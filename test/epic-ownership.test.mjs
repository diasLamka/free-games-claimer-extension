/* « Deja recupere » dit a tort, et l'anti-bot qu'on ne voyait pas (2.99.7).
 *
 * Signale le 2026-10-01 : des jeux Epic non recuperes, et -- en forcant -- un
 * anti-bot a l'ecran avant « Ajouter a la bibliotheque » pendant que
 * l'extension repondait « deja recupere ».
 *
 * La cause : « Dans la bibliotheque » se cherchait n'importe ou dans la page.
 * La carte d'un AUTRE jeu suffisait a conclure « possede », a l'ecrire `claimed`
 * dans l'historique du moteur, et tout ce qui suivait s'y fiait. Ces tests
 * tiennent la regle neuve : la possession se lit sur LE bouton d'achat de CETTE
 * fiche, et rien d'autre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';
import { falseOwnership, libraryKey } from '../watch/library.js';
import { claimWhatCanBe } from '../watch/cycle.js';
import { makeOffer, normaliseTitle } from '../watch/offer.js';
import { VERDICTS } from '../watch/claim.js';
import { fakeChrome } from './fake-chrome.mjs';

function element(texte, { href = null, lienVers = null } = {}) {
  const lien = lienVers ? { getAttribute: () => lienVers } : null;
  return {
    textContent: texte,
    id: '',
    className: '',
    disabled: false,
    offsetWidth: 120,
    offsetHeight: 40,
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : null),
    closest: () => lien,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 40 }),
    dispatchEvent() { return true; },
  };
}

/* Une page Epic : les boutons d'achat principaux (marques par Epic) et tous les autres. */
function page(sandbox, { principaux = [], autres = [], overlay = false } = {}) {
  sandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('purchase-cta-button')) return principaux;
    if (sel.includes('[role="button"]')) return [...principaux, ...autres];
    return [];
  };
  sandbox.document.querySelector = (sel) => (overlay && sel.includes('webPurchaseContainer') ? {} : null);
}

const fiche = (slug = 'cardpocalypse') => loadEngine({ hostname: 'store.epicgames.com', pathname: `/fr/p/${slug}` });
const liste = () => loadEngine({ hostname: 'store.epicgames.com', pathname: '/fr/free-games' });

/* ------------------------------------------------ la possession, ici */

test('le bouton d\'achat de la fiche dit « Dans la bibliotheque » : le jeu est a vous', () => {
  const { fgc, sandbox } = fiche();
  const cta = element('Dans la bibliothèque');
  page(sandbox, { principaux: [cta] });
  assert.equal(fgc.epicOwnedHere(), cta);
  assert.equal(fgc.epicCtaState(), 'owned');
  assert.equal(fgc.isEpicGameUnownedOnCurrentPage(), false);
});

test('« Obtenir » sur la fiche, « In Library » sur une autre carte : le jeu n\'est PAS a vous (le cas signale)', () => {
  const { fgc, sandbox } = fiche();
  const cta = element('Obtenir');
  const autreCarte = element('Hades In Library', { lienVers: '/fr/p/hades' });
  const etiquette = element('In Library');           // une vignette, ailleurs dans la page
  page(sandbox, { principaux: [cta], autres: [autreCarte, etiquette] });
  assert.equal(fgc.epicOwnedHere(), null, 'une etiquette ailleurs ne contredit pas le bouton de la fiche');
  assert.equal(fgc.epicCtaState(), 'unowned');
  assert.equal(fgc.isEpicGameUnownedOnCurrentPage(), true);
});

test('une liste n\'est la fiche d\'aucun jeu : personne n\'y est « possede ici »', () => {
  const { fgc, sandbox } = liste();
  page(sandbox, { autres: [element('Dans la bibliothèque'), element('Obtenir')] });
  assert.equal(fgc.epicOwnedHere(), null);
  assert.equal(fgc.epicCtaState(), null);
});

