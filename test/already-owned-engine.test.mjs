/* Le moteur ne demande « montrez-moi le bouton » que s'il y a un bouton a montrer (2.106.0).
 *
 * Mesure en vrai Chromium (loop-e2e) : une page GOG qui dit « offre terminee », ou qui ne
 * montre plus que « Jouer » parce que le jeu est deja a vous, sortait en
 * needs_teaching -- et revenait a chaque tentative. Or aucun clic de l'utilisateur ne
 * peut etre appris sur une page ou tout est interdit (jouer, acheter, installer) : la
 * question n'avait pas de reponse.
 *
 * Le moteur le dit maintenant tel quel : verdict `gone` (rien a prendre ici). Le worker
 * le confirme une seconde fois avant de clore l'offre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

/* Un controle de page, avec ce que le moteur en lit (meme forme que adaptive-nav.test.mjs). */
function ctrl({ tag = 'BUTTON', text = '', href = null, w = 240, h = 56, main = true, chrome = false, list = false, disabled = false, attrs = {} } = {}) {
  const el = {
    tagName: tag,
    textContent: text,
    innerText: text,
    className: '',
    id: '',
    disabled,
    offsetWidth: w,
    offsetHeight: h,
    parentElement: { textContent: '', parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null)),
    closest(sel) {
      if (sel === 'a[href]') return tag === 'A' ? el : null;
      if (sel.includes('header, nav')) return chrome ? {} : null;
      if (sel.includes('main, [role="main"]')) return main ? {} : null;
      if (sel.includes('li, [class*="carousel"')) return list ? {} : null;
      return null;
    },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    dispatchEvent: () => true,
    click() {},
  };
  return el;
}

function page(sandbox, { elements = [], mainText = '' } = {}) {
  sandbox.document.querySelectorAll = (sel) => {
    if (sel === 'iframe') return [];
    if (sel.includes('dialog[open]')) return [];
    if (sel.includes('script[src]')) return [];
    if (sel.includes('button')) return elements;
    return [];
  };
  sandbox.document.querySelector = (sel) => (sel === 'main' ? { textContent: mainText } : null);
  sandbox.document.body.contains = () => true;
}

const rapide = (fn, ms) => (ms >= 10000 ? 0 : setTimeout(fn, 1));
const gog = (pathname = '/en/game/hades') => loadEngine({ hostname: 'www.gog.com', pathname, setTimeout: rapide });

/* Les trois barres d'une vraie page de magasin, que rien ne revele. */
const barre = () => [
  ctrl({ tag: 'A', text: 'Store', href: '/en/games', chrome: true, w: 60, h: 20 }),
  ctrl({ tag: 'A', text: 'Community', href: '/en/community', chrome: true, w: 60, h: 20 }),
  ctrl({ text: 'Menu', chrome: true, w: 40, h: 20 }),
];

/* ------------------------------------------------- ce que l'utilisateur pourrait montrer */

test('« Jouer », « Acheter », « Installer », « Dans la bibliotheque » : rien a montrer', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, {
    elements: [
      ctrl({ text: 'Play' }), ctrl({ text: 'Jouer' }), ctrl({ text: 'Buy now' }), ctrl({ text: 'Installer' }),
      ctrl({ text: 'Wishlist it' }), ctrl({ text: 'In library' }), ctrl({ text: 'Dans la bibliothèque' }),
      ctrl({ text: 'Continuer' }), ctrl({ text: 'Download' }),
    ],
  });
  assert.deepEqual([...fgc.navTeachableLabels(8)], []);
});

test('ce qui est hors page, en liste, desactive ou trop long n\'est pas enseignable non plus', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, {
    elements: [
      ctrl({ text: 'Prends-le', chrome: true }),
      ctrl({ text: 'Prends-le', list: true }),
      ctrl({ text: 'Prends-le', disabled: true }),
      ctrl({ text: 'Prends-le', attrs: { 'aria-disabled': 'true' } }),
      ctrl({ text: 'x'.repeat(60) }),
      ctrl({ text: '' }),
    ],
  });
  assert.deepEqual([...fgc.navTeachableLabels(8)], []);
});

