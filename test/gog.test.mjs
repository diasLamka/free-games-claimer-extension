/* Tests de la source GOG.
 *
 * La capture `fixtures/gog-filtered.json` n'est pas inventee : c'est le
 * squelette EXACT d'un produit renvoye par
 * /games/ajax/filtered?mediaType=game&sort=popularity le 2026-09-17 -- tous
 * ses champs, dans leur forme reelle -- decline en sept cas. Seules les
 * VALEURS de prix, de titre et de disponibilite changent d'un cas a l'autre ;
 * le schema, lui, est mesure.
 *
 * Voir docs/superpowers/specs/2026-09-17-v6-v7-constats.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NAME, ORIGIN, FILTERED_URL, readPrice, mapProduct, mapResponse, discover } from '../watch/sources/gog.js';
import { STORES } from '../watch/offer.js';
import { readWorth, readCurrency } from '../watch/filters.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(readFileSync(join(ICI, 'fixtures', 'gog-filtered.json'), 'utf8'));
const T = Date.UTC(2026, 8, 17, 12, 0, 0);

/** La reponse REELLE du 2026-09-17 : 107 octets, aucun jeu gratuit ce jour-la. */
const VIDE = {
  products: [], ts: null, page: 1, totalPages: 0,
  totalResults: '0', totalGamesFound: 0, totalMoviesFound: 0,
};

const reponse = (data, { ok = true, status = 200 } = {}) => async () => ({
  ok, status, async json() { return data; },
});

/* ------------------------------------------------------------------ prix */

test('un jeu payant offert un temps est a garder ; un gratuit permanent non', () => {
  // La distinction etablie pour Epic en 2.12.0, transposee : c'est elle qui
  // evite d'ouvrir un onglet pour un titre que tout le monde possede deja.
  const offert = readPrice({ currency: 'EUR', baseAmount: '9.99', finalAmount: '0.00' });
  assert.equal(offert.keepable, true);
  assert.equal(offert.worth, '9.99 EUR');

  const permanent = readPrice({ currency: 'EUR', baseAmount: '0.00', finalAmount: '0.00' });
  assert.equal(permanent.keepable, false);
  assert.equal(permanent.worth, null, 'un jeu gratuit de toute facon ne vaut rien a annoncer');
});

test('la valeur porte toujours sa devise', () => {
  // Un montant nu serait relu plus tard par quelqu'un qui devrait supposer --
  // exactement le bug de devise corrige en 2.14.0.
  const { worth } = readPrice({ currency: 'EUR', baseAmount: '9.99', finalAmount: '0.00' });
  assert.equal(readWorth(worth), 9.99);
  assert.equal(readCurrency(worth), 'EUR');
});

test('un bloc prix illisible rend « on ne sait pas », jamais « gratuit »', () => {
  // null n'est pas false : traiter l'ignorance comme un refus ferait rater de
  // vrais jeux offerts.
  for (const cas of [null, undefined, {}, { baseAmount: 'douze' }]) {
    assert.deepEqual(readPrice(cas), { worth: null, keepable: null });
  }
});

/* ------------------------------------------------------------ projection */

test('un produit offert devient une offre complete', () => {
  const brut = CAPTURE.products[0];
  const { offer } = mapProduct(brut, T);

  assert.equal(offer.source, NAME);
  assert.equal(offer.store, STORES.GOG);
  assert.equal(offer.storeId, 'offert');
  assert.equal(offer.title, 'Un Jeu Offert', 'le titre arrive avec des espaces de tete');
  assert.equal(offer.url, `${ORIGIN}/fr/game/offworld_trading_company_market_corrections`);
  assert.equal(offer.keepable, true);
  assert.equal(offer.worth, '9.99 EUR');
});

