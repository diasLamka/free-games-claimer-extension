/* Le grand chiffre du tableau de bord : ce qui a ete economise depuis le debut (2.76.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tally } from '../watch/tally.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const HTML = lire('pages/popup.html');
const JS = lire('pages/popup.js');
const CLES = ['heroLabel', 'heroGamesOne', 'heroGamesMany', 'heroGamesPriced', 'heroThisMonth'];

/** Le corps d'une fonction de popup.js, accolades comptees. */
function corps(nom) {
  const i = JS.indexOf(`function ${nom}(`);
  assert.ok(i >= 0, nom);
  let p = 0;
  for (let k = JS.indexOf('{', i); k < JS.length; k++) {
    if (JS[k] === '{') p++;
    else if (JS[k] === '}' && --p === 0) return JS.slice(i, k + 1);
  }
  throw new Error(`${nom} : fin introuvable`);
}

test('le bloc existe une fois, cache au depart, et annonce ses changements', () => {
  const m = HTML.match(/<section class="hero" id="hero"[^>]*>/g) || [];
  assert.equal(m.length, 1);
  assert.match(m[0], /\bhidden\b/, 'rien ne s\'affiche avant le premier rendu');
  assert.match(m[0], /aria-live="polite"/);
  for (const id of ['hero-value', 'hero-games', 'hero-delta']) assert.equal(HTML.split(`id="${id}"`).length, 2, id);
  assert.ok(HTML.indexOf('id="hero"') < HTML.indexOf('id="panes"'), 'en tete, avant les volets');
});

test('dans le petit popup, le chiffre ne prend pas de place', () => {
  // Ferme par defaut, ouvert seulement sous le marqueur du tableau de bord.
  assert.match(HTML, /\n\s*\.hero \{ display: none; \}/);
  assert.match(HTML, /:root\[data-vue="onglet"\] \.hero:not\(\[hidden\]\) \{[^}]*display: block;/);
  // Un seul grand chiffre, assez grand pour se lire de loin, dans la police du texte.
  const taille = /\.hero-value \{[^}]*font: 600 (\d+)px\/[\d.]+ var\(--body\)/.exec(HTML);
  assert.ok(taille && Number(taille[1]) >= 48, 'au moins 48 px');
  assert.equal((HTML.match(/class="hero-value"/g) || []).length, 1);
});

test('le rendu ne montre le bloc qu\'au tableau de bord, et seulement avec une valeur connue', () => {
  const f = corps('renderHero');
  assert.match(f, /hero\.hidden = !EN_ONGLET \|\| !b\.priced;/);
  assert.match(f, /if \(hero\.hidden\) return;/);
  assert.match(f, /moneyTotals\(b\.totals\)/, 'le meme total que le Bilan, converti de la meme facon');
  assert.match(corps('renderTally'), /renderHero\(rows, b, all\);/);
});

test('le chiffre du mois est celui du bilan : l\'extension seule, mois en UTC', () => {
  const now = Date.parse('2026-09-26T12:00:00Z');
  const mois = new Date(now).toISOString().slice(0, 7);
  const rows = [
    { ts: Date.parse('2026-09-02T10:00:00Z'), store: 'epic', worth: 14.99, currency: 'EUR' },
    { ts: Date.parse('2026-09-20T10:00:00Z'), store: 'gog', worth: 9.99, currency: 'EUR' },
    { ts: Date.parse('2026-09-21T10:00:00Z'), store: 'epic', worth: 30, currency: 'EUR', already: true },
    { ts: Date.parse('2026-08-31T23:59:00Z'), store: 'epic', worth: 19.99, currency: 'EUR' },
  ];
  // Ce que fait renderHero : le mois courant, passe par le meme tally.
  const ceMois = tally(rows.filter((r) => new Date(r.ts).toISOString().slice(0, 7) === mois));
  assert.deepEqual(ceMois.totals, { EUR: 24.98 }, 'un jeu deja a vous n\'a rien rapporte');
  assert.equal(tally(rows).byMonth[mois], 2, 'meme compte que « meilleur mois »');
  assert.match(corps('renderHero'), /toISOString\(\)\.slice\(0, 7\)/);
});

test('les phrases existent dans les quatre langues, avec leurs trous', () => {
  const trous = { heroLabel: [], heroGamesOne: [], heroGamesMany: ['$1'], heroGamesPriced: ['$1', '$2'], heroThisMonth: ['$1'] };
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of CLES) {
      const msg = table[k] && table[k].message;
      assert.ok(msg, `${l} ${k}`);
      for (const tr of trous[k]) assert.ok(msg.includes(tr), `${l} ${k} ${tr}`);
      assert.ok(!/\$[3-9]/.test(msg), `${l} ${k}`);
    }
  }
  assert.match(HTML, /data-i18n="heroLabel"/);
});
