/* Les DLC gratuits de vos jeux Steam (2.92.0).
 *
 * Sur des reponses reelles de Steam (Euro Truck Simulator 2, 2026-09-27) : un
 * DLC sans prix n'est qu'un candidat ; appdetails tranche (gratuit, sorti) ;
 * ce que vous possedez ou avez masque ne revient pas ; le rythme est tenu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  shortDlcName, dlcCandidates, dlcVerdict, runDlcPass, pendingFreeDlc, gamesToScan, steamGames, readDlcState, dlcPassDue,
  RESCAN_MS, PER_RUN, dlcForAppUrl,
} from '../watch/steam-dlc.js';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const DLCFORAPP = fx('steam-dlcforapp-227300.json');
const FREE = fx('steam-appdetails-3977520.json');
const PAID = fx('steam-appdetails-5131880.json');
const NOW = Date.UTC(2026, 8, 27, 12);

/** appdetails d'un DLC, fabrique sur le modele du vrai. */
function details(id, { free = true, soon = false } = {}) {
  const d = structuredClone(FREE['3977520']);
  d.data.steam_appid = Number(id);
  d.data.name = `DLC ${id}`;
  d.data.is_free = free;
  d.data.release_date = { coming_soon: soon, date: soon ? 'To be announced' : '14 Oct, 2025' };
  return { [id]: d };
}

test('dlcforapp : les DLC sans prix sont des candidats, les autres non', () => {
  const c = dlcCandidates(DLCFORAPP);
  assert.deepEqual(c.map((x) => x.id), ['3977520', '3323360', '1536500', '3796990']);
  assert.match(c[0].name, /DAF XF Electric/);
  assert.equal(dlcCandidates({ status: 2 }), null);
});

test('appdetails tranche : gratuit et sorti, ou non', () => {
  assert.deepEqual(dlcVerdict(FREE, '3977520'), {
    free: true, released: true, dlc: true, parent: '227300', name: 'Euro Truck Simulator 2 - DAF XF Electric', packageId: null,
  });
  const p = dlcVerdict(PAID, '5131880');
  assert.equal(p.free, false, 'pas de prix, mais pas gratuit : les Prime Access de Warframe');
  assert.equal(dlcVerdict({ 1: { success: false } }, '1'), null);
});

test('un passage : lit les jeux, verifie les candidats, ne garde que le gratuit et sorti', async () => {
  const collection = {
    'steam:227300': { store: 'steam', id: '227300', title: 'Euro Truck Simulator 2', kind: 'game' },
    'steam:3323360': { store: 'steam', id: '3323360', title: 'ETS2 - Volvo FH Series 6', kind: 'dlc' },
  };
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push({ url, init });
    if (url.includes('dynamicstore/userdata')) return { ok: true, json: async () => ({ rgOwnedApps: [227300, 3323360], rgOwnedPackages: [1] }) };
    if (url.includes('dlcforapp')) return { ok: true, json: async () => DLCFORAPP };
    const id = new URL(url).searchParams.get('appids');
    if (id === '3977520') return { ok: true, json: async () => FREE };
    return { ok: true, json: async () => details(id, { free: id !== '1536500' && id !== '3796990', soon: id === '1536500' || id === '3796990' }) };
  };
  const r = await runDlcPass({ fetch: fetchImpl, now: NOW, collection, state: null, pause: async () => {} });
  assert.deepEqual(r.found, ['3977520'], 'celui qu\'on possede deja n\'est meme pas verifie');
  assert.ok(!urls.some((u) => u.url.includes('appids=3323360')));
  // Les lectures publiques partent sans cookies ; seule la bibliotheque les porte.
  for (const u of urls) assert.equal(u.init.credentials, u.url.includes('userdata') ? 'include' : 'omit', u.url);

  const pending = pendingFreeDlc(r.state, collection);
  assert.deepEqual(pending.map((p) => p.id), ['3977520']);
  assert.equal(pending[0].parentName, 'Euro Truck Simulator 2');
  assert.equal(pending[0].runUrl, 'steam://run/3977520');
  assert.equal(pending[0].short, 'DAF XF Electric', 'sans le nom du jeu, dit a cote');
  assert.equal(pending[0].url, 'https://store.steampowered.com/app/3977520/');

  // Masque : il ne revient plus. Possede (ajoute dans Steam) : non plus.
  assert.equal(pendingFreeDlc({ ...r.state, hidden: ['3977520'] }, collection).length, 0);
  assert.equal(pendingFreeDlc({ ...r.state, owned: { at: NOW, apps: ['3977520'] } }, collection).length, 0);
});

