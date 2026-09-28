/* « Vos gouts » (2.99.0).
 *
 * Trois cents jeux offerts par an, et l'oeil ne s'arrete que sur ceux qu'on
 * connait. L'extension sait pourtant ce que vous aimez : ce que vous avez
 * beaucoup joue (le miroir Steam, watch/playtime.js), ce que vous avez fini,
 * ce que vous avez abandonne ou ecarte (watch/annotations.js). Elle en tire un
 * PROFIL -- les etiquettes des joueurs qui reviennent dans vos jeux -- et
 * l'oppose a chaque offre : « Pour vous : Roguelike, Action ».
 *
 * CE QUI EST MESURE (2026-09-28) :
 *
 *   - `IStoreBrowseService/GetItems` avec `include_tag_count` rend les vingt
 *     etiquettes d'un jeu et leur poids, sans cookie, cinquante jeux d'un
 *     coup -- la meme requete que « Ce soir je joue a... » ;
 *   - `IStoreService/GetTagList` rend le NOM de chaque etiquette dans la
 *     langue demandee, sans cookie ni cle : 446 etiquettes, ~20 Ko ;
 *   - les etiquettes les plus larges (« Singleplayer », « Indie », « Action »,
 *     « Great Soundtrack »...) sont sur presque tout : elles pesent 0,4 fois,
 *     sinon toutes les offres se ressembleraient.
 *
 * LE CALCUL, en clair : un jeu est un vecteur d'etiquettes (poids / poids max,
 * dix etiquettes). Le profil est la somme de vos jeux, chacun compte selon
 * l'affection qu'on lui prete -- vingt-cinq heures et plus : 1 ; fini : 1 ;
 * commence : 0,8 ; abandonne : -0,6 ; « pas pour moi » : -1. La ressemblance
 * d'une offre est le cosinus entre les deux, de -1 a 1. Sous trois jeux
 * aimes, pas de profil : trois jeux ne sont pas des gouts.
 *
 * Aucune donnee ne part ailleurs que vers Steam, et seuls des numeros de
 * jeux : jamais un titre, jamais un compte. Le profil (des numeros
 * d'etiquettes et des poids) est le seul resultat garde, avec le nom des
 * etiquettes retenues.
 *
 * Module pur, sauf `refreshTaste`, qui recoit son `fetch`.
 */
import { STATUS, readAnnotation } from './annotations.js';
import { buildRows, KINDS, rowKey } from './collection.js';
import { ITEMS_URL } from './sources/steam.js';

export const KEY_TASTE = 'veille:gouts';

/** Les etiquettes posees sur presque tout : elles comptent, mais peu. */
export const GENERIC = Object.freeze([4182, 492, 1756, 4166, 597, 493, 113, 19, 21, 3859, 7481]);
export const GENERIC_FORCE = 0.4;

/** Dix etiquettes par jeu suffisent, et tiennent dans le stockage. */
export const TOP_TAGS = 10;
/** Sous ce nombre de jeux aimes, pas de profil. */
export const MIN_LIKED = 3;
/** Un jeu joue moins n'est pas un gout. */
export const MIN_HOURS = 3;
/** Les jeux les plus joues, et pas plus : le profil suit ce qu'on joue vraiment. */
export const MAX_SIGNALS = 40;
/** A partir de la, une offre est « pour vous ». */
export const FOR_YOU = 0.45;
/** Etiquettes gardees dans le profil. */
export const KEEP_POSITIVE = 30;
export const KEEP_NEGATIVE = 10;

export const PASS_EVERY_MS = 6 * 3600 * 1000;
/* Une offre arrivee depuis le dernier passage n'attend pas six heures : dix minutes. */
export const MISSING_EVERY_MS = 10 * 60 * 1000;
export const GAME_FRESH_MS = 60 * 24 * 3600 * 1000;
export const NAMES_FRESH_MS = 60 * 24 * 3600 * 1000;
export const MAX_GAMES = 300;
export const LOT = 50;
export const LOTS_PER_RUN = 2;

/** Ce qu'un etat d'annotation dit de l'affection : signe et force. */
const AFFECTION = Object.freeze({
  [STATUS.DONE]: 1,
  [STATUS.PLAYING]: 0.8,
  [STATUS.DROPPED]: -0.6,
  [STATUS.NOT_FOR_ME]: -1,
});

