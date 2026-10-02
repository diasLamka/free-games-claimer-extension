/* « Piege ou bonne affaire ? » (2.103.0).
 *
 * « Gratuit » ne dit pas « interessant ». Un jeu offert peut etre gratuit de
 * toute facon, une demo, un DLC qui ne sert a rien sans un jeu qu'on n'a pas,
 * ou un titre dont le prix « barre » a ete gonfle par le site qui l'annonce.
 * Ce module rassemble ce que l'on sait deja et rend une note de A a D, avec
 * ses RAISONS -- jamais une note sans pourquoi -- ou « non evaluee » quand les
 * donnees manquent. Il ne devine pas.
 *
 * CE QUI EST UTILISE, et d'ou ca vient :
 *
 *   - le magasin lui-meme dit si l'offre est a garder (`keepable`, prix
 *     d'origine a zero chez Epic, GOG) : source de confiance ;
 *   - la fiche Steam (`appdetails`, sans cookie) dit le TYPE (jeu, dlc, demo,
 *     musique), si le jeu est gratuit de toute facon, son prix de catalogue en
 *     dollars et, pour un DLC, le jeu de base ;
 *   - les evaluations Steam (watch/steam-ratings.js) ;
 *   - la collection importee dit si le jeu de base est a vous.
 *
 * LA VALEUR ANNONCEE : un agregateur (gamerpower) publie des dollars sans
 * garantie ; un magasin publie son propre prix. La premiere n'est comptee
 * « verifiee » que recoupee avec le prix Steam (meme devise : les deux sont
 * lus en dollars), et plafonnee a ce prix quand elle le depasse trop.
 *
 * Module pur, sauf `refreshChecks`, qui recoit son `fetch`. Aucune horloge
 * implicite. Son pendant Kotlin (android/.../data/Bargain.kt) est verifie par
 * une table d'or (test/bargain.test.mjs -> bargain-golden.tsv).
 */
import { STORES, worthSource } from './offer.js';
import { readWorth, readCurrency, isKeepable, isExtraContent, isStoreDlc } from './filters.js';
import { ratingFor, steamAppId } from './steam-ratings.js';
import { appDetailsEntry } from './sources/steam.js';
import { ownedStoreKeys, sanitiseCollection } from './collection.js';

/** { 'app:<appid>': { at, appid, type, isFree, price, currency, fullgame, fullgameName } | { at, none: true } }. */
export const KEY_CHECKS = 'veille:prix-steam';

const DAY_MS = 24 * 3600 * 1000;
/** Le prix de catalogue bouge peu : une lecture par mois. */
export const FRESH_MS = 30 * DAY_MS;
/** Un jeu que Steam ne rend pas : on redemande dans une semaine. */
export const NONE_MS = 7 * DAY_MS;
export const MAX_ENTRIES = 400;
export const PER_RUN = 8;

/** Les prix de l'agregateur sont en dollars : on compare donc a la fiche US. */
export const COMPARE_CC = 'US';
export const COMPARE_CURRENCY = 'USD';

export const GRADES = Object.freeze({ A: 'A', B: 'B', C: 'C', D: 'D' });

/** Au-dela, la valeur annoncee est « gonflee » : le rapport au prix Steam... */
export const INFLATED_RATIO = 1.5;
export const VERY_INFLATED_RATIO = 3;
/** ...et l'ecart en dollars (un rabais de quelques dollars n'est pas une tromperie). */
export const INFLATED_MIN_GAP = 5;
/** Une valeur confirmee en dessous de ce seuil n'ajoute rien a la note. */
export const WORTH_THRESHOLD = 10;
/** Moins d'avis que cela : la note Steam n'est pas fiable. */
export const MIN_REVIEWS = 50;

export const appDetailsUrl = (appid) => `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&cc=${COMPARE_CC}&l=english`;

/** Une demo ou un test : dit par le titre quand la fiche Steam manque. */
const TRIAL_WORDS = /\b(demo|playtest|benchmark)\b/i;

/* ------------------------------------------------------------- la valeur */

export { worthSource };

/** 19.99 -> « 19.99 », 20 -> « 20 » : le meme texte en JS et en Kotlin. */
export function amountText(n) {
  if (!Number.isFinite(n)) return '';
  return Math.abs(n - Math.round(n)) < 0.005 ? String(Math.round(n)) : n.toFixed(2);
}

