/* La migration du schema 1 vers le schema 2.
 *
 * Ce fichier existe pour une raison precise : une migration ratee ne leve
 * aucune erreur. Le code relit un champ qui n'existe plus, trouve `undefined`,
 * applique sa valeur par defaut, et tout continue de fonctionner -- en ayant
 * remis a zero le seuil de l'utilisateur, son plancher, et son interrupteur
 * d'autonomie. Rien dans la console, rien dans les logs.
 *
 * Les formes ci-dessous sont celles qu'une installation en 2.10.0 porte
 * REELLEMENT dans storage.local. Elles ne sont pas inventees pour le test :
 * elles viennent des ecritures de watch/cycle.js et watch/storage.js d'avant le
 * renommage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { renameFields, buildV2Patch, MIGRATED_KEYS } from '../watch/migrate.js';
import { FIELD_RENAMES } from '../watch/field-renames.js';
import { checkSchema, SCHEMA, SCHEMA_VERSION, KEYS } from '../watch/storage.js';
import { fakeChrome } from './fake-chrome.mjs';

/* --------------------------------------------------------- formes reelles */

const REGLAGES_V1 = {
  plancherParJour: 8,
  reclamationAutonome: false,
  notifications: true,
  sourcesActives: ['epic-api', 'gamerpower'],
  surcharges: {},
};

const FILTRES_V1 = {
  valeurMinimale: 12,
  reclamerSansValeur: false,
  reclamerContenuAdditionnel: true,
  magasinsAutorises: ['epic', 'gog'],
  titresExclus: ['bundle test'],
};

const OFFRE_V1 = {
  source: 'gamerpower',
  idSource: '2743',
  magasin: 'epic',
  idMagasin: 'witchfire',
  titre: 'Witchfire',
  titreNormalise: 'witchfire',
  url: 'https://store.epicgames.com/p/witchfire',
  urlResolution: null,
  debut: 1756200000000,
  fin: 1756800000000,
  valeur: '$39.99',
  image: 'https://cdn/witchfire.jpg',
  dejaPossede: null,
  plateformes: 'PC (Epic Games)',
  categorie: 'Game',
  etat: 'confirmed',
  verdict: null,
  vuLe: null,
  majLe: 1756200500000,
  notifieLe: 1756200600000,
  tentatives: 0,
  rangement: 'epic:witchfire',
};

const ETAT_V1 = {
  amorce: true,
  dernierCycle: 1756200000000,
  prochainCycle: 1756203600000,
  derniereErreur: null,
  nonVues: 3,
};

const SOURCES_V1 = {
  'epic-api': {
    dernierSucces: 1756200000000,
    derniereErreur: null,
    echecsConsecutifs: 0,
    derniereTaille: 12,
    fenetresAnnoncees: [{ debut: 1756800000000, titre: 'Breathedge', image: 'https://cdn/b.jpg' }],
  },
};

/* ------------------------------------------------------------- renameFields */

test('un champ connu est renomme, un champ inconnu est conserve', () => {
  const out = renameFields({ valeurMinimale: 12, champInconnuDeLaTable: 7 });
  assert.equal(out.minWorth, 12);
  assert.equal(out.champInconnuDeLaTable, 7);
  assert.ok(!('valeurMinimale' in out), 'l\'ancien nom ne doit pas survivre');
});

test('les valeurs ne sont jamais touchees, seules les cles', () => {
  // 'titre' comme VALEUR doit rester tel quel : c'est une donnee.
  const out = renameFields({ titre: 'titre', magasin: 'magasin' });
  assert.equal(out.title, 'titre');
  assert.equal(out.store, 'magasin');
});

test('la recursion traverse les objets et les tableaux', () => {
  const out = renameFields(SOURCES_V1);
  const s = out['epic-api'];
  assert.equal(s.lastSuccess, 1756200000000);
  assert.equal(s.consecutiveFailures, 0);
  assert.equal(s.announcedWindows[0].start, 1756800000000);
  assert.equal(s.announcedWindows[0].title, 'Breathedge');
});

test('les cles du catalogue ne sont pas des champs et ne bougent pas', () => {
  const out = renameFields({ 'epic:witchfire': OFFRE_V1, 'gog:titre:xyz': OFFRE_V1 });
  assert.ok('epic:witchfire' in out, 'la cle forte doit survivre');
  assert.ok('gog:titre:xyz' in out, 'la cle faible doit survivre');
});

test('renameFields est idempotent : rejouer la migration ne casse rien', () => {
  const une = renameFields(FILTRES_V1);
  const deux = renameFields(une);
  assert.deepEqual(deux, une);
});

/* ------------------------------------------- les reglages doivent survivre */

test('le seuil de valeur survit a la migration', () => {
  const { minWorth } = renameFields(FILTRES_V1);
  assert.equal(minWorth, 12, 'un seuil perdu revient a zero sans aucune erreur');
});

test('tous les filtres de l\'utilisateur survivent', () => {
  const out = renameFields(FILTRES_V1);
  assert.equal(out.minWorth, 12);
  assert.equal(out.claimWithoutWorth, false);
  assert.equal(out.claimExtraContent, true);
  assert.deepEqual(out.allowedStores, ['epic', 'gog']);
  assert.deepEqual(out.excludedTitles, ['bundle test']);
});

