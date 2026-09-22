/* La file de reclamation, rendue pilotable.
 *
 * « Tout recuperer » existait avec exactement les bonnes garanties -- memes
 * filtres, meme canari, meme registre, meme plafond horaire -- mais il ne
 * s'affichait qu'a partir de deux offres et prenait TOUT. Entre les deux, rien.
 *
 * Trois manques, tous verifies dans le code avant d'etre combles :
 *
 *  1. Aucun moyen de dire « celle-ci, maintenant ». La table `UI_COMMANDS` de
 *     watch/messaging.js est fermee et ne portait aucune commande a l'unite.
 *  2. L'epinglage etait purement decoratif : il vivait dans `veille:ui`, que
 *     le service worker ne lit jamais, et `claimCandidates` triait sur la
 *     seule urgence.
 *  3. Aucun moyen de dire « plus tard ». Le seul geste de mise a l'ecart etait
 *     la croix, qui exclut le TITRE pour toujours -- un bannissement la ou on
 *     voulait un report.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import { claimOneNow, prioritise, snooze, SNOOZE_MS } from '../watch/commands.js';
import { claimCandidates } from '../watch/cycle.js';
import { byUrgency, makeOffer, STATES, STORES } from '../watch/offer.js';
import { UI_COMMANDS } from '../watch/messaging.js';
import { KEYS, DEFAULT_SETTINGS } from '../watch/storage.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const HEURE = 3600000;
const JOUR = 24 * HEURE;

function offre({ end, ...over } = {}) {
  /* La date de fin passe par makeOffer, jamais par-dessus : le modele la lit
     en nombre, et une surcharge naive y remettrait la chaine ISO -- apres quoi
     l'urgence compare des textes, sans rien signaler. */
  return {
    ...makeOffer({
      source: 'epic-api',
      store: STORES.EPIC,
      storeId: over.storeId || 'jeu',
      title: over.title || 'Un jeu',
      url: 'https://store.epicgames.com/p/jeu',
      end: end || new Date(T + 3 * JOUR).toISOString(),
      seenAt: T - JOUR,
    }),
    catalogKey: over.catalogKey || 'epic:jeu',
    ...over,
  };
}

/* ------------------------------------------------------- « celle-ci, maintenant » */

test('la commande a l\'unite est inscrite au contrat du worker', () => {
  /* `messageAllowed` refuse tout type absent de la table : une branche ajoutee
     sans y etre inscrite echoue bruyamment en test plutot que de passer en
     silence en production. C'est ce qui rend cette assertion utile. */
  assert.ok(UI_COMMANDS.includes('fgc-claim-one'));
  assert.ok(UI_COMMANDS.includes('fgc-prioritise'));
  assert.ok(UI_COMMANDS.includes('fgc-snooze'));
});

/* --------------------------------------------------------------- priorite */

test('une offre prioritaire passe devant, meme moins urgente', () => {
  const urgente = offre({ catalogKey: 'a', storeId: 'a', end: new Date(T + HEURE).toISOString() });
  const choisie = offre({
    catalogKey: 'b', storeId: 'b', end: new Date(T + 5 * JOUR).toISOString(), priority: true,
  });

  const ordre = byUrgency([urgente, choisie], T).map((o) => o.catalogKey);

  assert.deepEqual(ordre, ['b', 'a']);
});

test('a priorite egale, l\'urgence decide comme avant', () => {
  const tot = offre({ catalogKey: 'a', storeId: 'a', end: new Date(T + HEURE).toISOString() });
  const tard = offre({ catalogKey: 'b', storeId: 'b', end: new Date(T + 5 * JOUR).toISOString() });

  assert.deepEqual(byUrgency([tard, tot], T).map((o) => o.catalogKey), ['a', 'b']);
});

test('la priorite s\'ecrit sur le CATALOGUE, pas dans les preferences d\'affichage', async () => {
  /* L'epinglage vivait dans `veille:ui`, que le service worker ne lit jamais :
     il ordonnait la liste et ne changeait rien a ce qui etait reclame en
     premier. Une etoile qui ne fait rien est pire qu'une etoile absente. */
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.OFFERS]: { 'epic:jeu': offre() } });

  await prioritise({ chrome: faux.chrome, catalogKey: 'epic:jeu', on: true, now: T });

  assert.equal(faux.payload()[KEYS.OFFERS]['epic:jeu'].priority, true);
});

test('retirer la priorite la retire vraiment', async () => {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.OFFERS]: { 'epic:jeu': offre({ priority: true }) },
  });

  await prioritise({ chrome: faux.chrome, catalogKey: 'epic:jeu', on: false, now: T });

  assert.equal(faux.payload()[KEYS.OFFERS]['epic:jeu'].priority, false);
});

/* ------------------------------------------------------------- « plus tard » */

