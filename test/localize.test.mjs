/* Les adresses des magasins suivent la langue et le pays du reglage.
 *
 * Deux promesses sont tenues ici :
 *
 *   1. watch/localize.js fait ce qu'il dit, magasin par magasin, et RIEN de
 *      plus : Steam, les hotes inconnus et le http restent tels quels ;
 *   2. le moteur (src/core/09-locale-urls.js) en tient une copie ES5 qui rend
 *      EXACTEMENT la meme chose sur les memes entrees -- meme duplication
 *      assumee, meme garde que test/locale.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { loadEngine } from './harness.mjs';
import { KEY_COUNTRY, KEY_LANG } from '../watch/locale.js';
import {
  KEY_LUNA_HOST, localizeUrl, lunaHostFor, normaliseLunaHost, epicPageLang,
} from '../watch/localize.js';
import { readLocale, localizeFor, installLinkLocalizer } from '../watch/localizer.js';
import { openHiddenTab } from '../watch/claim.js';

const FR = { country: 'FR', lang: 'fr' };

/* ------------------------------------------------------------------ Epic */

test('Epic : le segment de langue du chemin devient celui du pays', () => {
  assert.equal(localizeUrl('https://store.epicgames.com/en-US/p/hades', FR),
    'https://store.epicgames.com/fr/p/hades');
  assert.equal(localizeUrl('https://store.epicgames.com/en-US/free-games?x=1#a', FR),
    'https://store.epicgames.com/fr/free-games?x=1#a');
});

test('Epic : sans segment (schema actuel), c\'est ?lang= qui porte la langue', () => {
  assert.equal(localizeUrl('https://store.epicgames.com/p/hades', FR),
    'https://store.epicgames.com/p/hades?lang=fr');
  assert.equal(localizeUrl('https://store.epicgames.com/p/hades?lang=en', FR),
    'https://store.epicgames.com/p/hades?lang=fr');
  assert.equal(localizeUrl('https://store.epicgames.com/p/hades?a=1&lang=en', FR),
    'https://store.epicgames.com/p/hades?a=1&lang=fr');
});

test('Epic : une adresse deja bonne est rendue octet pour octet', () => {
  for (const ok of [
    'https://store.epicgames.com/fr/p/hades',
    'https://store.epicgames.com/p/hades?lang=fr',
    'https://store.epicgames.com/free-games?lang=fr',
  ]) assert.equal(localizeUrl(ok, FR), ok);
});

test('Epic : « free-games », « p », « browse » ne sont pas pris pour une langue', () => {
  // « fr » suivi de « ee-games » n'est PAS le segment « fr ».
  assert.equal(localizeUrl('https://store.epicgames.com/free-games', FR),
    'https://store.epicgames.com/free-games?lang=fr');
  assert.equal(localizeUrl('https://store.epicgames.com/browse?q=a', FR),
    'https://store.epicgames.com/browse?q=a&lang=fr');
});

test('Epic : pour reclamer, la langue reste une de celles que le moteur lit', () => {
  // Allemagne : on AFFICHE en allemand, on OUVRE en anglais (bug de la 2.20.0).
  const de = { country: 'DE', lang: 'de' };
  assert.equal(epicPageLang('de', false), 'de');
  assert.equal(epicPageLang('de', true), 'en');
  assert.equal(localizeUrl('https://store.epicgames.com/p/x', de),
    'https://store.epicgames.com/p/x?lang=de');
  assert.equal(localizeUrl('https://store.epicgames.com/p/x', { ...de, forClaim: true }),
    'https://store.epicgames.com/p/x?lang=en');
  assert.equal(localizeUrl('https://store.epicgames.com/de/p/x', { ...de, forClaim: true }),
    'https://store.epicgames.com/en-US/p/x');
  // Une langue que le moteur lit reste telle quelle.
  assert.equal(localizeUrl('https://store.epicgames.com/p/x', { ...FR, forClaim: true }),
    'https://store.epicgames.com/p/x?lang=fr');
});

/* ------------------------------------------------------------------- GOG */

