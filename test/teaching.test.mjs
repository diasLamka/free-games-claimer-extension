/* Apprendre un libelle a l'extension, sans lui apprendre a payer.
 *
 * Quand un magasin refait sa page, le moteur ne reconnait plus son bouton : le
 * canari compte les echecs, une alerte part, et ensuite plus rien. Il faut
 * attendre une version. Un claimer dans un conteneur attend, lui, une nouvelle
 * image.
 *
 * Ce que ce depot rend faisable et que les autres ne rendent pas : le moteur
 * ne reconnait PAS les boutons par leur forme dans le document, mais par leur
 * TEXTE. `lunaClaimLabelAllowed` et `gogSubmitLabelAllowed` sont deja des
 * listes blanches de libelles. Apprendre, c'est donc ajouter un mot a une
 * liste -- pas capturer un chemin CSS qui casserait au rendu suivant.
 *
 * TOUT LE DANGER EST LA. Un libelle appris trop large ferait cliquer un bouton
 * payant, sur un vrai compte, sans que personne ne l'ait demande. Ce fichier
 * teste d'abord ce qui doit etre REFUSE.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_TAUGHT, MAX_TAUGHT, SURFACES, forget, learn, taughtFor, wouldAccept,
} from '../watch/teaching.js';
import { loadEngine } from './harness.mjs';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);

/* ------------------------------------------------- ce qui doit etre refuse */

test('un libelle qui parle d\'argent est refuse, quelle que soit la langue', () => {
  /* La premiere ligne de defense, et la seule qui compte vraiment. Le moteur
     applique deja `looksPaid` a l'execution ; refuser des l'apprentissage
     evite qu'un libelle dangereux dorme dans le stockage en attendant une
     regression du second garde. */
  for (const mot of [
    'Acheter', 'Buy now', 'Ajouter au panier', 'Add to cart', 'Payer',
    'Checkout', 'Passer commande', 'Pre-order', 'Precommander', '19,99 EUR',
    'Purchase', 'Souscrire', 'Subscribe', 'S abonner',
  ]) {
    const r = learn({}, { surface: SURFACES.LUNA, label: mot, now: T });
    assert.equal(r.learned, false, `accepte a tort : ${mot}`);
    assert.ok(r.reason, 'un motif de refus, jamais un silence');
  }
});

test('un libelle vide ou minuscule est refuse', () => {
  /* Un libelle d'un caractere correspondrait a presque tout bouton dont le
     texte le contient, ce qui revient a autoriser le clic partout. */
  for (const mot of ['', '   ', 'a', 'ok', '!']) {
    assert.equal(learn({}, { surface: SURFACES.LUNA, label: mot, now: T }).learned, false, JSON.stringify(mot));
  }
});

test('un libelle demesure est refuse', () => {
  /* Coller une page entiere dans le champ ferait une expression qui ne
     matcherait jamais rien, et un utilisateur convaincu d'avoir repare
     quelque chose. */
  const r = learn({}, { surface: SURFACES.LUNA, label: 'x'.repeat(200), now: T });
  assert.equal(r.learned, false);
});

test('une surface inconnue est refusee', () => {
  /* Les deux seules surfaces qui existent sont celles dont le moteur lit la
     liste. Ecrire sous un autre nom produirait une entree que personne ne lit,
     donc un apprentissage qui ne repare rien sans le dire. */
  const r = learn({}, { surface: 'epic-checkout', label: 'Recuperer', now: T });
  assert.equal(r.learned, false);
});

/* ------------------------------------------------- ce qui doit etre accepte */

test('un libelle de reclamation ordinaire est appris', () => {
  const r = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir le jeu', now: T });

  assert.equal(r.learned, true);
  assert.deepEqual(taughtFor(r.taught, SURFACES.LUNA), ['obtenir le jeu']);
});

test('le libelle est range en minuscules et espaces normalises', () => {
  /* Le moteur compare sur un texte deja aplati : un libelle appris avec deux
     espaces ne matcherait jamais le bouton dont il vient. */
  const r = learn({}, { surface: SURFACES.LUNA, label: '  Obtenir   LE Jeu  ', now: T });

  assert.deepEqual(taughtFor(r.taught, SURFACES.LUNA), ['obtenir le jeu']);
});

