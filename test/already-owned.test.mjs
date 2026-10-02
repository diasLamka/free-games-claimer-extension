/* Un jeu qu'on possede ne se recupere qu'UNE fois (2.106.0).
 *
 * Signale : « pour GOG, et peut-etre les autres, il faut le recuperer une seule fois
 * alors que la c'est a l'infini ; il faut verifier pour chaque magasin si c'est deja
 * recupere, et ne plus le demander ».
 *
 * La cause, mesuree en vrai Chromium (loop-e2e) : une page qui ne disait pas « dans
 * la bibliotheque » -- le jeu deja a vous avec un simple bouton « Jouer », ou l'offre
 * finie -- sortait du moteur en « montrez-moi le bouton », verdict qui ne s'abandonnait
 * jamais. A chaque tentative : un onglet ouvert dans la fenetre de l'utilisateur, la
 * meme question, pour un jeu qu'il avait deja.
 *
 * Ce qui est tenu ici : la question est posee AU PLUS UNE FOIS par offre ; une page qui
 * n'offre rien se confirme deux fois puis cesse ; le compte du magasin est interroge
 * AVANT d'ouvrir un onglet ; et un jeu reconnu a vous ne revient pas, meme sous une
 * autre cle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { claimWhatCanBe, claimCandidates } from '../watch/cycle.js';
import { makeOffer } from '../watch/offer.js';
import {
  VERDICTS, FINAL_VERDICTS, MAX_ATTEMPTS, MAX_ASKS, ASK_WAIT_MS, GONE_CONFIRM_MS, GONE_RECHECK_MS, alreadyAsked,
} from '../watch/claim.js';
import { KEY_DEJA, VIA, MAX_DEJA, KEEP_MS, dejaKey, readDeja, dejaKeys, remember, mergeDeja } from '../watch/deja.js';
import { BACKUP_KEYS, planRestore, snapshot } from '../watch/full-backup.js';
import {
  sameTitle, gogSearchUrl, readSearch, listHas, collectionHas, accountOwns, ORACLE_STORES, SEARCH_TIMEOUT_MS,
} from '../watch/owned-check.js';
import { ANSWERS, settleByAnswer, resetForTeaching, teachBannerInPage, showTeachBanner } from '../watch/teach.js';
import { CONTENT_MESSAGES, messageAllowed } from '../watch/messaging.js';
import { retryNow } from '../watch/commands.js';
import { KEYS } from '../watch/storage.js';
import { classify, KINDS } from '../watch/canary.js';
import { makeOutcome, OUTCOMES } from '../watch/outcomes.js';
import { fakeChrome } from './fake-chrome.mjs';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const H = 3600 * 1000;
const J = 24 * H;

/* Le cycle date ses marques avec Date.now() (voir `commence` dans claimWhatCanBe) : l'horloge
   du test est donc posee a l'instant du cycle, et rendue a la fin. */
const vraieHorloge = Date.now;
let horloge = NOW;
Date.now = () => horloge;
test.after(() => { Date.now = vraieHorloge; });

const gogOffer = (id, title, extra = {}) => ({
  ...makeOffer({ source: 'gog', sourceId: id, store: 'gog', storeId: id, title, url: `https://www.gog.com/en/game/${id}`, end: NOW + 5 * J, ...extra }),
  catalogKey: `gog:${id}`,
});
const epicOffer = (id, title) => ({
  ...makeOffer({ source: 'epic-api', sourceId: id, store: 'epic', storeId: id, title, url: `https://store.epicgames.com/p/${id}`, end: NOW + 5 * J }),
  catalogKey: `epic:${id}`,
});

/* Une reclamation de test : rend, tour a tour, les verdicts donnes, et note ce qu'on lui a demande. */
function scenario(verdicts) {
  const appels = [];
  let i = 0;
  const claim = async (offer, opts) => {
    appels.push({ key: offer.catalogKey, teach: opts.teach, force: opts.force });
    const v = verdicts[Math.min(i++, verdicts.length - 1)];
    return typeof v === 'string' ? { verdict: v, details: null } : v;
  };
  return { appels, claim };
}

async function cycle(fc, catalog, { now = NOW, claim, ownerCheck, forced = false, library = null, collection = null, stores = ['gog', 'epic', 'amazon'] } = {}) {
  horloge = now;
  return claimWhatCanBe({
    chrome: fc.chrome,
    now,
    catalog,
    filters: {},
    claimableStores: stores,
    watchedStores: stores,
    cadence: [],
    maxReclamations: 3,
    library,
    collection,
    claim,
    ownerCheck,
    forced,
  });
}

