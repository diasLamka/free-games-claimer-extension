/* Tests des horaires ancres sur un fuseau nomme.
 *
 * Tous les vecteurs ont ete verifies par execution reelle avant d'etre ecrits
 * ici : ce fichier asserte un comportement mesure, pas un comportement espere.
 *
 * Les tests sont independants du fuseau de la machine qui les execute : rien
 * n'utilise l'heure locale du systeme, tout passe par des fuseaux nommes et
 * des instants UTC explicites.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validZone,
  localParts,
  offset,
  instantFromLocal,
  validRule,
  nextOccurrence,
  nextOccurrences,
} from '../watch/schedule/clock.js';

const NY = 'America/New_York';
const PARIS = 'Europe/Paris';
const H = 3600000;

const iso = (t) => new Date(t).toISOString();

/* ------------------------------------------------------------------ bases */

test('fuseauValide distingue un fuseau connu d\'une chaine inventee', () => {
  assert.equal(validZone('UTC'), true);
  assert.equal(validZone(NY), true);
  assert.equal(validZone(PARIS), true);
  assert.equal(validZone('Mars/Olympus'), false);
  assert.equal(validZone(''), false);
  assert.equal(validZone(null), false);
});

test('partiesLocales rend minuit comme 0, pas comme 24', () => {
  // Piege classique de Intl : sans hourCycle h23, minuit se formate "24".
  const p = localParts(Date.UTC(2026, 7, 27, 0, 0, 0), 'UTC');
  assert.equal(p.hour, 0);
  assert.equal(p.day, 27);
  assert.equal(p.weekday, 4); // jeudi
});

test('decalage rend le decalage du fuseau a l\'instant donne', () => {
  assert.equal(offset(Date.parse('2026-01-15T12:00:00Z'), NY), -5 * H);   // EST
  assert.equal(offset(Date.parse('2026-07-15T12:00:00Z'), NY), -4 * H);   // EDT
  assert.equal(offset(Date.parse('2026-01-15T12:00:00Z'), PARIS), 1 * H); // CET
  assert.equal(offset(Date.parse('2026-07-15T12:00:00Z'), PARIS), 2 * H); // CEST
  assert.equal(offset(Date.parse('2026-07-15T12:00:00Z'), 'UTC'), 0);
});

/* ------------------------------------------ le piege des fuseaux desynchronises */

test('11:00 a New York ne vaut pas toujours 17:00 a Paris', () => {
  // C'est LA raison d'etre de ce module. En 2026, les Etats-Unis passent a
  // l'heure d'ete le 8 mars et l'Europe le 29 mars : pendant ces trois
  // semaines, l'ecart tombe de 6 h a 5 h. Une regle ecrite "17:00 a Paris"
  // rate le drop d'une heure, deux fois par an.
  const onzeHeuresNy = (year, month, day) =>
    instantFromLocal(NY, { year, month, day, hour: 11 }).instant;

  // Avant les deux transitions : 16:00 UTC, soit 17:00 a Paris.
  assert.equal(iso(onzeHeuresNy(2026, 3, 5)), '2026-03-05T16:00:00.000Z');
  // Entre les deux : 15:00 UTC, soit 16:00 a Paris.
  assert.equal(iso(onzeHeuresNy(2026, 3, 12)), '2026-03-12T15:00:00.000Z');
  assert.equal(iso(onzeHeuresNy(2026, 3, 26)), '2026-03-26T15:00:00.000Z');
  // Apres les deux : 15:00 UTC, et de nouveau 17:00 a Paris.
  assert.equal(iso(onzeHeuresNy(2026, 4, 2)), '2026-04-02T15:00:00.000Z');

  // Meme phenomene a l'automne, dans l'autre sens : l'Europe repasse a
  // l'heure d'hiver le 25 octobre, les Etats-Unis le 1er novembre.
  assert.equal(iso(onzeHeuresNy(2026, 10, 22)), '2026-10-22T15:00:00.000Z');
  assert.equal(iso(onzeHeuresNy(2026, 10, 29)), '2026-10-29T15:00:00.000Z');
  assert.equal(iso(onzeHeuresNy(2026, 11, 5)), '2026-11-05T16:00:00.000Z');
});

