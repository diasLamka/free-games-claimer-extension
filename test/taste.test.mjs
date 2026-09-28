/* « Vos gouts » (2.99.0) : ce que vous aimez, tire de ce que vous jouez, et
 * oppose aux offres. Les fiches viennent de Steam, mesurees le 2026-09-28
 * (test/fixtures/steam-getitems-taste.json) : les scores ci-dessous sont ceux
 * de vrais jeux, pas de jeux inventes pour la demonstration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_TASTE, GENERIC, GENERIC_FORCE, TOP_TAGS, MIN_LIKED, MIN_HOURS, MAX_SIGNALS, FOR_YOU, LOT, LOTS_PER_RUN, PASS_EVERY_MS,
  compactTags, tagVector, signalsFrom, buildProfile, scoreGame, tasteFor, tasteNames, readTasteState, tastePassDue,
  tasteItemsUrl, tagListUrl, tagLanguage, fetchGames, refreshTaste,
} from '../watch/taste.js';
import { STATUS } from '../watch/annotations.js';
import { scoreTonight } from '../watch/tonight.js';
import { composeAnnouncement } from '../watch/cycle.js';
import { makeOffer, STORES } from '../watch/offer.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ITEMS = JSON.parse(lire('test/fixtures/steam-getitems-taste.json')).response.store_items;
const NOMS = Object.fromEntries(JSON.parse(lire('test/fixtures/steam-taglist-fr.json')).response.tags.map((t) => [String(t.tagid), t.name]));
const NOW = Date.UTC(2026, 8, 28, 12);

const JEU = Object.fromEntries(ITEMS.map((it) => [it.name, String(it.appid)]));
const jeux = Object.fromEntries(ITEMS.map((it) => [String(it.appid), { tags: compactTags(it.tags), at: NOW }]));
const nom = (n) => { const id = Object.entries(JEU).find(([k]) => k.startsWith(n)); assert.ok(id, n); return id[1]; };
const aimes = ['Hades', 'Celeste', 'Hollow Knight', 'Slay the Spire'].map((n) => ({ appid: nom(n), s: 1 }));
const score = (profil, n) => scoreGame(profil, jeux[nom(n)].tags);

test('les etiquettes d\'un jeu : les dix plus fortes, ramenees a 100, jamais du vide', () => {
  const c = compactTags(ITEMS.find((i) => i.name === 'Hades').tags);
  assert.equal(c.length, TOP_TAGS);
  assert.equal(c[0][1], 100, 'la plus forte vaut 100');
  assert.deepEqual(c.map((x) => x[1]), [...c.map((x) => x[1])].sort((a, b) => b - a), 'de la plus forte a la moins forte');
  assert.equal(compactTags([]), null);
  assert.equal(compactTags(null), null);
  assert.equal(compactTags([{ tagid: 'x', weight: 3 }, { tagid: 5, weight: 0 }]), null, 'ni identifiant illisible, ni poids nul');
});

test('les etiquettes larges pesent moins : sinon toutes les offres se ressembleraient', () => {
  const v = tagVector([[4182, 100], [1234, 100]]);
  assert.equal(v[1234], 1);
  assert.equal(v[4182], GENERIC_FORCE);
  assert.ok(GENERIC.includes(4182) && GENERIC.includes(492) && GENERIC.includes(19));
  assert.deepEqual(tagVector(null), {});
});

test('les signaux : les heures, l\'etat dit a la main l\'emporte, et le hors-Steam ne dit rien', () => {
  const playtime = { 100: 80, 200: 10, 300: MIN_HOURS - 0.1, 400: null, 500: 3, abc: 50 };
  const collection = { items: {
    'steam:600': { store: 'steam', id: '600', title: 'Fini', kind: 'game' },
    'steam:700': { store: 'steam', id: '700', title: 'Ecarte', kind: 'game' },
    'steam:100': { store: 'steam', id: '100', title: 'Beaucoup Joue', kind: 'game' },
    'gog:9': { store: 'gog', id: '9', title: 'Sur GOG', kind: 'game' },
  } };
  const annotations = { 'steam:600': { status: STATUS.DONE }, 'steam:700': { status: STATUS.NOT_FOR_ME }, 'gog:9': { status: STATUS.DONE }, 'steam:100': { status: STATUS.DROPPED } };
  const s = Object.fromEntries(signalsFrom({ playtime, annotations, collection }).map((x) => [x.appid, x.s]));
  assert.equal(s['200'], 0.4, 'dix heures : 10 / 25');
  assert.equal(s['500'], 0.2, 'trois heures : le plancher');
  assert.equal(s['300'], undefined, 'trop peu joue : pas un gout');
  assert.equal(s['400'], undefined, 'jamais lance : rien');
  assert.equal(s.abc, undefined);
  assert.equal(s['600'], 1, 'fini');
  assert.equal(s['700'], -1, 'pas pour moi');
  assert.equal(s['100'], -0.6, 'abandonne malgre quatre-vingts heures : la main l\'emporte');
  assert.equal(s['9'], undefined, 'GOG n\'a pas d\'appid Steam');
  // Les plus joues d'abord, quarante au plus.
  const beaucoup = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [String(1000 + i), 5 + i]));
  const cap = signalsFrom({ playtime: beaucoup });
  assert.equal(cap.length, MAX_SIGNALS);
  assert.ok(cap.some((x) => x.appid === '1059') && !cap.some((x) => x.appid === '1000'));
  assert.deepEqual(signalsFrom({}), []);
});

test('un profil demande au moins trois jeux aimes dont on connait les etiquettes', () => {
  assert.equal(buildProfile(aimes.slice(0, MIN_LIKED - 1), jeux), null);
  assert.equal(buildProfile(aimes, {}), null, 'sans etiquettes lues, rien');
  assert.equal(buildProfile([...aimes.slice(0, 2), { appid: '999', s: 1 }], jeux), null, 'un jeu dont on ne sait rien ne compte pas');
  const p = buildProfile(aimes, jeux);
  assert.equal(p.liked, 4);
  assert.equal(p.disliked, 0);
  assert.ok(Object.keys(p.tags).length > 10);
  assert.ok(Object.values(p.tags).every((v) => v >= -1 && v <= 1));
  // Ce qui revient dans Hades, Celeste, Hollow Knight et Slay the Spire : les rogue-likes et le 2D.
  const top = Object.entries(p.tags).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => NOMS[id]);
  assert.ok(top.includes('Roguelike'), top.join());
});

test('un profil de rogue-likes reconnait les rogue-likes, pas les simulations', () => {
  const p = buildProfile(aimes, jeux);
  assert.ok(score(p, 'Dead Cells').score >= FOR_YOU, 'Dead Cells');
  assert.ok(score(p, 'The Binding of Isaac').score >= FOR_YOU - 0.05, 'Isaac, a la limite');
  assert.ok(score(p, 'Dead Cells').score > score(p, 'Stardew Valley').score);
  assert.ok(score(p, 'Planet Zoo').score < 0.1, 'un jeu de gestion');
  assert.ok(score(p, 'Euro Truck Simulator 2').score < 0.1);
  assert.ok(score(p, 'Dead Cells').score <= 1 && score(p, 'Planet Zoo').score >= -1);
  // Ce qui porte la ressemblance est dit en mots precis, jamais « Jeu solo ».
  const noms = score(p, 'Dead Cells').top.map((id) => NOMS[id]);
  assert.ok(noms.length >= 2 && noms.includes('Roguelike'), noms.join());
  assert.ok(!score(p, 'Dead Cells').top.some((id) => GENERIC.includes(id)), 'jamais une etiquette generique tant qu\'une precise porte');
});

test('un jeu ecarte tire le profil vers le bas', () => {
  const sans = buildProfile(aimes, jeux);
  const avec = buildProfile([...aimes, { appid: nom('Planet Zoo'), s: -1 }, { appid: nom('Euro Truck Simulator 2'), s: -1 }], jeux);
  assert.equal(avec.disliked, 2);
  assert.ok(score(avec, 'Planet Zoo').score < score(sans, 'Planet Zoo').score);
  assert.ok(Object.values(avec.tags).some((v) => v < 0), 'des etiquettes negatives sont retenues');
  const gestion = buildProfile(['Planet Zoo', 'Euro Truck Simulator 2', 'Stardew Valley', 'Cities: Skylines'].map((n) => ({ appid: nom(n), s: 1 })), jeux);
  assert.ok(score(gestion, 'Dead Cells').score < FOR_YOU && score(gestion, 'Planet Zoo').score >= FOR_YOU);
});

test('scoreGame et tasteFor sont sobres devant l\'absence', () => {
  const p = buildProfile(aimes, jeux);
  assert.equal(scoreGame(null, jeux[nom('Hades')].tags), null);
  assert.equal(scoreGame(p, null), null);
  assert.equal(scoreGame(p, []), null);
  const etat = { profile: p, games: jeux, names: NOMS };
  assert.ok(tasteFor(etat, nom('Dead Cells')));
  assert.equal(tasteFor(etat, nom('Planet Zoo')), null, 'sous le seuil');
  assert.equal(tasteFor(etat, '424242'), null, 'jeu inconnu');
  assert.equal(tasteFor(etat, null), null);
  assert.equal(tasteFor({ games: jeux }, nom('Dead Cells')), null, 'sans profil');
  assert.equal(tasteFor({ profile: p, games: { 1: { none: true } } }, '1'), null);
  const noms = tasteNames(etat, tasteFor(etat, nom('Dead Cells')).top);
  assert.ok(noms.includes('Roguelike'));
  assert.deepEqual(tasteNames(etat, [999999]), [], 'une etiquette sans nom se tait');
});

test('l\'etat stocke a toujours sa forme, et le passage est du toutes les six heures', () => {
  assert.deepEqual(readTasteState(null), { at: null, profile: null, games: {}, names: {}, namesAt: null, namesLang: null });
  assert.deepEqual(readTasteState({ profile: { tags: 3 }, games: [] }).games, {});
  assert.equal(readTasteState({ profile: { tags: 3 } }).profile, null);
  assert.equal(tastePassDue(null, NOW), true);
  assert.equal(tastePassDue({ at: NOW - 3600e3 }, NOW), false);
  assert.equal(tastePassDue({ at: NOW - PASS_EVERY_MS }, NOW), true);
  assert.equal(KEY_TASTE, 'veille:gouts');
  assert.equal(DEFAULT_SETTINGS.taste, true);
});

test('les requetes ne portent que des numeros de jeux, sans cookie, et rien que les etiquettes', () => {
  const u = new URL(tasteItemsUrl(['1145360', '504230'], 'FR'));
  const input = JSON.parse(u.searchParams.get('input_json'));
  assert.deepEqual(input.ids, [{ appid: 1145360 }, { appid: 504230 }]);
  assert.deepEqual(input.data_request, { include_tag_count: 20 });
  assert.equal(u.hostname, 'api.steampowered.com');
  assert.match(tagListUrl('french'), /IStoreService\/GetTagList\/v1\/\?language=french$/);
  assert.equal(tagLanguage('fr-FR'), 'french');
  assert.equal(tagLanguage('de'), 'german');
  assert.equal(tagLanguage('it'), 'english');
});

/** Un faux Steam : rend les fiches du fixture, et note ce qu'on lui demande. */
function fauxSteam({ echec = false, sansListe = false } = {}) {
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push({ url: String(url), init });
    if (echec) throw new Error('reseau');
    if (/GetTagList/.test(url)) return sansListe ? { ok: false } : { ok: true, json: async () => ({ response: { tags: Object.entries(NOMS).map(([tagid, name]) => ({ tagid: Number(tagid), name })) } }) };
    const input = JSON.parse(new URL(url).searchParams.get('input_json'));
    const store_items = input.ids.map(({ appid }) => ITEMS.find((i) => i.appid === appid) || { appid, success: 15 });
    return { ok: true, json: async () => ({ response: { store_items } }) };
  };
  return { fetchImpl, appels };
}