/* ------------------------------------------------------- la memoire « deja a vous » */

test('la memoire garde un constat par magasin et titre normalise, borne et periment', () => {
  assert.equal(dejaKey('gog', 'Hades™ (GOG) Giveaway'), 'gog|hades');
  assert.equal(dejaKey('', 'x'), null);
  assert.equal(dejaKey('gog', '   '), null);

  const a = remember({}, { store: 'gog', title: 'Hades', via: VIA.ACCOUNT }, NOW);
  assert.equal(a.added, true);
  assert.deepEqual(Object.keys(a.deja), ['gog|hades']);
  const b = remember(a.deja, { store: 'gog', title: 'HADES', via: VIA.ANSWER }, NOW + 1);
  assert.equal(b.added, false, 'deja note : rien a ecrire');
  assert.equal(b.deja['gog|hades'].via, VIA.ACCOUNT, 'le premier constat reste');
  assert.equal(remember(a.deja, { store: 'epic', title: 'Hades' }, NOW).added, true, 'un autre magasin est un autre constat');

  // Borne : les plus anciens sortent.
  let m = {};
  for (let i = 0; i < MAX_DEJA + 20; i++) m = remember(m, { store: 'gog', title: `Jeu ${i}` }, NOW + i).deja;
  assert.equal(Object.keys(m).length, MAX_DEJA);
  assert.ok(!('gog|jeu 0' in m), 'le plus ancien est sorti');
  assert.ok(`gog|jeu ${MAX_DEJA + 19}` in m);

  // Peremption : un jeu rembourse doit pouvoir revenir.
  const vieux = { 'gog|hades': { ts: NOW - KEEP_MS - 1, via: VIA.ACCOUNT, title: 'Hades' } };
  assert.deepEqual(readDeja(vieux, NOW), {});
  assert.equal(dejaKeys(vieux, NOW).size, 0);
});

test('la memoire lue du stockage ne croit rien : cles invalides, dates fausses, objets etrangers', () => {
  assert.deepEqual(readDeja(null), {});
  assert.deepEqual(readDeja('texte'), {});
  assert.deepEqual(readDeja([1, 2]), {});
  const sale = readDeja({
    'gog|ok': { ts: NOW, via: 'inconnu', title: 'x'.repeat(500) },
    'pas-une-cle': { ts: NOW },
    'epic|sans date': { via: 'account' },
    'epic|nul': null,
  });
  assert.deepEqual(Object.keys(sale), ['gog|ok']);
  assert.equal(sale['gog|ok'].via, VIA.PAGE, 'un « via » inconnu devient « page »');
  assert.equal(sale['gog|ok'].title.length, 120);
});

/* ---------------------------------------------------- la question au compte du magasin */

test('deux titres ne sont le meme jeu que s\'ils sont IDENTIQUES (editions et casse pres)', () => {
  assert.ok(sameTitle('Hades', 'HADES'));
  assert.ok(sameTitle('Hades™', 'Hades'));
  assert.ok(sameTitle('Hades (GOG) Giveaway', 'Hades'), 'le suffixe de l\'agregateur n\'est pas le jeu');
  assert.ok(sameTitle('Cyberpunk 2077 - Standard Edition', 'Cyberpunk 2077'));
  assert.ok(sameTitle('Pillars of Eternity: Definitive Edition', 'Pillars of Eternity'));
  // Un faux « deja a vous » fait rater un jeu offert : jamais « l'un dans l'autre ».
  assert.ok(!sameTitle('Civilization', 'Civilization VI'));
  assert.ok(!sameTitle('Hades', 'Hades II'));
  assert.ok(!sameTitle('Cyberpunk 2077', 'Cyberpunk 2077: Phantom Liberty'));
  assert.ok(!sameTitle('', ''));
  assert.ok(!sameTitle('Hades', ''));
});

test('l\'adresse de recherche GOG : la bibliotheque, une page, le titre nettoye et borne', () => {
  const u = new URL(gogSearchUrl('Sid Meier\'s Civilization (GOG) Giveaway'));
  assert.equal(u.origin + u.pathname, 'https://www.gog.com/account/getFilteredProducts');
  assert.equal(u.searchParams.get('mediaType'), '1');
  assert.equal(u.searchParams.get('page'), '1');
  assert.equal(u.searchParams.get('search'), 'Sid Meier\'s Civilization');
  assert.equal(new URL(gogSearchUrl('x'.repeat(300))).searchParams.get('search').length, 80);
  assert.equal(new URL(gogSearchUrl(null)).searchParams.get('search'), '');
});

