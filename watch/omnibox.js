/* La barre d'adresse : « fg » puis un titre (2.85.0).
 *
 * « Est-ce que je l'ai deja ? Est-il gratuit quelque part ? » -- la question
 * vient en lisant un article, un message d'ami, un forum, et la reponse etait
 * a trois clics : ouvrir le popup, chercher, ou ouvrir Ma collection. Taper
 * `fg hades` dans la barre d'adresse la donne en tapant.
 *
 * Une suggestion par jeu, qui dit le fait le plus utile, dans cet ordre :
 * gratuit en ce moment (et ou, jusqu'a quand), bientot gratuit (annonce
 * d'Epic), deja recupere par l'extension (quand), deja dans une bibliotheque
 * importee, ou attendu dans les souhaits. Choisir une suggestion ouvre la
 * fiche quand on la connait ; Entree sur le texte seul ouvre le tableau de
 * bord, la recherche remplie.
 *
 * Rien ne sort de la machine : tout est lu dans le stockage de l'extension.
 *
 * Module pur : le worker lui passe ce qu'il a lu, et la maniere de le dire.
 */
import { STATES, displayTitle, isExpired, normaliseTitle, webUrl } from './offer.js';
import { announcedWindows } from './recap.js';
import { steamWishes, wishes } from './wishlist.js';

export const KEYWORD = 'fg';
export const MAX_SUGGESTIONS = 6;

/** Du plus utile au moins utile : c'est l'ordre des suggestions. */
export const KINDS = Object.freeze({ FREE: 'free', SOON: 'soon', CLAIMED: 'claimed', OWNED: 'owned', WISHED: 'wished' });
const RANG = { free: 0, soon: 1, claimed: 2, owned: 3, wished: 4 };

/** La description d'une suggestion est du XML pour Chrome : on echappe tout. */
export function escapeXml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** 0 : titre exact ; 1 : il commence par la recherche ; 2 : il la contient. */
function proximite(cle, q) {
  if (cle === q) return 0;
  return cle.startsWith(q) ? 1 : 2;
}

/**
 * Les faits connus pour chaque titre qui contient la recherche, regroupes par
 * titre normalise. Deux lettres au moins : « a » ramenerait tout.
 */
export function omniFacts(query, {
  catalog = {}, library = {}, collection = {}, wishlist = [], steamWishlist = null, gogWishlist = null,
  sources = {}, watched = null, now,
} = {}) {
  const q = normaliseTitle(query);
  if (q.length < 2) return new Map();
  const jeux = new Map();
  const noter = (titre, fait) => {
    const cle = normaliseTitle(titre);
    if (!cle || !cle.includes(q)) return;
    const j = jeux.get(cle) || { key: cle, title: displayTitle(titre), score: proximite(cle, q), facts: [] };
    j.facts.push(fait);
    jeux.set(cle, j);
  };

  for (const o of Object.values(catalog || {})) {
    if (!o || !o.title || o.state === STATES.EXPIRED || o.state === STATES.RESOLVED || isExpired(o, now)) continue;
    if (typeof o.start === 'number' && o.start > now) continue;
    if (Array.isArray(watched) && !watched.includes(o.store)) continue;
    noter(o.title, { kind: KINDS.FREE, store: o.store, end: typeof o.end === 'number' ? o.end : null, url: webUrl(o.url || o.resolveUrl) });
  }
  for (const w of announcedWindows(sources, now)) {
    if (w && w.title) noter(w.title, { kind: KINDS.SOON, store: w.store || null, start: w.start, url: webUrl(w.url) });
  }
  for (const e of Object.values(library || {})) {
    if (e && e.title) noter(e.title, { kind: KINDS.CLAIMED, store: e.store, ts: e.ts ?? null, url: webUrl(e.url) });
  }
  for (const it of Object.values(collection || {})) {
    if (it && it.title) noter(it.title, { kind: KINDS.OWNED, store: it.store, url: webUrl(it.url) });
  }
  for (const w of [...wishes(wishlist), ...steamWishes(steamWishlist), ...steamWishes(gogWishlist)]) {
    if (w && w.title) noter(w.title, { kind: KINDS.WISHED });
  }
  return jeux;
}

/**
 * Les suggestions, pretes pour `suggest()` : { content, description }.
 *
 * `content` est l'adresse de la fiche quand on la connait -- c'est ce que
 * Chrome rend a `onInputEntered` --, sinon le titre, qui ouvrira la recherche
 * du tableau de bord. Deux suggestions n'ont jamais le meme `content`.
 */
export function omniSuggestions(query, data, { t, storeLabel = (s) => s, dateText = (ms) => String(ms), max = MAX_SUGGESTIONS }) {
  const jeux = [...omniFacts(query, data).values()];
  for (const j of jeux) j.facts.sort((a, b) => RANG[a.kind] - RANG[b.kind]);
  jeux.sort((a, b) => (RANG[a.facts[0].kind] - RANG[b.facts[0].kind]) || (a.score - b.score) || a.title.localeCompare(b.title));

  const out = [];
  const vus = new Set();
  for (const j of jeux) {
    const f = j.facts[0];
    const aVous = j.facts.some((x) => x.kind === KINDS.CLAIMED || x.kind === KINDS.OWNED);
    let phrase;
    if (f.kind === KINDS.FREE) {
      phrase = f.end ? t('omniFree', j.title, storeLabel(f.store), dateText(f.end)) : t('omniFreeNoEnd', j.title, storeLabel(f.store));
      if (aVous) phrase += ` · ${t('omniAlsoYours')}`;
    } else if (f.kind === KINDS.SOON) {
      phrase = t('omniSoon', j.title, storeLabel(f.store || 'epic'), dateText(f.start));
      if (aVous) phrase += ` · ${t('omniAlsoYours')}`;
    } else if (f.kind === KINDS.CLAIMED) {
      phrase = f.ts ? t('omniClaimed', j.title, storeLabel(f.store), dateText(f.ts)) : t('omniClaimedNoDate', j.title, storeLabel(f.store));
    } else if (f.kind === KINDS.OWNED) {
      phrase = t('omniOwned', j.title, storeLabel(f.store));
    } else {
      phrase = t('omniWished', j.title);
    }
    const url = j.facts.map((x) => x.url).find(Boolean) || null;
    const content = url || j.title;
    if (vus.has(content)) continue;
    vus.add(content);
    out.push({ content, description: escapeXml(phrase) });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Ce qu'ouvre Entree : la fiche si le texte en est une (une suggestion
 * choisie), sinon le tableau de bord avec la recherche remplie.
 */
export function omniTarget(text, dashboardUrl) {
  const brut = String(text || '').trim();
  const url = /^https:\/\//i.test(brut) ? webUrl(brut) : null;
  if (url) return url;
  return `${dashboardUrl}${dashboardUrl.includes('?') ? '&' : '?'}q=${encodeURIComponent(brut.slice(0, 100))}`;
}
