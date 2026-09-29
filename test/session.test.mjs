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
} from '../watch/session.js';
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
