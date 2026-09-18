/* Ce qui est ÉCRIT sur le bouton décide, pas le sélecteur qui l'a trouvé.
 *
 * Epic a coûté quatre versions pour apprendre cette règle : un bouton désigné
 * par un attribut (`[data-a-target="buy-box_call-to-action"]`, `[type="submit"]`)
 * ne dit rien de ce qu'il fait. « buy-box_call-to-action » est le nom d'un
 * EMPLACEMENT ; le jour où Amazon y rend « S'abonner à Luna+ » ou
 * « Acheter 19,99 € », rien n'arrêtait le moteur :
 *
 *   - le garde-caisse s'efface sur les magasins éprouvés (PROVEN_HOSTS), et
 *     luna.amazon.fr en fait partie -- à raison : le parcours gratuit y passe
 *     légitimement par un panier à zéro ;
 *   - la liste de motifs n'était qu'un repli du `||`, jamais consultée quand
 *     l'attribut avait déjà trouvé quelque chose ;
 *   - et ces parcours cliquaient en direct (`el.click()`), hors de
 *     robustClick, donc hors de portée du bouton d'arrêt d'urgence.
 *
 * Le test qui compte est le troisième : un CTA Luna intitulé
 * « Acheter 19,99 € » n'est jamais cliqué. Il échoue sur le moteur d'avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

/* Un bouton qui note tout ce qu'il reçoit (même patron que click.test.mjs). */
function bouton(texte, options = {}) {
  const el = {
    recu: [],
    textContent: texte,
    value: options.value,
    id: '',
    className: '',
    disabled: false,
    offsetWidth: 80,
    offsetHeight: 20,
    getClientRects: () => [{}],
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 20 }),
    dispatchEvent(ev) { el.recu.push(ev.type); return true; },
    click() { el.recu.push('click-natif'); },
  };
  return el;
}

const clics = (el) => el.recu.filter((t) => t === 'click' || t === 'click-natif').length;

const luna = () => loadEngine({ hostname: 'luna.amazon.fr', pathname: '/claims/home' });

/* ------------------------------------------- l'autorisation par libellé Luna */

test('un libellé payant n\'est jamais autorisé sur Luna', () => {
  const { fgc } = luna();
  for (const texte of [
    'Acheter 19,99 €',
    'Acheter',
    'Buy now',
    'S’abonner à Luna+',
    'Passer à l\'abonnement 9,99 €/mois',
    'Précommander',
    'Pre-order',
    '19.99 $',
  ]) {
    assert.equal(fgc.lunaClaimLabelAllowed(bouton(texte)), false, `autorisé à tort : ${texte}`);
  }
});

test('les libellés de réclamation gratuite restent autorisés', () => {
  const { fgc } = luna();
  for (const texte of [
    'Obtenir le jeu',
    'Récupérer le jeu',
    'Récupérer',
    'Claim game',
    'Get the game',
    /* Le textContent d'un bouton concatène tous ses descendants : un span de
       lecteur d'écran suffit à faire échouer un motif ancré en ^...$. */
    'Obtenir le jeu (ouvre dans un nouvel onglet)',
    '  Récupérer\n  le jeu  ',
  ]) {
    assert.equal(fgc.lunaClaimLabelAllowed(bouton(texte)), true, `refusé à tort : ${texte}`);
  }
});

test('un bouton muet n\'est pas une autorisation', () => {
  const { fgc } = luna();
  assert.equal(fgc.lunaClaimLabelAllowed(bouton('')), false);
  assert.equal(fgc.lunaClaimLabelAllowed(null), false);
});

/* --------------------------------------------------- le test qui compte */

test('un CTA Luna intitulé « Acheter 19,99 € » n\'est jamais cliqué', () => {
  const { fgc } = luna();
  const cta = bouton('Acheter 19,99 €');

  /* Deux verrous indépendants, et c'est voulu : la liste d'autorisation ne
     laisse pas passer le bouton, et robustClick le refuserait quand même si
     un appelant l'oubliait. */
  assert.equal(fgc.lunaClaimLabelAllowed(cta), false);
  assert.equal(fgc.robustClick(cta), false);
  assert.equal(clics(cta), 0, `reçu : ${cta.recu.join(', ')}`);
});

test('le garde-libellé tient sur un hôte éprouvé, où le garde-caisse s\'efface', () => {
  const { fgc } = luna();
  /* luna.amazon.fr est dans PROVEN_HOSTS : le garde-caisse y est désarmé,
     donc le libellé est la SEULE chose qui protège. */
  assert.equal(fgc.checkoutGuardApplies(), false);
  const achat = bouton('Acheter 19,99 €');
  assert.equal(fgc.robustClick(achat), false);
  assert.equal(clics(achat), 0);
});

