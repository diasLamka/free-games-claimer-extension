/* Le lanceur : un seul bouton sur la page d'un magasin (2.51.0).
 *
 * Deux boites se chevauchaient dans le coin de la page : celle du moteur et
 * celle de la surcouche. Il n'en reste qu'une, et ces tests tiennent ses
 * promesses : toujours la sur un magasin, ailleurs rien quand il n'y a rien a
 * dire (2.67.0), rien hors du cadre principal, une racine fermee, et le
 * moteur seul a agir.
 *
 * content/launcher.js tourne ici pour de vrai, dans un bac a sable, sur un
 * faux document juste assez complet pour lui -- voisins compris : d'autres
 * extensions qui posent leur propre bouton flottant (2.52.0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { LAUNCHER_LABELS, launcherLabels } from '../watch/lookup.js';

const ROOT = new URL('../', import.meta.url);
const SRC = readFileSync(new URL('content/launcher.js', ROOT), 'utf8');
const LOCALES = ['en', 'fr', 'de', 'es'];

/* ------------------------------------------------------------ faux document */

function makeStyle() {
  const s = {};
  Object.defineProperty(s, 'cssText', {
    enumerable: false,
    get: () => '',
    set(v) {
      for (const k of Object.keys(s)) delete s[k];
      for (const d of String(v).split(';')) {
        const i = d.indexOf(':');
        if (i < 0) continue;
        s[d.slice(0, i).trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = d.slice(i + 1).trim();
      }
    },
  });
  return s;
}

function makeDom() {
  const doc = { activeElement: null, listeners: {}, animations: [] };

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.style = makeStyle();
      this.childNodes = [];
      this.parentNode = null;
      this.attrs = {};
      this.listeners = {};
      this.text = '';
      this.rect = null;
      this.fixed = false;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get parentElement() { return this.parentNode; }
    appendChild(c) {
      if (c.parentNode) c.parentNode.removeChild(c);
      this.childNodes.push(c);
      c.parentNode = this;
      return c;
    }
    removeChild(c) {
      const i = this.childNodes.indexOf(c);
      if (i >= 0) this.childNodes.splice(i, 1);
      c.parentNode = null;
      return c;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    set textContent(v) { this.childNodes = []; this.text = String(v); }
    get textContent() { return this.text + this.childNodes.map((c) => c.textContent).join(''); }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener(t, f) {
      const l = this.listeners[t] || [];
      const i = l.indexOf(f);
      if (i >= 0) l.splice(i, 1);
    }
    fire(type, props = {}) {
      for (const f of [...(this.listeners[type] || [])]) f({ type, target: this, button: 0, pointerId: 1, ...props });
    }
    contains(n) {
      for (let x = n; x; x = x.parentNode || x.host) if (x === this) return true;
      return false;
    }
    attachShadow(opts) {
      this.shadowMode = opts && opts.mode;
      this.shadow = new El('#shadow-root');
      this.shadow.host = this;
      return this.shadow;
    }
    getBoundingClientRect() {
      if (this.rect) return this.rect;
      const left = parseFloat(this.style.left) || 0;
      const top = parseFloat(this.style.top) || 0;
      const width = parseFloat(this.style.width) || 0;
      const height = parseFloat(this.style.height) || 0;
      return { left, top, width, height, right: left + width, bottom: top + height };
    }
    focus() { doc.activeElement = this; }
    matches() { return true; }
    setPointerCapture() {}
    animate(images, options) {
      doc.animations.push({ el: this, images, options });
      // La fin est immediate : un fondu qui s'acheve rend la main sans attendre.
      return { cancel() {}, set onfinish(f) { f(); } };
    }
  }

  doc.body = new El('body');
  doc.documentElement = { clientHeight: 800, clientWidth: 1200 };
  doc.readyState = 'complete';
  doc.title = '';
  doc.h1 = null;
  doc.createElement = (t) => new El(t);
  doc.createElementNS = (ns, t) => new El(t);
  doc.querySelector = () => doc.h1;
  doc.addEventListener = (t, f) => { (doc.listeners[t] ||= []).push(f); };
  doc.removeEventListener = (t, f) => {
    const l = doc.listeners[t] || [];
    const i = l.indexOf(f);
    if (i >= 0) l.splice(i, 1);
  };
  doc.fire = (type, props) => { for (const f of [...(doc.listeners[type] || [])]) f({ type, ...props }); };
  return { doc, El };
}

const dans = (z, x, y) => x >= z.left && x <= z.left + z.width && y >= z.top && y <= z.top + z.height;

/**
 * Charge le lanceur sur une fausse page. `reponse` est ce que le worker
 * renverrait a fgc-lookup ; null, il ne repond pas.
 *
 * `voisins` : ce qui occupe l'ecran. `zone` est la ou il se dessine, `boite`
 * sa boite a lui (differente pour un hote de racine d'ombre), `fixe` sa
 * position, `racine` s'il est pose directement dans <body>.
 */
function charger({
  hostname = 'luna.amazon.com', pathname = '/claims/home', h1 = null, reponse = {}, top = true, stored,
  voisins = [], reduit = false, ui, clair = false, differe = false,
} = {}) {
  const { doc, El } = makeDom();
  if (h1) { doc.h1 = new El('h1'); doc.h1.textContent = h1; }
  const envoyes = [];
  const ecrits = [];
  const minuteries = [];
  const ecoutes = {};
  const win = {
    innerHeight: 800,
    innerWidth: 1200,
    addEventListener(t, f) { (ecoutes[t] ||= []).push(f); },
    removeEventListener(t, f) { ecoutes[t] = (ecoutes[t] || []).filter((g) => g !== f); },
    matchMedia: (q) => ({ matches: /color-scheme: light/.test(q) ? clair : reduit }),
    getComputedStyle: (n) => ({ position: n.fixed ? 'fixed' : 'static' }),
  };

  /* Le contenu de la page, qui couvre toute la fenetre. */
  const page = new El('main');
  page.rect = { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 };
  doc.body.appendChild(page);
  const elements = voisins.map((v) => {
    const e = new El('div');
    const z = v.zone;
    const b = v.boite || z;
    e.rect = { left: b.left, top: b.top, width: b.width, height: b.height, right: b.left + b.width, bottom: b.top + b.height };
    e.fixed = v.fixe !== false;
    e.zone = z;
    (v.racine ? doc.body : page).appendChild(e);
    return e;
  });
  doc.elementsFromPoint = (x, y) => {
    const pile = [];
    const h = doc.body.childNodes.find((n) => n.shadow);
    if (h && dans(h.getBoundingClientRect(), x, y)) pile.push(h);
    for (const e of elements) if (e.parentNode && dans(e.zone, x, y)) pile.push(e);
    pile.push(page, doc.body, doc.documentElement);
    return pile;
  };
  const messages = [];
  const changements = [];
  /* Les reponses gardees pour plus tard (`differe`) : un worker lent. */
  const enAttente = [];
  const lieu = { hostname, pathname };
  const chrome = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (f) => messages.push(f) },
      sendMessage(msg, cb) {
        envoyes.push(JSON.parse(JSON.stringify(msg)));
        const r = typeof reponse === 'function' ? reponse(msg) : reponse;
        if (!r || !cb) return;
        const repondre = () => cb(JSON.parse(JSON.stringify(r)));
        if (differe) enAttente.push(repondre); else repondre();
      },
    },
    i18n: { getMessage: (k) => `nav:${k}` },
    storage: {
      local: {
        /* Le theme vit sous sa propre cle (2.70.0) : `ui`, a part de la place. */
        get: (k, cb) => cb(k === 'veille:ui' ? (ui === undefined ? {} : { [k]: ui }) : (stored === undefined ? {} : { [k]: stored })),
        set: (o, cb) => { ecrits.push(JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      },
      onChanged: { addListener: (f) => changements.push(f) },
    },
  };
  const ctx = {
    window: win,
    document: doc,
    location: lieu,
    chrome,
    setTimeout: (fn, ms) => { minuteries.push({ fn, ms }); return minuteries.length; },
    clearTimeout() {},
  };
  win.top = top ? win : {};
  win.self = win;
  vm.runInNewContext(SRC, ctx);

  const hote = () => doc.body.childNodes.find((n) => n.shadow) || null;
  /* Le panneau de la 2.62.0 : un en-tete (icone, nom, tableau de bord,
     fermer), puis trois zones -- la page, le moteur, la liste. */
  const parts = () => {
    const [bouton, bulle, panneau] = hote().shadow.childNodes;
    const [tete, corps] = panneau.childNodes;
    const [page, actions, liste, vide] = corps.childNodes;
    const [, carte, faits] = page.childNodes;
    const [statut, reclamer, auto] = actions.childNodes;
    const [pastille, point] = bouton.childNodes.slice(1);
    const [, , grand, fermer] = tete.childNodes;
    return { bouton, bulle, panneau, page, carte, faits, statut, actions, reclamer, auto, liste, vide, grand, fermer, pastille, point };
  };
  /** Les minuteries en attente d'un delai donne, jouees et oubliees. */
  const jouer = (ms) => {
    for (const m of minuteries.filter((x) => x.ms === ms)) { minuteries.splice(minuteries.indexOf(m), 1); m.fn(); }
  };
  /** Tout ce qui attend au plus `max` ms : la bulle attend la fin de l'arrivee. */
  const jouerJusqua = (max) => {
    for (const m of minuteries.filter((x) => x.ms <= max)) { minuteries.splice(minuteries.indexOf(m), 1); m.fn(); }
  };
  const redimensionner = () => { for (const f of ecoutes.resize || []) f(); };
  const pos = () => ({ left: hote().style.left, top: hote().style.top });
  return {
    doc, win, api: win.FGC_PAGE_UI, envoyes, ecrits, minuteries, hote, parts, elements, jouer, jouerJusqua, redimensionner, pos,
    /** Le popup change un reglage d'affichage. */
    changerUi: (valeur) => { for (const f of changements) f({ 'veille:ui': { newValue: valeur } }, 'local'); },
    /** Change de page sans recharger : le chemin, et le titre rendu (ou pas encore). */
    naviguer(chemin, titre) {
      lieu.pathname = chemin;
      if (titre !== undefined) this.titre(titre);
    },
    titre(t) {
      if (t === null) { doc.h1 = null; return; }
      doc.h1 = new El('h1');
      doc.h1.textContent = t;
    },
    /** Un evenement de la fenetre (popstate). */
    evenement: (type) => { for (const f of [...(ecoutes[type] || [])]) f({ type }); },
    /** Les reponses differees, rendues dans l'ordre. */
    repondre: () => { for (const f of enAttente.splice(0)) f(); },
    /** Ce que le lanceur repond a un message du worker. */
    demander: (msg) => {
      let r;
      for (const f of messages) f(msg, {}, (x) => { r = JSON.parse(JSON.stringify(x)); });
      return r;
    },
  };
}