test('le rythme : huit jeux par passage, un jeu relu tous les trente jours, un passage par heure', () => {
  const games = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), title: `J${i}` }));
  const state = readDlcState({ games: { 1: { at: NOW - 1000 }, 2: { at: NOW - RESCAN_MS - 1 } } });
  const n = gamesToScan(games, state, NOW);
  assert.equal(n.length, PER_RUN);
  assert.ok(!n.some((g) => g.id === '1'), 'lu il y a une seconde');
  assert.ok(!n.some((g) => g.id === '2'), 'les jamais lus passent avant');
  const peu = gamesToScan(games.slice(0, 4), state, NOW).map((g) => g.id);
  assert.deepEqual(peu, ['3', '4', '2'], 'jamais lus, puis lu il y a plus de trente jours');
  assert.equal(dlcPassDue({ at: NOW - 1000 }, NOW), false);
  assert.equal(dlcPassDue({ at: NOW - 3600_001 }, NOW), true);
  assert.deepEqual(steamGames({ a: { store: 'steam', id: '5', kind: 'dlc' }, b: { store: 'gog', id: '6' }, c: { store: 'steam', id: '7', kind: 'game', title: 'X' } }), [{ id: '7', title: 'X' }]);
  assert.equal(dlcForAppUrl('227300'), 'https://store.steampowered.com/api/dlcforapp/?appid=227300&cc=FR&l=english');
});

test('un DLC qui prend un prix sort de la liste a la relecture du jeu ; un DLC a paraitre est reverifie', async () => {
  const collection = { g: { store: 'steam', id: '227300', title: 'ETS2', kind: 'game' } };
  const state = {
    at: NOW - RESCAN_MS - 10,
    owned: { at: NOW, apps: [] },
    games: { 227300: { at: NOW - RESCAN_MS - 10, name: 'ETS2', dlc: ['111', '3977520'] } },
    dlc: {
      111: { name: 'Ancien', parent: '227300', checked: true, free: true, released: true, dlc: true },
      3977520: { name: 'DAF', parent: '227300', checked: true, free: true, released: false, dlc: true },
    },
  };
  const verifies = [];
  const fetchImpl = async (url) => {
    if (url.includes('dlcforapp')) return { ok: true, json: async () => DLCFORAPP };
    const id = new URL(url).searchParams.get('appids');
    verifies.push(id);
    return { ok: true, json: async () => (id === '3977520' ? FREE : details(id, { free: false, soon: true })) };
  };
  const r = await runDlcPass({ fetch: fetchImpl, now: NOW, collection, state, pause: async () => {} });
  assert.equal(r.state.dlc['111'], undefined, 'n\'est plus sans prix : retire');
  assert.ok(verifies.includes('3977520'), 'etait a paraitre : reverifie');
  assert.deepEqual(pendingFreeDlc(r.state, collection).map((p) => p.id), ['3977520']);
});

test('une panne ne jette pas, et le jeu en panne n\'est pas relu en boucle', async () => {
  const collection = { g: { store: 'steam', id: '9', title: 'X', kind: 'game' } };
  const r = await runDlcPass({ fetch: async () => { throw new Error('reseau'); }, now: NOW, collection, state: null, pause: async () => {} });
  assert.ok(r.errors.length >= 2);
  assert.equal(gamesToScan(steamGames(collection), readDlcState(r.state), NOW + 3600_000).length, 0);
});

test('le nom court d\'un DLC : sans son jeu, jamais vide', () => {
  assert.equal(shortDlcName('Euro Truck Simulator 2 - DAF XD', 'Euro Truck Simulator 2'), 'DAF XD');
  assert.equal(shortDlcName('Hades: Original Soundtrack', 'Hades'), 'Original Soundtrack');
  assert.equal(shortDlcName('Soundtrack', 'Hades'), 'Soundtrack');
  assert.equal(shortDlcName('Hades', 'Hades'), 'Hades');
  assert.equal(shortDlcName('Hadestown OST', 'Hades'), 'Hadestown OST', 'un mot entier seulement');
});
