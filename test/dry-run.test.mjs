/* Tester la recuperation sans rien recuperer (2.64.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DRY, DRY_ERRORS, KEY_DRY_RUN, dryRunStores, fromEngine, fromSteamStep, inspectOffer, pickTestOffer,
  recognised, storesToTest,
} from '../watch/dry-run.js';
import { reportVerdict } from '../watch/claim.js';
import { UI_COMMANDS, CONTENT_MESSAGES, messageAllowed } from '../watch/messaging.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { loadEngine } from './harness.mjs';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const NOW = Date.parse('2026-09-24T12:00:00Z');
const H = 3600000;

/* ------------------------------------------------------------ quoi tester */

test('les magasins testes sont ceux que l\'extension reclame, parmi ceux suivis', () => {
  assert.deepEqual(storesToTest(DEFAULT_SETTINGS), ['epic', 'gog', 'amazon'], 'Steam coupe par defaut : rien a tester');
  assert.deepEqual(storesToTest({ ...DEFAULT_SETTINGS, steamAutoClaim: true }), ['epic', 'gog', 'amazon', 'steam']);
  assert.deepEqual(storesToTest({ ...DEFAULT_SETTINGS, watchedStores: ['epic', 'steam'] }), ['epic']);
});

test('le jeu teste : offert maintenant, avec une page, pas encore pris d\'abord, le plus proche de sa fin', () => {
  const catalogue = {
    a: { store: 'epic', title: 'Deja pris', state: 'resolved', url: 'https://store.epicgames.com/p/a', end: NOW + H },
    b: { store: 'epic', title: 'Loin', state: 'queued', url: 'https://store.epicgames.com/p/b', end: NOW + 72 * H },
    c: { store: 'epic', title: 'Proche', state: 'queued', url: 'https://store.epicgames.com/p/c', end: NOW + 5 * H },
    d: { store: 'epic', title: 'Fini', state: 'queued', url: 'https://store.epicgames.com/p/d', end: NOW - H },
    e: { store: 'epic', title: 'Pas encore', state: 'discovered', url: 'https://store.epicgames.com/p/e', start: NOW + H },
    f: { store: 'epic', title: 'Sans page', state: 'queued', end: NOW + H },
    g: { store: 'epic', title: 'Expire', state: 'expired', url: 'https://store.epicgames.com/p/g' },
    m: { store: 'epic-mobile', title: 'Mindcop', state: 'discovered', url: 'https://store.epicgames.com/p/m' },
  };
  const choisi = pickTestOffer(catalogue, 'epic', NOW);
  assert.equal(choisi.title, 'Proche');
  assert.equal(choisi.catalogKey, 'c');

  delete catalogue.b; delete catalogue.c;
  assert.equal(pickTestOffer(catalogue, 'epic', NOW).title, 'Deja pris', 'a defaut, un jeu pris : sa page doit le dire');
  assert.equal(pickTestOffer(catalogue, 'gog', NOW), null);
  assert.equal(pickTestOffer(null, 'epic', NOW), null);
});

test('Steam ne se teste qu\'avec le paquet : c\'est lui que la page doit porter', () => {
  const catalogue = {
    s1: { store: 'steam', title: 'Sans paquet', state: 'queued', storeId: '123', url: 'https://store.steampowered.com/app/123/' },
    s2: { store: 'steam', title: 'Dwarven Realms', state: 'queued', storeId: '456', packageId: '789' },
  };
  assert.equal(pickTestOffer(catalogue, 'steam', NOW).title, 'Dwarven Realms');
});

/* ------------------------------------------------------------ les reponses */

test('la reponse de Steam, dans le vocabulaire commun', () => {
  assert.deepEqual(fromSteamStep({ ok: true, dryRun: true, via: 'formulaire', sessionid: true }),
    { status: DRY.READY, label: 'Add to Account', details: 'formulaire de licence gratuite' });
  assert.equal(fromSteamStep({ ok: false, reason: 'deja-possede' }).status, DRY.OWNED);
  assert.equal(fromSteamStep({ ok: false, reason: 'non-connecte' }).status, DRY.LOGIN);
  assert.equal(fromSteamStep({ ok: false, reason: 'libelle-payant' }).status, DRY.REFUSED);
  const absent = fromSteamStep({ ok: false, reason: 'bouton-introuvable', labels: ['Add to Cart', 'Wishlist'] });
  assert.equal(absent.status, DRY.NO_BUTTON);
  assert.deepEqual(absent.visible, ['Add to Cart', 'Wishlist']);
  assert.equal(fromSteamStep(null).status, DRY.ERROR);
});

