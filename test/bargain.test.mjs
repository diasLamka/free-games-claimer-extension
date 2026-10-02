/* « Piege ou bonne affaire ? » : la note A-D, ses raisons, et le total verifie.
 *
 * Ce que ces tests tiennent :
 *   - une note ne s'invente pas : sans donnee qui compte, elle est null ;
 *   - ce qui est gratuit de toute facon, une demo, une musique : D, quoi qu'on
 *     sache d'autre ;
 *   - A exige une bonne note Steam ET une valeur confirmee ;
 *   - la valeur d'un agregateur n'est « verifiee » que recoupee avec Steam,
 *     et plafonnee quand elle est gonflee ;
 *   - la copie Kotlin suit : table d'or regeneree ici, relue par BargainTest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { setLocale } from '../lib/i18n.js';
import { composeAnnouncement } from '../watch/cycle.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { makeEntry, mergeEntry, integrateHistory } from '../watch/library.js';
import { claimsMade } from '../watch/tally.js';
import {
  verdictFor, verdictLine, verdictTitle, gradeLabel, collectionFacts, reasonText,
  grade, gradeTone, readCheck, compareWorth, certify, worthSource, amountText, baseGameOwned,
  refreshChecks, storeChecks, needsCheck, checkFor, checkAppId, appDetailsUrl, KEY_CHECKS,
  FRESH_MS, NONE_MS, MAX_ENTRIES, PER_RUN,
} from '../watch/bargain.js';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const offre = (o = {}) => ({
  title: 'Hades', store: 'epic', source: 'epic-api', category: 'Game', keepable: true, worth: '29.99 EUR', ...o,
});
const note = (positive, total) => ({ positive, total, score: 8, at: NOW });
const fiche = (o = {}) => ({ appid: '1145360', type: 'game', isFree: false, price: 24.99, currency: 'USD', fullgame: null, fullgameName: null, ...o });
const cles = (r) => r.reasons.map((x) => x.key);

/* ---------------------------------------------------------------- les notes */

test('A : une bonne note Steam ET une valeur confirmee par le magasin', () => {
  const r = grade({ offer: offre(), rating: note(920, 1000) });
  assert.equal(r.grade, 'A');
  assert.deepEqual(cles(r).sort(), ['bargainRatedHigh', 'bargainValueConfirmed']);
});

test('B : bien note, mais la valeur n\'est pas confirmee -- jamais A sans les deux', () => {
  const sans = grade({ offer: offre({ worth: null }), rating: note(920, 1000) });
  assert.equal(sans.grade, 'B');
  const moyen = grade({ offer: offre(), rating: note(750, 1000) });
  assert.equal(moyen.grade, 'B');
});

test('C : avis partages, meme avec une vraie valeur', () => {
  const r = grade({ offer: offre(), rating: note(600, 1000) });
  assert.equal(r.grade, 'C');
  assert.ok(cles(r).includes('bargainRatedMixed'));
});

test('D : mal note, meme gratuit et cher', () => {
  const r = grade({ offer: offre(), rating: note(400, 1000) });
  assert.equal(r.grade, 'D');
  assert.equal(r.reasons[0].key, 'bargainRatedLow', 'le pire motif d\'abord');
});

test('trop peu d\'avis : on le dit, la note Steam ne compte pas', () => {
  const r = grade({ offer: offre(), rating: note(30, 30) });
  assert.ok(cles(r).includes('bargainFewReviews'));
  assert.equal(r.grade, 'B', 'seule la valeur confirmee compte');
});

test('une petite valeur seule ne fait pas une note : elle se dit, sans juger', () => {
  const r = grade({ offer: offre({ worth: '5 EUR' }) });
  assert.equal(r.grade, null);
  assert.deepEqual(cles(r), ['bargainValueSmall', 'bargainNoData']);
});

