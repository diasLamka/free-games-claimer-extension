/* Chaque cle que le moteur LIT doit etre prechargee (content/gm-shim.js).
 *
 * `GM_getValue` est synchrone, le stockage de l'extension ne l'est pas : le shim
 * precharge donc une liste ENUMEREE de cles (ENGINE_KEYS). Une cle lue mais
 * absente de la liste rend toujours son defaut -- sans erreur, sans trace. La
 * memoire du navigateur adaptatif (FGC_nav_<magasin>) etait dans ce cas de la
 * 2.100.0 a la 2.102.0 : elle s'ecrivait, et ne se relisait jamais d'une page a
 * l'autre. Aucun test unitaire ne pouvait le voir (le harnais lit une Map) ;
 * celui-ci compare le shim au moteur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SHIM = readFileSync(new URL('../content/gm-shim.js', import.meta.url), 'utf8');
const SRC = new URL('../src/core/', import.meta.url);

function engineKeys() {
  const body = SHIM.slice(SHIM.indexOf('var ENGINE_KEYS = ['));
  // Sans les commentaires : leurs apostrophes decaleraient l'appariement des guillemets.
  const list = body.slice(0, body.indexOf('];')).replace(/\/\/[^\n]*/g, '');
  return new Set([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

const PLATEFORMES = ['Epic Games', 'GOG', 'Amazon Luna'];

test('toute cle litterale lue par GM_getValue est prechargee', () => {
  const precharges = engineKeys();
  const lues = new Set();
  for (const f of readdirSync(SRC)) {
    if (f === '32-test-hook.js') continue;
    const texte = readFileSync(new URL(f, SRC), 'latin1');
    // Une cle composee ('FGC_history_' + platform) est verifiee a part, magasin par magasin.
    for (const m of texte.matchAll(/GM_getValue\(\s*'([^']+)'\s*[,)]/g)) lues.add(m[1]);
  }
  assert.ok(lues.size >= 10, `trop peu de cles trouvees (${lues.size}) : le test ne lit plus le moteur`);
  for (const k of lues) assert.ok(precharges.has(k), `${k} est lue par le moteur mais pas prechargee`);
});

test('les cles composees (historique, memoire du navigateur) sont prechargees pour chaque magasin', () => {
  const precharges = engineKeys();
  for (const p of PLATEFORMES) {
    assert.ok(precharges.has(`FGC_history_${p}`), `FGC_history_${p}`);
    assert.ok(precharges.has(`FGC_nav_${p}`), `FGC_nav_${p}`);
  }
});

test('le moteur compose bien ces cles avec ces prefixes', () => {
  const tout = readdirSync(SRC).map((f) => readFileSync(new URL(f, SRC), 'latin1')).join('\n');
  assert.match(tout, /NAV_MEMORY_PREFIX = 'FGC_nav_'/);
  assert.match(tout, /'FGC_history_' \+ platform/);
});
