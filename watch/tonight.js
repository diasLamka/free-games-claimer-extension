/* « Ce soir je joue a... » (2.95.0).
 *
 * Des centaines de jeux pris gratuitement, et le soir venu, on ne sait pas
 * lequel lancer. L'extension, elle, sait ce que vous avez (Ma collection et
 * ce qu'elle a recupere), ce que Steam dit que vous n'avez jamais lance (le
 * miroir, watch/playtime.js), ce que vous avez mis de cote (« a essayer »,
 * watch/annotations.js) -- elle choisit UN jeu, pour le temps que vous avez.
 *
 * CE QUI EST MESURE (2026-09-27) :
 *
 *   - `IStoreBrowseService/GetItems` rend, sans cookie et pour cinquante jeux
 *     d'un coup, les vingt etiquettes des joueurs avec leur poids
 *     (`include_tag_count`), la note (`include_reviews`), la categorie Steam
 *     Deck (`include_platforms`) et la vignette (`include_assets`) ;
 *   - la DUREE d'un jeu n'est publiee par personne sans cle : HowLongToBeat
 *     refuse les requetes (403), SteamSpy rend zero heure pour tous les jeux.
 *     Les etiquettes des joueurs, elles, disent le format : « Short » est
 *     posee sur Portal et What Remains of Edith Finch ; les rogue-likes, les
 *     jeux de cartes, l'arcade se jouent par parties courtes ; les mondes
 *     ouverts, les RPG, les simulations de ferme sont un long cours. Verifie
 *     sur douze jeux connus (test/fixtures/steam-getitems-tonight.json).
 *
 * D'ou trois formats -- court, parties courtes, long cours -- et jamais une
 * duree inventee. Les identifiants d'etiquettes viennent de
 * `IStoreService/GetTagList`, ils sont stables.
 *
 * Module pur, sauf `refreshTonight`, qui recoit son `fetch`.
 */
import { buildRows, KINDS, rowKey } from './collection.js';
import { readAnnotation, STATUS } from './annotations.js';
import { deckAtLeast, deckFromItem, DECK } from './deck.js';
import { normaliseTitle } from './offer.js';
import { searchUrl, matchSearch } from './steam-ratings.js';
import { ITEMS_URL, steamImage } from './sources/steam.js';
import { coverFor } from './covers.js';

export const KEY_TONIGHT = 'veille:ce-soir';

/** Le temps dont on dispose ce soir. */
export const TIMES = Object.freeze({ HOUR: 'hour', EVENING: 'evening', WEEKEND: 'weekend', ANY: 'any' });
export const FORMATS = Object.freeze({ SHORT: 'short', SESSIONS: 'sessions', LONG: 'long' });

/** Les etiquettes Steam qui disent le format (IStoreService/GetTagList, 2026-09-27). */
export const TAG_SHORT = 4234;
export const TAGS_SESSIONS = Object.freeze([
  1716, // Roguelike
  3959, // Roguelite
  42804, // Action Roguelike
  454187, // Traditional Roguelike
  1091588, // Roguelike Deckbuilder
  1666, // Card Game
  32322, // Deckbuilding
  1773, // Arcade
  5154, // Score Attack
  699, // Racing
  1743, // Fighting
  7178, // Party Game
  7108, // Party
  6621, // Pinball
  1665, // Match 3
  22955, // Mini Golf
  4885, // Bullet Hell
  4255, // Shoot 'Em Up
]);
export const TAGS_LONG = Object.freeze([
  1695, // Open World
  122, // RPG
  4434, // JRPG
  4474, // CRPG
  4364, // Grand Strategy
  1670, // 4X
  1100689, // Open World Survival Craft
  1662, // Survival
  128, // Massively Multiplayer
  1754, // MMORPG
  3810, // Sandbox
  220585, // Colony Sim
  4328, // City Builder
  87918, // Farming Sim
  255534, // Automation
  10235, // Life Sim
  7332, // Base Building
]);

