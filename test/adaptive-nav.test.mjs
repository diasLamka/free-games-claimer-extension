/* Le navigateur adaptatif (2.100.0).
 *
 * Signale : sur GOG, la fiche d'un jeu en giveaway porte "Go to giveaway", qui
 * mene a une seconde page ou il faut cliquer "Ajouter a la bibliotheque". Le
 * moteur ne cherchait qu'un libelle exact sur la page courante, et ne trouvait
 * rien sur la premiere.
 *
 * Ces tests tiennent ce que le module promet : lire la page plutot qu'un
 * texte, ne jamais toucher a ce qui coute de l'argent, ne croire un succes que
 * sur une preuve, apprendre de ce qui a marche, et reprendre apres un
 * changement de page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';

const TIMER = 'Offer ends in: 2d 21h 50m 26s';

/* Un controle de page, avec ce que le moteur en lit. */
function ctrl({ tag = 'BUTTON', text = '', visible = null, href = null, w = 240, h = 56, cls = '', main = false, chrome = false, list = false, around = '', disabled = false, onClick = null } = {}) {
  const recu = [];
  let fait = false;
  const el = {
    tagName: tag,
    textContent: text,
    ...(visible !== null ? { innerText: visible } : {}),
    className: cls,
    id: '',
    disabled,
    offsetWidth: w,
    offsetHeight: h,
    recu,
    parentElement: { textContent: around, parentElement: null },
    getClientRects: () => [{}],
    getAttribute: (n) => (n === 'href' ? href : null),
    closest(sel) {
      if (sel === 'a[href]') return tag === 'A' ? el : null;
      if (sel.includes('header, nav')) return chrome ? {} : null;
      if (sel.includes('main, [role="main"]')) return main ? {} : null;
      if (sel.includes('li, [class*="carousel"')) return list ? {} : null;
      return null;
    },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    dispatchEvent(ev) {
      recu.push(ev.type);
      if (ev.type === 'click' && !fait && onClick) { fait = true; onClick(el); }
      return true;
    },
    click() {
      recu.push('click-natif');
      if (!fait && onClick) { fait = true; onClick(el); }
    },
  };
  return el;
}
const clics = (e) => e.recu.filter((t) => t === 'click' || t === 'click-natif').length;

/* Le DOM que le moteur interroge, derriere un seul point de verite. */
function page(sandbox, { elements = [], dialogs = [], iframes = [], mainText = '', titre = null } = {}) {
  const ctx = { elements, dialogs, iframes, mainText };
  const retires = new Set();
  sandbox.document.querySelectorAll = (sel) => {
    if (sel === 'iframe') return ctx.iframes;
    if (sel.includes('dialog[open]')) return ctx.dialogs;
    if (sel.includes('script[src]')) return [];
    if (sel.includes('button')) return ctx.elements.filter((e) => !retires.has(e));
    return [];
  };
  sandbox.document.querySelector = (sel) => {
    if (sel === 'main') return { textContent: ctx.mainText };
    if ((sel === '.giveaway__title' || sel === 'h1' || sel.includes('h1')) && titre) return { textContent: titre };
    return null;
  };
  sandbox.document.body.contains = (x) => !retires.has(x);
  ctx.retirer = (x) => retires.add(x);
  return ctx;
}

/* Les delais courts comptent ; une attente de navigation (le navigateur decharge la
   page) ne revient jamais, comme dans un vrai onglet. */
const rapide = (fn, ms) => (ms >= 10000 ? 0 : setTimeout(fn, 1));
const gog = (pathname = '/en/game/bounty_train') => loadEngine({ hostname: 'www.gog.com', pathname, setTimeout: rapide });

/* ------------------------------------------------------------ les garde-fous */

test('ce qui touche a l\'argent, aux comptes ou au partage n\'est JAMAIS choisi', () => {
  const { fgc } = gog();
  for (const interdit of [
    'Wishlist it', 'Add to cart', 'Ajouter au panier', 'Buy now', 'Acheter 4,99 €', 'Checkout', 'Kaufen', 'Comprar ahora',
    'Politique de confidentialité', 'Sign in', 'Se connecter', 'Watch trailer', 'Share', 'Newsletter', 'Annuler', 'Plus tard',
    'Pay now', 'Payment', 'Subscribe', 'Obtenir pour 9,99 €', 'Get it for $4.99',
  ]) {
    assert.ok(fgc.navVetoReason(interdit), `"${interdit}" devrait etre interdit`);
  }
  for (const permis of ['Go to giveaway', 'Ajouter à la bibliothèque', 'Add to library', 'Récupérez Bounty Train', 'Claim', 'Obtenir 0,00 €']) {
    assert.equal(fgc.navVetoReason(permis), null, `"${permis}" devrait etre permis`);
  }
});

