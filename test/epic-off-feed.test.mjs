/* Une fiche Epic que le flux freeGamesPromotions ne liste pas (2.115.0).
 *
 * Signale le 2026-10-25 : MAFIA HOTEL, offert a 0 EUR par son editeur le
 * 2026-10-24, n'est PAS dans freeGamesPromotions (verifie sur FR, US, DE et GB).
 * Le moteur lisait le flux, ne voyait que deux jeux deja pris, ecrivait « aucun
 * jeu gratuit restant a reclamer » et ne cliquait rien -- dans l'extension comme
 * dans l'appli, qui partagent ce moteur.
 *
 * La regle neuve : sur une fiche qu'on lui ORDONNE expressement et que le flux ne
 * liste pas, le moteur lit le bouton principal. « Obtenir » / « Get » sans un mot
 * d'argent : il reclame. Tout le reste : il ne clique rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

const EPIC = 'Epic Games';
const MAFIA = 'mafia-hotel-eaea4c';

/* Le flux d'Epic : deux jeux a 0 EUR en ce moment, comme le 2026-10-25. */
function feed() {
  const debut = new Date(Date.now() - 3 * 86400000).toISOString();
  const fin = new Date(Date.now() + 4 * 86400000).toISOString();
  const jeu = (title, slug) => ({
    title, id: slug, offerMappings: [{ pageSlug: slug }], offerType: 'BASE_GAME',
    price: { totalPrice: { originalPrice: 2239, discountPrice: 0 } },
    promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: debut, endDate: fin }] }] },
  });
  return JSON.stringify({ data: { Catalog: { searchStore: { elements: [
    jeu('Sker Ritual', 'sker-ritual-aac702'), jeu('Home - A Unique Horror Adventure', 'home-19212a'),
  ] } } } });
}

/* Un bouton de fiche, qui compte les clics qu'il recoit. */
function bouton(texte) {
  const b = {
    textContent: texte, id: '', className: '', disabled: false, offsetWidth: 120, offsetHeight: 40, clics: 0,
    getClientRects: () => [{}],
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 40 }),
    dispatchEvent() { b.clics++; return true; },
    click() { b.clics++; },
  };
  return b;
}

/* La fiche de MAFIA HOTEL, avec ses boutons ; le titre est celui du <h1>. */
function fiche({ principaux = [], autres = [], titre = 'MAFIA HOTEL', slug = MAFIA } = {}) {
  const e = loadEngine({ hostname: 'store.epicgames.com', pathname: `/fr/p/${slug}` });
  const journal = [];
  for (const k of ['log', 'info', 'warn', 'error']) e.sandbox.console[k] = (...a) => journal.push(`${k}: ${a.map(String).join(' ')}`);
  e.sandbox.GM_xmlhttpRequest = (o) => o.onload({ status: 200, responseText: feed() });
  e.sandbox.document.querySelector = (s) => (s === 'main' ? {} : s === 'h1' ? { textContent: titre } : null);
  e.sandbox.document.querySelectorAll = (s) => {
    if (s.includes('purchase-cta-button')) return principaux;
    if (s.includes('[role="button"]')) return [...principaux, ...autres];
    return [];
  };
  return { ...e, journal };
}

const ticks = async (n = 25) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const dit = (journal, re) => journal.some((l) => re.test(l));

/* ------------------------------------------------ l'etat de la fiche */

test('le bouton principal « Obtenir » ou « Get » : la fiche est gratuite', () => {
  for (const texte of ['Obtenir', 'Get', 'Récupérer', 'Ajouter à la bibliothèque', 'Add to Library']) {
    const { fgc } = fiche({ principaux: [bouton(texte)] });
    assert.equal(fgc.epicOffFeedState(), 'free', texte);
  }
});

test('un libelle qui parle d\'argent est « payant », jamais gratuit', () => {
  for (const texte of ['Acheter maintenant', 'Buy Now', 'Obtenir 4,99 €', 'Get $1.99', 'Précommander', 'Pre-order', 'S\'abonner']) {
    const { fgc } = fiche({ principaux: [bouton(texte)] });
    assert.equal(fgc.epicOffFeedState(), 'paid', texte);
  }
});

test('« Ajouter au panier » seul ne vaut pas « gratuit » : sur une fiche payante c\'est le second bouton', () => {
  const { fgc } = fiche({ principaux: [bouton('Ajouter au panier')] });
  assert.notEqual(fgc.epicOffFeedState(), 'free');
});

test('dans la bibliotheque : la fiche est a vous', () => {
  const { fgc } = fiche({ principaux: [bouton('Dans la bibliothèque')] });
  assert.equal(fgc.epicOffFeedState(), 'owned');
});

test('un libelle inconnu ou une fiche qui n\'a pas fini de s\'afficher : on ne sait pas, donc on ne prend pas', () => {
  assert.equal(fiche({ principaux: [bouton('Bientôt disponible')] }).fgc.epicOffFeedState(), null);
  assert.equal(fiche({ principaux: [bouton('')] }).fgc.epicOffFeedState(), null);
  assert.equal(fiche({ principaux: [] }).fgc.epicOffFeedState(), null);
});

