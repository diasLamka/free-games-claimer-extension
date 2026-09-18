/* Tests du catalogue : rapprochement multi-sources, disparitions, expiration,
 * retention.
 *
 * Les scenarios reproduisent des situations reelles de la veille, pas des
 * appels de fonction isoles : c'est la ou vivent les bugs de ce module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  integrate,
  purgeExpired,
  markExpired,
  openOffers,
  resume,
  indexBy,
  storageKey,
  VANISH_DELAY_MS,
  RETENTION_MS,
} from '../watch/catalog.js';
import { makeOffer, STATES, STORES } from '../watch/offer.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const offreEpic = (extra = {}) => makeOffer({
  source: 'epic-api',
  store: STORES.EPIC,
  storeId: 'together-after-dark',
  title: 'Together After Dark',
  url: 'https://store.epicgames.com/p/together-after-dark?lang=fr',
  end: '2026-09-03T15:00:00.000Z',
  ...extra,
});

const offreAgregateur = (extra = {}) => makeOffer({
  source: 'gamerpower',
  sourceId: 3316,
  title: 'Together After Dark (Epic Games) Giveaway',
  platforms: 'PC, Epic Games Store',
  resolveUrl: 'https://www.gamerpower.com/open/together-after-dark-epic-games-giveaway',
  naiveDateZone: 'America/New_York',
  start: '2026-08-26 07:39:16',
  ...extra,
});

/* -------------------------------------------------------------- integration */

test('une premiere decouverte cree une nouveaute', () => {
  const r = integrate({}, [offreEpic()], { now: T });
  assert.equal(r.freshOffers.length, 1);
  assert.equal(r.updates.length, 0);
  assert.equal(Object.keys(r.catalog).length, 1);
  assert.equal(r.freshOffers[0].catalogKey, 'epic:together-after-dark');
});

test('revoir la meme offre ne cree pas de nouveaute', () => {
  const a = integrate({}, [offreEpic()], { now: T });
  const b = integrate(a.catalog, [offreEpic()], { now: T + 60000 });

  assert.equal(b.freshOffers.length, 0, 'une offre deja connue a ete notifiee comme neuve');
  assert.equal(b.updates.length, 1);
  assert.equal(Object.keys(b.catalog).length, 1);
});

test('deux sources qui annoncent le meme jeu donnent une seule entree', () => {
  // C'est le scenario central : l'agregateur et l'API Epic voient tous deux
  // "Together After Dark". Sans rapprochement, on ouvrirait deux onglets.
  const a = integrate({}, [offreEpic()], { now: T });
  const b = integrate(a.catalog, [offreAgregateur()], { now: T + 1000 });

  assert.equal(Object.keys(b.catalog).length, 1);
  assert.equal(b.freshOffers.length, 0);
  assert.equal(b.updates.length, 1);

  // La fusion garde le meilleur des deux : l'URL du magasin vient d'Epic,
  // l'URL de resolution et la date de publication viennent de l'agregateur.
  const merged = b.updates[0];
  assert.equal(merged.url, 'https://store.epicgames.com/p/together-after-dark?lang=fr');
  assert.equal(merged.resolveUrl, 'https://www.gamerpower.com/open/together-after-dark-epic-games-giveaway');
  assert.equal(merged.storeId, 'together-after-dark');
  assert.equal(merged.end, Date.UTC(2026, 8, 3, 15, 0, 0));
});

test('l\'ordre de decouverte ne change pas le resultat', () => {
  const versA = integrate(integrate({}, [offreEpic()], { now: T }).catalog,
    [offreAgregateur()], { now: T + 1000 });
  const versB = integrate(integrate({}, [offreAgregateur()], { now: T }).catalog,
    [offreEpic()], { now: T + 1000 });

  assert.equal(Object.keys(versA.catalog).length, 1);
  assert.equal(Object.keys(versB.catalog).length, 1);

  const a = Object.values(versA.catalog)[0];
  const b = Object.values(versB.catalog)[0];
  assert.equal(a.storeId, b.storeId);
  assert.equal(a.url, b.url);
  assert.equal(a.resolveUrl, b.resolveUrl);
  assert.equal(a.end, b.end);
});

test('deux jeux differents restent deux entrees', () => {
  const autre = offreEpic({ storeId: 'bolmn', title: 'Bolmn' });
  const r = integrate({}, [offreEpic(), autre], { now: T });
  assert.equal(r.freshOffers.length, 2);
  assert.equal(Object.keys(r.catalog).length, 2);
});