test('une offre mise en pause n\'est plus candidate', () => {
  const r = claimCandidates(
    { 'epic:jeu': offre({ snoozedUntil: T + HEURE }) },
    {},
    { claimableStores: [STORES.EPIC], now: T },
  );

  assert.deepEqual(r.candidates, []);
});

test('la pause expire d\'elle-meme', () => {
  /* Difference exacte avec la croix, qui exclut le titre POUR TOUJOURS. Ici
     l'offre revient seule : c'est un report, pas un bannissement. */
  const r = claimCandidates(
    { 'epic:jeu': offre({ snoozedUntil: T - 1 }) },
    {},
    { claimableStores: [STORES.EPIC], now: T },
  );

  assert.equal(r.candidates.length, 1);
});

test('mettre en pause ecrit une echeance, pas un drapeau', async () => {
  /* Un booleen demanderait a quelqu'un de penser a le retirer. Une echeance se
     perime toute seule, ce qui est la seule forme de report qui ne s'oublie
     pas. */
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.OFFERS]: { 'epic:jeu': offre() } });

  await snooze({ chrome: faux.chrome, catalogKey: 'epic:jeu', now: T });

  assert.equal(faux.payload()[KEYS.OFFERS]['epic:jeu'].snoozedUntil, T + SNOOZE_MS);
});

test('une pause ne survit jamais a la fin de l\'offre', async () => {
  /* Reporter au-dela de la date de fin reviendrait a refuser l'offre en
     croyant la remettre a plus tard. La pause est bornee par l'echeance. */
  const faux = fakeChrome({ now: T });
  const courte = offre({ end: new Date(T + HEURE).toISOString() });
  await faux.chrome.storage.local.set({ [KEYS.OFFERS]: { 'epic:jeu': courte } });

  await snooze({ chrome: faux.chrome, catalogKey: 'epic:jeu', now: T });

  const ecrit = faux.payload()[KEYS.OFFERS]['epic:jeu'];
  assert.ok(ecrit.snoozedUntil < courte.end, 'la pause s\'arrete avant la fin');
});

/* ----------------------------------------------------- reclamer celle-ci */

test('reclamer une seule offre ne touche pas aux autres', async () => {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
    [KEYS.OFFERS]: {
      'epic:un': offre({ catalogKey: 'epic:un', storeId: 'un', title: 'Un' }),
      'epic:deux': offre({ catalogKey: 'epic:deux', storeId: 'deux', title: 'Deux' }),
    },
  });

  const vues = [];
  const r = await claimOneNow({
    chrome: faux.chrome,
    catalogKey: 'epic:un',
    now: T,
    claimableStores: [STORES.EPIC],
    claim: async (offer) => { vues.push(offer.catalogKey); return { verdict: 'claimed' }; },
  });

  assert.deepEqual(vues, ['epic:un'], 'une seule offre tentee');
  assert.equal(r.claimed, 1);
});

test('reclamer une offre inconnue echoue proprement', async () => {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS }, [KEYS.OFFERS]: {} });

  const r = await claimOneNow({
    chrome: faux.chrome, catalogKey: 'epic:fantome', now: T, claimableStores: [STORES.EPIC],
  });

  assert.equal(r.claimed, 0);
  assert.equal(r.reason, 'unknown');
});

test('l\'arret d\'urgence prime sur un clic a l\'unite', async () => {
  /* Le bouton est nouveau ; l'arret d'urgence est la promesse la plus forte de
     l'extension. Un chemin neuf qui l'ignorerait la viderait de son sens. */
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    FGC_kill_switch: true,
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
    [KEYS.OFFERS]: { 'epic:jeu': offre() },
  });

  const vues = [];
  const r = await claimOneNow({
    chrome: faux.chrome,
    catalogKey: 'epic:jeu',
    now: T,
    claimableStores: [STORES.EPIC],
    claim: async (o) => { vues.push(o.catalogKey); return { verdict: 'claimed' }; },
  });

  assert.equal(r.stopped, true);
  assert.deepEqual(vues, [], 'rien n\'a ete tente');
});

test('une offre mise en pause se reclame quand meme si on la demande', async () => {
  /* Le report est une consigne pour la reclamation AUTOMATIQUE. Un clic
     explicite est plus recent que la pause, et lui obeir contre son auteur
     serait absurde. */
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS },
    [KEYS.OFFERS]: { 'epic:jeu': offre({ snoozedUntil: T + 5 * HEURE }) },
  });

  const vues = [];
  await claimOneNow({
    chrome: faux.chrome,
    catalogKey: 'epic:jeu',
    now: T,
    claimableStores: [STORES.EPIC],
    claim: async (o) => { vues.push(o.catalogKey); return { verdict: 'claimed' }; },
  });

  assert.deepEqual(vues, ['epic:jeu']);
});
