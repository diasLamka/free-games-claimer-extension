/* Le registre, d'un ordinateur a l'autre.
 *
 * Chaque test correspond a une facon de croire son registre partage alors
 * qu'il ne l'est pas -- une tranche rejetee par le quota, un ordinateur qui
 * efface ce que l'autre a pris, une restauration qui ecrase -- ou de laisser
 * chez Google ce que l'utilisateur a demande de retirer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  compact, packChunks, expand, mergeInto, mirrorLibrary, readLibraryMirror,
  restoreLibrary, clearLibraryMirror, KEY_SYNC_COUNT, SYNC_PREFIX, MAX_CHUNKS,
} from '../watch/library-sync.js';
import { KEY_LIBRARY, makeEntry, libraryKey, ownedKeys } from '../watch/library.js';
import { MAX_ITEM_BYTES } from '../watch/backup.js';
import { normaliseTitle } from '../watch/offer.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

function lib(n, { store = 'epic', from = 0, prefix = 'jeu' } = {}) {
  const out = {};
  for (let i = from; i < from + n; i++) {
    const e = makeEntry({ store, id: `${prefix}-${i}`, title: `Un jeu au titre assez long numero ${i}`, ts: T + i, status: 'claimed', worth: '19,99 EUR', image: 'https://cdn/x.jpg' });
    out[libraryKey(store, e.id)] = e;
  }
  return out;
}

/* -------------------------------------------------------------- compaction */

test('seuls partent le magasin, l\'identifiant, le titre et la date', () => {
  const [t] = compact(lib(1));
  assert.deepEqual(t, ['epic', 'jeu-0', 'Un jeu au titre assez long numero 0', T]);
});

test('une entree sans titre ne part pas, et les plus recentes passent en tete', () => {
  const l = { ...lib(3), 'amazon:x': makeEntry({ store: 'amazon', id: 'x', title: null, ts: T + 99, status: 'claimed' }) };
  const tuples = compact(l);
  assert.equal(tuples.length, 3);
  assert.deepEqual(tuples.map((t) => t[3]), [T + 2, T + 1, T]);
});

test('chaque tranche tient dans un element de la zone sync', () => {
  const { chunks, kept, dropped } = packChunks(compact(lib(400)));
  assert.ok(chunks.length > 1, 'plusieurs tranches');
  assert.equal(kept, 400);
  assert.equal(dropped, 0);
  chunks.forEach((c, i) => assert.ok(`${SYNC_PREFIX}${i}`.length + JSON.stringify(c).length <= MAX_ITEM_BYTES));
});

test('au-dela du plafond, les plus anciennes restent dehors, et c\'est dit', () => {
  const tuples = compact(lib(40));
  const { chunks, kept, dropped } = packChunks(tuples, { maxBytes: 400, maxChunks: 2 });
  assert.equal(chunks.length, 2);
  assert.equal(kept + dropped, 40);
  assert.ok(dropped > 0);
  // Les gardees sont les plus recentes.
  assert.equal(chunks[0][0][3], T + 39);
});

test('une tranche relue redevient une entree de registre, et le reste est ignore', () => {
  const [e] = expand([['gog', '42', 'Jeu', T], ['?'], null, ['gog', '43', '', T]]);
  assert.equal(e.store, 'gog');
  assert.equal(e.id, '42');
  assert.equal(e.status, 'claimed');
  assert.equal(expand([['gog', '42', 'Jeu', T], ['gog', '43', '', T]]).length, 1);
});

/* ---------------------------------------------------------------- stockage */

test('le miroir se relit tel qu\'il a ete ecrit, meme gros', async () => {
  const { chrome } = fakeChrome();
  const r = await mirrorLibrary(chrome, lib(400));
  assert.equal(r.ok, true, 'aucune tranche rejetee par le quota');
  const relu = await readLibraryMirror(chrome);
  assert.equal(relu.length, 400);
});

