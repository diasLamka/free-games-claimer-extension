/* La hotte : les codes en double deviennent un stock a offrir.
 *
 * Un code est un porteur : ces tests gardent surtout ce qui ne doit JAMAIS arriver (le code dans une sauvegarde, dans le
 * relais, deux fois dans la hotte) en plus du comportement attendu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_HOTTE, MAX_HOTTE, readHotte, shelve, setGiven, takeOut, qrText, ownedForCodes, duplicateCodes,
} from '../watch/hotte.js';
import { normaliseTitle } from '../watch/offer.js';
import { BACKUP_KEYS } from '../watch/full-backup.js';
import { EXPORT_KEYS } from '../watch/auto-backup.js';
import { addCodes } from '../watch/codes.js';

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const CODE = { store: 'gog', code: 'ABCDE-FGHIJ-KLMNO', title: 'WarBreeds', deadline: '2026-12-31', ts: 1, attempts: 2 };

/* ------------------------------------------------------------ la lecture */

test('une hotte absente ou abimee est une hotte vide', () => {
  for (const raw of [undefined, null, {}, 'x', 42, [], { items: 'oui' }, { items: [null, 3, {}, { code: '' }] }]) {
    assert.deepEqual(readHotte(raw), { items: [] }, JSON.stringify(raw));
  }
});

test('la lecture ne garde que des champs connus, bornes, sans doublon de code', () => {
  const h = readHotte({
    items: [
      { code: 'A1B2C3D4-E5F6', title: 't'.repeat(500), store: 'gog', evil: '<script>', at: 5, given: 'hier' },
      { code: 'A1B2C3D4-E5F6', title: 'doublon' },
    ],
  });
  assert.equal(h.items.length, 1);
  assert.equal(h.items[0].title.length, 160);
  assert.equal(h.items[0].given, null, 'une date illisible n\'est pas un "donne"');
  assert.equal('evil' in h.items[0], false);
});

test('la hotte est bornee : au-dela, le plus ancien part', () => {
  let h = { items: [] };
  for (let i = 0; i < MAX_HOTTE + 5; i++) h = shelve(h, { code: `CODE-${String(i).padStart(4, '0')}-ZZZZ` }, NOW + i);
  assert.equal(h.items.length, MAX_HOTTE);
  assert.ok(!h.items.some((x) => x.code === 'CODE-0000-ZZZZ'));
  assert.ok(h.items.some((x) => x.code === `CODE-${String(MAX_HOTTE + 4).padStart(4, '0')}-ZZZZ`));
});

/* ------------------------------------------------------------- les gestes */

test('ranger : le code, son jeu, son magasin et sa date limite suivent', () => {
  const h = shelve(undefined, CODE, NOW);
  assert.deepEqual(h.items, [{
    code: 'ABCDE-FGHIJ-KLMNO', title: 'WarBreeds', store: 'gog', deadline: '2026-12-31', at: NOW, given: null,
  }]);
});

test('ranger deux fois le meme code ne le range qu\'une fois', () => {
  const une = shelve(undefined, CODE, NOW);
  const deux = shelve(une, { ...CODE, title: 'Autre' }, NOW + 1);
  assert.equal(deux.items.length, 1);
  assert.equal(deux.items[0].title, 'WarBreeds');
});

test('ranger ne modifie pas la hotte recue, et refuse une entree sans code', () => {
  const avant = shelve(undefined, CODE, NOW);
  const copie = JSON.stringify(avant);
  shelve(avant, { ...CODE, code: 'AUTRE-CODE-0001' }, NOW + 1);
  assert.equal(JSON.stringify(avant), copie);
  assert.equal(shelve(avant, { title: 'sans code' }, NOW).items.length, 1);
  assert.equal(shelve(avant, null, NOW).items.length, 1);
});

test('donner : la date s\'inscrit, et se retire', () => {
  const h = shelve(undefined, CODE, NOW);
  const donne = setGiven(h, CODE.code, NOW + 1000);
  assert.equal(donne.items[0].given, NOW + 1000);
  assert.equal(setGiven(donne, CODE.code, null).items[0].given, null);
  assert.equal(setGiven(h, 'INCONNU-0000', NOW).items[0].given, null, 'un autre code n\'est pas touche');
});

