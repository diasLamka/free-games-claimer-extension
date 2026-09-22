/* Agir depuis la notification.
 *
 * Le canal qui joint l'utilisateur le plus souvent ne servait qu'a informer.
 * Le service worker ne construisait que des notifications de type « basic »,
 * sans boutons, et aucun `onButtonClicked` n'etait enregistre.
 *
 * Deux obstacles reels, et ce fichier tient les deux.
 *
 * LA MEMOIRE. La table retenue ne gardait qu'un couple identifiant -> URL.
 * Rien ne savait donc sur QUELLE offre agir des heures plus tard -- et des
 * heures plus tard est le cas normal : le service worker meurt trente secondes
 * apres le dernier evenement, et le clic arrive quand l'utilisateur revient.
 *
 * FIREFOX. Son implementation des notifications ignore les boutons et rejette
 * la creation qui en porte. Une extension qui n'affiche plus AUCUNE
 * notification sur Firefox serait un prix absurde pour deux boutons sur
 * Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  ACTIONS, NOTICE, actionAt, buttonsFor,
} from '../watch/notify-actions.js';
import { rememberNotification, readNotification } from '../watch/storage.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

/* --------------------------------------------------------- quels boutons */

test('une offre annoncee propose de la prendre ou de la reporter', () => {
  const b = buttonsFor(NOTICE.OFFER);

  assert.equal(b.length, 2, 'Chrome n\'en affiche jamais plus de deux');
  assert.deepEqual(b.map((x) => x.action), [ACTIONS.CLAIM, ACTIONS.SNOOZE]);
});

test('un rappel de fin proche ne propose pas de reporter', () => {
  /* Reporter une offre qui se termine dans six heures, c'est la refuser en
     croyant gagner du temps. Le bouton absent est un bouton qui ne peut pas
     couter un jeu. */
  const b = buttonsFor(NOTICE.REMINDER);

  assert.deepEqual(b.map((x) => x.action), [ACTIONS.CLAIM]);
});

test('un incident mene a ce qui l\'explique, et rien de plus', () => {
  /* Le chien de garde aboie, il ne repare pas. Un bouton « reparer » sur une
     panne dont on ne connait pas la cause serait un mensonge. */
  const b = buttonsFor(NOTICE.INCIDENT);

  assert.deepEqual(b.map((x) => x.action), [ACTIONS.JOURNAL]);
});

test('un genre inconnu ne propose rien plutot que de deviner', () => {
  assert.deepEqual(buttonsFor('quelque-chose'), []);
});

/* ------------------------------------------------- de l'index a l'action */

test('l\'index rendu par le navigateur se traduit en action', () => {
  /* `onButtonClicked` ne rend qu'un NUMERO. Sans cette table, le second bouton
     d'un rappel declencherait l'action du second bouton d'une annonce -- donc
     une mise en pause au lieu d'une reclamation, sur la notification meme qui
     dit que l'offre se termine. */
  assert.equal(actionAt(NOTICE.OFFER, 0), ACTIONS.CLAIM);
  assert.equal(actionAt(NOTICE.OFFER, 1), ACTIONS.SNOOZE);
  assert.equal(actionAt(NOTICE.REMINDER, 0), ACTIONS.CLAIM);
});

test('un index hors de la liste ne declenche rien', () => {
  assert.equal(actionAt(NOTICE.REMINDER, 1), null);
  assert.equal(actionAt(NOTICE.OFFER, 7), null);
  assert.equal(actionAt(NOTICE.INCIDENT, -1), null);
});

/* ------------------------------------------------------------- la memoire */

test('ce qu\'une notification retient suffit a agir des heures plus tard', async () => {
  const faux = fakeChrome({ now: T });

  await rememberNotification(faux.chrome, 'veille-1', {
    url: 'https://store.epicgames.com/p/jeu',
    catalogKey: 'epic:jeu',
    kind: NOTICE.OFFER,
  });

  const lu = await readNotification(faux.chrome, 'veille-1');
  assert.equal(lu.url, 'https://store.epicgames.com/p/jeu');
  assert.equal(lu.catalogKey, 'epic:jeu');
  assert.equal(lu.kind, NOTICE.OFFER);
});

test('une notification inconnue se lit sans exploser', async () => {
  const faux = fakeChrome({ now: T });
  assert.equal(await readNotification(faux.chrome, 'jamais-vue'), null);
});

test('les entrees ecrites avant la 2.30.0 restent lisibles', async () => {
  /* Elles ne portaient qu'une chaine. Les ignorer ferait que le premier clic
     apres une mise a jour retombe sur le popup au lieu de l'offre -- un bug
     minuscule, une seule fois, et parfaitement evitable. */
  const faux = fakeChrome({ now: T });
  const zone = faux.chrome.storage.session || faux.chrome.storage.local;
  await zone.set({ 'veille:liens-notifications': { vieille: 'https://www.gog.com/game/x' } });

  const lu = await readNotification(faux.chrome, 'vieille');
  assert.equal(lu.url, 'https://www.gog.com/game/x');
  assert.equal(lu.catalogKey, null);
});

test('la table ne grossit pas indefiniment', async () => {
  const faux = fakeChrome({ now: T });

  for (let i = 0; i < 60; i++) {
    await rememberNotification(faux.chrome, `n-${i}`, { url: `https://x/${i}` });
  }

  const zone = faux.chrome.storage.session || faux.chrome.storage.local;
  const { 'veille:liens-notifications': table } = await zone.get('veille:liens-notifications');
  assert.ok(Object.keys(table).length <= 30, 'plafond tenu');
  assert.ok(table['n-59'], 'la plus recente est gardee');
  assert.ok(!table['n-0'], 'la plus ancienne est partie');
});

test('une notification sans rien a retenir n\'ecrit rien', async () => {
  /* Le chien de garde en envoie sans URL ni offre. Ecrire une entree vide
     consommerait une place du plafond et chasserait un lien utile. */
  const faux = fakeChrome({ now: T });

  await rememberNotification(faux.chrome, 'vide', {});

  assert.equal(await readNotification(faux.chrome, 'vide'), null);
});
