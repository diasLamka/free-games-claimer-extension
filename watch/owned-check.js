/* « Est-ce deja a vous ? » -- demande au MAGASIN, avant d'ouvrir un onglet (2.106.0).
 *
 * Un jeu offert ne se recupere qu'une fois. Le moteur sait le reconnaitre quand la page
 * le dit (« Dans la bibliotheque »), mais une page qui ne dit plus que « Jouer »
 * ou « Telecharger » le laissait sans reponse -- et, jusqu'a la 2.105.0, la
 * question « montrez-moi le bouton » revenait a chaque tentative, sans fin, pour un
 * jeu que l'on avait deja. Ici on pose la question la ou la reponse est sure : la
 * bibliotheque du compte.
 *
 * GOG (2.106.0) : la liste de la bibliotheque accepte une recherche (`search=`), avec
 * VOTRE session -- la meme lecture que « Tout importer », une page, rien de modifie.
 *
 * EPIC (2.107.0) : l'historique des commandes du compte (la page « Transactions » :
 * ce que lit deja « Tout importer »), au plus EPIC_PAGES pages, lues UNE fois par cycle
 * quel que soit le nombre d'offres Epic. Un jeu offert qu'on a reclame y figure comme
 * une commande a zero ; on le reconnait par l'identifiant de l'offre, ou par un titre
 * identique. Epic peut repondre autre chose que du JSON (page de verification, mur
 * anti-robot) : c'est alors « on ne sait pas », comme pour GOG.
 *
 * STEAM n'est pas ici, et c'est voulu : sa liste de jeux possedes est lue a chaque
 * veille (`dynamicstore/userdata`, par identifiant) et ecarte l'offre avant meme
 * qu'elle devienne candidate. AMAZON (Prime Gaming) n'a pas d'adresse que l'on sache
 * lire d'ici : sa page ne se laisse interroger que par un jeton de page et un schema
 * non mesure -- on n'invente pas d'adresse, la page tranche comme avant.
 *
 * Aucune de ces adresses n'a ete mesuree avec une session d'ici : une reponse
 * illisible, ou une recherche que le magasin ignorerait, ne prouve RIEN et ne bloque
 * RIEN. Les autres magasins passent par ce que l'extension sait deja : le registre,
 * la collection importee (identifiants exacts), l'historique du moteur.
 *
 * LA PRUDENCE EST LE CHOIX. Un faux « deja a vous » fait RATER un jeu offert ; un
 * onglet de trop ne coute qu'un onglet. Le titre doit donc etre IDENTIQUE (aux
 * editions et a la casse pres) : « Civilization » n'est pas « Civilization VI ».
 *
 * Module pur, sauf `fetch` qui est injecte. Ne leve jamais.
 */
import { normaliseTitle } from './offer.js';
import { sanitiseCollection } from './collection.js';
import { GOG_LIBRARY_URL, epicPageUrl, UNDONE } from './collection-import.js';

export const SEARCH_TIMEOUT_MS = 15000;

/** Les magasins dont on sait interroger le compte. */
export const ORACLE_STORES = Object.freeze(['gog', 'epic']);

/** Pages de l'historique des commandes Epic lues au plus par cycle : assez pour les derniers mois, pas une bibliotheque. */
export const EPIC_PAGES = 3;

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
 * Lit une page de l'historique des commandes Epic : `{ readable, offerIds, titles, next }`.
 * Illisible (pas de `orders`) veut dire « on ne sait pas ». Une commande annulee ou
 * remboursee n'est pas un jeu a vous.
 */
export function readEpicOrders(json) {
  const vide = { readable: false, offerIds: [], titles: [], next: null };
  if (!json || typeof json !== 'object' || !Array.isArray(json.orders)) return vide;
  const offerIds = [];
  const titles = [];
  for (const o of json.orders) {
    if (!o || typeof o !== 'object') continue;
    if (UNDONE.test(`${o.orderType || ''} ${o.orderStatus || ''} ${o.status || ''}`)) continue;
    for (const it of Array.isArray(o.items) ? o.items : []) {
      if (!it || typeof it !== 'object') continue;
      if (typeof it.offerId === 'string' && it.offerId) offerIds.push(it.offerId);
      if (typeof it.description === 'string' && it.description) titles.push(it.description);
    }
  }
  const next = typeof json.nextPageToken === 'string' && json.nextPageToken ? json.nextPageToken : null;
  return { readable: true, offerIds: offerIds.slice(0, 2000), titles: titles.slice(0, 2000), next };
}