test('la reponse du moteur est bornee : elle vient d\'une page', () => {
  const long = 'x'.repeat(500);
  const r = fromEngine({ verdict: 'no_button', label: long, visible: [long, 'Acheter', '', 1, 2, 3, 4, 5, 6, 7] });
  assert.equal(r.status, DRY.NO_BUTTON);
  assert.equal(r.label.length, 80);
  assert.ok(r.visible.length <= 8 && r.visible.every((s) => s.length <= 45));
  assert.equal(fromEngine({ verdict: 'claimed' }).status, DRY.ERROR, 'un verdict de reclamation n\'a rien a faire ici');
  assert.equal(fromEngine(null).status, DRY.ERROR);
  assert.ok(recognised(DRY.READY) && recognised(DRY.OWNED) && !recognised(DRY.NO_BUTTON));
});

/* ------------------------------------------------------------ l'onglet */

/** Un chrome reduit a ce que l'essai touche. `onOrder` repond a l'ordre du worker. */
function fauxChrome({ landed, onOrder, executeResult } = {}) {
  const session = {};
  const faits = { created: [], removedWindows: [], sent: [], executed: [] };
  const chrome = {
    windows: {
      create: async ({ url, state }) => { faits.created.push({ url, state }); return { id: 9, tabs: [{ id: 42, url }] }; },
      remove: async (id) => { faits.removedWindows.push(id); },
    },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      get: async (id) => ({ id, status: 'complete', url: landed }),
      remove: async () => {},
      sendMessage: async (id, msg) => {
        faits.sent.push(msg);
        setTimeout(() => reportVerdict(id, 'fgc-inspection', onOrder(msg)), 5);
        return { recu: true };
      },
    },
    scripting: {
      executeScript: async (opts) => { faits.executed.push(opts); return [{ result: executeResult }]; },
    },
    storage: {
      session: {
        get: async (k) => ({ [k]: session[k] }),
        set: async (o) => { Object.assign(session, o); },
      },
    },
  };
  return { chrome, faits, session };
}

/** Le moteur s'annonce une fois l'attente posee, comme dans un vrai onglet. */
function annoncerPret(tabId) {
  const minuterie = setInterval(() => { if (reportVerdict(tabId, 'fgc-pret', { type: 'fgc-pret' })) clearInterval(minuterie); }, 2);
  return minuterie;
}

const EPIC = { store: 'epic', title: 'Shogun Showdown', url: 'https://store.epicgames.com/fr/p/shogun-showdown', catalogKey: 'k' };

test('le moteur recoit « inspecte », jamais « reclame », dans une fenetre reduite refermee apres', async () => {
  const { chrome, faits, session } = fauxChrome({
    landed: EPIC.url,
    onOrder: () => ({ type: 'fgc-inspection', verdict: 'ready', label: 'Obtenir' }),
  });
  const pret = annoncerPret(42);
  const r = await inspectOffer(EPIC, { chrome, now: NOW });
  clearInterval(pret);
  assert.deepEqual(r, { status: DRY.READY, label: 'Obtenir' });
  assert.deepEqual(faits.created, [{ url: EPIC.url, state: 'minimized' }]);
  assert.deepEqual(faits.sent.map((m) => m.type), ['fgc-inspecte']);
  assert.deepEqual(faits.removedWindows, [9], 'la fenetre de l\'essai est refermee');
  assert.deepEqual(session['veille:onglets-pilotes'], {}, 'l\'onglet n\'est plus suivi');
});

test('une redirection qui n\'arrive pas au magasin attendu ne reveille pas le moteur', async () => {
  const { chrome, faits } = fauxChrome({ landed: 'https://www.example.com/giveaway', onOrder: () => ({}) });
  const r = await inspectOffer({ store: 'gog', title: 'X', resolveUrl: 'https://www.gamerpower.com/open/x' }, { chrome, now: NOW });
  assert.equal(r.status, DRY.WRONG_PAGE);
  assert.equal(faits.sent.length, 0);
});

