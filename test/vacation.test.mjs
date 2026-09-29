/* Le mode vacances (2.84.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  VACATION_MAX_MS, decideAlert, decideAnnouncement, effectiveQuiet, inQuietHours, onVacation, readVacation,
} from '../watch/notify-policy.js';
import {
  KEY_VACATION, RETURN_GRACE_MS, VACATION_CHOICES, composeReturn, planVacation, returnDue, runReturnSummary,
} from '../watch/vacation.js';
import { KEY_RECAP } from '../watch/recap.js';
import { DEFAULT_SETTINGS, KEYS } from '../watch/storage.js';
import { UI_COMMANDS, messageAllowed } from '../watch/messaging.js';
import { setLocale, t } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-09-26T10:00:00Z');
const PARIS = 'Europe/Paris';

test('un depart se relit ; une saisie absurde n\'en est pas un', () => {
  assert.deepEqual(readVacation({ from: NOW, until: NOW + 7 * DAY }), { from: NOW, until: NOW + 7 * DAY });
  assert.equal(readVacation(null), null);
  assert.equal(readVacation({ from: NOW, until: NOW }), null, 'une fin avant le debut');
  assert.equal(readVacation({ from: NOW, until: NOW + VACATION_MAX_MS + 1 }), null, 'plus de deux mois');
  assert.equal(readVacation({ from: 'x', until: NOW }), null);
  assert.equal(onVacation({ from: NOW, until: NOW + DAY }, NOW + 1), true);
  assert.equal(onVacation({ from: NOW, until: NOW + DAY }, NOW + DAY), false, 'la fin est exclue');
  assert.equal(DEFAULT_SETTINGS.vacation, null);
});

test('des heures calmes qui durent des jours -- meme heures calmes coupees', () => {
  const reglages = { quiet: { on: false, start: '23:00', end: '08:00' }, vacation: { from: NOW, until: NOW + 7 * DAY } };
  const q = effectiveQuiet(reglages);
  assert.equal(inQuietHours(q, NOW + 3 * DAY, PARIS), true, 'en plein apres-midi, en vacances');
  assert.equal(inQuietHours(q, NOW + 8 * DAY, PARIS), false, 'rentre : les heures calmes redeviennent celles des reglages');
  assert.equal(inQuietHours(q, NOW - DAY, PARIS), false, 'avant le depart non plus');
  // Sans vacances, rien ne change.
  assert.deepEqual(effectiveQuiet({ quiet: { on: true, start: '23:00', end: '08:00' } }), { on: true, start: '23:00', end: '08:00' });
});

test('ce qui arrive pendant l\'absence est retenu, jamais perdu', () => {
  const q = effectiveQuiet({ quiet: { on: false }, vacation: { from: NOW, until: NOW + 7 * DAY } });
  assert.deepEqual(decideAnnouncement({ quiet: q, zone: PARIS, now: NOW + DAY, count: 3 }), { notify: false, hold: true, digest: false });
  assert.deepEqual(decideAlert({ quiet: q, zone: PARIS, now: NOW + DAY, count: 1 }), { notify: false, hold: true });
  assert.equal(decideAnnouncement({ quiet: q, zone: PARIS, now: NOW + 8 * DAY, count: 3 }).notify, true, 'au retour, l\'annonce part');
});

test('partir : maintenant, pour 1 a 60 jours', () => {
  assert.deepEqual(VACATION_CHOICES, [3, 7, 14, 21, 30]);
  assert.deepEqual(planVacation(7, NOW), { from: NOW, until: NOW + 7 * DAY });
  assert.equal(planVacation('0', NOW).until, NOW + DAY);
  assert.equal(planVacation(999, NOW).until, NOW + 60 * DAY);
  assert.ok(readVacation(planVacation(60, NOW)), 'la plus longue duree proposee reste lisible');
});

test('le resume du retour : apres la fin, une fois par depart, dans la semaine', () => {
  const v = { from: NOW, until: NOW + 7 * DAY };
  assert.equal(returnDue(v, null, NOW + 3 * DAY), false, 'pas avant la fin');
  assert.equal(returnDue(v, null, NOW + 7 * DAY), true);
  assert.equal(returnDue(v, { summarizedFor: v.until }, NOW + 7 * DAY + 1), false, 'une fois');
  assert.equal(returnDue(v, { summarizedFor: NOW - 30 * DAY }, NOW + 8 * DAY), true, 'un depart precedent ne compte pas');
  assert.equal(returnDue(v, null, v.until + RETURN_GRACE_MS + 1), false, 'trop tard pour apprendre quelque chose');
  assert.equal(returnDue(null, null, NOW), false);
});

test('le message : les lignes du recap, un titre de retour ; rien a dire se dit aussi', () => {
  setLocale('fr');
  try {
    const vide = composeReturn({ claimed: [], manual: [], missed: [], upcoming: [] }, { t });
    assert.equal(vide.title, 'Bon retour !');
    assert.match(vide.text, /^Rien de manqué/);
    const plein = composeReturn({
      claimed: [{ title: 'Hue', store: 'epic' }, { title: 'Mechabellum', store: 'epic' }],
      manual: [{ title: 'Squad', store: 'steam' }], missed: [{ title: 'RiMS Racing', store: 'epic' }], upcoming: [],
    }, { t, storeLabel: (s) => s, total: '29,98 €' });
    assert.equal(plein.title, 'Bon retour : 2 jeux récupérés pendant votre absence');
    assert.match(plein.text, /Hue, Mechabellum/);
    assert.match(plein.text, /Squad/);
    assert.match(plein.text, /RiMS Racing/);
  } finally { setLocale(null); }
});

/** Un faux stockage : get/set, et ce que le monde a ecrit. */
function fauxChrome(data) {
  const d = { ...data };
  return {
    d,
    storage: { local: {
      async get(keys) { const l = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(l.filter((k) => d[k] !== undefined).map((k) => [k, structuredClone(d[k])])); },
      async set(o) { Object.assign(d, structuredClone(o)); },
    } },
  };
}

