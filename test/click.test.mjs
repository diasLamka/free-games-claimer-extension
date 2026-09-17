/* Un clic, c'est un clic.
 *
 * Ce fichier existe a cause d'un rapport du 2026-09-17 : sur la fiche d'un jeu
 * gratuit, la fenetre d'achat s'ouvrait puis restait figee, et l'utilisateur
 * voyait passer "plusieurs clics la ou un seul est demande". Le moteur en
 * envoyait effectivement plusieurs :
 *
 *   - robustClick dispatchait un evenement 'click' PUIS appelait el.click(),
 *     qui en dispatche un second -- deux activations par appel ;
 *   - deux sondes repassent sur les modales de fin d'achat, et recliquaient le
 *     meme bouton a chaque passage tant qu'il restait affiche.
 *
 * Les tests ci-dessous tiennent ces deux comptes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

/* Un bouton qui note tout ce qu'il recoit. */
function bouton(texte = 'J’accepte', options = {}) {
  const el = {
    recu: [],
    textContent: texte,
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
    dispatchEvent(ev) {
      if (options.refuseDispatch) throw new Error('dispatchEvent indisponible');
      el.recu.push(ev.type);
      return true;
    },
    click() { el.recu.push('click-natif'); },
  };
  return el;
}

const clics = (el) => el.recu.filter((t) => t === 'click' || t === 'click-natif').length;

/* ------------------------------------------------------- un appel, un clic */

test('robustClick n\'active le bouton qu\'une seule fois', () => {
  const { fgc } = loadEngine();
  const btn = bouton();

  assert.equal(fgc.robustClick(btn), true);
  assert.equal(clics(btn), 1, `recu : ${btn.recu.join(', ')}`);
  /* La sequence de survol reste complete : c'est elle qui fait reagir les
     gestionnaires qui ecoutent le pointeur plutot que le clic. */
  assert.deepEqual(btn.recu, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
});

test('le clic natif ne sert que si le dispatch a echoue', () => {
  const { fgc } = loadEngine();
  const btn = bouton('J’accepte', { refuseDispatch: true });

  assert.equal(fgc.robustClick(btn), true);
  assert.deepEqual(btn.recu, ['click-natif']);
});

test('les evenements de pointeur portent de quoi etre pris au serieux', () => {
  const { fgc, sandbox } = loadEngine();
  const vus = [];
  const btn = bouton();
  btn.dispatchEvent = (ev) => { vus.push(ev); return true; };

  fgc.robustClick(btn);

  const down = vus.find((e) => e.type === 'pointerdown');
  assert.equal(down.pointerId, 1);
  assert.equal(down.isPrimary, true);
  assert.equal(down.buttons, 1);
  assert.equal(vus.find((e) => e.type === 'click').button, 0);
  assert.equal(sandbox.document.hidden, false);
});

/* ------------------------------------------- pas de rafale sur un bouton */

test('le meme bouton n\'est pas recliqué dans la foulee', () => {
  const { fgc } = loadEngine();
  const btn = bouton();

  assert.equal(fgc.robustClick(btn), true);
  assert.equal(fgc.robustClick(btn), false, 'deuxieme clic immediat accepte');
  assert.equal(fgc.robustClick(btn), false);
  assert.equal(clics(btn), 1);
});

test('passe le delai de repos, une nouvelle chance est donnee -- mais pas indefiniment', () => {
  const { fgc } = loadEngine();
  /* Le repos est ce qui separe "laisser la page reagir" de "marteler" : on le
     met a zero pour compter les chances, pas pour attendre 4 s en test. */
  fgc.CONFIG.clickCooldownMs = 0;
  const btn = bouton();

  for (let i = 0; i < 10; i++) fgc.robustClick(btn);

  assert.equal(clics(btn), fgc.CONFIG.maxClicksPerElement);
});

test('deux boutons differents ne se genent pas', () => {
  const { fgc } = loadEngine();
  const a = bouton('J’accepte');
  const b = bouton('Commander');

  assert.equal(fgc.robustClick(a), true);
  assert.equal(fgc.robustClick(b), true);
  assert.equal(clics(a), 1);
  assert.equal(clics(b), 1);
});

/* ------------------------------- les libelles d'Epic, tels qu'ils arrivent */

const racine = (...boutons) => ({
  querySelectorAll: () => boutons,
  querySelector: () => null,
});

/* Epic ecrit ses libelles francais avec des espaces insecables et repartit le
   texte sur plusieurs descendants : textContent rend "J'accepte" avec un
   blanc que trim() ne voit pas au milieu. Un motif ancre echouait dessus
   alors que le bouton etait le bon. */
test('un libelle coupe par des blancs inhabituels reste reconnu', () => {
  const { fgc } = loadEngine();
  const accord = [/^j['\u2019]accepte$/i];

  for (const libelle of ['J\u2019accepte', ' J\u2019accepte ', 'J\u2019accepte\n  ']) {
    assert.ok(fgc.findActionElement(racine(bouton(libelle)), accord), `libelle non reconnu : ${JSON.stringify(libelle)}`);
  }
});

test('le candidat le plus court est prefere au conteneur qui l\'embarque', () => {
  const { fgc } = loadEngine();
  const conteneur = bouton('En selectionnant J\u2019accepte vous renoncez a votre droit de retractation');
  const btn = bouton('J\u2019accepte');

  assert.equal(fgc.findShortestActionElement(racine(conteneur, btn), [/j['\u2019]accepte/i]), btn);
});

/* --------------------------------- la fenetre ouverte se reconnait toute seule */

test('une iframe de paiement presente vaut fenetre d\'achat ouverte', () => {
  const { fgc, sandbox } = loadEngine();

  assert.equal(fgc.epicPurchaseOverlayOpen(), false);

  sandbox.document.querySelector = (sel) => (sel.includes('webPurchaseContainer') ? {} : null);
  assert.equal(fgc.epicPurchaseOverlayOpen(), true);
});

test('une modale de fin d\'achat affichee vaut fenetre ouverte', () => {
  const { fgc, sandbox } = loadEngine();
  const modale = {
    offsetWidth: 400,
    offsetHeight: 300,
    getClientRects: () => [{}],
    textContent: 'Droit de retractation -- en validant, vous renoncez a...',
  };
  sandbox.document.querySelectorAll = (sel) => (sel.includes('dialog') ? [modale] : []);
  assert.equal(fgc.epicPurchaseOverlayOpen(), true);

  /* Cachee, elle ne compte pas : c'est le residu d'une modale deja fermee. */
  modale.offsetWidth = 0;
  modale.offsetHeight = 0;
  modale.getClientRects = () => [];
  assert.equal(fgc.epicPurchaseOverlayOpen(), false);
});

test('un texte de pied de page ne fait pas croire a une fenetre ouverte', () => {
  const { fgc, sandbox } = loadEngine();
  /* Le piege a eviter absolument : croire la fenetre ouverte alors qu'elle ne
     l'est pas, c'est un jeu qu'on ne reclame jamais. */
  sandbox.document.querySelector = (sel) => (sel.includes('payment-website-pci') ? null : null);
  sandbox.document.querySelectorAll = () => [];
  assert.equal(fgc.epicPurchaseOverlayOpen(), false);
});
