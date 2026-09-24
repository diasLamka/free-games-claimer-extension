/* Source de decouverte : les jeux MOBILES offerts par Epic (2.57.0).
 *
 * Epic offre aussi, chaque semaine, des jeux pour Android et iOS. Ils ne sont
 * PAS dans `freeGamesPromotions` -- ni tels quels, ni avec `&platform=` : la
 * mesure V8 du 2026-09-23 l'a etabli (13 offres, aucune mobile, filtre sans
 * effet). Ils sont dans l'API de decouverte de l'application mobile :
 *
 *   egs-platform-service.store.epicgames.com/api/v2/public/discover/home
 *     ?count=10&country=FR&locale=fr&platform=android&start=0&store=EGS
 *
 * CE QUI EST MESURE (rapport V8, Android et iOS) :
 *   - la reponse est `{ data: [rubrique...], paging }` ;
 *   - une rubrique est `{ topicId, type, title, link, size, offers: [...] }` ;
 *     celle des jeux offerts porte `topicId` = « mobile-android-free-game » ou
 *     « mobile-ios-free-game » -- a ne pas confondre avec
 *     « mobile-android-genre-free », les free-to-play ;
 *   - une offre est `{ offerId, sandboxId, content }`, et `content` porte
 *     `title`, `mapping.slug` (« calico-android-83faf9 »),
 *     `systemSpecs.platform` (« android » | « ios »), `categories` (des
 *     chaines, « freegames » en tete), `catalogItemId`, `media`, `purchase`.
 *
 * MESURE ENSUITE (lecture directe du 2026-09-23, test/fixtures) :
 *   - `purchase` est la LISTE des options d'achat : `Claim` a prix nul, dont
 *     `discount.discountEndDate` est la fin de la gratuite, puis `Purchase`
 *     au prix normal, qui prend effet a cette fin ;
 *   - `media` porte quatre images, chacune son `imageType` : `appIcon`
 *     (ProductIcon), `card16x9` (OfferImageWide), `card3x4` (OfferImageTall)
 *     et `coverImage`. La vignette est la large.
 * Les lecteurs restent generaux (findEnd, findImage) : ils trouvent ces deux
 * chemins sur la vraie reponse, et survivraient a un champ renomme. Une date
 * ou une image qu'on ne trouve pas vaut « on ne sait pas », jamais une valeur
 * inventee ; chaque lecture dit le CHEMIN ou elle a pris ce qu'elle retient,
 * et la mesure V8 le recopie. Sans date de fin, une offre vit tant que la rubrique la porte --
 * la source fait autorite sur son magasin, et une offre qui en disparait est
 * terminee.
 *
 * Ces jeux se RECUPERENT DANS L'APPLICATION EPIC du telephone : l'extension
 * les voit, les annonce, les envoie au telephone si l'alerte est active --
 * elle ne les reclame jamais. D'ou un magasin a part, `epic-mobile`, hors de
 * la liste des magasins reclamables, et que la source Epic (PC) ne balaie pas.
 *
 * La reponse pese pres de 500 Ko sur Android : la source ne tourne que si
 * l'utilisateur suit ce magasin (voir activeSourcesFor), et pas plus d'une
 * fois toutes les trois heures.
 */
import { makeOffer, STORES } from '../offer.js';
import { normaliseCountry, normaliseLang } from '../locale.js';
import { storeUrl } from './epic.js';

export const NAME = 'epic-mobile';
export const PLATFORMS = Object.freeze(['android', 'ios']);

/** La rubrique des jeux offerts, et elle seule. */
export const FREE_TOPIC = /^mobile-(android|ios)-free-game$/;

/**
 * La page qu'ouvre un clic quand la fiche du jeu n'est pas connue : celle des
 * jeux gratuits, qui AFFICHE la rubrique mobile (mesure V8 : « Installer
 * l'appli mobile pour en profiter »).
 */
export const PAGE_URL = 'https://store.epicgames.com/free-games';

/**
 * La fiche du jeu sur le site d'Epic (2.67.0), par le slug ANDROID.
 *
 * Mesure du 2026-09-24 dans Chromium : `store.epicgames.com/fr/p/
 * mindcop-android-0f4bac` repond 200 et se range en `/p/mindcop-android-
 * 0f4bac?lang=fr` -- la vraie fiche, « Mindcop | Telecharger et acheter
 * aujourd'hui », titre en h1. Le slug iOS (« mindcop-ios-11d53d ») n'a pas pu
 * etre ouvert : Cloudflare a arrete les essais suivants. Un jeu iOS seul garde
 * donc la page des jeux gratuits -- un lien mesure plutot qu'un lien suppose.
 */
export function productUrl(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,120}-android-[0-9a-f]{4,}$/.test(s)) return null;
  return storeUrl(`/p/${s}`);
}

/**
 * Le prix normal, lu dans l'option `Purchase` (2.67.0), ou null.
 *
 * Mesure du 2026-09-23 (test/fixtures) : Mindcop porte `Claim` a 0, puis
 * `Purchase` a `decimalPrice` 5.39 EUR, affiche « 5,39 € ». Le nombre et la
 * devise, pas le texte affiche : c'est la forme que le reste de l'extension
 * sait lire et convertir.
 */
