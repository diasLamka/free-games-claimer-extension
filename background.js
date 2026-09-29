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
  readState, readKeys, readSettings, write, KEYS, DEFAULT_SETTINGS, normaliseSettings,
  rememberNotification, readNotification, readNotificationLink,
} from './watch/storage.js';
import { reportVerdict, isPiloted, sweepTabs, tabVanished } from './watch/claim.js';
import {
  claimAllNow, claimOneNow, isStopped, prioritise, pruneNow, readPlaytime, retryNow,
  sendToBridge, snooze, teach, wish,
} from './watch/commands.js';
import { KEY_LIBRARY, PLATFORM_STORES, addedEntries, integrateHistory } from './watch/library.js';
import {
  KEY_SESSIONS, PROBED_STORES, fromImportStatus, recordSession,
} from './watch/session.js';
import { senderKind, messageAllowed, isOurs, hostMatchers, relayRequest } from './watch/messaging.js';
import { STORE_LABELS, STATES, isExpired, webUrl } from './watch/offer.js';
import { KEY_JOURNAL, makeEntry, appendTo, clearJournal } from './watch/journal.js';
import { KEY_CANARY, acknowledge } from './watch/canary.js';
import { KEY_CODES, mirrorCodes, restoreCodes, hasSync } from './watch/backup.js';
import { mirrorLibrary, restoreLibrary, clearLibraryMirror } from './watch/library-sync.js';
import { KEY_SENTINEL, writeBeat, clearBeat } from './watch/sentinel.js';
import { KEY_COLLECTION, IMPORTABLE_STORES, IMPORT_STATUS, applyImport, markRunning } from './watch/collection.js';
import { importStore, probeSession } from './watch/collection-import.js';
import { KEY_COUNTRY, normaliseCountry } from './watch/locale.js';
import { KEY_INCIDENTS } from './watch/incidents.js';
import { factLines, freeNowList, launcherLabels, lookup, pageGame } from './watch/lookup.js';
import { ownedElsewhere, guardLines, guardStoreOf, isProductPage } from './watch/owned-guard.js';
import { KEY_COLLECTION as KEY_COLLECTION_LOOKUP } from './watch/collection.js';
import { KEY_OUTCOMES } from './watch/outcomes.js';
import { normaliseTitle } from './watch/offer.js';
import { KEY_GOG_WISHLIST, KEY_STEAM_WISHLIST, KEY_WISHLIST, makeImportedWishlist } from './watch/wishlist.js';
import { escapeXml, omniSuggestions, omniTarget } from './watch/omnibox.js';
import { MENU_LINK, MENU_PAGE, menuItems, wishFromClick } from './watch/context-wish.js';
import { KEY_PHONE, PRIORITY, phoneTarget, pushToPhone } from './watch/phone.js';
import { currentLocale, intlLocale, keysWith, setLocale, t } from './lib/i18n.js';
import { composeEngineText, engineTemplates, engineTitle } from './watch/engine-text.js';
import { ALARM_DISK, DISK_PERIOD_MIN, checkDisk, requestUpdate, updatedNotice } from './watch/self-update.js';
import { badgeState, effectiveQuiet, inQuietHours, onVacation } from './watch/notify-policy.js';
import { runReturnSummary } from './watch/vacation.js';
import { runRecap } from './watch/recap.js';
import { runCodeReminders } from './watch/code-reminders.js';
import { restoreBackup } from './watch/full-backup.js';
import { KEY_WEEKENDS, nextWeekends, refreshWeekends, weekendsDue } from './watch/steam-weekends.js';
import { KEY_STEAM_DLC, dlcPassDue, runDlcPass } from './watch/steam-dlc.js';
import { KEY_ODDS, KEY_GIVERS, PASS_EVERY_MS as ODDS_EVERY_MS, recordGivers, refreshOddsInfo, wishTargets } from './watch/odds.js';
import { KEY_TASTE, MIN_LIKED as TASTE_MIN_LIKED, fetchGames as fetchTasteGames, notForYou, readTasteState, refreshTaste, signalsFrom, tagLanguage, tastePassDue, tasteFor, tasteNames } from './watch/taste.js';
import { KEY_TONIGHT, buildPile, readTonightState, refreshTonight, steamLanguage, tonightPassDue } from './watch/tonight.js';
import { KEY_PLAYTIME } from './watch/playtime.js';
import { KEY_ANNOTATIONS } from './watch/annotations.js';
import { runAutoBackup } from './watch/auto-backup.js';
import {
  KEY_RATINGS, PER_RUN as RATINGS_PER_RUN, eligible as ratingEligible, needsRating, ratingFor, steamAppId, ratingLine, refreshRatings,
  tone as ratingTone,
} from './watch/steam-ratings.js';
import { openOffers } from './watch/catalog.js';
import { KEY_COVERS, refreshCovers } from './watch/covers.js';
import { money } from './lib/money.js';
import { DASHBOARD_PAGE } from './lib/dashboard.js';
import { ACTIONS, actionAt, buttonsFor } from './watch/notify-actions.js';
import { notificationImage } from './watch/notify-image.js';
import { inspectHealth as inspectHealthOf } from './watch/health.js';
import { windowsLackLinks } from './watch/sources/epic.js';
import { KEY_DRY_RUN, dryRunStores, storesToTest } from './watch/dry-run.js';

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
  /* Rendue pour qui doit savoir la ligne ecrite : un rechargement de
     l'extension, par exemple, couperait l'ecriture en cours. */
  return journalQueue;
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

  /* Le recap du jeudi part aussi d'ici : un ordinateur qui se reveille le
     vendredi matin n'attend pas le prochain cycle pour le recevoir. */
  // Le retour de vacances d'abord : il tient lieu de recap de la semaine.
  await maybeReturn(now);
  await maybeRecap(now);
  await maybeCodeReminders(now);
  await maybeWeekends(now);
  await maybeAutoBackup(now);
  await maybeRatings(now);

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
async function showNotice({ id, title, message, url = null, kind = null, catalogKey = null, image = null }) {
  try {
    await rememberNotification(api, id, { url, catalogKey, kind });

    const base = { type: 'basic', iconUrl: 'icons/icon128.png', title, message };
    const boutons = buttonsFor(kind).map((b) => ({ title: t(b.label) }));

    /* La jaquette du jeu (2.63.0), en grand sous le texte : voir
       watch/notify-image.js. Sans elle -- CDN muet, image trop lourde --, la
       notification part avec l'icone, comme avant. */
    const imageUrl = image ? await notificationImage(image) : null;
    const illustree = imageUrl ? { ...base, type: 'image', imageUrl } : null;

    /* Du plus riche au plus simple : une plateforme qui refuse les boutons
       (Firefox) ou le type image ne doit jamais faire taire la notification. */
    const essais = [
      illustree && boutons.length ? { ...illustree, buttons: boutons } : null,
      illustree,
      boutons.length ? { ...base, buttons: boutons } : null,
      base,
    ].filter(Boolean);
    for (let i = 0; i < essais.length; i++) {
      try {
        await api.notifications.create(id, essais[i]);
        return;
      } catch (e) {
        if (i === essais.length - 1) throw e;
        record('info', 'notification refusee sous cette forme, repli plus simple', e);
      }
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
        // La note Steam d'un jeu annonce seul (2.78.0), cinq secondes au plus.
        rateOffer: (offer) => rateOne(offer),
        // Vos gouts (2.99.0) : de quoi un jeu annonce seul se rapproche de ce que vous aimez.
        tasteOffer: (offer) => tasteOne(offer),
        // Silence intelligent (2.99.5) : ce qui ne ressemble pas a vos gouts attend le resume.
        tasteDefer: (offers) => tasteDefer(offers),
        notify: async ({ title, text, id, url, kind, catalogKey, image }) => {
          await showNotice({ id, title, message: text, url, kind, catalogKey, image });
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
        // Apres le cycle : les jeux du jeudi viennent d'etre vus et pris.
        await maybeReturn(Date.now());
        await maybeRecap(Date.now());
        await maybeCodeReminders(Date.now());
        await maybeWeekends(Date.now());
        await maybeSteamDlc(Date.now());
        await maybeOdds(Date.now());
        await maybeTonight(Date.now());
        await maybeTaste(Date.now());
        await maybeAutoBackup(Date.now());
        await maybeRatings(Date.now());
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

/* ---------------------------------------------------------- recap du jeudi */

/** Garde intra-instance : le cycle et l'alarme filet peuvent arriver ensemble. */
let recapRunning = null;

/**
 * Le recap du jeudi soir, s'il est du (2.65.0). La decision et le texte vivent
 * dans watch/recap.js ; ici, les quatre choses qui touchent la plateforme. Ne
 * jette jamais : un recap rate n'est pas une panne de la veille.
 */
function maybeRecap(now = Date.now()) {
  if (recapRunning) return recapRunning;
  recapRunning = (async () => {
    await langue;
    const settings = await readSettings(api);
    const { [KEY_PHONE]: phoneRaw } = await readKeys(api, KEY_PHONE);
    const tel = phoneTarget(phoneRaw);
    return runRecap({
      chrome: api,
      now,
      t,
      storeLabel: (s) => STORE_LABELS[s] || s,
      format: money,
      quietNow: inQuietHours(effectiveQuiet(settings), now),
      // Un clic mene au tableau de bord : le detail de la semaine y est.
      notify: ({ id, title, message }) => showNotice({ id, title, message, url: api.runtime.getURL(DASHBOARD_PAGE) }),
      phone: tel && tel.recap
        ? (msg) => pushToPhone({ chrome: api, fetch: (u, i) => fetch(u, i), target: tel, msg, now, record, why: 'recap du jeudi' })
        : null,
      record,
    });
  })()
    .catch((e) => record('warn', 'recap du jeudi impossible', e))
    .finally(() => { recapRunning = null; });
  return recapRunning;
}

/* ------------------------------------------------ retour de vacances */

let returnRunning = null;

/**
 * Le resume du retour de vacances (2.84.0), une fois par depart. Voir
 * watch/vacation.js. Il part sur le telephone si le recap du jeudi y va.
 */
function maybeReturn(now = Date.now()) {
  if (returnRunning) return returnRunning;
  returnRunning = (async () => {
    await langue;
    const settings = await readSettings(api);
    const { [KEY_PHONE]: phoneRaw } = await readKeys(api, KEY_PHONE);
    const tel = phoneTarget(phoneRaw);
    return runReturnSummary({
      chrome: api,
      now,
      t,
      storeLabel: (s) => STORE_LABELS[s] || s,
      format: money,
      quietNow: inQuietHours(effectiveQuiet(settings), now),
      notify: ({ id, title, message }) => showNotice({ id, title, message, url: api.runtime.getURL(DASHBOARD_PAGE) }),
      phone: tel && tel.recap
        ? (msg) => pushToPhone({ chrome: api, fetch: (u, i) => fetch(u, i), target: tel, msg, now, record, why: 'retour de vacances' })
        : null,
      record,
    });
  })()
    .catch((e) => { record('warn', 'retour de vacances impossible', e); return { sent: false }; })
    .finally(() => { returnRunning = null; });
  return returnRunning;
}

/* ------------------------------------------- week-ends gratuits de Steam */

let weekendsRunning = null;

/**
 * Les week-ends gratuits de Steam (2.75.0), relus au plus toutes les six
 * heures, et seulement si Steam est suivi. Voir watch/steam-weekends.js.
 */
function maybeWeekends(now = Date.now()) {
  if (weekendsRunning) return weekendsRunning;
  weekendsRunning = (async () => {
    const settings = await readSettings(api);
    if (settings.steamWeekends === false || !(settings.watchedStores || []).includes('steam')) return null;
    const { [KEY_WEEKENDS]: avant } = await readKeys(api, KEY_WEEKENDS);
    if (!weekendsDue(avant, now)) return null;
    const r = await refreshWeekends({ fetch: (u, i) => fetch(u, i), now });
    await write(api, { [KEY_WEEKENDS]: nextWeekends(avant, r) });
    record(r.failed ? 'warn' : 'info', r.failed
      ? `week-ends Steam : lecture impossible (${r.errors.join(' ; ')})`
      : `week-ends Steam : ${r.items.length} jeu(x) a essayer`);
    return r;
  })()
    .catch((e) => record('warn', 'week-ends Steam impossibles', e))
    .finally(() => { weekendsRunning = null; });
  return weekendsRunning;
}

/**
 * Les DLC gratuits de vos jeux Steam (2.92.0), un passage par heure au plus,
 * si Steam est suivi et que Ma collection connait vos jeux Steam. Voir
 * watch/steam-dlc.js. Une notification pour ceux qui viennent d'etre trouves.
 */
let dlcRunning = null;

function maybeSteamDlc(now = Date.now()) {
  if (dlcRunning) return dlcRunning;
  dlcRunning = (async () => {
    const settings = await readSettings(api);
    if (settings.steamDlc === false || !(settings.watchedStores || []).includes('steam')) return null;
    const raw = await readKeys(api, [KEY_STEAM_DLC, KEY_COLLECTION_LOOKUP, KEY_COUNTRY]);
    const collection = (raw[KEY_COLLECTION_LOOKUP] || {}).items || {};
    if (!Object.values(collection).some((i) => i && i.store === 'steam')) return null;
    if (!dlcPassDue(raw[KEY_STEAM_DLC], now)) return null;
    const r = await runDlcPass({
      fetch: (u, i) => fetch(u, i), now, collection, state: raw[KEY_STEAM_DLC],
      country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR',
    });
    const dejaDit = new Set(r.state.notified);
    const nouveaux = r.found.filter((id) => !dejaDit.has(id)).map((id) => ({ id, ...r.state.dlc[id] }));
    r.state.notified = [...dejaDit, ...nouveaux.map((d) => d.id)].slice(-3000);
    await write(api, { [KEY_STEAM_DLC]: r.state });
    record(r.errors.length ? 'warn' : 'info', `DLC Steam gratuits : ${r.found.length} trouve(s) ce passage${r.errors.length ? ` -- ${r.errors.slice(0, 3).join(' ; ')}` : ''}`);
    if (nouveaux.length && settings.notifyMode !== 'off' && !inQuietHours(effectiveQuiet(settings), now)) {
      const jeu = (r.state.games[nouveaux[0].parent] || {}).name || '';
      await showNotice({
        id: `dlc-${now}`,
        title: nouveaux.length === 1 ? t('dlcFoundOne', jeu) : t('dlcFoundMany', String(nouveaux.length)),
        message: t('dlcFoundBody', nouveaux.slice(0, 4).map((d) => d.name).join(', ')),
        url: nouveaux.length === 1 ? `https://store.steampowered.com/app/${nouveaux[0].id}/` : null,
      });
    }
    return r;
  })()
    .catch((e) => record('warn', 'DLC Steam gratuits impossibles', e))
    .finally(() => { dlcRunning = null; });
  return dlcRunning;
}

/**
 * « Attendez, il sera offert » (2.94.0) : apres chaque cycle, les editeurs des
 * offres vues sont retenus ; une fois par heure au plus, huit fiches Steam de
 * souhaits sont lues (sans cookie). Voir watch/odds.js.
 */
let oddsRunning = null;

function maybeOdds(now = Date.now()) {
  if (oddsRunning) return oddsRunning;
  oddsRunning = (async () => {
    const raw = await readKeys(api, [KEYS.OFFERS, KEY_GIVERS, KEY_ODDS, KEY_WISHLIST, KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST, KEY_COUNTRY]);
    const givers = recordGivers(raw[KEY_GIVERS] || {}, Object.values(raw[KEYS.OFFERS] || {}), now);
    await write(api, { [KEY_GIVERS]: givers });
    const cache = raw[KEY_ODDS] || {};
    if (cache.__at && now - cache.__at < ODDS_EVERY_MS) return null;
    const targets = wishTargets({
      wishlist: raw[KEY_WISHLIST] || [], steamWishlist: raw[KEY_STEAM_WISHLIST] || null, gogWishlist: raw[KEY_GOG_WISHLIST] || null,
    });
    if (!targets.length) return null;
    const next = await refreshOddsInfo({
      fetch: (u, i) => fetch(u, i), targets, cache, now, country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR',
    });
    await write(api, { [KEY_ODDS]: { ...next, __at: now } });
    return next;
  })()
    .catch((e) => record('warn', 'chances des souhaits impossibles', e))
    .finally(() => { oddsRunning = null; });
  return oddsRunning;
}

/**
 * « Ce soir je joue a... » (2.95.0) : une fois par heure au plus, les
 * etiquettes, la note et la categorie Steam Deck des jeux de la pile, cent
 * par passage, et huit titres hors Steam cherches. Sans cookie. Voir
 * watch/tonight.js.
 */
let tonightRunning = null;
/* Le popup peut demander un passage tout de suite (2.96.0) : le jeu montre
   n'a pas encore sa fiche. Pas plus d'un toutes les deux minutes. */
const TONIGHT_FORCE_MIN_MS = 2 * 60 * 1000;

function maybeTonight(now = Date.now(), { force = false } = {}) {
  if (tonightRunning) return tonightRunning;
  tonightRunning = (async () => {
    const settings = await readSettings(api);
    if (settings.tonight === false) return null;
    const raw = await readKeys(api, [KEY_TONIGHT, KEY_COLLECTION_LOOKUP, KEY_LIBRARY, KEY_PLAYTIME, KEY_ANNOTATIONS, KEY_COUNTRY, KEY_COVERS]);
    const dernier = readTonightState(raw[KEY_TONIGHT]).at;
    if (force ? (dernier && now - dernier < TONIGHT_FORCE_MIN_MS) : !tonightPassDue(raw[KEY_TONIGHT], now)) return null;
    const pile = buildPile({
      collection: raw[KEY_COLLECTION_LOOKUP] || null,
      library: raw[KEY_LIBRARY] || {},
      playtime: (raw[KEY_PLAYTIME] || {}).games || null,
      annotations: raw[KEY_ANNOTATIONS] || {},
      state: raw[KEY_TONIGHT],
      covers: raw[KEY_COVERS] || {},
    });
    if (!pile.length) return null;
    const next = await refreshTonight({
      fetch: (u, i) => fetch(u, i), pile, state: raw[KEY_TONIGHT], now, country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR',
      lang: steamLanguage(currentLocale()),
    });
    await write(api, { [KEY_TONIGHT]: next });
    return next;
  })()
    .catch((e) => record('warn', 'ce soir je joue a : lecture Steam impossible', e))
    .finally(() => { tonightRunning = null; });
  return tonightRunning;
}

/* ------------------------------------------------- sauvegarde automatique */

let autoBackupRunning = null;

/**
 * La sauvegarde de la semaine (2.77.0), si la permission `downloads` est
 * accordee. Voir watch/auto-backup.js. `force` : le clic qui l'active.
 */
function maybeAutoBackup(now = Date.now(), { force = false } = {}) {
  if (autoBackupRunning) return autoBackupRunning;
  autoBackupRunning = (async () => {
    const settings = await readSettings(api);
    return runAutoBackup({
      chrome: api,
      now,
      force,
      version: api.runtime.getManifest().version,
      // Les heures de la nuit seulement : une sauvegarde n'est pas une
      // notification, elle ne se tait pas en vacances (2.84.0).
      quietNow: inQuietHours(settings.quiet, now),
      record,
    });
  })()
    .catch((e) => { record('warn', 'sauvegarde automatique impossible', e); return { done: false, why: 'failed' }; })
    .finally(() => { autoBackupRunning = null; });
  return autoBackupRunning;
}

/* ------------------------------------------------------ la note Steam */

/* Une seule ecriture du registre a la fois : la notification et le passage
   d'apres cycle y ecrivent tous deux, et deux get -> set entrelaces perdent
   une note. */
let ratingsChain = Promise.resolve();

function ensureRatings(offers, { limit = RATINGS_PER_RUN, timeoutMs } = {}) {
  const travail = async () => {
    const settings = await readSettings(api);
    if (settings.steamRatings === false) return null;
    const { [KEY_RATINGS]: avant, [KEY_COUNTRY]: pays } = await readKeys(api, [KEY_RATINGS, KEY_COUNTRY]);
    const r = await refreshRatings(avant || {}, offers, {
      fetch: (u, i) => fetch(u, i), now: Date.now(), country: normaliseCountry(pays), limit, timeoutMs,
    });
    if (r.got) await write(api, { [KEY_RATINGS]: r.ratings });
    return r;
  };
  const p = ratingsChain.then(travail, travail);
  ratingsChain = p.catch(() => null);
  return p;
}

/** La note d'une offre pour sa notification : relue, ou cherchee tout de suite. */
async function rateOne(offer) {
  try {
    const settings = await readSettings(api);
    if (settings.steamRatings === false) return null;
    /* Six secondes au plus, file d'attente comprise : une notification ne
       patiente pas derriere le passage de huit notes d'un autre reveil. */
    await Promise.race([
      ensureRatings([offer], { limit: 1, timeoutMs: 5000 }),
      new Promise((fin) => setTimeout(fin, 6000)),
    ]);
    const { [KEY_RATINGS]: notes } = await readKeys(api, KEY_RATINGS);
    return ratingFor(notes, offer);
  } catch { return null; }
}

/**
 * Les noms des etiquettes qui rapprochent un jeu de vos gouts (2.99.0), ou
 * null. Cinq secondes au plus : si le jeu n'a pas encore ses etiquettes, on
 * les lit tout de suite -- une notification ne les attend pas plus longtemps.
 */
async function tasteOne(offer) {
  try {
    const settings = await readSettings(api);
    if (settings.taste === false) return null;
    const raw = await readKeys(api, [KEY_TASTE, KEY_RATINGS, KEY_COUNTRY]);
    const etat = readTasteState(raw[KEY_TASTE]);
    if (!etat.profile) return null;
    const appid = steamAppId(offer) || (ratingFor(raw[KEY_RATINGS], offer) || {}).appid || null;
    if (!appid) return null;
    let courant = etat;
    if (!etat.games[appid]) {
      const lus = await Promise.race([
        fetchTasteGames((u, i) => fetch(u, i), [appid], { now: Date.now(), country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR' }),
        new Promise((fin) => setTimeout(() => fin(null), 5000)),
      ]);
      if (!lus) return null;
      courant = { ...etat, games: { ...etat.games, ...lus } };
      // Relu juste avant d'ecrire : le passage de fond a pu avancer entre-temps.
      const frais = readTasteState((await readKeys(api, KEY_TASTE))[KEY_TASTE]);
      await write(api, { [KEY_TASTE]: { ...frais, games: { ...frais.games, ...lus } } });
    }
    const r = tasteFor(courant, appid);
    return r ? tasteNames(courant, r.top) : null;
  } catch { return null; }
}

/**
 * Silence intelligent (2.99.5) : parmi ces offres, les cles de celles qui ne
 * ressemblent PAS aux gouts. Cinq secondes au plus pour lire les etiquettes
 * qui manquent ; au moindre doute, l'offre sonne.
 */
async function tasteDefer(offers) {
  try {
    const settings = await readSettings(api);
    if (settings.taste === false || settings.tasteQuiet !== true) return [];
    const raw = await readKeys(api, [KEY_TASTE, KEY_RATINGS, KEY_COUNTRY]);
    const etat = readTasteState(raw[KEY_TASTE]);
    if (!etat.profile) return [];
    const appidOf = (o) => steamAppId(o) || (ratingFor(raw[KEY_RATINGS], o) || {}).appid || null;
    const manque = [...new Set(offers.map(appidOf).filter((id) => id && !etat.games[String(id)]))];
    let games = etat.games;
    if (manque.length) {
      const lus = await Promise.race([
        fetchTasteGames((u, i) => fetch(u, i), manque, { now: Date.now(), country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR' }),
        new Promise((fin) => setTimeout(() => fin(null), 5000)),
      ]);
      if (lus) {
        games = { ...games, ...lus };
        const frais = readTasteState((await readKeys(api, KEY_TASTE))[KEY_TASTE]);
        await write(api, { [KEY_TASTE]: { ...frais, games: { ...frais.games, ...lus } } });
      }
    }
    return [...notForYou(offers, { state: { ...etat, games }, appidOf })];
  } catch { return []; }
}

/**
 * Vos gouts (2.99.0), apres chaque cycle : les etiquettes des jeux que vous
 * aimez (ou ecartez) et des offres en cours, deux lots de cinquante au plus,
 * une fois toutes les six heures. Sans cookie. Voir watch/taste.js.
 */
let tasteRunning = null;
function maybeTaste(now = Date.now()) {
  if (tasteRunning) return tasteRunning;
  tasteRunning = (async () => {
    const settings = await readSettings(api);
    if (settings.taste === false) return null;
    const raw = await readKeys(api, [KEY_TASTE, KEY_COLLECTION_LOOKUP, KEY_LIBRARY, KEY_PLAYTIME, KEY_ANNOTATIONS, KEY_COUNTRY, KEYS.OFFERS, KEY_RATINGS]);
    const signals = signalsFrom({
      playtime: (raw[KEY_PLAYTIME] || {}).games || null,
      annotations: raw[KEY_ANNOTATIONS] || {},
      collection: raw[KEY_COLLECTION_LOOKUP] || null,
      library: raw[KEY_LIBRARY] || {},
    });
    const wanted = Object.values(raw[KEYS.OFFERS] || {})
      .filter((o) => o && o.state !== STATES.EXPIRED && !isExpired(o, now))
      .map((o) => steamAppId(o) || (ratingFor(raw[KEY_RATINGS], o) || {}).appid || null)
      .filter(Boolean);
    if (!tastePassDue(raw[KEY_TASTE], now, wanted)) return null;
    // Rien a comparer, et rien a apprendre : pas de requete.
    if (signals.filter((x) => x.s > 0).length < TASTE_MIN_LIKED && !readTasteState(raw[KEY_TASTE]).profile) return null;
    const next = await refreshTaste({
      fetch: (u, i) => fetch(u, i), signals, wanted, state: raw[KEY_TASTE], now,
      country: normaliseCountry(raw[KEY_COUNTRY]) || 'FR', lang: tagLanguage(currentLocale()),
    });
    await write(api, { [KEY_TASTE]: next });
    return next;
  })()
    .catch((e) => record('warn', 'vos gouts : lecture Steam impossible', e))
    .finally(() => { tasteRunning = null; });
  return tasteRunning;
}

/**
 * Les notes des jeux gratuits en ce moment et des week-ends Steam (2.78.0),
 * apres chaque cycle : huit au plus par passage, chacune relue une fois par
 * semaine. Voir watch/steam-ratings.js.
 */
async function maybeRatings(now = Date.now()) {
  try {
    const settings = await readSettings(api);
    if (settings.steamRatings === false) return null;
    const { [KEYS.OFFERS]: catalog, [KEY_WEEKENDS]: weekends } = await readKeys(api, [KEYS.OFFERS, KEY_WEEKENDS]);
    const suivis = settings.watchedStores || [];
    const offres = [
      ...openOffers(catalog || {}, now).filter((o) => suivis.includes(o.store)),
      ...((weekends && Array.isArray(weekends.items)) ? weekends.items : []),
    ];
    const r = await ensureRatings(offres);
    if (r && r.asked) record('info', `notes Steam : ${r.got}/${r.asked} relue(s)`);
    return r;
  } catch (e) {
    record('warn', 'notes Steam impossibles', e);
    return null;
  }
}

/* ------------------------------------------------ jaquettes (2.81.0) */

/* Une ecriture du registre a la fois, comme pour les notes : deux demandes
   du popup rapprochees perdraient sinon une jaquette. */
let coversChain = Promise.resolve();

function ensureCovers(titles) {
  const travail = async () => {
    const { [KEY_COVERS]: avant, [KEY_COUNTRY]: pays } = await readKeys(api, [KEY_COVERS, KEY_COUNTRY]);
    const r = await refreshCovers(avant || {}, (titles || []).slice(0, 40), {
      fetch: (u, i) => fetch(u, i), now: Date.now(), country: normaliseCountry(pays),
    });
    if (r.got) await write(api, { [KEY_COVERS]: r.covers });
    return { asked: r.asked, got: r.got };
  };
  const p = coversChain.then(travail, travail);
  coversChain = p.catch(() => null);
  return p;
}

/* ------------------------------------------------------ rappel des codes */

let codeRemindersRunning = null;

/**
 * Le rappel avant qu'un code expire (2.73.0). Voir watch/code-reminders.js.
 * Il suit le canal des ALERTES, pas celui des offres : un code qui va se
 * perdre demande une personne, comme une session perdue.
 */
function maybeCodeReminders(now = Date.now()) {
  if (codeRemindersRunning) return codeRemindersRunning;
  codeRemindersRunning = (async () => {
    await langue;
    const settings = await readSettings(api);
    const { [KEY_PHONE]: phoneRaw } = await readKeys(api, KEY_PHONE);
    const tel = phoneTarget(phoneRaw);
    return runCodeReminders({
      chrome: api,
      now,
      t,
      storeLabel: (s) => STORE_LABELS[s] || s,
      quietNow: inQuietHours(effectiveQuiet(settings), now),
      computer: settings.alertMode !== 'off',
      notify: ({ id, title, message, url }) => showNotice({ id, title, message, url: url || api.runtime.getURL(DASHBOARD_PAGE) }),
      phone: tel
        ? (msg) => pushToPhone({ chrome: api, fetch: (u, i) => fetch(u, i), target: tel, msg, now, record, why: 'rappel de code' })
        : null,
      record,
    });
  })()
    .catch((e) => record('warn', 'rappel des codes impossible', e))
    .finally(() => { codeRemindersRunning = null; });
  return codeRemindersRunning;
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

      /* La liste de souhaits voyage avec la bibliotheque : dans la meme
         reponse chez Steam, dans une lecture de plus chez GOG (2.66.0). Elle
         n'est remplacee que par une liste LUE : une importation ratee, ou une
         reponse qui ne la porte pas, laisse la precedente en place. */
      const cleSouhaits = { steam: KEY_STEAM_WISHLIST, gog: KEY_GOG_WISHLIST }[store];
      if (cleSouhaits && result.status === IMPORT_STATUS.OK && Array.isArray(result.wishlist)) {
        await write(api, { [cleSouhaits]: makeImportedWishlist(result.wishlist, normaliseTitle, Date.now()) });
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

/* ------------------------------------------------------ essai a blanc */

/** Garde intra-instance : deux essais simultanes ouvriraient deux fois les memes pages. */
let dryRunning = null;

/**
 * L'essai a blanc de chaque magasin reclame (2.64.0). L'arret d'urgence le
 * coupe comme il coupe tout ce qui ouvre une page de magasin.
 */
async function runDryRun() {
  if (await isStopped(api)) return { stopped: true };
  const raw = await readKeys(api, [KEYS.OFFERS]);
  const settings = await readSettings(api);
  return dryRunStores(storesToTest(settings), {
    chrome: api,
    catalog: raw[KEYS.OFFERS] || {},
    now: Date.now(),
    record,
    write: (etat) => write(api, { [KEY_DRY_RUN]: etat }),
  });
}

/* --------------------------------------------------- listeners, au niveau racine */

/* Un listener ne peut rien faire d'une promesse rejetee : sans ce catch, un
   alarms.create refuse devenait une « Uncaught (in promise) » dans
   chrome://extensions, sans que rien ne la journalise proprement. */
function planifier(origine) {
  ensureSchedule().catch((e) => record('error', `planification impossible (${origine})`, e));
}

api.alarms.onAlarm.addListener((alarme) => {
  if (alarme.name === ALARM_DISK) {
    checkDisk({ chrome: api, fetch: (u, i) => fetch(u, i), cycleBusy: !!cycleRunning, record })
      .catch((e) => record('warn', 'lecture du dossier de l\'extension impossible', e));
    return;
  }
  if (alarme.name === ALARM_MAIN) {
    startCycle('alarme principale').catch((e) => record('error', 'cycle impossible (alarme principale)', e));
    return;
  }
  if (alarme.name === ALARM_NET) {
    // Le filet ne travaille pas : il verifie que la principale existe encore.
    planifier('filet');
  }
});

/* Les raccourcis clavier (2.69.0), declares dans `commands` du manifeste.
 *
 * Le popup a le sien, `_execute_action`, que le navigateur traite seul. Les
 * deux autres arrivent ici : ouvrir le tableau de bord -- la page d'options,
 * donc l'onglet deja ouvert s'il existe -- et verifier maintenant, par le meme
 * chemin que le bouton du popup. Aucune permission : un raccourci n'est qu'un
 * geste de plus de l'utilisateur. Firefox les prend tels quels. */
if (api.commands && api.commands.onCommand) {
  api.commands.onCommand.addListener((commande) => {
    if (commande === 'open-dashboard') {
      api.runtime.openOptionsPage().catch((e) => record('warn', 'tableau de bord impossible a ouvrir (raccourci)', e));
      return;
    }
    if (commande === 'check-now') {
      record('info', 'verification demandee au clavier');
      startCycle('raccourci clavier', { force: true })
        .catch((e) => record('error', 'cycle impossible (raccourci clavier)', e));
    }
  });
}

api.runtime.onStartup.addListener(() => planifier('demarrage'));

// Une mise a jour efface les alarmes : 'update' compte autant que 'install'.
api.runtime.onInstalled.addListener(() => planifier('installation'));

/* La langue choisie dans les reglages (Apparence -> Langue).
 *
 * Seules les PAGES l'appliquaient : le worker parlait la langue du navigateur.
 * Ses notifications, les phrases des fiches et les libelles du bouton de page
 * ignoraient donc le choix. Il la lit maintenant a chaque reveil et la suit
 * quand elle change ; ce qui compose un texte attend `langue` d'abord. */
const KEY_UI = 'veille:ui';

async function appliquerLangue() {
  const raw = await readKeys(api, KEY_UI);
  const ui = raw[KEY_UI] || {};
  setLocale(ui.language && ui.language !== 'auto' ? ui.language : null);
}

const langue = appliquerLangue().catch(() => {});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[KEY_UI]) return;
  const ui = changes[KEY_UI].newValue || {};
  setLocale(ui.language && ui.language !== 'auto' ? ui.language : null);
  // Le menu du clic droit parle la langue choisie, lui aussi (2.79.0).
  if (api.contextMenus) {
    for (const id of [MENU_PAGE, MENU_LINK]) api.contextMenus.update(id, { title: t('ctxWishMenu') }, () => void api.runtime.lastError);
  }
});

/* --------------------------------------------- la barre d'adresse (2.85.0) */

/* « fg » puis un titre : voir watch/omnibox.js. Les donnees sont lues une fois
   et gardees tant que le stockage ne change pas -- chaque lettre tapee
   relancerait sinon la lecture d'une collection de plusieurs milliers de
   jeux. */
const OMNI_KEYS = [KEYS.OFFERS, KEY_LIBRARY, KEY_COLLECTION_LOOKUP, KEY_WISHLIST, KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST, KEYS.SOURCES, KEYS.SETTINGS];
let omniCache = null;

async function omniData() {
  if (omniCache) return omniCache;
  const raw = await readKeys(api, OMNI_KEYS);
  omniCache = {
    catalog: raw[KEYS.OFFERS] || {},
    library: raw[KEY_LIBRARY] || {},
    collection: (raw[KEY_COLLECTION_LOOKUP] || {}).items || {},
    wishlist: raw[KEY_WISHLIST] || [],
    steamWishlist: raw[KEY_STEAM_WISHLIST] || null,
    gogWishlist: raw[KEY_GOG_WISHLIST] || null,
    sources: raw[KEYS.SOURCES] || {},
    watched: normaliseSettings(raw[KEYS.SETTINGS]).watchedStores,
  };
  return omniCache;
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && OMNI_KEYS.some((k) => changes[k])) omniCache = null;
});

/** « 3 oct. », ou « 3 oct. 2025 » quand ce n'est pas cette annee. */
function omniDate(ms) {
  const d = new Date(ms);
  const autreAnnee = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', ...(autreAnnee ? { year: 'numeric' } : {}) });
}

if (api.omnibox) {
  api.omnibox.onInputStarted.addListener(() => {
    langue.then(() => api.omnibox.setDefaultSuggestion({ description: escapeXml(t('omniDefault')) })).catch(() => {});
  });
  api.omnibox.onInputChanged.addListener((text, suggest) => {
    langue
      .then(omniData)
      .then((data) => suggest(omniSuggestions(text, { ...data, now: Date.now() }, {
        t, storeLabel: (s) => STORE_LABELS[s] || s, dateText: omniDate,
      })))
      .catch(() => suggest([]));
  });
  api.omnibox.onInputEntered.addListener((text, disposition) => {
    const url = omniTarget(text, api.runtime.getURL('pages/popup.html?vue=onglet'));
    if (disposition === 'currentTab') api.tabs.update({ url }).catch(() => {});
    else api.tabs.create({ url, active: disposition !== 'newBackgroundTab' }).catch(() => {});
  });
}

/* ------------------------------------------- souhait par clic droit (2.79.0) */

/* Les entrees du menu survivent aux redemarrages : on les (re)cree a
   l'installation et a la mise a jour, jamais a chaque reveil. Voir
   watch/context-wish.js. */
async function installerMenus() {
  if (!api.contextMenus) return;
  await langue;
  await new Promise((fin) => api.contextMenus.removeAll(() => { void api.runtime.lastError; fin(); }));
  for (const item of menuItems(t('ctxWishMenu'))) {
    api.contextMenus.create(item, () => {
      const err = api.runtime.lastError;
      if (err) record('warn', `menu du clic droit : ${err.message || err}`);
    });
  }
}

api.runtime.onInstalled.addListener(() => {
  installerMenus().catch((e) => record('warn', 'menu du clic droit impossible', e));
});

if (api.contextMenus && api.contextMenus.onClicked) {
  api.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_PAGE && info.menuItemId !== MENU_LINK) return;
    langue
      .then(() => wishFromClick({ info, tab, chrome: api, t, notify: showNotice, record }))
      .catch((e) => record('warn', 'souhait par clic droit impossible', e));
  });
}

/* Le dossier de l'extension mis a jour (2.53.0) : voir watch/self-update.js.
 * L'alarme n'existe que pour une installation depuis un dossier ; une version
 * du Web Store n'en a pas, et une alarme restee d'avant est retiree. */
async function armerDisque() {
  let dev = false;
  try {
    dev = !!(api.management && api.management.getSelf && (await api.management.getSelf()).installType === 'development');
  } catch { dev = false; }
  const alarme = await api.alarms.get(ALARM_DISK);
  if (dev && !alarme) await api.alarms.create(ALARM_DISK, { periodInMinutes: DISK_PERIOD_MIN });
  if (!dev && alarme) await api.alarms.clear(ALARM_DISK);
}

/* Apres un rechargement vers une version plus recente : le dire, une fois. */
api.runtime.onInstalled.addListener((details) => {
  const n = updatedNotice(details, api.runtime.getManifest().version);
  if (!n) return;
  record('info', `mise a jour appliquee : ${n.from} -> ${n.to}`);
  langue
    .then(() => api.notifications.create('fgc-mise-a-jour', {
      type: 'basic', iconUrl: 'icons/icon128.png', title: t('updatedTitle'), message: t('updatedBody', n.to),
    }))
    .catch((e) => record('warn', 'notification de mise a jour impossible', e));
});

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

  if (msg.type === 'fgc-pret' || msg.type === 'fgc-verdict' || msg.type === 'fgc-inspection') {
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
    /* Le moteur n'envoie plus une phrase mais des pieces, { key, args }
       (2.55.0) : elles se composent ici, dans la langue choisie. */
    // create() rend une promesse : le try/catch d'origine ne voyait jamais son rejet.
    langue
      .then(() => readSettings(api))
      .then((settings) => {
        /* En vacances (2.84.0), le moteur continue de recuperer dans ses
           fenetres reduites -- sans le dire : le retour le resumera. */
        if (onVacation(settings.vacation, Date.now())) return null;
        return api.notifications.create('', {
          type: 'basic', iconUrl: 'icons/icon128.png', title: engineTitle(msg.title), message: composeEngineText(msg.text, t),
        });
      })
      .catch((e) => record('warn', 'notification impossible', e));
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
  /* Le bouton « tableau de bord » du panneau de la page (2.62.0). Une page
     de magasin ne peut pas ouvrir une page d'extension elle-meme ; elle le
     demande, et le worker ouvre la page d'options -- ou ramene l'onglet
     deja ouvert. Rien d'autre : pas d'adresse dans le message. */
  if (msg.type === 'fgc-open-dashboard') {
    api.runtime.openOptionsPage().catch(() => {});
    return;
  }

  /* L'anti-doublon (2.87.0) : deja a vous ailleurs ? La decision est dans
     watch/owned-guard.js ; ici, la lecture du stockage et les mots. */
  if (msg.type === 'fgc-owned-guard') {
    (async () => {
      await langue;
      const url = String((sender && sender.tab && sender.tab.url) || msg.url || '');
      if (!isProductPage(url)) { sendResponse({ show: false }); return; }
      const raw = await readKeys(api, [KEYS.OFFERS, KEY_LIBRARY, KEY_COLLECTION_LOOKUP]);
      const candidats = (Array.isArray(msg.candidates) ? msg.candidates : [])
        .filter((c) => typeof c === 'string').map((c) => c.slice(0, 200)).slice(0, 5);
      const r = ownedElsewhere({
        candidates: candidats,
        pageStore: guardStoreOf(url),
        library: raw[KEY_LIBRARY] || {},
        collection: (raw[KEY_COLLECTION_LOOKUP] || {}).items || {},
        catalog: raw[KEYS.OFFERS] || {},
        normalise: normaliseTitle,
        now: Date.now(),
      });
      if (!r) { sendResponse({ show: false }); return; }
      const dateText = (ts) => new Date(ts).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
      const storeLabel = (s) => STORE_LABELS[s] || s;
      sendResponse({
        show: true,
        title: r.title,
        heading: t('guardHeading'),
        intro: t('guardIntro'),
        close: t('sentinelClose'),
        lines: guardLines(r, { t, storeLabel, dateText }),
      });
    })().catch(() => sendResponse({ show: false }));
    return true;
  }

  if (msg.type === 'fgc-lookup') {
    (async () => {
      await langue;
      const raw = await readKeys(api, [
        KEYS.OFFERS, KEY_LIBRARY, KEY_COLLECTION_LOOKUP, KEY_OUTCOMES, KEYS.SETTINGS, KEY_UI,
      ]);
      const now = Date.now();
      const facts = lookup({
        title: msg.title,
        store: msg.store || null,
        catalog: raw[KEYS.OFFERS] || {},
        library: raw[KEY_LIBRARY] || {},
        collection: (raw[KEY_COLLECTION_LOOKUP] || {}).items || {},
        outcomes: raw[KEY_OUTCOMES] || {},
        normalise: normaliseTitle,
        now,
      });
      /* Les phrases partent avec les faits, dans la langue du lecteur : la
         lanceur n'a pas de table de traduction (voir factLines). Ses
         libelles partent aussi, pour la meme raison ; hors d'une fiche, le
         titre est vide et seuls eux ont un sens. */
      const dateText = (ts) => new Date(ts).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
      const storeLabel = (s) => STORE_LABELS[s] || s;
      /* Le panneau redessine (2.62.0) : le jeu de la page en carte, et ce
         qui est gratuit en ce moment -- les memes offres que la liste du
         popup. Les preferences d'affichage (refus, « masquer ce que je
         possede ») sont LUES ici pour cela seulement : le worker n'agit
         jamais d'apres elles. */
      const catalog = raw[KEYS.OFFERS] || {};
      const settings = raw[KEYS.SETTINGS] || {};
      const ui = raw[KEY_UI] || {};
      /* La note Steam du jeu de la fiche (2.82.0), sur Epic et GOG -- la fiche
         Steam la montre deja. A part des faits : elle ne compte pas dans la
         pastille et ne fait pas parler la bulle, puisque presque chaque fiche
         en a une. Cherchee si besoin, trois secondes et demie au plus. */
      let rating = null;
      const offre = { title: String(msg.title || ''), store: msg.store || null };
      if (offre.title && offre.store !== 'steam' && settings.steamRatings !== false && ratingEligible(offre)) {
        let notes = (await readKeys(api, KEY_RATINGS))[KEY_RATINGS] || {};
        if (needsRating(notes, offre, now)) {
          await Promise.race([
            ensureRatings([offre], { limit: 1, timeoutMs: 3000 }),
            new Promise((fin) => setTimeout(fin, 3500)),
          ]).catch(() => null);
          notes = (await readKeys(api, KEY_RATINGS))[KEY_RATINGS] || {};
        }
        const r = ratingFor(notes, offre);
        if (r) rating = { text: ratingLine(r), tone: ratingTone(r) };
      }
      sendResponse({
        rating,
        facts,
        lines: factLines(facts, { t, storeLabel, dateText }),
        labels: launcherLabels(t),
        /* Les etats du moteur, en modeles : le lanceur les remplit (2.55.0). */
        engine: engineTemplates(t, keysWith('eng')),
        game: pageGame(catalog, {
          title: msg.title, store: msg.store || null, normalise: normaliseTitle, now, t, storeLabel,
        }),
        free: freeNowList(catalog, {
          now,
          t,
          storeLabel,
          watched: Array.isArray(settings.watchedStores) ? settings.watchedStores : DEFAULT_SETTINGS.watchedStores,
          dismissed: Array.isArray(ui.dismissed) ? ui.dismissed : [],
          hideOwned: ui.hideOwned === true,
        }),
      });
    })().catch(() => sendResponse({ facts: [] }));
    return true;
  }

  /* « Mettre a jour maintenant » (2.54.0) : le relais fait le git pull, puis
     le disque est relu tout de suite. La reponse part AVANT le rechargement,
     qui fermera le popup. */
  if (msg.type === 'fgc-maj') {
    (async () => {
      const r = await requestUpdate({ chrome: api });
      record(r.ok ? 'info' : 'warn', `mise a jour demandee depuis le popup : ${r.etat}`);
      const disk = r.ok
        ? await checkDisk({ chrome: api, fetch: (u, i) => fetch(u, i), cycleBusy: !!cycleRunning, record, delayMs: 1200 })
        : null;
      sendResponse({ ...r, disk, running: api.runtime.getManifest().version });
    })().catch((e) => sendResponse({ ok: false, etat: 'echec', detail: String((e && e.message) || e) }));
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

  /* Tester la recuperation, sans rien recuperer (2.64.0). Un geste, jamais
     un automatisme : chaque essai ouvre une page de magasin avec la session
     de l'utilisateur. Voir watch/dry-run.js. */
  if (msg.type === 'fgc-dry-run') {
    if (dryRunning) { sendResponse({ busy: true }); return; }
    dryRunning = runDryRun();
    dryRunning
      .then((etat) => sendResponse({ ok: true, ...etat }))
      .catch((e) => {
        record('warn', 'essai a blanc impossible', e);
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      })
      .finally(() => { dryRunning = null; });
    return true;
  }

  /* Restaurer une sauvegarde (2.74.0). Le fichier a ete lu par la page ; le
     worker relit le stockage, fusionne et ecrit en une fois -- il est le seul
     ecrivain du registre et des listes. Voir watch/full-backup.js. */
  if (msg.type === 'fgc-restore') {
    restoreBackup(api, msg.data, { now: Date.now() })
      .then((r) => {
        if (r.ok) record('info', `sauvegarde restauree : ${Object.values(r.added).reduce((n, x) => n + x, 0)} element(s) ajoute(s)`);
        sendResponse(r);
      })
      .catch((e) => {
        record('warn', 'restauration impossible', e);
        sendResponse({ ok: false, reason: String((e && e.message) || e) });
      });
    return true;
  }

  if (msg.type === 'fgc-vacation-back') {
    maybeReturn(Date.now()).then(sendResponse);
    return true;
  }

  if (msg.type === 'fgc-covers') {
    const titres = Array.isArray(msg.titles) ? msg.titles.filter((x) => typeof x === 'string') : [];
    ensureCovers(titres)
      .then(sendResponse)
      .catch((e) => { record('warn', 'jaquettes impossibles', e); sendResponse({ asked: 0, got: 0 }); });
    return true;
  }

  if (msg.type === 'fgc-taste') {
    maybeTaste(Date.now())
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'fgc-tonight') {
    maybeTonight(Date.now(), { force: true })
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (msg.type === 'fgc-auto-backup') {
    maybeAutoBackup(Date.now(), { force: true }).then(sendResponse);
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
armerDisque().catch((e) => record('warn', 'alarme du dossier impossible', e));
