/* L'image de « Votre annee en jeux gratuits » (2.93.0).
 *
 * 1080 x 1350 : le format portrait que les reseaux prennent tel quel. La
 * charte de l'extension, en grand : fond noir, un seul accent jaune cyber,
 * traits de 6 px, ombres pleines, Archivo Black et Space Mono -- et la
 * signature, le billet poinconne et le tampon de travers.
 *
 * Ce module dessine ; il ne compte rien (watch/year.js) et ne traduit rien :
 * les textes arrivent tout faits.
 */

export const W = 1080;
export const H = 1350;
const ACCENT = '#E8FF00';
const NOIR = '#000000';
const BLANC = '#FFFFFF';
const DISPLAY = '"Archivo Black", "Arial Black", sans-serif';
const MONO = '"Space Mono", ui-monospace, monospace';

/** Les polices de la charte, chargees avant de dessiner (sinon le canvas prend la police de secours). */
export async function loadFonts(doc = document) {
  try {
    await Promise.all([
      doc.fonts.load(`64px ${DISPLAY}`),
      doc.fonts.load(`700 32px ${MONO}`),
      doc.fonts.load(`400 32px ${MONO}`),
    ]);
  } catch { /* la police de secours dessine quand meme */ }
}

/** La plus grande taille, de `max` a `min`, ou `texte` tient dans `largeur`. */
function ajuste(ctx, texte, largeur, max, min, famille, graisse = '') {
  let taille = max;
  for (; taille > min; taille -= 2) {
    ctx.font = `${graisse} ${taille}px ${famille}`.trim();
    if (ctx.measureText(texte).width <= largeur) return taille;
  }
  ctx.font = `${graisse} ${min}px ${famille}`.trim();
  return min;
}

/** Coupe avec « … » ce qui depasse encore a la plus petite taille. */
function coupe(ctx, texte, largeur) {
  if (ctx.measureText(texte).width <= largeur) return texte;
  let t = texte;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > largeur) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Le bloc de la charte : ombre pleine decalee, aplat, bordure. */
function bloc(ctx, x, y, w, h, { fond, ombre, trait = NOIR, decalage = 14, epaisseur = 6 }) {
  if (ombre) { ctx.fillStyle = ombre; ctx.fillRect(x + decalage, y + decalage, w, h); }
  ctx.fillStyle = fond;
  ctx.fillRect(x, y, w, h);
  ctx.lineWidth = epaisseur;
  ctx.strokeStyle = trait;
  ctx.strokeRect(x + epaisseur / 2, y + epaisseur / 2, w - epaisseur, h - epaisseur);
}

/** Le tampon : double trait, de travers. */
function tampon(ctx, texte, cx, cy, { angle = -8, taille = 40, fond = BLANC, encre = NOIR } = {}) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.font = `${taille}px ${DISPLAY}`;
  const w = ctx.measureText(texte).width + 48;
  const h = taille + 34;
  ctx.fillStyle = fond;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = encre;
  ctx.lineWidth = 5;
  ctx.strokeRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5);
  ctx.lineWidth = 3;
  ctx.strokeRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24);
  ctx.fillStyle = encre;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texte, 0, 3);
  ctx.restore();
}

/**
 * Dessine la carte. `txt` porte les textes deja traduits :
 *   { kicker, title, subtitle, valueLabel, value, gamesStamp, stores[], topLabel,
 *     top[{ title, worth }], lines[], footer }
 */