test('un passage lit les etiquettes qui manquent, fait le profil et en nomme les etiquettes', async () => {
  const s = fauxSteam();
  const wanted = [nom('Dead Cells'), nom('Planet Zoo'), '424242'];
  const etat = await refreshTaste({ fetch: s.fetchImpl, signals: aimes, wanted, state: null, now: NOW, country: 'FR', lang: 'french', pause: async () => {} });
  assert.equal(etat.at, NOW);
  assert.equal(etat.profile.liked, 4);
  assert.ok(etat.games[nom('Dead Cells')].tags.length);
  assert.deepEqual(etat.games['424242'], { none: true, at: NOW }, 'Steam ne connait pas ce numero');
  assert.equal(etat.namesLang, 'french');
  assert.ok(Object.values(etat.names).includes('Roguelike'));
  assert.ok(Object.keys(etat.names).length <= Object.keys(etat.profile.tags).length, 'seuls les noms utiles sont gardes');
  assert.ok(s.appels.every((a) => a.init.credentials === 'omit'), 'aucun cookie');
  assert.ok(tasteFor(etat, nom('Dead Cells')));

  // Un second passage n'a plus rien a lire : ni fiches, ni noms.
  const s2 = fauxSteam();
  const suite = await refreshTaste({ fetch: s2.fetchImpl, signals: aimes, wanted, state: etat, now: NOW + PASS_EVERY_MS, country: 'FR', lang: 'french', pause: async () => {} });
  assert.deepEqual(s2.appels, [], 'tout est en cache');
  assert.deepEqual(suite.profile, etat.profile);
});

