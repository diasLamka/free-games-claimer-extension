/* La memoire de « c'est deja a vous » (2.106.0).
 *
 * Un jeu qu'on possede ne se recupere qu'UNE fois. Le registre (watch/library.js)
 * sait ce que le MOTEUR a pris ; il ne sait rien de ce qu'un autre geste a donne :
 * un jeu pris a la main sur GOG, un jeu que la bibliotheque du magasin montre deja,
 * une reponse « c'est deja a moi » cliquee sur le bandeau. Ce module garde ces
 * constats, pour que l'offre qui revient -- sous une autre cle, d'une autre source,
 * apres la purge du catalogue -- ne rouvre pas un onglet.
 *
 * Volontairement a part du registre : ce ne sont PAS des jeux pris par l'extension.
 * Ils ne comptent ni dans le bilan, ni dans le recap de l'annee, ni dans le carnet.
 *
 * Module pur : l'instant est toujours passe en parametre.
 */
import { normaliseTitle } from './offer.js';

/** Dans le stockage. Ecrit par le worker seul. */
export const KEY_DEJA = 'veille:deja';

/** Un constat plus vieux que cela n'est plus relu : un jeu rembourse doit pouvoir revenir. */
export const KEEP_MS = 400 * 24 * 3600 * 1000;
export const MAX_DEJA = 500;

/** D'ou vient le constat. */
export const VIA = Object.freeze({
  ACCOUNT: 'account',
  COLLECTION: 'collection',
  ANSWER: 'answer',
  PAGE: 'page',
});

const VIAS = new Set(Object.values(VIA));

/** La cle d'un constat : le magasin et le titre normalise, comme `ownedKeys`. */
export function dejaKey(store, title) {
  const norm = normaliseTitle(title);
  return store && norm ? `${store}|${norm}` : null;
}

/** Le contenu du stockage, rendu exploitable quoi qu'il contienne. */
export function readDeja(raw, now = null) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, MAX_DEJA * 2)) {
    if (!v || typeof v !== 'object' || !/^[a-z0-9_-]+\|.+/.test(k) || !Number.isFinite(v.ts)) continue;
    if (now !== null && now - v.ts > KEEP_MS) continue;
    out[k] = { ts: v.ts, via: VIAS.has(v.via) ? v.via : VIA.PAGE, title: typeof v.title === 'string' ? v.title.slice(0, 120) : '' };
  }
  return out;
}

/** Les cles connues, pour les fusionner a `ownedKeys`. */
export function dejaKeys(raw, now = null) {
  return new Set(Object.keys(readDeja(raw, now)));
}

/**
 * Ajoute un constat. Rend { deja, added } : `added` vaut false quand on le savait
 * deja (rien a ecrire), et la memoire reste bornee -- les plus anciens sortent.
 */
export function remember(raw, { store, title, via = VIA.PAGE }, now) {
  const deja = readDeja(raw, now);
  const k = dejaKey(store, title);
  if (!k) return { deja, added: false };
  if (deja[k]) return { deja, added: false };
  deja[k] = { ts: now, via: VIAS.has(via) ? via : VIA.PAGE, title: String(title || '').slice(0, 120) };
  const keys = Object.keys(deja);
  if (keys.length > MAX_DEJA) {
    keys.sort((a, b) => deja[a].ts - deja[b].ts);
    for (const old of keys.slice(0, keys.length - MAX_DEJA)) delete deja[old];
  }
  return { deja, added: true };
}

/** La fusion d'une sauvegarde : l'union, ce qui est deja la reste, la memoire reste bornee. */
export function mergeDeja(local, fichier, now) {
  const a = readDeja(local, now);
  const recus = readDeja(fichier, now);
  const ajoutes = Object.keys(recus).filter((k) => !a[k]);
  const out = { ...a };
  for (const k of ajoutes) out[k] = recus[k];
  const keys = Object.keys(out);
  if (keys.length > MAX_DEJA) {
    keys.sort((x, y) => out[x].ts - out[y].ts);
    for (const old of keys.slice(0, keys.length - MAX_DEJA)) delete out[old];
  }
  return { value: out, added: ajoutes.filter((k) => k in out).length };
}
