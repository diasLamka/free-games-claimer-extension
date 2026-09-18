/* Un seul reglage de pays, trois lecteurs, aucune recopie.
 *
 * `locale=fr-FR&country=FR&allowCountries=FR` etait ecrit a deux endroits --
 * `watch/sources/epic.js` et `src/core/01-config.js` -- et le reglage de langue
 * de l'interface ne touchait ni l'un ni l'autre. Un utilisateur belge, suisse
 * ou canadien lisait des prix francais.
 *
 * La duplication ne peut pas disparaitre : le moteur est en ES5 concatene dans
 * une IIFE et tourne aussi en userscript, sans `chrome.storage` ni modules. Ce
 * fichier tient donc la meme promesse que `test/epic-parite.test.mjs` pour les
 * slugs : les deux implementations rendent EXACTEMENT la meme chose sur les
 * memes entrees.
 *
 * Et ce que le reglage ne fait pas est teste aussi : GOG et GamerPower
 * n'acceptent aucun parametre de pays, et leurs sources ignorent ces valeurs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  DEFAULT_LANG,
  KEY_COUNTRY,
  KEY_LANG,
  currencyFor,
  epicApiUrls,
  localeTag,
  normaliseCountry,
  normaliseLang,
} from '../watch/locale.js';
import { discover as discoverEpic, API_URLS } from '../watch/sources/epic.js';
import { discover as discoverGog } from '../watch/sources/gog.js';
import { baseOf, ratesUrl, refreshRates, toBase } from '../watch/rates.js';

/* ------------------------------------------------------------ le defaut */

test('sans rien de choisi, c\'est la France, comme avant', () => {
  assert.equal(normaliseCountry(null), 'FR');
  assert.equal(normaliseLang(null, null), 'fr');
  assert.equal(localeTag(null, null), 'fr-FR');
  assert.equal(currencyFor(null), 'EUR');
  assert.deepEqual(epicApiUrls(null, null), [...API_URLS]);
  assert.ok(API_URLS[0].includes('locale=fr-FR&country=FR&allowCountries=FR'));
});

test('un pays inconnu ne devient jamais une devise inventee', () => {
  /* Accepter un code quelconque obligerait a DEVINER sa devise, et un montant
     converti dans une devise devinee serait un chiffre invente. */
  for (const bidon of ['ZZ', '', null, 'FRANCE', 42, 'fr-fr']) {
    assert.equal(normaliseCountry(bidon), DEFAULT_COUNTRY, `accepte a tort : ${bidon}`);
  }
  assert.equal(normaliseCountry('be'), 'BE', 'la casse ne doit pas decider');
  assert.equal(normaliseCountry(' CH '), 'CH');
});

test('la langue suit le pays quand elle n\'est pas imposee', () => {
  assert.equal(normaliseLang('auto', 'US'), 'en', '« auto » veut dire la langue du pays');
  assert.equal(normaliseLang(null, 'DE'), 'de');
  assert.equal(normaliseLang('fr', 'US'), 'fr', 'une langue explicite l\'emporte');
  assert.equal(normaliseLang('', null), DEFAULT_LANG);
});

test('chaque pays propose porte une langue et une devise', () => {
  for (const [code, info] of Object.entries(COUNTRIES)) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.match(info.lang, /^[a-z]{2}$/);
    assert.match(info.currency, /^[A-Z]{3}$/);
    assert.ok(info.label, `${code} sans etiquette`);
  }
});

/* ------------------------------------------------------ l'URL construite */

test('le pays choisi commande les trois parametres de l\'URL Epic', () => {
  const [premier, second] = epicApiUrls('CH', null);

  assert.ok(premier.includes('locale=fr-CH'));
  assert.ok(premier.includes('country=CH'));
  assert.ok(premier.includes('allowCountries=CH'));
  /* Les deux hotes restent servis : le second est la voie IPv4 pure, utile
     quand la resolution IPv6 echoue chez certains fournisseurs. */
  assert.ok(second.includes('ipv4'));
  assert.ok(second.includes('country=CH'));
});

test('la source Epic construit son URL depuis le pays recu', async () => {
  const vues = [];
  const reponse = {
    ok: true,
    status: 200,
    json: async () => ({ data: { Catalog: { searchStore: { elements: [] } } } }),
  };

  await discoverEpic({
    fetch: async (url) => { vues.push(url); return reponse; },
    now: Date.now(),
    country: 'US',
    lang: null,
  });

  assert.equal(vues.length, 1);
  assert.ok(vues[0].includes('locale=en-US'), vues[0]);
  assert.ok(vues[0].includes('country=US'));
});

test('sans pays, la source Epic garde exactement l\'URL d\'avant', async () => {
  const vues = [];
  await discoverEpic({
    fetch: async (url) => {
      vues.push(url);
      return { ok: true, status: 200, json: async () => ({ data: { Catalog: { searchStore: { elements: [] } } } }) };
    },
    now: Date.now(),
  });
  assert.equal(vues[0], API_URLS[0]);
});