/**
 * Confronte la valeur annoncee par un agregateur (en dollars) au prix Steam.
 * Rend { state: 'ok' | 'inflated' | 'very' | 'unverifiable', declared, real }.
 */
export function compareWorth(declared, check) {
  if (!Number.isFinite(declared) || declared <= 0) return { state: 'unverifiable', declared: null, real: null };
  if (!check || check.none || check.currency !== COMPARE_CURRENCY || !Number.isFinite(check.price) || check.price <= 0) {
    return { state: 'unverifiable', declared, real: null };
  }
  const real = check.price;
  if (declared - real < INFLATED_MIN_GAP || declared / real < INFLATED_RATIO) return { state: 'ok', declared, real };
  return { state: declared / real >= VERY_INFLATED_RATIO ? 'very' : 'inflated', declared, real };
}

/* ------------------------------------------------------------- la fiche */

/** Ce qu'une reponse appdetails dit d'un titre, ou null. */
export function readCheck(json, appid) {
  const e = appDetailsEntry(json, appid);
  if (!e || e.success !== true || !e.data) return null;
  const d = e.data;
  const p = d.price_overview;
  const fullgame = d.fullgame && /^\d+$/.test(String(d.fullgame.appid)) ? String(d.fullgame.appid) : null;
  return {
    appid: String(appid),
    type: String(d.type || '').toLowerCase().slice(0, 24),
    isFree: d.is_free === true,
    price: p && Number.isFinite(p.initial) ? p.initial / 100 : null,
    currency: p && p.currency ? String(p.currency) : null,
    fullgame,
    fullgameName: fullgame && d.fullgame.name ? String(d.fullgame.name).slice(0, 120) : null,
  };
}

/** L'appid Steam d'une offre : le sien, sinon celui que la note a trouve. */
export function checkAppId(offer, ratings) {
  return steamAppId(offer) || (ratingFor(ratings || {}, offer) || {}).appid || null;
}

export const checkKey = (appid) => `app:${appid}`;

export function checkFor(checks, appid) {
  const c = appid && checks ? checks[checkKey(appid)] : null;
  return c && !c.none ? c : null;
}

export function needsCheck(checks, appid, now) {
  if (!appid) return false;
  const c = checks ? checks[checkKey(appid)] : null;
  if (!c || typeof c.at !== 'number') return true;
  return now - c.at >= (c.none ? NONE_MS : FRESH_MS);
}

/** Range des fiches lues, et garde les MAX_ENTRIES plus recentes. */
export function storeChecks(checks, entries) {
  const out = { ...(checks && typeof checks === 'object' ? checks : {}) };
  for (const [k, v] of entries) if (k && v) out[k] = v;
  const cles = Object.keys(out);
  if (cles.length > MAX_ENTRIES) {
    cles.sort((a, b) => (out[b].at || 0) - (out[a].at || 0));
    for (const k of cles.slice(MAX_ENTRIES)) delete out[k];
  }
  return out;
}

/**
 * Lit les fiches qui manquent ou ont vieilli, `limit` au plus. Ne jette jamais ;
 * un echec reseau ne note rien (on retentera au prochain passage).
 */
export async function refreshChecks(checks, appids, {
  fetch: fetchImpl = fetch, now = Date.now(), limit = PER_RUN, timeoutMs = 8000,
  pause = (ms) => new Promise((ok) => setTimeout(ok, ms)),
} = {}) {
  const vus = new Set();
  const aFaire = [];
  for (const id of appids || []) {
    const a = id ? String(id) : null;
    if (!a || vus.has(a) || !needsCheck(checks, a, now)) continue;
    vus.add(a);
    aFaire.push(a);
  }
  const entrees = [];
  let premier = true;
  for (const appid of aFaire.slice(0, limit)) {
    if (!premier) await pause(1200);
    premier = false;
    const arret = typeof AbortController === 'function' ? new AbortController() : null;
    const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(appDetailsUrl(appid), { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: arret ? arret.signal : undefined });
      if (!r.ok) continue;
      const json = await r.json();
      const info = readCheck(json, appid);
      /* Steam repond `success: false` pour un titre retire de la vente : c'est
         une reponse, pas une panne. Un objet vide ou illisible, lui, n'en est pas une. */
      if (info) entrees.push([checkKey(appid), { ...info, at: now }]);
      else if (json && typeof json === 'object' && appDetailsEntry(json, appid)) entrees.push([checkKey(appid), { none: true, at: now }]);
    } catch { /* hors ligne, delai : au prochain passage */ } finally {
      if (minuterie) clearTimeout(minuterie);
    }
  }
  return { checks: storeChecks(checks, entrees), asked: aFaire.length ? Math.min(aFaire.length, limit) : 0, got: entrees.length };
}

