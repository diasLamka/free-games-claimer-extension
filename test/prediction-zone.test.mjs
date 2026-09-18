/* La prediction derivait d'une heure deux fois par an, et personne ne le voyait.
 *
 * L'histogramme qui apprend « quand regarder » rangeait ses cases en UTC. Un
 * magasin publie a une heure LOCALE : au changement d'heure, toutes ses cases
 * glissent d'une heure, et il faut reaccumuler trois observations dans la
 * nouvelle case avant qu'elle redevienne chaude -- trois semaines pour une
 * source hebdomadaire comme Epic.
 *
 * Le commentaire du module pariait que la decroissance par demi-vie absorbait
 * ce glissement. Le chiffre dit le contraire : la demi-fenetre chaude de
 * l'ordonnanceur vaut 30 MINUTES, donc une derive d'une heure ne la frole meme
 * pas. Elle la rate entierement.
 *
 * Deuxieme defaut, trouve en mesurant le premier : une case couvre une heure
 * pleine, mais l'ordonnanceur ne recevait que son DEBUT. Avec une fenetre de
 * +/- 30 minutes, la seconde moitie de toute case apprise n'etait jamais
 * couverte.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cellKey,
  statZone,
  retuneZone,
  observe,
  learnedHotInstants,
  emptyStat,
} from '../watch/schedule/prediction.js';
import { DEFAULTS as SCHEDULER_DEFAULTS } from '../watch/schedule/scheduler.js';
import { SOURCES } from '../watch/sources/index.js';

/* Epic publie le jeudi a 11:00 heure de New York. Les deux memes rotations,
   de part et d'autre du changement d'heure americain du 1er novembre 2026. */
const ETE = Date.UTC(2026, 8, 24, 15, 0, 0);    // jeudi 24 septembre, 11:00 EDT
const HIVER = Date.UTC(2026, 10, 5, 16, 0, 0);  // jeudi 5 novembre, 11:00 EST

/* --------------------------------------------------- la derive, constatee */

test('en UTC, deux rotations identiques tombent dans deux cases differentes', () => {
  assert.equal(cellKey(ETE), '4-15');
  assert.equal(cellKey(HIVER), '4-16');
});

test('ancrees sur le fuseau du magasin, elles tombent dans la MEME case', () => {
  assert.equal(cellKey(ETE, 'America/New_York'), '4-11');
  assert.equal(cellKey(HIVER, 'America/New_York'), '4-11');
});

test('une derive d\'une heure rate la fenetre chaude, elle ne la frole pas', () => {
  /* C'est ce chiffre qui a decide de la forme du correctif : si la fenetre
     faisait une heure de demi-largeur, une note au CHANGELOG aurait suffi. */
  assert.equal(SCHEDULER_DEFAULTS.hotHalfWindowMs, 30 * 60 * 1000);

  /* Une case qui a glisse d'une heure place l'instant attendu a 60 minutes du
     drop reel, pour une demi-fenetre de 30 : le creneau chaud ne s'ouvre meme
     pas. Si la demi-fenetre avait valu une heure, une note au CHANGELOG aurait
     suffi et ce chantier n'existerait pas. */
  assert.ok(3600000 > SCHEDULER_DEFAULTS.hotHalfWindowMs);
});

/* ------------------------------------------------------- la transposition */

const statUtc = (key, instant) => ({
  cells: { [key]: { weight: 3, observations: 3 } },
  observations: 6,
  lastUpdate: instant,
  zone: null,
});

test('les cases apprises en UTC sont transposees, pas jetees', () => {
  const migre = retuneZone(statUtc('4-15', ETE), 'America/New_York', ETE);

  assert.equal(migre.zone, 'America/New_York');
  assert.deepEqual(migre.cells, { '4-11': { weight: 3, observations: 3 } });
  /* Trois semaines de reapprentissage evitees : c'est tout l'interet de
     transposer plutot que de repartir de zero. */
  assert.equal(migre.observations, 6);
});

test('deux cases qui se rejoignent additionnent leurs poids', () => {
  const stat = {
    cells: { '4-15': { weight: 2, observations: 2 }, '4-16': { weight: 1, observations: 1 } },
    observations: 3,
    lastUpdate: ETE,
    zone: null,
  };
  /* Les deux cases d'une source qui a traverse un changement d'heure en UTC :
     transposees, elles se retrouvent a une heure d'ecart, pas superposees. */
  const migre = retuneZone(stat, 'America/New_York', ETE);
  assert.deepEqual(Object.keys(migre.cells).sort(), ['4-11', '4-12']);
  assert.equal(migre.cells['4-11'].weight, 2);
});

test('un fuseau inconnu de la plateforme retombe sur UTC sans rien casser', () => {
  assert.equal(statZone({ zone: 'Mars/Olympus_Mons' }), 'UTC');
  assert.equal(statZone({ zone: 'America/New_York' }), 'America/New_York');
  assert.equal(statZone(null), 'UTC');
  assert.equal(statZone(emptyStat()), 'UTC');
});