test('GOG ignore le pays, parce que GOG n\'en accepte aucun', async () => {
  const vues = [];
  await discoverGog({
    fetch: async (url) => { vues.push(url); return { ok: true, status: 200, json: async () => ({ products: [], page: 1, totalPages: 1 }) }; },
    now: Date.now(),
    country: 'US',
    lang: 'en',
  });

  assert.equal(vues.length, 1);
  assert.ok(!vues[0].includes('country='), vues[0]);
  assert.ok(!vues[0].includes('locale='), vues[0]);
});

/* -------------------------------------------- la parite avec le moteur ES5 */

/* Le moteur tourne dans un contexte `vm` : ses tableaux n'ont pas le meme
   prototype que les notres, et une comparaison de structure echouerait sur la
   seule difference de realm. On compare donc ce qui compte -- les chaines. */
const memesUrls = (a, b, message) => assert.equal(a.join(' | '), b.join(' | '), message);

/** Le moteur, charge avec un pays deja ecrit dans son stockage. */
function moteur(country, lang) {
  const { fgc, gmStore } = loadEngine();
  if (country !== undefined) gmStore.set(KEY_COUNTRY, country);
  if (lang !== undefined) gmStore.set(KEY_LANG, lang);
  return fgc;
}

test('moteur et veille construisent la MEME URL, pays par pays', () => {
  for (const code of Object.keys(COUNTRIES)) {
    const lang = COUNTRIES[code].lang;
    const fgc = moteur(code, lang);
    memesUrls(fgc.getEpicApiUrls(), epicApiUrls(code, lang), `divergence sur ${code}`);
  }
});

test('le moteur retombe sur le defaut cable quand le stockage est vide', () => {
  const fgc = moteur(undefined, undefined);
  assert.equal(fgc.getEpicCountry(), DEFAULT_COUNTRY);
  assert.equal(fgc.getEpicLang(), DEFAULT_LANG);
  memesUrls(fgc.getEpicApiUrls(), [...API_URLS]);
});

test('le moteur refuse une valeur qui n\'a pas la forme d\'un code', () => {
  /* Le moteur ne porte pas la table des pays -- c'est le popup qui borne le
     choix. Il verifie donc la FORME, et retombe sur le defaut sinon. */
  const fgc = moteur('FRANCE', 'francais');
  assert.equal(fgc.getEpicCountry(), DEFAULT_COUNTRY);
  assert.equal(fgc.getEpicLang(), DEFAULT_LANG);
});

test('la langue de la boutique suit le reglage jusque dans l\'URL d\'une fiche', () => {
  const fgc = moteur('DE', 'de');
  assert.ok(fgc.epicStoreUrl('/p/un-jeu').endsWith('lang=de'));
});

/* --------------------------------------------- la devise suit le pays */

test('la devise visee par la conversion suit le pays, pas l\'euro en dur', () => {
  assert.equal(currencyFor('FR'), 'EUR');
  assert.equal(currencyFor('CH'), 'CHF');
  assert.equal(currencyFor('US'), 'USD');
  assert.equal(currencyFor('GB'), 'GBP');
  assert.equal(ratesUrl('CHF'), 'https://api.frankfurter.app/latest?from=CHF');
});

test('convertir vise la base de la table, quelle qu\'elle soit', () => {
  const enFrancs = { base: 'CHF', date: '2026-09-18', rates: { EUR: 1.05, USD: 1.2 }, fetchedAt: Date.now() };
  assert.equal(baseOf(enFrancs), 'CHF');
  assert.equal(toBase(21, 'CHF', enFrancs, Date.now()), 21, 'la devise de base n\'est pas convertie');
  assert.equal(toBase(1.2, 'USD', enFrancs, Date.now()), 1);
  /* Et ce qu'on ne sait pas convertir reste null : jamais un chiffre invente. */
  assert.equal(toBase(10, 'JPY', enFrancs, Date.now()), null);
});

test('un changement de pays fait redemander le taux avant l\'heure', async () => {
  const frais = { base: 'EUR', date: '2026-09-18', rates: { USD: 1.1 }, fetchedAt: 1000 };
  const vues = [];
  const fetchImpl = async (url) => {
    vues.push(url);
    return { ok: true, status: 200, json: async () => ({ base: 'CHF', date: '2026-09-18', rates: { EUR: 1.05 } }) };
  };

  /* Meme base : rien a faire, la table est fraiche. */
  const rien = await refreshRates({ now: 2000, stored: frais, fetch: fetchImpl, base: 'EUR' });
  assert.equal(rien.changed, false);
  assert.equal(vues.length, 0);

  /* Base differente : la table ne sait plus convertir vers la bonne devise,
     meme fraiche. C'est le seul cas ou l'on redemande avant l'heure. */
  const rebase = await refreshRates({ now: 2000, stored: frais, fetch: fetchImpl, base: 'CHF' });
  assert.equal(rebase.changed, true);
  assert.equal(baseOf(rebase.rates), 'CHF');
  assert.equal(vues[0], ratesUrl('CHF'));
});