/* La geometrie par defaut : fenetre 1200 x 800, bouton de 40, marge de 12. */
const ZONE_W = 1200 - 40 - 24;
const ZONE_H = 800 - 40 - 24;
const px = (v) => `${Math.round(v)}px`;
const DEFAUT = { left: 12 + 1 * ZONE_W, top: 12 + 0.7 * ZONE_H };

function moteur(extra = {}) {
  const appels = { claim: 0, set: [] };
  let on = true;
  return {
    appels,
    spec: {
      claim: () => { appels.claim++; },
      auto: { kind: 'epic', get: () => on, set: (v) => { appels.set.push(v); on = v; } },
      ...extra,
    },
  };
}

/* ------------------------------------------------------------ rien a dire */

test('une fiche Steam dont on ne sait rien : le bouton, sans pastille ni bulle (2.67.0)', () => {
  /* Jusqu'a la 2.66.1, elle ne recevait rien : on cherchait le bouton sur
     Steam sans le trouver. */
  const p = charger({ hostname: 'store.steampowered.com', pathname: '/app/1/', h1: 'Inconnu', reponse: { facts: [], lines: [] } });
  assert.deepEqual(p.envoyes[0], { type: 'fgc-lookup', title: 'Inconnu', store: 'steam' });
  p.jouerJusqua(700);
  assert.ok(p.hote(), 'le bouton est la');
  const { pastille, bulle, page } = p.parts();
  assert.equal(pastille.style.display, 'none', 'rien a compter');
  assert.notEqual(bulle.style.display, 'flex', 'rien a annoncer');
  assert.equal(page.style.display, 'none', 'rien a dire de la fiche');
});

