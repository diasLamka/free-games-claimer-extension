/* Etes-vous connecte, magasin par magasin ?
 *
 * CE QUE CETTE QUESTION A COUTE. Trois versions de suite, les 19 et 20
 * septembre 2026, ont ete depensees a chercher pourquoi Steam ne reclamait
 * rien. La reponse tenait a une question que l'extension ne savait pas poser :
 * suis-je connecte ? Elle la devinait depuis le service worker -- une lecture
 * de `dynamicstore/userdata` qui rend des listes vides aussi bien pour « pas
 * de session » que pour « le worker n'a pas vu la session » -- et elle se
 * taisait. L'utilisateur voyait « aucune action », et rien d'autre.
 *
 * Ce module ne devine plus : il MESURE, il DATE, et il le montre.
 *
 * TROIS PRINCIPES.
 *
 *   1. Ne pas savoir est un etat, pas un echec. `inconnu` existe, il
 *      s'affiche, et il ne se confond ni avec « connecte » ni avec
 *      « deconnecte ». La 2.22.2 a ete ecrite parce qu'une lecture muette
 *      avait ete prise pour une absence de session.
 *   2. Une mesure a une date. Un « connecte » d'il y a trois jours ne dit
 *      rien d'aujourd'hui ; l'interface doit pouvoir le dire aussi.
 *   3. Un magasin qu'on ne sait pas sonder le dit. Amazon n'a pas de lecture
 *      mesuree (`watch/collection.js`) : il rend `non-sondable`, pas
 *      `inconnu`. Les deux se ressemblent et ne veulent pas dire la meme
 *      chose -- l'un attend une mesure, l'autre attend du code.
 *
 * Module PUR : aucune API d'extension, aucun acces reseau, aucune horloge
 * implicite. La sonde elle-meme vit dans `watch/collection-import.js`, avec
 * les autres lectures authentifiees et le `judge` qu'elles partagent.
 */
import { IMPORT_STATUS } from './collection.js';

export const KEY_SESSIONS = 'veille:sessions';

/** L'etat d'une session, du point de vue de l'utilisateur. */
export const SESSION = Object.freeze({
  /** La lecture a abouti et le compte a repondu. */
  OK: 'ok',
  /** Le magasin dit lui-meme qu'il n'y a pas de session. */
  OUT: 'logged_out',
  /** La lecture a echoue, ou n'a rien dit de concluant. */
  UNKNOWN: 'unknown',
  /** Aucune sonde n'existe pour ce magasin, et ce n'est pas un incident. */
  UNSUPPORTED: 'unsupported',
});

/**
 * Les magasins sondables, et pourquoi les autres ne le sont pas.
 *
 * Les trois memes que `IMPORTABLE_STORES` -- et ce n'est pas une
 * coincidence : sonder une session, c'est faire la plus petite des lectures
 * authentifiees que l'import fait deja.
 */
export const PROBED_STORES = Object.freeze(['steam', 'gog', 'epic']);

/** Ou se reconnecter, quand la sonde dit non. Mesurees, pas devinees. */
export const LOGIN_URLS = Object.freeze({
  steam: 'https://store.steampowered.com/login/',
  gog: 'https://www.gog.com/account',
  epic: 'https://www.epicgames.com/id/login',
});

/* ------------------------------------------------------------- traduction */

/**
 * Le vocabulaire de l'import devient celui de la session.
 *
 * `shape` -- une reponse lue mais pas de la forme attendue -- devient
 * `inconnu` et JAMAIS `deconnecte`. C'est precisement la confusion qui a
 * coute la 2.22.2 : une adresse qui a change ressemble a une session absente,
 * et dire « reconnectez-vous » a quelqu'un qui l'est deja l'envoie tourner en
 * rond.
 */
export function fromImportStatus(status) {
  if (status === IMPORT_STATUS.OK) return SESSION.OK;
  if (status === IMPORT_STATUS.LOGGED_OUT) return SESSION.OUT;
  return SESSION.UNKNOWN;
}

/* ---------------------------------------------------------------- lecture */

