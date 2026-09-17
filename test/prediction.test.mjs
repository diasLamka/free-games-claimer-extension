/* Tests de la couche apprenante.
 *
 * Le test central est celui du biais d'observation : c'est le mode d'echec qui
 * ne leve aucune erreur et donne l'apparence du bon fonctionnement. Il est
 * reproduit ici par simulation, pas asserte par principe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HALF_LIFE_MS,
  MAX_INTERVAL_MS,
  MIN_OBSERVATIONS,
  CELL_COUNT,
  emptyStat,
  cellKey,
  decay,
  totalWeight,
  creditInstant,
  creditInterval,
  observe,
  hotCells,
  learnedHotInstants,
  band24h,
  isTrustworthy,
} from '../watch/schedule/prediction.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/* Un jeudi, 15:00 UTC -- l'heure a laquelle Epic ouvre le plus souvent. */
const JEUDI_15H = Date.parse('2026-08-27T15:00:00Z');

/* ------------------------------------------------------------------ cases */

test('cleCase situe un instant en jour de semaine et heure UTC', () => {
  assert.equal(cellKey(JEUDI_15H), '4-15');                       // jeudi, 15 h
  assert.equal(cellKey(Date.parse('2026-08-23T00:30:00Z')), '0-0'); // dimanche, minuit
  assert.equal(cellKey(Date.parse('2026-08-29T23:59:00Z')), '6-23');
});

test('une statistique vide ne pretend rien', () => {
  const s = emptyStat();
  assert.equal(totalWeight(s), 0);
  assert.deepEqual(hotCells(s), []);
  assert.equal(isTrustworthy(s), false);
  assert.deepEqual(learnedHotInstants(s, JEUDI_15H), []);
});

/* ----------------------------------------------------------------- credit */

test('crediterInstant depose tout le poids sur une seule case', () => {
  const s = creditInstant(emptyStat(), JEUDI_15H, JEUDI_15H);
  assert.equal(totalWeight(s), 1);
  assert.equal(s.cells['4-15'].weight, 1);
  assert.equal(s.cells['4-15'].observations, 1);
  assert.equal(s.observations, 1);
});

test('crediterIntervalle repartit un credit total de 1 au prorata du temps', () => {
  // De 14:30 a 16:30 : 30 min dans la case 14, 60 dans la 15, 30 dans la 16.
  const start = Date.parse('2026-08-27T14:30:00Z');
  const end = Date.parse('2026-08-27T16:30:00Z');
  const s = creditInterval(emptyStat(), start, end, end);

  assert.ok(Math.abs(totalWeight(s) - 1) < 1e-9, `total = ${totalWeight(s)}`);
  assert.ok(Math.abs(s.cells['4-14'].weight - 0.25) < 1e-9);
  assert.ok(Math.abs(s.cells['4-15'].weight - 0.5) < 1e-9);
  assert.ok(Math.abs(s.cells['4-16'].weight - 0.25) < 1e-9);
  assert.equal(s.observations, 1);
});

test('un intervalle trop large compte l\'observation sans la situer', () => {
  // Machine eteinte trois jours : repartir sur 72 cases ajouterait du bruit
  // partout au lieu d'apprendre quoi que ce soit.
  const end = JEUDI_15H;
  const start = end - 3 * DAY;
  const s = creditInterval(emptyStat(), start, end, end);

  assert.equal(totalWeight(s), 0, 'du poids a ete depose malgre un intervalle de 3 jours');
  assert.equal(s.observations, 1, 'l\'observation elle-meme doit rester comptee');
  assert.ok(3 * DAY > MAX_INTERVAL_MS);
});

test('crediterIntervalle tolere un intervalle nul ou inverse', () => {
  const s = creditInterval(emptyStat(), JEUDI_15H, JEUDI_15H, JEUDI_15H);
  assert.equal(totalWeight(s), 1);
  assert.equal(s.cells['4-15'].weight, 1);
});

/* ------------------------------------------------------- le biais central */

test('la date publiee par la source prime sur l\'heure du sondage', () => {
  // C'est la correction principale du biais : l'agregateur publie l'heure de
  // mise en ligne sur toutes ses offres.
  const heureDuSondage = Date.parse('2026-08-27T23:00:00Z'); // case 4-23
  const offer = { start: JEUDI_15H };                        // case 4-15

  const s = observe(emptyStat(), offer, {
    now: heureDuSondage,
    lastEmptyPoll: heureDuSondage - 8 * HOUR,
  });

  assert.equal(s.cells['4-15'].weight, 1, 'la date publiee n\'a pas ete utilisee');
  assert.equal(s.cells['4-23'], undefined, 'l\'heure du sondage a ete creditee a tort');
});