/* ---------------------------------------------------------------- la note */

function ratedReason(rating) {
  const pct = Math.round((100 * rating.positive) / rating.total);
  if (pct >= 85) return { score: 2, reason: { key: 'bargainRatedHigh', args: [String(pct), String(rating.total)], tone: 'good' } };
  if (pct >= 70) return { score: 1, reason: { key: 'bargainRatedGood', args: [String(pct), String(rating.total)], tone: 'good' } };
  if (pct >= 50) return { score: -1, reason: { key: 'bargainRatedMixed', args: [String(pct), String(rating.total)], tone: 'bad' } };
  return { score: -3, reason: { key: 'bargainRatedLow', args: [String(pct), String(rating.total)], tone: 'bad' } };
}

/**
 * La note d'une offre : { grade: 'A'|'B'|'C'|'D'|null, reasons: [{ key, args, tone }] }.
 *
 * `offer`      l'offre (titre, magasin, category, keepable, worth, source/origin)
 * `check`      la fiche Steam lue (readCheck), ou null
 * `rating`     la note Steam ({ positive, total }), ou null
 * `baseOwned`  le jeu de base d'un DLC est-il a vous ? true / false / null (inconnu)
 *
 * Trois regles tiennent la balance :
 *   - ce qui est gratuit de toute facon, ou une demo, est D quoi qu'il arrive ;
 *   - sans AUCUNE donnee qui compte, la note est null (« non evaluee ») ;
 *   - A demande une bonne note Steam ET une valeur confirmee : sans note, B au mieux.
 */
export function grade({ offer, check = null, rating = null, baseOwned = null } = {}) {
  const reasons = [];
  if (!offer) return { grade: null, reasons: [{ key: 'bargainNoData', args: [], tone: 'neutral' }] };

  /* --- ce qui ne vaut rien a garder : D, sans appel */
  if (isKeepable(offer) === false || (check && check.isFree && check.type !== 'dlc')) {
    return { grade: GRADES.D, reasons: [{ key: 'bargainFreeForever', args: [], tone: 'bad' }] };
  }
  if ((check && check.type === 'demo') || TRIAL_WORDS.test(offer.title || '')) {
    return { grade: GRADES.D, reasons: [{ key: 'bargainDemo', args: [], tone: 'bad' }] };
  }
  if (check && (check.type === 'music' || check.type === 'video' || check.type === 'advertising')) {
    return { grade: GRADES.D, reasons: [{ key: 'bargainNotAGame', args: [], tone: 'bad' }] };
  }

  let score = 0;
  let evidence = 0;

  /* --- le jeu de base d'un DLC */
  const dlc = isExtraContent(offer) || (check && check.type === 'dlc');
  const hasBase = Boolean((check && check.fullgame) || offer.parentAppid);
  if (dlc && hasBase) {
    const name = (check && check.fullgameName) || '';
    if (baseOwned === false) {
      score -= 3; evidence++;
      reasons.push({ key: name ? 'bargainNeedsBase' : 'bargainNeedsBaseBare', args: name ? [name] : [], tone: 'bad' });
    } else if (baseOwned === true) {
      score += 1; evidence++;
      reasons.push({ key: 'bargainBaseOwned', args: [], tone: 'good' });
    } else {
      score -= 1; evidence++;
      reasons.push({ key: 'bargainNeedsBaseUnknown', args: [], tone: 'bad' });
    }
  } else if (dlc && !isStoreDlc(offer)) {
    score -= 1; evidence++;
    reasons.push({ key: 'bargainExtra', args: [], tone: 'bad' });
  }

  /* --- la valeur */
  const declared = readWorth(offer.worth);
  const currency = readCurrency(offer.worth);
  const source = worthSource(offer);
  if (declared !== null && declared > 0) {
    if (source === 'store') {
      const shown = `${amountText(declared)} ${currency || ''}`.trim();
      if (declared >= WORTH_THRESHOLD) { score += 1; evidence++; reasons.push({ key: 'bargainValueConfirmed', args: [shown], tone: 'good' }); } else reasons.push({ key: 'bargainValueSmall', args: [shown], tone: 'neutral' });
    } else {
      const cmp = compareWorth(declared, check);
      const shownDeclared = `${amountText(declared)} ${currency || COMPARE_CURRENCY}`.trim();
      if (cmp.state === 'unverifiable') {
        reasons.push({ key: 'bargainValueUnconfirmed', args: [shownDeclared], tone: 'neutral' });
      } else if (cmp.state === 'ok') {
        const shown = `${amountText(Math.min(cmp.declared, cmp.real))} ${COMPARE_CURRENCY}`;
        if (Math.min(cmp.declared, cmp.real) >= WORTH_THRESHOLD) { score += 1; evidence++; reasons.push({ key: 'bargainValueConfirmed', args: [shown], tone: 'good' }); } else reasons.push({ key: 'bargainValueSmall', args: [shown], tone: 'neutral' });
      } else {
        evidence++;
        score -= cmp.state === 'very' ? 3 : 2;
        reasons.push({ key: 'bargainInflated', args: [shownDeclared, `${amountText(cmp.real)} ${COMPARE_CURRENCY}`], tone: 'bad' });
      }
    }
  }

  /* --- les evaluations Steam */
  if (rating && rating.total > 0) {
    if (rating.total >= MIN_REVIEWS) {
      const r = ratedReason(rating);
      score += r.score; evidence++;
      reasons.push(r.reason);
    } else {
      reasons.push({ key: 'bargainFewReviews', args: [String(rating.total)], tone: 'neutral' });
    }
  }

  if (evidence === 0) {
    reasons.push({ key: 'bargainNoData', args: [], tone: 'neutral' });
    return { grade: null, reasons };
  }
  const note = score >= 3 ? GRADES.A : score >= 1 ? GRADES.B : score >= -1 ? GRADES.C : GRADES.D;
  /* Les mauvaises raisons d'abord : c'est ce qui sert a decider. */
  reasons.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
  return { grade: note, reasons };
}