test('toutes les pages d\'un magasin ont le bouton : l\'accueil de Steam, ses recherches, Epic, GOG, Luna (2.67.0)', () => {
  for (const [hostname, pathname] of [
    ['store.steampowered.com', '/'], ['store.steampowered.com', '/search/'], ['store.epicgames.com', '/fr/'],
    ['www.gog.com', '/fr/'], ['gog.com', '/en/games'], ['luna.amazon.fr', '/claims/home'], ['gaming.amazon.com', '/home'],
  ]) {
    const p = charger({ hostname, pathname, reponse: { facts: [], lines: [], free: LIBRE } });
    assert.ok(p.hote(), `${hostname}${pathname}`);
    assert.equal(p.envoyes[0].title, '', 'hors d\'une fiche, aucun titre');
  }
});

test('hors d\'un magasin, sans moteur ni fait, toujours rien', () => {
  for (const hostname of ['www.epicgames.com', 'dev.epicgames.com', 'accounts.epicgames.com', 'store.epicgames.com.example.org']) {
    const p = charger({ hostname, pathname: '/site/fr/home', reponse: { facts: [], lines: [], free: LIBRE } });
    assert.equal(p.hote(), null, hostname);
  }
});

test('sur un magasin, un worker muet n\'empeche pas le bouton : les libelles du navigateur', () => {
  const p = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: null });
  assert.ok(p.hote());
  assert.equal(p.parts().bouton.getAttribute('aria-label'), 'nav:launcherButton');
});

test('un panneau sans rien a montrer le dit, au lieu de s\'ouvrir vide', () => {
  const p = charger({
    hostname: 'store.steampowered.com', pathname: '/',
    reponse: { facts: [], lines: [], labels: { nothing: 'Aucun jeu gratuit en ce moment.' }, free: { total: 0, offers: [] } },
  });
  p.parts().bouton.fire('click');
  const { vide, liste, page, actions } = p.parts();
  assert.equal(vide.style.display, 'block');
  assert.equal(vide.textContent, 'Aucun jeu gratuit en ce moment.');
  assert.equal(liste.style.display, 'none');
  assert.equal(page.style.display, 'none');
  assert.equal(actions.style.display, 'none');

  // Des offres en cours : la liste, et plus de phrase vide.
  const q = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: { facts: [], lines: [], free: LIBRE } });
  q.parts().bouton.fire('click');
  assert.equal(q.parts().liste.style.display, 'block');
  assert.equal(q.parts().vide.style.display, 'none');
  assert.equal(q.parts().vide.textContent, '');
});

test('hors du cadre principal, le lanceur ne s\'installe pas', () => {
  const p = charger({ top: false });
  assert.equal(p.api, undefined);
  assert.equal(p.envoyes.length, 0);
});

test('hors d\'une fiche, la question part sans titre : seuls les libelles reviennent', () => {
  const p = charger({ hostname: 'luna.amazon.com', reponse: { facts: [], lines: [] } });
  assert.deepEqual(p.envoyes[0], { type: 'fgc-lookup', title: '', store: null });
  assert.equal(p.parts().pastille.style.display, 'none', 'un magasin : le bouton, mais rien a compter');
});

/* ------------------------------------------------------------ la fiche */

test('une fiche qui a quelque chose a dire : un bouton, une pastille, une bulle breve', () => {
  const p = charger({
    hostname: 'store.steampowered.com', pathname: '/app/1/', h1: 'Tyranny',
    reponse: { facts: [{ kind: 'owned' }, { kind: 'missed' }], lines: ['A vous sur GOG.', 'Deja offert.'], labels: { button: 'Ouvrir' } },
  });
  p.jouerJusqua(700); // la bulle attend que le bouton soit arrive
  const h = p.hote();
  assert.ok(h, 'le bouton existe');
  assert.equal(h.shadowMode, 'closed', 'racine fermee : la page ne lit rien');
  const { bouton, pastille, bulle, faits, reclamer } = p.parts();
  assert.equal(pastille.textContent, '2');
  assert.equal(bulle.style.display, 'flex');
  assert.equal(bulle.textContent, 'A vous sur GOG.');
  assert.equal(bouton.getAttribute('aria-label'), 'Ouvrir', 'les libelles du worker passent en premier');
  assert.equal(faits.childNodes.length, 2);
  assert.equal(reclamer.parentNode.style.display, 'none', 'sans moteur, aucune commande');

  // La seconde lecture (fiche rendue tard) ne rejoue pas la bulle.
  p.parts().bulle.style.display = 'none';
  p.minuteries.find((m) => m.ms === 2500).fn();
  assert.equal(p.parts().bulle.style.display, 'none');
});

test('un nombre de phrases qui ne correspond pas aux faits n\'est pas affiche', () => {
  const p = charger({
    hostname: 'store.steampowered.com', pathname: '/app/1/', h1: 'X',
    reponse: { facts: [{ kind: 'owned' }], lines: ['une', 'deux'] },
  });
  // Le bouton d'un magasin reste ; aucune des deux phrases n'est montree.
  assert.equal(p.parts().pastille.style.display, 'none');
  assert.equal(p.parts().faits.childNodes.length, 0);
});

/* ------------------------------------------------------------ le moteur */

test('le moteur declare ses commandes : le bouton apparait, le panneau les porte', () => {
  const p = charger({ reponse: null });
  const m = moteur();
  p.api.engine(m.spec);
  p.api.status('idle', 'Pret');
  const { bouton, panneau, statut, reclamer, auto, point, bulle } = p.parts();

  assert.equal(bouton.getAttribute('aria-label'), 'nav:launcherButton', 'sans reponse du worker, le navigateur');
  assert.equal(point.style.display, 'none', 'au repos, aucun point');
  assert.equal(bulle.style.display, 'none', 'au repos, aucune bulle');

  bouton.fire('click');
  assert.equal(panneau.style.display, 'block');
  assert.equal(bouton.getAttribute('aria-expanded'), 'true');
  assert.equal(statut.style.display, 'none', '« pret » n\'apprend rien');
  assert.equal(reclamer.textContent, 'nav:claimAll');
  assert.equal(auto.getAttribute('aria-checked'), 'true');
  assert.equal(auto.textContent, 'nav:epicAutoLabel');

  reclamer.fire('click');
  assert.equal(m.appels.claim, 1, 'reclamer passe par le moteur');
  auto.fire('click');
  assert.deepEqual(m.appels.set, [false]);
  assert.equal(auto.getAttribute('aria-checked'), 'false');
});

