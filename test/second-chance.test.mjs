/* « Deuxieme chance » (2.98.0) : un jeu deja offert sans que vous l'ayez eu,
 * qui revient. Les regles evitent de crier au loup : il faut un passage rate,
 * jamais un jeu deja pris, jamais l'offre elle-meme apres une coupure de sa
 * source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fakeChrome } from './fake-chrome.mjs';
import { recurrenceIndex, secondChance, markSecondChance } from '../watch/recurrence.js';
import { byUrgency, makeOffer, normaliseTitle, STORES } from '../watch/offer.js';
import { runCycle, composeAnnouncement } from '../watch/cycle.js';
import { KEYS } from '../watch/storage.js';
import { KEY_OUTCOMES } from '../watch/outcomes.js';
import { KEY_LIBRARY } from '../watch/library.js';

const DAY = 86400000;
const T = Date.UTC(2026, 8, 27, 12);
const MARS = Date.UTC(2026, 2, 12, 18);

const issue = (title, store, ts, outcome) => ({ key: `${store}:${title}`, title, store, ts, outcome });
const index = (outcomes, library = {}) => recurrenceIndex({ outcomes, library, normalise: normaliseTitle });
const cette = (title, extra = {}) => ({ title, store: 'gog', start: T - 2 * DAY, ...extra });

test('rate en mars, offert de nouveau : deuxieme chance, avec la date et le magasin', () => {
  const i = index({ a: issue('Hades', 'epic', MARS, 'missed') });
  assert.deepEqual(secondChance(i, cette('Hades'), normaliseTitle, T), { ts: MARS, store: 'epic', count: 1 });
  // Le magasin n'a aucune importance : rate sur Epic, offert sur GOG, c'est la meme occasion.
  assert.equal(secondChance(i, cette('Hades', { store: 'epic' }), normaliseTitle, T).store, 'epic');
  // Une edition ou une casse differente est le meme jeu.
  assert.ok(secondChance(i, cette('HADES'), normaliseTitle, T));
});

test('un passage « incertain » (un captcha a arrete la prise) compte : le jeu n\'est pas au compte', () => {
  const i = index({ a: issue('Gris', 'gog', MARS, 'unknown') });
  assert.ok(secondChance(i, cette('Gris'), normaliseTitle, T));
});

test('jamais pour un jeu deja pris, sur n\'importe quel magasin', () => {
  const pris = index({ a: issue('Tunic', 'epic', MARS, 'missed'), b: issue('Tunic', 'gog', MARS + 40 * DAY, 'taken') });
  assert.equal(secondChance(pris, cette('Tunic'), normaliseTitle, T), null);
  // Le registre aussi : il n'est jamais purge.
  const registre = index({ a: issue('Celeste', 'epic', MARS, 'missed') }, { 'amazon:celeste': { store: 'amazon', id: 'celeste', title: 'Celeste', ts: MARS + DAY, status: 'claimed' } });
  assert.equal(secondChance(registre, cette('Celeste'), normaliseTitle, T), null);
});

test('jamais un jeu jamais vu, ni une offre qui se rencontre elle-meme', () => {
  assert.equal(secondChance(index({}), cette('Inconnu'), normaliseTitle, T), null);
  assert.equal(secondChance(null, cette('Hades'), normaliseTitle, T), null);
  // Le passage finit APRES le debut de cette offre : c'est elle-meme, apres une coupure de sa source.
  const meme = index({ a: issue('Hades', 'epic', T - DAY, 'missed') });
  assert.equal(secondChance(meme, cette('Hades', { start: T - 2 * DAY }), normaliseTitle, T), null);
  // Un jour de marge avant le debut : assez pour etre une autre fois.
  const avant = index({ a: issue('Hades', 'epic', T - 4 * DAY, 'missed') });
  assert.ok(secondChance(avant, cette('Hades', { start: T - 2 * DAY }), normaliseTitle, T));
  // Sans debut connu : trois jours de recul.
  const recent = index({ a: issue('Hades', 'epic', T - DAY, 'missed') });
  assert.equal(secondChance(recent, { title: 'Hades', store: 'gog' }, normaliseTitle, T), null);
  assert.ok(secondChance(index({ a: issue('Hades', 'epic', T - 4 * DAY, 'missed') }), { title: 'Hades', store: 'gog' }, normaliseTitle, T));
});

test('plusieurs fois rate : le plus recent est dit, le compte aussi', () => {
  const i = index({ a: issue('Hades', 'epic', MARS, 'missed'), b: issue('Hades', 'amazon', MARS + 90 * DAY, 'missed') });
  assert.deepEqual(secondChance(i, cette('Hades'), normaliseTitle, T), { ts: MARS + 90 * DAY, store: 'amazon', count: 2 });
});

test('le drapeau est derive, et passe devant le tout-venant mais derriere ce qui est attendu', () => {
  const i = index({ a: issue('Hades', 'epic', MARS, 'missed') });
  const offres = [
    { title: 'Autre', store: 'epic', end: T + DAY, start: T - DAY },
    { title: 'Hades', store: 'gog', end: T + 5 * DAY, start: T - 2 * DAY },
    { title: 'Attendu', store: 'epic', end: T + 6 * DAY, start: T - DAY, wished: true },
  ];
  const marquees = markSecondChance(offres, i, normaliseTitle, T);
  assert.equal(marquees[0].secondChance, undefined);
  assert.equal(marquees[1].secondChance.store, 'epic');
  assert.equal(offres[1].secondChance, undefined, 'l\'entree n\'est pas modifiee');
  assert.deepEqual(byUrgency(marquees, T).map((o) => o.title), ['Attendu', 'Hades', 'Autre']);
});

test('l\'annonce le dit : titre, et la fois d\'avant en mots', () => {
  const o = makeOffer({ source: 'test', store: STORES.GOG, storeId: 'hades', title: 'Hades', url: 'https://www.gog.com/game/hades' });
  const { title, text } = composeAnnouncement([{ ...o, end: T + 7 * 3600000, secondChance: { ts: MARS, store: 'epic', count: 1 } }], null, T);
  assert.match(title, /Hades/);
  assert.notEqual(title, composeAnnouncement([o], null, T).title, 'un titre a part');
  assert.match(text, /2026/);
  assert.match(text, /Epic/);
  assert.equal(text.split('\n').length, 2, 'une ligne de plus, pas un roman');
  // Sans deuxieme chance, rien ne change.
  assert.equal(composeAnnouncement([o], null, T).text.split('\n').length, 1);
});

test('de bout en bout : le cycle annonce a part le jeu rate, et n\'ecrit pas le drapeau dans le catalogue', async () => {
  const faux = fakeChrome({ now: T });
  const notifications = [];
  const hades = makeOffer({ source: 'test', store: STORES.EPIC, storeId: 'hades', title: 'Hades', url: 'https://store.epicgames.com/p/hades', start: T - DAY, end: T + 3 * DAY });
  const src = { name: 'test', completeList: true, minIntervalMs: 0, async discover() { return { offers: [hades], dropped: [], errors: [] }; } };
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'], notifyMode: 'digest' },
    [KEY_OUTCOMES]: { 'epic:hades-2026-03': issue('Hades', 'gog', MARS, 'missed') },
    [KEY_LIBRARY]: {},
    // Deja amorce : un premier cycle n'annonce rien.
    [KEYS.STATE]: { booted: true },
  });
  const cycle = () => runCycle({
    chrome: faux.chrome, now: T, sources: { test: src }, notify: async (n) => { notifications.push(n); },
    updateBadge: async () => {}, record: () => {},
  });
  await cycle();
  assert.equal(notifications.length, 1, 'malgre le mode resume, la deuxieme chance est annoncee a part');
  assert.match(notifications[0].text, /2026/);
  const catalogue = faux.payload()[KEYS.OFFERS];
  for (const o of Object.values(catalogue)) assert.equal(o.secondChance, undefined, 'jamais persiste');
});

test('le popup, les libelles et la charte', () => {
  const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const popup = lire('pages/popup.js');
  assert.match(popup, /import \{ recurrenceIndex, secondChance \} from '\.\.\/watch\/recurrence\.js';/);
  assert.match(popup, /el\('span', 'kind-tag second-chance', t\('tagSecondChance'\)\)/);
  assert.match(lire('pages/brut.css'), /\.kind-tag\.second-chance \{/);
  for (const l of ['fr', 'en', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['notifySecondChanceTitle', 'notifySecondChanceLine', 'tagSecondChance']) assert.ok(table[k] && table[k].message, `${l} ${k}`);
  }
});
