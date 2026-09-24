/* Les puces de magasin au-dessus des jeux (2.61.0).
 *
 * « Tous 5 · Epic 2 · Steam 2 · Epic mobile 1 » : un clic ne garde que les
 * offres d'un magasin, un second revient a tout. La recherche filtrait deja
 * par nom de magasin, mais il fallait le taper -- et savoir lesquels avaient
 * des offres.
 *
 * Le choix n'est PAS memorise d'une ouverture a l'autre, comme la recherche :
 * un filtre « Steam » oublie cacherait, a l'ouverture suivante, le jeu Epic
 * arrive entre-temps. Le popup sert d'abord a voir ce qui est gratuit.
 *
 * Module PUR.
 */

/** La puce « Tous ». */
export const ALL = 'all';

/**
 * Les puces d'une liste d'offres `{ offer }` : un magasin par puce, le plus
 * fourni d'abord, puis dans l'ordre de `order` (celui des reglages).
 *
 * Un magasin choisi qui n'a plus d'offre ne filtre plus rien : la puce active
 * redevient « Tous », plutot qu'une liste vide sans puce pour en sortir.
 * `useful` dit s'il y a de quoi choisir -- une seule boutique, rien a filtrer.
 */
export function storeChips(rows, selected, order = []) {
  const counts = new Map();
  for (const row of rows || []) {
    const store = row && row.offer && row.offer.store;
    if (typeof store === 'string' && store) counts.set(store, (counts.get(store) || 0) + 1);
  }
  const rang = (s) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };
  const stores = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || rang(a[0]) - rang(b[0]) || a[0].localeCompare(b[0]));
  const active = selected && counts.has(selected) ? selected : ALL;
  return {
    active,
    total: (rows || []).length,
    chips: stores.map(([store, count]) => ({ store, count, active: store === active })),
    useful: stores.length >= 2,
  };
}

/** Les offres du magasin choisi ; toutes pour « Tous ». */
export function byStore(rows, store) {
  if (!store || store === ALL) return rows || [];
  return (rows || []).filter((row) => row && row.offer && row.offer.store === store);
}