test('une page qui ne propose que d\'acheter : aucune etape, aucun clic', async () => {
  const { fgc, sandbox } = gog('/en/game/cher');
  const acheter = ctrl({ text: 'Buy now', main: true });
  const panier = ctrl({ text: 'Add to cart 9,99 €', main: true });
  const souhait = ctrl({ text: 'Wishlist it', main: true });
  page(sandbox, { elements: [acheter, panier, souhait] });
  const r = await fgc.navRun('GOG', { stateTimeoutMs: 30 });
  assert.equal(r.outcome, 'none');
  assert.equal(clics(acheter) + clics(panier) + clics(souhait), 0);
  assert.deepEqual([...r.labels].sort(), ['Add to cart 9,99 €', 'Buy now', 'Wishlist it']);
});

/* ------------------------------------------------- lire la page, pas un texte */

test('la fiche du jeu (capture signalee) : "Go to giveaway" est le chemin, "Wishlist it" non', () => {
  const { fgc, sandbox } = gog();
  const lien = ctrl({ tag: 'A', text: 'Go to giveaway', href: '/en/giveaway/claim', main: true, w: 540, h: 66, around: TIMER + ' Now on giveaway' });
  const souhait = ctrl({ text: 'Wishlist it', main: true, w: 200, h: 30 });
  const magasin = ctrl({ tag: 'A', text: 'Store', href: '/en/games', chrome: true, w: 60, h: 20 });
  page(sandbox, { elements: [magasin, souhait, lien] });
  const st = fgc.navClassify({});
  assert.equal(st.state, 'goto');
  assert.equal(st.el, lien);
  assert.ok(st.score >= 12, `score ${st.score}`);
});

test('la page du giveaway (capture signalee) : "Ajouter a la bibliotheque" prend le jeu, la politique de confidentialite non', () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  const ajouter = ctrl({ text: 'Ajouter à la bibliothèque', main: true, w: 300, h: 70, around: 'Il vous reste 69 : 50 : 50' });
  const politique = ctrl({ tag: 'A', text: 'politique de confidentialité', href: '/privacy', main: true, w: 150, h: 18 });
  page(sandbox, { elements: [politique, ajouter] });
  const st = fgc.navClassify({});
  assert.equal(st.state, 'claim');
  assert.equal(st.el, ajouter);
});

test('un libelle jamais vu, dans une autre langue, est compris par son sens', () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  for (const [libelle, attendu] of [
    ['Zur Bibliothek hinzufügen', 'claim'], ['Jetzt sichern', 'claim'], ['Añadir a la biblioteca', 'claim'],
    ['Aggiungi alla libreria', 'claim'], ['Adicionar à biblioteca', 'claim'], ['Claim now', 'claim'], ['Récupérez le jeu', 'claim'],
    ['Grab it', 'claim'],
  ]) {
    const b = ctrl({ text: libelle, main: true, w: 300, h: 60, around: TIMER });
    page(sandbox, { elements: [b] });
    const st = fgc.navClassify({});
    assert.equal(st.state, attendu, `"${libelle}" -> ${st.state}`);
    assert.equal(st.el, b);
  }
  for (const libelle of ['Zum Giveaway', 'Aller au giveaway', 'Ir al sorteo', 'Vai al giveaway']) {
    const l = ctrl({ tag: 'A', text: libelle, href: '/giveaway', main: true, w: 300, h: 60, around: TIMER });
    page(sandbox, { elements: [l] });
    assert.equal(fgc.navClassify({}).state, 'goto', libelle);
  }
});

test('la structure seule suffit quand le giveaway est net (libelle inconnu), la memoire fait le reste', () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  const nouveau = ctrl({ text: 'Hol dir das Spiel', main: true, w: 148, h: 52, around: TIMER });  // 148 x 52 : la taille reelle du bouton GOG
  const autre = ctrl({ text: 'Mehr erfahren', main: false, w: 100, h: 20 });
  page(sandbox, { elements: [autre, nouveau] });
  let st = fgc.navClassify({});
  assert.equal(st.state, 'claim', 'un seul gros bouton, dans la zone du giveaway, pres du compte a rebours');
  assert.equal(st.el, nouveau);
  assert.match(st.why.join(' '), /structure/);

  // Hors du giveaway, ce meme libelle ne dit rien... tant qu'il n'a pas ete appris.
  const ailleurs = loadEngine({ hostname: 'www.gog.com', pathname: '/en/games', setTimeout: rapide });
  const tard = ctrl({ text: 'Hol dir das Spiel', main: true, w: 300, h: 70 });
  page(ailleurs.sandbox, { elements: [tard] });
  assert.equal(ailleurs.fgc.navClassify({}).state, 'unknown');
  ailleurs.fgc.navLearn('GOG', 'claim', tard, true);
  const memoire = ailleurs.fgc.navMemoryRead('GOG');
  assert.equal(ailleurs.fgc.navClassify(memoire).state, 'claim', 'appris : reconnu partout');
  assert.ok(Object.keys(memoire.claim).includes('hol dir das spiel'));
});

