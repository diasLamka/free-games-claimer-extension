/* Clic droit : « Me prevenir quand ce jeu sera gratuit » (2.79.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  GAME_PAGES, MENU_LINK, MENU_PAGE, chooseTitle, cleanDocTitle, menuItems, readPageTitle, slugTitle, storeOfUrl,
  wishFromClick,
} from '../watch/context-wish.js';
import { KEY_WISHLIST, KEY_STEAM_WISHLIST } from '../watch/wishlist.js';
import { setLocale, t } from '../lib/i18n.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T12:00:00Z');

test('les fiches des trois magasins, et rien d\'autre', () => {
  assert.equal(storeOfUrl('https://store.steampowered.com/app/393380/Squad/'), 'steam');
  assert.equal(storeOfUrl('https://store.epicgames.com/fr/p/mechabellum'), 'epic');
  assert.equal(storeOfUrl('https://store.epicgames.com/p/mechabellum'), 'epic');
  assert.equal(storeOfUrl('https://www.gog.com/fr/game/astrea_six_sided_oracles'), 'gog');
  assert.equal(storeOfUrl('https://store.steampowered.com/search/?term=x'), null);
  assert.equal(storeOfUrl('https://store.epicgames.com/fr/browse'), null);
  assert.equal(storeOfUrl('http://store.steampowered.com/app/1/'), null, 'https seulement');
  assert.equal(storeOfUrl('https://evil.example/app/1/'), null);
  assert.equal(storeOfUrl('pas une adresse'), null);
  // Les motifs du menu couvrent exactement ces fiches-la.
  assert.ok(GAME_PAGES.every((m) => /^https:\/\/(store\.steampowered\.com|store\.epicgames\.com|www\.gog\.com)\//.test(m)));
});

test('le nom que porte l\'adresse, lisible', () => {
  assert.equal(slugTitle('https://store.steampowered.com/app/1286880/Ship_Graveyard_Simulator/'), 'Ship Graveyard Simulator');
  assert.equal(slugTitle('https://store.steampowered.com/app/393380/'), '', 'sans nom, rien');
  assert.equal(slugTitle('https://store.epicgames.com/fr/p/astrea-six-sided-oracles-6f1b33'), 'Astrea Six Sided Oracles', 'l\'identifiant d\'Epic retire');
  assert.equal(slugTitle('https://store.epicgames.com/fr/p/cities-skylines'), 'Cities Skylines', 'un mot n\'est pas un identifiant');
  assert.equal(slugTitle('https://www.gog.com/fr/game/the_witcher_3_wild_hunt'), 'The Witcher 3 Wild Hunt');
});

test('le titre du document, sans le magasin', () => {
  assert.equal(cleanDocTitle('Mechabellum | Download and Buy Today - Epic Games Store'), 'Mechabellum');
  assert.equal(cleanDocTitle('Save 50% on Squad on Steam'), 'Squad');
  assert.equal(cleanDocTitle('Économisez 50 % sur Squad sur Steam'), 'Squad');
  assert.equal(cleanDocTitle('Squad on Steam'), 'Squad');
  assert.equal(cleanDocTitle('Astrea: Six-Sided Oracles on GOG.com'), 'Astrea: Six-Sided Oracles');
  // Lu sur GOG le 2026-09-26.
  assert.equal(cleanDocTitle('The Witcher 3: Wild Hunt - Complete Edition 50% de réduction | GOG.COM'), 'The Witcher 3: Wild Hunt - Complete Edition');
});

test('fiche : ce que la page affiche d\'abord ; lien : son texte, sinon l\'adresse', () => {
  const url = 'https://store.steampowered.com/app/393380/Squad/';
  assert.equal(chooseTitle({ scraped: 'Squad', docTitle: 'Save 50% on Squad on Steam', url }), 'Squad');
  assert.equal(chooseTitle({ scraped: '', docTitle: 'Save 50% on Squad on Steam', url }), 'Squad');
  assert.equal(chooseTitle({ scraped: '', docTitle: '', url }), 'Squad');
  assert.equal(chooseTitle({ link: true, linkText: 'Squad', url }), 'Squad');
  assert.equal(chooseTitle({ link: true, linkText: 'Acheter', url }), 'Squad', 'un texte de bouton ne nomme pas un jeu');
  assert.equal(chooseTitle({ link: true, linkText: '', url: 'https://store.steampowered.com/app/393380/' }), '');
  assert.equal(chooseTitle({ scraped: 'Dwarven Realms (Steam) Key Giveaway' }), 'Dwarven Realms');
  assert.equal(chooseTitle({ scraped: 'x'.repeat(300) }), '', 'une page entiere n\'est pas un titre');
  // Epic derriere Cloudflare, mesure du 2026-09-26 : l'attente n'est pas un jeu, l'adresse l'est.
  assert.equal(chooseTitle({ scraped: 'One more step', docTitle: 'Just a moment...', url: 'https://store.epicgames.com/fr/p/astrea-six-sided-oracles' }), 'Astrea Six Sided Oracles');
  assert.equal(chooseTitle({ scraped: 'One more step', docTitle: 'Just a moment...', url: '' }), '');
});

test('le menu : une entree sur la fiche, une sur un lien vers une fiche', () => {
  const [page, lien] = menuItems('Me prévenir');
  assert.equal(page.id, MENU_PAGE);
  assert.deepEqual(page.contexts, ['page']);
  assert.deepEqual(page.documentUrlPatterns, [...GAME_PAGES]);
  assert.equal(lien.id, MENU_LINK);
  assert.deepEqual(lien.contexts, ['link']);
  assert.deepEqual(lien.targetUrlPatterns, [...GAME_PAGES]);
  // La fonction injectee est autonome : pas d'import, pas de variable exterieure.
  assert.doesNotMatch(readPageTitle.toString(), /\b(import|require|chrome|api)\b/);
});

/** Un faux chrome : stockage, et une page dont on lit le titre. */
function fauxChrome(raw = {}, lu = { title: 'Squad', doc: 'Save 50% on Squad on Steam' }) {
  const data = { ...raw };
  const injections = [];
  return {
    data, injections,
    storage: {
      local: {
        async get(keys) {
          const l = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(l.filter((k) => data[k] !== undefined).map((k) => [k, structuredClone(data[k])]));
        },
        async set(obj) { Object.assign(data, structuredClone(obj)); },
      },
    },
    scripting: {
      async executeScript(opts) {
        injections.push(opts);
        if (lu instanceof Error) throw lu;
        return [{ result: lu }];
      },
    },
  };
}

