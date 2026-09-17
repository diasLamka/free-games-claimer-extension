/* Le registre de ce qu'on possede.
 *
 * Il existe parce que le titre et la valeur d'un jeu ne survivent pas a la
 * purge du catalogue : l'historique du moteur ne garde qu'un slug. Chaque test
 * ici correspond a une facon de perdre une information qu'on ne pourra plus
 * jamais retrouver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  libraryKey,
  makeEntry,
  mergeEntry,
  addedEntries,
  enrich,
  integrateHistory,
  ownedTitles,
  entries,
  ACQUIRED,
  PLATFORM_STORES,
} from '../watch/library.js';
import { normaliseTitle } from '../watch/offer.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const DAY = 86400000;

const CATALOGUE = {
  'epic:cardpocalypse': {
    store: 'epic',
    storeId: 'cardpocalypse',
    title: 'Cardpocalypse Standard Edition',
    url: 'https://store.epicgames.com/p/cardpocalypse',
    worth: '23,99 €',
    image: 'https://cdn/card.jpg',
  },
};

/* ------------------------------------------------------------- identite */

test('la cle du registre est le magasin plus l\'identifiant', () => {
  assert.equal(libraryKey('epic', 'cardpocalypse'), 'epic:cardpocalypse');
  // Les prefixes du moteur ne font pas partie de l'identite.
  assert.equal(libraryKey('epic', 'slug:cardpocalypse'), 'epic:cardpocalypse');
  assert.equal(libraryKey('gog', 'code:xyz'), 'gog:xyz');
});

test('deux magasins, deux acquisitions', () => {
  // Et c'est souvent voulu : un jeu possede sur Epic vaut la peine d'etre repris
  // sur GOG, sans DRM.
  assert.notEqual(libraryKey('epic', 'x'), libraryKey('gog', 'x'));
});

/* ------------------------------------------------------------- fusion */

test('la premiere date gagne', () => {
  /* Une reclamation reussie n'arrive qu'une fois. Un second passage sur la meme
     page rend « deja possede » et ne doit pas redater l'acquisition de deux ans
     en arriere vers aujourd'hui. */
  const ancien = makeEntry({ store: 'epic', id: 'x', title: 'X', ts: T - 700 * DAY, status: 'claimed' });
  const recent = makeEntry({ store: 'epic', id: 'x', title: 'X', ts: T, status: 'claimed' });

  assert.equal(mergeEntry(ancien, recent).ts, T - 700 * DAY);
  assert.equal(mergeEntry(recent, ancien).ts, T - 700 * DAY, 'l\'ordre ne change rien');
});

test('un champ renseigne ne se fait pas ecraser par un vide', () => {
  // C'est ce qui permet d'enrichir plus tard une entree figee sans titre.
  const complet = makeEntry({ store: 'epic', id: 'x', title: 'Vrai titre', worth: '$20', ts: T, status: 'claimed' });
  const vide = makeEntry({ store: 'epic', id: 'x', title: null, worth: null, ts: T, status: 'claimed' });

  const out = mergeEntry(complet, vide);
  assert.equal(out.title, 'Vrai titre');
  assert.equal(out.worth, '$20');
});

test('une entree vide se laisse enrichir', () => {
  const vide = makeEntry({ store: 'epic', id: 'x', title: null, ts: T, status: 'claimed' });
  const complet = makeEntry({ store: 'epic', id: 'x', title: 'Tard', worth: '$20', ts: T, status: 'claimed' });
  assert.equal(mergeEntry(vide, complet).title, 'Tard');
});

/* ------------------------------------------------- difference d'historique */

test('seules les entrees NOUVELLES sont prises', () => {
  /* saveHistoryEntry reecrit l'objet entier a chaque appel : sans difference, la
     premiere ecriture ferait tout re-ingerer comme si tout venait d'arriver, et
     le registre daterait toute une collection du meme jour. */
  const avant = { 'slug:a': { ts: T - DAY, status: 'claimed' } };
  const apres = {
    'slug:a': { ts: T - DAY, status: 'claimed' },
    'slug:b': { ts: T, status: 'claimed' },
  };

  const out = addedEntries(avant, apres);
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'slug:b');
});

test('un changement de statut sur la meme cle compte', () => {
  const avant = { 'slug:a': { ts: T, status: 'code_pending_gog' } };
  const apres = { 'slug:a': { ts: T, status: 'redeemed' } };
  assert.equal(addedEntries(avant, apres).length, 1);
});

test('la premiere ecriture prend tout, et c\'est correct', () => {
  // Le registre est vide : il n'y a rien a dater faussement.
  const apres = { 'slug:a': { ts: T, status: 'claimed' }, 'slug:b': { ts: T, status: 'claimed' } };
  assert.equal(addedEntries(undefined, apres).length, 2);
});

test('une entree sans horodatage est ignoree', () => {
  assert.equal(addedEntries({}, { 'slug:a': { status: 'claimed' } }).length, 0);
});

