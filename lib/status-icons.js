/* Les icones de statut, dessinees au DOM (2.81.0 dans le popup, partagees
 * avec la page Historique en 2.83.0).
 *
 * 16 x 16, un seul trait, la couleur venant de `currentColor` : un cercle coche
 * pour « recupere », une double coche pour « deja a vous », un cercle barre
 * pour « ignore », une croix pour l'echec, une horloge pour ce qui attend, un
 * point d'exclamation pour une offre ratee, un point d'interrogation pour une
 * issue inconnue.
 *
 * Jamais d'innerHTML (voir SECURITY.md) : chaque forme est un element cree par
 * `createElementNS`, avec ses attributs poses un a un. Les mots du statut vont
 * dans `<title>` et `aria-label` : l'icone ne remplace pas le sens, elle le
 * resume.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const CERCLE = ['circle', { cx: 8, cy: 8, r: 6.5 }];

export const STATUS_ICONS = Object.freeze({
  ok: [CERCLE, ['path', { d: 'M5.2 8.3l1.9 1.9 3.7-4.1' }]],
  own: [['path', { d: 'M1.6 8.7l2.5 2.5 5-5.6' }], ['path', { d: 'M7.7 10.9l.3.3 5-5.6' }]],
  skip: [CERCLE, ['path', { d: 'M5.4 10.6l5.2-5.2' }]],
  ko: [CERCLE, ['path', { d: 'M5.9 5.9l4.2 4.2M10.1 5.9l-4.2 4.2' }]],
  wait: [CERCLE, ['path', { d: 'M8 4.9V8l2.1 1.4' }]],
  miss: [CERCLE, ['path', { d: 'M8 4.7v3.9M8 11.2v.1' }]],
  unknown: [CERCLE, ['path', { d: 'M6.1 6.3a1.95 1.95 0 1 1 2.8 1.75c-.55.25-.9.7-.9 1.25v.2M8 11.3v.1' }]],
});

/** L'icone `kind`, nommee `label`. Un genre inconnu dessine l'horloge. */
export function statusIcon(kind, label, doc = document) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', `st-icon ${STATUS_ICONS[kind] ? kind : 'wait'}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const titre = doc.createElementNS(SVG_NS, 'title');
  titre.textContent = label;
  svg.append(titre);
  for (const [tag, attrs] of STATUS_ICONS[kind] || STATUS_ICONS.wait) {
    const n = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.append(n);
  }
  return svg;
}
