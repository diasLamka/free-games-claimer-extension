/* L'anti-doublon au moment de payer (2.87.0).
 *
 * Ce qui compte : alerter sur la fiche d'un jeu PAYANT qu'on possede deja
 * AILLEURS -- jamais sur la boutique ou on le possede (elle le dit), jamais
 * quand il est gratuit ici (c'est une recuperation) -- et lire le nom du jeu
 * sous l'habillage de chaque boutique.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GUARD_SITES, PRODUCT_PAGES, cleanTitle, guardStoreOf, isProductPage, ownedElsewhere, guardLines, guardScriptId,
} from '../watch/owned-guard.js';
import { normaliseTitle } from '../watch/offer.js';
import { makeEntry } from '../watch/library.js';
import { messageAllowed, isOurs } from '../watch/messaging.js';

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const T2024 = Date.UTC(2024, 2, 12, 17, 0, 0);

test('le nom du jeu sous l\'habillage des boutiques', () => {
  const cas = {
    'Buy Hades from the Humble Store': 'Hades',
    'Hades | PC Steam Game | Fanatical': 'Hades',
    'Hades - Steam key - Gamesplanet.com': 'Hades',
    'Buy Hades - PC Steam Key - Green Man Gaming': 'Hades',
    'Save 50% on Hades on Steam': 'Hades',
    'Hades on Steam': 'Hades',
    'Hades II': 'Hades II',
    'Disco Elysium - The Final Cut': 'Disco Elysium',
    '  ': '',
  };
  for (const [brut, attendu] of Object.entries(cas)) assert.equal(cleanTitle(brut), attendu, brut);
});

test('les fiches de jeu, et elles seules', () => {
  for (const u of [
    'https://store.steampowered.com/app/1145360/Hades/',
    'https://store.epicgames.com/fr/p/hades',
    'https://www.gog.com/fr/game/gris',
    'https://www.gog.com/game/gris',
    'https://www.humblebundle.com/store/hades',
    'https://www.fanatical.com/en/game/hades',
    'https://www.greenmangaming.com/games/hades/',
    'https://fr.gamesplanet.com/game/hades-steam-key--4718-1',
    'https://www.indiegala.com/store/game/hades/1145360',
  ]) assert.ok(isProductPage(u), u);
  for (const u of [
    'https://store.epicgames.com/fr/',
    'https://store.steampowered.com/cart/',
    'https://www.humblebundle.com/store/search?sort=bestselling',
    'https://www.fanatical.com/en/',
    'https://evil.test/store/game/hades',
    'pas une adresse',
  ]) assert.ok(!isProductPage(u), u);
  assert.equal(guardStoreOf('https://uk.gamesplanet.com/game/x'), 'gamesplanet');
});

test('la copie des fiches dans le script de contenu n\'a pas diverge', () => {
  const src = readFileSync(new URL('../content/owned-guard.js', import.meta.url), 'utf8');
  const bloc = /var FICHES = \[([\s\S]*?)\];/.exec(src)[1];
  const copies = [...bloc.matchAll(/^\s*\/(.+)\/,\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(copies, Object.values(PRODUCT_PAGES).map((r) => r.source));
});

const epicHades = makeEntry({ store: 'epic', id: 'hades', title: 'Hades', ts: T2024, status: 'claimed' });

test('possede sur Epic, fiche Steam payante : on alerte, avec le magasin et la date', () => {
  const r = ownedElsewhere({
    candidates: ['Save 50% on Hades on Steam'], pageStore: 'steam',
    library: { 'epic:hades': epicHades }, normalise: normaliseTitle, now: NOW,
  });
  assert.equal(r.title, 'Hades');
  assert.deepEqual(r.owned, [{ store: 'epic', ts: T2024, via: null, source: 'library' }]);
  const t = (k, ...a) => `${k}(${a.join(',')})`;
  assert.deepEqual(guardLines(r, { t, storeLabel: (s) => s.toUpperCase(), dateText: () => '12 mars 2024' }),
    ['guardClaimedOn(EPIC,12 mars 2024)']);
});

test('un sous-titre apres un tiret se lit en entier d\'abord', () => {
  const de = makeEntry({ store: 'gog', id: 'de', title: 'Disco Elysium - The Final Cut', ts: T2024, status: 'claimed' });
  const r = ownedElsewhere({
    candidates: ['Disco Elysium - The Final Cut'], pageStore: 'steam', library: { 'gog:de': de }, normalise: normaliseTitle, now: NOW,
  });
  assert.equal(r.title, 'Disco Elysium - The Final Cut');
  assert.equal(r.owned[0].store, 'gog');
});

test('possede sur la boutique de la page seulement : silence (elle le dit deja)', () => {
  assert.equal(ownedElsewhere({
    candidates: ['Hades'], pageStore: 'epic', library: { 'epic:hades': epicHades }, normalise: normaliseTitle, now: NOW,
  }), null);
});

test('gratuit ici en ce moment : silence, c\'est une recuperation', () => {
  const catalog = { 'steam:1145360': { title: 'Hades', store: 'steam', end: NOW + 3600000 } };
  assert.equal(ownedElsewhere({
    candidates: ['Hades'], pageStore: 'steam', library: { 'epic:hades': epicHades }, catalog, normalise: normaliseTitle, now: NOW,
  }), null);
});

test('recupere par le telephone (relais) ou importe dans Ma collection : dit tel quel', () => {
  const tel = { ...makeEntry({ store: 'epic', id: 'gris', title: 'Gris', ts: T2024, status: 'claimed' }), via: 'telephone' };
  const collection = { 'gog:1': { store: 'gog', id: '1', title: 'GRIS', acquiredAt: null } };
  const r = ownedElsewhere({
    candidates: ['Buy Gris from the Humble Store'], pageStore: 'humble',
    library: { 'epic:gris': tel }, collection, normalise: normaliseTitle, now: NOW,
  });
  const t = (k, ...a) => `${k}(${a.join(',')})`;
  assert.deepEqual(guardLines(r, { t, dateText: () => 'd' }), ['guardClaimedByPhone(epic,d)', 'guardOwned(gog)']);
});

test('un statut non acquis ne compte pas ; un titre vide non plus', () => {
  const rate = makeEntry({ store: 'epic', id: 'x', title: 'Hades', ts: T2024, status: 'failed' });
  assert.equal(ownedElsewhere({ candidates: ['Hades'], pageStore: 'steam', library: { a: rate }, normalise: normaliseTitle, now: NOW }), null);
  assert.equal(ownedElsewhere({ candidates: ['', '   '], pageStore: 'steam', library: { 'epic:hades': epicHades }, normalise: normaliseTitle, now: NOW }), null);
});

test('le message vient d\'un script de contenu, jamais d\'une page', () => {
  assert.ok(isOurs('fgc-owned-guard'));
  assert.ok(messageAllowed('fgc-owned-guard', 'content'));
  assert.ok(!messageAllowed('fgc-owned-guard', 'page'));
});

test('manifestes : le script sur Epic, GOG et Steam ; les boutiques en permission facultative', () => {
  for (const f of ['../manifest.json', '../manifest.firefox.json']) {
    const m = JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
    const cs = m.content_scripts.find((c) => c.js.includes('content/owned-guard.js'));
    assert.ok(cs, f);
    assert.ok(cs.matches.includes('https://store.steampowered.com/*'));
    assert.ok(cs.matches.includes('https://store.epicgames.com/*'));
    assert.ok(cs.matches.includes('https://www.gog.com/*'));
    // Aucune boutique ajoutee d'office : elles passent par la permission facultative.
    for (const site of GUARD_SITES) for (const o of site.origins) assert.ok(!(m.host_permissions || []).includes(o), o);
    assert.ok((m.optional_host_permissions || []).includes('https://*/*'));
  }
  assert.equal(guardScriptId('humble'), 'fgc-anti-doublon-humble');
});
