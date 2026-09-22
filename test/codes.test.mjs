/* Le coffre a cles : une seule table de destinations, deux implementations.
 *
 * La destination d'un code se decidait par un ternaire binaire -- GOG d'un
 * cote, l'URL Microsoft pour TOUT le reste -- ecrit en double, dans le moteur
 * et dans le popup. Sept magasins que Luna sait distribuer recevaient donc
 * l'adresse de Microsoft.
 *
 * La duplication entre `watch/codes.js` et `src/core/01-config.js` ne peut pas
 * disparaitre : le moteur est en ES5 concatene et tourne aussi en userscript,
 * sans modules. Ce fichier tient donc la meme promesse que
 * `test/locale.test.mjs` pour le pays -- les deux implementations rendent
 * EXACTEMENT la meme chose sur les memes entrees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';
import {
  AUTO_REDEEM_STORES, CODE_PATTERN, CODE_STATUS, REDEEM_URLS,
  addCodes, canAutoRedeem, codeStatus, parseCodes, redeemUrlFor, setCodeStatus,
} from '../watch/codes.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

/* ------------------------------------------------------------- la parite */

test('les deux tables de destinations sont identiques', () => {
  const { fgc } = loadEngine();

  for (const [store, url] of Object.entries(REDEEM_URLS)) {
    assert.equal(fgc.redeemUrlFor(store), url, `destination de ${store}`);
  }
});

test('le motif de code est le meme des deux cotes', () => {
  const { fgc } = loadEngine();

  /* Un motif qui diverge ferait accepter dans le popup un code que le moteur
     refuse, ou l'inverse -- et l'utilisateur n'aurait aucun moyen de savoir
     lequel des deux a raison. */
  assert.equal(CODE_PATTERN.source, fgc.redeemCodePattern().source);
});

/* -------------------------------------------------------- les destinations */

test('GOG et Microsoft ont leur adresse, les autres disent qu\'ils ne l\'ont pas', () => {
  assert.match(redeemUrlFor('gog'), /gog\.com\/redeem/);
  assert.match(redeemUrlFor('microsoft'), /account\.microsoft\.com/);

  /* `null` veut dire « pas mesure », pas « pas de page ». Inventer une adresse
     plausible couterait un onglet ouvert sur une erreur, et la confiance dans
     toutes les autres. */
  for (const store of ['epic', 'ubisoft', 'ea', 'blizzard', 'amazon', 'legacy']) {
    assert.equal(redeemUrlFor(store), null, store);
  }
});

test('un magasin inconnu ne recoit pas l\'adresse d\'un autre', () => {
  /* Le defaut etait l'URL Microsoft. Un code Ubisoft envoyait donc sur la page
     d'echange de Microsoft, qui le refuse. */
  assert.equal(redeemUrlFor('quelque-chose'), null);
  assert.equal(redeemUrlFor(undefined), null);
});

test('seul GOG s\'echange tout seul', () => {
  /* Le moteur a un parcours MESURE pour lui, et rien d'equivalent ailleurs. Un
     second parcours ne s'ecrit pas avant d'avoir mesure la page visee. */
  assert.deepEqual(AUTO_REDEEM_STORES, ['gog']);
  assert.equal(canAutoRedeem('gog'), true);
  assert.equal(canAutoRedeem('microsoft'), false);
});

/* ----------------------------------------------------------------- l'etat */

test('un code sans etat est en attente, jamais indefini', () => {
  assert.equal(codeStatus({}), CODE_STATUS.PENDING);
  assert.equal(codeStatus(null), CODE_STATUS.PENDING);
});

test('« echange » et « invalide » cessent de se ressembler', () => {
  /* Un code ne portait qu'un compteur d'essais : de quoi savoir qu'on avait
     essaye, jamais ce qui s'etait passe. L'un veut dire « c'est fait »,
     l'autre « celui-la ne servira plus jamais ». */
  const liste = [{ code: 'A-B', store: 'gog' }];

  assert.equal(codeStatus(setCodeStatus(liste, 'A-B', CODE_STATUS.REDEEMED, T)[0]), CODE_STATUS.REDEEMED);
  assert.equal(codeStatus(setCodeStatus(liste, 'A-B', CODE_STATUS.INVALID, T)[0]), CODE_STATUS.INVALID);
});

test('un etat inconnu laisse la liste intacte', () => {
  const liste = [{ code: 'A-B', status: CODE_STATUS.PENDING }];

  assert.deepEqual(setCodeStatus(liste, 'A-B', 'peut-etre', T), liste);
});

/* --------------------------------------------------------------- la saisie */

test('un code colle seul est reconnu', () => {
  assert.deepEqual(parseCodes('ABCDE-12345-FGHIJ'), ['ABCDE-12345-FGHIJ']);
});

test('les codes se retrouvent au milieu du bruit d\'un courriel', () => {
  /* Une liste collee porte des titres, des puces et des lignes vides. Demander
     a l'utilisateur de nettoyer ce qu'une expression reguliere sait ignorer
     serait lui faire faire le travail de la machine. */
  const colle = `Vos cles :
  - Tyranny : ABCDE-12345-FGHIJ
  - Cardpocalypse : ZZZZZ-99999-YYYYY

  Bonne partie !`;

  assert.deepEqual(parseCodes(colle).sort(), ['ABCDE-12345-FGHIJ', 'ZZZZZ-99999-YYYYY']);
});

test('un code colle en minuscules est accepte', () => {
  /* Le motif ne reconnait que les capitales. Refuser sans explication un code
     colle depuis un courriel en minuscules serait incomprehensible. */
  assert.deepEqual(parseCodes('abcde-12345-fghij'), ['ABCDE-12345-FGHIJ']);
});

test('un mot en capitales n\'est pas un code', () => {
  /* La condition « au moins un chiffre » du motif existe pour cela, et elle
     est recopiee a l'identique depuis le moteur. */
  assert.deepEqual(parseCodes('ATTENTION MERCI BEAUCOUP'), []);
});

test('le meme code colle deux fois n\'entre qu\'une fois', () => {
  assert.deepEqual(parseCodes('ABCDE-12345-FGHIJ ABCDE-12345-FGHIJ'), ['ABCDE-12345-FGHIJ']);
});

/* -------------------------------------------------------------- l'ajout */

test('ajouter ignore ce qui est deja la', () => {
  const avant = [{ code: 'A-1', store: 'gog' }];
  const apres = addCodes(avant, [{ code: 'A-1', store: 'gog' }, { code: 'B-2', store: 'epic' }]);

  assert.equal(apres.length, 2);
  assert.deepEqual(apres.map((c) => c.code), ['A-1', 'B-2']);
});

test('le dedoublonnage porte sur le code, pas sur le titre', () => {
  /* Le meme jeu peut donner deux cles, et deux cles differentes valent deux
     jeux. */
  const apres = addCodes([{ code: 'A-1', title: 'Tyranny' }], [{ code: 'B-2', title: 'Tyranny' }]);

  assert.equal(apres.length, 2);
});