test('integrer refuse de travailler sans instant', () => {
  assert.throws(() => integrate({}, [offreEpic()], {}), TypeError);
});

test('une offre sans cle exploitable est ignoree, avec un motif', () => {
  const emptyNode = makeOffer({ source: 'gamerpower', title: '' });
  const r = integrate({}, [emptyNode], { now: T });
  assert.equal(r.freshOffers.length, 0);
  assert.equal(r.skipped.length, 1);
});

test('une liste vide ne casse rien', () => {
  const r = integrate({}, [], { now: T });
  assert.deepEqual(r.catalog, {});
  assert.equal(r.freshOffers.length, 0);
});

/* --------------------------------------------------------------- expiration */

test('une offre dont la fin est passee bascule en expiree', () => {
  const a = integrate({}, [offreEpic()], { now: T });
  const apres = Date.UTC(2026, 8, 4, 0, 0, 0); // apres le 3 septembre
  const b = integrate(a.catalog, [], { now: apres });

  assert.equal(b.expired.length, 1);
  assert.equal(Object.values(b.catalog)[0].state, STATES.EXPIRED);
});

test('une offre expiree ne re-expire pas a chaque cycle', () => {
  const a = integrate({}, [offreEpic()], { now: T });
  const apres = Date.UTC(2026, 8, 4, 0, 0, 0);
  const b = integrate(a.catalog, [], { now: apres });
  const c = integrate(b.catalog, [], { now: apres + DAY });

  assert.equal(b.expired.length, 1);
  assert.equal(c.expired.length, 0, 'l\'expiration a ete signalee deux fois');
});

test('integrer ne modifie pas le catalogue qu\'on lui passe', () => {
  // Le service worker relit son etat depuis le stockage a chaque reveil : une
  // fonction qui mute son entree rendrait tout raisonnement sur l'ordre des
  // ecritures impossible.
  const a = integrate({}, [offreEpic()], { now: T });
  const before = JSON.stringify(a.catalog);

  const apres = Date.UTC(2026, 8, 4, 0, 0, 0);
  integrate(a.catalog, [offreEpic({ storeId: 'autre', title: 'Autre' })], { now: apres });

  assert.equal(JSON.stringify(a.catalog), before, 'le catalogue d\'entree a ete modifie');
});

test('une offre sans date de fin n\'expire jamais toute seule', () => {
  const sansFin = offreEpic({ end: 'N/A', storeId: 'sans-fin' });
  const a = integrate({}, [sansFin], { now: T });
  const b = integrate(a.catalog, [sansFin], { now: T + 365 * DAY });
  assert.equal(b.expired.length, 0);
});

/* ------------------------------------------------------------ disparitions */

test('une offre sans date de fin qui disparait est mise en observation, pas terminee', () => {
  const sansFin = makeOffer({
    source: 'gamerpower', store: STORES.INDIEGALA, title: 'Leaper', end: 'N/A',
    resolveUrl: 'https://x.test',
  });
  const a = integrate({}, [sansFin], { now: T, source: 'gamerpower', completeList: true });
  const b = integrate(a.catalog, [], { now: T + DAY / 2, source: 'gamerpower', completeList: true });

  assert.equal(b.vanished.length, 0, 'terminee trop vite : un hoquet d\'API suffirait');
  assert.equal(Object.values(b.catalog)[0].missingSince, T + DAY / 2);
  assert.equal(Object.values(b.catalog)[0].state, STATES.DISCOVERED);
});

test('une offre absente au-dela du delai de grace est terminee', () => {
  const sansFin = makeOffer({
    source: 'gamerpower', store: STORES.INDIEGALA, title: 'Leaper', end: 'N/A',
    resolveUrl: 'https://x.test',
  });
  let cat = integrate({}, [sansFin], { now: T, source: 'gamerpower', completeList: true }).catalog;
  cat = integrate(cat, [], { now: T + 1000, source: 'gamerpower', completeList: true }).catalog;
  const end = integrate(cat, [], {
    now: T + 1000 + VANISH_DELAY_MS,
    source: 'gamerpower',
    completeList: true,
  });

  assert.equal(end.vanished.length, 1);
  assert.equal(Object.values(end.catalog)[0].state, STATES.EXPIRED);
});

