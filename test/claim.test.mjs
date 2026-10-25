/* Tests de l'orchestrateur de reclamation.
 *
 * Chaque test correspond a une facon dont la reclamation autonome peut mal
 * tourner sur un vrai compte, ou laisser des traces derriere elle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  VERDICTS,
  FINAL_VERDICTS,
  KEY_TABS,
  MAX_PER_HOUR,
  claimOffer,
  reportVerdict,
  awaitVerdict,
  markPiloted,
  forgetPiloted,
  isPiloted,
  sweepTabs,
  hasRoom,
  recordClaim,
} from '../watch/claim.js';
import { makeOffer, STORES } from '../watch/offer.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const SUPPORTES = [STORES.EPIC, STORES.GOG, STORES.AMAZON];

/**
 * Un faux chrome dote d'onglets scriptables : chaque onglet cree joue un
 * scenario -- il s'annonce ou non, rend tel verdict, atterrit sur telle URL.
 */
function fauxAvecOnglets(scenario = {}) {
  const faux = fakeChrome({ now: T });
  const onglets = new Map();
  let prochainId = 100;
  const ouverts = [];
  const closed = [];
  const ordres = [];

  faux.chrome.tabs = {
    async create({ url }) {
      const id = prochainId++;
      onglets.set(id, { id, url: scenario.urlAtterrissage || url, status: 'complete' });
      ouverts.push({ id, url });
      // Le content script s'annonce peu apres le chargement.
      if (scenario.sAnnonce !== false) {
        setTimeout(() => reportVerdict(id, 'fgc-pret', { url }), 5);
      }
      return { id };
    },
    async get(id) {
      const t = onglets.get(id);
      if (!t) throw new Error('onglet inconnu');
      return t;
    },
    async remove(id) { onglets.delete(id); closed.push(id); },
    async sendMessage(id, msg) {
      ordres.push({ id, msg });
      if (scenario.ordreEchoue) throw new Error('Receiving end does not exist');
      if (scenario.verdict) {
        setTimeout(() => reportVerdict(id, 'fgc-verdict', { verdict: scenario.verdict, reasonText: scenario.reasonText, page: scenario.page }), 5);
      }
      return { recu: true };
    },
    onUpdated: { addListener() {}, removeListener() {} },
  };

  return { faux, onglets, ouverts, closed, ordres };
}

const offreEpic = (extra = {}) => makeOffer({
  source: 'epic-api', store: STORES.EPIC, storeId: 'cardpocalypse',
  title: 'Cardpocalypse', url: 'https://store.epicgames.com/p/cardpocalypse?lang=fr',
  ...extra,
});

const offreAgregateur = (extra = {}) => makeOffer({
  source: 'gamerpower', store: STORES.EPIC, title: 'Un Jeu (Epic Games) Giveaway',
  resolveUrl: 'https://www.gamerpower.com/open/un-jeu', ...extra,
});

const options = (faux) => ({
  chrome: faux.chrome, now: T, supportedStores: SUPPORTES, budgetMs: 2000,
});

/* --------------------------------------------------------- cas nominal */

test('une offre a URL connue est reclamee et l\'onglet se referme', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.CLAIMED });
  const r = await claimOffer(offreEpic(), options(ctx.faux));

  assert.equal(r.verdict, VERDICTS.CLAIMED);
  assert.equal(ctx.ouverts.length, 1);
  assert.equal(ctx.ouverts[0].url, 'https://store.epicgames.com/p/cardpocalypse?lang=fr');
  assert.equal(ctx.closed.length, 1, 'l\'onglet n\'a pas ete referme');
  assert.equal(ctx.ordres.length, 1);
  assert.equal(ctx.ordres[0].msg.type, 'fgc-reclame');
});

test('l\'onglet est ouvert en arriere-plan, jamais au premier plan', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.CLAIMED });
  let actifDemande = null;
  const creerOrigine = ctx.faux.chrome.tabs.create;
  ctx.faux.chrome.tabs.create = async (params) => { actifDemande = params.active; return creerOrigine(params); };

  await claimOffer(offreEpic(), options(ctx.faux));
  assert.equal(actifDemande, false, 'l\'onglet volerait le focus');
});

test('l\'onglet ne reste pas marque comme pilote apres coup', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.CLAIMED });
  await claimOffer(offreEpic(), options(ctx.faux));
  const remainingCount = ctx.faux.payload('session')[KEY_TABS];
  assert.deepEqual(remainingCount, {}, 'un marqueur d\'onglet a survecu');
});

/* --------------------------------------------------------- resolution */

