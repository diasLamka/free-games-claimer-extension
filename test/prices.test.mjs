/* Les prix des souhaits : deux sources, une meme forme, et ce qu'on ne fait jamais.
 *
 * Ce que ces tests gardent avant tout : la cle ITAD ne sort que vers ITAD (jamais dans un message, une note, une sauvegarde),
 * les donnees d'ITAD ne sont ni converties ni retouchees (ses conditions), et un souhait n'est jamais sans prix pour une
 * cle mal recopiee : CheapShark prend le relais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_PRICES, KEY_ITAD, SOURCES, FRESH_MS, NOT_FOUND_MS, PER_RUN,
  itadKey, cleanKey, sharkSearchUrl, sharkLookupUrl, sharkGameUrl, sharkDealUrl, parseSharkList, matchTitle, parseSharkGame,
  itadLookupUrl, itadSearchUrl, itadPricesRequest, parseItadLookup, parseItadSearch, parseItadPrices,
  readItad, readShark, wantedSource, needsPrice, refreshPrices, testItad, sourceLabel,
} from '../watch/prices.js';
import { BACKUP_KEYS } from '../watch/full-backup.js';
import { EXPORT_KEYS } from '../watch/auto-backup.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { UI_COMMANDS } from '../watch/messaging.js';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const KEY = 'abcd1234EFGH5678ijkl9012mnop3456qrst7890';
const ID = '018d937f-0000-7000-8000-123456789abc';

/* ------------------------------------------------------------- les donnees */

const sharkGame = () => ({
  info: { title: 'HADES', steamAppID: '1145360', thumb: 'https://cdn.example/hades.jpg' },
  cheapestPriceEver: { price: '15.04', date: 1621111111 },
  deals: [
    { storeID: '1', dealID: 'AAAA%2BBBBBBBBBBBB', price: '24.99', retailPrice: '24.99', savings: '0.000000' },
    { storeID: '11', dealID: 'CCCC%2BDDDDDDDDDDDD', price: '18.74', retailPrice: '24.99', savings: '25.010004' },
    { storeID: '999', dealID: 'EEEE%2BFFFFFFFFFFFF', price: '20.00', retailPrice: '24.99', savings: '20.0' },
  ],
});

const AFFILIE = 'https://isthereanydeal.com/click/?a=b&tag=un-code&url=https%3A%2F%2Fshop.example%2Fhades%3Fref%3D1';
const itadPrix = () => [{
  id: ID,
  historyLow: { all: { amount: 9.99, amountInt: 999, currency: 'EUR' }, y1: null, m3: null },
  deals: [
    { shop: { id: 61, name: 'Steam' }, price: { amount: 20.99, amountInt: 2099, currency: 'EUR' }, regular: { amount: 20.99, amountInt: 2099, currency: 'EUR' }, cut: 0, url: 'https://store.steampowered.com/app/1145360/' },
    { shop: { id: 35, name: 'GOG' }, price: { amount: 12.49, amountInt: 1249, currency: 'EUR' }, regular: { amount: 20.99, amountInt: 2099, currency: 'EUR' }, cut: 40, url: AFFILIE },
  ],
}];

/** Un faux fetch : `routes` = [[sous-chaine de l'adresse, reponse]]. Note chaque appel. */
function faux(routes) {
  const appels = [];
  const f = async (url, init = {}) => {
    appels.push({ url: String(url), init });
    const hit = routes.find(([motif]) => String(url).includes(motif));
    if (!hit) return { ok: false, status: 404, json: async () => null };
    const rep = typeof hit[1] === 'function' ? hit[1](String(url), init) : hit[1];
    if (rep instanceof Error) throw rep;
    return { ok: rep.status === undefined || (rep.status >= 200 && rep.status < 300), status: rep.status ?? 200, json: async () => rep.json };
  };
  f.appels = appels;
  return f;
}

const lookupOk = { json: { found: true, game: { id: ID, slug: 'hades', title: 'Hades' } } };
const lookupAbsent = { json: { found: false } };

/* ---------------------------------------------------------------- la cle */