test('sans date publiee, l\'apprentissage ne se replie PAS sur l\'heure du sondage', () => {
  // Simulation du piege : une source qui lache toujours a 15:00, sondee
  // uniquement a 20:00. Si l'histogramme credite l'heure du sondage, il
  // apprend 20:00 -- son propre rythme -- et se renforce lui-meme.
  let stat = emptyStat();
  for (let semaine = 0; semaine < 8; semaine++) {
    const sondage = JEUDI_15H + semaine * 7 * DAY + 5 * HOUR;      // 20:00
    const sondagePrecedent = sondage - 6 * HOUR;                    // 14:00
    stat = observe(stat, { start: null }, {
      now: sondage,
      lastEmptyPoll: sondagePrecedent,
    });
  }

  const hotKeys = hotCells(stat, { now: JEUDI_15H + 8 * 7 * DAY });
  const heuresChaudes = hotKeys.map((c) => c.hour);

  // Le credit est reparti sur 14 h -> 20 h : aucune heure ne doit ressortir
  // seule, et surtout pas 20 h, qui n'est que notre habitude.
  if (heuresChaudes.length) {
    assert.ok(!(heuresChaudes.length === 1 && heuresChaudes[0] === 20),
      'l\'histogramme a appris l\'heure du sondage, pas celle du drop');
  }
  // Le poids doit etre etale, pas concentre.
  const weight = Object.values(stat.cells).map((c) => c.weight);
  const max = Math.max(...weight);
  assert.ok(max < totalWeight(stat) * 0.5,
    `une case concentre ${(max / totalWeight(stat) * 100).toFixed(0)} % du poids`);
});

test('avec la date publiee, le vrai creneau ressort net', () => {
  let stat = emptyStat();
  for (let semaine = 0; semaine < 8; semaine++) {
    const drop = JEUDI_15H + semaine * 7 * DAY;
    stat = observe(stat, { start: drop }, { now: drop + 5 * HOUR });
  }

  const hotKeys = hotCells(stat, { now: JEUDI_15H + 8 * 7 * DAY });
  assert.ok(hotKeys.length >= 1, 'aucun creneau appris malgre huit observations nettes');
  assert.equal(hotKeys[0].day, 4);
  assert.equal(hotKeys[0].hour, 15);
});

/* ------------------------------------------------------------ decroissance */

test('le poids decroit de moitie en une demi-vie', () => {
  const s = creditInstant(emptyStat(), JEUDI_15H, JEUDI_15H);
  const apres = decay(s, JEUDI_15H + HALF_LIFE_MS);
  assert.ok(Math.abs(apres.cells['4-15'].weight - 0.5) < 1e-9);
});

test('une case oubliee depuis longtemps disparait du stockage', () => {
  // Sinon elle se traine pour toujours en pesant zero.
  const s = creditInstant(emptyStat(), JEUDI_15H, JEUDI_15H);
  const apres = decay(s, JEUDI_15H + 20 * HALF_LIFE_MS);
  assert.deepEqual(apres.cells, {});
});

test('un changement d\'horaire finit par l\'emporter sur l\'ancien', () => {
  // Un magasin qui deplace son drop ne doit pas garder eternellement un
  // creneau mort dans l'histogramme.
  let stat = emptyStat();
  const debutAncien = JEUDI_15H;
  for (let i = 0; i < 10; i++) {
    const d = debutAncien + i * 7 * DAY;
    stat = observe(stat, { start: d }, { now: d });
  }

  // Un an plus tard, le magasin lache desormais a 20:00.
  const bascule = debutAncien + 365 * DAY;
  for (let i = 0; i < 10; i++) {
    const d = bascule + i * 7 * DAY + 5 * HOUR;
    stat = observe(stat, { start: d }, { now: d });
  }

  const hotKeys = hotCells(stat, { now: bascule + 10 * 7 * DAY });
  assert.ok(hotKeys.length >= 1);
  assert.equal(hotKeys[0].hour, 20, `le creneau dominant est ${hotKeys[0].hour} h`);
});

/* --------------------------------------------------------------- seuils */

test('une case isolee ne devient pas chaude', () => {
  // Sans minimum d'observations, la toute premiere serait declaree chaude.
  const s = creditInstant(emptyStat(), JEUDI_15H, JEUDI_15H);
  assert.deepEqual(hotCells(s, { now: JEUDI_15H }), []);
  assert.ok(MIN_OBSERVATIONS > 1);
});