test('sous trois jeux aimes : pas de profil, donc pas de noms a lire', async () => {
  const s = fauxSteam();
  const etat = await refreshTaste({ fetch: s.fetchImpl, signals: aimes.slice(0, 2), wanted: [], state: null, now: NOW, pause: async () => {} });
  assert.equal(etat.profile, null);
  assert.ok(!s.appels.some((a) => /GetTagList/.test(a.url)));
});

test('deux lots de cinquante au plus par passage, et une pause entre eux', async () => {
  const s = fauxSteam();
  const pauses = [];
  const wanted = Array.from({ length: LOT * LOTS_PER_RUN + 30 }, (_, i) => String(50000 + i));
  const etat = await refreshTaste({ fetch: s.fetchImpl, signals: [], wanted, state: null, now: NOW, pause: async (ms) => { pauses.push(ms); } });
  assert.equal(s.appels.filter((a) => /GetItems/.test(a.url)).length, LOTS_PER_RUN);
  assert.deepEqual(pauses, [1200]);
  assert.equal(Object.keys(etat.games).length, LOT * LOTS_PER_RUN);
});

test('Steam en panne : le passage ne jette pas et garde ce qu\'il savait', async () => {
  const bon = await refreshTaste({ fetch: fauxSteam().fetchImpl, signals: aimes, wanted: [], state: null, now: NOW, lang: 'french', pause: async () => {} });
  const panne = await refreshTaste({ fetch: fauxSteam({ echec: true }).fetchImpl, signals: aimes, wanted: [nom('Dead Cells')], state: { ...bon, games: {} }, now: NOW + 9e9, lang: 'french', pause: async () => {} });
  assert.equal(panne.profile, null, 'sans etiquettes, pas de profil : on ne suppose pas');
  assert.deepEqual(panne.games, {});
  assert.equal(await fetchGames(fauxSteam({ echec: true }).fetchImpl, ['1'], { now: NOW }), null);
  assert.deepEqual(await fetchGames(fauxSteam().fetchImpl, [], { now: NOW }), {});
  const un = await fetchGames(fauxSteam().fetchImpl, [nom('Dead Cells'), 'pas-un-numero'], { now: NOW });
  assert.deepEqual(Object.keys(un), [nom('Dead Cells')]);
});

