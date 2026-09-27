/* Tests du cycle de veille, joues de bout en bout contre un faux chrome.
 *
 * Chaque test reproduit un mode d'echec identifie a la conception, pas un
 * appel de fonction : c'est ce qui separe un test utile d'un test decoratif.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import { runCycle, toNotify, composeAnnouncement, CREDIBLE_LIST_RATIO } from '../watch/cycle.js';
import { KEYS, readState, checkSchema, SCHEMA, withLease } from '../watch/storage.js';
import { makeOffer, STORES } from '../watch/offer.js';
import { reportVerdict as signalerReclamation } from '../watch/claim.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Une source de test : rend ce qu'on lui dit, sans reseau. */
function sourceFactice(name, reponses, options = {}) {
  let i = 0;
  return {
    name,
    completeList: options.completeList !== false,
    minIntervalMs: options.minIntervalMs || 0,
    appels: 0,
    async discover() {
      this.appels++;
      const r = reponses[Math.min(i, reponses.length - 1)];
      i++;
      return typeof r === 'function' ? r() : r;
    },
  };
}

const offer = (title, extra = {}) => makeOffer({
  source: 'test',
  store: STORES.EPIC,
  storeId: title.toLowerCase().replace(/\W+/g, '-'),
  title,
  url: `https://store.epicgames.com/p/${title.toLowerCase()}`,
  ...extra,
});

const response = (offers) => ({ offers, dropped: [], errors: [] });

async function contexteDeTest(sourcesObj, opts = {}) {
  const faux = fakeChrome({ now: T, ...opts });
  const notifications = [];
  const badges = [];
  const journal = [];

  // Une source doit etre activee dans les reglages pour etre interrogee : le
  // test configure l'extension comme le ferait l'interface.
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: Object.keys(sourcesObj) },
  });

  return {
    faux,
    notifications,
    badges,
    journal,
    async cycle(now, extra = {}) {
      return runCycle({
        chrome: faux.chrome,
        now,
        sources: sourcesObj,
        notify: async (n) => { notifications.push(n); },
        updateBadge: async (n) => { badges.push(n); },
        record: (niveau, message) => journal.push(`${niveau}: ${message}`),
        ...extra,
      });
    },
  };
}

/* ------------------------------------------------------------------ amorcage */

test('le premier cycle remplit le catalogue sans notifier une seule fois', async () => {
  // Vingt notifications a l'installation, dont des offres publiees il y a des
  // annees, et l'utilisateur coupe les notifications pour toujours. Cette
  // erreur-la ne se rattrape pas.
  const src = sourceFactice('test', [response([offer('Jeu A'), offer('Jeu B'), offer('Jeu C')])]);
  const c = await contexteDeTest({ test: src });

  const r = await c.cycle(T);

  assert.equal(r.boot, true);
  assert.equal(c.notifications.length, 0, 'des notifications ont ete envoyees a l\'amorcage');

  const catalog = c.faux.payload()[KEYS.OFFERS];
  assert.equal(Object.keys(catalog).length, 3);
  for (const o of Object.values(catalog)) {
    assert.equal(o.notifiedAt, T, 'une offre d\'amorcage n\'a pas ete marquee annoncee');
  }

  const state = await readState(c.faux.chrome);
  assert.equal(state.booted, true);
});

test('apres l\'amorcage, une offre vraiment nouvelle est annoncee', async () => {
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    response([offer('Jeu A'), offer('Jeu B')]),
  ]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  assert.equal(c.notifications.length, 0);

  await c.cycle(T + DAY, { force: true });
  assert.equal(c.notifications.length, 1);
  // Le nom du jeu est dans le titre depuis la V4 : une notification tronque son
  // corps bien avant son titre.
  const dit = `${c.notifications[0].title} ${c.notifications[0].text}`;
  assert.match(dit, /Jeu B/);
  assert.doesNotMatch(dit, /Jeu A/, 'une offre deja connue a ete re-annoncee');
});

/* --------------------------------------------------------- non-duplication */