test('la bascule Luna porte son propre libelle ; sans bascule, pas de ligne', () => {
  const p = charger({ reponse: null });
  p.api.engine({ claim() {}, auto: { kind: 'luna', get: () => false, set() {} } });
  p.parts().bouton.fire('click');
  assert.equal(p.parts().auto.textContent, 'nav:lunaAutoLabel');

  p.api.engine({ claim() {}, auto: null });
  assert.equal(p.parts().auto.style.display, 'none');
});

test('une fin s\'annonce dans la bulle ; un travail en cours, par le point seul', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);

  p.api.status('running', 'Epic : Tyranny...');
  assert.equal(p.parts().point.style.display, 'block');
  assert.equal(p.parts().bulle.style.display, 'none');

  p.api.status('ok', 'Epic : Tyranny recupere');
  p.jouerJusqua(700);
  assert.equal(p.parts().bulle.style.display, 'flex');
  assert.equal(p.parts().bulle.textContent, 'Epic : Tyranny recupere');

  // La bulle s'efface d'elle-meme.
  p.minuteries.filter((m) => m.ms === 6000).pop().fn();
  assert.equal(p.parts().bulle.style.display, 'none');

  // Panneau ouvert : l'etat s'y lit, aucune bulle par-dessus.
  p.parts().bouton.fire('click');
  p.api.status('error', 'Non connecte sur Epic');
  assert.equal(p.parts().bulle.style.display, 'none');
  assert.equal(p.parts().statut.style.display, 'flex');
  assert.equal(p.parts().statut.textContent, 'Non connecte sur Epic');
});

test('un clic hors du panneau le ferme ; un clic dedans, non ; Echap aussi', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);
  const { bouton, panneau } = p.parts();

  bouton.fire('click');
  p.doc.fire('pointerdown', { target: p.hote() });
  assert.equal(panneau.style.display, 'block', 'la cible d\'un clic interne est l\'hote');
  p.doc.fire('pointerdown', { target: p.doc.body });
  assert.equal(panneau.style.display, 'none');

  bouton.fire('click');
  p.doc.fire('keydown', { key: 'Escape' });
  assert.equal(panneau.style.display, 'none');
});

test('glisser pose le bouton n\'importe ou, retient la place, et n\'ouvre pas le panneau', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);
  const { bouton, panneau } = p.parts();
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) }, 'au bord droit, aux deux tiers');

  bouton.fire('pointerdown', { clientX: 1168, clientY: 547 });
  bouton.fire('pointermove', { clientX: 600, clientY: 300 });
  bouton.fire('pointerup', { clientX: 600, clientY: 300 });
  bouton.fire('click');

  const left = DEFAUT.left - 568;
  const top = DEFAUT.top - 247;
  assert.deepEqual(p.pos(), { left: px(left), top: px(top) }, 'au milieu de la page, sur les deux axes');
  assert.equal(panneau.style.display, 'none', 'le clic qui suit un glisser est avale');
  assert.equal(p.ecrits.length, 1);
  assert.deepEqual(Object.keys(p.ecrits[0]), ['veille:lanceur'], 'la seule cle que ce script ecrit');
  assert.deepEqual(p.ecrits[0]['veille:lanceur'], {
    x: Math.round(((left - 12) / ZONE_W) * 1000) / 1000,
    y: Math.round(((top - 12) / ZONE_H) * 1000) / 1000,
  });

  // Un petit tremblement n'est pas un glisser.
  bouton.fire('pointerdown', { clientX: 600, clientY: 300 });
  bouton.fire('pointermove', { clientX: 602, clientY: 301 });
  bouton.fire('pointerup', { clientX: 602, clientY: 301 });
  bouton.fire('click');
  assert.equal(panneau.style.display, 'block');
});

test('glisse hors de la fenetre, il reste dedans', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);
  const { bouton } = p.parts();
  bouton.fire('pointerdown', { clientX: 1168, clientY: 547 });
  bouton.fire('pointermove', { clientX: -500, clientY: 5000 });
  bouton.fire('pointerup', { clientX: -500, clientY: 5000 });
  assert.deepEqual(p.pos(), { left: '12px', top: px(800 - 40 - 12) });
  assert.deepEqual(p.ecrits[0]['veille:lanceur'], { x: 0, y: 1 });
});

test('la place retenue est relue ; l\'ancienne (hauteur seule) aussi ; une valeur absurde, non', () => {
  const bon = charger({ reponse: null, stored: { x: 0, y: 0.25 } });
  bon.api.engine(moteur().spec);
  assert.deepEqual(bon.pos(), { left: '12px', top: px(12 + 0.25 * ZONE_H) });

  const ancienne = charger({ reponse: null, stored: { y: 0.25 } });
  ancienne.api.engine(moteur().spec);
  assert.deepEqual(ancienne.pos(), { left: px(DEFAUT.left), top: px(12 + 0.25 * ZONE_H) }, 'avant la 2.52.0 : bord droit');

  const absurde = charger({ reponse: null, stored: { x: -3, y: 7 } });
  absurde.api.engine(moteur().spec);
  assert.deepEqual(absurde.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) });

  const bord = charger({ reponse: null, stored: { x: 1, y: 1 } });
  bord.api.engine(moteur().spec);
  assert.deepEqual(bord.pos(), { left: px(1200 - 40 - 12), top: px(800 - 40 - 12) }, 'jamais hors de la fenetre');
});

/* ------------------------------------------------------------ les voisins */

/* Un bouton d'une autre extension, a l'endroit exact ou le lanceur se pose. */
const SUR_LA_PLACE = { left: 1140, top: 510, width: 56, height: 56 };

test('un voisin occupe la place : le lanceur se met juste a cote, et y revient quand il part', () => {
  const p = charger({ reponse: null, voisins: [{ zone: SUR_LA_PLACE }] });
  p.api.engine(moteur().spec);
  // Au-dessus il faudrait monter de 64 px, au-dessous 48 suffisent -- marge comprise.
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top + 48) });
  assert.equal(p.ecrits.length, 0, 's\'ecarter n\'est pas choisir : la place voulue ne change pas');

  p.elements[0].remove();
  p.redimensionner();
  p.jouer(250);
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) });
});

