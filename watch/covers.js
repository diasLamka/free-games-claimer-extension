/* Les jaquettes de « Deja recupere » (2.81.0).
 *
 * La liste ne montrait une image que pour les jeux que le catalogue ou la
 * bibliotheque connaissaient encore -- deux sur huit, le jour ou on l'a
 * regardee. Les autres etaient une ligne de texte nue, et une liste de jeux
 * se reconnait a ses images bien avant ses titres.
 *
 * Quand ni l'un ni l'autre ne la connait, on la demande a la recherche du
 * magasin Steam, comme la note Steam (2.78.0) : `api/storesearch` rend pour
 * chaque application une petite image (`tiny_image`, 231 x 87), et on ne
 * garde que le resultat au titre normalise IDENTIQUE -- jamais une bande-son,
 * une demo ou une suite. Un jeu que Steam ne connait pas garde son initiale.
 *
 * Seuls les titres AFFICHES sont demandes, seize au plus par passage, une fois
 * pour toutes (un echec se redemande apres une semaine). Sans cookie.
 *
 * Module pur, sauf `fetchCover`, qui recoit son `fetch`.
 */
import { normaliseTitle } from './offer.js';
import { findSearchItem, searchUrl } from './steam-ratings.js';

/** { [titre normalise]: { image, appid, at } | { none: true, at } }. Espace de la veille. */
export const KEY_COVERS = 'veille:jaquettes';

const DAY_MS = 24 * 3600 * 1000;

/** Un jeu que Steam ne connaissait pas : on redemande une semaine plus tard. */
export const NONE_MS = 7 * DAY_MS;

/** Par demande du popup : ce que le tableau de bord affiche. */
export const PER_RUN = 16;

/** Au-dela, les plus anciennes sortent. */
export const MAX_ENTRIES = 600;

/** Une image servie par le CDN de Steam, en https : rien d'autre ne s'affiche. */
export function safeImage(u) {
  return typeof u === 'string'
    && /^https:\/\/([a-z0-9-]+\.)*(steamstatic\.com|akamaihd\.net|steampowered\.com)\/[^\s"'<>]{1,400}$/i.test(u)
    ? u : null;
}

/** La jaquette connue pour ce titre, ou null. */
export function coverFor(covers, title) {
  const k = normaliseTitle(title);
  const c = k && covers ? covers[k] : null;
  return c && !c.none ? safeImage(c.image) : null;
}

/** Faut-il la demander ? Jamais demandee, ou introuvable il y a plus d'une semaine. */
export function needsCover(covers, title, now) {
  const k = normaliseTitle(title);
  if (!k) return false;
  const c = covers ? covers[k] : null;
  if (!c || typeof c.at !== 'number') return true;
  return Boolean(c.none) && now - c.at >= NONE_MS;
}

/**
 * Cherche la jaquette d'un titre. Rend l'entree a ranger, `{ none: true }` si
 * Steam ne connait pas ce jeu, ou null si Steam n'a pas repondu.
 */
export async function fetchCover(title, { fetch: fetchImpl = fetch, now = Date.now(), country = 'US', timeoutMs = 8000 } = {}) {
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(searchUrl(title, country), {
      credentials: 'omit', headers: { Accept: 'application/json' }, signal: arret ? arret.signal : undefined,
    });
    if (!r.ok) return null;
    const item = findSearchItem(await r.json(), title);
    const image = item ? safeImage(item.tiny_image) : null;
    return image ? { image, appid: String(item.id), at: now } : { none: true, at: now };
  } catch {
    return null;
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/**
 * Les jaquettes manquantes de ces titres, `limit` au plus, une apres l'autre.
 * Rend le registre suivant et ce qui a ete demande.
 */
export async function refreshCovers(covers, titles, { fetch: fetchImpl = fetch, now = Date.now(), country, limit = PER_RUN, timeoutMs } = {}) {
  const vus = new Set();
  const aFaire = [];
  for (const title of titles || []) {
    const k = normaliseTitle(title);
    if (!k || vus.has(k) || !needsCover(covers, title, now)) continue;
    vus.add(k);
    aFaire.push([k, String(title).slice(0, 120)]);
  }
  const out = { ...(covers && typeof covers === 'object' ? covers : {}) };
  let got = 0;
  for (const [k, title] of aFaire.slice(0, limit)) {
    const c = await fetchCover(title, { fetch: fetchImpl, now, country, timeoutMs });
    if (c) { out[k] = c; got++; }
  }
  const cles = Object.keys(out);
  if (cles.length > MAX_ENTRIES) {
    cles.sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
    for (const k of cles.slice(MAX_ENTRIES)) delete out[k];
  }
  return { covers: out, asked: Math.min(aFaire.length, limit), got };
}