test('rejouer le meme cycle n\'annonce pas deux fois la meme offre', async () => {
  // C'est la propriete qui rend le systeme sur : le verrou n'empeche pas la
  // double execution, l'idempotence si.
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    response([offer('Jeu A'), offer('Jeu B')]),
    response([offer('Jeu A'), offer('Jeu B')]),
    response([offer('Jeu A'), offer('Jeu B')]),
  ]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  await c.cycle(T + DAY, { force: true });
  await c.cycle(T + 2 * DAY, { force: true });
  await c.cycle(T + 3 * DAY, { force: true });

  assert.equal(c.notifications.length, 1, `${c.notifications.length} notifications pour une seule offre`);
});

test('la notification repose sur notifieLe, pas sur le resultat du cycle', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A')])]);
  const c = await contexteDeTest({ test: src });
  await c.cycle(T);

  const catalog = c.faux.payload()[KEYS.OFFERS];
  const entryPairs = Object.values(catalog);
  assert.equal(toNotify(catalog, T).length, 0);

  // On simule une entree ecrite mais jamais annoncee -- exactement ce que
  // laisse une mort du service worker entre l'ecriture et la notification.
  const catalogKey = entryPairs[0].catalogKey;
  catalog[catalogKey] = { ...entryPairs[0], notifiedAt: null };
  assert.equal(toNotify(catalog, T).length, 1, 'une offre non annoncee doit etre reprise');
});

/* ------------------------------------------------- garde sur la liste complete */

test('une liste effondree est traitee comme partielle, pas comme des disparitions', async () => {
  // Une panne de deux cycles chez la source effacerait sinon la moitie du
  // catalogue : le mecanisme cense rattraper les offres retirees deviendrait
  // celui qui les detruit.
  const vingt = Array.from({ length: 20 }, (_, i) => offer(`Jeu ${i}`, { end: 'N/A' }));
  const trois = vingt.slice(0, 3);

  const src = sourceFactice('test', [response(vingt), response(trois)]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  const r = await c.cycle(T + DAY, { force: true });

  assert.ok(r.anomalies.length >= 1, 'l\'effondrement n\'a pas ete signale');
  assert.match(r.anomalies[0], /partielle/);

  const catalog = c.faux.payload()[KEYS.OFFERS];
  const enObservation = Object.values(catalog).filter((o) => o.missingSince);
  assert.equal(enObservation.length, 0, 'des offres ont ete mises en observation a tort');
});

test('une reponse vide est toujours traitee comme partielle', async () => {
  const dix = Array.from({ length: 10 }, (_, i) => offer(`Jeu ${i}`, { end: 'N/A' }));
  const src = sourceFactice('test', [response(dix), response([])]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  const r = await c.cycle(T + DAY, { force: true });

  assert.ok(r.anomalies.length >= 1);
  const catalog = c.faux.payload()[KEYS.OFFERS];
  assert.equal(Object.keys(catalog).length, 10, 'le catalogue a ete ampute');
});

test('une baisse credible reste une liste complete', async () => {
  const dix = Array.from({ length: 10 }, (_, i) => offer(`Jeu ${i}`, { end: 'N/A' }));
  const sept = dix.slice(0, 7); // au-dessus du ratio
  const src = sourceFactice('test', [response(dix), response(sept)]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  const r = await c.cycle(T + DAY, { force: true });

  assert.equal(r.anomalies.length, 0, `anomalies inattendues : ${r.anomalies}`);
  const catalog = c.faux.payload()[KEYS.OFFERS];
  const enObservation = Object.values(catalog).filter((o) => o.missingSince);
  assert.equal(enObservation.length, 3, 'les trois offres absentes auraient du passer en observation');
});

test('le ratio de credibilite est celui documente', () => {
  assert.equal(CREDIBLE_LIST_RATIO, 0.5);
});

/* --------------------------------------------------------------- echecs */

test('un echec de source est compte et n\'abime pas le catalogue', async () => {
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    { offers: [], dropped: [], errors: ['HTTP 503'] },
  ]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  await c.cycle(T + DAY, { force: true });

  const sources = c.faux.payload()[KEYS.SOURCES];
  assert.equal(sources.test.consecutiveFailures, 1);
  assert.match(sources.test.lastError, /503/);

  const catalog = c.faux.payload()[KEYS.OFFERS];
  assert.equal(Object.keys(catalog).length, 1, 'le catalogue a souffert d\'un echec de source');
});

test('une coupure reseau ne compte pas comme un echec de la source', async () => {
  // Sinon une nuit sans wifi gele la veille six heures, exactement au moment ou
  // l'utilisateur rouvre son portable.
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    { offers: [], dropped: [], errors: ['Failed to fetch'] },
  ]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  await c.cycle(T + DAY, { force: true, offline: () => true });

  const sources = c.faux.payload()[KEYS.SOURCES];
  assert.ok(!sources.test.consecutiveFailures, 'un echec a ete compte alors qu\'on etait hors ligne');
});

test('une source qui jette n\'arrete pas le cycle', async () => {
  const casse = {
    name: 'casse',
    completeList: true,
    async discover() { throw new Error('boum'); },
  };
  const bonne = sourceFactice('bonne', [response([offer('Jeu A')])]);
  const c = await contexteDeTest({ casse, bonne });

  const r = await c.cycle(T, { force: true });
  assert.deepEqual(r.queried.sort(), ['bonne', 'casse']);

  const catalog = c.faux.payload()[KEYS.OFFERS];
  assert.equal(Object.keys(catalog).length, 1, 'la source valide n\'a pas ete integree');
});

/* --------------------------------------------------------------- le verrou */

test('deux cycles simultanes : un seul travaille', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A')])]);
  const c = await contexteDeTest({ test: src }, { latenceMs: 2 });

  const [a, b] = await Promise.all([c.cycle(T, { force: true }), c.cycle(T, { force: true })]);
  const ignores = [a, b].filter((r) => r.ignore).length;

  assert.equal(ignores, 1, 'les deux cycles ont travaille, ou aucun');
});

