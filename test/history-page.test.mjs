/* La page Historique refaite (2.83.0) : puces, liste par mois, jaquettes, icones. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HTML = lire('pages/historique.html');
const JS = lire('pages/historique.js');
const CODE = JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('des puces plutot que des listes deroulantes, et une liste plutot qu\'un tableau', () => {
  assert.match(HTML, /<div class="chip-row" id="outcome-chips" role="group"/);
  assert.match(HTML, /<div class="chip-row" id="store-chips" role="group"/);
  assert.doesNotMatch(HTML, /<select id="outcome">|<select id="store">|id="rows"|id="months"/, 'les anciens filtres et tableaux sont partis');
  assert.match(HTML, /<div id="list"><\/div>/);
  assert.match(CODE, /b\.setAttribute\('aria-pressed', String\(valeur === active\)\);/);
});

test('chaque jeu : jaquette (figee, sinon Steam, sinon l\'initiale), magasin, valeur, date, issue en tampon', () => {
  assert.match(CODE, /const image = r\.image \|\| coverFor\(covers, nom\);/);
  assert.match(CODE, /li\.append\(coverTile\(image, nom\)\);/);
  assert.match(CODE, /meta\.append\(storeTag\(r\.store\)\);/);
  // L'issue en tampon, comme dans le popup (2.97.0) : son mot, et ses mots exacts au survol.
  assert.match(CODE, /const tampon = el\('span', `stamp \$\{issue\.stamp\}`, issue\.word\);/);
  assert.match(CODE, /tampon\.title = mots;/);
  assert.match(CODE, /stamp: 'ok', word: t\('stampClaimed'\)/);
  assert.match(CODE, /stamp: 'miss', word: t\('stampMissed'\)/);
  assert.match(CODE, /stamp: 'unknown', word: t\('stampUnknown'\)/);
  const css = lire('pages/brut.css');
  assert.match(css, /\.stamp\.ko, \.stamp\.miss \{/);
  assert.match(css, /\.stamp\.wait, \.stamp\.unknown \{/);
  assert.match(HTML, /<link rel="stylesheet" href="brut\.css">/, 'les tampons viennent de la charte');
  assert.doesNotMatch(CODE, /innerHTML/);
});

test('les jaquettes manquantes se demandent par lots, chacune une fois', () => {
  assert.match(CODE, /const lotDemande = aDemander\.slice\(0, COVERS_PER_RUN\);/);
  assert.match(CODE, /for \(const nom of lotDemande\) DEMANDEES\.add\(nom\);/, 'seules celles envoyees sont marquees');
  assert.match(CODE, /type: 'fgc-covers', titles: lotDemande/);
  assert.match(CODE, /changes\[KEY_OUTCOMES\] \|\| changes\[KEY_COVERS\]/, 'une jaquette arrivee redessine la page');
});

test('les mois portent leurs comptes ; « Ce qui revient » vide le dit', () => {
  assert.match(CODE, /for \(const mois of groupByMonth\(visibles\)\)/);
  assert.match(HTML, /id="recurring-none" data-i18n="historyRecurringNone" hidden/);
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['historyChipAll', 'historyRecurringNone', 'historyOutcome', 'historyStore']) assert.ok(table[k], `${l} ${k}`);
  }
});
