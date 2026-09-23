/* Le tableau de bord : le popup, ouvert en grand dans un onglet (2.58.0).
 *
 * Une seule page pour deux usages, donc un seul risque qui compte : que la
 * mise en page d'onglet atteigne le VRAI popup. Elle y ferait grandir la
 * fenetre jusqu'a 800 px. Ces tests tiennent la detection, les manifestes,
 * l'archive, et le fait que chaque regle d'onglet reste sous son marqueur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { DASHBOARD_PAGE, isDashboard } from '../lib/dashboard.js';
import { fichiersDuPaquet } from '../build/package.mjs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');

/* ------------------------------------------------------------ la detection */

test('le tableau de bord se reconnait a sa requete, ou a une vue d\'onglet', () => {
  const soi = {};
  assert.equal(isDashboard('?vue=onglet', null, soi), true);
  assert.equal(isDashboard('?x=1&vue=onglet', [], soi), true);
  assert.equal(isDashboard('', [soi], soi), true, 'popup.html ouvert a la main dans un onglet');
});

test('le vrai popup n\'est jamais pris pour un onglet', () => {
  const soi = {};
  assert.equal(isDashboard('', [], soi), false, 'aucune vue d\'onglet');
  assert.equal(isDashboard('', [{}, {}], soi), false, 'd\'autres onglets de l\'extension, pas lui');
  assert.equal(isDashboard('', null, soi), false, 'getViews absent (apercu, navigateur muet)');
  assert.equal(isDashboard('?vue=popup', [], soi), false);
  assert.equal(isDashboard(undefined, [undefined], undefined), false);
});

/* ------------------------------------------------------------ les manifestes */

test('les deux manifestes ouvrent le tableau de bord comme page d\'options, dans un onglet', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(lire(f));
    assert.deepEqual(m.options_ui, { page: DASHBOARD_PAGE, open_in_tab: true }, f);
    assert.equal(m.action.default_popup, DASHBOARD_PAGE.split('?')[0], `${f} : la meme page que le popup`);
    assert.ok(existsSync(new URL(DASHBOARD_PAGE.split('?')[0], ROOT)));
  }
});

test('l\'archive porte la page d\'options sans sa requete, et le module qui la reconnait', () => {
  for (const variante of ['chrome', 'firefox']) {
    const noms = fichiersDuPaquet(variante).map((e) => e.dansLeZip);
    assert.ok(noms.includes('lib/dashboard.js'), variante);
    assert.ok(noms.every((n) => !/[?#]/.test(n)), `${variante} : un nom de fichier avec une requete`);
  }
});

/* ------------------------------------------------------------ la page */

const HTML = lire('pages/popup.html');
const JS = lire('pages/popup.js');
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>'));

test('chaque regle qui elargit la page reste sous le marqueur du tableau de bord', () => {
  /* Hors du marqueur, `html, body` gardent leurs 328 px : c'est la regle de
     base, et la seule. Les regles lues ici sont les plus internes -- celles
     d'un @media comprises. */
  const regles = [...STYLE.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ selecteur: m[1].trim(), corps: m[2] }));
  const elargissent = regles.filter(({ selecteur, corps }) => /width:\s*auto|max-height:\s*none|grid-template-areas/.test(corps)
    || /\.panes\b|\.pane-title/.test(selecteur));
  assert.ok(elargissent.length >= 6);
  for (const { selecteur } of elargissent) {
    if (selecteur === '.pane-title') continue; // display: none, la seule regle hors du marqueur
    assert.match(selecteur, /:root\[data-vue="onglet"\]/, `regle hors du tableau de bord : ${selecteur}`);
  }
  assert.match(STYLE, /html, body \{\s*margin: 0;\s*width: 328px;/);
  assert.match(STYLE, /:root\[data-vue="onglet"\] #open-dashboard \{ display: none; \}/, 'pas de bouton « en grand » dans le grand');
});

test('les volets ont un titre, montre seulement en colonnes, et le bouton sa traduction', () => {
  for (const [volet, cle] of [['games', 'tabGames'], ['codes', 'tabCodes'], ['settings', 'tabSettings']]) {
    assert.match(HTML, new RegExp(`id="pane-${volet}"[^>]*>\\s*<h2 class="pane-title" data-i18n="${cle}"></h2>`), volet);
  }
  assert.match(STYLE, /^\s*\.pane-title \{ display: none; \}/m);
  assert.match(HTML, /<main class="panes" id="panes">[\s\S]*id="pane-games"[\s\S]*id="pane-codes"[\s\S]*id="pane-settings"[\s\S]*<\/main>/);
  assert.match(HTML, /id="open-dashboard" data-i18n-attr="title:dashboardOpen,aria-label:dashboardOpen"/);
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    assert.ok(table.dashboardOpen && table.dashboardTitle, l);
  }
});

test('le popup pose le marqueur avant tout rendu, et ne se ferme plus quand il est un onglet', () => {
  assert.match(JS, /import \{ DASHBOARD_PAGE, isDashboard \} from '\.\.\/lib\/dashboard\.js';/);
  const marqueur = JS.indexOf("document.documentElement.dataset.vue = 'onglet'");
  assert.ok(marqueur > 0 && marqueur < JS.indexOf('\nload()'), 'marqueur pose avant le premier load()');
  assert.match(JS, /api\.extension\.getViews\(\{ type: 'tab' \}\)/, 'jamais les vues de type popup : un doute vaut « popup »');
  assert.match(JS, /function openTab\(url\) \{\s*api\.tabs\.create\(\{ url, active: true \}\);\s*\/\/[^\n]*\s*if \(!EN_ONGLET\) window\.close\(\);/);
  assert.match(JS, /api\.runtime\.openOptionsPage\(\)/, 'le bouton ramene l\'onglet existant');
  assert.match(JS, /openTab\(api\.runtime\.getURL\(DASHBOARD_PAGE\)\)/);
});

test('le tableau de bord se tient a jour : chaque minute, au retour, et quand le popup change la langue', () => {
  assert.match(JS, /if \(EN_ONGLET\) \{\s*\/\/[^\n]*\s*setInterval\(\(\) => \{ if \(document\.visibilityState === 'visible' && !editing\(\)\) scheduleRefresh\(\); \}, 60 \* 1000\);/);
  assert.match(JS, /else if \(EN_ONGLET && cles\.includes\(KEY_UI\) && !document\.hasFocus\(\)\) scheduleRefresh\(\);/);
  /* Marquer les offres vues ecrit le catalogue, et le catalogue relance le
     rendu : jamais depuis un rendu, sinon la page tournerait en boucle. */
  const marques = [...JS.matchAll(/tell\('fgc-mark-seen'\)/g)].length;
  assert.equal(marques, 2, 'showTab et le retour sur l\'onglet, rien d\'autre');
});
