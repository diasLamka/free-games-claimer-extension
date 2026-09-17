/* Tests de l'ordonnanceur.
 *
 * C'est le module le plus subtil de la veille : trois regimes qui se
 * superposent, deux freins, et une horloge. Tout est teste avec un instant
 * injecte, jamais avec l'heure reelle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REGIMES,
  DEFAULTS,
  floorForSource,
  floorIntervalMs,
  dailyCap,
  backoffAfterFailures,
  budgetDay,
  budgetSpent,
  hotInstants,
  isHot,
  nextHotStart,
  scheduleSource,
  schedule,
  afterSuccess,
  afterFailure,
} from '../watch/schedule/scheduler.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* Un jeudi, 09:00 UTC. Le drop Epic du jeudi tombe a 15:00 UTC ce jour-la. */
const T = Date.parse('2026-08-27T09:00:00Z');
const REGLE_EPIC = { zone: 'America/New_York', dayCount: [4], hour: 11 };

/* --------------------------------------------------------------- reglages */

test('le plancher se regle globalement et par magasin', () => {
  assert.equal(floorForSource({}, 'epic'), DEFAULTS.floorPerDay);
  assert.equal(floorForSource({ floorPerDay: 6 }, 'epic'), 6);
  assert.equal(floorForSource({ floorPerDay: 6, overrides: { epic: 12 } }, 'epic'), 12);
  assert.equal(floorForSource({ floorPerDay: 6, overrides: { epic: 12 } }, 'gog'), 6);
});

test('le plancher reste dans les bornes de l\'interface', () => {
  assert.equal(floorForSource({ floorPerDay: 0 }, 'x'), 1);
  assert.equal(floorForSource({ floorPerDay: -5 }, 'x'), 1);
  assert.equal(floorForSource({ floorPerDay: 99 }, 'x'), 24);
  assert.equal(floorForSource({ floorPerDay: 3.4 }, 'x'), 3);
});

test('l\'intervalle du plancher decoule du nombre de verifications', () => {
  assert.equal(floorIntervalMs({ floorPerDay: 3 }, 'x'), 8 * HOUR);
  assert.equal(floorIntervalMs({ floorPerDay: 24 }, 'x'), 1 * HOUR);
  assert.equal(floorIntervalMs({ floorPerDay: 1 }, 'x'), 24 * HOUR);
});

test('le plafond journalier se derive du plancher et ne se saisit jamais', () => {
  // Deux reglages qui peuvent se contredire finissent par se contredire.
  assert.equal(dailyCap({ floorPerDay: 3 }, 'x'), 120);
  assert.equal(dailyCap({ floorPerDay: 24 }, 'x'), 240);
  // Il reste toujours au-dessus du plancher : un plafond qui interdirait le
  // plancher regle serait une contradiction silencieuse.
  for (const n of [1, 3, 6, 12, 24]) {
    assert.ok(dailyCap({ floorPerDay: n }, 'x') > n, `plafond trop bas pour ${n}`);
  }
});

test('le recul apres echec double puis plafonne', () => {
  assert.equal(backoffAfterFailures(0), 0);
  assert.equal(backoffAfterFailures(1), 15 * MINUTE);
  assert.equal(backoffAfterFailures(2), 30 * MINUTE);
  assert.equal(backoffAfterFailures(3), 60 * MINUTE);
  assert.equal(backoffAfterFailures(10), DEFAULTS.maxBackoffMs);
  assert.equal(backoffAfterFailures(1000), DEFAULTS.maxBackoffMs);
});

/* ----------------------------------------------------------------- budget */

test('le budget se compte par jour UTC et se remet a zero au changement de jour', () => {
  assert.equal(budgetDay(Date.parse('2026-08-27T23:59:59Z')), '2026-08-27');
  assert.equal(budgetDay(Date.parse('2026-08-28T00:00:00Z')), '2026-08-28');

  const state = { budget: { day: '2026-08-27', spent: 40 } };
  assert.equal(budgetSpent(state, Date.parse('2026-08-27T12:00:00Z')), 40);
  assert.equal(budgetSpent(state, Date.parse('2026-08-28T12:00:00Z')), 0);
  assert.equal(budgetSpent({}, T), 0);
});