export function readPrice(purchase) {
  for (const o of Array.isArray(purchase) ? purchase : []) {
    if (!o || String(o.purchaseType || '').toLowerCase() !== 'purchase') continue;
    const p = o.price || {};
    const n = Number(p.decimalPrice);
    const code = String(p.currencyCode || '');
    if (Number.isFinite(n) && n > 0 && /^[A-Z]{3}$/.test(code)) return `${n.toFixed(2)} ${code}`;
  }
  return null;
}

export function discoverUrl(country, lang, platform) {
  const c = normaliseCountry(country);
  const l = normaliseLang(lang, c);
  return 'https://egs-platform-service.store.epicgames.com/api/v2/public/discover/home'
    + `?count=10&country=${encodeURIComponent(c)}&locale=${encodeURIComponent(l)}`
    + `&platform=${encodeURIComponent(platform)}&start=0&store=EGS`;
}

/** « calico-android-83faf9 » -> « calico » : le meme jeu sur les deux plateformes. */
export function baseSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(s)) return null;
  return s.replace(/-(android|ios)-[0-9a-f]{4,}$/, '') || null;
}

/**
 * Les offres de la rubrique des jeux offerts.
 *
 * null quand la rubrique est ABSENTE : Epic a range sa page autrement, et on
 * ne sait plus rien -- ce n'est pas « aucun jeu cette semaine ». Une rubrique
 * presente et vide, elle, dit bien « aucun ».
 */
export function freeTopicOffers(json) {
  const rubriques = json && Array.isArray(json.data) ? json.data : null;
  if (!rubriques) return null;
  const libres = rubriques.filter((r) => r && typeof r.topicId === 'string' && FREE_TOPIC.test(r.topicId));
  if (!libres.length) return null;
  return libres.flatMap((r) => (Array.isArray(r.offers) ? r.offers : []));
}

/** Les mots d'une cle : « discountEndDate » -> « discount end date », « end_date » -> « end date ». */
const mots = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();

/* ------------------------------------------------------------ la vignette */

