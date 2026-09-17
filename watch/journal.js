/* Ce que la veille a fait pendant que personne ne regardait.
 *
 * Le probleme est entier dans une phrase : `record()` ecrivait dans la console
 * du service worker, et un service worker s'arrete au bout de trente secondes
 * d'inactivite en emportant sa console. Le seul endroit ou l'on pourrait lire
 * ce qui s'est passe a 4 h du matin est donc efface avant qu'on se leve.
 *
 * Ce n'est pas theorique. La 2.13.4 corrigeait une veille qui ne tournait
 * JAMAIS -- `alarms.create` recevait une propriete inconnue, Chrome rejetait
 * l'appel, aucune alarme n'etait posee. Rien nulle part n'en portait la trace :
 * il a fallu charger l'extension dans un Chromium et la regarder vivre. Un
 * anneau persistant aurait montre l'echec des le premier reveil.
 *
 * TROIS REGLES.
 *
 *  1. UN SEUL ECRIVAIN : le service worker. Le popup et la page du journal
 *     LISENT. chrome.storage n'a pas de transaction ; deux contextes qui font
 *     lire-modifier-ecrire sur le meme tableau perdent des entrees, et un
 *     journal qui perd des entrees ne sert a rien.
 *
 *  2. RIEN QUI NE SE SERIALISE. Une Error ne traverse pas `storage.local` : ce
 *     module la reduit en texte avant, plutot que d'ecrire {} sans le dire.
 *
 *  3. BORNE DURE. 500 entrees, imposees a l'ecriture et non au menage. Un
 *     journal qui grossit sans fin finit par remplir le quota, et c'est alors
 *     le CATALOGUE qui ne peut plus s'ecrire -- le journal aurait coute la
 *     veille qu'il servait a surveiller.
 *
 * Les fonctions de lecture et de decision sont pures. Les trois qui touchent
 * au stockage recoivent leur `chrome` en parametre, comme watch/commands.js :
 * un service worker ne se teste pas, un module qui recoit son `chrome` si.
 */

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_JOURNAL = 'veille:journal';

/** Taille de l'anneau, telle que le design la fixe (§9). */
export const MAX_ENTRIES = 500;

export const LEVELS = Object.freeze({
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
});

const KNOWN_LEVELS = Object.freeze(Object.values(LEVELS));

/** Au-dela, un detail est tronque : un journal n'est pas un vidage memoire. */
export const MAX_DETAILS = 400;

/**
 * Reduit un detail en texte lisible et stockable.
 *
 * Une Error passee telle quelle a `storage.local` arrive sous la forme `{}` :
 * ni message, ni pile, et aucune erreur pour le signaler. C'est la forme la
 * plus couteuse d'information perdue -- celle qu'on croit avoir.
 */
export function describe(details) {
  if (details === null || details === undefined || details === '') return null;

  let text;
  if (details instanceof Error) {
    text = details.name && details.message ? `${details.name}: ${details.message}` : String(details);
  } else if (typeof details === 'string') {
    text = details;
  } else if (typeof details === 'number' || typeof details === 'boolean') {
    text = String(details);
  } else {
    try {
      text = JSON.stringify(details);
    } catch {
      // Cycle, getter qui jette, objet hote : le nom du type vaut mieux que rien.
      text = Object.prototype.toString.call(details);
    }
  }

  if (typeof text !== 'string' || !text) return null;
  return text.length > MAX_DETAILS ? `${text.slice(0, MAX_DETAILS - 1)}…` : text;
}

/** Une entree, normalisee. Un niveau inconnu devient `info` plutot que de passer. */
export function makeEntry({ level, message, details = null, ts } = {}) {
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    level: KNOWN_LEVELS.includes(level) ? level : LEVELS.INFO,
    message: String(message === undefined || message === null ? '' : message),
    details: describe(details),
  };
}

/**
 * Ajoute une entree et rend un NOUVEL anneau, le plus recent en tete.
 *
 * Le plus recent en tete parce que c'est l'ordre de lecture : on ouvre un
 * journal pour savoir ce qui vient de se passer, pas ce qui s'est passe il y a
 * trois semaines.
 */
