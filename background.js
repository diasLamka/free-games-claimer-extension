/* Service worker : relais du moteur, et pilotage de la veille de fond.
 *
 * Module ES : le manifest declare "type": "module". Les imports doivent rester
 * STATIQUES et en tete de fichier, et tous les listeners doivent etre
 * enregistres de facon synchrone au niveau racine. Un import() dynamique ou un
 * addListener place apres un await casse la reception des evenements, sans
 * message d'erreur.
 *
 * Six contraintes de MV3 gouvernent ce fichier. Elles ne sont pas des
 * precautions de style : chacune correspond a un mode d'echec verifie dans la
 * source de Chromium ou dans la documentation.
 *
 *  1. Une alarme PONCTUELLE est supprimee par le navigateur au moment ou elle
 *     se declenche. Entre ce moment et le create() suivant, l'extension n'a
 *     plus aucune alarme : une mort du worker dans cette fenetre tuerait la
 *     veille DEFINITIVEMENT. D'ou l'alarme filet periodique, qui ne fait que
 *     verifier que la principale existe.
 *  2. On rearme AVANT de travailler, jamais apres. Une erreur en plein cycle ne
 *     doit pas emporter le planning avec elle.
 *  3. Une mise a jour de l'extension EFFACE toutes les alarmes. Il faut les
 *     recreer dans onInstalled, pour 'install' comme pour 'update'.
 *  4. Le worker s'arrete apres 30 s d'inactivite, et une seule requete ne peut
 *     pas depasser 5 minutes. Un cycle doit tenir dessous, et chaque fetch
 *     porte son propre delai.
 *  5. Les variables globales sont perdues a chaque arret. Tout etat vit dans le
 *     stockage ; les globales ci-dessous ne servent qu'a l'interieur d'un
 *     reveil.
 *  6. Le plancher d'une alarme vaut 30 s en extension empaquetee et 1 s en mode
 *     developpeur. On pose notre propre plancher a 60 s pour ne dependre
 *     d'aucun des deux.
 */
import { runCycle } from './watch/cycle.js';
import { SOURCES, CLAIMABLE_STORES } from './watch/sources/index.js';
import {
  readState, readKeys, readSettings, write, KEYS,
  rememberNotification, readNotification, readNotificationLink,
} from './watch/storage.js';
import { reportVerdict, isPiloted, sweepTabs, tabVanished } from './watch/claim.js';
import {
  claimAllNow, claimOneNow, prioritise, pruneNow, readPlaytime, retryNow,
  sendToBridge, snooze, teach, wish,
} from './watch/commands.js';
import { KEY_LIBRARY, PLATFORM_STORES, addedEntries, integrateHistory } from './watch/library.js';
import {
  KEY_SESSIONS, PROBED_STORES, fromImportStatus, recordSession,
} from './watch/session.js';
import { senderKind, messageAllowed, isOurs, hostMatchers, relayRequest } from './watch/messaging.js';
import { STORE_LABELS, webUrl } from './watch/offer.js';
import { KEY_JOURNAL, makeEntry, appendTo, clearJournal } from './watch/journal.js';
import { KEY_CANARY, acknowledge } from './watch/canary.js';
import { KEY_CODES, mirrorCodes, restoreCodes, hasSync } from './watch/backup.js';
import { mirrorLibrary, restoreLibrary, clearLibraryMirror } from './watch/library-sync.js';
import { KEY_SENTINEL, writeBeat, clearBeat } from './watch/sentinel.js';
import { KEY_COLLECTION, IMPORTABLE_STORES, IMPORT_STATUS, applyImport, markRunning } from './watch/collection.js';
import { importStore, probeSession } from './watch/collection-import.js';
import { KEY_COUNTRY, normaliseCountry } from './watch/locale.js';
import { KEY_INCIDENTS } from './watch/incidents.js';
import { factLines, launcherLabels, lookup } from './watch/lookup.js';
import { KEY_COLLECTION as KEY_COLLECTION_LOOKUP } from './watch/collection.js';
import { KEY_OUTCOMES } from './watch/outcomes.js';
import { normaliseTitle } from './watch/offer.js';
import { KEY_STEAM_WISHLIST, makeSteamWishlist } from './watch/wishlist.js';
import { KEY_PHONE, PRIORITY, phoneTarget, pushToPhone } from './watch/phone.js';
import { intlLocale, t } from './lib/i18n.js';
import { badgeState } from './watch/notify-policy.js';
import { ACTIONS, actionAt, buttonsFor } from './watch/notify-actions.js';
import { inspectHealth as inspectHealthOf } from './watch/health.js';
import { windowsLackLinks } from './watch/sources/epic.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const ALARM_MAIN = 'veille-principale';
const ALARM_NET = 'veille-filet';

/** Notre plancher, independant de celui du navigateur. */
const MIN_DELAY_MS = 60 * 1000;
/** Periode du filet. Largement au-dela du plancher per-extension. */
const NET_PERIOD_MIN = 30;
/** Rearmement provisoire pose avant le travail, au cas ou le cycle meurt. */
const FALLBACK_MS = 15 * 60 * 1000;

/** Garde intra-instance : le code racine et onAlarm peuvent demander un cycle au meme reveil. */
let cycleRunning = null;

/* ------------------------------------------------------------------ journal */

/* Les ecritures du journal sont mises a la queue leu leu.
 *
 * `record()` est appele partout et sans await -- il doit rester synchrone pour
 * l'appelant. Mais deux ecritures lancees en parallele font chacune leur
 * lire-modifier-ecrire sur le meme tableau, et la seconde ecrase la premiere :
 * l'entree perdue serait justement celle qui explique la suivante. La chaine
 * ci-dessous les serialise dans l'instance, et il n'y a jamais qu'une instance
 * de service worker a la fois.
 *
 * Un echec d'ecriture ne remonte pas : le journal sert a diagnostiquer le
 * reste, il n'a pas a faire tomber ce qu'il observe. */
let journalQueue = Promise.resolve();

function record(niveau, message, details) {
  const prefix = '[FGC][veille]';
  if (niveau === 'error') console.error(prefix, message, details ?? '');
  else if (niveau === 'warn') console.warn(prefix, message, details ?? '');
  else console.log(prefix, message, details ?? '');

  // La console d'un service worker meurt avec lui, trente secondes apres le
  // dernier evenement. Ce qui suit est la seule trace qui survit a la nuit.
  const entry = makeEntry({ level: niveau, message, details, ts: Date.now() });
  journalQueue = journalQueue.then(() => appendTo(api, entry)).catch(() => {});
}