const URL_HTTPS = /^https:\/\/[^\s"'<>]{1,2000}$/;
const EXT_IMAGE = /\.(?:jpe?g|png|webp|avif)(?:[?#][^\s"']*)?$/i;
/** Ce qui n'est pas une image, meme sur le CDN d'Epic. */
const EXT_AUTRE = /\.(?:mp4|webm|m3u8|mov|gif|svg|json|js|html?)(?:[?#]|$)/i;
/** Le CDN d'images d'Epic sert aussi des adresses sans extension. */
const CDN_EPIC = /^https:\/\/cdn\d*\.(?:epicgames\.com|unrealengine\.com)\//i;
/** Ce qui fait une bonne vignette PAYSAGE, et ce qui n'en fait pas une. */
const INDICE_BON = /wide|16 ?x ?9|landscape|hero|banner|featured|card|thumb|key ?art|cover/;
const INDICE_MAUVAIS = /logo|icon|rating|avatar|badge|screenshot|video|trailer|tall|portrait|3 ?x ?4|9 ?x ?16|vertical/;

/**
 * La vignette dans `media`, et le chemin ou elle a ete prise.
 *
 * La forme de `media` n'est pas mesuree (2.57.0). Plutot que la premiere image
 * venue -- un logo, un portrait --, chaque image https recoit une note d'apres
 * les cles qui y menent et le genre que son objet declare
 * (`{ type: 'OfferImageWide', url }`) : large, 16x9, carte ou vignette
 * gagnent ; logo, icone, portrait ou capture perdent. A note egale, la
 * premiere. Le chemin part dans le rapport V8 : il dit d'ou vient l'image.
 */
export function findImage(media) {
  let meilleure = null;
  (function walk(v, chemin, indice, profondeur) {
    if (profondeur > 7 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!URL_HTTPS.test(s) || EXT_AUTRE.test(s)) return;
      if (!EXT_IMAGE.test(s) && !CDN_EPIC.test(s)) return;
      const note = (INDICE_BON.test(indice) ? 2 : 0) - (INDICE_MAUVAIS.test(indice) ? 3 : 0);
      if (!meilleure || note > meilleure.note) meilleure = { url: s, path: chemin, note };
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${chemin}[${i}]`, indice, profondeur + 1)); return; }
    if (typeof v === 'object') {
      const genre = ['type', 'name', 'imageType', 'kind', 'role']
        .map((k) => (typeof v[k] === 'string' ? mots(v[k]) : '')).join(' ');
      for (const [k, x] of Object.entries(v)) walk(x, `${chemin}.${k}`, `${indice} ${mots(k)} ${genre}`, profondeur + 1);
    }
  }(media, 'media', '', 0));
  return meilleure && { url: meilleure.url, path: meilleure.path };
}

/** La vignette seule, ou null. */
export function readImage(media) {
  const trouvee = findImage(media);
  return trouvee ? trouvee.url : null;
}

/* ------------------------------------------------------------ la date de fin */

/** Une cle qui dit « fin ». « weekend », « legend » ou « startDate » ne passent pas. */
const CLE_FIN = /\bends? ?(date|time|at|on)?$|\bexpir|\buntil$|\bvalid (to|thru|through)$/;

/** Un instant : une date ecrite (avec son annee), ou des secondes, ou des millisecondes. */
function instant(v) {
  if (typeof v === 'string' && /\b20\d\d\b/.test(v)) {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v > 1e12 && v < 1e14) return v;
    if (v > 1e9 && v < 1e11) return v * 1000;
  }
  return null;
}

/**
 * La date de fin dans `purchase`, et le chemin ou elle a ete lue : une cle qui
 * dit « fin », une valeur qui se lit comme un instant A VENIR. S'il y en a
 * plusieurs, la plus proche -- une offre finit a sa premiere fin. Sinon null :
 * une date qu'on ne trouve pas vaut « on ne sait pas », jamais une valeur
 * inventee.
 */
export function findEnd(purchase, now) {
  let fin = null;
  (function walk(v, chemin, profondeur) {
    if (profondeur > 6 || !v || typeof v !== 'object') return;
    const entrees = Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v);
    for (const [k, x] of entrees) {
      const ici = typeof k === 'number' ? `${chemin}[${k}]` : `${chemin}.${k}`;
      if (typeof k === 'string' && CLE_FIN.test(mots(k))) {
        const t = instant(x);
        if (t !== null) {
          if (t > now && (fin === null || t < fin.at)) fin = { at: t, path: ici };
          continue;
        }
      }
      walk(x, ici, profondeur + 1);
    }
  }(purchase, 'purchase', 0));
  return fin;
}

/** La date de fin seule, en millisecondes, ou null. */
export function readEnd(purchase, now) {
  const fin = findEnd(purchase, now);
  return fin ? fin.at : null;
}

/**
 * Les offres des deux plateformes, reunies par jeu.
 *
 * Le meme jeu a un slug par plateforme ; il n'en fait pas deux offres. Les
 * plateformes vont dans `platforms`, en clair (« Android, iOS »).
 */
export function mapMobileOffers(parPlateforme, now) {
  const jeux = new Map();
  const dropped = [];
  for (const [plateforme, offres] of Object.entries(parPlateforme)) {
    for (const o of offres || []) {
      const c = o && o.content;
      const titre = c && typeof c.title === 'string' ? c.title.trim() : '';
      const base = baseSlug(c && c.mapping && c.mapping.slug);
      if (!titre || !base) { dropped.push({ plateforme, raison: 'titre ou slug illisible' }); continue; }
      const jeu = jeux.get(base) || { titre, base, plateformes: new Set(), image: null, fin: null, ids: [], page: null, prix: null };
      jeu.plateformes.add(plateforme === 'ios' ? 'iOS' : 'Android');
      jeu.image = jeu.image || readImage(c.media);
      jeu.page = jeu.page || productUrl(c.mapping.slug);
      jeu.prix = jeu.prix || readPrice(c.purchase);
      const fin = readEnd(c.purchase, now);
      if (fin !== null && (jeu.fin === null || fin < jeu.fin)) jeu.fin = fin;
      if (o.offerId) jeu.ids.push(String(o.offerId));
      jeux.set(base, jeu);
    }
  }
  const offers = [...jeux.values()].map((j) => makeOffer({
    source: NAME,
    sourceId: `${NAME}:${j.base}`,
    store: STORES.EPIC_MOBILE,
    storeId: j.base,
    title: j.titre,
    url: j.page || PAGE_URL,
    image: j.image,
    worth: j.prix,
    end: j.fin === null ? null : new Date(j.fin).toISOString(),
    platforms: [...j.plateformes].sort().join(', '),
    category: 'game',
    // La rubrique est celle des jeux OFFERTS, pas des free-to-play.
    keepable: true,
    seenAt: now,
  }));
  return { offers, dropped };
}

export async function discover({ fetch: fetchImpl = fetch, now = Date.now(), country = null, lang = null } = {}) {
  const errors = [];
  const parPlateforme = {};
  let lues = 0;

  for (const plateforme of PLATFORMS) {
    const url = discoverUrl(country, lang, plateforme);
    try {
      const response = await fetchImpl(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
      if (!response.ok) { errors.push(`${plateforme} : HTTP ${response.status}`); continue; }
      const offres = freeTopicOffers(await response.json());
      if (offres === null) { errors.push(`${plateforme} : rubrique des jeux offerts absente (forme changee ?)`); continue; }
      parPlateforme[plateforme] = offres;
      lues++;
    } catch (e) {
      errors.push(`${plateforme} : ${(e && e.message) || e}`);
    }
  }

  const { offers, dropped } = mapMobileOffers(parPlateforme, now);
  return {
    offers,
    dropped,
    nextWindows: [],
    errors,
    usedUrl: lues ? discoverUrl(country, lang, PLATFORMS[0]) : null,
    /* Complete seulement si les DEUX plateformes ont ete lues : un jeu propre
       a iOS, absent d'une lecture Android seule, ne doit pas passer pour
       termine. */
    complete: lues === PLATFORMS.length,
  };
}