test('rien de solide : non evaluee, et on dit pourquoi', () => {
  const r = grade({ offer: offre({ worth: null, source: 'gamerpower' }) });
  assert.equal(r.grade, null);
  assert.deepEqual(cles(r), ['bargainNoData']);
  assert.equal(grade({ offer: null }).grade, null);
});

test('gratuit de toute facon, demo, musique : D quoi qu\'on sache d\'autre', () => {
  const libre = grade({ offer: offre({ keepable: false, worth: null }), rating: note(990, 1000) });
  assert.equal(libre.grade, 'D');
  assert.deepEqual(cles(libre), ['bargainFreeForever']);

  assert.equal(grade({ offer: offre(), check: fiche({ isFree: true }), rating: note(990, 1000) }).grade, 'D', 'free-to-play chez Steam');
  assert.deepEqual(cles(grade({ offer: offre(), check: fiche({ type: 'demo' }) })), ['bargainDemo']);
  assert.deepEqual(cles(grade({ offer: offre({ title: 'Hades Demo' }) })), ['bargainDemo']);
  assert.deepEqual(cles(grade({ offer: offre(), check: fiche({ type: 'music' }) })), ['bargainNotAGame']);
  // Un mot de titre qui n'a rien d'une demo.
  assert.notDeepEqual(cles(grade({ offer: offre({ title: 'Demon Slayer' }), rating: note(900, 1000) })), ['bargainDemo']);
});

/* ------------------------------------------------------------ la valeur */

test('valeur annoncee par un agregateur : recoupee avec le prix Steam', () => {
  const agr = { source: 'gamerpower', worth: '$24.99' };
  const ok = grade({ offer: offre(agr), check: fiche({ price: 19.99 }), rating: note(900, 1000) });
  assert.equal(ok.grade, 'A', 'ecart modeste : confirmee');
  assert.ok(ok.reasons.some((r) => r.key === 'bargainValueConfirmed' && r.args[0] === '19.99 USD'), 'au plus bas des deux');

  const gonfle = grade({ offer: offre({ source: 'gamerpower', worth: '$60.00' }), check: fiche({ price: 19.99 }), rating: note(900, 1000) });
  assert.equal(gonfle.grade, 'C');
  assert.equal(gonfle.reasons[0].key, 'bargainInflated');
  assert.deepEqual(gonfle.reasons[0].args, ['60 USD', '19.99 USD']);

  const sans = grade({ offer: offre({ source: 'gamerpower', worth: '$30' }), rating: note(900, 1000) });
  assert.equal(sans.grade, 'B');
  assert.ok(cles(sans).includes('bargainValueUnconfirmed'), 'annoncee, non confirmee');
});

test('un rabais de quelques dollars n\'est pas une tromperie', () => {
  assert.equal(compareWorth(13.99, fiche({ price: 9.99 })).state, 'ok', 'ecart sous cinq dollars');
  assert.equal(compareWorth(30, fiche({ price: 25 })).state, 'ok', 'rapport sous 1,5');
  assert.equal(compareWorth(40, fiche({ price: 20 })).state, 'inflated');
  assert.equal(compareWorth(60, fiche({ price: 20 })).state, 'very');
  assert.equal(compareWorth(60, fiche({ price: null })).state, 'unverifiable');
  assert.equal(compareWorth(60, fiche({ currency: 'EUR' })).state, 'unverifiable', 'jamais de conversion inventee');
  assert.equal(compareWorth(60, { none: true }).state, 'unverifiable');
  assert.equal(compareWorth(null, fiche()).state, 'unverifiable');
});

test('qui a donne la valeur : le magasin ou un agregateur', () => {
  assert.equal(worthSource({ worth: '5', source: 'epic-api' }), 'store');
  assert.equal(worthSource({ worth: '5', source: 'gog' }), 'store');
  assert.equal(worthSource({ worth: '5', source: 'gamerpower' }), 'aggregator');
  assert.equal(worthSource({ worth: '5', source: 'gamerpower', origin: { worth: 'epic-api' } }), 'store', 'la provenance du champ prime');
  assert.equal(worthSource({ worth: null, source: 'epic-api' }), null);
});

