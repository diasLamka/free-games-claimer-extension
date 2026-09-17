/* Tests du document offscreen : le cycle de vie, pas le parsing.
 *
 * Le parsing lui-meme demande un navigateur et vit dans offscreen-html.js, que
 * ces tests ne chargent pas -- c'est precisement pourquoi cette page ne
 * contient aucune connaissance de magasin. Ce qui se teste ici est ce qui
 * casse en production : deux documents crees, un document laisse ouvert, une
 * plateforme qui n'en a pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  OFFSCREEN_URL,
  REASON,
  hasOffscreen,
  ensureDocument,
  closeDocument,
  queryHtml,
  firstText,
  firstValue,
} from '../watch/offscreen.js';

/* -------------------------------------------------------- disponibilite */

test('une plateforme sans offscreen se declare, elle ne jette pas', async () => {
  // Firefox n'a pas chrome.offscreen. Une source HTML doit pouvoir dire
  // « indisponible » plutot que de faire tomber le cycle qui l'interroge.
  const sans = { runtime: {} };
  assert.equal(hasOffscreen(sans), false);
  assert.equal(await ensureDocument(sans), false);

  const r = await queryHtml(sans, { url: 'https://exemple.test/' });
  assert.equal(r.ok, false);
  assert.match(r.error, /indisponible/);
});

test('une URL manquante est refusee avant toute creation', async () => {
  const { chrome, offscreen } = fakeChrome();
  const r = await queryHtml(chrome, {});
  assert.equal(r.ok, false);
  assert.equal(offscreen.creations, 0, 'rien ne doit etre cree pour une requete vide');
});

/* ------------------------------------------------------- cycle de vie */

test('le document est cree une fois, avec le motif declare', async () => {
  const { chrome, offscreen } = fakeChrome();
  assert.equal(await ensureDocument(chrome), true);

  assert.equal(offscreen.creations, 1);
  assert.equal(offscreen.dernier.url, OFFSCREEN_URL);
  assert.deepEqual(Array.from(offscreen.dernier.reasons), [REASON]);
  assert.ok(offscreen.dernier.justification.length > 20, 'la justification est lue par le Web Store');
});

test('un document deja ouvert n\'en fait pas creer un second', async () => {
  // La plateforme n'en autorise qu'un pour toute l'extension, et createDocument
  // REJETTE au second. Le faux reproduit ce refus.
  const { chrome, offscreen } = fakeChrome();
  await ensureDocument(chrome);
  assert.equal(await ensureDocument(chrome), true);
  assert.equal(offscreen.creations, 1, 'le second appel doit se contenter du document existant');
});

test('fermer un document absent ne jette pas', async () => {
  const { chrome } = fakeChrome();
  await closeDocument(chrome);   // rien d'ouvert
  assert.ok(true);
});

/* ------------------------------------------------------------ requete */

test('une lecture rend le resultat et REFERME derriere elle', async () => {
  // Un document laisse ouvert tient le service worker eveille et consomme un
  // processus pour rien.
  const { chrome, offscreen, repondreOffscreen, messagesRecus } = fakeChrome();
  repondreOffscreen(() => ({ ok: true, status: 200, results: { titre: [{ text: 'Un jeu', value: null }] } }));

  const r = await queryHtml(chrome, {
    url: 'https://exemple.test/',
    queries: [{ name: 'titre', selector: '.giveaway__title' }],
  });

  assert.equal(r.ok, true);
  assert.equal(firstText(r.results.titre), 'Un jeu');
  assert.equal(offscreen.ouvert, false, 'le document doit etre referme');
  assert.equal(offscreen.fermetures, 1);
  assert.equal(messagesRecus[0].type, 'fgc-offscreen-html');
  assert.equal(messagesRecus[0].url, 'https://exemple.test/');
});

test('une page muette se lit comme une page muette, sans exception', async () => {
  const { chrome, offscreen, repondreOffscreen } = fakeChrome();
  repondreOffscreen(() => undefined);

  const r = await queryHtml(chrome, { url: 'https://exemple.test/' });
  assert.equal(r.ok, false);
  assert.match(r.error, /aucune reponse/);
  assert.equal(offscreen.ouvert, false, 'meme sans reponse, on referme');
});

test('un envoi qui echoue referme quand meme le document', async () => {
  const { chrome, offscreen, repondreOffscreen } = fakeChrome();
  repondreOffscreen(() => { throw new Error('Receiving end does not exist'); });

  const r = await queryHtml(chrome, { url: 'https://exemple.test/' });
  assert.equal(r.ok, false);
  assert.equal(offscreen.ouvert, false);
  assert.equal(offscreen.fermetures, 1);
});

/* ----------------------------------------------------------- extraits */

test('les extraits se lisent sans navigateur : c\'est la frontiere', () => {
  // Les sources travaillent sur des objets simples et serialisables, que les
  // tests fabriquent a la main. Rien de ce qui suit ne demande un DOM.
  const lignes = [{ text: '', value: null }, { text: ' Cardpocalypse ', value: ' /game/x ' }];

  assert.equal(firstText(lignes), 'Cardpocalypse', 'le vide est saute, le reste est ebarbe');
  assert.equal(firstValue(lignes), '/game/x');
  assert.equal(firstText([]), null);
  assert.equal(firstValue(null), null);
  assert.equal(firstText([{ text: null }]), null);
});