/* ------------------------------------------------------------------ alarmes */

function normaliseDeadline(when, now) {
  const floor = now + MIN_DELAY_MS;
  if (typeof when !== 'number' || !Number.isFinite(when)) return floor;
  return Math.max(when, floor);
}

/* AlarmCreateInfo n'accepte que when, delayInMinutes et periodInMinutes. Une
   propriete de plus -- `persistAcrossSessions` figurait ici -- fait JETER
   alarms.create : plus aucune alarme, la veille ne tournait jamais, et meme
   « Verifier maintenant » echouait avant le cycle. Les tests ne le voyaient
   pas, le faux chrome acceptant tout. */
async function armMain(when, now) {
  const deadline = normaliseDeadline(when, now);
  await api.alarms.create(ALARM_MAIN, { when: deadline });
  return deadline;
}

/**
 * Garantit qu'il existe toujours de quoi nous reveiller, et rattrape une
 * echeance manquee.
 *
 * Appelee au niveau racine a chaque demarrage du worker, dans onStartup et
 * dans onInstalled. C'est volontairement redondant : aucun de ces trois points
 * ne couvre tous les cas, et la documentation recommande explicitement de
 * reverifier l'existence des alarmes a chaque demarrage.
 */
async function ensureSchedule(now = Date.now()) {
  // Un crash en pleine reclamation laisse un onglet ouvert : sans ce balayage,
  // ils s'accumuleraient silencieusement.
  try {
    const { closed } = await sweepTabs(api, now);
    if (closed) record('warn', `${closed} onglet(s) de reclamation abandonne(s) referme(s)`);
  } catch (e) { record('warn', 'balayage des onglets impossible', e); }

  /* Le tour d'inspection, ICI et pas dans le cycle.
   *
   * C'est la decision centrale du chien de garde. Quand la veille est morte,
   * le cycle ne tourne pas -- donc un detecteur qui y vivrait ne se
   * declencherait jamais, precisement pour la panne qu'il est cense voir. Un
   * chien de garde qui dort avec le chien qu'il garde ne garde rien.
   *
   * `ensureSchedule` est appelee par l'alarme filet periodique, au demarrage
   * et a l'installation. L'alarme filet existe deja et survit a la mort du
   * service worker : c'est exactement la propriete dont ce detecteur a besoin,
   * et elle etait deja payee.
   */
  try {
    await inspectHealth(now);
  } catch (e) { record('warn', 'tour d\'inspection impossible', e); }

  const net = await api.alarms.get(ALARM_NET);
  if (!net) {
    await api.alarms.create(ALARM_NET, { periodInMinutes: NET_PERIOD_MIN });
  }

  const state = await readState(api);
  const principale = await api.alarms.get(ALARM_MAIN);

  // Echeance passee : on rattrape, une seule fois, sans compter les occasions
  // manquees -- une alarme ne rattrape jamais les periodes sautees non plus.
  if (state.nextCycle !== null && state.nextCycle <= now) {
    return startCycle('rattrapage');
  }

  if (!principale) {
    await armMain(state.nextCycle, now);
    return null;
  }

  // Reprogrammer seulement si l'ecart est reel : rearmer a chaque reveil
  // repousserait l'echeance indefiniment et l'alarme ne se declencherait jamais.
  const aimed = normaliseDeadline(state.nextCycle, now);
  if (Math.abs(principale.scheduledTime - aimed) > MIN_DELAY_MS) {
    await armMain(state.nextCycle, now);
  }
  return null;
}

/* --------------------------------------------------------- notifications */

/**
 * Affiche une notification, avec ses boutons quand la plateforme les accepte.
 *
 * Firefox ignore `buttons` et REJETTE la creation qui en porte. Detecter le
 * navigateur serait fragile ; on essaie, et on recommence sans. Une extension
 * qui n'afficherait plus aucune notification sur Firefox serait un prix absurde
 * pour deux boutons sur Chrome.
 *
 * Ce qu'il faut pour agir est retenu AVANT l'affichage : le clic peut arriver
 * des heures plus tard, sur un service worker qui a tout oublie.
 */
async function showNotice({ id, title, message, url = null, kind = null, catalogKey = null }) {
  try {
    await rememberNotification(api, id, { url, catalogKey, kind });

    const base = { type: 'basic', iconUrl: 'icons/icon128.png', title, message };
    const boutons = buttonsFor(kind).map((b) => ({ title: t(b.label) }));

    if (!boutons.length) {
      await api.notifications.create(id, base);
      return;
    }

    try {
      await api.notifications.create(id, { ...base, buttons: boutons });
    } catch (e) {
      record('info', 'boutons de notification refuses, repli sans boutons', e);
      await api.notifications.create(id, base);
    }
  } catch (e) {
    record('warn', 'notification impossible', e);
  }
}

/**
 * Ce qu'un bouton de notification declenche.
 *
 * `onButtonClicked` ne rend qu'un NUMERO : c'est la table de
 * watch/notify-actions.js qui dit ce que cette position signifie POUR CE
 * GENRE de notification. Sans elle, le second bouton d'un rappel declencherait
 * l'action du second bouton d'une annonce.
 *
 * Un index inconnu ne declenche rien : agir dans le doute sur un vrai compte
 * est exactement ce qu'on evite partout ailleurs.
 */
async function runNoticeAction(id, index) {
  const retenu = await readNotification(api, id);
  if (!retenu) return;

  const action = actionAt(retenu.kind, index);
  if (!action) return;

  if (action === ACTIONS.JOURNAL) {
    await api.tabs.create({ url: api.runtime.getURL('pages/journal.html'), active: true });
    return;
  }
  if (!retenu.catalogKey) return;

  if (action === ACTIONS.CLAIM) {
    const r = await claimOneNow({
      chrome: api,
      catalogKey: retenu.catalogKey,
      claimableStores: CLAIMABLE_STORES,
      record,
    });
    record('info', `reclamation depuis une notification : ${r.claimed} prise(s)`);
    return;
  }
  if (action === ACTIONS.SNOOZE) {
    await snooze({ chrome: api, catalogKey: retenu.catalogKey });
  }
}