/* ------------------------------------------------------------------ DLC */

test('DLC : le jeu de base manque -> D ; est a vous -> bon point ; inconnu -> prudence', () => {
  const dlc = offre({ store: 'steam', source: 'steam', category: 'DLC', worth: '4.99 EUR', parentAppid: '620' });
  const f = fiche({ type: 'dlc', fullgame: '620', fullgameName: 'Portal 2' });
  const manque = grade({ offer: dlc, check: f, baseOwned: false });
  assert.equal(manque.grade, 'D');
  assert.deepEqual(manque.reasons[0], { key: 'bargainNeedsBase', args: ['Portal 2'], tone: 'bad' });

  assert.equal(grade({ offer: dlc, check: f, baseOwned: true }).grade, 'B');
  const inconnu = grade({ offer: dlc, check: f, baseOwned: null });
  assert.ok(cles(inconnu).includes('bargainNeedsBaseUnknown'));
  assert.notEqual(inconnu.grade, 'A');
});

test('butin d\'agregateur : du contenu lie a un jeu, pas un jeu', () => {
  const r = grade({ offer: offre({ source: 'gamerpower', category: 'DLC', title: 'Skin Pack', worth: null }) });
  assert.equal(r.grade, 'C');
  assert.deepEqual(cles(r), ['bargainExtra']);
});

test('le jeu de base d\'un DLC se lit dans la collection importee', () => {
  const possedes = new Set(['steam:620']);
  assert.equal(baseGameOwned({ fullgame: '620' }, {}, possedes, true), true);
  assert.equal(baseGameOwned({ fullgame: '10' }, {}, possedes, true), false);
  assert.equal(baseGameOwned({ fullgame: '10' }, {}, possedes, false), null, 'collection jamais importee : on ne sait pas');
  assert.equal(baseGameOwned(null, { parentAppid: '620' }, possedes, true), true);
  assert.equal(baseGameOwned(null, {}, possedes, true), null);
});

test('la couleur d\'une note', () => {
  assert.deepEqual(['A', 'B', 'C', 'D', null].map(gradeTone), ['good', 'good', 'mixed', 'bad', null]);
});

/* ------------------------------------------------------------ la fiche */

const REPONSE = (data, id = '620') => ({ [id]: { success: true, data } });

test('readCheck : type, gratuit de toute facon, prix de catalogue, jeu de base', () => {
  const dlc = readCheck(REPONSE({ steam_appid: 9, type: 'dlc', is_free: false, price_overview: { initial: 499, currency: 'USD', final: 0 }, fullgame: { appid: '620', name: 'Portal 2' } }, '9'), '9');
  assert.deepEqual(dlc, { appid: '9', type: 'dlc', isFree: false, price: 4.99, currency: 'USD', fullgame: '620', fullgameName: 'Portal 2' });
  const f2p = readCheck(REPONSE({ type: 'game', is_free: true }, '730'), '730');
  assert.equal(f2p.isFree, true);
  assert.equal(f2p.price, null);
  assert.equal(readCheck({ 620: { success: false } }, '620'), null);
  assert.equal(readCheck(null, '620'), null);
  assert.equal(readCheck(REPONSE({ type: 'dlc', fullgame: { appid: 'x\'; DROP' } }), '620').fullgame, null, 'un appid n\'est que des chiffres');
});

