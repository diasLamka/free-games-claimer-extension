/* La sauvegarde automatique, chaque semaine (2.77.0).
 *
 * La 2.74.0 a donne une sauvegarde qui ramene tout. Encore faut-il l'avoir
 * faite : une extension chargee depuis un dossier perd tout son stockage le
 * jour ou on la retire de chrome://extensions -- pour la recharger d'un autre
 * dossier, par exemple --, et personne n'exporte « au cas ou » un mardi soir.
 *
 * Une fois par semaine, le service worker depose donc le fichier dans
 * Telechargements/free-games-claimer/, et n'en garde que les quatre derniers :
 * un mois de recul, quelques centaines de Ko.
 *
 * CE QUI EST ECRIT : exactement ce que la restauration relit -- le bloc
 * `backup` de la 2.74.0 --, plus le bilan pour qu'on sache ce que contient le
 * fichier en l'ouvrant. Ni le catalogue ni l'etat des sources, qui ne servent
 * qu'au diagnostic et se reconstruisent en un cycle. Et, comme pour l'export
 * a la main, AUCUN secret : ni le serveur ntfy, ni le webhook Discord, ni le
 * jeton Telegram (BACKUP_KEYS ne les connait pas).
 *
 * LA PERMISSION EST L'INTERRUPTEUR. `downloads` est optionnelle : accordee
 * sur un clic dans Reglages -> Sauvegarde, retiree du meme clic. Sans elle,
 * `chrome.downloads` n'existe pas et rien ne se passe ; il n'y a pas de
 * second reglage qui pourrait dire « actif » quand Chrome dit non.
 *
 * Module pur, sauf `runAutoBackup`, qui recoit tout ce qu'il touche.
 */
import { buildExport, exportFileName } from './tally.js';
import { BACKUP_KEYS, snapshot } from './full-backup.js';
import { HISTORY_KEYS } from './recap.js';
import { KEYS } from './storage.js';
import { KEY_CODES } from './backup.js';
import { KEY_LIBRARY } from './library.js';

/** Ce qui a ete fait : { at, fingerprint, files: [{ id, name, at, bytes }], failedAt, error }. */
export const KEY_AUTO_BACKUP = 'veille:sauvegarde-auto';

/** La permission optionnelle qui tient lieu d'interrupteur. */
export const PERMISSION = 'downloads';

const DAY_MS = 24 * 3600 * 1000;

/** Une fois par semaine. */
export const EVERY_MS = 7 * DAY_MS;

/** Apres un echec, on retente six heures plus tard -- pas a chaque cycle. */
export const RETRY_MS = 6 * 3600 * 1000;

/** Les fichiers gardes : un mois de recul. */
export const KEEP = 4;

/** Le sous-dossier, sous le dossier de telechargement de Chrome. */
export const FOLDER = 'free-games-claimer';

/** Tout ce que l'export lit : le bloc restaurable, et de quoi faire le bilan. */
export const EXPORT_KEYS = Object.freeze([...new Set([
  KEY_CODES, ...Object.values(HISTORY_KEYS), KEYS.OFFERS, KEY_LIBRARY,
  KEYS.SOURCES, KEYS.SETTINGS, KEYS.FILTERS, ...BACKUP_KEYS,
])]);

/** Une valeur du stockage, en texte JSON (moteur) ou deja un objet. */
function lire(raw, key, fallback) {
  const v = raw ? raw[key] : undefined;
  if (v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * L'export complet, tel que le bouton « Exporter » l'ecrit, a partir de ce
 * que le stockage rend pour EXPORT_KEYS. Le popup et le worker passent par
 * ici : un seul format, ou qu'il soit produit.
 */
export function exportFromStorage(raw, { version = null, now }) {
  return buildExport({
    codes: lire(raw, KEY_CODES, []),
    histories: Object.fromEntries(Object.entries(HISTORY_KEYS).map(([l, k]) => [l, lire(raw, k, {})])),
    catalog: lire(raw, KEYS.OFFERS, {}),
    library: lire(raw, KEY_LIBRARY, {}),
    sources: lire(raw, KEYS.SOURCES, {}),
    settings: lire(raw, KEYS.SETTINGS, {}),
    filters: lire(raw, KEYS.FILTERS, {}),
    version,
    backup: snapshot(raw),
    now,
  });
}

/**
 * Le fichier de la semaine : ce que la restauration relit, et le bilan pour
 * l'oeil. `automatic` dit d'ou il vient ; l'import l'ignore.
 */
export function compactExport(full) {
  return {
    exportFormat: full.exportFormat,
    exportedAt: full.exportedAt,
    extensionVersion: full.extensionVersion,
    automatic: true,
    pendingCodes: full.pendingCodes,
    tally: full.tally,
    backup: full.backup,
  };
}

/** Une empreinte courte (FNV-1a, 32 bits) : « a-t-il change ? », rien de plus. */
export function fingerprint(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Faut-il sauvegarder ? Jamais fait, fait il y a une semaine -- et pas juste apres un echec. */
export function autoBackupDue(state, now) {
  if (state && typeof state.failedAt === 'number' && now - state.failedAt < RETRY_MS) return false;
  return !state || typeof state.at !== 'number' || now - state.at >= EVERY_MS;
}

/** Les fichiers a garder, du plus recent au plus ancien, et ceux a effacer. */
export function planPrune(files, keep = KEEP) {
  const liste = (Array.isArray(files) ? files : [])
    .filter((f) => f && Number.isInteger(f.id))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  return { keep: liste.slice(0, keep), remove: liste.slice(keep) };
}

/** Le nom du fichier, dans son sous-dossier. */
export function autoFileName(now) {
  return `${FOLDER}/${exportFileName(now)}`;
}

/** Du texte UTF-8 en adresse `data:` base64 -- un service worker n'a pas de Blob URL. */
export function dataUrl(text, mime = 'application/json') {
  const octets = new TextEncoder().encode(text);
  let binaire = '';
  const PAS = 0x8000;
  for (let i = 0; i < octets.length; i += PAS) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + PAS));
  }
  return `data:${mime};base64,${btoa(binaire)}`;
}

