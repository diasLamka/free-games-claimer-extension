/* Le Steam Deck (2.49.0) : ce jeu y tourne-t-il ?
 *
 * La categorie vient de GetItems (`include_platforms`), dans la reponse que
 * l'extension lisait deja. Sa forme connectee n'a pas ete mesuree ici : chaque
 * test verifie donc aussi qu'une forme inconnue vaut « on ne sait pas », et
 * que « on ne sait pas » ne passe aucun filtre ni n'efface rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DECK, deckAtLeast, deckFromItem, readDeck } from '../watch/deck.js';
import { itemsUrl, mapItem } from '../watch/sources/steam.js';
import { makeOffer, merge, STORES } from '../watch/offer.js';
import { buildRows, filterRows, makeItem, KINDS } from '../watch/collection.js';

const T = Date.UTC(2026, 8, 23, 12, 0, 0);

/* ------------------------------------------------------------ la lecture */

test('la categorie Steam, en nombre ou en nom d\'enumeration', () => {
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 3 } }), DECK.VERIFIED);
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 2 } }), DECK.PLAYABLE);
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 1 } }), DECK.UNSUPPORTED);
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 'k_ESteamDeckCompatibilityCategory_Verified' } }), DECK.VERIFIED);
});

test('inconnu, absent ou etrange : on ne sait pas', () => {
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 0 } }), null);
  assert.equal(deckFromItem({ platforms: { steam_deck_compat_category: 9 } }), null);
  assert.equal(deckFromItem({ platforms: {} }), null);
  assert.equal(deckFromItem({}), null);
  assert.equal(deckFromItem(null), null);
  assert.equal(readDeck('toaster'), null);
});

test('le seuil : jouable laisse passer verifie, une inconnue ne passe rien', () => {
  assert.ok(deckAtLeast(DECK.VERIFIED, 'playable'));
  assert.ok(deckAtLeast(DECK.PLAYABLE, 'playable'));
  assert.ok(!deckAtLeast(DECK.PLAYABLE, 'verified'));
  assert.ok(!deckAtLeast(DECK.UNSUPPORTED, 'playable'));
  assert.ok(!deckAtLeast(null, 'playable'), 'le filtre promet que le jeu tourne');
  assert.ok(deckAtLeast(null, ''), 'sans seuil, tout passe');
});

/* ------------------------------------------------------- la source Steam */

test('GetItems demande les plateformes, dans la meme requete', () => {
  const input = JSON.parse(decodeURIComponent(itemsUrl(['10']).split('input_json=')[1]));
  assert.equal(input.data_request.include_platforms, true);
  assert.equal(input.data_request.include_basic_info, true, 'rien de retire');
});

test('une offre Steam porte sa categorie Deck', () => {
  const o = mapItem({
    appid: 10, name: 'Jeu offert', type: 0,
    best_purchase_option: { is_free_to_keep: true, packageid: 1 },
    platforms: { steam_deck_compat_category: 3 },
  }, T, null);
  assert.equal(o.deck, DECK.VERIFIED);
});

test('une offre d\'ailleurs n\'efface pas ce que Steam a dit', () => {
  const steam = makeOffer({ source: 'steam', store: STORES.STEAM, storeId: '10', title: 'Jeu', deck: 'verified', seenAt: T });
  const agregateur = makeOffer({ source: 'gamerpower', store: STORES.STEAM, title: 'Jeu', seenAt: T });
  assert.equal(agregateur.deck, null);
  assert.equal(merge(steam, agregateur).deck, DECK.VERIFIED);
  assert.equal(merge(agregateur, steam).deck, DECK.VERIFIED);
});

/* ------------------------------------------------------------ la collection */

test('un jeu importe ne porte le champ que si Steam l\'a dit', () => {
  assert.equal(makeItem({ store: 'steam', id: '10', title: 'A', deck: 'playable' }).deck, DECK.PLAYABLE);
  assert.ok(!('deck' in makeItem({ store: 'steam', id: '11', title: 'B' })), 'pas un null par jeu');
  assert.ok(!('deck' in makeItem({ store: 'steam', id: '12', title: 'C', deck: 'bizarre' })));
});

test('le filtre Deck ne garde que ce qui tourne', () => {
  const collection = {
    stores: {},
    items: {
      'steam:1': makeItem({ store: 'steam', id: '1', title: 'Verifie', kind: KINDS.GAME, deck: 'verified' }),
      'steam:2': makeItem({ store: 'steam', id: '2', title: 'Jouable', kind: KINDS.GAME, deck: 'playable' }),
      'steam:3': makeItem({ store: 'steam', id: '3', title: 'Non', kind: KINDS.GAME, deck: 'unsupported' }),
      'gog:4': makeItem({ store: 'gog', id: '4', title: 'Inconnu', kind: KINDS.GAME }),
    },
  };
  const rows = buildRows({ collection, library: {} });
  const titres = (deck) => filterRows(rows, { deck }).map((r) => r.title).sort();
  assert.deepEqual(titres(''), ['Inconnu', 'Jouable', 'Non', 'Verifie']);
  assert.deepEqual(titres('playable'), ['Jouable', 'Verifie']);
  assert.deepEqual(titres('verified'), ['Verifie']);
});

import { importSteam } from '../watch/collection-import.js';
import { OWNED_URL } from '../watch/sources/steam.js';

test('l\'import de la bibliotheque rapporte la categorie Deck, sans requete de plus', async () => {
  const appels = [];
  const fetch = async (url) => {
    appels.push(url);
    const corps = url === OWNED_URL
      ? { rgOwnedApps: [10, 20] }
      : { response: { store_items: [
        { appid: 10, name: 'Sur le Deck', type: 0, platforms: { steam_deck_compat_category: 3 } },
        { appid: 20, name: 'Sans forme connue', type: 0, platforms: { autre: true } },
      ] } };
    return { ok: true, status: 200, url, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(corps) };
  };
  const r = await importSteam({ fetch, pause: async () => {} });
  assert.equal(appels.length, 2, 'userdata, puis un seul lot GetItems');
  const parId = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(parId['10'].deck, DECK.VERIFIED);
  assert.ok(!('deck' in parId['20']));
  assert.match(r.report, /platforms/, 'le rapport montre la forme : c\'est la mesure');
});
