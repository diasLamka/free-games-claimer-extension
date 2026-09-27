/* Le scanner de page (2.91.0).
 *
 * Ce qui compte : un lien de magasin donne son jeu, meme cache derriere une
 * redirection ; un titre connu cite dans le texte est trouve, sans qu'un mot
 * courant (« Control ») fasse croire a un jeu ; et chaque jeu ressort avec ce
 * qui le concerne -- gratuit maintenant d'abord, deja a vous en dernier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gameFromLink, unwrapLink, slugTitle, scanGames, classify, knownTitles, readPage, STATUS, MAX_GAMES,
} from '../watch/page-scan.js';
import { normaliseTitle } from '../watch/offer.js';
import { makeEntry } from '../watch/library.js';
import { addWish, makeSteamWishlist } from '../watch/wishlist.js';

const NOW = Date.UTC(2026, 8, 27, 12);

test('un lien de fiche donne le magasin, l\'identifiant et un titre lisible', () => {
  assert.deepEqual(gameFromLink('https://store.steampowered.com/app/1145360/Hades/', ''),
    { store: 'steam', id: '1145360', title: 'Hades', url: 'https://store.steampowered.com/app/1145360/Hades/' });
  assert.equal(gameFromLink('https://store.steampowered.com/app/367520/Hollow_Knight/', 'Hollow Knight on Steam').title, 'Hollow Knight');
  assert.equal(gameFromLink('https://store.epicgames.com/fr/p/the-witness', 'ici').title, 'The Witness', 'un texte vide de sens cede au slug');
  assert.equal(gameFromLink('https://www.gog.com/en/game/disco_elysium', 'Disco Elysium - The Final Cut').title, 'Disco Elysium');
  assert.equal(gameFromLink('https://www.humblebundle.com/store/celeste', 'Buy Celeste from the Humble Store').title, 'Celeste');
  assert.equal(gameFromLink('https://www.fanatical.com/en/game/tunic', '').store, 'fanatical');
  assert.equal(gameFromLink('https://tobyfox.itch.io/deltarune', 'DELTARUNE').store, 'itchio');
  assert.equal(gameFromLink('https://store.steampowered.com/app/1145360', ''), null, 'ni nom ni slug : rien');
  assert.equal(gameFromLink('https://store.steampowered.com/app/1145360', 'Hades').title, 'Hades');
  for (const u of ['https://www.humblebundle.com/store/search?sort=x', 'https://store.epicgames.com/fr/', 'https://example.test/game/x', 'javascript:alert(1)']) {
    assert.equal(gameFromLink(u, 'x'), null, u);
  }
});

test('les redirections de YouTube, Reddit ou Google sont deballees', () => {
  const yt = 'https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fstore.steampowered.com%2Fapp%2F1145360%2FHades%2F';
  assert.equal(unwrapLink(yt), 'https://store.steampowered.com/app/1145360/Hades/');
  assert.equal(gameFromLink(yt, 'https://store.steampowered.com/app/1145360/Hades/').title, 'Hades');
  assert.equal(unwrapLink('https://www.google.com/url?url=https://www.gog.com/game/gris&sa=D'), 'https://www.gog.com/game/gris');
  assert.equal(unwrapLink('file:///etc/passwd'), null);
  assert.equal(slugTitle('hollow_knight%20silksong'), 'Hollow Knight Silksong');
});

test('le texte : un titre connu de plusieurs mots partout, d\'un seul mot seulement mis en avant', () => {
  const page = {
    links: [{ href: 'https://store.steampowered.com/app/1145360/Hades/', text: 'Hades' }],
    strong: ['Nos coups de coeur', 'Celeste'],
    text: 'On a adore Hollow Knight et Celeste. Le controle de la manette dans Control est parfait. Hades aussi.',
  };
  const trouves = scanGames(page, { known: ['Hollow Knight', 'Celeste', 'Control', 'Tunic', 'Hades', 'Gris'], normalise: normaliseTitle });
  assert.deepEqual(trouves.map((g) => g.title), ['Hades', 'Hollow Knight', 'Celeste']);
  assert.equal(trouves[0].source, 'link', 'le lien passe avant le texte, et une seule fois');
  assert.equal(trouves[1].source, 'text');
});

test('une page qui cite trop de jeux s\'arrete au plafond', () => {
  const links = Array.from({ length: 80 }, (_, i) => ({ href: `https://store.steampowered.com/app/${i + 10}/Jeu_${i}/`, text: '' }));
  assert.equal(scanGames({ links, strong: [], text: '' }, { normalise: normaliseTitle }).length, MAX_GAMES);
});

test('chaque jeu ressort avec ce qui le concerne, gratuit d\'abord, deja a vous en dernier', () => {
  const games = scanGames({
    links: [
      { href: 'https://store.steampowered.com/app/1145360/Hades/', text: 'Hades' },
      { href: 'https://www.gog.com/game/gris', text: 'Gris' },
      { href: 'https://store.epicgames.com/p/tunic', text: 'Tunic' },
      { href: 'https://store.steampowered.com/app/367520/Hollow_Knight/', text: 'Hollow Knight' },
    ],
  }, { normalise: normaliseTitle });
  const rows = classify(games, {
    catalog: { 'gog:gris': { title: 'Gris', store: 'gog', end: NOW + 3600_000, url: 'https://www.gog.com/game/gris' } },
    library: { 'epic:hades': makeEntry({ store: 'epic', id: 'hades', title: 'Hades', ts: NOW - 86400_000, status: 'claimed' }) },
    wishlist: addWish([], 'Tunic', normaliseTitle),
    steamWishlist: makeSteamWishlist([{ id: '367520', title: 'Hollow Knight' }], normaliseTitle, NOW),
    normalise: normaliseTitle,
    now: NOW,
  });
  assert.deepEqual(rows.map((r) => [r.title, r.status]), [
    ['Gris', STATUS.FREE], ['Tunic', STATUS.WISHED], ['Hollow Knight', STATUS.WISHED], ['Hades', STATUS.OWNED],
  ]);
  assert.equal(rows[0].catalogKey, 'gog:gris');
  assert.equal(rows[0].freeStore, 'gog');
  assert.ok(rows[3].facts.some((f) => f.kind === 'claimed'));
});

test('les titres connus : registre, catalogue, collection, souhaits et listes importees', () => {
  const k = knownTitles({
    library: { a: { title: 'Hades' } },
    catalog: { b: { title: 'Gris' } },
    collection: { c: { title: 'Celeste' } },
    wishlist: addWish([], 'Tunic', normaliseTitle),
    steamWishlist: makeSteamWishlist([{ id: '1', title: 'Hollow Knight' }], normaliseTitle, NOW),
  });
  assert.deepEqual(k.sort(), ['Celeste', 'Gris', 'Hades', 'Hollow Knight', 'Tunic']);
});

test('readPage se suffit a elle-meme : executeScript la serialise sans son module', () => {
  const src = readPage.toString();
  // Aucune reference a ce qui est importe ou defini ailleurs dans le module.
  for (const nom of ['lookup', 'cleanTitle', 'wishOrigin', 'MAX_TEXT', 'MAX_LINKS', 'gameFromLink']) {
    assert.ok(!new RegExp(`\\b${nom}\\b`).test(src), nom);
  }
});
