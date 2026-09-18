/* Recuperer sur Steam -- en option, coupee par defaut.
 *
 * Ce fichier tient les promesses faites a l'utilisateur quand il active
 * l'option, et d'abord celles qui tiennent quand il ne l'active PAS :
 *
 *   - sans l'option, Steam n'est ni reclamable ni interroge, et meme un appel
 *     direct ne fait rien ;
 *   - avec l'option, rien ne s'ouvre sans session ni sur un jeu deja possede ;
 *   - on ne clique que si le bloc du PAQUET, le formulaire de LICENCE GRATUITE
 *     et le libelle exact concordent -- la forme mesuree le 2026-09-19 sur une
 *     vraie offre en cours ;
 *   - le succes se lit dans la bibliotheque, pas sur la page ;
 *   - une par cycle, vingt minutes d'ecart, six par jour.
 *
 * Aucun test ne clique sur un vrai Steam : la page reelle n'a ete lue qu'a
 * blanc (steamPageStep avec dryRun), dans un navigateur sans session.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  steamPageStep,
  steamGate,
  steamAppUrl,
  describeStep,
  STEAM_SPACING_MS,
  STEAM_MAX_PER_DAY,
} from '../watch/steam-claim.js';
import { claimOffer, VERDICTS } from '../watch/claim.js';
import { claimWhatCanBe, runCycle } from '../watch/cycle.js';
import { CLAIMABLE_STORES, claimableStoresFor, activeSourcesFor } from '../watch/sources/index.js';
import { mapItem, readOwnership, OWNED_URL } from '../watch/sources/steam.js';
import { makeOffer, merge, STORES, STATES } from '../watch/offer.js';
import { DEFAULT_SETTINGS, KEYS } from '../watch/storage.js';

const PAQUET = '1827145';
const APPID = '2000040';

/* ------------------------------------------------------------ l'option */

test('l\'option est coupee par defaut, et seul un vrai « true » ajoute Steam', () => {
  assert.equal(DEFAULT_SETTINGS.steamAutoClaim, false);
  assert.ok(!claimableStoresFor(DEFAULT_SETTINGS).includes(STORES.STEAM));
  assert.ok(!activeSourcesFor(DEFAULT_SETTINGS).includes('steam'), 'la source Steam reste inactive par defaut');

  for (const presque of ['true', 1, 'oui', {}, null, undefined]) {
    assert.ok(!claimableStoresFor({ steamAutoClaim: presque }).includes(STORES.STEAM), `accepte a tort : ${JSON.stringify(presque)}`);
  }

  const on = { ...DEFAULT_SETTINGS, steamAutoClaim: true };
  assert.deepEqual(claimableStoresFor(on), [...CLAIMABLE_STORES, STORES.STEAM]);
  assert.ok(activeSourcesFor(on).includes('steam'), 'l\'option active la source qui donne le paquet');
  assert.ok(!CLAIMABLE_STORES.includes(STORES.STEAM), 'la liste de base ne bouge pas');
});

/* ----------------------------------------------------------- la source */

test('la source Steam donne le paquet, et le DLC porte le type 4 (mesure)', () => {
  const now = Date.UTC(2026, 8, 19);
  const item = (type) => ({
    appid: Number(APPID),
    name: 'Space Menace',
    type,
    best_purchase_option: {
      packageid: Number(PAQUET), is_free_to_keep: true, free_to_keep_ends: 1790175600,
      formatted_original_price: '7,19€', original_price_in_cents: 719,
    },
  });

  const jeu = mapItem(item(0), now, null);
  assert.equal(jeu.packageId, PAQUET);
  assert.equal(jeu.category, 'Game');
  /* Mesure du 2026-09-19 : « Dying Light: The Beast - Discharge Weapon Pack »,
     un DLC offert ce jour-la, rend type 4. Le code lisait 1. */
  assert.equal(mapItem(item(4), now, null).category, 'DLC');
});

test('une fusion avec l\'agregateur ne perd pas le paquet', () => {
  const steam = makeOffer({ source: 'steam', store: STORES.STEAM, storeId: APPID, packageId: PAQUET, title: 'Space Menace' });
  const agregateur = makeOffer({ source: 'gamerpower', store: STORES.STEAM, title: 'Space Menace (Steam) Giveaway' });
  assert.equal(merge(steam, agregateur).packageId, PAQUET);
  assert.equal(merge(agregateur, steam).packageId, PAQUET);
});

/* ---------------------------------------------------------- possession */

function reponseJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('la bibliotheque se lit avec la session, sans cache, et une liste vide veut dire « pas connecte »', async () => {
  const vues = [];
  const r = await readOwnership({
    now: 42,
    fetch: async (url, init) => { vues.push({ url, init }); return reponseJson({ rgOwnedApps: [], rgOwnedPackages: [] }); },
  });
  assert.equal(r.status, 'logged_out');
  assert.equal(vues[0].url, `${OWNED_URL}?t=42`);
  assert.equal(vues[0].init.credentials, 'include');
  assert.equal(vues[0].init.cache, 'no-store');

  const ok = await readOwnership({ fetch: async () => reponseJson({ rgOwnedApps: [10], rgOwnedPackages: [Number(PAQUET)] }) });
  assert.equal(ok.status, 'ok');
  assert.ok(ok.packages.has(PAQUET));
  assert.ok(ok.apps.has('10'));

  assert.equal((await readOwnership({ fetch: async () => reponseJson({}, 500) })).status, 'error');
  assert.equal((await readOwnership({ fetch: async () => reponseJson({ autre: 1 }) })).status, 'error');
});

/* ------------------------------------------------------ l'etape en page */

/**
 * Un document reduit a ce que l'etape lit, sur le modele du balisage mesure le
 * 2026-09-19 (bloc `game_area_purchase_section_add_to_cart_<paquet>`,
 * formulaire vers /freelicense/addfreelicense/, bouton « Add to Account »).
 */
function fauxDocument({
  packageId = PAQUET,
  action = 'https://store.steampowered.com/freelicense/addfreelicense/',
  subid,
  labels = ['Add to Account'],
  owned = false,
} = {}) {
  const clics = [];
  const boutons = labels.map((label) => ({ textContent: `\n    ${label}   \n`, click() { clics.push(label); } }));
  const form = {
    getAttribute: (n) => (n === 'action' ? action : null),
    querySelector: (s) => (s === 'input[name="subid"]' ? { value: subid ?? packageId } : null),
  };
  const bloc = {
    querySelector: (s) => (s === `form[name="add_to_cart_${packageId}"]` ? form : null),
    querySelectorAll: (s) => (s === '.game_purchase_action a, .game_purchase_action button' ? boutons : []),
  };
  return {
    title: 'Save 100% on Space Menace on Steam',
    getElementById: (id) => (id === `game_area_purchase_section_add_to_cart_${packageId}` ? bloc : null),
    querySelector: (s) => (s === '.game_area_already_owned' && owned ? {} : null),
    clics,
  };
}

test('l\'etape clique une fois quand paquet, formulaire gratuit et libelle concordent', () => {
  const doc = fauxDocument();
  assert.deepEqual(steamPageStep(PAQUET, true, doc), { ok: true, dryRun: true });
  assert.equal(doc.clics.length, 0, 'a blanc : aucun clic');

  assert.deepEqual(steamPageStep(PAQUET, false, doc), { ok: true, clicked: true });
  assert.deepEqual(doc.clics, ['Add to Account']);
});

test('un formulaire qui ne vise pas la licence gratuite n\'est jamais clique', () => {
  /* Le garde-fou qui compte : un formulaire de panier ou de caisse peut
     depenser de l'argent, celui de /freelicense/addfreelicense/ ne le peut pas. */
  for (const action of [
    'https://store.steampowered.com/cart/',
    'https://store.steampowered.com/checkout/',
    'https://store.steampowered.com/freelicense/addfreelicense/../../cart/',
    'https://evil.example/freelicense/addfreelicense/',
    '',
  ]) {
    const doc = fauxDocument({ action });
    const r = steamPageStep(PAQUET, false, doc);
    assert.equal(r.ok, false, action);
    assert.equal(r.reason, 'formulaire-non-gratuit', action);
    assert.equal(doc.clics.length, 0, action);
  }
});

test('l\'etape refuse tout ecart, sans jamais cliquer', () => {
  const cas = [
    [fauxDocument({ packageId: '999' }), 'bloc-absent'],
    [fauxDocument({ packageId: '999', owned: true }), 'deja-possede'],
    [fauxDocument({ subid: '42' }), 'paquet-different'],
    [fauxDocument({ labels: ['Add to Cart'] }), 'bouton-introuvable'],
    [fauxDocument({ labels: ['Add to Account', 'Add to Account'] }), 'boutons-multiples'],
    [fauxDocument({ labels: ['Add to Account 7,19€'] }), 'bouton-introuvable'],
  ];
  for (const [doc, raison] of cas) {
    const r = steamPageStep(PAQUET, false, doc);
    assert.equal(r.ok, false);
    assert.equal(r.reason, raison);
    assert.equal(doc.clics.length, 0, raison);
  }
  assert.match(describeStep({ reason: 'bouton-introuvable', labels: ['Add to Cart'] }), /Add to Cart/);
  assert.equal(describeStep(null), 'aucune reponse de la page');
});

