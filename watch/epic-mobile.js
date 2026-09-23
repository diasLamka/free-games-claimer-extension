/* Les jeux mobiles gratuits d'Epic : ce que la mesure V8 doit trancher (2.56.0).
 *
 * Depuis que l'Epic Games Store existe sur Android et iOS, Epic offre aussi
 * des jeux MOBILES chaque semaine. L'extension ne les voit pas, et personne
 * ne sait encore ou Epic les expose :
 *
 *   1. dans `freeGamesPromotions`, l'API que l'extension lit DEJA -- auquel
 *      cas une categorie, une etiquette ou un attribut les distingue ;
 *   2. dans la meme API, filtree par plateforme (`&platform=android|ios`) ;
 *   3. dans l'API de decouverte de l'application mobile
 *      (`egs-platform-service`), sur un hote que le manifeste couvre deja
 *      (`*.epicgames.com`) ;
 *   4. seulement dans la page des jeux gratuits.
 *
 * Regle du depot : une hypothese se mesure avant de s'ecrire. Ce module ne
 * decide rien ; il resume ce que chaque reponse montre, pour que le rapport
 * dise ou lire les jeux mobiles -- et qu'on ecrive la source du premier coup.
 *
 * Tout ce qui est lu est PUBLIC (des offres de magasin) et lu sans cookies :
 * le rapport peut recopier des titres et des categories sans rien dire de
 * l'utilisateur.
 *
 * Module PUR.
 */
import { describeShape } from './collection.js';
import { promoActiveNow } from './sources/epic.js';
import { findEnd, findImage } from './sources/epic-mobile.js';

/** Les mots qui trahissent une offre mobile. */
export const MOBILE_WORDS = /\b(mobile|android|ios|iphone|ipad|google ?play|app ?store)\b/i;

/** Les mots qui trahissent une gratuite, dans une reponse qu'on ne connait pas. */
const FREE_WORDS = /\b(free|gratuit|gratis|kostenlos)\b|free ?games|is ?free|discount ?price/i;

const court = (v, n = 80) => String(v).replace(/\s+/g, ' ').slice(0, n);

/**
 * Ou une reponse parle de mobile : les chemins des cles et des valeurs qui
 * contiennent un mot mobile, avec la valeur (courte).
 */
export function findHints(value, { words = MOBILE_WORDS, limit = 40 } = {}) {
  const out = [];
  function walk(v, chemin, profondeur) {
    if (out.length >= limit || profondeur > 14) return;
    if (typeof v === 'string') {
      if (words.test(v)) out.push({ path: chemin, value: court(v) });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${chemin}[${i}]`, profondeur + 1));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const ici = chemin ? `${chemin}.${k}` : k;
        /* Une cle en camelCase -- `mobileOnly`, `isIOS` -- se lit mot a mot. */
        if (words.test(k.replace(/([a-z])([A-Z])/g, '$1 $2')) && out.length < limit) out.push({ path: ici, value: typeof x === 'object' ? describeShape(x, { depth: 1 }) : court(x) });
        walk(x, ici, profondeur + 1);
      }
    }
  }
  walk(value, '', 0);
  return out;
}

/** Les elements d'une reponse freeGamesPromotions, ou null si la forme a change. */
export function promoElements(json) {
  const els = json && json.data && json.data.Catalog && json.data.Catalog.searchStore
    && json.data.Catalog.searchStore.elements;
  return Array.isArray(els) ? els : null;
}

/**
 * Chaque element, resume : de quoi dire, en le relisant, lequel est mobile et
 * par quel champ on le reconnaitrait.
 */
export function summariseElements(elements, now) {
  return (elements || []).map((el) => {
    const indices = findHints(el, { limit: 8 });
    return {
      title: court(el.title || '?', 60),
      offerType: el.offerType || null,
      categories: (el.categories || []).map((c) => c && c.path).filter(Boolean),
      tags: (el.tags || []).length,
      attributes: (el.customAttributes || []).map((a) => a && a.key).filter(Boolean),
      freeNow: promoActiveNow(el, now),
      upcoming: !!(el.promotions && el.promotions.upcomingPromotionalOffers
        && el.promotions.upcomingPromotionalOffers.length),
      mobile: indices,
    };
  });
}

/** Deux listes de titres : ce que l'une a et l'autre non. */
export function compareTitles(a, b) {
  const x = new Set(a);
  const y = new Set(b);
  return {
    onlyFirst: [...x].filter((t) => !y.has(t)),
    onlySecond: [...y].filter((t) => !x.has(t)),
    same: [...x].filter((t) => y.has(t)).length,
  };
}

/**
 * Une reponse inconnue (l'API de decouverte) : sa forme, les objets qui ont
 * un titre -- des modules, des offres --, et ou elle parle de gratuite.
 */
export function summariseUnknown(json, { limit = 25 } = {}) {
  const titres = [];
  function walk(v, chemin, profondeur) {
    if (titres.length >= limit || profondeur > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${chemin}[${i}]`, profondeur + 1)); return; }
    const titre = typeof v.title === 'string' ? v.title : (typeof v.name === 'string' ? v.name : null);
    if (titre) titres.push({ path: chemin || '(racine)', title: court(titre, 60), keys: Object.keys(v).slice(0, 14) });
    for (const [k, x] of Object.entries(v)) walk(x, chemin ? `${chemin}.${k}` : k, profondeur + 1);
  }
  walk(json, '', 0);
  return {
    shape: describeShape(json, { depth: 5, maxKeys: 20 }),
    titled: titres,
    free: findHints(json, { words: FREE_WORDS, limit: 20 }),
    mobile: findHints(json, { limit: 20 }),
  };
}

