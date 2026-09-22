/* Un nouvel ordinateur ne doit pas tout retenter.
 *
 * Deux choses le permettaient :
 *
 *   - le registre ne recevait rien. Le moteur ecrit son historique en TEXTE
 *     JSON (GM_setValue), et addedEntries le parcourait comme un objet : zero
 *     entree, toujours. Constate sur une vraie installation le 2026-09-22 --
 *     treize reclamations dans l'historique, un registre absent ;
 *   - Ma collection savait ce que vous possedez sur Epic, GOG et Steam, mais
 *     aucun filtre ne la lisait.
 *
 * La regle du ROADMAP tient : la collection ne decide que sur un IDENTIFIANT
 * exact. Un faux « deja possede » ferait rater un jeu offert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readHistory, addedEntries, integrateHistory, ownedKeys } from '../watch/library.js';
import {
  offerStoreKeys, ownedStoreKeys, applyImport, emptyCollection, makeItem, IMPORT_STATUS,
} from '../watch/collection.js';
import { judge, REASONS } from '../watch/filters.js';
import { claimCandidates } from '../watch/cycle.js';
import { makeOffer, normaliseTitle, STORES, STATES } from '../watch/offer.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

/* ------------------------------------------- le registre recoit du texte */

test('l\'historique ecrit en texte JSON est lu', () => {
  const texte = JSON.stringify({ 'slug:mindcop-78e6c1': { status: 'claimed', reason: 'CLAIMED', ts: T, title: 'Mindcop' } });

  assert.deepEqual(Object.keys(readHistory(texte)), ['slug:mindcop-78e6c1']);
  const added = addedEntries(undefined, texte);
  assert.equal(added.length, 1);
  assert.equal(added[0].key, 'slug:mindcop-78e6c1');
});

test('seules les nouveautes comptent, meme en texte', () => {
  const avant = JSON.stringify({ a: { status: 'claimed', ts: 1 } });
  const apres = JSON.stringify({ a: { status: 'claimed', ts: 1 }, b: { status: 'claimed', ts: 2 } });
  assert.deepEqual(addedEntries(avant, apres).map((e) => e.key), ['b']);
});

test('un texte illisible ne casse rien', () => {
  assert.deepEqual(readHistory('{pas du json'), {});
  assert.deepEqual(readHistory('[1,2]'), {});
  assert.deepEqual(readHistory(null), {});
  assert.deepEqual(addedEntries('{', '}'), []);
});

test('le rattrapage de tout l\'historique remplit le registre, et le rejouer ne change rien', () => {
  const texte = JSON.stringify({
    'slug:mindcop-78e6c1': { status: 'claimed', reason: 'CLAIMED', ts: T, title: 'Mindcop' },
    'slug:rate': { status: 'failed', reason: 'x', ts: T },
  });
  const premier = integrateHistory({}, { platform: 'Epic Games', added: addedEntries(null, texte) });
  assert.equal(premier.changed, 1, 'seule l\'acquisition entre');
  assert.ok(ownedKeys(premier.library, normaliseTitle).has('epic|' + normaliseTitle('Mindcop')));

  const second = integrateHistory(premier.library, { platform: 'Epic Games', added: addedEntries(null, texte) });
  assert.equal(second.changed, 0);
});

/* ------------------------------------- la collection, par identifiant */

function collectionWith(store, items, status = IMPORT_STATUS.OK) {
  return applyImport(emptyCollection(), store, { status, items }, T);
}

const epicOffer = (over = {}) => makeOffer({
  source: 'epic-api', sourceId: '1513de80f23f42e584540be749826057', store: STORES.EPIC,
  storeId: 'mindcop-78e6c1', title: 'Mindcop', url: 'https://store.epicgames.com/p/mindcop-78e6c1', ...over,
});