/* ------------------------------------------------------- tour d'inspection */

/**
 * Ce que le systeme repond quand on lui demande s'il nous laisse parler.
 *
 * Firefox n'implemente pas `getPermissionLevel`. Son absence n'est pas un
 * refus : conclure « coupe » sur une API manquante ferait afficher un
 * avertissement permanent et faux a tous les utilisateurs Firefox.
 */
async function notificationLevel() {
  try {
    if (!api.notifications || typeof api.notifications.getPermissionLevel !== 'function') return 'granted';
    return await new Promise((resolve) => {
      api.notifications.getPermissionLevel((level) => resolve(level || 'granted'));
    });
  } catch { return 'granted'; }
}

/**
 * Le tour d'inspection, delegue au module qui le tient.
 *
 * La logique vit dans watch/health.js, testable de bout en bout : ce qu'elle
 * observe est justement l'ABSENCE de cycle, donc elle ne peut pas etre testee
 * a travers un cycle. Ici ne reste que le branchement des quatre choses qui
 * touchent la plateforme.
 */
async function inspectHealth(now) {
  return inspectHealthOf({
    chrome: api,
    now,
    permissionLevel: await notificationLevel(),
    notify: async ({ id, title, message }) => {
      await api.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title,
        message,
      });
    },
    setBadge: async ({ text, color }) => {
      await api.action.setBadgeText({ text });
      await api.action.setBadgeBackgroundColor({ color });
    },
    record,
    // Pour le telephone seulement (2.47.0) : rien d'autre ne part d'ici.
    fetch: (u, i) => fetch(u, i),
  });
}

/* -------------------------------------------------------------------- cycle */

/**
 * Maintient le worker en vie pendant le cycle.
 *
 * Un await long sans aucun appel d'API extension n'est pas suivi par le
 * systeme d'evenements : le worker peut s'arreter au milieu. Un appel trivial
 * toutes les vingt secondes remet le compteur a zero.
 */
function startKeepalive() {
  const id = setInterval(() => {
    api.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
  return () => clearInterval(id);
}

async function startCycle(origine, options = {}) {
  if (cycleRunning) {
    record('info', `cycle deja en cours dans cette instance (${origine})`);
    return cycleRunning;
  }

  const now = Date.now();

  // Rearmer AVANT le travail : si le cycle meurt, l'alarme de repli reste.
  await armMain(now + FALLBACK_MS, now);

  const stopKeepalive = startKeepalive();

  cycleRunning = (async () => {
    try {
      const result = await runCycle({
        chrome: api,
        now,
        sources: SOURCES,
        fetch: (url, init) => fetch(url, init),
        notify: async ({ title, text, id, url, kind, catalogKey }) => {
          await showNotice({ id, title, message: text, url, kind, catalogKey });
        },
        updateBadge: async (n) => {
          try {
            /* Le compte d'offres ne doit pas effacer une marque d'incident.
               Sans cette relecture, un cycle qui se termine bien repeindrait
               « 4 » par-dessus le « ! » d'un selecteur mort -- et la seule
               alerte visible disparaitrait au premier reveil suivant. */
            const { [KEY_INCIDENTS]: incidents } = await readKeys(api, KEY_INCIDENTS);
            const b = badgeState({ unseen: n, incidents: incidents || {}, now: Date.now() });
            await api.action.setBadgeText({ text: b.text });
            await api.action.setBadgeBackgroundColor({ color: b.color });
          } catch (e) { /* le badge est un bonus */ }
        },
        record,
        offline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
        // La liste SANS option. Steam n'y entre qu'a la lecture des reglages,
        // dans le cycle, si l'utilisateur a active steamAutoClaim.
        claimableStores: CLAIMABLE_STORES,
        ...options,
      });

      if (result && !result.ignore && !result.stopped) {
        await armMain(result.nextWake, Date.now());
      }
      return result;
    } catch (e) {
      record('error', `cycle en echec (${origine})`, e);
      await write(api, { [KEYS.STATE]: { ...(await readState(api)), lastError: String((e && e.message) || e) } });
      return { erreur: String((e && e.message) || e) };
    } finally {
      stopKeepalive();
      cycleRunning = null;
    }
  })();

  return cycleRunning;
}

/* --------------------------------------------------------------- collection */

/** Garde intra-instance : un double clic ne lance pas deux importations qui s'ecrasent. */
let collectionRunning = null;

/**
 * Importe les bibliotheques demandees, un magasin apres l'autre.
 *
 * Chaque magasin est ECRIT des qu'il est lu : la page voit la progression par
 * storage.onChanged, et un worker tue en route ne perd que le magasin en cours
 * -- marque « en cours », que effectiveStatus finit par declarer mort. Le
 * worker reste l'unique ecrivain de la cle, comme pour le catalogue.
 */
async function importCollection(stores) {
  const stopKeepalive = startKeepalive();
  const results = {};
  try {
    const raw = await readKeys(api, [KEY_COUNTRY]);
    const country = normaliseCountry(raw[KEY_COUNTRY]);

    for (const store of stores) {
      const avant = await readKeys(api, KEY_COLLECTION);
      await write(api, { [KEY_COLLECTION]: markRunning(avant[KEY_COLLECTION], store, Date.now()) });

      const result = await importStore(store, { fetch: (url, init) => fetch(url, init), country });

      // Relire avant d'ecrire : un magasin ne doit pas ecraser ce que le
      // precedent vient d'y mettre.
      const apres = await readKeys(api, KEY_COLLECTION);
      await write(api, { [KEY_COLLECTION]: applyImport(apres[KEY_COLLECTION], store, result, Date.now()) });

      /* La liste de souhaits Steam voyage dans la meme reponse. Elle n'est
         remplacee que par une liste LUE : une importation ratee, ou une
         reponse qui ne la porte pas, laisse la precedente en place. */
      if (result.status === IMPORT_STATUS.OK && Array.isArray(result.wishlist)) {
        await write(api, { [KEY_STEAM_WISHLIST]: makeSteamWishlist(result.wishlist, normaliseTitle, Date.now()) });
      }

      const niveau = result.status === IMPORT_STATUS.OK ? 'info' : 'warn';
      record(niveau, `collection ${store} : ${result.status}${result.note ? ` (${result.note})` : ''}`);
      results[store] = { status: result.status, count: result.items.length, note: result.note };
    }
    return results;
  } finally {
    stopKeepalive();
  }
}

/* ----------------------------------------------------------- sessions */

/** Garde intra-instance : deux sondes simultanees liraient les memes comptes. */
let sessionRunning = null;

/**
 * Mesure l'etat de session des magasins demandes, et l'ecrit.
 *
 * Une requete par magasin, la plus petite que l'import sache faire. Jamais
 * d'ecriture sur un compte : c'est de la lecture, comme l'importation.
 *
 * Ne jette jamais : une sonde qui echoue rend `inconnu`, ce qui est la
 * verite. C'est tout le point du module -- ne pas savoir est un etat, pas
 * une panne.
 */
async function probeSessions(stores) {
  const raw = await readKeys(api, KEY_SESSIONS);
  let etat = raw[KEY_SESSIONS] || {};

  for (const store of stores) {
    let mesure;
    try {
      mesure = await probeSession(store, { fetch: (url, init) => fetch(url, init) });
    } catch (e) {
      mesure = { status: null, note: (e && e.message) || String(e) };
    }
    const status = fromImportStatus(mesure.status);
    etat = recordSession(etat, store, { status, note: mesure.note }, Date.now());
    record('info', `session ${store} : ${status}${mesure.note ? ` (${mesure.note})` : ''}`);
  }

  await write(api, { [KEY_SESSIONS]: etat });
  return etat;
}

/* --------------------------------------------------- listeners, au niveau racine */

/* Un listener ne peut rien faire d'une promesse rejetee : sans ce catch, un
   alarms.create refuse devenait une « Uncaught (in promise) » dans
   chrome://extensions, sans que rien ne la journalise proprement. */
function planifier(origine) {
  ensureSchedule().catch((e) => record('error', `planification impossible (${origine})`, e));
}

api.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === ALARM_MAIN) {
    startCycle('alarme principale').catch((e) => record('error', 'cycle impossible (alarme principale)', e));
    return;
  }
  if (alarme.name === ALARM_NET) {
    // Le filet ne travaille pas : il verifie que la principale existe encore.
    planifier('filet');
  }
});