test('l\'appris ne passe jamais outre le veto : un libelle retenu qui devient payant reste interdit', () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  const b = ctrl({ text: 'Hol dir das Spiel', main: true, w: 300, h: 70, around: TIMER });
  page(sandbox, { elements: [b] });
  fgc.navLearn('GOG', 'claim', b, true);
  b.textContent = 'Hol dir das Spiel für 9,99 €';
  assert.equal(fgc.navClassify(fgc.navMemoryRead('GOG')).state, 'unknown');
});

test('"deja a vous" ne se lit que sur le controle de CETTE fiche, pas sur une vignette', () => {
  const { fgc, sandbox } = gog('/en/game/hades');
  const vignette = ctrl({ tag: 'A', text: 'In library', href: '/en/game/celeste', list: true, w: 120, h: 24 });
  const carte = ctrl({ tag: 'A', text: 'Celeste In library', href: '/en/game/celeste', main: true });
  const pied = ctrl({ text: 'In library', chrome: true });
  page(sandbox, { elements: [vignette, carte, pied] });
  assert.equal(fgc.navOwnedEvidence(), null);

  const vrai = ctrl({ text: 'In library', main: true, w: 260, h: 56 });
  page(sandbox, { elements: [vignette, vrai] });
  assert.equal(fgc.navOwnedEvidence(), vrai);
});

/* ----------------------------------------------------------- de page en page */

test('de la fiche au giveaway : le lien est SUIVI dans cet onglet et l\'ordre est ecrit pour la page suivante', async () => {
  const { fgc, sandbox } = gog();
  const suivis = [];
  sandbox.location.assign = (u) => suivis.push(u);
  const lien = ctrl({ tag: 'A', text: 'Go to giveaway', href: '/en/giveaway/claim', main: true, w: 540, h: 66, around: TIMER });
  page(sandbox, { elements: [ctrl({ text: 'Wishlist it', main: true }), lien] });

  fgc.navRun('GOG', {});                       // ne revient pas : la page est dechargee
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(suivis, ['https://www.gog.com/en/giveaway/claim']);
  assert.equal(clics(lien), 0, 'un lien vers une autre page se suit, il ne s\'ouvre pas dans un nouvel onglet');
  const ordre = fgc.navOrderPending();
  assert.equal(ordre.platform, 'GOG');
  assert.equal(ordre.hops, 1);
  assert.deepEqual([...ordre.trail], ['Go to giveaway']);
});

test('la page suivante REPREND la reclamation, la mene au bout, et retient le chemin', async () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  sandbox.sessionStorage.setItem('FGC_nav_order', JSON.stringify({
    platform: 'GOG', hops: 1, trail: ['Go to giveaway'], lastGoto: 'Go to giveaway', force: false, deadline: Date.now() + 60000,
  }));
  assert.ok(fgc.navOrderPending(), 'un ordre attend la page suivante');

  const ajouter = ctrl({
    text: 'Ajouter à la bibliothèque', main: true, w: 300, h: 70, around: 'Il vous reste 69 : 50 : 50',
    onClick: (b) => { b.textContent = 'Dans la bibliothèque'; },
  });
  page(sandbox, { elements: [ajouter], titre: 'Bounty Train' });
  const r = await fgc.navRun('GOG', {});
  assert.equal(r.outcome, 'claimed');
  assert.equal(r.title, 'Bounty Train');
  assert.deepEqual([...r.trail], ['Go to giveaway', 'Ajouter à la bibliothèque']);
  assert.equal(clics(ajouter), 1);
  assert.equal(fgc.navOrderPending(), null, 'l\'ordre est consomme');

  const memoire = fgc.navMemoryRead('GOG');
  assert.equal(memoire.claim['ajouter a la bibliotheque'].ok, 1);
  assert.equal(memoire.goto['go to giveaway'].ok, 1, 'le lien suivi a mene a la bonne page');
});