test('un clic sur la fiche ajoute le jeu, et le dit', async () => {
  setLocale('fr');
  try {
    const chrome = fauxChrome();
    const avis = [];
    const r = await wishFromClick({
      info: { menuItemId: MENU_PAGE, pageUrl: 'https://store.steampowered.com/app/393380/Squad/', frameId: 0 },
      tab: { id: 7, title: 'Save 50% on Squad on Steam' },
      chrome, t, notify: async (n) => avis.push(n), now: NOW,
    });
    assert.deepEqual(r, { added: true, title: 'Squad', already: null, freeNow: null });
    assert.deepEqual(chrome.data[KEY_WISHLIST].map((w) => w.title), ['Squad']);
    assert.equal(chrome.injections[0].target.tabId, 7);
    assert.equal(chrome.injections[0].func, readPageTitle);
    assert.equal(avis.length, 1);
    assert.equal(avis[0].title, 'Ajouté à vos souhaits : Squad');
    assert.match(avis[0].message, /prévenu dès qu’il sera gratuit/);
  } finally { setLocale(null); }
});

test('deja attendu -- a la main ou par la liste Steam : rien n\'est ecrit deux fois', async () => {
  setLocale('fr');
  try {
    const avis = [];
    const main = fauxChrome({ [KEY_WISHLIST]: [{ title: 'Squad', key: 'squad' }] });
    const r = await wishFromClick({
      info: { menuItemId: MENU_PAGE, pageUrl: 'https://store.steampowered.com/app/393380/Squad/' },
      tab: { id: 1 }, chrome: main, t, notify: async (n) => avis.push(n), now: NOW,
    });
    assert.equal(r.added, false);
    assert.equal(main.data[KEY_WISHLIST].length, 1);
    assert.equal(avis[0].title, 'Déjà dans vos souhaits : Squad');
    // Sous un autre nom : l'appid suffit.
    const steam = fauxChrome({ [KEY_STEAM_WISHLIST]: { at: NOW, wishes: [{ id: '393380', title: 'Squad (FR)', key: 'squad fr' }] } });
    const r2 = await wishFromClick({
      info: { menuItemId: MENU_PAGE, pageUrl: 'https://store.steampowered.com/app/393380/Squad/' },
      tab: { id: 1 }, chrome: steam, t, notify: async () => {}, now: NOW,
    });
    assert.equal(r2.already, 'steam');
    assert.equal(steam.data[KEY_WISHLIST], undefined, 'la liste importee suffit');
  } finally { setLocale(null); }
});