api.runtime.onStartup.addListener(() => planifier('demarrage'));

// Une mise a jour efface les alarmes : 'update' compte autant que 'install'.
api.runtime.onInstalled.addListener(() => planifier('installation'));

/* « Bientot » restait sans liens apres la mise a jour qui les a ajoutes.
 *
 * Les fenetres annoncees ne sont reecrites qu'a la prochaine interrogation de
 * la source, et le budget peut la repousser de plusieurs jours. Une mise a jour
 * qui trouve des fenetres sans adresse interroge donc ces sources-la tout de
 * suite -- elles seules, une fois, comme le fait la sentinelle. */
async function refreshLinklessWindows() {
  const raw = await readKeys(api, KEYS.SOURCES);
  const states = raw[KEYS.SOURCES] || {};
  const names = Object.keys(states).filter((n) => SOURCES[n] && windowsLackLinks(states[n] && states[n].announcedWindows));
  if (!names.length) return;
  // Un cycle deja lance ignorerait la demande : on attend qu'il se termine.
  if (cycleRunning) await cycleRunning;
  record('info', `fenetres annoncees sans adresse : ${names.join(', ')} interrogee(s) a nouveau`);
  await startCycle('fenetres sans adresse', { force: names });
}

api.runtime.onInstalled.addListener((details) => {
  if (!details || details.reason !== 'update') return;
  refreshLinklessWindows().catch((e) => record('warn', 'rafraichissement des fenetres annoncees impossible', e));
});

/* La sauvegarde des codes.
 *
 * Elle est coupee par defaut : la zone sync traverse le compte du navigateur.
 * Quand elle est active, deux moments comptent et un seul est evident.
 *
 * RESTAURER au demarrage et a l'installation, parce que c'est exactement la
 * ou une reinstallation atterrit : la zone locale est vide, la zone sync a
 * survecu. Le cas a l'air rare jusqu'au jour ou il arrive, et ce jour-la un
 * code perdu est un jeu perdu.
 *
 * MIROITER a chaque ecriture de la cle du moteur. Le moteur ecrit aussi quand
 * l'utilisateur reclame a la main, sur une page que la veille n'a jamais vue :
 * s'accrocher a nos propres cycles raterait precisement ces codes-la. */
async function restaurerCodes(origine) {
  const { syncCodes } = await readSettings(api);
  if (!syncCodes || !hasSync(api)) return;

  const { restored } = await restoreCodes(api);
  if (restored) record('info', `${restored} code(s) restaure(s) depuis la sauvegarde (${origine})`);
}

api.runtime.onStartup.addListener(() => {
  restaurerCodes('demarrage').catch((e) => record('warn', 'restauration des codes impossible', e));
});
api.runtime.onInstalled.addListener(() => {
  restaurerCodes('installation').catch((e) => record('warn', 'restauration des codes impossible', e));
});

/* Le registre se remplit a l'instant de la reclamation.
 *
 * C'est la SEULE fenetre pendant laquelle l'information existe : le titre, la
 * valeur et la vignette vivent dans le catalogue de veille, qui est purge a
 * trente puis quatre-vingt-dix jours. Passe ce delai, l'historique ne porte
 * plus qu'un slug, et le bilan comme l'export perdent tout le passe.
 *
 * L'ecoute porte sur storage.onChanged plutot que sur nos propres ecritures,
 * parce que le moteur ecrit aussi quand l'utilisateur reclame a la main, sur
 * une page que la veille n'a jamais vue. */
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes[KEY_CODES]) {
    (async () => {
      const { syncCodes } = await readSettings(api);
      if (!syncCodes || !hasSync(api)) return;

      const { mirrored, dropped, ok } = await mirrorCodes(api, changes[KEY_CODES].newValue);
      // Un lot trop gros n'est pas tronque par le navigateur, il est rejete :
      // le dire est la difference entre une sauvegarde et une illusion.
      if (!ok) record('warn', 'sauvegarde des codes refusee par le navigateur');
      else if (dropped) record('warn', `${dropped} code(s) trop anciens hors sauvegarde, ${mirrored} garde(s)`);
    })().catch((e) => record('warn', 'sauvegarde des codes impossible', e));
  }

  if (changes[KEY_LIBRARY]) {
    mirrorRegistre(changes[KEY_LIBRARY].newValue || {})
      .catch((e) => record('warn', 'sauvegarde du registre impossible', e));
  }
  if (changes[KEYS.SETTINGS]) toggleRegistre(changes[KEYS.SETTINGS]);

  const lots = Object.entries(changes)
    .filter(([key]) => key.startsWith('FGC_history_'))
    .map(([key, change]) => ({
      platform: key.slice('FGC_history_'.length),
      added: addedEntries(change.oldValue, change.newValue),
    }))
    .filter((l) => l.added.length);

  if (!lots.length) return;

  integrateIntoLibrary(lots, 'figee(s)');
});