test('une reponse de la bibliotheque se lit ou ne se lit pas ; jamais « pas a vous » par defaut', () => {
  assert.deepEqual(readSearch({ products: [{ title: 'Hades' }, { id: 3 }, null] }), { readable: true, titles: ['Hades'] });
  assert.equal(readSearch({ products: [] }).readable, true);
  assert.equal(readSearch({ message: 'Full authentication is required' }).readable, false);
  assert.equal(readSearch(null).readable, false);
  assert.equal(readSearch('<html>').readable, false);
  assert.ok(listHas('Hades', ['Celeste', 'HADES']));
  assert.ok(!listHas('Hades', ['Hades II']));
});

function reponseJson(corps, { ok = true } = {}) {
  return async () => ({ ok, status: ok ? 200 : 403, text: async () => (typeof corps === 'string' ? corps : JSON.stringify(corps)) });
}

test('le compte GOG dit « a vous » : la recherche, avec la session, une seule page', async () => {
  const vus = [];
  const fetch = async (url, init) => { vus.push({ url, init }); return reponseJson({ products: [{ title: 'Bounty Train' }, { title: 'Hades' }], totalPages: 1 })(); };
  const r = await accountOwns(gogOffer('hades', 'Hades'), { fetch });
  assert.deepEqual({ owns: r.owns, via: r.via }, { owns: true, via: 'account' });
  assert.equal(vus.length, 1);
  assert.equal(vus[0].init.credentials, 'include', 'avec VOTRE session');
  assert.equal(vus[0].init.headers.Accept, 'application/json');
  assert.ok(!('method' in vus[0].init) || vus[0].init.method === 'GET', 'une lecture, rien d\'envoye');
});

test('tout le reste est « on ne sait pas » (null), et ne bloque rien', async () => {
  const offre = gogOffer('hades', 'Hades');
  const cas = {
    'titre absent de la reponse': reponseJson({ products: [{ title: 'Celeste' }] }),
    'recherche ignoree par le magasin (autre page de titres)': reponseJson({ products: [{ title: 'Hades II' }, { title: 'Hadean' }] }),
    'session absente (403 JSON)': reponseJson({ message: 'Full authentication is required' }, { ok: false }),
    'page de connexion (HTML)': reponseJson('<html><title>Connexion</title></html>'),
    'forme inattendue': reponseJson({ games: [] }),
    'corps vide': reponseJson(''),
    'reseau coupe': async () => { throw new Error('Failed to fetch'); },
    'reponse sans texte': async () => ({ ok: true, text: async () => { throw new Error('boum'); } }),
  };
  for (const [nom, fetch] of Object.entries(cas)) assert.equal(await accountOwns(offre, { fetch }), null, nom);
  assert.equal(await accountOwns(offre, {}), null, 'sans fetch injecte : aucune requete');
  assert.equal(await accountOwns(null, { fetch: reponseJson({ products: [{ title: 'Hades' }] }) }), null);
  assert.equal(await accountOwns({ store: 'gog', title: '' }, { fetch: reponseJson({ products: [] }) }), null);
});

test('seul GOG a une adresse qui repond ; les autres magasins ne recoivent aucune requete', async () => {
  assert.deepEqual([...ORACLE_STORES], ['gog']);
  let appels = 0;
  const fetch = async () => { appels++; return reponseJson({ products: [{ title: 'Hades' }] })(); };
  for (const store of ['epic', 'amazon', 'steam']) {
    assert.equal(await accountOwns({ store, title: 'Hades' }, { fetch }), null, store);
  }
  assert.equal(appels, 0);
  assert.ok(SEARCH_TIMEOUT_MS <= 20000, 'une requete du worker ne dure pas plus que celles de l\'import');
});

test('la collection importee repond d\'abord, sans requete ; une collection jamais importee ne dit rien', async () => {
  const collection = {
    stores: { gog: { lastOk: NOW - J, count: 2 } },
    items: {
      'gog:1': { store: 'gog', id: '1', title: 'Hades', kind: 'game' },
      'gog:2': { store: 'gog', id: '2', title: 'Celeste', kind: 'game' },
    },
  };
  assert.ok(collectionHas(collection, 'gog', 'Hades (GOG) Giveaway'));
  assert.ok(!collectionHas(collection, 'gog', 'Hades II'));
  assert.ok(!collectionHas(collection, 'epic', 'Hades'), 'un autre magasin');
  assert.ok(!collectionHas({ stores: { gog: { lastOk: null } }, items: collection.items }, 'gog', 'Hades'), 'jamais importee avec succes');
  assert.ok(!collectionHas(null, 'gog', 'Hades'));
  let appels = 0;
  const r = await accountOwns(gogOffer('1', 'Hades'), { collection, fetch: async () => { appels++; return null; } });
  assert.equal(r.via, 'collection');
  assert.equal(appels, 0);
});