test('GOG : le prefixe de langue est remplace, ou pose', () => {
  assert.equal(localizeUrl('https://www.gog.com/en/game/hades', FR), 'https://www.gog.com/fr/game/hades');
  assert.equal(localizeUrl('https://www.gog.com/game/hades', FR), 'https://www.gog.com/fr/game/hades');
  assert.equal(localizeUrl('https://www.gog.com/redeem', FR), 'https://www.gog.com/fr/redeem');
  assert.equal(localizeUrl('https://www.gog.com/', FR), 'https://www.gog.com/fr/');
  assert.equal(localizeUrl('https://www.gog.com/#giveaway', FR), 'https://www.gog.com/fr/#giveaway');
  assert.equal(localizeUrl('https://www.gog.com/de/games?price=free', FR), 'https://www.gog.com/fr/games?price=free');
});

test('GOG : une adresse deja bonne, ou hors du catalogue, ne bouge pas', () => {
  for (const ok of [
    'https://www.gog.com/fr/game/hades',
    'https://www.gog.com/account',
    'https://www.gog.com/account/settings',
    'https://www.gog.com/api/x',
  ]) assert.equal(localizeUrl(ok, FR), ok);
});

test('GOG : une langue que le site ne sert pas en chemin laisse l\'adresse intacte', () => {
  // Espagne, Italie, Portugal, Pays-Bas : GOG n'a pas de prefixe pour eux.
  for (const [country, lang] of [['ES', 'es'], ['IT', 'it'], ['PT', 'pt'], ['NL', 'nl']]) {
    assert.equal(localizeUrl('https://www.gog.com/en/game/hades', { country, lang }),
      'https://www.gog.com/en/game/hades', `${country} : un prefixe invente serait refuse`);
  }
  assert.equal(localizeUrl('https://www.gog.com/en/game/hades', { country: 'DE', lang: 'de' }),
    'https://www.gog.com/de/game/hades');
});

/* ------------------------------------------------------------------ Luna */

test('Luna : le domaine suit le pays', () => {
  assert.equal(lunaHostFor('FR'), 'luna.amazon.fr');
  assert.equal(lunaHostFor('BE'), 'luna.amazon.fr');
  assert.equal(lunaHostFor('GB'), 'luna.amazon.co.uk');
  assert.equal(lunaHostFor('US'), 'luna.amazon.com');
  assert.equal(lunaHostFor('PT'), 'luna.amazon.com', 'pas de domaine portugais : repli .com');
  assert.equal(localizeUrl('https://luna.amazon.com/claims/home?filter=Game&g=s', FR),
    'https://luna.amazon.fr/claims/home?filter=Game&g=s');
  assert.equal(localizeUrl('https://luna.amazon.fr/claims/home', { country: 'DE', lang: 'de' }),
    'https://luna.amazon.de/claims/home');
});

test('Luna : la session vue sur un autre domaine l\'emporte, jamais un hote quelconque', () => {
  assert.equal(localizeUrl('https://luna.amazon.fr/claims/home', { ...FR, lunaHost: 'luna.amazon.com' }),
    'https://luna.amazon.com/claims/home');
  assert.equal(normaliseLunaHost('luna.amazon.com'), 'luna.amazon.com');
  assert.equal(normaliseLunaHost(' Luna.Amazon.FR '), 'luna.amazon.fr');
  for (const bidon of ['evil.example', 'luna.amazon.com.evil.example', 'amazon.fr', '', null]) {
    assert.equal(normaliseLunaHost(bidon), null, `accepte a tort : ${bidon}`);
  }
  // Un hote appris non valide est ignore : le pays reprend la main.
  assert.equal(localizeUrl('https://luna.amazon.com/claims/home', { ...FR, lunaHost: 'evil.example' }),
    'https://luna.amazon.fr/claims/home');
});

test('Luna : seules les pages de reclamation changent de domaine', () => {
  assert.equal(localizeUrl('https://luna.amazon.com/', FR), 'https://luna.amazon.com/');
  assert.equal(localizeUrl('https://luna.amazon.com/library', FR), 'https://luna.amazon.com/library');
});

