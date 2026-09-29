/* Le logo (2.99.2) : une geometrie, plusieurs copies.
 *
 * Le ticket jaune, la manette, « FREE » et la fleche vivent dans
 * tools/icons.mjs. L'icone du lanceur sur les pages de magasin en garde une
 * copie en ES5 (un script de contenu ne charge rien) : ce test l'empeche de
 * deriver, comme les vecteurs Android et les SVG generes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  TICKET, MANETTE, ENCOCHES, CROIX, BOUTONS, JAUNE, ENCRE,
  svgIcone, svgCarre, androidForeground, androidBackground, androidMonochrome, androidStatut, mapPath, blocs, VARIANTES,
} from '../tools/icons.mjs';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('le lanceur des pages de magasin porte la meme geometrie que la source', () => {
  const lanceur = lire('content/launcher.js');
  assert.ok(lanceur.includes(`ticket: '${TICKET}'`), 'le ticket');
  assert.ok(lanceur.includes(`manette: '${MANETTE}'`), 'la manette');
  assert.ok(lanceur.includes(`jaune: '${JAUNE}'`) && lanceur.includes(`encre: '${ENCRE}'`));
  for (const [cx, cy] of ENCOCHES) assert.ok(lanceur.includes(`cx: ${cx}, cy: ${cy}, r: 58`), `encoche ${cx}`);
  for (const [x, y, l, h] of CROIX) assert.ok(lanceur.includes(`x: ${x}, y: ${y}, width: ${l}, height: ${h}`), `croix ${x}`);
  for (const [x, y, r] of BOUTONS) assert.ok(lanceur.includes(`cx: ${x}, cy: ${y}, r: ${r}`), `bouton ${x}`);
});

test('l\'ancien logo ambre n\'est plus nulle part', () => {
  // Ni dans l'icone du lanceur, ni dans les sources, ni dans les vecteurs Android.
  const lanceur = lire('content/launcher.js');
  assert.ok(!lanceur.includes("fill: C.icone"), 'plus d\'icone peinte de la teinte ambre');
  assert.ok(!/x: 23\.7, y: 39/.test(lanceur), 'plus de coupon de 80,6 x 49,9');
  for (const f of ['icons/icon.svg', 'android/app/src/main/res/drawable/ic_launcher_foreground.xml', 'android/app/src/main/res/drawable/ic_launcher_background.xml']) {
    const t = lire(f);
    assert.ok(!/FFC06B|FF8A3D|FFB454|181128/i.test(t), f);
    assert.match(t, /E8FF00|0A0A0A/i, f);
  }
});

test('les fichiers generes sont ceux que le script ecrirait', () => {
  assert.equal(lire('icons/icon.svg'), svgIcone());
  assert.equal(lire('docs/logo/telegram-bot-logo.svg'), svgCarre());
  const res = 'android/app/src/main/res/drawable';
  assert.equal(lire(`${res}/ic_launcher_foreground.xml`), androidForeground());
  assert.equal(lire(`${res}/ic_launcher_background.xml`), androidBackground());
  assert.equal(lire(`${res}/ic_launcher_monochrome.xml`), androidMonochrome());
  assert.equal(lire(`${res}/ic_stat_ticket.xml`), androidStatut());
});

test('chaque PNG existe, a la bonne taille, et le logo de 16 px n\'est pas le grand rogne', () => {
  for (const v of VARIANTES) {
    assert.ok(existsSync(new URL(`../${v.nom}`, import.meta.url)), v.nom);
    const png = readFileSync(new URL(`../${v.nom}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), v.taille, `${v.nom} : largeur`);
    assert.equal(png.readUInt32BE(20), v.taille, `${v.nom} : hauteur`);
  }
  // Trois niveaux de detail : le petit ne porte ni « FREE » ni fleche.
  assert.ok(svgIcone().includes('rx="10"'), 'le grand porte l\'etiquette FREE');
  assert.ok(!svgIcone({ niveau: 'simple' }).includes('rx="10"'));
  assert.ok(!svgIcone({ niveau: 'minimal' }).includes('stroke-dasharray'));
});

test('mapPath met a l\'echelle un trace absolu, rayons compris, drapeaux d\'arc intacts', () => {
  assert.equal(mapPath('M10 20H30V40A5 5 0 0 1 35 45Z', 2, 1, 1), 'M21,41H61V81A10,10 0,0,1 71,91Z');
  assert.equal(mapPath('M0 0L10 10', 1, 5, 5), 'M5,5L15,15');
});

test('FREE se lit : quatre lettres, sans couture, sur une grille de 5 x 7', () => {
  const r = blocs('FREE');
  assert.ok(r.length > 20);
  assert.ok(Math.max(...r.map(([x, , l]) => x + l)) <= 4 * 5 * 14 + 3 * 14);
  assert.ok(Math.max(...r.map(([, y, , h]) => y + h)) <= 7 * 14);
});

test('le manifeste declare les quatre tailles, et le popup montre le meme logo', () => {
  const m = JSON.parse(lire('manifest.json'));
  for (const t of ['16', '32', '48', '128']) assert.equal(m.icons[t], `icons/icon${t}.png`);
  assert.match(lire('pages/popup.html'), /<img src="\.\.\/icons\/icon128\.png"/);
});