test('une source qui a epuise son budget n\'est pas due, et repart demain', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    state: { lastCall: T - 10 * HOUR, budget: { day: '2026-08-27', spent: 120 } },
    now: T,
  });
  assert.equal(r.dueNow, false);
  assert.equal(r.regime, REGIMES.BUDGET);
  assert.equal(r.nextInstant, Date.parse('2026-08-28T00:00:00Z'));
});

/* --------------------------------------------------------- creneaux chauds */

test('un creneau reste chaud pendant la demi-heure qui suit le drop', () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const hotList = [drop];
  assert.equal(isHot(hotList, drop - 31 * MINUTE), false);
  assert.equal(isHot(hotList, drop - 30 * MINUTE), true);
  assert.equal(isHot(hotList, drop), true);
  assert.equal(isHot(hotList, drop + 30 * MINUTE), true);
  assert.equal(isHot(hotList, drop + 31 * MINUTE), false);
});

test('instantsChauds voit le creneau du jour depuis une regle de calendrier', () => {
  const juste = Date.parse('2026-08-27T15:10:00Z'); // 10 min apres le drop
  const hotList = hotInstants({ rules: [REGLE_EPIC] }, juste);
  assert.ok(hotList.includes(Date.parse('2026-08-27T15:00:00Z')),
    'le creneau tout juste franchi a disparu');
  assert.equal(isHot(hotList, juste), true);
});

test('instantsChauds accepte les fenetres que la source annonce elle-meme', () => {
  // Epic publie ses prochaines ouvertures : on n'a pas a les predire.
  const annoncee = Date.parse('2026-08-27T15:00:00Z');
  const hotList = hotInstants({ announcedWindows: [annoncee] }, T);
  assert.deepEqual(hotList, [annoncee]);
});

test('instantsChauds ignore ce qui est hors horizon', () => {
  const tresLoin = T + 30 * DAY;
  const hotList = hotInstants({ announcedWindows: [tresLoin] }, T);
  assert.equal(hotList.length, 0);
});

test('prochainDebutChaud vise l\'ouverture de la fenetre, pas l\'instant du drop', () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const start = nextHotStart([drop], T);
  assert.equal(start, drop - 30 * MINUTE);
});

/* ---------------------------------------------------------------- regimes */

test('une source jamais interrogee est due tout de suite', () => {
  const r = scheduleSource({ source: 'gamerpower', state: {}, now: T });
  assert.equal(r.dueNow, true);
  assert.equal(r.reasonText, 'jamais interrogee');
});

test('le plancher tient quand il ne se passe rien', () => {
  const settings = { floorPerDay: 3 }; // toutes les 8 h

  const tot = scheduleSource({
    source: 'gamerpower', settings, state: { lastCall: T - 7 * HOUR }, now: T,
  });
  assert.equal(tot.dueNow, false);
  assert.equal(tot.regime, REGIMES.FLOOR);
  assert.equal(tot.nextInstant, T - 7 * HOUR + 8 * HOUR);

  const mur = scheduleSource({
    source: 'gamerpower', settings, state: { lastCall: T - 8 * HOUR }, now: T,
  });
  assert.equal(mur.dueNow, true);
});

test('le creneau chaud resserre la cadence bien au-dela du plancher', () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const pendant = drop + 5 * MINUTE;

  // Interrogee il y a 8 minutes : le plancher dirait non, le creneau dit oui.
  const r = scheduleSource({
    source: 'epic-api',
    settings: { floorPerDay: 3 },
    state: { lastCall: pendant - 8 * MINUTE },
    announcedWindows: [drop],
    now: pendant,
  });
  assert.equal(r.regime, REGIMES.HOT);
  assert.equal(r.dueNow, true);
});