test('le cache reste petit, et ne sacrifie jamais les jeux du profil', async () => {
  const s = fauxSteam();
  const vieux = Object.fromEntries(Array.from({ length: 320 }, (_, i) => [String(70000 + i), { tags: [[1, 100]], at: NOW - (i + 1) * 1000 - 9e9 }]));
  // Les jeux du profil sont les plus vieux de tous : ils restent.
  for (const a of aimes) vieux[a.appid] = jeux[a.appid] && { ...jeux[a.appid], at: 1 };
  const etat = await refreshTaste({ fetch: s.fetchImpl, signals: aimes, wanted: [], state: { games: vieux }, now: NOW + 1e9, lang: 'french', pause: async () => {} });
  assert.ok(Object.keys(etat.games).length <= 300);
  for (const a of aimes) assert.ok(etat.games[a.appid], a.appid);
});

test('Ce soir : un jeu dans vos gouts passe devant, et dit pourquoi', () => {
  const p = buildProfile(aimes, jeux);
  const etat = { profile: p, games: jeux, names: NOMS };
  const c = { key: 'steam:1', title: 'Dead Cells', appid: nom('Dead Cells'), never: null };
  const info = { tags: jeux[nom('Dead Cells')].tags, format: null };
  const sans = scoreTonight(c, info, {});
  const avec = scoreTonight(c, info, { taste: etat });
  assert.equal(avec.score - sans.score, 1.5);
  const raison = avec.reasons.find((r) => r.key === 'tonightTaste');
  assert.ok(raison && raison.args[0].includes('Roguelike'));
  // Sans noms lus : la raison existe, sans etiquettes.
  assert.ok(scoreTonight(c, info, { taste: { profile: p, names: {} } }).reasons.some((r) => r.key === 'tonightTasteBare'));
  // Un jeu qui n'y est pas, un profil absent, une fiche sans etiquettes : rien ne change.
  const zoo = { tags: jeux[nom('Planet Zoo')].tags, format: null };
  assert.deepEqual(scoreTonight(c, zoo, { taste: etat }), scoreTonight(c, zoo, {}));
  assert.deepEqual(scoreTonight(c, info, { taste: null }), sans);
  assert.deepEqual(scoreTonight(c, { format: null }, { taste: etat }), scoreTonight(c, { format: null }, {}));
});

