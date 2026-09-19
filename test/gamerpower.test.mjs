/* Tests de la source de decouverte gamerpower.
 *
 * Tourne sur une CAPTURE REELLE de l'API (test/fixtures/gamerpower-giveaways.json,
 * 2026-08-27, 20 offres) plus des entrees deformees a la main. Les cas limites
 * qui comptent viennent tous de donnees observees : 8 offres sur 20 sans date
 * de fin, des titres suffixes, un champ platforms en texte libre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as gp from '../watch/sources/gamerpower.js';
import { STORES, byUrgency } from '../watch/offer.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(readFileSync(join(ICI, 'fixtures', 'gamerpower-giveaways.json'), 'utf8'));

const T = Date.UTC(2026, 7, 27, 10, 0, 0);

/* ------------------------------------------------------------- la capture */

test('la fixture est une vraie reponse exploitable', () => {
  assert.ok(Array.isArray(CAPTURE));
  assert.ok(CAPTURE.length >= 15, `${CAPTURE.length} offres`);
  // Le cas qui justifie la regle d'urgence : une part notable des offres
  // arrive sans date de fin. Si la fixture perd cette propriete, le test
  // d'urgence ci-dessous ne prouve plus rien.
  const sansFin = CAPTURE.filter((o) => o.end_date === 'N/A').length;
  assert.ok(sansFin > 0, 'aucune offre sans date de fin dans la capture');
});

/* ------------------------------------------------------------- projection */

test('mapperReponse projette toute la capture sans rien perdre en silence', () => {
  const { offers, dropped, erreur } = gp.mapResponse(CAPTURE, T);
  assert.equal(erreur, null);
  assert.equal(offers.length + dropped.length, CAPTURE.length);
  assert.equal(dropped.length, 0, `ecartees : ${JSON.stringify(dropped)}`);
});

test('les champs essentiels sont renseignes sur toutes les offres', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);
  for (const o of offers) {
    assert.equal(o.source, 'gamerpower');
    assert.ok(o.sourceId, `idSource manquant sur "${o.title}"`);
    assert.ok(o.title, 'titre vide');
    assert.ok(o.normalisedTitle, `titre normalise vide sur "${o.title}"`);
    assert.ok(o.resolveUrl, `urlResolution manquante sur "${o.title}"`);
    // L'agregateur ne donne jamais l'URL du magasin : elle doit rester nulle
    // jusqu'a l'etape de resolution.
    assert.equal(o.url, null, `url du magasin renseignee a tort sur "${o.title}"`);
    assert.ok(typeof o.start === 'number', `debut illisible sur "${o.title}"`);
  }
});

test('chaque offre de la capture porte une vignette', () => {
  // 20 sur 20 dans la capture reelle : le popup peut compter dessus.
  const { offers } = gp.mapResponse(CAPTURE, T);
  for (const o of offers) {
    assert.ok(o.image, `aucune vignette pour "${o.title}"`);
    assert.match(o.image, /^https:\/\//);
  }
});

test('le routage identifie les magasins connus de la capture', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);
  const byStore = new Map();
  for (const o of offers) byStore.set(o.store, (byStore.get(o.store) || 0) + 1);

  // La capture contient au moins de l'Epic, de l'itch.io et de l'IndieGala.
  assert.ok(byStore.get(STORES.EPIC) >= 1, 'aucune offre Epic reconnue');
  assert.ok(
    (byStore.get(STORES.ITCHIO) || 0) + (byStore.get(STORES.INDIEGALA) || 0) >= 2,
    'ni itch.io ni IndieGala reconnus',
  );
});

test('une offre sans magasin identifiable n\'est pas reclamable mais reste au catalogue', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);
  const inconnues = offers.filter((o) => !gp.isClaimable(o));
  // Mobile et VR n'ont pas de module de reclamation : elles doivent tomber
  // dans ce panier, sans disparaitre.
  for (const o of inconnues) assert.equal(o.store, STORES.UNKNOWN);
  assert.equal(offers.length, inconnues.length + offers.filter(gp.isClaimable).length);
});