/* ------------------------------------- avant d'ouvrir un onglet : le jeu est deja a vous */

test('le compte dit « a vous » : aucun onglet, aucun jeton, offre close, jeu memorise', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = gogOffer('hades', 'Hades');
  const celeste = gogOffer('celeste', 'Celeste');
  const { appels, claim } = scenario([VERDICTS.CLAIMED]);
  const ownerCheck = async (o) => (o.title === 'Hades' ? { owns: true, via: 'account', note: 'deja dans la bibliotheque de votre compte GOG' } : null);

  const r = await cycle(fc, { [hades.catalogKey]: hades, [celeste.catalogKey]: celeste }, { claim, ownerCheck });

  assert.deepEqual(appels.map((a) => a.key), ['gog:celeste'], 'seul l\'autre jeu ouvre un onglet');
  const h = r.catalog['gog:hades'];
  assert.equal(h.verdict, VERDICTS.OWNED);
  assert.equal(h.state, 'resolved');
  assert.equal(h.alreadyOwned, true);
  assert.equal(h.ownedVia, 'account');
  assert.equal(h.nextAttemptAt, null);
  assert.ok(FINAL_VERDICTS.includes(VERDICTS.OWNED));
  assert.equal(r.claims.find((c) => c.catalogKey === 'gog:hades').verdict, VERDICTS.OWNED, 'dit « deja a vous », pas « recupere »');
  assert.equal(r.cadence.length, 1, 'un seul jeton du plafond horaire : celui de Celeste');

  const stocke = (await fc.chrome.storage.local.get(KEY_DEJA))[KEY_DEJA];
  assert.deepEqual(Object.keys(stocke), ['gog|hades']);
  assert.equal(stocke['gog|hades'].via, 'account');
});

test('un jeu reconnu a vous ne revient pas : meme sous une autre cle, sans meme poser la question', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = gogOffer('hades', 'Hades');
  const { claim } = scenario([VERDICTS.CLAIMED]);
  await cycle(fc, { [hades.catalogKey]: hades }, { claim, ownerCheck: async () => ({ owns: true, via: 'account', note: 'x' }) });

  // Plus tard : l'agregateur re-annonce le meme jeu, sous une autre cle, sans identifiant GOG.
  const revenu = { ...makeOffer({ source: 'gamerpower', store: 'gog', title: 'Hades (GOG) Giveaway', url: 'https://www.gog.com/en/game/hades', end: NOW + 3 * J }), catalogKey: 'gamerpower:777' };
  let questions = 0;
  const { appels, claim: claim2 } = scenario([VERDICTS.CLAIMED]);
  const r = await cycle(fc, { [revenu.catalogKey]: revenu }, { now: NOW + 2 * J, claim: claim2, ownerCheck: async () => { questions++; return null; } });
  assert.deepEqual(appels, []);
  assert.equal(questions, 0, 'la memoire repond avant le compte');
  assert.equal(r.catalog['gamerpower:777'].verdict ?? null, null, 'et rien n\'est ecrit sur l\'offre');
});

test('un clic de l\'utilisateur ignore la memoire, mais le compte du magasin reste cru', async () => {
  const fc = fakeChrome({ now: NOW });
  await fc.chrome.storage.local.set({ [KEY_DEJA]: remember({}, { store: 'gog', title: 'Hades' }, NOW - J).deja });
  const hades = gogOffer('hades', 'Hades');

  const { appels, claim } = scenario([VERDICTS.CLAIMED]);
  await cycle(fc, { [hades.catalogKey]: hades }, { claim, forced: true, ownerCheck: async () => null });
  assert.deepEqual(appels.map((a) => a.force), [true], 'la memoire s\'est trompee ? un clic explicite repart de la page');

  const fc2 = fakeChrome({ now: NOW });
  const s2 = scenario([VERDICTS.CLAIMED]);
  const r = await cycle(fc2, { [hades.catalogKey]: hades }, { claim: s2.claim, forced: true, ownerCheck: async () => ({ owns: true, via: 'account', note: 'x' }) });
  assert.deepEqual(s2.appels, []);
  assert.equal(r.catalog['gog:hades'].verdict, VERDICTS.OWNED);
});