test('un verrou Web disponible est prefere au bail', async () => {
  let demande = 0;
  const webLocks = {
    async request(name, options, fn) {
      demande++;
      return fn({ name: name });
    },
  };
  const src = sourceFactice('test', [response([offer('Jeu A')])]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T, { force: true, webLocks });
  assert.equal(demande, 1, 'le verrou Web n\'a pas ete utilise');
});

test('avecVerrou rend la main sans executer quand le verrou est pris', async () => {
  const faux = fakeChrome({ now: T });
  let executions = 0;
  const job = async () => { executions++; return 'fait'; };

  const premier = await withLease(faux.chrome, 'x', async () => {
    // Pendant que le premier tient le bail, un second essaie.
    const second = await withLease(faux.chrome, 'x', job, { now: T });
    assert.equal(second.acquired, false);
    return job();
  }, { now: T });

  assert.equal(premier.acquired, true);
  assert.equal(executions, 1);
});

/* --------------------------------------------------------------- schema */

test('un schema plus recent que le code arrete la veille au lieu de planter', async () => {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.SCHEMA]: 999 });

  const r = await runCycle({
    chrome: faux.chrome,
    now: T,
    sources: { test: sourceFactice('test', [response([offer('Jeu A')])]) },
  });

  assert.equal(r.stopped, true);
  assert.match(r.reason, /version 999/);
});

test('verifierSchema initialise puis se tait', async () => {
  const faux = fakeChrome({ now: T });
  assert.equal((await checkSchema(faux.chrome)).state, SCHEMA.INITIALISED);
  assert.equal((await checkSchema(faux.chrome)).state, SCHEMA.OK);
});

/* ------------------------------------------------------------ observabilite */

test('le cycle laisse de quoi se debugger sans console', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A')])]);
  const c = await contexteDeTest({ test: src });
  await c.cycle(T, { force: true });

  const state = await readState(c.faux.chrome);
  assert.equal(state.lastCycle, T);
  assert.ok(state.nextCycle === null || typeof state.nextCycle === 'number');

  const sources = c.faux.payload()[KEYS.SOURCES];
  assert.equal(sources.test.lastSuccess, T);
  assert.equal(sources.test.lastError, null);
  assert.equal(sources.test.lastSize, 1);
});

test('le badge est mis a jour meme quand rien n\'est notifie', async () => {
  // C'est le canal de repli : quand les notifications sont coupees au niveau du
  // systeme, chrome.notifications.create reussit sans rien afficher.
  const src = sourceFactice('test', [response([offer('Jeu A'), offer('Jeu B')])]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T);
  assert.equal(c.notifications.length, 0, 'amorcage');
  assert.equal(c.badges.length, 1);
  assert.equal(c.badges[0], 2);
});

