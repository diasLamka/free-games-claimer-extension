/* Source de decouverte : l'API officielle freeGamesPromotions d'Epic.
 *
 * Epic est le seul magasin pour lequel nous avons une source de premiere main.
 * Elle est prioritaire sur l'agregateur pour trois raisons : elle donne l'URL
 * du magasin directement (l'agregateur ne la donne jamais), elle donne les
 * bornes exactes de la fenetre promotionnelle, et elle n'a pas de latence de
 * republication.
 *
 * La logique de resolution de slug est reprise a l'identique du moteur
 * (src/core/10-epic-helpers.js). C'est une duplication assumee : le moteur est
 * en ES5 concatene dans une IIFE, ce module est en ESM. Plutot que de tordre
 * l'un ou l'autre, un test de parite (test/epic-parite.test.mjs) verifie que
 * les deux rendent exactement la meme chose sur les memes entrees.
 */
import { makeOffer, STORES } from '../offer.js';

export const NAME = 'epic-api';

export const API_URLS = Object.freeze([
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR',
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR',
]);

export const STORE_ORIGIN = 'https://store.epicgames.com';
export const LANG = 'fr';

/* ------------------------------------------------------------------- slugs */

/**
 * Ramene un slug brut a la forme attendue par le store, ou null si la valeur
 * ne peut pas donner une URL valide :
 *   "cardpocalypse/home"  -> "cardpocalypse"  (suffixe herite retire)
 *   "[]"                  -> null             (jeu mystere sans page)
 *   32 caracteres hex     -> null             (hash d'offre : mene a /not-found)
 */
export function normaliseSlug(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.split('?')[0].split('#')[0];
  s = s.replace(/^\/+|\/+$/g, '');
  s = s.split('/')[0];
  if (!s || s === '[]') return null;
  if (/^[0-9a-f]{32}$/.test(s)) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s)) return null;
  return s;
}

/**
 * Ordre de priorite : offerMappings[].pageSlug (page de l'offre), puis
 * catalogNs.mappings[].pageSlug (page produit du namespace), puis productSlug
 * nettoye, puis urlSlug en dernier recours -- souvent un identifiant interne.
 *
 * Un candidat inexploitable ne fait pas echouer la resolution : on passe au
 * suivant. C'est ce qui a corrige les 404 de la v2.3.0.
 */
export function resolveSlug(el) {
  if (!el) return null;
  const candidates = [];
  for (const m of el.offerMappings || []) if (m) candidates.push(m.pageSlug);
  for (const m of (el.catalogNs && el.catalogNs.mappings) || []) if (m) candidates.push(m.pageSlug);
  candidates.push(el.productSlug, el.slugUrl);

  for (const c of candidates) {
    const slug = normaliseSlug(c);
    if (slug) return slug;
  }
  return null;
}

/**
 * Vignette du jeu. L'API expose plusieurs formats sous keyImages ; on prend le
 * plus proche d'une tuile carree, puis le format large, puis n'importe lequel.
 */
export function offerImage(el) {
  const images = (el && el.keyImages) || [];
  const preferences = ['Thumbnail', 'OfferImageWide', 'DieselStoreFrontWide', 'OfferImageTall'];
  for (const type of preferences) {
    const found = images.find((i) => i && i.type === type && i.url);
    if (found) return found.url;
  }
  const first = images.find((i) => i && i.url);
  return first ? first.url : null;
}

export function pathBase(el) {
  const isBundle = (el && el.offerType === 'BUNDLE')
    || ((el && el.categories) || []).some((c) => c && c.path === 'bundles');
  return isBundle ? '/bundles/' : '/p/';
}

export function storeUrl(path) {
  let url = STORE_ORIGIN + path;
  if (LANG) url += (path.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(LANG);
  return url;
}

export function buildUrl(base, slug) {
  return storeUrl(base + slug);
}

/* -------------------------------------------------------------- promotions */

/**
 * Parcourt les fenetres promotionnelles et rend celle qui court a l'instant
 * donne, avec ses bornes. Rend null si aucune ne court.
 *
 * Une borne absente ou illisible est traitee comme infinie : mieux vaut
 * considerer une promo comme ouverte et verifier sur place que la rater.
 */
export function activeWindow(el, now) {
  const batches = (el && el.promotions && el.promotions.promotionalOffers) || [];
  for (const batch of batches) {
    for (const offer of (batch && batch.promotionalOffers) || []) {
      if (!offer) continue;
      let start = offer.startDate ? Date.parse(offer.startDate) : Number.NEGATIVE_INFINITY;
      let end = offer.endDate ? Date.parse(offer.endDate) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(start)) start = Number.NEGATIVE_INFINITY;
      if (Number.isNaN(end)) end = Number.POSITIVE_INFINITY;
      if (start <= now && now < end) {
        return {
          start: Number.isFinite(start) ? start : null,
          end: Number.isFinite(end) ? end : null,
        };
      }
    }
  }
  return null;
}

