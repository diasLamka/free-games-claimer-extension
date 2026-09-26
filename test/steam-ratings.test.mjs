/* La note Steam des jeux offerts (2.78.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FRESH_MS, KEY_RATINGS, MAX_ENTRIES, NONE_MS, PER_RUN,
  eligible, fetchRating, matchSearch, needsRating, percent, ratingFor, ratingKey, ratingLine,
  readSummary, refreshRatings, reviewsUrl, scoreLabel, searchUrl, steamAppId, storeRatings, tone,
} from '../watch/steam-ratings.js';
import { composeAnnouncement } from '../watch/cycle.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { setLocale } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const fixture = (f) => JSON.parse(lire(`test/fixtures/${f}`));
const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 3600 * 1000;

/* Mesure du 2026-09-26 : Astrea, gratuit sur Epic ce jour-la. */
const ASTREA = { store: 'epic', title: 'Astrea: Six Sided Oracles', normalisedTitle: 'astrea six sided oracles', category: null };
const SEARCH = fixture('steam-search-astrea.json');
const REVIEWS = fixture('steam-reviews-astrea.json');

/** Un faux fetch qui repond par URL, et compte les appels. */
function fauxFetch(routes) {
  const appels = [];
  const f = async (url) => {
    appels.push(url);
    for (const [motif, rep] of routes) {
      if (url.includes(motif)) {
        if (rep instanceof Error) throw rep;
        return { ok: rep.status ? rep.status < 400 : true, status: rep.status || 200, json: async () => rep.body ?? rep };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.appels = appels;
  return f;
}

test('la recherche ne garde que le titre exact -- ni la bande-son, ni la demo', () => {
  assert.equal(matchSearch(SEARCH, 'Astrea: Six Sided Oracles'), '1755830', 'le tiret de Steam ne compte pas');
  assert.equal(matchSearch(SEARCH, 'Astrea'), null, 'un titre plus court ne se devine pas');
  assert.equal(matchSearch(SEARCH, 'Astrea: Six-Sided Oracles Demo'), '1942700');
  assert.equal(matchSearch({ items: [{ type: 'app', name: 'X', id: 'abc' }] }, 'X'), null);
  assert.equal(matchSearch(null, 'X'), null);
  assert.equal(matchSearch(SEARCH, ''), null);
});

test('le resume des evaluations : chiffres, pourcentage, et refus du reste', () => {
  const s = readSummary(REVIEWS);
  assert.deepEqual(s, { score: 8, positive: 2788, total: 3017 });
  assert.equal(percent(s), 92);
  // Mechabellum le meme jour : 15 151 / 18 025 = 84 %, comme sur sa fiche Steam.
  assert.equal(percent({ positive: 15151, total: 18025 }), 84);
  assert.equal(readSummary({ success: 2 }), null);
  assert.equal(readSummary({ success: 1, query_summary: { review_score: 12, total_positive: 1, total_reviews: 1 } }), null);
  assert.equal(readSummary({ success: 1, query_summary: { review_score: 8, total_positive: 5, total_reviews: 3 } }), null);
  assert.equal(percent({ positive: 0, total: 0 }), null);
});

test('l\'echelle de Steam, traduite par son chiffre', () => {
  setLocale('fr');
  try {
    assert.equal(scoreLabel({ score: 8 }), 'Très positives');
    assert.equal(scoreLabel({ score: 5 }), 'Moyennes');
    assert.equal(scoreLabel({ score: 0 }), '', '0 : trop peu d\'evaluations');
    assert.equal(ratingLine({ score: 8, positive: 2788, total: 3017 }), 'Steam : Très positives (92 %)');
  } finally { setLocale(null); }
  setLocale('en');
  try {
    assert.equal(scoreLabel({ score: 9 }), 'Overwhelmingly Positive');
    assert.equal(scoreLabel({ score: 1 }), 'Overwhelmingly Negative');
  } finally { setLocale(null); }
  assert.equal(tone({ score: 6 }), 'good');
  assert.equal(tone({ score: 5 }), 'mixed');
  assert.equal(tone({ score: 4 }), 'bad');
  assert.equal(tone({ score: 0 }), null);
});

test('l\'appid quand l\'offre le porte, le titre sinon ; ni mobile ni DLC', () => {
  const steam = { store: 'steam', storeId: '1675200', title: 'Steel Seed', url: 'https://store.steampowered.com/app/1675200/' };
  assert.equal(steamAppId(steam), '1675200');
  assert.equal(ratingKey(steam), 'app:1675200');
  const weekend = { appid: '393380', title: 'Squad', url: 'https://store.steampowered.com/app/393380/Squad/' };
  assert.equal(ratingKey(weekend), 'app:393380', 'les week-ends portent leur appid');
  assert.equal(ratingKey(ASTREA), 't:astrea six sided oracles');
  assert.equal(eligible(ASTREA), true);
  assert.equal(eligible({ store: 'epic-mobile', title: 'Castlevania' }), false, 'un jeu mobile n\'est pas le jeu Steam du meme nom');
  assert.equal(eligible({ store: 'epic', title: 'Dying Light - Weapon Pack', category: 'DLC' }), false);
  assert.equal(eligible({ store: 'epic', title: '' }), false);
});

test('une semaine pour une note, trois jours pour « inconnu de Steam »', () => {
  const k = ratingKey(ASTREA);
  assert.equal(needsRating({}, ASTREA, NOW), true);
  assert.equal(needsRating({ [k]: { score: 8, total: 3, positive: 3, at: NOW - FRESH_MS + 1000 } }, ASTREA, NOW), false);
  assert.equal(needsRating({ [k]: { score: 8, total: 3, positive: 3, at: NOW - FRESH_MS } }, ASTREA, NOW), true);
  assert.equal(needsRating({ [k]: { none: true, at: NOW - NONE_MS + 1000 } }, ASTREA, NOW), false);
  assert.equal(needsRating({ [k]: { none: true, at: NOW - NONE_MS } }, ASTREA, NOW), true);
  assert.equal(needsRating({}, { store: 'epic-mobile', title: 'X' }, NOW), false);
});

test('une note inconnue, ou sur trop peu d\'avis, ne s\'affiche pas', () => {
  const k = ratingKey(ASTREA);
  assert.equal(ratingFor({ [k]: { none: true, at: NOW } }, ASTREA), null);
  assert.equal(ratingFor({ [k]: { score: 0, positive: 3, total: 4, at: NOW } }, ASTREA), null);
  assert.deepEqual(ratingFor({ [k]: { appid: '1', score: 8, positive: 9, total: 10, at: NOW } }, ASTREA).score, 8);
  assert.equal(ratingFor(undefined, ASTREA), null);
});

test('chercher puis lire : deux requetes sans cookie, puis plus aucune', async () => {
  const f = fauxFetch([['storesearch', SEARCH], ['appreviews/1755830', REVIEWS]]);
  const r = await fetchRating(ASTREA, { fetch: f, now: NOW, country: 'FR' });
  assert.deepEqual(r, { appid: '1755830', score: 8, positive: 2788, total: 3017, at: NOW });
  assert.equal(f.appels.length, 2);
  assert.match(f.appels[0], /term=Astrea%3A\+Six\+Sided\+Oracles/);
  assert.match(f.appels[0], /cc=FR/);
  assert.equal(f.appels[1], reviewsUrl('1755830'));
  // Une offre Steam : l'appid est deja la, une seule requete.
  const g = fauxFetch([['appreviews/393380', REVIEWS]]);
  await fetchRating({ appid: '393380', title: 'Squad' }, { fetch: g, now: NOW });
  assert.equal(g.appels.length, 1);
});

test('Steam ne connait pas le jeu : on le note, pour ne pas redemander demain', async () => {
  const f = fauxFetch([['storesearch', { total: 0, items: [] }]]);
  assert.deepEqual(await fetchRating(ASTREA, { fetch: f, now: NOW }), { none: true, at: NOW });
});

test('Steam ne repond pas : rien n\'est note, on retentera', async () => {
  assert.equal(await fetchRating(ASTREA, { fetch: fauxFetch([['storesearch', { status: 503, body: {} }]]), now: NOW }), null);
  assert.equal(await fetchRating(ASTREA, { fetch: fauxFetch([['storesearch', new Error('reseau')]]), now: NOW }), null);
  assert.equal(await fetchRating(ASTREA, { fetch: fauxFetch([['storesearch', SEARCH], ['appreviews', { success: 2 }]]), now: NOW }), null);
  assert.equal(searchUrl('x', 'zz').includes('cc=US'), true, 'un pays illisible ne part pas tel quel');
  // Le suffixe de GamerPower ne part pas chez Steam : il ne trouverait rien.
  assert.match(searchUrl('Dwarven Realms (Steam) Key Giveaway'), /term=Dwarven\+Realms&/);
});

test('un passage : huit offres au plus, chacune une fois, le reste garde', async () => {
  const offres = Array.from({ length: 12 }, (_, i) => ({ store: 'steam', storeId: String(100 + i), title: `Jeu ${i}` }));
  offres.push(offres[0]);
  const f = fauxFetch([['appreviews', REVIEWS]]);
  const avant = { 'app:999': { appid: '999', score: 7, positive: 9, total: 10, at: NOW - DAY } };
  const r = await refreshRatings(avant, offres, { fetch: f, now: NOW });
  assert.equal(PER_RUN, 8);
  assert.equal(r.asked, 8);
  assert.equal(r.got, 8);
  assert.equal(f.appels.length, 8, 'le doublon ne coute rien');
  assert.ok(r.ratings['app:999'], 'ce qu\'on savait reste');
  assert.equal(Object.keys(r.ratings).length, 9);
  // Le passage suivant prend la suite, sans redemander les huit premiers.
  const g = fauxFetch([['appreviews', REVIEWS]]);
  const r2 = await refreshRatings(r.ratings, offres, { fetch: g, now: NOW + DAY });
  assert.equal(g.appels.length, 4);
  assert.equal(r2.asked, 4);
});

test('le souvenir ne grossit pas sans fin', () => {
  const entrees = Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => [`app:${i}`, { score: 8, positive: 1, total: 1, at: NOW + i }]);
  const out = storeRatings({}, entrees);
  assert.equal(Object.keys(out).length, MAX_ENTRIES);
  assert.ok(!out['app:0'] && out[`app:${MAX_ENTRIES + 9}`], 'les plus anciennes sortent');
});

test('la notification d\'un jeu seul porte sa note sur une seconde ligne', () => {
  setLocale('fr');
  try {
    const note = { score: 8, positive: 2788, total: 3017 };
    const { text } = composeAnnouncement([{ ...ASTREA, end: NOW + 5 * DAY }], null, NOW, note);
    assert.match(text, /\nSteam : Très positives \(92 %\)$/);
    assert.ok(!composeAnnouncement([ASTREA], null, NOW, null).text.includes('Steam'), 'sans note, rien');
    assert.ok(!composeAnnouncement([ASTREA, { ...ASTREA, title: 'B' }], null, NOW, note).text.includes('Steam'), 'plusieurs jeux : pas de note');
  } finally { setLocale(null); }
});

test('branche partout : reglage, worker, cycle, popup', () => {
  assert.equal(DEFAULT_SETTINGS.steamRatings, true);
  assert.equal(KEY_RATINGS, 'veille:notes-steam');
  const bg = lire('background.js');
  assert.match(bg, /rateOffer: \(offer\) => rateOne\(offer\)/);
  assert.match(bg, /await maybeRatings\(now\);/);
  assert.match(bg, /new Promise\(\(fin\) => setTimeout\(fin, 6000\)\)/, 'une notification n\'attend pas plus de six secondes');
  const cycle = lire('watch/cycle.js');
  assert.match(cycle, /!decision\.digest && watched\.length === 1 && typeof rateOffer === 'function'/);
  const popup = lire('pages/popup.js');
  assert.match(popup, /if \(note\) actions\.append\(ratingTag\(note\)\);/);
  assert.match(popup, /ratingsOn: behaviour\.steamRatings !== false/);
  const html = lire('pages/popup.html');
  assert.match(html, /id="steam-ratings"/);
  const manifest = JSON.parse(lire('manifest.json'));
  assert.ok(manifest.host_permissions.includes('https://store.steampowered.com/*'), 'aucune permission nouvelle');
});
