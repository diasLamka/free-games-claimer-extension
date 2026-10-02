/* Le gardien de bibliotheque (2.105.0).
 *
 * Un jeu pris n'est pas forcement un jeu garde : un magasin retire un titre, un
 * remboursement ou une sanction le retire du compte, et personne ne regarde ses
 * trois cents jeux un par un. Une fois par mois -- si vous l'avez demande --,
 * l'extension relit la collection de vos magasins (le meme import que « Tout
 * importer ») et compare avec ce qu'elle a pris : ce qui manque est dit.
 *
 * LA PRUDENCE EST LE CHOIX, parce qu'une fausse alerte « votre jeu a disparu » est
 * pire que pas d'alerte :
 *   - seulement Steam, GOG et Epic, dont on sait relire la collection ;
 *   - seulement si l'import de ce magasin est FRAIS (moins de trois jours) et pas
 *     minuscule : une reponse partielle ne prouve pas qu'un jeu manque ;
 *   - seulement un jeu pris depuis plus de quarante-huit heures (le magasin met du
 *     temps a l'afficher) ;
 *   - le meme titre ne s'apparie pas par identifiant (chaque magasin a le sien)
 *     mais par titre normalise, tolerant aux editions (« Hades » / « Hades -
 *     Standard Edition ») ;
 *   - le jeu doit manquer a DEUX relectures espacees d'au moins vingt heures ;
 *   - et il n'est dit qu'une fois.
 * Ce que l'alerte ne sait pas : POURQUOI -- retrait du magasin, remboursement,
 * compte sanctionne ou simple titre different. Elle le dit.
 *
 * Module pur : l'import, les notifications et l'horloge viennent de l'appelant.
 */
import { normaliseTitle } from './offer.js';
import { ACQUIRED } from './library.js';
import { sanitiseCollection } from './collection.js';

/** Dans le stockage. Ecrit par le worker seul. */
export const KEY_LIBWATCH = 'veille:gardien';

export const WATCHED_STORES = Object.freeze(['steam', 'gog', 'epic']);

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const MIN_AGE_MS = 48 * HOUR_MS;
export const IMPORT_MAX_AGE_MS = 3 * DAY_MS;
export const MIN_GAP_MS = 20 * HOUR_MS;
export const EVERY_MS = 30 * DAY_MS;
/** Apres un import rate (session expiree), on reessaie le lendemain. */
export const RETRY_MS = DAY_MS;
/** Une collection plus petite que cela n'est pas une photographie fiable. */
export const MIN_STORE_ITEMS = 10;
export const MAX_MISSING = 200;

export function readWatchState(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const missing = {};
  if (r.missing && typeof r.missing === 'object') {
    for (const [k, v] of Object.entries(r.missing).slice(0, MAX_MISSING)) {
      if (!v || typeof v !== 'object' || typeof v.store !== 'string') continue;
      missing[k] = {
        store: v.store,
        title: typeof v.title === 'string' ? v.title.slice(0, 160) : '',
        claimedAt: Number.isFinite(v.claimedAt) ? v.claimedAt : null,
        firstAt: Number.isFinite(v.firstAt) ? v.firstAt : 0,
        lastAt: Number.isFinite(v.lastAt) ? v.lastAt : 0,
        alertedAt: Number.isFinite(v.alertedAt) ? v.alertedAt : null,
      };
    }
  }
  return {
    at: Number.isFinite(r.at) ? r.at : null,
    nextAt: Number.isFinite(r.nextAt) ? r.nextAt : null,
    missing,
  };
}

/** La relecture mensuelle est-elle due ? Seulement si l'utilisateur l'a demandee. */
export function due(settings, state, now) {
  if (!settings || settings.libraryWatch !== true) return false;
  const s = readWatchState(state);
  return s.nextAt === null || now >= s.nextAt;
}

/** Les magasins dont on peut relire la collection ET que l'utilisateur a deja importes une fois. */
export function storesToImport(collection) {
  const c = sanitiseCollection(collection);
  return WATCHED_STORES.filter((s) => c.stores[s] && c.stores[s].lastOk);
}

