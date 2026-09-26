/* La note Steam des jeux offerts (2.78.0).
 *
 * « Gratuit » ne dit pas « bon ». Un jeu offert sur Epic merite-t-il les 20 Go
 * de l'installer ? La reponse que tout le monde consulte, ce sont les
 * evaluations Steam : « Tres positives, 84 % ». Les voici a cote du jeu, dans
 * la liste et dans la notification.
 *
 * CE QUI EST MESURE (2026-09-26, Mechabellum, gratuit sur Epic ce jour-la) :
 *
 *   - `api/storesearch/?term=...` rend, sans cookie ni cle, les applications
 *     dont le nom ressemble : `{ items: [{ type: 'app', name, id }] }`. Le
 *     premier resultat n'est pas toujours le bon (un DLC, une suite) : on ne
 *     garde que celui dont le TITRE NORMALISE est identique, sinon rien ;
 *   - `appreviews/<appid>?json=1&language=all&num_per_page=0` rend le resume :
 *     `query_summary: { review_score (1..9, 0 = trop peu), review_score_desc,
 *     total_positive, total_reviews }`. Pour Mechabellum : 8, « Very Positive »,
 *     15 151 sur 18 025 = 84 %.
 *
 * TOUTES LANGUES, et c'est un choix : la fiche Steam montre le score des avis
 * dans la langue du visiteur quand il y en a assez (Squad, meme jour : 84 %
 * sur les avis anglais, 82,5 % toutes langues). Toutes langues est le chiffre
 * le plus stable et le meme pour tous ; l'infobulle le dit.
 *     `review_score` suit l'echelle de Steam, de « Extremement negatives » (1)
 *     a « Extremement positives » (9) ; on traduit le chiffre, pas le texte.
 *
 * Un jeu deja note n'est relu qu'une fois par semaine ; un jeu que Steam ne
 * connait pas, tous les trois jours. Les jeux mobiles et les DLC ne sont pas
 * cherches : le meme nom designerait un autre produit.
 *
 * Module pur, sauf `fetchRating`, qui recoit son `fetch`.
 */
import { STORES, displayTitle, normaliseTitle } from './offer.js';
import { isExtraContent } from './filters.js';
import { t } from '../lib/i18n.js';

/** { [cle]: { appid, score, positive, total, at } | { none: true, at } }. Espace de la veille. */
export const KEY_RATINGS = 'veille:notes-steam';

const DAY_MS = 24 * 3600 * 1000;

/** Une note se relit une fois par semaine : elle bouge lentement. */
export const FRESH_MS = 7 * DAY_MS;

/** Un jeu que Steam ne connait pas : on redemande dans trois jours, il peut y arriver. */
export const NONE_MS = 3 * DAY_MS;

/** Au-dela, les plus anciennes sortent : un souvenir de 400 jeux suffit. */
export const MAX_ENTRIES = 400;

/** Par passage de la veille : poli envers Steam, et les offres sont peu nombreuses. */
export const PER_RUN = 8;

export const SEARCH_URL = 'https://store.steampowered.com/api/storesearch/';

/** L'appid Steam de l'offre, quand elle le porte deja. */
export function steamAppId(offer) {
  if (!offer) return null;
  if (offer.appid && /^\d+$/.test(String(offer.appid))) return String(offer.appid);
  if (offer.store === STORES.STEAM && offer.storeId && /^\d+$/.test(String(offer.storeId))) return String(offer.storeId);
  const m = /store\.steampowered\.com\/app\/(\d+)/.exec(String(offer.url || ''));
  return m ? m[1] : null;
}

/** Cherche-t-on une note pour cette offre ? Pas pour un jeu mobile, ni pour un DLC. */
export function eligible(offer) {
  if (!offer || !offer.title) return false;
  if (offer.store === STORES.EPIC_MOBILE) return false;
  if (steamAppId(offer)) return true;
  return !isExtraContent(offer) && Boolean(normaliseTitle(offer.title));
}

/** La cle du souvenir : l'appid quand on l'a, le titre normalise sinon. */
export function ratingKey(offer) {
  const appid = steamAppId(offer);
  if (appid) return `app:${appid}`;
  const n = offer && (offer.normalisedTitle || normaliseTitle(offer.title));
  return n ? `t:${n}` : null;
}

/** La note connue d'une offre, ou null (inconnue, ou trop peu d'evaluations). */
export function ratingFor(ratings, offer) {
  const k = ratingKey(offer);
  const r = k && ratings ? ratings[k] : null;
  return r && !r.none && r.score > 0 && r.total > 0 ? r : null;
}

/** Faut-il (re)demander ? */
export function needsRating(ratings, offer, now) {
  if (!eligible(offer)) return false;
  const r = ratings ? ratings[ratingKey(offer)] : null;
  if (!r || typeof r.at !== 'number') return true;
  return now - r.at >= (r.none ? NONE_MS : FRESH_MS);
}