test('la cle ITAD : seule une valeur qui a la forme d\'une cle est retenue', () => {
  assert.equal(itadKey({ key: KEY }), KEY);
  assert.equal(itadKey({ key: `  ${KEY} \n` }), KEY);
  for (const raw of [undefined, null, {}, { key: '' }, { key: 'court' }, { key: 'a b c d e f g h i' }, { key: 'x'.repeat(200) }, { key: 42 }, 'cle']) {
    assert.equal(itadKey(raw), null, JSON.stringify(raw));
  }
  assert.equal(cleanKey(` ${KEY} `), KEY);
  assert.equal(cleanKey('pas une cle!'), null);
  // La cle part en parametre d'adresse, sans troncature : la forme la borne a 100 signes (celles du service en ont 40).
  assert.equal(cleanKey('k'.repeat(100)), 'k'.repeat(100));
  assert.equal(cleanKey('k'.repeat(101)), null);
});

test('la cle et le cache sont hors de toute sauvegarde : une cle est un secret', () => {
  assert.ok(!BACKUP_KEYS.includes(KEY_ITAD), 'sauvegarde complete');
  assert.ok(!EXPORT_KEYS.includes(KEY_ITAD), 'sauvegarde automatique');
  assert.equal(KEY_ITAD, 'veille:itad');
});

/* ----------------------------------------------------------- les adresses */

test('les adresses de CheapShark : le titre est encode, l\'identifiant aussi', () => {
  assert.equal(sharkSearchUrl('Hades & Co #1'), 'https://www.cheapshark.com/api/1.0/games?title=Hades%20%26%20Co%20%231&limit=8');
  assert.equal(sharkLookupUrl(1145360), 'https://www.cheapshark.com/api/1.0/games?steamAppID=1145360');
  assert.equal(sharkGameUrl('196149'), 'https://www.cheapshark.com/api/1.0/games?id=196149');
});

test('l\'adresse d\'une affaire CheapShark : l\'identifiant, deja encode par l\'API, n\'est pas re-encode', () => {
  assert.equal(sharkDealUrl('AAAA%2BBBBBBBBBBBB'), 'https://www.cheapshark.com/redirect?dealID=AAAA%2BBBBBBBBBBBB');
  assert.equal(sharkDealUrl('court'), null);
  assert.equal(sharkDealUrl('a b c d e f g h'), null);
  assert.equal(sharkDealUrl(undefined), null);
});

test('les requetes d\'ITAD : la cle en parametre, le pays en deux lettres, ni code promo ni affaires seules', () => {
  assert.equal(itadLookupUrl({ key: KEY, appid: 1145360 }), `https://api.isthereanydeal.com/games/lookup/v1?key=${KEY}&appid=1145360`);
  assert.equal(itadLookupUrl({ key: KEY, title: 'Hades II' }), `https://api.isthereanydeal.com/games/lookup/v1?key=${KEY}&title=Hades%20II`);
  assert.match(itadSearchUrl({ key: KEY, title: 'Hades' }), /\/games\/search\/v1\?key=.*&title=Hades&results=6$/);
  const r = itadPricesRequest({ key: KEY, country: 'fr', id: ID });
  assert.match(r.url, /^https:\/\/api\.isthereanydeal\.com\/games\/prices\/v3\?key=/);
  assert.match(r.url, /country=FR/);
  assert.match(r.url, /deals=false/);
  assert.match(r.url, /vouchers=false/);
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.credentials, 'omit');
  assert.equal(r.init.body, JSON.stringify([ID]));
  assert.match(itadPricesRequest({ key: KEY, country: 'France', id: ID }).url, /country=FR/, 'un pays illisible vaut la France');
});

/* ------------------------------------------------------------- CheapShark */

test('une recherche CheapShark : seules les lignes lisibles, et le titre exact', () => {
  const liste = parseSharkList([
    { gameID: '196149', steamAppID: '1145360', external: 'Hades', thumb: 'https://x/h.jpg' },
    { gameID: '5', steamAppID: null, external: 'The Road to Hades', thumb: 'http://x/ko.jpg' },
    { gameID: 'pas-un-nombre', external: 'Casse' },
    null,
  ]);
  assert.deepEqual(liste.map((g) => g.gameId), ['196149', '5']);
  assert.equal(liste[1].thumb, null, 'une vignette http n\'est pas gardee');
  assert.equal(matchTitle(liste, 'HADES').gameId, '196149');
  assert.equal(matchTitle(liste, 'Hades 2'), null, 'jamais le prix d\'un autre jeu');
  assert.equal(matchTitle(liste, ''), null);
  assert.deepEqual(parseSharkList('rien'), []);
});

