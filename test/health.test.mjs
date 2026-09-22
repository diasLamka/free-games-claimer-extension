/* Le tour d'inspection : ce qui se passe quand personne ne regarde.
 *
 * Ce fichier existe pour une raison precise, et c'est la meme que celle qui a
 * fait sortir ce code de background.js : le detecteur de veille arretee ne
 * peut pas etre teste depuis un cycle, puisque son sujet est justement
 * l'absence de cycle. Il lui faut un point d'entree a lui, jouable sans rien
 * demarrer.
 *
 * Conception : docs/superpowers/specs/2026-09-22-chien-de-garde-design.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import { inspectHealth } from '../watch/health.js';
import { KEY_INCIDENTS, KINDS } from '../watch/incidents.js';
import { KEYS, DEFAULT_SETTINGS } from '../watch/storage.js';
import { ALERTS } from '../watch/notify-policy.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const HEURE = 3600000;
const JOUR = 24 * HEURE;

/** Un poste ou la veille s'est tue il y a deux jours. */
async function poste({ settings = {}, state, permissionLevel = 'granted' } = {}) {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...settings },
    [KEYS.STATE]: state === undefined
      ? { booted: true, lastCycle: T - 2 * JOUR, nextCycle: T - 2 * JOUR + 8 * HEURE, unseen: 4 }
      : state,
  });

  const envoyees = [];
  const badges = [];

  const tour = (now = T) => inspectHealth({
    chrome: faux.chrome,
    now,
    permissionLevel,
    notify: async (n) => { envoyees.push(n); },
    setBadge: async (b) => { badges.push(b); },
    record: () => {},
  });

  return { faux, envoyees, badges, tour };
}

/* ------------------------------------------- la panne qui n'avait pas de voix */

test('une veille arretee est vue et dite, sans qu\'aucun cycle n\'ait tourne', async () => {
  /* C'est la raison d'etre du lot. Rien ici ne demarre de cycle : on ne lit
     que de l'etat persiste, ce qui est la seule facon de voir une veille
     morte. */
  const p = await poste();

  const r = await p.tour();

  assert.equal(r.opened.length, 1);
  assert.equal(r.opened[0].kind, KINDS.STALLED);
  assert.equal(p.envoyees.length, 1, 'une notification est partie');
  assert.match(p.envoyees[0].message, /cycle/);
});

test('une veille a l\'heure ne dit rien du tout', async () => {
  const p = await poste({
    state: { booted: true, lastCycle: T - HEURE, nextCycle: T + 7 * HEURE, unseen: 0 },
  });

  const r = await p.tour();

  assert.deepEqual(r.opened, []);
  assert.deepEqual(p.envoyees, []);
});

test('l\'incident n\'est dit qu\'une fois, meme sur cinq tours', async () => {
  const p = await poste();

  for (let i = 0; i < 5; i++) await p.tour(T + i * HEURE);

  assert.equal(p.envoyees.length, 1, 'cinq tours, une notification');
});

test('l\'incident est persiste, pas recalcule a chaque reveil', async () => {
  /* Le service worker perd toute sa memoire entre deux reveils. Un compteur
     en variable ne survivrait pas, et l'alerte repartirait a chaque fois. */
  const p = await poste();
  await p.tour();

  const ecrit = p.faux.payload()[KEY_INCIDENTS];
  assert.ok(ecrit.stalled, 'l\'incident est sur le disque');
  assert.equal(ecrit.stalled.notifiedAt, T);
});

/* --------------------------------------------------------- le canal coupe */

test('permission refusee : aucune notification n\'est meme tentee', async () => {
  /* Envoyer une notification pour annoncer que les notifications sont
     bloquees serait absurde -- et, surtout, sans effet. */
  const p = await poste({ permissionLevel: 'denied' });

  const r = await p.tour();

  assert.deepEqual(p.envoyees, [], 'rien n\'est envoye');
  assert.ok(r.incidents.muted, 'l\'incident existe quand meme');
});

