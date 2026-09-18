/* Source de decouverte : Steam, jeux et DLC offerts DEFINITIVEMENT.
 *
 * Ce module ne clique jamais. Il repond a une question et une seule : « qu'est-
 * ce qui est gratuit a garder en ce moment, et que je n'ai pas deja ? »
 *
 * PAR DEFAUT, le clic reste humain : l'offre est detectee, affichee, mise a un
 * clic. Le Steam Subscriber Agreement (section 4.C) interdit « any form of
 * scripts, bots, macros, or other non-human-controlled systems » pour
 * interagir avec Steam, et prevoit la fermeture du compte sans preavis (4.D).
 * Un compte Steam represente souvent des annees de bibliotheque.
 *
 * Depuis la 2.22.0, l'utilisateur peut prendre ce risque lui-meme : l'option
 * `steamAutoClaim`, coupee par defaut, fait recuperer les offres par
 * watch/claim.js (claimSteamOffer). Ce module lui fournit les deux choses
 * qu'elle exige : le numero de PAQUET de chaque offre, et la lecture de ce que
 * le compte possede -- avant d'agir, et comme preuve apres.
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

  /* Le prix, dans la devise du magasin et non dans la notre.
   *
   * GetItems rend les deux : `formatted_original_price` porte le symbole de la
   * region ("19,99 EUR" depuis la France), `original_price_in_cents` n'en porte
   * aucun. Ce module composait « $ » + les centimes, ce qui affichait des
   * dollars a qui voit des euros sur la page. On prend donc la forme deja
   * formatee quand elle existe, et le nombre nu -- sans symbole invente --
   * sinon. */
  const originalPrice = Number.parseInt(purchase.original_price_in_cents, 10);
  const formatted = typeof purchase.formatted_original_price === 'string'
    ? purchase.formatted_original_price.trim()
    : '';

  return makeOffer({
    source: NAME,
    sourceId: appid,
    store: STORES.STEAM,
    storeId: appid,
    title: item.name || `Application ${appid}`,
    url: path,
    image: item.assets && item.assets.header ? item.assets.header : null,
    end,
    worth: formatted
      || (Number.isFinite(originalPrice) && originalPrice > 0 ? (originalPrice / 100).toFixed(2) : null),
    /* Le DLC porte le type 4. Mesure du 2026-09-19 : « Dying Light: The Beast -
       Discharge Weapon Pack », offert ce jour-la, rend `type: 4` dans GetItems.
       Ce module lisait 1 : les vrais DLC passaient pour des jeux, et le filtre
       « contenu en jeu » ne les voyait jamais. */
    category: item.type === 4 ? 'DLC' : 'Game',
    /* Le paquet gratuit que l'offre donne. Mesure du meme jour : c'est aussi
       le numero du bloc d'achat de la page, et celui que `rgOwnedPackages`
       contient une fois la licence ajoutee. Sans lui, pas de recuperation. */
    packageId: purchase.packageid ? String(purchase.packageid) : null,
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
 * Ce que la session possede, applications ET paquets, avec un verdict.
 *
 * `readOwned` rend null quand il ne sait pas ; la recuperation a besoin de
 * savoir POURQUOI. Mesure du 2026-09-19 : sans session, userdata repond 200
 * avec des listes VIDES -- d'ou « logged_out » sur une liste vide, plutot que
 * « rien possede ». `cache: 'no-store'` et un parametre qui change : juste
 * apres une activation, c'est la reponse fraiche qu'il faut lire.
 */
export async function readOwnership({ fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const r = await fetchImpl(`${OWNED_URL}?t=${now}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return { status: 'error', note: `HTTP ${r.status}`, apps: new Set(), packages: new Set() };
    const data = await r.json();
    const apps = data && data.rgOwnedApps;
    const packages = data && data.rgOwnedPackages;
    if (!Array.isArray(apps) || !Array.isArray(packages)) {
      return { status: 'error', note: 'forme inattendue', apps: new Set(), packages: new Set() };
    }
    if (!apps.length && !packages.length) {
      return { status: 'logged_out', note: 'listes vides', apps: new Set(), packages: new Set() };
    }
    return { status: 'ok', note: null, apps: new Set(apps.map(String)), packages: new Set(packages.map(String)) };
  } catch (e) {
    return { status: 'error', note: (e && e.message) || String(e), apps: new Set(), packages: new Set() };
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
