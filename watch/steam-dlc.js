/* Les DLC gratuits de vos jeux Steam (2.92.0).
 *
 * Bandes-son, camions, packs : des centaines de jeux ont des contenus
 * additionnels GRATUITS qu'on n'ajoute jamais, faute de savoir qu'ils
 * existent. L'extension connait vos jeux Steam (Ma collection) ; elle cherche,
 * doucement, lesquels en ont.
 *
 * CE QUI EST MESURE (2026-09-27) :
 *
 *   - `api/dlcforapp/?appid=` rend tous les DLC d'un jeu en une requete, avec
 *     leur prix -- et SANS `price_overview` ceux qui n'ont pas de prix. Pas de
 *     prix ne veut pas dire gratuit : les « Prime Access » de Warframe n'en
 *     ont pas non plus ;
 *   - `api/appdetails?appids=` tranche : `is_free: true`, `release_date.
 *     coming_soon: false`. Euro Truck Simulator 2 a ainsi dix DLC gratuits
 *     (camions), et quatre extensions sans prix parce qu'a paraitre ;
 *   - un DLC gratuit n'a AUCUN paquet (`packages` absent) : sa page propose
 *     « Download », qui ouvre `steam://run/<appid>`. Seule l'application Steam
 *     l'ajoute. L'extension ne l'imite pas -- ce serait parler au nom du
 *     client Steam -- : elle les TROUVE, et un clic par DLC les confie a
 *     Steam.
 *
 * Le rythme : huit jeux lus par passage, puis huit DLC verifies ; un jeu relu
 * tous les trente jours. Requetes anonymes (`credentials: 'omit'`), sauf la
 * lecture de ce que vous possedez, la meme que la source Steam, toutes les
 * six heures au plus.
 *
 * Module pur, sauf `runDlcPass`, qui recoit son `fetch`.
 */
import { appDetailsEntry, readOwnership } from './sources/steam.js';

export const KEY_STEAM_DLC = 'veille:dlc-steam';

export const PER_RUN = 8;
export const RESCAN_MS = 30 * 24 * 3600 * 1000;
export const OWNED_EVERY_MS = 6 * 3600 * 1000;
/** Entre deux passages, pas moins d'une heure : c'est un inventaire, pas une veille. */
export const PASS_EVERY_MS = 3600 * 1000;
export const PAUSE_MS = 1200;

export const dlcForAppUrl = (appid, cc = 'FR') => `https://store.steampowered.com/api/dlcforapp/?appid=${encodeURIComponent(appid)}&cc=${encodeURIComponent(cc)}&l=english`;
export const appDetailsUrl = (appid, cc = 'FR') => `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=${encodeURIComponent(cc)}&l=english`;
export const storeUrl = (appid) => `https://store.steampowered.com/app/${appid}/`;

/** L'etat stocke, avec sa forme. */
export function readDlcState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    at: typeof r.at === 'number' ? r.at : null,
    games: r.games && typeof r.games === 'object' ? r.games : {},
    dlc: r.dlc && typeof r.dlc === 'object' ? r.dlc : {},
    owned: r.owned && typeof r.owned === 'object' && Array.isArray(r.owned.apps) ? r.owned : null,
    hidden: Array.isArray(r.hidden) ? r.hidden.map(String) : [],
    notified: Array.isArray(r.notified) ? r.notified.map(String) : [],
  };
}

/** Vos jeux Steam, d'apres Ma collection : [{ id, title }]. */
export function steamGames(collection) {
  return Object.values(collection || {})
    .filter((i) => i && i.store === 'steam' && /^\d+$/.test(String(i.id || '')) && (i.kind === 'game' || !i.kind))
    .map((i) => ({ id: String(i.id), title: i.title || null }));
}

/** Les jeux a lire maintenant : jamais lus d'abord, puis les plus anciens. */
export function gamesToScan(games, state, now, n = PER_RUN) {
  return games
    .filter((g) => { const s = state.games[g.id]; return !s || now - s.at >= RESCAN_MS; })
    .sort((a, b) => ((state.games[a.id] || {}).at || 0) - ((state.games[b.id] || {}).at || 0))
    .slice(0, n);
}

/** Les DLC sans prix d'une reponse `dlcforapp` : les candidats a verifier. */
export function dlcCandidates(json) {
  if (!json || json.status !== 1 || !Array.isArray(json.dlc)) return null;
  return json.dlc
    .filter((d) => d && d.id !== undefined && (!d.price_overview || d.price_overview.final === 0))
    .map((d) => ({ id: String(d.id), name: String(d.name || '').slice(0, 160), image: typeof d.header_image === 'string' ? d.header_image : null }));
}

/** Le verdict d'`appdetails` sur un DLC : gratuit, sorti, son jeu -- ou null si illisible. */
export function dlcVerdict(json, appid) {
  const e = appDetailsEntry(json, appid);
  if (!e || e.success !== true || !e.data) return null;
  const d = e.data;
  const pkgs = Array.isArray(d.packages) ? d.packages.map(String) : [];
  return {
    free: d.is_free === true,
    released: !(d.release_date && d.release_date.coming_soon === true),
    dlc: d.type === 'dlc',
    parent: d.fullgame && d.fullgame.appid ? String(d.fullgame.appid) : null,
    name: String(d.name || '').slice(0, 160),
    // Un paquet gratuit s'ajoute au compte depuis la page ; sans paquet, seul le client Steam l'ajoute.
    packageId: d.is_free === true && pkgs.length ? pkgs[0] : null,
  };
}

/**
 * Le nom d'un DLC sans celui de son jeu : « Euro Truck Simulator 2 - DAF XD »
 * devient « DAF XD ». Le jeu est dit a cote ; le repeter coupait le nom.
 */