test('les notifications se taisent quand le reglage les coupe', async () => {
  const src = sourceFactice('test', [response([offer('A')]), response([offer('A'), offer('B')])]);
  const c = await contexteDeTest({ test: src });
  await c.cycle(T);
  await c.faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { notifications: false } });
  await c.cycle(T + DAY, { force: true });

  assert.equal(c.notifications.length, 0);
});

/* --------------------------------------------------------------- annonces */

test('composeAnnouncement reste lisible quand cinq offres tombent ensemble', () => {
  // Une seule offre : le TITRE porte le nom du jeu, le corps porte le magasin.
  // C'est l'inverse de ce que faisait la V2, et c'est mieux : sur Windows, une
  // notification tronque son corps bien avant son titre.
  const une = composeAnnouncement([offer('Solo')]);
  assert.match(une.title, /Solo/);
  assert.ok(une.text.length > 0, 'le corps doit nommer le magasin');
  // Les textes viennent de _locales : une cle brute a l'ecran est un bug.
  assert.ok(!/^notify[A-Z]/.test(une.title), `cle non traduite : ${une.title}`);
  assert.ok(!/^notify[A-Z]/.test(une.text), `cle non traduite : ${une.text}`);

  const cinq = composeAnnouncement(['A', 'B', 'C', 'D', 'E'].map((t) => offer(t)));
  assert.match(cinq.title, /5/);
  assert.match(cinq.text, /A, B, C/);
  assert.match(cinq.text, /2/, 'le compte des offres non citees');
});

/* ------------------------------------------------------------- lacunes */

test('une longue absence laisse une trace exploitable par la prediction', async () => {
  // Sans ce journal, la couche B apprendra le rythme de nos propres sondages
  // au lieu de celui du magasin.
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    response([offer('Jeu A')]),
  ]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T, { force: true });
  await c.cycle(T + 3 * DAY, { force: true });

  const sources = c.faux.payload()[KEYS.SOURCES];
  assert.ok(Array.isArray(sources.test.gaps), 'aucune lacune enregistree');
  assert.equal(sources.test.gaps.length, 1);
  assert.equal(sources.test.gaps[0].start, T);
  assert.equal(sources.test.gaps[0].end, T + 3 * DAY);
});

/* ------------------------------------------------- fenetres annoncees */

test('instantsDeFenetres accepte les deux formes stockees', async () => {
  const { windowInstants } = await import('../watch/cycle.js');
  // Les versions anterieures ne rangeaient que l'instant ; on ne casse pas un
  // etat deja ecrit sur la machine de l'utilisateur.
  assert.deepEqual(windowInstants([T, T + 1000]), [T, T + 1000]);
  assert.deepEqual(windowInstants([{ title: 'X', start: T }]), [T]);
  assert.deepEqual(windowInstants([{ title: 'X', start: T }, T + 5]), [T, T + 5]);
  assert.deepEqual(windowInstants([null, {}, 'texte']), []);
  assert.deepEqual(windowInstants(undefined), []);
});

test('les fenetres annoncees sont conservees entieres, pas reduites a des instants', async () => {
  const src = {
    name: 'test',
    completeList: true,
    async discover() {
      return {
        offers: [offer('Jeu A')],
        dropped: [],
        errors: [],
        nextWindows: [{ title: 'Jeu Futur', image: 'https://x.test/i.jpg', start: T + 3 * DAY, end: T + 10 * DAY }],
      };
    },
  };
  const c = await contexteDeTest({ test: src });
  await c.cycle(T, { force: true });

  const sources = c.faux.payload()[KEYS.SOURCES];
  const f = sources.test.announcedWindows[0];
  assert.equal(f.title, 'Jeu Futur', 'le titre a ete perdu : le popup ne pourrait rien montrer');
  assert.equal(f.image, 'https://x.test/i.jpg');
  assert.equal(f.start, T + 3 * DAY);
});

/* ------------------------------------------------ reclamation autonome */

