/* La sentinelle de la frame d'achat Epic.
 *
 * Ce fichier existe a cause du 2026-09-17, jeu "MindCop". Console de l'onglet,
 * dans l'iframe store.epicgames.com/purchase :
 *
 *     27.068  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
 *     28.574  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
 *     30.083  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
 *     30.084  Clic ignore : "Ajouter a la bibliotheque" a deja ete clique 1 fois.
 *
 * Trois etapes brulees sur le meme bouton, module mort a 30 s, et la modale
 * "droit de retractation" arrive apres : plus personne pour cliquer
 * "J'accepte". Les tests ci-dessous tiennent les quatre comptes qui comptent :
 * la duree de vie, les tentatives, le bouton choisi, et ce qui reste interdit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

/* Un bouton qui note tout ce qu'il recoit (meme patron que click.test.mjs). */
function bouton(texte) {
  const el = {
    recu: [],
    textContent: texte,
    id: '',
    className: '',
    disabled: false,
    offsetWidth: 120,
    offsetHeight: 40,
    getClientRects: () => [{}],
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 40 }),
    dispatchEvent(ev) { el.recu.push(ev.type); return true; },
    click() { el.recu.push('click-natif'); },
  };
  return el;
}

const clics = (el) => el.recu.filter((t) => t === 'click' || t === 'click-natif').length;

/* Impose un ecran a la frame : un seul point de verite pour tout le DOM que
   le moteur interroge. Le dispatch se fait sur le selecteur, comme dans
   test/pure.test.mjs. */
function ecran(sandbox, boutons, opts = {}) {
  sandbox.document.querySelectorAll = (sel) => {
    if (sel.includes('role="dialog"')) return opts.dialogues || [];
    if (sel.includes('script[src]')) return opts.scripts || [];
    if (sel === 'iframe') return [];
    if (sel.includes('[role="button"]')) return boutons;   // action + libelles visibles
    if (sel.includes('h1,h2,h3')) return opts.titres || [];
    return [];
  };
  sandbox.document.querySelector = () => null;
}

const sousIframe = () => loadEngine({ frame: 'sub', hostname: 'store.epicgames.com', pathname: '/purchase' });
const framePrestataire = () => loadEngine({ frame: 'pci', hostname: 'payment-website-pci.ol.epicgames.com', pathname: '/purchase' });

/* ------------------------------------------- ce qu'on ne clique jamais */

test('"Annuler" n\'est jamais clique, meme seul a l\'ecran', () => {
  const { fgc, sandbox } = sousIframe();
  const annuler = bouton('Annuler');
  ecran(sandbox, [annuler, bouton('Fermer'), bouton('En savoir plus')]);

  assert.equal(fgc.epicPaymentFramePass(), false);
  assert.equal(clics(annuler), 0);
  assert.equal(fgc.epicPaymentFrameState().actions, 0);
});

test('face a "Annuler" et "J\'accepte", c\'est l\'accord qui est clique', () => {
  const { fgc, sandbox } = sousIframe();
  const annuler = bouton('Annuler');
  const accepte = bouton('J’accepte');
  ecran(sandbox, [annuler, accepte]);

  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(accepte), 1);
  assert.equal(clics(annuler), 0);
});

/* La regle de la 2.15.1 : c'est la liste autorisee qui borne le risque, pas
   l'adresse de l'iframe. "Valider la commande" peut depenser de l'argent. */
test('"Valider la commande" reste interdite dans une sous-iframe Epic', () => {
  const { fgc, sandbox } = sousIframe();
  const valider = bouton('Valider la commande');
  const place = bouton('Place order');
  ecran(sandbox, [valider, place]);

  assert.equal(fgc.epicPaymentFramePass(), false);
  assert.equal(clics(valider), 0);
  assert.equal(clics(place), 0);
  assert.equal(fgc.epicPaymentFrameState().actions, 0);
});

test('la meme page, dans la frame du prestataire, est bien commandee', () => {
  const { fgc, sandbox } = framePrestataire();
  const valider = bouton('Valider la commande');
  ecran(sandbox, [valider]);

  /* Prouve que le test precedent n'est pas un faux positif de selecteur : la
     frontiere est le ROLE de la frame, pas le libelle ni l'URL. */
  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(valider), 1);
});

