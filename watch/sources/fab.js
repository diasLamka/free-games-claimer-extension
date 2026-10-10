/* Source de decouverte : les assets "Limited-Time Free" de Fab, la boutique
 * d'Epic pour les modeles 3D, les plugins et les assets Unreal et Unity (2.108.0).
 *
 * CE QUI EST MESURE (2026-10-10, docs/specs/2026-10-10-humble-fab-constats.md) :
 *   - https://www.fab.com/limited-time-free repond 200 a un GET anonyme, sans
 *     JavaScript et sans cookie. Les fiches y sont dans le HTML BRUT, pas
 *     chargees apres coup ;
 *   - elles y sont sous deux formes : le balisage (liens /listings/<uuid>,
 *     classes `fabkit-*` generees, donc a ne pas lire) et un bloc de donnees,
 *     <script id="js-json-data-prefetched-data" type="application/json">, dont
 *     l'entree "/i/blades/free_content_blade" est la liste elle-meme :
 *       { isLimitedFreeContent: true, tiles: [{ listing: {
 *           uid, title, listingType, user.sellerName, assetFormats[...],
 *           thumbnails[0].images[{ width, url }],
 *           licenses: [{ name, slug, offerId, priceTier: {
 *             currencyCode, price, discountedPrice, discountSettings,
 *             discountStartDate, discountEndDate } }] } }] }
 *   - une fiche offerte a deux licences (Personnelle et Professionnelle), toutes
 *     deux remises a 0 pour la meme periode ;
 *   - /i/listings/search et les autres endpoints /i/... repondent 403 a un
 *     client qui n'est pas un navigateur (Cloudflare) : la page, elle, passe.
 *
 * CE QUI NE L'EST PAS : la RECLAMATION. Elle exige la session Epic de
 * l'utilisateur, et le bouton d'ajout a la bibliotheque n'a jamais ete observe
 * connecte. Fab est donc detecte et annonce, jamais reclame (voir
 * DETECT_ONLY_STORES) : un clic ouvre la fiche, ou l'utilisateur ajoute
 * l'asset lui-meme.
 *
 * On lit le bloc de donnees, pas le balisage : un nom de classe genere change
 * a chaque deploiement, un champ `discountEndDate` non.
 *
 * Module PUR : le reseau et l'horloge sont passes en parametre.
 */
import { makeOffer, STORES } from '../offer.js';

export const NAME = 'fab';

/** La page des offres a duree limitee, et la seule que la source lit. */
export const PAGE_URL = 'https://www.fab.com/limited-time-free';