test('le detail d\'un jeu CheapShark : prix en nombres, du moins cher au plus cher, plus bas historique borne', () => {
  const info = parseSharkGame(sharkGame(), NOW);
  assert.equal(info.source, SOURCES.SHARK);
  assert.equal(info.currency, 'USD');
  assert.deepEqual(info.deals.map((d) => d.amount), [18.74, 20, 24.99]);
  assert.equal(info.best.shop, 'Humble Store');
  assert.equal(info.best.cut, 25);
  assert.equal(info.best.url, 'https://www.cheapshark.com/redirect?dealID=CCCC%2BDDDDDDDDDDDD');
  assert.equal(info.deals[1].shop, 'Marchand 999', 'un marchand inconnu s\'ecrit avec son numero');
  assert.equal(info.low, 15.04);
  assert.equal(info.lowAt, 1621111111000);

  // Le plus bas ne peut pas etre au-dessus du prix d'aujourd'hui.
  const trop = sharkGame(); trop.cheapestPriceEver.price = '30.00';
  assert.equal(parseSharkGame(trop, NOW).low, 18.74);
  assert.equal(parseSharkGame({ deals: [] }, NOW), null);
  assert.equal(parseSharkGame(null, NOW), null);
});

/* ------------------------------------------------------------------- ITAD */

test('un lookup ITAD : seul un jeu trouve avec un identifiant lisible', () => {
  assert.deepEqual(parseItadLookup(lookupOk.json), { id: ID, slug: 'hades', title: 'Hades' });
  assert.equal(parseItadLookup({ found: false }), null);
  assert.equal(parseItadLookup({ found: true, game: { id: 'x' } }), null);
  assert.equal(parseItadLookup(null), null);
  assert.deepEqual(parseItadSearch([{ id: ID, slug: 's', title: 'T' }, { id: 'zzz' }, null]).map((g) => g.id), [ID]);
});

test('les prix d\'ITAD : les montants et les adresses sont gardes TELS QUELS, sans conversion ni nettoyage', () => {
  const info = parseItadPrices(itadPrix(), { now: NOW, slug: 'hades' });
  assert.equal(info.source, SOURCES.ITAD);
  assert.equal(info.currency, 'EUR', 'la devise est celle d\'ITAD, jamais convertie');
  assert.deepEqual(info.deals.map((d) => d.amount), [12.49, 20.99]);
  assert.equal(info.best.shop, 'GOG');
  assert.equal(info.best.cut, 40);
  assert.equal(info.best.regular, 20.99);
  assert.equal(info.best.url, AFFILIE, 'les etiquettes d\'affiliation font partie de la donnee');
  assert.equal(info.low, 9.99);
  assert.equal(info.page, 'https://isthereanydeal.com/game/hades/info/');
});

test('les prix d\'ITAD : une adresse qui n\'est pas https est ecartee, un plus bas historique ne depasse pas le prix du jour', () => {
  const j = itadPrix();
  j[0].deals[1].url = 'javascript:alert(1)';
  assert.equal(parseItadPrices(j, { now: NOW }).best.url, null);
  const k = itadPrix(); k[0].historyLow.all.amount = 50;
  assert.equal(parseItadPrices(k, { now: NOW }).low, 12.49);
  assert.equal(parseItadPrices([{ id: ID, historyLow: { all: null, y1: null, m3: null }, deals: [] }], { now: NOW }), null);
  assert.equal(parseItadPrices([], { now: NOW }), null);
  assert.equal(parseItadPrices(null, { now: NOW }), null);
});

/* ------------------------------------------------------------ la lecture */

test('ITAD : par l\'appid d\'abord, puis les prix', async () => {
  const f = faux([['games/lookup/v1', lookupOk], ['games/prices/v3', { json: itadPrix() }]]);
  const r = await readItad({ target: { title: 'Hades', appid: '1145360' }, key: KEY, country: 'FR', fetch: f, now: NOW });
  assert.equal(r.info.best.shop, 'GOG');
  assert.equal(f.appels.length, 2);
  assert.match(f.appels[0].url, /appid=1145360/);
  assert.equal(f.appels[1].init.method, 'POST');
});