test('le plancher et l\'autonomie survivent', () => {
  const out = renameFields(REGLAGES_V1);
  assert.equal(out.floorPerDay, 8);
  assert.equal(out.autonomousClaim, false, 'false est une decision, pas une absence');
});

test('une offre du catalogue garde tous ses champs sous leurs nouveaux noms', () => {
  const out = renameFields(OFFRE_V1);
  assert.equal(out.title, 'Witchfire');
  assert.equal(out.store, 'epic');
  assert.equal(out.storeId, 'witchfire');
  assert.equal(out.start, 1756200000000);
  assert.equal(out.end, 1756800000000);
  assert.equal(out.worth, '$39.99');
  assert.equal(out.state, 'confirmed');
  assert.equal(out.notifiedAt, 1756200600000);
  assert.equal(out.catalogKey, 'epic:witchfire');
  // null n'est pas la meme chose que false : « on ne sait pas » doit survivre.
  assert.equal(out.alreadyOwned, null);
  // Aucun champ ne doit rester en francais.
  for (const k of Object.keys(out)) {
    assert.ok(!(k in FIELD_RENAMES), `champ non migre : ${k}`);
  }
});

/* ---------------------------------------------------------- buildV2Patch */

test('une cle absente n\'est pas creee', () => {
  const { patch } = buildV2Patch({});
  assert.deepEqual(patch, {}, 'ecrire {} par-dessus rien ferait croire a une initialisation');
});

test('une cle deja migree n\'est pas reecrite', () => {
  const dejaAnglais = { 'veille:filtres': { minWorth: 12 } };
  const { patch, changed } = buildV2Patch(dejaAnglais);
  assert.equal(changed, 0);
  assert.deepEqual(patch, {});
});

test('le correctif couvre chaque cle qui porte des champs francais', () => {
  const stored = {
    'veille:reglages': REGLAGES_V1,
    'veille:filtres': FILTRES_V1,
    'veille:offres': { 'epic:witchfire': OFFRE_V1 },
    'veille:etat': ETAT_V1,
    'veille:sources': SOURCES_V1,
  };
  const { patch, changed } = buildV2Patch(stored);
  assert.equal(changed, 5);
  for (const key of Object.keys(stored)) assert.ok(key in patch, `${key} absent du correctif`);
  assert.equal(patch['veille:etat'].lastCycle, 1756200000000);
  assert.equal(patch['veille:etat'].unseen, 3);
});

test('MIGRATED_KEYS ne cite que des cles de la veille', () => {
  for (const k of MIGRATED_KEYS) {
    assert.ok(k.startsWith('veille:'), `${k} n'est pas une cle de la veille`);
  }
});

/* ------------------------------------------------------------- checkSchema */

test('checkSchema migre et pose la version dans la meme ecriture', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({
    'veille:schema': 1,
    'veille:filtres': FILTRES_V1,
    'veille:reglages': REGLAGES_V1,
  });

  const out = await checkSchema(chrome);
  assert.equal(out.state, SCHEMA.MIGRATED);
  assert.equal(out.from, 1);
  assert.equal(out.version, SCHEMA_VERSION);
  assert.equal(out.changed, 2);

  const apres = await chrome.storage.local.get(['veille:schema', 'veille:filtres', 'veille:reglages']);
  assert.equal(apres['veille:schema'], SCHEMA_VERSION);
  assert.equal(apres['veille:filtres'].minWorth, 12);
  assert.equal(apres['veille:reglages'].floorPerDay, 8);
});

test('une seconde passe de checkSchema ne touche plus a rien', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ 'veille:schema': 1, 'veille:filtres': FILTRES_V1 });
  await checkSchema(chrome);
  const apres1 = await chrome.storage.local.get('veille:filtres');

  const out = await checkSchema(chrome);
  assert.equal(out.state, SCHEMA.OK);
  const apres2 = await chrome.storage.local.get('veille:filtres');
  assert.deepEqual(apres2, apres1);
});

test('une installation neuve est initialisee, pas migree', async () => {
  const { chrome } = fakeChrome();
  const out = await checkSchema(chrome);
  assert.equal(out.state, SCHEMA.INITIALISED);
  const { [KEYS.SCHEMA]: v } = await chrome.storage.local.get(KEYS.SCHEMA);
  assert.equal(v, SCHEMA_VERSION);
});

test('un schema plus recent que le code arrete la veille au lieu de la casser', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ 'veille:schema': SCHEMA_VERSION + 5 });
  const out = await checkSchema(chrome);
  assert.equal(out.state, SCHEMA.TOO_RECENT);
  assert.match(out.message, /version/);
});

/* ------------------------------------------------- coherence avec la table */

test('la table de champs est injective, sinon deux champs se recouvrent', () => {
  const vus = new Map();
  for (const [avant, apres] of Object.entries(FIELD_RENAMES)) {
    // Une cible partagee ecraserait un champ par un autre pendant la migration.
    assert.ok(!vus.has(apres), `« ${vus.get(apres)} » et « ${avant} » visent « ${apres} »`);
    vus.set(apres, avant);
  }
});

test('la table ne renomme aucun champ vers un nom encore francais', () => {
  for (const [avant, apres] of Object.entries(FIELD_RENAMES)) {
    assert.ok(!(apres in FIELD_RENAMES), `« ${avant} » -> « ${apres} », qui est encore une source`);
  }
});