test('l\'heure vue depuis Paris change bien pendant la fenetre de desynchronisation', () => {
  const heureAParis = (t) => localParts(t, PARIS).hour;
  const onzeNy = (month, day) => instantFromLocal(NY, { year: 2026, month, day, hour: 11 }).instant;

  assert.equal(heureAParis(onzeNy(3, 5)), 17);
  assert.equal(heureAParis(onzeNy(3, 12)), 16, 'la desynchronisation de mars n\'est pas reproduite');
  assert.equal(heureAParis(onzeNy(4, 2)), 17);
  assert.equal(heureAParis(onzeNy(10, 29)), 16, 'la desynchronisation d\'octobre n\'est pas reproduite');
  assert.equal(heureAParis(onzeNy(11, 5)), 17);
});

/* --------------------------------------------------- cas pathologiques */

test('une heure murale inexistante tombe apres le trou, dans les deux sens de transition', () => {
  // Mesure : laisse a lui-meme, le point fixe convergeait a 01:30 pour New
  // York et 03:30 pour Paris sur la meme demande. La convention est imposee.
  const ny = instantFromLocal(NY, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  assert.equal(ny.exact, false);
  assert.equal(iso(ny.instant), '2026-03-08T07:30:00.000Z');
  assert.equal(localParts(ny.instant, NY).hour, 3);

  const paris = instantFromLocal(PARIS, { year: 2026, month: 3, day: 29, hour: 2, minute: 30 });
  assert.equal(paris.exact, false);
  assert.equal(localParts(paris.instant, PARIS).hour, 3);
});

test('une heure murale ambigue rend la premiere occurrence, encore en heure d\'ete', () => {
  const ny = instantFromLocal(NY, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 });
  assert.equal(ny.exact, true);
  assert.equal(iso(ny.instant), '2026-11-01T05:30:00.000Z');
  assert.equal(offset(ny.instant, NY), -4 * H, 'ce n\'est pas la premiere occurrence');

  const paris = instantFromLocal(PARIS, { year: 2026, month: 10, day: 25, hour: 2, minute: 30 });
  assert.equal(paris.exact, true);
  assert.equal(offset(paris.instant, PARIS), 2 * H, 'ce n\'est pas la premiere occurrence');
});

test('un aller-retour heure locale -> instant -> heure locale est stable hors transition', () => {
  for (const zone of [NY, PARIS, 'UTC', 'Asia/Tokyo', 'Australia/Sydney']) {
    for (const month of [1, 4, 7, 10]) {
      const demande = { year: 2026, month, day: 15, hour: 11, minute: 0 };
      const { instant, exact } = instantFromLocal(zone, demande);
      assert.equal(exact, true, `${zone} mois ${month}`);
      const reread = localParts(instant, zone);
      assert.equal(reread.hour, 11, `${zone} mois ${month}`);
      assert.equal(reread.day, 15, `${zone} mois ${month}`);
    }
  }
});

/* ------------------------------------------------------------------ regles */

test('regleValide refuse ce qui ne peut pas se planifier', () => {
  assert.equal(validRule({ zone: NY, dayCount: [4], hour: 11 }), true);
  assert.equal(validRule({ zone: 'UTC', daily: true, hour: 0, minute: 0 }), true);

  assert.equal(validRule(null), false);
  assert.equal(validRule({ zone: 'Mars/Olympus', dayCount: [4], hour: 11 }), false);
  assert.equal(validRule({ zone: NY, hour: 11 }), false, 'ni jours ni quotidien');
  assert.equal(validRule({ zone: NY, dayCount: [], hour: 11 }), false);
  assert.equal(validRule({ zone: NY, dayCount: [7], hour: 11 }), false);
  assert.equal(validRule({ zone: NY, dayCount: [4], hour: 24 }), false);
  assert.equal(validRule({ zone: NY, dayCount: [4], hour: -1 }), false);
  assert.equal(validRule({ zone: NY, dayCount: [4], hour: 11, minute: 60 }), false);
  assert.equal(validRule({ zone: NY, dayCount: [4], hour: 11.5 }), false);
});

/* --------------------------------------------------------- occurrences */

