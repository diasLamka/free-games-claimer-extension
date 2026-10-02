/* Le navigateur adaptatif, branche sur Epic et Amazon Luna (2.101.0).
 *
 * GOG l'avait recu en 2.100.0. Epic et Luna connaissaient chacun une liste de
 * libelles : qu'Epic ecrive « Recuperer » ou qu'Amazon change son mot, la fiche
 * restait sans bouton et la reclamation finissait en echec. Ici le SENS du
 * libelle prend le relais -- avec les memes interdits que partout (argent,
 * panier, abonnement, essai gratuit), et sans toucher a ce qui garde l'argent
 * chez Epic : le module de l'iframe de paiement, dont les listes sont figees.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

function element(texte, { href = null, w = 240, h = 56, disabled = false, main = false, list = false, chrome = false } = {}) {
  const recu = [];
  const el = {
    textContent: texte,
    innerText: texte,
    id: '',
    className: '',
    tagName: 'BUTTON',
    disabled,
    offsetWidth: w,
    offsetHeight: h,
    recu,
    parentElement: { textContent: '', parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : null),
    closest(sel) {
      if (sel.includes('header, nav')) return chrome ? {} : null;
      if (sel.includes('main, [role="main"]')) return main ? {} : null;
      if (sel.includes('li, [class*="carousel"')) return list ? {} : null;
      return null;
    },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    dispatchEvent(ev) { recu.push(ev.type); return true; },
    click() { recu.push('click-natif'); },
  };
  return el;
}
const clics = (e) => e.recu.filter((t) => t === 'click' || t === 'click-natif').length;

function pageEpic(sandbox, { principaux = [], autres = [] } = {}) {
  sandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('purchase-cta-button')) return principaux;
    if (sel.includes('button')) return [...principaux, ...autres];
    return [];
  };
  sandbox.document.querySelector = () => null;
}
const fiche = (slug = 'hades') => loadEngine({ hostname: 'store.epicgames.com', pathname: `/fr/p/${slug}` });

/* ------------------------------------------------------------------ Epic */

test('Epic : un mot nouveau qui veut dire « recuperer » est reconnu sur le bouton d\'achat de la fiche', () => {
  for (const mot of ['Récupérer maintenant', 'Claim now', 'Jetzt holen', 'Riscatta ora', 'Reclamar ahora', 'Add to library']) {
    const { fgc, sandbox } = fiche();
    const cta = element(mot);
    pageEpic(sandbox, { principaux: [cta] });
    assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), cta, mot);
    assert.equal(fgc.epicCtaState(false), 'unowned', `${mot} : la fiche dit « a prendre »`);
  }
});

test('Epic : ce qui coute de l\'argent n\'est jamais retenu, quel que soit le mot', () => {
  for (const cher of ['Acheter maintenant', 'Buy now', 'Obtenir pour 19,99 €', 'Get it for $4.99', 'Add to cart', 'Ajouter au panier',
    'Passer à la caisse', 'Check out now', 'Essai gratuit Epic+', 'Subscribe', 'Wishlist it']) {
    const { fgc, sandbox } = fiche();
    pageEpic(sandbox, { principaux: [element(cher)] });
    assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), null, cher);
  }
});

test('Epic : un mot que le vocabulaire ne connait pas n\'est PAS devine', () => {
  const { fgc, sandbox } = fiche();
  pageEpic(sandbox, { principaux: [element('Prends-le !')] });
  assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), null, 'pas de supposition sur Epic : l\'argent est au bout');
});

test('Epic : hors fiche d\'un jeu, ou bouton inactif, rien', () => {
  const liste = loadEngine({ hostname: 'store.epicgames.com', pathname: '/fr/free-games' });
  pageEpic(liste.sandbox, { principaux: [element('Claim now')] });
  assert.equal(liste.fgc.epicAdaptiveClaimButton('Epic Games'), null);

  const { fgc, sandbox } = fiche();
  pageEpic(sandbox, { principaux: [element('Claim now', { disabled: true })] });
  assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), null);
});

test('Epic : sans bouton marque, une rangee d\'extensions n\'est pas le jeu', () => {
  const { fgc, sandbox } = fiche();
  const extension = element('Claim', { list: true });
  const entete = element('Claim', { chrome: true });
  pageEpic(sandbox, { autres: [extension, entete] });
  assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), null);

  const vrai = element('Claim now', { main: true });
  pageEpic(sandbox, { autres: [extension, entete, vrai] });
  assert.equal(fgc.epicAdaptiveClaimButton('Epic Games'), vrai);
});

test('Epic : la possession se lit aussi en d\'autres langues, sur le bouton de CETTE fiche', () => {
  for (const mot of ['Im Besitz', 'En posesión', 'Nella tua libreria', 'Na sua biblioteca', 'Owned']) {
    const { fgc, sandbox } = fiche();
    const cta = element(mot);
    pageEpic(sandbox, { principaux: [cta] });
    assert.equal(fgc.epicOwnedHere(), cta, mot);
    assert.equal(fgc.epicCtaState(false), 'owned', mot);
  }
  // Un autre jeu possede ailleurs sur la page ne dit rien de celui-ci.
  const { fgc, sandbox } = fiche();
  pageEpic(sandbox, { principaux: [element('Claim now')], autres: [element('Im Besitz')] });
  assert.equal(fgc.epicOwnedHere(), null);
});