test('les offres sans date de fin passent en tete de la file', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);
  const triees = byUrgency(offers, T);
  const sansFin = offers.filter((o) => o.end === null);
  assert.ok(sansFin.length > 0, 'la capture ne contient plus d\'offre sans date de fin');
  for (let i = 0; i < sansFin.length; i++) {
    assert.equal(triees[i].end, null, `l'offre ${i} de la file a une date de fin`);
  }
});

/* -------------------------------------------------------- entrees abimees */

test('mapperEntree ecarte ce qu\'elle ne sait pas lire, avec un motif', () => {
  const cas = [
    [null, 'entree non exploitable'],
    ['une chaine', 'entree non exploitable'],
    [{ id: 1 }, 'titre absent'],
    [{ id: 1, title: '   ' }, 'titre absent'],
    [{ id: 1, title: 'X', status: 'Expired', open_giveaway_url: 'https://x.test' }, 'statut'],
    [{ id: 1, title: 'X' }, 'aucune URL a ouvrir'],
  ];
  for (const [raw, attendu] of cas) {
    const { offer, skippedItem } = gp.mapEntry(raw, T);
    assert.equal(offer, undefined, `aurait du etre ecartee : ${JSON.stringify(raw)}`);
    assert.ok(skippedItem.reasonText.includes(attendu), `motif "${skippedItem.reasonText}" au lieu de "${attendu}"`);
  }
});

test('mapperEntree accepte une entree minimale valide', () => {
  const { offer, skippedItem } = gp.mapEntry({
    id: 42,
    title: 'Jeu Minimal (Epic Games) Giveaway',
    open_giveaway_url: 'https://www.gamerpower.com/open/jeu-minimal',
    published_date: '2026-08-26 21:23:06',
    end_date: 'N/A',
  }, T);

  assert.equal(skippedItem, undefined);
  assert.equal(offer.sourceId, '42');
  assert.equal(offer.store, STORES.EPIC);
  assert.equal(offer.normalisedTitle, 'jeu minimal');
  assert.equal(offer.end, null);
  assert.equal(offer.start, Date.UTC(2026, 7, 27, 1, 23, 6)); // 21:23 a New York
});

test('mapperReponse deduplique sur l\'identifiant de la source', () => {
  const entry = {
    id: 7,
    title: 'Doublon (Steam) Key Giveaway',
    open_giveaway_url: 'https://www.gamerpower.com/open/doublon',
    published_date: '2026-08-26 10:00:00',
  };
  const { offers, dropped } = gp.mapResponse([entry, { ...entry }], T);
  assert.equal(offers.length, 1);
  assert.equal(dropped.length, 1);
  assert.ok(dropped[0].reasonText.includes('doublon'));
});

test('mapperReponse refuse ce qui n\'est pas un tableau', () => {
  for (const mauvais of [null, undefined, {}, 'texte', 42]) {
    const r = gp.mapResponse(mauvais, T);
    assert.equal(r.offers.length, 0);
    assert.ok(r.erreur);
  }
});

test('un tableau vide est un resultat valide, pas une erreur', () => {
  const r = gp.mapResponse([], T);
  assert.equal(r.erreur, null);
  assert.equal(r.offers.length, 0);
});

/* -------------------------------------------------------------- decouverte */

test('decouvrir projette une reponse reelle', async () => {
  const r = await gp.discover({
    fetch: async () => ({ ok: true, status: 200, json: async () => CAPTURE }),
    now: T,
  });
  assert.equal(r.errors.length, 0);
  assert.equal(r.offers.length, CAPTURE.length);
});