const STEAM_LANGS = Object.freeze({ fr: 'french', en: 'english', de: 'german', es: 'spanish' });

/** La langue des noms d'etiquettes, dans le vocabulaire de Steam. */
export function tagLanguage(locale) {
  return STEAM_LANGS[String(locale || 'en').toLowerCase().slice(0, 2)] || 'english';
}

/* ---------------------------------------------------------------- l'etat */

/** L'etat stocke, avec sa forme. */
export function readTasteState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ok = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const p = r.profile && typeof r.profile === 'object' && ok(r.profile.tags) ? r.profile : null;
  return {
    at: typeof r.at === 'number' ? r.at : null,
    profile: p ? { tags: p.tags, liked: Number(p.liked) || 0, disliked: Number(p.disliked) || 0 } : null,
    games: ok(r.games) ? r.games : {},
    names: ok(r.names) ? r.names : {},
    namesAt: typeof r.namesAt === 'number' ? r.namesAt : null,
    namesLang: typeof r.namesLang === 'string' ? r.namesLang : null,
  };
}

/** Un jeu du cache : relu apres soixante jours (sept s'il n'avait rien). */
const aRelire = (g, now) => !g || now - (g.at || 0) >= (g.none ? 7 * 24 * 3600 * 1000 : GAME_FRESH_MS);

/**
 * Un passage est-il du ? Toutes les six heures, ou -- quand une offre en cours
 * n'a pas encore ses etiquettes (`wanted`, ses appids) -- au bout de dix minutes.
 */
export function tastePassDue(raw, now, wanted = []) {
  const s = readTasteState(raw);
  if (!s.at || now - s.at >= PASS_EVERY_MS) return true;
  return now - s.at >= MISSING_EVERY_MS && (wanted || []).some((id) => aRelire(s.games[String(id)], now));
}

/* --------------------------------------------------------------- les jeux */

/**
 * Les etiquettes d'un jeu, compactees : `[[tagid, poids 0..100], ...]`, les
 * `TOP_TAGS` plus fortes. Rend null si le jeu n'en a aucune : un jeu sans
 * etiquette n'a rien a comparer.
 */
export function compactTags(tags, top = TOP_TAGS) {
  const list = (Array.isArray(tags) ? tags : [])
    .map((t) => ({ id: Number(t && t.tagid), w: Number(t && t.weight) || 0 }))
    .filter((t) => Number.isInteger(t.id) && t.id > 0 && t.w > 0)
    .sort((a, b) => b.w - a.w || a.id - b.id)
    .slice(0, top);
  if (!list.length) return null;
  const max = list[0].w;
  return list.map((t) => [t.id, Math.max(1, Math.round((t.w / max) * 100))]);
}

/** Un vecteur { tagid: valeur 0..1 } depuis les etiquettes compactees, les larges etant attenuees. */
export function tagVector(compact) {
  const v = {};
  for (const [id, w] of Array.isArray(compact) ? compact : []) {
    if (!Number.isInteger(id) || !(w > 0)) continue;
    v[id] = (w / 100) * (GENERIC.includes(id) ? GENERIC_FORCE : 1);
  }
  return v;
}

const norme = (v) => Math.sqrt(Object.values(v).reduce((n, x) => n + x * x, 0));

/* -------------------------------------------------------------- le profil */

/**
 * Ce que le miroir et les annotations disent de l'affection : `[{ appid, s }]`,
 * `s` de -1 a 1. Un etat dit a la main l'emporte sur les heures. Les jeux
 * hors Steam n'ont pas d'appid : ils ne disent rien ici.
 *
 * `playtime` : appid -> heures (null = jamais lance), ou rien.
 */
export function signalsFrom({ playtime = null, annotations = {}, collection = null, library = {} } = {}) {
  const out = new Map();
  const pt = playtime && typeof playtime === 'object' ? playtime : {};
  const joues = Object.entries(pt)
    .filter(([id, h]) => /^\d+$/.test(id) && typeof h === 'number' && h >= MIN_HOURS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SIGNALS);
  for (const [id, h] of joues) out.set(id, Math.min(1, Math.max(0.2, h / 25)));

  for (const row of buildRows({ collection, library })) {
    if (row.kind !== KINDS.GAME) continue;
    const steam = row.stores && row.stores.steam;
    if (!steam || !/^\d+$/.test(String(steam.id))) continue;
    const s = AFFECTION[readAnnotation(annotations, rowKey(row)).status];
    if (typeof s === 'number') out.set(String(steam.id), s);
  }
  return [...out].map(([appid, s]) => ({ appid, s }));
}

