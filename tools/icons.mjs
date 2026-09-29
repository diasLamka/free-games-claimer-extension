/* Le logo : UNE source, tous les formats (2.99.2).
 *
 *   node tools/icons.mjs            ecrit les SVG et les vecteurs Android
 *   node tools/icons.mjs --png      ecrit aussi les PNG (il faut Playwright et
 *                                   un Chromium : PLAYWRIGHT_PATH=... CHROME_PATH=...)
 *
 * Le logo est un ticket jaune a encoches et pointille -- l'offre --, une
 * manette -- les jeux --, « FREE » en blocs -- gratuit --, et une fleche vers
 * un bac -- recuperer, le geste que l'extension fait pour vous. Sur fond noir,
 * avec l'ombre blanche decalee des cartes de l'interface. Des etincelles
 * jaunes dans le grand format.
 *
 * Tout est dessine ici, en coordonnees de 1024 : une seule geometrie, donc un
 * seul logo, de l'icone de 16 px a l'avatar du bot Telegram et a l'icone
 * adaptative Android. Aucun logo tiers.
 *
 * Trois niveaux de detail, parce que 16 pixels ne portent pas ce que 640 portent :
 *   complet  (128, 48, Telegram, Android) : manette, FREE, fleche, pointille ;
 *   simple   (32)                          : ticket, manette, pointille ;
 *   minimal  (16)                          : ticket et manette, droits.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

export const JAUNE = '#E8FF00';
export const ENCRE = '#0A0A0A';
export const BLANC = '#FFFFFF';

/* --------------------------------------------------------------- la geometrie */

/** Le ticket, encoches en moins : un rectangle arrondi de 772 x 444. */
export const TICKET = 'M170 292H854A44 44 0 0 1 898 336V692A44 44 0 0 1 854 736H170A44 44 0 0 1 126 692V336A44 44 0 0 1 170 292Z';
/** Le meme, avec ses deux encoches taillees dans la matiere (pour les icones a une couleur). */
const TICKET_ENCOCHE = 'M170 292H854A44 44 0 0 1 898 336V456A58 58 0 0 0 898 572V692A44 44 0 0 1 854 736H170A44 44 0 0 1 126 692V572A58 58 0 0 0 126 456V336A44 44 0 0 1 170 292Z';
export const ENCOCHES = [[126, 514], [898, 514]];
const R_ENCOCHE = 58;

/** La manette, dans un repere local de 452 x 218. */
export const MANETTE = 'M92 20H336A92 92 0 0 1 424 118L440 210A44 44 0 0 1 356 232L334 178H94L72 232A44 44 0 0 1 -12 210L4 118A92 92 0 0 1 92 20Z';
export const CROIX = [[64, 52, 24, 76], [38, 78, 76, 24]];
export const BOUTONS = [[290, 62, 18], [332, 102, 18]];

/** Les lettres de « FREE », sur une grille de 5 x 7. */
const LETTRES = {
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10010', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
};

/** Les rectangles (x, y, l, h) d'un mot, l'unite etant `u`. Les cases voisines d'une ligne sont fondues. */
export function blocs(mot, u = 14) {
  const out = [];
  [...mot].forEach((c, k) => {
    LETTRES[c].forEach((ligne, j) => {
      let i = 0;
      while (i < 5) {
        if (ligne[i] !== '1') { i++; continue; }
        let f = i;
        while (f < 5 && ligne[f] === '1') f++;
        out.push([k * 6 * u + i * u, j * u, (f - i) * u, u]);
        i = f;
      }
    });
  });
  return out;
}

const LARGEUR_MOT = 4 * 5 * 14 + 3 * 14; // 322
const HAUTEUR_MOT = 7 * 14; // 98

const rect = ([x, y, l, h], fill, extra = '') => `<rect x="${x}" y="${y}" width="${l}" height="${h}" fill="${fill}"${extra}/>`;

/* ----------------------------------------------------------------- le dessin */

/**
 * Le ticket et tout ce qu'il porte, en coordonnees de 1024, penche de 7 degres
 * (`tilt`). `niveau` : 'complet' | 'simple' | 'minimal'.
 */
