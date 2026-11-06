/* Le recap du jeudi soir (2.65.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_RECAP, RECAP_GRACE_MS, announcedWindows, buildRecap, composeRecap, hasNews, recapDue,
  recapTotal, recapWindowStart, runRecap, titleList,
} from '../watch/recap.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { phoneTarget } from '../watch/phone.js';
import { setLocale, t } from '../lib/i18n.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const H = 3600000;
const J = 24 * H;
/** Heure locale : le recap vit a l'heure de l'ordinateur. Le 24 septembre 2026 est un jeudi. */
const le = (jour, heure, minute = 0) => new Date(2026, 8, jour, heure, minute).getTime();

/* ------------------------------------------------------------ quand */

test('la semaine du recap commence le jeudi a 18 h, heure locale', () => {
  assert.equal(new Date(le(24, 12)).getDay(), 4);
  assert.equal(recapWindowStart(le(24, 18, 5)), le(24, 18));
  assert.equal(recapWindowStart(le(24, 17, 59)), le(17, 18), 'avant 18 h, c\'est encore la semaine d\'avant');
  assert.equal(recapWindowStart(le(27, 10)), le(24, 18), 'le dimanche matin, c\'est le jeudi d\'avant');
  assert.equal(recapWindowStart(le(30, 23)), le(24, 18), 'le mercredi soir aussi');
});

test('un recap par semaine, du jeudi soir au dimanche soir -- pas au-dela', () => {
  assert.equal(recapDue(le(24, 18, 5), null), true);
  assert.equal(recapDue(le(24, 17, 59), null), false, 'la semaine d\'avant est perimee');
  assert.equal(recapDue(le(24, 19), le(24, 18, 5)), false, 'deja envoye cette semaine');
  assert.equal(recapDue(le(25, 9), le(17, 18, 2)), true, 'ordinateur eteint jeudi : il part vendredi matin');
  assert.equal(recapDue(le(24, 18) + RECAP_GRACE_MS - 60000, null), true);
  assert.equal(recapDue(le(24, 18) + RECAP_GRACE_MS + 60000, null), false, 'lundi, le recap de la semaine n\'a plus de sens');
});

test('une liste de titres bornee, sans doublon', () => {
  assert.equal(titleList(['A', 'B', 'A', null]), 'A, B');
  assert.equal(titleList(['A', 'B', 'C', 'D', 'E', 'F'], 4), 'A, B, C, D +2');
  assert.equal(titleList([]), '');
});

/* ------------------------------------------------------------ quoi */

const NOW = le(24, 18, 30);
const SINCE = le(17, 18);

function semaine() {
  const histories = {
    'Epic Games': {
      'slug:shogun-showdown': { status: 'claimed', ts: le(24, 17, 10), title: 'Shogun Showdown' },
      'slug:vieux': { status: 'claimed', ts: le(10, 12), title: 'Vieux jeu' },
      'slug:deja': { status: 'claimed', reason: 'ALREADY_OWNED', ts: le(20, 12), title: 'Deja a moi' },
    },
    GOG: { 'slug:dwarf': { status: 'claimed', ts: le(21, 9), title: 'Dwarf Test' } },
  };
  const catalog = {
    'epic:shogun-showdown': { store: 'epic', title: 'Shogun Showdown', worth: '14,99 \u20ac', state: 'resolved', verdict: 'claimed' },
    'gog:dwarf': { store: 'gog', title: 'Dwarf Test', worth: '9,99 \u20ac', state: 'resolved' },
    'steam:1': { store: 'steam', title: 'Dwarven Realms (Steam) Key Giveaway', state: 'queued', end: NOW + 3 * J },
    'steam:2': { store: 'steam', title: 'Deadshot', state: 'resolved', verdict: 'claimed', lastAttemptAt: le(22, 8) },
    'epic-mobile:m': { store: 'epic-mobile', title: 'Mindcop', state: 'discovered', end: NOW + 6 * J },
    'epic:bloque': { store: 'epic', title: 'Bloque', state: 'queued', verdict: 'needs_login', attempts: 1, end: NOW + J },
    'epic:attend': { store: 'epic', title: 'En file', state: 'queued', end: NOW + J },
    'epic:possede': { store: 'steam', title: 'Deja la', state: 'queued', alreadyOwned: true },
    'ubisoft:x': { store: 'ubisoft', title: 'Hors suivi', state: 'queued' },
  };
  const outcomes = {
    a: { outcome: 'missed', store: 'gog', title: 'Rate cette semaine', end: le(22, 12), ts: le(22, 12) },
    b: { outcome: 'missed', store: 'gog', title: 'Rate avant', end: le(12, 12), ts: le(12, 12) },
    c: { outcome: 'taken', store: 'epic', title: 'Pris', end: le(23, 12), ts: le(23, 12) },
  };
  const sources = {
    'epic-api': { announcedWindows: [{ title: 'Cardpocalypse', start: le(1 + 30, 17), url: 'https://store.epicgames.com/p/c' }, { title: 'Loin', start: NOW + 20 * J }] },
  };
  const settings = { ...DEFAULT_SETTINGS, watchedStores: [...DEFAULT_SETTINGS.watchedStores, 'epic-mobile'] };
  return { histories, catalog, outcomes, sources, settings, now: NOW, since: SINCE };
}