/** Ce qu'on sait d'un magasin, avec sa date. Jamais undefined. */
export function readSession(state, store) {
  const entry = state && state[store];
  if (!PROBED_STORES.includes(store)) {
    return { store, status: SESSION.UNSUPPORTED, note: null, at: null };
  }
  if (!entry || typeof entry !== 'object') {
    return { store, status: SESSION.UNKNOWN, note: null, at: null };
  }
  return {
    store,
    status: Object.values(SESSION).includes(entry.status) ? entry.status : SESSION.UNKNOWN,
    note: typeof entry.note === 'string' ? entry.note : null,
    at: Number.isFinite(entry.at) ? entry.at : null,
    // Depuis quand la sonde dit « deconnecte » sans discontinuer (2.99.4). Une entree plus ancienne : sa date.
    outSince: Number.isFinite(entry.outSince) ? entry.outSince : (entry.status === SESSION.OUT && Number.isFinite(entry.at) ? entry.at : null),
  };
}

/**
 * Une sonde qui dit « deconnecte » une seule fois ne suffit pas a le dire a
 * l'utilisateur (2.99.4) : un magasin en maintenance, une page d'accueil
 * servie a la place, un portail captif au reveil rendent la meme reponse
 * qu'une session perdue. Il faut qu'elle le redise une demi-heure plus tard.
 */
export const OUT_CONFIRM_MS = 30 * 60 * 1000;

/** Enregistre une mesure. Rend un nouvel etat : rien n'est modifie en place. */
export function recordSession(state, store, { status, note = null }, now) {
  if (typeof now !== 'number') throw new TypeError('recordSession : "maintenant" est obligatoire');
  const statut = Object.values(SESSION).includes(status) ? status : SESSION.UNKNOWN;
  const avant = readSession(state, store);
  return {
    ...(state || {}),
    [store]: {
      status: statut,
      note: note ? String(note).slice(0, 160) : null,
      at: now,
      // La serie de « deconnecte » garde son debut ; toute autre mesure la casse.
      ...(statut === SESSION.OUT ? { outSince: avant.status === SESSION.OUT && avant.outSince !== null ? avant.outSince : now } : {}),
    },
  };
}

/* -------------------------------------------------------------- fraicheur */

/**
 * Au-dela, une mesure ne dit plus rien d'aujourd'hui.
 *
 * Six heures : assez pour qu'une verification par cycle suffise, assez court
 * pour qu'une deconnexion de la nuit soit visible au matin.
 */
export const STALE_AFTER_MS = 6 * 3600000;

export function isStale(entry, now) {
  if (!entry || !Number.isFinite(entry.at)) return true;
  return now - entry.at > STALE_AFTER_MS;
}

/* CE QUI N'EST PAS ICI, ET POURQUOI.
 *
 * Il manque volontairement un `dueForProbe` -- la fonction qui dirait quels
 * magasins resonder d'eux-memes a chaque cycle. Elle avait ete ecrite, puis
 * retiree : sonder, c'est lire un compte AVEC la session de l'utilisateur,
 * et l'extension ne fait jamais cela toute seule. L'importation de
 * collection s'en tient a la meme regle depuis la 2.21.0, pour la meme
 * raison, et la livrer inutilisee aurait laisse dans le depot une fonction
 * qui contredit ce que `SECURITY.md` promet.
 *
 * Le jour ou une sonde automatique se justifiera -- avant une reclamation,
 * par exemple, pour ne pas ouvrir un onglet vers un compte deconnecte -- elle
 * se reecrira en trois lignes a partir d'`isStale`. */

/* ---------------------------------------------------------------- resume */

/**
 * Une ligne pour l'interface : y a-t-il quelque chose a faire ?
 *
 * `actionable` ne compte QUE les `logged_out`. Un `inconnu` n'envoie
 * personne se reconnecter -- c'est la lecon de la 2.22.2, et elle tient
 * jusque dans le compteur.
 */
export function summarise(state, { watchedStores = [] } = {}) {
  const stores = PROBED_STORES.filter((s) => !watchedStores.length || watchedStores.includes(s));
  const rows = stores.map((s) => readSession(state, s));
  return {
    rows,
    ok: rows.filter((r) => r.status === SESSION.OK).length,
    out: rows.filter((r) => r.status === SESSION.OUT).length,
    unknown: rows.filter((r) => r.status === SESSION.UNKNOWN).length,
    actionable: rows.filter((r) => r.status === SESSION.OUT).map((r) => r.store),
  };
}
