/* Les textes du moteur, dans la langue du lecteur (2.55.0).
 *
 * Le moteur ecrivait ses phrases en francais sans accents pour tout le monde.
 * Il n'envoie plus que des pieces, { key, args } ; le lanceur et le worker les
 * composent. Ces tests tiennent les deux bouts : aucune phrase ne reste dans
 * le moteur, et chaque piece a sa traduction, avec assez de valeurs pour la
 * remplir, dans les quatre langues.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { readPiece, composeEngineText, engineTitle, engineTemplates, MAX_ARGS, MAX_ARG_LENGTH } from '../watch/engine-text.js';
import { keysWith, setLocale, t } from '../lib/i18n.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const LOCALES = ['en', 'fr', 'de', 'es'];
const TABLES = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(lire(`_locales/${l}/messages.json`))]));
const MODULES = readdirSync(new URL('src/core/', ROOT)).filter((f) => f.endsWith('.js'))
  .map((f) => ({ f, src: readFileSync(new URL(`src/core/${f}`, ROOT), 'latin1') }));

/* ------------------------------------------------------------ le moteur */

/** Chaque appel uiText('engX', a, b) du moteur, avec son nombre de valeurs. */
function appels() {
  const out = [];
  for (const { f, src } of MODULES) {
    for (const m of src.matchAll(/uiText\('(eng[A-Za-z0-9]+)'((?:[^()]|\([^()]*\))*)\)/g)) {
      const reste = m[2].trim().replace(/^,/, '').trim();
      const valeurs = reste ? reste.split(/,(?![^(]*\))/).length : 0;
      out.push({ f, cle: m[1], valeurs });
    }
  }
  return out;
}

test('le moteur ne compose plus aucune phrase pour l\'utilisateur', () => {
  for (const { f, src } of MODULES) {
    if (f === '30-menu.js') continue; // commandes de la console, pour le developpeur
    src.split(/\r?\n/).forEach((ligne, i) => {
      if (!/\b(updateUiState|notifyUser)\(/.test(ligne) || /function (updateUiState|notifyUser)/.test(ligne)) return;
      assert.match(ligne, /uiText\(|summaryText|uiMsg|notice/, `${f}:${i + 1} ${ligne.trim()}`);
    });
  }
  assert.ok(appels().length >= 90);
});

test('chaque piece du moteur a sa phrase dans les quatre langues, avec assez de valeurs', () => {
  for (const { f, cle, valeurs } of appels()) {
    for (const l of LOCALES) {
      const entree = TABLES[l][cle];
      assert.ok(entree && entree.message, `${l} : ${cle} (${f})`);
      const besoin = Math.max(0, ...[...entree.message.matchAll(/\$(\d)/g)].map((m) => Number(m[1])));
      assert.equal(besoin, valeurs, `${l} : ${cle} attend $${besoin}, ${f} en passe ${valeurs}`);
    }
  }
});

test('les phrases du moteur ont retrouve leurs accents', () => {
  assert.equal(TABLES.fr.engEpicAllClaimed.message, 'Tous les jeux gratuits de la semaine sont déjà récupérés');
  assert.equal(TABLES.de.engEpicAllClaimed.message, 'Alle Gratisspiele dieser Woche sind schon abgeholt');
  // Plus de renvoi vers un bouton « Claim » ni vers le menu Tampermonkey, qui n'existent plus.
  for (const l of LOCALES) {
    for (const [cle, { message }] of Object.entries(TABLES[l])) {
      if (!cle.startsWith('eng')) continue;
      assert.ok(!/Tampermonkey|sur Claim|on Claim\b/.test(message), `${l} : ${cle}`);
    }
  }
});

/* ------------------------------------------------------------ la piece */

test('une piece est verifiee comme une donnee venue d\'une page', () => {
  assert.deepEqual(readPiece({ key: 'engReady' }), { key: 'engReady', args: [] });
  assert.deepEqual(readPiece({ key: 'engEpicClaimed', args: ['Tyranny', 3, null] }), { key: 'engEpicClaimed', args: ['Tyranny', '3', ''] });
  for (const mauvais of [null, 'engReady', { key: 'launcherButton' }, { key: 'eng<img>' }, { key: 42 }, { key: 'eng' }]) {
    assert.equal(readPiece(mauvais), null, JSON.stringify(mauvais));
  }
  const long = readPiece({ key: 'engError', args: Array(20).fill('x'.repeat(5000)) });
  assert.equal(long.args.length, MAX_ARGS);
  assert.equal(long.args[0].length, MAX_ARG_LENGTH);
});

test('une notification se compose piece par piece ; une phrase d\'avant passe telle quelle', () => {
  const faux = (cle, ...a) => `[${cle}|${a.join('|')}]`;
  assert.equal(composeEngineText({ key: 'engNotifyGogLogin', args: [] }, faux), '[engNotifyGogLogin|]');
  assert.equal(composeEngineText([
    { key: 'engNotifyLunaCode', args: ['Xbox', 'Halo', 'AAAA-BBBB'] },
    { key: 'engNotifyCopied' },
    { key: 'launcherButton' },
  ], faux), '[engNotifyLunaCode|Xbox|Halo|AAAA-BBBB] [engNotifyCopied|]', 'une cle hors du moteur est ignoree');
  assert.equal(composeEngineText('Ancienne phrase.', faux), 'Ancienne phrase.');
  assert.equal(composeEngineText(undefined, faux), '');
  assert.equal(engineTitle('Free Games Claimer -- Epic Games'), 'Free Games Claimer — Epic Games');
  assert.equal(engineTitle(''), 'Free Games Claimer');
});

test('dans la vraie table : la phrase du lecteur, accents et valeurs compris', () => {
  setLocale('fr');
  try {
    assert.equal(composeEngineText({ key: 'engNotifyGogAdded', args: ['Tyranny'] }, t), '« Tyranny » ajouté à votre bibliothèque GOG.');
    setLocale('es');
    assert.equal(composeEngineText({ key: 'engEpicTally', args: ['2', '3'] }, t), 'Epic: 2 de 3 reclamado(s)');
  } finally { setLocale(null); }
});

test('les modeles du lanceur gardent leurs $1..$4, et laissent les notifications de cote', () => {
  setLocale('de');
  try {
    const m = engineTemplates(t, keysWith('eng'));
    assert.equal(m.engEpicClaimed, 'Epic: $1 abgeholt');
    assert.equal(m.engLunaSummary, 'Luna: $1 abgeholt, $2 Code(s), $3 übersprungen, $4 fehlgeschlagen');
    assert.equal(m.engNotifyGogLogin, undefined);
    assert.ok(Object.keys(m).every((k) => k.startsWith('eng')));
  } finally { setLocale(null); }
});

/* ------------------------------------------------------------ le branchement */

test('le worker compose les notifications du moteur et envoie les modeles au lanceur', () => {
  const bg = lire('background.js');
  assert.match(bg, /msg\.type === 'fgc-notify'[\s\S]{0,900}title: engineTitle\(msg\.title\), message: composeEngineText\(msg\.text, t\)/);
  assert.match(bg, /engine: engineTemplates\(t, keysWith\('eng'\)\)/);
  assert.match(lire('content/gm-shim.js'), /text: opts\.text \|\| ''/, 'le relais GM transmet la piece sans la changer en chaine');
});
