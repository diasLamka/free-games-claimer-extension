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
import { judge, REASONS } from '../watch/filters.js';

const PAQUET = '1827145';
const APPID = '2000040';

/* ------------------------------------------------------------ l'option */

test('l\'option est coupee par defaut, et seul un vrai « true » ajoute Steam', () => {
  assert.equal(DEFAULT_SETTINGS.steamAutoClaim, false);
  assert.ok(!claimableStoresFor(DEFAULT_SETTINGS).includes(STORES.STEAM));

  /* La 2.27.0 a separe deux choses que cette ligne confondait.
   *
   * Elle exigeait jusqu'ici que la SOURCE Steam soit inactive par defaut.
   * C'etait lier regarder et cliquer : la source ne fait que lire une
   * recherche publique, sans cookie, et elle est desormais interrogee pour
   * tout le monde -- c'est elle, et elle seule, qui donne la date de fin
   * exacte, le type DLC et le numero de paquet.
   *
   * Ce qui reste coupe par defaut, et qui est le vrai sujet du contrat Steam,
   * c'est la RECLAMATION. Le reste de ce fichier ne teste que celle-la. */
  assert.ok(activeSourcesFor(DEFAULT_SETTINGS).includes('steam'), 'la source Steam est lue par defaut');

  for (const presque of ['true', 1, 'oui', {}, null, undefined]) {
    assert.ok(!claimableStoresFor({ steamAutoClaim: presque }).includes(STORES.STEAM), `accepte a tort : ${JSON.stringify(presque)}`);
  }

  const on = { ...DEFAULT_SETTINGS, steamAutoClaim: true };
  assert.deepEqual(claimableStoresFor(on), [...CLAIMABLE_STORES, STORES.STEAM]);
  assert.ok(activeSourcesFor(on).includes('steam'), 'l\'option garde la source qui donne le paquet');
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
  /** 'in' : le menu de compte est la. 'out' : un lien de connexion. null : ni l'un ni l'autre. */
  session = 'in',
  /* Le href MESURE le 2026-09-19 sur Deadshot : une URL « javascript: ». Une
     chaine vide modelise un bouton a gestionnaire, que le clic atteint. */
  href,
  sessionid = true,
} = {}) {
  const clics = [];
  const envois = [];
  const lienDefaut = `javascript:addToCart( ${packageId} );`;
  const lien = href === undefined ? lienDefaut : href;
  const boutons = labels.map((label) => ({
    textContent: `\n    ${label}   \n`,
    getAttribute: (n) => (n === 'href' ? lien : null),
    click() { clics.push(label); },
  }));
  const form = {
    getAttribute: (n) => (n === 'action' ? action : null),
    querySelector: (s) => {
      if (s === 'input[name="subid"]') return { value: subid ?? packageId };
      if (s === 'input[name="sessionid"]') return sessionid ? { value: 'abc' } : null;
      return null;
    },
    requestSubmit() { envois.push(subid ?? packageId); },
  };
  const bloc = {
    querySelector: (s) => (s === `form[name="add_to_cart_${packageId}"]` ? form : null),
    querySelectorAll: (s) => (s === '.game_purchase_action a, .game_purchase_action button' ? boutons : []),
  };
  return {
    title: 'Save 100% on Space Menace on Steam',
    getElementById: (id) => {
      if (id === 'account_pulldown') return session === 'in' ? {} : null;
      return id === `game_area_purchase_section_add_to_cart_${packageId}` ? bloc : null;
    },
    querySelector: (s) => {
      if (s === '.game_area_already_owned') return owned ? {} : null;
      if (s.includes('/login/')) return session === 'out' ? {} : null;
      return null;
    },
    clics,
    envois,
  };
}

test('le bouton reel est un href « javascript: » : on envoie SON formulaire, une fois', () => {
  /* Mesure du 2026-09-19 (Deadshot, paquet 1830927) : le bouton est une ancre
     `javascript:addToCart( 1830927 );`. Chrome REFUSE une navigation vers une
     URL « javascript: » demandee depuis le monde isole de chrome.scripting :
     le clic partait sans rien jeter et sans rien faire. Le journal disait
     « clic fait », la bibliotheque restait vide. */
  const doc = fauxDocument();
  assert.deepEqual(steamPageStep(PAQUET, true, doc), { ok: true, dryRun: true, via: 'formulaire', sessionid: true });
  assert.equal(doc.envois.length, 0, 'a blanc : rien envoye');

  assert.deepEqual(steamPageStep(PAQUET, false, doc), { ok: true, clicked: true, via: 'formulaire', sessionid: true });
  assert.deepEqual(doc.envois, [PAQUET], 'le formulaire deja verifie, une seule fois');
  assert.equal(doc.clics.length, 0, 'et jamais les deux : Steam compte les activations');
});

