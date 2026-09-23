/* Qui a le droit de demander quoi au service worker.
 *
 * Trois faiblesses de defense en profondeur, relevees par un audit et
 * fermees en 2.24.0. Aucune n'etait joignable depuis le web -- sans
 * `externally_connectable`, aucune page ne parle a l'extension -- mais les
 * trois tenaient la meme promesse implicite : « personne d'autre que nous
 * n'appellera ceci ». Une promesse implicite n'est pas une garde.
 *
 *   - le relais reseau acceptait n'importe quelle URL, methode et en-tete ;
 *   - l'ouverture d'onglet ne verifiait aucun schema ;
 *   - aucune des seize commandes ne regardait QUI la demandait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  senderKind, messageAllowed, isOurs, hostMatchers, relayRequest,
  UI_COMMANDS, CONTENT_MESSAGES,
} from '../watch/messaging.js';
import { webUrl, makeOffer } from '../watch/offer.js';
import { makeItem, storePageUrl } from '../watch/collection.js';

const BASE = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

/* ------------------------------------------------------ origine du message */

test('l\'URL tranche avant l\'onglet : une page d\'extension en a un aussi', () => {
  // Le popup : pas d'onglet du tout.
  assert.equal(senderKind({ url: BASE + 'pages/popup.html' }, BASE), 'page');
  // Le journal : une page de l'extension, mais dans un onglet. C'est le cas
  // qui casserait une detection fondee sur la seule presence de sender.tab.
  assert.equal(senderKind({ url: BASE + 'pages/journal.html', tab: { id: 7 } }, BASE), 'page');
  assert.equal(senderKind({ url: BASE + 'pages/collection.html', tab: { id: 8 } }, BASE), 'page');

  // Un script de contenu : un onglet, et une URL de magasin.
  assert.equal(senderKind({ url: 'https://store.epicgames.com/p/x', tab: { id: 9 } }, BASE), 'content');

  // Ni l'un ni l'autre.
  assert.equal(senderKind({}, BASE), 'inconnu');
  assert.equal(senderKind(null, BASE), 'inconnu');
  assert.equal(senderKind({ url: 'https://evil.example/' }, BASE), 'inconnu');
});

test('une autre extension ne passe pas pour la notre', () => {
  const autre = 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/popup.html';
  assert.equal(senderKind({ url: autre }, BASE), 'inconnu');
  assert.equal(senderKind({ url: autre, tab: { id: 3 } }, BASE), 'content');
});

test('les commandes d\'interface refusent un script de contenu', () => {
  /* Le coeur du correctif. `fgc-collection-import` declenche des lectures
     AVEC les cookies de l'utilisateur sur Steam, GOG et Epic ; une page de
     magasin n'a aucune raison de pouvoir la demander. */
  for (const type of UI_COMMANDS) {
    assert.equal(messageAllowed(type, 'page'), true, type);
    assert.equal(messageAllowed(type, 'content'), false, type);
    assert.equal(messageAllowed(type, 'inconnu'), false, type);
  }
  assert.ok(UI_COMMANDS.includes('fgc-collection-import'));
  assert.ok(UI_COMMANDS.includes('fgc-claim-all'));
  assert.ok(UI_COMMANDS.includes('fgc-journal-clear'));
});

test('les messages du moteur refusent une page d\'extension', () => {
  for (const type of CONTENT_MESSAGES) {
    assert.equal(messageAllowed(type, 'content'), true, type);
    assert.equal(messageAllowed(type, 'page'), false, type);
  }
});

test('ce qui ne nous est pas adresse passe en silence', () => {
  /* `sendMessage` arrose tous les contextes. La page de diagnostic parle au
     document de sonde par `fgc-diag-offscreen-run` ; le worker le recoit
     aussi, n'a jamais eu de branche pour lui, et ne doit pas le journaliser
     comme un refus a chaque mesure. */
  assert.equal(isOurs('fgc-diag-offscreen-run'), false);
  assert.equal(isOurs('fgc-offscreen-html'), false);
  assert.equal(isOurs('fgc-reclame'), false, 'celui-la va du worker vers l\'onglet');

  for (const type of [...UI_COMMANDS, ...CONTENT_MESSAGES]) {
    assert.equal(isOurs(type), true, type);
  }
});

test('un type inconnu est refuse, et les deux listes ne se chevauchent pas', () => {
  /* Refuser par defaut : une branche ajoutee au worker sans etre inscrite
     ici doit echouer en test, pas passer en silence en production. */
  for (const kind of ['page', 'content', 'inconnu']) {
    assert.equal(messageAllowed('fgc-inconnu', kind), false);
    assert.equal(messageAllowed('', kind), false);
    assert.equal(messageAllowed(undefined, kind), false);
  }
  const croisement = UI_COMMANDS.filter((t) => CONTENT_MESSAGES.includes(t));
  assert.deepEqual(croisement, [], 'un type ne peut pas etre des deux bords');
});

/* -------------------------------------------------------------- le relais */

