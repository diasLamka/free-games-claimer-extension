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

/* ------------------------------ la langue de la page n'est pas celle de l'API */

/* Le moteur choisit ses boutons par ce qui est ECRIT dessus (2.18.0), et ses
 * motifs ne lisent que quelques langues. La 2.20.0 envoyait la langue du pays
 * jusque dans l'URL des fiches -- et ce fichier le TESTAIT : « regle sur
 * l'Allemagne, l'URL finit par lang=de ». C'etait le bug, ecrit comme une
 * promesse. Le moteur ouvrait des pages en allemand, ou aucun motif ne
 * reconnait un bouton : aucun clic, donc aucun danger -- mais plus aucune
 * reclamation non plus. */

test('regle sur l\'Allemagne, la fiche s\'ouvre dans une langue que le moteur lit', () => {
  const fgc = moteur('DE', 'de');
  assert.equal(fgc.getEpicPageLang(), 'en');
  assert.ok(fgc.epicStoreUrl('/p/un-jeu').endsWith('?lang=en'), fgc.epicStoreUrl('/p/un-jeu'));
  /* L'API, elle, garde la langue du pays : les titres affiches restent en
     allemand. Le moteur retrouve ses cartes par le slug, jamais par le titre,
     donc une API et une page dans deux langues ne se genent pas. */
  assert.ok(fgc.getEpicApiUrls()[0].includes('locale=de-DE'));
});

test('pays par pays, aucune fiche ne s\'ouvre dans une langue que le moteur ne lit pas', () => {
  for (const [code, info] of Object.entries(COUNTRIES)) {
    const fgc = moteur(code, info.lang);
    const lisibles = Array.from(fgc.CONFIG.epicReadableLangs);
    const page = fgc.getEpicPageLang();

    assert.ok(lisibles.includes(page), `${code} ouvre ses fiches en « ${page} »`);
    assert.ok(fgc.epicStoreUrl('/p/un-jeu').endsWith(`lang=${page}`), code);
    /* Une langue lisible est gardee telle quelle : un Suisse romand lit ses
       fiches en francais, un Americain en anglais. Seules les autres tombent
       sur le repli. */
    if (lisibles.includes(info.lang)) assert.equal(page, info.lang, code);
    else assert.equal(page, fgc.CONFIG.epicFallbackPageLang, code);
  }
});

test('une langue vide reste vide : Epic choisit, comme le permet CONFIG', () => {
  /* `epicLang: ''` est le « laisser Epic choisir » documente dans CONFIG. Sans
     la garde de getEpicPageLang, la chaine vide -- absente de la liste des
     langues lisibles -- serait devenue « en » en silence. */
  const fgc = moteur();
  fgc.CONFIG.epicLang = '';
  assert.equal(fgc.getEpicPageLang(), '');
  assert.equal(fgc.epicStoreUrl('/free-games'), 'https://store.epicgames.com/free-games');
});

/* Ce que le moteur doit savoir lire, etape par etape, dans chaque langue qu'il
 * declare lisible.
 *
 * Le francais vient des captures reelles (2026-08-27 et 2026-09-17, voir le
 * CHANGELOG de la 2.12.1 a la 2.16.2). L'anglais n'a AUCUNE capture dans ce
 * depot : ses libelles sont ceux que les motifs du moteur portent. Cette table
 * ne prouve donc pas que l'anglais marche. Elle interdit deux choses : qu'une
 * langue soit declaree lisible sans libelle pour chaque etape, et qu'un motif
 * retreci perde en silence un libelle connu. */
const LIBELLES = {
  fr: {
    cta: ['Obtenir', 'Ajouter au panier'],
    commande: ['Ajouter à la bibliothèque', 'Valider la commande'],
    accord: ['J\'accepte', 'J’accepte'],
    possede: ['Dans la bibliothèque'],
  },
  en: {
    cta: ['Get', 'Add To Cart'],
    commande: ['Place Order'],
    accord: ['I Agree'],
    possede: ['In Library'],
  },
};

test('une langue n\'est declaree lisible qu\'avec ses libelles, a chaque etape', () => {
  const fgc = moteur();
  const etapes = {
    cta: fgc.EPIC_MAIN_CTA_PATTERNS,
    commande: fgc.EPIC_LIBRARY_PATTERNS,
    accord: fgc.EPIC_AGREE_PATTERNS,
    possede: fgc.EPIC_OWNERSHIP_PATTERNS,
  };
  const lisibles = Array.from(fgc.CONFIG.epicReadableLangs);
  assert.ok(lisibles.includes(fgc.CONFIG.epicFallbackPageLang), 'le repli doit etre lui-meme une langue lisible');

  for (const lang of lisibles) {
    assert.ok(LIBELLES[lang], `« ${lang} » est declaree lisible sans aucun libelle : mesurer la vraie page d'abord`);
    for (const [etape, motifs] of Object.entries(etapes)) {
      const libelles = LIBELLES[lang][etape] || [];
      assert.ok(libelles.length, `« ${lang} » : aucun libelle pour l'etape « ${etape} »`);
      for (const libelle of libelles) {
        assert.ok(Array.from(motifs).some((m) => m.test(libelle)),
          `« ${lang} » : « ${libelle} » (${etape}) n'est reconnu par aucun motif`);
      }
    }
  }
});

/* --------------------------------------------- la devise suit le pays */

test('la devise visee par la conversion suit le pays, pas l\'euro en dur', () => {
  assert.equal(currencyFor('FR'), 'EUR');
  assert.equal(currencyFor('CH'), 'CHF');
  assert.equal(currencyFor('US'), 'USD');
  assert.equal(currencyFor('GB'), 'GBP');
  assert.equal(ratesUrl('CHF'), 'https://api.frankfurter.dev/v1/latest?from=CHF');
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