export function append(ring, entry, max = MAX_ENTRIES) {
  const base = Array.isArray(ring) ? ring : [];
  const taille = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_ENTRIES;
  return [entry, ...base].slice(0, taille);
}

/** Ne garde que les entrees exploitables : un anneau relu peut etre n'importe quoi. */
export function sanitise(ring, max = MAX_ENTRIES) {
  if (!Array.isArray(ring)) return [];
  return ring
    .filter((e) => e && typeof e === 'object' && Number.isFinite(e.ts))
    .map((e) => makeEntry(e))
    .slice(0, Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_ENTRIES);
}

/**
 * Filtre pour l'affichage.
 *
 * `level` retient ce niveau ET les plus graves : demander les avertissements
 * sans voir les erreurs qui les suivent donnerait une lecture fausse de la
 * nuit.
 */
const SEVERITY = Object.freeze({ info: 0, warn: 1, error: 2 });

export function filterEntries(ring, { level = null, since = null, query = '' } = {}) {
  const plancher = level && SEVERITY[level] !== undefined ? SEVERITY[level] : null;
  const besoin = String(query || '').trim().toLowerCase();

  return (Array.isArray(ring) ? ring : []).filter((e) => {
    if (!e) return false;
    if (plancher !== null && (SEVERITY[e.level] ?? 0) < plancher) return false;
    if (Number.isFinite(since) && e.ts < since) return false;
    if (besoin) {
      const foin = `${e.message || ''} ${e.details || ''}`.toLowerCase();
      if (!foin.includes(besoin)) return false;
    }
    return true;
  });
}

/** Combien d'entrees par niveau, pour une ligne d'entete qui se lit d'un coup. */
export function countByLevel(ring) {
  const out = { info: 0, warn: 0, error: 0 };
  for (const e of Array.isArray(ring) ? ring : []) {
    if (e && out[e.level] !== undefined) out[e.level]++;
  }
  return out;
}

/**
 * Le journal en texte, du plus ancien au plus recent.
 *
 * L'ordre s'inverse ici, et seulement ici : a l'ecran on veut le dernier
 * evenement en haut, dans un fichier joint a un rapport de bug on veut lire
 * l'enchainement dans le sens ou il s'est produit.
 */
export function toText(ring) {
  return sanitise(ring)
    .slice()
    .reverse()
    .map((e) => {
      const quand = new Date(e.ts).toISOString();
      const niveau = e.level.toUpperCase().padEnd(5, ' ');
      return e.details
        ? `${quand} ${niveau} ${e.message} -- ${e.details}`
        : `${quand} ${niveau} ${e.message}`;
    })
    .join('\n');
}

/** Nom de fichier stable et trie chronologiquement, comme celui de l'export. */
export function journalFileName(now) {
  const d = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `free-games-claimer-journal-${d}.txt`;
}

/* ------------------------------------------------------------- stockage */

/**
 * Ajoute une entree au journal stocke, et rend l'anneau resultant.
 *
 * Lire-modifier-ecrire, donc a n'appeler que depuis l'ecrivain unique -- le
 * service worker -- et en serie. C'est lui qui tient la file : voir
 * `journalQueue` dans background.js.
 */
export async function appendTo(chrome, entry, max = MAX_ENTRIES) {
  const brut = await chrome.storage.local.get(KEY_JOURNAL);
  const suivant = append(sanitise(brut[KEY_JOURNAL], max), entry, max);
  await chrome.storage.local.set({ [KEY_JOURNAL]: suivant });
  return suivant;
}

/** Le journal tel qu'il est stocke, nettoye de ce qui ne se relit pas. */
export async function readJournal(chrome, max = MAX_ENTRIES) {
  const brut = await chrome.storage.local.get(KEY_JOURNAL);
  return sanitise(brut[KEY_JOURNAL], max);
}

/** Efface tout. Passe par l'ecrivain unique, pour la meme raison. */
export async function clearJournal(chrome) {
  await chrome.storage.local.set({ [KEY_JOURNAL]: [] });
}