test('lache sur un voisin : il se pousse a cote, et c\'est cette place-la qui est retenue', () => {
  const p = charger({ reponse: null, voisins: [{ zone: { left: 570, top: 270, width: 56, height: 56 } }] });
  p.api.engine(moteur().spec);
  const { bouton } = p.parts();
  bouton.fire('pointerdown', { clientX: 1168, clientY: 547 });
  bouton.fire('pointermove', { clientX: 600, clientY: 300 });
  bouton.fire('pointerup', { clientX: 600, clientY: 300 });

  const top = DEFAUT.top - 247 - 64;
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left - 568), top: px(top) }, '64 px plus haut : hors du voisin, avec de l\'air');
  const retenu = p.ecrits[0]['veille:lanceur'];
  assert.ok(Math.abs(retenu.y - (top - 12) / ZONE_H) < 0.002);
});

test('le bouton d\'une extension dans une racine d\'ombre compte, meme sans boite a lui', () => {
  const p = charger({
    reponse: null,
    voisins: [{ zone: SUR_LA_PLACE, boite: { left: 0, top: 0, width: 0, height: 0 }, fixe: false, racine: true }],
  });
  p.api.engine(moteur().spec);
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top + 48) });
});

test('ce qui ne flotte pas ne le pousse pas : le texte de la page, un en-tete pleine largeur', () => {
  const texte = charger({ reponse: null, voisins: [{ zone: SUR_LA_PLACE, fixe: false }] });
  texte.api.engine(moteur().spec);
  assert.deepEqual(texte.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) });

  const bandeau = charger({ reponse: null, voisins: [{ zone: { left: 0, top: 500, width: 1200, height: 90 } }] });
  bandeau.api.engine(moteur().spec);
  assert.deepEqual(bandeau.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) });
});

test('panneau ouvert : il ne bouge pas sous la main, et reprend sa place a la fermeture', () => {
  const p = charger({ reponse: null, voisins: [{ zone: SUR_LA_PLACE }] });
  p.api.engine(moteur().spec);
  const ecarte = { left: px(DEFAUT.left), top: px(DEFAUT.top + 48) };
  assert.deepEqual(p.pos(), ecarte);

  p.parts().bouton.fire('click');
  p.elements[0].remove();
  p.redimensionner();
  p.jouer(250);
  assert.deepEqual(p.pos(), ecarte, 'le voisin est parti, mais le panneau est ouvert');

  p.doc.fire('keydown', { key: 'Escape' });
  p.redimensionner();
  p.jouer(250);
  assert.deepEqual(p.pos(), { left: px(DEFAUT.left), top: px(DEFAUT.top) });
});

/* ------------------------------------------------------------ animations */

test('il arrive en glissant depuis le bord le plus proche, une seule fois', () => {
  const droite = charger({ reponse: null });
  droite.api.engine(moteur().spec);
  droite.api.engine(moteur().spec);
  droite.api.status('running', 'x');
  const arrivees = droite.doc.animations.filter((a) => a.el === droite.parts().bouton);
  assert.equal(arrivees.length, 1);
  assert.match(arrivees[0].images[0].transform, /^translateX\(\d/, 'depuis la droite');
  assert.equal(arrivees[0].images[0].opacity, 0);

  const gauche = charger({ reponse: null, stored: { x: 0, y: 0.5 } });
  gauche.api.engine(moteur().spec);
  const a = gauche.doc.animations.find((x) => x.el === gauche.parts().bouton);
  assert.match(a.images[0].transform, /^translateX\(-/, 'depuis la gauche');
});

test('moins de mouvement demande : un simple fondu', () => {
  const p = charger({ reponse: null, reduit: true });
  p.api.engine(moteur().spec);
  const a = p.doc.animations.find((x) => x.el === p.parts().bouton);
  assert.deepEqual(JSON.parse(JSON.stringify(a.images)), [{ opacity: 0 }, { opacity: 1 }]);
});

test('panneau et bulle s\'ouvrent du cote ou il y a de la place', () => {
  const droite = charger({ reponse: null });
  droite.api.engine(moteur().spec);
  droite.api.status('ok', 'fini');
  droite.jouerJusqua(700);
  assert.equal(droite.parts().bulle.style.right, '50px');
  droite.parts().bouton.fire('click');
  const pd = droite.parts().panneau.style;
  assert.deepEqual([pd.left, pd.right, pd.top, pd.bottom], ['auto', '50px', 'auto', '0'], 'a gauche, vers le haut');

  const gauche = charger({ reponse: null, stored: { x: 0, y: 0.1 } });
  gauche.api.engine(moteur().spec);
  gauche.api.status('ok', 'fini');
  gauche.jouerJusqua(700);
  assert.equal(gauche.parts().bulle.style.left, '50px');
  gauche.parts().bouton.fire('click');
  const pg = gauche.parts().panneau.style;
  assert.deepEqual([pg.left, pg.right, pg.top, pg.bottom], ['50px', 'auto', '0', 'auto'], 'a droite, vers le bas');
});

test('un statut inconnu vaut « au repos »', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);
  p.api.status('<img>', 'x');
  assert.equal(p.parts().point.style.display, 'none');
});

test('hors d\'un magasin, un moteur qui se retire, sans fait a dire, retire le bouton', () => {
  const p = charger({ hostname: 'www.epicgames.com', pathname: '/site/fr/home', reponse: null });
  p.api.engine(moteur().spec);
  assert.ok(p.hote());
  p.api.engine(null);
  assert.equal(p.hote(), null);
});

/* ------------------------------------------------------------ libelles */

test('les libelles du lanceur : memes cles des deux cotes, presentes dans chaque langue', () => {
  const m = /var CLES = \{([\s\S]*?)\};/.exec(SRC);
  assert.ok(m, 'la table CLES du lanceur');
  const cotePage = Object.fromEntries([...m[1].matchAll(/(\w+):\s*'(\w+)'/g)].map((x) => [x[1], x[2]]));
  assert.deepEqual(cotePage, { ...LAUNCHER_LABELS });

  for (const loc of LOCALES) {
    const table = JSON.parse(readFileSync(new URL(`_locales/${loc}/messages.json`, ROOT), 'utf8'));
    for (const cle of Object.values(LAUNCHER_LABELS)) {
      assert.ok(table[cle] && table[cle].message, `${loc} : ${cle}`);
    }
  }

  assert.deepEqual(launcherLabels((k) => `<${k}>`), {
    button: '<launcherButton>', close: '<sentinelClose>', claim: '<claimAll>',
    autoEpic: '<epicAutoLabel>', autoLuna: '<lunaAutoLabel>',
    dashboard: '<dashboardOpen>', thisPage: '<launcherThisPage>', freeNow: '<launcherFreeNow>',
    seeAll: '<launcherSeeAll>', dlc: '<tagDlc>', freeLeft: '<launcherFreeLeft>', freeNoEnd: '<launcherFreeNoEnd>',
    cardLeft: '<launcherCardLeft>', cardNoEnd: '<launcherCardNoEnd>', nothing: '<launcherNothing>',
  });
});