test('gratuit en ce moment : la notification le dit, et mene a l\'offre', async () => {
  setLocale('fr');
  try {
    const avis = [];
    const chrome = fauxChrome({
      'veille:offres': {
        'epic:astrea': { store: 'epic', title: 'Astrea: Six Sided Oracles', normalisedTitle: 'astrea six sided oracles', url: 'https://store.epicgames.com/p/astrea', state: 'confirmed', end: NOW + 86400000 },
      },
    }, { title: 'Astrea: Six-Sided Oracles', doc: '' });
    const r = await wishFromClick({
      info: { menuItemId: MENU_PAGE, pageUrl: 'https://www.gog.com/fr/game/astrea_six_sided_oracles' },
      tab: { id: 3 }, chrome, t, notify: async (n) => avis.push(n), now: NOW,
    });
    assert.equal(r.freeNow, 'epic');
    assert.equal(avis[0].message, 'Il est gratuit en ce moment sur Epic Games Store !');
    assert.equal(avis[0].url, 'https://store.epicgames.com/p/astrea');
  } finally { setLocale(null); }
});

test('un lien : pas d\'injection, le nom vient de l\'adresse', async () => {
  const chrome = fauxChrome();
  const r = await wishFromClick({
    info: { menuItemId: MENU_LINK, linkUrl: 'https://store.steampowered.com/app/1286880/Ship_Graveyard_Simulator/', pageUrl: 'https://www.reddit.com/r/FreeGameFindings/' },
    tab: { id: 4 }, chrome, t, notify: async () => {}, now: NOW,
  });
  assert.equal(r.title, 'Ship Graveyard Simulator');
  assert.equal(chrome.injections.length, 0, 'la page du lien n\'est pas lue : aucun acces a reddit');
});

test('page illisible : on le dit, on n\'invente rien', async () => {
  setLocale('fr');
  try {
    const avis = [];
    const chrome = fauxChrome({}, new Error('Cannot access contents of the page'));
    const r = await wishFromClick({
      info: { menuItemId: MENU_PAGE, pageUrl: 'https://store.steampowered.com/app/393380/' },
      tab: { id: 1, title: '' }, chrome, t, notify: async (n) => avis.push(n), now: NOW,
    });
    assert.deepEqual(r, { added: false, title: null });
    assert.equal(avis[0].title, 'Nom du jeu introuvable');
    assert.equal(chrome.data[KEY_WISHLIST], undefined);
  } finally { setLocale(null); }
});

test('branche : permission, creation a l\'installation, langue suivie', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    assert.ok(JSON.parse(lire(f)).permissions.includes('contextMenus'), f);
  }
  const bg = lire('background.js');
  assert.match(bg, /api\.runtime\.onInstalled\.addListener\(\(\) => \{\n\s+installerMenus\(\)/);
  assert.match(bg, /api\.contextMenus\.update\(id, \{ title: t\('ctxWishMenu'\) \}/);
  assert.match(bg, /wishFromClick\(\{ info, tab, chrome: api, t, notify: showNotice, record \}\)/);
});