/**
 * Fenetres promotionnelles A VENIR, telles qu'Epic les publie lui-meme.
 *
 * C'est la meilleure nouvelle de cette source : pour Epic, l'ordonnanceur n'a
 * pas a PREDIRE l'heure du prochain drop, il la LIT. Et il vaut mieux, car la
 * regle "Epic lache a 11:00 heure de New York" est fausse en general : la
 * capture du 2026-08-27 contient des ouvertures a 15:00Z (soit 11:00 EDT, la
 * regle attendue) mais aussi a 17:00Z et 01:00Z. Un calendrier ecrit a la main
 * aurait rate ces deux-la.
 */
export function upcomingWindows(el, now) {
  const batches = (el && el.promotions && el.promotions.upcomingPromotionalOffers) || [];
  const windows = [];
  for (const batch of batches) {
    for (const offer of (batch && batch.promotionalOffers) || []) {
      if (!offer || !offer.startDate) continue;
      const start = Date.parse(offer.startDate);
      if (Number.isNaN(start) || start <= now) continue;
      const end = offer.endDate ? Date.parse(offer.endDate) : NaN;
      windows.push({
        title: (el && el.title) || null,
        image: offerImage(el),
        start,
        end: Number.isNaN(end) ? null : end,
      });
    }
  }
  return windows;
}

/**
 * Toutes les ouvertures a venir annoncees par l'API, du plus proche au plus
 * lointain. L'ordonnanceur arme son alarme sur la premiere.
 */
export function nextWindows(elements, now) {
  const all = [];
  for (const el of elements || []) all.push(...upcomingWindows(el, now));
  return all.sort((a, b) => a.start - b.start);
}

/**
 * Une promo est reclamable si une fenetre court ET que le prix remise est a
 * zero -- quand l'API fournit le prix. Sans information de prix, on fait
 * confiance a la fenetre.
 */
export function promoActiveNow(el, now) {
  if (!activeWindow(el, now)) return false;
  const total = el.price && el.price.totalPrice;
  if (total && typeof total.discountPrice === 'number') return total.discountPrice === 0;
  return true;
}

/**
 * Est-ce le JEU OFFERT DE LA SEMAINE, ou quelque chose qui est gratuit de toute
 * facon ?
 *
 * La difference se lit dans le prix d'origine, et nulle part ailleurs :
 *
 *   originalPrice > 0 et discountPrice === 0  ->  un jeu payant, offert un temps
 *   originalPrice === 0                       ->  gratuit en permanence
 *
 * Ce n'est pas une subtilite. Sur la capture reelle du 2026-08-27, le flux
 * freeGamesPromotions rend DEUX offres actives : Cardpocalypse, a 23,99 EUR
 * remis a zero, et un « Pack de Mage Epique » a 0 EUR -- un cosmetique
 * permanent, offerType ADD_ON, qui n'est pas un jeu et qu'il n'y a rien a
 * « prendre ». Sans ce controle, chaque cycle ouvrait un onglet et posait une
 * requete sur un vrai compte pour un objet deja acquis par tout le monde.
 *
 * Le prix d'origine est prefere a offerType : Epic offre parfois de vrais DLC
 * payants, que le reglage « inclure les DLC » doit pouvoir accepter. Ce qui se
 * decide ici, c'est « y a-t-il quelque chose a garder », pas « est-ce un jeu ».
 */
export function isFreeToKeep(el) {
  const total = el && el.price && el.price.totalPrice;
  if (!total || typeof total.originalPrice !== 'number') return null;   // on ne sait pas
  if (total.originalPrice <= 0) return false;                           // gratuit de toute facon
  return total.discountPrice === 0;
}

