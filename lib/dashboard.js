/* Le tableau de bord : le popup, ouvert en grand dans un onglet (2.58.0).
 *
 * C'est l'onglet dedie du design (§9) -- veille, offres, codes, reglages sur
 * un ecran. Ce n'est PAS une seconde page : popup.html s'y dispose en
 * colonnes. Deux pages auraient fini par diverger, et un reglage ajoute au
 * popup aurait manque au tableau de bord.
 *
 * Module PUR : il dit ou la page tourne, il ne touche a rien.
 */

/** La page d'options du manifeste, et ce qu'ouvre le bouton « en grand ». */
export const DASHBOARD_PAGE = 'pages/popup.html?vue=onglet';

/**
 * La page tourne-t-elle dans un onglet ?
 *
 * Deux signes, et aucun ne peut se tromper dans le vrai popup :
 *   - `?vue=onglet`, que porte DASHBOARD_PAGE ;
 *   - la liste des vues de type ONGLET de l'extension
 *     (`extension.getViews({ type: 'tab' })`), ou le popup ne figure jamais.
 *     Elle couvre popup.html ouvert a la main, ou un navigateur qui perdrait
 *     la requete de la page d'options.
 *
 * Un doute vaut « popup » : sa mise en page tient aussi dans un onglet, alors
 * qu'une mise en page d'onglet ferait grandir le popup jusqu'a 800 px.
 */
export function isDashboard(search, tabViews, self) {
  if (new URLSearchParams(search || '').get('vue') === 'onglet') return true;
  return Array.isArray(tabViews) && self != null && tabViews.includes(self);
}
