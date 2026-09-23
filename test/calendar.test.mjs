/* L'agenda (2.46.0) : un fichier que TOUS les agendas doivent lire.
 *
 * Les pieges d'un .ics sont connus et silencieux : une ligne trop longue
 * coupee au milieu d'un accent, une virgule non echappee qui scinde un titre,
 * un UID qui change a chaque export et double tous les evenements, une heure
 * sans fuseau lue dans celui du telephone. Chaque test en prend un.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENT_MS, buildCalendar, calendarFileName, codeEvents, dateStamp, endingEvents,
  escapeText, foldLine, shortHash, upcomingEvents, utcStamp,
} from '../watch/calendar.js';

const T = Date.UTC(2026, 8, 23, 12, 0, 0);
const HOUR = 3600000;
const DAY = 24 * HOUR;

const label = {
  ending: (title, store) => `Derniere heure : ${title} (${store})`,
  endingSoon: (title) => `Plus que 24 h : ${title}`,
  starting: (title, store) => `Gratuit : ${title} (${store})`,
  code: (title, store) => `Code : ${title} (${store})`,
  mystery: 'Jeu mystere',
  untitled: 'Sans titre',
};
const options = { now: T, label, storeLabel: (s) => (s === 'epic' ? 'Epic Games Store' : s) };

/** Deplie un calendrier : ce qu'un agenda lit une fois les lignes recollees. */
const unfold = (ics) => ics.replace(/\r\n /g, '');

/* ------------------------------------------------------------- l'ecriture */

test('les instants sont en UTC, suffixe Z', () => {
  assert.equal(utcStamp(Date.UTC(2026, 8, 24, 15, 0, 0)), '20260924T150000Z');
  assert.equal(dateStamp({ year: 2026, month: 6, day: 15 }), '20260715');
});

test('le texte echappe ce que la RFC reserve', () => {
  assert.equal(escapeText('A, B; C\\D\nE'), 'A\\, B\\; C\\\\D\\nE');
});

test('une ligne se plie a 75 octets, jamais au milieu d\'un accent', () => {
  const ligne = `SUMMARY:${'é'.repeat(60)}`;
  const plie = foldLine(ligne);
  for (const morceau of plie.split('\r\n')) {
    assert.ok(Buffer.byteLength(morceau, 'utf8') <= 75, `${Buffer.byteLength(morceau, 'utf8')} octets`);
  }
  assert.equal(unfold(plie), ligne, 'replie, la ligne est intacte');
  assert.ok(!plie.includes('�'));
});

test('une ligne courte ne bouge pas', () => {
  assert.equal(foldLine('BEGIN:VEVENT'), 'BEGIN:VEVENT');
});

test('l\'empreinte est stable et courte', () => {
  assert.equal(shortHash('ABCD-EFGH-IJKL'), shortHash('ABCD-EFGH-IJKL'));
  assert.notEqual(shortHash('ABCD-EFGH-IJKL'), shortHash('ABCD-EFGH-IJKM'));
  assert.match(shortHash('x'), /^[0-9a-f]{8}$/);
});

/* ------------------------------------------------------------ les offres */

test('la fin d\'une offre : la derniere heure, et un rappel la veille', () => {
  const [e] = endingEvents([{ key: 'epic:abc', title: 'Hollow Knight', store: 'epic', end: T + 3 * DAY, url: 'https://store.epicgames.com/p/hk' }], options);
  assert.equal(e.start, T + 3 * DAY - EVENT_MS);
  assert.equal(e.end, T + 3 * DAY);
  assert.equal(e.summary, 'Derniere heure : Hollow Knight (Epic Games Store)');
  assert.deepEqual(e.alarms.map((a) => [a.related, a.trigger]), [['END', '-P1D'], ['START', 'PT0S']]);
});

test('une offre qui finit dans moins d\'une heure commence maintenant', () => {
  const [e] = endingEvents([{ key: 'k', title: 'X', store: 'epic', end: T + 10 * 60000 }], options);
  assert.equal(e.start, T);
});

test('une offre sans fin, ou deja finie, n\'entre pas', () => {
  assert.deepEqual(endingEvents([
    { key: 'a', title: 'Sans fin', store: 'epic', end: null },
    { key: 'b', title: 'Finie', store: 'epic', end: T - 1 },
    { key: 'c', title: '', store: 'epic', end: T + DAY },
  ], options), []);
});

test('un lien qui n\'est pas https n\'est pas repris', () => {
  const [e] = endingEvents([{ key: 'k', title: 'X', store: 'epic', end: T + DAY, url: 'javascript:alert(1)' }], options);
  assert.equal(e.url, null);
});

