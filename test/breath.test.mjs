/* Le souffle : ne pas se presenter au magasin quand il pose le plus de defis.
 *
 * Ce que ces tests gardent avant tout : PAS DE CONCLUSION SANS DONNEES, et JAMAIS AU-DELA DE LA FIN D'OFFRE.
 * Tous les instants sont UTC explicites ; le fuseau est passe en parametre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOURS, MIN_ATTEMPTS, MIN_CHALLENGES, URGENT_MS, MAX_WAIT_MS, MAX_TOTAL,
  readBreath, recordAttempt, profile, hourOf, decide, heldKeys,
} from '../watch/breath.js';

const H = 3600000;
const DAY = 24 * H;
const iso = (t) => new Date(t).toISOString();

/** Un jour de decembre a l'heure UTC donnee. */
const a = (hour, min = 0) => Date.UTC(2026, 11, 3, hour, min, 0);

/**
 * Des statistiques fabriquees : `parHeure` = { 18: [essais, defis], ... }. Le reste de la journee recoit `fond` essais sans defi.
 * Avec fond = 4 : total = 20 + 4 * 23 ... voir chaque test.
 */
function stats(store, parHeure, fond = 4) {
  const n = new Array(HOURS).fill(fond);
  const c = new Array(HOURS).fill(0);
  for (const [h, [essais, defis]] of Object.entries(parHeure)) { n[Number(h)] = essais; c[Number(h)] = defis; }
  return { stores: { [store]: { n, c } } };
}

/** Un magasin qui pose des defis le soir : 18 h et 19 h sont mauvaises. */
const SOIR = stats('epic', { 18: [10, 6], 19: [10, 5] });

/* ------------------------------------------------------------- la lecture */

test('des statistiques absentes ou abimees sont des statistiques vides', () => {
  for (const raw of [undefined, null, 'x', 4, [], { stores: 'oui' }, { stores: { epic: 'x' } }]) {
    const b = readBreath(raw);
    assert.deepEqual(Object.keys(b.stores).filter((s) => b.stores[s].n.some((x) => x !== 0)), [], JSON.stringify(raw));
  }
});

test('la lecture borne les compteurs : jamais negatifs, jamais plus de defis que d\'essais', () => {
  const b = readBreath({ stores: { epic: { n: [3, -2, 'x'], c: [9, 4, 1] } } });
  assert.equal(b.stores.epic.n.length, HOURS);
  assert.deepEqual(b.stores.epic.n.slice(0, 3), [3, 0, 0]);
  assert.deepEqual(b.stores.epic.c.slice(0, 3), [3, 0, 0], 'un defi est un essai');
});

/* ---------------------------------------------------------- l'enregistrement */

test('un essai s\'inscrit a l\'heure locale du fuseau demande', () => {
  // 03:00 UTC, c'est 22 h la veille a New York (heure d'hiver), 12 h a Tokyo.
  assert.equal(hourOf(a(3), 'UTC'), 3);
  assert.equal(hourOf(a(3), 'America/New_York'), 22);
  assert.equal(hourOf(a(3), 'Asia/Tokyo'), 12);
  assert.equal(hourOf(a(3), 'Mars/Olympus'), 3, 'un fuseau inconnu vaut UTC');

  const b = recordAttempt(undefined, 'epic', true, a(3), 'America/New_York');
  assert.equal(b.stores.epic.n[22], 1);
  assert.equal(b.stores.epic.c[22], 1);
  assert.equal(b.stores.epic.n[3], 0);
});

test('un essai sans defi compte un essai et zero defi', () => {
  const b = recordAttempt(undefined, 'gog', false, a(10), 'UTC');
  assert.equal(b.stores.gog.n[10], 1);
  assert.equal(b.stores.gog.c[10], 0);
});

test('enregistrer ne modifie pas les statistiques recues, et ignore un magasin ou un instant absents', () => {
  const avant = recordAttempt(undefined, 'epic', false, a(10), 'UTC');
  const copie = JSON.stringify(avant);
  recordAttempt(avant, 'epic', true, a(11), 'UTC');
  assert.equal(JSON.stringify(avant), copie);
  assert.equal(JSON.stringify(recordAttempt(avant, '', true, a(11), 'UTC')), copie);
  assert.equal(JSON.stringify(recordAttempt(avant, 'epic', true, NaN, 'UTC')), copie);
});