/* ------------------------------------------------------------ integration */

test('le titre et la valeur sont figes a l\'instant de la reclamation', () => {
  const added = [{ key: 'slug:cardpocalypse', entry: { ts: T, status: 'claimed' } }];
  const { library, changed } = integrateHistory({}, {
    platform: 'Epic Games',
    added,
    catalog: CATALOGUE,
  });

  assert.equal(changed, 1);
  const e = library['epic:cardpocalypse'];
  assert.equal(e.title, 'Cardpocalypse Standard Edition');
  assert.equal(e.worth, '23,99 €');
  assert.equal(e.image, 'https://cdn/card.jpg');
  assert.equal(e.ts, T);
});

test('sans le catalogue, on fige au moins l\'identifiant', () => {
  // Reclamation manuelle sur une page que la veille n'a jamais vue : mieux vaut
  // une entree pauvre qu'aucune entree.
  const { library } = integrateHistory({}, {
    platform: 'Epic Games',
    added: [{ key: 'slug:inconnu', entry: { ts: T, status: 'claimed' } }],
    catalog: {},
  });
  assert.equal(library['epic:inconnu'].id, 'inconnu');
  assert.equal(library['epic:inconnu'].title, null);
});

test('seuls les statuts d\'acquisition entrent au registre', () => {
  const added = ['failed', 'needs_login', 'skipped', 'challenge']
    .map((status, i) => ({ key: `slug:${i}`, entry: { ts: T, status } }));

  const { library, changed } = integrateHistory({}, { platform: 'GOG', added, catalog: {} });
  assert.equal(changed, 0);
  assert.deepEqual(library, {});
  // Et la liste est bien celle du bilan.
  assert.deepEqual([...ACQUIRED].sort(), ['claimed', 'redeemed']);
});

test('une plateforme inconnue ne cree rien', () => {
  const { changed } = integrateHistory({}, {
    platform: 'Boutique Inventee',
    added: [{ key: 'x', entry: { ts: T, status: 'claimed' } }],
    catalog: {},
  });
  assert.equal(changed, 0);
});

test('rejouer le meme lot ne change rien', () => {
  const added = [{ key: 'slug:cardpocalypse', entry: { ts: T, status: 'claimed' } }];
  const un = integrateHistory({}, { platform: 'Epic Games', added, catalog: CATALOGUE });
  const deux = integrateHistory(un.library, { platform: 'Epic Games', added, catalog: CATALOGUE });
  assert.equal(deux.changed, 0, 'l\'idempotence est ce qui rend le declencheur sur');
});

test('integrateHistory ne modifie pas le registre qu\'on lui passe', () => {
  const registre = {};
  integrateHistory(registre, {
    platform: 'Epic Games',
    added: [{ key: 'slug:x', entry: { ts: T, status: 'claimed' } }],
    catalog: {},
  });
  assert.deepEqual(registre, {}, 'une fonction pure ne mute pas son entree');
});

/* ---------------------------------------------------------- enrichissement */

test('enrich retrouve l\'offre par cle forte, puis par identifiant', () => {
  assert.ok(enrich('epic', 'slug:cardpocalypse', CATALOGUE));
  assert.ok(enrich('epic', 'cardpocalypse', CATALOGUE));

  // Range sous une cle faible : le repli parcourt par storeId.
  const faible = { 'epic:titre:xyz': { store: 'epic', storeId: 'zzz', title: 'Z' } };
  assert.ok(enrich('epic', 'zzz', faible));
  assert.equal(enrich('epic', 'absent', faible), null);
});

/* --------------------------------------------------------------- lecture */

test('ownedTitles garde la plus ancienne acquisition d\'un titre', () => {
  const lib = {
    'epic:x': makeEntry({ store: 'epic', id: 'x', title: 'Machin', ts: T - 400 * DAY, status: 'claimed' }),
    'gog:x': makeEntry({ store: 'gog', id: 'x', title: 'Machin', ts: T, status: 'claimed' }),
  };
  const table = ownedTitles(lib, normaliseTitle);
  assert.equal(table.get(normaliseTitle('Machin')).store, 'epic');
});

test('une entree sans titre n\'entre pas dans la table de rapprochement', () => {
  const lib = { 'epic:x': makeEntry({ store: 'epic', id: 'x', title: null, ts: T, status: 'claimed' }) };
  assert.equal(ownedTitles(lib, normaliseTitle).size, 0);
});

test('entries rend le registre du plus recent au plus ancien', () => {
  const lib = {
    a: makeEntry({ store: 'epic', id: 'a', ts: T - DAY, status: 'claimed' }),
    b: makeEntry({ store: 'epic', id: 'b', ts: T, status: 'claimed' }),
  };
  assert.deepEqual(entries(lib).map((e) => e.id), ['b', 'a']);
});

test('les trois plateformes du moteur sont couvertes', () => {
  assert.deepEqual(Object.keys(PLATFORM_STORES).sort(), ['Amazon Luna', 'Epic Games', 'GOG']);
});