test('un bouton a gestionnaire, lui, se clique -- un clic traverse les mondes', () => {
  const doc = fauxDocument({ href: '' });
  assert.deepEqual(steamPageStep(PAQUET, true, doc), { ok: true, dryRun: true, via: 'clic', sessionid: true });

  assert.deepEqual(steamPageStep(PAQUET, false, doc), { ok: true, clicked: true, via: 'clic', sessionid: true });
  assert.deepEqual(doc.clics, ['Add to Account']);
  assert.equal(doc.envois.length, 0);
});

test('un formulaire sans sessionid part quand meme, mais il est signale', () => {
  /* On ne bloque pas : le bouton du site part du MEME formulaire, donc son
     absence dirait que la page a change de forme, pas que l'envoi est
     impossible. Mais un POST sans jeton echoue en silence -- et un silence,
     ici, coute une soiree. */
  const doc = fauxDocument({ sessionid: false });
  const r = steamPageStep(PAQUET, false, doc);
  assert.equal(r.ok, true);
  assert.equal(r.sessionid, false);
  assert.deepEqual(doc.envois, [PAQUET]);
});

test('un « javascript: » qui appelle autre chose est un refus, pas une devinette', () => {
  for (const mauvais of [
    'javascript:addToCart( 999 );',
    'javascript:checkout();',
    'javascript:void(0)',
  ]) {
    const doc = fauxDocument({ href: mauvais });
    const r = steamPageStep(PAQUET, false, doc);
    assert.equal(r.ok, false, mauvais);
    assert.equal(r.reason, 'action-inconnue', mauvais);
    assert.equal(doc.envois.length + doc.clics.length, 0, mauvais);
  }
  assert.match(describeStep({ reason: 'action-inconnue', href: 'javascript:checkout();' }), /checkout/);
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

test('la session se lit sur la page, et l\'inconnu laisse passer', () => {
  /* Le correctif de la 2.22.2. La bibliotheque lue depuis le service worker
     peut rendre des listes vides alors que la session existe : c'est la page
     qui tranche, et elle ne tranche que sur un signe franc. */
  const connecte = fauxDocument({ session: 'in' });
  assert.deepEqual(steamPageStep(PAQUET, true, connecte), { ok: true, dryRun: true, via: 'formulaire', sessionid: true });

  const deconnecte = fauxDocument({ session: 'out' });
  const r = steamPageStep(PAQUET, false, deconnecte);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'non-connecte');
  assert.equal(deconnecte.clics.length, 0, 'jamais de clic sans session');

  /* Ni menu de compte, ni lien de connexion : Steam a change de balisage. On
     ne sait pas, et ne pas savoir ne doit pas bloquer -- les trois
     verifications suivantes protegent deja de ce qui coute. */
  assert.deepEqual(steamPageStep(PAQUET, true, fauxDocument({ session: null })), { ok: true, dryRun: true, via: 'formulaire', sessionid: true });

  /* Et un lien « /login/ » AILLEURS que dans le menu global -- l'encart
     « sign in to see reasons », present sur une page connectee -- ne prouve
     rien. Ce document ne repond qu'a une recherche NON restreinte : si
     l'etape en faisait une, elle declarerait deconnecte un compte qui ne
     l'est pas, et c'est precisement la panne qu'on repare. */
  const encart = fauxDocument({ session: null });
  const brut = encart.querySelector;
  encart.querySelector = (sel) => (sel === 'a[href*="/login/"]' ? {} : brut(sel));
  assert.deepEqual(steamPageStep(PAQUET, true, encart), { ok: true, dryRun: true, via: 'formulaire', sessionid: true });
});

test('l\'etape se suffit a elle-meme une fois serialisee', () => {
  /* executeScript l'envoie en texte : une reference a ce module y serait
     indefinie. On la reconstruit depuis sa source, comme le fera Chrome. */
  const reconstruite = new Function(`return (${steamPageStep.toString()})`)();
  assert.deepEqual(reconstruite(PAQUET, true, fauxDocument()), { ok: true, dryRun: true, via: 'formulaire', sessionid: true });
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
  /** Ce que rend la SECONDE lecture, a blanc, quand la bibliotheque est muette. */
  etapeApres = null,
  /** Faux si la plateforme ne permet pas de revenir sur la fiche. */
  retour = true,
  atterrissage = null,
  apresClic = 'https://store.steampowered.com/freelicense/addfreelicense/',
  fenetres = false,
} = {}) {
  const faux = fakeChrome({ now: T });
  await faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, steamAutoClaim: option } });

  const onglets = new Map();
  const traces = { ouverts: [], fermes: [], fenetresFermees: [], injections: [], retours: [], lectures: 0 };
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
  if (retour) {
    faux.chrome.tabs.update = async (id, { url }) => {
      const t = onglets.get(id);
      if (!t) throw new Error('onglet inconnu');
      onglets.set(id, { ...t, url, status: 'complete' });
      traces.retours.push(url);
      return onglets.get(id);
    };
  }
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
      // args[1] est `dryRun` : la seconde lecture, celle d'apres le clic.
      if (args[1] === true) return [{ result: etapeApres }];
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

