/* Etes-vous connecte, magasin par magasin ?
 *
 * Ce fichier tient la promesse du module, et d'abord celle qui a coute trois
 * versions en septembre 2026 : **ne pas savoir n'est pas etre deconnecte**.
 * Une lecture muette prise pour une absence de session, et l'extension
 * envoyait se reconnecter quelqu'un qui l'etait deja -- ou, pire, ne faisait
 * rien du tout en silence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SESSION, PROBED_STORES, LOGIN_URLS, STALE_AFTER_MS,
  fromImportStatus, readSession, recordSession, isStale, summarise, OUT_CONFIRM_MS,
  VIA_PAGE, PAGE_URLS, PAGE_STORES, PAGE_RECHECK_MS, REFRESH_AFTER_MS,
  judgePage, needsPage, settle, dueForProbe,
} from '../watch/session.js';
import { landOnPage } from '../watch/session-page.js';
import { IMPORT_STATUS } from '../watch/collection.js';
import { probeSession } from '../watch/collection-import.js';
import { OWNED_URL } from '../watch/sources/steam.js';

const T = Date.UTC(2026, 8, 20, 12, 0, 0);

/* ------------------------------------------------------------ traduction */

test('une forme inattendue est « inconnu », jamais « deconnecte »', () => {
  /* La lecon de la 2.22.2, tenue par un test. Une adresse qui a change
     ressemble a une session absente ; les confondre envoie l'utilisateur
     tourner en rond. */
  assert.equal(fromImportStatus(IMPORT_STATUS.SHAPE), SESSION.UNKNOWN);
  assert.equal(fromImportStatus(IMPORT_STATUS.ERROR), SESSION.UNKNOWN);
  assert.equal(fromImportStatus(undefined), SESSION.UNKNOWN);
  assert.equal(fromImportStatus(null), SESSION.UNKNOWN);

  assert.equal(fromImportStatus(IMPORT_STATUS.OK), SESSION.OK);
  assert.equal(fromImportStatus(IMPORT_STATUS.LOGGED_OUT), SESSION.OUT);
});

/* ---------------------------------------------------------------- etat */

test('un magasin jamais sonde rend « inconnu » sans date, pas une absence', () => {
  const vide = readSession({}, 'steam');
  assert.equal(vide.status, SESSION.UNKNOWN);
  assert.equal(vide.at, null);

  // Amazon n'a aucune lecture mesuree : c'est « non sondable », et les deux
  // ne veulent pas dire la meme chose -- l'un attend une mesure, l'autre du code.
  assert.equal(readSession({}, 'amazon').status, SESSION.UNSUPPORTED);
  assert.ok(!PROBED_STORES.includes('amazon'));
});

test('une valeur abimee au stockage ne devient pas un « connecte »', () => {
  for (const abime of [{ status: 'oui' }, { status: true }, 'texte', 42, null]) {
    assert.equal(readSession({ steam: abime }, 'steam').status, SESSION.UNKNOWN);
  }
  // Une date illisible ne doit pas non plus passer pour une mesure fraiche.
  assert.equal(readSession({ steam: { status: 'ok', at: 'hier' } }, 'steam').at, null);
});

test('enregistrer ne modifie rien en place, et borne la note', () => {
  const avant = { gog: { status: SESSION.OK, note: 'a', at: 1 } };
  const apres = recordSession(avant, 'steam', { status: SESSION.OUT, note: 'x'.repeat(400) }, T);

  assert.equal(avant.steam, undefined, 'l\'etat d\'origine est intact');
  assert.equal(apres.gog.at, 1, 'les autres magasins survivent');
  assert.equal(apres.steam.status, SESSION.OUT);
  assert.equal(apres.steam.at, T);
  assert.equal(apres.steam.note.length, 160);

  assert.throws(() => recordSession({}, 'steam', { status: SESSION.OK }), /maintenant/);
});

/* ----------------------------------------------------------- fraicheur */

test('une mesure vieille de plus de six heures ne dit plus rien d\'aujourd\'hui', () => {
  assert.equal(isStale({ at: T - STALE_AFTER_MS + 1000 }, T), false);
  assert.equal(isStale({ at: T - STALE_AFTER_MS - 1000 }, T), true);
  assert.equal(isStale(undefined, T), true);
  assert.equal(isStale({ at: null }, T), true);
});