test('ITAD : un appid inconnu, le titre exact prend le relais ; puis la recherche', async () => {
  const sansAppid = faux([['appid=', lookupAbsent], ['title=Hades', lookupOk], ['games/prices/v3', { json: itadPrix() }]]);
  const r = await readItad({ target: { title: 'Hades', appid: '1' }, key: KEY, country: 'FR', fetch: sansAppid, now: NOW });
  assert.ok(r.info);

  const parRecherche = faux([
    ['games/lookup/v1', lookupAbsent],
    ['games/search/v1', { json: [{ id: ID, slug: 'h2', title: 'Hades II' }, { id: '018d937f-0000-7000-8000-000000000001', slug: 'hades', title: 'Hades' }] }],
    ['games/prices/v3', { json: itadPrix() }],
  ]);
  const r2 = await readItad({ target: { title: 'hades', appid: null }, key: KEY, country: 'FR', fetch: parRecherche, now: NOW });
  assert.ok(r2.info);
  const corps = JSON.parse(parRecherche.appels.at(-1).init.body);
  assert.deepEqual(corps, ['018d937f-0000-7000-8000-000000000001'], 'le titre EXACT, pas le premier venu');
});

test('ITAD : un jeu introuvable est un jeu introuvable, pas une erreur', async () => {
  const f = faux([['games/lookup/v1', lookupAbsent], ['games/search/v1', { json: [] }]]);
  const r = await readItad({ target: { title: 'Inconnu', appid: null }, key: KEY, country: 'FR', fetch: f, now: NOW });
  assert.deepEqual(r, { info: null });
});

test('ITAD : cle refusee, trop de requetes, reseau en panne -- et la cle ne sort jamais dans la reponse', async () => {
  const refusee = await readItad({ target: { title: 'Hades' }, key: KEY, country: 'FR', fetch: faux([['games/lookup/v1', { status: 403 }]]), now: NOW });
  assert.deepEqual(refusee, { error: 'key' });
  const trop = await readItad({ target: { title: 'Hades' }, key: KEY, country: 'FR', fetch: faux([['games/lookup/v1', { status: 429 }]]), now: NOW });
  assert.deepEqual(trop, { error: 'busy' });
  const panne = await readItad({ target: { title: 'Hades' }, key: KEY, country: 'FR', fetch: faux([['games/lookup/v1', () => new Error(`boom ${KEY}`)]]), now: NOW });
  assert.deepEqual(panne, { error: 'net' });
  for (const r of [refusee, trop, panne]) assert.ok(!JSON.stringify(r).includes(KEY));
});

test('CheapShark : par l\'appid, sinon par le titre EXACT -- jamais un autre jeu', async () => {
  const parAppid = faux([['steamAppID=', { json: [{ gameID: '196149', external: 'Hades' }] }], ['games?id=196149', { json: sharkGame() }]]);
  assert.ok((await readShark({ target: { title: 'Hades', appid: '1145360' }, fetch: parAppid, now: NOW })).info);

  const parTitre = faux([['games?title=', { json: [{ gameID: '5', external: 'Hades 2' }, { gameID: '196149', external: 'Hades' }] }], ['games?id=196149', { json: sharkGame() }]]);
  const r = await readShark({ target: { title: 'Hades', appid: null }, fetch: parTitre, now: NOW });
  assert.ok(r.info);
  assert.match(parTitre.appels.at(-1).url, /id=196149/);

  const aucun = faux([['games?title=', { json: [{ gameID: '5', external: 'Hades 2' }] }]]);
  assert.deepEqual(await readShark({ target: { title: 'Hades', appid: null }, fetch: aucun, now: NOW }), { info: null });
});

/* -------------------------------------------------------------- le cache */

const cible = (title, appid = null) => ({ key: `t:${title.toLowerCase()}`, title, appid });

test('la source visee : ITAD avec une cle, CheapShark sans', () => {
  assert.equal(wantedSource(KEY), SOURCES.ITAD);
  assert.equal(wantedSource(null), SOURCES.SHARK);
  assert.equal(sourceLabel({ source: SOURCES.ITAD }), 'IsThereAnyDeal');
  assert.equal(sourceLabel({ source: SOURCES.SHARK }), 'CheapShark');
});

test('needsPrice : jamais lu, perime, introuvable depuis trois jours, ou lu par une autre source que celle visee', () => {
  const t = cible('Hades');
  const frais = { [t.key]: { at: NOW - 1000, found: true, want: SOURCES.SHARK } };
  assert.equal(needsPrice({}, t, NOW, null), true);
  assert.equal(needsPrice(frais, t, NOW, null), false);
  assert.equal(needsPrice({ [t.key]: { at: NOW - FRESH_MS, found: true, want: SOURCES.SHARK } }, t, NOW, null), true);
  assert.equal(needsPrice({ [t.key]: { at: NOW - FRESH_MS - 1, found: false, want: SOURCES.SHARK } }, t, NOW, null), false, 'introuvable : trois jours');
  assert.equal(needsPrice({ [t.key]: { at: NOW - NOT_FOUND_MS, found: false, want: SOURCES.SHARK } }, t, NOW, null), true);
  assert.equal(needsPrice(frais, t, NOW, KEY), true, 'une cle vient d\'etre ajoutee : on relit par ITAD');
});