test('les URL sans protocole sont completees', () => {
  // GOG publie ses images en `//images-3.gog-statics.com/...` : laissees
  // telles quelles, elles seraient inutilisables hors d'une page https.
  const { offer } = mapProduct(CAPTURE.products[0], T);
  assert.match(offer.image, /^https:\/\/images-3\.gog-statics\.com\//);
  assert.match(offer.url, /^https:\/\/www\.gog\.com\//);
});

test('la fin de promotion est lue en SECONDES', () => {
  // Lue en millisecondes, une offre qui se termine dans trois jours paraitrait
  // expiree depuis 1970, et le catalogue la rangerait aussitot comme terminee.
  const { offer } = mapProduct(CAPTURE.products[0], T);
  assert.equal(offer.end, 1789700000 * 1000);

  const sansFin = mapProduct(CAPTURE.products[1], T);
  assert.equal(sansFin.offer.end, null, 'salesVisibility.to a null ne doit pas inventer de date');
});

test('chaque ecart porte son motif', () => {
  // Un ecart silencieux est une offre perdue, et un signal que l'API a change
  // qui ne remonte jamais.
  const motifs = CAPTURE.products
    .map((p) => mapProduct(p, T).skippedItem)
    .filter(Boolean)
    .map((s) => s.reasonText);

  assert.ok(motifs.some((m) => /pas encore sorti/.test(m)));
  assert.ok(motifs.some((m) => /n'est pas un jeu/.test(m)));
  assert.ok(motifs.some((m) => /indisponible/.test(m)));
  assert.ok(motifs.some((m) => /titre absent/.test(m)));
});

test('une entree qu\'on ne sait pas lire est ecartee, pas jetee', () => {
  assert.ok(mapProduct(null, T).skippedItem);
  assert.ok(mapProduct('pas un objet', T).skippedItem);
  assert.ok(mapProduct({ title: 'Sans URL', url: null }, T).skippedItem);
});

/* -------------------------------------------------------------- reponse */

test('la capture rend deux offres, et un doublon ecarte', () => {
  const { offers, dropped } = mapResponse(CAPTURE, T);

  assert.deepEqual(offers.map((o) => o.storeId), ['offert', 'permanent']);
  assert.equal(offers.length + dropped.length, CAPTURE.products.length);
  assert.ok(dropped.some((d) => /doublon/.test(d.reasonText)), 'deux onglets pour le meme jeu, sinon');
});

test('le gratuit permanent reste au catalogue -- c\'est le filtre qui tranche', () => {
  // La source RAPPORTE, elle ne decide pas. C'est `claimOnlyKeepable` qui
  // choisit de ne pas l'ouvrir, et l'utilisateur peut couper ce reglage.
  const { offers } = mapResponse(CAPTURE, T);
  const permanent = offers.find((o) => o.storeId === 'permanent');
  assert.equal(permanent.keepable, false);
});

test('une reponse sans tableau « products » est une erreur, pas un vide', () => {
  // Confondre les deux ferait passer un changement d'API pour une journee
  // sans offres.
  assert.match(mapResponse({}, T).erreur, /products/);
  assert.match(mapResponse(null, T).erreur, /products/);
  assert.match(mapResponse([], T).erreur, /products/);
});

test('la vraie reponse vide du 2026-09-17 se lit comme un vide normal', () => {
  const { offers, dropped, erreur } = mapResponse(VIDE, T);
  assert.deepEqual(offers, []);
  assert.deepEqual(dropped, []);
  assert.equal(erreur, null, 'aucun jeu gratuit ce jour-la n\'est pas une panne');
});

/* ------------------------------------------------------------ decouverte */

test('discover projette la capture', async () => {
  const { offers, errors } = await discover({ fetch: reponse(CAPTURE), now: T });
  assert.equal(offers.length, 2);
  assert.deepEqual(errors, []);
});

test('discover ne jette jamais : une source en panne degrade, elle n\'arrete pas', async () => {
  const casse = await discover({ fetch: async () => { throw new Error('socket coupee'); }, now: T });
  assert.deepEqual(casse.offers, []);
  assert.match(casse.errors[0], /socket coupee/);

  const http = await discover({ fetch: reponse(null, { ok: false, status: 503 }), now: T });
  assert.deepEqual(http.errors, ['HTTP 503']);

  const illisible = await discover({
    fetch: async () => ({ ok: true, status: 200, async json() { throw new Error('Unexpected token'); } }),
    now: T,
  });
  assert.match(illisible.errors[0], /JSON illisible/);
});

test('la requete part sans cookies, et le dit', async () => {
  // Connecte, GOG masque ce que le compte possede deja : la veille verrait une
  // offre disparaitre parce qu'elle a ete reclamee, et `completeList` la
  // traiterait comme terminee.
  let vues = null;
  await discover({
    fetch: async (url, init) => { vues = { url, init }; return { ok: true, status: 200, async json() { return VIDE; } }; },
    now: T,
  });

  assert.equal(vues.url, FILTERED_URL);
  assert.equal(vues.init.credentials, 'omit');
  assert.match(FILTERED_URL, /price=free/);
  assert.match(FILTERED_URL, /mediaType=game/, 'GOG vend aussi des films');
});

/* ------------------------------------------------------------- reglages */

test('une source livree apres coup s\'active chez qui a deja des reglages', async () => {
  // Sans cela, elle ne tournerait que sur les nouvelles installations, et la
  // seule personne a en profiter serait celle qui n'en a pas besoin.
  const { normaliseSettings, DEFAULT_SETTINGS } = await import('../watch/storage.js');

  const ancien = normaliseSettings({ activeSources: ['epic-api', 'gamerpower'] });
  assert.ok(ancien.activeSources.includes(NAME));
  assert.ok(ancien.activeSources.includes('epic-api'), 'sans rien retirer');

  // Ce qui n'est pas dans les defauts n'est pas touche : une source retiree du
  // produit ne doit pas etre ressuscitee.
  const exotique = normaliseSettings({ activeSources: ['epic-api', 'source-maison'] });
  assert.ok(exotique.activeSources.includes('source-maison'));
  assert.deepEqual(
    DEFAULT_SETTINGS.activeSources.filter((n) => !exotique.activeSources.includes(n)),
    [],
  );
});

test('le registre expose GOG avec une liste declaree INCOMPLETE', async () => {
  // La source ne lit que la premiere page du catalogue : promettre une liste
  // complete ferait expirer a chaque cycle toute offre glissee en page deux.
  const { SOURCES } = await import('../watch/sources/index.js');
  assert.equal(SOURCES[NAME].completeList, false);
  assert.ok(SOURCES[NAME].minIntervalMs >= 10 * 60 * 1000, 'on reste poli avec un site marchand');
});