test('bibliotheque vide : on va voir la page, et c\'est ELLE qui dit « connexion requise »', async () => {
  /* Le correctif de la 2.22.2. Avant : des listes vides suffisaient a rendre
     « connexion requise » sans rien ouvrir -- et un utilisateur connecte,
     dont `dynamicstore/userdata` ne rend rien depuis le service worker,
     n'obtenait AUCUNE action, a chaque cycle, pour toujours. */
  const ctx = await fauxSteam({
    bibliotheques: [{ rgOwnedApps: [], rgOwnedPackages: [] }],
    etape: { ok: false, reason: 'non-connecte', title: 'Space Menace' },
  });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.LOGIN);
  assert.equal(ctx.traces.ouverts.length, 1, 'la page est ouverte : elle seule sait');
  assert.equal(ctx.traces.injections.length, 1);
});

test('bibliotheque muette mais session bien la : la recuperation se fait', async () => {
  /* Le coeur du bug signale : « mon compte Steam est connecte, aucune
     action ». La bibliotheque ne repond rien d'exploitable avant le clic,
     la page est connectee, et la preuve arrive apres. */
  for (const muette of [{ rgOwnedApps: [], rgOwnedPackages: [] }, { pasDeListes: true }]) {
    const ctx = await fauxSteam({
      bibliotheques: [muette, { rgOwnedApps: [1], rgOwnedPackages: [1, Number(PAQUET)] }],
    });
    const r = await reclamer(ctx);
    assert.equal(r.verdict, VERDICTS.CLAIMED, JSON.stringify(r));
    assert.equal(ctx.traces.injections.length, 1, 'un seul clic');
  }
});