/* --------------------------------- les tentatives ne se gaspillent plus */

test('un bouton deja clique ne consomme aucune tentative', () => {
  const { fgc, sandbox } = sousIframe();
  /* On interdit la seconde chance pour isoler le comportement mesure le
     2026-09-17 : trois passes, trois etapes brulees, un seul vrai clic. */
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 999999;
  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);

  assert.equal(fgc.epicPaymentFramePass(), true);
  for (let i = 0; i < 20; i++) fgc.epicPaymentFramePass();

  assert.equal(fgc.epicPaymentFrameState().actions, 1, 'des passes ont ete comptees comme des actions');
  assert.equal(clics(ajouter), 1);
});

test('la sentinelle est toujours vivante apres vingt passes', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 999999;
  ecran(sandbox, [bouton('Ajouter à la bibliothèque')]);

  for (let i = 0; i < 20; i++) fgc.epicPaymentFramePass();

  /* L'ancienne boucle etait morte des la troisieme. C'est ce qui a laisse la
     modale sans personne pour la cliquer. */
  assert.equal(fgc.epicPaymentFrameState().alive, true);
  assert.equal(fgc.epicPaymentFrameState().stopped, false);
});

/* ------------------------------------------------ le scenario du 17/09 */

test('la modale qui arrive TARD est cliquee', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 999999;

  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);
  assert.equal(fgc.epicPaymentFramePass(), true);

  // Epic reflechit : vingt passes sans que rien ne change.
  for (let i = 0; i < 20; i++) fgc.epicPaymentFramePass();

  // Puis la modale de retractation s'affiche, avec des noeuds neufs.
  const annuler = bouton('Annuler');
  const accepte = bouton('J’accepte');
  ecran(sandbox, [annuler, accepte], { dialogues: [{ textContent: 'Informations sur le droit de rétractation' }] });

  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(accepte), 1);
  assert.equal(clics(annuler), 0);
  assert.equal(fgc.epicPaymentFrameState().actions, 2);
});

test('la veille passe par le vrai chemin du guetteur, et ne meurt pas a la troisieme', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 999999;
  fgc.startEpicPostPurchaseModalWatcher();

  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);
  for (let i = 0; i < 40; i++) assert.equal(fgc.epicPostPurchaseWatcherTick(), true, 'la veille s\'est arretee au tour ' + i);

  const accepte = bouton('J’accepte');
  ecran(sandbox, [accepte]);
  fgc.epicPostPurchaseWatcherTick();

  assert.equal(clics(accepte), 1);
});

/* --------------------------------- chaque frame ne fait que son travail */

test('dans la frame d\'achat, seule la sentinelle clique', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.startEpicPostPurchaseModalWatcher();
  const accepte = bouton('J’accepte');
  ecran(sandbox, [accepte], {
    titres: [{ textContent: 'Informations sur le droit de rétractation', closest: () => null, parentElement: null }],
    dialogues: [{ textContent: 'Informations sur le droit de rétractation' }],
  });

  fgc.epicPostPurchaseWatcherTick();

  /* UN seul clic : handleEpicPostPurchaseModals n'a pas tourne en plus. Deux
     activations, c'etait le bug de la 2.13.5 -- on ne le refait pas par la
     porte de derriere. */
  assert.equal(clics(accepte), 1);
});

test('dans le cadre du dessus, la sentinelle ne clique rien', () => {
  const { fgc, sandbox } = loadEngine({ hostname: 'store.epicgames.com', pathname: '/p/mindcop' });
  /* Veille ARMEE : sans cela la passe ne tourne pas du tout, et le test
     passerait a vide -- il ne prouverait rien. */
  fgc.startEpicPostPurchaseModalWatcher();
  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);

  fgc.epicPostPurchaseWatcherTick();

  /* Sur une fiche produit, "Ajouter a la bibliotheque" ne se clique QUE par
     claimEpicGame. Une sentinelle qui tournerait ici reclamerait toute seule. */
  assert.equal(clics(ajouter), 0);
});

