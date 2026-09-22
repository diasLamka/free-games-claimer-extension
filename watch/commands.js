/* Commandes venues du popup.
 *
 * Le popup ne peut pas les executer lui-meme : le catalogue n'a qu'un ecrivain,
 * le service worker. Sans cette regle, deux contextes ecrivent le meme objet
 * sans transaction, et le dernier a poser son `set()` efface le travail de
 * l'autre -- chrome.storage n'a rien pour l'empecher.
 *
 * Ce module porte la logique, background.js n'en garde que le branchement. Ce
 * decoupage n'est pas cosmetique : un service worker ne se teste pas, un module
 * qui recoit son `chrome` en parametre se teste.
 */
import { readKeys, write, writeCycle, normaliseSettings, KEYS } from './storage.js';
import { claimWhatCanBe, KEY_STOP } from './cycle.js';
import { KEY_CANARY } from './canary.js';
import { KEY_LIBRARY } from './library.js';
import { STATES, isExpired } from './offer.js';
import { MAX_PER_HOUR } from './claim.js';
import { claimableStoresFor } from './sources/index.js';
import { normaliseTitle } from './offer.js';
import { KEY_WISHLIST, addWish, removeWish } from './wishlist.js';

/**
 * Reclame tout ce qui peut l'etre, maintenant, a la demande.
 *
 * Un cycle ordinaire s'en tient a trois reclamations : il tourne seul, souvent,
 * et rien ne presse. Ici l'utilisateur vient de cliquer et regarde -- la limite
 * n'est plus la discretion mais le plafond horaire, qui protege le compte et
 * doit donc rester.
 */
/** L'arret d'urgence est-il tire ? Voir KEY_STOP dans watch/cycle.js. */
export async function isStopped(chrome) {
  const raw = await chrome.storage.local.get(KEY_STOP);
  return raw[KEY_STOP] === true;
}

export async function claimAllNow({ chrome, now = Date.now(), claimableStores, record = () => {} }) {
  if (await isStopped(chrome)) {
    record('warn', 'arret d\'urgence actif : aucune reclamation');
    return { claimed: 0, left: 0, claims: [], stopped: true };
  }

  const raw = await readKeys(chrome, [KEYS.OFFERS, KEYS.FILTERS, KEYS.CADENCE, KEYS.SETTINGS, KEY_CANARY, KEY_LIBRARY]);
  const settings = normaliseSettings(raw[KEYS.SETTINGS]);

  const { catalog, cadence, claims, canary } = await claimWhatCanBe({
    chrome,
    now,
    catalog: raw[KEYS.OFFERS] || {},
    filters: raw[KEYS.FILTERS] || {},
    /* L'option Steam s'applique ici comme au cycle -- et son rythme aussi :
       « Tout recuperer » ne prend jamais plus d'une offre Steam a la fois. */
    claimableStores: claimableStoresFor(settings, claimableStores),
    /* Le meme filtre que le cycle. Sans lui, « Tout recuperer » rouvrirait la
       porte que la reclamation de fond vient de fermer, et sur un magasin que
       l'utilisateur a explicitement decoche. */
    watchedStores: settings.watchedStores,
    cadence: raw[KEYS.CADENCE] || [],
    /* « Tout recuperer » nourrit le canari comme un cycle ordinaire : un
       magasin casse l'est aussi quand c'est l'utilisateur qui clique, et
       c'est meme le moment ou il regarde. */
    canary: raw[KEY_CANARY] || {},
    /* Et le meme registre : rouvrir un onglet sur un jeu deja possede coute un
       jeton du plafond horaire, que ce soit un cycle ou un clic qui l'ouvre. */
    library: raw[KEY_LIBRARY] || {},
    maxReclamations: MAX_PER_HOUR,
    record,
  });

  await writeCycle(chrome, { catalog, cadence, canary });

  const claimed = claims.filter((c) => c.verdict === 'claimed').length;
  return { claimed, left: claims.length - claimed, claims };
}

/**
 * Efface le recul d'une offre pour qu'elle reparte au prochain cycle.
 *
 * Le compteur d'essais repart a zero, et c'est voulu. Le recul et l'abandon au
 * cinquieme essai protegent contre les reprises AUTOMATIQUES, qui recommencent
 * sans que rien ait change. Ici quelqu'un vient d'agir -- se reconnecter,
 * resoudre un defi -- et la cause de l'echec n'est plus la meme. Garder le
 * compteur rendrait l'extension sourde au moment precis ou elle redevient
 * utile.
 *
 * Le garde-fou tient quand meme : chaque clic ne rouvre que cinq tentatives
 * espacees par le recul, et il faut un humain pour le refaire.
 */