/** Equipe un faux chrome d'onglets qui jouent un verdict donne. */
function avecOnglets(faux, verdict) {
  const ouverts = [];
  let id = 200;
  faux.chrome.tabs = {
    async create({ url }) {
      const monId = id++;
      ouverts.push({ id: monId, url });
      setTimeout(() => signalerReclamation(monId, 'fgc-pret', { url }), 2);
      return { id: monId };
    },
    async get(i) { return { id: i, url: ouverts.find((o) => o.id === i).url, status: 'complete' }; },
    async remove() {},
    async sendMessage(i) {
      setTimeout(() => signalerReclamation(i, 'fgc-verdict', { verdict }), 2);
      return { recu: true };
    },
    onUpdated: { addListener() {}, removeListener() {} },
  };
  return ouverts;
}

test('une offre qui passe les filtres est reclamee, et son verdict est garde', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A', { worth: '$9.99', category: 'Game' })])]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'claimed');

  await c.cycle(T, {
    force: true,
    claimableStores: [STORES.EPIC],
  });

  assert.equal(ouverts.length, 1, 'aucun onglet de reclamation ouvert');
  const catalog = c.faux.payload()[KEYS.OFFERS];
  const entry = Object.values(catalog)[0];
  assert.equal(entry.verdict, 'claimed');
  assert.equal(entry.state, 'resolved', 'un verdict definitif doit clore l\'offre');
  assert.equal(entry.attempts, 1);
});

test('un magasin hors perimetre de reclamation n\'ouvre aucun onglet', async () => {
  // C'est le cas de Steam : detecte, affiche, jamais clique.
  const jeuSteam = makeOffer({
    source: 'test', store: STORES.STEAM, storeId: '5004030',
    title: 'Un jeu Steam', url: 'https://store.steampowered.com/app/5004030/',
    worth: '$10.99', category: 'Game',
  });
  const src = sourceFactice('test', [response([jeuSteam])]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'claimed');

  await c.cycle(T, { force: true, claimableStores: [STORES.EPIC, STORES.GOG] });

  assert.equal(ouverts.length, 0, 'un onglet a ete ouvert sur un magasin en detection seule');
  const entry = Object.values(c.faux.payload()[KEYS.OFFERS])[0];
  assert.equal(entry.verdict, null, 'un verdict a ete pose sans reclamation');
});

test('les filtres ecartent avant la reclamation, pas apres', async () => {
  const dlc = offer('Un DLC', { worth: '$1.99', category: 'DLC' });
  const src = sourceFactice('test', [response([dlc])]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'claimed');

  await c.cycle(T, { force: true, claimableStores: [STORES.EPIC] });
  assert.equal(ouverts.length, 0, 'un DLC a ete reclame malgre le filtre par defaut');
});

test('le plafond de reclamations par cycle est respecte', async () => {
  const dix = Array.from({ length: 10 }, (_, i) => offer(`Jeu ${i}`, { worth: '$5.99', category: 'Game' }));
  const src = sourceFactice('test', [response(dix)]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'claimed');

  await c.cycle(T, { force: true, claimableStores: [STORES.EPIC], maxReclamations: 3 });
  assert.equal(ouverts.length, 3, `${ouverts.length} onglets ouverts pour un plafond de 3`);
});

test('la reclamation autonome se coupe par reglage', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A', { worth: '$9.99', category: 'Game' })])]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'claimed');

  await c.faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'], autonomousClaim: false },
  });
  await c.cycle(T, { force: true, claimableStores: [STORES.EPIC] });
  assert.equal(ouverts.length, 0, 'la reclamation a tourne malgre le reglage');
});

test('un defi de securite ne rouvre pas d\'onglet au cycle suivant', async () => {
  const src = sourceFactice('test', [
    response([offer('Jeu A', { worth: '$9.99', category: 'Game' })]),
    response([offer('Jeu A', { worth: '$9.99', category: 'Game' })]),
  ]);
  const c = await contexteDeTest({ test: src });
  const ouverts = avecOnglets(c.faux, 'challenge');

  await c.cycle(T, { force: true, claimableStores: [STORES.EPIC] });
  assert.equal(ouverts.length, 1);
  const entry = Object.values(c.faux.payload()[KEYS.OFFERS])[0];
  assert.equal(entry.verdict, 'challenge');
  assert.equal(typeof entry.nextAttemptAt, 'number', 'un defi doit poser un recul');

  await c.cycle(T + 60000, { force: true, claimableStores: [STORES.EPIC] });
  assert.equal(ouverts.length, 1, 'un second onglet de defi a ete ouvert une minute apres');
});