const BLADE_KEY = '/i/blades/free_content_blade';
const DATA_SCRIPT = /<script\b[^>]*\bid=["']js-json-data-prefetched-data["'][^>]*>([\s\S]*?)<\/script>/gi;
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** La largeur de vignette visee : assez nette pour une carte, bien en deca du plein ecran. */
const LARGEUR_VISEE = 640;

/** La fiche d'un asset sur Fab, ou null si l'identifiant n'a pas la forme d'un UUID. */
export function listingUrl(uid) {
  const u = String(uid || '').trim().toLowerCase();
  return UID.test(u) ? `https://www.fab.com/listings/${u}` : null;
}

/**
 * Le bloc des offres a duree limitee, ou null.
 *
 * null veut dire « la page n'a pas la forme mesuree » : un defi Cloudflare, un
 * JSON abime, un bloc renomme. Ce n'est PAS « aucune offre cette semaine » --
 * ce cas-la rend un bloc dont `tiles` est vide.
 */
export function readBlade(html) {
  if (typeof html !== 'string') return null;
  /* Toutes les balises de ce nom, pas la premiere : un commentaire ou un texte
     qui en cite une ne doit pas masquer la vraie. */
  for (const m of html.matchAll(DATA_SCRIPT)) {
    let donnees;
    try {
      donnees = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const blade = donnees && typeof donnees === 'object' ? donnees[BLADE_KEY] : null;
    if (blade && typeof blade === 'object' && blade.isLimitedFreeContent === true && Array.isArray(blade.tiles)) return blade;
  }
  return null;
}

/** Un instant ISO en millisecondes, ou null. */
const instant = (v) => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Une licence gratuite MAINTENANT : un prix d'origine reel remis a zero, une
 * remise commencee et pas finie. Rend ses fins et son prix, ou la raison du refus.
 *
 * Un prix d'origine nul n'est pas une offre : c'est gratuit de toute facon,
 * il n'y a rien a garder.
 */
function licenceGratuite(licence, now) {
  const p = licence && licence.priceTier;
  if (!p || typeof p !== 'object') return { raison: 'aucune licence gratuite' };
  if (!(typeof p.price === 'number' && p.price > 0) || p.discountedPrice !== 0) return { raison: 'aucune licence gratuite' };
  const debut = instant(p.discountStartDate);
  const fin = instant(p.discountEndDate);
  if (fin !== null && fin <= now) return { raison: 'remise terminee' };
  if (debut !== null && debut > now) return { raison: 'remise a venir' };
  return {
    gratuite: true,
    debut,
    fin,
    prix: p.price,
    devise: /^[A-Z]{3}$/.test(String(p.currencyCode || '')) ? p.currencyCode : null,
    perso: licence.slug === 'personal',
  };
}

/** La vignette : la plus petite image d'au moins 640 px de large, sinon la plus large. */
function vignette(listing) {
  const miniature = Array.isArray(listing.thumbnails) ? listing.thumbnails[0] : null;
  if (!miniature || typeof miniature !== 'object') return null;
  const images = (Array.isArray(miniature.images) ? miniature.images : [])
    .filter((i) => i && typeof i.url === 'string' && typeof i.width === 'number');
  if (images.length) {
    const assez = images.filter((i) => i.width >= LARGEUR_VISEE).sort((a, b) => a.width - b.width);
    return (assez[0] || images.sort((a, b) => b.width - a.width)[0]).url;
  }
  return typeof miniature.mediaUrl === 'string' ? miniature.mediaUrl : null;
}

/** « Unreal Engine, Unity » : les formats de l'asset, sans doublon. */
function formats(listing) {
  const noms = (Array.isArray(listing.assetFormats) ? listing.assetFormats : [])
    .map((f) => f && f.assetFormatType && f.assetFormatType.name)
    .filter((n) => typeof n === 'string' && n.trim());
  return noms.length ? [...new Set(noms.map((n) => n.trim()))].join(', ') : null;
}

/**
 * Les offres d'un bloc, a l'instant `now`.
 *
 * Une fiche devient une offre si une de ses licences est gratuite MAINTENANT.
 * Sa fin est la plus proche des licences gratuites : l'offre s'arrete des que
 * l'une d'elles redevient payante. Sa valeur est le prix de la licence
 * Personnelle, a defaut celui de la moins chere des gratuites, dans la devise
 * de la page. Ce qui ne passe pas est rendu dans `dropped`, avec sa raison.
 */
export function mapFabOffers(blade, now) {
  const offers = [];
  const dropped = [];
  const vus = new Set();
  for (const tuile of Array.isArray(blade && blade.tiles) ? blade.tiles : []) {
    const listing = tuile && tuile.listing;
    if (!listing || typeof listing !== 'object') { dropped.push({ uid: null, raison: 'fiche illisible' }); continue; }
    const uid = String(listing.uid || '').trim().toLowerCase();
    const titre = typeof listing.title === 'string' ? listing.title.trim() : '';
    const page = listingUrl(uid);
    if (!page || !titre) { dropped.push({ uid: uid || null, raison: 'identifiant ou titre illisible' }); continue; }
    if (vus.has(uid)) continue;
    vus.add(uid);

    const lues = (Array.isArray(listing.licenses) ? listing.licenses : []).map((l) => licenceGratuite(l, now));
    const gratuites = lues.filter((l) => l.gratuite);
    if (!gratuites.length) {
      const raison = lues.find((l) => l.raison && l.raison !== 'aucune licence gratuite');
      dropped.push({ uid, raison: raison ? raison.raison : 'aucune licence gratuite' });
      continue;
    }

    const fins = gratuites.map((l) => l.fin).filter((t) => t !== null);
    const debuts = gratuites.map((l) => l.debut).filter((t) => t !== null);
    const prix = gratuites.find((l) => l.perso) || [...gratuites].sort((a, b) => a.prix - b.prix)[0];
    offers.push(makeOffer({
      source: NAME,
      sourceId: `${NAME}:${uid}`,
      store: STORES.FAB,
      storeId: uid,
      title: titre,
      url: page,
      image: vignette(listing),
      worth: prix.devise ? `${prix.prix.toFixed(2)} ${prix.devise}` : null,
      start: debuts.length ? new Date(Math.min(...debuts)).toISOString() : null,
      end: fins.length ? new Date(Math.min(...fins)).toISOString() : null,
      publisher: listing.user && typeof listing.user.sellerName === 'string' ? listing.user.sellerName : null,
      platforms: formats(listing),
      category: 'asset',
      // Ajoute a la bibliotheque, pour toujours : ce n'est pas un essai.
      keepable: true,
      seenAt: now,
    }));
  }
  return { offers, dropped };
}

export async function discover({ fetch: fetchImpl = fetch, now = Date.now() } = {}) {
  const errors = [];
  let offers = [];
  let dropped = [];
  let complete = false;
  try {
    const response = await fetchImpl(PAGE_URL, { credentials: 'omit', headers: { Accept: 'text/html' } });
    if (!response.ok) {
      errors.push(`HTTP ${response.status}`);
    } else {
      const blade = readBlade(await response.text());
      if (!blade) {
        errors.push('bloc des offres absent (la page a change de forme, ou un defi l\'a remplacee)');
      } else {
        ({ offers, dropped } = mapFabOffers(blade, now));
        // Le bloc EST la liste entiere : une fiche qui n'y est plus est terminee.
        complete = true;
      }
    }
  } catch (e) {
    errors.push(String((e && e.message) || e));
  }
  return {
    offers,
    dropped,
    nextWindows: [],
    errors,
    usedUrl: complete ? PAGE_URL : null,
    complete,
  };
}
