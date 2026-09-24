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
  KEY_STEAM_WISHLIST, MAX_STEAM_WISHES, WISH_ORIGIN, makeSteamWishlist, steamWishes, wishOrigin,
  KEY_GOG_WISHLIST, makeImportedWishlist,
} from '../watch/wishlist.js';
import { readFileSync } from 'node:fs';
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

/* ------------------------------------------------- la liste Steam (2.46.0) */

const steamOffre = (appid, title) => ({
  ...makeOffer({
    source: 'steam', sourceId: appid, store: STORES.STEAM, storeId: appid, title,
    url: `https://store.steampowered.com/app/${appid}/`, seenAt: T,
  }),
});

test('la liste Steam a sa propre cle, dans l\'espace de la veille', () => {
  assert.ok(KEY_STEAM_WISHLIST.startsWith('veille:'));
  assert.notEqual(KEY_STEAM_WISHLIST, KEY_WISHLIST);
});

test('la photographie Steam garde les appids lisibles, une fois chacun', () => {
  const s = makeSteamWishlist([
    { id: '367520', title: 'Hollow Knight' },
    { id: 367520, title: 'Hollow Knight' },
    { id: 'abc', title: 'Pas un appid' },
    { id: '42', title: null },
  ], normaliseTitle, T);

  assert.equal(s.at, T);
  assert.deepEqual(steamWishes(s).map((w) => w.id), ['367520', '42']);
  assert.equal(steamWishes(s)[0].key, 'hollow knight');
  assert.equal(steamWishes(s)[1].key, null, 'sans nom, pas de cle de titre');
});

test('la photographie Steam est bornee', () => {
  const beaucoup = Array.from({ length: MAX_STEAM_WISHES + 10 }, (_, i) => ({ id: String(i + 1), title: `Jeu ${i}` }));
  assert.equal(steamWishes(makeSteamWishlist(beaucoup, normaliseTitle, T)).length, MAX_STEAM_WISHES);
});

test('un souhait Steam reconnait le meme jeu offert sur Epic, par son titre', () => {
  const s = makeSteamWishlist([{ id: '367520', title: 'Hollow Knight' }], normaliseTitle, T);
  assert.equal(wishOrigin([], offre('Hollow Knight'), normaliseTitle, s), WISH_ORIGIN.STEAM);
  assert.equal(isWished([], offre('Celeste'), normaliseTitle, s), false);
});

test('une offre Steam se reconnait par son appid, meme sous un autre titre', () => {
  const s = makeSteamWishlist([{ id: '42', title: null }], normaliseTitle, T);
  assert.equal(wishOrigin([], steamOffre('42', 'Titre traduit'), normaliseTitle, s), WISH_ORIGIN.STEAM);
  // Le meme identifiant sur un autre magasin ne designe pas le meme jeu.
  assert.equal(wishOrigin([], offre('Titre traduit', { store: STORES.EPIC, storeId: '42' }), normaliseTitle, s), null);
});

test('la saisie gagne sur Steam : c\'est elle que le coeur sait retirer', () => {
  const s = makeSteamWishlist([{ id: '367520', title: 'Hollow Knight' }], normaliseTitle, T);
  const l = addWish([], 'Hollow Knight', normaliseTitle);
  assert.equal(wishOrigin(l, offre('Hollow Knight'), normaliseTitle, s), WISH_ORIGIN.MANUAL);
});

test('sans liste Steam, rien ne change', () => {
  assert.equal(wishOrigin([], offre('Hollow Knight'), normaliseTitle, null), null);
  assert.equal(wishOrigin([], offre('Hollow Knight'), normaliseTitle, { wishes: 'casse' }), null);
  assert.deepEqual(markWished([offre('A')], [], normaliseTitle).map((o) => o.wished), [false]);
});

test('markWished lit aussi la liste Steam', () => {
  const s = makeSteamWishlist([{ id: '1', title: 'A' }], normaliseTitle, T);
  assert.deepEqual(markWished([offre('A'), offre('B')], [], normaliseTitle, s).map((o) => o.wished), [true, false]);
});

/* ------------------------------------------------------------ la liste GOG (2.66.0) */

test('la liste GOG a sa propre cle, et la meme photographie que Steam', () => {
  assert.equal(KEY_GOG_WISHLIST, 'veille:souhaits-gog');
  assert.equal(makeSteamWishlist, makeImportedWishlist, 'l\'ancien nom reste, pour ce qui l\'utilise encore');
  const g = makeImportedWishlist([{ id: '1207658924', title: 'Unreal Gold' }, { id: 'x', title: 'y' }], normaliseTitle, T);
  assert.deepEqual(g.wishes.map((w) => w.id), ['1207658924']);
});

test('une offre GOG se reconnait par son numero de produit, pas par son slug', () => {
  const g = makeImportedWishlist([{ id: '1207658924', title: null }], normaliseTitle, T);
  const gog = offre('Titre traduit', { source: 'gog', sourceId: '1207658924', store: STORES.GOG, storeId: 'unreal_gold' });
  assert.equal(wishOrigin([], gog, normaliseTitle, null, g), WISH_ORIGIN.GOG);
  // Le meme numero venu de l'agregateur ne dit rien : ce n'est pas un numero GOG.
  const agregateur = offre('Titre traduit', { source: 'gamerpower', sourceId: '1207658924', store: STORES.GOG });
  assert.equal(wishOrigin([], agregateur, normaliseTitle, null, g), null);
});

test('un souhait GOG reconnait le meme jeu offert sur Epic ; la saisie et Steam passent devant', () => {
  const g = makeImportedWishlist([{ id: '1', title: 'Hollow Knight' }], normaliseTitle, T);
  const s = makeImportedWishlist([{ id: '367520', title: 'Hollow Knight' }], normaliseTitle, T);
  assert.equal(wishOrigin([], offre('Hollow Knight'), normaliseTitle, null, g), WISH_ORIGIN.GOG);
  assert.equal(wishOrigin([], offre('Hollow Knight'), normaliseTitle, s, g), WISH_ORIGIN.STEAM);
  assert.equal(wishOrigin(addWish([], 'Hollow Knight', normaliseTitle), offre('Hollow Knight'), normaliseTitle, s, g), WISH_ORIGIN.MANUAL);
  assert.deepEqual(markWished([offre('Hollow Knight'), offre('B')], [], normaliseTitle, null, g).map((o) => o.wished), [true, false]);
});

test('la liste GOG est lue par le cycle, ecrite par l\'import, montree par le popup', () => {
  const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.match(lire('watch/storage.js'), /gogWishlist: raw\[KEY_GOG_WISHLIST\] \|\| null,/);
  assert.match(lire('watch/cycle.js'), /markWished\(pending, ctx\.wishlist, normaliseTitle, ctx\.steamWishlist, ctx\.gogWishlist\)/);
  assert.match(lire('background.js'), /\{ steam: KEY_STEAM_WISHLIST, gog: KEY_GOG_WISHLIST \}\[store\]/);
  assert.match(lire('pages/popup.js'), /wishOrigin\(ctx\.wishlist, offer, normaliseTitle, ctx\.steamWishlist, ctx\.gogWishlist\)/);
});