test('un bouton qu\'on ne connait pas reste enseignable, une seule fois dans la liste', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, { elements: [ctrl({ text: 'Play' }), ctrl({ text: 'Prends-le' }), ctrl({ text: 'Prends-le' }), ctrl({ text: 'Attrape-le' })] });
  assert.deepEqual([...fgc.navTeachableLabels(8)], ['Prends-le', 'Attrape-le']);
  assert.deepEqual([...fgc.navTeachableLabels(1)], ['Prends-le'], 'borne');
});

test('la demande ne part pas quand il n\'y a rien a montrer, meme si des boutons sont visibles', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, { elements: [ctrl({ text: 'Play' }), ctrl({ text: 'Buy now' }), ctrl({ text: 'Wishlist it' })] });
  assert.equal(fgc.teachRequest('GOG', 'rien'), null);
  page(sandbox, { elements: [ctrl({ text: 'Play' }), ctrl({ text: 'Prends-le' })] });
  const r = fgc.teachRequest('GOG', 'rien');
  assert.equal(r.verdict, 'needs_teaching');
  assert.match(r.reasonText, /Prends-le/);
  assert.doesNotMatch(r.reasonText, /Play/, 'on ne propose pas un bouton interdit');
});

/* ------------------------------------------------------------------ rien a prendre ici */

test('une page de magasin qui ne propose plus que jouer ou acheter n\'offre rien a prendre', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, { elements: [...barre(), ctrl({ text: 'Play' })] });
  assert.equal(fgc.pageOffersNothing(), true, 'jeu deja a vous, la page ne dit que « Jouer »');
  page(sandbox, { elements: [ctrl({ text: 'Buy now' }), ctrl({ text: 'Add to cart 9,99 €' }), ctrl({ text: 'Wishlist it' })] });
  assert.equal(fgc.pageOffersNothing(), true, 'offre finie : la page vend le jeu');
});

test('mais pas une page vide, en erreur, ou qui garde un bouton a montrer', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, { elements: [] });
  assert.equal(fgc.pageOffersNothing(), false, 'page blanche : un echec, pas « rien a prendre »');
  page(sandbox, { elements: [ctrl({ text: 'Retry' }), ctrl({ text: 'Play' })] });
  assert.equal(fgc.pageOffersNothing(), false, 'deux controles : trop peu pour une vraie page de magasin');
  page(sandbox, { elements: [...barre(), ctrl({ text: 'Prends-le' })] });
  assert.equal(fgc.pageOffersNothing(), false, 'un bouton inconnu : on peut le demander');
});

test('« offre terminee » lue par le navigateur compte, meme sans autre signe', () => {
  const { fgc, sandbox } = gog();
  page(sandbox, { elements: [] });
  fgc.navOutcome('ended');
  assert.equal(fgc.pageOffersNothing(), true);
  fgc.navOutcome('none');
  assert.equal(fgc.pageOffersNothing(), false);
});

test('hors des trois magasins, et sur une page Epic introuvable : jamais', () => {
  const dehors = loadEngine({ hostname: 'example.com', pathname: '/' });
  page(dehors.sandbox, { elements: [...barre(), ctrl({ text: 'Play' })] });
  dehors.fgc.navOutcome('ended');
  assert.equal(dehors.fgc.pageOffersNothing(), false);

  // Une fiche Epic « introuvable » vient souvent d'une adresse mal derivee : on ne l'enterre pas.
  const epic = loadEngine({ hostname: 'store.epicgames.com', pathname: '/en-US/not-found' });
  page(epic.sandbox, { elements: [...barre(), ctrl({ text: 'Play' })] });
  epic.fgc.navOutcome('ended');
  assert.equal(epic.fgc.pageOffersNothing(), false);

  // Alors qu'une vraie fiche Epic qui ne propose que « Jouer » : rien a prendre.
  const fiche = loadEngine({ hostname: 'store.epicgames.com', pathname: '/en-US/p/hades' });
  page(fiche.sandbox, { elements: [...barre(), ctrl({ text: 'Play' })] });
  assert.equal(fiche.fgc.pageOffersNothing(), true);
});