test('Epic : apres le delai de grace, un libelle inconnu est clique ; avant, on attend les libelles livres', async () => {
  const { fgc, sandbox } = fiche();
  const cta = element('Claim now');
  pageEpic(sandbox, { principaux: [cta] });

  // Delai de grace long : le sens n'est pas encore appele, la fiche attend.
  fgc.CONFIG.epicAdaptiveGraceMs = 60000;
  const attente = fgc.claimEpicGame(sandbox.document, 'Hades', 'Epic Games');
  await new Promise((r) => setImmediate(r));
  assert.equal(clics(cta), 0, 'avant le delai : aucun clic');

  // Delai nul : le sens decide, et le bouton recoit son clic.
  const autre = fiche();
  const cta2 = element('Claim now');
  pageEpic(autre.sandbox, { principaux: [cta2] });
  autre.fgc.CONFIG.epicAdaptiveGraceMs = 0;
  autre.fgc.claimEpicGame(autre.sandbox.document, 'Hades', 'Epic Games');
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(clics(cta2) >= 1, 'apres le delai : le bouton est clique');
  void attente;
});

test('Epic : le module de paiement ne lit PAS ce vocabulaire (listes figees)', () => {
  const { fgc } = fiche();
  // La liste figee de l'iframe n'accepte pas « Claim now » : seul le bouton de la fiche a ete elargi.
  const motifs = fgc.CONFIG && fgc.epicPaymentConfirmPatterns ? fgc.epicPaymentConfirmPatterns : null;
  if (motifs) assert.equal(motifs.some((p) => p.test('Claim now')), false);
});

/* ------------------------------------------------------------------ Luna */

const luna = (pathname = '/claims/home') => loadEngine({ hostname: 'luna.amazon.fr', pathname });

test('Luna : le libelle d\'un bouton de reclamation est autorise par son sens quand le mot change', () => {
  const { fgc } = luna();
  for (const mot of ['Claim now', 'Récupérer maintenant', 'Jetzt holen', 'Riscatta ora', 'Obtenir le jeu', 'Get game', 'Add to library']) {
    assert.equal(fgc.lunaClaimLabelAllowed(element(mot)), true, mot);
  }
});

test('Luna : abonnement, essai, achat et prix ne passent JAMAIS, meme s\'ils contiennent un mot de reclamation', () => {
  const { fgc } = luna();
  for (const piege of [
    'Try Luna+ free for 7 days', 'Obtenir Luna+ gratuitement', 'Essayer gratuitement', 'Start free trial', 'Join Prime', 'Upgrade to claim',
    'Subscribe to claim', 'Buy now', 'Acheter 19,99 €', 'Get it for $9.99', 'Passer à la caisse', 'Sign in to claim', 'Se connecter', 'Play now',
  ]) {
    assert.equal(fgc.lunaClaimLabelAllowed(element(piege)), false, piege);
  }
});

test('Luna : « deja a vous » se lit aussi dans d\'autres langues', () => {
  const { fgc } = luna();
  for (const texte of ['Already in your library', 'Bereits in deiner Bibliothek', 'Ya en tu biblioteca', 'Già nella tua libreria', 'Success!']) {
    assert.equal(fgc.lunaClaimedText(texte), true, texte);
  }
  assert.equal(fgc.lunaClaimedText('Get game'), false);
  assert.equal(fgc.lunaClaimedText('Obtenir le jeu'), false);
});

test('Luna : la memoire d\'un libelle reussi etend le vocabulaire, sans passer devant les interdits', () => {
  const { fgc } = luna();
  const inconnu = element('Prends-le');
  assert.equal(fgc.lunaClaimLabelAllowed(inconnu), false);
  fgc.navLearn('Amazon Luna', 'claim', 'prendsle', true);
  assert.equal(fgc.lunaClaimLabelAllowed(inconnu), true, 'appris par une reussite');
  // Un libelle d\'argent appris (par erreur) reste interdit.
  fgc.navLearn('Amazon Luna', 'claim', 'buy now', true);
  assert.equal(fgc.lunaClaimLabelAllowed(element('Buy now')), false);
});

test('les memes interdits valent partout : le vocabulaire ne s\'ouvre que sur ce qui prend un jeu gratuit', () => {
  const { fgc } = luna();
  for (const interdit of ['Luna+', 'Start your free trial', 'Rejoindre Prime', 'Mettre à niveau', 'Jetzt testen', 'Check out']) {
    assert.ok(fgc.navVetoReason(interdit), interdit);
  }
  for (const permis of ['Claim', 'Récupérer', 'Add to library', 'Go to giveaway']) {
    assert.equal(fgc.navVetoReason(permis), null, permis);
  }
});