/** Integre des lots d'historique au registre, et l'ecrit s'il a change. */
async function integrateIntoLibrary(lots, verbe) {
  try {
    const raw = await readKeys(api, [KEY_LIBRARY, KEYS.OFFERS]);
    let library = raw[KEY_LIBRARY] || {};
    let total = 0;

    for (const { platform, added } of lots) {
      const r = integrateHistory(library, {
        platform,
        added,
        catalog: raw[KEYS.OFFERS] || {},
      });
      library = r.library;
      total += r.changed;
    }

    if (total) {
      await write(api, { [KEY_LIBRARY]: library });
      record('info', `bibliotheque : ${total} entree(s) ${verbe}`);
    }
  } catch (e) {
    // Un registre qui echoue ne doit jamais empecher une reclamation.
    record('warn', 'bibliotheque non mise a jour', e);
  }
}

/* Le registre rattrape l'historique deja ecrit.
 *
 * Jusqu'a la 2.42.0 il ne recevait rien (voir readHistory) : tout ce que le
 * moteur a note avant est absent, et le filtre « deja dans la bibliotheque »
 * ne pouvait pas s'en servir. L'historique entier est donc rejoue au
 * demarrage et a l'installation -- sans effet sur ce qui est deja connu,
 * puisque mergeEntry garde la premiere date et ne vide aucun champ. */
async function backfillLibrary(origine) {
  const cles = Object.keys(PLATFORM_STORES).map((p) => `FGC_history_${p}`);
  const raw = await readKeys(api, cles);
  const lots = Object.keys(PLATFORM_STORES)
    .map((platform) => ({ platform, added: addedEntries(null, raw[`FGC_history_${platform}`]) }))
    .filter((l) => l.added.length);
  if (lots.length) await integrateIntoLibrary(lots, `rattrapee(s) depuis l'historique (${origine})`);
}

/* Le registre, d'un ordinateur a l'autre (watch/library-sync.js).
 *
 * Coupe par defaut, comme la sauvegarde des codes : la zone sync traverse le
 * compte du navigateur. Active, il suit les memes moments -- MIROITER a chaque
 * ecriture du registre, RESTAURER au demarrage et a l'installation -- plus
 * celui de l'activation, ou les deux se font d'un coup. Le rattrapage de
 * l'historique passe AVANT la restauration : deux ecritures croisees du
 * registre perdraient l'une des deux. */
async function mirrorRegistre(library) {
  const { syncLibrary } = await readSettings(api);
  if (!syncLibrary || !hasSync(api)) return;
  const { ok, kept, dropped } = await mirrorLibrary(api, library);
  if (!ok) record('warn', 'sauvegarde du registre refusee par le navigateur');
  else if (dropped) record('warn', `${dropped} jeu(x) trop ancien(s) hors sauvegarde du registre, ${kept} garde(s)`);
}

async function restaurerRegistre(origine) {
  const { syncLibrary } = await readSettings(api);
  if (!syncLibrary || !hasSync(api)) return;
  const { restored, changed } = await restoreLibrary(api);
  if (restored) record('info', `registre : ${restored} jeu(x) pris ailleurs ajoute(s) (${origine})`);
  // Rien d'ecrit ici, donc pas de miroir declenche : ce que CET ordinateur
  // sait doit quand meme partir.
  if (!changed) {
    const raw = await readKeys(api, KEY_LIBRARY);
    await mirrorRegistre(raw[KEY_LIBRARY] || {});
  }
}

function toggleRegistre(change) {
  const avant = Boolean(change.oldValue && change.oldValue.syncLibrary === true);
  const apres = Boolean(change.newValue && change.newValue.syncLibrary === true);
  if (!avant && apres) {
    restaurerRegistre('activation').catch((e) => record('warn', 'restauration du registre impossible', e));
  } else if (avant && !apres) {
    clearLibraryMirror(api)
      .then((ok) => record(ok ? 'info' : 'warn', ok ? 'registre retire du compte' : 'registre non retire du compte'))
      .catch((e) => record('warn', 'retrait du registre impossible', e));
  }
}

const demarrerRegistre = (origine) => backfillLibrary(origine)
  .catch((e) => record('warn', 'rattrapage du registre impossible', e))
  .then(() => restaurerRegistre(origine))
  .catch((e) => record('warn', 'restauration du registre impossible', e));
api.runtime.onStartup.addListener(() => demarrerRegistre('demarrage'));
api.runtime.onInstalled.addListener(() => demarrerRegistre('installation'));

/* Un onglet pilote qui disparait resout ses attentes tout de suite.
 *
 * Sans ces deux ecouteurs, fermer l'onglet de fond -- ou un plantage, ou un
 * dechargement par Chrome -- laissait l'attente courir jusqu'a son budget :
 * cinq minutes. Or les reclamations s'enchainent EN SERIE et le catalogue n'est
 * ecrit qu'apres la boucle, donc un seul onglet ferme immobilisait le cycle
 * assez longtemps pour que le worker soit tue avant l'ecriture.
 *
 * onReplaced compte autant que onRemoved : Chrome remplace un onglet par un
 * autre lors d'une pre-rendu adoptee, et l'ancien identifiant devient mort sans
 * qu'aucune fermeture ne soit signalee. */
api.tabs.onRemoved.addListener((tabId) => {
  const resolus = tabVanished(tabId);
  if (resolus) record('warn', `onglet ${tabId} disparu : ${resolus} attente(s) resolue(s)`);
});

api.tabs.onReplaced.addListener((ajoute, retire) => {
  const resolus = tabVanished(retire);
  if (resolus) record('warn', `onglet ${retire} remplace par ${ajoute} : ${resolus} attente(s) resolue(s)`);
});

/* Enregistre au niveau racine, comme tous les autres : le clic arrive sur un
   service worker qui vient de demarrer, et un listener pose apres un await ne
   le recevrait jamais. */