/* ------------------------------------------------------------ ce qui ne revient pas */

test('ni innerHTML ni feuille de style : le lanceur construit par noeuds et par proprietes', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const interdit of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', "createElement('style')",
    'adoptedStyleSheets', "setAttribute('style'"]) {
    assert.ok(!code.includes(interdit), interdit);
  }
});

test('le moteur ne pose plus rien dans la page : il parle au lanceur', () => {
  const ui = readFileSync(new URL('src/core/12-ui.js', ROOT), 'latin1');
  for (const interdit of ['createElement', 'GM_addStyle', 'getElementById', 'appendChild']) {
    assert.ok(!ui.includes(interdit), interdit);
  }
  assert.match(ui, /window\.FGC_PAGE_UI/);
});

test('les deux manifestes : le lanceur partout ou le moteur tourne, plus tout Steam, jamais dans un cadre', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(readFileSync(new URL(f, ROOT), 'utf8'));
    const tous = m.content_scripts.flatMap((c) => c.js);
    assert.ok(!tous.includes('content/overlay.js'), `${f} : la surcouche est fondue dans le lanceur`);
    const lanceur = m.content_scripts.filter((c) => c.js.includes('content/launcher.js'));
    assert.equal(lanceur.length, 1, `${f} : une seule entree`);
    assert.equal(lanceur[0].all_frames, false, `${f} : cadre principal seulement`);

    const moteurs = m.content_scripts.find((c) => c.js.includes('content/free-games-claimer.js'));
    for (const motif of moteurs.matches) assert.ok(lanceur[0].matches.includes(motif), `${f} : ${motif}`);
    assert.ok(lanceur[0].matches.includes('https://store.steampowered.com/*'), `${f} : tout Steam, pas seulement les fiches`);
    assert.ok(!lanceur[0].matches.includes('https://store.steampowered.com/app/*'), `${f} : plus de doublon`);
    // Aucune permission de plus : Steam est deja un hote autorise.
    assert.ok(m.host_permissions.includes('https://store.steampowered.com/*'), f);
  }
});

/* ------------------------------------------------------------ occupe ? (2.53.0) */

test('avant un rechargement, le lanceur dit si son moteur est en pleine reclamation', () => {
  const p = charger({ reponse: null });
  assert.deepEqual(p.demander({ type: 'fgc-occupe' }), { occupe: false });
  p.api.status('running', 'Epic : Tyranny...');
  assert.deepEqual(p.demander({ type: 'fgc-occupe' }), { occupe: true }, 'meme sans bouton : onglet pilote');
  p.api.status('ok', 'fini');
  assert.deepEqual(p.demander({ type: 'fgc-occupe' }), { occupe: false });
  assert.equal(p.demander({ type: 'autre' }), undefined, 'les autres messages ne le regardent pas');
});

/* ------------------------------------------------------------ textes du moteur (2.55.0) */

test('l\'etat du moteur se compose dans la langue du lecteur, avec ses valeurs', () => {
  const p = charger({
    hostname: 'store.epicgames.com', pathname: '/fr/free-games',
    reponse: { facts: [], lines: [], engine: { engEpicClaimed: 'Epic : $1 récupéré', engEpicTally: 'Epic : $1 sur $2 récupéré(s)', '<b>': 'x' } },
  });
  p.api.engine(moteur().spec);
  p.api.status('ok', { key: 'engEpicClaimed', args: ['Tyranny'] });
  p.jouerJusqua(700);
  assert.equal(p.parts().bulle.textContent, 'Epic : Tyranny récupéré');
  p.parts().bouton.fire('click');
  assert.equal(p.parts().statut.textContent, 'Epic : Tyranny récupéré', 'et dans le panneau');

  p.api.status('error', { key: 'engEpicTally', args: ['0', '2'] });
  assert.equal(p.parts().statut.textContent, 'Epic : 0 sur 2 récupéré(s)');
});

test('sans modele du worker, le navigateur ; une phrase d\'avant passe telle quelle', () => {
  const p = charger({ reponse: null });
  p.api.engine(moteur().spec);
  p.parts().bouton.fire('click');
  p.api.status('error', { key: 'engCaptcha', args: [] });
  assert.equal(p.parts().statut.textContent, 'nav:engCaptcha');
  p.api.status('error', [{ key: 'engCaptcha' }, 'suite']);
  assert.equal(p.parts().statut.textContent, 'nav:engCaptcha suite');
  p.api.status('error', 'Ancienne phrase');
  assert.equal(p.parts().statut.textContent, 'Ancienne phrase');
});

/* ------------------------------------------------------------ le panneau redessine (2.62.0) */

const JEU = {
  title: 'Dying Light: The Beast - Discharge Weapon Pack', store: 'steam', storeLabel: 'Steam', end: 1790258400000,
  left: '6 h 04', urgency: 'hot', image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4355480/header.jpg',
  url: 'https://store.steampowered.com/app/4355480/', dlc: true,
};
const LIBRE = {
  total: 5,
  offers: [
    { ...JEU },
    { title: 'Mindcop', store: 'epic', storeLabel: 'Epic Games Store', end: 1790262000000, left: '7 h 09', urgency: 'hot', image: 'https://cdn1.epicgames.com/m.jpg', url: 'https://store.epicgames.com/p/mindcop', dlc: false },
    { title: 'Piege', store: 'gog', storeLabel: 'GOG', end: null, left: 'fin inconnue', urgency: 'unknown', image: 'javascript:alert(1)', url: 'http://www.gog.com/x', dlc: false },
  ],
};
const FICHE_DLC = {
  hostname: 'store.steampowered.com', pathname: '/app/4355480/', h1: JEU.title,
  reponse: {
    facts: [{ kind: 'freeNow', store: 'steam' }, { kind: 'freeNow', store: 'epic' }],
    lines: ['Offert en ce moment sur Steam.', 'Offert en ce moment sur Epic.'],
    labels: { freeLeft: 'Gratuit sur $1 · encore $2', cardLeft: 'Gratuit · encore $1', thisPage: 'Sur cette page', freeNow: 'Gratuit en ce moment', seeAll: 'Tout voir', dlc: 'DLC', dashboard: 'En grand' },
    game: JEU,
    free: LIBRE,
  },
};

