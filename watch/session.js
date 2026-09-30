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
    // D'ou vient la mesure (2.99.6) : `page` quand une vraie page du magasin l'a montre.
    via: entry.via === VIA_PAGE ? VIA_PAGE : null,
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
export function recordSession(state, store, { status, note = null, via = null }, now) {
  if (typeof now !== 'number') throw new TypeError('recordSession : "maintenant" est obligatoire');
  const statut = Object.values(SESSION).includes(status) ? status : SESSION.UNKNOWN;
  const avant = readSession(state, store);
  return {
    ...(state || {}),
    [store]: {
      status: statut,
      note: note ? String(note).slice(0, 160) : null,
      at: now,
      ...(via === VIA_PAGE ? { via: VIA_PAGE } : {}),
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

/* ------------------------------------------------- confirmer par la page */

/** La mesure vient d'une vraie page du magasin, pas de la seule lecture d'une API. */
export const VIA_PAGE = 'page';

/**
 * Les deux magasins dont la session se renouvelle au chargement de leur PAGE
 * (2.99.6), et la page qui tranche.
 *
 * Steam et Epic gardent la session dans des jetons qui expirent en quelques
 * heures. Ce qui les renouvelle, c'est le script de la page quand elle se
 * charge -- pas une requete de l'extension. Passe ce delai, la sonde rapide
 * (une lecture avec les cookies) voit donc un jeton expire et conclut
 * « deconnecte » ou « inconnu » a quelqu'un qui est connecte, jusqu'au jour ou
 * il ouvre le magasin lui-meme : la page se charge, tout redevient vert. C'est
 * ce que les utilisateurs faisaient « a la main ». L'extension le fait donc a
 * leur place, dans une fenetre reduite, avant de croire un « non ».
 *
 * Mesure (2026-09-30, sans session) : /account/ de Steam atterrit sur
 * /login/?redir=account%2F&redir_ssl=1. Epic renvoie vers /id/login ; la page
 * d'Epic est derriere un mur anti-robot pour un client sans navigateur, d'ou
 * l'onglet plutot qu'un `fetch`.
 */
export const PAGE_URLS = Object.freeze({
  steam: 'https://store.steampowered.com/account/',
  epic: 'https://www.epicgames.com/account/personal',
});

/** GOG n'y est pas : sa page de compte s'ouvre sans rediriger, et sa sonde JSON est deja sans ambiguite. */
export const PAGE_STORES = Object.freeze(Object.keys(PAGE_URLS));

const CHALLENGE_TITLE = /just a moment|un instant|attention required|verify you are human|access denied|captcha/i;

/**
 * Ce que dit la page ou l'onglet a atterri. Pure.
 *
 * Une redirection vers la connexion est sans ambiguite. Rester sur la page du
 * compte dit « connecte ». Tout le reste -- un defi anti-robot, un controle
 * d'age, une page inattendue -- ne dit RIEN : `inconnu`, jamais `deconnecte`.
 */
export function judgePage(store, landed, title) {
  let u;
  try { u = new URL(String(landed || '')); } catch { return SESSION.UNKNOWN; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (CHALLENGE_TITLE.test(String(title || ''))) return SESSION.UNKNOWN;
  if (store === 'steam') {
    if (host === 'login.steampowered.com') return SESSION.OUT;
    if (host !== 'store.steampowered.com') return SESSION.UNKNOWN;
    if (path.startsWith('/login')) return SESSION.OUT;
    return path.startsWith('/account') ? SESSION.OK : SESSION.UNKNOWN;
  }
  if (store === 'epic') {
    if (!(host === 'epicgames.com' || host.endsWith('.epicgames.com'))) return SESSION.UNKNOWN;
    if (path.includes('/login')) return SESSION.OUT;
    return path.startsWith('/account') ? SESSION.OK : SESSION.UNKNOWN;
  }
  return SESSION.UNKNOWN;
}

/** Une session declaree perdue PAR UNE PAGE n'est pas re-verifiee avant : pas de fenetre pour un compte qui n'existe pas. */
export const PAGE_RECHECK_MS = 6 * 3600000;

/**
 * Faut-il charger la page ? Seulement si la sonde rapide n'a pas dit « oui »,
 * si le magasin s'y prete, et si une page n'a pas deja montre la perte il y a peu.
 */
export function needsPage(store, fastStatus, prev, now) {
  if (!PAGE_STORES.includes(store)) return false;
  if (fastStatus === SESSION.OK) return false;
  if (prev && prev.status === SESSION.OUT && prev.via === VIA_PAGE && Number.isFinite(prev.at) && now - prev.at < PAGE_RECHECK_MS) return false;
  return true;
}

/**
 * Le verdict final d'un magasin : la sonde rapide, puis la page si elle a ete
 * consultee (`page` : `{ url, title }`, ou `null` quand elle n'a rien donne,
 * ou `undefined` quand elle n'a pas ete consultee).
 *
 * Trois regles. Un « oui » de la sonde se croit tel quel. Un « non » ne devient
 * `deconnecte` que si la page l'a montre -- pour Steam et Epic, une sonde seule
 * dit `inconnu`. Une page muette ne condamne personne.
 */
export function settle(store, fast, page, prev, now) {
  const rapide = { status: fast.status, note: fast.note || null };
  if (rapide.status === SESSION.OK) return { ...rapide, via: null };
  if (!PAGE_STORES.includes(store)) return { ...rapide, via: null };

  // Deja perdue, page a l'appui, il y a peu : on garde ce verdict tel quel.
  if (page === undefined) {
    if (prev && prev.status === SESSION.OUT && prev.via === VIA_PAGE && Number.isFinite(prev.at) && now - prev.at < PAGE_RECHECK_MS) {
      return { status: SESSION.OUT, note: prev.note, via: VIA_PAGE, keep: true };
    }
    return rapide.status === SESSION.OUT
      ? { status: SESSION.UNKNOWN, note: `non confirmee par la page (${rapide.note || 'sonde'})`, via: null }
      : { ...rapide, via: null };
  }

  const verdict = page ? judgePage(store, page.url, page.title) : SESSION.UNKNOWN;
  if (verdict === SESSION.OK) return { status: SESSION.OK, note: 'confirmee par la page du compte', via: VIA_PAGE };
  if (verdict === SESSION.OUT) return { status: SESSION.OUT, note: 'la page du compte renvoie vers la connexion', via: VIA_PAGE };
  const vu = page ? String(page.title || page.url || '').replace(/\s+/g, ' ').trim().slice(0, 60) : 'page non chargee';
  return { status: SESSION.UNKNOWN, note: `la page n'a rien montre de net (${vu})`, via: null };
}

/* ------------------------------------------------------- sonde automatique */

/**
 * Quand une session doit etre resondee d'elle-meme (2.99.6).
 *
 * Une mesure « connecte » se renouvelle avant de vieillir (quatre heures : elle
 * ne s'affiche jamais en ambre) ; une mesure qui n'est pas `connecte` se
 * refait des qu'une demi-heure a passe, pour que la reconnexion soit vue vite.
 * La decision de charger la page, elle, est `needsPage` : un compte perdu ne
 * rouvre pas de fenetre avant six heures.
 */
export const REFRESH_AFTER_MS = 4 * 3600000;

export function dueForProbe(entry, now) {
  if (!entry || !Number.isFinite(entry.at)) return true;
  if (entry.status === SESSION.OK) return now - entry.at > REFRESH_AFTER_MS;
  return now - entry.at >= OUT_CONFIRM_MS;
}

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
