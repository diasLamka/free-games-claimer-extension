/* Le modele d'Offre : identite, normalisation, rapprochement, urgence.
 *
 * C'est le vocabulaire commun de la veille. Une source de decouverte produit
 * des Offres, l'ordonnanceur les compte, le catalogue les garde, l'orchestrateur
 * les reclame. Rien d'autre dans le systeme ne doit inventer sa propre forme.
 *
 * Module pur : aucune API d'extension, aucun acces reseau, aucune horloge
 * implicite -- l'instant est toujours passe en parametre. C'est ce qui le rend
 * testable sans navigateur.
 */
import { readDeck } from './deck.js';
import { instantFromLocal } from './schedule/clock.js';

/* ------------------------------------------------------------------ magasins */

/** Identifiants internes des magasins. Le reste du code ne connait que ceux-la. */
export const STORES = Object.freeze({
  EPIC: 'epic',
  /* Les jeux mobiles offerts par Epic (2.57.0) : ils se recuperent dans
     l'application du telephone, jamais par l'extension. Un magasin a part,
     pour que la source Epic (PC) ne les balaie pas et que rien ne tente de
     les reclamer. */
  EPIC_MOBILE: 'epic-mobile',
  /* Les assets offerts par Epic sur Fab (2.108.0) : modeles 3D, plugins,
     assets Unreal et Unity. Detectes et annonces, jamais reclames -- la
     reclamation n'a pas ete observee connectee. */
  FAB: 'fab',
  GOG: 'gog',
  STEAM: 'steam',
  AMAZON: 'amazon',
  MICROSOFT: 'microsoft',
  UBISOFT: 'ubisoft',
  EA: 'ea',
  BLIZZARD: 'blizzard',
  ITCHIO: 'itchio',
  INDIEGALA: 'indiegala',
  FANATICAL: 'fanatical',
  HUMBLE: 'humble',
  LEGACY: 'legacy',
  UNKNOWN: 'unknown',
});

export const STORE_LABELS = Object.freeze({
  epic: 'Epic Games Store',
  'epic-mobile': 'Epic Games (mobile)',
  fab: 'Fab (Epic)',
  gog: 'GOG.com',
  steam: 'Steam',
  amazon: 'Amazon Games',
  microsoft: 'Microsoft Store',
  ubisoft: 'Ubisoft Connect',
  ea: 'EA app',
  blizzard: 'Battle.net',
  itchio: 'itch.io',
  indiegala: 'IndieGala',
  fanatical: 'Fanatical',
  humble: 'Humble Bundle',
  legacy: 'Legacy Games',
  unknown: 'plateforme inconnue',
});

/** Cycle de vie d'une offre dans le catalogue. */
export const STATES = Object.freeze({
  DISCOVERED: 'discovered',
  RESOLVING: 'resolving',
  CONFIRMED: 'confirmed',
  QUEUED: 'queued',
  CLAIMING: 'claiming',
  RESOLVED: 'resolved',
  EXPIRED: 'expired',
});

/* -------------------------------------------------------------- normalisation */

// Marques diacritiques isolees par une decomposition NFD. Construite depuis une
// chaine echappee plutot qu'ecrite en litteral : un intervalle de caracteres
// combinants dans une source est illisible et se corrompt au moindre passage
// d'outil.
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Ramene un titre a une forme comparable : minuscules, sans accents, sans
 * ponctuation, espaces normalises. Sert de cle de rapprochement faible quand
 * deux sources annoncent le meme jeu sans identifiant commun.
 */
