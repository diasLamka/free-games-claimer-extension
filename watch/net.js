/* Dire ce qu'une requete a rate, sans se tromper de coupable.
 *
 * Ce module existe a cause d'un diagnostic faux, et d'une soiree perdue
 * dessus. Le journal disait, trois fois d'affilee :
 *
 *   gamerpower : echec
 *   {"errors":["JSON illisible : signal is aborted without reason"]}
 *
 * « JSON illisible » accusait l'API d'avoir change de format. Elle n'avait
 * rien change : c'est NOTRE minuteur qui avait coupe la requete pendant la
 * lecture du corps. `fetch` rend alors ses en-tetes -- donc `response.ok` est
 * vrai, donc on entre dans `response.json()` -- et c'est la que l'abandon
 * remonte. Chaque source avait deux endroits ou attraper une erreur : le
 * catch exterieur traduisait bien l'abandon en « delai depasse », et le catch
 * interieur, pose autour du seul `json()`, le renommait en probleme de
 * format. Le mauvais message gagnait, parce qu'il etait le plus proche.
 *
 * Une seule fonction pour les deux endroits, donc, et pour toutes les
 * sources. Un motif d'echec est ce que l'utilisateur lit avant de decider si
 * le probleme vient de chez lui ; il n'a pas le droit de mentir.
 *
 * Module pur : aucune API d'extension, aucun acces reseau.
 */

/**
 * Pourquoi cette requete a echoue, en une ligne pour le journal.
 *
 * `signal` est celui qu'on a passe a `fetch`. On le consulte EN PREMIER, et
 * c'est le point : quand notre minuteur a tire, la cause est notre delai,
 * quelle que soit la forme que l'erreur a prise en remontant. Toutes les
 * plateformes ne rejettent pas un abandon avec un `AbortError` -- certaines
 * rendent un « Failed to fetch » ordinaire -- et se fier au seul nom de
 * l'erreur, c'est se remettre a cette loterie.
 *
 * `label` nomme l'etape, et ne sert QUE lorsque l'echec n'est pas le notre :
 * une reponse vraiment mal formee merite toujours son « JSON illisible », qui
 * dit a l'utilisateur que l'API a change. Le supprimer pour corriger le
 * mensonge aurait remplace un mauvais diagnostic par une absence de
 * diagnostic -- deux tests l'ont refuse, et ils avaient raison.
 */
/**
 * Ce motif d'echec est-il celui d'un RESEAU qui ne repond pas (2.99.4) ?
 *
 * « Failed to fetch », un delai depasse, une page d'erreur de Chrome : rien de
 * cela ne dit que la source a change. Au reveil d'un portable, le navigateur
 * croit encore le reseau la (`navigator.onLine` est vrai) alors que le wifi
 * n'est pas revenu -- toutes les sources echouent ensemble, de la meme facon,
 * et c'est la coupure, pas elles. Un statut HTTP (« HTTP 503 ») n'en est pas
 * un : le serveur a repondu.
 */
export function isNetworkFailure(message) {
  return /failed to fetch|networkerror|network request failed|load failed|net::err_|delai depasse|requete abandonnee|timed out|econnreset|enotfound|dns/i
    .test(String(message || ''));
}

export function describeFetchFailure(e, { timeoutMs, signal, label } = {}) {
  const aborted = Boolean((signal && signal.aborted) || (e && e.name === 'AbortError'));
  if (aborted) {
    return typeof timeoutMs === 'number' ? `delai depasse (${timeoutMs} ms)` : 'requete abandonnee';
  }
  const message = (e && e.message) || String(e);
  return label ? `${label} : ${message}` : message;
}