test('apprendre deux fois le meme libelle ne le double pas', () => {
  let t = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir', now: T }).taught;
  t = learn(t, { surface: SURFACES.LUNA, label: 'OBTENIR', now: T }).taught;

  assert.equal(taughtFor(t, SURFACES.LUNA).length, 1);
});

test('les deux surfaces ne se melangent pas', () => {
  /* Un libelle appris pour l'echange GOG n'a rien a autoriser sur une page
     Luna : les deux parcours cliquent des choses differentes. */
  let t = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir', now: T }).taught;
  t = learn(t, { surface: SURFACES.GOG, label: 'Activer la cle', now: T }).taught;

  assert.deepEqual(taughtFor(t, SURFACES.LUNA), ['obtenir']);
  assert.deepEqual(taughtFor(t, SURFACES.GOG), ['activer la cle']);
});

test('un libelle s\'oublie', () => {
  /* Ce qui s'apprend se desapprend. Sans cela, un libelle appris par erreur
     resterait pour toujours, et la seule issue serait de tout effacer. */
  const t = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir', now: T }).taught;

  assert.deepEqual(taughtFor(forget(t, SURFACES.LUNA, 'OBTENIR'), SURFACES.LUNA), []);
});

/* ------------------------------------------------------------- le plafond */

test('la liste est bornee par surface', () => {
  /* Cent libelles autorises reviendraient a n'en autoriser aucun : la liste
     blanche cesserait d'etre une liste blanche. */
  let t = {};
  for (let i = 0; i < MAX_TAUGHT + 5; i++) {
    t = learn(t, { surface: SURFACES.LUNA, label: `Bouton numero ${i}`, now: T + i }).taught;
  }

  assert.equal(taughtFor(t, SURFACES.LUNA).length, MAX_TAUGHT);
});

/* ------------------------------------------------------------- l'essai */

test('on peut demander si un libelle SERAIT accepte, sans l\'apprendre', () => {
  /* L'interface doit pouvoir dire « celui-la, je ne peux pas » AVANT le clic
     de confirmation, plutot que d'accepter puis de refuser en silence. */
  assert.equal(wouldAccept(SURFACES.LUNA, 'Obtenir le jeu').ok, true);
  assert.equal(wouldAccept(SURFACES.LUNA, 'Acheter maintenant').ok, false);
  assert.ok(wouldAccept(SURFACES.LUNA, 'Acheter maintenant').reason);
});

test('l\'essai ne modifie rien', () => {
  const avant = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir', now: T }).taught;
  const copie = JSON.parse(JSON.stringify(avant));

  wouldAccept(SURFACES.LUNA, 'Acheter');

  assert.deepEqual(avant, copie);
});

test('la cle vit dans l\'espace du MOTEUR, pas dans celui de la veille', () => {
  /* C'est le moteur qui la lit, de facon synchrone, avant chaque clic. Il ne
     connait que l'espace FGC_*, et une lecture asynchrone arriverait apres le
     clic qu'elle devait autoriser. */
  assert.ok(KEY_TAUGHT.startsWith('FGC_'));
});

/* ------------------------------------------- le moteur, et ce qu'il refuse */

test('le moteur lit ce que le module ecrit', () => {
  /* La duplication ne peut pas disparaitre : le module est en ES moderne, le
     lecteur en ES5 concatene qui tourne aussi en userscript. Ce test tient la
     meme promesse que ceux du pays et des codes -- les deux cotes s'accordent
     sur les memes entrees. */
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  const { taught } = learn({}, { surface: SURFACES.LUNA, label: 'Obtenir le jeu', now: T });

  gmStore.set(KEY_TAUGHT, JSON.stringify(taught));

  assert.deepEqual(Array.from(fgc.taughtLabels('luna')), ['obtenir le jeu']);
  assert.equal(fgc.matchesTaught('Obtenir le jeu', 'luna'), true);
});