test('au retour : ce qui a ete pris depuis le depart, puis plus rien -- et pas de recap du jeudi en plus', async () => {
  const depart = NOW - 7 * DAY;
  const chrome = fauxChrome({
    [KEYS.SETTINGS]: { vacation: { from: depart, until: NOW - DAY }, notifyMode: 'every' },
    'FGC_history_Epic Games': JSON.stringify({
      'slug:hue': { status: 'claimed', ts: NOW - 3 * DAY, title: 'Hue' },
      'slug:vieux': { status: 'claimed', ts: depart - DAY, title: 'Avant le depart' },
    }),
  });
  const avis = [];
  const tel = [];
  setLocale('fr');
  try {
    const r = await runReturnSummary({
      chrome, now: NOW, t, storeLabel: (s) => s, format: (m) => String(m),
      notify: async (n) => avis.push(n), phone: async (m) => tel.push(m),
    });
    assert.equal(r.sent, true);
    assert.equal(avis.length, 1);
    assert.equal(avis[0].title, 'Bon retour : 1 jeu récupéré pendant votre absence');
    assert.doesNotMatch(avis[0].message, /Avant le depart/, 'seulement depuis le depart');
    assert.equal(tel.length, 1);
    assert.equal(chrome.d[KEY_VACATION].summarizedFor, NOW - DAY);
    assert.equal(chrome.d[KEY_RECAP].at, NOW, 'le recap de la semaine est tenu pour fait');
    const encore = await runReturnSummary({ chrome, now: NOW + 1000, t, notify: async (n) => avis.push(n) });
    assert.equal(encore.sent, false);
    assert.equal(avis.length, 1, 'une seule fois');
  } finally { setLocale(null); }
});

test('la nuit du retour, il attend le matin ; notifications coupees, rien sur l\'ordinateur mais c\'est marque', async () => {
  const reglages = { vacation: { from: NOW - 7 * DAY, until: NOW - DAY } };
  const nuit = fauxChrome({ [KEYS.SETTINGS]: reglages });
  assert.deepEqual(await runReturnSummary({ chrome: nuit, now: NOW, t, notify: async () => {}, quietNow: true }), { sent: false, why: 'quiet' });
  assert.equal(nuit.d[KEY_VACATION], undefined, 'rien n\'est marque : il repartira');
  const muet = fauxChrome({ [KEYS.SETTINGS]: { ...reglages, notifyMode: 'off' } });
  const avis = [];
  const r = await runReturnSummary({ chrome: muet, now: NOW, t, notify: async (n) => avis.push(n) });
  assert.equal(r.sent, true);
  assert.equal(avis.length, 0);
  assert.ok(muet.d[KEY_VACATION]);
});

test('branche partout ou l\'on previent, et seulement la', () => {
  const bg = lire('background.js');
  assert.equal((bg.match(/quietNow: inQuietHours\(effectiveQuiet\(settings\), now\)/g) || []).length, 3, 'recap, rappel des codes, retour');
  assert.match(bg, /une sauvegarde n'est pas une\s*\/\/ notification, elle ne se tait pas en vacances \(2\.84\.0\)\.\s*quietNow: inQuietHours\(settings\.quiet, now\),/);
  assert.match(bg, /if \(onVacation\(settings\.vacation, Date\.now\(\)\)\) return null;/, 'le moteur se tait aussi');
  assert.match(bg, /await maybeReturn\(now\);\s*await maybeRecap\(now\);/, 'le retour avant le recap');
  const cycle = lire('watch/cycle.js');
  assert.equal((cycle.match(/quiet: effectiveQuiet\(ctx\.settings\),/g) || []).length, 3, 'annonces, resume des jeux mis de cote (2.99.5) et rappels avant la fin');
  assert.match(cycle, /!inQuietHours\(effectiveQuiet\(ctx\.settings\), now\)/, 'le telephone des reclamations manuelles');
  assert.doesNotMatch(cycle, /ctx\.settings\.quiet/);
  const sante = lire('watch/health.js');
  assert.equal((sante.match(/quiet: effectiveQuiet\(settings\),/g) || []).length, 2);
  assert.ok(UI_COMMANDS.includes('fgc-vacation-back'));
  assert.equal(messageAllowed('fgc-vacation-back', 'content'), false);
  const popup = lire('pages/popup.js');
  assert.match(popup, /writeBehaviour\(\{ vacation: planVacation\(document\.getElementById\('vacation-days'\)\.value, Date\.now\(\)\) \}\)/);
  assert.match(popup, /await tell\('fgc-vacation-back'\);/);
  assert.match(lire('pages/popup.html'), /<div class="stopped vacation" id="vacation-banner" hidden>/);
});