const MANIFESTE = [
  'https://*.epicgames.com/*',
  'https://www.gog.com/*',
  'https://store-site-backend-static.ak.epicgames.com/*',
  'https://api.frankfurter.dev/*',
];
const HOTES = hostMatchers(MANIFESTE);

test('le relais laisse passer ce que son seul appelant reel demande', () => {
  /* La verification de l'API publique Epic : un GET, un en-tete Accept. */
  const r = relayRequest({
    url: 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr',
    headers: { Accept: 'application/json' },
  }, HOTES);
  assert.equal(r.refus, undefined, JSON.stringify(r));
  assert.equal(r.init.method, 'GET');
  assert.equal(r.init.credentials, 'omit');
  assert.deepEqual(r.init.headers, { Accept: 'application/json' });
});

test('le joker de sous-domaine du manifeste est respecte, sans deborder', () => {
  const ok = (h) => relayRequest({ url: `https://${h}/x` }, HOTES).refus === undefined;
  assert.ok(ok('store.epicgames.com'));
  assert.ok(ok('accounts.epicgames.com'));
  assert.ok(ok('epicgames.com'), 'le domaine nu est couvert par *.');
  assert.ok(ok('www.gog.com'));

  // « *.epicgames.com » ne doit pas couvrir un domaine qui s'en approche.
  assert.ok(!ok('epicgames.com.evil.test'));
  assert.ok(!ok('notepicgames.com'));
  assert.ok(!ok('gog.com'), 'le manifeste ne liste que www.gog.com pour le relais');
});

test('le relais refuse tout ce qui n\'est pas un GET HTTPS vers un hote permis', () => {
  const refus = (msg) => relayRequest(msg, HOTES).refus;

  // Le cas qui motivait le correctif : sonder une adresse interne.
  assert.match(refus({ url: 'http://localhost:8080/' }), /schema refuse/);
  assert.match(refus({ url: 'http://127.0.0.1/' }), /schema refuse/);
  assert.match(refus({ url: 'https://192.168.1.1/' }), /hote hors permissions/);
  assert.match(refus({ url: 'https://evil.example/collecte' }), /hote hors permissions/);

  assert.match(refus({ url: 'file:///etc/passwd' }), /schema refuse/);
  assert.match(refus({ url: 'pas une url' }), /URL illisible/);
  assert.match(refus({ url: '' }), /URL illisible/);

  for (const method of ['POST', 'PUT', 'DELETE', 'patch']) {
    assert.match(refus({ url: 'https://www.gog.com/x', method }), /methode refusee/, method);
  }
});

test('le relais ne recopie que Accept, et seulement s\'il est plausible', () => {
  const init = (headers) => relayRequest({ url: 'https://www.gog.com/x', headers }, HOTES).init;

  // Tout le reste est jete : le relais n'est pas un tunnel.
  assert.deepEqual(init({ Cookie: 'session=vole', Authorization: 'Bearer x' }).headers, {});
  assert.deepEqual(init({ 'X-Forwarded-For': '10.0.0.1' }).headers, {});

  // La casse de l'en-tete ne doit pas servir a le faire passer inapercu.
  assert.deepEqual(init({ accept: 'text/html' }).headers, { Accept: 'text/html' });

  // Une valeur qui tente une injection de retour chariot est refusee.
  assert.deepEqual(init({ Accept: 'a\r\nX-Injecte: 1' }).headers, {});
  assert.deepEqual(init({ Accept: 'x'.repeat(200) }).headers, {});
});

/* ------------------------------------------------- les URL, un seul filtre */

test('webUrl est le point de passage, et il n\'accepte que http(s)', () => {
  for (const bon of ['https://www.gog.com/x', 'http://example.test/y']) {
    assert.equal(webUrl(bon), bon);
  }
  for (const mauvais of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'chrome-extension://abc/popup.html',
    'file:///etc/passwd',
    'steam://run/440',
    'vbscript:msgbox',
    '',
    null,
    undefined,
  ]) {
    assert.equal(webUrl(mauvais), null, String(mauvais));
  }
});

test('une entree de collection filtre son URL comme une offre', () => {
  /* L'asymetrie relevee par l'audit : makeOffer filtrait, makeItem non --
     alors que son `url` vient d'une reponse GOG lue AVEC la session, et
     finit dans un href de la page Collection. */
  assert.equal(makeItem({ store: 'gog', id: '1', title: 'X', url: 'javascript:alert(1)' }).url, null);
  assert.equal(makeItem({ store: 'gog', id: '1', title: 'X', url: 'https://www.gog.com/game/x' }).url,
    'https://www.gog.com/game/x');
  assert.equal(makeOffer({ store: 'gog', title: 'X', url: 'javascript:alert(1)' }).url, null);

  // Et storePageUrl refiltre : une collection ecrite avant ce controle peut
  // encore porter n'importe quoi.
  assert.equal(storePageUrl('gog', { id: '1', url: 'javascript:alert(1)' }), null);
  assert.equal(storePageUrl('steam', { id: '440', url: 'javascript:alert(1)' }),
    'https://store.steampowered.com/app/440/', 'le repli construit par identifiant tient toujours');
});