/* ------------------------------------------------------ bornes et filet */

test('le plafond d\'actions tient meme quand React remonte des noeuds neufs', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.CONFIG.clickCooldownMs = 0;
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 0;

  /* Chaque passe : un bouton NEUF et une signature differente. La memoire des
     clics de robustClick, qui travaille par noeud, ne voit rien passer. */
  for (let i = 0; i < 30; i++) {
    ecran(sandbox, [bouton('Ajouter à la bibliothèque ' + i)]);
    fgc.epicPaymentFramePass();
  }

  assert.equal(fgc.epicPaymentFrameState().actions, fgc.CONFIG.epicPaymentFrameMaxActions);
});

test('un defi de securite eteint la sentinelle', () => {
  const { fgc, sandbox } = sousIframe();
  const accepte = bouton('J’accepte');
  ecran(sandbox, [accepte], {
    scripts: [{ src: 'https://store.epicgames.com/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1' }],
  });

  assert.equal(fgc.epicPaymentFramePass(), false);
  assert.equal(clics(accepte), 0);
  assert.equal(fgc.epicPaymentFrameState().stopped, true);
  assert.equal(fgc.epicPaymentFrameState().alive, false);
});

test('le filet ne previent qu\'une fois', () => {
  const { fgc, sandbox } = sousIframe();
  fgc.CONFIG.epicPaymentFrameStuckNoticeMs = 0;
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 999999;
  const notifications = [];
  sandbox.GM_notification = (opts) => notifications.push(opts);

  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);
  for (let i = 0; i < 10; i++) fgc.epicPaymentFramePass();

  assert.equal(notifications.length, 1, JSON.stringify(notifications.map((n) => n.text)));
  // Depuis la 2.55.0, une piece { key, args } : le worker compose la phrase.
  assert.equal(notifications[0].text.key, 'engNotifyEpicWaitingClick');
  assert.match(notifications[0].text.args[0], /biblioth/i);
});

/* ------------------------------- le cadre du dessus n'enchaine pas */

test('une fenetre d\'achat ouverte bloque le passage au jeu suivant', () => {
  const { fgc, sandbox } = loadEngine({ hostname: 'store.epicgames.com', pathname: '/p/mindcop' });
  sandbox.document.querySelectorAll = () => [];

  sandbox.document.querySelector = (sel) => (sel.includes('webPurchaseContainer') ? {} : null);
  assert.equal(fgc.nextGameGateReason(), 'purchase-open');

  /* C'est le seul chemin du code qui pouvait detruire une commande en cours :
     processNext naviguait vers le jeu suivant par-dessus la fenetre ouverte. */
  sandbox.document.querySelector = () => null;
  assert.equal(fgc.nextGameGateReason(), null);
});

/* ------------------------- ce qui est derriere une modale est hors de portee */

/* Une modale Epic : elle porte ses propres boutons, et le bouton de la page
   reste dans le document derriere elle -- exactement comme le 2026-09-17. */
function modale(boutons, texte = 'Informations sur le droit de retractation. En selectionnant J\'accepte, vous donnez votre consentement...') {
  return {
    offsetWidth: 520,
    offsetHeight: 300,
    getClientRects: () => [{}],
    textContent: texte,
    querySelectorAll: () => boutons,
    querySelector: () => null,
  };
}

test('modale ouverte : c\'est "J\'accepte" qui est clique, pas le bouton du dessous', () => {
  const { fgc, sandbox } = sousIframe();
  const ajouter = bouton('Ajouter à la bibliothèque');
  const annuler = bouton('Annuler');
  const accepte = bouton('J\'accepte');
  /* Le document contient les trois -- c'est ce que montrait la ligne
     "Ecran avant : Ajouter à la bibliothèque | Annuler | J'accepte #3". */
  ecran(sandbox, [ajouter, annuler, accepte], { dialogues: [modale([annuler, accepte])] });

  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(accepte), 1);
  assert.equal(clics(ajouter), 0, 'le bouton derriere la modale a ete clique');
  assert.equal(clics(annuler), 0);
});