test('reprendre : le code ressort, pret a rejoindre la liste a echanger', () => {
  const h = shelve(undefined, CODE, NOW);
  const { hotte, entry } = takeOut(h, CODE.code);
  assert.deepEqual(hotte.items, []);
  assert.deepEqual(entry, {
    store: 'gog', code: 'ABCDE-FGHIJ-KLMNO', title: 'WarBreeds', deadline: '2026-12-31', ts: NOW, attempts: 0,
  });
  // Et il se remet dans la liste sans doublon.
  assert.equal(addCodes([entry], [entry]).length, 1);
});

test('reprendre un code absent ne change rien et ne rend rien', () => {
  const h = shelve(undefined, CODE, NOW);
  const { hotte, entry } = takeOut(h, 'ABSENT-0000-ZZZZ');
  assert.equal(entry, null);
  assert.equal(hotte.items.length, 1);
});

test('le QR code ne porte que le code', () => {
  assert.equal(qrText('  ABCDE-FGHIJ-KLMNO \n'), 'ABCDE-FGHIJ-KLMNO');
  assert.equal(qrText(undefined), '');
});

/* ------------------------------------------------------------- le reperage */

const LIB = {
  'gog:warbreeds': { store: 'gog', title: 'WarBreeds', status: 'claimed', ts: 1 },
  'epic:hades': { store: 'epic', title: 'Hades', status: 'claimed', ts: 2 },
};

test('un code dont le jeu est au registre DU MEME MAGASIN est signale', () => {
  const owned = ownedForCodes(LIB, null, normaliseTitle);
  const codes = [
    { code: 'AAAA-BBBB-CCCC', store: 'gog', title: 'WarBreeds' },
    { code: 'DDDD-EEEE-FFFF', store: 'gog', title: 'Hades' }, // possede sur Epic, pas sur GOG
    { code: 'GGGG-HHHH-IIII', store: 'gog', title: 'Autre jeu' },
  ];
  assert.deepEqual([...duplicateCodes(codes, owned, normaliseTitle)], ['AAAA-BBBB-CCCC']);
});

test('le reperage ignore les majuscules, les accents et la ponctuation du titre', () => {
  const owned = ownedForCodes(LIB, null, normaliseTitle);
  const codes = [{ code: 'AAAA-BBBB-CCCC', store: 'gog', title: '  WARBREEDS! ' }];
  assert.equal(duplicateCodes(codes, owned, normaliseTitle).size, 1);
});

test('un code sans titre ou sans magasin (saisi a la main) n\'est jamais signale', () => {
  const owned = ownedForCodes(LIB, null, normaliseTitle);
  const codes = [
    { code: 'AAAA-BBBB-CCCC', store: 'gog', title: null },
    { code: 'DDDD-EEEE-FFFF', store: null, title: 'WarBreeds' },
    null,
    { title: 'WarBreeds', store: 'gog' },
  ];
  assert.equal(duplicateCodes(codes, owned, normaliseTitle).size, 0);
});

test('la collection importee compte, mais seulement si l\'importation a reussi un jour', () => {
  const collection = {
    stores: { steam: { lastOk: NOW }, gog: {} },
    items: {
      'steam:1': { store: 'steam', id: '1', title: 'Portal 2' },
      'gog:2': { store: 'gog', id: '2', title: 'Witcher 3' },
    },
  };
  const owned = ownedForCodes({}, collection, normaliseTitle);
  const codes = [
    { code: 'AAAA-BBBB-CCCC', store: 'steam', title: 'Portal 2' },
    { code: 'DDDD-EEEE-FFFF', store: 'gog', title: 'Witcher 3' }, // jamais importe avec succes : on ne sait pas
  ];
  assert.deepEqual([...duplicateCodes(codes, owned, normaliseTitle)], ['AAAA-BBBB-CCCC']);
});

test('un registre ou une collection absents ne signalent rien', () => {
  const owned = ownedForCodes(undefined, undefined, normaliseTitle);
  assert.equal(owned.size, 0);
  assert.equal(duplicateCodes(undefined, owned, normaliseTitle).size, 0);
});

/* ------------------------------------------------- ce qui ne doit jamais arriver */

test('la hotte n\'est dans aucune liste de sauvegarde : un code est un porteur', () => {
  assert.ok(!BACKUP_KEYS.includes(KEY_HOTTE), 'sauvegarde complete');
  assert.ok(!EXPORT_KEYS.includes(KEY_HOTTE), 'sauvegarde automatique');
});

test('rien dans le relais ni dans les alertes ne sait lire la hotte', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../watch/relay.js', '../watch/phone.js', '../watch/homeassistant.js', '../watch/discord-format.js', '../watch/telegram-format.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(!/hotte/i.test(src), `${f} parle de la hotte`);
  }
});