/** Cherche le titre tel qu'on le montre : « Dwarven Realms », pas « ... (Steam) Key Giveaway ». */
export function searchUrl(title, country = 'US') {
  const u = new URL(SEARCH_URL);
  u.searchParams.set('term', displayTitle(title).slice(0, 100));
  u.searchParams.set('cc', /^[A-Z]{2}$/.test(country) ? country : 'US');
  u.searchParams.set('l', 'english');
  return u.toString();
}

export function reviewsUrl(appid) {
  return `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&num_per_page=0`;
}

/** Le seul resultat de recherche qui porte EXACTEMENT ce titre, ou null. */
export function matchSearch(data, title) {
  const cible = normaliseTitle(title);
  if (!cible) return null;
  const items = (data && Array.isArray(data.items)) ? data.items : [];
  const bons = items.filter((i) => i && (i.type === 'app' || !i.type) && /^\d+$/.test(String(i.id)) && normaliseTitle(i.name) === cible);
  return bons.length ? String(bons[0].id) : null;
}

/** Le resume des evaluations, ou null si la reponse n'en est pas un. */
export function readSummary(data) {
  if (!data || data.success !== 1 || !data.query_summary) return null;
  const q = data.query_summary;
  const score = Number(q.review_score);
  const positive = Number(q.total_positive);
  const total = Number(q.total_reviews);
  if (!Number.isInteger(score) || score < 0 || score > 9) return null;
  if (!Number.isFinite(positive) || !Number.isFinite(total) || positive < 0 || total < positive) return null;
  return { score, positive, total };
}

/** Le pourcentage que la fiche Steam affiche. */
export function percent(r) {
  return r && r.total > 0 ? Math.round((100 * r.positive) / r.total) : null;
}

/** Bonne, partagee, mauvaise : la couleur de la note. */
export function tone(r) {
  if (!r || !r.score) return null;
  if (r.score >= 6) return 'good';
  if (r.score === 5) return 'mixed';
  return 'bad';
}

/* L'echelle de Steam, du pire au meilleur, en TABLE : le build retrouve les
   cles ecrites en toutes lettres, pas celles qu'on fabriquerait. */
const SCORE_KEYS = Object.freeze([null,
  'steamScore1', 'steamScore2', 'steamScore3', 'steamScore4', 'steamScore5',
  'steamScore6', 'steamScore7', 'steamScore8', 'steamScore9']);

/** Le libelle de Steam, dans la langue choisie : « Tres positives ». */
export function scoreLabel(r) {
  return r && SCORE_KEYS[r.score] ? t(SCORE_KEYS[r.score]) : '';
}

/** La ligne de notification : « Steam : Tres positives (84 %) ». */
export function ratingLine(r) {
  return r ? t('ratingLine', scoreLabel(r), String(percent(r))) : '';
}

/**
 * Va chercher la note d'une offre. Ne jette jamais : rend l'entree a ranger,
 * `{ none: true }` si Steam ne connait pas ce jeu, ou null si Steam n'a pas
 * repondu (on retentera au prochain passage, sans rien noter).
 */
export async function fetchRating(offer, { fetch: fetchImpl = fetch, now = Date.now(), country = 'US', timeoutMs = 8000 } = {}) {
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
  const init = { credentials: 'omit', headers: { Accept: 'application/json' }, signal: arret ? arret.signal : undefined };
  try {
    let appid = steamAppId(offer);
    if (!appid) {
      const r = await fetchImpl(searchUrl(offer.title, country), init);
      if (!r.ok) return null;
      appid = matchSearch(await r.json(), offer.title);
      if (!appid) return { none: true, at: now };
    }
    const r = await fetchImpl(reviewsUrl(appid), init);
    if (!r.ok) return null;
    const s = readSummary(await r.json());
    if (!s) return null;
    return { appid, ...s, at: now };
  } catch {
    return null;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/** Range une note, et garde les MAX_ENTRIES plus recentes. */
export function storeRatings(ratings, entries) {
  const out = { ...(ratings && typeof ratings === 'object' ? ratings : {}) };
  for (const [k, v] of entries) if (k && v) out[k] = v;
  const cles = Object.keys(out);
  if (cles.length > MAX_ENTRIES) {
    cles.sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
    for (const k of cles.slice(MAX_ENTRIES)) delete out[k];
  }
  return out;
}

/**
 * Les notes manquantes ou vieillies de ces offres, `limit` au plus, une apres
 * l'autre. Rend le registre suivant et ce qui a ete demande.
 */
export async function refreshRatings(ratings, offers, { fetch: fetchImpl = fetch, now = Date.now(), country, limit = PER_RUN, timeoutMs } = {}) {
  const vus = new Set();
  const aFaire = [];
  for (const o of offers || []) {
    const k = ratingKey(o);
    if (!k || vus.has(k) || !needsRating(ratings, o, now)) continue;
    vus.add(k);
    aFaire.push([k, o]);
  }
  const entrees = [];
  for (const [k, o] of aFaire.slice(0, limit)) {
    const r = await fetchRating(o, { fetch: fetchImpl, now, country, timeoutMs });
    if (r) entrees.push([k, r]);
  }
  return { ratings: storeRatings(ratings, entrees), asked: Math.min(aFaire.length, limit), got: entrees.length };
}