test('l\'etape se suffit a elle-meme une fois serialisee', () => {
  /* executeScript l'envoie en texte : une reference a ce module y serait
     indefinie. On la reconstruit depuis sa source, comme le fera Chrome. */
  const reconstruite = new Function(`return (${steamPageStep.toString()})`)();
  assert.deepEqual(reconstruite(PAQUET, true, fauxDocument()), { ok: true, dryRun: true });
});

/* ------------------------------------------------------------ le rythme */

test('une par cycle, vingt minutes d\'ecart, six par jour', () => {
  const now = Date.UTC(2026, 8, 19, 12);
  const steam = (min) => ({ store: 'steam', lastAttemptAt: now - min * 60000 });

  assert.equal(steamGate({}, now).allowed, true);
  assert.equal(steamGate({}, now, { claimedThisRun: 1 }).allowed, false);
  assert.equal(steamGate({ a: steam(5) }, now).allowed, false, 'trop proche');
  assert.equal(steamGate({ a: steam(STEAM_SPACING_MS / 60000 + 1) }, now).allowed, true);
  assert.equal(steamGate({ a: { store: 'epic', lastAttemptAt: now - 60000 } }, now).allowed, true, 'les autres magasins ne comptent pas');

  const journee = Object.fromEntries(
    Array.from({ length: STEAM_MAX_PER_DAY }, (_, i) => [`s${i}`, steam(60 + i * 90)]),
  );
  assert.equal(steamGate(journee, now).allowed, false, 'plafond du jour');
  assert.equal(steamGate({ vieux: steam(25 * 60) }, now).allowed, true, 'hier ne compte plus');
});

/* ---------------------------------------------------- l'orchestration */

const T = Date.UTC(2026, 8, 19, 12, 0, 0);
const RAPIDE = { navigationMs: 200, pollMs: 5, confirmTries: 3, confirmDelayMs: 1 };

const offreSteam = (extra = {}) => ({
  ...makeOffer({
    source: 'steam', store: STORES.STEAM, storeId: APPID, packageId: PAQUET,
    title: 'Space Menace', url: `https://store.steampowered.com/app/${APPID}/`, keepable: true,
    state: STATES.QUEUED, ...extra,
  }),
  catalogKey: `steam:${APPID}`,
});

/**
 * Un faux navigateur pour le parcours Steam : un onglet, une injection qui
 * rend le resultat du scenario, puis la navigation que provoque le clic ; et
 * une bibliotheque qui repond, appel apres appel, ce que dit `bibliotheques`.
 */
async function fauxSteam({
  option = true,
  bibliotheques = [{ rgOwnedApps: [1], rgOwnedPackages: [1] }, { rgOwnedApps: [1], rgOwnedPackages: [1, Number(PAQUET)] }],
  etape = { ok: true, clicked: true },
  atterrissage = null,
  apresClic = 'https://store.steampowered.com/freelicense/addfreelicense/',
  fenetres = false,
} = {}) {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, steamAutoClaim: option } });

  const onglets = new Map();
  const traces = { ouverts: [], fermes: [], fenetresFermees: [], injections: [], lectures: 0 };
  let prochain = 500;

  faux.chrome.tabs = {
    async create({ url }) {
      const id = prochain++;
      onglets.set(id, { id, url: atterrissage || url, status: 'complete' });
      traces.ouverts.push({ id, url });
      return { id };
    },
    async get(id) {
      const t = onglets.get(id);
      if (!t) throw new Error('onglet inconnu');
      return t;
    },
    async remove(id) { onglets.delete(id); traces.fermes.push(id); },
    onUpdated: { addListener() {}, removeListener() {} },
  };
  if (fenetres) {
    faux.chrome.windows = {
      async create({ url, state }) {
        const { id } = await faux.chrome.tabs.create({ url });
        traces.etatFenetre = state;
        return { id: 77, tabs: [{ id }] };
      },
      async remove(id) { traces.fenetresFermees.push(id); },
    };
  }
  faux.chrome.scripting = {
    async executeScript({ target, func, args }) {
      traces.injections.push({ tabId: target.tabId, func, args });
      if (etape && etape.clicked) {
        const t = onglets.get(target.tabId);
        if (t) onglets.set(target.tabId, { ...t, url: apresClic, status: 'complete' });
      }
      return [{ result: etape }];
    },
  };

  const fetch = async () => {
    const body = bibliotheques[Math.min(traces.lectures, bibliotheques.length - 1)];
    traces.lectures++;
    return reponseJson(body);
  };

  return { chrome: faux.chrome, fetch, traces, faux };
}