/* ------------------------------------------------------- ce qui ne bouge pas */

test('Steam, les autres hotes, le http et les non-adresses restent tels quels', () => {
  for (const intact of [
    'https://store.steampowered.com/app/10/?l=english',
    'https://store.steampowered.com/app/10/',
    'http://store.epicgames.com/p/x',
    'https://example.com/en/game/x',
    'https://store.epicgames.com.evil.example/p/x',
    'javascript:alert(1)',
    'pas une adresse',
    '',
  ]) assert.equal(localizeUrl(intact, FR), intact, intact);
  assert.equal(localizeUrl(null, FR), null);
  assert.equal(localizeUrl(undefined, FR), undefined);
});

test('sans reglage, la France : c\'est le defaut du depot', () => {
  assert.equal(localizeUrl('https://www.gog.com/en/game/x'), 'https://www.gog.com/fr/game/x');
  assert.equal(localizeUrl('https://luna.amazon.com/claims/home'), 'https://luna.amazon.fr/claims/home');
});

/* ---------------------------------------------- parite avec la copie du moteur */

const ADRESSES = [
  'https://store.epicgames.com/p/hades',
  'https://store.epicgames.com/en-US/p/hades',
  'https://store.epicgames.com/fr/p/hades?x=1#h',
  'https://store.epicgames.com/free-games',
  'https://store.epicgames.com/bundles/x?lang=de',
  'https://store.epicgames.com/de/p/x',
  'https://store.epicgames.com/purchase?offers=1',
  'https://www.gog.com/en/game/hades',
  'https://www.gog.com/game/hades',
  'https://www.gog.com/redeem',
  'https://www.gog.com/',
  'https://www.gog.com/#giveaway',
  'https://www.gog.com/de/games?price=free',
  'https://www.gog.com/account',
  'https://gog.com/game/x',
  'https://luna.amazon.com/claims/home?filter=Game&g=s',
  'https://luna.amazon.fr/claims/abc/dp/amzn1.pg.item.1',
  'https://luna.amazon.de/claims',
  'https://luna.amazon.com/library',
  'https://store.steampowered.com/app/10/?l=english',
  'http://www.gog.com/game/x',
  'https://example.com/',
];
const REGLAGES = [
  ['FR', 'fr'], ['BE', 'fr'], ['CH', 'fr'], ['CA', 'en'], ['US', 'en'], ['GB', 'en'],
  ['DE', 'de'], ['ES', 'es'], ['IT', 'it'], ['PT', 'pt'], ['NL', 'nl'], ['PL', 'pl'],
];

test('le moteur et le module rendent exactement la meme adresse', () => {
  for (const [country, lang] of REGLAGES) {
    for (const lunaHost of [null, 'luna.amazon.com', 'luna.amazon.co.uk']) {
      const { fgc, gmStore } = loadEngine();
      gmStore.set(KEY_COUNTRY, country);
      gmStore.set(KEY_LANG, lang);
      if (lunaHost) gmStore.set(KEY_LUNA_HOST, lunaHost);
      for (const forClaim of [false, true]) {
        for (const adresse of ADRESSES) {
          assert.equal(
            fgc.localizeStoreUrl(adresse, forClaim),
            localizeUrl(adresse, { country, lang, lunaHost, forClaim }),
            `${country}/${lang} luna=${lunaHost} claim=${forClaim} : ${adresse}`,
          );
        }
      }
    }
  }
});

test('le moteur ne retient un domaine Luna que sur un domaine Luna connu', () => {
  const luna = loadEngine({ hostname: 'luna.amazon.fr', pathname: '/claims/home' });
  assert.equal(luna.fgc.readLunaHost(), '');
  luna.fgc.rememberLunaHost();
  assert.equal(luna.gmStore.get(KEY_LUNA_HOST), 'luna.amazon.fr');
  assert.equal(luna.fgc.readLunaHost(), 'luna.amazon.fr');

  const autre = loadEngine({ hostname: 'www.gog.com', pathname: '/' });
  autre.fgc.rememberLunaHost();
  assert.equal(autre.gmStore.has(KEY_LUNA_HOST), false, 'GOG n\'est pas un domaine Luna');

  const faux = loadEngine({ hostname: 'luna.amazon.com.evil.example', pathname: '/claims' });
  faux.fgc.rememberLunaHost();
  assert.equal(faux.gmStore.has(KEY_LUNA_HOST), false);

  // Une valeur stockee invalide est ignoree, pas suivie.
  const mal = loadEngine();
  mal.gmStore.set(KEY_LUNA_HOST, 'evil.example');
  assert.equal(mal.fgc.readLunaHost(), '');
});