test('la poursuite resserre aussi, mais moins que le creneau chaud', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    settings: { floorPerDay: 3 },
    state: { lastCall: T - 11 * MINUTE },
    chasing: true,
    now: T,
  });
  assert.equal(r.regime, REGIMES.CHASE);
  assert.equal(r.dueNow, true);

  const tropTot = scheduleSource({
    source: 'gamerpower',
    state: { lastCall: T - 5 * MINUTE },
    chasing: true,
    now: T,
  });
  assert.equal(tropTot.dueNow, false);
});

test('le creneau chaud l\'emporte sur la poursuite', () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const r = scheduleSource({
    source: 'epic-api',
    state: { lastCall: drop - 8 * MINUTE },
    announcedWindows: [drop],
    chasing: true,
    now: drop,
  });
  assert.equal(r.regime, REGIMES.HOT);
});

/* ------------------------------------------------------------------ pannes */

test('une source qui vient d\'echouer se repose avant de reessayer', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    state: { lastCall: T - 5 * MINUTE, consecutiveFailures: 1 },
    now: T,
  });
  assert.equal(r.dueNow, false);
  assert.equal(r.regime, REGIMES.OUTAGE);
  assert.equal(r.nextInstant, T - 5 * MINUTE + 15 * MINUTE);
});

test('le recul est purge une fois passe', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    state: { lastCall: T - 20 * MINUTE, consecutiveFailures: 1 },
    settings: { floorPerDay: 24 }, // une par heure
    now: T,
  });
  // Le recul de 15 min est passe, mais l'intervalle du plancher (1 h) ne l'est
  // pas : la source n'est pas due pour autant.
  assert.equal(r.regime, REGIMES.FLOOR);
  assert.equal(r.dueNow, false);
});

test('le budget l\'emporte meme sur une source en panne', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    state: {
      lastCall: T - MINUTE,
      consecutiveFailures: 5,
      budget: { day: '2026-08-27', spent: 500 },
    },
    now: T,
  });
  assert.equal(r.regime, REGIMES.BUDGET);
});

/* -------------------------------------------------- la machine a dormi */

test('trois jours de sommeil ne declenchent pas trois cycles de rattrapage', () => {
  const r = scheduleSource({
    source: 'gamerpower',
    settings: { floorPerDay: 3 },
    state: { lastCall: T - 3 * DAY },
    now: T,
  });
  assert.equal(r.dueNow, true);
  // Une seule source due, un seul cycle. Rien ne compte les occasions manquees.
  const plan = schedule({
    sources: ['gamerpower'],
    states: { gamerpower: { lastCall: T - 3 * DAY } },
    settings: { floorPerDay: 3 },
    now: T,
  });
  assert.deepEqual(plan.dueList, ['gamerpower']);
});

/* --------------------------------------------------------------- le plan */

test('planifier rend les sources dues et le prochain reveil', () => {
  const plan = schedule({
    sources: ['epic-api', 'gamerpower'],
    states: {
      'epic-api': { lastCall: T - 1 * HOUR },
      gamerpower: { lastCall: T - 9 * HOUR },
    },
    settings: { floorPerDay: 3 }, // 8 h
    now: T,
  });

  assert.deepEqual(plan.dueList, ['gamerpower']);
  // epic-api n'est pas due : reveil a son echeance, dans 7 h.
  assert.equal(plan.nextWake, T - HOUR + 8 * HOUR);
  assert.equal(plan.detail.length, 2);
});

test('le reveil vise l\'ouverture du creneau chaud quand elle arrive avant l\'echeance', () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const plan = schedule({
    sources: ['epic-api'],
    states: { 'epic-api': { lastCall: T } },
    settings: { floorPerDay: 3 }, // echeance a T + 8 h = 17:00Z
    windowsBySource: { 'epic-api': [drop] },
    now: T,
  });
  // L'ouverture du creneau (14:30Z) arrive avant l'echeance du plancher.
  assert.equal(plan.nextWake, drop - 30 * MINUTE);
});

test('planifier rend un reveil nul quand plus rien n\'est prevu', () => {
  const plan = schedule({ sources: [], states: {}, now: T });
  assert.deepEqual(plan.dueList, []);
  assert.equal(plan.nextWake, null);
});

