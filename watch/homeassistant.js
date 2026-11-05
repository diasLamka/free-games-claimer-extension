/* La maison : Home Assistant (2.116.0).
 *
 * Les alertes de l'extension s'arretent au telephone et a l'ecran. Home
 * Assistant, lui, sait faire autre chose d'un jeu offert : allumer une lampe au
 * moment ou il tombe, tenir un capteur « jeux a prendre » sur le tableau de
 * bord, lire le titre au salon.
 *
 * Il n'y a RIEN a installer chez lui. Une automatisation HA qui declare un
 * declencheur `webhook` recoit tout POST envoye a son adresse, et lit le corps
 * en JSON : c'est tout le protocole. Pas de jeton, pas de courtier MQTT, pas de
 * serveur a nous : l'adresse du webhook EST le secret, comme le sujet ntfy.
 *
 * CE QUI PART, ET CE QUI NE PART JAMAIS. Les titres des jeux a prendre, leur
 * magasin, le lien de leur fiche, leur jaquette, leur fin, leur valeur -- tout
 * ce que n'importe quelle page de magasin montre. Jamais un code de rachat,
 * jamais un identifiant de compte, jamais un cookie : la requete part sans les
 * cookies du navigateur (`credentials: 'omit'`) et ne suit aucune redirection.
 *
 * UN SEUL SENS. Home Assistant n'envoie rien a l'extension : le bouton « tout
 * recuperer » depuis la maison demanderait une porte ouverte, et le design n'en
 * ouvre pas.
 *
 * LAN D'ABORD, MAIS JAMAIS EN CLAIR SUR INTERNET. Un Home Assistant tourne le
 * plus souvent en http sur le reseau local : l'adresse en http n'est donc
 * acceptee que pour un hote local (adresse privee, `.local`, nom sans point).
 * Hors du reseau local, https est exige.
 *
 * Coupe par defaut. Module PUR, sauf `pushHome`, qui recoit le stockage.
 */

/** La configuration. Ecrite par le popup seul ; jamais synchronisee (l'adresse est un secret). */
export const KEY_HOME = 'veille:maison';

/** Le dernier envoi, et l'empreinte du dernier etat envoye : ecrit par le worker seul. */
export const KEY_HOME_STATE = 'veille:maison-etat';

export const DEFAULT_HOME = Object.freeze({ on: false, url: '' });

/** Les genres d'evenement. L'automatisation filtre sur `trigger.json.event`. */
export const EVENTS = Object.freeze({ TEST: 'test', NEW: 'new_offers', CLAIMED: 'claimed', STATE: 'state' });

/** Ce que l'automatisation lit pour savoir d'ou ca vient. */
export const SOURCE = 'free-games-claimer';

/** La version du format : elle monte si un champ change de sens, jamais pour en ajouter un. */
export const FORMAT = 1;

/** Un reseau local repond vite ; au-dela, quelque chose ne va pas. */
export const TIMEOUT_MS = 8000;

/** Un etat inchange est renvoye au plus toutes les six heures : un capteur qui ne bouge pas ne doit pas se croire mort. */
export const HEARTBEAT_MS = 6 * 3600 * 1000;

/** Au plus douze jeux par message : un attribut d'entite HA ne depasse pas 16 Ko. */
export const MAX_GAMES = 12;

export function readHome(raw) {
  const h = { ...DEFAULT_HOME, ...(raw && typeof raw === 'object' ? raw : {}) };
  return { on: h.on === true, url: typeof h.url === 'string' ? h.url.trim() : '' };
}

/* ------------------------------------------------------------ l'adresse */

/**
 * Cet hote est-il sur le reseau local ?
 *
 * `URL` a deja normalise l'adresse : `0x7f.1` y est devenu `127.0.0.1`, donc la
 * lecture ci-dessous ne voit que des formes canoniques.
 */
export function isLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost') return true;
  if (/\.(local|lan|home\.arpa|internal)$/.test(h)) return true;
  // IPv6 : l'hote d'une URL garde ses crochets.
  if (h.startsWith('[') && h.endsWith(']')) {
    const v6 = h.slice(1, -1);
    return v6 === '::1' || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if (a > 255 || b > 255 || c > 255 || d > 255) return false;
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  // Un nom sans point (« homeassistant ») ne se resout que sur le reseau local.
  return !h.includes('.') && !h.includes(':');
}