export async function retryNow({ chrome, catalogKey, now = Date.now() }) {
  const raw = await readKeys(chrome, [KEYS.OFFERS]);
  const catalog = raw[KEYS.OFFERS] || {};
  const offer = catalog[catalogKey];
  if (!offer) return { retried: false };

  await writeCycle(chrome, {
    catalog: {
      ...catalog,
      [catalogKey]: { ...offer, nextAttemptAt: null, attempts: 0, updatedAt: now },
    },
  });
  return { retried: true };
}

/**
 * Duree pendant laquelle une offre terminee reste au catalogue.
 *
 * Elle n'est pas gardee par sentimentalisme : une source qui repond une liste
 * vide -- panne, changement de format, rate-limit -- ferait disparaitre tout le
 * catalogue si l'absence valait suppression immediate. La retention est le
 * delai au bout duquel une absence devient credible.
 */
export const KEEP_EXPIRED_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Purge les offres terminees et anciennes.
 *
 * Rien qui soit encore en cours ne part, quel que soit son age : une offre sans
 * date de fin peut etre ouverte depuis des mois et l'etre toujours demain.
 */
export async function pruneNow({ chrome, now = Date.now(), keepMs = KEEP_EXPIRED_MS }) {
  const raw = await readKeys(chrome, [KEYS.OFFERS]);
  const catalog = raw[KEYS.OFFERS] || {};

  const kept = {};
  let dropped = 0;

  for (const [key, offer] of Object.entries(catalog)) {
    const finished = offer
      && (offer.state === STATES.EXPIRED || offer.state === STATES.RESOLVED || isExpired(offer, now));
    const old = finished && typeof offer.updatedAt === 'number' && now - offer.updatedAt > keepMs;

    // Sans horodatage de mise a jour on ne sait pas depuis quand elle est
    // terminee : on la garde. Une purge qui devine se trompe dans le seul sens
    // qui coute.
    if (old) { dropped++; continue; }
    kept[key] = offer;
  }

  if (dropped) await write(chrome, { [KEYS.OFFERS]: kept });
  return { dropped, kept: Object.keys(kept).length };
}

/* ------------------------------------------------------- la file pilotable */

/**
 * Duree d'une mise en pause.
 *
 * Six heures : assez pour qu'une offre cesse d'occuper la tete de liste pendant
 * qu'on fait autre chose, assez court pour qu'elle revienne dans la journee.
 * Une pause qui durerait jusqu'a la fin de l'offre ne serait plus un report,
 * mais un refus deguise -- et le refus a deja son geste, la croix.
 */
export const SNOOZE_MS = 6 * 3600000;

/** Marge minimale avant la fin. En deca, reporter revient a renoncer. */
const SNOOZE_MARGIN_MS = 30 * 60000;

/**
 * Pose ou retire la priorite d'une offre.
 *
 * Elle s'ecrit sur le CATALOGUE et non dans les preferences d'affichage.
 * L'epinglage vivait dans `veille:ui`, que le service worker ne lit jamais :
 * il ordonnait la liste et ne changeait rien a ce qui etait reclame en
 * premier. Une etoile qui ne fait rien est pire qu'une etoile absente.
 */
export async function prioritise({ chrome, catalogKey, on = true, now = Date.now() }) {
  const raw = await readKeys(chrome, [KEYS.OFFERS]);
  const catalog = raw[KEYS.OFFERS] || {};
  const offer = catalog[catalogKey];
  if (!offer) return { changed: false };

  await writeCycle(chrome, {
    catalog: { ...catalog, [catalogKey]: { ...offer, priority: on === true, updatedAt: now } },
  });
  return { changed: true };
}

/**
 * Met une offre de cote, pour un temps.
 *
 * Une ECHEANCE, jamais un drapeau : un booleen demanderait a quelqu'un de
 * penser a le retirer, alors qu'une echeance se perime toute seule. C'est la
 * seule forme de report qui ne s'oublie pas.
 *
 * Bornee par la fin de l'offre. Reporter au-dela reviendrait a la refuser en
 * croyant la remettre a plus tard -- et le refus a deja son geste.
 */
