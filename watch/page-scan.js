/* Le scanner de page (2.91.0).
 *
 * Un article « les 10 meilleurs jeux de l'annee », un fil Reddit, la
 * description d'une video : des jeux cites, et pour chacun la meme question --
 * est-ce que je l'ai deja ? est-il gratuit en ce moment ? est-ce que je
 * l'attends ? Aucun outil ne repond pour cinq magasins a la fois ; l'extension,
 * si : elle a le registre, la collection, le catalogue et les souhaits.
 *
 * Deux lectures :
 *   - les LIENS vers des fiches de magasin -- surs : l'adresse dit le magasin
 *     et le jeu. Les liens de redirection (YouTube, Reddit, Google) sont
 *     deballes ;
 *   - le TEXTE, pour les titres que l'extension connait deja. Un titre de
 *     plusieurs mots se trouve partout ; un titre d'un seul mot (« Control »,
 *     « Inside ») seulement dans un titre de section, un passage en gras ou un
 *     lien -- sinon chaque page qui parle de controle le citerait.
 *
 * La page est lue une fois, sur un clic, par `scripting.executeScript` et la
 * permission `activeTab` : aucun acces permanent a aucun site. Rien ne quitte
 * la machine.
 *
 * Module pur, sauf `readPage`, qui est injectee telle quelle dans la page.
 */
import { lookup, FACTS } from './lookup.js';
import { cleanTitle } from './owned-guard.js';
import { steamWishes, wishOrigin } from './wishlist.js';

export const MAX_TEXT = 400000;
export const MAX_LINKS = 600;
export const MAX_GAMES = 40;

/**
 * Lue DANS la page, dans le monde isole de l'extension : la page ne la voit
 * pas. Serialisee par executeScript, elle ne doit rien utiliser d'exterieur.
 */
export function readPage() {
  const propre = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= 600) break;
    links.push({ href: String(a.href).slice(0, 800), text: propre(a.textContent, 160) });
  }
  const strong = [];
  for (const n of document.querySelectorAll('h1, h2, h3, h4, strong, b, a')) {
    if (strong.length >= 1500) break;
    const t = propre(n.textContent, 160);
    if (t) strong.push(t);
  }
  return {
    url: location.href,
    title: propre(document.title, 200),
    links,
    strong,
    text: document.body ? String(document.body.innerText || '').slice(0, 400000) : '',
  };
}

/* ------------------------------------------------------------ les liens */