test('le jeu de la page en carte : vignette sans referent, magasin, DLC, temps qui reste', () => {
  const p = charger(FICHE_DLC);
  p.parts().bouton.fire('click');
  const { carte, faits, page } = p.parts();
  assert.equal(page.style.display, 'block');
  assert.equal(carte.style.display, 'flex');
  const texte = carte.textContent;
  assert.match(texte, /Dying Light: The Beast - Discharge Weapon Pack/);
  assert.match(texte, /Steam/);
  assert.match(texte, /DLC/);
  assert.match(texte, /Gratuit · encore 6 h 04/, 'la carte montre deja le magasin');
  const img = carte.childNodes[0].childNodes.find((n) => n.tagName === 'IMG');
  assert.equal(img.src, JEU.image);
  assert.equal(img.referrerPolicy, 'no-referrer', 'le CDN n\'apprend pas quelle page on lisait');
  // « offert sur Steam » est deja dans la carte ; « aussi sur Epic », non.
  assert.equal(faits.childNodes.length, 1);
  assert.match(faits.textContent, /Epic/);
});

test('gratuit en ce moment : des liens vers les fiches, sans le jeu de la page ni adresse douteuse', () => {
  const p = charger(FICHE_DLC);
  p.parts().bouton.fire('click');
  const { liste } = p.parts();
  assert.equal(liste.style.display, 'block');
  const [titre, ...reste] = liste.childNodes;
  assert.match(titre.textContent, /Gratuit en ce moment5/);
  const rangees = reste.filter((n) => n.tagName !== 'BUTTON');
  assert.equal(rangees.length, 2, 'le DLC de la page n\'est pas repete');
  assert.equal(rangees[0].tagName, 'A');
  assert.equal(rangees[0].href, 'https://store.epicgames.com/p/mindcop');
  assert.equal(rangees[0].target, '_blank');
  assert.equal(rangees[0].rel, 'noopener noreferrer');
  assert.match(rangees[0].textContent, /Mindcop.*7 h 09/);
  // http et javascript: ne passent pas : ni lien, ni image.
  assert.equal(rangees[1].tagName, 'DIV');
  assert.equal(rangees[1].childNodes[0].childNodes.some((n) => n.tagName === 'IMG'), false);
});

test('« Tout voir » et l\'icone en grand demandent le tableau de bord au worker, puis ferment', () => {
  const p = charger(FICHE_DLC);
  p.parts().bouton.fire('click');
  const tout = p.parts().liste.childNodes.find((n) => n.tagName === 'BUTTON');
  assert.equal(tout.textContent, 'Tout voir');
  tout.fire('click');
  assert.deepEqual(p.envoyes.filter((m) => m.type === 'fgc-open-dashboard'), [{ type: 'fgc-open-dashboard' }]);
  assert.equal(p.parts().panneau.style.display, 'none');
  assert.equal(p.parts().grand.getAttribute('aria-label'), 'En grand');
});

test('la bulle d\'un jeu offert : sa vignette, son titre, le temps qui reste', () => {
  const p = charger(FICHE_DLC);
  p.jouerJusqua(700);
  const { bulle } = p.parts();
  assert.equal(bulle.style.display, 'flex');
  assert.match(bulle.textContent, /^D?Dying Light: The Beast - Discharge Weapon PackGratuit sur Steam · encore 6 h 04$/);
  assert.ok(bulle.childNodes[0].childNodes.some((n) => n.tagName === 'IMG' && n.src === JEU.image));
});

test('ouvrir le panneau relit l\'extension : les comptes a rebours ne vieillissent pas', () => {
  const p = charger(FICHE_DLC);
  const avant = p.envoyes.filter((m) => m.type === 'fgc-lookup').length;
  p.parts().bouton.fire('click');
  assert.equal(p.envoyes.filter((m) => m.type === 'fgc-lookup').length, avant + 1);
});

/* ------------------------------------------------------------ le theme (2.70.0) */

const fondDe = (p) => p.parts().panneau.style.background;

test('le panneau suit le theme choisi dans le popup, sinon celui du systeme', () => {
  const sombre = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: null });
  assert.equal(fondDe(sombre), '#14101F', 'par defaut, systeme sombre : sombre');
  const systemeClair = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: null, clair: true });
  assert.equal(fondDe(systemeClair), '#FBFAFE');
  const choisi = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: null, ui: { theme: 'light' } });
  assert.equal(fondDe(choisi), '#FBFAFE');
  const texte = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: null, ui: JSON.stringify({ theme: 'dark' }), clair: true });
  assert.equal(fondDe(texte), '#14101F', 'le reglage bat le systeme, meme ecrit en texte');
});

test('changer de theme dans le popup redessine le lanceur, ouvert ou non', () => {
  const p = charger({ hostname: 'store.steampowered.com', pathname: '/', reponse: { facts: [], lines: [], free: { total: 0, offers: [] } } });
  p.parts().bouton.fire('click');
  assert.equal(p.parts().panneau.style.display !== 'none', true);
  p.changerUi({ theme: 'light' });
  assert.equal(fondDe(p), '#FBFAFE');
  assert.notEqual(p.parts().panneau.style.display, 'none', 'reste ouvert');
  assert.equal(p.parts().pastille.style.background, '#1B1528', 'la pastille s\'inverse, sinon elle disparait');
  p.changerUi({ theme: 'dark' });
  assert.equal(fondDe(p), '#14101F');
  p.changerUi({ density: 'compact' });
  assert.equal(fondDe(p), '#14101F', 'un autre reglage ne touche a rien');
});