test('la semaine : recupere, a prendre soi-meme, rate, annonce', () => {
  const r = buildRecap(semaine());
  assert.deepEqual(r.claimed.map((c) => c.title).sort(), ['Deadshot', 'Dwarf Test', 'Shogun Showdown'],
    'le moteur et Steam ; ni ce qui etait deja a vous, ni la semaine d\'avant');
  assert.deepEqual(r.manual.map((m) => m.title), ['Bloque', 'Dwarven Realms (Steam) Key Giveaway', 'Mindcop'],
    'Steam sans l\'option, le jeu mobile, et une reclamation arretee sur une connexion -- pas la file ordinaire');
  assert.deepEqual(r.missed.map((m) => m.title), ['Rate cette semaine']);
  assert.deepEqual(r.upcoming.map((u) => u.title), ['Cardpocalypse'], 'huit jours devant, pas plus');
  assert.equal(hasNews(r), true);
});

test('avec la recuperation Steam activee, un jeu Steam n\'est plus \u00ab a prendre soi-meme \u00bb', () => {
  const s = semaine();
  const r = buildRecap({ ...s, settings: { ...s.settings, steamAutoClaim: true } });
  assert.ok(!r.manual.some((m) => m.store === 'steam'));
});

test('le texte, en francais, avec la valeur quand elle est dans une seule devise', () => {
  setLocale('fr');
  try {
    const r = buildRecap(semaine());
    const format = (n, c) => `${n.toFixed(2).replace('.', ',')} ${c === 'EUR' ? '\u20ac' : c}`;
    const total = recapTotal(r.claimed, format);
    assert.equal(total, '24,98 \u20ac');
    const { title, text } = composeRecap(r, { t, storeLabel: (s) => ({ steam: 'Steam', 'epic-mobile': 'Epic Games (mobile)', epic: 'Epic Games Store' })[s] || s, total });
    assert.equal(title, 'Votre semaine : 3 jeux r\u00e9cup\u00e9r\u00e9s');
    const lignes = text.split('\n');
    assert.match(lignes[0], /^R\u00e9cup\u00e9r\u00e9s : .*Shogun Showdown.* \(valeur 24,98 \u20ac\)$/);
    assert.equal(lignes[1], '\u00c0 prendre vous-m\u00eame : Bloque (Epic Games Store), Dwarven Realms (Steam), Mindcop (Epic Games (mobile))');
    assert.equal(lignes[2], 'Rat\u00e9s : Rate cette semaine');
    assert.equal(lignes[3], 'Bient\u00f4t : Cardpocalypse');
    assert.equal(composeRecap({ claimed: [{ title: 'A' }], manual: [], missed: [], upcoming: [] }, { t }).title, 'Votre semaine : 1 jeu r\u00e9cup\u00e9r\u00e9');
    assert.equal(composeRecap({ claimed: [], manual: [{ title: 'B', store: 'steam' }], missed: [], upcoming: [] }, { t, storeLabel: () => 'Steam' }).title,
      'Votre semaine de jeux gratuits');
  } finally { setLocale(null); }
});

test('deux devises ne s\'additionnent pas', () => {
  assert.equal(recapTotal([{ worth: 10, currency: 'EUR' }, { worth: 5, currency: 'USD' }], () => 'x'), null);
  assert.equal(recapTotal([{ worth: null, currency: null }], () => 'x'), null);
});

test('les ouvertures annoncees : une par jeu, la plus proche', () => {
  const w = announcedWindows({ 'epic-api': { announcedWindows: [{ title: 'A', start: 30 }, { title: 'A', start: 20 }, 50, 5] } }, 10);
  assert.deepEqual(w.map((x) => [x.title, x.start]), [['A', 20], [null, 50]]);
});

/* ------------------------------------------------------------ l'envoi */

function fauxStockage(donnees) {
  const d = { ...donnees };
  return {
    d,
    storage: { local: {
      get: async (cles) => Object.fromEntries(cles.filter((k) => k in d).map((k) => [k, JSON.parse(JSON.stringify(d[k]))])),
      set: async (o) => { Object.assign(d, o); },
    } },
  };
}

function donneesSemaine(reglages = {}) {
  const s = semaine();
  return {
    'veille:reglages': { ...reglages },
    'veille:offres': s.catalog,
    'veille:sources': s.sources,
    'veille:issues': s.outcomes,
    // Le moteur ecrit ses historiques en texte JSON.
    'FGC_history_Epic Games': JSON.stringify(s.histories['Epic Games']),
    FGC_history_GOG: s.histories.GOG,
  };
}