/**
 * L'adresse d'un webhook Home Assistant, verifiee -- ou null.
 *
 * `http(s)://hote[:port]/api/webhook/<identifiant>` : celle que HA montre dans
 * l'automatisation. Ou celle du Cloud (Nabu Casa) : `https://hooks.nabu.casa/<jeton>`.
 * Sans identifiants dans l'adresse ni requete -- ils finiraient au journal.
 */
export function homeUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.protocol === 'http:') {
    if (!isLocalHost(u.hostname)) return null;
  } else if (u.protocol !== 'https:') {
    return null;
  }
  const chemin = u.pathname.replace(/\/+$/, '');
  const hote = u.hostname.toLowerCase();
  const direct = /^\/api\/webhook\/[A-Za-z0-9_-]{8,128}$/.test(chemin);
  const nabu = hote === 'hooks.nabu.casa' && u.protocol === 'https:' && /^\/[A-Za-z0-9_-]{20,200}$/.test(chemin);
  if (!direct && !nabu) return null;
  return `${u.origin}${chemin}`;
}

/**
 * Le motif de permission a demander : `http://hote/*`, SANS le port -- un
 * motif d'hote ne porte pas de port, et celui sans port les couvre tous.
 */
export function originPattern(url) {
  const ok = homeUrl(url);
  if (!ok) return null;
  const u = new URL(ok);
  return `${u.protocol}//${u.hostname}/*`;
}

/** La cible d'envoi, seulement si la maison est activee ET l'adresse valide. */
export function homeTarget(raw) {
  const h = readHome(raw);
  if (!h.on) return null;
  const url = homeUrl(h.url);
  return url ? { url } : null;
}

/* -------------------------------------------------------- le message */

const str = (v) => (typeof v === 'string' ? v : '');
const https = (v) => (typeof v === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/i.test(v) ? v : null);

/** Un jeu, tel que l'automatisation le lit. Rien qui ne soit deja public. */
export function gameEntry(o, { labels = {} } = {}) {
  const fin = typeof o.end === 'number' && Number.isFinite(o.end) ? new Date(o.end).toISOString() : null;
  return {
    title: str(o.title).slice(0, 120),
    store: str(o.store),
    store_label: str(labels[o.store]) || str(o.store),
    url: https(o.url) || https(o.resolveUrl),
    image: https(o.image),
    end: fin,
    worth: str(o.worth) || null,
    wished: o.wished === true,
  };
}

/**
 * L'etat : ce qu'il y a a prendre maintenant. `count` dit TOUT, `games` n'en
 * montre que douze, les plus pressantes d'abord (fin la plus proche).
 */
export function snapshot(offers, { labels = {} } = {}) {
  const liste = (offers || []).filter((o) => o && o.title);
  const tries = [...liste].sort((a, b) => {
    const ea = typeof a.end === 'number' ? a.end : Infinity;
    const eb = typeof b.end === 'number' ? b.end : Infinity;
    return ea - eb;
  });
  const games = tries.slice(0, MAX_GAMES).map((o) => gameEntry(o, { labels }));
  const premiere = games.find((g) => g.end);
  return {
    count: liste.length,
    titles: games.map((g) => g.title).join(', '),
    next_end: premiere ? premiere.end : null,
    next_end_title: premiere ? premiere.title : null,
    games,
  };
}

/**
 * Le corps d'un evenement. Chaque evenement porte l'etat COMPLET (`count`,
 * `games`...), de sorte qu'une automatisation n'a besoin de lire qu'un seul
 * genre de message pour tenir un capteur a jour.
 *
 *   new_offers : de nouveaux jeux viennent d'etre annonces (`new`) ;
 *   claimed    : l'extension vient de prendre des jeux (`claimed`) ;
 *   state      : l'etat a change, ou six heures ont passe ;
 *   test       : le bouton « Essayer » du popup.
 */
export function homeEvent(event, { offers = [], fresh = [], claimed = [], now, quiet = false, labels = {}, version = null } = {}) {
  const corps = {
    source: SOURCE,
    format: FORMAT,
    event,
    at: new Date(typeof now === 'number' ? now : Date.now()).toISOString(),
    quiet: quiet === true,
    ...snapshot(offers, { labels }),
  };
  if (event === EVENTS.NEW) corps.new = (fresh || []).filter((o) => o && o.title).slice(0, MAX_GAMES).map((o) => gameEntry(o, { labels }));
  if (event === EVENTS.CLAIMED) corps.claimed = (claimed || []).map(str).filter(Boolean).slice(0, 20);
  if (version) corps.version = str(version);
  return corps;
}