/* ---------------------------------------------- la couche apprenante */

test('seules les offres NOUVELLES nourrissent la prediction', async () => {
  // Une offre deja connue, revue a chaque cycle, gonflerait la case de nos
  // propres heures de sondage : exactement le biais que la conception combat.
  const meme = response([offer('Jeu A', { start: T - 3600000 })]);
  const src = sourceFactice('test', [meme, meme, meme]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T, { force: true });
  const apres1 = c.faux.payload()['veille:stats'].test.observations;

  await c.cycle(T + DAY, { force: true });
  await c.cycle(T + 2 * DAY, { force: true });
  const apres3 = c.faux.payload()['veille:stats'].test.observations;

  assert.equal(apres1, 1);
  assert.equal(apres3, 1, `${apres3} observations pour une seule offre vue trois fois`);
});

test('la prediction credite la date publiee par la source', async () => {
  const drop = Date.parse('2026-08-27T15:00:00Z');
  const src = sourceFactice('test', [response([offer('Jeu A', { start: drop })])]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(drop + 5 * HOUR, { force: true });

  const stats = c.faux.payload()['veille:stats'].test;
  assert.ok(stats.cells['4-15'], 'la case du drop n\'a pas ete creditee');
  assert.equal(stats.cells['4-20'], undefined, 'l\'heure du sondage a ete creditee');
});

/* ---------------------------------------------------- respect du plan */

test('sans forcage, une source qui vient de tourner n\'est pas reinterrogee', async () => {
  const src = sourceFactice('test', [response([offer('Jeu A')]), response([offer('Jeu A')])]);
  const c = await contexteDeTest({ test: src });

  await c.cycle(T, { force: true });
  const appelsApresPremier = src.appels;

  const r = await c.cycle(T + 60000);
  assert.equal(src.appels, appelsApresPremier, 'la source a ete reinterrogee trop tot');
  assert.deepEqual(r.queried, []);
});

/* ------------------------------------------------------ forcage cible */

test('forcer une LISTE n\'interroge que ces sources-la', async () => {
  // Ce que demande la sentinelle : reparer une source cassee sans faire payer
  // les saines. Sur des API tierces, c'est exactement le trafic a ne pas
  // produire.
  const appels = { a: 0, b: 0 };
  const c = await contexteDeTest({
    a: { name: 'a', minIntervalMs: 0, async discover() { appels.a++; return response([offer('Jeu A')]); } },
    b: { name: 'b', minIntervalMs: 0, async discover() { appels.b++; return response([offer('Jeu B')]); } },
  });

  await c.cycle(T + DAY, { force: ['a'] });
  assert.equal(appels.a, 1);
  assert.equal(appels.b, 0, 'la source saine ne devait pas etre touchee');

  await c.cycle(T + 2 * DAY, { force: true });
  assert.equal(appels.b, 1, 'forcer tout interroge bien tout');
});

test('forcer une source inconnue n\'interroge rien, et ne jette pas', async () => {
  const appels = { a: 0 };
  const c = await contexteDeTest({
    a: { name: 'a', minIntervalMs: 0, async discover() { appels.a++; return response([]); } },
  });

  const r = await c.cycle(T + DAY, { force: ['source-qui-n-existe-pas'] });
  assert.equal(appels.a, 0);
  assert.ok(r, 'le cycle doit rendre un resultat, pas une exception');
});

/* ------------------------------------------------------ souhaits (2.46.0) */

import { KEY_WISHLIST, KEY_STEAM_WISHLIST, addWish, makeSteamWishlist } from '../watch/wishlist.js';
import { normaliseTitle } from '../watch/offer.js';

/** Deux nouveautes apres l'amorcage, en mode resume : le cas ou un souhait doit percer. */
async function resumeAvecSouhaits(souhaits) {
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    response([offer('Jeu A'), offer('Jeu B'), offer('Hollow Knight')]),
  ]);
  const c = await contexteDeTest({ test: src });
  await c.faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'], notifyMode: 'digest' },
    ...souhaits,
  });
  await c.cycle(T);
  await c.cycle(T + DAY, { force: true });
  return c;
}

