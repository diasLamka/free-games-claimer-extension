/* Le claimer qui se repare seul (2.102.0).
 *
 * Deux choses nouvelles par rapport a 2.101.0 :
 *
 *   1. L'EMPREINTE. Un controle qui a pris un jeu est retenu avec sa forme (marque
 *      de test, cible, classes lisibles, forme de l'adresse). Quand le magasin
 *      change le MOT, un controle de meme forme est reconnu -- sans passer devant
 *      aucun interdit.
 *   2. LA DEMANDE. Quand le moteur lit la page sans reconnaitre de bouton, il le
 *      dit (needs_teaching), une fois toutes les six heures par magasin, et UN clic
 *      de l'utilisateur, prouve par « le jeu est a vous », apprend le bouton.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

function control(texte, { tag = 'BUTTON', attrs = {}, cls = '', href = null, w = 240, h = 56, main = true, list = false } = {}) {
  const el = {
    tagName: tag,
    textContent: texte,
    innerText: texte,
    className: cls,
    id: '',
    disabled: false,
    offsetWidth: w,
    offsetHeight: h,
    parentElement: { textContent: '', parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null)),
    closest(sel) {
      if (sel === 'a[href]') return tag === 'A' ? el : null;
      if (sel.includes('header, nav')) return null;
      if (sel.includes('main, [role="main"]')) return main ? {} : null;
      if (sel.includes('li, [class*="carousel"')) return list ? {} : null;
      return null;
    },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    dispatchEvent: () => true,
  };
  return el;
}
const page = (sandbox, elements) => {
  sandbox.document.querySelectorAll = (sel) => (sel.includes('button') ? elements : []);
  sandbox.document.querySelector = () => null;
};
const clic = (el, trusted = true) => ({ isTrusted: trusted, target: { closest: () => el } });
const gog = (pathname = '/en/game/hades') => loadEngine({ hostname: 'www.gog.com', pathname });

const BOUTON = { attrs: { 'data-testid': 'claim-cta' }, cls: 'button-primary giveaway__button' };

/* ------------------------------------------------------------- l'empreinte */

test('la forme d\'un controle est retenue, mais pas celle d\'un <button> nu', () => {
  const { fgc } = gog();
  const fp = fgc.navFingerprint(control('Prends-le', BOUTON));
  assert.equal(fp.t, 'button');
  assert.equal(fp.i, 'claim-cta');
  assert.deepEqual([...fp.c], ['button-primary', 'giveaway__button']);
  assert.equal(fgc.navFingerprint(control('OK')), null, 'rien de distinctif : pas d\'empreinte');
  // Les classes generees par une feuille de style ne sont pas une forme.
  assert.equal(fgc.navFingerprint(control('x', { cls: 'css-1x2y3z sc-AbCdEf _a1b2c3 jsx-12345' })), null);
});

test('un mot nouveau sur un controle de meme forme est reconnu apres UNE reussite', () => {
  const { fgc, sandbox } = gog();
  const avant = control('Prends-le', BOUTON);
  page(sandbox, [avant]);
  // Rien n'est connu : ni le mot ni la forme.
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null);

  fgc.navLearn('GOG', 'claim', fgc.navDescribe(avant), true);

  // Le magasin change le mot, pas la structure.
  const apres = control('Attrape-le', BOUTON);
  page(sandbox, [apres]);
  const best = fgc.navBest('claim', fgc.navMemoryRead('GOG'));
  assert.ok(best, 'la forme apprise suffit');
  assert.equal(best.el, apres);
  assert.match(best.why.join(' '), /empreinte/);
});

test('la forme n\'ouvre JAMAIS la porte a un libelle interdit', () => {
  const { fgc, sandbox } = gog();
  fgc.navLearn('GOG', 'claim', fgc.navDescribe(control('Prends-le', BOUTON)), true);
  for (const interdit of ['Buy now', 'Acheter 9,99 €', 'Add to cart', 'Install', 'Installer', 'Launch', 'Lancer', 'Download', 'Mettre à jour', 'Subscribe']) {
    const el = control(interdit, BOUTON);
    page(sandbox, [el]);
    assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null, interdit);
  }
});

test('une autre forme, une autre balise, un autre magasin : pas de reconnaissance', () => {
  const { fgc, sandbox } = gog();
  fgc.navLearn('GOG', 'claim', fgc.navDescribe(control('Prends-le', BOUTON)), true);
  const autreForme = control('Attrape-le', { attrs: { 'data-testid': 'wishlist-cta' }, cls: 'button-primary giveaway__button' });
  page(sandbox, [autreForme]);
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null, 'une autre marque de test');
  const lien = control('Attrape-le', { ...BOUTON, tag: 'A', href: '/en/giveaway/x' });
  page(sandbox, [lien]);
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null, 'une autre balise');
  const bon = control('Attrape-le', BOUTON);
  page(sandbox, [bon]);
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('Epic Games')), null, 'la memoire est par magasin');
});

test('une forme faite de classes seules demande deux reussites', () => {
  const { fgc, sandbox } = gog();
  const classes = { cls: 'button-primary giveaway__button' };
  fgc.navLearn('GOG', 'claim', fgc.navDescribe(control('Prends-le', classes)), true);
  page(sandbox, [control('Attrape-le', classes)]);
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null, 'une fois ne suffit pas');
  fgc.navLearn('GOG', 'claim', fgc.navDescribe(control('Prends-le', classes)), true);
  assert.ok(fgc.navBest('claim', fgc.navMemoryRead('GOG')), 'deux fois : oui');
});