/** Un lien de redirection deballe : l'adresse qu'il cache, sinon lui-meme. */
export function unwrapLink(href) {
  let u;
  try { u = new URL(String(href || '')); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  for (const p of ['q', 'url', 'u', 'target', 'dest']) {
    const v = u.searchParams.get(p);
    if (v && /^https?:\/\//i.test(v)) {
      try { return new URL(v).href; } catch { /* suivant */ }
    }
  }
  return u.href;
}

/** « hollow_knight_silksong », « the-witness » : un titre lisible. */
export function slugTitle(slug) {
  let s = '';
  try { s = decodeURIComponent(String(slug || '')); } catch { s = String(slug || ''); }
  s = s.replace(/[_+-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).slice(0, 140);
}

/** Les fiches de jeu, par magasin : [magasin, motif, groupe de l'identifiant]. */
const FICHES = [
  ['steam', /^https?:\/\/store\.steampowered\.com\/app\/(\d+)(?:\/([^/?#]+))?/i],
  ['epic', /^https?:\/\/store\.epicgames\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?p\/([^/?#]+)/i],
  ['gog', /^https?:\/\/(?:www\.)?gog\.com\/(?:[a-z]{2}\/)?game\/([^/?#]+)/i],
  ['humble', /^https?:\/\/(?:www\.)?humblebundle\.com\/store\/(?!search\b)([^/?#]+)/i],
  ['fanatical', /^https?:\/\/(?:www\.)?fanatical\.com\/[a-z-]+\/(?:game|dlc)\/([^/?#]+)/i],
  ['greenmangaming', /^https?:\/\/(?:www\.)?greenmangaming\.com\/games\/([^/?#]+)/i],
  ['indiegala', /^https?:\/\/(?:www\.)?indiegala\.com\/store\/game\/([^/?#]+)/i],
  ['itchio', /^https?:\/\/[a-z0-9-]+\.itch\.io\/([^/?#]+)/i],
];

/** Un texte de lien qui ne dit pas le nom du jeu. */
const MOTS_VIDES = /^(ici|here|lien|link|clique[rz]?|click|voir|see|page|store|boutique|magasin|steam|epic( games)?( store)?|gog(\.com)?|humble( bundle)?|fanatical|itch\.io|indiegala|green man gaming|buy|acheter|get it|free|gratuit|download|telecharger|t[ée]l[ée]charger|\d+(\s*%|\s*€|\s*\$)?)$/i;

function titreDuLien(text) {
  const t = cleanTitle(text || '');
  if (t.length < 2 || t.length > 90) return '';
  if (/^https?:|www\.|\.com\b/i.test(t) || MOTS_VIDES.test(t) || !/\p{L}/u.test(t)) return '';
  return t;
}

/** Le jeu d'un lien vers une fiche de magasin, ou null. */
export function gameFromLink(href, text = '') {
  const url = unwrapLink(href);
  if (!url) return null;
  for (const [store, re] of FICHES) {
    const m = re.exec(url);
    if (!m) continue;
    const id = m[1];
    // Steam porte le nom dans l'adresse apres le numero ; les autres, c'est l'identifiant.
    const slug = store === 'steam' ? m[2] : m[1];
    const title = titreDuLien(text) || (slug ? slugTitle(slug) : '');
    if (!title) return null;
    return { store, id: String(id).slice(0, 120), title, url: url.split('#')[0].slice(0, 300) };
  }
  return null;
}

/* -------------------------------------------------------------- le texte */

/** Un index des mots de la page : mot -> positions (500 au plus par mot). */
function indexWords(words) {
  const index = new Map();
  words.forEach((w, i) => {
    if (!w) return;
    let l = index.get(w);
    if (!l) index.set(w, (l = []));
    if (l.length < 500) l.push(i);
  });
  return index;
}

function contient(words, index, key) {
  const t = key.split(' ');
  const pos = index.get(t[0]) || [];
  return pos.some((p) => t.every((w, j) => words[p + j] === w));
}

/**
 * Les jeux de la page : ceux des liens d'abord, puis les titres connus que le
 * texte cite. `known` : des titres, tels quels. Un par titre normalise.
 */
export function scanGames(page, { known = [], normalise }) {
  if (typeof normalise !== 'function') throw new TypeError('scanner : la normalisation est obligatoire');
  const out = [];
  const vus = new Set();
  const garder = (g) => {
    const k = normalise(g.title);
    if (!k || vus.has(k) || out.length >= MAX_GAMES) return;
    vus.add(k);
    out.push({ ...g, key: k });
  };

  for (const l of (page && page.links) || []) {
    const g = gameFromLink(l.href, l.text);
    if (g) garder({ ...g, source: 'link' });
  }

  const mots = normalise(String((page && page.text) || '').slice(0, MAX_TEXT)).split(' ');
  const index = indexWords(mots);
  const forts = ((page && page.strong) || []).map((s) => ` ${normalise(s)} `);
  for (const titre of known) {
    const k = normalise(titre);
    if (!k || vus.has(k) || k.length < 4) continue;
    const seul = !k.includes(' ');
    const trouve = seul
      ? k.length >= 5 && forts.some((f) => f.includes(` ${k} `))
      : contient(mots, index, k);
    if (trouve) garder({ title: titre, store: null, id: null, url: null, source: 'text' });
  }
  return out;
}

/* ---------------------------------------------------------- la reponse */

export const STATUS = Object.freeze({ FREE: 'free', WISHED: 'wished', UNKNOWN: 'unknown', OWNED: 'owned' });
const ORDRE = [STATUS.FREE, STATUS.WISHED, STATUS.UNKNOWN, STATUS.OWNED];

/**
 * Ce que l'extension sait de chaque jeu trouve : ses faits (lookup), le
 * souhait, l'offre du catalogue a reclamer, et un etat resume. Du plus utile
 * (gratuit maintenant) au moins utile (deja a vous).
 */
export function classify(games, {
  catalog = {}, library = {}, collection = {}, outcomes = {},
  wishlist = [], steamWishlist = null, gogWishlist = null, normalise, now,
}) {
  const rows = (games || []).map((g) => {
    const facts = lookup({ title: g.title, store: g.store, catalog, library, collection, outcomes, normalise, now });
    const wished = wishOrigin(wishlist, { title: g.title, store: g.store, storeId: g.id }, normalise, steamWishlist, gogWishlist) !== null;
    const libre = Object.entries(catalog || {}).find(([, o]) => o && o.title && normalise(o.title) === g.key
      && !(typeof o.end === 'number' && o.end <= now) && !(typeof o.start === 'number' && o.start > now));
    const owned = facts.some((f) => f.kind === FACTS.OWNED || f.kind === FACTS.CLAIMED);
    const status = owned ? STATUS.OWNED
      : libre ? STATUS.FREE
        : wished ? STATUS.WISHED
          : STATUS.UNKNOWN;
    return {
      ...g,
      facts,
      wished,
      status,
      catalogKey: libre ? libre[0] : null,
      freeStore: libre ? libre[1].store : null,
    };
  });
  return rows.sort((a, b) => ORDRE.indexOf(a.status) - ORDRE.indexOf(b.status));
}

/** Les titres que l'extension connait : registre, catalogue, souhaits, collection. */
export function knownTitles({ library = {}, catalog = {}, collection = {}, wishlist = [], steamWishlist = null, gogWishlist = null }) {
  const out = new Set();
  for (const e of Object.values(library || {})) if (e && e.title) out.add(e.title);
  for (const o of Object.values(catalog || {})) if (o && o.title) out.add(o.title);
  for (const i of Object.values(collection || {})) if (i && i.title) out.add(i.title);
  for (const w of wishlist || []) if (w && (typeof w === 'string' ? w : w.title)) out.add(typeof w === 'string' ? w : w.title);
  for (const l of [steamWishlist, gogWishlist]) {
    for (const it of steamWishes(l)) if (it && it.title) out.add(it.title);
  }
  return [...out];
}
