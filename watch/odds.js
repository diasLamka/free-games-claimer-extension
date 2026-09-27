/* « Attendez, il sera offert » (2.94.0).
 *
 * Un jeu de la liste de souhaits : l'acheter maintenant, ou attendre qu'il
 * passe gratuit ? Personne ne le sait -- mais certains indices ne trompent
 * pas, et aucun outil ne les rassemble :
 *
 *   - il a DEJA ete offert (ce que l'extension a vu passer, watch/recurrence.js) :
 *     un jeu offert une fois l'est souvent une seconde, sur un autre magasin ;
 *   - son EDITEUR offre des jeux : l'extension le note a chaque offre Epic,
 *     qui nomme son vendeur ;
 *   - son PROFIL : les jeux offerts ont souvent deux ou trois ans et un prix
 *     de catalogue modeste ; un jeu sorti cette annee a 60 € l'est rarement.
 *
 * Le resultat est une ESTIMATION en trois niveaux, avec ses raisons -- jamais
 * un pourcentage, qui ferait croire a une mesure. Les fiches Steam sont lues
 * sans cookie, huit par passage, et gardees trente jours.
 *
 * Module pur, sauf `refreshOddsInfo`, qui recoit son `fetch`.
 */
import { normaliseTitle } from './offer.js';
import { searchUrl, matchSearch } from './steam-ratings.js';
import { appDetailsEntry } from './sources/steam.js';
import { steamWishes, wishes } from './wishlist.js';

export const KEY_ODDS = 'veille:chances';
export const KEY_GIVERS = 'veille:editeurs';

export const PER_RUN = 8;
export const FRESH_MS = 30 * 24 * 3600 * 1000;
export const NOT_FOUND_MS = 7 * 24 * 3600 * 1000;
export const PASS_EVERY_MS = 3600 * 1000;
export const MAX_GIVERS = 1500;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export const LEVELS = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low', UNKNOWN: 'unknown', F2P: 'f2p' });

export const appDetailsUrl = (appid, cc = 'FR') => `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=${encodeURIComponent(cc)}&l=english`;

/* ------------------------------------------------------------ les editeurs */

const FORMES = /\b(inc|ltd|limited|llc|gmbh|s ?a|sas|srl|co|corp|corporation|plc|pty|kk|ab|oy|bv|publishing)\b/g;

