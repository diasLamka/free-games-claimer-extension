/* Le Steam Deck : ce jeu y tourne-t-il ?
 *
 * La question qui suit « est-ce que je l'ai ? » quand on joue sur la console
 * de Valve. Steam y repond lui-meme, jeu par jeu -- verifie, jouable, non pris
 * en charge -- et il le fait dans la reponse que l'extension lit DEJA :
 * `IStoreBrowseService/GetItems`, pourvu qu'on lui demande `include_platforms`.
 * Aucune requete de plus, aucun hote de plus.
 *
 * CE QUI EST MESURE ET CE QUI NE L'EST PAS. Le champ lu est
 * `platforms.steam_deck_compat_category`, la categorie que la boutique Steam
 * affiche sur chaque fiche : 1 non pris en charge, 2 jouable, 3 verifie, 0 ou
 * absent inconnu. Il n'a pas ete mesure dans ce depot -- le banc de test n'a
 * pas acces a Steam. D'ou la regle de tout le module : une valeur qu'on ne
 * reconnait pas vaut « on ne sait pas », et « on ne sait pas » ne s'affiche
 * pas. La premiere importation de Ma collection le dira : son rapport montre
 * la forme d'un element GetItems, `platforms` compris.
 *
 * Seuls les jeux STEAM portent cette information : un jeu Epic ou GOG n'a pas
 * d'appid, et le rapprocher d'un jeu Steam par son titre serait affirmer une
 * compatibilite qu'on n'a pas lue.
 *
 * Module PUR.
 */

export const DECK = Object.freeze({
  VERIFIED: 'verified',
  PLAYABLE: 'playable',
  UNSUPPORTED: 'unsupported',
});

/** L'ordre, du meilleur au pire : sert au filtre « au moins jouable ». */
const RANG = Object.freeze({ [DECK.VERIFIED]: 3, [DECK.PLAYABLE]: 2, [DECK.UNSUPPORTED]: 1 });

/** Les formes connues de la categorie : le nombre, ou le nom de l'enumeration Steam. */
const PAR_VALEUR = Object.freeze({
  3: DECK.VERIFIED,
  2: DECK.PLAYABLE,
  1: DECK.UNSUPPORTED,
  k_ESteamDeckCompatibilityCategory_Verified: DECK.VERIFIED,
  k_ESteamDeckCompatibilityCategory_Playable: DECK.PLAYABLE,
  k_ESteamDeckCompatibilityCategory_Unsupported: DECK.UNSUPPORTED,
});

/** La categorie Deck d'un element GetItems, ou null quand on ne sait pas. */
export function deckFromItem(item) {
  const brut = item && item.platforms ? item.platforms.steam_deck_compat_category : undefined;
  if (brut === undefined || brut === null) return null;
  return PAR_VALEUR[brut] || null;
}

/** Une valeur stockee, verifiee : une des trois, ou null. */
export function readDeck(value) {
  return RANG[value] ? value : null;
}

/**
 * Cette valeur atteint-elle le seuil demande ?
 *
 * `min` vaut 'playable' ou 'verified' ; un seuil vide laisse tout passer. Un
 * jeu dont on ne sait rien ne passe AUCUN seuil : le filtre promet que le jeu
 * tourne, et une inconnue ne le promet pas.
 */
export function deckAtLeast(value, min) {
  if (!min) return true;
  const v = RANG[readDeck(value)] || 0;
  return v >= (RANG[min] || Infinity);
}
