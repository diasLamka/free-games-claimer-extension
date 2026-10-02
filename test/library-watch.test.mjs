/* Le gardien de bibliotheque (2.105.0) : dire qu'un jeu pris a disparu, sans jamais
 * crier au loup. Chaque garde-fou a son test : une fausse alerte est pire que le silence. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_LIBWATCH, WATCHED_STORES, MIN_AGE_MS, IMPORT_MAX_AGE_MS, MIN_GAP_MS, EVERY_MS, RETRY_MS, MIN_STORE_ITEMS,
  readWatchState, due, storesToImport, trustedStores, sameGame, missingGames, reconcile, scheduled,
} from '../watch/library-watch.js';

const NOW = Date.UTC(2026, 9, 2, 20, 0, 0);
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

/** Une collection importee : `n` jeux du magasin, plus ceux qu'on veut. */
function collection(store, titres, { lastOk = NOW - HOUR, fill = MIN_STORE_ITEMS } = {}) {
  const items = {};
  titres.forEach((t, i) => { items[`${store}:${i}`] = { store, id: String(i), title: t }; });
  for (let i = 0; i < fill; i++) items[`${store}:f${i}`] = { store, id: `f${i}`, title: `Remplissage ${i} ${store}` };
  return { stores: { [store]: { status: 'ok', at: lastOk, lastOk, count: Object.keys(items).length } }, items };
}
const pris = (store, titre, ts = NOW - 10 * DAY, o = {}) => [`${store}:${titre}`, { store, id: titre.toLowerCase(), title: titre, ts, status: 'claimed', ...o }];
const lib = (...entrees) => Object.fromEntries(entrees);

test('seuls Steam, GOG et Epic sont surveilles', () => {
  assert.deepEqual([...WATCHED_STORES], ['steam', 'gog', 'epic']);
  const c = collection('gog', ['Hades']);
  assert.deepEqual(missingGames({ library: lib(pris('amazon', 'Luna X')), collection: c, now: NOW }), [], 'Amazon n\'a pas de collection a relire');
});

test('un jeu qui figure dans la collection ne manque pas, a une edition pres', () => {
  const c = collection('gog', ['Hades - Standard Edition', 'Celeste']);
  const r = missingGames({ library: lib(pris('gog', 'Hades'), pris('gog', 'Celeste'), pris('gog', 'Tunic')), collection: c, now: NOW });
  assert.deepEqual(r.map((m) => m.title), ['Tunic']);
  assert.ok(sameGame('Hades', 'HADES'));
  assert.ok(sameGame('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt - Game of the Year Edition'));
  assert.ok(sameGame('Hollow Knight', 'Hollow Knight: Silksong Pack'), 'l\'un dans l\'autre, six caracteres au moins');
  assert.equal(sameGame('Hades', 'Hades II'), false, 'trop court pour se contenter de la contenance');
  assert.equal(sameGame('', 'x'), false);
  assert.equal(sameGame('Portal', 'Portal 2'), true, 'six caracteres : contenu');
});

test('une importation ancienne ou minuscule ne prouve rien', () => {
  const vieille = collection('gog', ['Celeste'], { lastOk: NOW - IMPORT_MAX_AGE_MS - 1 });
  assert.deepEqual(trustedStores(vieille, NOW), []);
  assert.deepEqual(missingGames({ library: lib(pris('gog', 'Tunic')), collection: vieille, now: NOW }), []);
  const petite = collection('gog', ['Celeste'], { fill: 2 });
  assert.deepEqual(trustedStores(petite, NOW), []);
  const bonne = collection('gog', ['Celeste']);
  assert.deepEqual(trustedStores(bonne, NOW), ['gog']);
  assert.deepEqual(trustedStores(null, NOW), []);
  assert.equal(MIN_STORE_ITEMS >= 10, true);
});

test('un jeu pris depuis moins de quarante-huit heures n\'est pas juge', () => {
  const c = collection('gog', ['Celeste']);
  const frais = lib(pris('gog', 'Tunic', NOW - MIN_AGE_MS + 1000));
  assert.deepEqual(missingGames({ library: frais, collection: c, now: NOW }), []);
  const mur = lib(pris('gog', 'Tunic', NOW - MIN_AGE_MS - 1000));
  assert.equal(missingGames({ library: mur, collection: c, now: NOW }).length, 1);
  // Ni un echec, ni une entree sans titre.
  assert.deepEqual(missingGames({ library: lib(pris('gog', 'Echec', NOW - 10 * DAY, { status: 'failed' }), pris('gog', 'X', NOW - 10 * DAY, { title: null })), collection: c, now: NOW }), []);
});

test('la comparaison se limite au magasin du jeu pris', () => {
  const c = { ...collection('gog', ['Celeste']) };
  const steam = collection('steam', ['Tunic']);
  const les2 = { stores: { ...c.stores, ...steam.stores }, items: { ...c.items, ...steam.items } };
  // Tunic est dans Steam, pas sur GOG : un jeu GOG nomme Tunic manque bien.
  assert.equal(missingGames({ library: lib(pris('gog', 'Tunic')), collection: les2, now: NOW }).length, 1);
  assert.equal(missingGames({ library: lib(pris('steam', 'Tunic')), collection: les2, now: NOW }).length, 0);
});

