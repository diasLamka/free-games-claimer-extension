/* Tests du journal persistant.
 *
 * Ce module existe parce qu'un service worker emporte sa console en mourant.
 * Chaque test correspond a une facon de rendre le journal inutile au moment
 * precis ou on en a besoin : une erreur ecrite comme {}, un anneau qui grossit
 * sans fin, un filtre qui cache les erreurs qu'on cherchait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  KEY_JOURNAL,
  MAX_ENTRIES,
  MAX_DETAILS,
  LEVELS,
  describe as decrire,
  makeEntry,
  append,
  sanitise,
  filterEntries,
  countByLevel,
  toText,
  journalFileName,
  appendTo,
  readJournal,
  clearJournal,
} from '../watch/journal.js';

const T = Date.UTC(2026, 8, 17, 4, 0, 0);

/* ---------------------------------------------------------------- details */

test('une Error devient du texte, pas un objet vide', () => {
  // Une Error passee telle quelle a storage.local arrive sous la forme {} :
  // ni message, ni pile, et rien pour le signaler.
  const e = new TypeError('alarms.create: unexpected property');
  assert.equal(decrire(e), 'TypeError: alarms.create: unexpected property');
});

test('un objet est serialise, un objet impossible rend son type', () => {
  assert.equal(decrire({ source: 'epic', offres: 2 }), '{"source":"epic","offres":2}');

  const cycle = {};
  cycle.soi = cycle;
  assert.equal(decrire(cycle), '[object Object]', 'un cycle ne doit pas faire jeter le journal');
});

test('l\'absence de detail reste l\'absence de detail', () => {
  assert.equal(decrire(null), null);
  assert.equal(decrire(undefined), null);
  assert.equal(decrire(''), null);
});

test('un detail trop long est tronque, pas refuse', () => {
  const long = 'x'.repeat(MAX_DETAILS * 2);
  const out = decrire(long);
  assert.equal(out.length, MAX_DETAILS);
  assert.ok(out.endsWith('…'), 'la troncature doit se voir');
});

/* ----------------------------------------------------------------- entree */

test('une entree est normalisee, niveau inconnu compris', () => {
  const e = makeEntry({ level: 'catastrophe', message: 'coucou', ts: T });
  assert.equal(e.level, LEVELS.INFO, 'un niveau inconnu ne doit pas passer tel quel');
  assert.equal(e.message, 'coucou');
  assert.equal(e.ts, T);
  assert.equal(e.details, null);
});

test('une entree sans horodatage en recoit un', () => {
  const avant = Date.now();
  const e = makeEntry({ level: 'info', message: 'x' });
  assert.ok(e.ts >= avant, 'l\'horodatage manquant doit etre pose, pas laisse vide');
});

/* ----------------------------------------------------------------- anneau */

test('le plus recent est en tete : c\'est l\'ordre de lecture', () => {
  let ring = [];
  ring = append(ring, makeEntry({ level: 'info', message: 'premier', ts: T }));
  ring = append(ring, makeEntry({ level: 'info', message: 'second', ts: T + 1000 }));

  assert.equal(ring[0].message, 'second');
  assert.equal(ring.length, 2);
});

test('la borne est imposee a l\'ecriture, jamais au menage', () => {
  // Un journal qui grossit sans fin remplit le quota, et c'est alors le
  // CATALOGUE qui ne peut plus s'ecrire : le journal aurait coute la veille.
  let ring = [];
  for (let i = 0; i < MAX_ENTRIES + 50; i++) {
    ring = append(ring, makeEntry({ level: 'info', message: `entree ${i}`, ts: T + i }));
  }
  assert.equal(ring.length, MAX_ENTRIES);
  assert.equal(ring[0].message, `entree ${MAX_ENTRIES + 49}`, 'la plus recente doit survivre');
  assert.equal(ring[ring.length - 1].message, 'entree 50', 'les plus anciennes partent');
});

test('un anneau relu illisible ne fait pas tomber la page', () => {
  assert.deepEqual(sanitise(null), []);
  assert.deepEqual(sanitise('pas un tableau'), []);

  const propre = sanitise([null, { ts: T, level: 'warn', message: 'ok' }, { message: 'sans date' }]);
  assert.equal(propre.length, 1);
  assert.equal(propre[0].message, 'ok');
});

/* ---------------------------------------------------------------- lecture */

const ring = [
  makeEntry({ level: 'error', message: 'cycle impossible', details: new Error('boom'), ts: T + 3000 }),
  makeEntry({ level: 'warn', message: 'source epic muette', ts: T + 2000 }),
  makeEntry({ level: 'info', message: 'cycle termine, 2 offres', ts: T + 1000 }),
  makeEntry({ level: 'info', message: 'reveil', ts: T }),
];