/** Une empreinte courte (FNV-1a) de l'etat : de quoi dire « rien n'a change ». */
export function stateHash(corps) {
  const s = JSON.stringify([corps.count, (corps.games || []).map((g) => [g.title, g.store, g.end])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

/** Faut-il renvoyer l'etat ? Il a change, ou le dernier a plus de six heures, ou il n'est jamais parti. */
export function shouldSendState(prev, corps, now) {
  if (!prev || typeof prev.hash !== 'string' || typeof prev.stateAt !== 'number') return true;
  if (prev.hash !== stateHash(corps)) return true;
  return now - prev.stateAt >= HEARTBEAT_MS;
}

/* -------------------------------------------------------------- l'envoi */

export function homeRequest(target, corps) {
  return {
    url: target.url,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      credentials: 'omit',
      cache: 'no-store',
      // Une redirection mene ailleurs que chez l'utilisateur : on s'arrete.
      redirect: 'error',
    },
  };
}

/** Ce qu'un statut veut dire, pour qui doit corriger sa configuration. */
export function describeStatus(status) {
  if (status === 400) return 'HTTP 400 : Home Assistant a refuse le message';
  if (status === 401 || status === 403) return `HTTP ${status} : acces refuse -- l'adresse passe-t-elle par un proxy qui demande une connexion ?`;
  if (status === 404) return 'HTTP 404 : adresse du webhook introuvable';
  if (status === 405) return 'HTTP 405 : ce n\'est pas l\'adresse d\'un webhook Home Assistant';
  if (status === 413) return 'HTTP 413 : message trop long';
  if (status === 429) return 'HTTP 429 : trop de messages, le serveur limite';
  return `HTTP ${status}`;
}

/**
 * Envoie. Ne jette jamais : rend `{ ok, status, note }`.
 *
 * Home Assistant repond 200 meme quand aucune automatisation n'ecoute cette
 * adresse : un succes dit « le message est arrive », pas « quelqu'un l'a lu ».
 */
export async function sendHome({ fetch: fetchImpl, target, corps, timeoutMs = TIMEOUT_MS }) {
  if (!target || !corps) return { ok: false, status: 0, note: 'rien a envoyer' };
  const { url, init } = homeRequest(target, corps);
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, { ...init, signal: arret ? arret.signal : undefined });
    if (r.ok) return { ok: true, status: r.status, note: null };
    return { ok: false, status: r.status, note: describeStatus(r.status) };
  } catch (e) {
    const coupe = arret && arret.signal.aborted;
    return { ok: false, status: 0, note: coupe ? `delai depasse (${timeoutMs} ms)` : 'Home Assistant ne repond pas (adresse, reseau, certificat ?)' };
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/**
 * Envoie, et garde la trace du resultat pour le popup. La SEULE fonction de ce
 * module qui touche au stockage, et elle le recoit en parametre.
 *
 * L'adresse n'est jamais ecrite au journal : elle contient le secret. Un echec
 * dit pourquoi (`note`), jamais ou.
 */
export async function pushHome({ chrome, fetch: fetchImpl, target, corps, now, record = () => {}, why = 'evenement' }) {
  const r = await sendHome({ fetch: fetchImpl, target, corps });
  record(r.ok ? 'info' : 'warn', r.ok ? `maison : ${why} envoye` : `maison : ${why} non envoye -- ${r.note}`);
  try {
    const prev = (await chrome.storage.local.get(KEY_HOME_STATE))[KEY_HOME_STATE] || {};
    const next = { ...prev, at: now, ok: r.ok, status: r.status, note: r.note, why };
    // Chaque message porte l'etat complet : un envoi reussi vaut aussi etat envoye.
    if (r.ok && corps.event !== EVENTS.TEST) { next.hash = stateHash(corps); next.stateAt = now; }
    await chrome.storage.local.set({ [KEY_HOME_STATE]: next });
  } catch { /* l'etat est un confort, pas une garantie */ }
  return r;
}