test('Steam garde son propre chemin : le compte n\'est jamais interroge pour lui', async () => {
  const fc = fakeChrome({ now: NOW });
  const steam = { ...makeOffer({ source: 'steam', store: 'steam', storeId: '10', packageId: '99', title: 'Jeu Steam', url: 'https://store.steampowered.com/app/10', end: NOW + J }), catalogKey: 'steam:10' };
  const { claim } = scenario([VERDICTS.CLAIMED]);
  let questions = 0;
  await cycle(fc, { [steam.catalogKey]: steam }, { claim, stores: ['steam'], ownerCheck: async () => { questions++; return { owns: true, via: 'account' }; } });
  assert.equal(questions, 0);
});

test('la question au compte ne casse jamais le cycle', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = gogOffer('hades', 'Hades');
  const { appels, claim } = scenario([VERDICTS.CLAIMED]);
  await cycle(fc, { [hades.catalogKey]: hades }, { claim, ownerCheck: async () => { throw new Error('boum'); } });
  assert.deepEqual(appels.map((a) => a.key), ['gog:hades'], 'en cas de doute, la page tranche comme avant');
});

/* --------------------------------------------- « montrez-moi le bouton » : UNE fois par offre */

test('la question « montrez-moi le bouton » est posee une fois, puis plus jamais', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = gogOffer('hades', 'Hades');
  let catalog = { [hades.catalogKey]: hades };
  const { appels, claim } = scenario([VERDICTS.TEACH, VERDICTS.FAILURE, VERDICTS.FAILURE, VERDICTS.FAILURE, VERDICTS.FAILURE, VERDICTS.FAILURE, VERDICTS.FAILURE]);

  // 1. Premier passage : le moteur peut demander.
  let t = NOW;
  let r = await cycle(fc, catalog, { now: t, claim });
  catalog = r.catalog;
  assert.equal(appels[0].teach, true);
  assert.equal(catalog['gog:hades'].verdict, VERDICTS.TEACH);
  assert.equal(catalog['gog:hades'].asks, MAX_ASKS);
  assert.ok(alreadyAsked(catalog['gog:hades']));
  assert.equal(catalog['gog:hades'].nextAttemptAt, t + ASK_WAIT_MS, 'la journee entiere pour repondre');

  // 2. Pas avant : l'onglet qui attend l'utilisateur n'est pas double par un autre.
  r = await cycle(fc, catalog, { now: t + 3 * H, claim });
  assert.equal(appels.length, 1);

  // 3. Les passages suivants ne demandent plus, jusqu'a l'abandon.
  let passes = 0;
  while (passes < 12) {
    const echeance = catalog['gog:hades'].nextAttemptAt;
    if (echeance === null) break;
    t = Math.max(t, echeance) + 1000;
    const avant = appels.length;
    r = await cycle(fc, catalog, { now: t, claim });
    catalog = r.catalog;
    if (appels.length === avant) break;
    assert.equal(appels[appels.length - 1].teach, false, 'plus de question');
    passes++;
  }
  assert.ok(appels.slice(1).every((a) => a.teach === false));
  assert.equal(appels.length, MAX_ATTEMPTS, 'cinq essais au total, puis l\'offre est abandonnee');
  assert.equal(claimCandidates(catalog, {}, { claimableStores: ['gog'], now: t + H }).candidates.length, 0, 'abandonnee, pas seulement en attente');
});

test('une offre ouverte comme avant la 2.106.0 (verdict « a montrer », sans compteur) compte comme deja demandee', () => {
  assert.ok(alreadyAsked({ verdict: VERDICTS.TEACH }));
  assert.ok(alreadyAsked({ asks: 1 }));
  assert.ok(!alreadyAsked({ verdict: VERDICTS.FAILURE }));
  assert.ok(!alreadyAsked(null));
});

test('un clic « Recuperer » de l\'utilisateur peut redemander : il est devant l\'ecran', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = { ...gogOffer('hades', 'Hades'), verdict: VERDICTS.TEACH, asks: 1 };
  const { appels, claim } = scenario([VERDICTS.TEACH]);
  await cycle(fc, { [hades.catalogKey]: hades }, { claim, forced: true });
  assert.equal(appels[0].teach, true);
});

