/* Les gestes du popup sont des boutons, pas des textes soulignes (2.60.0).
 *
 * « Repartir de zero », « Reessayer », « Retirer », « J'ai vu »... etaient des
 * liens gris soulignes : ils se lisaient comme des adresses, et se perdaient
 * dans le texte. Ils sont devenus des pilules (`.btn-sm`). « Tout voir »,
 * copie pauvre de la page Historique, est parti, et la liste « Deja
 * recupere » n'affiche plus d'heure : celle qu'elle montrait etait l'heure du
 * CONSTAT sur la page du magasin, pas celle de la recuperation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const HTML = lire('pages/popup.html');
const JS = lire('pages/popup.js');

test('plus aucun texte souligne qui fasse office de bouton', () => {
  assert.doesNotMatch(HTML, /class="link\b/, 'popup.html');
  assert.doesNotMatch(HTML, /button\.link/, 'le style a disparu avec ses usages');
  assert.doesNotMatch(JS, /el\('button', 'link'/, 'popup.js');
  for (const id of ['reset-log', 'session-probe']) {
    assert.match(HTML, new RegExp(`class="btn-sm[^"]*" id="${id}"`), id);
  }
  for (const cle of ['retryNow', 'remove', 'canaryAck', 'teachForget', 'sessionSignIn', 'openSentinel']) {
    assert.match(JS, new RegExp(`el\\('button', 'btn-sm[^']*', t\\('${cle}'\\)\\)`), cle);
  }
});

test('le pied de page : trois boutons et le diagnostic en icone, plus de liens', () => {
  const pied = HTML.slice(HTML.indexOf('<footer>'), HTML.indexOf('</footer>'));
  assert.doesNotMatch(pied, /<a\b/);
  for (const id of ['open-collection', 'open-history', 'open-journal']) {
    assert.match(pied, new RegExp(`<button class="btn-sm" id="${id}"`), id);
  }
  assert.match(pied, /<button class="icon-button" id="open-diagnostics" data-i18n-attr="title:diagnostics,aria-label:diagnostics">/);
});

test('« Deja recupere » : ni heure trompeuse, ni « Tout voir »', () => {
  const rendu = JS.slice(JS.indexOf('function renderLog'), JS.indexOf('/* ------------------------------------------------------------------- codes */'));
  assert.ok(rendu.length > 500);
  assert.doesNotMatch(rendu, /el\('time'/);
  assert.doesNotMatch(rendu, /showAllLog/);
  assert.doesNotMatch(HTML + JS, /show-all-log/);
  assert.match(rendu, /rows\.slice\(0, EN_ONGLET \? 16 : 8\)/);
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    assert.equal(table.seeAll, undefined, l);
    assert.ok(table.navJournal && table.navJournal.message, l);
  }
});