/**
 * Le profil : { tags: { tagid: valeur }, liked, disliked }, ou null sous
 * `MIN_LIKED` jeux aimes dont on connait les etiquettes.
 *
 * `games` : appid -> { tags: [[id, poids]] } (le cache de l'etat).
 */
export function buildProfile(signals, games) {
  const sum = {};
  let liked = 0;
  let disliked = 0;
  let total = 0;
  for (const { appid, s } of signals || []) {
    const g = games && games[appid];
    if (!g || !Array.isArray(g.tags) || !g.tags.length || !s) continue;
    if (s > 0) liked++; else disliked++;
    total += Math.abs(s);
    for (const [id, v] of Object.entries(tagVector(g.tags))) sum[id] = (sum[id] || 0) + s * v;
  }
  if (liked < MIN_LIKED || !total) return null;
  const entries = Object.entries(sum).map(([id, v]) => [id, v / total]).filter(([, v]) => Math.abs(v) >= 0.03);
  const pos = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, KEEP_POSITIVE);
  const neg = entries.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, KEEP_NEGATIVE);
  const tags = {};
  for (const [id, v] of [...pos, ...neg]) tags[id] = Math.round(v * 1000) / 1000;
  return Object.keys(tags).length ? { tags, liked, disliked } : null;
}

/**
 * La ressemblance d'un jeu (ses etiquettes compactees) avec le profil : le
 * cosinus, de -1 a 1, et les etiquettes qui la portent (les plus fortes
 * d'abord). Rend null sans profil ou sans etiquettes.
 */
export function scoreGame(profile, compact) {
  if (!profile || !profile.tags) return null;
  const v = tagVector(compact);
  const nv = norme(v);
  const p = {};
  for (const [id, x] of Object.entries(profile.tags)) p[id] = Number(x) || 0;
  const np = norme(p);
  if (!nv || !np) return null;
  let dot = 0;
  const porteuses = [];
  for (const [id, x] of Object.entries(v)) {
    const c = (p[id] || 0) * x;
    dot += c;
    if (c > 0) porteuses.push([Number(id), c]);
  }
  porteuses.sort((a, b) => b[1] - a[1]);
  // « Jeu solo » ne dit rien : on le cite seulement quand rien d'autre ne porte.
  const precises = porteuses.filter(([id]) => !GENERIC.includes(id));
  const dites = precises.length ? precises : porteuses;
  return { score: Math.round((dot / (nv * np)) * 1000) / 1000, top: dites.slice(0, 3).map(([id]) => id) };
}

/** Le jeu (son appid) est-il pour vous ? Rend { score, top } ou null. */
export function tasteFor(state, appid) {
  const s = readTasteState(state);
  if (!s.profile || !appid) return null;
  const g = s.games[String(appid)];
  if (!g || !g.tags) return null;
  const r = scoreGame(s.profile, g.tags);
  return r && r.score >= FOR_YOU ? r : null;
}

/** Les noms des etiquettes qui portent la ressemblance, dans la langue de l'etat. */
export function tasteNames(state, ids) {
  const s = readTasteState(state);
  return (ids || []).map((id) => s.names[String(id)]).filter(Boolean);
}

/** Les etiquettes qu'on retient du profil, pour n'en garder que les noms utiles. */
export function profileTagIds(profile) {
  return profile && profile.tags ? Object.keys(profile.tags).map(Number) : [];
}

/* --------------------------------------------------------------- le reseau */

export function tagListUrl(lang = 'english') {
  return `https://api.steampowered.com/IStoreService/GetTagList/v1/?language=${encodeURIComponent(lang)}`;
}

