/* Source de decouverte : Steam, jeux et DLC offerts DEFINITIVEMENT.
 *
 * DETECTION SEULE. Ce module ne clique jamais, n'ouvre jamais d'onglet de
 * reclamation, et Steam ne figure pas dans la liste des magasins reclamables.
 * Il repond a une question et une seule : « qu'est-ce qui est gratuit a garder
 * en ce moment, et que je n'ai pas deja ? »
 *
 * Ce choix n'est pas technique. Le parcours serait le plus simple des quatre --
 * page rendue cote serveur, un seul bouton, aucun panier. Mais le Steam
 * Subscriber Agreement interdit noir sur blanc « any form of scripts, bots,
 * macros... to interact with Content and Services on Steam in any manner », et
 * prevoit la resiliation du compte sans preavis. Un compte Steam represente
 * souvent des annees de bibliotheque : l'extension n'a pas a prendre ce pari.
 *
 * Elle se contente donc de LIRE, ce que fait n'importe quel visiteur, et de
 * mettre l'offre a un clic. Le clic reste humain.
 */
import { makeOffer, STORES } from '../offer.js';

export const NAME = 'steam';

/** Recherche des promotions a -100 %. Le filtre specials exclut les free-to-play. */
export const SEARCH_URL = 'https://store.steampowered.com/search/?maxprice=free&specials=1&ndl=1';

/** Confirmation machine, publique et sans cle. */
export const ITEMS_URL = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';

/** Donnees du magasin pour la session en cours. Sert a savoir ce qu'on possede. */
export const OWNED_URL = 'https://store.steampowered.com/dynamicstore/userdata/';

export const DETAIL_URL = 'https://store.steampowered.com/app/';

/**
 * Extrait les identifiants d'application de la page de recherche.
 *
 * Lecture d'attribut, pas d'analyse de document : `data-ds-appid` est un
 * attribut stable, et un service worker n'a de toute facon pas de DOMParser.
 */
export function extractAppIds(html) {
  const found = new Set();
  const reason = /data-ds-appid="(\d+)"/g;
  let m;
  while ((m = reason.exec(String(html || ''))) !== null) found.add(m[1]);
  return [...found];
}

/** Requete de confirmation pour un lot d'applications. */
export function itemsUrl(appids, { lang = 'french', pays = 'FR' } = {}) {
  const input = {
    ids: appids.map((appid) => ({ appid: Number(appid) })),
    context: { language: lang, country_code: pays },
    data_request: { include_basic_info: true },
  };
  return `${ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/**
 * Une offre est-elle « gratuite a garder » ?
 *
 * `is_free` ne discrimine RIEN : il vaut true aussi bien pour un free-to-play
 * permanent que pour une offre temporaire. Verifie sur trois applications
 * reelles le 2026-08-27 : Counter-Strike 2 (free-to-play) rend `is_free: true`
 * sans aucun `best_purchase_option`, tandis qu'une vraie offre rend
 * `is_free_to_keep: true` avec sa date de fin. C'est ce dernier champ, et lui
 * seul, qui fait foi.
 */
export function isFreeToKeep(item) {
  const offer = item && item.best_purchase_option;
  return Boolean(offer && offer.is_free_to_keep === true);
}

export function mapItem(item, now, owned) {
  if (!isFreeToKeep(item)) return null;

  const appid = String(item.appid || item.id || '');
  const purchase = item.best_purchase_option || {};
  const path = item.store_url_path ? `https://store.steampowered.com/${item.store_url_path}` : `${DETAIL_URL}${appid}/`;

  // free_to_keep_ends est en secondes, pas en millisecondes.
  const end = Number.isFinite(purchase.free_to_keep_ends) && purchase.free_to_keep_ends > 0
    ? purchase.free_to_keep_ends * 1000
    : null;

  const originalPrice = Number.parseInt(purchase.original_price_in_cents, 10);

  return makeOffer({
    source: NAME,
    sourceId: appid,
    store: STORES.STEAM,
    storeId: appid,
    title: item.name || `Application ${appid}`,
    url: path,
    image: item.assets && item.assets.header ? item.assets.header : null,
    end,
    worth: Number.isFinite(originalPrice) && originalPrice > 0 ? `$${(originalPrice / 100).toFixed(2)}` : null,
    category: item.type === 1 ? 'DLC' : 'Game',
    /* La source ne rend QUE des offres dont best_purchase_option dit
       is_free_to_keep. Le dire explicitement evite que le filtre retombe sur la
       valeur : un jeu offert dont Steam ne publie pas le prix d'origine serait
       sinon classe « on ne sait pas ». */
    keepable: true,
    alreadyOwned: owned ? owned.has(appid) : null,
    seenAt: now,
    updatedAt: now,
  });
}

/**
 * Ce que la session connectee possede deja.
 *
 * Rend null -- et non un ensemble vide -- quand on ne sait pas : une absence de
 * reponse ne prouve pas que la bibliotheque est vide, et afficher « pas encore
 * recupere » sur des jeux deja acquis serait pire que ne rien afficher.
 */
export async function readOwned({ fetch: fetchImpl = fetch } = {}) {
  try {
    const r = await fetchImpl(OWNED_URL, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    const apps = data && data.rgOwnedApps;
    if (!Array.isArray(apps)) return null;
    return new Set(apps.map(String));
  } catch {
    return null;
  }
}

/**
 * Decouvre les offres en cours.
 *
 * Deux temps : la page de recherche donne les candidats, l'API de confirmation
 * tranche. La page seule ne suffit pas -- elle melange les gratuits permanents
 * aux offres temporaires.
 */
export async function discover({
  fetch: fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = 20000,
  withOwned = true,
} = {}) {
  const errors = [];
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), timeoutMs) : null;
  const signal = stopwatch ? stopwatch.signal : undefined;

  try {
    const searchUrl = await fetchImpl(SEARCH_URL, { credentials: 'omit', signal });
    if (!searchUrl.ok) return { offers: [], dropped: [], errors: [`recherche : HTTP ${searchUrl.status}`] };

    const appids = extractAppIds(await searchUrl.text());
    if (!appids.length) {
      // Resultat legitime : les promotions a -100 % sont rares chez Steam.
      return { offers: [], dropped: [], errors: [] };
    }

    const items = await fetchImpl(itemsUrl(appids), {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!items.ok) return { offers: [], dropped: [], errors: [`items : HTTP ${items.status}`] };

    const data = await items.json();
    const list = (data && data.response && data.response.store_items) || [];

    const owned = withOwned ? await readOwned({ fetch: fetchImpl }) : null;
    if (withOwned && owned === null) {
      errors.push('possessions inconnues : session Steam absente ou illisible');
    }

    const offers = [];
    const dropped = [];
    for (const item of list) {
      const offer = mapItem(item, now, owned);
      if (offer) offers.push(offer);
      else dropped.push({ reasonText: 'pas une offre a garder', title: item && item.name });
    }

    return { offers, dropped, errors };
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? `delai depasse (${timeoutMs} ms)` : (e && e.message) || String(e);
    return { offers: [], dropped: [], errors: [reason] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
