/* Le graphique du Bilan : les jeux recuperes, mois par mois (2.72.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { barHeight, labelledMonths, lastMonths, monthlySeries, worthDrawing } from '../lib/month-chart.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const NOW = Date.parse('2026-09-24T12:00:00Z');
const ligne = (iso, extra = {}) => ({ ts: Date.parse(iso), store: 'epic', title: 'x', worth: null, currency: null, already: false, ...extra });

test('douze mois, le mois courant compris, par-dessus le changement d\'annee', () => {
  const m = lastMonths(NOW);
  assert.equal(m.length, 12);
  assert.equal(m[0], '2025-10');
  assert.equal(m[11], '2026-09');
  assert.deepEqual(lastMonths(Date.parse('2026-01-15T00:00:00Z'), 3), ['2025-11', '2025-12', '2026-01']);
});

test('la serie compte ce que l\'extension a pris, pas ce qui etait deja a vous', () => {
  const s = monthlySeries([
    ligne('2026-09-02T10:00:00Z', { worth: 14.99, currency: 'EUR' }),
    ligne('2026-09-20T10:00:00Z', { worth: 9.99, currency: 'EUR' }),
    ligne('2026-09-21T10:00:00Z', { worth: 19.99, currency: 'USD' }),
    ligne('2026-09-22T10:00:00Z', { already: true, worth: 50, currency: 'EUR' }),
    ligne('2026-08-31T23:59:00Z'),
    ligne('2024-01-01T00:00:00Z'),
    { ts: NaN }, null,
  ], NOW);
  const sept = s[11];
  assert.equal(sept.month, '2026-09');
  assert.equal(sept.count, 3);
  assert.deepEqual(sept.totals, { EUR: 24.98, USD: 19.99 }, 'une valeur ne s\'additionne que dans sa devise');
  assert.equal(s[10].count, 1, 'le 31 aout a 23:59 UTC est en aout, comme dans « votre meilleur mois »');
  assert.equal(s.reduce((n, p) => n + p.count, 0), 4, 'hors fenetre : ignore');
});

test('un seul mois non vide ne montre aucun rythme : pas de graphique', () => {
  assert.equal(worthDrawing(monthlySeries([ligne('2026-09-02T10:00:00Z')], NOW)), false);
  assert.equal(worthDrawing(monthlySeries([ligne('2026-09-02T10:00:00Z'), ligne('2026-07-02T10:00:00Z')], NOW)), true);
  assert.equal(worthDrawing([]), false);
});

test('la valeur ne s\'ecrit que sur deux batons : le plus haut, et le mois en cours', () => {
  const s = [{ count: 1 }, { count: 5 }, { count: 2 }, { count: 5 }, { count: 0 }, { count: 3 }];
  assert.deepEqual([...labelledMonths(s)].sort(), [3, 5], 'a egalite, le plus recent');
  assert.deepEqual([...labelledMonths([{ count: 4 }, { count: 0 }])], [0], 'un mois en cours vide ne s\'ecrit pas');
  assert.deepEqual([...labelledMonths([])], []);
});

test('un baton non vide reste visible ; un mois vide n\'a pas de baton', () => {
  assert.equal(barHeight(0, 5), 0);
  assert.equal(barHeight(5, 5), 1);
  assert.equal(barHeight(1, 100), 0.06);
  assert.equal(barHeight(3, 0), 0);
});

test('le popup dessine sans innerHTML, avec une couleur validee pour chaque theme', () => {
  const html = lire('pages/popup.html');
  assert.match(html, /<figure class="mchart" id="tally-chart" hidden>/);
  assert.match(html, /<table id="tally-chart-table"><\/table>/);
  assert.equal((html.match(/--chart: +#CC7A20;/g) || []).length, 1, 'sombre');
  assert.equal((html.match(/--chart: +#B96A00;/g) || []).length, 2, 'clair : systeme et choisi');
  const js = lire('pages/popup.js');
  const debut = js.indexOf('function renderMonthChart(');
  const fin = js.indexOf('function renderTally(');
  assert.ok(debut > 0 && fin > debut);
  const bloc = js.slice(debut, fin);
  assert.doesNotMatch(bloc, /innerHTML/);
  assert.match(bloc, /col\.addEventListener\('focus'/, 'l\'infobulle vient aussi au clavier');
  assert.match(js, /renderMonthChart\(rows\);/);
});
