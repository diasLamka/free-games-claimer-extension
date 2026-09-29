/* Tests du canari de selecteurs.
 *
 * Le canari existe pour un mode d'echec precis : un magasin change un libelle,
 * l'extension echoue, le recul espace poliment les tentatives, et personne
 * n'apprend rien avant de constater qu'un jeu manque. Chaque test ci-dessous
 * correspond a une facon de rendre ce canari inutile -- crier pour rien,
 * accuser le mauvais coupable, ou se taire quand il faut parler.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_CANARY,
  ALERT_AFTER,
  ALERT_AFTER_UNPROVEN,
  KINDS,
  classify,
  observe,
  alerts,
  acknowledge,
  alertLine,
  newAlerts,
} from '../watch/canary.js';

const T = Date.UTC(2026, 8, 17, 3, 0, 0);
const HEURE = 3600000;

/** Enchaine des verdicts sur un magasin, un par heure. */
function suite(store, liste, depart = T) {
  let etat = {};
  liste.forEach((v, i) => {
    etat = observe(etat, { store, verdict: v.verdict, details: v.details ?? null, ts: depart + i * HEURE });
  });
  return etat;
}

/* ------------------------------------------------------------ classement */

test('un parcours mene a son terme prouve que les selecteurs marchent', () => {
  for (const v of ['claimed', 'redeemed', 'already_redeemed', 'code_pending_gog']) {
    assert.equal(classify(v), KINDS.SUCCESS, v);
  }
});

test('un echec qui n\'est pas le notre parle du magasin, quelle qu\'en soit la forme', () => {
  // Les trois dernieres pannes de selecteur ont pris trois formes differentes.
  // Une liste de motifs a reconnaitre les aurait ratees toutes les trois.
  assert.equal(classify('failed', 'waitForElement: timeout apres 10000ms'), KINDS.SELECTOR);
  assert.equal(classify('failed', 'bouton introuvable ; boutons vus : Acheter | Liste de souhaits'), KINDS.SELECTOR);
  assert.equal(classify('failed', 'quelque chose que personne n\'a encore vu'), KINDS.SELECTOR);
  assert.equal(classify('failed', null), KINDS.SELECTOR, 'un echec sans motif reste un echec du parcours');
});

test('un worker mort en pleine reclamation n\'accuse pas le magasin', () => {
  assert.equal(classify('undetermined', 'reprise apres un worker arrete'), KINDS.OTHER);
});

test('nos propres pannes n\'accusent pas le magasin', () => {
  // Un canari qui crie a chaque coupure reseau est un canari qu'on coupe.
  assert.equal(classify('failed', 'la page n\'a pas fini de charger'), KINDS.OTHER);
  assert.equal(classify('failed', 'le moteur ne s\'est pas annonce'), KINDS.OTHER);
  assert.equal(classify('failed', 'ordre non transmis : port closed'), KINDS.OTHER);
  // 2.99.1 : la page d'erreur de Chrome n'est pas une page de Steam qui a change.
  assert.equal(classify('failed', 'injection impossible : Frame with ID 0 is showing error page'), KINDS.OTHER);
  assert.equal(classify('failed', 'injection impossible : Cannot access contents of the page'), KINDS.OTHER);
  assert.equal(classify('failed', 'injection impossible : No tab with id: 42.'), KINDS.OTHER);
  assert.equal(classify('failed', 'net::ERR_INTERNET_DISCONNECTED'), KINDS.OTHER);
});

test('une reconnexion ne dit rien : le moteur s\'arrete avant de regarder', () => {
  for (const v of ['needs_login', 'needs_link', 'challenge']) {
    assert.equal(classify(v), KINDS.HUMAN, v);
  }
});

test('ce qui n\'est ni succes ni echec ne pese pas', () => {
  for (const v of ['skipped', 'out_of_scope', 'bad_url', 'expired', 'upcoming', 'quota']) {
    assert.equal(classify(v), KINDS.OTHER, v);
  }
});

/* ------------------------------------------------------------- comptage */

test('deux echecs de selecteur d\'affilee sur un magasin eprouve alertent', () => {
  const etat = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'failed', details: 'delai depasse' },
  ]);

  const [a] = alerts(etat);
  assert.ok(a, 'aucune alerte levee');
  assert.equal(a.store, 'epic');
  assert.equal(a.streak, ALERT_AFTER);
  assert.equal(a.since, T + HEURE, 'l\'alerte doit dater du PREMIER echec de la serie');
  assert.equal(a.lastDetails, 'delai depasse');
});

test('un magasin qui n\'a jamais rien reclame demande un echec de plus', () => {
  // Il peut n'avoir jamais ete essaye, ou ne pas avoir de compte. Crier des le
  // deuxieme apprend a ignorer le canari.
  const deux = suite('gog', [
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'failed', details: 'bouton introuvable' },
  ]);
  assert.equal(alerts(deux).length, 0);

  const trois = observe(deux, { store: 'gog', verdict: 'failed', details: 'bouton introuvable', ts: T + 3 * HEURE });
  assert.equal(alerts(trois).length, 1);
  assert.equal(alerts(trois)[0].streak, ALERT_AFTER_UNPROVEN);
});

