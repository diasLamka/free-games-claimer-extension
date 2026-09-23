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
 * CE QUI NE L'EST PAS : la forme de `purchase` (donc la date de fin) et celle
 * de `media` (donc la vignette). Elles sont lues avec prudence : une date ou
 * une image qu'on ne trouve pas vaut « on ne sait pas », jamais une valeur
 * inventee. Sans date de fin, une offre vit tant que la rubrique la porte --
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

export const NAME = 'epic-mobile';
export const PLATFORMS = Object.freeze(['android', 'ios']);

/** La rubrique des jeux offerts, et elle seule. */
export const FREE_TOPIC = /^mobile-(android|ios)-free-game$/;

/**
 * La page qu'ouvre un clic : celle des jeux gratuits, qui AFFICHE la rubrique
 * mobile (mesure V8 : « Installer l'appli mobile pour en profiter »). Une
 * page produit par jeu mobile n'a pas ete mesuree.
 */
export const PAGE_URL = 'https://store.epicgames.com/free-games';

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

/** La premiere image https trouvee dans `media`, dont la forme n'est pas mesuree. */
export function readImage(media) {
  let trouvee = null;
  (function walk(v, profondeur) {
    if (trouvee || profondeur > 6 || v === null || v === undefined) return;
    if (typeof v === 'string') {
      if (/^https:\/\/[^\s"']+\.(?:jpe?g|png|webp)(?:\?[^\s"']*)?$/i.test(v)) trouvee = v;
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, profondeur + 1); return; }
    if (typeof v === 'object') for (const x of Object.values(v)) walk(x, profondeur + 1);
  }(media, 0));
  return trouvee;
}

/**
 * Une date de fin dans `purchase`, dont la forme n'est pas mesuree : une cle
 * qui dit « fin » et une valeur qui se lit comme une date. Sinon null.
 */
export function readEnd(purchase, now) {
  let fin = null;
  (function walk(v, profondeur) {
    if (profondeur > 6 || !v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      /* La cle se lit mot a mot : « discountEndDate » -> « discount end date ».
         « weekend » ou « legend » ne passent pas. */
      const mots = k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      if (typeof x === 'string' && /\bends? ?(date|time|at)?$|\bexpir/.test(mots)) {
        const t = Date.parse(x);
        if (Number.isFinite(t) && t > now && (fin === null || t < fin)) fin = t;
      } else {
        walk(x, profondeur + 1);
      }
    }
  }(purchase, 0));
  return fin;
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
      const jeu = jeux.get(base) || { titre, base, plateformes: new Set(), image: null, fin: null, ids: [] };
      jeu.plateformes.add(plateforme === 'ios' ? 'iOS' : 'Android');
      jeu.image = jeu.image || readImage(c.media);
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
    url: PAGE_URL,
    image: j.image,
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