export function ticket({ niveau = 'complet', tilt = -7, ombre = true } = {}) {
  const complet = niveau === 'complet';
  const s = [];
  if (ombre) s.push(`<path transform="translate(24 24)" fill="${BLANC}" d="${TICKET}"/>`);
  s.push(`<path fill="${JAUNE}" d="${TICKET}"/>`);
  for (const [cx, cy] of ENCOCHES) s.push(`<circle cx="${cx}" cy="${cy}" r="${R_ENCOCHE}" fill="${ENCRE}"/>`);
  if (niveau !== 'minimal') {
    s.push(`<line x1="694" y1="322" x2="694" y2="706" stroke="${ENCRE}" stroke-width="10" stroke-dasharray="26 18"/>`);
  }
  // La manette : au centre du grand format, plus grosse quand il n'y a pas d'etiquette dessous.
  const [echelle, tx, ty] = complet ? [0.86, 228, 316] : [1.04, 188, 383];
  s.push(`<g transform="translate(${tx} ${ty}) scale(${echelle})">`
    + `<path fill="${ENCRE}" d="${MANETTE}"/>`
    + CROIX.map((r) => rect(r, JAUNE, ' rx="4"')).join('')
    + BOUTONS.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${JAUNE}"/>`).join('')
    + '</g>');
  if (complet) {
    // FREE : des blocs jaunes sur une etiquette noire.
    const bx = 410 - (LARGEUR_MOT + 64) / 2;
    s.push(`<rect x="${bx}" y="584" width="${LARGEUR_MOT + 64}" height="${HAUTEUR_MOT + 40}" rx="10" fill="${ENCRE}"/>`);
    s.push(`<g transform="translate(${bx + 32} 604)">${blocs('FREE').map((r) => rect([r[0], r[1], r[2] + 0.6, r[3] + 0.6], JAUNE)).join('')}</g>`);
    // Recuperer : une fleche vers le bas, dans un bac.
    s.push(`<g fill="${ENCRE}"><rect x="778" y="392" width="36" height="96"/><path d="M750 480H842L796 556Z"/>`
      + '<rect x="742" y="586" width="108" height="26" rx="4"/><rect x="742" y="566" width="26" height="46" rx="4"/><rect x="824" y="566" width="26" height="46" rx="4"/></g>');
  }
  return `<g transform="rotate(${tilt} 512 512)">${s.join('')}</g>`;
}

const ETINCELLES = [
  'M210 196l14 34 34 14-34 14-14 34-14-34-34-14 34-14z',
  'M806 152l10 24 24 10-24 10-10 24-10-24-24-10 24-10z',
  'M222 800l10 24 24 10-24 10-10 24-10-24-24-10 24-10z',
  'M830 812l14 34 34 14-34 14-14 34-14-34-34-14 34-14z',
];

const TITRE = '<title>Free Games Claimer — le ticket gratuit</title>';

/** Le grand format carre, avec ses etincelles : l'avatar du bot Telegram. */
export function svgCarre() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">\n  ${TITRE}\n`
    + `  <!-- Fond noir : Telegram le rogne en cercle, tout l'utile tient dans le disque central. -->\n`
    + `  <rect width="1024" height="1024" fill="${ENCRE}"/>\n`
    + `  <g fill="${JAUNE}">${ETINCELLES.map((d) => `<path d="${d}"/>`).join('')}</g>\n`
    + `  <g transform="translate(512 512) scale(.94) translate(-512 -512)">${ticket()}</g>\n</svg>\n`;
}

/**
 * L'icone : un carre arrondi noir, le ticket plus grand, pas d'etincelles.
 * Le rayon (22 %) est celui des icones de navigateur ; les coins restent
 * transparents.
 */