test('le verdict dit son nom, son magasin et sa raison', () => {
  const { fgc } = gog();
  assert.deepEqual({ ...fgc.goneVerdict('GOG') }, {
    type: 'fgc-verdict', verdict: 'gone', reasonText: 'rien a prendre sur cette page', plateforme: 'GOG',
  });
});

/* ----------------------------------------- l'ordre de reclamation, de bout en bout */

/* Un pilote de test : l'ordre est donne, l'horloge avance a la main, les messages sont notes. */
function pilote(chargement, { teach } = {}) {
  const { fgc, sandbox, gmStore } = gog(chargement.pathname || '/en/game/hades');
  page(sandbox, chargement);
  const envoyes = [];
  sandbox.chrome = { runtime: { sendMessage: (m) => envoyes.push(m) } };
  let tick = null;
  sandbox.setInterval = (fn) => { tick = fn; return 1; };
  /* Une horloge qui AVANCE a chaque lecture : le navigateur adaptatif attend « que la page dise
     ce qu'elle est » en comparant l'heure a une echeance, et une horloge figee l'attendrait toujours. */
  let horloge = 1_800_000_000_000;
  sandbox.Date = class extends Date { static now() { horloge += 40; return horloge; } };
  return {
    fgc, sandbox, gmStore, envoyes,
    async lancer() {
      fgc.runClaimOrder(300000, false, teach);
      // Le module (asynchrone) finit -- le navigateur rend son issue --, puis la page « se pose » trois secondes.
      for (let i = 0; i < 200 && !fgc.navOutcome(); i++) await new Promise((r) => setTimeout(r, 25));
      assert.ok(fgc.navOutcome(), 'le navigateur a rendu une issue');
      await new Promise((r) => setTimeout(r, 30));
      horloge += 3500;
      tick();
      await new Promise((r) => setTimeout(r, 10));
      return envoyes;
    },
  };
}

test('GOG : « offre terminee » -> gone, jamais « montrez-moi le bouton »', async () => {
  const p = pilote({ elements: [...barre(), ctrl({ text: 'Browse the store' })], mainText: 'This giveaway has ended. Thank you for taking part.' });
  const envoyes = await p.lancer();
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].verdict, 'gone');
  assert.equal(envoyes[0].plateforme, 'GOG');
});

test('GOG : un jeu deja a vous dont la page ne dit que « Play » -> gone, pas de question', async () => {
  const p = pilote({ elements: [...barre(), ctrl({ text: 'Play' }), ctrl({ text: 'Wishlist it' })], mainText: 'Hades' });
  const envoyes = await p.lancer();
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].verdict, 'gone');
  assert.equal(p.fgc.teachState(), null, 'et le mode « a apprendre » n\'a pas ete ouvert');
});

test('GOG : un bouton qu\'on ne reconnait pas -> la question, comme avant', async () => {
  const p = pilote({ elements: [...barre(), ctrl({ text: 'Attrape-le' })], mainText: 'Hades' });
  const envoyes = await p.lancer();
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].verdict, 'needs_teaching');
  assert.match(envoyes[0].reasonText, /Attrape-le/);
});

test('GOG : le worker a deja pose la question (teach: false) -> echec ordinaire, pas de seconde question', async () => {
  const p = pilote({ elements: [...barre(), ctrl({ text: 'Attrape-le' })], mainText: 'Hades' }, { teach: false });
  const envoyes = await p.lancer();
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].verdict, 'failed');
  assert.equal(p.fgc.teachState(), null);
});

test('GOG : une page blanche -> echec (retente), jamais « rien a prendre »', async () => {
  const p = pilote({ elements: [], mainText: '' });
  const envoyes = await p.lancer();
  assert.equal(envoyes.length, 1);
  assert.equal(envoyes[0].verdict, 'failed');
});
