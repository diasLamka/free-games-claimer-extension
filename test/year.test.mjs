/* Votre annee en jeux gratuits (2.93.0).
 *
 * Ce qui compte : une annee = ce qui a ete PRIS cette annee-la (pas ce qu'on
 * avait deja, pas l'annee d'avant) ; les plus chers se classent meme entre
 * devises ; le mieux note ne l'est pas sur trois avis.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { yearRecap, yearsOf, yearFileName } from '../watch/year.js';
import { makeEntry } from '../watch/library.js';

const T = (m, d = 10) => Date.UTC(2026, m - 1, d, 12);
const e = (id, title, ts, worth, extra = {}) => ({ ...makeEntry({ store: 'epic', id, title, ts, worth, status: 'claimed' }), ...extra });

const library = {
  a: e('hades', 'Hades', T(3), '24,99 €'),
  b: e('gris', 'Gris', T(3, 20), '16,79 €', { store: 'gog' }),
  c: e('celeste', 'Celeste', T(7), '$19.99'),
  d: e('tunic', 'Tunic', T(7, 2), '29,99 €', { via: 'telephone' }),
  e: e('vieux', 'Vieux Jeu', Date.UTC(2025, 5, 1), '59,99 €'),
  f: e('deja', 'Deja A Moi', T(5), '39,99 €', { reason: 'ALREADY_OWNED' }),
  g: e('rate', 'Rate', T(5), '9,99 €', { status: 'failed' }),
  h: e('steam1', 'Portal', T(7, 15), null, { store: 'steam', id: '400' }),
};

test('une annee : ce qui a ete pris cette annee-la, et rien d\'autre', () => {
  const r = yearRecap({ library, year: 2026, now: T(9) });
  assert.equal(r.count, 5);
  assert.equal(r.priced, 4);
  assert.deepEqual(r.stores, [{ store: 'epic', count: 3 }, { store: 'gog', count: 1 }, { store: 'steam', count: 1 }]);
  assert.deepEqual(r.bestMonth, { month: '2026-07', count: 3 });
  assert.equal(r.viaPhone, 1);
  assert.deepEqual(yearsOf(library), [2026, 2025]);
  assert.equal(yearFileName(2026), 'free-games-2026.png');
});

test('les plus chers, entre devises : converties quand le taux est la', () => {
  const rates = { base: 'EUR', date: '2026-09-01', fetchedAt: T(9), rates: { USD: 2 } };
  const avec = yearRecap({ library, year: 2026, rates, now: T(9) });
  // $19.99 vaut 9,99 € a ce taux : il passe dernier.
  assert.deepEqual(avec.top.map((x) => x.title), ['Tunic', 'Hades', 'Gris']);
  const sans = yearRecap({ library, year: 2026, now: T(9) });
  assert.deepEqual(sans.top.map((x) => x.title), ['Tunic', 'Hades', 'Celeste'], 'sans taux : la valeur brute');
});

test('le mieux note : au moins cinquante avis, le pourcentage d\'abord', () => {
  const ratings = {
    'app:400': { score: 8, positive: 900, total: 1000 },
    't:hades': { score: 9, positive: 97, total: 100 },
    't:gris': { score: 8, positive: 20, total: 20 },
  };
  const r = yearRecap({ library, ratings, year: 2026, now: T(9) });
  assert.deepEqual(r.bestRated, { title: 'Hades', store: 'epic', percent: 97, total: 100 }, '100 % sur 20 avis ne compte pas');
  assert.equal(yearRecap({ library: {}, year: 2026 }).bestRated, null);
});
