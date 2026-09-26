/* Les week-ends gratuits de Steam (2.75.0), sur les vraies reponses du 2026-09-26. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  HOME_URL, KEY_WEEKENDS, REFRESH_MS, RETRY_MS, mapWeekend, nextWeekends, openWeekends, refreshWeekends,
  weekendCandidates, weekendsDue,
} from '../watch/steam-weekends.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ACCUEIL = lire('test/fixtures/steam-home-weekend.html');
const ITEMS = JSON.parse(lire('test/fixtures/steam-items-weekend.json'));
const NOW = Date.parse('2026-09-26T09:00:00Z');

test('la page d\'accueil designe les jeux marques free_weekend, et eux seuls', () => {
  assert.deepEqual(weekendCandidates(ACCUEIL).sort(), ['1286880', '393380']);
  assert.deepEqual(weekendCandidates('<html>rien</html>'), []);
  assert.deepEqual(weekendCandidates('GStoreItemData.AddStoreItemDataSet({"rgApps":{"1":{"free_weekend":true'), [], 'bloc tronque : rien devine');
  assert.deepEqual(weekendCandidates('GStoreItemData.AddStoreItemDataSet({"rgApps":{"12":{"name":"a \\"}\\" b","free_weekend":true}}})'), ['12'],
    'une accolade dans une chaine ne coupe pas le bloc');
});

test('GetItems confirme et date ; un jeu ordinaire ne passe pas', () => {
  const items = ITEMS.response.store_items.map((it) => mapWeekend(it, NOW)).filter(Boolean);
  assert.deepEqual(items.map((w) => w.title).sort(), ['Ship Graveyard Simulator', 'Squad']);
  const squad = items.find((w) => w.appid === '393380');
  assert.equal(squad.end, 1790614800 * 1000);
  assert.equal(new Date(squad.end).toISOString(), '2026-09-28T17:00:00.000Z', 'le « Sep 28 @ 10:00am » de la page, heure du Pacifique');
  assert.equal(squad.start, 1790269200 * 1000);
  assert.match(squad.url, /^https:\/\/store\.steampowered\.com\/app\/393380/);
  assert.match(squad.image, /^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\/steam\/apps\/393380\//);
  const ship = items.find((w) => w.appid === '1286880');
  assert.ok(ship.discount > 0 && ship.price, 'le prix si on veut le garder, avec sa remise');
  assert.equal(mapWeekend(ITEMS.response.store_items[0], squad.end + 1), null, 'fini : il ne sort plus');
  assert.equal(mapWeekend({ appid: 730, name: 'Counter-Strike 2', is_free: true }, NOW), null, 'un free-to-play n\'est pas un week-end');
});

test('six heures entre deux lectures ; un echec garde la liste et retente dans une heure', () => {
  assert.equal(weekendsDue(null, NOW), true);
  assert.equal(weekendsDue({ at: NOW - REFRESH_MS + 60000, items: [] }, NOW), false);
  assert.equal(weekendsDue({ at: NOW - REFRESH_MS, items: [] }, NOW), true);
  const connu = { at: NOW - REFRESH_MS, items: [{ appid: '1', end: NOW + 1000 }] };
  const apres = nextWeekends(connu, { at: NOW, items: [], errors: ['accueil : HTTP 503'], failed: true });
  assert.deepEqual(apres.items, connu.items, 'un echec n\'efface rien');
  assert.equal(weekendsDue(apres, NOW + RETRY_MS - 1), false);
  assert.equal(weekendsDue(apres, NOW + RETRY_MS), true);
  assert.deepEqual(nextWeekends(connu, { at: NOW, items: [], errors: [] }).items, [], 'une lecture reussie et vide : plus de week-end');
  assert.deepEqual(openWeekends({ items: [{ end: NOW - 1 }, { end: NOW + 2 }, { end: NOW + 1 }] }, NOW).map((w) => w.end), [NOW + 1, NOW + 2]);
});

test('la lecture complete : accueil sans cookies, puis GetItems pour les candidats', async () => {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, init });
    if (url === HOME_URL) return { ok: true, text: async () => ACCUEIL };
    return { ok: true, json: async () => ITEMS };
  };
  const r = await refreshWeekends({ fetch: f, now: NOW });
  assert.equal(r.failed, undefined);
  assert.equal(r.items.length, 2);
  assert.equal(appels[0].init.credentials, 'omit');
  assert.match(decodeURIComponent(appels[1].url), /"ids":\[\{"appid":(393380|1286880)\},\{"appid":(393380|1286880)\}\]/);
  const panne = await refreshWeekends({ fetch: async () => ({ ok: false, status: 503 }), now: NOW });
  assert.equal(panne.failed, true);
});

test('reglage actif par defaut, section et interrupteur dans le popup, lu seulement si Steam est suivi', () => {
  assert.equal(DEFAULT_SETTINGS.steamWeekends, true);
  assert.equal(KEY_WEEKENDS, 'veille:steam-weekends');
  const bg = lire('background.js');
  assert.match(bg, /if \(settings\.steamWeekends === false \|\| !\(settings\.watchedStores \|\| \[\]\)\.includes\('steam'\)\) return null;/);
  assert.match(bg, /await maybeWeekends\(now\);/);
  const html = lire('pages/popup.html');
  assert.match(html, /<section id="weekends-section" hidden>/);
  assert.match(html, /id="steam-weekends"/);
  assert.match(lire('pages/popup.js'), /writeBehaviour\(\{ steamWeekends: e\.target\.checked \}\)/);
});
