/* Les commandes venues du popup.
 *
 * Elles vivent dans un module plutot que dans background.js pour exactement
 * cette raison : un service worker ne se teste pas, un module qui recoit son
 * `chrome` en parametre se teste.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { claimAllNow, pruneNow, KEEP_EXPIRED_MS } from '../watch/commands.js';
import { fakeChrome } from './fake-chrome.mjs';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const DAY = 86400000;

const offer = (o) => ({
  store: 'epic',
  title: 'X',
  url: 'https://store.epicgames.com/p/x',
  state: 'confirmed',
  verdict: null,
  alreadyOwned: null,
  updatedAt: T,
  ...o,
});

/* ------------------------------------------------------------------ purge */

test('une offre terminee et ancienne est purgee', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': {
      'epic:vieille': offer({ state: 'expired', updatedAt: T - KEEP_EXPIRED_MS - DAY }),
    },
  });

  const out = await pruneNow({ chrome, now: T });
  assert.equal(out.dropped, 1);
  assert.equal(out.kept, 0);

  const { 'veille:offres': apres } = await chrome.storage.local.get('veille:offres');
  assert.deepEqual(apres, {});
});

test('une offre terminee mais recente est gardee', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': { 'epic:hier': offer({ state: 'expired', updatedAt: T - DAY }) },
  });

  const out = await pruneNow({ chrome, now: T });
  assert.equal(out.dropped, 0, 'la retention est le delai au bout duquel une absence devient credible');
});

test('une offre encore en cours n\'est jamais purgee, meme tres ancienne', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': {
      // Sans date de fin : ouverte depuis un an, peut-etre ouverte demain aussi.
      'steam:eternelle': offer({ end: null, updatedAt: T - 400 * DAY }),
    },
  });

  const out = await pruneNow({ chrome, now: T });
  assert.equal(out.dropped, 0);
  assert.equal(out.kept, 1);
});

test('une offre sans horodatage est gardee plutot que devinee', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': { 'epic:sans-date': offer({ state: 'expired', updatedAt: undefined }) },
  });

  const out = await pruneNow({ chrome, now: T });
  assert.equal(out.dropped, 0, 'une purge qui devine se trompe dans le seul sens qui coute');
});

test('une offre dont la fin est passee compte comme terminee', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': {
      // Etat encore « confirmed » : le cycle n'est pas repasse la marquer.
      'epic:passee': offer({ end: T - 10 * DAY, updatedAt: T - KEEP_EXPIRED_MS - DAY }),
    },
  });

  const out = await pruneNow({ chrome, now: T });
  assert.equal(out.dropped, 1);
});

test('la purge n\'ecrit rien quand il n\'y a rien a retirer', async () => {
  const { chrome, journal } = fakeChrome();
  await chrome.storage.local.set({ 'veille:offres': { 'epic:a': offer({ end: T + DAY }) } });
  const avant = journal.filter((e) => e.op === 'set').length;

  await pruneNow({ chrome, now: T });
  const apres = journal.filter((e) => e.op === 'set').length;
  assert.equal(apres, avant, 'une ecriture inutile est une occasion de course pour rien');
});

/* ------------------------------------------------------- reclamer tout */

test('sans candidat, la reclamation groupee ne fait rien et le dit', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ 'veille:offres': {} });

  const out = await claimAllNow({ chrome, now: T, claimableStores: ['epic', 'gog', 'amazon'] });
  assert.equal(out.claimed, 0);
  assert.equal(out.left, 0);
  assert.deepEqual(out.claims, []);
});

test('une offre deja possedee n\'est pas candidate', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': { 'epic:possedee': offer({ end: T + DAY, alreadyOwned: true }) },
  });

  const out = await claimAllNow({ chrome, now: T, claimableStores: ['epic'] });
  assert.equal(out.claims.length, 0, 'reclamer un jeu deja acquis consomme un quota pour rien');
});

test('un magasin sans module de reclamation n\'est pas candidat', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:offres': {
      'steam:1382330': offer({ store: 'steam', end: T + DAY, url: 'https://store.steampowered.com/app/1382330' }),
    },
  });

  // Steam n'est jamais dans la liste : detecte, affiche, jamais clique.
  const out = await claimAllNow({ chrome, now: T, claimableStores: ['epic', 'gog', 'amazon'] });
  assert.equal(out.claims.length, 0);
});