test('sans le marqueur d\'Epic : un bouton gratuit et aucun bouton payant suffit, un seul bouton payant l\'annule', () => {
  const sans = fiche({ principaux: [], autres: [bouton('Obtenir')] });
  sans.sandbox.document.querySelectorAll = (s) => (s.includes('purchase-cta-button') ? [] : [bouton('Obtenir')]);
  assert.equal(sans.fgc.epicOffFeedState(), 'free');

  const payante = fiche({ principaux: [] });
  payante.sandbox.document.querySelectorAll = (s) => (s.includes('purchase-cta-button') ? [] : [bouton('Obtenir'), bouton('Acheter maintenant')]);
  assert.equal(payante.fgc.epicOffFeedState(), 'paid');
});

/* ------------------------------------------------ le module, ordre expres */

test('MAFIA HOTEL, ordonne, hors flux, bouton « Obtenir » : le moteur clique (il ne dit plus « aucun jeu gratuit restant »)', async () => {
  const cta = bouton('Obtenir');
  const { fgc, journal } = fiche({ principaux: [cta] });
  fgc.markEpicClaimOrdered();
  fgc.runEpicGamesModule();
  await ticks();

  assert.ok(cta.clics > 0, 'le bouton « Obtenir » de la fiche a ete clique');
  assert.ok(dit(journal, /absente du flux/), 'et le journal dit pourquoi');
  assert.ok(!dit(journal, /Aucun jeu gratuit restant/), 'le moteur ne conclut plus que tout est pris');
});

test('le meme ordre sur une fiche payante : rien n\'est clique, rien n\'est ecrit', async () => {
  const cta = bouton('Acheter maintenant');
  const { fgc, journal, gmStore } = fiche({ principaux: [cta], autres: [bouton('Ajouter au panier')] });
  fgc.markEpicClaimOrdered();
  fgc.runEpicGamesModule();
  await ticks();

  assert.equal(cta.clics, 0);
  assert.ok(dit(journal, /annonce une depense/), 'le journal le dit, avec les boutons vus');
  assert.equal(fgc.getHistory(EPIC)[`slug:${MAFIA}`], undefined, 'aucune entree : le mode pilote conclura lui-meme');
  assert.ok(![...gmStore.keys()].some((k) => k.includes('mafia')));
});

test('ordonne, hors flux, deja dans la bibliotheque : l\'entree est ecrite, sans clic', async () => {
  const cta = bouton('Dans la bibliothèque');
  const { fgc } = fiche({ principaux: [cta] });
  fgc.markEpicClaimOrdered();
  fgc.runEpicGamesModule();
  await ticks();

  assert.equal(cta.clics, 0);
  const e = fgc.getHistory(EPIC)[`slug:${MAFIA}`];
  assert.equal(e.status, 'claimed');
  assert.equal(e.reason, 'ALREADY_OWNED');
  assert.equal(e.title, 'MAFIA HOTEL');
});

test('SANS ordre expres, la meme fiche n\'est pas touchee : le guetteur automatique ne clique jamais hors flux', async () => {
  const cta = bouton('Obtenir');
  const { fgc, journal } = fiche({ principaux: [cta] });
  // Les deux jeux du flux ont ete pris jeudi : le cas de l'utilisateur.
  fgc.saveHistoryEntry(EPIC, 'slug:sker-ritual-aac702', 'claimed', 'CLAIMED', 'Sker Ritual');
  fgc.saveHistoryEntry(EPIC, 'slug:home-19212a', 'claimed', 'CLAIMED', 'Home');
  fgc.runEpicGamesModule();
  await ticks();

  assert.equal(cta.clics, 0);
  assert.ok(dit(journal, /Aucun jeu gratuit restant/), 'comportement d\'avant, inchange');
});

test('un ordre perime (plus de deux minutes) est ignore ; un ordre ne sert qu\'une fois', async () => {
  const perime = bouton('Obtenir');
  const a = fiche({ principaux: [perime] });
  a.fgc.markEpicClaimOrdered(Date.now() - 3 * 60000);
  a.fgc.runEpicGamesModule();
  await ticks();
  assert.equal(perime.clics, 0, 'trois minutes : l\'ordre ne vaut plus');

  const frais = bouton('Obtenir');
  const b = fiche({ principaux: [frais] });
  b.fgc.markEpicClaimOrdered();
  b.fgc.runEpicGamesModule();
  await ticks();
  assert.ok(frais.clics > 0);
});

test('une fiche deja recuperee n\'est pas rejouee, sauf ordre force', async () => {
  const cta = bouton('Obtenir');
  const { fgc, journal } = fiche({ principaux: [cta] });
  fgc.saveHistoryEntry(EPIC, `slug:${MAFIA}`, 'claimed', 'CLAIMED', 'MAFIA HOTEL');
  fgc.markEpicClaimOrdered();
  fgc.runEpicGamesModule();
  await ticks();

  assert.equal(cta.clics, 0);
  assert.ok(dit(journal, /deja recuperee precedemment/));
});

test('un jeu que le flux liste garde son parcours : la fiche courante est reconnue comme avant', async () => {
  const cta = bouton('Obtenir');
  const { fgc, journal } = fiche({ principaux: [cta], slug: 'sker-ritual-aac702', titre: 'Sker Ritual' });
  fgc.markEpicClaimOrdered();
  fgc.runEpicGamesModule();
  await ticks();

  assert.ok(dit(journal, /Fiche produit courante identifiee comme jeu gratuit non reclame : Sker Ritual/));
  assert.ok(!dit(journal, /absente du flux/), 'pas la voie hors flux');
  assert.ok(cta.clics > 0);
});