const reclamer = (ctx, offre = offreSteam()) => claimOffer(offre, {
  chrome: ctx.chrome, now: T, fetch: ctx.fetch, steamTiming: RAPIDE,
});

test('option coupee : meme un appel direct ne fait rien', async () => {
  const ctx = await fauxSteam({ option: false });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.UNDETERMINED);
  assert.equal(ctx.traces.ouverts.length, 0);
  assert.equal(ctx.traces.lectures, 0, 'pas meme la bibliotheque');
});

test('sans session : « connexion requise », et aucun onglet', async () => {
  const ctx = await fauxSteam({ bibliotheques: [{ rgOwnedApps: [], rgOwnedPackages: [] }] });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.LOGIN);
  assert.equal(ctx.traces.ouverts.length, 0);
  assert.equal(ctx.traces.injections.length, 0);
});

test('deja possede, par le paquet ou par l\'application : acquis, sans rien tenter', async () => {
  for (const b of [{ rgOwnedApps: [1], rgOwnedPackages: [Number(PAQUET)] }, { rgOwnedApps: [Number(APPID)], rgOwnedPackages: [1] }]) {
    const ctx = await fauxSteam({ bibliotheques: [b] });
    const r = await reclamer(ctx);
    assert.equal(r.verdict, VERDICTS.CLAIMED);
    assert.equal(ctx.traces.ouverts.length, 0, 'le quota Steam compte « deja possede » comme un echec');
  }
});

test('sans paquet connu, on n\'ouvre rien', async () => {
  const ctx = await fauxSteam();
  const r = await reclamer(ctx, offreSteam({ packageId: null }));
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.equal(ctx.traces.ouverts.length, 0);
});

test('le parcours complet : page en anglais, fenetre reduite, un clic, la preuve dans la bibliotheque', async () => {
  const ctx = await fauxSteam({ fenetres: true });
  const r = await reclamer(ctx);

  assert.equal(r.verdict, VERDICTS.CLAIMED, JSON.stringify(r));
  assert.deepEqual(ctx.traces.ouverts.map((o) => o.url), [steamAppUrl(APPID)]);
  assert.match(ctx.traces.ouverts[0].url, /\?l=english$/);
  assert.equal(ctx.traces.etatFenetre, 'minimized');
  assert.equal(ctx.traces.injections.length, 1);
  assert.equal(ctx.traces.injections[0].func, steamPageStep);
  assert.deepEqual(ctx.traces.injections[0].args, [PAQUET, false]);
  assert.deepEqual(ctx.traces.fenetresFermees, [77], 'la fenetre est refermee');
});

test('un refus de la page est un echec qui dit pourquoi, et la fenetre se referme', async () => {
  const ctx = await fauxSteam({ etape: { ok: false, reason: 'formulaire-non-gratuit', action: 'https://store.steampowered.com/cart/' } });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /formulaire-non-gratuit/);
  assert.equal(ctx.traces.fermes.length, 1);
});

test('clic fait mais paquet absent : echec, pas une victoire supposee', async () => {
  const ctx = await fauxSteam({ bibliotheques: [{ rgOwnedApps: [1], rgOwnedPackages: [1] }] });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /pas apparu/);
  assert.equal(ctx.traces.lectures, 1 + RAPIDE.confirmTries);
});

test('controle d\'age ou connexion : on n\'injecte rien', async () => {
  const age = await fauxSteam({ atterrissage: `https://store.steampowered.com/agecheck/app/${APPID}/` });
  assert.equal((await reclamer(age)).verdict, VERDICTS.FAILURE);
  assert.equal(age.traces.injections.length, 0);

  const connexion = await fauxSteam({ atterrissage: 'https://store.steampowered.com/login/?redir=app%2F2000040' });
  assert.equal((await reclamer(connexion)).verdict, VERDICTS.LOGIN);
  assert.equal(connexion.traces.injections.length, 0);

  const apres = await fauxSteam({ apresClic: 'https://store.steampowered.com/login/?redir=freelicense' });
  assert.equal((await reclamer(apres)).verdict, VERDICTS.LOGIN);
});