/** « Gameplay Group International Inc. » et « Gameplay Group International » : le meme. */
export function normalisePublisher(name) {
  return normaliseTitle(name).replace(FORMES, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Les editeurs qui offrent, enrichis des offres vues : un jeu par editeur une
 * seule fois, meme vu a chaque cycle. Pure.
 */
export function recordGivers(givers, offers, now) {
  const next = { ...(givers || {}) };
  for (const o of offers || []) {
    if (!o || !o.publisher || o.keepable === false) continue;
    const k = normalisePublisher(o.publisher);
    const jeu = normaliseTitle(o.title);
    if (!k || !jeu) continue;
    const avant = next[k] || { name: String(o.publisher).slice(0, 120), games: [], last: 0 };
    if (avant.games.includes(jeu)) continue;
    next[k] = { ...avant, games: [...avant.games, jeu].slice(-50), last: Math.max(avant.last || 0, now) };
  }
  const cles = Object.keys(next);
  if (cles.length > MAX_GIVERS) {
    for (const k of cles.sort((a, b) => (next[a].last || 0) - (next[b].last || 0)).slice(0, cles.length - MAX_GIVERS)) delete next[k];
  }
  return next;
}

/* -------------------------------------------------------------- les souhaits */

/** La cle d'un souhait dans le cache : son appid Steam, sinon son titre. */
export function wishKey(w) {
  return w.appid ? `app:${w.appid}` : `t:${normaliseTitle(w.title)}`;
}

/**
 * Tous les souhaits, a estimer : la saisie d'abord (c'est elle qu'on a
 * choisie), puis les listes importees de Steam et de GOG. Un titre une fois.
 */
export function wishTargets({ wishlist = [], steamWishlist = null, gogWishlist = null } = {}) {
  const out = [];
  const vus = new Set();
  const ajouter = (w) => {
    const n = normaliseTitle(w.title);
    if (!n || vus.has(n)) return;
    vus.add(n);
    out.push({ ...w, key: wishKey(w) });
  };
  for (const w of wishes(wishlist)) ajouter({ title: w.title, appid: null, origin: 'manual' });
  for (const w of steamWishes(steamWishlist)) if (w.title) ajouter({ title: w.title, appid: w.id, origin: 'steam' });
  for (const w of steamWishes(gogWishlist)) if (w.title) ajouter({ title: w.title, appid: null, origin: 'gog' });
  return out;
}

/* ------------------------------------------------------------ la fiche Steam */

/** « 14 Oct, 2025 », « Oct 14, 2025 », « 2025 » : une date, ou null. */
export function readSteamDate(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
  if (Number.isFinite(t)) return t;
  const an = /\b(19|20)\d{2}\b/.exec(s);
  return an ? Date.UTC(Number(an[0]), 0, 1) : null;
}

/** Ce qu'une reponse appdetails dit d'un jeu, ou null. */
export function readInfo(json, appid) {
  const e = appDetailsEntry(json, appid);
  if (!e || e.success !== true || !e.data) return null;
  const d = e.data;
  const prix = d.price_overview;
  return {
    appid: String(appid),
    name: String(d.name || '').slice(0, 160),
    isFree: d.is_free === true,
    comingSoon: !!(d.release_date && d.release_date.coming_soon),
    released: d.release_date && !d.release_date.coming_soon ? readSteamDate(d.release_date.date) : null,
    basePrice: prix && Number.isFinite(prix.initial) ? prix.initial / 100 : null,
    currency: prix && prix.currency ? String(prix.currency) : null,
    publishers: Array.isArray(d.publishers) ? d.publishers.map(String).slice(0, 5) : [],
  };
}

async function lireJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Faut-il (re)lire la fiche de ce souhait ? */
export function needsInfo(cache, target, now) {
  const e = cache && cache[target.key];
  if (!e) return true;
  return now - (e.at || 0) >= (e.notFound ? NOT_FOUND_MS : FRESH_MS);
}

/**
 * Lit les fiches Steam qui manquent, huit au plus : le souhait par son appid
 * (liste Steam), sinon par son titre EXACT (la recherche du magasin). Rend le
 * cache suivant. Ne jette jamais.
 */
export async function refreshOddsInfo({
  fetch: fetchImpl, targets, cache, now, country = 'FR', limit = PER_RUN,
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
}) {
  const next = { ...(cache || {}) };
  let premier = true;
  const attendre = async () => { if (!premier) await pause(1200); premier = false; };
  for (const t of (targets || []).filter((x) => needsInfo(next, x, now)).slice(0, limit)) {
    let appid = t.appid;
    if (!appid) {
      await attendre();
      appid = matchSearch(await lireJson(fetchImpl, searchUrl(t.title, country)), t.title);
    }
    if (!appid) { next[t.key] = { at: now, notFound: true }; continue; }
    await attendre();
    const info = readInfo(await lireJson(fetchImpl, appDetailsUrl(appid, country)), appid);
    next[t.key] = info ? { ...info, at: now } : { at: now, notFound: true };
  }
  return next;
}

/* -------------------------------------------------------------- l'estimation */

/**
 * Les chances qu'un souhait passe gratuit, et pourquoi. `recurrence` : ce que
 * l'index des passages sait du titre (watch/recurrence.js) ; `info` : la
 * fiche Steam ; `givers` : les editeurs qui offrent. Pure.
 *
 * Rend { level, reasons: [{ key, args }] } -- les raisons dans l'ordre ou
 * elles comptent, a traduire par l'appelant.
 */
export function estimate({ recurrence = null, info = null, givers = {}, now }) {
  const reasons = [];
  let score = 0;
  let su = false;

  if (info && info.isFree) return { level: LEVELS.F2P, reasons: [{ key: 'oddsFreeToPlay', args: [] }] };

  if (recurrence && recurrence.count >= 1) {
    su = true;
    score += recurrence.count >= 2 ? 4 : 3;
    const dernier = recurrence.passes && recurrence.passes[0];
    reasons.push({ key: 'oddsGivenBefore', args: [String(recurrence.count), dernier && dernier.ts ? dernier.ts : null, dernier ? dernier.store : null] });
  }

  if (info && !info.notFound) {
    su = true;
    const editeur = (info.publishers || []).map((p) => givers[normalisePublisher(p)]).find((g) => g && g.games && g.games.length);
    if (editeur) {
      score += 2;
      reasons.push({ key: 'oddsPublisherGave', args: [editeur.name, String(editeur.games.length)] });
    }
    if (info.comingSoon) {
      score -= 3;
      reasons.push({ key: 'oddsUnreleased', args: [] });
    } else if (typeof info.released === 'number') {
      const ans = (now - info.released) / YEAR_MS;
      if (ans < 1) { score -= 2; reasons.push({ key: 'oddsRecent', args: [] }); } else if (ans >= 2) { score += 1; reasons.push({ key: 'oddsOld', args: [String(Math.floor(ans))] }); }
    }
    if (typeof info.basePrice === 'number') {
      if (info.basePrice >= 40) { score -= 1; reasons.push({ key: 'oddsExpensive', args: [info.basePrice, info.currency] }); } else if (info.basePrice > 0 && info.basePrice <= 25) { score += 1; reasons.push({ key: 'oddsCheap', args: [info.basePrice, info.currency] }); }
    }
  }

  if (!su) {
    // Rien a dire : on dit pourquoi, plutot que de deviner.
    reasons.push({ key: info && info.notFound ? 'oddsNotOnSteam' : 'oddsPending', args: [] });
    return { level: LEVELS.UNKNOWN, reasons };
  }
  const level = score >= 3 ? LEVELS.HIGH : score >= 1 ? LEVELS.MEDIUM : LEVELS.LOW;
  return { level, reasons };
}

const ORDRE = [LEVELS.HIGH, LEVELS.MEDIUM, LEVELS.LOW, LEVELS.UNKNOWN, LEVELS.F2P];

/** Les souhaits estimes, les meilleures chances d'abord. */
export function rankWishes(targets, { cache = {}, givers = {}, index = null, now, normalise = normaliseTitle }) {
  return (targets || []).map((t) => {
    const recurrence = index ? index.get(normalise(t.title)) || null : null;
    const info = cache[t.key] || null;
    return { ...t, info, ...estimate({ recurrence, info, givers, now }) };
  }).sort((a, b) => ORDRE.indexOf(a.level) - ORDRE.indexOf(b.level) || a.title.localeCompare(b.title));
}