test('Steam rejoue son etape en dryRun : le second argument est true', async () => {
  const { chrome, faits } = fauxChrome({
    landed: 'https://store.steampowered.com/app/456/?l=english',
    executeResult: { ok: true, dryRun: true, via: 'formulaire', sessionid: true },
  });
  const r = await inspectOffer({ store: 'steam', title: 'Dwarven Realms', storeId: '456', packageId: '789' }, { chrome, now: NOW });
  assert.equal(r.status, DRY.READY);
  assert.deepEqual(faits.executed[0].args, ['789', true]);
  assert.equal(faits.created[0].url, 'https://store.steampowered.com/app/456/?l=english');
});

test('un moteur muet donne « erreur », pas un faux succes', async () => {
  const { chrome } = fauxChrome({ landed: EPIC.url, onOrder: () => ({}) });
  const r = await inspectOffer(EPIC, { chrome, now: NOW, readyWaitMs: 20 });
  assert.equal(r.status, DRY.ERROR);
  assert.equal(r.reason, DRY_ERRORS.ENGINE_ABSENT);
  assert.match(r.details, /annonce/);
});

test('un essai qui n\'aboutit pas dit pourquoi dans la langue du popup (2.66.1)', () => {
  /* La 2.64.0 affichait la phrase technique du journal, en francais sans
     accents, quelle que soit la langue choisie. */
  assert.equal(fromSteamStep(null).reason, DRY_ERRORS.NO_ANSWER);
  assert.equal(fromEngine(null).reason, DRY_ERRORS.ENGINE_SILENT);
  const src = lire('watch/dry-run.js');
  const erreurs = [...src.matchAll(/status: DRY\.ERROR[^}]*\}/g)].map((m) => m[0]);
  const codees = erreurs.filter((e) => /reason: DRY_ERRORS\.[A-Z_]+/.test(e));
  assert.equal(erreurs.length - codees.length, 1, 'seule l\'exception garde son message brut');
  for (const nom of Object.keys(DRY_ERRORS)) {
    assert.ok(codees.some((e) => e.includes(`DRY_ERRORS.${nom}`)), `${nom} sert`);
  }

  const popup = lire('pages/popup.js');
  const cles = Object.keys(DRY_ERRORS).map((nom) => {
    const m = popup.match(new RegExp(`\\[DRY_ERRORS\\.${nom}\\]: '(dryError[A-Za-z]+)'`));
    assert.ok(m, `le popup traduit ${nom}`);
    return m[1];
  });
  assert.match(popup, /t\('dryTextError', DRY_ERROR_TEXTS\[r\.reason\] \? t\(DRY_ERROR_TEXTS\[r\.reason\]\) : r\.details \|\| ''\)/);
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of cles) assert.ok(table[k] && table[k].message, `${l} ${k}`);
  }
});

/* ------------------------------------------------------------ la serie */

test('chaque magasin, l\'un apres l\'autre, avec l\'avancement ecrit a chaque pas', async () => {
  const ecrits = [];
  const journal = [];
  const catalogue = { k: { ...EPIC, state: 'queued', end: NOW + H } };
  const etat = await dryRunStores(['epic', 'gog'], {
    chrome: {},
    catalog: catalogue,
    now: NOW,
    write: async (e) => { ecrits.push(JSON.parse(JSON.stringify(e))); },
    record: (niveau, texte) => journal.push([niveau, texte]),
    inspect: async (offer) => ({ status: DRY.NO_BUTTON, visible: ['Acheter'], title: 'ignore' }),
  });
  assert.equal(ecrits[0].running, true);
  assert.deepEqual(Object.values(ecrits[0].results).map((r) => r.status), ['running', 'running']);
  assert.equal(etat.running, false);
  assert.equal(etat.results.epic.status, DRY.NO_BUTTON);
  assert.equal(etat.results.epic.title, 'Shogun Showdown', 'le titre vient du catalogue, pas de la page');
  assert.equal(etat.results.gog.status, DRY.NOTHING);
  assert.equal(journal[0][0], 'warn');
  assert.equal(ecrits.length, 4, 'depart, deux magasins, fin');
});

/* ------------------------------------------------------------ le moteur */

function bouton(texte, { disabled = false } = {}) {
  const el = {
    recu: [],
    textContent: texte,
    disabled,
    offsetWidth: 80,
    offsetHeight: 20,
    getClientRects: () => [{}],
    getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 20 }),
    dispatchEvent(ev) { el.recu.push(ev.type); return true; },
    click() { el.recu.push('click-natif'); },
  };
  return el;
}