test('dans un cycle : une seule offre Steam, et la date qui regle le rythme est posee', async () => {
  const ctx = await fauxSteam({
    bibliotheques: [
      { rgOwnedApps: [1], rgOwnedPackages: [1] },
      { rgOwnedApps: [1], rgOwnedPackages: [1, Number(PAQUET)] },
    ],
  });
  const a = offreSteam();
  const b = { ...offreSteam({ storeId: '2484180', packageId: '1830927', title: 'Deadshot' }), catalogKey: 'steam:2484180' };
  const catalog = { [a.catalogKey]: a, [b.catalogKey]: b };

  const r = await claimWhatCanBe({
    chrome: ctx.chrome,
    now: T,
    catalog,
    filters: {},
    claimableStores: claimableStoresFor({ steamAutoClaim: true }),
    watchedStores: ['steam'],
    cadence: [],
    maxReclamations: 3,
    fetch: ctx.fetch,
  });

  assert.equal(r.claims.length, 1, 'une par cycle');
  assert.equal(ctx.traces.ouverts.length, 1);
  const tentee = Object.values(r.catalog).find((o) => typeof o.lastAttemptAt === 'number');
  assert.ok(tentee, 'lastAttemptAt pose');
  assert.equal(Object.values(r.catalog).filter((o) => o.lastAttemptAt).length, 1);
});

test('sans l\'option, le cycle ne touche pas a Steam', async () => {
  const ctx = await fauxSteam({ option: false });
  const a = offreSteam();
  const r = await claimWhatCanBe({
    chrome: ctx.chrome,
    now: T,
    catalog: { [a.catalogKey]: a },
    filters: {},
    claimableStores: claimableStoresFor({ steamAutoClaim: false }),
    watchedStores: ['steam'],
    cadence: [],
    maxReclamations: 3,
    fetch: ctx.fetch,
  });
  assert.equal(r.claims.length, 0);
  assert.equal(ctx.traces.ouverts.length, 0);
  assert.equal(ctx.traces.lectures, 0);
});

/* ------------------------------------------------------ le cycle entier */

function sourceFactice(name, offers) {
  return {
    name,
    completeList: true,
    minIntervalMs: 0,
    appels: 0,
    async discover() { this.appels++; return { offers, dropped: [], errors: [] }; },
  };
}

async function cycleSteam({ option }) {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: {
      ...DEFAULT_SETTINGS,
      // La source Steam n'est PAS dans les sources actives : l'option doit l'ajouter.
      activeSources: ['epic-api'],
      watchedStores: ['steam'],
      steamAutoClaim: option,
    },
  });
  const ouverts = [];
  faux.chrome.tabs = { ...faux.chrome.tabs, async create(o) { ouverts.push(o); return { id: 9 }; } };

  const fin = T + 3 * 86400000;
  const steam = sourceFactice('steam', [makeOffer({
    source: 'steam', store: STORES.STEAM, storeId: APPID, packageId: PAQUET, title: 'Space Menace',
    url: `https://store.steampowered.com/app/${APPID}/`, keepable: true, end: new Date(fin).toISOString(),
  })]);
  const epic = sourceFactice('epic-api', []);
  const lectures = [];

  await runCycle({
    chrome: faux.chrome,
    now: T,
    sources: { 'epic-api': epic, steam },
    // Sans session : Steam rend des listes vides (mesure du 2026-09-19).
    fetch: async (url) => { lectures.push(url); return reponseJson({ rgOwnedApps: [], rgOwnedPackages: [] }); },
    claimableStores: CLAIMABLE_STORES,
  });

  const offres = Object.values(faux.payload()[KEYS.OFFERS] || {});
  return { steam, ouverts, lectures, offre: offres.find((o) => o.store === STORES.STEAM) };
}

test('cycle, option active : la source Steam est interrogee, et sans session rien ne s\'ouvre', async () => {
  const r = await cycleSteam({ option: true });
  assert.equal(r.steam.appels, 1, 'l\'option active la source Steam');
  assert.ok(r.offre, 'l\'offre est au catalogue');
  assert.equal(r.offre.packageId, PAQUET);
  assert.equal(r.offre.verdict, VERDICTS.LOGIN);
  assert.equal(r.ouverts.length, 0, 'aucun onglet sans session');
  assert.ok(r.lectures.some((u) => u.startsWith(OWNED_URL)), 'la bibliotheque a ete lue');
});

test('cycle, option coupee : la source Steam n\'est meme pas interrogee', async () => {
  const r = await cycleSteam({ option: false });
  assert.equal(r.steam.appels, 0);
  assert.equal(r.ouverts.length, 0);
  // Le cycle lit d'autres choses (les taux de change) : seule la bibliotheque Steam compte ici.
  assert.ok(!r.lectures.some((u) => u.startsWith(OWNED_URL)), 'bibliotheque Steam lue sans option');
});