/* -------------------------------------------------------------- resume */

test('seul « deconnecte » appelle un geste ; « inconnu » n\'envoie personne', () => {
  const etat = {
    steam: { status: SESSION.OK, at: T },
    gog: { status: SESSION.OUT, at: T },
    epic: { status: SESSION.UNKNOWN, at: T },
  };
  const bilan = summarise(etat, { watchedStores: PROBED_STORES });
  assert.equal(bilan.ok, 1);
  assert.equal(bilan.out, 1);
  assert.equal(bilan.unknown, 1);
  assert.deepEqual(bilan.actionable, ['gog'], 'inconnu n\'est PAS actionnable');
  assert.ok(LOGIN_URLS.gog, 'un magasin actionnable a une adresse ou aller');
});

/* --------------------------------------------------------------- sonde */

/* `json()` autant que `text()` : la sonde GOG/Epic lit le corps en TEXTE
   (une session expiree rend souvent du HTML), la sonde Steam passe par
   readOwnership, qui appelle `json()`. Un faux qui n'offre qu'un des deux
   ferait echouer la moitie des cas pour une mauvaise raison. */
const reponse = (body, { status = 200, url = 'https://x/', type = 'application/json' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  url,
  headers: { get: () => type },
  text: async () => JSON.stringify(body),
  json: async () => body,
});

test('Steam : des listes vides sont une deconnexion, et rien d\'autre ne l\'est', async () => {
  /* Mesure du 2026-09-19 : sans session, userdata repond 200 avec des listes
     VIDES. `judge` n'y verrait rien d'anormal -- d'ou le detour par
     readOwnership pour ce magasin, et ce test pour qu'il y reste. */
  const vu = [];
  const out = await probeSession('steam', {
    fetch: async (url) => { vu.push(url); return reponse({ rgOwnedApps: [], rgOwnedPackages: [] }); },
  });
  assert.equal(out.status, IMPORT_STATUS.LOGGED_OUT);
  assert.ok(vu[0].startsWith(OWNED_URL));

  const dedans = await probeSession('steam', {
    fetch: async () => reponse({ rgOwnedApps: [10, 20], rgOwnedPackages: [5] }),
  });
  assert.equal(dedans.status, IMPORT_STATUS.OK);
  assert.match(dedans.note, /2 jeu/);

  const casse = await probeSession('steam', { fetch: async () => reponse({}, { status: 500 }) });
  assert.equal(casse.status, IMPORT_STATUS.ERROR);
});

test('GOG et Epic : une seule page, et le verdict deja mesure de l\'import', async () => {
  const pages = [];
  const attrape = (body, opts) => async (url) => { pages.push(url); return reponse(body, opts); };

  // Le refus mesure le 2026-09-19 sur GOG, sans session.
  const gogOut = await probeSession('gog', {
    fetch: attrape({ status: 403, message: 'Full authentication is required to access this resource.' },
      { status: 403 }),
  });
  assert.equal(gogOut.status, IMPORT_STATUS.LOGGED_OUT);
  assert.match(pages[0], /page=1$/, 'une sonde ne rapatrie pas une bibliotheque');

  // Une redirection vers la connexion : le cas Epic mesure le meme jour.
  const epicOut = await probeSession('epic', {
    fetch: async () => reponse({}, { url: 'https://www.epicgames.com/id/login' }),
  });
  assert.equal(epicOut.status, IMPORT_STATUS.LOGGED_OUT);

  const gogIn = await probeSession('gog', { fetch: async () => reponse({ products: [], totalPages: 1 }) });
  assert.equal(gogIn.status, IMPORT_STATUS.OK);

  // Une page HTML : on ne sait pas. Surtout pas « deconnecte ».
  const flou = await probeSession('gog', {
    fetch: async () => ({
      ok: true, status: 200, url: 'https://www.gog.com/account',
      headers: { get: () => 'text/html' },
      text: async () => '<html><title>GOG</title></html>',
    }),
  });
  assert.equal(flou.status, IMPORT_STATUS.SHAPE);
  assert.equal(fromImportStatus(flou.status), SESSION.UNKNOWN);
});