export function svgIcone({ niveau = 'complet', tilt = -7 } = {}) {
  const zoom = niveau === 'complet' ? 1.1 : 1.16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="128" height="128">\n  ${TITRE}\n`
    + `  <rect width="1024" height="1024" rx="226" fill="${ENCRE}"/>\n`
    + `  <g transform="translate(512 512) scale(${zoom}) translate(-512 -512)">${ticket({ niveau, tilt, ombre: niveau !== 'minimal' })}</g>\n</svg>\n`;
}

/* ------------------------------------------------------------------- Android */

const f = (n) => Math.round(n * 1000) / 1000;
const HEAD = '<?xml version="1.0" encoding="utf-8"?>\n';

/**
 * Applique « x * s + tx, y * s + ty » a un trace ABSOLU (M L H V A Z, ce que
 * sont TICKET, MANETTE et leurs pareils). Les rayons suivent l'echelle, les
 * drapeaux d'arc restent.
 */
export function mapPath(d, s = 1, tx = 0, ty = 0) {
  const out = [];
  for (const m of d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)) {
    const cmd = m[1];
    const n = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
    if (cmd === 'Z') { out.push('Z'); continue; }
    if (cmd === 'H') { out.push(`H${f(n[0] * s + tx)}`); continue; }
    if (cmd === 'V') { out.push(`V${f(n[0] * s + ty)}`); continue; }
    if (cmd === 'A') { out.push(`A${f(n[0] * s)},${f(n[1] * s)} ${n[2]},${n[3]},${n[4]} ${f(n[5] * s + tx)},${f(n[6] * s + ty)}`); continue; }
    for (let k = 0; k < n.length; k += 2) out.push(`${k ? 'L' : cmd}${f(n[k] * s + tx)},${f(n[k + 1] * s + ty)}`);
  }
  return out.join('');
}

/** Des rectangles (x, y, l, h) en trace, apres « x * s + tx ». */
const cheminRects = (rs, s = 1, tx = 0, ty = 0) => rs
  .map(([x, y, l, h]) => `M${f(x * s + tx)},${f(y * s + ty)}h${f(l * s)}v${f(h * s)}h${f(-l * s)}z`).join('');
const cercle = (cx, cy, r, s = 1, tx = 0, ty = 0) => {
  const R = f(r * s);
  return `M${f(cx * s + tx - R)},${f(cy * s + ty)}a${R},${R} 0,1,0 ${f(2 * R)},0a${R},${R} 0,1,0 ${f(-2 * R)},0z`;
};

const POINTILLE = Array.from({ length: 10 }, (_, i) => [689, 322 + i * 44, 10, 26]);
/** Plus epais, pour les icones a une couleur : un trait de 10 sur 1024 disparait a 108 dp. */
const POINTILLE_FIN = Array.from({ length: 8 }, (_, i) => [682, 330 + i * 48, 24, 28]);
const path = (fill, d, extra = '') => `<path android:fillColor="${fill}"${extra} android:pathData="${d}" />`;
const vecteur = (dp, viewport, corps) => `${HEAD}<vector xmlns:android="http://schemas.android.com/apk/res/android"\n    android:width="${dp}dp" android:height="${dp}dp"\n    android:viewportWidth="${viewport}" android:viewportHeight="${viewport}">\n${corps}</vector>\n`;

/**
 * L'icone adaptative : 108 dp, le dessin dans le disque central de 66 dp.
 * Les coordonnees de 1024 sont mises a l'echelle par un groupe, penchees par
 * un second.
 */
export function androidForeground() {
  const e = 0.083;
  const bx = 410 - (LARGEUR_MOT + 64) / 2;
  const mot = blocs('FREE').map(([x, y, l, h]) => [bx + 32 + x, 604 + y, l, h]);
  const lignes = [
    path(BLANC, mapPath(TICKET, 1, 24, 24)),
    path(JAUNE, TICKET),
    ...ENCOCHES.map(([cx, cy]) => path(ENCRE, cercle(cx, cy, R_ENCOCHE))),
    path(ENCRE, cheminRects(POINTILLE)),
    path(ENCRE, mapPath(MANETTE, 0.86, 228, 316)),
    path(JAUNE, cheminRects(CROIX, 0.86, 228, 316) + BOUTONS.map(([x, y, r]) => cercle(x, y, r, 0.86, 228, 316)).join('')),
    path(ENCRE, cheminRects([[bx, 584, LARGEUR_MOT + 64, HAUTEUR_MOT + 40]])),
    path(JAUNE, cheminRects(mot)),
    path(ENCRE, cheminRects([[778, 392, 36, 96], [742, 586, 108, 26], [742, 566, 26, 46], [824, 566, 26, 46]]) + 'M750,480H842L796,556Z'),
  ].map((l) => `            ${l}\n`).join('');
  return vecteur(108, 108,
    `    <group android:translateX="${f(54 - 512 * e)}" android:translateY="${f(54 - 512 * e)}" android:scaleX="${e}" android:scaleY="${e}">\n`
    + `        <group android:pivotX="512" android:pivotY="512" android:rotation="-7">\n${lignes}        </group>\n    </group>\n`)
    .replace('<vector', '<!-- Le logo (tools/icons.mjs) : ticket jaune, manette, FREE, fleche de recuperation. Genere. -->\n<vector');
}

export function androidBackground() {
  return vecteur(108, 108, `    ${path(ENCRE, 'M0,0h108v108h-108z')}\n`);
}

/** Le ticket encoche, la manette et le pointille en creux : une couleur, pour les icones thematiques. */
function silhouette(sc, tx, ty, { pointille = true } = {}) {
  // La manette au centre du compartiment de gauche, hors de portee de l'encoche.
  return mapPath(TICKET_ENCOCHE, sc, tx, ty) + mapPath(MANETTE, sc, 196 * sc + tx, 388 * sc + ty)
    + (pointille ? cheminRects(POINTILLE_FIN, sc, tx, ty) : '');
}

export function androidMonochrome() {
  const e = 0.083;
  return vecteur(108, 108,
    `    <group android:pivotX="54" android:pivotY="54" android:rotation="-7">\n        ${path('#FFFFFF', silhouette(e, 54 - 512 * e, 54 - 512 * e), ' android:fillType="evenOdd"')}\n    </group>\n`);
}

/** La barre d'etat : 24 dp, blanc, le ticket encoche et sa manette. */
export function androidStatut() {
  const e = 24 / 1024 * 1.2;
  return vecteur(24, 24, `    ${path('#FFFFFF', silhouette(e, 12 - 512 * e, 12 - 512 * e, { pointille: false }), ' android:fillType="evenOdd"')}\n`);
}

/* -------------------------------------------------------------------- ecriture */

function ecrire(chemin, texte) {
  const cible = join(RACINE, chemin);
  mkdirSync(dirname(cible), { recursive: true });
  writeFileSync(cible, texte);
}

/** Les SVG de chaque taille d'icone, et de l'avatar. */
export const VARIANTES = Object.freeze([
  { nom: 'icons/icon128.png', taille: 128, svg: () => svgIcone() },
  { nom: 'icons/icon48.png', taille: 48, svg: () => svgIcone() },
  { nom: 'icons/icon32.png', taille: 32, svg: () => svgIcone({ niveau: 'simple', tilt: -5 }) },
  { nom: 'icons/icon16.png', taille: 16, svg: () => svgIcone({ niveau: 'minimal', tilt: 0 }) },
  { nom: 'docs/logo/telegram-bot-logo.png', taille: 640, svg: () => svgCarre(), fond: true },
  { nom: 'docs/logo/telegram-bot-logo-1024.png', taille: 1024, svg: () => svgCarre(), fond: true },
]);

export function ecrireSources() {
  ecrire('icons/icon.svg', svgIcone());
  ecrire('docs/logo/telegram-bot-logo.svg', svgCarre());
  const res = 'android/app/src/main/res/drawable';
  ecrire(`${res}/ic_launcher_background.xml`, androidBackground());
  ecrire(`${res}/ic_launcher_foreground.xml`, androidForeground());
  ecrire(`${res}/ic_launcher_monochrome.xml`, androidMonochrome());
  ecrire(`${res}/ic_stat_ticket.xml`, androidStatut());
}

async function ecrirePng() {
  const chemin = process.env.PLAYWRIGHT_PATH || 'playwright';
  const { chromium } = await import(chemin);
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  for (const v of VARIANTES) {
    const p = await b.newPage({ viewport: { width: v.taille, height: v.taille }, deviceScaleFactor: 1 });
    const svg = v.svg().replace(/width="\d+" height="\d+"/, `width="${v.taille}" height="${v.taille}"`);
    await p.setContent(`<body style="margin:0;background:transparent">${svg}</body>`);
    await p.screenshot({ path: join(RACINE, v.nom), omitBackground: !v.fond, clip: { x: 0, y: 0, width: v.taille, height: v.taille } });
    await p.close();
  }
  await b.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ecrireSources();
  if (process.argv.includes('--png')) await ecrirePng();
  console.log('logo : sources ecrites' + (process.argv.includes('--png') ? ', PNG aussi' : ''));
}