test('un libelle appris autorise le bouton qu\'il decrit', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  const { taught } = learn({}, { surface: SURFACES.LUNA, label: 'Ajouter a ma bibliotheque', now: T });
  gmStore.set(KEY_TAUGHT, JSON.stringify(taught));

  /* Le libelle est cherche PAR INCLUSION : le textContent d'un bouton
     concatene tous ses descendants, et un span de lecteur d'ecran suffirait a
     faire echouer une egalite. */
  assert.equal(fgc.matchesTaught('  AJOUTER A MA BIBLIOTHEQUE  (gratuit)', 'luna'), true);
});

test('MEME appris, un bouton qui parle d\'argent reste refuse', () => {
  /* Le test le plus important du fichier.
   *
   * Le module refuse deja d'ECRIRE un libelle parlant d'argent. Celui-ci
   * verifie le SECOND garde : meme si un libelle dangereux arrivait dans le
   * stockage par un autre chemin -- une version anterieure, une edition a la
   * main du profil -- le moteur refuserait quand meme de cliquer, parce que
   * looksPaid passe AVANT.
   *
   * Il faut que les deux cedent pour qu'un achat parte. */
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  // Ecriture directe, en contournant volontairement le module.
  gmStore.set(KEY_TAUGHT, JSON.stringify({ luna: ['acheter maintenant'], gog: ['payer'] }));

  assert.equal(fgc.matchesTaught('Acheter maintenant', 'luna'), true, 'le lecteur le voit');
  assert.equal(
    fgc.lunaClaimLabelAllowed({ textContent: 'Acheter maintenant' }),
    false,
    'et le clic est refuse quand meme',
  );
});

test('un stockage abime ne casse pas la lecture', () => {
  /* Un JSON tronque par un disque plein ou une extension tierce ne doit pas
     empecher le moteur de cliquer ce qu'il sait deja cliquer. */
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  for (const brut of ['{', 'null', '[]', '"texte"', '']) {
    gmStore.set(KEY_TAUGHT, brut);
    assert.deepEqual(Array.from(fgc.taughtLabels('luna')), [], JSON.stringify(brut));
  }
});

test('sans rien d\'appris, le moteur se comporte exactement comme avant', () => {
  /* La regression la plus facile a introduire : un lecteur qui jette ou qui
     rend `undefined` casserait la reclamation de tout le monde, y compris de
     ceux qui n'ont jamais rien appris. */
  const { fgc } = loadEngine({ hostname: 'luna.amazon.fr' });

  assert.deepEqual(Array.from(fgc.taughtLabels('luna')), []);
  assert.equal(fgc.lunaClaimLabelAllowed({ textContent: 'Recuperer' }), true);
  assert.equal(fgc.lunaClaimLabelAllowed({ textContent: 'Acheter' }), false);
});

/* ------------------------------------------------------------- la trace */

test('un libelle refuse est retenu, pour qu\'on puisse le designer', () => {
  /* Sans cette trace, apprendre demanderait de recopier a la main le libelle
     exact d'un bouton qu'on ne voit plus. Personne ne le fait. */
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  fgc.noteSeenLabel('luna', '  Ajouter   a la bibliotheque ');

  assert.deepEqual(JSON.parse(gmStore.get('FGC_seen_labels')).luna, ['Ajouter a la bibliotheque']);
});

test('le meme libelle vu deux fois ne compte qu\'une fois, et remonte', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  fgc.noteSeenLabel('luna', 'Premier');
  fgc.noteSeenLabel('luna', 'Second');
  fgc.noteSeenLabel('luna', 'Premier');

  assert.deepEqual(JSON.parse(gmStore.get('FGC_seen_labels')).luna, ['Premier', 'Second']);
});

test('la trace est bornee', () => {
  /* Une liste qui grossit indefiniment finirait par contenir tous les boutons
     de tous les magasins, et ne designerait plus rien. */
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  for (let i = 0; i < 20; i++) fgc.noteSeenLabel('luna', `Bouton ${i}`);

  assert.equal(JSON.parse(gmStore.get('FGC_seen_labels')).luna.length, 8);
});

test('un libelle vide ou demesure n\'entre pas dans la trace', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });

  fgc.noteSeenLabel('luna', '   ');
  fgc.noteSeenLabel('luna', 'x'.repeat(200));

  assert.equal(gmStore.get('FGC_seen_labels'), undefined, 'rien n\'a ete ecrit');
});
