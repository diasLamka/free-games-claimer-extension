/* Les grandes saisons : les semaines ou un jeu tombe chaque jour.
 *
 * Tous les instants sont des instants UTC explicites et tous les fuseaux sont
 * nommes : rien ici ne depend du fuseau de la machine qui execute les tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validRule,
  validSeason,
  inSeason,
  nextOccurrence,
  nextOccurrences,
} from '../watch/schedule/clock.js';
import {
  KEY_SEASONS,
  DEFAULT_SEASON,
  readSeasons,
  seasonRules,
  withSeasons,
  seasonStatus,
  startsOf,
  dailyRun,
  projectDailyRun,
} from '../watch/schedule/seasons.js';
import { DEFAULT_SCHEDULES, schedulesWithDefaults } from '../watch/schedule/rules.js';
import { NAME as EPIC } from '../watch/sources/epic.js';
import { readContext } from '../watch/storage.js';
import { fakeChrome } from './fake-chrome.mjs';

const NY = 'America/New_York';
const H = 3600000;
const DAY = 24 * H;
const iso = (t) => new Date(t).toISOString();
const utc = (s) => Date.parse(s);

const FETES = { from: { month: 12, day: 15 }, until: { month: 1, day: 2 } };

/* ------------------------------------------------- le calendrier, dans clock */

test('une saison valide a deux bornes jour-mois, fevrier compris', () => {
  assert.equal(validSeason(FETES), true);
  assert.equal(validSeason({ from: { month: 2, day: 29 }, until: { month: 3, day: 1 } }), true);

  assert.equal(validSeason(null), false);
  assert.equal(validSeason({ from: { month: 12, day: 15 } }), false, 'sans fin');
  assert.equal(validSeason({ from: { month: 13, day: 1 }, until: { month: 1, day: 2 } }), false);
  assert.equal(validSeason({ from: { month: 2, day: 30 }, until: { month: 3, day: 1 } }), false);
  assert.equal(validSeason({ from: { month: 4, day: 31 }, until: { month: 5, day: 1 } }), false);
  assert.equal(validSeason({ from: { month: 0, day: 1 }, until: { month: 1, day: 2 } }), false);
  assert.equal(validSeason({ from: { month: 12, day: 15.5 }, until: { month: 1, day: 2 } }), false);
});

test('une regle avec une saison invalide est refusee', () => {
  const base = { zone: NY, daily: true, hour: 11 };
  assert.equal(validRule({ ...base, season: FETES }), true);
  assert.equal(validRule({ ...base, season: { from: { month: 99, day: 1 }, until: { month: 1, day: 2 } } }), false);
  assert.equal(validRule({ ...base, season: 'noel' }), false);
  assert.equal(validRule({ ...base, season: null }), false, 'null n\'est pas une absence de saison');
  assert.equal(validRule(base), true, 'sans saison : toute l\'annee, comme avant');
});

test('inSeason : bornes comprises, et une saison qui enjambe le nouvel an', () => {
  assert.equal(inSeason(FETES, 12, 14), false);
  assert.equal(inSeason(FETES, 12, 15), true, 'premier jour');
  assert.equal(inSeason(FETES, 12, 31), true);
  assert.equal(inSeason(FETES, 1, 1), true);
  assert.equal(inSeason(FETES, 1, 2), true, 'dernier jour');
  assert.equal(inSeason(FETES, 1, 3), false);
  assert.equal(inSeason(FETES, 7, 4), false);

  const ete = { from: { month: 6, day: 20 }, until: { month: 7, day: 5 } };
  assert.equal(inSeason(ete, 6, 19), false);
  assert.equal(inSeason(ete, 6, 20), true);
  assert.equal(inSeason(ete, 7, 5), true);
  assert.equal(inSeason(ete, 7, 6), false);

  assert.equal(inSeason(undefined, 3, 3), true, 'pas de saison : toujours');
});

