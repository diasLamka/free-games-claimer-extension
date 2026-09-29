/* Le chien de garde : quand c'est l'extension qui casse.
 *
 * Trois detecteurs existaient deja, complets et testes, et aucun n'avait de
 * voix : le canari de selecteurs, la source en repli, la session perdue. Leurs
 * constats allaient au journal -- une page qu'on ouvre quand on soupconne deja
 * quelque chose -- ou a un bandeau du popup, qu'on voit en l'ouvrant. Ni l'un
 * ni l'autre ne PREVIENT.
 *
 * Ce module change la nature de la chose. Une panne etait un COMPTEUR qui
 * monte ; elle devient un INCIDENT qui a une ouverture, une derniere
 * observation et une cloture. C'est ce qui permet les trois choses qui
 * manquaient : dire depuis quand, ne le dire qu'une fois, et savoir que c'est
 * fini.
 *
 * Conception : docs/specs/2026-09-22-chien-de-garde-design.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_INCIDENTS,
  KINDS,
  STALL_FLOOR_MS,
  incidentKey,
  incidentLine,
  isStalled,
  markNotified,
  observe,
  openIncidents,
  pendingNotices,
  reconcile,
} from '../watch/incidents.js';
import { SESSION } from '../watch/session.js';
import { DEFAULT_SETTINGS, normaliseSettings } from '../watch/storage.js';
import { ALERTS, badgeState, decideAlert } from '../watch/notify-policy.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const HEURE = 3600000;

/* ------------------------------------------------------------- l'identite */

test('un incident porte le genre et ce sur quoi il porte', () => {
  assert.equal(incidentKey({ kind: KINDS.SELECTOR, key: 'epic' }), 'selector:epic');
});

test('un incident qui ne porte sur rien n\'invente pas de cle', () => {
  /* `stalled` et `muted` concernent l'extension entiere. Leur donner une cle
     vide produirait « stalled: », qui se lit mal et se compare mal. */
  assert.equal(incidentKey({ kind: KINDS.STALLED }), 'stalled');
});

test('la cle de stockage vit dans l\'espace de la veille', () => {
  assert.ok(KEY_INCIDENTS.startsWith('veille:'));
});

/* --------------------------------------------- ouverture, reconstat, cloture */

test('un incident constate pour la premiere fois s\'ouvre', () => {
  const r = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic', detail: 'bouton introuvable' }], { now: T });

  assert.equal(r.opened.length, 1);
  const i = r.incidents['selector:epic'];
  assert.equal(i.openedAt, T);
  assert.equal(i.lastSeenAt, T);
  assert.equal(i.notifiedAt, null);
  assert.equal(i.detail, 'bouton introuvable');
});

test('un incident reconstate garde sa date d\'ouverture', () => {
  /* C'est tout l'interet d'avoir une histoire plutot qu'un compteur : « depuis
     mardi » ne se dit pas si l'ouverture se redate a chaque cycle. */
  const un = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic', detail: 'a' }], { now: T });
  const deux = reconcile(un.incidents, [{ kind: KINDS.SELECTOR, key: 'epic', detail: 'b' }], { now: T + 5 * HEURE });

  assert.equal(deux.opened.length, 0, 'ce n\'est pas une ouverture');
  const i = deux.incidents['selector:epic'];
  assert.equal(i.openedAt, T, 'l\'ouverture ne bouge pas');
  assert.equal(i.lastSeenAt, T + 5 * HEURE, 'le dernier constat, si');
  assert.equal(i.detail, 'b', 'le motif technique le plus recent');
});

test('un incident qui cesse d\'etre constate disparait, et le dit une fois', () => {
  /* La cloture est implicite. Un detecteur qui devrait penser a fermer ce
     qu'il a ouvert finirait par oublier -- et un incident fantome ferait
     chercher une panne qui n'existe plus. */
  const un = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T });
  const deux = reconcile(un.incidents, [], { now: T + HEURE });

  assert.deepEqual(deux.incidents, {});
  assert.deepEqual(deux.closed.map((i) => i.kind), [KINDS.SELECTOR]);
});

test('deux pannes distinctes font deux incidents', () => {
  const r = reconcile({}, [
    { kind: KINDS.SELECTOR, key: 'epic' },
    { kind: KINDS.SESSION, key: 'gog' },
  ], { now: T });

  assert.equal(Object.keys(r.incidents).length, 2);
  assert.equal(r.opened.length, 2);
});