/** Les etiquettes d'un lot de jeux : rien que des numeros, aucune langue a lire. */
export function tasteItemsUrl(appids, country = 'FR') {
  const input = {
    ids: appids.map((appid) => ({ appid: Number(appid) })),
    context: { language: 'english', country_code: /^[A-Z]{2}$/.test(country) ? country : 'FR' },
    data_request: { include_tag_count: 20 },
  };
  return `${ITEMS_URL}?input_json=${encodeURIComponent(JSON.stringify(input))}`;
}

async function lireJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * Les etiquettes d'un lot de jeux (cinquante au plus) : `{ appid: { tags, at }
 * | { none: true, at } }`, ou null si Steam ne repond pas. Sert au passage et
 * a la notification d'un jeu qui vient d'arriver.
 */
export async function fetchGames(fetchImpl, appids, { now, country = 'FR' } = {}) {
  const ids = [...new Set((appids || []).map(String).filter((id) => /^\d+$/.test(id)))].slice(0, LOT);
  if (!ids.length) return {};
  const json = await lireJson(fetchImpl, tasteItemsUrl(ids, country));
  const items = json && json.response && Array.isArray(json.response.store_items) ? json.response.store_items : null;
  if (!items) return null;
  const lus = new Map(items.map((it) => [String(it && (it.appid || it.id)), it]));
  const out = {};
  for (const id of ids) {
    const it = lus.get(id);
    const tags = it && it.success === 1 ? compactTags(it.tags) : null;
    out[id] = tags ? { tags, at: now } : { none: true, at: now };
  }
  return out;
}

/**
 * Un passage : les etiquettes des jeux qui manquent (ceux qui font le profil,
 * puis les offres, deux lots de cinquante au plus), puis le profil, puis --
 * au plus tous les deux mois -- le nom des etiquettes qu'il retient. Sans
 * cookie. Rend l'etat suivant ; ne jette jamais.
 *
 * `wanted` : les appids des offres et des jeux a comparer (la pile, les
 * offres en cours).
 */
export async function refreshTaste({
  fetch: fetchImpl, signals, wanted = [], state: raw, now, country = 'FR', lang = 'english',
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
}) {
  const s = readTasteState(raw);
  const games = { ...s.games };

  const ordre = [];
  const vus = new Set();
  for (const id of [...(signals || []).map((x) => x.appid), ...wanted]) {
    const k = String(id);
    if (!/^\d+$/.test(k) || vus.has(k)) continue;
    vus.add(k);
    if (aRelire(games[k], now)) ordre.push(k);
  }
  let premier = true;
  for (let i = 0; i < Math.min(ordre.length, LOT * LOTS_PER_RUN); i += LOT) {
    const lot = ordre.slice(i, i + LOT);
    if (!premier) await pause(1200);
    premier = false;
    const lus = await fetchGames(fetchImpl, lot, { now, country });
    if (lus) Object.assign(games, lus);
  }

  // Le cache reste petit : les plus anciens sortent, sauf ceux qui font le profil.
  const gardes = new Set((signals || []).map((x) => String(x.appid)));
  const ids = Object.keys(games);
  if (ids.length > MAX_GAMES) {
    const sortants = ids.filter((id) => !gardes.has(id)).sort((a, b) => (games[a].at || 0) - (games[b].at || 0)).slice(0, ids.length - MAX_GAMES);
    for (const id of sortants) delete games[id];
  }

  const profile = buildProfile(signals, games);

  let names = s.names;
  let namesAt = s.namesAt;
  let namesLang = s.namesLang;
  const besoin = profileTagIds(profile);
  const manque = besoin.some((id) => !names[String(id)]);
  if (profile && (manque || namesLang !== lang || !namesAt || now - namesAt >= NAMES_FRESH_MS)) {
    const json = await lireJson(fetchImpl, tagListUrl(lang));
    const list = json && json.response && Array.isArray(json.response.tags) ? json.response.tags : null;
    if (list) {
      // Seules les etiquettes du profil peuvent porter une ressemblance : ce sont les seuls noms utiles.
      const utiles = new Set(besoin);
      names = {};
      for (const t of list) if (utiles.has(Number(t.tagid)) && t.name) names[String(t.tagid)] = String(t.name).slice(0, 60);
      namesAt = now;
      namesLang = lang;
    }
  }

  return { at: now, profile, games, names, namesAt, namesLang };
}
