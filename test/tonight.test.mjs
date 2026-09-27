/* « Ce soir je joue a... » (2.95.0).
 *
 * Sur une reponse reelle de Steam (GetItems, douze jeux connus, 2026-09-27) :
 * le format se lit dans les etiquettes des joueurs ; la pile ne garde que ce
 * qui n'a pas ete lance ni ecarte ; le temps qu'on a decide de ce qui
 * convient ; le tirage varie, sans jamais sortir des meilleurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  formatFromTags, readItem, buildPile, scoreTonight, pickTonight, playLinks, keptPick, refreshTonight,
  tonightItemsUrl, tonightPassDue, readTonightState, tonightImage, steamHeader, steamLanguage, cleanDescription,
  FORMATS, TIMES, TOP, PICK_KEEP_MS, PASS_EVERY_MS, LOT, INFO_VERSION, MAX_DESCRIPTION,
} from '../watch/tonight.js';
import { STATUS } from '../watch/annotations.js';

const ITEMS = JSON.parse(readFileSync(new URL('./fixtures/steam-getitems-tonight.json', import.meta.url), 'utf8')).response.store_items;
const item = (appid) => ITEMS.find((i) => i.appid === appid);
const NOW = Date.UTC(2026, 8, 27, 20);

test('le format vient des etiquettes des joueurs, verifie sur douze jeux', () => {
  const formats = Object.fromEntries(ITEMS.map((i) => [i.name, formatFromTags(i.tags)]));
  assert.deepEqual(formats, {
    Hades: FORMATS.SESSIONS, // un RPG, mais d'abord un rogue-like
    'The Witcher 3: Wild Hunt - Complete Edition': FORMATS.LONG,
    Portal: FORMATS.SHORT, // « Short » en 18e position : elle compte quand meme
    'Stardew Valley': FORMATS.LONG,
    'Outer Wilds': FORMATS.LONG,
    Celeste: null, // rien qui dise le format : on ne devine pas
    Balatro: FORMATS.SESSIONS,
    'Cyberpunk 2077': FORMATS.LONG,
    'Slay the Spire': FORMATS.SESSIONS, // son etiquette RPG est trop faible pour compter
    'What Remains of Edith Finch': FORMATS.SHORT,
    INSIDE: null,
    Terraria: FORMATS.LONG,
  });
  assert.equal(formatFromTags([]), null);
  assert.equal(formatFromTags(null), null);
});

test('une fiche GetItems : note, Deck, vignette, format', () => {
  const h = readItem(item(1145360));
  assert.equal(h.name, 'Hades');
  assert.equal(h.percent, 97);
  assert.ok(h.reviews > 100000);
  assert.equal(h.deck, 'verified');
  assert.equal(h.format, FORMATS.SESSIONS);
  assert.match(h.image, /^https:\/\/shared\.akamai\.steamstatic\.com\/store_item_assets\/steam\/apps\/1145360\//);
  assert.match(h.description, /^Défiez le dieu des morts/);
  assert.equal(h.v, INFO_VERSION);
  assert.equal(readItem(item(400)).description, null, 'Portal n\'a pas de description courte');
  assert.equal(readItem({ success: 2, appid: 1 }), null);
  assert.equal(readItem(null), null);
  const u = new URL(tonightItemsUrl(['400', '620'], 'DE'));
  const input = JSON.parse(u.searchParams.get('input_json'));
  assert.deepEqual(input.ids, [{ appid: 400 }, { appid: 620 }]);
  assert.equal(input.context.country_code, 'DE');
  assert.equal(input.data_request.include_tag_count, 20);
  assert.equal(input.data_request.include_reviews, true);
  assert.equal(input.data_request.include_basic_info, true, 'la description courte');
  assert.equal(input.context.language, 'english');
  assert.equal(JSON.parse(new URL(tonightItemsUrl(['1'], 'FR', 'french')).searchParams.get('input_json')).context.language, 'french');
  assert.equal(JSON.parse(new URL(tonightItemsUrl(['1'], 'FR', 'klingon')).searchParams.get('input_json')).context.language, 'english');
  assert.equal(steamLanguage('fr'), 'french');
  assert.equal(steamLanguage('de-DE'), 'german');
  assert.equal(steamLanguage('pt'), 'english');
});

test('la description : du texte simple, coupe a un mot', () => {
  assert.equal(cleanDescription('Un <b>jeu</b> &quot;culte&quot;  &amp; court'), 'Un jeu "culte" & court');
  assert.equal(cleanDescription(''), null);
  const longue = cleanDescription('mot '.repeat(200));
  assert.ok(longue.length <= MAX_DESCRIPTION + 1);
  assert.match(longue, /mot…$/);
});

const collection = {
  stores: { steam: { lastOk: 1 } },
  items: {
    'steam:1145360': { store: 'steam', id: '1145360', title: 'Hades', kind: 'game', deck: 'verified' },
    'steam:292030': { store: 'steam', id: '292030', title: 'The Witcher 3: Wild Hunt', kind: 'game' },
    'steam:400': { store: 'steam', id: '400', title: 'Portal', kind: 'game' },
    'steam:105600': { store: 'steam', id: '105600', title: 'Terraria', kind: 'game' },
    'steam:9999': { store: 'steam', id: '9999', title: 'Une Bande-son', kind: 'dlc' },
    'gog:1': { store: 'gog', id: '1', title: 'Celeste', kind: 'game', url: 'https://www.gog.com/game/celeste' },
  },
};
const library = {
  'epic:balatro': { store: 'epic', id: 'balatro', title: 'Balatro', url: 'https://store.epicgames.com/p/balatro', ts: Date.UTC(2026, 2, 12), status: 'claimed' },
  'epic:rate': { store: 'epic', id: 'rate', title: 'Rate', ts: 1, status: 'failed' },
};

test('la pile : jamais lance, ni commence, ni ecarte ; un DLC n\'en est pas', () => {
  const playtime = { 1145360: null, 292030: 0.2, 400: 12.5 };
  const annotations = { 'steam:105600': { status: STATUS.NOT_FOR_ME }, 'gog:1': { status: STATUS.TO_TRY } };
  const pile = buildPile({ collection, library, playtime, annotations });
  assert.deepEqual(pile.map((c) => c.title).sort(), ['Balatro', 'Celeste', 'Hades', 'The Witcher 3: Wild Hunt']);
  const h = pile.find((c) => c.title === 'Hades');
  assert.equal(h.never, true);
  assert.equal(h.appid, '1145360');
  assert.equal(h.deck, 'verified');
  assert.equal(pile.find((c) => c.title === 'The Witcher 3: Wild Hunt').never, false, 'lance douze minutes : encore la pile');
  assert.equal(pile.find((c) => c.title === 'Celeste').toTry, true);
  assert.equal(pile.find((c) => c.title === 'Celeste').never, null, 'GOG ne dit pas le temps de jeu');
  assert.equal(pile.find((c) => c.title === 'Balatro').claimed, true);
  // Sans miroir, on ne sait pas : on ne suppose pas « jamais lance », on n'ecarte rien.
  const sans = buildPile({ collection, library });
  assert.equal(sans.length, 6, "Terraria revient : rien ne l'ecarte");
  assert.ok(sans.every((c) => c.never === null));
  for (const s of [STATUS.PLAYING, STATUS.DONE, STATUS.DROPPED]) {
    assert.ok(!buildPile({ collection, library, annotations: { 'steam:1145360': { status: s } } }).some((c) => c.title === 'Hades'), s);
  }
});

test('un titre hors Steam retrouve son appid par la recherche', () => {
  const state = { titles: { balatro: { at: NOW, appid: '2379780' } } };
  const pile = buildPile({ collection, library, state });
  const b = pile.find((c) => c.title === 'Balatro');
  assert.equal(b.appid, '2379780');
  assert.equal(b.ownedOnSteam, false);
});

const info = (appid) => ({ ...readItem(item(appid)), at: NOW });
const APPS = {
  1145360: info(1145360), 292030: info(292030), 400: info(400), 2379780: info(2379780), 105600: info(105600),
};

test('le temps qu\'on a : une heure ecarte le long cours, une soiree prefere le court', () => {
  const c = { key: 'k', title: 'X', stores: {}, never: true, toTry: false };
  assert.equal(scoreTonight(c, APPS[292030], { time: TIMES.HOUR }), null);
  const soir = (a) => scoreTonight(c, APPS[a], { time: TIMES.EVENING }).score;
  assert.ok(soir(400) > soir(1145360), 'Portal, court, avant Hades');
  assert.ok(soir(1145360) > soir(292030), 'Hades avant The Witcher 3');
  const heure = (a) => scoreTonight(c, APPS[a], { time: TIMES.HOUR }).score;
  assert.ok(heure(2379780) > heure(400), 'une heure : des parties courtes');
  const we = (a) => scoreTonight(c, APPS[a], { time: TIMES.WEEKEND }).score;
  assert.ok(we(292030) > we(1145360), 'un week-end : le long cours');
  // « Recupere gratuitement en... » n'est plus une raison (2.96.0) : la description le remplace.
  const r = scoreTonight({ ...c, toTry: true, claimed: true, since: Date.UTC(2026, 2, 12) }, APPS[400], { time: TIMES.EVENING });
  assert.deepEqual(r.reasons.map((x) => x.key), ['tonightToTry', 'tonightNever', 'tonightShort', 'tonightRating']);
  assert.deepEqual(r.reasons[3].args, ['98']);
});

test('Steam Deck : seulement ce que Steam dit jouable', () => {
  const c = { key: 'k', title: 'X', stores: {}, never: null, toTry: false };
  assert.equal(scoreTonight(c, null, { deckOnly: true }), null, 'inconnu : ne passe pas');
  assert.equal(scoreTonight({ ...c, deck: 'unsupported' }, null, { deckOnly: true }), null);
  const v = scoreTonight(c, APPS[400], { deckOnly: true });
  assert.ok(v.reasons.some((x) => x.key === 'tonightDeckVerified'));
  assert.ok(scoreTonight({ ...c, deck: 'playable' }, null, { deckOnly: true }).reasons.some((x) => x.key === 'tonightDeckPlayable'));
});

test('le tirage : parmi les meilleurs, varie, et repart du debut quand tout est vu', () => {
  const pile = buildPile({ collection, library, state: { titles: { balatro: { at: NOW, appid: '2379780' } } } });
  const opts = { apps: APPS, time: TIMES.EVENING };
  const premier = pickTonight(pile, { ...opts, random: () => 0 });
  assert.equal(premier.pick.title, 'Portal');
  assert.equal(premier.count, 6);
  const tires = new Set();
  for (let i = 0; i < 20; i++) tires.add(pickTonight(pile, { ...opts, random: () => i / 20 }).pick.title);
  assert.ok(tires.size >= 3, [...tires].join(', '));
  const tous = pile.map((c) => c.key);
  const r = pickTonight(pile, { ...opts, exclude: tous, random: () => 0 });
  assert.equal(r.wrapped, true);
  assert.equal(r.pick.title, 'Portal');
  const un = pickTonight(pile, { ...opts, exclude: [premier.pick.key], random: () => 0 });
  assert.notEqual(un.pick.title, 'Portal');
  assert.equal(pickTonight([], opts).pick, null);
  assert.equal(pickTonight(pile, { ...opts, time: TIMES.HOUR, deckOnly: true, apps: {} }).pick !== null, true, 'Hades : Deck verifie par la collection');
  assert.ok(TOP >= 3);
});

test('une image pour chaque jeu : la fiche, l\'en-tete Steam, la jaquette du registre', () => {
  const lib = { ...library, 'amazon:bm': { store: 'amazon', id: 'bm', title: 'Botany Manor', image: 'https://m.media-amazon.com/images/bm.jpg', ts: 1, status: 'claimed' } };
  const pile = buildPile({ collection, library: lib, covers: { celeste: { image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/504230/header.jpg', at: 1 } } });
  const bm = pile.find((c) => c.title === 'Botany Manor');
  assert.equal(bm.image, 'https://m.media-amazon.com/images/bm.jpg');
  assert.equal(tonightImage(bm, null), 'https://m.media-amazon.com/images/bm.jpg', 'pas encore d\'appid : la jaquette du registre');
  assert.equal(tonightImage({ ...bm, appid: '1425350' }, null), steamHeader('1425350'), 'l\'appid trouve : l\'en-tete Steam');
  assert.equal(tonightImage(bm, { image: 'https://x/y.jpg' }), 'https://x/y.jpg');
  assert.match(pile.find((c) => c.title === 'Celeste').image, /504230/);
  assert.equal(steamHeader('abc'), null);
});

test('les liens : Steam lance, les autres ouvrent leur fiche', () => {
  const pile = buildPile({ collection, library, state: { titles: { balatro: { at: NOW, appid: '2379780' } } } });
  assert.deepEqual(playLinks(pile.find((c) => c.title === 'Hades')), { launch: 'steam://run/1145360', page: 'https://store.steampowered.com/app/1145360/' });
  assert.deepEqual(playLinks(pile.find((c) => c.title === 'Celeste')), { launch: null, page: 'https://www.gog.com/game/celeste' });
  assert.deepEqual(playLinks(pile.find((c) => c.title === 'Balatro')), { launch: null, page: 'https://store.epicgames.com/p/balatro' });
  assert.deepEqual(playLinks(null), { launch: null, page: null });
});

test('le choix tient la soiree, pas plus, et pas si les reglages changent', () => {
  const pile = buildPile({ collection, library });
  const k = pile[0].key;
  const saved = { key: k, at: NOW, time: TIMES.EVENING, deckOnly: false };
  assert.equal(keptPick(saved, pile, { time: TIMES.EVENING, deckOnly: false }, NOW + 3600e3).key, k);
  assert.equal(keptPick(saved, pile, { time: TIMES.EVENING, deckOnly: false }, NOW + PICK_KEEP_MS), null);
  assert.equal(keptPick(saved, pile, { time: TIMES.HOUR, deckOnly: false }, NOW), null);
  assert.equal(keptPick(saved, pile, { time: TIMES.EVENING, deckOnly: true }, NOW), null);
  assert.equal(keptPick({ ...saved, key: 'steam:disparu' }, pile, { time: TIMES.EVENING, deckOnly: false }, NOW), null);
  assert.equal(keptPick(null, pile, {}, NOW), null);
});

test('le passage Steam : sans cookie, recherche exacte, lots GetItems, rythme tenu', async () => {
  const appels = [];
  const fetch = async (url, init) => {
    appels.push({ url, init });
    if (url.includes('/api/storesearch/')) {
      const term = new URL(url).searchParams.get('term');
      const items = term === 'Balatro' ? [{ type: 'app', id: 2379780, name: 'Balatro' }] : [{ type: 'app', id: 5, name: `${term} Deluxe` }];
      return { ok: true, json: async () => ({ total: items.length, items }) };
    }
    const input = JSON.parse(new URL(url).searchParams.get('input_json'));
    const lus = input.ids.map(({ appid }) => item(appid)).filter(Boolean);
    return { ok: true, json: async () => ({ response: { store_items: lus } }) };
  };
  const pile = buildPile({ collection, library });
  const next = await refreshTonight({ fetch, pile, state: null, now: NOW, pause: async () => {} });
  assert.ok(appels.every((a) => a.init.credentials === 'omit'));
  assert.equal(appels.filter((a) => a.url.includes('storesearch')).length, 2, 'Balatro et Celeste, hors Steam');
  assert.deepEqual(next.titles.balatro, { at: NOW, appid: '2379780' });
  assert.deepEqual(next.titles.celeste, { at: NOW, none: true }, 'Celeste Deluxe n\'est pas Celeste');
  assert.equal(next.apps['1145360'].format, FORMATS.SESSIONS);
  assert.equal(next.apps['2379780'].percent, 97);
  assert.equal(next.at, NOW);
  // Relu dans soixante jours seulement : un second passage ne demande rien.
  appels.length = 0;
  const encore = await refreshTonight({ fetch, pile: buildPile({ collection, library, state: next }), state: next, now: NOW + 3600e3, pause: async () => {} });
  assert.equal(appels.length, 0);
  assert.deepEqual(encore.apps, next.apps);
  // Une fiche d'une forme ancienne (sans description) est relue sans attendre soixante jours.
  appels.length = 0;
  const ancienne = { ...next, apps: { ...next.apps, 1145360: { ...next.apps['1145360'], v: undefined, description: undefined } } };
  const relue = await refreshTonight({ fetch, pile: buildPile({ collection, library, state: ancienne }), state: ancienne, now: NOW + 3600e3, pause: async () => {} });
  assert.equal(appels.filter((a) => a.url.includes('GetItems')).length, 1);
  assert.match(relue.apps['1145360'].description, /dieu des morts/);
  assert.equal(tonightPassDue(next, NOW + PASS_EVERY_MS - 1), false);
  assert.equal(tonightPassDue(next, NOW + PASS_EVERY_MS), true);
  assert.equal(tonightPassDue(null, NOW), true);
  assert.deepEqual(readTonightState('x'), { at: null, apps: {}, titles: {} });
});

test('le passage ne jette jamais, et lit au plus deux lots', async () => {
  const beaucoup = { stores: {}, items: {} };
  for (let i = 1; i <= 130; i++) beaucoup.items[`steam:${i}`] = { store: 'steam', id: String(i), title: `Jeu ${i}`, kind: 'game' };
  let lots = 0;
  const fetch = async (url) => {
    if (url.includes('GetItems')) { lots++; throw new Error('reseau'); }
    return { ok: false, status: 500 };
  };
  const next = await refreshTonight({ fetch, pile: buildPile({ collection: beaucoup }), state: null, now: NOW, pause: async () => {} });
  assert.equal(lots, 2);
  assert.ok(LOT * 2 < 130);
  assert.deepEqual(next.apps, {}, 'un echec ne note rien : on relira');
});

test('le popup et la page Ma collection ecrivent la meme cle d\'etat', () => {
  const popup = readFileSync(new URL('../pages/popup.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../pages/collection.js', import.meta.url), 'utf8');
  assert.match(popup, /setStatus\(brut\[KEY_ANNOTATIONS\] \|\| \{\}, key, status\)/);
  assert.match(page, /rowKey,\n\} from '\.\.\/watch\/collection\.js'/);
  assert.match(page, /annotations = brut\[KEY_ANNOTATIONS\] \|\| \{\};/, 'la page relit enfin les etats');
});
