/* Les prix des souhaits : le meilleur prix du moment, le plus bas jamais vu, et chez qui.
 *
 * DEUX SOURCES, la meme forme de reponse.
 *
 *  - IsThereAnyDeal (ITAD), avec la cle PERSONNELLE de l'utilisateur : des prix dans la devise de son pays (des euros pour la
 *    France), par marchand, avec le plus bas historique. C'est la source qui dit la meme chose que l'appli.
 *  - CheapShark, sans cle : le meilleur prix chez les marchands qu'il suit, le plus bas historique -- en DOLLARS, seule
 *    devise qu'il connaisse. Le popup les lit en euros au taux du jour, marques "environ" (lib/money.js).
 *
 * Sans cle ITAD, ou si la cle est refusee, CheapShark prend le relais : un souhait n'est jamais sans prix pour une cle
 * mal recopiee. Le contraire n'est pas vrai : une cle valide l'emporte.
 *
 * CONDITIONS D'ITAD, respectees ici (https://docs.isthereanydeal.com/) :
 *   - usage PERSONNEL : la cle est celle de l'utilisateur, jamais une cle du projet ; elle reste sur cette machine, hors de
 *     toute sauvegarde, de tout relais et de toute alerte ;
 *   - les donnees ne sont PAS modifiees : le prix est celui qu'ITAD donne dans la devise du pays demande (aucune conversion),
 *     et l'adresse du marchand est gardee telle quelle, etiquettes d'affiliation comprises ;
 *   - un lien et la mention de la source accompagnent ce qu'on montre (le popup l'ecrit) ;
 *   - un cache : six heures par souhait, six souhaits par passage -- loin des mille requetes par cinq minutes permises.
 *
 * CE QUI QUITTE LA MACHINE : le titre (ou l'identifiant Steam) d'un souhait, et la cle ITAD, vers ces deux services -- et
 * seulement quand l'utilisateur a coche "Prix des souhaits". Voir SECURITY.md.
 *
 * Pur, sauf `refreshPrices` et `testItad`, qui recoivent leur `fetch`.
 */
import { normaliseTitle } from './offer.js';

/** Le cache des prix, par souhait ; et la cle ITAD de l'utilisateur (un secret : jamais dans une sauvegarde). */
export const KEY_PRICES = 'veille:prix';
export const KEY_ITAD = 'veille:itad';

export const SOURCES = Object.freeze({ ITAD: 'itad', SHARK: 'cheapshark' });

export const FRESH_MS = 6 * 60 * 60 * 1000;
export const NOT_FOUND_MS = 3 * 24 * 60 * 60 * 1000;
export const PER_RUN = 6;
const PAUSE_MS = 1200;
const MAX_DEALS = 8;

const ITAD = 'https://api.isthereanydeal.com';
const SHARK = 'https://www.cheapshark.com/api/1.0';

const enc = (s) => encodeURIComponent(String(s ?? '').slice(0, 120));

/* ----------------------------------------------------------------- la cle */

const KEY_FORM = /^[A-Za-z0-9_-]{8,128}$/;

/** La cle ITAD stockee, ou null : une valeur qui n'a pas la forme d'une cle n'est pas envoyee. */
export function itadKey(raw) {
  const k = raw && typeof raw === 'object' && typeof raw.key === 'string' ? raw.key.trim() : '';
  return KEY_FORM.test(k) ? k : null;
}

/** La cle saisie, nettoyee, ou null. */
export function cleanKey(text) {
  const k = String(text || '').trim();
  return KEY_FORM.test(k) ? k : null;
}

/* ------------------------------------------------------------- CheapShark */

export const sharkSearchUrl = (title) => `${SHARK}/games?title=${enc(title)}&limit=8`;
export const sharkLookupUrl = (appid) => `${SHARK}/games?steamAppID=${enc(appid)}`;
export const sharkGameUrl = (gameId) => `${SHARK}/games?id=${enc(gameId)}`;

/** Les marchands de CheapShark (storeID) les plus courants ; un autre s'ecrit "Marchand n". */
export const SHARK_STORES = Object.freeze({
  1: 'Steam', 2: 'GamersGate', 3: 'Green Man Gaming', 7: 'GOG', 8: 'EA app', 11: 'Humble Store', 13: 'Ubisoft Connect',
  15: 'Fanatical', 21: 'WinGameStore', 23: 'GameBillet', 24: 'Voidu', 25: 'Epic Games Store', 27: 'Gamesplanet',
  28: 'Gamesload', 29: '2Game', 30: 'IndieGala', 31: 'Blizzard Shop', 33: 'DLGamer', 34: 'Noctre', 35: 'DreamGame',
});

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