test('une fenetre de confirmation a mi-chemin est traversee, un bandeau de cookies jamais', async () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  let dialogues = [];
  const jaccepte = ctrl({ text: "J'accepte", w: 120, h: 40 });
  const ajouter = ctrl({
    text: 'Add to library', main: true, w: 300, h: 70, around: TIMER,
    onClick: (b) => {
      const boite = { textContent: 'Conditions du giveaway. Voulez-vous continuer ?', offsetWidth: 400, offsetHeight: 200, getClientRects: () => [{}], querySelectorAll: () => [jaccepte] };
      dialogues.push(boite);
      jaccepte.onClickDone = () => {};
    },
  });
  const ctx = page(sandbox, { elements: [ajouter], titre: 'Jeu' });
  Object.defineProperty(ctx, 'dialogs', { get: () => dialogues });
  sandbox.document.querySelectorAll = ((orig) => (sel) => (sel.includes('dialog[open]') ? dialogues : orig(sel)))(sandbox.document.querySelectorAll);
  jaccepte.dispatchEvent = (ev) => {
    jaccepte.recu.push(ev.type);
    if (ev.type === 'click') { dialogues = []; ajouter.textContent = 'In library'; }
    return true;
  };
  const r = await fgc.navRun('GOG', { verifyTimeoutMs: 400 });
  assert.equal(r.outcome, 'claimed');
  assert.equal(clics(jaccepte), 1);

  // Un bandeau de cookies porte "Accepter" : ce n'est pas notre fenetre.
  const cookies = ctrl({ text: 'Accept', w: 120, h: 40 });
  const bandeau = { textContent: 'We use cookies. Privacy settings.', offsetWidth: 600, offsetHeight: 120, getClientRects: () => [{}], querySelectorAll: () => [cookies] };
  const autre = gog('/en/giveaway/claim');
  page(autre.sandbox, { elements: [], dialogs: [bandeau] });
  const st = autre.fgc.navClassify({});
  assert.notEqual(st.state, 'confirm');
  assert.equal(clics(cookies), 0);
});

test('un jeu deja a vous est dit tel quel, sans clic', async () => {
  const { fgc, sandbox } = gog('/en/game/hades');
  const dedans = ctrl({ text: 'In library', main: true, w: 260, h: 56 });
  page(sandbox, { elements: [dedans], titre: 'Hades' });
  const r = await fgc.navRun('GOG', {});
  assert.equal(r.outcome, 'owned');
  assert.equal(clics(dedans), 0);
});

test('un bouton qui disparait sans rien dire n\'est PAS un succes', async () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  let ctx;
  const ajouter = ctrl({ text: 'Add to library', main: true, w: 300, h: 70, around: TIMER, onClick: (b) => ctx.retirer(b) });
  ctx = page(sandbox, { elements: [ajouter], titre: 'Jeu' });
  const r = await fgc.navRun('GOG', { verifyTimeoutMs: 200, stateTimeoutMs: 100 });
  assert.notEqual(r.outcome, 'claimed', 'rien ne prouve la reussite : on ne l\'affirme pas');
});

test('un clic sans effet n\'est pas rejoue : une fois, puis "bloque"', async () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  const ajouter = ctrl({ text: 'Add to library', main: true, w: 300, h: 70, around: TIMER });
  page(sandbox, { elements: [ajouter], titre: 'Jeu' });
  const r = await fgc.navRun('GOG', { verifyTimeoutMs: 100, stateTimeoutMs: 100 });
  assert.equal(r.outcome, 'stuck');
  assert.equal(clics(ajouter), 1);
  assert.equal(fgc.navMemoryRead('GOG').claim['add to library'].ko, 1, 'l\'echec est retenu');
});

test('au plus trois changements de page : pas de ping-pong', async () => {
  const { fgc, sandbox } = gog();
  sandbox.sessionStorage.setItem('FGC_nav_order', JSON.stringify({ platform: 'GOG', hops: 3, trail: ['a', 'b', 'c'], lastGoto: 'c', deadline: Date.now() + 60000 }));
  const lien = ctrl({ tag: 'A', text: 'Go to giveaway', href: '/en/giveaway/claim', main: true, w: 540, h: 66, around: TIMER });
  page(sandbox, { elements: [lien] });
  const r = await fgc.navRun('GOG', {});
  assert.equal(r.outcome, 'stuck');
  assert.equal(clics(lien), 0);
});

