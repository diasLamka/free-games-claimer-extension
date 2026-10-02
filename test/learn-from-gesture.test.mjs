/* Apprendre de votre geste (2.101.0).
 *
 * Quand un magasin change sa page et que le moteur ne reconnait plus rien, on
 * recupere le jeu a la main, une fois : le moteur retient ce sur quoi on a
 * clique -- si, et seulement si, la page dit ensuite que le jeu est a nous
 * alors qu'il ne l'etait pas avant le clic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

function control(texte, { href = null } = {}) {
  return {
    tagName: href ? 'A' : 'BUTTON',
    textContent: texte,
    innerText: texte,
    className: '',
    id: '',
    disabled: false,
    offsetWidth: 200,
    offsetHeight: 50,
    parentElement: { textContent: '', parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : null),
    closest: () => null,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 50 }),
    dispatchEvent: () => true,
  };
}

const page = (sandbox, elements) => {
  sandbox.document.querySelectorAll = (sel) => (sel.includes('button') ? elements : []);
  sandbox.document.querySelector = () => null;
};
const clic = (el, trusted = true) => ({ isTrusted: trusted, target: { closest: () => el } });
const gog = (pathname = '/en/game/hades') => loadEngine({ hostname: 'www.gog.com', pathname });

test('un clic de l\'utilisateur suivi de « dans la bibliotheque » apprend ce qui a pris le jeu', () => {
  const { fgc, sandbox } = gog();
  const prends = control('Prends-le');
  page(sandbox, [prends]);
  fgc.demoOnClick(clic(prends));

  // Le jeu est maintenant a nous.
  page(sandbox, [control('In library')]);
  fgc.demoCheck();

  const memoire = fgc.navMemoryRead('GOG');
  assert.equal(memoire.claim['prendsle'].ok, 1);
  assert.equal(fgc.demoRead().length, 0, 'la demonstration est consommee');

  // Et ce mot inconnu est desormais compris.
  assert.equal(fgc.navClaimsLabel(control('Prends-le'), 'GOG'), true);
  assert.equal(fgc.navClaimsLabel(control('Prends-le'), 'Epic Games'), false, 'la memoire est par magasin');
});

test('deux pages : « ce qui y mene » est retenu avec « ce qui prend »', () => {
  const premiere = gog('/en/game/hades');
  const lien = control('Voir l\'affaire du jour', { href: '/en/giveaway' });
  page(premiere.sandbox, [lien]);
  premiere.fgc.demoOnClick(clic(lien));

  // Navigation : sessionStorage survit, la page change.
  const seconde = loadEngine({ hostname: 'www.gog.com', pathname: '/en/giveaway' });
  for (const k of ['FGC_nav_demo']) seconde.sandbox.sessionStorage.setItem(k, premiere.sandbox.sessionStorage.getItem(k));
  const prends = control('Prends-le');
  page(seconde.sandbox, [prends]);
  seconde.fgc.demoOnClick(clic(prends));
  page(seconde.sandbox, [control('In library')]);
  seconde.fgc.demoCheck();

  const memoire = seconde.fgc.navMemoryRead('GOG');
  assert.equal(memoire.claim['prendsle'].ok, 1);
  assert.equal(memoire.goto['voir laffaire du jour'].ok, 1);
});

test('un clic du moteur (evenement synthetique) n\'est jamais une demonstration', () => {
  const { fgc, sandbox } = gog();
  const bouton = control('Add to library');
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton, false));
  assert.equal(fgc.demoRead().length, 0);
});

test('un libelle d\'argent, de panier ou de connexion n\'est jamais retenu', () => {
  const { fgc, sandbox } = gog();
  for (const mot of ['Buy now', 'Acheter 4,99 €', 'Add to cart', 'Sign in', 'Subscribe', 'Wishlist it']) {
    const bouton = control(mot);
    page(sandbox, [bouton]);
    fgc.demoOnClick(clic(bouton));
  }
  assert.equal(fgc.demoRead().length, 0);
});

test('un jeu deja a vous avant le clic : rien n\'est appris', () => {
  const { fgc, sandbox } = gog();
  const deja = control('In library');
  const autre = control('Prends-le');
  page(sandbox, [deja, autre]);
  fgc.demoOnClick(clic(autre));
  fgc.demoCheck();
  assert.deepEqual(fgc.navMemoryRead('GOG'), {});
  assert.equal(fgc.demoRead().length, 0, 'et la demonstration est classee');
});

test('sans preuve de possession, rien n\'est appris, et les clics attendent', () => {
  const { fgc, sandbox } = gog();
  const bouton = control('Prends-le');
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton));
  fgc.demoCheck();
  assert.deepEqual(fgc.navMemoryRead('GOG'), {});
  assert.equal(fgc.demoRead().length, 1);
});

test('un clic trop ancien est oublie', () => {
  const { fgc, sandbox } = gog();
  const bouton = control('Prends-le');
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton));
  const vieux = JSON.parse(sandbox.sessionStorage.getItem('FGC_nav_demo')).map((e) => ({ ...e, ts: Date.now() - 120000 }));
  sandbox.sessionStorage.setItem('FGC_nav_demo', JSON.stringify(vieux));
  page(sandbox, [control('In library')]);
  fgc.demoCheck();
  assert.deepEqual(fgc.navMemoryRead('GOG'), {});
});

test('un jeu devenu a vous longtemps apres le dernier clic ne prouve rien (commande payee a la main)', () => {
  const { fgc, sandbox } = gog();
  const bouton = control('Prends-le');
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton));
  const lent = JSON.parse(sandbox.sessionStorage.getItem('FGC_nav_demo')).map((e) => ({ ...e, ts: Date.now() - 60000 }));
  sandbox.sessionStorage.setItem('FGC_nav_demo', JSON.stringify(lent));
  page(sandbox, [control('In library')]);
  fgc.demoCheck();
  assert.deepEqual(fgc.navMemoryRead('GOG'), {});
  assert.equal(fgc.demoRead().length, 0);
});

test('une confirmation (Continuer, Accepter, OK) n\'est pas ce qui prend un jeu', () => {
  const { fgc, sandbox } = gog();
  for (const mot of ['Continue', 'Continuer', 'Accept', 'OK', 'Confirmer', 'Weiter']) {
    const bouton = control(mot);
    page(sandbox, [bouton]);
    fgc.demoOnClick(clic(bouton));
  }
  assert.equal(fgc.demoRead().length, 0);
});

test('hors des trois magasins, le moteur n\'ecoute rien', () => {
  const { fgc, sandbox } = loadEngine({ hostname: 'example.com', pathname: '/' });
  const bouton = control('Add to library');
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton));
  assert.equal(fgc.demoRead().length, 0);
});

test('Epic : le bouton de la fiche, clique par l\'utilisateur, devient connu', () => {
  const { fgc, sandbox } = loadEngine({ hostname: 'store.epicgames.com', pathname: '/fr/p/hades' });
  const cta = control('Prends-le');
  sandbox.document.querySelectorAll = (sel) => (sel.includes('purchase-cta-button') ? [cta] : sel.includes('button') ? [cta] : []);
  sandbox.document.querySelector = () => null;
  fgc.demoOnClick(clic(cta));

  const possede = control('Dans la bibliothèque');
  sandbox.document.querySelectorAll = (sel) => (sel.includes('purchase-cta-button') ? [possede] : sel.includes('button') ? [possede] : []);
  fgc.demoCheck();
  assert.equal(fgc.navMemoryRead('Epic Games').claim['prendsle'].ok, 1);
});