test('bibliotheque illisible apres le clic : la page rechargee sert de preuve', async () => {
  const muette = [{ rgOwnedApps: [], rgOwnedPackages: [] }];

  const acquis = await fauxSteam({
    bibliotheques: muette,
    etapeApres: { ok: false, reason: 'deja-possede', title: 'Space Menace' },
  });
  const r = await reclamer(acquis);
  assert.equal(r.verdict, VERDICTS.CLAIMED, JSON.stringify(r));
  assert.match(r.details, /confirme par la page/);
  assert.deepEqual(acquis.traces.retours, [steamAppUrl(APPID)], 'on revient sur la fiche');
  assert.equal(acquis.traces.injections.length, 2);
  assert.equal(acquis.traces.injections[1].args[1], true, 'la seconde lecture ne clique pas');

  // Le bouton est toujours la : le clic n'a rien donne, et on le dit.
  const rate = await fauxSteam({ bibliotheques: muette, etapeApres: { ok: true, dryRun: true } });
  assert.equal((await reclamer(rate)).verdict, VERDICTS.FAILURE);

  // Ni bibliotheque, ni page : ni succes, ni echec.
  const aveugle = await fauxSteam({ bibliotheques: muette, retour: false });
  const flou = await reclamer(aveugle);
  assert.equal(flou.verdict, VERDICTS.UNDETERMINED);
  assert.match(flou.details, /resultat invisible/);
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

test('clic fait mais paquet absent : echec, pas une victoire supposee -- et on dit ou ca a atterri', async () => {
  const ctx = await fauxSteam({ bibliotheques: [{ rgOwnedApps: [1], rgOwnedPackages: [1] }] });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.FAILURE);
  assert.match(r.details, /pas apparu/);
  /* Le motif d'un refus de Steam est sur la page d'arrivee, pas ailleurs.
     Sans elle, l'echec ne disait rien d'actionnable. */
  assert.match(r.details, /arrive sur.*addfreelicense/);
  assert.equal(ctx.traces.lectures, 1 + RAPIDE.confirmTries);
});

test('bibliotheque lisible mais en retard : la page rattrape, et c\'est un succes', async () => {
  /* `dynamicstore/userdata` est cache cote Steam et peut rester en retard sur
     une activation qui a pourtant eu lieu. On ne declare plus l'echec avant
     d'avoir redemande a la page -- elle, elle sait. */
  const ctx = await fauxSteam({
    bibliotheques: [{ rgOwnedApps: [1], rgOwnedPackages: [1] }],
    etapeApres: { ok: false, reason: 'deja-possede', title: 'Deadshot' },
  });
  const r = await reclamer(ctx);
  assert.equal(r.verdict, VERDICTS.CLAIMED, JSON.stringify(r));
  assert.match(r.details, /confirme par la page/);
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
  /* Un onglet complet : la recuperation Steam va desormais REGARDER la page
     quand la bibliotheque ne dit rien, il lui faut donc de quoi le faire. */
  const ouverts = [];
  const onglets = new Map();
  faux.chrome.tabs = {
    ...faux.chrome.tabs,
    async create(o) { ouverts.push(o); onglets.set(9, { id: 9, url: o.url, status: 'complete' }); return { id: 9 }; },
    async get(id) { const t = onglets.get(id); if (!t) throw new Error('onglet inconnu'); return t; },
    async remove(id) { onglets.delete(id); },
    onUpdated: { addListener() {}, removeListener() {} },
  };
  /* Sans session, la page porte un lien de connexion : c'est elle qui tranche. */
  faux.chrome.scripting = {
    async executeScript() { return [{ result: { ok: false, reason: 'non-connecte', title: 'Space Menace' } }]; },
  };

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

test('cycle, option active : la source Steam est interrogee, et la page tranche la session', async () => {
  const r = await cycleSteam({ option: true });
  assert.equal(r.steam.appels, 1, 'l\'option active la source Steam');
  assert.ok(r.offre, 'l\'offre est au catalogue');
  assert.equal(r.offre.packageId, PAQUET);
  /* Des listes vides ne suffisent plus a conclure : le cycle ouvre la fiche,
     et c'est son menu de compte qui rend le verdict. Sans cela, un compte
     connecte que le worker ne voit pas restait sans la moindre action. */
  assert.equal(r.ouverts.length, 1, 'la page est consultee');
  assert.equal(r.offre.verdict, VERDICTS.LOGIN);
  assert.ok(r.lectures.some((u) => u.startsWith(OWNED_URL)), 'la bibliotheque a ete lue');
});

test('cycle, option coupee : la source est lue, mais rien n\'est clique ni lu du compte', async () => {
  /* Ce test exigeait jusqu'a la 2.27.0 que la source ne soit pas meme
     interrogee. C'etait trop : ce que le contrat Steam interdit, c'est le
     CLIC, pas la lecture d'une page de recherche publique.

     Trois affirmations desormais, et la premiere a change de sens :
     la source est bien interrogee, aucun onglet ne s'ouvre, et le compte
     n'est pas lu -- ce dernier point etant la promesse ecrite de
     SECURITY.md, « jamais un compte de sa propre initiative ». */
  const r = await cycleSteam({ option: false });
  assert.equal(r.steam.appels, 1, 'la detection tourne pour tout le monde');
  assert.equal(r.ouverts.length, 0, 'aucun onglet, donc aucun clic');
  // Le cycle lit d'autres choses (les taux de change) : seule la bibliotheque Steam compte ici.
  assert.ok(!r.lectures.some((u) => u.startsWith(OWNED_URL)), 'bibliotheque Steam lue sans option');
});

test('une entree Steam sans paquet n\'est pas candidate, et ne prend pas le creneau', async () => {
  /* Une cle Steam offerte sur un site tiers, vue par l'agregateur : magasin
     « steam », mais aucun paquet. Plus urgente que la vraie offre, elle passait
     devant, echouait, et bloquait le creneau Steam pendant vingt minutes. */
  const sansPaquet = {
    ...makeOffer({
      source: 'gamerpower', store: STORES.STEAM, title: 'Cle Steam offerte ailleurs',
      url: 'https://www.gamerpower.com/x', keepable: true, end: new Date(T + 3600000).toISOString(),
    }),
    catalogKey: 'steam:cle',
  };
  const avecOption = claimableStoresFor({ steamAutoClaim: true });
  assert.equal(judge(sansPaquet, {}, { supportedStores: avecOption }).reason, REASONS.STORE_UNSUPPORTED);

  const ctx = await fauxSteam();
  const vraie = offreSteam();
  const r = await claimWhatCanBe({
    chrome: ctx.chrome,
    now: T,
    catalog: { [sansPaquet.catalogKey]: sansPaquet, [vraie.catalogKey]: vraie },
    filters: {},
    claimableStores: avecOption,
    watchedStores: ['steam'],
    cadence: [],
    maxReclamations: 3,
    fetch: ctx.fetch,
  });
  assert.deepEqual(r.claims.map((c) => c.catalogKey), [vraie.catalogKey]);
  assert.equal(r.claims[0].verdict, VERDICTS.CLAIMED);
});
