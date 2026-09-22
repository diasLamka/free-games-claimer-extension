/* La page Historique : la colonne d'a cote du tableau de chasse.
 *
 * Le bilan compte ce qui a ete PRIS. Les issues figees depuis la 2.27.0 savent
 * aussi ce qui a ete rate -- et c'est la seule colonne qui apprenne quelque
 * chose : un taux de capture qui s'effondre est soit un reglage trop strict,
 * soit une panne, et les deux se corrigent.
 *
 * Ce module ne fait que lire, filtrer et compter. Il est pur pour une raison
 * simple : les comptes sont exactement ce qu'on ne peut pas verifier a l'oeil
 * sur une page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  byMonth, filterHistory, historyRows, summariseHistory,
} from '../watch/history.js';
import { OUTCOMES } from '../watch/outcomes.js';

const JOUR = 86400000;
const T = Date.UTC(2026, 8, 22, 12, 0, 0);

function issue(over = {}) {
  return {
    store: 'epic',
    id: 'jeu',
    title: 'Un jeu',
    worth: '10.00',
    end: T,
    firstSeen: T - 7 * JOUR,
    ts: T,
    state: 'expired',
    verdict: null,
    outcome: OUTCOMES.MISSED,
    ...over,
  };
}

/* --------------------------------------------------------------- lecture */

test('les issues se lisent de la plus recente a la plus ancienne', () => {
  const r = historyRows({
    a: issue({ ts: T - JOUR, title: 'Vieux' }),
    b: issue({ ts: T, title: 'Recent' }),
  });

  assert.deepEqual(r.map((x) => x.title), ['Recent', 'Vieux']);
});

test('un magasin vide ne fait pas echouer la lecture', () => {
  assert.deepEqual(historyRows(null), []);
  assert.deepEqual(historyRows({}), []);
});

/* ---------------------------------------------------------------- filtres */

test('on peut ne regarder que ce qui a ete rate', () => {
  const rows = historyRows({
    a: issue({ outcome: OUTCOMES.TAKEN, title: 'Pris' }),
    b: issue({ outcome: OUTCOMES.MISSED, title: 'Rate' }),
  });

  const r = filterHistory(rows, { outcome: OUTCOMES.MISSED });
  assert.deepEqual(r.map((x) => x.title), ['Rate']);
});

test('on peut ne regarder qu\'un magasin', () => {
  const rows = historyRows({
    a: issue({ store: 'epic', title: 'E' }),
    b: issue({ store: 'gog', title: 'G' }),
  });

  assert.deepEqual(filterHistory(rows, { store: 'gog' }).map((x) => x.title), ['G']);
});

test('la recherche ignore la casse et les accents absents', () => {
  const rows = historyRows({ a: issue({ title: 'Cardpocalypse' }) });

  assert.equal(filterHistory(rows, { query: 'CARDPO' }).length, 1);
  assert.equal(filterHistory(rows, { query: 'autre' }).length, 0);
});

test('un filtre vide ne filtre rien', () => {
  const rows = historyRows({ a: issue(), b: issue({ store: 'gog' }) });

  assert.equal(filterHistory(rows, {}).length, 2);
  assert.equal(filterHistory(rows, { outcome: '', store: '', query: '' }).length, 2);
});

/* ---------------------------------------------------------------- comptes */

test('le taux de capture compte ce qui a ete pris sur ce qui est passe', () => {
  const rows = historyRows({
    a: issue({ outcome: OUTCOMES.TAKEN }),
    b: issue({ outcome: OUTCOMES.TAKEN }),
    c: issue({ outcome: OUTCOMES.MISSED }),
    d: issue({ outcome: OUTCOMES.MISSED }),
  });

  const s = summariseHistory(rows);
  assert.equal(s.total, 4);
  assert.equal(s.taken, 2);
  assert.equal(s.missed, 2);
  assert.equal(s.rate, 50);
});

test('les issues INCONNUES ne comptent ni pour ni contre', () => {
  /* Une reclamation qui a echoue sur un defi de securite ne dit pas si le jeu
     est au compte. La compter comme ratee accuserait l'extension a tort ; la
     compter comme prise la flatterait. Elle sort du ratio, et le nombre reste
     affiche a cote. */
  const rows = historyRows({
    a: issue({ outcome: OUTCOMES.TAKEN }),
    b: issue({ outcome: OUTCOMES.UNKNOWN }),
  });

  const s = summariseHistory(rows);
  assert.equal(s.unknown, 1);
  assert.equal(s.rate, 100, 'une sur une, l\'inconnue mise a part');
});

test('un historique vide ne rend pas un taux de zero', () => {
  /* Zero pour cent sur rien du tout ferait croire a une panne le premier jour.
     L'absence de taux se dit par null, pas par un chiffre. */
  const s = summariseHistory([]);

  assert.equal(s.total, 0);
  assert.equal(s.rate, null);
});

test('la valeur est comptee separement pour ce qui est pris et ce qui est rate', () => {
  const rows = historyRows({
    a: issue({ outcome: OUTCOMES.TAKEN, worth: '19,99' }),
    b: issue({ outcome: OUTCOMES.MISSED, worth: '9.99' }),
  });

  const s = summariseHistory(rows);
  assert.ok(Math.abs(s.worthTaken - 19.99) < 0.01, 'la virgule decimale est lue');
  assert.ok(Math.abs(s.worthMissed - 9.99) < 0.01);
});

test('une valeur illisible ne fausse pas le total', () => {
  /* Un « gratuit » ou une chaine vide dans le champ valeur ne doit pas devenir
     zero par accident ni NaN par negligence : NaN contamine toute la somme et
     rend la page entiere illisible. */
  const rows = historyRows({
    a: issue({ outcome: OUTCOMES.TAKEN, worth: 'gratuit' }),
    b: issue({ outcome: OUTCOMES.TAKEN, worth: '5.00' }),
  });

  assert.equal(summariseHistory(rows).worthTaken, 5);
});

/* ------------------------------------------------------------ par mois */

test('le decoupage par mois va du plus recent au plus ancien', () => {
  const rows = historyRows({
    a: issue({ ts: Date.UTC(2026, 7, 3), outcome: OUTCOMES.TAKEN }),
    b: issue({ ts: Date.UTC(2026, 8, 3), outcome: OUTCOMES.TAKEN }),
    c: issue({ ts: Date.UTC(2026, 8, 20), outcome: OUTCOMES.MISSED }),
  });

  const mois = byMonth(rows);
  assert.equal(mois.length, 2);
  assert.equal(mois[0].month, '2026-09');
  assert.equal(mois[0].taken, 1);
  assert.equal(mois[0].missed, 1);
  assert.equal(mois[1].month, '2026-08');
});
