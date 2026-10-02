/* « Est-ce deja a vous ? » -- demande au MAGASIN, avant d'ouvrir un onglet (2.106.0).
 *
 * Un jeu offert ne se recupere qu'une fois. Le moteur sait le reconnaitre quand la page
 * le dit (« Dans la bibliotheque »), mais une page qui ne dit plus que « Jouer »
 * ou « Telecharger » le laissait sans reponse -- et, jusqu'a la 2.105.0, la
 * question « montrez-moi le bouton » revenait a chaque tentative, sans fin, pour un
 * jeu que l'on avait deja. Ici on pose la question la ou la reponse est sure : la
 * bibliotheque du compte.
 *
 * SEUL GOG a, pour l'instant, une adresse qui repond « ce titre est-il a vous ? » :
 * la liste de la bibliotheque accepte une recherche (`search=`), avec VOTRE session
 * -- la meme lecture que « Tout importer », une page, rien de modifie. Elle n'a
 * jamais ete mesuree avec une session d'ici : une reponse illisible, ou une
 * recherche que le magasin ignorerait, ne prouve RIEN et ne bloque RIEN. Les autres
 * magasins passent par ce que l'extension sait deja : le registre, la collection
 * importee (identifiants exacts), l'historique du moteur.
 *
 * LA PRUDENCE EST LE CHOIX. Un faux « deja a vous » fait RATER un jeu offert ; un
 * onglet de trop ne coute qu'un onglet. Le titre doit donc etre IDENTIQUE (aux
 * editions et a la casse pres) : « Civilization » n'est pas « Civilization VI ».
 *
 * Module pur, sauf `fetch` qui est injecte. Ne leve jamais.
 */
import { normaliseTitle } from './offer.js';
import { sanitiseCollection } from './collection.js';
import { GOG_LIBRARY_URL } from './collection-import.js';

export const SEARCH_TIMEOUT_MS = 15000;

/** Les magasins dont on sait interroger le compte. */
export const ORACLE_STORES = Object.freeze(['gog']);

const EDITION = /\b(standard|deluxe|ultimate|definitive|complete|goty|game of the year|gold|premium|enhanced|remastered|anniversary|special|collector s|digital)\s+edition\b/g;

/** Un titre ramene a ce qui le distingue : sans accent, sans suffixe d'agregateur, sans « Edition ». */
function core(title) {
  return normaliseTitle(title).replace(EDITION, ' ').replace(/\s+/g, ' ').trim();
}

/** Ces deux titres designent-ils EXACTEMENT le meme jeu ? (Pas « l'un dans l'autre » : voir plus haut.) */
export function sameTitle(a, b) {
  const x = core(a);
  const y = core(b);
  return !!x && x === y;
}

/** L'adresse de recherche dans la bibliotheque GOG. Le titre est nettoye comme pour le rapprochement. */
export function gogSearchUrl(title) {
  const q = String(title || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b(key\s+)?giveaway\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${GOG_LIBRARY_URL}?mediaType=1&sortBy=title&page=1&search=${encodeURIComponent(q)}`;
}

/**
 * Lit une reponse de la bibliotheque GOG : `{ readable, titles }`. Illisible
 * (pas de `products`) ne veut pas dire « pas a vous » -- seulement « on ne sait pas ».
 */
export function readSearch(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.products)) return { readable: false, titles: [] };
  const titles = json.products.map((p) => (p && typeof p.title === 'string' ? p.title : '')).filter(Boolean).slice(0, 200);
  return { readable: true, titles };
}

/** Le titre de l'offre figure-t-il, a l'identique, dans cette liste ? */
export function listHas(title, titles) {
  return (titles || []).some((t) => sameTitle(t, title));
}

/** La collection importee (GOG) dit-elle deja que ce titre est a vous ? */
export function collectionHas(collection, store, title) {
  const c = sanitiseCollection(collection);
  const st = c.stores[store];
  if (!st || !st.lastOk) return false;
  for (const it of Object.values(c.items)) {
    if (it && it.store === store && it.title && sameTitle(it.title, title)) return true;
  }
  return false;
}

/**
 * La reponse du compte pour une offre : `{ owns: true, via, note }`, ou null quand
 * on ne sait pas (autre magasin, session absente, reponse illisible, recherche sans
 * resultat). Jamais `owns: false` : l'absence d'un titre dans une recherche dont on
 * ne maitrise pas le filtre ne prouve pas qu'il manque.
 */
export async function accountOwns(offer, { fetch: fetchImpl = null, collection = null } = {}) {
  try {
    if (!offer || !offer.title || !ORACLE_STORES.includes(offer.store)) return null;

    if (collection && collectionHas(collection, offer.store, offer.title)) {
      return { owns: true, via: 'collection', note: 'deja dans votre collection importee' };
    }
    if (typeof fetchImpl !== 'function') return null;

    const url = gogSearchUrl(offer.title);
    const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = stopwatch ? setTimeout(() => stopwatch.abort(), SEARCH_TIMEOUT_MS) : null;
    let text;
    try {
      const r = await fetchImpl(url, {
        credentials: 'include',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
        signal: stopwatch ? stopwatch.signal : undefined,
      });
      if (!r || !r.ok) return null;
      text = await r.text();
    } finally {
      if (timer) clearTimeout(timer);
    }
    let json;
    try { json = JSON.parse(text); } catch { return null; }
    const { readable, titles } = readSearch(json);
    if (!readable) return null;
    return listHas(offer.title, titles)
      ? { owns: true, via: 'account', note: 'deja dans la bibliotheque de votre compte GOG' }
      : null;
  } catch {
    return null;
  }
}