/** Une etiquette compte si elle pese au moins ce rapport de la plus forte. */
const FORCE = 0.3;
/** Lance plus d'une demi-heure : ce n'est plus la pile, c'est un jeu commence. */
export const LAUNCHED_HOURS = 0.5;
/** Assez d'avis pour qu'une note veuille dire quelque chose. */
export const MIN_REVIEWS = 50;

export const INFO_FRESH_MS = 60 * 24 * 3600 * 1000;
export const NONE_MS = 7 * 24 * 3600 * 1000;
export const PASS_EVERY_MS = 3600 * 1000;
export const LOT = 50;
export const LOTS_PER_RUN = 2;
export const SEARCHES_PER_RUN = 8;
/** Un choix tient la soiree : rouvrir le popup ne le change pas. */
export const PICK_KEEP_MS = 12 * 3600 * 1000;
/** Tire parmi les cinq meilleurs, pour qu'« Un autre » propose vraiment autre chose. */
export const TOP = 5;

/**
 * La forme des fiches : 2 depuis la 2.96.0, qui y ajoute la description
 * courte. Une fiche d'une forme plus ancienne est relue, sans attendre ses
 * soixante jours.
 */
export const INFO_VERSION = 2;
/** La description montree sur la carte : une phrase ou deux, pas la fiche. */
export const MAX_DESCRIPTION = 300;

/** La langue des descriptions Steam, d'apres celle de l'extension. */
const STEAM_LANGS = Object.freeze({ fr: 'french', en: 'english', de: 'german', es: 'spanish' });
export function steamLanguage(locale) {
  return STEAM_LANGS[String(locale || '').toLowerCase().split('-')[0]] || 'english';
}

/** L'en-tete d'une fiche Steam, deduit de son appid : l'image est la avant toute lecture. */
export function steamHeader(appid) {
  return /^\d+$/.test(String(appid || '')) ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg` : null;
}

/** Une description Steam en texte simple : sans balise, sans espaces doubles, coupee a un mot. */
export function cleanDescription(text) {
  const t = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= MAX_DESCRIPTION) return t || null;
  const coupe = t.slice(0, MAX_DESCRIPTION);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), MAX_DESCRIPTION - 40)).trimEnd()}…`;
}

/** L'etat stocke, avec sa forme. */
export function readTonightState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ok = (v) => v && typeof v === 'object' && !Array.isArray(v);
  return {
    at: typeof r.at === 'number' ? r.at : null,
    apps: ok(r.apps) ? r.apps : {},
    titles: ok(r.titles) ? r.titles : {},
  };
}

/* ------------------------------------------------------------- le format */

/** Le format d'un jeu d'apres ses etiquettes : 'short', 'sessions', 'long' ou null. */
export function formatFromTags(tags) {
  const list = (Array.isArray(tags) ? tags : []).filter((t) => t && Number.isFinite(Number(t.tagid)));
  if (!list.length) return null;
  // « Short » est une etiquette qu'on ne pose que si c'est vrai : ou qu'elle soit, elle compte.
  if (list.some((t) => Number(t.tagid) === TAG_SHORT)) return FORMATS.SHORT;
  const max = Math.max(...list.map((t) => Number(t.weight) || 0));
  const fortes = list.filter((t) => (Number(t.weight) || 0) >= max * FORCE);
  const poids = (ids) => Math.max(0, ...fortes.filter((t) => ids.includes(Number(t.tagid))).map((t) => Number(t.weight) || 0));
  const s = poids(TAGS_SESSIONS);
  const l = poids(TAGS_LONG);
  if (!s && !l) return null;
  // Hades est un RPG, mais d'abord un rogue-like : la plus forte l'emporte.
  return s >= l ? FORMATS.SESSIONS : FORMATS.LONG;
}