export function shortDlcName(name, parentName) {
  const n = String(name || '').trim();
  const p = String(parentName || '').trim();
  if (!p || n.length <= p.length || n.slice(0, p.length).toLowerCase() !== p.toLowerCase()) return n;
  // Un mot entier : « Hadestown » n'est pas un DLC de « Hades ».
  if (!/[\s\-–—:|]/.test(n.charAt(p.length))) return n;
  const reste = n.slice(p.length).replace(/^\s*[-–—:|]\s*/, '').trim();
  return reste || n;
}

/** Ce que vous possedez sur Steam : la derniere lecture, et Ma collection. */
function ownedSet(state, collection) {
  const s = new Set((state.owned && state.owned.apps) || []);
  for (const i of Object.values(collection || {})) if (i && i.store === 'steam' && i.id) s.add(String(i.id));
  return s;
}

/**
 * Les DLC gratuits, sortis, que vous n'avez pas encore et n'avez pas
 * masques -- groupes par jeu, dans l'ordre des titres.
 */
export function pendingFreeDlc(stateRaw, collection) {
  const state = readDlcState(stateRaw);
  const owned = ownedSet(state, collection);
  const hidden = new Set(state.hidden);
  return Object.entries(state.dlc)
    .filter(([id, d]) => d && d.checked && d.free && d.released && d.dlc !== false && !owned.has(id) && !hidden.has(id))
    .map(([id, d]) => ({
      id,
      name: d.name,
      short: shortDlcName(d.name, state.games[d.parent] && state.games[d.parent].name),
      image: d.image || null,
      parent: d.parent,
      parentName: (state.games[d.parent] && state.games[d.parent].name) || null,
      packageId: d.packageId || null,
      url: storeUrl(id),
      runUrl: `steam://run/${id}`,
    }))
    .sort((a, b) => String(a.parentName || '').localeCompare(String(b.parentName || '')) || a.name.localeCompare(b.name));
}

/** Un passage est-il du ? */
export function dlcPassDue(stateRaw, now) {
  const s = readDlcState(stateRaw);
  return !s.at || now - s.at >= PASS_EVERY_MS;
}

async function lireJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, json: await r.json() };
  } catch (e) {
    return { ok: false, status: 0, note: (e && e.message) || String(e) };
  }
}

/**
 * Un passage : ce que vous possedez (toutes les six heures), huit jeux lus,
 * huit DLC verifies. Rend { state, found, errors } -- `found` : les DLC
 * gratuits nouvellement confirmes. Ne jette jamais.
 */
export async function runDlcPass({
  fetch: fetchImpl, now, collection, state: raw, country = 'FR', perRun = PER_RUN,
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
}) {
  const state = readDlcState(raw);
  const errors = [];
  const found = [];
  state.games = { ...state.games };
  state.dlc = { ...state.dlc };

  if (!state.owned || now - state.owned.at >= OWNED_EVERY_MS) {
    const o = await readOwnership({ fetch: fetchImpl, now });
    if (o.status === 'ok') state.owned = { at: now, apps: [...o.apps] };
    else if (state.owned) state.owned = { ...state.owned, at: now };
    if (o.status !== 'ok') errors.push(`bibliotheque : ${o.status}${o.note ? ` (${o.note})` : ''}`);
  }

  let premier = true;
  const attendre = async () => { if (!premier) await pause(PAUSE_MS); premier = false; };

  for (const g of gamesToScan(steamGames(collection), state, now, perRun)) {
    await attendre();
    const r = await lireJson(fetchImpl, dlcForAppUrl(g.id, country));
    const cands = r.ok ? dlcCandidates(r.json) : null;
    if (!cands) {
      errors.push(`dlcforapp ${g.id} : ${r.ok ? 'forme inattendue' : r.status || r.note}`);
      // Relu au prochain passage, pas tout de suite : un jeu retire du magasin repond mal a chaque fois.
      state.games[g.id] = { at: now - RESCAN_MS + 24 * 3600 * 1000, name: g.title, dlc: (state.games[g.id] || {}).dlc || [] };
      continue;
    }
    const ids = cands.map((c) => c.id);
    // Un DLC qui a pris un prix n'est plus candidat : il sort de la liste.
    for (const old of (state.games[g.id] || {}).dlc || []) if (!ids.includes(old)) delete state.dlc[old];
    state.games[g.id] = { at: now, name: (r.json && r.json.name) || g.title, dlc: ids };
    for (const c of cands) {
      const avant = state.dlc[c.id];
      if (!avant) state.dlc[c.id] = { name: c.name, image: c.image, parent: g.id, checked: false };
      // Pas encore sorti, ou pas encore gratuit, il y a trente jours : on reverifie.
      else if (avant.checked && !(avant.free && avant.released)) state.dlc[c.id] = { ...avant, checked: false };
    }
  }

  const owned = ownedSet(state, collection);
  const aVerifier = Object.entries(state.dlc).filter(([id, d]) => d && !d.checked && !owned.has(id)).slice(0, perRun);
  for (const [id, d] of aVerifier) {
    await attendre();
    const r = await lireJson(fetchImpl, appDetailsUrl(id, country));
    const v = r.ok ? dlcVerdict(r.json, id) : null;
    if (!v) { errors.push(`appdetails ${id} : ${r.ok ? 'illisible' : r.status || r.note}`); continue; }
    state.dlc[id] = { ...d, ...v, name: v.name || d.name, parent: v.parent || d.parent, checked: true, at: now };
    if (v.free && v.released && v.dlc) found.push(id);
  }

  state.at = now;
  return { state, found, errors };
}