/**
 * La rubrique des jeux offerts, recopiee pour le rapport (2.57.0, revu 2.59.0).
 *
 * La source lit deja `title`, `mapping.slug` et `systemSpecs.platform` --
 * mesures. Restent `purchase` (la date de fin) et `media` (la vignette), dont
 * la forme n'est pas connue.
 *
 * La 2.57.0 recopiait la premiere offre ENTIERE, coupee a 6000 caracteres :
 * `ageRating` et `media` passent avant `purchase` dans l'objet, et la coupe
 * pouvait tomber avant lui -- le champ cherche. Chacun a desormais sa ligne,
 * avec sa forme complete (les cles, sans les valeurs) et ses valeurs bornees.
 * Ils sont pris sur le premier jeu que la lecture MANQUE, s'il y en a un :
 * c'est lui qui dira quoi corriger. Sinon sur le premier.
 *
 * Et pour chaque jeu de la rubrique, ce que l'extension en comprend : la fin
 * et la vignette qu'elle retient, avec le chemin ou elle les a prises. Le
 * rapport dit ainsi, du premier coup, si la lecture est juste.
 *
 * Donnees publiques (des offres de magasin), lues sans cookies.
 */
export function freeTopicDump(json, now = Date.now()) {
  const rubriques = json && Array.isArray(json.data) ? json.data : [];
  return rubriques
    .filter((r) => r && typeof r.topicId === 'string' && /free-game$/.test(r.topicId))
    .map((r) => {
      const offres = Array.isArray(r.offers) ? r.offers : [];
      const contenu = (o) => (o && o.content) || {};
      const manque = offres.find((o) => !findEnd(contenu(o).purchase, now) || !findImage(contenu(o).media));
      const c = offres.length ? contenu(manque || offres[0]) : null;
      const brut = (v, n) => (v === undefined ? null : JSON.stringify(v).slice(0, n));
      return {
        topicId: r.topicId,
        title: typeof r.title === 'string' ? court(r.title, 80) : null,
        type: r.type || null,
        size: r.size || null,
        link: r.link || null,
        offers: offres.length,
        sampleTitle: c && typeof c.title === 'string' ? court(c.title, 60) : null,
        contentKeys: c ? Object.keys(c) : [],
        purchaseShape: c ? describeShape(c.purchase, { depth: 6, maxKeys: 30 }) : null,
        purchase: c ? brut(c.purchase, 3000) : null,
        mediaShape: c ? describeShape(c.media, { depth: 6, maxKeys: 30 }) : null,
        media: c ? brut(c.media, 3000) : null,
        read: offres.slice(0, 12).map((o) => {
          const cc = (o && o.content) || {};
          const fin = findEnd(cc.purchase, now);
          const image = findImage(cc.media);
          return {
            title: court(cc.title || '?', 60),
            end: fin ? new Date(fin.at).toISOString() : null,
            endPath: fin ? fin.path : null,
            image: image ? image.url : null,
            imagePath: image ? image.path : null,
          };
        }),
      };
    });
}