/** L'adresse de redirection d'une affaire CheapShark : l'identifiant est deja encode par l'API, on ne le re-encode pas. */
export function sharkDealUrl(dealId) {
  const id = String(dealId || '');
  return /^[A-Za-z0-9%._~-]{8,200}$/.test(id) ? `https://www.cheapshark.com/redirect?dealID=${id}` : null;
}

/** La liste d'une recherche : `[{ gameId, appid, title, thumb }]`. */
export function parseSharkList(json) {
  if (!Array.isArray(json)) return [];
  return json.map((g) => ({
    gameId: g && g.gameID !== undefined ? String(g.gameID) : null,
    appid: g && g.steamAppID ? String(g.steamAppID) : null,
    title: g && typeof g.external === 'string' ? g.external.slice(0, 160) : '',
    thumb: g && typeof g.thumb === 'string' && g.thumb.startsWith('https://') ? g.thumb : null,
  })).filter((g) => g.gameId && /^\d+$/.test(g.gameId));
}

/** La ligne qui porte EXACTEMENT ce titre (normalise), ou null : une approximation donnerait le prix d'un autre jeu. */
export function matchTitle(list, title) {
  const cible = normaliseTitle(title);
  if (!cible) return null;
  return (list || []).find((g) => normaliseTitle(g.title) === cible) || null;
}

/** Le detail d'un jeu CheapShark (`games?id=`) en prix : le meilleur, le plus bas jamais vu, les marchands. */
export function parseSharkGame(json, now) {
  if (!json || typeof json !== 'object') return null;
  const deals = (Array.isArray(json.deals) ? json.deals : []).map((d) => {
    const amount = num(d && d.price);
    if (amount === null) return null;
    const store = d.storeID !== undefined ? Number(d.storeID) : NaN;
    return {
      shop: SHARK_STORES[store] || `Marchand ${d.storeID}`,
      amount,
      regular: num(d.retailPrice),
      cut: Math.max(0, Math.round(num(d.savings) || 0)),
      url: sharkDealUrl(d.dealID),
    };
  }).filter(Boolean).sort((a, b) => a.amount - b.amount).slice(0, MAX_DEALS);
  const best = deals[0] || null;
  const low = num(json.cheapestPriceEver && json.cheapestPriceEver.price);
  const lowAtSec = num(json.cheapestPriceEver && json.cheapestPriceEver.date);
  // CheapShark met le plus bas historique a jour avec retard : il ne peut pas depasser le prix d'aujourd'hui.
  const lowest = low !== null && best ? Math.min(low, best.amount) : low;
  if (!best && lowest === null) return null;
  return {
    source: SOURCES.SHARK,
    at: now,
    found: true,
    currency: 'USD',
    best,
    low: lowest,
    lowAt: lowest === low && lowAtSec ? lowAtSec * 1000 : null,
    deals,
    page: null,
  };
}

/* ------------------------------------------------------------------- ITAD */

export const itadLookupUrl = ({ key, appid, title }) => `${ITAD}/games/lookup/v1?key=${enc(key)}&${appid ? `appid=${enc(appid)}` : `title=${enc(title)}`}`;
export const itadSearchUrl = ({ key, title }) => `${ITAD}/games/search/v1?key=${enc(key)}&title=${enc(title)}&results=6`;

/** La requete des prix d'un jeu, dans la devise du pays. `vouchers` coupe : un code promo n'est pas un prix. */
export function itadPricesRequest({ key, country, id }) {
  const pays = /^[A-Za-z]{2}$/.test(String(country || '')) ? String(country).toUpperCase() : 'FR';
  return {
    url: `${ITAD}/games/prices/v3?key=${enc(key)}&country=${pays}&deals=false&vouchers=false&capacity=${MAX_DEALS}`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([id]),
      credentials: 'omit',
      cache: 'no-store',
    },
  };
}

const UUID = /^[0-9a-fA-F-]{20,40}$/;

/** Le jeu d'un `lookup` : `{ id, slug, title }` ou null. */
export function parseItadLookup(json) {
  const g = json && json.found === true ? json.game : null;
  if (!g || typeof g.id !== 'string' || !UUID.test(g.id)) return null;
  return { id: g.id, slug: typeof g.slug === 'string' ? g.slug.slice(0, 120) : null, title: typeof g.title === 'string' ? g.title.slice(0, 160) : '' };
}

/** Les jeux d'une `search` : `[{ id, slug, title }]`. */
export function parseItadSearch(json) {
  if (!Array.isArray(json)) return [];
  return json.filter((g) => g && typeof g.id === 'string' && UUID.test(g.id))
    .map((g) => ({ id: g.id, slug: typeof g.slug === 'string' ? g.slug.slice(0, 120) : null, title: typeof g.title === 'string' ? g.title.slice(0, 160) : '' }));
}

