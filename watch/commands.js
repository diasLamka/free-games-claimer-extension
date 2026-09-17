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
import { STATES, isExpired } from './offer.js';
import { MAX_PER_HOUR } from './claim.js';

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

  const raw = await readKeys(chrome, [KEYS.OFFERS, KEYS.FILTERS, KEYS.CADENCE, KEYS.SETTINGS, KEY_CANARY]);
  const settings = normaliseSettings(raw[KEYS.SETTINGS]);

  const { catalog, cadence, claims, canary } = await claimWhatCanBe({
    chrome,
    now,
    catalog: raw[KEYS.OFFERS] || {},
    filters: raw[KEYS.FILTERS] || {},
    claimableStores,
    /* Le meme filtre que le cycle. Sans lui, « Tout recuperer » rouvrirait la
       porte que la reclamation de fond vient de fermer, et sur un magasin que
       l'utilisateur a explicitement decoche. */
    watchedStores: settings.watchedStores,
    cadence: raw[KEYS.CADENCE] || [],
    /* « Tout recuperer » nourrit le canari comme un cycle ordinaire : un
       magasin casse l'est aussi quand c'est l'utilisateur qui clique, et
       c'est meme le moment ou il regarde. */
    canary: raw[KEY_CANARY] || {},
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
