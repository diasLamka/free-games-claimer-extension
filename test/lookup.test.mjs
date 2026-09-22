/* La connaissance de l'extension sort du popup.
 *
 * Sur la fiche d'un jeu, l'extension ne disait rien. C'est pourtant la qu'on se
 * demande si on l'a deja, et depuis quand.
 *
 * Ce module repond a la question. Il n'affiche rien : il rend des FAITS, et la
 * page choisit ce qu'elle en montre. Melanger les deux empecherait de tester ce
 * qu'on sait sans monter un document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FACTS, lookup } from '../watch/lookup.js';
import { normaliseTitle } from '../watch/offer.js';
import { OUTCOMES } from '../watch/outcomes.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const JOUR = 86400000;

const base = { normalise: normaliseTitle, now: T };

/* --------------------------------------------------------------- possede */

test('le jeu possede se dit, avec ses magasins', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    collection: {
      'gog:1207': { store: 'gog', id: '1207', title: 'Tyranny' },
      'epic:tyranny': { store: 'epic', id: 'tyranny', title: 'Tyranny' },
    },
  });

  assert.deepEqual(f, [{ kind: FACTS.OWNED, stores: ['epic', 'gog'] }]);
});

test('le rapprochement tient malgre la casse et la ponctuation', () => {
  /* Les quatre magasins n'ecrivent pas les titres pareil. La normalisation est
     celle du modele d'offre, la seule avec laquelle ils se recoupent. */
  const f = lookup({
    ...base,
    title: 'HOLLOW KNIGHT: SILKSONG',
    collection: { 'gog:hk': { store: 'gog', id: 'hk', title: 'Hollow Knight Silksong' } },
  });

  assert.equal(f[0].kind, FACTS.OWNED);
});

/* ------------------------------------------------------------ offert maintenant */

test('une offre en cours sur un AUTRE magasin est dite', () => {
  /* C'est precisement ce qu'on ne peut pas voir soi-meme en regardant une
     fiche Steam : que le meme jeu est gratuit chez GOG aujourd'hui. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    store: 'steam',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: T + JOUR, url: 'https://www.gog.com/x' } },
  });

  assert.equal(f[0].kind, FACTS.FREE_NOW);
  assert.equal(f[0].store, 'gog');
  assert.equal(f[0].url, 'https://www.gog.com/x');
});

test('une offre terminee ne se dit pas comme une offre en cours', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: T - JOUR } },
  });

  assert.deepEqual(f, []);
});

test('une offre sans date de fin reste une offre en cours', () => {
  /* Huit offres sur vingt n'ont pas de date chez l'agregateur. Les taire
     serait pire que les annoncer -- meme regle que l'annonce. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: null } },
  });

  assert.equal(f[0].kind, FACTS.FREE_NOW);
});

/* ---------------------------------------------------------------- reclame */

test('une acquisition par l\'extension se dit, avec sa date', () => {
  /* La date vient du registre, qui n'est JAMAIS purge -- contrairement au
     catalogue, vide a quatre-vingt-dix jours. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    library: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T - 300 * JOUR } },
  });

  assert.equal(f[0].kind, FACTS.CLAIMED);
  assert.equal(f[0].ts, T - 300 * JOUR);
});

/* ------------------------------------------------------------------ rate */

test('un jeu deja passe en offre et rate se dit', () => {
  /* Le seul fait qui puisse changer une decision d'ACHAT : ce jeu a deja ete
     offert, il peut l'etre encore. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    outcomes: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T - 60 * JOUR, outcome: OUTCOMES.MISSED } },
  });

  assert.equal(f[0].kind, FACTS.MISSED);
});

test('un jeu passe en offre et PRIS ne se dit pas comme rate', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    outcomes: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T, outcome: OUTCOMES.TAKEN } },
  });

  assert.deepEqual(f, []);
});

/* --------------------------------------------------------- rien a dire */

test('un titre inconnu ne produit aucun fait', () => {
  /* Le cas de l'immense majorite des fiches. La surcouche ne doit alors rien
     afficher du tout : un bandeau vide sur chaque page de magasin serait une
     nuisance permanente. */
  assert.deepEqual(lookup({ ...base, title: 'Un jeu jamais vu' }), []);
});

test('un titre vide ne produit aucun fait', () => {
  assert.deepEqual(lookup({ ...base, title: '' }), []);
  assert.deepEqual(lookup({ ...base, title: null }), []);
});

/* ------------------------------------------------------------ dedoublonnage */

test('le meme fait n\'est jamais dit deux fois', () => {
  /* Le catalogue porte la meme offre sous deux cles, forte et faible. Afficher
     deux fois « offert sur GOG » ferait douter de tout le reste. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: {
      'gog:1207': { title: 'Tyranny', store: 'gog', end: T + JOUR },
      'gog:tyranny': { title: 'Tyranny', store: 'gog', end: T + JOUR },
    },
  });

  assert.equal(f.length, 1);
});

test('deux magasins differents restent deux faits', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: {
      a: { title: 'Tyranny', store: 'gog', end: T + JOUR },
      b: { title: 'Tyranny', store: 'epic', end: T + JOUR },
    },
  });

  assert.equal(f.length, 2);
});

/* ------------------------------------------------------- les obligations */

test('la normalisation et l\'instant sont obligatoires', () => {
  /* Meme regle que partout ailleurs dans la veille : un module pur ne fait
     entrer ni l'horloge ni une comparaison approximative par la fenetre. */
  assert.throws(() => lookup({ title: 'x', now: T }), TypeError);
  assert.throws(() => lookup({ title: 'x', normalise: normaliseTitle }), TypeError);
});