test('observer transpose une fois, puis credite dans le bon fuseau', () => {
  const avant = statUtc('4-15', ETE - 1000);
  const ete = observe(avant, { start: ETE }, { now: ETE, zone: 'America/New_York' });

  assert.equal(ete.zone, 'America/New_York');
  assert.equal(ete.cells['4-11'].observations, 4, 'la case transposee recoit la nouvelle observation');

  /* Et six semaines plus tard, de l'autre cote du changement d'heure
     americain, la meme rotation retombe dans la MEME case. C'est tout l'objet
     du chantier : en UTC, elle serait partie fonder une case voisine. */
  const hiver = observe(ete, { start: HIVER }, { now: HIVER, zone: 'America/New_York' });
  assert.equal(hiver.cells['4-11'].observations, 5);
  assert.equal(Object.keys(hiver.cells).length, 1);
});

test('transposer sous l\'autre decalage coute une heure, et c\'est assume', () => {
  /* La limite de la transposition, ecrite pour qu'elle ne surprenne personne :
     une case ne garde pas les dates de ses observations, seulement un poids.
     Transposer une case apprise en ete avec le decalage de novembre la place
     donc une heure trop tot. Ces observations-la etaient DEJA decalees -- c'est
     le bug qu'on corrige -- et la demi-vie les efface. */
  const tardif = retuneZone(statUtc('4-15', ETE), 'America/New_York', HIVER);
  assert.deepEqual(Object.keys(tardif.cells), ['4-10']);
});

/* --------------------------------------------- la case entiere est couverte */

const statChaud = (now) => ({
  cells: { '4-11': { weight: 3, observations: 3 } },
  observations: 6,
  lastUpdate: now,
  zone: 'America/New_York',
});

test('une case chaude donne deux instants, espaces d\'une demi-heure', () => {
  const now = Date.UTC(2026, 8, 21, 0, 0, 0);
  const instants = learnedHotInstants(statChaud(now), now);

  assert.equal(instants.length, 2);
  assert.equal(instants[1] - instants[0], 30 * 60 * 1000);

  /* Avec une demi-fenetre de 30 minutes, les deux instants couvrent
     [14:30, 16:00] -- la case entiere, plus une avance qui rattrape un drop
     legerement anticipe. Le seul premier instant s'arretait a 15:30. */
  const debut = instants[0] - SCHEDULER_DEFAULTS.hotHalfWindowMs;
  const fin = instants[1] + SCHEDULER_DEFAULTS.hotHalfWindowMs;
  assert.ok(debut <= ETE, 'la couverture commence avant l\'heure de la case');
  assert.ok(fin >= ETE + 3600000, 'la couverture va jusqu\'au bout de la case');
});

test('la meme case chaude suit le changement d\'heure americain', () => {
  const avant = Date.UTC(2026, 8, 21, 0, 0, 0);
  assert.equal(learnedHotInstants(statChaud(avant), avant)[0], ETE);

  const apres = Date.UTC(2026, 10, 2, 0, 0, 0);
  assert.equal(learnedHotInstants(statChaud(apres), apres)[0], HIVER);
});

test('et les trois semaines ou l\'Europe et l\'Amerique ne sont pas d\'accord', () => {
  /* L'Europe recule le 25 octobre 2026, les Etats-Unis le 1er novembre. Le
     jeudi 29 octobre, la rotation d'Epic tombe donc a 16 h a Paris, pas 17 h.
     Une regle ecrite « 17:00 Europe/Paris » se tromperait ce jour-la ; une
     case ancree sur New York, non. */
  const now = Date.UTC(2026, 9, 26, 0, 0, 0);
  const instant = learnedHotInstants(statChaud(now), now)[0];

  assert.equal(new Date(instant).toISOString(), '2026-10-29T15:00:00.000Z');
  const aParis = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(instant));
  assert.equal(aParis, '16:00');
});

/* ----------------------------------------------- ce que les sources declarent */

test('seules les sources dont le fuseau est MESURE en declarent un', () => {
  assert.equal(SOURCES['epic-api'].zone, 'America/New_York');
  /* L'agregateur date ses offres en heure de New York, sans fuseau dans la
     chaine : c'est mesure, donc c'est ecrit. */
  assert.equal(SOURCES.gamerpower.zone, 'America/New_York');

  /* GOG et Steam : aucune mesure de leur heure de publication. Supposer un
     fuseau serait ecrire une hypothese non mesuree -- ce que ROADMAP.md
     interdit. Leurs cases restent en UTC, comme avant. */
  assert.equal(SOURCES.gog.zone, undefined);
  assert.equal(SOURCES.steam.zone, undefined);
});
