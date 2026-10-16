/* La veille decouvre les jeux Luna toute seule (2.114.0).
 *
 * Luna n'a pas d'API publique : aucune source ne lui donnait de jeu a prendre, donc la
 * veille ne rouvrait jamais sa page et rien n'etait recupere en fond. La source Luna lit la
 * liste des offres dans une fenetre reduite (rien a l'ecran), par le moteur, sans un clic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { discover, mapLunaList, NAME, CLAIMS_URL } from '../watch/sources/luna.js';
import { SOURCES, activeSourcesFor } from '../watch/sources/index.js';
import { reportVerdict } from '../watch/claim.js';
import { CONTENT_MESSAGES, messageAllowed } from '../watch/messaging.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { STORES } from '../watch/offer.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const NOW = Date.parse('2026-10-16T09:00:00Z');
const HOST = 'https://luna.amazon.fr';

const carte = (id, titre, extra = {}) => ({
  id, title: titre, url: `${HOST}/claims/${id}/dp/${id}`, store: 'amazon', hasButton: false, hasCta: true, collected: false, ...extra,
});

/* ------------------------------------------------------------ la liste -> des offres */

test('une fiche a prendre devient une offre Amazon avec sa page', () => {
  const { offers, dropped } = mapLunaList([carte('amzn1.pg.item.a', 'Warbreeds 2')], NOW);
  assert.equal(dropped.length, 0);
  assert.equal(offers.length, 1);
  const o = offers[0];
  assert.equal(o.store, STORES.AMAZON);
  assert.equal(o.source, NAME);
  assert.equal(o.sourceId, 'amzn1.pg.item.a');
  assert.equal(o.title, 'Warbreeds 2');
  assert.equal(o.url, `${HOST}/claims/amzn1.pg.item.a/dp/amzn1.pg.item.a`);
  assert.notEqual(o.alreadyOwned, true);
});

test('une carte deja prise est decrite comme possedee : la veille ne la rouvre pas', () => {
  const { offers } = mapLunaList([carte('b', 'Deja pris', { collected: true, hasCta: false })], NOW);
  assert.equal(offers[0].alreadyOwned, true);
});

test('les cartes a bouton direct (sans fiche) se rejoignent sur la page de la liste, en UNE offre', () => {
  const { offers } = mapLunaList([
    carte('c1', 'Direct un', { hasButton: true, url: null }),
    carte('c2', 'Direct deux', { hasButton: true, url: null }),
    carte('d', 'Avec fiche'),
  ], NOW);
  assert.equal(offers.length, 2);
  const direct = offers.find((o) => o.url === CLAIMS_URL);
  assert.ok(direct, 'les boutons directs vivent sur la liste');
  assert.match(direct.title, /Direct un/);
  assert.match(direct.sourceId, /^direct-/);
  // La meme liste donne la meme cle ; une autre liste, une autre.
  const encore = mapLunaList([carte('c1', 'Direct un', { hasButton: true, url: null }), carte('c2', 'Direct deux', { hasButton: true, url: null })], NOW);
  assert.equal(encore.offers[0].sourceId, direct.sourceId);
  const autre = mapLunaList([carte('c9', 'Autre', { hasButton: true, url: null })], NOW);
  assert.notEqual(autre.offers[0].sourceId, direct.sourceId);
});

test('ce qui vient de la page est borne et jamais cru : hote etranger, titre vide, trop de cartes', () => {
  const { offers, dropped } = mapLunaList([
    carte('e', 'Ailleurs', { url: 'https://evil.example/claims/e/dp/e' }),
    carte('f', '   '),
    carte('g', 'x'.repeat(500)),
    null,
    'texte',
  ], NOW);
  assert.equal(offers.length, 1, 'seul le titre trop long est garde, tronque');
  assert.ok(offers[0].title.length <= 120);
  assert.equal(dropped.length, 4);
  const beaucoup = Array.from({ length: 200 }, (_, i) => carte(`id${i}`, `Jeu ${i}`));
  assert.ok(mapLunaList(beaucoup, NOW).offers.length <= 60);
});

/* ------------------------------------------------------------ la lecture dans l'onglet */