test('refreshChecks : huit au plus, une fois par mois, sans cookie, sans jeter', async () => {
  const appels = [];
  const fetchFalse = async (url, init) => {
    appels.push({ url, init });
    const id = new URL(url).searchParams.get('appids');
    if (id === '7') return { ok: true, json: async () => ({ 7: { success: false } }) };
    if (id === '8') return { ok: false };
    if (id === '9') throw new Error('hors ligne');
    return { ok: true, json: async () => REPONSE({ type: 'game', price_overview: { initial: 1999, currency: 'USD' } }, id) };
  };
  const pause = async () => {};
  const r = await refreshChecks({}, ['1', '2', '1', '7', '8', '9', '', null], { fetch: fetchFalse, now: NOW, pause });
  assert.equal(appels.length, 5, 'un seul appel par appid, vides ecartes');
  assert.ok(appels.every((a) => a.init.credentials === 'omit'), 'aucun cookie');
  assert.ok(appels.every((a) => new URL(a.url).searchParams.get('cc') === 'US'), 'les dollars des agregateurs se comparent a la fiche US');
  assert.deepEqual(Object.keys(r.checks).sort(), ['app:1', 'app:2', 'app:7']);
  assert.equal(r.checks['app:7'].none, true, 'retire de la vente : une reponse');
  assert.equal(r.got, 3);

  // Frais : rien a refaire ; vieilli : on relit.
  assert.equal(needsCheck(r.checks, '1', NOW + FRESH_MS - 1), false);
  assert.equal(needsCheck(r.checks, '1', NOW + FRESH_MS), true);
  assert.equal(needsCheck(r.checks, '7', NOW + NONE_MS), true, 'un titre introuvable se redemande plus tot');
  assert.equal(needsCheck(r.checks, null, NOW), false);

  // Plafond par passage.
  const beaucoup = Array.from({ length: 30 }, (_, i) => String(100 + i));
  const n = [];
  await refreshChecks({}, beaucoup, { fetch: async (u) => { n.push(u); return { ok: true, json: async () => ({}) }; }, now: NOW, pause });
  assert.equal(n.length, PER_RUN);
});

test('le registre garde les plus recentes et ne grossit pas sans fin', () => {
  const gros = {};
  for (let i = 0; i < MAX_ENTRIES + 20; i++) gros[`app:${i}`] = { at: i };
  const r = storeChecks(gros, [['app:z', { at: 99999 }]]);
  assert.equal(Object.keys(r).length, MAX_ENTRIES);
  assert.ok(r['app:z']);
  assert.equal(r['app:0'], undefined, 'la plus ancienne sort');
  assert.equal(checkFor(r, 'z') && checkFor(r, 'z').at, 99999);
  assert.equal(checkFor({ 'app:1': { none: true, at: 1 } }, '1'), null);
});

test('l\'appid d\'une offre : le sien, sinon celui de sa note Steam', () => {
  assert.equal(checkAppId({ store: 'steam', storeId: '620', title: 'x' }, {}), '620');
  assert.equal(checkAppId({ store: 'epic', title: 'Hades', normalisedTitle: 'hades' }, { 't:hades': { appid: '1145360', score: 8, total: 10, positive: 9, at: 1 } }), '1145360');
  assert.equal(checkAppId({ store: 'epic', title: 'Hades' }, {}), null);
  assert.ok(appDetailsUrl('620').includes('cc=US'));
  assert.equal(KEY_CHECKS, 'veille:prix-steam');
});

/* ------------------------------------------------------- le total verifie */

test('le total verifie : le magasin tel quel, l\'agregateur recoupe ou a part', () => {
  const rows = [
    { worth: 29.99, currency: 'EUR', source: 'store', appid: null },          // Epic : son propre prix
    { worth: 24.99, currency: 'USD', source: 'aggregator', appid: '1' },     // recoupe : ok
    { worth: 60, currency: 'USD', source: 'aggregator', appid: '2' },        // gonfle : plafonne a 19.99
    { worth: 30, currency: 'USD', source: 'aggregator', appid: '3' },        // pas de fiche : a part
    { worth: 15, currency: 'USD', source: 'aggregator', appid: '4' },        // gratuit de toute facon
    { worth: null, currency: 'USD', source: 'aggregator', appid: '5' },      // sans valeur : ignoree
    { worth: 12, currency: 'EUR', source: null, appid: null },               // provenance inconnue : a part
  ];
  const checks = {
    'app:1': { appid: '1', type: 'game', isFree: false, price: 19.99, currency: 'USD', at: 1 },
    'app:2': { appid: '2', type: 'game', isFree: false, price: 19.99, currency: 'USD', at: 1 },
    'app:4': { appid: '4', type: 'game', isFree: true, price: null, currency: null, at: 1 },
  };
  const c = certify(rows, checks);
  assert.deepEqual(c.verified, { EUR: 29.99, USD: 24.99 + 19.99 });
  assert.deepEqual(c.trimmed, { USD: 40.01 });
  assert.deepEqual(c.unverified, { USD: 30, EUR: 12 });
  assert.equal(c.excluded, 1);
  assert.equal(c.counted, 3);
  assert.deepEqual(certify([], {}), { verified: {}, unverified: {}, trimmed: {}, excluded: 0, counted: 0 });
});