/* --------------------------------------------------------- une seule fois */

test('on ne dit un incident qu\'une fois, meme sur dix cycles', () => {
  let etat = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T }).incidents;

  const premier = pendingNotices(etat);
  assert.equal(premier.length, 1);

  etat = markNotified(etat, premier.map((i) => i.id), { now: T });

  for (let c = 1; c <= 10; c++) {
    etat = reconcile(etat, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T + c * HEURE }).incidents;
    assert.deepEqual(pendingNotices(etat), [], `cycle ${c}`);
  }
});

test('un incident referme puis reouvert se redit : c\'est une panne neuve', () => {
  let etat = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T }).incidents;
  etat = markNotified(etat, ['selector:epic'], { now: T });

  etat = reconcile(etat, [], { now: T + HEURE }).incidents;
  etat = reconcile(etat, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T + 2 * HEURE }).incidents;

  assert.equal(pendingNotices(etat).length, 1, 'une panne qui revient est une nouvelle');
});

test('un canal coupe ne se raconte pas par le canal coupe', () => {
  /* `muted` dit que le systeme refuse nos notifications. Tenter d'en envoyer
     une pour l'annoncer serait absurde : c'est le badge et le popup qui le
     portent. */
  const etat = reconcile({}, [{ kind: KINDS.MUTED }], { now: T }).incidents;

  assert.deepEqual(pendingNotices(etat), []);
  assert.equal(openIncidents(etat).length, 1, 'il existe, il ne se notifie pas');
});

/* ------------------------------------------------------ la veille arretee */

test('la veille en retard au-dela du double de son pas est arretee', () => {
  /* Le facteur deux laisse passer un cycle manque sans crier : un portable
     ferme une nuit ne doit rien declencher. */
  const pas = 8 * HEURE;
  const base = { lastCycle: T, nextCycle: T + pas };

  assert.equal(isStalled({ ...base, now: T + pas }), false, 'a l\'heure');
  assert.equal(isStalled({ ...base, now: T + 2 * pas }), false, 'un cycle manque, on patiente');
  assert.equal(isStalled({ ...base, now: T + 2 * pas + 1 }), true, 'au-dela, c\'est une panne');
});

test('un pas tres court ne fait pas crier au bout de dix minutes', () => {
  /* Sans plancher, une source forcee a la main -- donc un `nextCycle` proche
     -- ferait declarer la veille morte au premier reveil manque. Le plancher
     est le pas nominal d'un reglage par defaut. */
  const base = { lastCycle: T, nextCycle: T + 10 * 60000 };

  assert.equal(isStalled({ ...base, now: T + HEURE }), false);
  assert.equal(isStalled({ ...base, now: T + STALL_FLOOR_MS }), false);
  assert.equal(isStalled({ ...base, now: T + STALL_FLOOR_MS + 1 }), true);
});

test('une veille qui n\'a jamais tourne n\'est pas une veille arretee', () => {
  /* A l'installation, `lastCycle` est nul. Crier a ce moment-la accueillerait
     l'utilisateur par une alerte, pour un etat parfaitement normal. */
  assert.equal(isStalled({ lastCycle: null, nextCycle: null, now: T }), false);
});

/* ------------------------------------------------------- les observations */

test('une alerte du canari devient un incident qui porte le motif technique', () => {
  /* Le motif est recopie tel quel : c'est lui qui nomme le bouton manquant, et
     une capture de cette ligne a suffi a corriger la 2.13.2. */
  const vus = observe({
    canary: { epic: { streak: 3, lastOkAt: T - 100, lastDetails: 'waitForElement: timeout' } },
    now: T,
  });

  const i = vus.find((v) => v.kind === KINDS.SELECTOR);
  assert.ok(i, 'un incident de selecteur');
  assert.equal(i.key, 'epic');
  assert.match(i.detail, /timeout/);
});

test('une source en repli devient un incident', () => {
  const vus = observe({
    sources: { gog: { consecutiveFailures: 3, lastError: 'HTTP 503' } },
    now: T,
  });

  const i = vus.find((v) => v.kind === KINDS.SOURCE);
  assert.equal(i.key, 'gog');
  assert.match(i.detail, /503/);
});