export function drawYearCard(canvas, txt) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const M = 72;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  ctx.fillStyle = NOIR;
  ctx.fillRect(0, 0, W, H);

  // L'en-tete : la marque, en mono, et le titre massif.
  ctx.fillStyle = ACCENT;
  ctx.font = `700 26px ${MONO}`;
  ctx.fillText(String(txt.kicker || '').toUpperCase(), M, 104);

  ctx.fillStyle = BLANC;
  const titre = String(txt.title || '').toUpperCase();
  ajuste(ctx, titre, W - 2 * M, 118, 60, DISPLAY);
  ctx.fillText(titre, M, 230);
  ctx.fillStyle = ACCENT;
  const sous = String(txt.subtitle || '').toUpperCase();
  ajuste(ctx, sous, W - 2 * M, 64, 34, DISPLAY);
  ctx.fillText(sous, M, 306);

  // Le chiffre : le bloc jaune, ombre blanche, comme le tableau de bord.
  const hy = 350;
  const hh = 240;
  bloc(ctx, M, hy, W - 2 * M - 14, hh, { fond: ACCENT, ombre: BLANC });
  ctx.fillStyle = NOIR;
  ctx.font = `700 26px ${MONO}`;
  ctx.fillText(String(txt.valueLabel || '').toUpperCase(), M + 36, hy + 64);
  const valeur = String(txt.value || '');
  ajuste(ctx, valeur, W - 2 * M - 90, 132, 56, DISPLAY);
  ctx.fillText(valeur, M + 36, hy + 200);
  tampon(ctx, String(txt.gamesStamp || '').toUpperCase(), W - M - 150, hy + hh + 6, { angle: -6, taille: 40 });

  // Les magasins, en puces.
  let x = M;
  const py = hy + hh + 100;
  ctx.font = `700 26px ${MONO}`;
  for (const s of (txt.stores || []).slice(0, 5)) {
    const texte = String(s).toUpperCase();
    const w = ctx.measureText(texte).width + 36;
    if (x + w > W - M) break;
    ctx.strokeStyle = BLANC;
    ctx.lineWidth = 4;
    ctx.strokeRect(x + 2, py - 38, w - 4, 56);
    ctx.fillStyle = BLANC;
    ctx.fillText(texte, x + 18, py);
    x += w + 16;
  }

  // Les plus chers : un billet, poinconne et perfore.
  const ty = py + 50;
  const th = 84 + 70 * Math.max(1, (txt.top || []).length);
  bloc(ctx, M, ty, W - 2 * M - 14, th, { fond: BLANC, ombre: ACCENT });
  ctx.fillStyle = NOIR;
  for (const [cx, cy] of [[M, ty + 58], [W - M - 14, ty + 58]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.save();
  ctx.setLineDash([18, 12]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = NOIR;
  ctx.beginPath();
  ctx.moveTo(M + 30, ty + 58);
  ctx.lineTo(W - M - 44, ty + 58);
  ctx.stroke();
  ctx.restore();
  ctx.font = `700 24px ${MONO}`;
  ctx.fillText(String(txt.topLabel || '').toUpperCase(), M + 36, ty + 42);
  (txt.top || []).forEach((g, i) => {
    const y = ty + 120 + i * 70;
    ctx.font = `28px ${DISPLAY}`;
    const prix = String(g.worth || '');
    const lp = ctx.measureText(prix).width;
    ctx.fillText(coupe(ctx, `${i + 1}. ${String(g.title || '').toUpperCase()}`, W - 2 * M - 110 - lp), M + 36, y);
    ctx.textAlign = 'right';
    ctx.fillText(prix, W - M - 50, y);
    ctx.textAlign = 'left';
  });

  // Les lignes : mois record, mieux note, telephone.
  let ly = ty + th + 70;
  ctx.fillStyle = BLANC;
  for (const l of (txt.lines || []).slice(0, 3)) {
    ctx.font = `700 30px ${MONO}`;
    ctx.fillStyle = ACCENT;
    ctx.fillText('>', M, ly);
    ctx.fillStyle = BLANC;
    ajuste(ctx, String(l), W - 2 * M - 44, 30, 20, MONO, '700');
    ctx.fillText(coupe(ctx, String(l), W - 2 * M - 44), M + 40, ly);
    ly += 50;
  }

  // Le pied : la marque, et le tampon RECUPERE.
  ctx.fillStyle = BLANC;
  ctx.font = `400 24px ${MONO}`;
  ctx.fillText(String(txt.footer || ''), M, H - 60);
  tampon(ctx, String(txt.stamp || '').toUpperCase(), W - M - 150, H - 100, { angle: -10, taille: 34, fond: ACCENT });
  return canvas;
}

/** L'image en PNG. */
export function cardBlob(canvas) {
  return new Promise((ok) => canvas.toBlob((b) => ok(b), 'image/png'));
}