test('une offre qui reapparait n\'est plus en observation', () => {
  const sansFin = makeOffer({
    source: 'gamerpower', store: STORES.INDIEGALA, title: 'Leaper', end: 'N/A',
    resolveUrl: 'https://x.test',
  });
  let cat = integrate({}, [sansFin], { now: T, source: 'gamerpower', completeList: true }).catalog;
  cat = integrate(cat, [], { now: T + 1000, source: 'gamerpower', completeList: true }).catalog;
  assert.ok(Object.values(cat)[0].missingSince);

  cat = integrate(cat, [sansFin], { now: T + 2000, source: 'gamerpower', completeList: true }).catalog;
  assert.equal(Object.values(cat)[0].missingSince, undefined);
});

test('une liste partielle ne declare personne disparu', () => {
  // Sans listeComplete, l'absence ne veut rien dire : c'est peut-etre une
  // requete filtree.
  const sansFin = makeOffer({
    source: 'gamerpower', store: STORES.INDIEGALA, title: 'Leaper', end: 'N/A',
    resolveUrl: 'https://x.test',
  });
  const cat = integrate({}, [sansFin], { now: T, source: 'gamerpower', completeList: true }).catalog;
  const r = integrate(cat, [], { now: T + 10 * DAY, source: 'gamerpower' });

  assert.equal(r.vanished.length, 0);
  assert.equal(Object.values(r.catalog)[0].missingSince, undefined);
});

test('la disparition d\'une source n\'affecte pas les offres d\'une autre', () => {
  let cat = integrate({}, [offreEpic({ end: 'N/A' })], { now: T }).catalog;
  const r = integrate(cat, [], {
    now: T + 10 * DAY,
    source: 'gamerpower',
    completeList: true,
  });
  assert.equal(r.vanished.length, 0);
  assert.equal(Object.values(r.catalog)[0].state, STATES.DISCOVERED);
});

/* ---------------------------------------------------------------- retention */

test('purger retire les entrees terminees et anciennes', () => {
  const catalog = {
    vieille: { ...offreEpic(), state: STATES.EXPIRED, updatedAt: T - RETENTION_MS - 1 },
    recente: { ...offreEpic({ storeId: 'b' }), state: STATES.EXPIRED, updatedAt: T - DAY },
  };
  const r = purgeExpired(catalog, { now: T });
  assert.equal(r.removed.length, 1);
  assert.deepEqual(Object.keys(r.catalog), ['recente']);
});

test('purger ne touche jamais a une offre encore en cours, meme tres ancienne', () => {
  // Une offre bloquee depuis des mois sur "compte a associer" est un probleme
  // a montrer, pas a effacer.
  const catalog = {
    bloquee: { ...offreEpic(), state: STATES.QUEUED, updatedAt: T - 5 * RETENTION_MS },
  };
  const r = purgeExpired(catalog, { now: T });
  assert.equal(r.removed.length, 0);
  assert.deepEqual(Object.keys(r.catalog), ['bloquee']);
});

/* ------------------------------------------------------------------ lecture */

test('enCours et resume decrivent l\'etat du catalogue', () => {
  const catalog = {
    a: { ...offreEpic(), state: STATES.DISCOVERED },
    b: { ...offreEpic({ storeId: 'b' }), state: STATES.QUEUED },
    c: { ...offreEpic({ storeId: 'c' }), state: STATES.EXPIRED },
    d: { ...offreEpic({ storeId: 'd' }), state: STATES.RESOLVED },
  };
  assert.equal(openOffers(catalog, T).length, 2);
  assert.deepEqual(resume(catalog), {
    [STATES.DISCOVERED]: 1,
    [STATES.QUEUED]: 1,
    [STATES.EXPIRED]: 1,
    [STATES.RESOLVED]: 1,
  });
});

test('indexer expose les deux cles de chaque entree', () => {
  const cat = integrate({}, [offreEpic()], { now: T }).catalog;
  const index = indexBy(cat);
  assert.equal(index.get('epic:together-after-dark'), 'epic:together-after-dark');
  assert.equal(index.get('epic:titre:together after dark'), 'epic:together-after-dark');
});

test('cleDeRangement prefere la cle forte', () => {
  assert.equal(storageKey(offreEpic()), 'epic:together-after-dark');
  assert.equal(
    storageKey(makeOffer({ store: 'epic', title: 'Sans identifiant' })),
    'epic:titre:sans identifiant',
  );
});
