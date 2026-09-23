/* Parite entre le moteur (ES5, src/core) et la source de veille (ESM,
 * watch/sources/epic.js).
 *
 * Les deux resolvent les slugs Epic et decident quelles promotions sont
 * actives. La logique est dupliquee, volontairement : le moteur vit dans une
 * IIFE ES5 concatenee, la veille en modules ESM, et les rapprocher couterait
 * plus cher que ce test ne coute.
 *
 * Ce fichier est le contrat qui rend la duplication sure. Il tourne sur une
 * CAPTURE REELLE de l'API (test/fixtures/epic-freegames.json, 2026-08-27) plus
 * des cas limites construits a la main. Si les deux implementations divergent
 * d'un slug ou d'une decision, il casse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEngine } from './harness.mjs';
import * as epic from '../watch/sources/epic.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const capture = JSON.parse(readFileSync(join(ICI, 'fixtures', 'epic-freegames.json'), 'utf8'));
const ELEMENTS = capture.data.Catalog.searchStore.elements;

const { fgc } = loadEngine();

/* Instant de la capture : deux offres etaient actives. */
const T_CAPTURE = Date.UTC(2026, 7, 27, 10, 0, 0);

/* --------------------------------------------------- la capture est valide */

test('la fixture est une vraie reponse d\'API exploitable', () => {
  assert.ok(Array.isArray(ELEMENTS));
  assert.ok(ELEMENTS.length >= 10, `${ELEMENTS.length} elements`);
  // Le cas qui a motive le correctif v2.3.0 doit etre present, sinon la
  // fixture ne protege plus contre la regression qu'elle est censee couvrir.
  const cardpo = ELEMENTS.find((e) => e.title && e.title.startsWith('Cardpocalypse'));
  assert.ok(cardpo, 'Cardpocalypse absent de la capture');
  assert.equal(cardpo.productSlug, 'cardpocalypse/home');
  assert.equal(cardpo.offerMappings[0].pageSlug, 'cardpocalypse');
});

/* ------------------------------------------------------------ parite slugs */

test('normaliserSlug : parite sur les cas limites', () => {
  const cas = [
    'cardpocalypse/home',
    '/Cardpocalypse/',
    'cardpocalypse?lang=fr',
    'cardpocalypse#ancre',
    '  cardpocalypse  ',
    '[]',
    '',
    '3f18c54a6e00424b8c0f2b3d4e5f6a7b',
    '3f18c54a6e00424ba6e8f4',          // 22 hex : pas 32, donc accepte
    'Un Titre !',
    'jeu.avec-points_et-tirets',
    '-commence-par-un-tiret',
    null,
    undefined,
  ];
  for (const c of cas) {
    assert.equal(
      epic.normaliseSlug(c),
      fgc.normalizeEpicSlug(c),
      `divergence sur ${JSON.stringify(c)}`,
    );
  }
});

test('resoudreSlug : parite sur toute la capture reelle', () => {
  for (const el of ELEMENTS) {
    assert.equal(
      epic.resolveSlug(el),
      fgc.resolveEpicSlug(el),
      `divergence de slug sur "${el.title}"`,
    );
  }
});

test('resoudreSlug : parite sur les priorites construites a la main', () => {
  const cas = [
    { offerMappings: [{ pageSlug: 'a' }], catalogNs: { mappings: [{ pageSlug: 'b' }] }, productSlug: 'c', urlSlug: 'd' },
    { offerMappings: [], catalogNs: { mappings: [{ pageSlug: 'b' }] }, productSlug: 'c' },
    { productSlug: 'cardpocalypse/home' },
    { urlSlug: 'dernier-recours' },
    { offerMappings: [{ pageSlug: '[]' }], productSlug: '3f18c54a6e00424b8c0f2b3d4e5f6a7b', urlSlug: 'le-bon' },
    { productSlug: '[]', urlSlug: '[]' },
    { offerMappings: [null], catalogNs: null, productSlug: null, urlSlug: null },
    {},
    null,
  ];
  for (const el of cas) {
    assert.equal(
      epic.resolveSlug(el),
      fgc.resolveEpicSlug(el),
      `divergence sur ${JSON.stringify(el)}`,
    );
  }
});

/* ------------------------------------------------------ parite promotions */

test('promoActiveMaintenant : parite sur la capture, a plusieurs instants', () => {
  // Trois instants : avant la fenetre en cours, pendant, et apres. Chacun
  // change la reponse attendue, donc chacun teste vraiment quelque chose.
  const instants = [
    Date.UTC(2026, 7, 19, 12, 0, 0),
    T_CAPTURE,
    Date.UTC(2026, 8, 5, 12, 0, 0),
  ];
  for (const t of instants) {
    for (const el of ELEMENTS) {
      assert.equal(
        epic.promoActiveNow(el, t),
        fgc.isEpicPromoActiveNow(el, t),
        `divergence sur "${el.title}" a ${new Date(t).toISOString()}`,
      );
    }
  }
});

