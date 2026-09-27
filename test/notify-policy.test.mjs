/* Quand prevenir, et par quel canal.
 *
 * Deux choses se testent mal en production et bien ici : une plage horaire qui
 * traverse minuit, et un resume qui ne doit pas partir deux fois par jour.
 *
 * Toutes les heures locales passent par un fuseau EXPLICITE. Sans lui la suite
 * passerait ou echouerait selon la region de la machine qui la lance, ce qui est
 * le pire des resultats : elle serait verte ici et rouge chez quelqu'un d'autre,
 * sans que le code ait change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readClock,
  inQuietHours,
  decideAnnouncement,
  endingSoon,
  badgeCount,
  onlyWatched,
  MODES,
  BADGES,
  DIGEST_INTERVAL_MS,
} from '../watch/notify-policy.js';

const PARIS = 'Europe/Paris';
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Un instant UTC qui vaut `h`:`m` a Paris en aout (UTC+2). */
const parisAout = (h, m = 0) => Date.UTC(2026, 7, 27, h - 2, m, 0);

/* ------------------------------------------------------------- readClock */

test('readClock lit une heure et refuse le reste', () => {
  assert.equal(readClock('23:00'), 23 * 60);
  assert.equal(readClock('08:30'), 8 * 60 + 30);
  assert.equal(readClock('0:05'), 5);
  assert.equal(readClock('24:00'), null, '24 h n\'existe pas');
  assert.equal(readClock('12:60'), null);
  assert.equal(readClock('midi'), null);
  assert.equal(readClock(''), null);
  assert.equal(readClock(undefined), null);
});

/* ---------------------------------------------------------- inQuietHours */

test('la plage par defaut traverse minuit', () => {
  const quiet = { on: true, start: '23:00', end: '08:00' };

  assert.equal(inQuietHours(quiet, parisAout(23, 30), PARIS), true, '23 h 30 est dans la nuit');
  assert.equal(inQuietHours(quiet, parisAout(3), PARIS), true, '3 h aussi');
  assert.equal(inQuietHours(quiet, parisAout(7, 59), PARIS), true, 'juste avant la fin');
  assert.equal(inQuietHours(quiet, parisAout(8), PARIS), false, 'la borne de fin est exclue');
  assert.equal(inQuietHours(quiet, parisAout(14), PARIS), false, 'l\'apres-midi n\'est pas calme');
  assert.equal(inQuietHours(quiet, parisAout(22, 59), PARIS), false, 'juste avant le debut');
  assert.equal(inQuietHours(quiet, parisAout(23), PARIS), true, 'la borne de debut est incluse');
});

test('une plage qui ne traverse pas minuit fonctionne aussi', () => {
  const quiet = { on: true, start: '09:00', end: '17:00' };
  assert.equal(inQuietHours(quiet, parisAout(12), PARIS), true);
  assert.equal(inQuietHours(quiet, parisAout(8), PARIS), false);
  assert.equal(inQuietHours(quiet, parisAout(20), PARIS), false);
});

test('la plage desactivee ne fait jamais taire', () => {
  assert.equal(inQuietHours({ on: false, start: '23:00', end: '08:00' }, parisAout(3), PARIS), false);
  assert.equal(inQuietHours(null, parisAout(3), PARIS), false);
  assert.equal(inQuietHours(undefined, parisAout(3), PARIS), false);
});

test('une plage illisible previent quand meme', () => {
  // Le silence est le mode qui perd des jeux : en cas de doute, on notifie.
  assert.equal(inQuietHours({ on: true, start: 'nuit', end: '08:00' }, parisAout(3), PARIS), false);
  assert.equal(inQuietHours({ on: true, start: '23:00', end: '23:00' }, parisAout(23), PARIS), false);
});

test('la plage suit le fuseau, pas la machine', () => {
  const quiet = { on: true, start: '23:00', end: '08:00' };
  // Le meme instant : 2 h du matin a Paris, 20 h la veille a New York.
  const instant = parisAout(2);
  assert.equal(inQuietHours(quiet, instant, PARIS), true);
  assert.equal(inQuietHours(quiet, instant, 'America/New_York'), false);
});

/* ------------------------------------------------------ decideAnnouncement */

const T = parisAout(14);

test('aucune offre, aucune decision a prendre', () => {
  const d = decideAnnouncement({ mode: MODES.EVERY, now: T, count: 0 });
  assert.deepEqual(d, { notify: false, hold: false, digest: false });
});

test('mode « a chaque offre » : on notifie', () => {
  const d = decideAnnouncement({ mode: MODES.EVERY, now: T, count: 2 });
  assert.equal(d.notify, true);
  assert.equal(d.hold, false);
});

test('mode « jamais » ne retient rien', () => {
  const d = decideAnnouncement({ mode: MODES.OFF, now: T, count: 2 });
  assert.equal(d.notify, false);
  assert.equal(d.hold, false, 'retenir ferait tout partir d\'un coup au rallumage');
});

test('en heures calmes l\'annonce est DIFFEREE, pas supprimee', () => {
  const d = decideAnnouncement({
    mode: MODES.EVERY,
    quiet: { on: true, start: '23:00', end: '08:00' },
    zone: PARIS,
    now: parisAout(2),
    count: 1,
  });
  assert.equal(d.notify, false);
  assert.equal(d.hold, true, 'sans hold, notifieLe serait pose et l\'offre jamais annoncee');
});