function fauxChrome({ reponse, silence = false } = {}) {
  const session = {};
  const faits = { created: [], removedWindows: [], sent: [] };
  const chrome = {
    windows: {
      create: async ({ url, state }) => { faits.created.push({ url, state }); return { id: 9, tabs: [{ id: 42, url }] }; },
      remove: async (id) => { faits.removedWindows.push(id); },
    },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      get: async (id) => ({ id, status: 'complete', url: CLAIMS_URL }),
      remove: async () => {},
      sendMessage: async (id, msg) => {
        faits.sent.push(msg);
        if (!silence) setTimeout(() => reportVerdict(id, 'fgc-liste', reponse), 5);
        return { recu: true };
      },
    },
    storage: {
      session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => { Object.assign(session, o); } },
      local: { get: async () => ({}) },
    },
  };
  return { chrome, faits, session };
}

function annoncerPret(tabId) {
  const minuterie = setInterval(() => { if (reportVerdict(tabId, 'fgc-pret', { type: 'fgc-pret' })) clearInterval(minuterie); }, 2);
  return minuterie;
}

test('la source ouvre la liste Luna dans une fenetre REDUITE, la fait lire, la referme', async () => {
  const { chrome, faits, session } = fauxChrome({
    reponse: { type: 'fgc-liste', verdict: 'ok', offers: [carte('a', 'Warbreeds 2'), carte('b', 'Pris', { collected: true, hasCta: false })] },
  });
  const pret = annoncerPret(42);
  const r = await discover({ chrome, now: NOW });
  clearInterval(pret);
  assert.equal(faits.created.length, 1);
  assert.equal(faits.created[0].state, 'minimized', 'rien a l\'ecran');
  assert.match(faits.created[0].url, /^https:\/\/luna\.amazon\.[a-z.]+\/claims\/home/);
  assert.deepEqual(faits.sent.map((m) => m.type), ['fgc-liste-luna'], 'un ordre de LECTURE, jamais « reclame »');
  assert.deepEqual(faits.removedWindows, [9]);
  assert.deepEqual(session['veille:onglets-pilotes'], {}, 'l\'onglet n\'est plus suivi');
  assert.equal(r.errors.length, 0);
  assert.equal(r.offers.length, 2);
  assert.equal(r.complete, true, 'la page EST la liste entiere');
});

test('une session perdue, un defi ou une page etrangere sont des erreurs dites, pas une liste vide', async () => {
  for (const [verdict, motif] of [['needs_login', /session perdue/i], ['challenge', /verification|defi/i], ['wrong_page', /page/i]]) {
    const { chrome } = fauxChrome({ reponse: { type: 'fgc-liste', verdict, offers: [] } });
    const pret = annoncerPret(42);
    const r = await discover({ chrome, now: NOW });
    clearInterval(pret);
    assert.equal(r.offers.length, 0);
    assert.equal(r.errors.length, 1, verdict);
    assert.match(r.errors[0], motif);
    assert.equal(r.complete, false);
  }
});

test('une page lue mais sans carte n\'est pas une erreur ni une liste complete', async () => {
  const { chrome } = fauxChrome({ reponse: { type: 'fgc-liste', verdict: 'empty', offers: [] } });
  const pret = annoncerPret(42);
  const r = await discover({ chrome, now: NOW });
  clearInterval(pret);
  assert.equal(r.errors.length, 0);
  assert.equal(r.offers.length, 0);
  assert.equal(r.complete, false, 'aucune disparition concluee d\'une page qu\'on n\'a pas su lire');
});

test('un moteur muet donne une erreur, et la fenetre est refermee quand meme', async () => {
  const { chrome, faits } = fauxChrome({ silence: true });
  const r = await discover({ chrome, now: NOW, readyWaitMs: 20, listWaitMs: 20 });
  assert.equal(r.offers.length, 0);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(faits.removedWindows, [9]);
});

test('sans chrome, la source ne jette pas : elle dit pourquoi', async () => {
  const r = await discover({ now: NOW });
  assert.equal(r.offers.length, 0);
  assert.equal(r.errors.length, 1);
});

/* ------------------------------------------------------------ le registre */

test('Luna est une source reelle, jamais interrogee pour un magasin non suivi', () => {
  const s = SOURCES[NAME];
  assert.ok(s, 'enregistree');
  assert.equal(typeof s.discover, 'function');
  assert.equal(s.onlyWhenActive, true);
  assert.equal(s.authoritativeFor, STORES.AMAZON);
  assert.ok(s.minIntervalMs >= 60 * 60 * 1000, 'une page de compte : pas plus d\'une fois par heure');
});