/* ----------------------------------------------------- l'arrêt d'urgence */

test('l\'arrêt d\'urgence bloque aussi un clic Luna', () => {
  const { fgc, gmStore } = luna();
  const btn = bouton('Obtenir le jeu');

  assert.equal(fgc.robustClick(btn), true, 'sans arrêt d\'urgence, le clic passe');
  gmStore.set('FGC_kill_switch', true);

  const second = bouton('Obtenir le jeu');
  assert.equal(fgc.robustClick(second), false);
  assert.equal(clics(second), 0);
});

/* ------------------------------------------------- une série reste une série */

test('dix offres différentes donnent bien dix clics', () => {
  const { fgc } = luna();
  const boutons = Array.from({ length: 10 }, (_, i) => bouton(`Récupérer le jeu ${i}`));

  for (const b of boutons) assert.equal(fgc.robustClick(b), true);
  assert.deepEqual(boutons.map(clics), Array(10).fill(1));
});

test('le même bouton recliqué tout de suite est refusé, sauf exception nommée', () => {
  const { fgc } = luna();
  const btn = bouton('Obtenir le jeu');

  assert.equal(fgc.robustClick(btn), true);
  assert.equal(fgc.robustClick(btn), false, 'deux clics à moins de 4 s : anti-rafale');
  assert.equal(clics(btn), 1);

  /* allowRepeat : la confirmation GOG, où le bouton d'envoi peut être
     RELABELLISÉ au lieu d'être remplacé. Sans cette exception, le clic de
     confirmation arrive sous les 4 s de repos, il est refusé, et un code est
     brûlé pour rien. */
  assert.equal(fgc.robustClick(btn, { allowRepeat: true }), true);
  assert.equal(clics(btn), 2);
});

test('allowRepeat ne lève ni l\'arrêt d\'urgence ni le refus des libellés payants', () => {
  const { fgc, gmStore } = luna();

  const achat = bouton('Acheter 19,99 €');
  assert.equal(fgc.robustClick(achat, { allowRepeat: true }), false);

  gmStore.set('FGC_kill_switch', true);
  const gratuit = bouton('Récupérer');
  assert.equal(fgc.robustClick(gratuit, { allowRepeat: true }), false);
  assert.equal(clics(gratuit), 0);
});

/* ------------------------------------------------ l'autorisation GOG /redeem */

test('le bouton d\'envoi GOG est autorisé par son libellé', () => {
  const { fgc } = loadEngine({ hostname: 'www.gog.com', pathname: '/fr/redeem' });

  for (const texte of ['Continuer', 'Continue', 'Valider', 'Suivant', 'Next', 'OK']) {
    assert.equal(fgc.gogSubmitLabelAllowed(bouton(texte)), true, `refusé à tort : ${texte}`);
  }
  /* Les libellés de confirmation valent aussi : GOG peut relabelliser le même
     bouton entre l'envoi et la confirmation. */
  for (const texte of ['Récupérer', 'Utiliser le code', 'Redeem', 'Confirmer']) {
    assert.equal(fgc.gogSubmitLabelAllowed(bouton(texte)), true, `refusé à tort : ${texte}`);
  }
  for (const texte of ['Acheter', 'Acheter maintenant 5,99 €', 'Ajouter 5,99 € au panier', 'S’abonner']) {
    assert.equal(fgc.gogSubmitLabelAllowed(bouton(texte)), false, `autorisé à tort : ${texte}`);
  }
});

test('un bouton d\'envoi muet reste accepté, un bouton muet « payant » non', () => {
  const { fgc } = loadEngine({ hostname: 'www.gog.com', pathname: '/fr/redeem' });

  /* Icône seule : c'est le formulaire de #codeInput qui l'a désigné, et il
     n'annonce rien. On refuse ce qui est écrit et suspect, pas ce qui se tait. */
  assert.equal(fgc.gogSubmitLabelAllowed(bouton('')), true);
  /* Un <input type="submit"> porte son libellé dans `value`, pas dans le texte. */
  assert.equal(fgc.gogSubmitLabelAllowed(bouton('', { value: 'Continuer' })), true);
  assert.equal(fgc.gogSubmitLabelAllowed(bouton('', { value: 'Acheter 19,99 €' })), false);
  assert.equal(fgc.gogSubmitLabelAllowed(null), false);
});