/** Attend qu'un telechargement se termine : 'complete', 'interrupted', ou null au bout du delai. */
async function attendre(chrome, id, { timeoutMs = 30000, pas = 200 } = {}) {
  const fin = Date.now() + timeoutMs;
  for (;;) {
    const [d] = await chrome.downloads.search({ id });
    if (d && (d.state === 'complete' || d.state === 'interrupted')) return d;
    if (Date.now() >= fin) return null;
    await new Promise((r) => setTimeout(r, pas));
  }
}

/**
 * La sauvegarde de la semaine, si elle est due : lit, compare, depose, range.
 *
 * `force` la fait tout de suite (le clic qui l'active veut voir un fichier).
 * Les heures calmes la reportent : la bulle de telechargement de Chrome n'a
 * rien a faire a 3 h du matin. Ne jette jamais.
 */
export async function runAutoBackup({
  chrome, now, version = null, force = false, quietNow = false, record = () => {}, timeoutMs = 30000,
}) {
  if (!chrome.downloads || typeof chrome.downloads.download !== 'function') return { done: false, why: 'off' };
  try {
    if (chrome.permissions && !(await chrome.permissions.contains({ permissions: [PERMISSION] }))) {
      return { done: false, why: 'off' };
    }
  } catch { return { done: false, why: 'off' }; }

  const { [KEY_AUTO_BACKUP]: avant } = await chrome.storage.local.get(KEY_AUTO_BACKUP);
  const etat = avant && typeof avant === 'object' ? avant : {};
  if (!force && quietNow) return { done: false, why: 'quiet' };
  if (!force && !autoBackupDue(avant, now)) return { done: false, why: 'not-due' };

  const fichier = compactExport(exportFromStorage(await chrome.storage.local.get(EXPORT_KEYS), { version, now }));
  const empreinte = fingerprint(JSON.stringify(fichier.backup || {}));
  const { keep: gardes } = planPrune(etat.files);

  /* Rien n'a bouge depuis la derniere : le fichier deja depose vaut encore.
     On note l'heure, pour ne pas relire le stockage a chaque cycle. */
  if (!force && etat.fingerprint === empreinte && gardes.length) {
    const { failedAt, error, ...reste } = etat;
    await chrome.storage.local.set({ [KEY_AUTO_BACKUP]: { ...reste, at: now } });
    return { done: false, why: 'unchanged' };
  }

  const texte = JSON.stringify(fichier, null, 2);
  const nom = autoFileName(now);
  try {
    const id = await chrome.downloads.download({
      url: dataUrl(texte), filename: nom, conflictAction: 'uniquify', saveAs: false,
    });
    const d = await attendre(chrome, id, { timeoutMs });
    if (!d || d.state !== 'complete') {
      throw new Error(d ? `telechargement interrompu (${d.error || '?'})` : 'telechargement sans fin');
    }

    const bytes = Number(d.fileSize) > 0 ? Number(d.fileSize) : texte.length;
    const { keep, remove } = planPrune([{ id, name: d.filename || nom, at: now, bytes }, ...gardes]);
    for (const f of remove) {
      try { await chrome.downloads.removeFile(f.id); } catch { /* deplace ou efface a la main */ }
      try { await chrome.downloads.erase({ id: f.id }); } catch { /* deja sorti de la liste */ }
    }
    await chrome.storage.local.set({ [KEY_AUTO_BACKUP]: { at: now, fingerprint: empreinte, files: keep } });
    record('info', `sauvegarde automatique : ${nom} (${Math.round(bytes / 1024)} Ko)`);
    return { done: true, id, name: nom, bytes, removed: remove.length };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 200);
    await chrome.storage.local.set({ [KEY_AUTO_BACKUP]: { ...etat, failedAt: now, error } });
    record('warn', `sauvegarde automatique impossible : ${error}`);
    return { done: false, why: 'failed', error };
  }
}

/** Ce que Reglages -> Sauvegarde affiche : le dernier fichier, combien sont gardes, ou l'echec. */
export function describeAutoBackup(state) {
  const files = planPrune(state && state.files).keep;
  const last = files[0] || null;
  if (state && typeof state.failedAt === 'number' && (!last || state.failedAt > last.at)) {
    return { kind: 'failed', error: state.error || null, last };
  }
  if (!last) return { kind: 'none', last: null };
  return { kind: 'ok', last, count: files.length };
}