test('demander les avertissements montre aussi les erreurs', () => {
  // Voir les avertissements sans les erreurs qui les suivent donnerait une
  // lecture fausse de la nuit.
  const vus = filterEntries(ring, { level: 'warn' });
  assert.deepEqual(vus.map((e) => e.level), ['error', 'warn']);
});

test('le filtre par date et par texte porte sur le message ET le detail', () => {
  assert.equal(filterEntries(ring, { since: T + 2000 }).length, 2);
  assert.equal(filterEntries(ring, { query: 'EPIC' }).length, 1, 'la casse ne doit pas compter');
  assert.equal(filterEntries(ring, { query: 'boom' }).length, 1, 'le detail est cherche aussi');
  assert.equal(filterEntries(ring, { query: 'jamais vu' }).length, 0);
});

test('le compte par niveau tient en une ligne d\'entete', () => {
  assert.deepEqual(countByLevel(ring), { info: 2, warn: 1, error: 1 });
  assert.deepEqual(countByLevel([]), { info: 0, warn: 0, error: 0 });
});

/* ----------------------------------------------------------------- export */

test('le texte exporte se lit dans le sens ou les choses se sont produites', () => {
  const lignes = toText(ring).split('\n');
  assert.equal(lignes.length, 4);
  assert.match(lignes[0], /reveil$/, 'le fichier commence par le plus ancien');
  assert.match(lignes[3], /cycle impossible -- Error: boom$/);
  assert.match(lignes[0], /^2026-09-17T04:00:00\.000Z INFO /);
});

test('un journal vide s\'exporte sans casser', () => {
  assert.equal(toText([]), '');
  assert.equal(toText(null), '');
});

test('le nom de fichier est stable et se trie chronologiquement', () => {
  assert.equal(journalFileName(T), 'free-games-claimer-journal-2026-09-17-04-00-00.txt');
});

test('la cle vit dans l\'espace de la veille, jamais dans celui du moteur', () => {
  assert.ok(KEY_JOURNAL.startsWith('veille:'));
});

/* --------------------------------------------------------------- stockage */

test('une entree ecrite survit au stockage, Error comprise', async () => {
  const { chrome } = fakeChrome();
  await appendTo(chrome, makeEntry({ level: 'error', message: 'cycle', details: new Error('boum'), ts: T }));

  const relu = await readJournal(chrome);
  assert.equal(relu.length, 1);
  assert.equal(relu[0].details, 'Error: boum', 'l\'erreur doit traverser le stockage en texte');
});

test('la borne tient a l\'ecriture, pas a la lecture', async () => {
  const { chrome } = fakeChrome();
  for (let i = 0; i < 12; i++) {
    await appendTo(chrome, makeEntry({ level: 'info', message: `n${i}`, ts: T + i }), 10);
  }
  const relu = await readJournal(chrome, 10);
  assert.equal(relu.length, 10);
  assert.equal(relu[0].message, 'n11');
});

test('deux ecritures entrelacees perdent une entree -- d\'ou la file du worker', async () => {
  // Ce test ne verifie pas une correction : il fixe la RAISON de la file
  // d'attente de background.js. Sans elle, l'entree perdue serait justement
  // celle qui explique la suivante.
  const { chrome } = fakeChrome({ latenceMs: 5 });

  await Promise.all([
    appendTo(chrome, makeEntry({ level: 'info', message: 'A', ts: T })),
    appendTo(chrome, makeEntry({ level: 'info', message: 'B', ts: T + 1 })),
  ]);
  assert.equal((await readJournal(chrome)).length, 1, 'chrome.storage n\'a pas de transaction');

  await clearJournal(chrome);
  await appendTo(chrome, makeEntry({ level: 'info', message: 'A', ts: T }));
  await appendTo(chrome, makeEntry({ level: 'info', message: 'B', ts: T + 1 }));
  assert.equal((await readJournal(chrome)).length, 2, 'en serie, les deux tiennent');
});

test('un journal jamais ecrit se lit comme un journal vide', async () => {
  assert.deepEqual(await readJournal(fakeChrome().chrome), []);
});

test('effacer laisse un anneau vide, pas une cle absente', async () => {
  const { chrome } = fakeChrome();
  await appendTo(chrome, makeEntry({ level: 'info', message: 'x', ts: T }));
  await clearJournal(chrome);

  const brut = await chrome.storage.local.get(KEY_JOURNAL);
  assert.deepEqual(Array.from(brut[KEY_JOURNAL]), []);
});
