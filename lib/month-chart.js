/* Le graphique du Bilan : les jeux recuperes, mois par mois (2.72.0).
 *
 * Le Bilan disait « 23 jeux recuperes » et « votre meilleur mois : mars, 6
 * jeux ». Le rythme, lui -- une annee qui s'accelere, un magasin qui se tait
 * depuis l'ete --, ne se lit que dessine.
 *
 * UNE SEULE SERIE : le nombre de jeux. La valeur economisee est une autre
 * grandeur, dans d'autres unites -- et parfois deux devises qui ne
 * s'additionnent pas : elle n'a pas de second axe, elle vit dans l'infobulle
 * et dans le tableau.
 *
 * Les mois sont ceux du bilan (`tally().byMonth`), en UTC : le graphique et
 * « votre meilleur mois » doivent designer le meme mois.
 *
 * Module pur : il rend des nombres, le popup dessine.
 */

/** Les `mois` derniers mois, le mois courant compris : 'AAAA-MM'. */
export function lastMonths(now, mois = 12) {
  const d = new Date(now);
  const out = [];
  for (let i = mois - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/**
 * La serie : un point par mois, `{ month, count, totals }`. `rows` vient de
 * `claimsMade` ; ce qui etait deja a vous ne compte pas -- il ne vous a rien
 * rapporte ce mois-la --, et une valeur n'est additionnee que dans sa devise.
 */
export function monthlySeries(rows, now, mois = 12) {
  const cles = lastMonths(now, mois);
  const parMois = Object.fromEntries(cles.map((k) => [k, { month: k, count: 0, totals: {} }]));
  for (const r of rows || []) {
    if (!r || r.already || typeof r.ts !== 'number' || !Number.isFinite(r.ts)) continue;
    const point = parMois[new Date(r.ts).toISOString().slice(0, 7)];
    if (!point) continue;
    point.count++;
    if (typeof r.worth === 'number' && Number.isFinite(r.worth) && r.currency && r.currency !== '?') {
      point.totals[r.currency] = Math.round(((point.totals[r.currency] || 0) + r.worth) * 100) / 100;
    }
  }
  return cles.map((k) => parMois[k]);
}

/** Vaut-il la peine de dessiner ? Au moins deux mois non vides : un seul baton ne montre aucun rythme. */
export function worthDrawing(series) {
  return (series || []).filter((p) => p.count > 0).length >= 2;
}

/**
 * Les mois dont la valeur s'ecrit sur le baton : le plus haut (le plus
 * recent, a egalite) et le mois en cours. Jamais tous -- l'infobulle et le
 * tableau portent le reste.
 */
export function labelledMonths(series) {
  const liste = series || [];
  const out = new Set();
  let max = -1;
  let iMax = -1;
  liste.forEach((p, i) => { if (p.count > 0 && p.count >= max) { max = p.count; iMax = i; } });
  if (iMax >= 0) out.add(iMax);
  const dernier = liste.length - 1;
  if (dernier >= 0 && liste[dernier].count > 0) out.add(dernier);
  return out;
}

/** La hauteur d'un baton, en fraction du plus haut ; un mois non vide reste visible. */
export function barHeight(count, max) {
  if (!(count > 0) || !(max > 0)) return 0;
  return Math.max(0.06, count / max);
}
