/* Le registre, d'un ordinateur a l'autre.
 *
 * Sur un nouvel ordinateur, l'extension ne sait rien de ce qu'elle a deja pris
 * ailleurs : elle rouvre un onglet sur chaque offre en cours, et chaque
 * ouverture coute un jeton du plafond horaire. Ma collection le rattrape pour
 * Epic, GOG et Steam -- a condition d'etre importee -- mais pas pour Luna, dont
 * la bibliotheque ne s'importe pas.
 *
 * Ce module recopie donc le REGISTRE (watch/library.js) dans
 * `chrome.storage.sync`, que le navigateur replique sur le compte. Un autre
 * ordinateur connecte au meme compte le fusionne au sien, et son filtre
 * « deja dans la bibliotheque » sait ce que le premier a pris.
 *
 * CE QUI PART, ET CE QUI NE PART PAS. Le magasin, l'identifiant, le titre et la
 * date : ce que le filtre lit, rien de plus. Ni valeur, ni vignette, ni lien --
 * ils se retrouvent dans le catalogue et ne valent pas leur place dans 100 Ko.
 * Et jamais un code : ils ont leur propre sauvegarde (watch/backup.js), avec
 * son propre interrupteur.
 *
 * LES CONTRAINTES DE LA ZONE SYNC sont celles de backup.js : 8 Ko par element,
 * rejet et non troncature au-dela, zone parfois absente, et un compte a
 * traverser -- d'ou un reglage coupe par defaut. Le registre ne tient pas dans
 * un element : il est coupe en tranches, les plus recentes d'abord, parce que
 * ce sont les offres en cours qu'il faut ne pas rouvrir.
 *
 * Les fonctions de decision sont pures ; celles qui touchent au stockage
 * recoivent leur `chrome` en parametre.
 */
import { KEY_LIBRARY, libraryKey, makeEntry, mergeEntry } from './library.js';
import { MAX_ITEM_BYTES, hasSync } from './backup.js';

/** Prefixe des tranches DANS LA ZONE SYNC : `veille:registre:0`, `:1`... */
export const SYNC_PREFIX = 'veille:registre:';

/** La cle qui dit combien de tranches sont valides. */
export const KEY_SYNC_COUNT = `${SYNC_PREFIX}n`;

/**
 * Plafond de tranches. Huit fois 7,8 Ko laissent a la zone de quoi garder les
 * codes et les reglages : le registre ne doit pas les evincer.
 */
export const MAX_CHUNKS = 8;

const chunkKey = (i) => `${SYNC_PREFIX}${i}`;

/* ------------------------------------------------------------- compaction */

/**
 * Le registre reduit a ce que le filtre lit : [magasin, id, titre, date].
 *
 * Une entree sans titre ne sert a rien ailleurs -- `ownedKeys` l'ignore -- et
 * ne part pas. Les plus recentes d'abord.
 */
export function compact(library) {
  return Object.values(library || {})
    .filter((e) => e && e.store && e.id && e.title && Number.isFinite(e.ts))
    .sort((a, b) => b.ts - a.ts)
    .map((e) => [e.store, String(e.id), String(e.title), e.ts]);
}

/** Taille que la zone comptera pour une tranche : la cle plus la valeur. */
function sizeOf(i, tuples) {
  return chunkKey(i).length + JSON.stringify(tuples).length;
}

/**
 * Coupe en tranches qui tiennent chacune dans un element.
 *
 * Rend `dropped` : une sauvegarde partielle qui se croit complete est pire que
 * pas de sauvegarde, et l'interface doit pouvoir le dire.
 */
export function packChunks(tuples, { maxBytes = MAX_ITEM_BYTES, maxChunks = MAX_CHUNKS } = {}) {
  const chunks = [];
  let current = [];
  let i = 0;

  for (const t of tuples) {
    if (sizeOf(i, [...current, t]) <= maxBytes) { current.push(t); continue; }
    if (current.length) { chunks.push(current); i++; }
    if (chunks.length >= maxChunks) break;
    current = sizeOf(i, [t]) <= maxBytes ? [t] : [];
  }
  if (current.length && chunks.length < maxChunks) chunks.push(current);

  const kept = chunks.reduce((n, c) => n + c.length, 0);
  return { chunks, kept, dropped: tuples.length - kept };
}