/** Les magasins dont l'import est assez frais et assez fourni pour juger. */
export function trustedStores(collection, now) {
  const c = sanitiseCollection(collection);
  return WATCHED_STORES.filter((s) => {
    const st = c.stores[s];
    return st && st.lastOk && now - st.lastOk <= IMPORT_MAX_AGE_MS && (st.count || 0) >= MIN_STORE_ITEMS;
  });
}

const EDITION = /\b(standard|deluxe|ultimate|definitive|complete|goty|game of the year|gold|premium|enhanced|remastered|anniversary)\s+edition\b/g;

/** Un titre ramene a ce qui le distingue : sans accent, sans « Edition ». */
function core(title) {
  return normaliseTitle(title).replace(EDITION, ' ').replace(/\s+/g, ' ').trim();
}

/** Ces deux titres designent-ils le meme jeu ? Egaux, ou l'un dans l'autre (six caracteres au moins). */
export function sameGame(a, b) {
  const x = core(a);
  const y = core(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [court, long] = x.length <= y.length ? [x, y] : [y, x];
  return court.length >= 6 && long.includes(court);
}

/**
 * Les jeux pris que la collection ne montre plus : [{ key, store, title, claimedAt }].
 * `stores` : les magasins dont on juge (voir trustedStores).
 */
export function missingGames({ library, collection, now, stores = null }) {
  const c = sanitiseCollection(collection);
  const juges = new Set(stores || trustedStores(c, now));
  const titresParMagasin = {};
  for (const it of Object.values(c.items)) {
    if (!it || !juges.has(it.store) || !it.title) continue;
    (titresParMagasin[it.store] = titresParMagasin[it.store] || []).push(it.title);
  }
  const out = [];
  for (const [key, e] of Object.entries(library || {})) {
    if (!e || !juges.has(e.store) || !e.title || !ACQUIRED.includes(e.status)) continue;
    if (!Number.isFinite(e.ts) || now - e.ts < MIN_AGE_MS) continue;
    const titres = titresParMagasin[e.store] || [];
    if (titres.some((t) => sameGame(t, e.title))) continue;
    out.push({ key, store: e.store, title: e.title, claimedAt: e.ts });
  }
  return out.sort((a, b) => a.claimedAt - b.claimedAt).slice(0, MAX_MISSING);
}

/**
 * Rapproche ce qui manque de ce qu'on savait. Rend { state, alerts } : `alerts`
 * est ce qui manque pour la DEUXIEME fois, a vingt heures d'ecart au moins, et
 * n'a pas encore ete dit.
 */
export function reconcile(raw, missing, { now, judged }) {
  const state = readWatchState(raw);
  const next = {};
  const alerts = [];
  const juges = new Set(judged);
  const vusManquants = new Map(missing.map((m) => [m.key, m]));

  // Ce qu'on savait d'un magasin qui n'a pas ete juge cette fois reste tel quel.
  for (const [k, v] of Object.entries(state.missing)) if (!juges.has(v.store)) next[k] = v;

  for (const [k, m] of vusManquants) {
    const avant = state.missing[k];
    const entree = avant
      ? { ...avant, title: m.title, lastAt: now }
      : { store: m.store, title: m.title, claimedAt: m.claimedAt, firstAt: now, lastAt: now, alertedAt: null };
    if (!entree.alertedAt && now - entree.firstAt >= MIN_GAP_MS) {
      entree.alertedAt = now;
      alerts.push({ key: k, store: m.store, title: m.title, claimedAt: m.claimedAt });
    }
    next[k] = entree;
  }
  // Un jeu qui reapparait (ou qu'on ne juge plus) sort de la liste.
  return { state: { ...state, missing: next }, alerts };
}

/**
 * Apres une relecture : la prochaine dans un mois ; le lendemain si l'import a
 * echoue ; et un peu plus de vingt heures plus tard quand un jeu manque sans
 * avoir ete confirme -- c'est la deuxieme relecture qui decide.
 */
export function scheduled(raw, { now, ok }) {
  const state = readWatchState(raw);
  const enAttente = Object.values(state.missing).some((m) => !m.alertedAt);
  const delai = !ok ? RETRY_MS : enAttente ? MIN_GAP_MS + HOUR_MS : EVERY_MS;
  return { ...state, at: now, nextAt: now + delai };
}