test('planifier refuse de travailler sans instant', () => {
  assert.throws(() => schedule({ sources: ['x'] }), TypeError);
});

test('une source due n\'entre pas dans le calcul du prochain reveil', () => {
  // Elle va tourner tout de suite : c'est son resultat qui fixera la suite.
  const plan = schedule({
    sources: ['a', 'b'],
    states: { a: {}, b: { lastCall: T - HOUR } },
    settings: { floorPerDay: 3 },
    now: T,
  });
  assert.deepEqual(plan.dueList, ['a']);
  assert.equal(plan.nextWake, T - HOUR + 8 * HOUR);
});

/* ------------------------------------------------------- mise a jour d'etat */

test('apresSucces remet les echecs a zero et consomme du budget', () => {
  const e0 = { lastCall: T - HOUR, consecutiveFailures: 3, lastError: 'boum' };
  const e1 = afterSuccess(e0, T);
  assert.equal(e1.lastCall, T);
  assert.equal(e1.consecutiveFailures, 0);
  assert.equal(e1.lastError, null);
  assert.deepEqual(e1.budget, { day: '2026-08-27', spent: 1 });

  const e2 = afterSuccess(e1, T + MINUTE);
  assert.equal(e2.budget.spent, 2);
});

test('apresEchec compte les echecs et consomme du budget lui aussi', () => {
  // Sinon une source en panne bouclerait sans jamais entamer son plafond --
  // exactement le scenario que le plafond doit empecher.
  const e1 = afterFailure({}, T, 'HTTP 503');
  assert.equal(e1.consecutiveFailures, 1);
  assert.equal(e1.lastError, 'HTTP 503');
  assert.equal(e1.budget.spent, 1);

  const e2 = afterFailure(e1, T + MINUTE, 'HTTP 503');
  assert.equal(e2.consecutiveFailures, 2);
  assert.equal(e2.budget.spent, 2);
});

test('le budget repart de zero au changement de jour', () => {
  const veille = afterSuccess({ budget: { day: '2026-08-26', spent: 119 } }, T);
  assert.deepEqual(veille.budget, { day: '2026-08-27', spent: 1 });
});

/* ------------------------------------------------- scenario de bout en bout */

test('scenario : une journee complete sur Epic, du plancher au creneau chaud', () => {
  const settings = { floorPerDay: 3 };
  const drop = Date.parse('2026-08-27T15:00:00Z');
  let state = {};
  const cycles = [];

  // Toutes les 5 minutes pendant 24 heures, on demande a l'ordonnanceur.
  for (let t = Date.parse('2026-08-27T00:00:00Z'); t < Date.parse('2026-08-28T00:00:00Z'); t += 5 * MINUTE) {
    const r = scheduleSource({
      source: 'epic-api', state, settings, announcedWindows: [drop], now: t,
    });
    if (r.dueNow) {
      cycles.push({ t, regime: r.regime });
      state = afterSuccess(state, t);
    }
  }

  const hotList = cycles.filter((c) => c.regime === REGIMES.HOT);
  const planchers = cycles.filter((c) => c.regime === REGIMES.FLOOR);

  // Le plancher garantit son minimum sur la journee.
  assert.ok(planchers.length >= 3, `seulement ${planchers.length} verifications de plancher`);
  // Le creneau d'une heure autour du drop est couvert densement.
  assert.ok(hotList.length >= 5, `seulement ${hotList.length} verifications en creneau chaud`);
  // Et tout cela reste tres en dessous du plafond.
  assert.ok(cycles.length < dailyCap(settings, 'epic-api'),
    `${cycles.length} cycles pour un plafond de ${dailyCap(settings, 'epic-api')}`);

  // Aucun cycle en dehors de la fenetre chaude ne doit tomber a moins de 8 h
  // du precedent cycle de plancher.
  for (let i = 1; i < planchers.length; i++) {
    assert.ok(planchers[i].t - planchers[i - 1].t >= 8 * HOUR - 5 * MINUTE,
      'deux verifications de plancher trop rapprochees');
  }
});