test('refreshPrices : avec une cle valide, ITAD ; la forme et la source sont notees', async () => {
  const f = faux([['games/lookup/v1', lookupOk], ['games/prices/v3', { json: itadPrix() }]]);
  const r = await refreshPrices({ targets: [cible('Hades', '1145360')], cache: {}, key: KEY, country: 'FR', fetch: f, now: NOW, pause: async () => {} });
  const e = r.cache['t:hades'];
  assert.equal(e.source, SOURCES.ITAD);
  assert.equal(e.want, SOURCES.ITAD);
  assert.equal(e.currency, 'EUR');
  assert.equal(r.keyRefused, false);
});

test('refreshPrices : une cle refusee fait passer a CheapShark, et ITAD n\'est plus interroge pendant ce passage', async () => {
  const f = faux([
    ['api.isthereanydeal.com', { status: 403 }],
    ['games?title=', { json: [{ gameID: '196149', external: 'Hades' }, { gameID: '7', external: 'Celeste' }] }],
    ['games?id=', { json: sharkGame() }],
  ]);
  const r = await refreshPrices({ targets: [cible('Hades'), cible('Celeste')], cache: {}, key: KEY, country: 'FR', fetch: f, now: NOW, pause: async () => {} });
  assert.equal(r.keyRefused, true);
  assert.equal(r.cache['t:hades'].source, SOURCES.SHARK);
  assert.equal(r.cache['t:celeste'].source, SOURCES.SHARK);
  assert.equal(r.cache['t:hades'].want, SOURCES.ITAD, 'la source visee reste ITAD : la cle sera retentee a la prochaine echeance');
  assert.equal(f.appels.filter((a) => a.url.includes('isthereanydeal')).length, 1, 'une seule tentative refusee, puis plus rien');
});

test('refreshPrices : six souhaits au plus par passage, les plus anciens d\'abord, ceux a jour laisses', async () => {
  const ciblesTous = Array.from({ length: 9 }, (_, i) => cible(`Jeu ${i}`));
  const f = faux([['games?title=', (u) => ({ json: [{ gameID: String(100 + Number(/Jeu(?:%20| )?(\d)/.exec(u)?.[1] ?? 0)), external: decodeURIComponent((/title=([^&]+)/.exec(u) || [])[1] || '') }] })], ['games?id=', { json: sharkGame() }]]);
  const cache = { [ciblesTous[0].key]: { at: NOW - 1000, found: true, want: SOURCES.SHARK } };
  const r = await refreshPrices({ targets: ciblesTous, cache, key: null, fetch: f, now: NOW, pause: async () => {} });
  const lus = Object.keys(r.cache).filter((k) => r.cache[k] !== cache[k]);
  assert.equal(lus.length, PER_RUN);
  assert.ok(!lus.includes(ciblesTous[0].key), 'le souhait a jour n\'est pas relu');
});

test('refreshPrices : une panne de reseau n\'ecrase pas ce qu\'on savait', async () => {
  const ancien = { at: NOW - FRESH_MS - 5, found: true, source: SOURCES.SHARK, want: SOURCES.SHARK, currency: 'USD', best: { amount: 1 } };
  const f = faux([['cheapshark', () => new Error('reseau')]]);
  const r = await refreshPrices({ targets: [cible('Hades')], cache: { 't:hades': ancien }, key: null, fetch: f, now: NOW, pause: async () => {} });
  assert.deepEqual(r.cache['t:hades'], ancien);
});

test('refreshPrices : trop de requetes arrete le passage tout de suite', async () => {
  const f = faux([['games?title=', { status: 429 }]]);
  const r = await refreshPrices({ targets: [cible('A'), cible('B'), cible('C')], cache: {}, key: null, fetch: f, now: NOW, pause: async () => {} });
  assert.equal(r.busy, true);
  assert.equal(f.appels.length, 1);
});