test('les deux palettes ont les memes couleurs, et le clair se lit', () => {
  const bloc = (nom) => {
    const m = new RegExp(`var ${nom} = \\{([\\s\\S]*?)\\n  \\};`).exec(SRC);
    assert.ok(m, nom);
    return Object.fromEntries([...m[1].matchAll(/'?([\w-]+)'?: '([^']+)'/g)].map((x) => [x[1], x[2]]));
  };
  const sombre = bloc('SOMBRE');
  const clair = bloc('CLAIR');
  assert.deepEqual(Object.keys(clair).sort(), Object.keys(sombre).sort());
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  for (const cle of ['texte', 'doux', 'ambre', 'rose', 'jade', 'epic', 'gog', 'steam', 'amazon']) {
    assert.ok(contraste(clair[cle], clair.fond) >= 4.5, `${cle} sur le fond clair : ${contraste(clair[cle], clair.fond).toFixed(2)}`);
  }
  assert.ok(contraste(clair.pastilleTexte, clair.pastilleFond) >= 4.5);
  assert.ok(contraste(clair.boutonTexte, clair.bouton) >= 4.5);
});

/* ------------------------------------------------------------ la navigation sans rechargement (2.70.1) */

/* Le faux worker d'une boutique Epic : Shogun Showdown est offert, le reste
   n'a rien a dire. La reponse depend du titre envoye, comme la vraie. */
const SHOGUN = {
  title: 'Shogun Showdown', store: 'epic', storeLabel: 'Epic Games Store', end: 1790262000000,
  left: '1 j 5 h', urgency: 'calm', image: null, url: 'https://store.epicgames.com/fr/p/shogun-showdown', dlc: false,
};
const EPIC = {
  hostname: 'store.epicgames.com', pathname: '/fr/', h1: 'Accueil',
  reponse: (msg) => (msg.title === 'Shogun Showdown'
    ? { facts: [{ kind: 'freeNow', store: 'epic' }], lines: ['Offert en ce moment sur Epic.'], game: SHOGUN, free: { total: 1, offers: [SHOGUN] } }
    : { facts: [], lines: [], free: { total: 1, offers: [SHOGUN] } }),
};
const lus = (p) => p.envoyes.filter((m) => m.type === 'fgc-lookup').map((m) => m.title);

test('une fiche ouverte sans rechargement a sa pastille et sa bulle, comme chargee directement', () => {
  const p = charger(EPIC);
  p.jouerJusqua(700);
  assert.equal(p.parts().pastille.style.display, 'none', 'l\'accueil : rien a compter');

  p.naviguer('/fr/p/shogun-showdown', 'Shogun Showdown');
  p.jouer(1500); // le guet du chemin
  p.jouerJusqua(700); // la bulle attend la fin de l'arrivee du bouton
  assert.equal(lus(p).at(-1), 'Shogun Showdown');
  const { pastille, bulle } = p.parts();
  assert.equal(pastille.textContent, '1');
  assert.equal(bulle.style.display, 'flex', 'une nouvelle page peut se dire une fois');
  assert.match(bulle.textContent, /Shogun Showdown/);
});

test('le titre arrive apres l\'adresse : la fiche d\'avant n\'est jamais lue pour celle d\'apres', () => {
  const p = charger({ ...EPIC, pathname: '/fr/p/shogun-showdown', h1: 'Shogun Showdown' });
  p.jouerJusqua(700);
  assert.equal(p.parts().pastille.textContent, '1');
  const avant = lus(p).length;

  // L'adresse change, la page affiche encore l'ancien titre.
  p.naviguer('/fr/p/autre-jeu');
  p.evenement('popstate');
  assert.equal(lus(p).length, avant, 'rien n\'est demande avec l\'ancien titre');
  assert.equal(p.parts().pastille.style.display, 'none', 'ce qu\'on savait de l\'ancienne page s\'efface aussitot');
  assert.notEqual(p.parts().bulle.style.display, 'flex');

  p.jouer(400);
  assert.equal(lus(p).length, avant, 'toujours l\'ancien titre : on attend');
  p.titre('Autre Jeu');
  p.jouer(400);
  assert.equal(lus(p).at(-1), 'Autre Jeu');
  assert.equal(p.parts().pastille.style.display, 'none');
});

test('un titre qui ne change pas finit quand meme par etre lu, puis relu', () => {
  const p = charger({ ...EPIC, pathname: '/fr/p/shogun-showdown', h1: 'Shogun Showdown' });
  const avant = lus(p).length;
  p.naviguer('/fr/p/shogun-showdown/achievements');
  p.evenement('popstate');
  for (let i = 0; i < 20 && lus(p).length === avant; i++) p.jouer(400);
  assert.equal(lus(p).length, avant + 1, 'une seule demande, au bout de l\'attente');
  assert.equal(lus(p).at(-1), 'Shogun Showdown', 'la sous-page du meme jeu');
  p.jouer(2500);
  assert.equal(lus(p).length, avant + 2, 'la relecture differee, comme au chargement');
});

test('seul le chemin compte : Epic reecrit la query sans changer de page', () => {
  const p = charger(EPIC);
  const avant = lus(p).length;
  p.jouer(1500);
  p.evenement('popstate');
  p.jouer(1500);
  assert.equal(lus(p).length, avant, 'meme chemin : aucune relecture');
});

test('une reponse partie pour la page d\'avant est ignoree', () => {
  const p = charger({ ...EPIC, pathname: '/fr/p/shogun-showdown', h1: 'Shogun Showdown', differe: true });
  // La reponse pour Shogun Showdown tarde ; on est deja sur l'accueil.
  p.naviguer('/fr/', 'Accueil');
  p.evenement('popstate');
  p.repondre();
  const { pastille, bulle } = p.parts();
  assert.equal(pastille.style.display, 'none', 'Shogun Showdown n\'est pas annonce sur l\'accueil');
  assert.notEqual(bulle.style.display, 'flex');
  assert.equal(lus(p).at(-1), 'Accueil', 'la page courante a sa propre question');
});

test('la relecture du chargement ne part pas pour une page qu\'on a deja quittee', () => {
  const p = charger({ ...EPIC, pathname: '/fr/p/shogun-showdown', h1: 'Shogun Showdown' });
  const relecture = p.minuteries.find((m) => m.ms === 2500);
  p.naviguer('/fr/', 'Accueil');
  p.evenement('popstate');
  const avant = lus(p).length;
  relecture.fn();
  assert.equal(lus(p).length, avant, 'elle appartenait a la page d\'avant');
});