test('amountText : le meme texte pour 20 et 19,99', () => {
  assert.equal(amountText(20), '20');
  assert.equal(amountText(19.99), '19.99');
  assert.equal(amountText(4.5), '4.50');
  assert.equal(amountText(NaN), '');
});

/* ------------------------------------------------- de bout en bout, en francais */

test('une offre jugee depuis ce que le stockage garde, puis dite en francais', () => {
  setLocale('fr');
  try {
    const o = { ...offre({ title: 'Portal Stories', store: 'epic' }), normalisedTitle: 'portal stories' };
    const ratings = { 't:portal stories': { appid: '620', score: 8, positive: 880, total: 1000, at: NOW } };
    const checks = { 'app:620': { appid: '620', type: 'game', isFree: false, price: 19.99, currency: 'USD', at: NOW } };
    const v = verdictFor(o, { ratings, checks, facts: collectionFacts(null) });
    assert.equal(v.grade, 'A');
    assert.equal(v.appid, '620');
    assert.equal(gradeLabel(v.grade, (k, ...a) => k), 'bargainGradeA');
    assert.equal(verdictLine(v, (k, ...a) => `${k}|${a.join('|')}`).split('|')[0], 'bargainLine');
    const titre = verdictTitle(v, (k, ...a) => `${k}:${a.join('~')}`);
    assert.ok(titre.startsWith('bargainTitle:A~bargainGradeA:\n'));
    assert.equal(titre.split('\n').length, 3, 'le titre et deux raisons');
    assert.equal(verdictLine({ grade: null, reasons: [] }, (k) => k), '', 'pas de note, pas de ligne');
  } finally { setLocale(null); }
});

test('les montants et les comptes se mettent en forme dans la langue, sans toucher au texte neutre', () => {
  const fmt = { money: (n, d) => `${String(n).replace('.', ',')} ${d === 'EUR' ? '\u20ac' : d}`, number: (n) => n.toLocaleString('fr-FR') };
  const dit = (k, ...a) => `${k}|${a.join('|')}`;
  const inflee = { key: 'bargainInflated', args: ['60 USD', '19.99 USD'], tone: 'bad' };
  assert.equal(reasonText(inflee, dit), 'bargainInflated|60 USD|19.99 USD', 'sans mise en forme : le texte neutre');
  assert.equal(reasonText(inflee, dit, fmt), 'bargainInflated|60 USD|19,99 USD');
  assert.equal(reasonText({ key: 'bargainValueConfirmed', args: ['24.99 EUR'], tone: 'good' }, dit, fmt), 'bargainValueConfirmed|24,99 \u20ac');
  const note_ = reasonText({ key: 'bargainRatedHigh', args: ['92', '100000'], tone: 'good' }, dit, fmt);
  assert.ok(/^bargainRatedHigh\|92\|100[\s\u00a0\u202f]000$/u.test(note_), note_);
  assert.equal(reasonText({ key: 'bargainNeedsBase', args: ['Portal 2'], tone: 'bad' }, dit, fmt), 'bargainNeedsBase|Portal 2', 'un nom de jeu reste tel quel');
  assert.equal(reasonText({ key: 'bargainValueConfirmed', args: ['??'], tone: 'good' }, dit, fmt), 'bargainValueConfirmed|??', 'illisible : tel quel');
});

