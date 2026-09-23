/* Le lanceur : un seul bouton sur la page d'un magasin (2.51.0).
 *
 * Deux boites se chevauchaient dans le coin de la page : celle du moteur et
 * celle de la surcouche. Il n'en reste qu'une, et ces tests tiennent ses
 * promesses : rien quand il n'y a rien a dire, rien hors du cadre principal,
 * une racine fermee, et le moteur seul a agir.
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
  voisins = [], reduit = false,
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
    matchMedia: () => ({ matches: reduit }),
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
  const chrome = {
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) { envoyes.push(JSON.parse(JSON.stringify(msg))); if (reponse) cb(JSON.parse(JSON.stringify(reponse))); },
    },
    i18n: { getMessage: (k) => `nav:${k}` },
    storage: {
      local: {
        get: (k, cb) => cb(stored === undefined ? {} : { [k]: stored }),
        set: (o, cb) => { ecrits.push(JSON.parse(JSON.stringify(o))); if (cb) cb(); },
      },
    },
  };
  const ctx = {
    window: win,
    document: doc,
    location: { hostname, pathname },
    chrome,
    setTimeout: (fn, ms) => { minuteries.push({ fn, ms }); return minuteries.length; },
    clearTimeout() {},
  };
  win.top = top ? win : {};
  win.self = win;
  vm.runInNewContext(SRC, ctx);

  const hote = () => doc.body.childNodes.find((n) => n.shadow) || null;
  const parts = () => {
    const [bouton, bulle, panneau] = hote().shadow.childNodes;
    const [, statut, faits, actions] = panneau.childNodes;
    const [pastille, point] = bouton.childNodes.slice(1);
    return { bouton, bulle, panneau, statut, faits, pastille, point, reclamer: actions.childNodes[0], auto: actions.childNodes[1] };
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

test('une fiche Steam dont on ne sait rien ne recoit rien', () => {
  const p = charger({ hostname: 'store.steampowered.com', pathname: '/app/1/', h1: 'Inconnu', reponse: { facts: [], lines: [] } });
  assert.equal(p.hote(), null);
  assert.deepEqual(p.envoyes[0], { type: 'fgc-lookup', title: 'Inconnu', store: 'steam' });
});

test('hors du cadre principal, le lanceur ne s\'installe pas', () => {
  const p = charger({ top: false });
  assert.equal(p.api, undefined);
  assert.equal(p.envoyes.length, 0);
});

test('hors d\'une fiche, la question part sans titre : seuls les libelles reviennent', () => {
  const p = charger({ hostname: 'luna.amazon.com', reponse: { facts: [], lines: [] } });
  assert.deepEqual(p.envoyes[0], { type: 'fgc-lookup', title: '', store: null });
  assert.equal(p.hote(), null, 'sans moteur ni fait, toujours rien');
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
  assert.equal(bulle.style.display, 'block');
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
  assert.equal(p.hote(), null);
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
  assert.equal(p.parts().bulle.style.display, 'block');
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

test('un moteur qui se retire, sans fait a dire, retire le bouton', () => {
  const p = charger({ reponse: null });
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

test('les deux manifestes : le lanceur partout ou le moteur tourne, plus les fiches Steam, jamais dans un cadre', () => {
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse(readFileSync(new URL(f, ROOT), 'utf8'));
    const tous = m.content_scripts.flatMap((c) => c.js);
    assert.ok(!tous.includes('content/overlay.js'), `${f} : la surcouche est fondue dans le lanceur`);
    const lanceur = m.content_scripts.filter((c) => c.js.includes('content/launcher.js'));
    assert.equal(lanceur.length, 1, `${f} : une seule entree`);
    assert.equal(lanceur[0].all_frames, false, `${f} : cadre principal seulement`);

    const moteurs = m.content_scripts.find((c) => c.js.includes('content/free-games-claimer.js'));
    for (const motif of moteurs.matches) assert.ok(lanceur[0].matches.includes(motif), `${f} : ${motif}`);
    assert.ok(lanceur[0].matches.includes('https://store.steampowered.com/app/*'));
  }
});