test('un ordinateur n\'efface pas ce que l\'autre a sauvegarde', async () => {
  /* Le premier sauvegarde ses jeux ; le second, qui ne les a pas encore
     fusionnes, sauvegarde les siens. Le miroir doit garder les deux. */
  const { chrome } = fakeChrome();
  await mirrorLibrary(chrome, lib(3, { prefix: 'pc1' }));
  await mirrorLibrary(chrome, lib(2, { prefix: 'pc2' }));
  const ids = (await readLibraryMirror(chrome)).map((e) => e.id).sort();
  assert.deepEqual(ids, ['pc1-0', 'pc1-1', 'pc1-2', 'pc2-0', 'pc2-1']);
});

test('les tranches d\'un miroir plus gros ne sont pas relues apres coup', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.sync.set({ [KEY_SYNC_COUNT]: 1, [`${SYNC_PREFIX}0`]: [['epic', 'a', 'A', T]], [`${SYNC_PREFIX}5`]: [['epic', 'fantome', 'F', T]] });
  assert.deepEqual((await readLibraryMirror(chrome)).map((e) => e.id), ['a']);
  await mirrorLibrary(chrome, {});
  const reste = await chrome.storage.sync.get(`${SYNC_PREFIX}5`);
  assert.equal(reste[`${SYNC_PREFIX}5`], undefined, 'la tranche orpheline est retiree');
});

test('restaurer FUSIONNE dans le registre local, sans rien ecraser', async () => {
  const { chrome } = fakeChrome();
  await mirrorLibrary(chrome, lib(2, { prefix: 'ailleurs' }));
  const local = lib(1, { prefix: 'ici' });
  await chrome.storage.local.set({ [KEY_LIBRARY]: local });

  const r = await restoreLibrary(chrome);
  assert.equal(r.restored, 2);
  const apres = (await chrome.storage.local.get(KEY_LIBRARY))[KEY_LIBRARY];
  assert.equal(Object.keys(apres).length, 3);
  assert.equal(apres['epic:ici-0'].worth, '19,99 EUR', 'le local garde ses champs');
  // C'est ce qui empeche l'autre ordinateur de rouvrir le jeu.
  assert.ok(ownedKeys(apres, normaliseTitle).has('epic|' + normaliseTitle('Un jeu au titre assez long numero 0')));

  const encore = await restoreLibrary(chrome);
  assert.equal(encore.restored, 0);
  assert.equal(encore.changed, false);
});

test('la premiere date gagne a la fusion', () => {
  const ici = { 'epic:a': makeEntry({ store: 'epic', id: 'a', title: 'A', ts: T + 50, status: 'claimed' }) };
  const { library } = mergeInto(ici, [makeEntry({ store: 'epic', id: 'a', title: 'A', ts: T, status: 'claimed' })]);
  assert.equal(library['epic:a'].ts, T);
});

test('couper l\'option retire la copie du compte', async () => {
  const { chrome } = fakeChrome();
  await mirrorLibrary(chrome, lib(5));
  assert.equal(await clearLibraryMirror(chrome), true);
  assert.deepEqual(await readLibraryMirror(chrome), []);
  const brut = await chrome.storage.sync.get(null);
  assert.equal(Object.keys(brut).filter((k) => k.startsWith(SYNC_PREFIX)).length, 0);
});

test('sans zone sync, rien ne casse et rien ne ment', async () => {
  const chrome = { storage: { local: fakeChrome().chrome.storage.local } };
  assert.deepEqual(await mirrorLibrary(chrome, lib(1)), { ok: false, kept: 0, dropped: 0 });
  assert.deepEqual(await readLibraryMirror(chrome), []);
  assert.deepEqual(await restoreLibrary(chrome), { restored: 0, changed: false });
  assert.equal(await clearLibraryMirror(chrome), false);
});

test('un set() refuse ne fait pas tomber l\'appelant', async () => {
  const chrome = {
    storage: {
      local: fakeChrome().chrome.storage.local,
      sync: { async get() { return {}; }, async set() { throw new Error('QUOTA_BYTES quota exceeded'); }, async remove() {} },
    },
  };
  const r = await mirrorLibrary(chrome, lib(3));
  assert.equal(r.ok, false);
});

test('le plafond laisse de la place aux codes et aux reglages', () => {
  assert.ok(MAX_CHUNKS * MAX_ITEM_BYTES < 102400 * 0.7);
});
