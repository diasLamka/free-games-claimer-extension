/* La note Steam dans le panneau des fiches Epic et GOG (2.82.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const BG = lire('background.js');
const LANCEUR = lire('content/launcher.js');

/** Le corps du gestionnaire `fgc-lookup`. */
function gestionnaire() {
  const i = BG.indexOf("if (msg.type === 'fgc-lookup')");
  assert.ok(i >= 0);
  return BG.slice(i, BG.indexOf("if (msg.type ===", i + 10));
}

test('le worker joint la note a part des faits, jamais sur une fiche Steam', () => {
  const g = gestionnaire();
  assert.match(g, /offre\.store !== 'steam'/, 'la fiche Steam montre deja la sienne');
  assert.match(g, /settings\.steamRatings !== false/, 'le reglage « Notes Steam » la coupe ici aussi');
  assert.match(g, /ratingEligible\(offre\)/, 'ni jeu mobile ni DLC');
  assert.match(g, /new Promise\(\(fin\) => setTimeout\(fin, 3500\)\)/, 'la fiche n\'attend pas plus de trois secondes et demie');
  assert.match(g, /rating = \{ text: ratingLine\(r\), tone: ratingTone\(r\) \};/);
  assert.match(g, /sendResponse\(\{\s*rating,/);
  // Elle n'entre pas dans les faits : la pastille et la bulle les comptent.
  assert.doesNotMatch(g, /facts\.push|kind: 'rating'/);
});

test('le panneau relit la note, et ne la compte pas', () => {
  assert.match(LANCEUR, /\/\^\(good\|mixed\|bad\)\$\/\.test\(note\.tone\)/, 'un ton inconnu ne passe pas');
  assert.match(LANCEUR, /note\.text\.slice\(0, 80\)/);
  assert.match(LANCEUR, /var NOTE_TEINTES = \{ good: 'jade', mixed: 'ambre', bad: 'rose' \};/);
  // La pastille et la bulle lisent etat.lignes : la note n'y est jamais poussee.
  assert.doesNotMatch(LANCEUR, /etat\.lignes\.push\([^)]*note/);
  assert.match(LANCEUR, /p\.page\.style\.display = jeu \|\| montres \|\| avecNote \? 'block' : 'none';/);
  // Au DOM, par textContent : aucun innerHTML dans le lanceur.
  assert.doesNotMatch(LANCEUR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /innerHTML/);
});