function https(u) {
  return typeof u === 'string' && /^https:\/\//.test(u) && u.length <= 1500 ? u : null;
}

/** Une adresse d'ITAD : une seule valeur par prix, ni changee ni nettoyee (ses etiquettes d'affiliation font partie de la donnee). */
function amountOf(p) {
  const a = p && num(p.amount);
  return a !== null && a >= 0 ? a : null;
}

/**
 * La reponse de `prices/v3` pour UN jeu, en prix. Les montants sont ceux d'ITAD, dans sa devise (celle du pays demande) :
 * aucune conversion, aucune retouche.
 */
export function parseItadPrices(json, { now, slug = null } = {}) {
  const entry = Array.isArray(json) ? json[0] : null;
  if (!entry || typeof entry !== 'object') return null;
  const deals = (Array.isArray(entry.deals) ? entry.deals : []).map((d) => {
    const amount = amountOf(d && d.price);
    if (amount === null) return null;
    return {
      shop: d.shop && typeof d.shop.name === 'string' ? d.shop.name.slice(0, 60) : '?',
      amount,
      currency: d.price && typeof d.price.currency === 'string' ? d.price.currency : null,
      regular: amountOf(d.regular),
      cut: Number.isInteger(d.cut) ? Math.max(0, Math.min(100, d.cut)) : 0,
      url: https(d.url),
    };
  }).filter(Boolean).sort((a, b) => a.amount - b.amount).slice(0, MAX_DEALS);
  const best = deals[0] || null;
  const histo = entry.historyLow && entry.historyLow.all ? amountOf(entry.historyLow.all) : null;
  if (!best && histo === null) return null;
  // Le plus bas historique ne peut pas etre au-dessus du prix d'aujourd'hui.
  const low = histo !== null && best ? Math.min(histo, best.amount) : histo;
  const currency = (best && best.currency)
    || (entry.historyLow && entry.historyLow.all && typeof entry.historyLow.all.currency === 'string' ? entry.historyLow.all.currency : null);
  return {
    source: SOURCES.ITAD,
    at: now,
    found: true,
    currency,
    best,
    low,
    lowAt: null,
    deals,
    page: slug ? `https://isthereanydeal.com/game/${encodeURIComponent(slug)}/info/` : null,
  };
}

/* ------------------------------------------------------------ la lecture */

async function getJson(fetchImpl, url, init = {}) {
  try {
    const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, ...init });
    if (!r || !r.ok) return { ok: false, status: r ? r.status : 0, json: null };
    return { ok: true, status: r.status, json: await r.json() };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/**
 * ITAD pour un souhait : le jeu (par son appid Steam, sinon son titre EXACT, sinon la recherche), puis ses prix.
 * Rend `{ info }`, `{ info: null }` (introuvable) ou `{ error: 'key' | 'busy' | 'net' }`. Ne jette jamais ; ni la cle ni
 * l'adresse n'entrent jamais dans ce qu'il rend.
 */
export async function readItad({ target, key, country, fetch: fetchImpl, now }) {
  let jeu = null;
  const essais = [];
  if (target.appid) essais.push({ appid: target.appid });
  essais.push({ title: target.title });
  for (const q of essais) {
    const r = await getJson(fetchImpl, itadLookupUrl({ key, ...q }));
    if (r.status === 401 || r.status === 403) return { error: 'key' };
    if (r.status === 429) return { error: 'busy' };
    if (!r.ok && r.status === 0) return { error: 'net' };
    jeu = r.ok ? parseItadLookup(r.json) : null;
    if (jeu) break;
  }
  if (!jeu) {
    const r = await getJson(fetchImpl, itadSearchUrl({ key, title: target.title }));
    if (r.status === 429) return { error: 'busy' };
    const cible = normaliseTitle(target.title);
    jeu = r.ok ? parseItadSearch(r.json).find((g) => normaliseTitle(g.title) === cible) || null : null;
  }
  if (!jeu) return { info: null };
  const req = itadPricesRequest({ key, country, id: jeu.id });
  const p = await getJson(fetchImpl, req.url, req.init);
  if (p.status === 401 || p.status === 403) return { error: 'key' };
  if (p.status === 429) return { error: 'busy' };
  if (!p.ok) return { error: 'net' };
  return { info: parseItadPrices(p.json, { now, slug: jeu.slug }) };
}