test('refreshPrices : un jeu introuvable est note, pour ne pas etre cherche a chaque passage', async () => {
  const f = faux([['games?title=', { json: [] }]]);
  const r = await refreshPrices({ targets: [cible('Inconnu')], cache: {}, key: null, fetch: f, now: NOW, pause: async () => {} });
  assert.deepEqual(r.cache['t:inconnu'], { at: NOW, found: false, want: SOURCES.SHARK });
});

/* ------------------------------------------------------------ l'essai de la cle */

test('l\'essai de la cle : bonne, refusee, trop courte, injoignable -- et jamais la cle dans la note', async () => {
  assert.deepEqual(await testItad({ key: KEY, fetch: faux([['games/lookup/v1', lookupOk]]) }), { ok: true, status: 200, note: null });
  assert.equal((await testItad({ key: KEY, fetch: faux([['games/lookup/v1', { status: 403 }]]) })).note, 'refused');
  assert.equal((await testItad({ key: 'court', fetch: faux([]) })).note, 'form');
  assert.equal((await testItad({ key: KEY, fetch: faux([['games/lookup/v1', () => new Error('x')]]) })).note, 'net');
  assert.equal((await testItad({ key: KEY, fetch: faux([['games/lookup/v1', { json: { found: false } }]]) })).note, 'unexpected');
  for (const f of [faux([['games/lookup/v1', { status: 403 }]]), faux([])]) assert.ok(!JSON.stringify(await testItad({ key: KEY, fetch: f })).includes(KEY));
});

/* ------------------------------------------------------------ le branchement */

test('coupe par defaut : rien n\'est envoye tant que la case n\'est pas cochee', () => {
  assert.equal(DEFAULT_SETTINGS.wishPrices, false);
  const worker = lire('background.js');
  assert.match(worker, /if \(settings\.wishPrices !== true\) return null;/);
});

test('les deux commandes de la popup sont autorisees et traitees par le worker', () => {
  const worker = lire('background.js');
  for (const type of ['fgc-prices-refresh', 'fgc-itad-test']) {
    assert.ok(UI_COMMANDS.includes(type), type);
    assert.ok(worker.includes(`msg.type === '${type}'`), `${type} traite`);
  }
});

test('la popup : chaque identifiant du HTML est branche, les cles sont lues, la cle n\'est jamais reaffichee', () => {
  const html = lire('pages/popup.html');
  const js = lire('pages/popup.js');
  for (const id of ['wish-prices-on', 'wish-prices-fields', 'itad-key', 'itad-save', 'itad-test', 'itad-clear', 'itad-create', 'prices-refresh', 'itad-state', 'wish-prices-credit']) {
    assert.ok(html.includes(`id="${id}"`), `${id} dans le HTML`);
    assert.ok(js.includes(`'${id}'`), `${id} dans popup.js`);
  }
  assert.match(html, /<input type="password" id="itad-key" autocomplete="off"/, 'un champ masque, sans memoire du navigateur');
  assert.match(js, /KEY_PRICES, KEY_ITAD,\n\];/, 'les deux cles sont lues (et donc suivies)');
  // Le champ n'est jamais rempli : on dit seulement qu'une cle existe.
  const valeurs = js.match(/getElementById\('itad-key'\)\.value\s*=[^;]*/g) || [];
  assert.deepEqual(valeurs, [], 'aucune ecriture dans le champ');
  const saisie = js.slice(js.indexOf('async function saveTypedItadKey'), js.indexOf('/** Essaie la cle enregistree'));
  assert.deepEqual(saisie.match(/\.value\s*=[^=][^;]*/g), [".value = ''"], 'le champ est vide apres l\'enregistrement, jamais rempli');
});

test('la cle n\'est connue que de trois fichiers : ce module, le worker (qui appelle) et la popup (qui la saisit)', () => {
  const dir = new URL('watch/', ROOT);
  const dehors = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'prices.js'
    && /KEY_ITAD|veille:itad/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(dehors, [], 'ni alerte, ni relais, ni sauvegarde, ni rapport');
  assert.doesNotMatch(lire('lib/i18n-tables.js'), /veille:itad/);
});

test('aucune permission de plus : les deux services repondent avec CORS, le worker les appelle sans hote declare', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(lire(f));
    const hotes = [...(m.host_permissions || []), ...(m.optional_host_permissions || [])].join(' ');
    assert.doesNotMatch(hotes, /isthereanydeal|cheapshark/i, f);
  }
});