test('sans bouton marque : une vignette d\'un autre jeu ne compte pas, un vrai bouton oui', () => {
  const { fgc, sandbox } = fiche('cardpocalypse');
  const vignette = element('Dans la bibliothèque', { lienVers: '/fr/p/hades' });
  const longue = element('Hades - jeu d\'action, roguelike, dans la bibliothèque depuis le 12 mars');
  page(sandbox, { autres: [vignette, longue] });
  assert.equal(fgc.epicOwnedHere(), null);

  const vrai = element('In Library');
  page(sandbox, { autres: [vignette, vrai] });
  assert.equal(fgc.epicOwnedHere(), vrai);
});

test('un lien vers CE jeu reste admis : le bouton d\'une fiche peut etre une ancre', () => {
  const { fgc, sandbox } = fiche('cardpocalypse');
  const ancre = element('Dans la bibliothèque', { lienVers: '/fr/p/cardpocalypse' });
  page(sandbox, { autres: [ancre] });
  assert.equal(fgc.epicOwnedHere(), ancre);
});

test('un bouton d\'achat au libelle inconnu ne dit rien : ni possede, ni a prendre', () => {
  const { fgc, sandbox } = fiche();
  page(sandbox, { principaux: [element('Précommander')], autres: [element('In Library')] });
  assert.equal(fgc.epicOwnedHere(), null);
  assert.equal(fgc.epicCtaState(), null);
});

/* ----------------------------- l'anti-bot niche dans la fenetre d'achat */

test('la frame d\'achat dit « defi » au cadre du dessus, qui le voit alors comme un defi de securite', () => {
  const ecouteurs = [];
  const { fgc, sandbox } = loadEngine({
    hostname: 'store.epicgames.com', pathname: '/fr/p/cardpocalypse',
    addEventListener: (type, fn) => ecouteurs.push([type, fn]),
  });
  const surMessage = ecouteurs.find(([t]) => t === 'message');
  assert.ok(surMessage, 'le cadre principal ecoute les messages de la frame d\'achat');
  page(sandbox, { principaux: [element('Obtenir')], overlay: true });
  assert.equal(fgc.detectSecurityChallenge(), null, 'rien tant que personne n\'a parle');

  surMessage[1]({ data: { fgcPaymentChallenge: true }, origin: 'https://payment-website-pci.ol.epicgames.com' });
  const defi = fgc.detectSecurityChallenge();
  assert.ok(defi && defi.type === 'captcha');

  // Fenetre refermee : le defi ne reste pas colle a la page.
  page(sandbox, { principaux: [element('Obtenir')], overlay: false });
  assert.equal(fgc.detectSecurityChallenge(), null);
});

test('un message d\'un autre hote, ou sans le drapeau, ne declenche rien', () => {
  const ecouteurs = [];
  const { fgc, sandbox } = loadEngine({
    hostname: 'store.epicgames.com', pathname: '/fr/p/cardpocalypse',
    addEventListener: (type, fn) => ecouteurs.push([type, fn]),
  });
  const surMessage = ecouteurs.find(([t]) => t === 'message')[1];
  page(sandbox, { principaux: [element('Obtenir')], overlay: true });
  surMessage({ data: { fgcPaymentChallenge: true }, origin: 'https://exemple.test' });
  surMessage({ data: { fgcPaymentChallenge: true }, origin: 'https://epicgames.com.exemple.test' });
  surMessage({ data: { autre: 1 }, origin: 'https://store.epicgames.com' });
  surMessage({ data: 'texte', origin: 'https://store.epicgames.com' });
  assert.equal(fgc.detectSecurityChallenge(), null);
});