test('un magasin sans sonde le dit, il ne plante pas', async () => {
  const r = await probeSession('amazon', { fetch: async () => { throw new Error('jamais appele'); } });
  assert.equal(r.status, IMPORT_STATUS.ERROR);
  assert.match(r.note, /sans sonde/);
});

test('la serie de « deconnecte » garde son debut, et toute autre mesure la casse (2.99.4)', () => {
  let e = recordSession({}, 'gog', { status: SESSION.OUT }, T);
  assert.equal(e.gog.outSince, T);
  e = recordSession(e, 'gog', { status: SESSION.OUT }, T + 40 * 60000);
  assert.equal(e.gog.outSince, T, 'le debut ne bouge pas');
  assert.equal(readSession(e, 'gog').outSince, T);
  // Une mesure « inconnue » (reseau coupe) interrompt la serie : le doute n'est pas une confirmation.
  e = recordSession(e, 'gog', { status: SESSION.UNKNOWN }, T + 50 * 60000);
  assert.equal(e.gog.outSince, undefined);
  e = recordSession(e, 'gog', { status: SESSION.OUT }, T + 60 * 60000);
  assert.equal(e.gog.outSince, T + 60 * 60000, 'une nouvelle serie repart de zero');
  e = recordSession(e, 'gog', { status: SESSION.OK }, T + 70 * 60000);
  assert.equal(readSession(e, 'gog').outSince, null);
  assert.equal(OUT_CONFIRM_MS, 30 * 60 * 1000);
});


/* ======================================================================
 * Confirmer par la page (2.99.6)
 *
 * Steam et Epic renouvellent leurs jetons quand leur PAGE se charge. Passees
 * quelques heures, la sonde rapide voit un jeton expire et dit « deconnecte »
 * a quelqu'un qui est connecte -- jusqu'a ce qu'il ouvre le magasin lui-meme.
 * ====================================================================== */

test('Steam : la redirection MESUREE vers /login/ dit deconnecte, rester sur /account/ dit connecte', () => {
  assert.equal(judgePage('steam', 'https://store.steampowered.com/login/?redir=account%2F&redir_ssl=1', 'Connexion'), SESSION.OUT);
  assert.equal(judgePage('steam', 'https://login.steampowered.com/jwt/refresh?redir=x', null), SESSION.OUT);
  assert.equal(judgePage('steam', 'https://store.steampowered.com/account/', 'Steam account details'), SESSION.OK);
  assert.equal(judgePage('steam', 'https://store.steampowered.com/account/?l=french', null), SESSION.OK);
});

test('Epic : /id/login dit deconnecte, /account dit connecte', () => {
  assert.equal(judgePage('epic', 'https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Faccount%2Fpersonal', null), SESSION.OUT);
  assert.equal(judgePage('epic', 'https://www.epicgames.com/id/login/epic?lang=fr', null), SESSION.OUT);
  assert.equal(judgePage('epic', 'https://www.epicgames.com/account/personal', 'Compte'), SESSION.OK);
});

test('une page muette ne dit JAMAIS deconnecte : defi anti-robot, controle d\'age, page etrangere, rien', () => {
  assert.equal(judgePage('steam', null, null), SESSION.UNKNOWN);
  assert.equal(judgePage('steam', 'https://store.steampowered.com/agecheck/app/1', null), SESSION.UNKNOWN);
  assert.equal(judgePage('steam', 'https://store.steampowered.com/account/', 'Just a moment...'), SESSION.UNKNOWN);
  assert.equal(judgePage('epic', 'https://www.epicgames.com/account/personal', 'Un instant…'), SESSION.UNKNOWN);
  assert.equal(judgePage('epic', 'https://exemple.test/id/login', null), SESSION.UNKNOWN);
  assert.equal(judgePage('gog', 'https://www.gog.com/account', null), SESSION.UNKNOWN);
});