test('sans souhait, deux nouveautes partent en resume', async () => {
  const c = await resumeAvecSouhaits({});
  assert.equal(c.notifications.length, 1);
  assert.ok(!c.journal.some((l) => /jeu attendu/.test(l)));
});

test('un souhait saisi echappe au resume : le cycle lit enfin la liste', async () => {
  /* De la 2.31.0 a la 2.45.0, readContext ne demandait pas la cle : le cycle
     voyait une liste vide, et ce test aurait rendu le resume. */
  const c = await resumeAvecSouhaits({ [KEY_WISHLIST]: addWish([], 'Hollow Knight', normaliseTitle) });
  assert.equal(c.notifications.length, 1);
  assert.ok(c.journal.some((l) => /jeu attendu/.test(l)));
  // Plusieurs offres : le compte en titre, et le jeu attendu en tete du texte.
  assert.match(c.notifications[0].text, /^Hollow Knight/);
});

test('un souhait de la liste Steam echappe au resume, offert sur un autre magasin', async () => {
  const steam = makeSteamWishlist([{ id: '367520', title: 'Hollow Knight' }], normaliseTitle, T);
  const c = await resumeAvecSouhaits({ [KEY_STEAM_WISHLIST]: steam });
  assert.equal(c.notifications.length, 1);
  assert.ok(c.journal.some((l) => /jeu attendu/.test(l)));
  assert.match(c.notifications[0].text, /^Hollow Knight/);
});

/* ------------------------------------------------ le telephone (2.47.0) */

import { KEY_PHONE } from '../watch/phone.js';

/** Un fetch qui ne repond qu'a ntfy, et note ce qui y part. */
function fetchNtfy() {
  const appels = [];
  const f = async (url, init) => {
    if (String(url).startsWith('https://ntfy.sh/')) { appels.push({ url, init }); return { ok: true, status: 200 }; }
    return { ok: false, status: 503 };
  };
  f.appels = appels;
  return f;
}

async function cycleAvecTelephone({ phone, settings = {}, wishes = ['Hollow Knight'] }) {
  const src = sourceFactice('test', [
    response([offer('Jeu A')]),
    response([offer('Jeu A'), offer('Jeu B'), offer('Hollow Knight')]),
  ]);
  const c = await contexteDeTest({ test: src });
  let l = [];
  for (const w of wishes) l = addWish(l, w, normaliseTitle);
  await c.faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'], ...settings },
    [KEY_WISHLIST]: l,
    ...(phone ? { [KEY_PHONE]: phone } : {}),
  });
  const f = fetchNtfy();
  await c.cycle(T, { fetch: f });
  await c.cycle(T + DAY, { force: true, fetch: f });
  await c.cycle(T + DAY + 2 * HOUR, { force: true, fetch: f });
  return { c, appels: f.appels };
}

test('telephone : un jeu attendu part une fois, avec le lien de sa fiche', async () => {
  const { appels } = await cycleAvecTelephone({ phone: { on: true, url: 'https://ntfy.sh/fgc-test' } });
  assert.equal(appels.length, 1, 'une fois, pas a chaque cycle');
  const u = new URL(appels[0].url);
  assert.match(u.searchParams.get('title'), /Hollow Knight/);
  assert.equal(u.searchParams.get('click'), 'https://store.epicgames.com/p/hollow knight');
  assert.doesNotMatch(appels[0].init.body, /Jeu B/, 'seulement les jeux attendus');
});

test('telephone : sans l\'option « jeux attendus », seuls les incidents partiront', async () => {
  const { appels } = await cycleAvecTelephone({ phone: { on: true, url: 'https://ntfy.sh/fgc-test', wished: false } });
  assert.equal(appels.length, 0);
});

test('telephone : l\'ordinateur coupe, le jeu attendu part quand meme au telephone', async () => {
  const { appels, c } = await cycleAvecTelephone({
    phone: { on: true, url: 'https://ntfy.sh/fgc-test' },
    settings: { notifyMode: 'off' },
  });
  assert.equal(c.notifications.length, 0);
  assert.equal(appels.length, 1);
});

