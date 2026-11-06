/* La mise en page du popup (2.125.0) : rien ne doit depasser des 328 px, le nom du prochain jeu s'affiche en entier, et les
 * sections se replient.
 *
 * Signale : une bande noire a droite des sections. L'en-tete (logo + nom + version + « Cette page » + agrandir) faisait 349 px dans
 * un popup de 328 : le bouton d'agrandissement DEPASSAIT, et Chrome dimensionne la fenetre d'un popup sur ce qui deborde. Aucun
 * test ne charge de navigateur : ces gardes lisent les feuilles de style et le script, comme celles des autres mises en page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const HTML = lire('pages/popup.html');
const JS = lire('pages/popup.js');
const CSS = lire('pages/brut.css');

test('l\'en-tete est une grille dont la colonne du milieu se contracte : rien ne depasse, la version passe sous le nom', () => {
  assert.match(HTML, /<header class="top">/);
  const regle = CSS.slice(CSS.indexOf('header.top {'));
  assert.match(regle, /grid-template-columns: auto minmax\(0, 1fr\) auto auto;/, 'la colonne du milieu peut se contracter');
  assert.match(regle, /grid-template-areas: "logo word scan dash" "logo ver scan dash";/, 'la version sous le nom');
  for (const id of ['scan-page', 'open-dashboard', 'version']) assert.ok(HTML.includes(`id="${id}"`), id);
});

test('le nom du prochain jeu n\'est plus coupe : il passe a la ligne', () => {
  // La derniere regle de base (la ligne commence par `.tc-title`, pas par `:root[data-vue=...]`) gagne dans la cascade.
  const regles = CSS.split('\n').filter((l) => l.startsWith('.tc-title {'));
  const dernier = regles[regles.length - 1];
  assert.match(dernier, /white-space: normal;/);
  assert.match(dernier, /flex: 1 1 100%;/);
  assert.doesNotMatch(dernier, /text-overflow: ellipsis/);
  assert.match(CSS, /:root\[data-vue="onglet"\] \.tc-title \{ flex: 1 1 14em; \}/, 'dans le tableau de bord, sur la meme ligne');
  assert.match(CSS, /\.timecode \{ flex-wrap: wrap;/);
});

test('les groupes d\'echeance se replient : un role, le clavier, un compte, un souvenir', () => {
  assert.match(JS, /function horizonHeader\(/);
  assert.match(JS, /sep\.setAttribute\('role', 'button'\)/);
  assert.match(JS, /sep\.setAttribute\('aria-expanded'/);
  assert.match(JS, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(JS, /horizonsOff: \{\}/, 'retenu dans les preferences, vide par defaut');
  // Replier ne redessine pas la liste : une classe sur la liste cache les cartes du groupe, le focus reste.
  assert.match(HTML, /#games\.off-today \.h-today/);
  for (const k of ['unknown', 'today', 'week', 'later']) assert.ok(HTML.includes(`#games.off-${k} .h-${k}`), k);
});

test('« Tout replier / Tout deplier » : une barre par volet, qui agit sur les sections visibles', () => {
  assert.match(JS, /const FOLD_PANES = \['pane-games', 'pane-codes', 'pane-settings'\]/);
  assert.match(JS, /function updateFoldsBars\(\)/);
  assert.match(JS, /pane\.addEventListener\('toggle', updateFoldsBars, true\)/, '`toggle` ne remonte pas : ecoute a la descente');
  assert.match(JS, /updateFoldsBars\(\);\n\}\n\n\/\* -+ writes/, 'redessinee a chaque rendu');
});

test('les quatre textes existent dans les quatre langues', () => {
  for (const l of ['fr', 'en', 'de', 'es']) {
    const m = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['foldsCollapseAll', 'foldsExpandAll', 'horizonFold', 'horizonUnfold']) assert.ok(m[k] && m[k].message, `${l}/${k}`);
    assert.match(m.horizonFold.message, /\$1/, `${l}: le nom du groupe`);
  }
});