test('seuls Steam et Epic passent par la page ; GOG garde sa sonde JSON', () => {
  assert.deepEqual([...PAGE_STORES].sort(), ['epic', 'steam']);
  assert.ok(PAGE_URLS.steam.startsWith('https://store.steampowered.com/'));
  assert.ok(PAGE_URLS.epic.startsWith('https://www.epicgames.com/'));
  assert.equal(needsPage('gog', SESSION.OUT, null, T), false);
});

test('un « oui » de la sonde se croit tel quel : aucune page chargee', () => {
  assert.equal(needsPage('steam', SESSION.OK, null, T), false);
  assert.equal(needsPage('epic', SESSION.OK, null, T), false);
  const r = settle('steam', { status: SESSION.OK, note: '12 jeu(x) vus' }, undefined, null, T);
  assert.equal(r.status, SESSION.OK);
  assert.equal(r.via, null);
});

test('un « non » ou un « inconnu » de la sonde declenche la page', () => {
  assert.equal(needsPage('steam', SESSION.OUT, null, T), true);
  assert.equal(needsPage('steam', SESSION.UNKNOWN, null, T), true);
  assert.equal(needsPage('epic', SESSION.OUT, { status: SESSION.OK, at: T - 9 * 3600000, via: null }, T), true);
});

test('jetons expires mais compte connecte : la page remet « connecte » (le cas signale)', () => {
  const rapide = { status: SESSION.OUT, note: 'listes vides' };
  const r = settle('steam', rapide, { url: 'https://store.steampowered.com/account/', title: 'Steam' }, null, T);
  assert.equal(r.status, SESSION.OK);
  assert.equal(r.via, VIA_PAGE);
  const e = settle('epic', { status: SESSION.OUT, note: 'redirige vers la connexion' }, { url: 'https://www.epicgames.com/account/personal', title: 'Epic' }, null, T);
  assert.equal(e.status, SESSION.OK);
});

test('sans page, un « non » de la sonde n\'est PAS « deconnecte » pour Steam et Epic', () => {
  const r = settle('steam', { status: SESSION.OUT, note: 'listes vides' }, undefined, null, T);
  assert.equal(r.status, SESSION.UNKNOWN);
  assert.match(r.note, /non confirmee/);
  // La page n'a pas charge (null) : meme regle.
  assert.equal(settle('epic', { status: SESSION.OUT, note: 'x' }, null, null, T).status, SESSION.UNKNOWN);
});

test('GOG, sans page possible, garde son verdict de la sonde', () => {
  assert.equal(settle('gog', { status: SESSION.OUT, note: 'Full authentication is required' }, undefined, null, T).status, SESSION.OUT);
});

test('la page qui renvoie vers la connexion confirme la perte, et elle est datee comme venant d\'une page', () => {
  const r = settle('steam', { status: SESSION.OUT, note: 'listes vides' }, { url: 'https://store.steampowered.com/login/?redir=account%2F', title: 'Connexion' }, null, T);
  assert.equal(r.status, SESSION.OUT);
  assert.equal(r.via, VIA_PAGE);
  const etat = recordSession({}, 'steam', { status: r.status, note: r.note, via: r.via }, T);
  assert.equal(readSession(etat, 'steam').via, VIA_PAGE);
  // Une mesure ordinaire ne porte pas la marque.
  assert.equal(readSession(recordSession({}, 'steam', { status: SESSION.OK }, T), 'steam').via, null);
});

test('une page muette (defi anti-robot) laisse « inconnu », jamais « deconnecte »', () => {
  const r = settle('epic', { status: SESSION.OUT, note: 'x' }, { url: 'https://www.epicgames.com/account/personal', title: 'Just a moment...' }, null, T);
  assert.equal(r.status, SESSION.UNKNOWN);
  assert.equal(r.via, null);
});

test('une perte montree par une page n\'ouvre pas de fenetre avant six heures', () => {
  const perdu = readSession(recordSession({}, 'steam', { status: SESSION.OUT, note: 'la page renvoie vers la connexion', via: VIA_PAGE }, T - 3600000), 'steam');
  assert.equal(needsPage('steam', SESSION.OUT, perdu, T), false);
  const r = settle('steam', { status: SESSION.OUT, note: 'listes vides' }, undefined, perdu, T);
  assert.equal(r.keep, true);
  assert.equal(r.status, SESSION.OUT);
  // Passe le delai, on regarde a nouveau.
  assert.equal(needsPage('steam', SESSION.OUT, perdu, T + PAGE_RECHECK_MS), true);
  // Et si l'utilisateur s'est reconnecte, la sonde rapide le voit sans page.
  assert.equal(settle('steam', { status: SESSION.OK, note: '3 jeu(x) vus' }, undefined, perdu, T).status, SESSION.OK);
});

