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
import { KEY_TAUGHT, forget, learn } from './teaching.js';
import { GAMES_URL, KEY_PLAYTIME, parseGamesXml, playtimeTable } from './playtime.js';
import { BRIDGE_NAME, makeSnapshot } from './bridge.js';
import { KEY_COLLECTION } from './collection.js';
import { KEY_OUTCOMES } from './outcomes.js';

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

export async function claimAllNow({ chrome, now = Date.now(), claimableStores, record = () => {}, fetch: fetchImpl, claim }) {
  if (await isStopped(chrome)) {
    record('warn', 'arret d\'urgence actif : aucune reclamation');
    return { claimed: 0, left: 0, claims: [], stopped: true };
  }

  const raw = await readKeys(chrome, [KEYS.OFFERS, KEYS.FILTERS, KEYS.CADENCE, KEYS.SETTINGS, KEY_CANARY, KEY_LIBRARY, KEY_COLLECTION]);
  const settings = normaliseSettings(raw[KEYS.SETTINGS]);

  const { catalog, cadence, claims, canary } = await claimWhatCanBe({
    chrome,
    now,
    fetch: fetchImpl,
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
    // Et ce que les magasins disent deja que vous possedez.
    collection: raw[KEY_COLLECTION] || null,
    maxReclamations: MAX_PER_HOUR,
    record,
    // Le geste de reclamation, injectable pour les tests (claimOneNow fait de meme) ; absent, c'est claimOffer.
    claim,
    // Un clic de l'utilisateur : voir `forced` dans claimWhatCanBe.
    forced: true,
    // Mais en bloc : ce que le registre dit pris ne rouvre pas d'onglet (2.108.1).
    trustKnownOwned: true,
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

  /* « Rien a prendre » confirme (2.106.0) clot l'offre ; un clic de l'utilisateur la
     rouvre -- et lui rend sa question « montrez-moi le bouton », qu'il peut vouloir
     entendre une seconde fois. */
  const rouvre = offer.verdict === 'gone' && offer.state === STATES.RESOLVED;
  await writeCycle(chrome, {
    catalog: {
      ...catalog,
      [catalogKey]: {
        ...offer,
        nextAttemptAt: null,
        attempts: 0,
        asks: 0,
        goneAt: null,
        ...(rouvre ? { state: STATES.QUEUED, verdict: null } : {}),
        updatedAt: now,
      },
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
  chrome, catalogKey, now = Date.now(), claimableStores, record = () => {}, claim, fetch: fetchImpl,
}) {
  if (await isStopped(chrome)) {
    record('warn', 'arret d\'urgence actif : aucune reclamation');
    return { claimed: 0, claims: [], stopped: true };
  }

  const raw = await readKeys(chrome, [KEYS.OFFERS, KEYS.FILTERS, KEYS.CADENCE, KEYS.SETTINGS, KEY_CANARY, KEY_LIBRARY, KEY_COLLECTION]);
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
    fetch: fetchImpl,
    catalog: seule,
    filters: raw[KEYS.FILTERS] || {},
    claimableStores: claimableStoresFor(settings, claimableStores),
    watchedStores: settings.watchedStores,
    cadence: raw[KEYS.CADENCE] || [],
    canary: raw[KEY_CANARY] || {},
    library: raw[KEY_LIBRARY] || {},
    collection: raw[KEY_COLLECTION] || null,
    maxReclamations: 1,
    record,
    claim,
    forced: true,
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

/**
 * Apprend, ou oublie, un libelle de bouton.
 *
 * Passe par le service worker et non par le popup, pour la meme raison que la
 * liste de souhaits : le MOTEUR lit cette cle de facon synchrone avant chaque
 * clic. Deux ecrivains sans transaction y perdraient silencieusement un
 * apprentissage -- et ce qui serait perdu ici est la seule chose qui repare
 * l'extension.
 *
 * Le refus remonte tel quel : un apprentissage refuse en silence ferait croire
 * a une reparation qui n'a pas eu lieu.
 */
export async function teach({ chrome, surface, label, on = true, now = Date.now() }) {
  const raw = await readKeys(chrome, [KEY_TAUGHT]);
  const avant = raw[KEY_TAUGHT] || {};

  if (!on) {
    const apres = forget(avant, surface, label);
    await write(chrome, { [KEY_TAUGHT]: apres });
    return { learned: false, forgotten: true, reason: null };
  }

  const r = learn(avant, { surface, label, now });
  if (r.learned) await write(chrome, { [KEY_TAUGHT]: r.taught });
  return { learned: r.learned, forgotten: false, reason: r.reason };
}

/**
 * Lit le temps de jeu Steam, SUR UN GESTE et jamais autrement.
 *
 * Cette lecture emporte les cookies de la session et touche un hote qui n'est
 * pas dans le manifeste : il est demande en permission optionnelle au moment
 * du clic, et retirable ensuite. C'est la meme posture que l'import de
 * collection, et la meme phrase de SECURITY.md qu'elle respecte -- l'extension
 * ne lit jamais un compte de sa propre initiative.
 *
 * Rend un rapport meme en cas d'echec : la forme d'une reponse CONNECTEE n'a
 * jamais ete mesuree dans ce depot, et le premier utilisateur a cliquer sera
 * celui qui la mesure. Un echec muet lui ferait croire a une panne de son
 * compte ; un rapport lui donne de quoi corriger le lecteur du premier coup.
 */
export async function readPlaytime({ chrome, fetch: fetchImpl = fetch, now = Date.now() }) {
  let texte;
  try {
    const r = await fetchImpl(GAMES_URL, {
      credentials: 'include',
      headers: { Accept: 'text/xml,application/xml' },
    });
    if (!r.ok) return { ok: false, reason: `HTTP ${r.status}`, count: 0 };
    texte = await r.text();
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e), count: 0 };
  }

  const jeux = parseGamesXml(texte);
  if (!jeux.length) {
    /* Zero jeu lu veut dire soit « profil prive », soit « forme inattendue ».
       Les deux se corrigent par un geste de l'utilisateur, et aucun des deux
       ne doit effacer ce qu'on savait deja. */
    return { ok: false, reason: 'aucun jeu lu : profil prive, ou forme inattendue', count: 0 };
  }

  await write(chrome, { [KEY_PLAYTIME]: { at: now, games: playtimeTable(jeux) } });
  return { ok: true, reason: null, count: jeux.length };
}

/**
 * Envoie un instantane a la passerelle locale.
 *
 * Le navigateur DEMARRE le programme hote a la connexion et le tue a la
 * fermeture : rien ne tourne en permanence, rien n'ecoute sur un port.
 *
 * On se deconnecte des l'accuse de reception, ou apres un delai. Laisser la
 * connexion ouverte garderait un processus vivant sur la machine de quelqu'un
 * pour rien -- et un canal ouvert qu'on a oublie est le genre de chose qu'on
 * ne remarque que le jour ou elle pose probleme.
 */
export async function sendToBridge({ chrome, now = Date.now(), timeoutMs = 5000 }) {
  const raw = await readKeys(chrome, [KEY_COLLECTION, KEY_LIBRARY, KEY_OUTCOMES, KEY_PLAYTIME]);

  const instantane = makeSnapshot({
    collection: (raw[KEY_COLLECTION] || {}).items || {},
    library: raw[KEY_LIBRARY] || {},
    outcomes: raw[KEY_OUTCOMES] || {},
    playtime: (raw[KEY_PLAYTIME] || {}).games || {},
    now,
  });

  return new Promise((resolve) => {
    let port;
    let fini = false;

    const finir = (resultat) => {
      if (fini) return;
      fini = true;
      try { if (port) port.disconnect(); } catch { /* deja fermee */ }
      resolve(resultat);
    };

    try {
      port = chrome.runtime.connectNative(BRIDGE_NAME);
    } catch (e) {
      return finir({ ok: false, reason: (e && e.message) || String(e) });
    }

    /* Un hote absent ou mal declare ne produit PAS d'erreur : il produit une
       deconnexion immediate. C'est le symptome le plus frequent, et le moins
       explicite du navigateur -- d'ou le motif recopie tel quel. */
    port.onDisconnect.addListener(() => {
      const erreur = chrome.runtime.lastError;
      finir({ ok: false, reason: (erreur && erreur.message) || 'passerelle absente ou mal declaree' });
    });

    port.onMessage.addListener((reponse) => {
      finir(reponse && reponse.ok
        ? { ok: true, written: reponse.written || null, sent: instantane.owned.length + instantane.claimed.length }
        : { ok: false, reason: (reponse && reponse.error) || 'reponse inattendue' });
    });

    setTimeout(() => finir({ ok: false, reason: 'aucune reponse de la passerelle' }), timeoutMs);

    try { port.postMessage(instantane); } catch (e) {
      finir({ ok: false, reason: (e && e.message) || String(e) });
    }
  });
}