test('deux relectures a vingt heures d\'ecart avant toute alerte, et une seule alerte', () => {
  const manque = [{ key: 'gog:tunic', store: 'gog', title: 'Tunic', claimedAt: NOW - 10 * DAY }];
  const un = reconcile(null, manque, { now: NOW, judged: ['gog'] });
  assert.deepEqual(un.alerts, [], 'premiere fois : on note, on ne dit rien');
  assert.equal(un.state.missing['gog:tunic'].firstAt, NOW);

  const tot = reconcile(un.state, manque, { now: NOW + MIN_GAP_MS - 1, judged: ['gog'] });
  assert.deepEqual(tot.alerts, [], 'trop tot : meme import, meme verdict');

  const deux = reconcile(un.state, manque, { now: NOW + MIN_GAP_MS + HOUR, judged: ['gog'] });
  assert.deepEqual(deux.alerts.map((a) => a.title), ['Tunic']);
  assert.ok(deux.state.missing['gog:tunic'].alertedAt);

  const trois = reconcile(deux.state, manque, { now: NOW + 40 * DAY, judged: ['gog'] });
  assert.deepEqual(trois.alerts, [], 'dit une fois');
});

test('un jeu qui reapparait sort de la liste ; un magasin non juge est laisse tel quel', () => {
  const manque = [{ key: 'gog:tunic', store: 'gog', title: 'Tunic', claimedAt: 1 }, { key: 'steam:portal', store: 'steam', title: 'Portal', claimedAt: 1 }];
  const un = reconcile(null, manque, { now: NOW, judged: ['gog', 'steam'] });
  const revenu = reconcile(un.state, [manque[1]], { now: NOW + DAY, judged: ['gog', 'steam'] });
  assert.deepEqual(Object.keys(revenu.state.missing), ['steam:portal'], 'Tunic est revenu');
  const nonJuge = reconcile(un.state, [], { now: NOW + DAY, judged: ['steam'] });
  assert.deepEqual(Object.keys(nonJuge.state.missing), ['gog:tunic'], 'GOG n\'a pas ete relu cette fois : on garde ce qu\'on savait');
});

test('la prochaine relecture : un mois, le lendemain si l\'import a echoue, le jour d\'apres si un jeu attend confirmation', () => {
  const vide = readWatchState(null);
  assert.equal(scheduled(vide, { now: NOW, ok: true }).nextAt, NOW + EVERY_MS);
  assert.equal(scheduled(vide, { now: NOW, ok: false }).nextAt, NOW + RETRY_MS);
  const attente = reconcile(null, [{ key: 'gog:tunic', store: 'gog', title: 'Tunic', claimedAt: 1 }], { now: NOW, judged: ['gog'] }).state;
  assert.equal(scheduled(attente, { now: NOW, ok: true }).nextAt, NOW + MIN_GAP_MS + HOUR, 'la confirmation vient vite');
  const dit = reconcile(attente, [{ key: 'gog:tunic', store: 'gog', title: 'Tunic', claimedAt: 1 }], { now: NOW + 2 * DAY, judged: ['gog'] }).state;
  assert.equal(scheduled(dit, { now: NOW + 2 * DAY, ok: true }).nextAt, NOW + 2 * DAY + EVERY_MS, 'plus rien a confirmer : un mois');
  assert.equal(scheduled(vide, { now: NOW, ok: true }).at, NOW);
});

test('la relecture n\'est due que si l\'utilisateur l\'a demandee', () => {
  assert.equal(due({ libraryWatch: false }, null, NOW), false);
  assert.equal(due({}, null, NOW), false);
  assert.equal(due({ libraryWatch: true }, null, NOW), true, 'jamais lue : due');
  assert.equal(due({ libraryWatch: true }, { nextAt: NOW + 1 }, NOW), false);
  assert.equal(due({ libraryWatch: true }, { nextAt: NOW }, NOW), true);
  assert.equal(due(null, null, NOW), false);
});

test('les magasins a relire sont ceux deja importes une fois', () => {
  const steam = collection('steam', ['x']);
  const gog = { stores: { gog: { status: 'error', at: NOW, lastOk: null, count: 0 } }, items: {} };
  const c = { stores: { ...steam.stores, ...gog.stores }, items: steam.items };
  assert.deepEqual(storesToImport(c), ['steam'], 'GOG n\'a jamais reussi : on ne l\'invente pas');
  assert.deepEqual(storesToImport(null), []);
});

test('l\'etat stocke est relu avec ses defauts et ne grossit pas sans fin', () => {
  assert.deepEqual(readWatchState(null), { at: null, nextAt: null, missing: {} });
  const gros = { missing: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`gog:${i}`, { store: 'gog', title: 't', firstAt: 1, lastAt: 1 }])) };
  assert.equal(Object.keys(readWatchState(gros).missing).length, 200);
  assert.deepEqual(readWatchState({ missing: { a: 'x', b: { store: 3 } } }).missing, {});
  assert.equal(KEY_LIBWATCH, 'veille:gardien');
});