test('un succes eteint l\'alerte sans que personne intervienne', () => {
  const casse = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'failed', details: 'bouton introuvable' },
  ]);
  assert.equal(alerts(casse).length, 1);

  const repare = observe(casse, { store: 'epic', verdict: 'claimed', ts: T + 9 * HEURE });
  assert.equal(alerts(repare).length, 0);
  assert.equal(repare.epic.streak, 0);
  assert.equal(repare.epic.lastOkAt, T + 9 * HEURE);
});

test('une reconnexion au milieu d\'une serie ne l\'efface pas et ne l\'allonge pas', () => {
  const etat = suite('amazon', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'needs_login' },
    { verdict: 'failed', details: 'bouton introuvable' },
  ]);
  assert.equal(etat.amazon.streak, 2, 'la reconnexion ne doit ni compter ni remettre a zero');
  assert.equal(alerts(etat).length, 1);
});

test('deux magasins ne se contaminent pas', () => {
  let etat = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'failed', details: 'bouton introuvable' },
  ]);
  etat = observe(etat, { store: 'gog', verdict: 'claimed', ts: T + 5 * HEURE });

  const noms = alerts(etat).map((a) => a.store);
  assert.deepEqual(noms, ['epic']);
});

test('les alertes sortent du plus casse au moins casse', () => {
  let etat = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'x' },
    { verdict: 'failed', details: 'x' },
  ]);
  etat = observe(etat, { store: 'gog', verdict: 'claimed', ts: T });
  for (let i = 0; i < 4; i++) {
    etat = observe(etat, { store: 'gog', verdict: 'failed', details: 'y', ts: T + (i + 1) * HEURE });
  }
  assert.deepEqual(alerts(etat).map((a) => a.store), ['gog', 'epic']);
});

/* ------------------------------------------------------------- lecture */

test('une alerte deja levee n\'est pas relevee a chaque cycle', () => {
  // Repetee a chaque cycle, elle noierait le journal et finirait ignoree --
  // exactement le sort qu'on veut eviter a un canari.
  const avant = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'x' },
    { verdict: 'failed', details: 'x' },
  ]);
  const apres = observe(avant, { store: 'epic', verdict: 'failed', details: 'x', ts: T + 9 * HEURE });

  assert.equal(newAlerts({}, avant).length, 1, 'la naissance de l\'alerte doit se voir');
  assert.equal(newAlerts(avant, apres).length, 0, 'la meme alerte ne doit pas se repeter');
});

test('la ligne de journal recopie le motif technique tel quel', () => {
  // C'est lui qui nomme le bouton manquant : une capture de cette ligne a
  // suffi a corriger la 2.13.2.
  const etat = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'bouton introuvable' },
    { verdict: 'failed', details: 'boutons vus : Acheter | Liste de souhaits' },
  ]);
  const ligne = alertLine(alerts(etat)[0]);
  assert.match(ligne, /^epic : 2 echec\(s\) de selecteur/);
  assert.match(ligne, /boutons vus : Acheter \| Liste de souhaits$/);
});

test('acquitter remet le compteur a zero sans effacer l\'historique du succes', () => {
  const etat = suite('epic', [
    { verdict: 'claimed' },
    { verdict: 'failed', details: 'x' },
    { verdict: 'failed', details: 'x' },
  ]);
  const vu = acknowledge(etat, 'epic');

  assert.equal(alerts(vu).length, 0);
  assert.equal(vu.epic.lastOkAt, T, 'le dernier succes reste connu');
  assert.deepEqual(acknowledge({}, 'inconnu'), {}, 'acquitter un magasin inconnu ne cree rien');
});

test('un etat relu illisible ne fait pas tomber le popup', () => {
  assert.deepEqual(alerts(null), []);
  assert.deepEqual(alerts({ epic: null }), []);
  assert.deepEqual(alerts({ epic: { streak: 'beaucoup' } }), []);
  assert.deepEqual(observe(null, {}), {}, 'un verdict sans magasin ne cree pas d\'entree');
});

test('la cle vit dans l\'espace de la veille, jamais dans celui du moteur', () => {
  assert.ok(KEY_CANARY.startsWith('veille:'));
});

test('jeu de base requis ne parle pas de la page du magasin (2.80.1)', () => {
  // Le canari criait « le magasin a probablement change sa page » pour un DLC
  // dont le compte n'avait pas le jeu de base : la page, elle, n'avait rien.
  assert.equal(classify('needs_base_game', 'DLC : il faut d\'abord posseder le jeu de base'), KINDS.OTHER);
});
