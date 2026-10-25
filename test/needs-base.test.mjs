/* Les DLC dont on n'a pas le jeu de base (2.113.0).
 *
 * L'extension continuait de les chercher : un DLC Steam gratuit dont le jeu de base manque revient en « Jeu de base requis », est relu toutes les
 * douze heures (la bibliotheque, puis le nom du jeu de base chez Steam), apparait dans « Vous attendent » et dans la liste, et s'annonce. Une option
 * -- coupee par defaut : un reglage ne retire rien dans le dos de l'utilisateur -- les ecarte : plus d'essai, plus de lecture, plus de ligne, plus
 * d'annonce. Elle ne conclut JAMAIS d'une collection Steam absente : ne pas savoir n'est pas savoir que le jeu manque.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FILTERS, REASONS, judge, baseGameMissing } from '../watch/filters.js';
import { claimCandidates, toNotify } from '../watch/cycle.js';
import { makeOffer, STORES, STATES } from '../watch/offer.js';

const T = Date.UTC(2026, 9, 13, 10, 0, 0);
const DAY = 24 * 3600 * 1000;
const opts = (ownedIds) => ({ supportedStores: [STORES.STEAM], ownedIds });

const dlc = (extra = {}) => makeOffer({
  source: 'steam', store: STORES.STEAM, storeId: '222', packageId: '9001', parentAppid: '111',
  title: 'Un DLC', url: 'https://store.steampowered.com/app/222/', keepable: true, category: 'dlc', end: T + 2 * DAY, ...extra,
});

/* Une collection Steam lue (au moins un jeu) qui ne contient PAS le jeu de base 111. */
const possede = (...appids) => new Set(appids.map((a) => 'steam:' + a));

test('par defaut, rien n\'est ecarte : un reglage ne retire rien dans le dos de l\'utilisateur', () => {
  assert.equal(DEFAULT_FILTERS.skipNeedsBase, false);
  assert.equal(judge(dlc(), {}, opts(possede('5'))).claimable, true);
});

test('option active, jeu de base absent d\'une collection Steam lue : le DLC est ecarte', () => {
  const r = judge(dlc(), { skipNeedsBase: true }, opts(possede('5')));
  assert.equal(r.claimable, false);
  assert.equal(r.reason, REASONS.NEEDS_BASE);
});

test('option active, jeu de base possede : le DLC reste reclamable', () => {
  assert.equal(judge(dlc(), { skipNeedsBase: true }, opts(possede('5', '111'))).claimable, true);
});

test('une collection Steam jamais lue ne prouve rien : on n\'ecarte pas', () => {
  for (const ids of [null, undefined, new Set(), possede().add('epic:abc')]) {
    assert.equal(judge(dlc(), { skipNeedsBase: true }, opts(ids)).claimable, true, String(ids));
  }
});

test('sans collection, le verdict « jeu de base requis » deja constate suffit', () => {
  assert.equal(judge(dlc({ verdict: 'needs_base_game' }), { skipNeedsBase: true }, opts(null)).reason, REASONS.NEEDS_BASE);
});

test('mais le jeu de base achete depuis rouvre la porte, malgre l\'ancien verdict', () => {
  assert.equal(judge(dlc({ verdict: 'needs_base_game' }), { skipNeedsBase: true }, opts(possede('111'))).claimable, true);
});

test('une offre sans jeu de base, ou d\'un autre magasin, n\'est jamais concernee', () => {
  const jeu = dlc({ parentAppid: null, category: 'game' });
  assert.equal(baseGameMissing(jeu, possede('5')), false);
  const epic = makeOffer({ source: 'epic-api', store: STORES.EPIC, storeId: 'x', title: 'Epic DLC', url: 'https://store.epicgames.com/p/x', parentAppid: '111' });
  assert.equal(baseGameMissing(epic, possede('5')), false);
  assert.equal(baseGameMissing(null, possede('5')), false);
});

test('les candidats a la reclamation ecartent ces DLC, avec leur motif', () => {
  const catalogue = { 'steam:222': { ...dlc(), catalogKey: 'steam:222' } };
  const ok = claimCandidates(catalogue, { skipNeedsBase: true }, { claimableStores: [STORES.STEAM], watchedStores: null, now: T, ownedIds: possede('5', '111') });
  assert.equal(ok.candidates.length, 1);
  const ecarte = claimCandidates(catalogue, { skipNeedsBase: true }, { claimableStores: [STORES.STEAM], watchedStores: null, now: T, ownedIds: possede('5') });
  assert.equal(ecarte.candidates.length, 0);
  assert.equal(ecarte.dropped[0].reason, REASONS.NEEDS_BASE);
  const sans = claimCandidates(catalogue, {}, { claimableStores: [STORES.STEAM], watchedStores: null, now: T, ownedIds: possede('5') });
  assert.equal(sans.candidates.length, 1, 'option coupee : rien ne change');
});

test('les annonces gardent ce DLC de cote tant que l\'option est active', () => {
  const catalogue = { 'steam:222': { ...dlc(), catalogKey: 'steam:222', state: STATES.CONFIRMED } };
  assert.equal(toNotify(catalogue, T).length, 1);
  assert.equal(toNotify(catalogue, T, { filters: { skipNeedsBase: true }, ownedIds: possede('5') }).length, 0);
  assert.equal(toNotify(catalogue, T, { filters: { skipNeedsBase: true }, ownedIds: possede('5', '111') }).length, 1);
  assert.equal(toNotify(catalogue, T, { filters: {}, ownedIds: possede('5') }).length, 1);
});