test('prochaineOccurrence : une regle de saison saute tout ce qui est hors saison', () => {
  const rule = { zone: NY, daily: true, hour: 11, season: FETES };

  // Le 5 novembre : rien avant le 15 decembre, 11:00 a New York (EST) = 16:00Z.
  assert.equal(iso(nextOccurrence(rule, utc('2026-11-05T00:00:00Z')).instant), '2026-12-15T16:00:00.000Z');
  // En pleine saison : le lendemain, pas le prochain jeudi.
  assert.equal(iso(nextOccurrence(rule, utc('2026-12-20T16:00:01Z')).instant), '2026-12-21T16:00:00.000Z');
  // A la fin de la saison : on saute a l'annee suivante.
  assert.equal(iso(nextOccurrence(rule, utc('2027-01-02T16:00:01Z')).instant), '2027-12-15T16:00:00.000Z');
});

test('prochaineOccurrence : la saison traverse le nouvel an sans trou', () => {
  const rule = { zone: NY, daily: true, hour: 11, season: FETES };
  const jours = nextOccurrences(rule, utc('2026-12-30T00:00:00Z'), 5).map((o) => iso(o.instant).slice(0, 10));
  assert.deepEqual(jours, ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-12-15']);
});

test('la saison se lit dans le calendrier LOCAL de la regle, pas en UTC', () => {
  // 23:00 a New York le 2 janvier = 04:00Z le 3 : en UTC on serait deja hors saison.
  const rule = { zone: NY, daily: true, hour: 23, season: FETES };
  const o = nextOccurrence(rule, utc('2027-01-02T12:00:00Z'));
  assert.equal(iso(o.instant), '2027-01-03T04:00:00.000Z');
  assert.equal(o.day, 2, 'le jour local est bien le 2');
});

test('une saison peut se combiner a des jours de semaine', () => {
  // Les jeudis de la saison seulement.
  const rule = { zone: NY, dayCount: [4], hour: 11, season: FETES };
  const jours = nextOccurrences(rule, utc('2026-12-01T00:00:00Z'), 3).map((o) => iso(o.instant).slice(0, 10));
  assert.deepEqual(jours, ['2026-12-17', '2026-12-24', '2026-12-31']);
});

/* --------------------------------------------------------------- le reglage */

test('le reglage absent ou abime vaut le defaut : actif, 15 decembre - 2 janvier', () => {
  for (const raw of [undefined, null, {}, 'oui', 42, [], { on: 'x' }]) {
    const s = readSeasons(raw);
    assert.equal(s.on, true, JSON.stringify(raw));
    assert.deepEqual(s.from, DEFAULT_SEASON.from);
    assert.deepEqual(s.until, DEFAULT_SEASON.until);
  }
});

test('le reglage : on peut couper la saison et changer ses dates', () => {
  assert.equal(readSeasons({ on: false }).on, false);

  const s = readSeasons({ on: true, from: { month: 6, day: 20 }, until: { month: 7, day: 5 } });
  assert.deepEqual(s.from, { month: 6, day: 20 });
  assert.deepEqual(s.until, { month: 7, day: 5 });
});

test('une paire de bornes invalide est rejetee ENTIERE', () => {
  // Une borne valide et une absurde : on ne fabrique pas une saison hybride.
  const s = readSeasons({ from: { month: 6, day: 20 }, until: { month: 14, day: 1 } });
  assert.deepEqual(s.from, DEFAULT_SEASON.from);
  assert.deepEqual(s.until, DEFAULT_SEASON.until);

  const t = readSeasons({ from: { month: 6, day: 20 } });
  assert.deepEqual(t.from, DEFAULT_SEASON.from, 'la borne seule n\'est pas retenue');
});

test('readSeasons rend des copies : modifier le resultat ne touche pas le defaut', () => {
  const s = readSeasons(undefined);
  s.from.month = 1;
  assert.equal(DEFAULT_SEASON.from.month, 12);
});

test('seasonRules : une regle quotidienne valide, a l\'heure d\'Epic', () => {
  const [r, ...reste] = seasonRules(undefined);
  assert.equal(reste.length, 0);
  assert.equal(validRule(r), true);
  assert.equal(r.zone, NY);
  assert.equal(r.daily, true);
  assert.equal(r.hour, 11);
  assert.equal(r.minute, 0);
  assert.deepEqual(r.season, FETES);

  assert.deepEqual(seasonRules({ on: false }), [], 'coupee : aucune regle');
});

test('withSeasons : la saison s\'ajoute a la regle du jeudi, sans la remplacer', () => {
  const base = schedulesWithDefaults(undefined);
  const avec = withSeasons(base, undefined, undefined);
  assert.equal(avec[EPIC].length, 2);
  assert.deepEqual(avec[EPIC][0], DEFAULT_SCHEDULES[EPIC][0], 'le jeudi est intact');
  assert.equal(avec[EPIC][1].daily, true);
  assert.equal(base[EPIC].length, 1, 'l\'entree n\'est pas modifiee');
});

test('withSeasons : coupee, elle ne change rien', () => {
  const base = schedulesWithDefaults(undefined);
  assert.equal(withSeasons(base, { on: false }, undefined), base);
});

test('withSeasons : une liste Epic videe par l\'utilisateur n\'est pas rallumee', () => {
  const stored = { [EPIC]: [] };
  const base = schedulesWithDefaults(stored);
  assert.deepEqual(base[EPIC], []);
  assert.deepEqual(withSeasons(base, undefined, stored)[EPIC], []);
});

test('withSeasons : les regles que l\'utilisateur a posees pour Epic gardent leur place', () => {
  const sienne = { zone: 'UTC', dayCount: [2], hour: 9 };
  const stored = { [EPIC]: [sienne] };
  const avec = withSeasons(schedulesWithDefaults(stored), undefined, stored);
  assert.deepEqual(avec[EPIC][0], sienne);
  assert.equal(avec[EPIC].length, 2);
});

test('seasonStatus : en saison, en attente, coupee -- lu a New York', () => {
  assert.deepEqual(seasonStatus(undefined, utc('2026-12-20T12:00:00Z')), { state: 'on', until: FETES.until });
  assert.deepEqual(seasonStatus(undefined, utc('2026-11-05T12:00:00Z')), { state: 'soon', from: FETES.from });
  assert.deepEqual(seasonStatus({ on: false }, utc('2026-12-20T12:00:00Z')), { state: 'off' });

  // 03:00 a Paris le 15 decembre = 21:00 le 14 a New York : pas encore.
  assert.equal(seasonStatus(undefined, utc('2026-12-15T02:00:00Z')).state, 'soon');
  // 09:00 a Paris le 15 = 03:00 le 15 a New York : c'est commence.
  assert.equal(seasonStatus(undefined, utc('2026-12-15T08:00:00Z')).state, 'on');
  // Le 2 janvier a 22:00 a New York est le dernier jour ; le 3 a 00:30 non.
  assert.equal(seasonStatus(undefined, utc('2027-01-03T03:00:00Z')).state, 'on');
  assert.equal(seasonStatus(undefined, utc('2027-01-03T05:30:00Z')).state, 'soon');
});

/* ----------------------------------------------------------- dans le stockage */

test('readContext ajoute la saison aux regles d\'Epic, et la coupe sur demande', async () => {
  const faux = fakeChrome({ now: utc('2026-11-05T12:00:00Z') });
  const contexte = await readContext(faux.chrome);
  assert.equal(contexte.schedules[EPIC].length, 2, 'defaut : le jeudi et la saison');

  await faux.chrome.storage.local.set({ [KEY_SEASONS]: { on: false } });
  const coupe = await readContext(faux.chrome);
  assert.equal(coupe.schedules[EPIC].length, 1, 'coupee : le jeudi seul');

  await faux.chrome.storage.local.set({
    [KEY_SEASONS]: { on: true, from: { month: 6, day: 20 }, until: { month: 7, day: 5 } },
  });
  const juin = await readContext(faux.chrome);
  assert.deepEqual(juin.schedules[EPIC][1].season.from, { month: 6, day: 20 });
});

/* --------------------------------------------------------------- detection */

test('dailyRun : trois ouvertures d\'un jour d\'ecart font un regime', () => {
  const starts = ['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z', '2026-12-17T16:00:00Z'].map(utc);
  const run = dailyRun(starts);
  assert.equal(run.length, 3);
  assert.equal(iso(run.first), '2026-12-15T16:00:00.000Z');
  assert.equal(iso(run.last), '2026-12-17T16:00:00.000Z');
});

test('dailyRun : deux ouvertures ne suffisent pas', () => {
  assert.equal(dailyRun(['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z'].map(utc)), null);
  assert.equal(dailyRun([]), null);
  assert.equal(dailyRun(undefined), null);
});

test('dailyRun : la semaine ordinaire (un jeudi sur sept) n\'est pas un regime quotidien', () => {
  const jeudis = ['2026-12-03T16:00:00Z', '2026-12-10T16:00:00Z', '2026-12-17T16:00:00Z', '2026-12-24T16:00:00Z'].map(utc);
  assert.equal(dailyRun(jeudis), null);
});

test('dailyRun : un trou de deux jours coupe la suite', () => {
  const starts = ['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z', '2026-12-18T16:00:00Z', '2026-12-19T16:00:00Z'].map(utc);
  assert.equal(dailyRun(starts), null, 'deux et deux, pas quatre');
});

test('dailyRun : desordre et doublons ne changent rien', () => {
  const starts = [
    '2026-12-17T16:00:00Z', '2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z',
    '2026-12-16T16:00:00Z', '2026-12-16T16:10:00Z', // deux jeux ensemble : un seul jour
  ].map(utc);
  assert.equal(dailyRun(starts).length, 3);
});

test('dailyRun : un changement d\'heure (23 ou 25 h) reste un jour', () => {
  // Le 1er novembre 2026 a New York : 25 h entre deux 11:00.
  const starts = ['2026-10-30T15:00:00Z', '2026-10-31T15:00:00Z', '2026-11-01T16:00:00Z'].map(utc);
  assert.equal(dailyRun(starts).length, 3);
});

test('dailyRun : rend la suite la plus recente quand il y en a deux', () => {
  const vieux = ['2026-06-01T16:00:00Z', '2026-06-02T16:00:00Z', '2026-06-03T16:00:00Z'].map(utc);
  const neuf = ['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z', '2026-12-17T16:00:00Z', '2026-12-18T16:00:00Z'].map(utc);
  const run = dailyRun([...vieux, ...neuf]);
  assert.equal(run.length, 4);
  assert.equal(iso(run.first), '2026-12-15T16:00:00.000Z');
});

test('projectDailyRun : le lendemain, a la meme heure de New York', () => {
  const starts = ['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z', '2026-12-17T16:00:00Z'].map(utc);
  const now = utc('2026-12-17T17:00:00Z');
  assert.deepEqual(projectDailyRun(starts, now).map(iso), ['2026-12-18T16:00:00.000Z']);
});

test('projectDailyRun : la meme heure MURALE, y compris au changement d\'heure', () => {
  // Les 30 et 31 octobre a 11:00 EDT, puis le 1er novembre a 11:00 EST.
  const starts = ['2026-10-30T15:00:00Z', '2026-10-31T15:00:00Z', '2026-11-01T16:00:00Z'].map(utc);
  const now = utc('2026-11-01T17:00:00Z');
  assert.deepEqual(projectDailyRun(starts, now).map(iso), ['2026-11-02T16:00:00.000Z']);
});

test('projectDailyRun : les ouvertures deja annoncees dans le futur comptent aussi', () => {
  // Epic annonce trois jours d'avance : on attend le quatrieme.
  const starts = ['2026-12-18T16:00:00Z', '2026-12-19T16:00:00Z', '2026-12-20T16:00:00Z'].map(utc);
  const now = utc('2026-12-17T12:00:00Z');
  assert.deepEqual(projectDailyRun(starts, now).map(iso), ['2026-12-21T16:00:00.000Z']);
});

test('projectDailyRun : un regime fini depuis plus d\'un jour et demi ne prolonge rien', () => {
  const starts = ['2026-12-15T16:00:00Z', '2026-12-16T16:00:00Z', '2026-12-17T16:00:00Z'].map(utc);
  assert.deepEqual(projectDailyRun(starts, utc('2026-12-19T12:00:00Z')), []);
  assert.deepEqual(
    projectDailyRun(starts, utc('2026-12-18T20:00:00Z')).map(iso),
    ['2026-12-18T16:00:00.000Z'],
    'encore dans la fenetre : la projection est rendue, le planificateur la jugera passee',
  );
});

test('projectDailyRun : sans regime, rien', () => {
  assert.deepEqual(projectDailyRun([utc('2026-12-17T16:00:00Z')], utc('2026-12-17T17:00:00Z')), []);
  assert.deepEqual(projectDailyRun([], 0), []);
});

test('startsOf : le debut des offres d\'une source, recentes, numeriques', () => {
  const now = utc('2026-12-17T17:00:00Z');
  const catalog = {
    a: { source: EPIC, start: utc('2026-12-16T16:00:00Z') },
    b: { source: EPIC, start: utc('2026-12-15T16:00:00Z') },
    c: { source: 'gog', start: utc('2026-12-16T16:00:00Z') },
    d: { source: EPIC, start: null },
    e: { source: EPIC, start: utc('2026-01-01T16:00:00Z') }, // trop ancien
    f: null,
  };
  const out = startsOf(catalog, EPIC, now).sort((x, y) => x - y);
  assert.deepEqual(out.map(iso), ['2026-12-15T16:00:00.000Z', '2026-12-16T16:00:00.000Z']);
  assert.deepEqual(startsOf(undefined, EPIC, now), []);
});

test('de bout en bout : en saison, le planificateur est chaud chaque jour a 11:00 de New York', async () => {
  const { hotInstants, isHot, nextHotStart, scheduleSource, REGIMES } = await import('../watch/schedule/scheduler.js');
  const avec = withSeasons(schedulesWithDefaults(undefined), undefined, undefined)[EPIC];
  const sans = schedulesWithDefaults(undefined)[EPIC];

  // Un dimanche de decembre, 17:00Z : l'ouverture du jour est passee de plus d'une heure.
  const now = utc('2026-12-20T17:00:00Z');
  assert.equal(new Date(now).getUTCDay(), 0, 'c\'est bien un dimanche');

  // Avec la saison, le prochain creneau chaud est LE LENDEMAIN, 30 minutes avant 16:00Z.
  assert.equal(iso(nextHotStart(hotInstants({ rules: avec }, now), now)), '2026-12-21T15:30:00.000Z');
  // Sans elle, il faut attendre le jeudi.
  assert.equal(iso(nextHotStart(hotInstants({ rules: sans }, now), now)), '2026-12-24T15:30:00.000Z');

  // Pendant l'ouverture d'un jour ordinaire de la saison : regime chaud.
  const pendant = utc('2026-12-22T16:10:00Z');
  assert.equal(isHot(hotInstants({ rules: avec }, pendant), pendant), true);
  assert.equal(isHot(hotInstants({ rules: sans }, pendant), pendant), false);
  const chaud = scheduleSource({ source: EPIC, state: { lastCall: pendant - 10 * 60000 }, settings: {}, rules: avec, now: pendant });
  assert.equal(chaud.regime, REGIMES.HOT);
  const plancher = scheduleSource({ source: EPIC, state: { lastCall: pendant - 10 * 60000 }, settings: {}, rules: sans, now: pendant });
  assert.equal(plancher.regime, REGIMES.FLOOR);

  // Hors saison, rien ne change : un mardi de novembre n'est pas chaud.
  const novembre = utc('2026-11-10T16:10:00Z');
  assert.equal(isHot(hotInstants({ rules: avec }, novembre), novembre), false);
});