test('apprendre un bouton remet en file aussi les offres deja demandees, puis retentees', () => {
  const catalogue = {
    'gog:a': { store: 'gog', verdict: 'failed', asks: 1, attempts: 3, nextAttemptAt: 99, state: 'queued' },
    'gog:b': { store: 'gog', verdict: 'needs_teaching', attempts: 1, nextAttemptAt: 50, state: 'queued' },
    'gog:c': { store: 'gog', verdict: 'owned', asks: 1, state: 'resolved' },
    'gog:d': { store: 'gog', verdict: 'failed', attempts: 2, state: 'queued' },
  };
  const { catalog, count } = resetForTeaching(catalogue, 'gog', 7);
  assert.equal(count, 2);
  assert.deepEqual([catalog['gog:a'].attempts, catalog['gog:a'].asks, catalog['gog:a'].nextAttemptAt], [0, 0, null]);
  assert.equal(catalog['gog:b'].attempts, 0);
  assert.equal(catalog['gog:c'].verdict, 'owned', 'une offre close ne repart jamais');
  assert.equal(catalog['gog:d'].attempts, 2, 'un echec ordinaire non plus');
});

/* ------------------------------------------------ « rien a prendre » : deux constats, puis fini */

test('« rien a prendre » : un premier constat se reverifie, le second clot l\'offre sans rien demander', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = gogOffer('hades', 'Hades');
  let catalog = { [hades.catalogKey]: hades };
  const { appels, claim } = scenario([{ verdict: VERDICTS.GONE, details: 'rien a prendre sur cette page' }]);

  let r = await cycle(fc, catalog, { now: NOW, claim });
  catalog = r.catalog;
  const o1 = catalog['gog:hades'];
  assert.equal(o1.verdict, VERDICTS.GONE);
  assert.equal(o1.state, 'queued', 'pas encore definitif : une page mal rendue ressemble a une page vide');
  assert.equal(o1.goneAt, NOW);
  assert.equal(o1.nextAttemptAt, NOW + GONE_RECHECK_MS);
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.GONE));
  assert.equal(o1.asks ?? 0, 0, 'et surtout aucune question');

  // Avant le recul : rien.
  r = await cycle(fc, catalog, { now: NOW + H, claim });
  assert.equal(appels.length, 1);

  // Au second constat, assez tard : c'est fini.
  assert.ok(GONE_RECHECK_MS >= GONE_CONFIRM_MS, 'le recul laisse toujours passer le delai de confirmation');
  r = await cycle(fc, catalog, { now: NOW + GONE_RECHECK_MS + 1000, claim });
  const o2 = r.catalog['gog:hades'];
  assert.equal(appels.length, 2);
  assert.equal(o2.state, 'resolved', 'l\'offre est close');
  assert.equal(o2.verdict, VERDICTS.GONE);
  assert.equal(o2.nextAttemptAt, null);
  assert.equal(claimCandidates(r.catalog, {}, { claimableStores: ['gog'], now: NOW + 40 * J }).candidates.length, 0, 'et elle ne revient pas');
});

test('deux constats trop proches ne closent pas ; un constat contraire efface le premier', async () => {
  const fc = fakeChrome({ now: NOW });
  const hades = { ...gogOffer('hades', 'Hades'), goneAt: NOW - 30 * 60 * 1000, verdict: VERDICTS.GONE };
  const s = scenario([VERDICTS.GONE]);
  let r = await cycle(fc, { [hades.catalogKey]: hades }, { now: NOW, claim: s.claim });
  assert.equal(r.catalog['gog:hades'].state, 'queued', 'une demi-heure d\'ecart ne vaut pas deux constats');
  assert.equal(r.catalog['gog:hades'].goneAt, NOW - 30 * 60 * 1000, 'le premier constat garde sa date');

  const s2 = scenario([VERDICTS.FAILURE]);
  r = await cycle(fc, { [hades.catalogKey]: hades }, { now: NOW, claim: s2.claim });
  assert.equal(r.catalog['gog:hades'].goneAt, null, 'une page qui reparle : le constat tombe');
});

test('« rien a prendre » n\'accuse pas le magasin pour le canari', () => {
  assert.equal(classify('gone'), KINDS.OTHER);
  assert.equal(classify('owned'), KINDS.OTHER);
  assert.equal(classify('needs_teaching'), KINDS.SELECTOR);
});