api.notifications.onButtonClicked.addListener((id, index) => {
  runNoticeAction(id, index)
    .catch((e) => record('warn', 'action de notification impossible', e));
  api.notifications.clear(id).catch(() => { /* deja fermee */ });
});

api.notifications.onClicked.addListener((id) => {
  // Mener a l'offre, jamais a une page d'accueil : c'est tout l'interet du
  // clic. Le popup reste le repli quand on ne sait pas ou aller.
  readNotificationLink(api, id)
    .then((url) => api.tabs.create({ url: url || api.runtime.getURL('pages/popup.html'), active: true }))
    .catch(() => api.tabs.create({ url: api.runtime.getURL('pages/popup.html'), active: true }))
    .catch((e) => record('warn', 'ouverture depuis la notification impossible', e));
  api.notifications.clear(id).catch(() => { /* deja fermee */ });
});

/* ------------------------------------------- relais du moteur (inchange, V1) */

/* Les hotes du relais sont ceux du manifeste, lus une fois. La liste ne peut
   donc pas deriver de ce que l'extension a le droit de lire : c'est la meme. */
const HOTES_RELAIS = hostMatchers((api.runtime.getManifest().host_permissions) || []);

/** La base chrome-extension:// de CETTE extension. Sert a reconnaitre nos pages. */
const BASE_EXTENSION = api.runtime.getURL('');