test('la notification dit de quoi le jeu se rapproche', () => {
  const o = makeOffer({ source: 'test', store: STORES.GOG, storeId: 'dead-cells', title: 'Dead Cells', url: 'https://www.gog.com/game/dead_cells' });
  const base = composeAnnouncement([o], null, null).text;
  const avec = composeAnnouncement([o], null, null, null, ['Roguelike', '2D']).text;
  assert.equal(avec.split('\n').length, base.split('\n').length + 1);
  assert.match(avec, /Roguelike, 2D/);
  assert.match(composeAnnouncement([o], null, null, null, []).text, /\S/);
  assert.equal(composeAnnouncement([o], null, null, null, null).text, base, 'sans gouts, rien ne change');
  assert.equal(composeAnnouncement([o], null, null, null).text, base);
});

test('le popup, le service worker, les libelles et la charte', () => {
  const popup = lire('pages/popup.js');
  assert.match(popup, /el\('span', 'kind-tag for-you', t\('tagForYou'\)\)/);
  assert.match(popup, /taste: tonightTaste\(all\)/);
  assert.match(popup, /document\.getElementById\('taste-toggle'\)\.addEventListener\('change', \(e\) => writeBehaviour\(\{ taste: e\.target\.checked \}\)\)/);
  assert.match(lire('pages/popup.html'), /id="taste-toggle"/);
  assert.match(lire('pages/brut.css'), /\.kind-tag\.for-you \{/);
  const sw = lire('background.js');
  assert.match(sw, /tasteOffer: \(offer\) => tasteOne\(offer\)/);
  assert.match(sw, /await maybeTaste\(Date\.now\(\)\)/);
  for (const l of ['fr', 'en', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['tagForYou', 'tasteLine', 'tasteLineBare', 'tonightTaste', 'tonightTasteBare', 'tasteLabel', 'tasteHint']) assert.ok(table[k] && table[k].message, `${l} ${k}`);
  }
});

test('la sauvegarde emporte le profil, jamais le cache des jeux, et ne remplace pas un profil deja la', async () => {
  const { snapshot, planRestore, BACKUP_KEYS } = await import('../watch/full-backup.js');
  const p = buildProfile(aimes, jeux);
  const etat = { at: NOW, profile: p, games: jeux, names: NOMS, namesAt: NOW, namesLang: 'french' };
  assert.ok(BACKUP_KEYS.includes(KEY_TASTE));
  const bloc = snapshot({ [KEY_TASTE]: etat });
  assert.deepEqual(Object.keys(bloc[KEY_TASTE]).sort(), ['at', 'names', 'namesAt', 'namesLang', 'profile']);
  assert.ok(JSON.stringify(bloc).length < 6000, 'un profil, pas un cache');
  // Sans profil, rien n'est emporte : un cache seul n'est pas un gout.
  assert.deepEqual(snapshot({ [KEY_TASTE]: { games: jeux } }), {});
  // Un appareil neuf recoit le profil et garde ses propres fiches.
  const neuf = planRestore({ [KEY_TASTE]: { games: { 1: { none: true, at: 1 } } } }, bloc, { now: NOW });
  assert.deepEqual(neuf.write[KEY_TASTE].profile, p);
  assert.deepEqual(neuf.write[KEY_TASTE].games, { 1: { none: true, at: 1 } });
  assert.ok(neuf.added[KEY_TASTE] > 0);
  // Un appareil qui a deja le sien le garde.
  assert.equal(planRestore({ [KEY_TASTE]: etat }, bloc, { now: NOW }).write[KEY_TASTE], undefined);
  // Un fichier abime n'ecrit rien.
  assert.equal(planRestore({}, { [KEY_TASTE]: { profile: { tags: 4 } } }, { now: NOW }).write[KEY_TASTE], undefined);
});