test('au-dela du plafond, les compteurs sont divises par deux : le profil suit le magasin', () => {
  let b = readBreath({ stores: { epic: { n: new Array(HOURS).fill(Math.floor(MAX_TOTAL / HOURS)), c: new Array(HOURS).fill(2) } } });
  const avant = b.stores.epic.n.reduce((x, y) => x + y, 0);
  assert.ok(avant <= MAX_TOTAL);
  for (let i = 0; i < 30; i++) b = recordAttempt(b, 'epic', false, a(10), 'UTC');
  const apres = b.stores.epic.n.reduce((x, y) => x + y, 0);
  assert.ok(apres <= MAX_TOTAL, String(apres));
  assert.ok(b.stores.epic.c.every((c, h) => c <= b.stores.epic.n[h]));
});

/* ------------------------------------------------------------------ le profil */

test('pas de profil sans assez d\'essais ET assez de defis (garde-fou 1)', () => {
  // Beaucoup d'essais, trop peu de defis.
  const peu = stats('epic', { 18: [10, 4] }, 4); // 4 defis, 26*... essais
  assert.equal(profile(peu, 'epic').challenges, 4);
  assert.ok(profile(peu, 'epic').total >= MIN_ATTEMPTS);
  assert.equal(profile(peu, 'epic').enough, false, 'quatre defis ne font pas un profil');

  // Beaucoup de defis, trop peu d'essais.
  const court = { stores: { epic: { n: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], c: [6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] } } };
  assert.equal(profile(court, 'epic').enough, false);

  assert.equal(profile(SOIR, 'epic').enough, true);
  assert.ok(MIN_CHALLENGES <= profile(SOIR, 'epic').challenges);
});

test('un magasin inconnu n\'a pas de profil, et aucune heure n\'y est mauvaise', () => {
  const p = profile(SOIR, 'gog');
  assert.equal(p.enough, false);
  assert.ok(p.bad.every((x) => x === false));
});

test('une heure est mauvaise seulement avec assez d\'essais, assez de defis, et un taux double du taux moyen', () => {
  const p = profile(SOIR, 'epic');
  assert.equal(p.bad[18], true);
  assert.equal(p.bad[19], true);
  assert.equal(p.bad[3], false);

  // Un defi isole, a 3 h, sur un seul essai : ne ferme pas la nuit.
  const isole = stats('epic', { 18: [10, 6], 19: [10, 5], 3: [1, 1] });
  assert.equal(profile(isole, 'epic').bad[3], false);

  // Assez d'essais et de defis, mais un taux qui ne sort pas du lot : un magasin aussi gris a toute heure n'a rien a eviter.
  const parHeure = {};
  for (let h = 0; h < HOURS; h++) parHeure[h] = [10, 3];
  const plat = stats('epic', parHeure);
  assert.equal(profile(plat, 'epic').enough, true);
  assert.equal(profile(plat, 'epic').bad.some(Boolean), false, 'tout est aussi gris : rien n\'est a eviter');
});

/* --------------------------------------------------------------- la decision */

const FIN_LOINTAINE = (now) => now + 3 * DAY;

test('heure mauvaise, offre qui peut attendre : on vise le debut de la premiere heure calme', () => {
  const now = a(18, 20);
  const d = decide({ breath: SOIR, store: 'epic', end: FIN_LOINTAINE(now), now, zone: 'UTC' });
  assert.equal(d.wait, true);
  assert.equal(iso(d.until), '2026-12-03T20:00:00.000Z', '18 h et 19 h sont mauvaises, 20 h est calme');
});

test('heure calme : on ne decale rien', () => {
  const now = a(10, 5);
  assert.deepEqual(decide({ breath: SOIR, store: 'epic', end: FIN_LOINTAINE(now), now, zone: 'UTC' }), { wait: false });
});

test('jamais au-dela de la fin d\'offre : une offre qui finit dans moins de vingt-quatre heures n\'attend pas (garde-fou 3)', () => {
  const now = a(18, 20);
  assert.deepEqual(decide({ breath: SOIR, store: 'epic', end: now + URGENT_MS - 1, now, zone: 'UTC' }), { wait: false });
  assert.equal(decide({ breath: SOIR, store: 'epic', end: now + URGENT_MS, now, zone: 'UTC' }).wait, true, 'pile vingt-quatre heures : elle peut attendre');
});