test('une offre de l\'agregateur est resolue par l\'atterrissage de l\'onglet', async () => {
  // L'agregateur ne publie jamais l'URL du magasin, et sa redirection repond
  // 403 hors navigateur : ouvrir l'onglet EST l'etape de resolution.
  const ctx = fauxAvecOnglets({
    urlAtterrissage: 'https://store.epicgames.com/p/un-jeu',
    verdict: VERDICTS.CLAIMED,
  });
  const r = await claimOffer(offreAgregateur(), options(ctx.faux));

  assert.equal(r.verdict, VERDICTS.CLAIMED);
  assert.equal(r.resolvedUrl, 'https://store.epicgames.com/p/un-jeu');
  assert.equal(r.store, STORES.EPIC);
  assert.equal(ctx.ouverts[0].url, 'https://www.gamerpower.com/open/un-jeu');
});

test('un atterrissage hors perimetre se ferme sans rien cliquer', async () => {
  // Cas mesure : une offre « Steam key » atterrit sur alienwarearena.com, un
  // site a compte et formulaire.
  const ctx = fauxAvecOnglets({
    urlAtterrissage: 'https://fr.alienwarearena.com/ucf/show/2175676/',
    verdict: VERDICTS.CLAIMED,
  });
  const r = await claimOffer(offreAgregateur(), options(ctx.faux));

  assert.equal(r.verdict, VERDICTS.OUT_OF_SCOPE);
  assert.equal(r.resolvedUrl, 'https://fr.alienwarearena.com/ucf/show/2175676/');
  assert.equal(ctx.ordres.length, 0, 'un ordre de reclamation a ete envoye hors perimetre');
  assert.equal(ctx.closed.length, 1);
});

test('l\'URL resolue est rendue meme quand la reclamation echoue', async () => {
  // Sans cela, l'offre serait re-resolue a chaque tentative.
  const ctx = fauxAvecOnglets({
    urlAtterrissage: 'https://store.epicgames.com/p/un-jeu',
    verdict: VERDICTS.FAILURE,
  });
  const r = await claimOffer(offreAgregateur(), options(ctx.faux));
  assert.equal(r.resolvedUrl, 'https://store.epicgames.com/p/un-jeu');
});

/* ------------------------------------------------------------ arrets nets */

test('un defi de securite laisse l\'onglet ouvert pour l\'utilisateur', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.CHALLENGE });
  const r = await claimOffer(offreEpic(), options(ctx.faux));

  assert.equal(r.verdict, VERDICTS.CHALLENGE);
  assert.equal(ctx.closed.length, 0, 'l\'onglet a ete referme alors qu\'il attend un humain');
  assert.ok(r.tabId, 'l\'identifiant de l\'onglet n\'est pas rendu');

  const marque = ctx.faux.payload('session')[KEY_TABS][r.tabId];
  assert.equal(marque.manual, true, 'le balayage des orphelins refermerait cet onglet');
});

test('une session absente rend son verdict sans insister', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.LOGIN });
  const r = await claimOffer(offreEpic(), options(ctx.faux));
  assert.equal(r.verdict, VERDICTS.LOGIN);
  assert.equal(ctx.closed.length, 1);
});

/* --------------------------------------------------------------- pannes */

test('un moteur qui ne s\'annonce pas ne bloque pas l\'orchestrateur', async () => {
  const ctx = fauxAvecOnglets({ sAnnonce: false });
  const r = await claimOffer(offreEpic(), { ...options(ctx.faux), budgetMs: 100 });

  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /annonce/);
  assert.equal(ctx.closed.length, 1, 'l\'onglet est reste ouvert');
}, { timeout: 40000 });

test('un ordre non transmis se solde par un echec, onglet referme', async () => {
  const ctx = fauxAvecOnglets({ ordreEchoue: true });
  const r = await claimOffer(offreEpic(), options(ctx.faux));
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /ordre non transmis/);
  assert.equal(ctx.closed.length, 1);
});

test('un moteur muet finit par rendre la main au bout du budget', async () => {
  // Le chronometre est cote service worker : une page throttlee ne peut pas se
  // surveiller elle-meme.
  const ctx = fauxAvecOnglets({});   // s'annonce mais ne verdicte jamais
  const start = Date.now();
  const r = await claimOffer(offreEpic(), { ...options(ctx.faux), budgetMs: 150 });

  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /aucun verdict/);
  assert.ok(Date.now() - start < 5000, 'l\'orchestrateur a attendu bien au-dela du budget');
  assert.equal(ctx.closed.length, 1);
});

test('une offre sans page a ouvrir est refusee avant tout onglet', async () => {
  const ctx = fauxAvecOnglets({});
  const r = await claimOffer(makeOffer({ title: 'X', store: STORES.EPIC }), options(ctx.faux));
  assert.equal(r.verdict, VERDICTS.BAD_URL);
  assert.equal(ctx.ouverts.length, 0, 'un onglet a ete ouvert pour rien');
});