test('un echec pese plus que la reussite : la forme n\'est plus retenue', () => {
  const { fgc, sandbox } = gog();
  const d = fgc.navDescribe(control('Prends-le', BOUTON));
  fgc.navLearn('GOG', 'claim', d, true);
  fgc.navLearn('GOG', 'claim', d, false);
  fgc.navLearn('GOG', 'claim', d, false);
  page(sandbox, [control('Attrape-le', BOUTON)]);
  assert.equal(fgc.navBest('claim', fgc.navMemoryRead('GOG')), null);
});

test('la memoire des formes reste bornee', () => {
  const { fgc } = gog();
  for (let i = 0; i < 20; i++) {
    fgc.navLearn('GOG', 'claim', fgc.navDescribe(control('x' + i, { attrs: { 'data-testid': 'cta-' + i } })), true);
  }
  assert.ok(fgc.navMemoryRead('GOG').fp.claim.length <= 8);
});

/* --------------------------------------------------------------- la demande */

test('le moteur ne demande qu\'une fois toutes les six heures par magasin', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, [control('Qui sait', BOUTON)]);
  assert.equal(fgc.teachBegin('GOG'), true);
  assert.ok(fgc.teachState(), 'le mode « a apprendre » est ouvert');
  assert.equal(fgc.teachBegin('GOG'), false, 'pas deux fois de suite');
  assert.equal(fgc.teachBegin('Epic Games'), true, 'un autre magasin a son propre compteur');
});

test('la demande part avec les boutons vus, seulement sur une page lisible', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, []);
  assert.equal(fgc.teachRequest('GOG', 'rien'), null, 'une page sans bouton ne demande rien');
  page(sandbox, [control('Prends-le', BOUTON), control('Wishlist it', {})]);
  const r = fgc.teachRequest('GOG', 'rien');
  assert.equal(r.type, 'fgc-verdict');
  assert.equal(r.verdict, 'needs_teaching');
  assert.equal(r.plateforme, 'GOG');
  assert.match(r.reasonText, /Prends-le/);

  const ailleurs = loadEngine({ hostname: 'example.com', pathname: '/' });
  page(ailleurs.sandbox, [control('Prends-le', BOUTON)]);
  assert.equal(ailleurs.fgc.teachRequest('GOG', 'x'), null, 'hors des trois magasins : jamais');
});

test('un clic, puis « le jeu est a vous » : appris, le worker est prevenu', () => {
  const { fgc, sandbox, gmStore } = gog();
  const envoyes = [];
  sandbox.chrome = { runtime: { sendMessage: (m) => envoyes.push(m) } };
  const prends = control('Prends-le', BOUTON);
  page(sandbox, [prends]);
  assert.equal(fgc.teachBegin('GOG'), true);

  fgc.demoOnClick(clic(prends));
  page(sandbox, [control('In library', {})]);
  fgc.demoCheck();

  const m = fgc.navMemoryRead('GOG');
  assert.equal(m.claim.prendsle.ok, 1);
  assert.equal(m.fp.claim[0].fp.i, 'claim-cta', 'et sa forme');
  assert.deepEqual(envoyes.map((e) => e.type), ['fgc-appris']);
  assert.equal(envoyes[0].plateforme, 'GOG');
  assert.equal(fgc.teachState(), null, 'la demande est close');
  void gmStore;
});

test('hors demande, apprendre ne previent pas le worker', () => {
  const { fgc, sandbox } = gog();
  const envoyes = [];
  sandbox.chrome = { runtime: { sendMessage: (m) => envoyes.push(m) } };
  const prends = control('Prends-le', BOUTON);
  page(sandbox, [prends]);
  fgc.demoOnClick(clic(prends));
  page(sandbox, [control('In library', {})]);
  fgc.demoCheck();
  assert.equal(fgc.navMemoryRead('GOG').claim.prendsle.ok, 1);
  assert.deepEqual(envoyes, []);
});

test('pendant la demande, la preuve a quatre minutes, pas quarante-cinq secondes', () => {
  const { fgc, sandbox } = gog();
  const prends = control('Prends-le', BOUTON);
  page(sandbox, [prends]);
  fgc.teachBegin('GOG');
  fgc.demoOnClick(clic(prends));
  const lent = JSON.parse(sandbox.sessionStorage.getItem('FGC_nav_demo')).map((e) => ({ ...e, ts: Date.now() - 120000 }));
  sandbox.sessionStorage.setItem('FGC_nav_demo', JSON.stringify(lent));
  page(sandbox, [control('In library', {})]);
  fgc.demoCheck();
  assert.equal(fgc.navMemoryRead('GOG').claim.prendsle.ok, 1, 'deux minutes plus tard, la demande attend encore');
});

test('une page de paiement n\'apprend rien', () => {
  const { fgc, sandbox } = gog('/en/checkout/pay');
  const bouton = control('Prends-le', BOUTON);
  page(sandbox, [bouton]);
  fgc.demoOnClick(clic(bouton));
  assert.equal(fgc.demoRead().length, 0);
});