test('des observations eparpillees ne produisent aucun creneau', () => {
  // Une source vraiment aleatoire ne doit rien faire ressortir : c'est le cas
  // de Steam, qui n'a aucun calendrier public.
  let stat = emptyStat();
  for (let i = 0; i < CELL_COUNT; i++) {
    const t = JEUDI_15H + i * HOUR;
    stat = observe(stat, { start: t }, { now: t });
  }
  assert.deepEqual(hotCells(stat, { now: JEUDI_15H + CELL_COUNT * HOUR }), []);
});

test('estFiable demande plus qu\'une poignee d\'observations', () => {
  let stat = emptyStat();
  for (let i = 0; i < MIN_OBSERVATIONS * 2 - 1; i++) {
    stat = observe(stat, { start: JEUDI_15H }, { now: JEUDI_15H });
  }
  assert.equal(isTrustworthy(stat), false);
  stat = observe(stat, { start: JEUDI_15H }, { now: JEUDI_15H });
  assert.equal(isTrustworthy(stat), true);
});

/* -------------------------------------------------- sortie pour l'ordonnanceur */

test('les cases chaudes deviennent des instants futurs, en UTC', () => {
  let stat = emptyStat();
  for (let semaine = 0; semaine < 8; semaine++) {
    const d = JEUDI_15H + semaine * 7 * DAY;
    stat = observe(stat, { start: d }, { now: d });
  }

  // Un lundi : le prochain jeudi 15:00 doit sortir.
  const lundi = Date.parse('2026-09-21T09:00:00Z');
  const instants = learnedHotInstants(stat, lundi);

  assert.ok(instants.length >= 1, 'aucun instant produit');
  for (const i of instants) {
    assert.ok(i > lundi, 'un instant passe a ete produit');
    assert.equal(new Date(i).getUTCDay(), 4);
    assert.equal(new Date(i).getUTCHours(), 15);
  }
});

test('les instants restent dans l\'horizon demande', () => {
  let stat = emptyStat();
  for (let s = 0; s < 8; s++) {
    const d = JEUDI_15H + s * 7 * DAY;
    stat = observe(stat, { start: d }, { now: d });
  }
  const lundi = Date.parse('2026-09-21T09:00:00Z');
  const courts = learnedHotInstants(stat, lundi, { horizonMs: 2 * DAY });
  assert.deepEqual(courts, [], 'un jeudi a plus de deux jours a ete produit');
});

/* ------------------------------------------------------------- affichage */

test('bandeau24h rend vingt-quatre intensites bornees', () => {
  let stat = emptyStat();
  for (let s = 0; s < 8; s++) {
    const d = JEUDI_15H + s * 7 * DAY;
    stat = observe(stat, { start: d }, { now: d });
  }

  const { bands } = band24h(stat, JEUDI_15H - 3 * HOUR);
  assert.equal(bands.length, 24);
  for (const b of bands) {
    assert.ok(b.intensity >= 0 && b.intensity <= 1, `intensite hors bornes : ${b.intensity}`);
  }
  // La case du drop doit etre la plus intense de la journee.
  const peak = bands.reduce((a, b) => (b.intensity > a.intensity ? b : a));
  assert.equal(peak.hour, 15);
});

test('bandeau24h ne divise pas par zero sur une statistique vide', () => {
  const { bands, total, observations } = band24h(emptyStat(), JEUDI_15H);
  assert.equal(bands.length, 24);
  assert.equal(total, 0);
  assert.equal(observations, 0);
  for (const b of bands) assert.equal(b.intensity, 0);
});

/* ------------------------------------------------------------- robustesse */

test('observer refuse de travailler sans instant', () => {
  assert.throws(() => observe(emptyStat(), { start: JEUDI_15H }, {}), TypeError);
});

test('les statistiques restent serialisables en JSON', () => {
  // Elles vivent dans chrome.storage.local : un Map ou une Date ne survivrait
  // pas a l'aller-retour.
  let stat = emptyStat();
  for (let s = 0; s < 5; s++) {
    const d = JEUDI_15H + s * 7 * DAY;
    stat = observe(stat, { start: d }, { now: d });
  }
  const reread = JSON.parse(JSON.stringify(stat));
  assert.deepEqual(reread, stat);
  assert.equal(totalWeight(reread), totalWeight(stat));
});