test('reclamer refuse de travailler sans instant', async () => {
  const ctx = fauxAvecOnglets({});
  await assert.rejects(
    () => claimOffer(offreEpic(), { chrome: ctx.faux.chrome }),
    TypeError,
  );
});

/* --------------------------------------------------------- onglets pilotes */

test('le marquage d\'un onglet pilote se pose, se lit et se retire', async () => {
  const faux = fakeChrome({ now: T });
  assert.equal(await isPiloted(faux.chrome, 42), false);

  await markPiloted(faux.chrome, 42, { expire: T + 1000 });
  assert.equal(await isPiloted(faux.chrome, 42), true);

  await forgetPiloted(faux.chrome, 42);
  assert.equal(await isPiloted(faux.chrome, 42), false);
});

test('le balayage referme les onglets abandonnes, pas les autres', async () => {
  // Sans lui, un crash en pleine reclamation laisserait un onglet ouvert pour
  // toujours, et ils s'accumuleraient.
  const ctx = fauxAvecOnglets({});
  await ctx.faux.chrome.tabs.create({ url: 'https://x.test/perime' });
  await ctx.faux.chrome.tabs.create({ url: 'https://x.test/encours' });
  await ctx.faux.chrome.tabs.create({ url: 'https://x.test/humain' });

  await markPiloted(ctx.faux.chrome, 100, { expire: T - 1 });
  await markPiloted(ctx.faux.chrome, 101, { expire: T + 60000 });
  await markPiloted(ctx.faux.chrome, 102, { manual: true });

  const { closed } = await sweepTabs(ctx.faux.chrome, T);
  assert.equal(closed, 1, 'le balayage n\'a pas ferme exactement l\'onglet perime');
  assert.deepEqual(ctx.closed, [100]);

  const remainingCount = ctx.faux.payload('session')[KEY_TABS];
  assert.ok('101' in remainingCount, 'un onglet en cours a ete oublie');
  assert.ok(!('102' in remainingCount), 'un onglet laisse a l\'utilisateur reste suivi pour rien');
});

/* ------------------------------------------------------------- bus */

test('signaler ne rend vrai que si quelqu\'un attendait', () => {
  assert.equal(reportVerdict(999, 'fgc-pret', {}), false);
});

test('attendre rend null a l\'expiration plutot que de jeter', async () => {
  const r = await awaitVerdict(998, 'fgc-verdict', 30);
  assert.equal(r, null);
});

/* ----------------------------------------------------------- cadence */

test('le plafond horaire compte ce qui est reellement dans l\'heure', () => {
  // Trente reclamations en dix minutes ne ressemblent a rien d'humain.
  const vieilles = Array.from({ length: 20 }, (_, i) => T - 2 * 3600000 - i * 1000);
  const recent = Array.from({ length: 4 }, (_, i) => T - i * 60000);

  const p = hasRoom([...vieilles, ...recent], T);
  assert.equal(p.recent.length, 4);
  assert.equal(p.left, MAX_PER_HOUR - 4);
});

test('le plafond atteint ne laisse plus de place', () => {
  const pleines = Array.from({ length: MAX_PER_HOUR }, (_, i) => T - i * 60000);
  assert.equal(hasRoom(pleines, T).left, 0);
  assert.equal(hasRoom([], T).left, MAX_PER_HOUR);
});

test('enregistrer une reclamation oublie ce qui sort de l\'heure', () => {
  const then = recordClaim([T - 2 * 3600000, T - 60000], T);
  assert.deepEqual(then, [T - 60000, T]);
});

/* -------------------------------------------------------- vocabulaire */

test('les verdicts definitifs ne contiennent rien de reessayable', () => {
  // Un echec ou un defi doivent pouvoir etre retentes ; un jeu deja reclame,
  // non.
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.FAILURE));
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.CHALLENGE));
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.LOGIN));
  assert.ok(FINAL_VERDICTS.includes(VERDICTS.CLAIMED));
  assert.ok(FINAL_VERDICTS.includes(VERDICTS.OUT_OF_SCOPE));
});

/* --------------------------- la page vue pendant l'echec (2.111.0) */

test('le moteur qui echoue joint la page qu\'il voyait, elle arrive jusqu\'au resultat', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.FAILURE, reasonText: 'delai depasse', page: { url: 'https://www.gog.com/redeem', title: 'GOG', text: 'rien de net' } });
  const r = await claimOffer(offreEpic(), options(ctx.faux));
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.equal(r.page.url, 'https://www.gog.com/redeem');
  assert.equal(r.page.text, 'rien de net');
});

test('sans page jointe, le resultat n\'en invente pas', async () => {
  const ctx = fauxAvecOnglets({ verdict: VERDICTS.CLAIMED });
  const r = await claimOffer(offreEpic(), options(ctx.faux));
  assert.equal(r.page, null);
});
