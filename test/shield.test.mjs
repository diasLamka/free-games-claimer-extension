/* Le bouclier : reconnaitre un faux site de jeux gratuits ou une fausse page de connexion.
 *
 * Ce fichier garde deux choses d'egale importance : ce qui DOIT etre vu (les imitations), et ce qui ne doit JAMAIS l'etre (les
 * sites officiels, les outils legitimes dont le nom contient "steam"). Un avertissement a tort apprend a ignorer les vrais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRANDS, LURES, LEVELS, REASONS, registrable, officialBrand, skeleton, editDistance, assessHost, assessPage, looksWorthAsking,
} from '../watch/shield.js';

const page = (url, extra = {}) => ({ url, title: '', text: '', hasPassword: false, ...extra });

/* ------------------------------------------------------- les noms d'hote */

test('registrable : le domaine enregistrable, deuxiemes niveaux compris', () => {
  assert.equal(registrable('store.epicgames.com'), 'epicgames.com');
  assert.equal(registrable('EPICGAMES.com.'), 'epicgames.com');
  assert.equal(registrable('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrable('example.com.au'), 'example.com.au');
  assert.equal(registrable('localhost'), 'localhost');
  assert.equal(registrable(''), '');
});

test('les domaines officiels, et leurs sous-domaines, sont reconnus', () => {
  for (const h of ['epicgames.com', 'store.epicgames.com', 'www.epicgames.com', 'unrealengine.com', 'fab.com', 'epic.games']) {
    assert.equal(officialBrand(h), 'epic', h);
  }
  for (const h of ['store.steampowered.com', 'steamcommunity.com', 'cdn.steamstatic.com', 's.team']) assert.equal(officialBrand(h), 'steam', h);
  for (const h of ['gog.com', 'www.gog.com', 'images.gog-statics.com']) assert.equal(officialBrand(h), 'gog', h);
});

test('un nom qui finit comme un domaine officiel n\'en est pas un', () => {
  for (const h of ['evilepicgames.com', 'epicgames.com.evil.net', 'notgog.com', 'steampowered.com.verify-login.ru']) {
    assert.equal(officialBrand(h), null, h);
  }
});

test('skeleton : ce qu\'un oeil presse confond', () => {
  assert.equal(skeleton('epicgarnes'), skeleton('epicgames'), 'rn et m');
  assert.equal(skeleton('st3ampowered'), skeleton('steampowered'), '3 et e');
  assert.equal(skeleton('steampovvered'), skeleton('steampowered'), 'vv et w');
  assert.equal(skeleton('g0g'), skeleton('gog'), '0 et o');
  assert.equal(skeleton('Steam-Powered'), 'steampowered', 'tirets et casse');
});

test('editDistance : borne et exacte', () => {
  assert.equal(editDistance('steam', 'steam'), 0);
  assert.equal(editDistance('steam', 'steem'), 1);
  assert.equal(editDistance('steam', 'stream'), 1);
  assert.equal(editDistance('abcdef', 'uvwxyz', 2), 3, 'au-dela du maximum : max + 1');
  assert.equal(editDistance('a', 'abcdefg', 2), 3);
});

/* ---------------------------------------------- l'adresse seule, ce qui est vu */

test('une imitation d\'adresse est une faute en soi', () => {
  const imitations = {
    'epicgarnes.com': 'epic', // rn pour m
    'epicgame.com': 'epic', // une lettre en moins
    'st3ampowered.com': 'steam',
    'steampowerd.com': 'steam',
    'steamcommunnity.com': 'steam',
    'steamcomrnunity.com': 'steam',
    'g0g.com': 'gog',
  };
  for (const [h, brand] of Object.entries(imitations)) {
    const r = assessHost(h);
    assert.equal(r.kind, 'typo', h);
    assert.equal(r.brand, brand, h);
  }
});

test('le meme nom sous une autre extension, et le nom habille', () => {
  assert.equal(assessHost('epicgames.net').kind, 'same-name');
  assert.equal(assessHost('steampowered.ru').kind, 'same-name');
  assert.equal(assessHost('epicgames-free.com').kind, 'brand-in-name');
  assert.equal(assessHost('free-epicgames-keys.net').kind, 'brand-in-name');
  assert.equal(assessHost('steam-powered-gifts.com').kind, 'brand-in-name');
  assert.equal(assessHost('gog-games.to').kind, 'brand-in-name', 'un nom court ne compte que comme mot entier d\'un nom a tirets');
});

test('les sites legitimes dont le nom contient "steam" ou "gog" ne sont pas des imitations', () => {
  for (const h of [
    'steamdb.info', 'steamgifts.com', 'steamspy.com', 'steamladder.com', 'steamcardexchange.net', 'isthereanydeal.com',
    'gogdb.org', 'google.com', 'dogs.com', 'epicurious.com', 'epicenter.org', 'steamboat.com', 'gamesplanet.com', 'humblebundle.com',
    'reddit.com', 'github.com', 'youtube.com',
  ]) {
    assert.equal(assessHost(h).kind, null, h);
  }
});

test('un nom court ne se laisse pas tordre : pas de tolerance sous huit lettres', () => {
  for (const h of ['gag.com', 'god.com', 'gogo.com', 'goog.com', 'dog.io']) assert.equal(assessHost(h).kind, null, h);
});

/* --------------------------------------------------------------- les pages */

test('un site officiel ne declenche JAMAIS rien, meme avec un champ de mot de passe et une promesse', () => {
  const r = assessPage(page('https://www.epicgames.com/id/login', {
    title: 'Log in | Epic Games', hasPassword: true, text: 'Free V-Bucks free steam wallet generator',
  }));
  assert.equal(r.level, LEVELS.OK);
  assert.equal(r.brand, 'epic');
  assert.deepEqual(r.reasons, []);
  for (const u of ['https://store.steampowered.com/login/', 'https://steamcommunity.com/login/home/', 'https://www.gog.com/account']) {
    assert.equal(assessPage(page(u, { title: 'Sign in', hasPassword: true })).level, LEVELS.OK, u);
  }
});

test('une imitation d\'adresse avec une page de connexion : danger', () => {
  const r = assessPage(page('https://epicgarnes.com/login', { title: 'Log in | Epic Games', hasPassword: true }));
  assert.equal(r.level, LEVELS.DANGER);
  assert.equal(r.brand, 'epic');
  assert.ok(r.reasons.includes(REASONS.TYPO));
  assert.ok(r.reasons.includes(REASONS.FAKE_LOGIN));
});

test('une imitation d\'adresse avec une promesse : danger', () => {
  const r = assessPage(page('https://st3ampowered.com/', { title: 'Free Steam Gift Card', text: 'Get your free steam gift card generator now' }));
  assert.equal(r.level, LEVELS.DANGER);
  assert.ok(r.reasons.includes(REASONS.LURE));
});

test('une imitation d\'adresse seule, sans rien d\'autre : attention', () => {
  const r = assessPage(page('https://steampowerd.com/', { title: 'Welcome', text: 'A page about gardening' }));
  assert.equal(r.level, LEVELS.WARN);
  assert.deepEqual(r.reasons, [REASONS.TYPO]);
});

test('le nom habille ne dit rien tout seul : il faut une connexion ou une promesse', () => {
  assert.equal(assessPage(page('https://epicgames-free.com/', { title: 'Weekly free games roundup' })).level, LEVELS.OK);
  const r = assessPage(page('https://epicgames-free.com/login', { title: 'Sign in to claim', hasPassword: true }));
  assert.equal(r.level, LEVELS.DANGER);
  assert.ok(r.reasons.includes(REASONS.BRAND_IN_NAME));
  assert.equal(assessPage(page('https://free-epicgames-keys.net/', { title: 'Epic Games key generator', text: 'epic games keys generator' })).level, LEVELS.DANGER);
});

test('le meme nom sous une autre extension : danger seulement avec connexion ET marque citee', () => {
  assert.equal(assessPage(page('https://epicgames.net/', { title: 'Hello' })).level, LEVELS.OK);
  assert.equal(assessPage(page('https://epicgames.net/login', { title: 'Epic Games - Log in', hasPassword: true })).level, LEVELS.DANGER);
});

test('une adresse qui n\'imite rien, avec un mot de passe sous un titre qui cite la marque : attention, jamais danger', () => {
  const r = assessPage(page('https://leaderboards.example.org/link', { title: 'Link your Steam account', hasPassword: true }));
  assert.equal(r.level, LEVELS.WARN);
  assert.equal(r.brand, 'steam');
  assert.ok(r.reasons.includes(REASONS.FAKE_LOGIN));
});

test('une promesse sur une adresse qui n\'imite rien : attention, a condition de citer un magasin', () => {
  const r = assessPage(page('https://promo.example.org/', { title: 'Win now', text: 'Free V-Bucks for Epic Games players, claim now' }));
  assert.equal(r.level, LEVELS.WARN);
  assert.ok(r.reasons.includes(REASONS.LURE));
  // La meme promesse sans aucune marque : rien.
  assert.equal(assessPage(page('https://promo.example.org/', { title: 'Win now', text: 'free v-bucks' })).level, LEVELS.OK);
});

test('les pages ordinaires ne declenchent rien : actualite, forum, outils legitimes, jeux gratuits annonces', () => {
  const sains = [
    page('https://www.reddit.com/r/FreeGameFindings/', { title: 'Free Games - Epic Games, Steam, GOG', text: 'Free on Epic Games this week: Hades' }),
    page('https://steamdb.info/app/220/', { title: 'Half-Life 2 - SteamDB', text: 'Steam players online' }),
    page('https://www.steamgifts.com/', { title: 'Steam Gifts', text: 'giveaways for Steam games' }),
    page('https://www.youtube.com/watch?v=x', { title: 'Epic Games free game of the week', text: 'Steam sale tips' }),
    page('https://isthereanydeal.com/game/hades/', { title: 'Hades - Is There Any Deal?', text: 'GOG Steam Epic prices' }),
    page('https://news.example.com/free-games', { title: 'Les jeux gratuits de la semaine', text: 'Epic Games offre un jeu gratuit chaque jeudi' }),
    page('https://forum.example.com/login', { title: 'Forum login', hasPassword: true, text: 'Welcome to the forum' }),
  ];
  for (const p of sains) assert.equal(assessPage(p).level, LEVELS.OK, p.url);
});

test('une adresse qui n\'est pas web, vide ou illisible : rien', () => {
  for (const u of ['', 'about:blank', 'chrome://extensions', 'file:///tmp/x.html', 'ftp://epicgarnes.com/', 'pas une adresse']) {
    assert.equal(assessPage(page(u, { title: 'Log in | Epic Games', hasPassword: true })).level, LEVELS.OK, u);
  }
  assert.equal(assessPage(undefined).level, LEVELS.OK);
  assert.equal(assessPage({}).level, LEVELS.OK);
});

test('les promesses reconnues en francais et en allemand', () => {
  assert.equal(assessPage(page('https://promo.example.org/', { title: 'Epic Games', text: 'Obtenez votre carte cadeau steam gratuite' })).level, LEVELS.WARN);
  assert.equal(assessPage(page('https://promo.example.org/', { title: 'Steam', text: 'Jetzt kostenlose Steam Geschenkkarte sichern' })).level, LEVELS.WARN);
});

/* ---------------------------------------------------- la pre-selection du script */

test('looksWorthAsking : seulement un champ de mot de passe, un titre qui cite une marque, ou une promesse dans le titre', () => {
  assert.equal(looksWorthAsking({ title: 'Hello', hasPassword: true }), true);
  assert.equal(looksWorthAsking({ title: 'Log in | Epic Games' }), true);
  assert.equal(looksWorthAsking({ title: 'Free V-Bucks generator' }), true);
  assert.equal(looksWorthAsking({ title: 'My cat photos' }), false);
  assert.equal(looksWorthAsking({}), false);
});

test('les magasins surveilles ont des domaines, des noms et des mots', () => {
  for (const [brand, b] of Object.entries(BRANDS)) {
    assert.ok(b.label && b.domains.length && b.names.length && b.words.length, brand);
  }
});

/* ------------------------------------------------------- les phrases et le cablage */

import { readFileSync } from 'node:fs';
import { shieldLines, officialDomains, SHIELD_ORIGINS, SHIELD_SCRIPT_ID } from '../watch/shield.js';
import { messageAllowed } from '../watch/messaging.js';
import { declaresOptionalOrigin } from '../watch/permissions.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('shieldLines : une phrase par raison, avec l\'adresse et la marque', () => {
  const t = (cle, ...args) => `${cle}(${args.join('|')})`;
  const r = assessPage(page('https://epicgarnes.com/login', { title: 'Log in | Epic Games', hasPassword: true }));
  assert.deepEqual(shieldLines(r, t), [
    'shieldReasonTypo(epicgarnes.com|Epic Games)',
    'shieldReasonFakeLogin(Epic Games)',
  ]);
  assert.deepEqual(shieldLines({ brand: null, host: 'x.org', reasons: [REASONS.LURE] }, t), ['shieldReasonLure()']);
  assert.deepEqual(shieldLines({ reasons: ['inconnue'] }, t), [], 'une raison inconnue ne fait pas de phrase');
  assert.deepEqual(shieldLines(undefined, t), []);
});

test('officialDomains : les deux premiers domaines de la marque', () => {
  assert.deepEqual(officialDomains('epic'), ['epicgames.com', 'epic.games']);
  assert.deepEqual(officialDomains('gog'), ['gog.com', 'gog-statics.com']);
  assert.deepEqual(officialDomains('inconnue'), []);
});

test('le script de page est une copie fidele des motifs de watch/shield.js', () => {
  const script = lire('content/shield.js');
  for (const b of Object.values(BRANDS)) {
    for (const re of b.words) assert.ok(script.includes(re.source), `marque absente du script : ${re.source}`);
  }
  for (const re of LURES) assert.ok(script.includes(re.source), `promesse absente du script : ${re.source}`);
});

test('le script de page ne fait que lire : aucun reseau, aucune ecriture de stockage, aucun clic', () => {
  const script = lire('content/shield.js');
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(script), 'aucun reseau');
  assert.ok(!/storage\.|localStorage|sessionStorage|document\.cookie/.test(script), 'ni stockage ni cookie');
  assert.ok(!/\.click\(|dispatchEvent/.test(script), 'aucun clic');
  assert.ok(/attachShadow\(\{ mode: 'closed' \}\)/.test(script), 'racine fantome fermee');
});

test('fgc-shield est un message de page de contenu, jamais de l\'interface', () => {
  assert.equal(messageAllowed('fgc-shield', 'content'), true);
  assert.equal(messageAllowed('fgc-shield', 'page'), false);
  assert.equal(messageAllowed('fgc-shield', 'inconnu'), false);
});

test('le worker lit l\'adresse dans l\'onglet expediteur, jamais dans le message', () => {
  const bg = lire('background.js');
  const i = bg.indexOf("msg.type === 'fgc-shield'");
  assert.ok(i > 0);
  const bloc = bg.slice(i, bg.indexOf("msg.type === 'fgc-lookup'", i));
  assert.match(bloc, /sender\.tab\.url/);
  assert.doesNotMatch(bloc, /msg\.url/);
});

test('les adresses du bouclier sont facultatives et DEJA declarees aux deux manifestes : aucune permission a l\'installation', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(lire(f));
    for (const o of SHIELD_ORIGINS) {
      assert.equal(declaresOptionalOrigin(m, o), true, `${f} : ${o}`);
      assert.ok(!(m.host_permissions || []).includes(o), `${f} : ${o} ne doit pas etre une permission d'installation`);
    }
  }
  assert.equal(SHIELD_SCRIPT_ID, 'fgc-bouclier');
});

test('le script de page n\'est pas declare au manifeste : il n\'existe que si l\'utilisateur l\'a demande', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(lire(f));
    const declares = JSON.stringify(m.content_scripts || []);
    assert.ok(!declares.includes('content/shield.js'), f);
  }
});