/** Des tranches relues vers des entrees de registre. */
export function expand(tuples) {
  const out = [];
  for (const t of tuples || []) {
    if (!Array.isArray(t) || t.length < 4) continue;
    const [store, id, title, ts] = t;
    if (!store || !id || !title || !Number.isFinite(ts)) continue;
    out.push(makeEntry({ store: String(store), id: String(id), title: String(title), ts, status: 'claimed' }));
  }
  return out;
}

/**
 * Fusionne des entrees venues d'ailleurs dans le registre local.
 *
 * FUSION, jamais remplacement : `mergeEntry` garde la premiere date et ne vide
 * aucun champ. Rend le nombre d'entrees NOUVELLES -- zero est le cas normal.
 */
export function mergeInto(library, entries) {
  const next = { ...(library || {}) };
  let added = 0;
  let changed = false;
  for (const e of entries) {
    const k = libraryKey(e.store, e.id);
    const before = next[k];
    const merged = mergeEntry(before, e);
    if (!before) added++;
    if (JSON.stringify(merged) !== JSON.stringify(before)) { next[k] = merged; changed = true; }
  }
  return { library: next, added, changed };
}

/* ---------------------------------------------------------------- stockage */

/**
 * Ecrit le miroir. Ne jette jamais : un filet qui casse ne doit pas emporter
 * ce qu'il protege.
 *
 * Le miroir recoit l'UNION de ce qu'il contient deja et du registre local,
 * jamais le registre seul. Un ordinateur qui n'a pas encore fusionne ce qu'un
 * autre a pris -- deux ecritures croisees au demarrage suffisent -- effacerait
 * sinon, en ecrivant son registre, ce que l'autre avait sauvegarde.
 */
export async function mirrorLibrary(chrome, library) {
  if (!hasSync(chrome)) return { ok: false, kept: 0, dropped: 0 };

  const remote = await readLibraryMirror(chrome);
  const { library: union } = mergeInto(library, remote);
  const { chunks, kept, dropped } = packChunks(compact(union));
  const obj = { [KEY_SYNC_COUNT]: chunks.length };
  chunks.forEach((c, i) => { obj[chunkKey(i)] = c; });
  // Les tranches au-dela du compte datent d'un registre plus gros : elles ne
  // doivent pas etre relues comme valides.
  const stale = [];
  for (let i = chunks.length; i < MAX_CHUNKS; i++) stale.push(chunkKey(i));

  try {
    await chrome.storage.sync.set(obj);
    if (stale.length) await chrome.storage.sync.remove(stale);
    return { ok: true, kept, dropped };
  } catch {
    // Quota global, hors ligne, sync desactivee par une politique.
    return { ok: false, kept: 0, dropped };
  }
}

/** Ce que la zone garde, en entrees de registre ; vide si elle ne repond pas. */
export async function readLibraryMirror(chrome) {
  if (!hasSync(chrome)) return [];
  try {
    const keys = [KEY_SYNC_COUNT];
    for (let i = 0; i < MAX_CHUNKS; i++) keys.push(chunkKey(i));
    const raw = await chrome.storage.sync.get(keys);
    const n = Math.min(Number(raw[KEY_SYNC_COUNT]) || 0, MAX_CHUNKS);
    const tuples = [];
    for (let i = 0; i < n; i++) if (Array.isArray(raw[chunkKey(i)])) tuples.push(...raw[chunkKey(i)]);
    return expand(tuples);
  } catch {
    return [];
  }
}

/**
 * Retire le miroir du compte.
 *
 * Couper l'interrupteur veut dire « ne gardez plus mes jeux chez Google », pas
 * seulement « n'y ajoutez plus rien ». Un autre ordinateur ou l'option reste
 * active reecrira le sien a sa prochaine acquisition : c'est son choix a lui.
 */
export async function clearLibraryMirror(chrome) {
  if (!hasSync(chrome)) return false;
  const keys = [KEY_SYNC_COUNT];
  for (let i = 0; i < MAX_CHUNKS; i++) keys.push(chunkKey(i));
  try {
    await chrome.storage.sync.remove(keys);
    return true;
  } catch {
    return false;
  }
}

/** Fusionne le miroir dans le registre local ; n'ecrit que s'il apporte quelque chose. */
export async function restoreLibrary(chrome) {
  const mirror = await readLibraryMirror(chrome);
  if (!mirror.length) return { restored: 0, changed: false };

  const raw = await chrome.storage.local.get(KEY_LIBRARY);
  const { library, added, changed } = mergeInto(raw[KEY_LIBRARY] || {}, mirror);
  if (changed) await chrome.storage.local.set({ [KEY_LIBRARY]: library });
  return { restored: added, changed };
}
