/* Recharger l'extension quand son dossier a ete mis a jour (2.53.0).
 *
 * Installee depuis un dossier (« Charger l'extension non empaquetee »), elle ne
 * se met jamais a jour seule : un `git pull` change les fichiers sur le disque,
 * mais Chrome continue de faire tourner l'ancienne version jusqu'a ce qu'on
 * clique sur « Recharger ». tools/maj-auto.ps1 fait le `git pull` ; ce module
 * fait le clic.
 *
 * COMMENT ELLE LE VOIT. Pour une extension chargee depuis un dossier, Chrome
 * sert ses fichiers directement depuis le disque : relire son propre
 * manifest.json rend la version QUI EST SUR LE DISQUE, alors que
 * `runtime.getManifest()` rend celle qui TOURNE. Plus recente sur le disque :
 * on recharge.
 *
 * TROIS GARDE-FOUS.
 *
 *  1. SEULEMENT UNE INSTALLATION DEPUIS UN DOSSIER (`installType` vaut
 *     'development'). Une version du Chrome Web Store se met a jour par le
 *     Store, et ce module ne la touche jamais.
 *
 *  2. JAMAIS EN PLEINE RECLAMATION. Recharger coupe les scripts de contenu de
 *     leur worker : un moteur en train de reclamer continuerait dans la page,
 *     mais ne pourrait plus rien ecrire -- le jeu serait pris, et l'historique
 *     ne le saurait pas. On attend donc qu'aucun cycle ne tourne et qu'aucun
 *     onglet ne dise « en cours » ; l'alarme suivante reessaie.
 *
 *  3. SEULEMENT VERS LE HAUT. Une version plus ANCIENNE sur le disque (une
 *     branche changee a la main, un retour en arriere) ne declenche rien : ce
 *     n'est pas une mise a jour, c'est un choix, et il se fait a la main.
 *
 * Module PUR, sauf `checkDisk` qui recoit tout ce qu'il touche.
 */

export const ALARM_DISK = 'veille-disque';
/** Toutes les cinq minutes : une lecture locale, qui ne sort pas de la machine. */
export const DISK_PERIOD_MIN = 5;
/** Le temps laisse a un onglet pour dire s'il est occupe. */
export const BUSY_TIMEOUT_MS = 2000;

/**
 * Compare deux versions « 2.52.0 ». Rend -1, 0 ou 1 ; null si l'une n'est pas
 * une version (on ne recharge pas sur une valeur qu'on ne comprend pas).
 */
export function compareVersions(a, b) {
  const lire = (v) => (typeof v === 'string' && /^\d+(\.\d+){0,3}$/.test(v) ? v.split('.').map(Number) : null);
  const x = lire(a);
  const y = lire(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** La version ecrite dans le manifest.json du disque, ou null. */
export async function diskVersion({ fetch, url }) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r || !r.ok) return null;
    const m = JSON.parse(await r.text());
    return m && typeof m.version === 'string' ? m.version : null;
  } catch {
    return null;
  }
}

/**
 * Faut-il recharger ? `reason` dit pourquoi, dans les deux cas : c'est ce que
 * le journal ecrit.
 */
export function reloadDecision({ installType, running, onDisk, busy }) {
  if (installType !== 'development') return { reload: false, reason: 'pas une installation depuis un dossier' };
  if (!onDisk) return { reload: false, reason: 'manifeste du disque illisible' };
  const c = compareVersions(onDisk, running);
  if (c === null) return { reload: false, reason: `version incomprise (${onDisk} / ${running})` };
  if (c <= 0) return { reload: false, reason: 'a jour' };
  if (busy) return { reload: false, reason: `version ${onDisk} sur le disque, mais une reclamation est en cours : on attendra` };
  return { reload: true, reason: `version ${onDisk} sur le disque, ${running} chargee : rechargement` };
}

/** Les motifs d'URL ou le lanceur tourne, lus dans le manifeste. */
export function launcherMatches(manifest) {
  const entree = ((manifest && manifest.content_scripts) || [])
    .find((c) => Array.isArray(c.js) && c.js.includes('content/launcher.js'));
  return entree ? entree.matches.slice() : [];
}

/**
 * Un onglet de magasin est-il en pleine reclamation ?
 *
 * Le lanceur connait l'etat du moteur de sa page (voir content/launcher.js,
 * 'fgc-occupe'). Un onglet qui ne repond pas -- page chargee avant
 * l'extension, script orphelin -- n'est pas compte : il ne peut rien ecrire de
 * toute facon.
 */
export async function tabsBusy({ chrome, matches, timeoutMs = BUSY_TIMEOUT_MS }) {
  if (!matches.length) return false;
  let onglets = [];
  try { onglets = await chrome.tabs.query({ url: matches }); } catch { return false; }
  const demandes = onglets.map((o) => Promise.race([
    chrome.tabs.sendMessage(o.id, { type: 'fgc-occupe' }, { frameId: 0 }).catch(() => null),
    new Promise((ok) => { setTimeout(() => ok(null), timeoutMs); }),
  ]));
  const reponses = await Promise.all(demandes);
  return reponses.some((r) => r && r.occupe === true);
}

/**
 * Le tour complet : lire les deux versions, verifier que rien ne travaille,
 * recharger si tout y est. Rend la decision.
 */
export async function checkDisk({ chrome, fetch, cycleBusy = false, record = () => {} }) {
  let installType = null;
  try {
    const moi = chrome.management && chrome.management.getSelf ? await chrome.management.getSelf() : null;
    installType = moi ? moi.installType : null;
  } catch { installType = null; }
  if (installType !== 'development') return { reload: false, reason: 'pas une installation depuis un dossier' };

  const manifest = chrome.runtime.getManifest();
  const onDisk = await diskVersion({ fetch, url: chrome.runtime.getURL('manifest.json') });
  const plusRecente = compareVersions(onDisk, manifest.version) === 1;
  const busy = plusRecente && (cycleBusy || await tabsBusy({ chrome, matches: launcherMatches(manifest) }));

  const d = reloadDecision({ installType, running: manifest.version, onDisk, busy });
  /* La ligne est ecrite AVANT de recharger : le rechargement couperait
     l'ecriture, et le journal ne dirait pas pourquoi l'extension a redemarre. */
  if (plusRecente) await record(d.reload ? 'info' : 'warn', d.reason);
  if (d.reload) chrome.runtime.reload();
  return d;
}

/**
 * Apres un rechargement : la notification « mise a jour ». Seulement quand la
 * version a CHANGE -- un clic sur « Recharger » a version egale ne dit rien.
 */
export function updatedNotice(details, currentVersion) {
  if (!details || details.reason !== 'update') return null;
  if (!details.previousVersion || compareVersions(currentVersion, details.previousVersion) !== 1) return null;
  return { from: details.previousVersion, to: currentVersion };
}