test('un defi de securite ou une connexion demandee arretent tout, sans clic', async () => {
  const { fgc, sandbox } = gog('/en/giveaway/claim');
  const ajouter = ctrl({ text: 'Add to library', main: true, w: 300, h: 70, around: TIMER });
  const captcha = { src: 'https://newassets.hcaptcha.com/captcha/v1/x/hcaptcha.html', offsetWidth: 400, offsetHeight: 300, getClientRects: () => [{}], getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) };
  page(sandbox, { elements: [ajouter], iframes: [captcha] });
  const r = await fgc.navRun('GOG', {});
  assert.equal(r.outcome, 'captcha');
  assert.equal(clics(ajouter), 0);

  const dehors = gog('/en/giveaway/claim');
  const connexion = ctrl({ text: 'Sign in', w: 100, h: 30 });
  page(dehors.sandbox, { elements: [connexion, ctrl({ text: 'Add to library', main: true, w: 300, h: 70, around: TIMER })] });
  assert.equal((await dehors.fgc.navRun('GOG', {})).outcome, 'login');
});

/* ------------------------------------- le module GOG, de bout en bout */

test('runGogModule : le jeu pris est inscrit a l\'historique, le jeu deja a vous aussi, avec la bonne raison', async () => {
  const pris = gog('/en/giveaway/claim');
  const ajouter = ctrl({ text: 'Add to library', main: true, w: 300, h: 70, around: TIMER, onClick: (b) => { b.textContent = 'In library'; } });
  page(pris.sandbox, { elements: [ajouter], titre: 'Bounty Train' });
  await pris.fgc.runGogModule();
  const h1 = JSON.parse(pris.gmStore.get('FGC_history_GOG'));
  assert.equal(h1['Bounty Train'].status, 'claimed');
  assert.equal(h1['Bounty Train'].reason, 'CLAIMED');

  const deja = gog('/en/game/hades');
  page(deja.sandbox, { elements: [ctrl({ text: 'In library', main: true, w: 260, h: 56 })], titre: 'Hades' });
  await deja.fgc.runGogModule();
  const h2 = JSON.parse(deja.gmStore.get('FGC_history_GOG'));
  assert.equal(h2.Hades.reason, 'ALREADY_OWNED');
});

/* Mesure du 2026-10-02 sur gog.com : le bouton de la fiche porte trois etats dans
   un seul noeud, dont un seul est affiche. */
test('le texte VISIBLE decide : un etat cache ("Check out now", "Buy as a gift") ne met pas le bouton sous veto', () => {
  const { fgc, sandbox } = gog();
  const reel = ctrl({
    tag: 'A', href: '/#giveaway', main: true, w: 396, h: 48, around: TIMER + ' Now on giveaway',
    text: 'Check out now Go to giveaway Buy as a gift', visible: 'Go to giveaway',
  });
  page(sandbox, { elements: [reel] });
  const st = fgc.navClassify({});
  assert.equal(st.state, 'goto');
  assert.equal(st.el, reel);
  assert.match(st.why.join(' '), /chemin/, 'le #giveaway du lien compte');
});

test('la fiche GOG reelle : le lien /#giveaway est suivi vers la page d\'accueil, dans cet onglet', async () => {
  const { fgc, sandbox } = gog();
  const suivis = [];
  sandbox.location.assign = (u) => suivis.push(u);
  const reel = ctrl({
    tag: 'A', href: '/#giveaway', main: true, w: 396, h: 48, around: TIMER,
    text: 'Check out now Go to giveaway Buy as a gift', visible: 'Go to giveaway',
  });
  page(sandbox, { elements: [reel] });
  fgc.navRun('GOG', {});
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(suivis, ['https://www.gog.com/#giveaway']);
  assert.equal(clics(reel), 0);
});

test('le bandeau reel de l\'accueil GOG : "Add to library" dans .giveaway, compte a rebours a cote', () => {
  const { fgc, sandbox } = gog('/en/');
  const bouton = ctrl({ text: 'Add to library', cls: 'button-primary giveaway__button', main: true, w: 148, h: 52, around: '69 : 37 : 10 left Add to library' });
  const politique = ctrl({ tag: 'A', text: 'Privacy policy', href: '/en/privacy', main: true, w: 84, h: 14 });
  const tuile = ctrl({ tag: 'A', text: 'Release: Hidden Capybaras with Orange in the Whimsical Library', href: '/en/news/release_x', w: 536, h: 264 });
  page(sandbox, { elements: [tuile, politique, bouton] });
  const st = fgc.navClassify({});
  assert.equal(st.state, 'claim');
  assert.equal(st.el, bouton);
});
