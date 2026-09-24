/* Les puces de magasin au-dessus des jeux (2.61.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ALL, byStore, storeChips } from '../lib/store-chips.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const ligne = (store, title = store) => ({ key: `${store}:${title}`, offer: { store, title } });

/* Les offres du 2026-09-24 au matin, lues sur les vrais magasins. */
const LIGNES = [
  ligne('epic', 'Mindcop'), ligne('epic', 'Shogun Showdown'),
  ligne('steam', 'Dying Light: The Beast - Discharge Weapon Pack'), ligne('steam', 'Dwarven Realms'),
  ligne('epic-mobile', 'Mindcop'),
];
const ORDRE = ['epic', 'gog', 'amazon', 'steam', 'epic-mobile'];

test('une puce par magasin present, la plus fournie d\'abord, puis l\'ordre des reglages', () => {
  const p = storeChips(LIGNES, ALL, ORDRE);
  assert.equal(p.active, ALL);
  assert.equal(p.total, 5);
  assert.equal(p.useful, true);
  assert.deepEqual(p.chips.map((c) => [c.store, c.count, c.active]), [
    ['epic', 2, false], ['steam', 2, false], ['epic-mobile', 1, false],
  ]);
});

test('choisir un magasin ne garde que ses offres ; « Tous » les garde toutes', () => {
  const p = storeChips(LIGNES, 'steam', ORDRE);
  assert.equal(p.active, 'steam');
  assert.deepEqual(p.chips.filter((c) => c.active).map((c) => c.store), ['steam']);
  assert.deepEqual(byStore(LIGNES, 'steam').map((r) => r.offer.title), ['Dying Light: The Beast - Discharge Weapon Pack', 'Dwarven Realms']);
  assert.equal(byStore(LIGNES, ALL).length, 5);
  assert.equal(byStore(LIGNES, null).length, 5);
  assert.deepEqual(byStore(undefined, 'steam'), []);
});

test('un magasin choisi qui n\'a plus d\'offre ne cache pas tout : retour a « Tous »', () => {
  const p = storeChips(LIGNES, 'gog', ORDRE);
  assert.equal(p.active, ALL);
  assert.ok(p.chips.every((c) => !c.active));
});

test('une seule boutique : rien a choisir, pas de puces', () => {
  assert.equal(storeChips([ligne('epic'), ligne('epic', 'b')], ALL).useful, false);
  assert.equal(storeChips([], ALL).useful, false);
  assert.equal(storeChips([{ offer: null }, null], ALL).total, 2, 'une ligne illisible compte, sans puce');
});

test('le popup affiche les puces, filtre la liste, et ne memorise rien', () => {
  const html = lire('pages/popup.html');
  const js = lire('pages/popup.js');
  assert.match(html, /<div class="chips" id="store-chips" role="group" data-i18n-attr="aria-label:chipsLabel" hidden><\/div>/);
  assert.match(js, /const visible = sortOffers\(byStore\(rows\.filter\(\(\{ offer \}\) => matchesQuery\(offer\)\), puces\.active\), now\);/);
  assert.match(js, /let storeFilter = ALL;/);
  assert.doesNotMatch(js, /writeUi\(\{ storeFilter/, 'un filtre oublie cacherait les nouvelles offres a la prochaine ouverture');
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    assert.ok(table.chipAll && table.chipsLabel, l);
  }
});
