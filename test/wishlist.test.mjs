/* La liste de souhaits : la premiere fois que l'utilisateur dit ce qu'il VEUT.
 *
 * Jusqu'ici il ne pouvait exprimer qu'un refus : la croix, qui exclut un titre
 * pour toujours. Aucune cle ne stockait un desir, la decision d'annonce ne
 * connaissait qu'un mode uniforme, et l'ordre de reclamation se calculait sur
 * la seule urgence.
 *
 * Un souhait porte sur un TITRE, pas sur une offre : c'est precisement son
 * interet. Le jeu attendu depuis des mois n'est encore dans aucun catalogue --
 * le souhait doit survivre a son absence et se reconnaitre le jour ou il
 * parait, sur n'importe quel magasin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_WISHLIST, MAX_WISHES, addWish, isWished, markWished, removeWish, wishes,
} from '../watch/wishlist.js';
import { makeOffer, normaliseTitle, STORES } from '../watch/offer.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

function offre(title, over = {}) {
  return {
    ...makeOffer({
      source: 'epic-api', store: STORES.EPIC, storeId: title, title,
      url: 'https://store.epicgames.com/p/x', seenAt: T,
    }),
    ...over,
  };
}

/* ------------------------------------------------------------ la liste */

test('la cle vit dans l\'espace de la veille', () => {
  assert.ok(KEY_WISHLIST.startsWith('veille:'));
});

test('un souhait s\'ajoute une fois, meme si on insiste', () => {
  let l = addWish([], 'Hollow Knight: Silksong', normaliseTitle);
  l = addWish(l, 'Hollow Knight: Silksong', normaliseTitle);

  assert.equal(wishes(l).length, 1);
});

test('la casse et la ponctuation ne font pas deux souhaits', () => {
  /* Le rapprochement se fait sur le titre normalise, comme partout ailleurs
     dans la veille. Deux entrees pour le meme jeu voudraient dire deux
     annonces prioritaires pour une seule offre. */
  let l = addWish([], 'Hollow Knight: Silksong', normaliseTitle);
  l = addWish(l, 'hollow knight silksong', normaliseTitle);

  assert.equal(wishes(l).length, 1);
});

test('un souhait se retire', () => {
  const l = removeWish(addWish([], 'Tyranny', normaliseTitle), 'TYRANNY', normaliseTitle);

  assert.deepEqual(wishes(l), []);
});

test('un titre vide n\'entre pas dans la liste', () => {
  /* Un souhait vide correspondrait a toutes les offres sans titre, donc a
     n'importe quoi. */
  assert.deepEqual(wishes(addWish([], '   ', normaliseTitle)), []);
});

test('la liste est bornee', () => {
  let l = [];
  for (let i = 0; i < MAX_WISHES + 10; i++) l = addWish(l, `Jeu numero ${i}`, normaliseTitle);

  assert.equal(wishes(l).length, MAX_WISHES);
  assert.ok(isWished(l, offre(`Jeu numero ${MAX_WISHES + 9}`), normaliseTitle), 'le dernier ajoute est garde');
});

/* ------------------------------------------------------ le rapprochement */

test('une offre attendue est reconnue quel que soit le magasin', () => {
  /* Le souhait porte sur un titre : posseder un jeu sur Epic ne le donne pas
     sur GOG, et c'est justement la copie GOG qu'on peut attendre. */
  const l = addWish([], 'Tyranny', normaliseTitle);

  assert.ok(isWished(l, offre('Tyranny'), normaliseTitle));
  assert.ok(isWished(l, { ...offre('Tyranny'), store: STORES.GOG }, normaliseTitle));
});

test('une offre qui n\'est pas attendue ne l\'est pas', () => {
  assert.equal(isWished(addWish([], 'Tyranny', normaliseTitle), offre('Autre chose'), normaliseTitle), false);
});

test('une liste vide ne rend jamais rien attendu', () => {
  /* Le cas du premier jour. Une liste vide qui rendrait tout prioritaire
     ferait de la nouveaute une regression. */
  assert.equal(isWished([], offre('Tyranny'), normaliseTitle), false);
});

test('marquer un lot pose le drapeau sans toucher au reste', () => {
  const l = addWish([], 'Tyranny', normaliseTitle);

  const [attendu, ordinaire] = markWished([offre('Tyranny'), offre('Autre')], l, normaliseTitle);

  assert.equal(attendu.wished, true);
  assert.equal(ordinaire.wished, false);
  assert.equal(attendu.title, 'Tyranny', 'rien d\'autre n\'a bouge');
});