test('une offre Epic designe son offerId, une offre GOG son produit', () => {
  assert.deepEqual(offerStoreKeys(epicOffer()), ['epic:1513de80f23f42e584540be749826057']);
  const gog = makeOffer({ source: 'gog', sourceId: 1207664663, store: STORES.GOG, storeId: 'x', title: 'X', url: 'https://www.gog.com/game/x' });
  assert.deepEqual(offerStoreKeys(gog), ['gog:1207664663']);
});

test('l\'agregateur, ou une source qui vise un autre magasin, ne designe rien', () => {
  const gp = makeOffer({ source: 'gamerpower', sourceId: 3721, store: STORES.EPIC, title: 'Mindcop', url: 'https://store.epicgames.com/p/mindcop' });
  assert.deepEqual(offerStoreKeys(gp), []);
  assert.deepEqual(offerStoreKeys(epicOffer({ store: STORES.GOG })), []);
  assert.deepEqual(offerStoreKeys(epicOffer({ sourceId: null })), []);
});

test('seul un magasin importe avec succes compte', () => {
  const item = makeItem({ store: 'epic', id: '1513de80f23f42e584540be749826057', title: 'Mindcop' });
  assert.equal(ownedStoreKeys(collectionWith('epic', [item])).size, 1);

  // Une importation ratee ne pose aucun jeu : il n'y a rien a compter.
  assert.equal(ownedStoreKeys(collectionWith('epic', [item], IMPORT_STATUS.SHAPE)).size, 0);

  // Une collection lue du stockage sans etat de magasin ne vaut rien non plus.
  assert.equal(ownedStoreKeys({ stores: {}, items: { 'epic:1': item } }).size, 0);
  assert.equal(ownedStoreKeys(null).size, 0);
});

test('une importation ratee apres une reussie garde les jeux', () => {
  const item = makeItem({ store: 'gog', id: 42, title: 'Jeu' });
  const ok = collectionWith('gog', [item]);
  const puisRate = applyImport(ok, 'gog', { status: IMPORT_STATUS.LOGGED_OUT }, T + 1000);
  assert.ok(ownedStoreKeys(puisRate).has('gog:42'));
});

test('possede sur le magasin, par identifiant : l\'offre est ecartee', () => {
  const ownedIds = ownedStoreKeys(collectionWith('epic', [makeItem({ store: 'epic', id: '1513de80f23f42e584540be749826057', title: 'Mindcop' })]));
  const r = judge(epicOffer(), {}, { supportedStores: [STORES.EPIC], ownedIds });
  assert.equal(r.claimable, false);
  assert.equal(r.reason, REASONS.ALREADY_OWNED);
});

test('le meme TITRE sous un autre identifiant ne suffit jamais', () => {
  /* La regle du ROADMAP : un jeu du meme nom -- une autre edition, un autre
     produit -- n'est pas le jeu offert. Rien n'est ecarte sur un titre. */
  const ownedIds = ownedStoreKeys(collectionWith('epic', [makeItem({ store: 'epic', id: 'autre-offre', title: 'Mindcop' })]));
  assert.equal(judge(epicOffer(), {}, { supportedStores: [STORES.EPIC], ownedIds }).claimable, true);
});

test('le cycle n\'ouvre pas d\'onglet pour ce que le magasin dit posseder', () => {
  const offer = { ...epicOffer(), state: STATES.CONFIRMED, catalogKey: 'epic:mindcop-78e6c1' };
  const catalog = { 'epic:mindcop-78e6c1': offer };
  const ownedIds = ownedStoreKeys(collectionWith('epic', [makeItem({ store: 'epic', id: offer.sourceId, title: 'Mindcop' })]));

  const avec = claimCandidates(catalog, {}, { claimableStores: [STORES.EPIC], now: T, ownedIds });
  assert.equal(avec.candidates.length, 0);
  assert.equal(avec.dropped[0].reason, REASONS.ALREADY_OWNED);

  const sans = claimCandidates(catalog, {}, { claimableStores: [STORES.EPIC], now: T });
  assert.equal(sans.candidates.length, 1, 'sans collection, rien ne change');
});