test('la notification d\'un jeu seul porte son verdict sur une derniere ligne', () => {
  const jeu = { store: 'epic', title: 'Astrea', end: NOW + 5 * 86400000 };
  const { text } = composeAnnouncement([jeu], null, NOW, null, null, 'Verdict B : Bonne affaire. Bien noté.');
  assert.match(text, /\nVerdict B : Bonne affaire\. Bien noté\.$/);
  assert.ok(!composeAnnouncement([jeu], null, NOW, null, null, null).text.includes('Verdict'));
  assert.ok(!composeAnnouncement([jeu, { ...jeu, title: 'B' }], null, NOW, null, null, 'Verdict').text.includes('Verdict'), 'plusieurs jeux : pas de verdict');
});

test('la provenance de la valeur est figee dans le registre, avec le reste', () => {
  const catalogue = {
    'epic:hades': { store: 'epic', storeId: 'hades', title: 'Hades', worth: '24,99 EUR', source: 'epic-api', origin: { worth: 'epic-api' } },
    'amazon:luna-x': { store: 'amazon', storeId: 'luna-x', title: 'Luna X', worth: '$14.99', source: 'gamerpower' },
  };
  const ajouts = [
    { key: 'slug:hades', entry: { status: 'claimed', ts: 100 } },
    { key: 'slug:luna-x', entry: { status: 'claimed', ts: 200 } },
  ];
  let lib = integrateHistory({}, { platform: 'Epic Games', added: [ajouts[0]], catalog: catalogue }).library;
  lib = integrateHistory(lib, { platform: 'Amazon Luna', added: [ajouts[1]], catalog: catalogue }).library;
  assert.equal(lib['epic:hades'].wsrc, 'store');
  assert.equal(lib['amazon:luna-x'].wsrc, 'aggregator');
  // Un champ renseigne ne s'efface pas ; une entree sans provenance n'invente pas de cle.
  assert.equal(mergeEntry(lib['epic:hades'], makeEntry({ store: 'epic', id: 'hades', ts: 50, status: 'claimed' })).wsrc, 'store');
  assert.ok(!('wsrc' in makeEntry({ store: 'epic', id: 'x', ts: 1, status: 'claimed' })));
  assert.ok(!('wsrc' in makeEntry({ store: 'epic', id: 'x', ts: 1, status: 'claimed', wsrc: 'pirate' })), 'valeurs connues seulement');
  // Et le bilan la lit : le catalogue d'abord, le registre quand il est purge.
  const rows = claimsMade({ 'Epic Games': { 'slug:hades': { status: 'claimed', ts: 100 } } }, {}, { library: lib });
  assert.equal(rows[0].source, 'store');
  assert.equal(rows[0].worth, 24.99);
});

test('branche partout : worker, cycle, popup, reglage commun avec les notes Steam', () => {
  const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.equal(DEFAULT_SETTINGS.steamRatings, true);
  const bg = lire('background.js');
  assert.match(bg, /verdictOffer: \(offer\) => verdictOne\(offer\)/);
  assert.match(bg, /const c = await ensureChecks\(offres\);/, 'apres les notes, dont il tient son appid');
  assert.match(bg, /if \(settings\.steamRatings === false\) return null;\s*const raw = await readKeys\(api, \[KEY_RATINGS, KEY_CHECKS\]\)/, 'le meme reglage coupe les deux');
  assert.match(lire('watch/cycle.js'), /!decision\.digest && watched\.length === 1 && typeof verdictOffer === 'function'/);
  const popup = lire('pages/popup.js');
  assert.match(popup, /if \(verdict\) actions\.append\(verdict\);/);
  assert.match(popup, /if \(!ctx\.ratingsOn \|\| offer\.alreadyOwned === true\) return null;/, 'rien a juger sur un jeu deja a vous');
  const manifest = JSON.parse(lire('manifest.json'));
  assert.ok(manifest.host_permissions.includes('https://store.steampowered.com/*'), 'aucune permission nouvelle');
});

