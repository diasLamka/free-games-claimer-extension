/* Le rappel avant qu'un code expire (2.73.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_CODE_REMINDERS, LEVELS, composeReminder, daysLeft, dueReminders, levelFor, readCodes, runCodeReminders,
} from '../watch/code-reminders.js';
import { KEY_CODES } from '../watch/backup.js';
import { setLocale, t } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
/** Heure locale, comme l'onglet Codes. */
const le = (mois, jour, heure = 12) => new Date(2026, mois - 1, jour, heure).getTime();
const code = (c, deadline, extra = {}) => ({ code: c, store: 'gog', title: `Jeu ${c}`, deadline, ...extra });

test('les jours restants se comptent comme dans l\'onglet Codes', () => {
  const now = le(10, 24);
  assert.equal(daysLeft('31 octobre 2026', now), 7);
  assert.equal(daysLeft('25 octobre 2026', now), 1);
  assert.equal(daysLeft('24 octobre 2026', now), 0, 'le jour meme');
  assert.equal(daysLeft('20 octobre 2026', now), -4);
  assert.equal(daysLeft('bientot', now), null);
  assert.equal(levelFor(8), null);
  assert.equal(levelFor(7), LEVELS.WEEK);
  assert.equal(levelFor(2), LEVELS.WEEK);
  assert.equal(levelFor(1), LEVELS.LAST);
  assert.equal(levelFor(0), LEVELS.LAST);
  assert.equal(levelFor(-1), null, 'passe : trop tard pour prevenir');
});

test('deux rappels par code, chacun une fois ; un code traite sort du registre', () => {
  const codes = [
    code('AAAA-1111', '31 octobre 2026'),
    code('BBBB-2222', '25 octobre 2026'),
    code('CCCC-3333', '31 decembre 2026'),
    code('DDDD-4444', '26 octobre 2026', { status: 'redeemed' }),
    code('EEEE-5555', 'on ne sait pas'),
  ];
  let r = dueReminders(codes, {}, le(10, 24));
  assert.deepEqual(r.due.map((d) => [d.code, d.level]), [['BBBB-2222', 'last'], ['AAAA-1111', 'week']], 'le plus urgent d\'abord');
  assert.deepEqual(r.sent, { 'AAAA-1111': 'week', 'BBBB-2222': 'last' });

  r = dueReminders(codes, r.sent, le(10, 25));
  assert.deepEqual(r.due, [], 'rien de neuf le lendemain');

  r = dueReminders(codes, r.sent, le(10, 30));
  assert.deepEqual(r.due.map((d) => [d.code, d.level]), [['AAAA-1111', 'last']], 'le dernier jour, une seconde fois');

  const echange = codes.map((c) => (c.code === 'AAAA-1111' ? { ...c, status: 'redeemed' } : c));
  assert.deepEqual(dueReminders(echange, r.sent, le(10, 30)).sent, { 'BBBB-2222': 'last' }, 'le registre ne garde que l\'attente');
});

test('le texte ne porte JAMAIS le code', () => {
  setLocale('fr');
  try {
    const { due } = dueReminders([code('SECR-ETCO-DE12', '25 octobre 2026', { title: 'Right and Down' })], {}, le(10, 24));
    const m = composeReminder(due, { t, storeLabel: (s) => ({ gog: 'GOG.com' })[s] || s });
    assert.equal(m.title, 'Un code GOG.com à utiliser d\'ici demain');
    assert.equal(m.text, 'Right and Down : à échanger sur GOG.com avant le 25 octobre 2026\nLe code est dans l\'onglet Codes.');
    assert.equal(m.url, 'https://www.gog.com/redeem');
    assert.ok(!JSON.stringify(m).includes('SECR'), 'ni dans le titre, ni dans le texte, ni dans le lien');
    const plusieurs = dueReminders([code('A1B2-C3D4', '30 octobre 2026'), code('E5F6-G7H8', '31 octobre 2026')], {}, le(10, 24)).due;
    assert.equal(composeReminder(plusieurs, { t }).title, '2 codes à utiliser bientôt');
  } finally { setLocale(null); }
});

test('les codes, tels que le moteur les ecrit', () => {
  assert.equal(readCodes(JSON.stringify([code('X1X1-Y2Y2', '1 mai 2026'), null, { code: '' }])).length, 1);
  assert.deepEqual(readCodes('pas du json'), []);
  assert.deepEqual(readCodes(undefined), []);
});

function stockage(d) {
  return { d, storage: { local: {
    get: async (cles) => Object.fromEntries(cles.filter((k) => k in d).map((k) => [k, d[k]])),
    set: async (o) => { Object.assign(d, o); },
  } } };
}

test('le registre est ecrit avant de prevenir ; les heures calmes retiennent tout', async () => {
  const chrome = stockage({ [KEY_CODES]: JSON.stringify([code('ZZZZ-9999', '25 octobre 2026', { title: 'Un jeu' })]) });
  const vus = [];
  const tel = [];
  const base = { chrome, t: (k, ...a) => [k, ...a].join('|'), storeLabel: (s) => s };
  assert.equal((await runCodeReminders({ ...base, now: le(10, 24, 23), quietNow: true, notify: async (n) => vus.push(n) })).why, 'quiet');
  assert.equal(chrome.d[KEY_CODE_REMINDERS], undefined);

  const r = await runCodeReminders({
    ...base, now: le(10, 24),
    notify: async (n) => vus.push({ ...n, note: chrome.d[KEY_CODE_REMINDERS] }),
    phone: async (m) => tel.push(m),
  });
  assert.equal(r.sent, 1);
  assert.deepEqual(vus[0].note, { 'ZZZZ-9999': 'last' }, 'ecrit AVANT');
  assert.equal(vus[0].url, 'https://www.gog.com/redeem');
  assert.equal(tel.length, 1);
  const envoye = [...vus.map(({ title, message, url }) => ({ title, message, url })), ...tel];
  assert.ok(!JSON.stringify(envoye).includes('ZZZZ'), 'le code ne part ni a l\'ecran ni au telephone');

  await runCodeReminders({ ...base, now: le(10, 24, 18), notify: async (n) => vus.push(n) });
  assert.equal(vus.length, 1, 'pas deux fois');

  const muet = stockage({ [KEY_CODES]: [code('YYYY-8888', '26 octobre 2026', { title: 'Un autre' })] });
  const vus2 = [];
  await runCodeReminders({ ...base, chrome: muet, now: le(10, 24), computer: false, notify: async (n) => vus2.push(n) });
  assert.equal(vus2.length, 0, 'alertes coupees : rien a l\'ecran');
});

test('le worker le fait passer par le canal des alertes, apres le cycle et au tour d\'inspection', () => {
  const bg = lire('background.js');
  assert.match(bg, /await maybeCodeReminders\(now\);/);
  assert.match(bg, /await maybeCodeReminders\(Date\.now\(\)\);/);
  assert.match(bg, /computer: settings\.alertMode !== 'off',/);
  assert.equal(KEY_CODE_REMINDERS, 'veille:rappels-codes');
});