const TONE_ORDER = Object.freeze({ bad: 0, good: 1, neutral: 2 });

/** La couleur de la pastille : good, mixed, bad, ou null (non evaluee). */
export function gradeTone(g) {
  if (g === GRADES.A || g === GRADES.B) return 'good';
  if (g === GRADES.C) return 'mixed';
  if (g === GRADES.D) return 'bad';
  return null;
}

/* ----------------------------------------------------------- le total vrai */

/**
 * Le total « verifie » des jeux PRIS, par devise.
 *
 * Chaque ligne : { store, title, worth: nombre|null, currency, source: 'store'|'aggregator'|null, appid }.
 *   - `store`  : le magasin a donne son propre prix -> compte tel quel ;
 *   - sinon, recoupee avec la fiche Steam (dollars) : comptee, plafonnee au
 *     prix Steam si l'annonce le depasse trop (l'excedent va dans `trimmed`) ;
 *   - un jeu que Steam dit gratuit de toute facon ne vaut rien (`excluded`) ;
 *   - une valeur qu'on ne peut pas recouper va dans `unverified` : annoncee,
 *     non comptee comme verifiee.
 */
export function certify(rows, checks = {}) {
  const verified = {};
  const unverified = {};
  const trimmed = {};
  let excluded = 0;
  let counted = 0;
  const add = (bag, cur, n) => { bag[cur] = (bag[cur] || 0) + n; };
  for (const r of rows || []) {
    if (!r || typeof r.worth !== 'number' || !(r.worth > 0)) continue;
    const cur = r.currency || '?';
    const c = r.appid ? checkFor(checks, r.appid) : null;
    if (c && c.isFree && c.type !== 'dlc') { excluded++; continue; }
    if (r.source === 'store') { add(verified, cur, r.worth); counted++; continue; }
    const cmp = r.currency === COMPARE_CURRENCY || !r.currency ? compareWorth(r.worth, c) : { state: 'unverifiable' };
    if (cmp.state === 'ok') { add(verified, cur, r.worth); counted++; } else if (cmp.state === 'inflated' || cmp.state === 'very') {
      add(verified, cur, cmp.real); add(trimmed, cur, r.worth - cmp.real); counted++;
    } else add(unverified, cur, r.worth);
  }
  const round = (bag) => Object.fromEntries(Object.entries(bag).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  return { verified: round(verified), unverified: round(unverified), trimmed: round(trimmed), excluded, counted };
}

/** Le jeu de base est-il a vous ? true / false / null (la collection ne le dit pas). */
export function baseGameOwned(check, offer, ownedKeys, collectionKnown) {
  const id = (check && check.fullgame) || (offer && offer.parentAppid) || null;
  if (!id) return null;
  if (!collectionKnown) return null;
  return ownedKeys && ownedKeys.has(`${STORES.STEAM}:${id}`) ? true : false;
}

/* ------------------------------------------------------------- l'assemblage */

/** Ce que la collection importee dit : { known, owned } -- known = Steam a ete importe au moins une fois. */
export function collectionFacts(collection) {
  const c = sanitiseCollection(collection);
  const st = c.stores && c.stores.steam;
  return { known: Boolean(st && st.lastOk), owned: ownedStoreKeys(c) };
}

/**
 * La note d'une offre depuis ce que le stockage garde : sa note Steam, sa
 * fiche de prix, la collection. Rend aussi l'appid trouve (ou null).
 */
export function verdictFor(offer, { ratings = {}, checks = {}, facts = null } = {}) {
  const appid = checkAppId(offer, ratings);
  const check = checkFor(checks, appid);
  const rating = ratingFor(ratings, offer);
  const baseOwned = baseGameOwned(check, offer, facts ? facts.owned : null, facts ? facts.known : false);
  return { ...grade({ offer, check, rating, baseOwned }), appid };
}

/* Les libelles, en TABLE : le build retrouve les cles ecrites en toutes lettres. */
const GRADE_KEYS = Object.freeze({ A: 'bargainGradeA', B: 'bargainGradeB', C: 'bargainGradeC', D: 'bargainGradeD' });

/** « Bonne affaire », « Pas une vraie affaire »... ; « Non evaluee » sans note. */
export function gradeLabel(g, t) {
  return t(GRADE_KEYS[g] || 'bargainGradeNone');
}

/* Les arguments qui sont des montants (« 24.99 EUR ») ou des comptes (« 100000 »),
   par raison : l'interface les met en forme dans SA langue (« 24,99 € »,
   « 100 000 »), le module garde le texte neutre que la copie Kotlin compare. */
const MONEY_ARGS = Object.freeze({
  bargainValueConfirmed: [0], bargainValueSmall: [0], bargainValueUnconfirmed: [0], bargainInflated: [0, 1],
});
const COUNT_ARGS = Object.freeze({
  bargainRatedHigh: [1], bargainRatedGood: [1], bargainRatedMixed: [1], bargainRatedLow: [1], bargainFewReviews: [0],
});

function formatArg(key, i, arg, fmt) {
  if (MONEY_ARGS[key] && MONEY_ARGS[key].includes(i)) {
    const m = /^(\d+(?:\.\d+)?)\s*([A-Za-z?]*)$/.exec(String(arg));
    return m ? fmt.money(Number(m[1]), m[2] || null) : arg;
  }
  if (COUNT_ARGS[key] && COUNT_ARGS[key].includes(i)) {
    const n = Number(arg);
    return Number.isFinite(n) ? fmt.number(n) : arg;
  }
  return arg;
}

/** Une raison, dans la langue choisie. `fmt` = { money(n, devise), number(n) } : la mise en forme locale. */
export function reasonText(reason, t, fmt = null) {
  const args = fmt ? reason.args.map((a, i) => formatArg(reason.key, i, a, fmt)) : reason.args;
  return t(reason.key, ...args);
}

/** Toutes les raisons, une par ligne : l'infobulle. */
export function verdictTitle(result, t, fmt = null) {
  const lignes = result.reasons.map((r) => `\u2022 ${reasonText(r, t, fmt)}`);
  return [t('bargainTitle', result.grade || '?', gradeLabel(result.grade, t)), ...lignes].join('\n');
}

/** La ligne d'une notification : « Verdict B : Bonne affaire. Bien note sur Steam... ». Vide sans note. */
export function verdictLine(result, t, fmt = null) {
  if (!result || !result.grade || !result.reasons.length) return '';
  return t('bargainLine', result.grade, gradeLabel(result.grade, t), reasonText(result.reasons[0], t, fmt));
}