test('le recap part une fois : la date est ecrite avant de prevenir', async () => {
  setLocale('fr');
  try {
    const chrome = fauxStockage(donneesSemaine());
    const vus = [];
    const tel = [];
    const opts = {
      chrome, t, storeLabel: (s) => s, format: (n) => `${n} \u20ac`,
      notify: async (n) => { vus.push({ ...n, dejaNote: Boolean(chrome.d[KEY_RECAP]) }); },
      phone: async (m) => { tel.push(m); },
    };
    const r = await runRecap({ ...opts, now: NOW });
    assert.equal(r.sent, true);
    assert.equal(vus.length, 1);
    assert.equal(vus[0].dejaNote, true, 'ecrite AVANT la notification');
    assert.equal(vus[0].title, 'Votre semaine : 3 jeux r\u00e9cup\u00e9r\u00e9s');
    assert.equal(tel.length, 1);
    assert.equal(tel[0].message, vus[0].message);

    const encore = await runRecap({ ...opts, now: NOW + H });
    assert.equal(encore.why, 'not-due');
    assert.equal(vus.length, 1);
  } finally { setLocale(null); }
});

test('coupe, en heures calmes, ou sans rien a dire : pas de notification', async () => {
  const vus = [];
  const notify = async (n) => vus.push(n);
  const base = { t: (k) => k, storeLabel: (s) => s, format: String, notify };

  const coupe = fauxStockage(donneesSemaine({ weeklyRecap: false }));
  assert.equal((await runRecap({ ...base, chrome: coupe, now: NOW })).why, 'off');

  const calme = fauxStockage(donneesSemaine());
  assert.equal((await runRecap({ ...base, chrome: calme, now: NOW, quietNow: true })).why, 'quiet');
  assert.equal(calme.d[KEY_RECAP], undefined, 'rien de marque : il repart au matin');

  const vide = fauxStockage({ 'veille:reglages': {} });
  const r = await runRecap({ ...base, chrome: vide, now: NOW });
  assert.equal(r.why, 'empty');
  assert.ok(vide.d[KEY_RECAP], 'marque quand meme : pas de nouvel essai toutes les demi-heures');

  const muet = fauxStockage(donneesSemaine({ notifyMode: 'off' }));
  const tel = [];
  await runRecap({ ...base, chrome: muet, now: NOW, phone: async (m) => tel.push(m) });
  assert.equal(tel.length, 1, 'notifications de l\'ordinateur coupees : le telephone le recoit quand meme');
  assert.equal(vus.length, 0);
});

/* ------------------------------------------------------------ le branchement */

test('le reglage, le telephone et le worker', () => {
  assert.equal(DEFAULT_SETTINGS.weeklyRecap, true);
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', recap: false }).recap, false);
  const bg = lire('background.js');
  assert.match(bg, /await maybeRecap\(now\);/, 'depuis le tour d\'inspection');
  assert.match(bg, /await maybeRecap\(Date\.now\(\)\);/, 'apres un cycle');
  assert.match(bg, /phone: tel && tel\.recap/);
  const html = lire('pages/popup.html');
  assert.match(html, /id="weekly-recap"/);
  assert.match(html, /id="phone-recap"/);
  const js = lire('pages/popup.js');
  assert.match(js, /writeBehaviour\(\{ weeklyRecap: e\.target\.checked \}\)/);
  assert.match(js, /const upcomingWindows = announcedWindows;/, 'le popup et le recap lisent la meme liste');
});

/* ------------------------------------------- chasse aux dollars (2.123.0) */

import { parseRates } from '../watch/rates.js';

test('le total de la semaine se dit en euros : les dollars sont convertis, le total marque environ', () => {
  const taux = parseRates({ amount: 1, base: 'EUR', date: '2026-10-16', rates: { USD: 1.125 } }, 1000);
  const format = (n, c) => `${n.toFixed(2)} ${c}`;
  // 22,50 $ valent 20,00 EUR au taux du jour : 20 + 5 = 25 EUR.
  assert.equal(recapTotal([{ worth: 22.5, currency: 'USD' }, { worth: 5, currency: 'EUR' }], format, taux, 2000), '\u2248 25.00 EUR');
  // Des dollars seuls, un taux qui sert : en euros, et approximatif.
  assert.equal(recapTotal([{ worth: 22.5, currency: 'USD' }], format, taux, 2000), '\u2248 20.00 EUR');
  // Des euros seuls : jamais approximatif.
  assert.equal(recapTotal([{ worth: 5, currency: 'EUR' }], format, taux, 2000), '5.00 EUR');
});

test('sans taux, le total de la semaine garde l\'ancien comportement : une devise se dit seule, plusieurs jamais', () => {
  const format = (n, c) => `${n.toFixed(2)} ${c}`;
  assert.equal(recapTotal([{ worth: 22.5, currency: 'USD' }], format, null, 2000), '22.50 USD');
  assert.equal(recapTotal([{ worth: 22.5, currency: 'USD' }, { worth: 5, currency: 'EUR' }], format, null, 2000), null);
});