test('le moteur ouvre l\'echange GOG dans la langue du reglage', () => {
  const { fgc } = loadEngine();
  assert.equal(fgc.gogRedeemUrl(), 'https://www.gog.com/fr/redeem');
});

/* ------------------------------------------- le pont avec le stockage */

const stockage = (valeurs) => ({
  storage: { local: { get: async (cles) => Object.fromEntries(cles.filter((c) => c in valeurs).map((c) => [c, valeurs[c]])) } },
});

test('le reglage lu dans le stockage decide de la langue des adresses', async () => {
  const chrome = stockage({ [KEY_COUNTRY]: 'DE', [KEY_LANG]: 'de' });
  assert.deepEqual(await readLocale(chrome), { country: 'DE', lang: 'de', lunaHost: null });
  assert.equal(await localizeFor(chrome, 'https://www.gog.com/en/game/x'), 'https://www.gog.com/de/game/x');
  // Pour une page que le moteur va lire, l'allemand devient l'anglais.
  assert.equal(await localizeFor(chrome, 'https://store.epicgames.com/p/x', { forClaim: true }),
    'https://store.epicgames.com/p/x?lang=en');
});

test('un stockage vide donne la France, un stockage muet ne change rien', async () => {
  assert.equal(await localizeFor(stockage({}), 'https://www.gog.com/en/game/x'), 'https://www.gog.com/fr/game/x');
  assert.equal(await localizeFor({}, 'https://www.gog.com/en/game/x'), 'https://www.gog.com/en/game/x');
  assert.equal(await localizeFor(null, 'https://www.gog.com/en/game/x'), 'https://www.gog.com/en/game/x');
  const casse = { storage: { local: { get: async () => { throw new Error('mort'); } } } };
  assert.equal(await localizeFor(casse, 'https://www.gog.com/en/game/x'), 'https://www.gog.com/en/game/x');
});

test('la fenetre de reclamation s\'ouvre dans la langue du reglage', async () => {
  const ouvertes = [];
  const chrome = {
    ...stockage({ [KEY_COUNTRY]: 'FR', [KEY_LANG]: 'fr', [KEY_LUNA_HOST]: 'luna.amazon.com' }),
    windows: { create: async (o) => { ouvertes.push(o.url); return { id: 1, tabs: [{ id: 2 }] }; } },
  };
  await openHiddenTab(chrome, 'https://www.gog.com/en/game/x');
  await openHiddenTab(chrome, 'https://luna.amazon.fr/claims/home');
  await openHiddenTab(chrome, 'https://store.steampowered.com/app/10/?l=english');
  assert.deepEqual(ouvertes, [
    'https://www.gog.com/fr/game/x',
    'https://luna.amazon.com/claims/home', // la session vue ailleurs l'emporte
    'https://store.steampowered.com/app/10/?l=english', // Steam : jamais touche
  ]);
});