/**
 * Le prix d'origine tel qu'Epic le formate, pour l'affichage et le bilan.
 *
 * Epic publie le prix DU COMPTE : « 23,99 EUR » sur un compte francais, avec
 * son `currencyCode` a cote. C'est ce qui rend faux tout symbole choisi par
 * l'extension -- elle n'a rien a choisir, le montant arrive deja habille.
 *
 * Le repli reconstruit le montant a partir des centimes SANS oublier la
 * devise : un nombre nu serait relu plus tard par quelqu'un qui devrait
 * deviner, et deviner ici veut dire supposer des dollars.
 */
export function originalWorth(el) {
  const total = el && el.price && el.price.totalPrice;
  const fmt = total && total.fmtPrice;
  const raw = fmt && fmt.originalPrice;
  if (raw && raw !== '0') return String(raw);

  if (total && typeof total.originalPrice === 'number' && total.originalPrice > 0 && total.currencyCode) {
    const info = total.currencyInfo;
    const decimals = info && Number.isFinite(info.decimals) ? info.decimals : 2;
    return `${(total.originalPrice / 10 ** decimals).toFixed(decimals)} ${total.currencyCode}`;
  }
  return null;
}

/* -------------------------------------------------------------- projection */

/**
 * Transforme la liste "elements" de l'API en Offres reclamables maintenant.
 *
 * Les elements ecartes sont rendus a part plutot que perdus : une offre
 * gratuite sans slug exploitable est une anomalie qui merite le journal, pas
 * un silence.
 */
export function mapElements(elements, now) {
  const offers = [];
  const dropped = [];

  for (const el of elements || []) {
    if (!el) continue;
    if (!promoActiveNow(el, now)) continue;

    // Gratuit en permanence : rien a prendre. Ecarte avec un motif, jamais en
    // silence -- si Epic changeait son flux, ce journal le dirait.
    if (isFreeToKeep(el) === false) {
      dropped.push({
        title: el.title,
        reasonText: 'gratuit en permanence, rien a garder',
        offerType: el.offerType ?? null,
      });
      continue;
    }

    const slug = resolveSlug(el);
    if (!slug) {
      dropped.push({
        title: el.title,
        reasonText: 'aucun slug de page exploitable',
        productSlug: el.productSlug ?? null,
        slugUrl: el.slugUrl ?? null,
      });
      continue;
    }

    const base = pathBase(el);
    const window = activeWindow(el, now);

    offers.push(makeOffer({
      source: NAME,
      sourceId: el.id,
      store: STORES.EPIC,
      storeId: slug,
      title: el.title,
      url: buildUrl(base, slug),
      image: offerImage(el),
      start: window ? window.start : null,
      end: window ? window.end : null,
      // Le prix d'origine etait perdu : le bilan comptait les jeux Epic sans
      // jamais pouvoir dire ce qu'ils valaient.
      worth: originalWorth(el),
      keepable: isFreeToKeep(el),
      seenAt: now,
      updatedAt: now,
    }));
  }

  return { offers, dropped };
}

/* --------------------------------------------------------------- decouverte */

/**
 * Interroge l'API et rend les offres actives.
 *
 * `fetch` et `maintenant` sont injectes : le module reste testable sans reseau
 * ni horloge reelle.
 *
 * Les deux hotes de l'API sont essayes dans l'ordre -- le second est la voie
 * IPv4, utile quand la resolution IPv6 echoue chez certains fournisseurs.
 */
export async function discover({ fetch: fetchImpl = fetch, now = Date.now(), urls = API_URLS } = {}) {
  const errors = [];

  for (const url of urls) {
    try {
      const response = await fetchImpl(url, {
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        errors.push(`${url} : HTTP ${response.status}`);
        continue;
      }

      const data = await response.json();
      const elements = data
        && data.data
        && data.data.Catalog
        && data.data.Catalog.searchStore
        && data.data.Catalog.searchStore.elements;

      if (!Array.isArray(elements)) {
        errors.push(`${url} : structure inattendue (elements absent)`);
        continue;
      }

      const { offers, dropped } = mapElements(elements, now);
      return {
        offers,
        dropped,
        // Epic annonce ses prochaines ouvertures : l'ordonnanceur s'en sert
        // pour armer une alarme a l'instant exact, au lieu de sonder a l'aveugle.
        nextWindows: nextWindows(elements, now),
        errors,
        usedUrl: url,
      };
    } catch (e) {
      errors.push(`${url} : ${(e && e.message) || e}`);
    }
  }

  return { offers: [], dropped: [], nextWindows: [], errors, usedUrl: null };
}