test('une offre annoncee : son debut, et un jeu mystere garde sa place', () => {
  const ev = upcomingEvents([
    { start: T + DAY, title: 'Celeste', store: 'epic', url: 'https://store.epicgames.com/p/celeste' },
    { start: T + 2 * DAY, title: null, store: 'epic' },
    { start: T - 1, title: 'Passee', store: 'epic' },
  ], options);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].start, T + DAY);
  assert.equal(ev[0].end, T + DAY + EVENT_MS);
  assert.equal(ev[1].summary, 'Gratuit : Jeu mystere (Epic Games Store)');
});

/* -------------------------------------------------------------- les codes */

test('un code : son dernier jour, en journee entiere, SANS le code', () => {
  const ev = codeEvents([{ code: 'SECRET-CODE-1234', title: 'Tyranny', store: 'gog', day: { year: 2026, month: 9, day: 1 } }], options);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].day, { year: 2026, month: 9, day: 1 });

  const ics = buildCalendar(ev, { now: T, name: 'Jeux gratuits' });
  assert.ok(!ics.includes('SECRET'), 'le code ne sort jamais dans l\'agenda');
  assert.match(ics, /DTSTART;VALUE=DATE:20261001\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261002\r\n/);
});

test('un code sans date, ou dont le jour est passe, n\'entre pas', () => {
  assert.deepEqual(codeEvents([
    { code: 'A', title: 'Sans date', store: 'gog', day: null },
    { code: 'B', title: 'Hier', store: 'gog', day: { year: 2026, month: 8, day: 22 } },
  ], options), []);
  // Aujourd'hui compte encore : c'est le dernier jour.
  assert.equal(codeEvents([{ code: 'C', title: 'Aujourd\'hui', store: 'gog', day: { year: 2026, month: 8, day: 23 } }], options).length, 1);
});

/* ------------------------------------------------------------- le fichier */

test('le fichier est un VCALENDAR complet, en CRLF', () => {
  const ics = buildCalendar(endingEvents([{ key: 'epic:1', title: 'Jeu, avec virgule', store: 'epic', end: T + DAY, url: 'https://store.epicgames.com/p/x' }], options), { now: T, name: 'Jeux gratuits' });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'aucun saut de ligne nu');
  const lu = unfold(ics);
  assert.match(lu, /SUMMARY:Derniere heure : Jeu\\, avec virgule \(Epic Games Store\)\r\n/);
  assert.match(lu, /DTSTART:20260924T110000Z\r\n/);
  assert.match(lu, /DTEND:20260924T120000Z\r\n/);
  assert.match(lu, /TRIGGER;RELATED=END:-P1D\r\n/);
  assert.match(lu, /URL:https:\/\/store\.epicgames\.com\/p\/x\r\n/);
  assert.equal((lu.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('le meme export rend les memes UID : un second import met a jour, il ne double pas', () => {
  const offre = [{ key: 'epic:abc', title: 'X', store: 'epic', end: T + DAY }];
  const a = buildCalendar(endingEvents(offre, options), { now: T, name: 'n' });
  const b = buildCalendar(endingEvents(offre, { ...options, now: T + HOUR }), { now: T + HOUR, name: 'n' });
  const uid = (ics) => /UID:([^\r]+)/.exec(ics)[1];
  assert.equal(uid(a), uid(b));
});

test('deux evenements de meme UID n\'en font qu\'un', () => {
  const e = endingEvents([{ key: 'k', title: 'X', store: 'epic', end: T + DAY }], options)[0];
  const ics = buildCalendar([e, { ...e, summary: 'autre' }], { now: T, name: 'n' });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('le nom du fichier porte le jour', () => {
  assert.equal(calendarFileName(T), 'free-games-claimer-2026-09-23.ics');
});

test('une offre annoncee garde son UID si Epic decale l\'heure', () => {
  const a = upcomingEvents([{ start: T + DAY, title: 'Celeste', store: 'epic' }], options)[0];
  const b = upcomingEvents([{ start: T + DAY + HOUR, title: 'Celeste', store: 'epic' }], options)[0];
  assert.equal(a.uid, b.uid);
  // Deux jeux mysteres, eux, ne se distinguent que par leur heure.
  const m = upcomingEvents([{ start: T + DAY, title: null, store: 'epic' }, { start: T + 2 * DAY, title: null, store: 'epic' }], options);
  assert.notEqual(m[0].uid, m[1].uid);
});