test('dans la frame d\'achat, un captcha previent le cadre du dessus', () => {
  const { fgc, sandbox } = loadEngine({ frame: 'pci', hostname: 'payment-website-pci.ol.epicgames.com', pathname: '/purchase' });
  const recus = [];
  sandbox.top.postMessage = (m, cible) => recus.push([m, cible]);
  const captcha = {
    src: 'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html',
    offsetWidth: 400, offsetHeight: 300, getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  };
  sandbox.document.querySelectorAll = (sel) => (sel === 'iframe' ? [captcha] : []);
  sandbox.document.querySelector = () => null;
  assert.equal(fgc.epicPaymentFramePass(), false);
  // Objets d'un autre contexte vm : on compare leur forme serialisee.
  assert.deepEqual(recus.map((r) => JSON.stringify(r[0])), ['{"fgcPaymentChallenge":true}']);
});

/* ---------------------- le soin, une fois, des « deja possede » a tort */

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const J = 86400000;

test('falseOwnership : efface les « deja possede » recents, jamais une vraie reclamation', () => {
  const histo = JSON.stringify({
    'slug:faux-recent': { status: 'claimed', reason: 'ALREADY_OWNED', ts: NOW - 2 * J, title: 'Faux' },
    'slug:faux-recent-2': { status: 'claimed', reason: 'ALREADY_CLAIMED', ts: NOW - 5 * J },
    'slug:vrai': { status: 'claimed', reason: 'CLAIMED', ts: NOW - 2 * J, title: 'Vrai' },
    'slug:vieux': { status: 'claimed', reason: 'ALREADY_OWNED', ts: NOW - 90 * J },
    'slug:echec': { status: 'failed', reason: 'ALREADY_OWNED', ts: NOW - 1 * J },
  });
  const lib = {
    [libraryKey('epic', 'slug:faux-recent')]: { store: 'epic', id: 'faux-recent' },
    [libraryKey('epic', 'slug:vrai')]: { store: 'epic', id: 'vrai' },
    [libraryKey('epic', 'slug:vieux')]: { store: 'epic', id: 'vieux' },
  };
  const r = falseOwnership(histo, lib, NOW);
  assert.deepEqual(r.removed.sort(), ['slug:faux-recent', 'slug:faux-recent-2']);
  assert.deepEqual(Object.keys(r.history).sort(), ['slug:echec', 'slug:vieux', 'slug:vrai']);
  assert.deepEqual(Object.keys(r.library).sort(), ['epic:vieux', 'epic:vrai']);
  // Pure : les entrees d'origine ne sont pas modifiees.
  assert.equal(Object.keys(lib).length, 3);
});

test('falseOwnership : un historique abime ou vide ne casse rien', () => {
  assert.deepEqual(falseOwnership(undefined, {}, NOW).removed, []);
  assert.deepEqual(falseOwnership('pas du json', null, NOW).removed, []);
  assert.deepEqual(falseOwnership('{}', {}, NOW).history, {});
});

/* -------------------- une recuperation demandee ne se fie pas a la memoire */

const offre = (id, title) => ({
  ...makeOffer({ source: 'epic', store: 'epic', storeId: id, title, url: `https://store.epicgames.com/p/${id}`, end: NOW + J }),
  catalogKey: `epic:${id}`,
});

test('un clic de l\'utilisateur ignore le registre et le dit au moteur ; un cycle ordinaire le respecte', async () => {
  const hades = offre('hades', 'Hades');
  const library = { 'epic:hades': { store: 'epic', id: 'hades', title: 'Hades', status: 'claimed', ts: NOW - J } };
  const appels = [];
  const base = (extra) => ({
    chrome: fakeChrome({ now: NOW }).chrome, now: NOW, catalog: { [hades.catalogKey]: hades }, filters: {},
    claimableStores: ['epic'], watchedStores: ['epic'], cadence: [], maxReclamations: 3, library,
    claim: async (o, opts) => { appels.push(opts.force); return { verdict: VERDICTS.CLAIMED }; },
    ...extra,
  });

  await claimWhatCanBe(base({}));
  assert.deepEqual(appels, [], 'le cycle ne rouvre pas un jeu que le registre dit pris');

  await claimWhatCanBe(base({ forced: true }));
  assert.deepEqual(appels, [true], 'un clic explicite repart de la page, et l\'ordre porte force');
});