test('dueForProbe : jamais mesure, « connecte » qui vieillit, autre chose apres une demi-heure', () => {
  assert.equal(dueForProbe(null, T), true);
  assert.equal(dueForProbe({}, T), true);
  const ok = { status: SESSION.OK, at: T - 3600000 };
  assert.equal(dueForProbe(ok, T), false, 'une heure : trop tot');
  assert.equal(dueForProbe({ ...ok, at: T - REFRESH_AFTER_MS - 1 }, T), true);
  // Toujours avant les six heures ou l'interface le montre en ambre.
  assert.ok(REFRESH_AFTER_MS < STALE_AFTER_MS);
  const out = { status: SESSION.OUT, at: T - 10 * 60000 };
  assert.equal(dueForProbe(out, T), false);
  assert.equal(dueForProbe({ ...out, at: T - OUT_CONFIRM_MS }, T), true);
  assert.equal(dueForProbe({ status: SESSION.UNKNOWN, at: T - OUT_CONFIRM_MS - 1 }, T), true);
});

/* ------------------------------------------------- landOnPage, faux chrome */

function fauxChrome({ url, title = 'Titre', loads = true, failOpen = false } = {}) {
  const calls = [];
  const listeners = [];
  const tab = { id: 7, status: 'loading', url, title };
  const zone = {};
  const chrome = {
    calls,
    windows: {
      create: async (o) => { calls.push(['windows.create', o.url]); if (failOpen) throw new Error('refus'); return { id: 3, tabs: [tab] }; },
      remove: async (id) => { calls.push(['windows.remove', id]); },
    },
    tabs: {
      get: async () => { if (loads) tab.status = 'complete'; return tab; },
      remove: async (id) => { calls.push(['tabs.remove', id]); },
      create: async (o) => { calls.push(['tabs.create', o.url]); if (failOpen) throw new Error('refus'); return tab; },
      onUpdated: { addListener: (f) => listeners.push(f), removeListener: () => {} },
      onRemoved: { addListener: () => {}, removeListener: () => {} },
    },
    storage: { session: { get: async (k) => (typeof k === 'string' ? { [k]: zone[k] } : {}), set: async (o) => Object.assign(zone, o), remove: async () => {} } },
  };
  return chrome;
}

test('landOnPage : ouvre la page du compte, lit ou elle a atterri, referme la fenetre', async () => {
  const chrome = fauxChrome({ url: 'https://store.steampowered.com/login/?redir=account%2F', title: 'Connexion' });
  const r = await landOnPage('steam', { chrome, now: T, loadWaitMs: 500, settle: async () => {} });
  assert.deepEqual(r, { url: 'https://store.steampowered.com/login/?redir=account%2F', title: 'Connexion' });
  assert.deepEqual(chrome.calls[0], ['windows.create', PAGE_URLS.steam]);
  assert.ok(chrome.calls.some((c) => c[0] === 'windows.remove'), 'la fenetre est refermee');
});

test('landOnPage : une page qui ne charge pas rend null, et referme quand meme', async () => {
  const chrome = fauxChrome({ url: 'https://www.epicgames.com/', loads: false });
  const r = await landOnPage('epic', { chrome, now: T, loadWaitMs: 30, settle: async () => {} });
  assert.equal(r, null);
  assert.ok(chrome.calls.some((c) => c[0] === 'windows.remove'));
});

test('landOnPage : un magasin sans page, ou une ouverture refusee, ne jette jamais', async () => {
  assert.equal(await landOnPage('gog', { chrome: fauxChrome({ url: 'x' }), now: T }), null);
  const chrome = fauxChrome({ url: 'x', failOpen: true });
  assert.equal(await landOnPage('steam', { chrome, now: T, loadWaitMs: 30, settle: async () => {} }), null);
});