export async function snooze({ chrome, catalogKey, now = Date.now(), ms = SNOOZE_MS }) {
  const raw = await readKeys(chrome, [KEYS.OFFERS]);
  const catalog = raw[KEYS.OFFERS] || {};
  const offer = catalog[catalogKey];
  if (!offer) return { changed: false };

  let until = now + ms;
  if (typeof offer.end === 'number' && offer.end > now) {
    until = Math.min(until, offer.end - SNOOZE_MARGIN_MS);
  }

  await writeCycle(chrome, {
    catalog: { ...catalog, [catalogKey]: { ...offer, snoozedUntil: until, updatedAt: now } },
  });
  return { changed: true, until };
}

/**
 * Reclame UNE offre, celle qu'on designe, tout de suite.
 *
 * Le chemin passe par `claimWhatCanBe` comme « Tout recuperer » : memes
 * filtres, meme canari, meme registre, meme plafond horaire. Un second chemin
 * de reclamation qui contournerait l'un des quatre serait le genre de raccourci
 * qui finit par ouvrir un onglet sur un magasin decoche.
 *
 * Une pause posee sur cette offre est IGNOREE : le report est une consigne pour
 * la reclamation automatique, et un clic explicite est plus recent que lui.
 */
export async function claimOneNow({
  chrome, catalogKey, now = Date.now(), claimableStores, record = () => {}, claim,
}) {
  if (await isStopped(chrome)) {
    record('warn', 'arret d\'urgence actif : aucune reclamation');
    return { claimed: 0, claims: [], stopped: true };
  }

  const raw = await readKeys(chrome, [KEYS.OFFERS, KEYS.FILTERS, KEYS.CADENCE, KEYS.SETTINGS, KEY_CANARY, KEY_LIBRARY]);
  const catalog = raw[KEYS.OFFERS] || {};
  const offer = catalog[catalogKey];
  if (!offer) return { claimed: 0, claims: [], reason: 'unknown' };

  const settings = normaliseSettings(raw[KEYS.SETTINGS]);

  /* Le catalogue reduit a cette seule offre, sa pause levee. Reduire l'ENTREE
     plutot que filtrer la sortie garantit qu'aucune autre offre ne peut etre
     tentee par ce chemin, quelles que soient les evolutions de
     `claimWhatCanBe`. */
  const seule = { [catalogKey]: { ...offer, snoozedUntil: null } };

  const r = await claimWhatCanBe({
    chrome,
    now,
    catalog: seule,
    filters: raw[KEYS.FILTERS] || {},
    claimableStores: claimableStoresFor(settings, claimableStores),
    watchedStores: settings.watchedStores,
    cadence: raw[KEYS.CADENCE] || [],
    canary: raw[KEY_CANARY] || {},
    library: raw[KEY_LIBRARY] || {},
    maxReclamations: 1,
    record,
    claim,
  });

  /* Reinjecter dans le catalogue COMPLET : `claimWhatCanBe` n'a vu qu'une
     entree, ecrire son resultat tel quel effacerait toutes les autres. */
  await writeCycle(chrome, {
    catalog: { ...catalog, ...r.catalog },
    cadence: r.cadence,
    canary: r.canary,
  });

  const claimed = r.claims.filter((c) => c.verdict === 'claimed').length;
  return { claimed, claims: r.claims };
}

/**
 * Ajoute ou retire un souhait.
 *
 * Passe par le service worker plutot que d'etre ecrit depuis le popup, et pour
 * une raison precise : la liste est LUE a chaque cycle. Deux ecrivains sur une
 * cle que le worker relit, sans transaction, c'est la perte silencieuse d'un
 * des deux -- et ce qui serait perdu ici est un choix que l'utilisateur vient
 * d'exprimer.
 *
 * La normalisation passee est celle du modele d'offre, la seule avec laquelle
 * le rapprochement veut dire quelque chose.
 */
export async function wish({ chrome, title, on = true }) {
  const raw = await readKeys(chrome, [KEY_WISHLIST]);
  const avant = raw[KEY_WISHLIST] || [];
  const apres = on
    ? addWish(avant, title, normaliseTitle)
    : removeWish(avant, title, normaliseTitle);

  await write(chrome, { [KEY_WISHLIST]: apres });
  return { wishes: apres.length };
}