test('une session perdue devient un incident, une session inconnue jamais', () => {
  /* Lecon de la 2.22.2, tenue jusqu'ici : une ignorance affichee comme une
     alerte fait passer « je ne sais pas » pour « c'est casse », et appelle un
     geste inutile. */
  const perdue = observe({
    sessions: { gog: { status: SESSION.OUT, at: T, outSince: T - 40 * 60000 } },
    now: T,
  });
  assert.ok(perdue.some((v) => v.kind === KINDS.SESSION && v.key === 'gog'));

  // 2.99.4 : une seule mesure « deconnecte » (maintenance, portail captif au reveil) ne suffit pas.
  const unSeulCoup = observe({ sessions: { gog: { status: SESSION.OUT, at: T, outSince: T } }, now: T });
  assert.deepEqual(unSeulCoup.filter((v) => v.kind === KINDS.SESSION), []);
  const presque = observe({ sessions: { gog: { status: SESSION.OUT, at: T, outSince: T - 29 * 60000 } }, now: T });
  assert.deepEqual(presque.filter((v) => v.kind === KINDS.SESSION), []);
  // Une entree d'avant la 2.99.4 (sans outSince) : sa date de mesure fait foi.
  const ancienne = observe({ sessions: { gog: { status: SESSION.OUT, at: T - 3600000 } }, now: T });
  assert.ok(ancienne.some((v) => v.kind === KINDS.SESSION));

  const inconnue = observe({
    sessions: { gog: { status: SESSION.UNKNOWN, at: T } },
    now: T,
  });
  assert.deepEqual(inconnue.filter((v) => v.kind === KINDS.SESSION), []);
});

test('une permission de notification refusee devient un incident', () => {
  const vus = observe({ permissionLevel: 'denied', now: T });

  assert.ok(vus.some((v) => v.kind === KINDS.MUTED));
  assert.deepEqual(observe({ permissionLevel: 'granted', now: T }), []);
});

test('la veille arretee devient un incident, sans qu\'aucun cycle n\'ait tourne', () => {
  /* C'est la raison d'etre du lot. Un chien de garde qui dort avec le chien
     qu'il garde ne garde rien : cette observation se fait a partir de l'etat
     persiste, donc depuis le gestionnaire d'alarme, sans cycle. */
  const vus = observe({
    state: { lastCycle: T - 48 * HEURE, nextCycle: T - 40 * HEURE },
    now: T,
  });

  assert.ok(vus.some((v) => v.kind === KINDS.STALLED));
});

test('rien qui ne va mal ne produit rien', () => {
  assert.deepEqual(observe({
    canary: { epic: { streak: 0, lastOkAt: T } },
    sources: { gog: { consecutiveFailures: 0 } },
    sessions: { gog: { status: SESSION.OK, at: T } },
    state: { lastCycle: T - HEURE, nextCycle: T + 7 * HEURE },
    permissionLevel: 'granted',
    now: T,
  }), []);
});

/* ------------------------------------------------------------- l'affichage */

test('les incidents ouverts se lisent du plus ancien au plus recent', () => {
  let etat = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T }).incidents;
  etat = reconcile(etat, [
    { kind: KINDS.SELECTOR, key: 'epic' },
    { kind: KINDS.SESSION, key: 'gog' },
  ], { now: T + HEURE }).incidents;

  const liste = openIncidents(etat);
  assert.equal(liste.length, 2);
  assert.equal(liste[0].kind, KINDS.SELECTOR, 'le plus ancien d\'abord : c\'est lui qui dure');
});

test('chaque incident sait se dire en une ligne', () => {
  const etat = reconcile({}, [
    { kind: KINDS.STALLED, detail: 'dernier cycle il y a 2 j' },
  ], { now: T }).incidents;

  const ligne = incidentLine(openIncidents(etat)[0]);
  assert.equal(typeof ligne, 'string');
  assert.ok(ligne.length > 0);
});

/* ------------------------------------------------------------- le canal */

test('une installation neuve est prevenue quand ca casse', () => {
  assert.equal(DEFAULT_SETTINGS.alertMode, ALERTS.ON);
});