/** Ce que la source comprend des rubriques lues : combien de fins, combien de vignettes. */
export function readTally(discover) {
  const lus = (discover || []).flatMap((d) => (d.freeTopic || []).flatMap((f) => f.read || []));
  return {
    games: lus.length,
    ends: lus.filter((x) => x.end).length,
    images: lus.filter((x) => x.image).length,
  };
}

/**
 * Le verdict de la mesure, en clair : ou lire les jeux mobiles, ou pourquoi on
 * ne sait toujours pas. `r` rassemble les lectures (voir pages/diagnostics.js).
 */
export function mobileVerdict(r) {
  /* La source existe depuis la 2.57.0 : si la rubrique a ete lue, le verdict
     dit ce qu'elle en comprend -- c'est la seule question encore ouverte. */
  const lu = readTally(r.discover);
  if (lu.games) {
    const complet = lu.ends === lu.games && lu.images === lu.games;
    return {
      level: complet ? 'ok' : 'warn',
      title: complet ? 'Les jeux mobiles sont lus, date de fin et vignette comprises' : 'Les jeux mobiles sont lus, pas en entier',
      detail: `${lu.games} jeu(x) dans la rubrique des jeux offerts : date de fin lue pour ${lu.ends}, vignette pour ${lu.images}.`
        + (complet ? '' : ' Le rapport recopie purchase et media, forme et valeurs : de quoi corriger la lecture du premier coup.'),
    };
  }
  const promo = r.promo || {};
  const promoLue = promo.ok && Array.isArray(promo.elements);
  const mobiles = promoLue ? promo.elements.filter((e) => e.mobile.length) : [];
  if (mobiles.length) {
    return {
      level: 'ok',
      title: 'Epic les met dans l\'API deja lue',
      detail: `${mobiles.length} offre(s) de freeGamesPromotions parlent de mobile (${mobiles.map((e) => e.title).join(', ')}). `
        + 'Le rapport dit par quel champ : la source Epic peut les reconnaitre sans une requete de plus.',
    };
  }
  const variantes = (r.platforms || []).filter((p) => p.ok && p.diff && p.diff.onlySecond.length);
  if (variantes.length) {
    return {
      level: 'ok',
      title: 'Le filtre de plateforme change la reponse',
      detail: variantes.map((v) => `platform=${v.platform} : ${v.diff.onlySecond.join(', ')}`).join(' ; ')
        + '. Une requete par plateforme suffirait.',
    };
  }
  const decouverte = (r.discover || []).filter((d) => d.ok && d.status === 200 && d.summary
    && (d.summary.free.length || d.summary.titled.length));
  if (decouverte.length) {
    return {
      level: 'warn',
      title: 'L\'API de decouverte mobile repond',
      detail: 'freeGamesPromotions ne distingue rien, mais egs-platform-service rend des offres ('
        + decouverte.map((d) => d.platform).join(', ') + '). Le rapport montre sa forme : c\'est elle qu\'il faudra lire.',
    };
  }
  if (!promoLue && !(r.discover || []).some((d) => d.ok)) {
    return {
      level: 'ko',
      title: 'Rien n\'a pu etre lu',
      detail: 'Ni l\'API des jeux gratuits ni celle de decouverte n\'ont repondu. C\'est un probleme de reseau '
        + 'ou d\'extension a moitie rechargee, pas un resultat : a relancer.',
    };
  }
  const page = r.page || {};
  const pageMobile = page.ok && page.matchesRaw && page.matchesRaw.motMobile;
  return {
    level: 'warn',
    title: 'Aucune API ne les distingue',
    detail: (pageMobile
      ? 'Seule la page des jeux gratuits parle de mobile : les echantillons du rapport disent dans quel bloc. '
      : 'Ni les API ni la page ne parlent de mobile cette semaine. ')
      + 'A relancer un jeudi soir, quand un jeu mobile est offert, pour trancher.',
  };
}