/* ----------------------------------------------------------- les phrases */

test('chaque raison a sa phrase, dans les quatre langues, avec ses trous', () => {
  const trous = {
    bargainGradeA: 0, bargainGradeB: 0, bargainGradeC: 0, bargainGradeD: 0, bargainGradeNone: 0,
    bargainTitle: 2, bargainLine: 3,
    bargainFreeForever: 0, bargainDemo: 0, bargainNotAGame: 0,
    bargainRatedHigh: 2, bargainRatedGood: 2, bargainRatedMixed: 2, bargainRatedLow: 2, bargainFewReviews: 1,
    bargainValueConfirmed: 1, bargainValueSmall: 1, bargainValueUnconfirmed: 1, bargainInflated: 2,
    bargainNeedsBase: 1, bargainNeedsBaseBare: 0, bargainNeedsBaseUnknown: 0, bargainBaseOwned: 0, bargainExtra: 0, bargainNoData: 0,
    heroVerified: 1, heroUnverified: 1, heroTrimmed: 1, heroExcluded: 1, heroVerifiedTitle: 0,
  };
  for (const l of ['fr', 'en', 'de', 'es']) {
    const table = JSON.parse(readFileSync(new URL(`../_locales/${l}/messages.json`, import.meta.url), 'utf-8'));
    for (const [cle, n] of Object.entries(trous)) {
      const msg = table[cle] && table[cle].message;
      assert.ok(msg, `${l} ${cle}`);
      for (let i = 1; i <= n; i++) assert.ok(msg.includes(`$${i}`), `${l} ${cle} : $${i}`);
      assert.ok(!msg.includes(`$${n + 1}`), `${l} ${cle} : pas de trou en trop`);
    }
  }
});

test('les cles de toutes les raisons que grade() peut rendre existent', () => {
  const source = readFileSync(new URL('../watch/bargain.js', import.meta.url), 'utf-8');
  const table = JSON.parse(readFileSync(new URL('../_locales/fr/messages.json', import.meta.url), 'utf-8'));
  const cles = new Set([...source.matchAll(/'(bargain[A-Z][A-Za-z]+)'/g)].map((m) => m[1]));
  assert.ok(cles.size >= 20);
  for (const c of cles) assert.ok(table[c], c);
});

/* ------------------------------------------------------- table d'or Kotlin */

