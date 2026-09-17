/* Tests de la sauvegarde des codes.
 *
 * Un code GOG perdu est un jeu perdu. Chaque test correspond a une facon de
 * perdre un code en croyant le sauver : une sauvegarde rejetee en silence par
 * le quota, une restauration qui ecrase, une liste coupee du mauvais cote.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  KEY_SYNC_CODES,
  KEY_CODES,
  MAX_ITEM_BYTES,
  parseCodes,
  mergeCodes,
  sizeOf,
  packForSync,
  hasSync,
  mirrorCodes,
  readMirror,
  restoreCodes,
} from '../watch/backup.js';

const code = (n, extra = {}) => ({
  code: `ABCDE-FGHIJ-${String(n).padStart(5, '0')}`,
  store: 'gog',
  title: `Jeu ${n}`,
  deadline: '31 decembre 2026',
  attempts: 0,
  ...extra,
});

/* ----------------------------------------------------------------- lecture */

test('la liste se lit serialisee comme en tableau', () => {
  // Le moteur ecrit du JSON (GM_setValue), la zone sync rend un tableau.
  assert.equal(parseCodes(JSON.stringify([code(1)])).length, 1);
  assert.equal(parseCodes([code(1), code(2)]).length, 2);
});

test('une liste illisible rend un tableau vide, pas une exception', () => {
  // Dans un service worker, une exception ici tuerait le cycle entier.
  assert.deepEqual(parseCodes('{pas du json'), []);
  assert.deepEqual(parseCodes(null), []);
  assert.deepEqual(parseCodes(42), []);
  assert.deepEqual(parseCodes([{ sans: 'code' }, null]), []);
});

/* ------------------------------------------------------------------ fusion */

test('fusionner ne perd aucun code', () => {
  const fusion = mergeCodes([code(1), code(2)], [code(2), code(3)]);
  assert.deepEqual(fusion.map((c) => c.title), ['Jeu 1', 'Jeu 2', 'Jeu 3']);
});

test('l\'entree la plus renseignee gagne', () => {
  // Une entree restauree qui aurait perdu son titre ne doit pas ecraser celle
  // qui l'a encore.
  const nu = { code: 'ABCDE-FGHIJ-00001' };
  const complet = code(1);

  assert.equal(mergeCodes([nu], [complet])[0].title, 'Jeu 1');
  assert.equal(mergeCodes([complet], [nu])[0].title, 'Jeu 1');
});

/* --------------------------------------------------------------- emballage */

test('un petit lot passe sans etre touche', () => {
  const liste = [code(1), code(2)];
  const { kept, dropped } = packForSync(liste);
  assert.equal(kept.length, 2);
  assert.equal(dropped.length, 0);
  assert.ok(sizeOf(kept) < MAX_ITEM_BYTES);
});

test('un lot trop gros est coupe par les PLUS ANCIENS', () => {
  // Le moteur ajoute a la fin : la queue est ce qui vient d'arriver et n'a pas
  // encore ete echange. Couper par la fin sauvegarderait exactement les codes
  // dont on n'a plus besoin.
  const liste = Array.from({ length: 200 }, (_, i) => code(i));
  const { kept, dropped } = packForSync(liste);

  assert.ok(dropped.length > 0, 'le lot devait deborder');
  assert.equal(kept.length + dropped.length, 200);
  assert.ok(sizeOf(kept) <= MAX_ITEM_BYTES, 'le lot garde doit tenir dans un element');
  assert.equal(kept[kept.length - 1].title, 'Jeu 199', 'le plus recent doit survivre');
  assert.equal(dropped[0].title, 'Jeu 0', 'le plus ancien part en premier');
});

/* ---------------------------------------------------------------- stockage */

test('sans zone sync, rien ne casse et rien ne ment', () => {
  const sansSync = { storage: { local: {} } };
  assert.equal(hasSync(sansSync), false);
});

test('le miroir se relit tel qu\'il a ete ecrit', async () => {
  const { chrome } = fakeChrome();
  const r = await mirrorCodes(chrome, [code(1), code(2)]);

  assert.equal(r.ok, true);
  assert.equal(r.mirrored, 2);
  assert.equal((await readMirror(chrome)).length, 2);
});

test('un set() refuse ne fait pas tomber l\'appelant', async () => {
  const chrome = {
    storage: {
      local: { async get() { return {}; }, async set() {} },
      sync: { async set() { throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded'); }, async get() { return {}; } },
    },
  };
  const r = await mirrorCodes(chrome, [code(1)]);
  assert.equal(r.ok, false, 'l\'echec doit se dire');
  assert.equal(r.mirrored, 0);
});

test('sans emballage, la zone sync refuserait le lot ENTIER', async () => {
  // C'est le mode d'echec que packForSync existe pour eviter : au-dela de 8 Ko
  // par element, set() ne tronque pas -- il rejette, et rien n'est sauvegarde.
  const { chrome } = fakeChrome();
  const gros = Array.from({ length: 200 }, (_, i) => code(i));

  await assert.rejects(
    () => chrome.storage.sync.set({ [KEY_SYNC_CODES]: gros }),
    /QUOTA_BYTES_PER_ITEM/,
  );

  const r = await mirrorCodes(chrome, gros);
  assert.equal(r.ok, true, 'emballe, le miroir passe');
  assert.ok(r.dropped > 0, 'et il dit ce qu\'il a laisse dehors');
  assert.ok(r.mirrored > 0);
});

test('restaurer FUSIONNE, et n\'ecrase jamais la liste locale', async () => {
  // Une restauration qui ecrase effacerait les codes recoltes depuis la
  // derniere synchronisation : le scenario ou l'on croit sauver et ou on perd.
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ [KEY_CODES]: JSON.stringify([code(1)]) });
  await chrome.storage.sync.set({ [KEY_SYNC_CODES]: [code(2), code(3)] });

  const { restored } = await restoreCodes(chrome);
  assert.equal(restored, 2);

  const apres = parseCodes((await chrome.storage.local.get(KEY_CODES))[KEY_CODES]);
  assert.deepEqual(apres.map((c) => c.title), ['Jeu 1', 'Jeu 2', 'Jeu 3']);
});

test('restaurer n\'ecrit rien quand il n\'y a rien a rendre', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ [KEY_CODES]: JSON.stringify([code(1)]) });
  await chrome.storage.sync.set({ [KEY_SYNC_CODES]: [code(1)] });

  assert.deepEqual(await restoreCodes(chrome), { restored: 0 });
  assert.deepEqual(await restoreCodes(fakeChrome().chrome), { restored: 0 }, 'ni miroir ni local');
});

test('la liste rendue au moteur reste du JSON serialise', async () => {
  // Le moteur la lit par GM_getValue : une autre forme la rendrait illisible
  // pour lui, et il repartirait de zero.
  const { chrome } = fakeChrome();
  await chrome.storage.sync.set({ [KEY_SYNC_CODES]: [code(7)] });
  await restoreCodes(chrome);

  const brut = (await chrome.storage.local.get(KEY_CODES))[KEY_CODES];
  assert.equal(typeof brut, 'string');
  assert.equal(JSON.parse(brut)[0].title, 'Jeu 7');
});
