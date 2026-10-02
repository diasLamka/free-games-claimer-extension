/* La sauvegarde complete, et sa restauration (2.74.0).
 *
 * La sauvegarde de la 2.10 ne ramenait que les codes, les filtres et les
 * reglages : « le reste se reconstruit en un cycle ». C'est vrai du catalogue
 * et de l'etat des sources. Ca ne l'est pas de ce que l'extension a APPRIS
 * avec le temps : quels jeux elle a pris et quand (le registre et les
 * historiques du moteur), ce qui a ete rate (l'Historique, le graphique du
 * Bilan), les listes de souhaits, la collection importee, les libelles
 * appris, les preferences d'affichage.
 *
 * Or une extension chargee depuis un dossier perd tout son stockage des que
 * Chrome la voit sous un autre identifiant : un autre dossier, un autre
 * ordinateur, une reinstallation. C'est a ce moment-la qu'une sauvegarde sert,
 * et c'est ce qu'elle ne savait pas refaire.
 *
 * DEUX REGLES.
 *
 *   La restauration FUSIONNE, elle n'ecrase pas. Ce qui est deja la reste ; le
 *   fichier complete. Restaurer une vieille sauvegarde sur une installation
 *   vivante ne doit rien lui faire perdre.
 *
 *   Le fichier est une entree NON FIABLE. Chaque cle est relue avec la forme
 *   qu'elle doit avoir, et ce qui ne l'a pas est ignore. Un libelle appris
 *   repasse par `learn`, qui refuse ce qui parle d'argent ; la recuperation
 *   Steam ne se rallume jamais depuis un fichier.
 *
 * CE QUI N'Y VA PAS : l'alerte du telephone. Son adresse ntfy, son webhook
 * Discord ou son jeton Telegram suffisent a ecrire a la place de
 * l'utilisateur ; un fichier de sauvegarde se copie, se joint a un message de
 * diagnostic, et n'a pas a les porter. Elle se reconfigure en une minute.
 *
 * Module pur, sauf `restoreBackup`, qui recoit son `chrome`.
 */
import { KEYS, readKeys, write } from './storage.js';
import { KEY_CODES } from './backup.js';
import { KEY_LIBRARY, mergeEntry } from './library.js';
import { KEY_LEDGER, mergeLedger } from './ledger.js';
import { KEY_OUTCOMES, MAX_OUTCOMES } from './outcomes.js';
import { KEY_WISHLIST, KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST, MAX_WISHES } from './wishlist.js';
import { KEY_COLLECTION, sanitiseCollection } from './collection.js';
import { KEY_TAUGHT, SURFACES, learn } from './teaching.js';
import { KEY_ANNOTATIONS, STATUS, readAnnotation } from './annotations.js';
import { KEY_COUNTRY, KEY_LANG, normaliseCountry, normaliseLang } from './locale.js';
import { KEY_TASTE, readTasteState } from './taste.js';

export const BACKUP_FORMAT = 2;

/** Les preferences d'affichage du popup. */
export const KEY_UI = 'veille:ui';

/** Les historiques du moteur, en texte JSON sous leurs cles FGC_*. */
export const HISTORY_KEYS = Object.freeze([
  'FGC_history_Epic Games', 'FGC_history_GOG', 'FGC_history_Amazon Luna',
]);

/** Les interrupteurs du moteur. */
export const ENGINE_SWITCHES = Object.freeze(['FGC_epic_auto_mode', 'FGC_luna_auto_mode', 'FGC_luna_claim_dlc']);

/** Tout ce que la sauvegarde emporte, cle de stockage par cle de stockage. */
export const BACKUP_KEYS = Object.freeze([
  KEY_CODES, ...HISTORY_KEYS, KEY_LIBRARY, KEY_OUTCOMES,
  /* Le carnet (2.105.0) : sa chaine est plus longue que n'importe quel resume. */
  KEY_LEDGER,
  KEY_WISHLIST, KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST, KEY_COLLECTION,
  KEY_TAUGHT, KEY_COUNTRY, KEY_LANG, ...ENGINE_SWITCHES,
  KEY_UI, KEYS.SETTINGS, KEYS.FILTERS,
  /* L'etat de chaque jeu (a essayer, en cours, fini...) : la seule donnee
     ecrite a la main par l'utilisateur. Absente jusqu'a la 2.95.0. */
  KEY_ANNOTATIONS,
  /* Le profil de « Vos gouts » (2.99.0) -- des numeros d'etiquettes et leurs
     poids, jamais un titre : l'appli le lit pour faire la meme chose. Sans le
     cache des jeux, que chaque appareil relit lui-meme. */
  KEY_TASTE,
]);

