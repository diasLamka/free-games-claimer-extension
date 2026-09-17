/* Tests de la garde-caisse du moteur.
 *
 * Elle a un seul travail : empecher un clic de demarrer un parcours de
 * PAIEMENT dans un onglet que l'utilisateur ne voit pas.
 *
 * Deux exigences opposees, et c'est tout l'enjeu :
 *   - elle doit bloquer les vrais controles de paiement des magasins non
 *     eprouves (pourboires itch.io, panier IndieGala) ;
 *   - elle ne doit RIEN bloquer sur Epic, GOG et Luna, dont le parcours
 *     GRATUIT passe legitimement par un panier et une commande.
 * Une garde trop zelee casse la reclamation qui marche en production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness.mjs';

/** Un faux element, avec juste ce que la garde inspecte. */
function element({ id = '', classe = '', onclick = null, testid = null, form = null, text = '' } = {}) {
  const el = {
    id,
    className: classe,
    textContent: text,
    getAttribute(name) {
      if (name === 'onclick') return onclick;
      if (name === 'data-testid') return testid;
      return null;
    },
    closest(sel) {
      return sel === 'form' ? form : null;
    },
  };
  return el;
}

/** Un faux formulaire qui contient, ou non, un champ de montant. */
function formulaire({ champs = [] } = {}) {
  return {
    querySelector(sel) {
      return champs.some((c) => sel.includes(c)) ? {} : null;
    },
  };
}

const surHote = (hostname) => loadEngine({ hostname }).fgc;

/* ------------------------------------------- ce qu'elle doit laisser passer */

test('la garde ne s\'applique pas aux trois magasins deja en production', () => {
  for (const host of ['store.epicgames.com', 'www.gog.com', 'luna.amazon.fr', 'gaming.amazon.com']) {
    const fgc = surHote(host);
    assert.equal(fgc.checkoutGuardApplies(), false, `la garde s'active sur ${host}`);
  }
});

test('la garde s\'applique partout ailleurs', () => {
  for (const host of ['store.steampowered.com', 'freebies.indiegala.com', 'dev.itch.io']) {
    const fgc = surHote(host);
    assert.equal(fgc.checkoutGuardApplies(), true, `la garde dort sur ${host}`);
  }
});

test('les boutons du parcours gratuit d\'Epic ne sont pas pris pour une caisse', () => {
  // Epic fait cliquer « Ajouter au panier » puis « Valider la commande » sur un
  // total a zero. Une garde fondee sur ces mots casserait tout.
  const fgc = surHote('store.epicgames.com');
  const boutons = [
    element({ text: 'Ajouter au panier' }),
    element({ text: 'Valider la commande' }),
    element({ text: 'Place Order' }),
    element({ text: 'Ajouter a la bibliotheque' }),
    element({ text: 'Obtenir' }),
    element({ text: "J'accepte" }),
  ];
  for (const b of boutons) {
    assert.equal(fgc.isCheckoutButton(b), false, `bloque a tort : "${b.textContent}"`);
  }
});

test('un bouton ordinaire d\'un magasin non eprouve passe', () => {
  const fgc = surHote('freebies.indiegala.com');
  assert.equal(fgc.isCheckoutButton(element({
    classe: 'developer-product-download-button-cont',
    text: 'Add to your library',
  })), false);
});

/* ------------------------------------------------ ce qu'elle doit bloquer */

test('un bouton de prestataire de paiement est refuse', () => {
  const fgc = surHote('dev.itch.io');
  assert.equal(fgc.isCheckoutButton(element({ classe: 'checkout_btn checkout_stripe' })), true);
  assert.equal(fgc.isCheckoutButton(element({ classe: 'checkout_paypal' })), true);
  assert.equal(fgc.isCheckoutButton(element({ id: 'paypal-button' })), true);
});

test('un bouton de pourboire est refuse', () => {
  const fgc = surHote('dev.itch.io');
  assert.equal(fgc.isCheckoutButton(element({ classe: 'donate_btn' })), true);
  assert.equal(fgc.isCheckoutButton(element({ id: 'tip_5' })), true);
});

test('un clic voisin d\'un champ de montant est refuse', () => {
  // Le cas itch.io : le formulaire qui porte le lien « No thanks, just take me
  // to the downloads » contient AUSSI le champ de prix et les boutons de
  // pourboire. C'est le seul endroit ou un selecteur relache demarre une caisse.
  const fgc = surHote('dev.itch.io');
  const avecPrix = element({
    text: 'No thanks, just take me to the downloads',
    form: formulaire({ champs: ['money_input'] }),
  });
  assert.equal(fgc.isCheckoutButton(avecPrix), true);

  const sansPrix = element({
    text: 'No thanks, just take me to the downloads',
    form: formulaire({ champs: [] }),
  });
  assert.equal(fgc.isCheckoutButton(sansPrix), false);
});

test('un panier appele par attribut onclick est refuse', () => {
  // indiegala.com/store : a.store-product-price-box-add-to-cart avec
  // onclick="cartAddProduct(...)" remplit un vrai panier.
  const fgc = surHote('www.indiegala.com');
  assert.equal(fgc.isCheckoutButton(element({
    classe: 'store-product-price-box-add-to-cart',
    onclick: "cartAddProduct(12345, 'Un jeu')",
  })), true);
});

test('en cas de doute, la garde refuse', () => {
  // Un selecteur rejete par le navigateur ne doit pas ouvrir la voie.
  const fgc = surHote('dev.itch.io');
  const explosif = {
    id: '', className: '', textContent: '',
    getAttribute() { return null; },
    closest() { throw new Error('selecteur invalide'); },
  };
  assert.equal(fgc.isCheckoutButton(explosif), true);
});

test('un element absent n\'est pas une caisse', () => {
  const fgc = surHote('dev.itch.io');
  assert.equal(fgc.isCheckoutButton(null), false);
  assert.equal(fgc.isCheckoutButton(undefined), false);
});