/** CheapShark pour un souhait : son identifiant (par l'appid, sinon le titre EXACT), puis son detail. `{ info }` ou `{ error }`. */
export async function readShark({ target, fetch: fetchImpl, now, pause = async () => {} }) {
  let gameId = null;
  if (target.appid) {
    const r = await getJson(fetchImpl, sharkLookupUrl(target.appid));
    if (r.status === 429) return { error: 'busy' };
    gameId = r.ok ? (parseSharkList(r.json)[0] || {}).gameId || null : null;
  }
  if (!gameId) {
    await pause();
    const r = await getJson(fetchImpl, sharkSearchUrl(target.title));
    if (r.status === 429) return { error: 'busy' };
    if (!r.ok && r.status === 0) return { error: 'net' };
    gameId = r.ok ? (matchTitle(parseSharkList(r.json), target.title) || {}).gameId || null : null;
  }
  if (!gameId) return { info: null };
  await pause();
  const g = await getJson(fetchImpl, sharkGameUrl(gameId));
  if (g.status === 429) return { error: 'busy' };
  if (!g.ok) return { error: 'net' };
  return { info: parseSharkGame(g.json, now) };
}

/* -------------------------------------------------------------- le cache */

/** Quelle source on vise : ITAD avec une cle, CheapShark sans. */
export const wantedSource = (key) => (key ? SOURCES.ITAD : SOURCES.SHARK);

/** Faut-il (re)lire ce souhait ? Jamais lu, perime, ou lu par une autre source que celle qu'on vise maintenant. */
export function needsPrice(cache, target, now, key) {
  const e = cache && cache[target.key];
  if (!e || typeof e !== 'object') return true;
  if (e.want !== wantedSource(key)) return true;
  return now - (e.at || 0) >= (e.found === false ? NOT_FOUND_MS : FRESH_MS);
}

/**
 * Lit les prix qui manquent, six souhaits au plus. Rend `{ cache, keyRefused, busy }` : le cache suivant, et ce qui s'est passe.
 * Une cle refusee fait passer ce souhait (et les suivants de ce passage) a CheapShark. Ne jette jamais.
 */
export async function refreshPrices({
  targets, cache, key = null, country = 'FR', fetch: fetchImpl, now, limit = PER_RUN, record = () => {},
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
}) {
  const next = { ...(cache || {}) };
  let keyRefused = false;
  let busy = false;
  let premier = true;
  const attendre = async () => { if (!premier) await pause(PAUSE_MS); premier = false; };
  const want = wantedSource(key);

  for (const t of (targets || []).filter((x) => needsPrice(next, x, now, key)).slice(0, limit)) {
    if (busy) break;
    let lu = null;
    if (key && !keyRefused) {
      await attendre();
      lu = await readItad({ target: t, key, country, fetch: fetchImpl, now });
      if (lu.error === 'key') { keyRefused = true; record('warn', 'prix des souhaits : la cle IsThereAnyDeal est refusee, CheapShark prend le relais'); }
      else if (lu.error === 'busy') { busy = true; record('warn', 'prix des souhaits : IsThereAnyDeal demande de ralentir'); break; }
      else if (lu.error === 'net') record('info', 'prix des souhaits : IsThereAnyDeal injoignable, CheapShark prend le relais');
    }
    if (!lu || lu.error) {
      await attendre();
      lu = await readShark({ target: t, fetch: fetchImpl, now, pause: () => pause(PAUSE_MS) });
      if (lu.error === 'busy') { busy = true; record('warn', 'prix des souhaits : CheapShark demande de ralentir'); break; }
      if (lu.error) continue; // une panne de reseau n'ecrase pas ce qu'on savait
    }
    next[t.key] = lu.info ? { ...lu.info, want } : { at: now, found: false, want };
  }
  return { cache: next, keyRefused, busy };
}

/**
 * L'essai de la cle : un jeu connu (Half-Life 2, appid 220) est cherche. Rend `{ ok, status, note }` ; la note ne contient
 * jamais la cle.
 */
export async function testItad({ key, fetch: fetchImpl }) {
  const k = cleanKey(key);
  if (!k) return { ok: false, status: 0, note: 'form' };
  const r = await getJson(fetchImpl, itadLookupUrl({ key: k, appid: 220 }));
  if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, note: 'refused' };
  if (r.status === 429) return { ok: false, status: 429, note: 'busy' };
  if (!r.ok) return { ok: false, status: r.status, note: 'net' };
  return parseItadLookup(r.json) ? { ok: true, status: 200, note: null } : { ok: false, status: 200, note: 'unexpected' };
}

/** La source a citer pour une fiche de prix. */
export function sourceLabel(info) {
  return info && info.source === SOURCES.ITAD ? 'IsThereAnyDeal' : 'CheapShark';
}
