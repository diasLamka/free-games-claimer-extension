/* « Attendez, il sera offert » (2.94.0).
 *
 * Ce qui compte : une estimation qui ne s'invente rien -- deja offert,
 * editeur genereux, profil (age, prix) --, en trois niveaux avec ses raisons ;
 * un editeur retenu une fois par jeu ; une fiche Steam lue meme quand Steam la
 * range sous une autre cle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  estimate, recordGivers, normalisePublisher, readInfo, readSteamDate, wishTargets, refreshOddsInfo, rankWishes, needsInfo,
  LEVELS, FRESH_MS,
} from '../watch/odds.js';
import { appDetailsEntry } from '../watch/sources/steam.js';
import { addWish, makeSteamWishlist } from '../watch/wishlist.js';
import { normaliseTitle } from '../watch/offer.js';
import { recurrenceIndex } from '../watch/recurrence.js';

const HADES = JSON.parse(readFileSync(new URL('./fixtures/steam-appdetails-1145360.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 8, 27, 12);
const YEAR = 365.25 * 24 * 3600 * 1000;

test('Steam range parfois la fiche sous une autre cle : on la trouve par steam_appid', () => {
  assert.deepEqual(Object.keys(HADES), ['1206340'], 'mesure du 2026-09-27 : Hades repond sous la cle d\'un de ses DLC');
  assert.equal(appDetailsEntry(HADES, '1145360').data.name, 'Hades');
  const info = readInfo(HADES, '1145360');
  assert.equal(info.name, 'Hades');
  assert.equal(info.basePrice, 24.5);
  assert.equal(info.currency, 'EUR');
  assert.deepEqual(info.publishers, ['Supergiant Games']);
  assert.equal(new Date(info.released).getUTCFullYear(), 2020);
  assert.equal(readInfo({ 1: { success: false } }, '1'), null);
});

test('les dates de Steam', () => {
  assert.equal(readSteamDate('17 Sep, 2020'), Date.parse('17 Sep, 2020'));
  assert.equal(new Date(readSteamDate('Oct 3rd, 2024')).getUTCFullYear(), 2024);
  assert.equal(readSteamDate('Q1 2027'), Date.UTC(2027, 0, 1));
  assert.equal(readSteamDate('To be announced'), null);
});

test('les editeurs qui offrent : un jeu une fois, les formes juridiques oubliees', () => {
  assert.equal(normalisePublisher('Gameplay Group International Inc.'), normalisePublisher('Gameplay Group International'));
  assert.equal(normalisePublisher('Devolver Digital'), 'devolver digital');
  let g = recordGivers({}, [
    { title: 'Breathedge', publisher: 'Hypetrain Digital' },
    { title: 'Breathedge', publisher: 'Hypetrain Digital' },
    { title: 'Autre', publisher: 'Hypetrain Digital Ltd' },
    { title: 'Gratuit a jouer', publisher: 'X', keepable: false },
  ], NOW);
  assert.deepEqual(Object.keys(g), ['hypetrain digital']);
  assert.equal(g['hypetrain digital'].games.length, 2);
  g = recordGivers(g, [{ title: 'Breathedge', publisher: 'Hypetrain Digital' }], NOW + 1);
  assert.equal(g['hypetrain digital'].games.length, 2, 'revu a chaque cycle, compte une fois');
});

test('l\'estimation : ses trois niveaux, et ses raisons', () => {
  const vieux = { released: NOW - 4 * YEAR, basePrice: 19.99, currency: 'EUR', publishers: ['Hypetrain Digital'] };
  const givers = { 'hypetrain digital': { name: 'Hypetrain Digital', games: ['a', 'b'] } };

  const deja = estimate({ recurrence: { count: 1, passes: [{ ts: NOW - YEAR, store: 'amazon' }] }, info: null, now: NOW });
  assert.equal(deja.level, LEVELS.HIGH, 'deja offert une fois : fortes');
  assert.equal(deja.reasons[0].key, 'oddsGivenBefore');

  const profil = estimate({ info: vieux, givers, now: NOW });
  assert.equal(profil.level, LEVELS.HIGH);
  assert.deepEqual(profil.reasons.map((r) => r.key), ['oddsPublisherGave', 'oddsOld', 'oddsCheap']);

  assert.equal(estimate({ info: { ...vieux, publishers: [] }, now: NOW }).level, LEVELS.MEDIUM, 'vieux et modeste, sans plus');
  const recent = estimate({ info: { released: NOW - 0.3 * YEAR, basePrice: 59.99, currency: 'EUR', publishers: [] }, now: NOW });
  assert.equal(recent.level, LEVELS.LOW);
  assert.deepEqual(recent.reasons.map((r) => r.key), ['oddsRecent', 'oddsExpensive']);
  assert.equal(estimate({ info: { comingSoon: true, publishers: [] }, now: NOW }).level, LEVELS.LOW);
  assert.equal(estimate({ now: NOW }).level, LEVELS.UNKNOWN, 'rien su : on ne devine pas');
  assert.deepEqual(estimate({ now: NOW }).reasons.map((r) => r.key), ['oddsPending']);
  assert.deepEqual(estimate({ info: { notFound: true }, now: NOW }).reasons.map((r) => r.key), ['oddsNotOnSteam']);
  assert.equal(estimate({ info: { isFree: true }, now: NOW }).level, LEVELS.F2P);
});

test('les souhaits : saisie d\'abord, puis Steam (par appid) et GOG, un titre une fois', () => {
  const t = wishTargets({
    wishlist: addWish([], 'Hades', normaliseTitle),
    steamWishlist: makeSteamWishlist([{ id: '1145360', title: 'Hades' }, { id: '367520', title: 'Hollow Knight' }], normaliseTitle, NOW),
  });
  assert.deepEqual(t.map((x) => [x.title, x.origin, x.key]), [['Hades', 'manual', 't:hades'], ['Hollow Knight', 'steam', 'app:367520']]);
});

test('les fiches : huit au plus, par appid ou par titre exact, gardees trente jours', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('storesearch')) return { ok: true, json: async () => ({ items: [{ id: 1145360, name: 'Hades', type: 'app' }] }) };
    return { ok: true, json: async () => HADES };
  };
  const targets = [{ title: 'Hades', key: 't:hades', appid: null }, { title: 'Introuvable', key: 't:introuvable', appid: null }];
  const fetch2 = async (url) => (url.includes('Introuvable') ? { ok: true, json: async () => ({ items: [] }) } : fetchImpl(url));
  const cache = await refreshOddsInfo({ fetch: fetch2, targets, cache: {}, now: NOW, pause: async () => {} });
  assert.equal(cache['t:hades'].name, 'Hades');
  assert.equal(cache['t:introuvable'].notFound, true);
  assert.equal(needsInfo(cache, targets[0], NOW + FRESH_MS - 1), false);
  assert.equal(needsInfo(cache, targets[0], NOW + FRESH_MS), true);
  for (const u of urls) assert.match(u, /^https:\/\/store\.steampowered\.com\/api\//);

  const index = recurrenceIndex({ outcomes: {}, library: {}, normalise: normaliseTitle });
  const r = rankWishes(targets, { cache, givers: {}, index, now: NOW });
  assert.equal(r[0].title, 'Hades');
  assert.equal(r[0].level, LEVELS.MEDIUM, 'six ans, 24,50 € : moyennes, sans editeur connu');
  assert.equal(r[1].level, LEVELS.UNKNOWN);
});
