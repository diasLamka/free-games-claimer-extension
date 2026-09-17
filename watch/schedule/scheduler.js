/* L'ordonnanceur : decide QUAND interroger chaque source.
 *
 * Fonction pure de bout en bout. On lui donne l'etat du monde et un instant,
 * elle rend ce qui est du maintenant et quand se reveiller ensuite. Elle ne
 * lit pas l'horloge, ne touche pas au stockage, ne connait pas chrome.alarms :
 * le cablage est ailleurs, et c'est ce qui rend cette logique -- la plus
 * subtile de la veille -- testable en entier.
 *
 * Trois regimes se superposent, du plus urgent au plus lache :
 *
 *   POURSUITE  une offre est reperee mais pas encore traitee, ou sa date de
 *              fin approche : on resserre jusqu'a resolution.
 *   CHAUD      on est dans une fenetre ou cette source lache habituellement,
 *              ou dans une fenetre qu'elle a elle-meme annoncee.
 *   PLANCHER   le minimum garanti, regle par l'utilisateur : N verifications
 *              par jour quoi qu'il arrive. C'est le filet.
 *
 * Et deux freins :
 *
 *   PANNE      la source vient d'echouer : recul exponentiel avant de
 *              reessayer, pour ne pas marteler un service en difficulte.
 *   BUDGET     le plafond de requetes du jour est atteint. La prediction sert
 *              a REPARTIR ce budget, jamais a l'augmenter.
 */
import { nextOccurrence } from './clock.js';

export const REGIMES = Object.freeze({
  CHASE: 'poursuite',
  HOT: 'chaud',
  FLOOR: 'plancher',
  OUTAGE: 'panne',
  BUDGET: 'budget',
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULTS = Object.freeze({
  /** Verifications minimum par jour. Reglable de 1 a 24 dans l'interface. */
  floorPerDay: 3,

  /** Demi-largeur d'un creneau chaud, de part et d'autre de l'instant attendu. */
  hotHalfWindowMs: 30 * MINUTE,

  /** Cadence dans un creneau chaud. */
  hotIntervalMs: 7 * MINUTE,

  /** Cadence quand une offre attend d'etre traitee. */
  chaseIntervalMs: 10 * MINUTE,

  /**
   * Le plafond journalier se DERIVE du plancher, il ne se saisit pas : deux
   * reglages qui peuvent se contredire finissent par se contredire. Il n'est
   * pas la pour rationner l'usage normal -- un creneau chaud consomme deja une
   * quinzaine de requetes -- mais pour borner une boucle emballee.
   */
  capFactor: 10,
  minCap: 120,

  /** Recul apres echec : double a chaque echec consecutif, jusqu'au plafond. */
  initialBackoffMs: 15 * MINUTE,
  maxBackoffMs: 6 * HOUR,

  /** Horizon de recherche des creneaux a venir, pour armer le reveil. */
  horizonMs: 7 * DAY,
});

/* --------------------------------------------------------------- reglages */

export function floorForSource(settings, source) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  const override = r.overrides && r.overrides[source];
  const n = Number.isFinite(override) ? override : r.floorPerDay;
  return Math.min(24, Math.max(1, Math.round(n)));
}

export function floorIntervalMs(settings, source) {
  return Math.round(DAY / floorForSource(settings, source));
}

export function dailyCap(settings, source) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  return Math.max(r.minCap, floorForSource(settings, source) * r.capFactor);
}

export function backoffAfterFailures(failures, settings) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  if (!failures || failures < 1) return 0;
  return Math.min(r.maxBackoffMs, r.initialBackoffMs * 2 ** (failures - 1));
}

/** Cle du jour pour le budget. En UTC : deterministe, et independante du voyage. */
export function budgetDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function budgetSpent(state, now) {
  const b = state && state.budget;
  if (!b || b.day !== budgetDay(now)) return 0;
  return b.spent || 0;
}

/* ------------------------------------------------------------- creneaux chauds */

/**
 * Instants chauds d'une source : ceux que ses regles de calendrier annoncent,
 * et ceux que la source a elle-meme publies.
 *
 * La recherche demarre avant `maintenant`, d'une demi-fenetre : sans cela, un
 * creneau tout juste franchi ne serait plus vu comme chaud, alors qu'on est
 * justement dans les trente minutes qui suivent le drop.
 */
export function hotInstants({ rules = [], announcedWindows = [] }, now, settings) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  const start = now - r.hotHalfWindowMs;
  const limit = now + r.horizonMs;
  const instants = [];

  for (const rule of rules) {
    let cursor = start - 1;
    // Deux occurrences suffisent : celle qui peut nous rendre chauds
    // maintenant, et la prochaine, qui servira a armer le reveil.
    for (let i = 0; i < 2; i++) {
      const o = nextOccurrence(rule, cursor);
      if (!o || o.instant > limit) break;
      instants.push(o.instant);
      cursor = o.instant;
    }
  }

  for (const instant of announcedWindows) {
    if (typeof instant === 'number' && instant >= start && instant <= limit) instants.push(instant);
  }

  return instants.sort((a, b) => a - b);
}

export function isHot(instants, now, settings) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  return instants.some((i) => Math.abs(now - i) <= r.hotHalfWindowMs);
}

/** Debut du prochain creneau chaud, pour armer le reveil dessus. */
export function nextHotStart(instants, now, settings) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  for (const i of instants) {
    const start = i - r.hotHalfWindowMs;
    if (start > now) return start;
  }
  return null;
}

/* ----------------------------------------------------------- une source */

