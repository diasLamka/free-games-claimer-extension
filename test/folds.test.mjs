/* Les sections de Jeux et de Codes se replient, et on s'en souvient (2.81.1). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HTML = lire('pages/popup.html');
const JS = lire('pages/popup.js');
const PLIS = {
  'fold-waiting': ['waitingOnYou', 'waiting-count', true],
  'fold-free': ['freeNow', 'free-count', true],
  'fold-weekends': ['weekendsTitle', 'weekends-count', true],
  'fold-upcoming': ['comingUp', 'upcoming-count', true],
  'fold-codes': ['codesToRedeem', 'codes-count', true],
  'fold-claimed': ['alreadyClaimed', 'claimed-count', false],
};

test('chaque section est un pli, son compte dans le titre ; seul « Deja recupere » part ferme', () => {
  for (const [id, [cle, compte, ouvert]] of Object.entries(PLIS)) {
    const re = new RegExp(`<details class="fold" id="${id}"( open)?>\\s*<summary><h2><span data-i18n="${cle}"></span><span class="count" id="${compte}"></span></h2></summary>`);
    const m = re.exec(HTML);
    assert.ok(m, id);
    assert.equal(Boolean(m[1]), ouvert, `${id} ouvert par defaut`);
  }
});

test('un seul souvenir pour tous les plis, relu une fois, et l\'ancien reglage repris', () => {
  const liste = /const REMEMBERED_FOLDS = Object\.freeze\(\[([^\]]+)\]\)/.exec(JS);
  assert.ok(liste);
  const ids = liste[1].match(/'[^']+'/g).map((x) => x.slice(1, -1));
  assert.deepEqual(ids.sort(), Object.keys(PLIS).sort());
  for (const id of ids) assert.equal(HTML.split(`id="${id}"`).length, 2, `${id} existe une fois`);
  assert.match(JS, /folds: \{\},/);
  assert.match(JS, /if \(!pli \|\| pli\.dataset\.init\) continue;/, 'relu une fois : un rendu ne rouvre pas ce qu\'on vient de fermer');
  assert.match(JS, /id === 'fold-claimed' && typeof ui\.claimedOpen === 'boolean' \? ui\.claimedOpen/, 'le reglage de la 2.81.0 est repris');
  assert.match(JS, /ui = \{ \.\.\.DEFAULT_UI, \.\.\.get\(all, KEY_UI, \{\}\) \};\r?\n  applyFolds\(\);/);
  assert.doesNotMatch(JS, /claimedOpen: false/);
});

test('les comptes se remplissent', () => {
  assert.match(JS, /document\.getElementById\('free-count'\)\.textContent = visible\.length \? String\(visible\.length\) : '';/);
  assert.match(JS, /document\.getElementById\('upcoming-count'\)\.textContent = String\(Math\.min\(next\.length, 6\)\);/);
  assert.match(JS, /document\.getElementById\('claimed-count'\)\.textContent = rows\.length \? String\(rows\.length\) : '';/);
});