api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  /* QUI demande, avant QUOI est demande.
   *
   * Les commandes d'interface -- importer une bibliotheque avec les cookies
   * de l'utilisateur, forcer une vague de reclamations, effacer le journal --
   * n'acceptent qu'une page de l'extension. Les messages du moteur
   * n'acceptent qu'un script de contenu. Voir watch/messaging.js pour le
   * pourquoi ; rien de ceci n'etait joignable depuis le web, c'est de la
   * defense en profondeur. */
  /* Ce qui ne nous est pas adresse passe en silence : sendMessage arrose tous
     les contextes, et la page de diagnostic parle au document de sonde. */
  if (!isOurs(msg.type)) return;

  const origine = senderKind(sender, BASE_EXTENSION);
  if (!messageAllowed(msg.type, origine)) {
    record('warn', `message refuse : ${msg.type} venu de « ${origine} »`);
    return;
  }

  /* --- dialogue avec un onglet pilote par la veille --- */

  // Le content script ne connait pas son propre identifiant d'onglet : seul le
  // service worker le sait, via sender.tab. C'est pour cela que la question
  // remonte ici plutot que d'etre tranchee dans la page.
  if (msg.type === 'fgc-suis-je-pilote') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId === undefined) { sendResponse({ piloted: false }); return; }
    isPiloted(api, tabId)
      .then((piloted) => sendResponse({ piloted }))
      .catch(() => sendResponse({ piloted: false }));
    return true;
  }

  if (msg.type === 'fgc-pret' || msg.type === 'fgc-verdict') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId !== undefined) reportVerdict(tabId, msg.type, msg);
    return;
  }

  if (msg.type === 'fgc-fetch') {
    /* Le relais etait un proxy ouvert : URL, methode et en-tetes libres. Il
       est desormais borne a un GET HTTPS vers un hote du manifeste, avec
       `Accept` pour tout bagage -- ce que son unique appelant reel demande.
       Voir relayRequest (watch/messaging.js). */
    const demande = relayRequest(msg, HOTES_RELAIS);
    if (demande.refus) {
      record('warn', `relais refuse : ${demande.refus}`);
      sendResponse({ error: `relais refuse : ${demande.refus}` });
      return true;
    }
    fetch(demande.url, demande.init)
      .then(function (r) { return r.text().then(function (body) { sendResponse({ status: r.status, body: body }); }); })
      .catch(function (e) { sendResponse({ error: String(e && e.message || e) }); });
    return true;
  }

  if (msg.type === 'fgc-notify') {
    // create() rend une promesse : le try/catch d'origine ne voyait jamais son rejet.
    api.notifications.create('', {
      type: 'basic', iconUrl: 'icons/icon128.png', title: String(msg.title || ''), message: String(msg.text || ''),
    }).catch((e) => record('warn', 'notification impossible', e));
    return;
  }

  if (msg.type === 'fgc-open-tab') {
    /* Si la demande vient d'un onglet PILOTE -- une reclamation invisible --
       le nouvel onglet doit naitre dans la MEME fenetre reduite, jamais dans
       celle de l'utilisateur. Sans cela, l'echange GOG declenche depuis Luna
       ouvrait un onglet en pleine session de l'utilisateur, et la fermeture de
       la fenetre de reclamation ne l'emportait pas. */
    /* Le schema est verifie ici, par la MEME fonction qui filtre les URL des
       offres. Sans elle, `chrome-extension://<id>/...` et `file:///`
       passaient : Chrome bloque « javascript: » et « data: » en navigation de
       premier niveau, pas ces deux-la. */
    const cible = webUrl(msg.url);
    if (!cible) {
      record('warn', `ouverture d'onglet refusee : ${String(msg.url).slice(0, 80)}`);
      return;
    }
    const senderTabId = msg && sender && sender.tab ? sender.tab.id : undefined;
    const senderWindowId = sender && sender.tab ? sender.tab.windowId : undefined;
    const echec = (e) => record('warn', `ouverture d'onglet impossible : ${cible}`, e);
    if (senderTabId !== undefined) {
      isPiloted(api, senderTabId)
        .then((piloted) => api.tabs.create(
          piloted && senderWindowId !== undefined
            ? { url: cible, active: false, windowId: senderWindowId }
            : { url: cible, active: !!msg.active },
        ))
        .catch(() => api.tabs.create({ url: cible, active: !!msg.active }))
        .catch(echec);
      return;
    }
    api.tabs.create({ url: cible, active: !!msg.active }).catch(echec);
    return;
  }

  /* --- commandes de la veille, pour le popup et la page de diagnostic --- */

  if (msg.type === 'fgc-check-now') {
    startCycle('demande manuelle', { force: true })
      .then(sendResponse)
      .catch((e) => {
        record('error', 'cycle impossible (demande manuelle)', e);
        sendResponse({ erreur: String((e && e.message) || e) });
      });
    return true;
  }

  // Le catalogue n'a qu'un ecrivain : le service worker. Le popup demande, il
  // n'ecrit pas -- sinon deux contextes se marchent dessus sans transaction.
  if (msg.type === 'fgc-mark-seen') {
    (async () => {
      const raw = await readKeys(api, [KEYS.OFFERS, KEYS.STATE]);
      const catalog = raw[KEYS.OFFERS] || {};
      const next = {};
      for (const [key, o] of Object.entries(catalog)) next[key] = o.seen ? o : { ...o, seen: true };
      const state = { ...(raw[KEYS.STATE] || {}), unseen: 0 };
      await write(api, { [KEYS.OFFERS]: next, [KEYS.STATE]: state });
      try { await api.action.setBadgeText({ text: '' }); } catch (e) { /* le badge est un bonus */ }
      sendResponse({ ok: true });
    })().catch((e) => {
      // Sans reponse, le popup attendrait indefiniment.
      record('warn', 'marquage des offres vues impossible', e);
      sendResponse({ ok: false });
    });
    return true;
  }

  /* Reclamer tout, a la demande. Le plafond horaire tient toujours : c'est lui
     qui protege le compte, pas la modestie du cycle ordinaire. */
  if (msg.type === 'fgc-claim-all') {
    claimAllNow({ chrome: api, claimableStores: CLAIMABLE_STORES, record })
      .then(sendResponse)
      .catch((e) => {
        record('error', 'reclamation groupee en echec', e);
        sendResponse({ claimed: 0, left: 0, error: String((e && e.message) || e) });
      });
    return true;
  }

  /* Referme tout onglet pilote encore ouvert. Demande par l'arret d'urgence :
     couper les futurs clics ne suffit pas si un onglet est deja en train d'en
     faire un. */
  if (msg.type === 'fgc-sweep-tabs') {
    sweepTabs(api, Date.now())
      .then((r) => { record('warn', `arret d'urgence : ${r.closed} onglet(s) referme(s)`); sendResponse(r); })
      .catch(() => sendResponse({ closed: 0 }));
    return true;
  }

  /* Reessayer une offre bloquee, a la demande. */
  if (msg.type === 'fgc-retry') {
    retryNow({ chrome: api, catalogKey: msg.catalogKey })
      .then(sendResponse)
      .catch(() => sendResponse({ retried: false }));
    return true;
  }

  /* La file pilotable. Les trois ecrivent le catalogue, dont le worker est le
     seul ecrivain : le popup demande, il n'ecrit pas. */
  if (msg.type === 'fgc-claim-one') {
    claimOneNow({
      chrome: api,
      catalogKey: msg.catalogKey,
      claimableStores: CLAIMABLE_STORES,
      record,
    })
      .then(sendResponse)
      .catch((e) => {
        record('warn', 'reclamation a l\'unite impossible', e);
        sendResponse({ claimed: 0, claims: [], error: String((e && e.message) || e) });
      });
    return true;
  }

  if (msg.type === 'fgc-prioritise') {
    prioritise({ chrome: api, catalogKey: msg.catalogKey, on: msg.on === true })
      .then(sendResponse)
      .catch(() => sendResponse({ changed: false }));
    return true;
  }

  /* Le lanceur demande ce qu'on sait d'un titre. Lecture seule, et la
     reponse ne porte QUE des faits deja connus de l'utilisateur : rien n'est
     divulgue a la page, qui n'apprend rien qu'il ne sache deja lui-meme. */
  if (msg.type === 'fgc-lookup') {
    (async () => {
      const raw = await readKeys(api, [
        KEYS.OFFERS, KEY_LIBRARY, KEY_COLLECTION_LOOKUP, KEY_OUTCOMES,
      ]);
      const facts = lookup({
        title: msg.title,
        store: msg.store || null,
        catalog: raw[KEYS.OFFERS] || {},
        library: raw[KEY_LIBRARY] || {},
        collection: (raw[KEY_COLLECTION_LOOKUP] || {}).items || {},
        outcomes: raw[KEY_OUTCOMES] || {},
        normalise: normaliseTitle,
        now: Date.now(),
      });
      /* Les phrases partent avec les faits, dans la langue du lecteur : la
         lanceur n'a pas de table de traduction (voir factLines). Ses
         libelles partent aussi, pour la meme raison ; hors d'une fiche, le
         titre est vide et seuls eux ont un sens. */
      const dateText = (ts) => new Date(ts).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
      sendResponse({
        facts,
        lines: factLines(facts, { t, storeLabel: (s) => STORE_LABELS[s] || s, dateText }),
        labels: launcherLabels(t),
      });
    })().catch(() => sendResponse({ facts: [] }));
    return true;
  }

  if (msg.type === 'fgc-bridge') {
    sendToBridge({ chrome: api })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: String((e && e.message) || e) }));
    return true;
  }

  if (msg.type === 'fgc-playtime') {
    readPlaytime({ chrome: api, fetch: (u, i) => fetch(u, i) })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, reason: String((e && e.message) || e), count: 0 }));
    return true;
  }

  /* L'essai du telephone, depuis le popup. Il passe par le meme chemin que
     les vraies alertes -- une adresse qui marche ici marche la-bas -- et son
     resultat efface un echec precedent, ce qui libere le tour d'inspection. */
  if (msg.type === 'fgc-phone-test') {
    readKeys(api, [KEY_PHONE])
      .then((raw) => {
        const tel = phoneTarget(raw[KEY_PHONE]);
        if (!tel) return { ok: false, status: 0, note: 'adresse invalide ou alerte coupee' };
        return pushToPhone({
          chrome: api,
          fetch: (u, i) => fetch(u, i),
          target: tel,
          msg: { title: t('phoneTestTitle'), message: t('phoneTestBody'), priority: PRIORITY.DEFAULT, tags: ['white_check_mark'] },
          now: Date.now(),
          record,
          why: 'essai',
        });
      })
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, status: 0, note: String((e && e.message) || e) }));
    return true;
  }

  if (msg.type === 'fgc-teach') {
    teach({ chrome: api, surface: msg.surface, label: msg.label, on: msg.on !== false })
      .then(sendResponse)
      .catch(() => sendResponse({ learned: false, reason: 'erreur' }));
    return true;
  }

  if (msg.type === 'fgc-wish') {
    wish({ chrome: api, title: msg.title, on: msg.on === true })
      .then(sendResponse)
      .catch(() => sendResponse({ wishes: 0 }));
    return true;
  }

  if (msg.type === 'fgc-snooze') {
    snooze({ chrome: api, catalogKey: msg.catalogKey })
      .then(sendResponse)
      .catch(() => sendResponse({ changed: false }));
    return true;
  }

  if (msg.type === 'fgc-prune') {
    pruneNow({ chrome: api })
      .then(sendResponse)
      .catch((e) => {
        record('warn', 'purge impossible', e);
        sendResponse({ dropped: 0 });
      });
    return true;
  }

  /* La sentinelle : un onglet ouvert par quelqu'un qui regarde.
   *
   * Elle n'ecrit ni le catalogue ni le journal -- elle DEMANDE un cycle, et le
   * worker reste l'ecrivain unique. Ce qu'elle apporte est ailleurs : elle
   * force les sources visees, donc elle passe outre le recul qui les endort
   * pendant des heures apres trois echecs. C'est le seul pouvoir du repli, et
   * il ne vaut que pendant qu'un humain regarde.
   *
   * Rien ici ne suspend la veille ordinaire. Le worker garde ses alarmes et
   * son plan : un onglet ferme, ou un navigateur tue, ne peut donc pas laisser
   * la veille en panne -- le pire qui puisse arriver est un cycle de trop, que
   * le bail et l'idempotence absorbent deja. */
  if (msg.type === 'fgc-sentinel') {
    (async () => {
      const now = Date.now();
      const cibles = Array.isArray(msg.sources) ? msg.sources : [];

      if (msg.state === 'close') {
        await clearBeat(api);
        record('info', 'sentinelle fermee : la veille ordinaire reprend seule');
        sendResponse({ ok: true });
        return;
      }

      await writeBeat(api, { at: now, attempts: msg.attempts || 0, sources: cibles });

      /* UNE SEULE valeur declenche un cycle, et elle est nommee.
       *
       * Le defaut est inoffensif, deliberement : le battement passe ici toutes
       * les minutes, et un `else` qui aurait force un cycle aurait martele les
       * sources soixante fois plus que prevu -- sur des API tierces, et sans
       * que rien dans l'interface ne le montre. */
      if (msg.state === 'beat') {
        const resultat = await startCycle('sentinelle', { force: cibles });
        const raw = await readKeys(api, KEYS.SOURCES);
        sendResponse({
          ok: true,
          erreur: (resultat && resultat.erreur) || null,
          sources: raw[KEYS.SOURCES] || {},
        });
        return;
      }

      if (msg.state === 'open') {
        record('warn', `sentinelle ouverte sur ${cibles.join(', ') || 'aucune source'}`);
      }

      // 'open', 'ping', ou tout le reste : le battement est pose, rien d'autre.
      const raw = await readKeys(api, KEYS.SOURCES);
      sendResponse({ ok: true, sources: raw[KEYS.SOURCES] || {} });
    })().catch((e) => {
      record('warn', 'sentinelle : commande impossible', e);
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    });
    return true;
  }

  /* Acquitter une alerte du canari. Meme regle que le catalogue : un seul
     ecrivain. Le compteur repart a zero, le dernier succes connu reste -- une
     alerte qu'on ne peut pas acquitter est une alerte qui finit ignoree. */
  if (msg.type === 'fgc-canary-ack') {
    (async () => {
      const raw = await api.storage.local.get(KEY_CANARY);
      await write(api, { [KEY_CANARY]: acknowledge(raw[KEY_CANARY] || {}, msg.store) });
      record('info', `canari acquitte : ${msg.store}`);
      sendResponse({ acknowledged: true });
    })().catch((e) => sendResponse({ acknowledged: false, error: String((e && e.message) || e) }));
    return true;
  }

  /* Vider passe par le worker, comme tout le reste : c'est lui qui ecrit le
     journal, et un effacement lance depuis une page pendant qu'il ecrit
     perdrait les entrees des deux cotes. */
  if (msg.type === 'fgc-journal-clear') {
    (async () => {
      await new Promise((resolve) => { journalQueue = journalQueue.then(resolve, resolve); });
      await clearJournal(api);
      record('info', 'journal efface a la demande');
      sendResponse({ cleared: true });
    })().catch((e) => sendResponse({ cleared: false, error: String((e && e.message) || e) }));
    return true;
  }

  /* Importer la collection, a la demande de la page. Jamais de facon
     automatique : chaque importation lit un compte avec la session de
     l'utilisateur, et c'est lui qui decide quand. */
  if (msg.type === 'fgc-collection-import') {
    if (collectionRunning) { sendResponse({ busy: true }); return; }
    const demandes = Array.isArray(msg.stores) && msg.stores.length ? msg.stores : IMPORTABLE_STORES;
    collectionRunning = importCollection(demandes.filter((s) => IMPORTABLE_STORES.includes(s)));
    collectionRunning
      .then((results) => sendResponse({ ok: true, results }))
      .catch((e) => {
        record('warn', 'collection : importation impossible', e);
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      })
      .finally(() => { collectionRunning = null; });
    return true;
  }

  /* Sonder les sessions, a la demande de la page. Meme regle que
     l'importation : chaque sonde lit un compte avec la session de
     l'utilisateur, donc elle part sur un geste, jamais toute seule. */
  if (msg.type === 'fgc-session-probe') {
    if (sessionRunning) { sendResponse({ busy: true }); return; }
    const demandes = (Array.isArray(msg.stores) && msg.stores.length ? msg.stores : PROBED_STORES)
      .filter((s) => PROBED_STORES.includes(s));
    sessionRunning = probeSessions(demandes);
    sessionRunning
      .then((sessions) => sendResponse({ ok: true, sessions }))
      .catch((e) => {
        record('warn', 'sessions : sonde impossible', e);
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      })
      .finally(() => { sessionRunning = null; });
    return true;
  }

  if (msg.type === 'fgc-watch-state') {
    (async () => {
      const state = await readState(api);
      const alarmNames = await api.alarms.getAll();
      sendResponse({ state, alarmNames });
    })().catch((e) => sendResponse({ error: String((e && e.message) || e) }));
    return true;
  }
});

/* ------------------------------------------------------------ demarrage */

// Filet universel : ni onStartup ni onInstalled ne couvrent un reveil ordinaire
// du worker. Cet appel racine coute un alarms.get et couvre tous les cas.
planifier('reveil');