test('promoActiveMaintenant : parite sur les cas limites de fenetre et de prix', () => {
  const window = (start, end, prix) => {
    const el = {
      title: 'test',
      promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: start, endDate: end }] }] },
    };
    if (prix !== undefined) el.price = { totalPrice: { discountPrice: prix } };
    return el;
  };
  const t = T_CAPTURE;
  const cas = [
    window('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 0),
    window('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 1999),
    window('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z'),
    window('2026-09-03T15:00:00.000Z', '2026-09-10T15:00:00.000Z', 0),  // a venir
    window('2026-08-06T15:00:00.000Z', '2026-08-13T15:00:00.000Z', 0),  // terminee
    window(null, null, 0),
    window('pas une date', 'pas une date', 0),
    { title: 'sans promotion' },
    { title: 'promotions nulles', promotions: null },
    null,
  ];
  for (const el of cas) {
    assert.equal(
      epic.promoActiveNow(el, t),
      fgc.isEpicPromoActiveNow(el, t),
      `divergence sur ${JSON.stringify(el)}`,
    );
  }
});

/* --------------------------------------------------------- parite des URL */

test('les URL construites sont identiques des deux cotes, sur la capture', () => {
  const attendues = fgc.mapEpicApiElements(ELEMENTS, T_CAPTURE);
  const { offers } = epic.mapElements(ELEMENTS, T_CAPTURE);

  assert.equal(offers.length, attendues.length, 'nombre d\'offres retenues different');

  for (let i = 0; i < attendues.length; i++) {
    assert.equal(offers[i].storeId, attendues[i].slug, `slug different a l'index ${i}`);
    assert.equal(offers[i].url, attendues[i].url, `url differente a l'index ${i}`);
    assert.equal(offers[i].title, attendues[i].title, `titre different a l'index ${i}`);
  }
});

test('la capture ne retient que le jeu offert, pas le cosmetique permanent', () => {
  const { offers, dropped } = epic.mapElements(ELEMENTS, T_CAPTURE);

  /* Deux offres passent la fenetre de promotion, une seule a quelque chose a
     garder. Le « Pack de Mage Epique » est a originalPrice 0 : gratuit pour
     tout le monde, en permanence, offerType ADD_ON. L'ouvrir consommait un
     onglet et une requete sur un vrai compte a chaque cycle. */
  assert.equal(offers.length, 1);
  assert.equal(offers[0].storeId, 'cardpocalypse');

  // Ecarte avec un motif, jamais en silence : si Epic changeait son flux, ce
  // journal serait le seul endroit ou on le verrait.
  const ecarte = dropped.find((d) => /Mage/.test(d.title || ''));
  assert.ok(ecarte, 'le pack permanent doit etre ecarte explicitement');
  assert.match(ecarte.reasonText, /permanence/);
  assert.equal(ecarte.offerType, 'ADD_ON');

  // Le correctif v2.3.0 : productSlug valait "cardpocalypse/home", offerMappings
  // donne le slug propre, et c'est lui qui doit gagner.
  assert.equal(offers[0].url, 'https://store.epicgames.com/p/cardpocalypse?lang=fr');
});

test('le prix d\'origine remonte, pour que le bilan puisse compter', () => {
  const { offers } = epic.mapElements(ELEMENTS, T_CAPTURE);
  // Il etait perdu : le bilan comptait les jeux Epic sans jamais savoir ce
  // qu'ils valaient.
  assert.match(offers[0].worth, /23,99/);
  assert.equal(offers[0].keepable, true);
});

test('les deux implementations s\'accordent sur ce qu\'il y a a garder', () => {
  // La parite compte : le moteur tourne dans la page, la veille en fond, et
  // seule cette assertion empeche l'un de reclamer ce que l'autre ecarte.
  for (const el of ELEMENTS) {
    assert.equal(
      fgc.isEpicFreeToKeep(el),
      epic.isFreeToKeep(el),
      `desaccord sur "${el.title}"`,
    );
  }
});

test('isFreeToKeep distingue les trois cas', () => {
  assert.equal(epic.isFreeToKeep({ price: { totalPrice: { originalPrice: 2399, discountPrice: 0 } } }), true);
  assert.equal(epic.isFreeToKeep({ price: { totalPrice: { originalPrice: 0, discountPrice: 0 } } }), false);
  assert.equal(epic.isFreeToKeep({ price: { totalPrice: { originalPrice: 2399, discountPrice: 2399 } } }), false);
  // Sans prix, on ne devine pas : null, et le filtre laisse passer.
  assert.equal(epic.isFreeToKeep({}), null);
  assert.equal(epic.isFreeToKeep({ price: { totalPrice: {} } }), null);
});

/* -------------------------------------------- ce que la veille ajoute seule */

test('les bornes de la fenetre active sont extraites', () => {
  const { offers } = epic.mapElements(ELEMENTS, T_CAPTURE);
  const cardpo = offers.find((o) => o.storeId === 'cardpocalypse');
  assert.equal(cardpo.start, Date.parse('2026-08-20T15:00:00.000Z'));
  assert.equal(cardpo.end, Date.parse('2026-08-27T15:00:00.000Z'));
});

