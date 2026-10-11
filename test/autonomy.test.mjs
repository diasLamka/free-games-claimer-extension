/* L'autonomie de l'extension (2.112.0) : recupere-t-elle vraiment seule, et qu'est-ce qui la freine ?
 *
 * Le calcul est pur : il lit ce que l'extension sait deja -- les reglages, les sessions sondees, l'arret d'urgence, la permission
 * d'arriere-plan, les verifications humaines vues, ce qui a ete pris -- et compte, sur quatorze jours, ce que la veille a pris
 * seule et ce qui a ete pris a la demande de l'utilisateur. Rien n'est mesure ici : tout vient de ce qui a ete note.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { autonomyReport, LEVEL, BLOCK, WINDOW_DAYS } from '../watch/autonomy.js';

const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
const DAY = 24 * 3600 * 1000;
const STORES = ['epic', 'gog', 'amazon'];

const base = (extra = {}) => ({
  settings: { autonomousClaim: true },
  catalog: {},
  sessions: {},
  stopped: false,
  backgroundSupported: true,
  backgroundGranted: true,
  claimableStores: STORES,
  now: NOW,
  ...extra,
});

const entry = (verdict, store, ageDays, alone) => ({ verdict, store, updatedAt: NOW - ageDays * DAY, ...(alone === undefined ? {} : { alone }) });

test('la reclamation autonome coupee : elle ne recupere pas seule', () => {
  const r = autonomyReport(base({ settings: { autonomousClaim: false } }));
  assert.equal(r.level, LEVEL.OFF);
  assert.deepEqual(r.blocks.map((b) => b.kind), [BLOCK.OFF]);
});

test('l\'arret d\'urgence : rien ne se recupere', () => {
  const r = autonomyReport(base({ stopped: true }));
  assert.equal(r.level, LEVEL.OFF);
  assert.deepEqual(r.blocks.map((b) => b.kind), [BLOCK.STOPPED]);
});

test('rien ne la freine : elle recupere seule', () => {
  const r = autonomyReport(base());
  assert.equal(r.level, LEVEL.ON);
  assert.deepEqual(r.blocks, []);
});

test('une session perdue sur un magasin actif est un frein', () => {
  const r = autonomyReport(base({ sessions: { epic: { status: 'logged_out', at: NOW - 1000 } } }));
  assert.equal(r.level, LEVEL.PARTIAL);
  const b = r.blocks.find((x) => x.kind === BLOCK.SESSIONS);
  assert.deepEqual([...b.stores], ['epic']);
});

test('une session perdue sur un magasin qu\'on ne reclame pas n\'est pas un frein, ni un « inconnu »', () => {
  const sessions = { steam: { status: 'logged_out', at: NOW - 1000 }, epic: { status: 'unknown', at: NOW - 1000 } };
  const r = autonomyReport(base({ sessions }));
  assert.equal(r.level, LEVEL.ON);
});

test('une verification humaine vue sur un jeu pas encore pris est un frein', () => {
  const r = autonomyReport(base({ catalog: { 'epic:a': entry('challenge', 'epic', 1) } }));
  assert.equal(r.level, LEVEL.PARTIAL);
  assert.deepEqual([...r.blocks.find((x) => x.kind === BLOCK.CHALLENGES).stores], ['epic']);
});

test('une vieille verification, ou un jeu finalement pris, n\'est plus un frein', () => {
  assert.equal(autonomyReport(base({ catalog: { 'epic:a': entry('challenge', 'epic', 20) } })).level, LEVEL.ON);
  // Le catalogue garde UNE entree par jeu : une fois pris, son verdict n'est plus « challenge ».
  assert.equal(autonomyReport(base({ catalog: { 'epic:a': entry('claimed', 'epic', 1, true) } })).level, LEVEL.ON);
});

test('sans la permission d\'arriere-plan, Chrome doit rester ouvert : c\'est un frein', () => {
  const r = autonomyReport(base({ backgroundGranted: false }));
  assert.equal(r.level, LEVEL.PARTIAL);
  assert.ok(r.blocks.some((b) => b.kind === BLOCK.CLOSED));
});

test('un navigateur qui ne propose pas la permission n\'en fait pas un frein', () => {
  assert.equal(autonomyReport(base({ backgroundSupported: false, backgroundGranted: false })).level, LEVEL.ON);
});

test('les freins s\'additionnent', () => {
  const r = autonomyReport(base({
    backgroundGranted: false,
    sessions: { gog: { status: 'logged_out', at: NOW } },
    catalog: { 'epic:a': entry('challenge', 'epic', 2) },
  }));
  assert.equal(r.level, LEVEL.PARTIAL);
  assert.deepEqual(r.blocks.map((b) => b.kind).sort(), [BLOCK.CHALLENGES, BLOCK.CLOSED, BLOCK.SESSIONS].sort());
});

test('elle compte, sur quatorze jours, ce que la veille a pris seule et ce qui l\'a ete a la demande', () => {
  const catalog = {
    a: entry('claimed', 'epic', 1, true),
    b: entry('redeemed', 'gog', 2, true),
    c: entry('claimed', 'epic', 3, false),
    d: entry('claimed', 'epic', 20, true), // trop ancien
    e: entry('claimed', 'epic', 1), // d'avant la mesure : on ne dit rien
    f: entry('failed', 'epic', 1, true), // pas pris
  };
  const r = autonomyReport(base({ catalog }));
  assert.equal(r.alone, 2);
  assert.equal(r.withYou, 1);
  assert.equal(WINDOW_DAYS, 14);
});

test('des entrees mal formees ne cassent rien', () => {
  const r = autonomyReport(base({ catalog: { a: null, b: 'x', c: {}, d: { verdict: 'claimed' } }, sessions: null, settings: null }));
  assert.equal(r.level, LEVEL.ON);
  assert.equal(r.alone + r.withYou, 0);
});