/** Ce qu'un element GetItems dit d'un jeu, ou null s'il est illisible. */
export function readItem(item) {
  if (!item || item.success !== 1 || !/^\d+$/.test(String(item.appid || item.id || ''))) return null;
  const rev = item.reviews && item.reviews.summary_filtered;
  const pct = rev && Number.isFinite(Number(rev.percent_positive)) ? Number(rev.percent_positive) : null;
  const n = rev && Number.isFinite(Number(rev.review_count)) ? Number(rev.review_count) : 0;
  return {
    v: INFO_VERSION,
    name: String(item.name || '').slice(0, 160) || null,
    description: cleanDescription(item.basic_info && item.basic_info.short_description),
    format: formatFromTags(item.tags),
    deck: deckFromItem(item),
    percent: pct !== null && pct >= 0 && pct <= 100 ? pct : null,
    reviews: n,
    image: steamImage(item.assets),
  };
}

/**
 * La requete GetItems d'un lot, sans cookie. `lang` : la langue de la
 * description (Steam rend l'anglais quand la traduction manque) ; les
 * etiquettes, elles, sont des numeros, les memes dans toutes les langues.
 */
export function tonightItemsUrl(appids, country = 'FR', lang = 'english') {
  const input = {
    ids: appids.map((appid) => ({ appid: Number(appid) })),
    context: { language: Object.values(STEAM_LANGS).includes(lang) ? lang : 'english', country_code: /^[A-Z]{2}$/.test(country) ? country : 'FR' },
    data_request: { include_basic_info: true, include_tag_count: 20, include_reviews: true, include_platforms: true, include_assets: true },
  };
  return `${ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

/* --------------------------------------------------------------- la pile */

/** Les etats qui sortent un jeu de la pile : commence, fini, abandonne, ecarte. */
const HORS_PILE = new Set([STATUS.PLAYING, STATUS.DONE, STATUS.DROPPED, STATUS.NOT_FOR_ME]);

/**
 * La pile : vos jeux (Ma collection, et ce que l'extension a recupere), moins
 * ceux que Steam dit lances, moins ceux que vous avez dit commences, finis,
 * abandonnes ou « pas pour moi ». Un jeu par titre.
 *
 * `playtime` : la table du miroir (appid -> heures, null = jamais lance), ou
 * rien si elle n'a jamais ete lue -- et alors on ne sait pas, on ne suppose pas.
 */
export function buildPile({ collection = null, library = {}, playtime = null, annotations = {}, state = null, covers = null } = {}) {
  const s = readTonightState(state);
  const pt = playtime && typeof playtime === 'object' ? playtime : null;
  const out = [];
  /* Une image pour chaque jeu, meme sans fiche Steam : celle que le registre
     a gardee de l'offre (la jaquette d'Amazon, d'Epic...), sinon celle que la
     recherche Steam a trouvee pour « Deja recupere ». */
  const images = new Map();
  for (const e of Object.values(library || {})) {
    if (e && e.title && typeof e.image === 'string' && /^https:\/\//i.test(e.image)) images.set(normaliseTitle(e.title), e.image);
  }
  for (const row of buildRows({ collection, library })) {
    if (row.kind !== KINDS.GAME || !row.title) continue;
    const key = rowKey(row);
    const etat = readAnnotation(annotations, key).status;
    if (HORS_PILE.has(etat)) continue;
    const steam = row.stores.steam || null;
    let hours;
    if (steam && pt && Object.prototype.hasOwnProperty.call(pt, steam.id)) {
      hours = pt[steam.id];
      if (typeof hours === 'number' && hours >= LAUNCHED_HOURS) continue;
    }
    const cherche = s.titles[normaliseTitle(row.title)];
    const appid = steam && /^\d+$/.test(String(steam.id)) ? String(steam.id) : (cherche && cherche.appid) || null;
    out.push({
      key,
      title: row.title,
      stores: row.stores,
      appid,
      ownedOnSteam: Boolean(steam),
      /* true : Steam dit jamais lance ; false : lance un instant ; null : on ne sait pas. */
      never: hours === undefined ? null : hours === null || hours === 0,
      toTry: etat === STATUS.TO_TRY,
      claimed: row.claimed,
      since: row.since,
      deck: row.deck || null,
      image: images.get(normaliseTitle(row.title)) || (covers ? coverFor(covers, row.title) : null) || null,
    });
  }
  return out;
}

/** L'image de la carte : la fiche Steam, l'en-tete deduit de l'appid, celle du registre, ou rien. */
export function tonightImage(c, info) {
  return (info && info.image) || steamHeader(c && c.appid) || (c && c.image) || null;
}

/* ------------------------------------------------------------- le choix */

/** Ce que le format vaut pour le temps qu'on a. null : ne convient pas. */
const PAR_TEMPS = Object.freeze({
  [TIMES.HOUR]: { [FORMATS.SESSIONS]: 3, [FORMATS.SHORT]: 1, [FORMATS.LONG]: null },
  [TIMES.EVENING]: { [FORMATS.SHORT]: 4, [FORMATS.SESSIONS]: 2, [FORMATS.LONG]: -2 },
  [TIMES.WEEKEND]: { [FORMATS.LONG]: 2, [FORMATS.SHORT]: 1, [FORMATS.SESSIONS]: 0 },
  [TIMES.ANY]: {},
});

const RAISON_FORMAT = Object.freeze({
  [FORMATS.SHORT]: 'tonightShort', [FORMATS.SESSIONS]: 'tonightSessions', [FORMATS.LONG]: 'tonightLong',
});

/**
 * Le score d'un jeu de la pile pour ce soir, et ses raisons -- ou null s'il ne
 * convient pas (pas sur Steam Deck quand on le demande, un long cours pour une
 * heure). Pur.
 */
export function scoreTonight(c, info, { time = TIMES.ANY, deckOnly = false } = {}) {
  const deck = (info && info.deck) || c.deck || null;
  if (deckOnly && !deckAtLeast(deck, DECK.PLAYABLE)) return null;
  const format = info ? info.format : null;
  const table = PAR_TEMPS[time] || PAR_TEMPS[TIMES.ANY];
  if (format && table[format] === null) return null;

  let score = 0;
  const reasons = [];
  if (c.toTry) { score += 3; reasons.push({ key: 'tonightToTry', args: [] }); }
  if (c.never === true) { score += 1; reasons.push({ key: 'tonightNever', args: [] }); }
  if (format) {
    score += table[format] || 0;
    reasons.push({ key: RAISON_FORMAT[format], args: [] });
  }
  if (info && typeof info.percent === 'number' && info.reviews >= MIN_REVIEWS) {
    score += (info.percent - 70) / 6;
    reasons.push({ key: 'tonightRating', args: [String(info.percent)] });
  }
  if (deckOnly) {
    if (deck === DECK.VERIFIED) score += 1;
    reasons.push({ key: deck === DECK.VERIFIED ? 'tonightDeckVerified' : 'tonightDeckPlayable', args: [] });
  }
  return { score, reasons };
}

/**
 * Un jeu pour ce soir. Les jeux qui conviennent, du meilleur au moins bon ; le
 * tirage se fait parmi les cinq premiers qu'on n'a pas encore montres, les
 * meilleurs plus souvent. Quand tout a ete montre, on repart du debut.
 *
 * Le hasard est INJECTE : un tirage non teste finit toujours par rendre le
 * premier element (watch/annotations.js, pickToTry).
 *
 * Rend { pick, count, wrapped } -- `pick` null quand rien ne convient.
 */
export function pickTonight(pile, { apps = {}, time = TIMES.ANY, deckOnly = false, exclude = [], random = Math.random } = {}) {
  const notes = [];
  for (const c of pile || []) {
    const info = c.appid ? apps[c.appid] || null : null;
    const s = scoreTonight(c, info && !info.none ? info : null, { time, deckOnly });
    if (s) notes.push({ ...c, info: info && !info.none ? info : null, ...s });
  }
  notes.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  if (!notes.length) return { pick: null, count: 0, wrapped: false };

  const vus = new Set(exclude || []);
  let pool = notes.filter((n) => !vus.has(n.key));
  const wrapped = !pool.length;
  if (wrapped) pool = notes;
  const top = pool.slice(0, TOP);
  const poids = top.map((_, i) => top.length - i);
  const total = poids.reduce((a, b) => a + b, 0);
  let r = Math.min(0.999999, Math.max(0, Number(random()) || 0)) * total;
  let i = 0;
  while (i < top.length - 1 && r >= poids[i]) { r -= poids[i]; i++; }
  return { pick: top[i], count: notes.length, wrapped };
}

/** Le lien du jeu : le lancer dans Steam s'il y est, sinon sa fiche. */
export function playLinks(c) {
  if (!c) return { launch: null, page: null };
  const steam = c.stores && c.stores.steam;
  const launch = steam && /^\d+$/.test(String(steam.id)) ? `steam://run/${steam.id}` : null;
  let page = null;
  for (const store of ['steam', 'gog', 'epic', 'amazon']) {
    const copy = c.stores && c.stores[store];
    if (copy && copy.url && /^https:\/\//i.test(copy.url)) { page = copy.url; break; }
  }
  if (!page && c.appid) page = `https://store.steampowered.com/app/${c.appid}/`;
  return { launch, page };
}

/** Le choix garde tient-il encore ? Meme reglages, moins de douze heures, encore dans la pile. */
export function keptPick(saved, pile, { time, deckOnly }, now) {
  if (!saved || typeof saved !== 'object' || typeof saved.at !== 'number') return null;
  if (now - saved.at >= PICK_KEEP_MS || saved.time !== time || Boolean(saved.deckOnly) !== Boolean(deckOnly)) return null;
  return (pile || []).find((c) => c.key === saved.key) || null;
}

/* ------------------------------------------------------ la lecture Steam */

async function lireJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Un passage est-il du ? */
export function tonightPassDue(raw, now) {
  const s = readTonightState(raw);
  return !s.at || now - s.at >= PASS_EVERY_MS;
}

/** Un titre cherche : relu apres soixante jours (sept s'il n'a rien donne). */
const titreARelire = (e, now) => !e || now - (e.at || 0) >= (e.none ? NONE_MS : INFO_FRESH_MS);
/** Une fiche : de meme, et tout de suite si elle est d'une forme plus ancienne. */
const ficheARelire = (e, now) => titreARelire(e, now) || (!e.none && e.v !== INFO_VERSION);

/**
 * Un passage : huit titres hors Steam cherches (titre EXACT), puis deux lots
 * de cinquante fiches GetItems. Sans cookie. Rend l'etat suivant ; ne jette
 * jamais.
 */
export async function refreshTonight({
  fetch: fetchImpl, pile, state: raw, now, country = 'FR', lang = 'english',
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
}) {
  const s = readTonightState(raw);
  const titles = { ...s.titles };
  const apps = { ...s.apps };
  let premier = true;
  const attendre = async () => { if (!premier) await pause(1200); premier = false; };

  const aChercher = (pile || []).filter((c) => !c.ownedOnSteam && titreARelire(titles[normaliseTitle(c.title)], now)).slice(0, SEARCHES_PER_RUN);
  for (const c of aChercher) {
    await attendre();
    const json = await lireJson(fetchImpl, searchUrl(c.title, country));
    if (!json) continue;
    const appid = matchSearch(json, c.title);
    titles[normaliseTitle(c.title)] = appid ? { at: now, appid } : { at: now, none: true };
  }

  const ids = [];
  const vus = new Set();
  for (const c of pile || []) {
    const appid = c.appid || (titles[normaliseTitle(c.title)] || {}).appid;
    if (!appid || vus.has(appid)) continue;
    vus.add(appid);
    if (ficheARelire(apps[appid], now)) ids.push(String(appid));
  }
  for (let i = 0; i < Math.min(ids.length, LOT * LOTS_PER_RUN); i += LOT) {
    const lot = ids.slice(i, i + LOT);
    await attendre();
    const json = await lireJson(fetchImpl, tonightItemsUrl(lot, country, lang));
    const items = json && json.response && Array.isArray(json.response.store_items) ? json.response.store_items : null;
    if (!items) continue;
    const lus = new Map(items.map((it) => [String(it && (it.appid || it.id)), it]));
    for (const id of lot) {
      const info = readItem(lus.get(id));
      apps[id] = info ? { ...info, at: now } : { at: now, none: true };
    }
  }
  return { at: now, apps, titles };
}