test('decouvrir ne jette jamais, quelle que soit la panne', async () => {
  const pannes = [
    [async () => { throw new Error('reseau coupe'); }, 'reseau coupe'],
    [async () => ({ ok: false, status: 503, json: async () => [] }), 'HTTP 503'],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }), 'JSON illisible'],
    [async () => ({ ok: true, status: 200, json: async () => ({ pas: 'un tableau' }) }), 'tableau'],
  ];
  for (const [fetchImpl, attendu] of pannes) {
    const r = await gp.discover({ fetch: fetchImpl, now: T });
    assert.equal(r.offers.length, 0);
    assert.ok(
      r.errors.some((e) => e.includes(attendu)),
      `erreurs ${JSON.stringify(r.errors)} ne mentionnent pas "${attendu}"`,
    );
  }
});

test('un abandon PENDANT la lecture du corps est un delai, pas un JSON illisible', async () => {
  /* Le cas exact du journal du 2026-09-19 :
       gamerpower : echec
       {"errors":["JSON illisible : signal is aborted without reason"]}
     Les en-tetes etaient arrivees -- donc `response.ok` vrai, donc on entrait
     dans `json()` -- et c'est la que NOTRE minuteur a coupe. Le catch pose
     autour du seul `json()` accusait l'API d'avoir change de format ; elle
     n'avait rien change. Trois expirations de suite ont endormi la source, et
     le message a envoye chercher au mauvais endroit. */
  const r = await gp.discover({
    fetch: (url, opts) => Promise.resolve({
      ok: true,
      status: 200,
      json: () => new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          // Le message que Chrome donne a un abandon sans motif explicite.
          const e = new Error('signal is aborted without reason');
          e.name = 'AbortError';
          reject(e);
        });
      }),
    }),
    now: T,
    timeoutMs: 30,
  });
  assert.equal(r.offers.length, 0);
  assert.deepEqual(r.errors, ['delai depasse (30 ms)']);
  assert.ok(!r.errors.some((e) => /JSON illisible/.test(e)), 'ne doit plus accuser le format');
});

test('et un abandon dont le nom ne dit rien reste un delai : c\'est NOTRE signal qui tranche', async () => {
  /* Toutes les plateformes ne rejettent pas un abandon avec un AbortError.
     Se fier au seul nom de l'erreur, c'etait se remettre a une loterie. */
  const r = await gp.discover({
    fetch: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new TypeError('Failed to fetch')));
    }),
    now: T,
    timeoutMs: 30,
  });
  assert.deepEqual(r.errors, ['delai depasse (30 ms)']);
});

test('decouvrir abandonne au bout du delai imparti', async () => {
  const r = await gp.discover({
    fetch: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }),
    now: T,
    timeoutMs: 30,
  });
  assert.equal(r.offers.length, 0);
  assert.ok(r.errors[0].includes('delai depasse'));
});

/* ------------------------------------------------------------- resolution */

test('redetecterMagasin corrige le routage une fois l\'URL connue', () => {
  const { offer } = gp.mapEntry({
    id: 1,
    // Titre trompeur : il annonce DRM-Free, l'URL dira Epic.
    title: 'Un Jeu Giveaway',
    platforms: 'PC, DRM-Free',
    open_giveaway_url: 'https://www.gamerpower.com/open/un-jeu',
    published_date: '2026-08-26 10:00:00',
  }, T);

  assert.equal(offer.store, STORES.UNKNOWN);
  assert.equal(
    gp.redetectStore(offer, 'https://store.epicgames.com/p/un-jeu'),
    STORES.EPIC,
  );
});

test('construireUrl produit une requete unique et parametree', () => {
  assert.equal(gp.buildUrl(), 'https://www.gamerpower.com/api/giveaways?type=game');
  assert.equal(gp.buildUrl({ type: 'loot' }), 'https://www.gamerpower.com/api/giveaways?type=loot');
  assert.equal(gp.buildUrl({ type: null }), 'https://www.gamerpower.com/api/giveaways');
});
