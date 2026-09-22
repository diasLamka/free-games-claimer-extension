/* Ce qui revient, et pourquoi le chiffre doit etre juste.
 *
 * C'est le seul signal de l'extension qui puisse changer une decision d'ACHAT.
 * Quelqu'un va s'appuyer dessus pour NE PAS acheter un jeu a vingt euros : un
 * compte gonfle par un doublon lui ferait attendre une offre qui ne reviendra
 * pas.
 *
 * La source a ete choisie apres mesure. L'agregateur public n'expose que les
 * offres ACTIVES -- verifie le 2026-09-22, seul statut present : « Active ».
 * Aucune archive n'existe, donc l'histoire vient de ce que l'extension a
 * elle-meme observe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECURRENT_AFTER, recurrenceFor, recurrenceIndex, recurring,
} from '../watch/recurrence.js';
import { normaliseTitle } from '../watch/offer.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const JOUR = 86400000;

const index = (parts) => recurrenceIndex({ ...parts, normalise: normaliseTitle });

/* -------------------------------------------------- les deux sources */

test('le registre des acquisitions compte, et il ne se purge jamais', () => {
  const i = index({ library: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T - 400 * JOUR } } });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).count, 1);
});

test('les issues comptent aussi, y compris ce qui a ete RATE', () => {
  /* Le registre ne sait que ce qui a ete pris. Une offre manquee est pourtant
     la preuve la plus directe que le jeu passe en offre. */
  const i = index({
    outcomes: { 'epic:t': { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' } },
  });

  const e = recurrenceFor(i, 'Tyranny', normaliseTitle);
  assert.equal(e.count, 1);
  assert.equal(e.passes[0].taken, false);
});

test('les deux sources se fusionnent, elles ne se choisissent pas', () => {
  const i = index({
    library: { a: { title: 'Tyranny', store: 'gog', ts: T - 400 * JOUR } },
    outcomes: { b: { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' } },
  });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).count, 2);
});

/* --------------------------------------------- le doublon, et ce qu'il coute */

test('le MEME passage vu par les deux sources ne compte qu\'une fois', () => {
  /* Une offre reclamee est dans le registre ET dans les issues. Compter deux
     fois ferait croire a une recurrence qui n'existe pas -- et ce chiffre est
     precisement celui sur lequel quelqu'un va s'appuyer pour ne pas acheter. */
  const i = index({
    library: { a: { title: 'Tyranny', store: 'gog', ts: T } },
    outcomes: { b: { title: 'Tyranny', store: 'gog', ts: T + 3600000, outcome: 'taken' } },
  });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).count, 1);
});

test('le meme jeu sur DEUX magasins fait deux passages', () => {
  /* Posseder un jeu sur Epic ne le donne pas sur GOG, et les deux offres sont
     deux evenements distincts. */
  const i = index({
    outcomes: {
      a: { title: 'Tyranny', store: 'gog', ts: T, outcome: 'missed' },
      b: { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' },
    },
  });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).count, 2);
});

test('le meme magasin a deux ANNEES d\'ecart fait bien deux passages', () => {
  /* C'est exactement le cas qui interesse : Epic reoffre. Confondre les deux
     par un dedoublonnage trop large detruirait le signal entier. */
  const i = index({
    outcomes: {
      a: { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' },
      b: { title: 'Tyranny', store: 'epic', ts: T - 500 * JOUR, outcome: 'missed' },
    },
  });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).count, 2);
});

/* ------------------------------------------------------ le rapprochement */

test('la casse et la ponctuation ne font pas deux jeux', () => {
  const i = index({
    library: { a: { title: 'Hollow Knight: Silksong', store: 'gog', ts: T - 400 * JOUR } },
    outcomes: { b: { title: 'HOLLOW KNIGHT SILKSONG', store: 'epic', ts: T, outcome: 'missed' } },
  });

  assert.equal(recurrenceFor(i, 'hollow knight silksong', normaliseTitle).count, 2);
});

/* ------------------------------------------------------------- la lecture */

test('un titre jamais vu rend null, pas une entree a zero', () => {
  /* « Jamais vu » et « vu une fois » ne se disent pas pareil. Une entree vide
     ferait afficher un bandeau qui n'apprend rien. */
  assert.equal(recurrenceFor(index({}), 'Un jeu inconnu', normaliseTitle), null);
});

test('les passages sont rendus du plus recent au plus ancien', () => {
  const i = index({
    outcomes: {
      a: { title: 'Tyranny', store: 'gog', ts: T - 400 * JOUR, outcome: 'missed' },
      b: { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' },
    },
  });

  assert.equal(recurrenceFor(i, 'Tyranny', normaliseTitle).passes[0].store, 'epic');
});

/* ------------------------------------------------------ ce qui revient */

test('un jeu vu deux fois revient, un jeu vu une fois non', () => {
  /* Deux passages et non trois : un jeu vu deux fois est deja un jeu qu'on
     peut attendre, et exiger trois rendrait le signal inutilisable pendant des
     annees vu la profondeur reelle des donnees. */
  assert.equal(RECURRENT_AFTER, 2);

  const i = index({
    outcomes: {
      a: { title: 'Tyranny', store: 'gog', ts: T - 400 * JOUR, outcome: 'missed' },
      b: { title: 'Tyranny', store: 'epic', ts: T, outcome: 'missed' },
      c: { title: 'Autre jeu', store: 'gog', ts: T, outcome: 'missed' },
    },
  });

  assert.deepEqual(recurring(i).map((e) => e.title), ['Tyranny']);
});

test('les plus frequents passent devant', () => {
  const i = index({
    outcomes: {
      a: { title: 'Deux fois', store: 'gog', ts: T - 400 * JOUR, outcome: 'missed' },
      b: { title: 'Deux fois', store: 'epic', ts: T, outcome: 'missed' },
      c: { title: 'Trois fois', store: 'gog', ts: T - 500 * JOUR, outcome: 'missed' },
      d: { title: 'Trois fois', store: 'epic', ts: T - 300 * JOUR, outcome: 'missed' },
      e: { title: 'Trois fois', store: 'amazon', ts: T, outcome: 'missed' },
    },
  });

  assert.deepEqual(recurring(i).map((e) => e.title), ['Trois fois', 'Deux fois']);
});

test('la normalisation est obligatoire', () => {
  assert.throws(() => recurrenceIndex({ outcomes: {} }), TypeError);
});