test('« Reessayer » rouvre une offre close par « rien a prendre » et lui rend sa question', async () => {
  const fc = fakeChrome({ now: NOW });
  const o = { ...gogOffer('hades', 'Hades'), verdict: VERDICTS.GONE, state: 'resolved', attempts: 2, asks: 1, goneAt: NOW - J };
  await fc.chrome.storage.local.set({ [KEYS.OFFERS]: { [o.catalogKey]: o } });
  const r = await retryNow({ chrome: fc.chrome, catalogKey: o.catalogKey, now: NOW });
  assert.equal(r.retried, true);
  const apres = (await fc.chrome.storage.local.get(KEYS.OFFERS))[KEYS.OFFERS][o.catalogKey];
  assert.equal(apres.state, 'queued');
  assert.equal(apres.verdict, null);
  assert.deepEqual([apres.attempts, apres.asks, apres.goneAt], [0, 0, null]);
  assert.equal(claimCandidates({ [o.catalogKey]: apres }, {}, { claimableStores: ['gog'], now: NOW }).candidates.length, 1);

  // Un jeu deja a vous, lui, reste a vous.
  const possede = { ...gogOffer('celeste', 'Celeste'), verdict: VERDICTS.OWNED, state: 'resolved', alreadyOwned: true };
  await fc.chrome.storage.local.set({ [KEYS.OFFERS]: { [possede.catalogKey]: possede } });
  await retryNow({ chrome: fc.chrome, catalogKey: possede.catalogKey, now: NOW });
  const reste = (await fc.chrome.storage.local.get(KEYS.OFFERS))[KEYS.OFFERS][possede.catalogKey];
  assert.equal(reste.state, 'resolved');
  assert.equal(reste.verdict, VERDICTS.OWNED);
});

/* --------------------------------- le bandeau : « c'est deja a moi », « plus offert » */

test('repondre « deja a moi » clot l\'offre, « plus offert » aussi ; une cle ou une reponse inconnue ne fait rien', () => {
  const o = { store: 'gog', title: 'Hades', verdict: 'needs_teaching', state: 'queued', attempts: 1, asks: 1, nextAttemptAt: 5 };
  const catalogue = { 'gog:hades': o };

  const a = settleByAnswer(catalogue, 'gog:hades', ANSWERS.OWNED, NOW);
  assert.equal(a.offer.verdict, 'owned');
  assert.equal(a.offer.state, 'resolved');
  assert.equal(a.offer.alreadyOwned, true);
  assert.equal(a.offer.ownedVia, 'answer');
  assert.equal(a.offer.nextAttemptAt, null);
  assert.equal(catalogue['gog:hades'].verdict, 'needs_teaching', 'le catalogue d\'origine reste intact');

  const b = settleByAnswer(catalogue, 'gog:hades', ANSWERS.GONE, NOW);
  assert.equal(b.offer.verdict, 'gone');
  assert.equal(b.offer.state, 'resolved');
  assert.ok(!('alreadyOwned' in b.offer), '« plus offert » ne dit rien de ce que vous possedez');

  assert.equal(settleByAnswer(catalogue, 'gog:inconnu', ANSWERS.OWNED, NOW).offer, null);
  assert.equal(settleByAnswer(catalogue, 'gog:hades', 'n\'importe quoi', NOW).offer, null);
  assert.equal(settleByAnswer(catalogue, null, ANSWERS.OWNED, NOW).offer, null);
  assert.deepEqual(settleByAnswer(null, 'x', ANSWERS.OWNED, NOW), { catalog: {}, offer: null });
});

test('la reponse du bandeau ne vient que d\'un script de contenu', () => {
  assert.ok(CONTENT_MESSAGES.includes('fgc-reponse'));
  assert.equal(messageAllowed('fgc-reponse', 'content'), true);
  assert.equal(messageAllowed('fgc-reponse', 'page'), false);
  assert.equal(messageAllowed('fgc-reponse', 'inconnu'), false);
});

function faussePage() {
  const ajoutes = [];
  const messages = [];
  const doc = {
    getElementById: () => null,
    createElement: () => ({
      style: {}, children: [], attrs: {}, listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(c) { this.children.push(c); },
      addEventListener(t, f) { this.listeners[t] = f; },
      attachShadow() { this.shadow = { children: [], appendChild(c) { this.children.push(c); } }; return this.shadow; },
      remove() { this.removed = true; },
    }),
    documentElement: { appendChild: (c) => ajoutes.push(c) },
  };
  return { doc, ajoutes, messages };
}

test('le bandeau porte deux reponses ; seul un VRAI clic envoie, et le bandeau disparait', () => {
  const { doc, ajoutes, messages } = faussePage();
  global.document = doc;
  global.chrome = { runtime: { sendMessage: (m) => messages.push(m) } };
  try {
    assert.equal(teachBannerInPage('Cliquez', 'C\'est deja a moi', 'Plus offert'), true);
    const barre = ajoutes[0].shadow.children[0];
    // [0] fermer (inchange), puis les deux reponses.
    assert.equal(barre.children.length, 3);
    const [, oui, fini] = barre.children;
    assert.equal(oui.textContent, 'C\'est deja a moi');
    assert.equal(fini.textContent, 'Plus offert');

    // La page ne peut pas cliquer pour vous : un evenement fabrique est ignore.
    oui.listeners.click({ isTrusted: false });
    oui.listeners.click({});
    oui.listeners.click();
    assert.deepEqual(messages, []);
    assert.equal(ajoutes[0].removed, undefined);

    oui.listeners.click({ isTrusted: true });
    assert.deepEqual(messages, [{ type: 'fgc-reponse', answer: 'owned' }]);
    assert.equal(ajoutes[0].removed, true);
    fini.listeners.click({ isTrusted: true });
    assert.deepEqual(messages[1], { type: 'fgc-reponse', answer: 'gone' });
  } finally {
    delete global.document;
    delete global.chrome;
  }
});

