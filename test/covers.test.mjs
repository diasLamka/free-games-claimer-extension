/* « Deja recupere » : jaquettes, icones, pli (2.81.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_COVERS, MAX_ENTRIES, NONE_MS, PER_RUN, coverFor, fetchCover, needsCover, refreshCovers, safeImage,
} from '../watch/covers.js';
import { UI_COMMANDS, messageAllowed } from '../watch/messaging.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 3600 * 1000;
/* Mesure du 2026-09-26 : Botany Manor, « deja recupere » dans la liste signalee. */
const BOTANY = JSON.parse(lire('test/fixtures/steam-search-botany.json'));

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url) => {
    appels.push(url);
    const term = new URL(url).searchParams.get('term');
    const r = reponses[term];
    if (r instanceof Error) throw r;
    if (!r) return { ok: true, json: async () => ({ total: 0, items: [] }) };
    return { ok: r.status ? r.status < 400 : true, json: async () => r.body || r };
  };
  f.appels = appels;
  return f;
}

test('la jaquette du titre exact -- ni la bande-son, ni la demo', async () => {
  const c = await fetchCover('Botany Manor', { fetch: fauxFetch({ 'Botany Manor': BOTANY }), now: NOW });
  assert.equal(c.appid, '1425350');
  assert.match(c.image, /^https:\/\/[a-z.]*steamstatic\.com\/.*1425350/);
  assert.equal(c.at, NOW);
});

test('inconnu de Steam : on le note ; Steam muet : rien', async () => {
  assert.deepEqual(await fetchCover('Un jeu inconnu 2026', { fetch: fauxFetch({}), now: NOW }), { none: true, at: NOW });
  assert.equal(await fetchCover('X', { fetch: fauxFetch({ X: { status: 503, body: {} } }), now: NOW }), null);
  assert.equal(await fetchCover('X', { fetch: fauxFetch({ X: new Error('reseau') }), now: NOW }), null);
});

test('seules les images du CDN de Steam, en https, s\'affichent', () => {
  assert.ok(safeImage('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1425350/capsule_231x87.jpg?t=1'));
  assert.ok(safeImage('https://cdn.cloudflare.steamstatic.com/steam/apps/1/header.jpg'));
  assert.equal(safeImage('http://shared.akamai.steamstatic.com/x.jpg'), null);
  assert.equal(safeImage('https://evil.example/steamstatic.com/x.jpg'), null);
  assert.equal(safeImage('javascript:alert(1)'), null);
  assert.equal(coverFor({ 'botany manor': { image: 'https://evil.example/x.jpg', at: NOW } }, 'Botany Manor'), null);
});

test('une fois pour toutes ; un introuvable se redemande apres une semaine', () => {
  const connu = { 'botany manor': { image: 'https://shared.akamai.steamstatic.com/a.jpg', appid: '1', at: NOW - 400 * DAY } };
  assert.equal(needsCover({}, 'Botany Manor', NOW), true);
  assert.equal(needsCover(connu, 'Botany Manor', NOW), false, 'une jaquette trouvee ne se redemande pas');
  assert.equal(coverFor(connu, 'BOTANY MANOR!'), 'https://shared.akamai.steamstatic.com/a.jpg', 'titre normalise');
  assert.equal(needsCover({ x: { none: true, at: NOW - NONE_MS + 1000 } }, 'X', NOW), false);
  assert.equal(needsCover({ x: { none: true, at: NOW - NONE_MS } }, 'X', NOW), true);
  assert.equal(coverFor({ x: { none: true, at: NOW } }, 'X'), null);
  assert.equal(needsCover({}, '', NOW), false);
});

test('un passage : les titres affiches, chacun une fois, seize au plus', async () => {
  const titres = Array.from({ length: 20 }, (_, i) => `Jeu ${i}`);
  titres.push('Jeu 0', 'Botany Manor');
  const f = fauxFetch({ 'Botany Manor': BOTANY });
  const r = await refreshCovers({}, ['Botany Manor', ...titres], { fetch: f, now: NOW });
  assert.equal(PER_RUN, 16);
  assert.equal(f.appels.length, 16, 'le doublon ne coute rien');
  assert.equal(r.asked, 16);
  assert.equal(r.covers['botany manor'].appid, '1425350');
  assert.equal(r.covers['jeu 0'].none, true);
  const r2 = await refreshCovers(r.covers, titres, { fetch: fauxFetch({}), now: NOW });
  assert.equal(r2.asked, 5, 'le passage suivant prend la suite');
});

test('le registre ne grossit pas sans fin', async () => {
  const plein = Object.fromEntries(Array.from({ length: MAX_ENTRIES }, (_, i) => [`jeu ${i}`, { none: true, at: NOW - DAY + i }]));
  const r = await refreshCovers(plein, ['Botany Manor'], { fetch: fauxFetch({ 'Botany Manor': BOTANY }), now: NOW });
  assert.equal(Object.keys(r.covers).length, MAX_ENTRIES);
  assert.ok(r.covers['botany manor'] && !r.covers['jeu 0']);
});

test('le popup demande, le worker ecrit ; la commande est reservee aux pages', () => {
  assert.equal(KEY_COVERS, 'veille:jaquettes');
  assert.ok(UI_COMMANDS.includes('fgc-covers'));
  assert.equal(messageAllowed('fgc-covers', 'content'), false);
  const bg = lire('background.js');
  assert.match(bg, /msg\.type === 'fgc-covers'/);
  assert.match(bg, /if \(r\.got\) await write\(api, \{ \[KEY_COVERS\]: r\.covers \}\);/);
  const popup = lire('pages/popup.js');
  assert.match(popup, /if \(aDemander\.length\) tell\('fgc-covers', \{ titles: aDemander \}\);/);
  assert.match(popup, /COVERS_ASKED\.add\(row\.label\)/, 'une demande par titre et par ouverture');
});

test('les statuts deviennent des icones, dessinees au DOM, avec leurs mots en infobulle', () => {
  const popup = lire('pages/popup.js');
  for (const k of ['ok', 'own', 'skip', 'ko', 'wait']) assert.match(popup, new RegExp(`\\n  ${k}: \\[`), k);
  assert.match(popup, /document\.createElementNS\(SVG_NS, 'svg'\)/);
  assert.match(popup, /svg\.setAttribute\('aria-label', label\);/);
  assert.match(popup, /st\.title = mots;/);
  const code = popup.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML/, 'jamais d\'innerHTML');
  const html = lire('pages/popup.html');
  for (const k of ['ok', 'own', 'skip', 'wait', 'ko']) assert.match(html, new RegExp(`\\.st-icon\\.${k}\\s+\\{ color: `), k);
});
