/* Le backlog : la premiere donnee de l'extension qui vienne de l'utilisateur.
 *
 * Tout ce que l'extension savait venait des magasins ou du moteur. L'inventaire
 * complet des cles `veille:` ne contenait rien de personnel : la page Ma
 * collection savait filtrer, trier et poser un lien de lancement, mais aucune
 * donnee produite par l'utilisateur ne s'y accrochait.
 *
 * Elle cesse donc d'etre un inventaire pour devenir un outil de gestion :
 * savoir ce qui n'a jamais ete lance, poser une note, et tirer un jeu au hasard
 * parmi ceux qu'on voulait essayer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_ANNOTATIONS, STATUS, annotationKey, countByStatus, pickToTry,
  readAnnotation, setNote, setStatus,
} from '../watch/annotations.js';

/* ------------------------------------------------------------- l'identite */

test('la cle vit dans l\'espace de la veille', () => {
  assert.ok(KEY_ANNOTATIONS.startsWith('veille:'));
});

test('une annotation est accrochee au magasin ET a l\'identifiant', () => {
  /* Meme regle que le registre d'acquisitions : le meme jeu possede sur Epic
     et sur GOG est deux entrees, parce qu'on peut l'avoir joue sur l'un et pas
     sur l'autre. */
  assert.equal(annotationKey('gog', '1207658930'), 'gog:1207658930');
  assert.notEqual(annotationKey('epic', 'x'), annotationKey('gog', 'x'));
});

/* -------------------------------------------------------------- l'etat */

test('un jeu sans annotation a un etat par defaut, jamais undefined', () => {
  /* La page affiche cet etat pour CHAQUE ligne de la collection, et la
     collection compte des centaines de jeux dont aucun n'a ete annote. Rendre
     undefined obligerait chaque appelant a s'en souvenir. */
  const a = readAnnotation({}, 'gog:x');

  assert.equal(a.status, STATUS.NONE);
  assert.equal(a.note, '');
});

test('poser un etat, puis le changer', () => {
  let t = setStatus({}, 'gog:x', STATUS.TO_TRY);
  assert.equal(readAnnotation(t, 'gog:x').status, STATUS.TO_TRY);

  t = setStatus(t, 'gog:x', STATUS.DONE);
  assert.equal(readAnnotation(t, 'gog:x').status, STATUS.DONE);
});

test('un etat inconnu est refuse plutot qu\'ecrit', () => {
  /* Un etat invente ne casserait rien a l'ecriture, et casserait tous les
     comptes et tous les filtres a la lecture -- sans jamais lever d'erreur. */
  const t = setStatus({}, 'gog:x', 'en-cours-de-reflexion');

  assert.equal(readAnnotation(t, 'gog:x').status, STATUS.NONE);
});

test('revenir a l\'etat par defaut efface l\'entree', () => {
  /* Une entree qui ne dit plus rien coute une ligne de stockage et fausse le
     compte de « jeux annotes ». */
  const t = setStatus(setStatus({}, 'gog:x', STATUS.DONE), 'gog:x', STATUS.NONE);

  assert.deepEqual(t, {});
});

/* -------------------------------------------------------------- la note */

test('une note se pose et se relit telle quelle', () => {
  const t = setNote({}, 'gog:x', '  a finir avant la suite  ');

  assert.equal(readAnnotation(t, 'gog:x').note, 'a finir avant la suite');
});

test('une note vide efface l\'entree si rien d\'autre ne la retient', () => {
  const t = setNote(setNote({}, 'gog:x', 'bof'), 'gog:x', '');

  assert.deepEqual(t, {});
});

test('effacer la note ne touche pas a l\'etat', () => {
  const t = setNote(setStatus({}, 'gog:x', STATUS.PLAYING), 'gog:x', '');

  assert.equal(readAnnotation(t, 'gog:x').status, STATUS.PLAYING);
});

test('une note trop longue est coupee, pas refusee', () => {
  /* Refuser ferait perdre ce qui a ete tape. Couper garde l'essentiel, et la
     borne protege un stockage partage avec le catalogue et les codes. */
  const t = setNote({}, 'gog:x', 'x'.repeat(5000));

  assert.ok(readAnnotation(t, 'gog:x').note.length < 5000);
  assert.ok(readAnnotation(t, 'gog:x').note.length > 100);
});

/* ------------------------------------------------------------- les comptes */

test('le compte par etat ignore ce qui n\'est pas annote', () => {
  let t = setStatus({}, 'a:1', STATUS.TO_TRY);
  t = setStatus(t, 'b:2', STATUS.TO_TRY);
  t = setStatus(t, 'c:3', STATUS.DONE);

  const n = countByStatus(t);
  assert.equal(n[STATUS.TO_TRY], 2);
  assert.equal(n[STATUS.DONE], 1);
  assert.equal(n[STATUS.PLAYING] || 0, 0);
});

/* ------------------------------------------------------------- le tirage */

test('le tirage ne sort que des jeux a essayer', () => {
  let t = setStatus({}, 'a:1', STATUS.TO_TRY);
  t = setStatus(t, 'b:2', STATUS.DONE);

  const tire = pickToTry(['a:1', 'b:2'], t, () => 0.99);

  assert.equal(tire, 'a:1', 'le seul candidat, quel que soit le hasard');
});

test('le tirage rend null quand il n\'y a rien a essayer', () => {
  /* Rendre un jeu au hasard parmi RIEN ferait proposer un jeu fini, ce qui est
     exactement le contraire du service rendu. */
  assert.equal(pickToTry(['a:1'], setStatus({}, 'a:1', STATUS.DONE), () => 0), null);
});

test('le tirage se sert vraiment du hasard qu\'on lui donne', () => {
  /* Le hasard est injecte pour que ce test existe. Un Math.random en dur
     rendrait la fonction intestable, et une fonction de tirage non testee
     finit toujours par rendre le premier element. */
  let t = setStatus({}, 'a:1', STATUS.TO_TRY);
  t = setStatus(t, 'b:2', STATUS.TO_TRY);
  t = setStatus(t, 'c:3', STATUS.TO_TRY);

  assert.equal(pickToTry(['a:1', 'b:2', 'c:3'], t, () => 0), 'a:1');
  assert.equal(pickToTry(['a:1', 'b:2', 'c:3'], t, () => 0.5), 'b:2');
  assert.equal(pickToTry(['a:1', 'b:2', 'c:3'], t, () => 0.99), 'c:3');
});
