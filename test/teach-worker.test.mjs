/* Le worker et « montrez-moi le bouton » (2.102.0). */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TEACH_VERDICT, storeOfPlatform, resetForTeaching, teachBannerInPage, showTeachBanner, isManualPilotTab } from '../watch/teach.js';
import { VERDICTS, MANUAL_VERDICTS, HUMAN_VERDICTS, KEY_TABS } from '../watch/claim.js';
import { classify, KINDS } from '../watch/canary.js';
import { STORES } from '../watch/offer.js';
import { CONTENT_MESSAGES, messageAllowed } from '../watch/messaging.js';

test('le verdict existe, laisse l\'onglet ouvert, et ne revient plus a l\'infini (2.106.0)', () => {
  assert.equal(TEACH_VERDICT, VERDICTS.TEACH);
  assert.ok(MANUAL_VERDICTS.includes(TEACH_VERDICT));
  assert.ok(!HUMAN_VERDICTS.includes(TEACH_VERDICT), 'il suit le recul et l\'abandon ordinaires');
});

test('pour le canari, c\'est le magasin qui a bouge (comme un selecteur casse)', () => {
  assert.equal(classify('needs_teaching'), KINDS.SELECTOR);
  assert.equal(classify('challenge'), KINDS.HUMAN, 'un defi reste un defi');
});

test('le moteur reconnait ses trois magasins, et eux seuls', () => {
  assert.equal(storeOfPlatform('GOG'), STORES.GOG);
  assert.equal(storeOfPlatform('Epic Games'), STORES.EPIC);
  assert.equal(storeOfPlatform('Amazon Luna'), STORES.AMAZON);
  for (const autre of ['Steam', '', null, undefined, 'gog', 'evil']) assert.equal(storeOfPlatform(autre), null, String(autre));
});

test('apprendre un bouton remet en file les offres du magasin qui l\'attendaient, et elles seules', () => {
  const catalogue = {
    'gog:a': { store: STORES.GOG, verdict: 'needs_teaching', attempts: 3, nextAttemptAt: 99 },
    'gog:b': { store: STORES.GOG, verdict: 'failed', attempts: 2, nextAttemptAt: 50 },
    'epic:c': { store: STORES.EPIC, verdict: 'needs_teaching', attempts: 1, nextAttemptAt: 70 },
    'gog:d': null,
  };
  const { catalog, count } = resetForTeaching(catalogue, STORES.GOG, 1000);
  assert.equal(count, 1);
  assert.equal(catalog['gog:a'].nextAttemptAt, null);
  assert.equal(catalog['gog:a'].attempts, 0);
  assert.equal(catalog['gog:a'].updatedAt, 1000);
  assert.equal(catalog['gog:b'].attempts, 2, 'un autre echec n\'est pas touche');
  assert.equal(catalog['epic:c'].attempts, 1, 'un autre magasin non plus');
  assert.equal(catalogue['gog:a'].attempts, 3, 'et le catalogue d\'origine reste intact');
  assert.deepEqual(resetForTeaching(null, STORES.GOG, 1), { catalog: {}, count: 0 });
});

test('le message d\'apprentissage ne vient que d\'un script de contenu', () => {
  assert.ok(CONTENT_MESSAGES.includes('fgc-appris'));
  assert.equal(messageAllowed('fgc-appris', 'content'), true);
  assert.equal(messageAllowed('fgc-appris', 'page'), false, 'une page d\'extension n\'a rien a y faire');
  assert.equal(messageAllowed('fgc-appris', 'inconnu'), false);
});

/* ------------------------------------------------------------- le bandeau */

function faussePage() {
  const ajoutes = [];
  const doc = {
    getElementById: () => null,
    createElement: () => {
      const el = {
        style: {}, children: [], attrs: {}, listeners: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        appendChild(c) { this.children.push(c); },
        addEventListener(t, f) { this.listeners[t] = f; },
        attachShadow() { this.shadow = { children: [], appendChild(c) { this.children.push(c); } }; return this.shadow; },
        remove() { this.removed = true; },
      };
      return el;
    },
    documentElement: { appendChild: (c) => ajoutes.push(c) },
  };
  return { doc, ajoutes };
}

test('le bandeau est pose une fois, borne en longueur, dans une racine fermee', () => {
  const { doc, ajoutes } = faussePage();
  global.document = doc;
  try {
    assert.equal(teachBannerInPage('Cliquez ici ' + 'x'.repeat(500)), true);
    assert.equal(ajoutes.length, 1);
    const hote = ajoutes[0];
    assert.equal(hote.id, 'fgc-apprendre');
    assert.ok(hote.shadow, 'racine fantome : la page ne peut ni le lire ni le restyler');
    const barre = hote.shadow.children[0];
    assert.ok(barre.textContent.length <= 240 + 1, 'texte borne');
    // Le bouton de fermeture retire le bandeau.
    barre.children[0].listeners.click();
    assert.equal(hote.removed, true);
    // Deja la : on ne le pose pas deux fois.
    doc.getElementById = () => ({});
    assert.equal(teachBannerInPage('autre'), true);
    assert.equal(ajoutes.length, 1);
  } finally {
    delete global.document;
  }
});

test('un bandeau rate ne casse rien', async () => {
  assert.equal(teachBannerInPage('x'), false, 'sans document');
  assert.equal(await showTeachBanner({}, 1, 'x'), false, 'sans scripting');
  const casse = { scripting: { executeScript: async () => { throw new Error('onglet ferme'); } } };
  assert.equal(await showTeachBanner(casse, 1, 'x'), false);
  const appels = [];
  const bon = { scripting: { executeScript: async (o) => { appels.push(o); } } };
  assert.equal(await showTeachBanner(bon, 7, 'Bonjour'), true);
  assert.equal(appels[0].target.tabId, 7);
  assert.deepEqual(appels[0].args, ['Bonjour']);
  assert.equal(appels[0].func, teachBannerInPage);
});

test('seul un onglet laisse ouvert pour un humain peut etre referme apres apprentissage', async () => {
  const zone = { get: async () => ({ [KEY_TABS]: { 5: { manual: true }, 6: { offer: 'x' } } }) };
  const chrome = { storage: { session: zone } };
  assert.equal(await isManualPilotTab(chrome, 5), true);
  assert.equal(await isManualPilotTab(chrome, 6), false, 'un onglet pilote normal n\'est pas a nous fermer ici');
  assert.equal(await isManualPilotTab(chrome, 9), false);
  assert.equal(await isManualPilotTab({ storage: {} }, 5), false);
});