test('le resume part une fois, puis attend vingt heures', () => {
  const premier = decideAnnouncement({ mode: MODES.DIGEST, now: T, count: 3, lastDigestAt: null });
  assert.equal(premier.notify, true);
  assert.equal(premier.digest, true);

  const trop_tot = decideAnnouncement({ mode: MODES.DIGEST, now: T + HOUR, count: 3, lastDigestAt: T });
  assert.equal(trop_tot.notify, false);
  assert.equal(trop_tot.hold, true, 'un resume differe n\'oublie pas les offres');

  const apres = decideAnnouncement({
    mode: MODES.DIGEST,
    now: T + DIGEST_INTERVAL_MS,
    count: 3,
    lastDigestAt: T,
  });
  assert.equal(apres.notify, true);
});

test('les heures calmes l\'emportent sur le resume', () => {
  const d = decideAnnouncement({
    mode: MODES.DIGEST,
    quiet: { on: true, start: '23:00', end: '08:00' },
    zone: PARIS,
    now: parisAout(1),
    count: 3,
    lastDigestAt: null,
  });
  assert.equal(d.notify, false);
  assert.equal(d.hold, true);
});

/* -------------------------------------------------------------- endingSoon */

const offre = (over, extra = {}) => ({ title: 'X', end: T + over, ...extra });

test('endingSoon prend ce qui se termine dans la fenetre', () => {
  const offers = [
    offre(2 * HOUR),
    offre(30 * HOUR),
    offre(-HOUR),                       // deja terminee
    offre(5 * HOUR, { remindedAt: T }), // deja rappelee
    { title: 'sans fin', end: null },
  ];
  const out = endingSoon(offers, { now: T, hours: 6 });
  assert.equal(out.length, 1);
  assert.equal(out[0].end, T + 2 * HOUR);
});

test('un seuil a zero coupe le rappel', () => {
  assert.deepEqual(endingSoon([offre(HOUR)], { now: T, hours: 0 }), []);
});

test('un verdict definitif ne merite plus de rappel', () => {
  const out = endingSoon([offre(HOUR, { verdict: 'claimed' })], {
    now: T,
    hours: 6,
    isFinal: (v) => v === 'claimed',
  });
  assert.deepEqual(out, []);
});

test('le seuil est bien en heures', () => {
  const offers = [offre(10 * HOUR)];
  assert.equal(endingSoon(offers, { now: T, hours: 6 }).length, 0);
  assert.equal(endingSoon(offers, { now: T, hours: 12 }).length, 1);
});

/* -------------------------------------------------------------- badgeCount */

test('le badge compte les non-vues par defaut', () => {
  assert.equal(badgeCount({ mode: BADGES.UNSEEN, unseen: 4, now: T }), 4);
});

test('le badge peut compter ce qui finit dans les 24 h', () => {
  const offers = [offre(2 * HOUR), offre(20 * HOUR), offre(30 * HOUR), offre(-HOUR)];
  assert.equal(badgeCount({ mode: BADGES.ENDING_TODAY, offers, now: T }), 2);
});

test('le badge coupe rend zero, quoi qu\'il arrive', () => {
  assert.equal(badgeCount({ mode: BADGES.OFF, unseen: 9, offers: [offre(HOUR)], now: T }), 0);
});

/* ------------------------------------------------------------- onlyWatched */

test('seuls les magasins suivis passent', () => {
  const offers = [{ store: 'epic' }, { store: 'itchio' }, { store: 'gog' }];
  assert.deepEqual(onlyWatched(offers, ['epic', 'gog']).map((o) => o.store), ['epic', 'gog']);
});

test('une liste de magasins vide ne filtre rien', () => {
  // Un reglage absent ne doit pas rendre l'extension muette : c'est le mode
  // d'echec qui ressemble le plus a « l'extension ne marche plus ».
  const offers = [{ store: 'epic' }, { store: 'itchio' }];
  assert.equal(onlyWatched(offers, []).length, 2);
  assert.equal(onlyWatched(offers, undefined).length, 2);
});

/* La derniere chance (2.90.0). */
import { lastChanceOffers, LAST_CHANCE_MS } from '../watch/notify-policy.js';

test('derniere chance : attendu, dans les 3 dernieres heures, pas a nous, une fois', () => {
  const now = Date.UTC(2026, 8, 27, 12);
  const o = (title, endIn, extra = {}) => ({ title, store: 'epic', end: now + endIn, wished: true, ...extra });
  const offres = [
    o('Dedans', 2 * 3600000),
    o('Trop tot', LAST_CHANCE_MS + 60000),
    o('Trop tard', 5 * 60000),
    o('Pas attendu', 3600000, { wished: false }),
    o('Deja dit', 3600000, { lastChanceAt: now - 1 }),
    o('Reclame', 3600000, { verdict: 'claimed' }),
    o('Possede', 3600000, { alreadyOwned: true }),
    o('Au registre', 3600000),
  ];
  const r = lastChanceOffers(offres, {
    now, isFinal: (v) => v === 'claimed', owned: (x) => x.title === 'Au registre',
  });
  assert.deepEqual(r.map((x) => x.title), ['Dedans']);
});