test('prochaineOccurrence trouve le prochain jeudi 11:00 a New York', () => {
  const rule = { zone: NY, dayCount: [4], hour: 11 };

  // Un mardi -> le jeudi suivant.
  assert.equal(
    iso(nextOccurrence(rule, Date.parse('2026-03-03T12:00:00Z')).instant),
    '2026-03-05T16:00:00.000Z',
  );
  // Un jeudi juste apres l'heure -> le jeudi d'apres, pas aujourd'hui.
  assert.equal(
    iso(nextOccurrence(rule, Date.parse('2026-03-05T16:00:01Z')).instant),
    '2026-03-12T15:00:00.000Z',
  );
  // Un jeudi juste avant l'heure -> aujourd'hui.
  assert.equal(
    iso(nextOccurrence(rule, Date.parse('2026-03-05T15:59:59Z')).instant),
    '2026-03-05T16:00:00.000Z',
  );
});

test('prochaineOccurrence est strictement posterieure a l\'instant donne', () => {
  const rule = { zone: NY, dayCount: [4], hour: 11 };
  const pile = Date.parse('2026-03-05T16:00:00Z');
  const o = nextOccurrence(rule, pile);
  assert.ok(o.instant > pile, 'une occurrence a l\'instant pile a ete rendue');
});

test('une regle a plusieurs jours rend le plus proche', () => {
  // Lundi et jeudi.
  const rule = { zone: 'UTC', dayCount: [1, 4], hour: 12 };
  assert.equal(
    iso(nextOccurrence(rule, Date.parse('2026-08-25T13:00:00Z')).instant),
    '2026-08-27T12:00:00.000Z', // jeudi
  );
  assert.equal(
    iso(nextOccurrence(rule, Date.parse('2026-08-28T13:00:00Z')).instant),
    '2026-08-31T12:00:00.000Z', // lundi
  );
});

test('une regle quotidienne ne derive jamais, meme sur un an', () => {
  // L'iteration se fait sur le calendrier local : ajouter 24 heures deriverait
  // aux changements d'heure, ou un jour dure 23 ou 25 heures.
  const rule = { zone: NY, daily: true, hour: 11 };
  let t = Date.parse('2026-01-01T00:00:00Z');
  let horsHeure = 0;

  for (let i = 0; i < 365; i++) {
    const o = nextOccurrence(rule, t);
    assert.ok(o, `pas d'occurrence au jour ${i}`);
    const p = localParts(o.instant, NY);
    if (p.hour !== 11 || p.minute !== 0) horsHeure++;
    t = o.instant;
  }

  assert.equal(horsHeure, 0, 'derive de l\'heure locale sur un an');
});

test('une regle quotidienne saute bien un jour a chaque fois', () => {
  const rule = { zone: NY, daily: true, hour: 11 };
  const then = nextOccurrences(rule, Date.parse('2026-03-05T12:00:00Z'), 10);
  assert.equal(then.length, 10);

  const dayCount = then.map((o) => `${o.year}-${o.month}-${o.day}`);
  assert.equal(new Set(dayCount).size, 10, 'deux occurrences le meme jour local');

  // La transition du 8 mars est dans l'intervalle : un des ecarts vaut 23 h.
  const ecarts = then.slice(1).map((o, i) => o.instant - then[i].instant);
  assert.ok(ecarts.includes(23 * H), `ecarts observes : ${ecarts.map((e) => e / H)}`);
  assert.ok(ecarts.every((e) => e === 23 * H || e === 24 * H || e === 25 * H));
});

test('prochaineOccurrence rend null sur une regle invalide', () => {
  assert.equal(nextOccurrence(null, Date.now()), null);
  assert.equal(nextOccurrence({ zone: 'Mars/Olympus', daily: true, hour: 1 }, Date.now()), null);
  assert.equal(nextOccurrence({ zone: 'UTC', dayCount: [], hour: 1 }, Date.now()), null);
});

test('prochainesOccurrences s\'arrete proprement sur une regle invalide', () => {
  assert.deepEqual(nextOccurrences(null, Date.now(), 5), []);
});

test('le resultat ne depend pas du fuseau de la machine qui execute', () => {
  // Rien dans le module ne lit l'heure locale du systeme : le meme calcul
  // depuis un instant UTC explicite doit donner le meme instant UTC partout.
  const rule = { zone: NY, dayCount: [4], hour: 11 };
  const t = Date.parse('2026-06-01T00:00:00Z');
  const attendu = '2026-06-04T15:00:00.000Z';
  assert.equal(iso(nextOccurrence(rule, t).instant), attendu);
});