/** Au-dela, ce n'est pas une sauvegarde de cette extension. */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

const objet = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Une valeur ecrite en texte JSON par le moteur, ou deja un objet. */
function texteJson(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

/** Le bloc `backup` d'un fichier : ce qui a ete lu, cle par cle. */
export function snapshot(raw) {
  const out = {};
  for (const k of BACKUP_KEYS) if (raw && raw[k] !== undefined) out[k] = raw[k];
  if (out[KEY_TASTE] !== undefined) {
    const t = readTasteState(out[KEY_TASTE]);
    if (t.profile) out[KEY_TASTE] = { at: t.at, profile: t.profile, names: t.names, namesAt: t.namesAt, namesLang: t.namesLang };
    else delete out[KEY_TASTE];
  }
  return out;
}

/* ------------------------------------------------------------ les fusions */

/** Les codes : l'union par code, ceux deja la d'abord. */
export function mergeCodes(local, fichier) {
  const avant = Array.isArray(texteJson(local)) ? texteJson(local) : [];
  const recus = Array.isArray(texteJson(fichier)) ? texteJson(fichier) : [];
  const vus = new Set(avant.map((c) => c && c.code));
  const ajoutes = recus.filter((c) => objet(c) && typeof c.code === 'string' && c.code && c.code.length <= 80 && !vus.has(c.code));
  return { value: [...avant, ...ajoutes], added: ajoutes.length };
}

/** Un historique du moteur : chaque entree absente est ajoutee ; une entree deja la reste. */
export function mergeHistory(local, fichier) {
  const avant = objet(texteJson(local)) ? texteJson(local) : {};
  const recus = objet(texteJson(fichier)) ? texteJson(fichier) : {};
  const out = { ...avant };
  let added = 0;
  for (const [k, e] of Object.entries(recus)) {
    if (k in out || !objet(e) || typeof e.status !== 'string' || typeof e.ts !== 'number') continue;
    out[k] = e;
    added++;
  }
  return { value: out, added };
}

/** Le registre : `mergeEntry`, qui garde la premiere date et ne vide jamais un champ. */
export function mergeLibrary(local, fichier) {
  const avant = objet(local) ? local : {};
  const out = { ...avant };
  let added = 0;
  for (const [k, e] of Object.entries(objet(fichier) ? fichier : {})) {
    if (!objet(e) || typeof e.store !== 'string' || typeof e.ts !== 'number') continue;
    if (!(k in out)) added++;
    out[k] = mergeEntry(out[k], e);
  }
  return { value: out, added };
}

/** Les issues : celles deja figees gagnent ; le plafond est garde. */
export function mergeOutcomes(local, fichier) {
  const avant = objet(local) ? local : {};
  const out = { ...avant };
  let added = 0;
  for (const [k, e] of Object.entries(objet(fichier) ? fichier : {})) {
    if (k in out || !objet(e) || typeof e.outcome !== 'string') continue;
    out[k] = e;
    added++;
  }
  const cles = Object.keys(out);
  if (cles.length <= MAX_OUTCOMES) return { value: out, added };
  const gardees = cles.sort((a, b) => (out[b].ts || 0) - (out[a].ts || 0)).slice(0, MAX_OUTCOMES);
  return { value: Object.fromEntries(gardees.map((k) => [k, out[k]])), added };
}

/** La liste saisie : l'union par titre normalise, la locale d'abord. */
export function mergeWishes(local, fichier) {
  const avant = Array.isArray(local) ? local : [];
  const vus = new Set(avant.map((w) => w && w.key));
  const ajoutes = (Array.isArray(fichier) ? fichier : [])
    .filter((w) => objet(w) && typeof w.title === 'string' && typeof w.key === 'string' && w.key && !vus.has(w.key));
  return { value: [...avant, ...ajoutes].slice(0, MAX_WISHES), added: ajoutes.length };
}

/** Les libelles appris : chacun repasse par `learn`, qui refuse ce qui parle d'argent. */
export function mergeTaught(local, fichier, now) {
  let taught = objet(texteJson(local)) ? texteJson(local) : {};
  const recus = objet(texteJson(fichier)) ? texteJson(fichier) : {};
  let added = 0;
  for (const surface of Object.values(SURFACES)) {
    const liste = Array.isArray(recus[surface]) ? recus[surface] : [];
    for (const label of [...liste].reverse()) {
      if ((taught[surface] || []).includes(label)) continue;
      const r = learn(taught, { surface, label, now });
      if (r.learned) { taught = r.taught; added++; }
    }
  }
  return { value: taught, added };
}

/**
 * Les etats des jeux : ceux du fichier s'ajoutent, ceux d'ici gagnent -- un
 * etat pose sur cet ordinateur est plus recent que la sauvegarde. Un etat
 * illisible ne revient pas.
 */
export function mergeAnnotations(local, fichier) {
  const avant = objet(local) ? local : {};
  const out = { ...avant };
  let added = 0;
  for (const k of Object.keys(objet(fichier) ? fichier : {})) {
    if (typeof k !== 'string' || k in avant) continue;
    const a = readAnnotation(fichier, k);
    if (a.status === STATUS.NONE && !a.note) continue;
    out[k] = a;
    added++;
  }
  return { value: out, added };
}

/** Les preferences d'affichage : celles du fichier, et les listes reunies. */
export function mergeUi(local, fichier) {
  const avant = objet(texteJson(local)) ? texteJson(local) : {};
  const recus = objet(texteJson(fichier)) ? texteJson(fichier) : {};
  const out = { ...avant };
  for (const k of ['theme', 'density', 'language', 'sort']) if (typeof recus[k] === 'string') out[k] = recus[k];
  if (typeof recus.hideOwned === 'boolean') out.hideOwned = recus.hideOwned;
  for (const k of ['pinned', 'dismissed']) {
    const a = Array.isArray(avant[k]) ? avant[k] : [];
    const b = Array.isArray(recus[k]) ? recus[k].filter((x) => typeof x === 'string') : [];
    out[k] = [...new Set([...a, ...b])];
  }
  return { value: out, added: 0 };
}

/**
 * Tout le plan de restauration : ce qu'il faut ecrire, et combien de choses
 * chaque cle apporte. Pur : `local` est ce que le stockage contient, `fichier`
 * le bloc `backup` d'une sauvegarde.
 */
export function planRestore(local, fichier, { now, steamAutoClaim = false } = {}) {
  const f = objet(fichier) ? fichier : {};
  const l = objet(local) ? local : {};
  const ecrire = {};
  const compte = {};
  const prendre = (cle, r, commeTexte = false) => {
    ecrire[cle] = commeTexte ? JSON.stringify(r.value) : r.value;
    compte[cle] = r.added;
  };

  if (KEY_CODES in f) prendre(KEY_CODES, mergeCodes(l[KEY_CODES], f[KEY_CODES]), typeof l[KEY_CODES] === 'string' || l[KEY_CODES] === undefined);
  for (const k of HISTORY_KEYS) if (k in f) prendre(k, mergeHistory(l[k], f[k]), true);
  if (KEY_LIBRARY in f) prendre(KEY_LIBRARY, mergeLibrary(l[KEY_LIBRARY], f[KEY_LIBRARY]));
  if (KEY_LEDGER in f) prendre(KEY_LEDGER, mergeLedger(l[KEY_LEDGER], f[KEY_LEDGER]));
  if (KEY_OUTCOMES in f) prendre(KEY_OUTCOMES, mergeOutcomes(l[KEY_OUTCOMES], f[KEY_OUTCOMES]));
  if (KEY_WISHLIST in f) prendre(KEY_WISHLIST, mergeWishes(l[KEY_WISHLIST], f[KEY_WISHLIST]));
  // Comme `teach` l'ecrit : un objet -- sauf si le stockage le tient deja en texte.
  if (KEY_TAUGHT in f) prendre(KEY_TAUGHT, mergeTaught(l[KEY_TAUGHT], f[KEY_TAUGHT], now), typeof l[KEY_TAUGHT] === 'string');
  if (KEY_UI in f) prendre(KEY_UI, mergeUi(l[KEY_UI], f[KEY_UI]));
  if (KEY_ANNOTATIONS in f) prendre(KEY_ANNOTATIONS, mergeAnnotations(l[KEY_ANNOTATIONS], f[KEY_ANNOTATIONS]));

  /* Les photographies -- listes importees, collection -- ne se fusionnent
     pas : ce sont des etats complets. Elles ne reviennent que si rien ne les
     remplace encore ; le prochain « Tout importer » les rafraichira. */
  for (const k of [KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST]) {
    if (k in f && !objet(l[k]) && objet(f[k]) && Array.isArray(f[k].wishes)) { ecrire[k] = f[k]; compte[k] = f[k].wishes.length; }
  }
  /* Le profil de gouts : une photographie aussi. Il ne revient que si cet appareil
     n'en a pas encore, et sans toucher au cache des jeux qu'il a lu. */
  if (KEY_TASTE in f) {
    const recu = readTasteState(f[KEY_TASTE]);
    if (recu.profile && !readTasteState(l[KEY_TASTE]).profile) {
      ecrire[KEY_TASTE] = { ...readTasteState(l[KEY_TASTE]), at: recu.at, profile: recu.profile, names: recu.names, namesAt: recu.namesAt, namesLang: recu.namesLang };
      compte[KEY_TASTE] = Object.keys(recu.profile.tags).length;
    }
  }
  if (KEY_COLLECTION in f && !objet(l[KEY_COLLECTION]) && objet(f[KEY_COLLECTION])) {
    const c = sanitiseCollection(f[KEY_COLLECTION]);
    ecrire[KEY_COLLECTION] = c;
    compte[KEY_COLLECTION] = Object.keys(c.items).length;
  }

  /* Les reglages, comme avant la 2.74.0 -- sauf la recuperation Steam, qui ne
     s'active qu'apres l'avertissement qui cite le contrat. */
  if (objet(f[KEYS.SETTINGS])) ecrire[KEYS.SETTINGS] = { ...f[KEYS.SETTINGS], steamAutoClaim: steamAutoClaim === true };
  if (objet(f[KEYS.FILTERS])) ecrire[KEYS.FILTERS] = f[KEYS.FILTERS];
  if (typeof f[KEY_COUNTRY] === 'string') ecrire[KEY_COUNTRY] = normaliseCountry(f[KEY_COUNTRY]);
  if (typeof f[KEY_LANG] === 'string') ecrire[KEY_LANG] = normaliseLang(f[KEY_LANG], ecrire[KEY_COUNTRY] || l[KEY_COUNTRY]);
  for (const k of ENGINE_SWITCHES) if (typeof f[k] === 'boolean') ecrire[k] = f[k];

  return { write: ecrire, added: compte };
}

/** Le bloc de sauvegarde d'un fichier, quel que soit son format. */
export function backupBlock(data) {
  if (!objet(data)) return null;
  if (objet(data.backup)) return data.backup;
  /* Format 1 (jusqu'a la 2.73.0) : les codes, les filtres, les reglages. */
  if ('exportFormat' in data || 'formatExport' in data) {
    const b = {};
    if (Array.isArray(data.pendingCodes)) b[KEY_CODES] = data.pendingCodes;
    if (objet(data.filters)) b[KEYS.FILTERS] = data.filters;
    if (objet(data.settings)) b[KEYS.SETTINGS] = data.settings;
    return b;
  }
  return null;
}

/**
 * Restaure, dans le service worker : relit le stockage, fusionne, ecrit en
 * une fois. Rend ce qui a ete ajoute, par cle.
 */
export async function restoreBackup(chrome, data, { now = Date.now() } = {}) {
  const bloc = backupBlock(data);
  if (!bloc) return { ok: false, reason: 'not-ours' };
  const local = await readKeys(chrome, BACKUP_KEYS);
  const reglages = objet(local[KEYS.SETTINGS]) ? local[KEYS.SETTINGS] : {};
  const plan = planRestore(local, bloc, { now, steamAutoClaim: reglages.steamAutoClaim === true });
  if (Object.keys(plan.write).length) await write(chrome, plan.write);
  return { ok: true, added: plan.added, keys: Object.keys(plan.write) };
}