function page(hostname, pathname, boutons, { patience = false } = {}) {
  const { fgc, sandbox } = loadEngine({ hostname, pathname });
  sandbox.document.querySelectorAll = (sel) => (/button/.test(sel) ? boutons : []);
  // Sans horloge, une attente ne finit jamais : on la fait expirer tout de suite.
  if (patience) sandbox.setTimeout = (fn) => { fn(); return 0; };
  return new Promise((resolve) => fgc.inspectPage(resolve));
}

test('le moteur lit la page Epic sans rien cliquer', async () => {
  const obtenir = bouton('Obtenir');
  const r = await page('store.epicgames.com', '/fr/p/shogun-showdown', [bouton('Liste de souhaits'), obtenir]);
  assert.equal(r.type, 'fgc-inspection');
  assert.equal(r.verdict, 'ready');
  assert.equal(r.label, 'Obtenir');
  assert.equal(r.plateforme, 'Epic Games');
  assert.deepEqual(obtenir.recu, [], 'aucun evenement, aucun clic');

  assert.equal((await page('store.epicgames.com', '/fr/p/x', [bouton('Dans la bibliothèque')])).verdict, 'owned');
  assert.equal((await page('store.epicgames.com', '/fr/p/x', [bouton('Se connecter'), bouton('Obtenir')])).verdict, 'needs_login');
});

test('aucun bouton reconnu : le moteur rend ceux qu\'il a vus', async () => {
  const r = await page('www.gog.com', '/fr/game/x', [bouton('Acheter maintenant'), bouton('Liste de souhaits')], { patience: true });
  assert.equal(r.verdict, 'no_button');
  assert.deepEqual([...r.visible], ['Acheter maintenant', 'Liste de souhaits']);
  assert.equal((await page('www.gog.com', '/fr/game/x', [bouton('Ajouter à la bibliothèque')])).verdict, 'ready');
});

test('un bouton reconnu mais payant est « refuse », comme il le serait au clic', async () => {
  // « add to library » n'est pas ancre chez GOG : le montant, lui, suffit a refuser.
  const payant = bouton('Add to library for 9,99 €');
  const r = await page('www.gog.com', '/fr/game/x', [payant]);
  assert.equal(r.verdict, 'refused');
  assert.equal(r.label, 'Add to library for 9,99 €');
  assert.deepEqual(payant.recu, []);
});

test('le bloc de l\'essai a blanc ne contient aucun clic', () => {
  const src = lire('src/core/31-bootstrap.js');
  const debut = src.indexOf('Essai a blanc (2.64.0)');
  const fin = src.indexOf('function listenForOrders');
  assert.ok(debut > 0 && fin > debut);
  const bloc = src.slice(debut, fin);
  for (const interdit of [/robustClick\(/, /\.click\(/, /requestSubmit/, /\.submit\(/, /dispatchEvent/, /location\.assign/]) {
    assert.doesNotMatch(bloc, interdit);
  }
  assert.match(src, /if \(msg\.type === 'fgc-inspecte'\) \{\s*sendResponse\(\{ recu: true \}\);\s*inspectPage\(sendToPilot\);/);
});

/* ------------------------------------------------------------ le branchement */

test('l\'essai part d\'une page de l\'extension, la reponse d\'un script de contenu', () => {
  assert.ok(UI_COMMANDS.includes('fgc-dry-run'));
  assert.ok(CONTENT_MESSAGES.includes('fgc-inspection'));
  assert.equal(messageAllowed('fgc-dry-run', 'content'), false);
  assert.equal(messageAllowed('fgc-inspection', 'page'), false);
  const bg = lire('background.js');
  assert.match(bg, /msg\.type === 'fgc-pret' \|\| msg\.type === 'fgc-verdict' \|\| msg\.type === 'fgc-inspection'/);
  assert.match(bg, /if \(await isStopped\(api\)\) return \{ stopped: true \};/);
  const html = lire('pages/popup.html');
  assert.match(html, /<button class="btn-sm" id="dry-run" data-i18n="dryRunButton"/);
  const js = lire('pages/popup.js');
  const liste = js.slice(js.indexOf('const KEYS_READ = ['), js.indexOf('];', js.indexOf('const KEYS_READ = [')));
  assert.match(liste, /\n\s+KEY_DRY_RUN,\r?\n/, 'le popup relit l\'essai quand il change');
  assert.equal(KEY_DRY_RUN, 'veille:essai-a-blanc');
  for (const l of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const k of ['dryRunButton', 'dryRunHint', 'dryTextReady', 'dryTextNoButton', 'drySeen']) assert.ok(table[k], `${l} ${k}`);
  }
});