test('le bouton derriere la modale ne recoit jamais rien, meme apres vingt passes', () => {
  const { fgc, sandbox } = sousIframe();
  const ajouter = bouton('Ajouter à la bibliothèque');
  const accepte = bouton('J\'accepte');
  ecran(sandbox, [ajouter, accepte], { dialogues: [modale([accepte])] });

  for (let i = 0; i < 20; i++) fgc.epicPaymentFramePass();

  /* Le 2026-09-17, ces vingt passes auraient produit six clics sur "Ajouter
     a la bibliotheque" et six modales empilees. */
  assert.equal(clics(ajouter), 0);
  assert.equal(clics(accepte), 1);
});

test('une modale sans bouton autorise ne fait RIEN cliquer', () => {
  const { fgc, sandbox } = sousIframe();
  const ajouter = bouton('Ajouter à la bibliothèque');
  const annuler = bouton('Annuler');
  const savoirPlus = bouton('En savoir plus');
  ecran(sandbox, [ajouter, annuler, savoirPlus], { dialogues: [modale([annuler, savoirPlus])] });

  /* On attend : pas de repli vers le document. C'est ce repli-la qui empilait
     les modales -- le filet des 30 s se chargera de prevenir. */
  assert.equal(fgc.epicPaymentFramePass(), false);
  assert.equal(clics(ajouter), 0);
  assert.equal(clics(annuler), 0);
  assert.equal(fgc.epicPaymentFrameState().actions, 0);
});

test('deux modales identiques empilees donnent la MEME signature', () => {
  const { fgc, sandbox } = sousIframe();
  const accepte = bouton('J\'accepte');
  const annuler = bouton('Annuler');

  ecran(sandbox, [annuler, accepte], { dialogues: [modale([annuler, accepte])] });
  const une = fgc.epicPaymentScreenSignature();

  ecran(sandbox, [annuler, accepte], { dialogues: [modale([annuler, accepte]), modale([annuler, accepte])] });
  const deux = fgc.epicPaymentScreenSignature();

  /* La signature comptait les dialogues : un empilement passait pour un ecran
     NEUF, le frein "deja clique, ecran inchange" ne se declenchait jamais, et
     les six actions y passaient. */
  assert.equal(deux, une);
});

test('sans modale, le parcours qui marche est inchange', () => {
  const { fgc, sandbox } = sousIframe();
  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);

  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(ajouter), 1);
});

/* ------------------------------------- le journal ne crie pas pour rien */

test('un reclic voue au refus n\'est meme pas tente', () => {
  const { fgc, sandbox } = sousIframe();
  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);

  assert.equal(fgc.epicPaymentFramePass(), true);
  assert.equal(clics(ajouter), 1);

  /* L'ecran bouge (une modale s'ouvre ailleurs) mais le meme bouton est
     toujours la : la passe suivante le retrouvait et se faisait refuser par
     l'anti-rafale -- un refus sans consequence, mais une ligne de journal a
     chaque fois, que chrome://extensions compte comme une erreur. */
  ecran(sandbox, [ajouter, bouton('Chargement...')]);
  for (let i = 0; i < 5; i++) assert.equal(fgc.epicPaymentFramePass(), false);

  assert.equal(clics(ajouter), 1);
  assert.equal(fgc.epicPaymentFrameState().actions, 1);
});

test('passe le delai de repos, un vrai second essai reste possible', () => {
  const { fgc, sandbox } = sousIframe();
  /* Le repos a zero : on verifie que le frein est bien le DELAI, et pas un
     verrou definitif -- un premier clic peut n'avoir pas pris. */
  fgc.CONFIG.clickCooldownMs = 0;
  fgc.CONFIG.epicPaymentFrameRetrySameMs = 0;
  const ajouter = bouton('Ajouter à la bibliothèque');
  ecran(sandbox, [ajouter]);

  fgc.epicPaymentFramePass();
  ecran(sandbox, [ajouter, bouton('Chargement...')]);
  fgc.epicPaymentFramePass();

  assert.equal(fgc.epicPaymentFrameState().actions, 2);
});
