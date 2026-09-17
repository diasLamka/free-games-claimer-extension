/* Tests du bilan et de l'export. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACQUIRED_STATUSES,
  EXPORT_FORMAT,
  matchHistory,
  claimsMade,
  tally,
  mainStore,
  buildExport,
  exportFileName,
} from '../watch/tally.js';
import { makeOffer, STORES } from '../watch/offer.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const DAY = 86400000;

const catalog = {
  'epic:cardpocalypse': makeOffer({
    source: 'epic-api', store: STORES.EPIC, storeId: 'cardpocalypse',
    title: 'Cardpocalypse', worth: '$14.99',
    url: 'https://store.epicgames.com/p/cardpocalypse',
  }),
  'epic:bolmn': makeOffer({
    source: 'epic-api', store: STORES.EPIC, storeId: 'bolmn',
    title: 'Bolmn', worth: '$4.99',
    url: 'https://store.epicgames.com/p/bolmn',
  }),
};

const histories = {
  'Epic Games': {
    'slug:cardpocalypse': { status: 'claimed', ts: T - 2 * DAY },
    'slug:bolmn': { status: 'claimed', ts: T - 40 * DAY },
    'slug:jamais-vu': { status: 'claimed', ts: T - DAY },      // absent du catalogue
    'slug:rate': { status: 'failed', ts: T - DAY },            // pas acquis
    'slug:sans-date': { status: 'claimed' },                    // sans horodatage
  },
  GOG: {
    'code:ABCDE': { status: 'redeemed', ts: T - 5 * DAY },
  },
  'Amazon Luna': {
    'offer:amzn1.pg.item.abc': { status: 'needs_link', ts: T - DAY },
  },
};

/* ------------------------------------------------------- rapprochement */

test('rapprocherHistorique retrouve l\'offre quand la veille la connaissait', () => {
  const o = matchHistory('slug:cardpocalypse', STORES.EPIC, catalog);
  assert.equal(o.title, 'Cardpocalypse');
});

test('rapprocherHistorique rend null sans inventer', () => {
  assert.equal(matchHistory('slug:jamais-vu', STORES.EPIC, catalog), null);
  assert.equal(matchHistory('slug:x', STORES.EPIC, {}), null);
  assert.equal(matchHistory('slug:x', STORES.EPIC, null), null);
});

/* ------------------------------------------------------- recuperations */

test('seules les recuperations reelles sont comptees', () => {
  const l = claimsMade(histories, catalog);
  const keys = l.map((x) => x.key);

  assert.ok(keys.includes('slug:cardpocalypse'));
  assert.ok(keys.includes('code:ABCDE'));
  assert.ok(!keys.includes('slug:rate'), 'un echec a ete compte comme une recuperation');
  assert.ok(!keys.includes('offer:amzn1.pg.item.abc'), 'un compte a associer n\'est pas une recuperation');
  assert.ok(!keys.includes('slug:sans-date'), 'une entree sans horodatage a ete comptee');
  assert.deepEqual(ACQUIRED_STATUSES, ['claimed', 'redeemed']);
});

test('les recuperations sont triees de la plus recente a la plus ancienne', () => {
  const l = claimsMade(histories, catalog);
  for (let i = 1; i < l.length; i++) assert.ok(l[i - 1].ts >= l[i].ts);
});

test('une recuperation inconnue du catalogue est gardee, sans valeur', () => {
  const l = claimsMade(histories, catalog);
  const inconnue = l.find((x) => x.key === 'slug:jamais-vu');
  assert.ok(inconnue, 'l\'entree a ete perdue');
  assert.equal(inconnue.title, null);
  assert.equal(inconnue.worth, null);
});

test('le filtre par date ne garde que la periode demandee', () => {
  const recent = claimsMade(histories, catalog, { since: T - 10 * DAY });
  assert.ok(recent.every((x) => x.ts >= T - 10 * DAY));
  assert.ok(!recent.some((x) => x.key === 'slug:bolmn'), 'une entree hors periode a ete gardee');
});

/* -------------------------------------------------------------- bilan */

test('le bilan distingue ce qu\'il a pu valoriser du reste', () => {
  // « 48 $ pour 20 jeux » laisserait croire que les 20 ont ete comptes.
  const b = tally(claimsMade(histories, catalog));

  assert.equal(b.count, 4);       // 2 Epic connus + 1 Epic inconnu + 1 code GOG
  assert.equal(b.priced, 2);   // seuls les deux du catalogue portent une valeur
  assert.equal(b.totalWorth, 19.98);
});

test('le bilan ventile par magasin et par mois', () => {
  const b = tally(claimsMade(histories, catalog));
  assert.equal(b.byStore[STORES.EPIC].count, 3);
  assert.equal(b.byStore[STORES.GOG].count, 1);
  assert.equal(b.byStore[STORES.EPIC].worth, 19.98);

  const month = Object.keys(b.byMonth);
  assert.ok(month.includes('2026-08'));
  assert.ok(month.includes('2026-07'), 'Bolmn date de 40 jours et devrait tomber en juillet');
});

test('un bilan vide ne casse rien', () => {
  const b = tally([]);
  assert.equal(b.count, 0);
  assert.equal(b.totalWorth, 0);
  assert.equal(b.priced, 0);
  assert.deepEqual(b.byStore, {});
  assert.equal(mainStore(b), null);
});

test('magasinDominant nomme le magasin le plus productif', () => {
  const d = mainStore(tally(claimsMade(histories, catalog)));
  assert.equal(d.store, STORES.EPIC);
  assert.equal(d.libelle, 'Epic Games Store');
  assert.equal(d.count, 3);
});

test('la valeur totale ne derive pas en virgule flottante', () => {
  const rows = Array.from({ length: 3 }, () => ({ store: 'epic', worth: 0.1, ts: T }));
  assert.equal(tally(rows).totalWorth, 0.3);
});

/* -------------------------------------------------------------- export */

test('l\'export contient d\'abord ce qui est irremplacable', () => {
  const codes = [{ code: 'ABCDE-12345', store: 'gog', title: 'Right and Down' }];
  const e = buildExport({ codes, histories, catalog, version: '2.9.0', now: T });

  assert.equal(e.exportFormat, EXPORT_FORMAT);
  assert.deepEqual(e.pendingCodes, codes);
  assert.equal(e.extensionVersion, '2.9.0');
  assert.equal(e.exportedAt, new Date(T).toISOString());
  assert.equal(e.tally.count, 4);
  assert.ok(Array.isArray(e.claimsMade));
});

test('l\'export survit a un aller-retour JSON', () => {
  const e = buildExport({ codes: [], histories, catalog, now: T });
  assert.deepEqual(JSON.parse(JSON.stringify(e)), e);
});

test('l\'export fonctionne sur une installation vierge', () => {
  const e = buildExport({ now: T });
  assert.deepEqual(e.pendingCodes, []);
  assert.equal(e.tally.count, 0);
});

test('exporter refuse de travailler sans instant', () => {
  assert.throws(() => buildExport({}), TypeError);
});

test('le nom de fichier est stable et se trie chronologiquement', () => {
  const a = exportFileName(Date.UTC(2026, 0, 5, 9, 3, 1));
  const b = exportFileName(Date.UTC(2026, 7, 27, 12, 0, 0));
  assert.match(a, /^free-games-claimer-2026-01-05-09-03-01\.json$/);
  assert.ok(a < b, 'les noms ne se trient pas dans l\'ordre chronologique');
});
