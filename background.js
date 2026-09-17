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
  rememberNotificationLink, readNotificationLink,
} from './watch/storage.js';
import { reportVerdict, isPiloted, sweepTabs, tabVanished } from './watch/claim.js';
import { claimAllNow, pruneNow, retryNow } from './watch/commands.js';
import { KEY_LIBRARY, addedEntries, integrateHistory } from './watch/library.js';
import { KEY_JOURNAL, makeEntry, appendTo, clearJournal } from './watch/journal.js';
import { KEY_CANARY, acknowledge } from './watch/canary.js';
import { KEY_CODES, mirrorCodes, restoreCodes, hasSync } from './watch/backup.js';
import { KEY_SENTINEL, writeBeat, clearBeat } from './watch/sentinel.js';

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
        notify: async ({ title, text, id, url }) => {
          try {
            // Le lien est retenu AVANT l'affichage : le clic peut arriver des
            // heures plus tard, sur un service worker qui a tout oublie.
            if (url) await rememberNotificationLink(api, id, url);
            await api.notifications.create(id, {
              type: 'basic',
              iconUrl: 'icon128.png',
              title: title,
              message: text,
            });
          } catch (e) {
            record('warn', 'notification impossible', e);
          }
        },
        updateBadge: async (n) => {
          try {
            await api.action.setBadgeText({ text: n > 0 ? String(n) : '' });
            await api.action.setBadgeBackgroundColor({ color: '#FF8A3D' });
          } catch (e) { /* le badge est un bonus */ }
        },
        record,
        offline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
        // Steam n'est jamais de cette liste : detecte et affiche, jamais clique.
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

  const lots = Object.entries(changes)
    .filter(([key]) => key.startsWith('FGC_history_'))
    .map(([key, change]) => ({
      platform: key.slice('FGC_history_'.length),
      added: addedEntries(change.oldValue, change.newValue),
    }))
    .filter((l) => l.added.length);

  if (!lots.length) return;

  (async () => {
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
        record('info', `bibliotheque : ${total} entree(s) figee(s)`);
      }
    } catch (e) {
      // Un registre qui echoue ne doit jamais empecher une reclamation.
      record('warn', 'bibliotheque non mise a jour', e);
    }
  })();
});

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

api.notifications.onClicked.addListener((id) => {
  // Mener a l'offre, jamais a une page d'accueil : c'est tout l'interet du
  // clic. Le popup reste le repli quand on ne sait pas ou aller.
  readNotificationLink(api, id)
    .then((url) => api.tabs.create({ url: url || api.runtime.getURL('popup.html'), active: true }))
    .catch(() => api.tabs.create({ url: api.runtime.getURL('popup.html'), active: true }))
    .catch((e) => record('warn', 'ouverture depuis la notification impossible', e));
  api.notifications.clear(id).catch(() => { /* deja fermee */ });
});

/* ------------------------------------------- relais du moteur (inchange, V1) */

api.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

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
    fetch(msg.url, { method: msg.method || 'GET', headers: msg.headers || {}, credentials: 'omit' })
      .then(function (r) { return r.text().then(function (body) { sendResponse({ status: r.status, body: body }); }); })
      .catch(function (e) { sendResponse({ error: String(e && e.message || e) }); });
    return true;
  }

  if (msg.type === 'fgc-notify') {
    // create() rend une promesse : le try/catch d'origine ne voyait jamais son rejet.
    api.notifications.create('', {
      type: 'basic', iconUrl: 'icon128.png', title: String(msg.title || ''), message: String(msg.text || ''),
    }).catch((e) => record('warn', 'notification impossible', e));
    return;
  }

  if (msg.type === 'fgc-open-tab') {
    /* Si la demande vient d'un onglet PILOTE -- une reclamation invisible --
       le nouvel onglet doit naitre dans la MEME fenetre reduite, jamais dans
       celle de l'utilisateur. Sans cela, l'echange GOG declenche depuis Luna
       ouvrait un onglet en pleine session de l'utilisateur, et la fermeture de
       la fenetre de reclamation ne l'emportait pas. */
    const senderTabId = msg && sender && sender.tab ? sender.tab.id : undefined;
    const senderWindowId = sender && sender.tab ? sender.tab.windowId : undefined;
    const echec = (e) => record('warn', `ouverture d'onglet impossible : ${msg.url}`, e);
    if (senderTabId !== undefined) {
      isPiloted(api, senderTabId)
        .then((piloted) => api.tabs.create(
          piloted && senderWindowId !== undefined
            ? { url: msg.url, active: false, windowId: senderWindowId }
            : { url: msg.url, active: !!msg.active },
        ))
        .catch(() => api.tabs.create({ url: msg.url, active: !!msg.active }))
        .catch(echec);
      return;
    }
    api.tabs.create({ url: msg.url, active: !!msg.active }).catch(echec);
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
