/* La mesure V8 : ou Epic expose-t-il ses jeux mobiles gratuits ? (2.56.0)
 *
 * Rien n'est encore ecrit pour les lire : la regle du depot veut qu'une
 * hypothese se mesure avant de s'ecrire. Ces tests tiennent l'ANALYSE de la
 * mesure -- ce qu'elle voit dans une reponse, et ce qu'elle en conclut --
 * pour que le rapport qu'on relira dise vrai.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOBILE_WORDS, findHints, promoElements, summariseElements, compareTitles, summariseUnknown, mobileVerdict,
} from '../watch/epic-mobile.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const CAPTURE = JSON.parse(lire('test/fixtures/epic-freegames.json'));
const LE_27_AOUT = Date.parse('2026-08-27T12:00:00Z');

/* ------------------------------------------------------------ les mots */

test('les mots mobiles, sans faux amis', () => {
  for (const vrai of ['Mobile', 'freegames/mobile', 'Android', 'iOS', 'iPhone', 'Google Play', 'App Store']) {
    assert.ok(MOBILE_WORDS.test(vrai), vrai);
  }
  for (const faux of ['automobile', 'Studios', 'Mobilier', 'Android2']) {
    assert.ok(!MOBILE_WORDS.test(faux), faux);
  }
});

test('les indices : le chemin des cles et des valeurs, borne', () => {
  const el = {
    title: 'Jeu',
    categories: [{ path: 'freegames' }, { path: 'freegames/mobile' }],
    customAttributes: [{ key: 'com.epicgames.app.platform', value: 'Android' }],
    mobileOnly: true,
    isIOS: false,
  };
  assert.deepEqual(findHints(el), [
    { path: 'categories[1].path', value: 'freegames/mobile' },
    { path: 'customAttributes[0].value', value: 'Android' },
    { path: 'mobileOnly', value: 'true' },
    { path: 'isIOS', value: 'false' },
  ]);
  const beaucoup = { liste: Array.from({ length: 100 }, () => 'android') };
  assert.equal(findHints(beaucoup, { limit: 5 }).length, 5);
});

/* ------------------------------------------------------------ l'API deja lue */

test('la vraie capture d\'Epic : douze offres, aucune ne parle de mobile', () => {
  const els = promoElements(CAPTURE);
  assert.equal(els.length, 12);
  const resume = summariseElements(els, LE_27_AOUT);
  assert.equal(resume.filter((e) => e.mobile.length).length, 0);

  const carte = resume.find((e) => e.title === 'Cardpocalypse Standard Edition');
  assert.equal(carte.freeNow, true);
  assert.equal(carte.offerType, 'BASE_GAME');
  assert.ok(carte.categories.includes('freegames'));
  assert.ok(carte.attributes.length > 0);
  assert.equal(resume.find((e) => e.title === 'Breathedge').upcoming, true);
});

test('une reponse dont la forme a change ne passe pas pour une liste vide', () => {
  assert.equal(promoElements({ data: { Catalog: {} } }), null);
  assert.equal(promoElements(null), null);
  assert.deepEqual(promoElements({ data: { Catalog: { searchStore: { elements: [] } } } }), []);
});

test('le filtre de plateforme : ce que chaque reponse a en propre', () => {
  assert.deepEqual(compareTitles(['A', 'B', 'C'], ['B', 'C', 'D']), { onlyFirst: ['A'], onlySecond: ['D'], same: 2 });
});

/* ------------------------------------------------------------ une API inconnue */

test('une reponse inconnue : sa forme, ses objets titres, ou elle parle de gratuite', () => {
  const decouverte = {
    data: {
      modules: [
        { type: 'freeGames', title: 'Free Games', offers: [
          { title: 'Offre X', price: { discountPrice: 0 }, platforms: ['android'] },
        ] },
      ],
    },
  };
  const s = summariseUnknown(decouverte);
  assert.match(s.shape, /^\{data: \{modules: \[1 x/);
  assert.deepEqual(s.titled.map((t) => [t.path, t.title]), [
    ['data.modules[0]', 'Free Games'],
    ['data.modules[0].offers[0]', 'Offre X'],
  ]);
  assert.ok(s.free.some((h) => h.value === 'Free Games'));
  assert.ok(s.free.some((h) => /discountPrice$/.test(h.path)));
  assert.deepEqual(s.mobile, [{ path: 'data.modules[0].offers[0].platforms[0]', value: 'android' }]);
});

/* ------------------------------------------------------------ le verdict */

const lu = (elements) => ({ ok: true, elements });
const offre = (title, mobile = []) => ({ title, mobile });

test('le verdict : l\'API deja lue les distingue', () => {
  const v = mobileVerdict({ promo: lu([offre('PC'), offre('Mobile', [{ path: 'categories[1].path', value: 'freegames/mobile' }])]) });
  assert.equal(v.level, 'ok');
  assert.match(v.detail, /Mobile/);
});

test('le verdict : le filtre de plateforme change la reponse', () => {
  const v = mobileVerdict({
    promo: lu([offre('PC')]),
    platforms: [{ platform: 'android', ok: true, diff: { onlyFirst: [], onlySecond: ['Jeu Android'], same: 1 } }],
  });
  assert.equal(v.level, 'ok');
  assert.match(v.detail, /platform=android : Jeu Android/);
});

test('le verdict : seule l\'API de decouverte repond', () => {
  const v = mobileVerdict({
    promo: lu([offre('PC')]),
    platforms: [{ platform: 'android', ok: true, diff: { onlyFirst: [], onlySecond: [], same: 1 } }],
    discover: [{ platform: 'android', ok: true, status: 200, summary: { free: [{}], titled: [], mobile: [] } }],
  });
  assert.equal(v.level, 'warn');
  assert.match(v.title, /decouverte/);
});

test('le verdict : une lecture qui echoue ne conclut rien', () => {
  const v = mobileVerdict({ promo: { ok: false }, discover: [{ ok: false }] });
  assert.equal(v.level, 'ko');
  assert.match(v.detail, /relancer/);
});

test('le verdict : rien nulle part, ou seulement dans la page', () => {
  const rien = mobileVerdict({ promo: lu([offre('PC')]), discover: [{ ok: true, status: 404 }] });
  assert.equal(rien.level, 'warn');
  assert.match(rien.detail, /Ni les API ni la page/);
  const page = mobileVerdict({ promo: lu([offre('PC')]), discover: [], page: { ok: true, matchesRaw: { motMobile: true } } });
  assert.match(page.detail, /Seule la page/);
});

/* ------------------------------------------------------------ la page de diagnostic */

test('la mesure est branchee, lit sans cookies, et reste sur des hotes deja declares', () => {
  const js = lire('pages/diagnostics.js');
  const html = lire('pages/diagnostics.html');
  assert.match(js, /from '\.\.\/watch\/epic-mobile\.js'/);
  assert.match(js, /fetch\(url, \{ credentials: 'omit', cache: 'no-store' \}\)/);
  assert.match(js, /\$\('mobile-run'\)\.addEventListener\('click', lancerMobile\)/);
  assert.match(js, /## V8 -- jeux mobiles Epic/);
  for (const id of ['mobile-run', 'mobile-state', 'm-promo', 'm-plateformes', 'm-decouverte', 'm-page', 'm-verdict']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  const manifeste = JSON.parse(lire('manifest.json'));
  assert.ok(manifeste.host_permissions.includes('https://*.epicgames.com/*'), 'egs-platform-service.store.epicgames.com est deja couvert');
  assert.match(js, /https:\/\/egs-platform-service\.store\.epicgames\.com\//);
});