test('les liens d\'une page sont reecrits au clic, et seulement les liens https', async () => {
  const ecouteurs = {};
  const doc = { addEventListener: (type, fn, capture) => { ecouteurs[type] = { fn, capture }; } };
  const chrome = stockage({ [KEY_COUNTRY]: 'FR', [KEY_LANG]: 'fr' });
  const localize = installLinkLocalizer(chrome, doc);
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(Object.keys(ecouteurs).sort(), ['auxclick', 'click', 'contextmenu']);
  assert.ok(ecouteurs.click.capture, 'en capture : avant le gestionnaire de la page');

  const lien = (href) => {
    const a = { attrs: { href }, getAttribute: (n) => a.attrs[n], setAttribute: (n, v) => { a.attrs[n] = v; } };
    return { target: { closest: () => a }, a };
  };
  for (const type of ['click', 'auxclick', 'contextmenu']) {
    const ev = lien('https://www.gog.com/en/game/x');
    ecouteurs[type].fn(ev);
    assert.equal(ev.a.attrs.href, 'https://www.gog.com/fr/game/x', type);
  }
  const http = lien('http://www.gog.com/en/game/x');
  ecouteurs.click.fn(http);
  assert.equal(http.a.attrs.href, 'http://www.gog.com/en/game/x');
  const relatif = lien('pages/popup.html');
  ecouteurs.click.fn(relatif);
  assert.equal(relatif.a.attrs.href, 'pages/popup.html');
  ecouteurs.click.fn({ target: { closest: () => null } }); // pas un lien : rien, sans jeter
  ecouteurs.click.fn({ target: {} });
  ecouteurs.click.fn(null);

  assert.equal(localize('https://luna.amazon.com/claims/home'), 'https://luna.amazon.fr/claims/home');
});

test('avant la lecture du reglage, un lien part tel quel', () => {
  const chrome = { storage: { local: { get: () => new Promise(() => {}) } } };
  const localize = installLinkLocalizer(chrome, null);
  assert.equal(localize('https://www.gog.com/en/game/x'), 'https://www.gog.com/en/game/x');
});

/* ------------------------------------- la copie Kotlin de l'appli Android */

/* L'appli tient sa propre copie (android/.../sources/Localize.kt). Elle est
   gardee par une table d'or : ce test la regenere depuis le module JS et la
   compare au fichier que le test Kotlin relit. Une divergence est un echec
   ICI, tout de suite -- pas un jeu qui s'ouvre en anglais sur un telephone.
   Pour la regenerer apres un changement voulu : UPDATE_GOLDEN=1 npm test. */
const OR = new URL('../android/app/src/test/resources/localize-golden.tsv', import.meta.url);
const OR_ADRESSES = [
  'https://store.epicgames.com/p/hades',
  'https://store.epicgames.com/en-US/p/hades',
  'https://store.epicgames.com/fr/p/hades?x=1#h',
  'https://store.epicgames.com/free-games',
  'https://store.epicgames.com/bundles/x?lang=de',
  'https://store.epicgames.com/de/p/x',
  'https://www.gog.com/en/game/hades',
  'https://www.gog.com/game/hades',
  'https://www.gog.com/redeem',
  'https://www.gog.com/',
  'https://www.gog.com/#giveaway',
  'https://www.gog.com/de/games?price=free',
  'https://www.gog.com/account',
  'https://luna.amazon.com/claims/home?filter=Game&g=s',
  'https://luna.amazon.fr/claims/abc/dp/amzn1.pg.item.1',
  'https://luna.amazon.com/library',
  'https://store.steampowered.com/app/10/?l=english',
  'http://www.gog.com/game/x',
  'https://example.com/en/game/x',
];
const OR_REGLAGES = [['FR', 'fr'], ['BE', 'fr'], ['DE', 'de'], ['ES', 'es'], ['US', 'en'], ['GB', 'en'], ['NL', 'nl']];

test('la table d\'or de l\'appli Android est celle du module JS', () => {
  const lignes = [];
  for (const [country, lang] of OR_REGLAGES) {
    for (const forClaim of [false, true]) {
      for (const adresse of OR_ADRESSES) {
        lignes.push([country, forClaim, adresse, localizeUrl(adresse, { country, lang, forClaim })].join('\t'));
      }
    }
  }
  const attendu = `${lignes.join('\n')}\n`;
  if (process.env.UPDATE_GOLDEN) writeFileSync(OR, attendu);
  assert.equal(readFileSync(OR, 'utf-8'), attendu,
    'android/app/src/test/resources/localize-golden.tsv est perime : UPDATE_GOLDEN=1 npm test, puis relancer le test Kotlin');
});