/**
 * Decide pour une source : est-elle due, sous quel regime, et quand la
 * reveiller si elle ne l'est pas.
 */
export function scheduleSource({
  source,
  state = {},
  settings,
  rules = [],
  announcedWindows = [],
  chasing = false,
  /**
   * Plancher impose par la source elle-meme, quel que soit le regime.
   * L'agregateur sert ses reponses derriere un CDN avec Cache-Control:
   * max-age=600 : l'interroger plus souvent relit le meme cache. Cout reel,
   * gain nul, et impossible a distinguer d'un vrai fonctionnement.
   */
  minIntervalMs = 0,
  now,
}) {
  const r = { ...DEFAULTS, ...(settings || {}) };
  const lastCall = state.lastCall ?? null;

  // Budget : le frein le plus fort, il l'emporte sur tout le reste.
  const spent = budgetSpent(state, now);
  const cap = dailyCap(settings, source);
  if (spent >= cap) {
    const tomorrow = Date.parse(budgetDay(now) + 'T00:00:00Z') + DAY;
    return {
      source, dueNow: false, regime: REGIMES.BUDGET, nextInstant: tomorrow,
      reasonText: `plafond du jour atteint (${spent}/${cap})`,
    };
  }

  // Recul apres echecs : on ne martele pas un service en difficulte.
  const backoff = backoffAfterFailures(state.consecutiveFailures, settings);
  if (backoff && lastCall !== null && now < lastCall + backoff) {
    return {
      source, dueNow: false, regime: REGIMES.OUTAGE, nextInstant: lastCall + backoff,
      reasonText: `${state.consecutiveFailures} echec(s) consecutif(s), repos jusqu'a la prochaine tentative`,
    };
  }

  const hotList = hotInstants({ rules, announcedWindows }, now, settings);
  const inWindow = isHot(hotList, now, settings);

  let regime;
  let interval;
  if (inWindow) {
    regime = REGIMES.HOT;
    interval = r.hotIntervalMs;
  } else if (chasing) {
    regime = REGIMES.CHASE;
    interval = r.chaseIntervalMs;
  } else {
    regime = REGIMES.FLOOR;
    interval = floorIntervalMs(settings, source);
  }

  interval = Math.max(interval, minIntervalMs);

  // Jamais interrogee : due tout de suite. Une machine qui a dormi trois jours
  // ne declenche pas trois cycles de rattrapage, juste un.
  if (lastCall === null) {
    return { source, dueNow: true, regime, nextInstant: now, reasonText: 'jamais interrogee' };
  }

  const deadline = lastCall + interval;
  if (now >= deadline) {
    return { source, dueNow: true, regime, nextInstant: now, reasonText: `regime ${regime}` };
  }

  // Pas due : le reveil vise la premiere des deux echeances -- la fin de
  // l'intervalle courant, ou l'ouverture du prochain creneau chaud.
  const hotStart = nextHotStart(hotList, now, settings);
  const nextInstant = hotStart === null ? deadline : Math.min(deadline, hotStart);

  return { source, dueNow: false, regime, nextInstant, reasonText: `prochaine echeance en regime ${regime}` };
}

/* --------------------------------------------------------- toutes les sources */

/**
 * Plan complet : ce qu'il faut interroger maintenant, et quand se reveiller.
 *
 * `prochainReveil` vaut null quand plus rien n'est prevu -- ce qui ne devrait
 * pas arriver tant qu'au moins une source est active, mais l'appelant doit
 * garder son alarme de securite pour ce cas.
 */
export function schedule({
  sources = [],
  states = {},
  settings,
  rulesBySource = {},
  windowsBySource = {},
  chasesBySource = {},
  minIntervals = {},
  now,
}) {
  if (typeof now !== 'number') throw new TypeError('planifier : "maintenant" est obligatoire');

  const detail = sources.map((source) => scheduleSource({
    source,
    state: states[source] || {},
    settings,
    rules: rulesBySource[source] || [],
    announcedWindows: windowsBySource[source] || [],
    chasing: Boolean(chasesBySource[source]),
    minIntervalMs: minIntervals[source] || 0,
    now,
  }));

  const dueList = detail.filter((d) => d.dueNow).map((d) => d.source);

  const instants = detail
    .filter((d) => !d.dueNow && typeof d.nextInstant === 'number' && d.nextInstant > now)
    .map((d) => d.nextInstant);

  return {
    dueList,
    nextWake: instants.length ? Math.min(...instants) : null,
    detail,
  };
}

/* ------------------------------------------------------- mise a jour d'etat */

/** Etat d'une source apres un cycle reussi. */
export function afterSuccess(state, now) {
  const day = budgetDay(now);
  const sameDay = state && state.budget && state.budget.day === day;
  return {
    ...state,
    lastCall: now,
    consecutiveFailures: 0,
    lastError: null,
    budget: { day, spent: (sameDay ? state.budget.spent : 0) + 1 },
  };
}

/**
 * Etat d'une source apres un echec.
 *
 * Une tentative ratee consomme du budget elle aussi : sinon une source en
 * panne pourrait boucler sans jamais l'entamer, ce qui est exactement le
 * scenario que le plafond doit empecher.
 */
export function afterFailure(state, now, message) {
  const day = budgetDay(now);
  const sameDay = state && state.budget && state.budget.day === day;
  return {
    ...state,
    lastCall: now,
    consecutiveFailures: ((state && state.consecutiveFailures) || 0) + 1,
    lastError: message || 'echec sans message',
    budget: { day, spent: (sameDay ? state.budget.spent : 0) + 1 },
  };
}