export function normaliseTitle(title) {
  return String(title || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    // L'agregateur suffixe systematiquement ses titres : "Machin (Epic Games)
    // Giveaway", "Truc (IndieGala) Key Giveaway". Ce suffixe n'appartient pas
    // au jeu et empeche tout rapprochement avec la source native.
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\b(key\s+)?giveaway\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Magasin annonce entre parentheses dans le titre de l'agregateur. Plus fiable
 * que le champ platforms, qui melange support et boutique : "PC, DRM-Free"
 * recouvre aussi bien itch.io qu'IndieGala.
 */
const TITLE_SUFFIXES = [
  [/\bepic\s*games?\b/i, STORES.EPIC],
  [/\bgog\b/i, STORES.GOG],
  [/\bsteam\b/i, STORES.STEAM],
  [/\bitch\.?\s*io\b/i, STORES.ITCHIO],
  [/\bindie\s*gala\b/i, STORES.INDIEGALA],
  [/\bfanatical\b/i, STORES.FANATICAL],
  [/\bhumble\b/i, STORES.HUMBLE],
  [/\bprime\s*gaming\b|\bamazon\b|\bluna\b/i, STORES.AMAZON],
  [/\bmicrosoft\b|\bxbox\b|\bwindows\s*store\b/i, STORES.MICROSOFT],
  [/\bubisoft\b|\buplay\b/i, STORES.UBISOFT],
  [/\borigin\b|\bea\s*(app|play)\b/i, STORES.EA],
  [/\bbattle\.?net\b|\bblizzard\b/i, STORES.BLIZZARD],
  [/\blegacy\s*games?\b/i, STORES.LEGACY],
];

export function storeFromTitle(title) {
  const parens = String(title || '').match(/\(([^)]*)\)/g) || [];
  for (const block of parens) {
    for (const [reason, store] of TITLE_SUFFIXES) {
      if (reason.test(block)) return store;
    }
  }
  return null;
}

/**
 * Le titre tel qu'on le MONTRE : sans le suffixe de l'agregateur.
 *
 * « Deadshot (Steam) Giveaway », « Dwarven Realms (Steam) Key Giveaway » : le
 * magasin est deja dit par l'etiquette de la carte, et « Giveaway » par le fait
 * meme d'etre dans la liste. On ne retire que ce qui est sur -- une parenthese
 * qui NOMME un magasin, et le mot final -- et une parenthese comme
 * « (Remastered) » reste a sa place. La donnee stockee, elle, ne change pas.
 */
export function displayTitle(title) {
  const brut = String(title || '');
  const propre = brut
    .replace(/\s*\(([^)]*)\)/g, (bloc, dedans) => (
      TITLE_SUFFIXES.some(([motif]) => motif.test(dedans)) ? '' : bloc))
    .replace(/\s+(key\s+)?giveaway\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return propre || brut.trim();
}

/**
 * Repli sur le champ platforms. Volontairement plus prudent : on n'y cherche
 * que les boutiques nommees explicitement. "PC" et "DRM-Free" ne designent
 * aucune boutique et ne doivent rien decider.
 */
export function storeFromPlatforms(platforms) {
  const parts = String(platforms || '').split(',').map((p) => p.trim());
  for (const p of parts) {
    if (!p) continue;
    for (const [reason, store] of TITLE_SUFFIXES) {
      if (reason.test(p)) return store;
    }
  }
  return null;
}

const STORE_HOSTS = [
  [/(^|\.)epicgames\.com$/i, STORES.EPIC],
  [/(^|\.)fab\.com$/i, STORES.FAB],
  [/(^|\.)gog\.com$/i, STORES.GOG],
  [/(^|\.)steampowered\.com$|(^|\.)steamcommunity\.com$/i, STORES.STEAM],
  [/(^|\.)itch\.io$/i, STORES.ITCHIO],
  [/(^|\.)indiegala\.com$/i, STORES.INDIEGALA],
  [/(^|\.)fanatical\.com$/i, STORES.FANATICAL],
  [/(^|\.)humblebundle\.com$/i, STORES.HUMBLE],
  [/(^|\.)amazon\.[a-z.]+$/i, STORES.AMAZON],
  [/(^|\.)microsoft\.com$|(^|\.)xbox\.com$/i, STORES.MICROSOFT],
  [/(^|\.)ubisoft\.com$|(^|\.)ubi\.com$/i, STORES.UBISOFT],
  [/(^|\.)ea\.com$|(^|\.)origin\.com$/i, STORES.EA],
  [/(^|\.)battle\.net$|(^|\.)blizzard\.com$/i, STORES.BLIZZARD],
];

export function storeFromUrl(url) {
  let host;
  try {
    host = new URL(String(url)).hostname;
  } catch {
    return null;
  }
  for (const [reason, store] of STORE_HOSTS) {
    if (reason.test(host)) return store;
  }
  return null;
}

/**
 * Routage a trois niveaux. L'URL resolue est la seule verite, mais elle n'est
 * connue qu'apres resolution : avant, on se contente du titre puis du champ
 * platforms.
 */
export function detectStore({ title, platforms, url } = {}) {
  return storeFromUrl(url)
    || storeFromTitle(title)
    || storeFromPlatforms(platforms)
    || STORES.UNKNOWN;
}

/* ------------------------------------------------------------ provenance */

/**
 * Les sources qui lisent le catalogue du magasin LUI-MEME : le prix qu'elles
 * rendent est celui du magasin, pas l'annonce d'un tiers.
 */
export const FIRST_PARTY_SOURCES = Object.freeze(['epic-api', 'gog', 'steam', 'epic-mobile', 'fab']);

/**
 * Qui a donne la valeur de cette offre : 'store' (le magasin), 'aggregator'
 * (un site tiers, en dollars et sans garantie) ou null (pas de valeur, ou pas
 * de source). La provenance du CHAMP (`origin.worth`, voir merge) prime sur la
 * source de l'offre : une offre decouverte par l'agregateur puis lue par Epic
 * porte le prix d'Epic.
 */
export function worthSource(offer) {
  if (!offer || !offer.worth) return null;
  const origin = (offer.origin && offer.origin.worth) || offer.source || null;
  if (!origin) return null;
  return FIRST_PARTY_SOURCES.includes(origin) ? 'store' : 'aggregator';
}

/* ------------------------------------------------------------------- dates */

/**
 * Lit une date et rend un nombre de millisecondes, ou null si la valeur n'est
 * pas exploitable -- l'agregateur ecrit litteralement "N/A" quand il ne sait
 * pas.
 *
 * Une date SANS indication de fuseau ("2026-08-26 21:23:06") ne peut pas etre
 * lue sans savoir de quel fuseau elle vient. `fuseauNaif` doit donc etre
 * fourni par la source, qui seule le sait. Sans lui, la valeur est refusee.
 *
 * Ce refus est deliberement brutal, parce que la supposition douce a deja
 * coute : ces dates etaient lues comme de l'UTC, alors qu'elles sont en heure
 * de New York. Recoupement du 2026-08-27 entre nos deux captures reelles :
 * l'API Epic ouvre Cardpocalypse a 2026-08-20T15:00:00Z, l'agregateur le
 * publie a "2026-08-20 11:02:34". Lu en UTC, cela place la publication quatre
 * heures AVANT l'ouverture de l'offre -- impossible. Lu en heure de New York,
 * deux minutes et demie apres le drop. Un decalage de quatre heures, dans le
 * sens qui fait expirer les offres trop tot, et aucune erreur levee.
 *
 * Ne jamais lire une date naive avec new Date() non plus : cela l'interprete
 * dans le fuseau de la machine, ce qui donne un resultat different selon
 * l'utilisateur.
 */
export function readDate(worth, naiveZone = null) {
  if (worth === null || worth === undefined) return null;
  if (typeof worth === 'number') return Number.isFinite(worth) ? worth : null;

  const raw = String(worth).trim();
  if (!raw || /^n\/?a$/i.test(raw)) return null;

  const naive = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naive) {
    if (!naiveZone) return null;
    const [, a, mo, j, h, mi, s] = naive;
    const { instant } = instantFromLocal(naiveZone, {
      year: Number(a),
      month: Number(mo),
      day: Number(j),
      hour: Number(h),
      minute: Number(mi),
      second: Number(s || 0),
    });
    return instant;
  }

  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/* ------------------------------------------------------------------ identite */

/**
 * Cle forte : le magasin plus son identifiant propre. Deux offres qui la
 * partagent sont le meme jeu, sans discussion possible.
 */
export function strongKey(offer) {
  if (!offer || !offer.store || !offer.storeId) return null;
  return `${offer.store}:${offer.storeId}`;
}

/**
 * Cle faible : le magasin plus le titre normalise. Sert avant resolution,
 * quand l'agregateur n'a pas encore livre d'identifiant.
 */
export function weakKey(offer) {
  if (!offer) return null;
  const t = normaliseTitle(offer.title);
  if (!t) return null;
  return `${offer.store || STORES.UNKNOWN}:titre:${t}`;
}

/** Toutes les cles sous lesquelles une offre peut etre reconnue. */
export function matchKeys(offer) {
  return [strongKey(offer), weakKey(offer)].filter(Boolean);
}

/* ------------------------------------------------------------- construction */

/**
 * Construit une Offre normalisee. Une source de decouverte ne rend que ca.
 *
 * `source`      identifiant de la source de decouverte (gamerpower, epic-api)
 * `idSource`    identifiant de l'offre chez cette source
 * `idMagasin`   identifiant chez le magasin (slug Epic, appid Steam), si connu
 * `url`         URL du magasin, si connue ; sinon `urlResolution`
 * `urlResolution` URL a ouvrir pour decouvrir l'URL du magasin
 */
/* Ces URL viennent d'API tierces et finissent dans tabs.create, windows.create
   et un <img> du popup : seul http(s) passe. Un « javascript: » ou un
   « chrome: » publie par erreur -- ou expres -- n'a rien a y faire.

   Exportee, et pas seulement par commodite : c'est LE point de passage des
   URL d'origine distante. Deux autres endroits en avaient besoin et s'en
   passaient -- l'ouverture d'onglet demandee par le moteur (background.js) et
   les entrees de collection (watch/collection.js). Une copie de plus aurait
   fini par diverger de celle-ci ; le champ `--rail` de la scrollbar avait
   deja montre comment. */
export function webUrl(value) {
  if (!value) return null;
  try {
    return /^https?:$/.test(new URL(String(value)).protocol) ? String(value) : null;
  } catch {
    return null;
  }
}

export function makeOffer(raw = {}) {
  const store = raw.store || detectStore(raw);
  // `fuseauDatesNaives` est fourni par la source : elle seule sait dans quel
  // fuseau son API ecrit ses horodatages sans suffixe. Voir lireDate.
  const zone = raw.naiveDateZone || null;
  const start = readDate(raw.start, zone);
  const end = readDate(raw.end, zone);

  return {
    source: raw.source || null,
    sourceId: raw.sourceId === undefined ? null : String(raw.sourceId),
    store,
    storeId: raw.storeId ? String(raw.storeId) : null,
    /* Le paquet Steam que l'offre donne (source Steam seulement). C'est lui
       que la recuperation Steam cherche sur la page, puis dans la
       bibliotheque. null partout ailleurs. */
    packageId: raw.packageId ? String(raw.packageId) : null,
    /* Le jeu de base d'un DLC Steam (2.80.1) : Steam n'ajoute un DLC gratuit
       qu'a un compte qui possede ce jeu-la. null partout ailleurs. */
    parentAppid: /^\d+$/.test(String(raw.parentAppid || '')) ? String(raw.parentAppid) : null,
    /* Steam Deck : 'verified' | 'playable' | 'unsupported' | null (source
       Steam seulement, voir watch/deck.js). null veut dire « on ne sait pas ». */
    deck: readDeck(raw.deck),
    title: String(raw.title || '').trim(),
    normalisedTitle: normaliseTitle(raw.title),
    url: webUrl(raw.url),
    resolveUrl: webUrl(raw.resolveUrl),
    start,
    end,
    worth: raw.worth || null,
    /* L'editeur, quand la source le nomme (Epic, 2.94.0) : voir watch/odds.js. */
    publisher: raw.publisher ? String(raw.publisher).slice(0, 120) : null,
    // Vignette du jeu, telle que la source la publie. Affichee dans le popup ;
    // c'est ce qui rend une liste de titres reconnaissable d'un coup d'oeil.
    image: webUrl(raw.image),
    // true / false / null. null signifie « on ne sait pas », ce qui n'est pas
    // la meme chose que false : afficher « pas encore recupere » sur un jeu
    // deja acquis serait pire que de ne rien afficher.
    alreadyOwned: raw.alreadyOwned === undefined ? null : raw.alreadyOwned,
    /**
     * Y a-t-il quelque chose a GARDER ? true / false / null.
     *
     * false : le titre est gratuit de toute facon -- free-to-play, cosmetique
     *         permanent. Il n'y a rien a reclamer, et l'ouvrir consomme un
     *         onglet et une requete sur un vrai compte pour rien.
     * null  : la source ne le dit pas. On retombe alors sur la valeur : une
     *         offre qui annonce un prix etait payante.
     *
     * Comme alreadyOwned, les trois etats sont distincts a dessein. Traiter
     * « on ne sait pas » comme « non » ferait rater de vrais jeux offerts.
     */
    keepable: raw.keepable === undefined ? null : raw.keepable,
    // Conserves tels quels : le champ platforms de l'agregateur est du texte
    // libre qui sert au routage de repli et a l'affichage, et la categorie
    // distingue un jeu d'un DLC ou d'un butin.
    platforms: raw.platforms || null,
    category: raw.category || null,
    state: raw.state || STATES.DISCOVERED,
    verdict: raw.verdict || null,
    seenAt: raw.seenAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    // Horodatage de la notification. Distinct de vuLe : une offre peut etre
    // connue du catalogue sans avoir ete annoncee, et c'est ce champ -- pas le
    // fait d'apparaitre dans "nouvelles" -- qui decide s'il faut notifier. Il
    // survit ainsi a une mort du service worker entre deux ecritures.
    notifiedAt: raw.notifiedAt ?? null,
    attempts: raw.attempts || 0,
  };
}

/* ---------------------------------------------------------------- catalogue */

/**
 * Cherche dans un catalogue l'entree qui designe le meme jeu. La cle forte
 * l'emporte : deux titres identiques sur des magasins differents sont deux
 * offres distinctes, mais deux entrees partageant un identifiant de magasin
 * sont la meme, quel que soit le titre affiche.
 */
export function matchUp(catalog, offer) {
  const strong = strongKey(offer);
  const weak = weakKey(offer);
  const entryPairs = Object.values(catalog || {});

  if (strong) {
    const byStrong = entryPairs.find((e) => strongKey(e) === strong);
    if (byStrong) return byStrong;
  }
  if (weak) {
    const byWeak = entryPairs.find((e) => weakKey(e) === weak);
    if (byWeak) return byWeak;
  }
  return null;
}

/**
 * Fiabilite par champ : pour chaque champ que deux sources peuvent renseigner
 * differemment, l'ordre des sources de la plus fiable a la moins fiable.
 *
 * L'API Epic donne l'instant exact d'ouverture et de fermeture, en UTC
 * explicite, et l'URL du magasin. L'agregateur donne une date de fin arrondie
 * a 23:59 et ne donne jamais l'URL du magasin. Sans cette table, la premiere
 * source a decouvrir une offre figeait sa date de fin pour toujours, y compris
 * quand la source de reference passait ensuite avec la bonne valeur.
 */
export const FIELD_TRUST = Object.freeze({
  start: ['epic-api', 'gamerpower'],
  end: ['epic-api', 'gamerpower'],
  url: ['epic-api', 'gamerpower'],
  storeId: ['epic-api', 'gamerpower'],
  title: ['epic-api', 'gamerpower'],
  // La jaquette du magasin vaut mieux que la vignette remontee par un tiers.
  image: ['epic-api', 'gamerpower'],
  /*
   * Le prix du magasin bat celui de l'agregateur, et ce n'est pas qu'une
   * question de fraicheur : c'est une question de DEVISE.
   *
   * Epic publie le prix DU COMPTE -- « 23,99 € » sur un compte francais, avec
   * son currencyCode a cote. L'agregateur, lui, ne connait que le dollar :
   * dans la capture reelle test/fixtures/gamerpower-giveaways.json, les vingt
   * montants renseignes sont en « $ », et la structure ne porte aucun code de
   * devise.
   *
   * Sans cette ligne, `worth` tombait dans la regle generale « le dernier non
   * vide gagne » : pour un jeu Epic vu par les deux sources, le montant
   * affiche dependait de l'ordre de passage des sources dans le cycle. Le
   * meme jeu valait « 23,99 € » ou « $19.99 » selon le jour.
   */
  worth: ['epic-api', 'gamerpower'],
});

const CONTESTED_FIELDS = Object.keys(FIELD_TRUST);

function rank(champ, source) {
  const order = FIELD_TRUST[champ] || [];
  const i = order.indexOf(source);
  return i === -1 ? Number.POSITIVE_INFINITY : i;
}

const filled = (v) => v !== null && v !== undefined && v !== '';

/** Provenance initiale : chaque champ renseigne vient de la source de l'offre. */
export function initialOrigin(offer) {
  const p = {};
  for (const champ of CONTESTED_FIELDS) {
    if (filled(offer[champ])) p[champ] = offer.source || null;
  }
  return p;
}

/**
 * Fusionne une offre fraichement decouverte dans celle deja connue.
 *
 * Deux regles :
 *   - on n'efface jamais une information par une absence : une source qui ne
 *     connait pas la date de fin ne doit pas effacer celle qu'une autre a
 *     fournie ;
 *   - quand les deux renseignent le meme champ, la source la plus fiable pour
 *     CE champ l'emporte, quel que soit l'ordre de decouverte.
 *
 * La seconde regle rend la fusion commutative : decouvrir par l'agregateur
 * puis par Epic, ou l'inverse, donne le meme resultat. C'est teste.
 */
export function merge(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const keep = (a, b) => (filled(b) ? b : a);

  const existingOrigin = existing.origin || initialOrigin(existing);
  const incomingOrigin = incoming.origin || initialOrigin(incoming);

  const merged = {
    ...existing,
    store: existing.store === STORES.UNKNOWN ? incoming.store : existing.store,
    resolveUrl: keep(existing.resolveUrl, incoming.resolveUrl),
    // `worth` n'est plus ici : il est desormais arbitre par FIELD_TRUST, dans
    // la boucle ci-dessous. L'y laisser aussi ne changerait rien au resultat,
    // mais ferait croire a deux regles concurrentes.
    platforms: keep(existing.platforms, incoming.platforms),
    category: keep(existing.category, incoming.category),
    // Une seule source le fournit : l'agregateur ne doit pas l'effacer.
    packageId: keep(existing.packageId, incoming.packageId),
    parentAppid: keep(existing.parentAppid, incoming.parentAppid),
    // Meme regle pour le Deck : seul Steam le dit, un null ne l'efface pas.
    deck: keep(existing.deck, incoming.deck),
    updatedAt: incoming.updatedAt ?? existing.updatedAt,
    origin: { ...existingOrigin },
  };

  for (const champ of CONTESTED_FIELDS) {
    const aA = filled(existing[champ]);
    const aB = filled(incoming[champ]);

    if (!aB) continue;                    // rien de neuf : on garde
    if (!aA) {                            // rien d'ancien : on prend
      merged[champ] = incoming[champ];
      merged.origin[champ] = incomingOrigin[champ] ?? incoming.source ?? null;
      continue;
    }

    // Les deux renseignent : la source la plus fiable pour ce champ gagne.
    const originA = existingOrigin[champ] ?? existing.source;
    const originB = incomingOrigin[champ] ?? incoming.source;
    const rankA = rank(champ, originA);
    const rankB = rank(champ, originB);

    /*
     * A egalite, l'existante reste -- SAUF si c'est la meme source qui repasse.
     *
     * La stabilite a egalite existe pour rendre la fusion commutative entre
     * deux sources DIFFERENTES : decouvrir par l'agregateur puis par Epic, ou
     * l'inverse, doit donner le meme resultat. Deux lectures de la MEME source
     * ne posent pas cette question : la seconde est simplement plus recente.
     *
     * Sans cette nuance, Epic ne pouvait pas corriger sa propre date de fin.
     * Consequence concrete : un jeu remis en promotion gardait la date de sa
     * promotion precedente, donc restait expire pour toujours.
     */
    const sameSource = originA != null && originA === originB;
    if (rankB < rankA || (rankB === rankA && sameSource)) {
      merged[champ] = incoming[champ];
      merged.origin[champ] = incomingOrigin[champ] ?? incoming.source ?? null;
    }
  }

  // Le titre normalise doit rester coherent avec le titre retenu.
  merged.normalisedTitle = normaliseTitle(merged.title);
  return merged;
}

/* -------------------------------------------------------------- urgence */

/** Une offre est expiree si sa date de fin est passee. Fin inconnue : jamais. */
export function isExpired(offer, now) {
  // Booleen strict : sans le Boolean(), une offre absente rendrait null, et un
  // appelant qui compare a false se ferait avoir en silence.
  return Boolean(offer && offer.end !== null && offer.end !== undefined && offer.end <= now);
}

/**
 * Cle de tri de la file de reclamation, la plus petite en premier.
 *
 * Une fin inconnue passe DEVANT, pas derriere : l'agregateur laisse 8 offres
 * sur 20 sans date de fin, et lire cette absence comme "pas urgent" serait le
 * moyen le plus sur de les perdre.
 */
export function urgency(offer, now) {
  if (!offer) return Number.POSITIVE_INFINITY;
  if (offer.end === null || offer.end === undefined) return -1;
  return Math.max(0, offer.end - now);
}

/** Trie une liste d'offres de la plus urgente a la moins urgente. */
export function byUrgency(offers, now) {
  return [...offers].sort((a, b) => {
    /* Ce que l'utilisateur a DESIGNE passe devant tout le reste. C'est le seul
       endroit ou son choix explicite bat le calcul -- et c'est normal : il sait
       des choses sur ce jeu que l'urgence ne dira jamais. */
    const pa = a.priority === true ? 0 : 1;
    const pb = b.priority === true ? 0 : 1;
    if (pa !== pb) return pa - pb;

    /* Puis ce qu'il ATTENDAIT, avant meme de l'avoir vu passer. Le drapeau est
       derive de la liste de souhaits a chaque lecture, jamais persiste : la
       liste change, et une offre marquee une fois pour toutes resterait
       prioritaire apres le retrait du souhait. */
    const wa = a.wished === true ? 0 : 1;
    const wb = b.wished === true ? 0 : 1;
    if (wa !== wb) return wa - wb;

    /* Puis ce qu'il a DEJA RATE (2.98.0) : la deuxieme chance d'un jeu passe
       devant le tout-venant, derriere ce qu'il attendait. Derive a la lecture,
       comme `wished`. */
    const sa = a.secondChance ? 0 : 1;
    const sb = b.secondChance ? 0 : 1;
    if (sa !== sb) return sa - sb;

    const ua = urgency(a, now);
    const ub = urgency(b, now);
    if (ua !== ub) return ua - ub;
    // A urgence egale, la plus recemment publiee d'abord : c'est celle dont la
    // fenetre a le plus de chances d'etre courte.
    return (b.start ?? 0) - (a.start ?? 0);
  });
}