test('les prochaines ouvertures annoncees par Epic sont lues et triees', () => {
  const then = epic.nextWindows(ELEMENTS, T_CAPTURE);
  assert.ok(then.length >= 5, `${then.length} fenetres a venir`);

  // Triees du plus proche au plus lointain, et toutes dans le futur.
  for (let i = 1; i < then.length; i++) {
    assert.ok(then[i - 1].start <= then[i].start, 'fenetres non triees');
  }
  assert.ok(then[0].start > T_CAPTURE);

  // La premiere ouverture de la capture : 2026-08-27T15:00Z.
  assert.equal(then[0].start, Date.parse('2026-08-27T15:00:00.000Z'));
});

test('toutes les ouvertures Epic ne tombent pas a 11:00 heure de New York', () => {
  // C'est la raison pour laquelle l'ordonnanceur lit l'API plutot que
  // d'appliquer un calendrier ecrit a la main.
  const heuresUtc = new Set(
    epic.nextWindows(ELEMENTS, T_CAPTURE).map((f) => new Date(f.start).getUTCHours()),
  );
  assert.ok(heuresUtc.size > 1, `une seule heure d'ouverture : ${[...heuresUtc]}`);
});

test('la vignette est extraite de la capture reelle, par ordre de preference', () => {
  const { offers } = epic.mapElements(ELEMENTS, T_CAPTURE);
  for (const o of offers) {
    assert.ok(o.image, `aucune vignette pour "${o.title}"`);
    assert.match(o.image, /^https:\/\//);
  }

  // L'ordre de preference est explicite, pas l'ordre du tableau de l'API.
  const el = {
    keyImages: [
      { type: 'OfferImageTall', url: 'https://x.test/tall' },
      { type: 'Thumbnail', url: 'https://x.test/thumb' },
      { type: 'OfferImageWide', url: 'https://x.test/wide' },
    ],
  };
  assert.equal(epic.offerImage(el), 'https://x.test/thumb');
  assert.equal(epic.offerImage({ keyImages: [{ type: 'Inconnu', url: 'https://x.test/z' }] }), 'https://x.test/z');
  assert.equal(epic.offerImage({ keyImages: [] }), null);
  assert.equal(epic.offerImage(null), null);
});

test('les fenetres a venir portent titre et vignette, pour l\'affichage', () => {
  const then = epic.nextWindows(ELEMENTS, T_CAPTURE);
  assert.ok(then.length > 0);
  for (const f of then) {
    assert.ok(f.title, 'fenetre sans titre : le popup ne pourrait rien montrer');
    assert.equal(typeof f.start, 'number');
  }
});

test('fenetresAVenir ignore une ouverture deja passee', () => {
  const el = {
    title: 'x',
    promotions: {
      upcomingPromotionalOffers: [{
        promotionalOffers: [
          { startDate: '2026-08-01T15:00:00.000Z', endDate: '2026-08-08T15:00:00.000Z' },
          { startDate: '2026-09-01T15:00:00.000Z', endDate: '2026-09-08T15:00:00.000Z' },
        ],
      }],
    },
  };
  const f = epic.upcomingWindows(el, T_CAPTURE);
  assert.equal(f.length, 1);
  assert.equal(f[0].start, Date.parse('2026-09-01T15:00:00.000Z'));
});

/* ------------------------------------------------------------- decouverte */

test('decouvrir bascule sur le second hote quand le premier echoue', async () => {
  const appels = [];
  const faussefetch = async (url) => {
    appels.push(url);
    if (appels.length === 1) throw new Error('ENOTFOUND');
    return { ok: true, status: 200, json: async () => capture };
  };

  const res = await epic.discover({ fetch: faussefetch, now: T_CAPTURE });
  assert.equal(appels.length, 2);
  assert.equal(res.usedUrl, epic.API_URLS[1]);
  assert.equal(res.offers.length, 1);
  assert.equal(res.errors.length, 1);
});

test('decouvrir ne jette jamais : elle rend les erreurs', async () => {
  const res = await epic.discover({
    fetch: async () => { throw new Error('reseau coupe'); },
    now: T_CAPTURE,
  });
  assert.equal(res.offers.length, 0);
  assert.equal(res.usedUrl, null);
  assert.equal(res.errors.length, epic.API_URLS.length);
});

test('decouvrir rejette une reponse de structure inattendue', async () => {
  const res = await epic.discover({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: null }) }),
    now: T_CAPTURE,
  });
  assert.equal(res.offers.length, 0);
  assert.ok(res.errors.every((e) => e.includes('structure inattendue')));
});

test('decouvrir traite un HTTP non-2xx comme un echec de cet hote', async () => {
  const res = await epic.discover({
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    now: T_CAPTURE,
  });
  assert.equal(res.offers.length, 0);
  assert.ok(res.errors.every((e) => e.includes('HTTP 503')));
});