test('sans libelles, le bandeau est celui d\'avant ; la reponse perdue (worker parti) ne casse rien', () => {
  const { doc, ajoutes } = faussePage();
  global.document = doc;
  global.chrome = { runtime: { sendMessage: () => { throw new Error('Extension context invalidated'); } } };
  try {
    assert.equal(teachBannerInPage('Cliquez'), true);
    assert.equal(ajoutes[0].shadow.children[0].children.length, 1, 'seulement la croix');
    const { doc: doc2, ajoutes: aj2 } = faussePage();
    global.document = doc2;
    teachBannerInPage('x', 'Oui', '');
    const barre = aj2[0].shadow.children[0];
    assert.equal(barre.children.length, 2, 'une reponse sans libelle n\'est pas posee');
    assert.doesNotThrow(() => barre.children[1].listeners.click({ isTrusted: true }));
    assert.equal(aj2[0].removed, true);
  } finally {
    delete global.document;
    delete global.chrome;
  }
});

test('showTeachBanner passe les libelles de reponse au script injecte', async () => {
  const appels = [];
  const chrome = { scripting: { executeScript: async (o) => { appels.push(o); } } };
  assert.equal(await showTeachBanner(chrome, 3, 'Bonjour', { owned: 'Deja a moi', gone: 'Plus offert' }), true);
  assert.deepEqual(appels[0].args, ['Bonjour', 'Deja a moi', 'Plus offert']);
  assert.equal(await showTeachBanner(chrome, 3, 'Bonjour'), true);
  assert.deepEqual(appels[1].args, ['Bonjour'], 'sans reponses : comme avant');
  assert.equal(await showTeachBanner(chrome, 3, 'Bonjour', {}), true);
  assert.deepEqual(appels[2].args, ['Bonjour']);
});

/* ------------------------------------------------------------ la sauvegarde */

test('la memoire « deja a vous » suit la sauvegarde complete, par union', () => {
  assert.ok(BACKUP_KEYS.includes(KEY_DEJA));
  const local = remember({}, { store: 'gog', title: 'Hades', via: VIA.ACCOUNT }, NOW - J).deja;
  const fichier = remember(remember({}, { store: 'gog', title: 'Hades', via: VIA.ANSWER }, NOW).deja, { store: 'epic', title: 'Celeste' }, NOW).deja;

  const m = mergeDeja(local, fichier, NOW);
  assert.deepEqual(Object.keys(m.value).sort(), ['epic|celeste', 'gog|hades']);
  assert.equal(m.added, 1, 'seul le nouveau compte');
  assert.equal(m.value['gog|hades'].via, VIA.ACCOUNT, 'ce qui est deja la reste');

  const plan = planRestore({ [KEY_DEJA]: local }, { [KEY_DEJA]: fichier }, { now: NOW });
  assert.equal(plan.added[KEY_DEJA], 1);
  assert.deepEqual(Object.keys(plan.write[KEY_DEJA]).sort(), ['epic|celeste', 'gog|hades']);
  assert.deepEqual(Object.keys(snapshot({ [KEY_DEJA]: local })), [KEY_DEJA]);

  // Un fichier etranger ou abime n'ecrit rien de faux.
  assert.deepEqual(mergeDeja(local, 'pas un objet', NOW).value, readDeja(local, NOW));
  assert.equal(mergeDeja(null, null, NOW).added, 0);
});

test('un jeu « deja a vous » est au compte pour les issues ; « rien a prendre » reste incertain', () => {
  const o = { store: 'gog', title: 'Hades', state: 'resolved', end: NOW + J };
  assert.equal(makeOutcome({ ...o, verdict: 'owned' }, { now: NOW }).outcome, OUTCOMES.TAKEN);
  assert.equal(makeOutcome({ ...o, verdict: 'gone' }, { now: NOW }).outcome, OUTCOMES.UNKNOWN);
});