test('une offre dont on ne connait pas la fin n\'est jamais decalee', () => {
  const now = a(18, 20);
  for (const end of [null, undefined, NaN]) {
    assert.deepEqual(decide({ breath: SOIR, store: 'epic', end, now, zone: 'UTC' }), { wait: false });
  }
});

test('l\'attente ne depasse jamais douze heures : sans heure calme dans la fenetre, on n\'attend pas', () => {
  // Treize heures de suite sont mauvaises (11 h a 23 h), le reste de la journee est tranquille et bien fourni en essais.
  const parHeure = {};
  for (let h = 11; h <= 23; h++) parHeure[h] = [10, 6];
  const long = stats('epic', parHeure, 60);
  assert.equal(profile(long, 'epic').bad.filter(Boolean).length, 13);

  // A 11 h 20, la premiere heure calme est minuit : douze heures quarante plus loin, au-dela du maximum.
  const tot = a(11, 20);
  assert.deepEqual(decide({ breath: long, store: 'epic', end: FIN_LOINTAINE(tot), now: tot, zone: 'UTC' }), { wait: false });

  // A 12 h 20, minuit est a onze heures quarante : on attend, et l'attente reste sous le maximum.
  const apres = a(12, 20);
  const d = decide({ breath: long, store: 'epic', end: FIN_LOINTAINE(apres), now: apres, zone: 'UTC' });
  assert.equal(d.wait, true);
  assert.equal(iso(d.until), '2026-12-04T00:00:00.000Z');
  assert.ok(d.until - apres <= MAX_WAIT_MS);
  assert.ok(d.until < FIN_LOINTAINE(apres) - MAX_WAIT_MS, 'il reste au moins la moitie du delai avant la fin');
});

test('la decision se lit a l\'heure LOCALE : le meme instant est mauvais a New York, pas a Paris', () => {
  // SOIR est ecrit en heures locales. 23:20 UTC = 18:20 a New York (mauvaise), 00:20 a Paris (calme).
  const now = Date.UTC(2026, 11, 3, 23, 20, 0);
  assert.equal(decide({ breath: SOIR, store: 'epic', end: FIN_LOINTAINE(now), now, zone: 'America/New_York' }).wait, true);
  assert.equal(decide({ breath: SOIR, store: 'epic', end: FIN_LOINTAINE(now), now, zone: 'Europe/Paris' }).wait, false);
});

test('un fuseau a demi-heure vise le vrai debut de l\'heure locale', () => {
  // Kolkata = UTC+5:30. 18:20 locale = 12:50 UTC ; la prochaine heure locale pleine est 19:00 locale = 13:30 UTC (mauvaise), puis 20:00 = 14:30 UTC.
  const now = Date.UTC(2026, 11, 3, 12, 50, 0);
  const d = decide({ breath: SOIR, store: 'epic', end: FIN_LOINTAINE(now), now, zone: 'Asia/Kolkata' });
  assert.equal(d.wait, true);
  assert.equal(iso(d.until), '2026-12-03T14:30:00.000Z');
});

test('un magasin sans profil n\'est jamais decale, meme a l\'heure d\'un autre', () => {
  const now = a(18, 20);
  assert.deepEqual(decide({ breath: SOIR, store: 'gog', end: FIN_LOINTAINE(now), now, zone: 'UTC' }), { wait: false });
});

test('heldKeys : l\'ensemble des offres a ne pas tenter maintenant', () => {
  const now = a(18, 20);
  const offres = [
    { catalogKey: 'epic:a', store: 'epic', end: now + 3 * DAY },
    { catalogKey: 'epic:b', store: 'epic', end: now + 2 * H }, // urgente
    { catalogKey: 'gog:c', store: 'gog', end: now + 3 * DAY }, // pas de profil
    { catalogKey: 'epic:d', store: 'epic', end: null }, // fin inconnue
    null,
    { store: 'epic', end: now + 3 * DAY }, // sans cle
  ];
  assert.deepEqual([...heldKeys(offres, { breath: SOIR, now, zone: 'UTC' })], ['epic:a']);
  assert.equal(heldKeys(undefined, { breath: SOIR, now, zone: 'UTC' }).size, 0);
});