/** Une lecture avec VOTRE session : le JSON de la reponse, ou null (reseau, refus, page HTML, corps vide). Ne leve jamais. */
async function getJson(fetchImpl, url) {
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), SEARCH_TIMEOUT_MS) : null;
  try {
    const r = await fetchImpl(url, {
      credentials: 'include',
      redirect: 'follow',
      headers: { Accept: 'application/json' },
      signal: stopwatch ? stopwatch.signal : undefined,
    });
    if (!r || !r.ok) return null;
    return JSON.parse(await r.text());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Les commandes Epic du compte, lues une fois (`memo` : une table par cycle). Rend
 * `{ readable, offerIds: Set, titles, pages }`. Une page apres la premiere qui ne se lit
 * pas arrete la lecture sans l'invalider : ce qu'on a lu est vrai, ce qu'on n'a pas lu
 * n'est simplement pas dit.
 */
export function epicBook(fetchImpl, { memo = null, note = null } = {}) {
  if (memo && memo.has('epic')) return memo.get('epic');
  const work = (async () => {
    const offerIds = new Set();
    const titles = [];
    const seen = new Set();
    let token = null;
    let pages = 0;
    for (let i = 0; i < EPIC_PAGES; i++) {
      const page = readEpicOrders(await getJson(fetchImpl, epicPageUrl(token)));
      if (!page.readable) break;
      pages++;
      for (const id of page.offerIds) offerIds.add(id);
      titles.push(...page.titles);
      if (!page.next || seen.has(page.next)) break;
      seen.add(page.next);
      token = page.next;
    }
    const book = { readable: pages > 0, offerIds, titles, pages };
    try {
      if (typeof note === 'function') {
        note(book.readable
          ? `Epic : ${titles.length} article(s) lus dans l'historique des commandes (${pages} page(s))`
          : 'Epic : historique des commandes illisible (session absente, verification ou mur anti-robot) -- la page tranche');
      }
    } catch { /* un journal ne casse rien */ }
    return book;
  })();
  if (memo) memo.set('epic', work);
  return work;
}

/**
 * La reponse du compte pour une offre : `{ owns: true, via, note }`, ou null quand
 * on ne sait pas (autre magasin, session absente, reponse illisible, recherche sans
 * resultat). Jamais `owns: false` : l'absence d'un titre dans une recherche dont on
 * ne maitrise pas le filtre ne prouve pas qu'il manque.
 *
 * `memo` (une table par cycle) evite de relire l'historique Epic pour chaque offre ;
 * `note(texte)` recoit une ligne de journal quand cette lecture a eu lieu.
 */
export async function accountOwns(offer, { fetch: fetchImpl = null, collection = null, memo = null, note = null } = {}) {
  try {
    if (!offer || !offer.title || !ORACLE_STORES.includes(offer.store)) return null;

    if (collection && collectionHas(collection, offer.store, offer.title)) {
      return { owns: true, via: 'collection', note: 'deja dans votre collection importee' };
    }
    if (typeof fetchImpl !== 'function') return null;

    if (offer.store === 'epic') {
      const book = await epicBook(fetchImpl, { memo, note });
      if (!book.readable) return null;
      const sameOffer = offer.source === 'epic-api' && offer.sourceId !== null && offer.sourceId !== undefined
        && book.offerIds.has(String(offer.sourceId));
      return sameOffer || listHas(offer.title, book.titles)
        ? { owns: true, via: 'account', note: 'deja dans l\'historique des commandes de votre compte Epic' }
        : null;
    }

    const json = await getJson(fetchImpl, gogSearchUrl(offer.title));
    const { readable, titles } = readSearch(json);
    if (!readable) return null;
    return listHas(offer.title, titles)
      ? { owns: true, via: 'account', note: 'deja dans la bibliotheque de votre compte GOG' }
      : null;
  } catch {
    return null;
  }
}