test('telephone : coupe par defaut, rien ne part', async () => {
  const { appels } = await cycleAvecTelephone({ phone: undefined });
  assert.equal(appels.length, 0);
});

/* ------------------------------ un defi : finir sur le telephone (2.89.0) */

import { KEY_RELAY, deriveRelay, open as ouvrirRelais, TYPES as RELAY_TYPES } from '../watch/relay.js';
import { VERDICTS } from '../watch/claim.js';

test('un defi de securite : demande d\'aide au relais, et l\'alerte ouvre l\'appli sur le jeu', async () => {
  const secret = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const src = sourceFactice('test', [response([offer('Jeu A')]), response([offer('Jeu A'), offer('Hades')])]);
  const c = await contexteDeTest({ test: src });
  await c.faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'] },
    [KEY_PHONE]: { on: true, url: 'https://ntfy.sh/fgc-test', wished: false },
    [KEY_RELAY]: { secret, server: 'https://ntfy.sh', dev: 'c0ffee01', pairedAt: T - 1000 },
  });
  const f = fetchNtfy();
  await c.cycle(T, { fetch: f, autonomousClaim: false });
  f.appels.length = 0;
  await c.cycle(T + DAY, {
    force: true, fetch: f, claimableStores: ['epic'],
    claim: async (o) => ({ verdict: o.title === 'Hades' ? VERDICTS.CHALLENGE : VERDICTS.CLAIMED, store: 'epic' }),
  });

  const ctx = await deriveRelay(secret);
  const relais = [];
  for (const a of f.appels.filter((x) => x.url === `https://ntfy.sh/${ctx.topic}`)) relais.push(await ouvrirRelais(a.init.body, ctx));
  const aide = relais.find((m) => m && m.type === RELAY_TYPES.HELP);
  assert.ok(aide, 'une demande d\'aide part au relais');
  assert.deepEqual(aide.games.map((g) => g.t), ['Hades']);
  assert.ok(aide.games[0].until > T + DAY);

  const alerte = f.appels.find((x) => x.url.startsWith('https://ntfy.sh/fgc-test?'));
  assert.ok(alerte, 'l\'alerte du defi part au telephone');
  const lien = new URL(alerte.url).searchParams.get('click');
  assert.match(lien, /^fgclaimer:\/\/finir\?/);
  assert.equal(new URL(lien).searchParams.get('t'), 'Hades');
  assert.match(alerte.init.body, /Hades/);
});

/* --------------------------- la derniere chance, au telephone (2.90.0) */

test('derniere chance : un jeu attendu qui finit dans les 3 h part en urgent, une seule fois', async () => {
  const src = sourceFactice('test', [response([
    offer('Hollow Knight', { end: T + 2 * HOUR + 30 * 60000 }),
    offer('Jeu B', { end: T + 2 * HOUR }),
    offer('Jeu C', { end: T + 20 * HOUR }),
  ])]);
  const c = await contexteDeTest({ test: src });
  await c.faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'] },
    [KEY_WISHLIST]: addWish(addWish([], 'Hollow Knight', normaliseTitle), 'Jeu C', normaliseTitle),
    [KEY_PHONE]: { on: true, url: 'https://ntfy.sh/fgc-test' },
  });
  const f = fetchNtfy();
  await c.cycle(T, { fetch: f, autonomousClaim: false });
  assert.equal(f.appels.length, 0, 'pas a l\'amorcage');
  await c.cycle(T + 30 * 60000, { force: true, fetch: f, autonomousClaim: false });
  const urgentes = f.appels.filter((a) => new URL(a.url).searchParams.get('priority') === '5');
  assert.equal(urgentes.length, 1);
  assert.match(new URL(urgentes[0].url).searchParams.get('title'), /Hollow Knight/);
  assert.doesNotMatch(urgentes[0].init.body, /Jeu B|Jeu C/, 'seulement l\'attendu, seulement dans les 3 h');
  await c.cycle(T + 40 * 60000, { force: true, fetch: f, autonomousClaim: false });
  assert.equal(f.appels.filter((a) => new URL(a.url).searchParams.get('priority') === '5').length, 1, 'une fois');
});