test('qui avait coupe les notifications n\'en recoit pas de nouvelles', () => {
  /* La regle du depot : « une preference perdue en silence est une trahison
     silencieuse ». Quelqu'un qui a coupe les notifications d'offres n'a pas
     demande a recevoir un genre nouveau. La traduction est unique et se fait
     a la lecture, exactement comme celle de `notifications: false` en
     `notifyMode: 'off'` depuis la 2.10. */
  const lu = normaliseSettings({ notifyMode: 'off' });
  assert.equal(lu.alertMode, ALERTS.OFF);
});

test('mais les deux reglages restent independants ensuite', () => {
  /* Un choix explicite ne se fait jamais ecraser par la traduction : sans
     cela, impossible de couper les offres et de garder les alertes -- qui est
     precisement la combinaison la plus utile. */
  const lu = normaliseSettings({ notifyMode: 'off', alertMode: ALERTS.ON });
  assert.equal(lu.alertMode, ALERTS.ON);
});

test('couper les alertes ne coupe pas les offres', () => {
  const lu = normaliseSettings({ alertMode: ALERTS.OFF });
  assert.equal(lu.notifyMode, 'every');
});

/* -------------------------------------------------- differer, jamais taire */

test('les heures calmes different une alerte, elles ne la suppriment pas', () => {
  /* Meme regle que les offres. Un selecteur mort a trois heures du matin
     n'appelle aucun geste avant le lever -- mais l'oublier ferait disparaitre
     la seule alerte qu'on aura jamais pour cette panne. */
  const calme = { on: true, start: '23:00', end: '08:00' };
  const nuit = Date.UTC(2026, 8, 23, 2, 0, 0);

  const d = decideAlert({ mode: ALERTS.ON, quiet: calme, now: nuit, count: 1, zone: 'UTC' });
  assert.equal(d.notify, false);
  assert.equal(d.hold, true, 'differe : on redira au matin');
});

test('hors des heures calmes, une alerte part', () => {
  const d = decideAlert({ mode: ALERTS.ON, now: T, count: 1 });
  assert.equal(d.notify, true);
  assert.equal(d.hold, false);
});

test('le mode coupe ne retient rien : le silence n\'est pas un report', () => {
  /* Difference exacte avec les heures calmes, et elle compte : retenir pour
     plus tard ferait tout partir d'un coup le jour ou l'utilisateur rallume
     les alertes. */
  const d = decideAlert({ mode: ALERTS.OFF, now: T, count: 3 });
  assert.equal(d.notify, false);
  assert.equal(d.hold, false);
});

test('rien a dire, rien a decider', () => {
  assert.equal(decideAlert({ mode: ALERTS.ON, now: T, count: 0 }).notify, false);
});

/* -------------------------------------------------------------- le badge */

test('sans incident, le badge porte le compte comme avant', () => {
  const b = badgeState({ mode: 'unseen', unseen: 4, offers: [], now: T, incidents: {} });
  assert.equal(b.text, '4');
});

test('un incident ouvert prime sur le compte d\'offres', () => {
  /* Une panne prime sur un decompte, que le popup affiche de toute facon. Et
     c'est le seul canal qui reste quand le systeme refuse nos notifications. */
  const incidents = reconcile({}, [{ kind: KINDS.SELECTOR, key: 'epic' }], { now: T }).incidents;
  const b = badgeState({ mode: 'unseen', unseen: 4, offers: [], now: T, incidents });

  assert.equal(b.text, '!');
  assert.notEqual(b.color, badgeState({ mode: 'unseen', unseen: 4, offers: [], now: T, incidents: {} }).color);
});

test('le badge crie meme quand le compte d\'offres est coupe', () => {
  /* `badgeMode: 'off'` dit « ne me compte pas les offres », pas « ne me dis
     jamais rien ». Confondre les deux enterrerait la derniere voix disponible
     quand les notifications sont bloquees par le systeme. */
  const incidents = reconcile({}, [{ kind: KINDS.MUTED }], { now: T }).incidents;
  const b = badgeState({ mode: 'off', unseen: 0, offers: [], now: T, incidents });

  assert.equal(b.text, '!');
});

test('observe : au reveil, la veille en retard n\'est pas jugee (2.99.1)', () => {
  const state = { lastCycle: T - 10 * HEURE, nextCycle: T - 7 * HEURE };
  assert.equal(observe({ state, now: T }).some((v) => v.kind === KINDS.STALLED), true);
  assert.equal(observe({ state, now: T, justWoke: true }).some((v) => v.kind === KINDS.STALLED), false);
});