/* Chaque cas : tous les champs que la copie Kotlin lit. `-` = absent. */
const CAS = [
  ['a-epic-top', { offer: offre(), rating: [920, 1000] }],
  ['b-sans-valeur', { offer: offre({ worth: null }), rating: [920, 1000] }],
  ['b-note-moyenne', { offer: offre(), rating: [750, 1000] }],
  ['c-partage', { offer: offre(), rating: [600, 1000] }],
  ['d-mal-note', { offer: offre(), rating: [400, 1000] }],
  ['b-peu-avis', { offer: offre(), rating: [30, 30] }],
  ['null-rien', { offer: offre({ worth: null, source: 'gamerpower' }) }],
  ['d-keepable-faux', { offer: offre({ keepable: false, worth: null }), rating: [990, 1000] }],
  ['d-f2p', { offer: offre(), check: fiche({ isFree: true }), rating: [990, 1000] }],
  ['d-demo-fiche', { offer: offre(), check: fiche({ type: 'demo' }) }],
  ['d-demo-titre', { offer: offre({ title: 'Hades Demo' }) }],
  ['d-musique', { offer: offre(), check: fiche({ type: 'music' }) }],
  ['a-demon', { offer: offre({ title: 'Demon Slayer' }), rating: [900, 1000] }],
  ['a-agregateur-recoupe', { offer: offre({ source: 'gamerpower', worth: '$24.99' }), check: fiche({ price: 19.99 }), rating: [900, 1000] }],
  ['c-gonfle', { offer: offre({ source: 'gamerpower', worth: '$60.00' }), check: fiche({ price: 19.99 }), rating: [900, 1000] }],
  ['d-tres-gonfle-mal-note', { offer: offre({ source: 'gamerpower', worth: '$90.00' }), check: fiche({ price: 19.99 }), rating: [600, 1000] }],
  ['b-agregateur-sans-fiche', { offer: offre({ source: 'gamerpower', worth: '$30' }), rating: [900, 1000] }],
  ['null-agregateur-na', { offer: offre({ source: 'gamerpower', worth: 'N/A' }) }],
  ['d-dlc-base-manque', { offer: offre({ store: 'steam', source: 'steam', category: 'DLC', worth: '4.99 EUR', parentAppid: '620' }), check: fiche({ type: 'dlc', fullgame: '620', fullgameName: 'Portal 2' }), baseOwned: false }],
  ['b-dlc-base-possede', { offer: offre({ store: 'steam', source: 'steam', category: 'DLC', worth: '4.99 EUR', parentAppid: '620' }), check: fiche({ type: 'dlc', fullgame: '620', fullgameName: 'Portal 2' }), baseOwned: true }],
  ['c-dlc-base-inconnu', { offer: offre({ store: 'steam', source: 'steam', category: 'DLC', worth: '4.99 EUR', parentAppid: '620' }), check: fiche({ type: 'dlc', fullgame: '620', fullgameName: 'Portal 2' }) }],
  ['c-butin', { offer: offre({ source: 'gamerpower', category: 'DLC', title: 'Skin Pack', worth: null }) }],
  ['b-gog-valeur-seule', { offer: offre({ store: 'gog', source: 'gog', worth: '19.99 USD' }) }],
  ['null-petite-valeur-seule', { offer: offre({ worth: '5 EUR' }) }],
  ['b-gog-fiche-seule-ok', { offer: offre({ store: 'gog', source: 'gog', worth: '39,99 EUR' }), rating: [80, 90] }],
];

const dash = (v) => (v === undefined || v === null ? '-' : String(v));

function ligneOr([id, c]) {
  const o = c.offer;
  const k = o.keepable === true ? 't' : o.keepable === false ? 'f' : '-';
  const ch = c.check;
  const fiche_ = ch ? [ch.type, ch.isFree ? 1 : 0, dash(ch.price), dash(ch.currency), dash(ch.fullgame), dash(ch.fullgameName)].join('|') : '-';
  const rt = c.rating ? c.rating.join('/') : '-';
  const bo = c.baseOwned === true ? 't' : c.baseOwned === false ? 'f' : '-';
  const r = grade({ offer: o, check: ch || null, rating: c.rating ? { positive: c.rating[0], total: c.rating[1] } : null, baseOwned: c.baseOwned === undefined ? null : c.baseOwned });
  const raisons = r.reasons.map((x) => `${x.key}:${x.args.join('~')}:${x.tone}`).join(';');
  return [id, o.title, o.store, o.source, dash(o.category), k, dash(o.worth), dash(o.parentAppid), fiche_, rt, bo, r.grade || '-', raisons].join('\t');
}

test('la table d\'or de l\'appli Android est celle du module JS', () => {
  const OR = new URL('../android/app/src/test/resources/bargain-golden.tsv', import.meta.url);
  const attendu = `${CAS.map(ligneOr).join('\n')}\n`;
  if (process.env.UPDATE_GOLDEN) writeFileSync(OR, attendu);
  assert.equal(readFileSync(OR, 'utf-8'), attendu,
    'android/app/src/test/resources/bargain-golden.tsv est perime : UPDATE_GOLDEN=1 npm test, puis relancer le test Kotlin');
});
