/* La barre d'adresse : « fg » puis un titre (2.85.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { KEYWORD, KINDS, escapeXml, omniFacts, omniSuggestions, omniTarget } from '../watch/omnibox.js';
import { setLocale, t } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const LABELS = { epic: 'Epic Games Store', steam: 'Steam', gog: 'GOG.com' };
const DIRE = { t, storeLabel: (s) => LABELS[s] || s, dateText: (ms) => new Date(ms).toISOString().slice(0, 10) };

const DONNEES = {
  now: NOW,
  catalog: {
    'epic:hades': { store: 'epic', title: 'Hades', url: 'https://store.epicgames.com/p/hades', end: NOW + 3 * DAY, state: 'queued' },
    'epic:vieux': { store: 'epic', title: 'Hades Vieux', url: 'https://store.epicgames.com/p/vieux', end: NOW - DAY, state: 'queued' },
    'ubi:hades2': { store: 'ubisoft', title: 'Hades Ubi', url: 'https://store.ubisoft.com/x', end: NOW + DAY, state: 'queued' },
  },
  library: { 'epic:hue': { store: 'epic', title: 'Hue', ts: NOW - 30 * DAY, url: 'https://store.epicgames.com/p/hue' } },
  collection: {
    'steam:1145360': { store: 'steam', id: '1145360', title: 'Hades', url: 'https://store.steampowered.com/app/1145360/' },
    'gog:1': { store: 'gog', id: '1', title: 'Hades II', url: null },
  },
  wishlist: [{ title: 'Hades III', key: 'hades iii' }],
  sources: { 'epic-api': { announcedWindows: [{ start: NOW + 5 * DAY, title: 'Hades Blood', url: 'https://store.epicgames.com/p/blood' }] } },
  watched: ['epic', 'steam', 'gog'],
};

test('le mot-cle est dans les deux manifestes', () => {
  assert.equal(KEYWORD, 'fg');
  for (const f of ['manifest.json', 'manifest.firefox.json']) assert.deepEqual(JSON.parse(lire(f)).omnibox, { keyword: 'fg' }, f);
});

test('les faits par jeu : gratuit, bientot, recupere, possede, souhaite -- et rien d\'expire ni de non suivi', () => {
  const f = omniFacts('hades', DONNEES);
  assert.deepEqual([...f.keys()].sort(), ['hades', 'hades blood', 'hades ii', 'hades iii']);
  assert.deepEqual(f.get('hades').facts.map((x) => x.kind).sort(), [KINDS.FREE, KINDS.OWNED].sort());
  assert.equal(f.get('hades blood').facts[0].kind, KINDS.SOON);
  assert.equal(omniFacts('h', DONNEES).size, 0, 'une lettre ramenerait tout');
  assert.equal(omniFacts('hue', DONNEES).get('hue').facts[0].kind, KINDS.CLAIMED);
});

test('une suggestion par jeu, du plus utile au moins utile, avec la fiche en contenu', () => {
  setLocale('fr');
  try {
    const s = omniSuggestions('hades', DONNEES, DIRE);
    assert.deepEqual(s.map((x) => x.content), [
      'https://store.epicgames.com/p/hades',
      'https://store.epicgames.com/p/blood',
      'Hades II',
      'Hades III',
    ]);
    assert.equal(s[0].description, 'Hades — gratuit sur Epic Games Store jusqu’au 2026-09-29 · déjà à vous');
    assert.equal(s[1].description, 'Hades Blood — bientôt gratuit sur Epic Games Store, le 2026-10-01');
    assert.equal(s[2].description, 'Hades II — déjà dans votre bibliothèque GOG.com');
    assert.equal(s[3].description, 'Hades III — dans vos souhaits : vous serez prévenu');
    assert.equal(omniSuggestions('hue', DONNEES, DIRE)[0].description, 'Hue — récupéré sur Epic Games Store le 2026-08-27');
    assert.equal(omniSuggestions('hades', DONNEES, { ...DIRE, max: 2 }).length, 2);
  } finally { setLocale(null); }
});

test('le titre exact passe devant, et la description est du XML echappe', () => {
  const data = { now: NOW, collection: {
    a: { store: 'steam', title: 'Super Hades Deluxe' },
    b: { store: 'steam', title: 'Hades' },
    c: { store: 'steam', title: 'Hades <script>&' },
  } };
  const s = omniSuggestions('hades', data, DIRE);
  assert.equal(s[0].content, 'Hades');
  assert.match(s.find((x) => x.content.startsWith('Hades <')).description, /Hades &lt;script&gt;&amp;/);
  assert.equal(escapeXml(`a"b'c`), 'a&quot;b&apos;c');
});

test('Entree : la fiche choisie, sinon le tableau de bord avec la recherche', () => {
  const tableau = 'chrome-extension://abc/pages/popup.html?vue=onglet';
  assert.equal(omniTarget('https://store.epicgames.com/p/hades', tableau), 'https://store.epicgames.com/p/hades');
  assert.equal(omniTarget('hades ii', tableau), `${tableau}&q=hades%20ii`);
  assert.equal(omniTarget('javascript:alert(1)', tableau), `${tableau}&q=javascript%3Aalert(1)`, 'jamais une adresse qui n\'est pas https');
  assert.equal(omniTarget('http://example.com', tableau), `${tableau}&q=http%3A%2F%2Fexample.com`);
});

test('branche : le worker suggere et ouvre, le tableau de bord lit ?q=', () => {
  const bg = lire('background.js');
  assert.match(bg, /api\.omnibox\.onInputChanged\.addListener/);
  assert.match(bg, /api\.omnibox\.onInputEntered\.addListener/);
  assert.match(bg, /OMNI_KEYS\.some\(\(k\) => changes\[k\]\)\) omniCache = null;/, 'le cache suit le stockage');
  const popup = lire('pages/popup.js');
  assert.match(popup, /new URLSearchParams\(location\.search\)\.get\('q'\)/);
});
