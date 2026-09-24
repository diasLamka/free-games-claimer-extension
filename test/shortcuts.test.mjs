/* Les raccourcis clavier (2.69.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const ATTENDUS = { _execute_action: 'Alt+Shift+G', 'open-dashboard': 'Alt+Shift+D', 'check-now': 'Alt+Shift+V' };

test('les deux manifestes declarent les trois raccourcis, traduits', () => {
  const tables = Object.fromEntries(['en', 'fr', 'de', 'es'].map((l) => [l, JSON.parse(lire(`_locales/${l}/messages.json`))]));
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(lire(f));
    const cmds = m.commands || {};
    assert.deepEqual(Object.keys(cmds).sort(), Object.keys(ATTENDUS).sort(), f);
    const touches = [];
    for (const [nom, c] of Object.entries(cmds)) {
      assert.equal(c.suggested_key.default, ATTENDUS[nom], `${f} ${nom}`);
      touches.push(c.suggested_key.default);
      const cle = /^__MSG_(\w+)__$/.exec(c.description);
      assert.ok(cle, `${f} ${nom} : description traduite`);
      for (const [l, table] of Object.entries(tables)) assert.ok(table[cle[1]], `${l} ${cle[1]}`);
    }
    // Chrome n'accepte pas plus de quatre touches suggerees, ni deux fois la meme.
    assert.ok(touches.length <= 4);
    assert.equal(new Set(touches).size, touches.length);
    assert.ok(!(m.permissions || []).includes('commands'), 'un raccourci ne demande aucune permission');
  }
});

test('le worker ouvre le tableau de bord et lance une verification', () => {
  const bg = lire('background.js');
  assert.match(bg, /api\.commands\.onCommand\.addListener\(\(commande\) => \{/);
  assert.match(bg, /if \(commande === 'open-dashboard'\) \{\s*api\.runtime\.openOptionsPage\(\)/);
  assert.match(bg, /if \(commande === 'check-now'\) \{[\s\S]{0,120}startCycle\('raccourci clavier', \{ force: true \}\)/);
});

test('le popup montre les touches VRAIMENT attribuees, pas celles du manifeste', () => {
  const js = lire('pages/popup.js');
  assert.match(js, /commandes = await api\.commands\.getAll\(\);/);
  for (const nom of Object.keys(ATTENDUS)) assert.ok(js.includes(nom.startsWith('_') ? `${nom}:` : `'${nom}':`), nom);
  assert.match(js, /SHORTCUTS_PAGE = api\.runtime\.getURL\(''\)\.startsWith\('moz-extension:'\) \? null : 'chrome:\/\/extensions\/shortcuts'/);
  const html = lire('pages/popup.html');
  assert.match(html, /<details class="fold" id="fold-keys">/);
  assert.match(html, /id="shortcuts-edit" data-i18n="shortcutsEdit" hidden/);
});