test('elle tourne si Amazon est suivi ET que l\'extension recupere seule', () => {
  assert.ok(activeSourcesFor(DEFAULT_SETTINGS).includes(NAME));
  assert.ok(!activeSourcesFor({ ...DEFAULT_SETTINGS, watchedStores: ['epic', 'gog'] }).includes(NAME), 'Amazon decoche : on n\'y touche pas');
  assert.ok(!activeSourcesFor({ ...DEFAULT_SETTINGS, autonomousClaim: false }).includes(NAME), 'recuperation autonome coupee : on n\'ouvre rien');
  assert.ok(activeSourcesFor({ ...DEFAULT_SETTINGS, watchedStores: [] }).includes(NAME), 'aucun magasin coche = tous, comme pour la reclamation');
  assert.ok(!activeSourcesFor({ ...DEFAULT_SETTINGS, activeSources: [...DEFAULT_SETTINGS.activeSources, NAME], autonomousClaim: false }).includes(NAME));
});

/* ------------------------------------------------------------ la messagerie et le moteur */

test('la reponse du moteur passe comme les autres, et l\'ordre n\'est pas une commande de l\'interface', () => {
  assert.ok(CONTENT_MESSAGES.includes('fgc-liste'));
  assert.equal(messageAllowed('fgc-liste', 'content'), true);
  assert.equal(messageAllowed('fgc-liste', 'page'), false, 'une page d\'extension n\'a rien a y faire');
  assert.equal(messageAllowed('fgc-liste-luna', 'content'), false, 'l\'ordre va du worker vers le moteur, jamais l\'inverse');
  assert.match(lire('background.js'), /msg\.type === 'fgc-liste'/);
});

test('le cycle donne chrome aux sources', () => {
  assert.match(lire('watch/cycle.js'), /source\.discover\(\{\s*chrome,/);
});

test('le moteur lit la liste Luna sans jamais cliquer', () => {
  const boot = lire('src/core/31-bootstrap.js');
  assert.match(boot, /msg\.type === 'fgc-liste-luna'/);
  const debut = boot.indexOf('function readLunaList');
  assert.ok(debut > 0, 'readLunaList existe');
  const fin = boot.indexOf('function listenForOrders', debut);
  const corps = boot.slice(debut, fin);
  assert.doesNotMatch(corps, /robustClick|\.click\(|location\.assign|location\.href\s*=/, 'AUCUN clic, AUCUNE navigation');
  assert.match(corps, /collectLunaOffers/);
});

/* ------------------------------------------------------------ de la liste a la reclamation */

test('les fiches lues entrent au catalogue et deviennent candidates ; la carte deja prise, non', async () => {
  const { integrate } = await import('../watch/catalog.js');
  const { claimCandidates } = await import('../watch/cycle.js');
  const { offers } = mapLunaList([
    carte('a', 'Warbreeds 2'),
    carte('b', 'Deja pris', { collected: true, hasCta: false }),
    carte('c', 'Direct', { hasButton: true, url: null }),
  ], NOW);
  const { catalog } = integrate({}, offers, { now: NOW, source: NAME, completeList: true, store: STORES.AMAZON });
  const { candidates } = claimCandidates(catalog, DEFAULT_SETTINGS.filters || {}, {
    claimableStores: [STORES.EPIC, STORES.GOG, STORES.AMAZON], watchedStores: DEFAULT_SETTINGS.watchedStores, now: NOW,
  });
  const titres = candidates.map((o) => o.title).sort();
  assert.deepEqual(titres, ['Direct', 'Warbreeds 2']);
  assert.ok(candidates.every((o) => o.store === STORES.AMAZON && o.url));
});

test('une fiche qui quitte la liste est notee absente, puis terminee au passage suivant', async () => {
  const { integrate } = await import('../watch/catalog.js');
  const un = mapLunaList([carte('a', 'Warbreeds 2'), carte('z', 'Autre')], NOW).offers;
  const lecture = mapLunaList([carte('a', 'Warbreeds 2')], NOW).offers;
  const opts = { source: NAME, completeList: true, store: STORES.AMAZON };
  const premier = integrate({}, un, { now: NOW, ...opts });
  const deux = integrate(premier.catalog, lecture, { now: NOW + 3600000, ...opts });
  const absente = Object.values(deux.catalog).find((o) => o.title === 'Autre');
  assert.ok(absente.missingSince, 'le premier passage constate son absence');
  const trois = integrate(deux.catalog, lecture, { now: NOW + 7200000, ...opts });
  const fin = Object.values(trois.catalog).find((o) => o.title === 'Autre');
  assert.ok(trois.vanished.length === 1 || fin.state === 'expired', 'le second la clot');
  assert.notEqual(Object.values(trois.catalog).find((o) => o.title === 'Warbreeds 2').state, 'expired');
});