test('permission refusee : le badge prend le relais', async () => {
  const p = await poste({ permissionLevel: 'denied' });

  await p.tour();

  assert.equal(p.badges.at(-1).text, '!');
});

/* --------------------------------------------------- differer, ou se taire */

test('heures calmes : rien n\'est envoye, et rien n\'est perdu', async () => {
  /* La difference avec le mode coupe tient dans la seconde ligne : l'incident
     reste NON dit, donc il sera dit au matin. C'est la seule alerte qu'on
     aura jamais pour cette panne. */
  const p = await poste({
    settings: { quiet: { on: true, start: '23:00', end: '08:00' } },
  });

  const nuit = Date.UTC(2026, 8, 23, 2, 0, 0);
  const r = await p.tour(nuit);

  assert.deepEqual(p.envoyees, []);
  assert.equal(r.incidents.stalled.notifiedAt, null, 'on redira au matin');
});

test('alertes coupees : rien n\'est envoye, et rien ne s\'accumule', async () => {
  /* Difference exacte avec les heures calmes. L'utilisateur n'a pas demande
     un report, il a demande le silence : retenir ferait tout partir d'un coup
     le jour ou il rallume. */
  const p = await poste({ settings: { alertMode: ALERTS.OFF } });

  const r = await p.tour();

  assert.deepEqual(p.envoyees, []);
  assert.equal(r.incidents.stalled.notifiedAt, T, 'marque dit, sans l\'avoir dit');
});

test('qui avait coupe les notifications d\'offres ne recoit pas d\'alerte', async () => {
  /* La traduction unique de normaliseSettings, verifiee de bout en bout
     plutot qu'au seul niveau du reglage. */
  const p = await poste({ settings: { notifyMode: 'off', alertMode: undefined } });

  await p.tour();

  assert.deepEqual(p.envoyees, []);
});

/* ------------------------------------------------------------- la cloture */

test('un incident qui cesse disparait, en silence', async () => {
  const p = await poste();
  await p.tour();
  assert.equal(p.envoyees.length, 1);

  /* La veille repart : le tour suivant ne doit plus rien trouver, et ne doit
     surtout pas annoncer la bonne nouvelle. Un probleme resolu n'interrompt
     personne. */
  await p.faux.chrome.storage.local.set({
    [KEYS.STATE]: { booted: true, lastCycle: T + HEURE, nextCycle: T + 9 * HEURE, unseen: 4 },
  });
  const r = await p.tour(T + 2 * HEURE);

  assert.deepEqual(r.incidents, {});
  assert.equal(r.closed.length, 1);
  assert.equal(p.envoyees.length, 1, 'toujours une seule notification');
});

/* -------------------------------------------------------------- le badge */

test('sans incident, le badge rend le compte d\'offres non vues', async () => {
  const p = await poste({
    state: { booted: true, lastCycle: T - HEURE, nextCycle: T + 7 * HEURE, unseen: 4 },
  });

  await p.tour();

  assert.equal(p.badges.at(-1).text, '4');
});

test('ce qui attendait un canal bloque part des qu\'il rouvre', async () => {
  /* Le piege que ce test ferme : marquer « dit » une alerte envoyee vers un
     canal coupe la perdrait pour toujours -- y compris apres le retour de la
     permission, moment ou elle serait enfin utile. */
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
    [KEYS.STATE]: { booted: true, lastCycle: T - 2 * JOUR, nextCycle: T - 2 * JOUR + 8 * HEURE },
  });

  const envoyees = [];
  const tour = (permissionLevel, now) => inspectHealth({
    chrome: faux.chrome,
    now,
    permissionLevel,
    notify: async (n) => { envoyees.push(n); },
    setBadge: async () => {},
    record: () => {},
  });

  await tour('denied', T);
  assert.deepEqual(envoyees, [], 'canal coupe : rien ne part');

  await tour('granted', T + HEURE);
  assert.equal(envoyees.length, 1, 'le canal rouvre, l\'alerte part enfin');
});
