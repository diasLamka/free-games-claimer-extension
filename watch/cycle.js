/* Un cycle de veille : planifier, interroger, integrer, persister, annoncer.
 *
 * C'est le seul module de la veille qui touche a chrome.*, et encore : tout y
 * est injecte. Il n'appelle jamais Date.now() ni fetch directement, ce qui le
 * rend jouable de bout en bout dans les tests avec le faux chrome.
 *
 * L'ordre des operations n'est pas negociable, et chaque etape est la parce
 * qu'un mode d'echec la reclame :
 *
 *   1. rearmer le reveil AVANT le travail. Une alarme ponctuelle est detruite
 *      par le navigateur quand elle se declenche ; si le service worker meurt
 *      pendant le cycle, plus rien ne le relancerait jamais.
 *   2. persister le catalogue AVANT de notifier. Entre les deux, le worker peut
 *      mourir. On prefere perdre une notification qu'en envoyer deux.
 *   3. notifier ce qui n'a PAS de notifieLe, pas ce que le cycle appelle
 *      "nouveau". Le second se recalcule et double ; le premier est persiste.
 */
import { integrate, purgeExpired, openOffers } from './catalog.js';
import { STATES, STORE_LABELS, isExpired, byUrgency } from './offer.js';
import {
  schedule,
  afterSuccess,
  afterFailure,
  DEFAULTS as SCHEDULER_DEFAULTS,
} from './schedule/scheduler.js';
import { observe, learnedHotInstants, emptyStat } from './schedule/prediction.js';
import { KEY_CANARY, observe as observeCanary, newAlerts, alertLine } from './canary.js';
import { split } from './filters.js';
import {
  decideAnnouncement, endingSoon, badgeCount, onlyWatched,
} from './notify-policy.js';
import { t } from '../i18n.js';
import {
  claimOffer,
  hasRoom,
  recordClaim,
  VERDICTS,
  FINAL_VERDICTS,
  HUMAN_VERDICTS,
  MANUAL_VERDICTS,
  MAX_ATTEMPTS,
  nextAttemptAt,
  BUDGET_MS,
  sweepTabs,
} from './claim.js';
import {
  readContext,
  writeCycle,
  withLease,
  checkSchema,
  SCHEMA,
  KEYS,
} from './storage.js';

/**
 * Reclamations par cycle. Le service worker meurt au-dela de cinq minutes par
 * evenement ; une reclamation mesuree prend 23 secondes. Trois laisse une
 * marge confortable, et le plafond horaire fait le reste.
 */
export const MAX_CLAIMS_PER_CYCLE = 3;

/**
 * Arret d'urgence.
 *
 * Dans l'espace FGC_* et non veille:*, seule cle de la veille dans ce cas : le
 * MOTEUR doit la lire de facon synchrone avant chaque clic, et il ne connait que
 * cet espace. Le prix est une ligne dans ENGINE_KEYS de gm-shim.js ; le prix de
 * l'alternative serait un interrupteur auquel le moteur n'obeit pas.
 */
export const KEY_STOP = 'FGC_kill_switch';

/**
 * Une reponse est traitee comme liste complete seulement si elle est
 * credible. Sous ce ratio de la derniere taille connue, on la considere
 * partielle : une panne de deux cycles effacerait sinon la moitie du
 * catalogue, et le mecanisme concu pour rattraper les offres retirees
 * deviendrait celui qui les detruit.
 */
export const CREDIBLE_LIST_RATIO = 0.5;

/** Nombre maximum de lacunes d'observation conservees par source. */
const MAX_GAPS = 50;

/* --------------------------------------------------------------- notification */

/** "3 h" / "45 min" -- l'unite d'un rappel, jamais des secondes. */
function readableHours(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h`;
}

/** Les offres du catalogue qui n'ont jamais ete annoncees. */
export function toNotify(catalog) {
  return Object.values(catalog || {}).filter(
    (o) => !o.notifiedAt && o.state !== STATES.EXPIRED,
  );
}

/**
 * Compose le message. Une notification par offre au-dela de trois, c'est un
 * harcelement : au-dela on resume.
 */
export function composeAnnouncement(offers, storeLabel) {
  if (offers.length === 1) {
    const o = offers[0];
    // Le libelle du magasin, pas son identifiant : « Epic Games Store » plutot
    // que « epic ». L'injection reste possible pour les tests.
    const store = storeLabel ? storeLabel(o.store) : (STORE_LABELS[o.store] || o.store);
    return {
      title: t('notifyOneTitle', o.title),
      text: t('notifyOneStore', store),
    };
  }
  const titles = offers.slice(0, 3).map((o) => o.title).join(', ');
  const left = offers.length - 3;
  return {
    title: t('notifyManyTitle', String(offers.length)),
    text: left > 0 ? t('notifyManyBody', titles, String(left)) : titles,
  };
}

/* -------------------------------------------------------------- observation */

/**
 * Note l'intervalle pendant lequel une source n'a PAS ete observee.
 *
 * Sans ce journal, la couche B de la prediction apprendra le rythme de nos
 * propres sondages au lieu de celui du magasin -- le principal risque du
 * sous-systeme, identifie des le design.
 */
export function noteGap(sourceState, now, nominalStepMs) {
  const latest = sourceState.lastSuccess;
  if (!latest) return sourceState;
  if (now - latest < 2 * nominalStepMs) return sourceState;

  const gaps = [...(sourceState.gaps || []), { start: latest, end: now }];
  return { ...sourceState, gaps: gaps.slice(-MAX_GAPS) };
}

/* -------------------------------------------------------------------- cycle */

/**
 * Execute un cycle complet.
 *
 * `sources`     registre { nom: { decouvrir, listeComplete, intervalleMinimalMs } }
 * `notifier`    async ({ titre, texte, id }) -> void
 * `majBadge`    async (nombre) -> void
 * `journaliser` (niveau, message, details) -> void
 * `horsLigne`   () -> bool, pour ne pas compter une coupure reseau comme un
 *               echec de la source
 */
export async function runCycle({
  chrome,
  now,
  sources,
  fetch: fetchImpl,
  notify = async () => {},
  updateBadge = async () => {},
  record = () => {},
  offline = () => false,
  force = false,
  webLocks,
  /** Magasins ou l'extension a le droit de cliquer. Steam n'y est jamais. */
  claimableStores = [],
  /** Faux en test, ou quand l'utilisateur coupe la reclamation autonome. */
  autonomousClaim = true,
  maxReclamations = MAX_CLAIMS_PER_CYCLE,
}) {
  if (typeof now !== 'number') throw new TypeError('executerCycle : "maintenant" est obligatoire');

  /* Arret d'urgence : avant tout, y compris avant la verification de schema.
     Un interrupteur qui demande a l'extension de ne rien faire ne doit pas
     commencer par ecrire un numero de version. */
  const stop = await chrome.storage.local.get(KEY_STOP);
  if (stop[KEY_STOP] === true) {
    record('warn', 'arret d\'urgence actif : cycle annule');
    return { stopped: true, reason: 'arret d\'urgence' };
  }

  const schema = await checkSchema(chrome);
  if (schema.state === SCHEMA.TOO_RECENT) {
    record('error', 'veille arretee : ' + schema.message);
    return { stopped: true, reason: schema.message };
  }

  const result = await withLease(chrome, 'veille-cycle', async () => {
    const ctx = await readContext(chrome);
    const names = Object.keys(sources).filter(
      (n) => force || ctx.settings.activeSources.includes(n),
    );

    const plan = schedule({
      sources: names,
      states: ctx.sources,
      settings: ctx.settings,
      rulesBySource: ctx.schedules,
      windowsBySource: Object.fromEntries(names.map((n) => [n, [
        // Ce que la source annonce elle-meme (Epic publie ses ouvertures)...
        ...windowInstants(ctx.sources[n] && ctx.sources[n].announcedWindows),
        // ...et ce que la couche apprenante a deduit de l'historique.
        ...learnedHotInstants((ctx.stats && ctx.stats[n]) || emptyStat(), now),
      ]])),
      chasesBySource: Object.fromEntries(
        names.map((n) => [n, hasPendingOffers(ctx.catalog, n, now)]),
      ),
      minIntervals: Object.fromEntries(
        names.map((n) => [n, sources[n].minIntervalMs || 0]),
      ),
      now,
    });

    const toQuery = force ? names : plan.dueList;
    record('info', `cycle : ${toQuery.length} source(s) a interroger`, {
      dueList: toQuery,
      nextWake: plan.nextWake,
    });

    /* Avant tout : rattraper ce qu'un worker mort a laisse en plan. Une
       reclamation interrompue reste marquee CLAIMING pour toujours sinon, et
       l'offre n'est plus jamais candidate. */
    const rattrapage = reclaimAbandoned(ctx.catalog, now);
    if (rattrapage.recovered) {
      record('warn', `${rattrapage.recovered} reclamation(s) interrompue(s) rattrapee(s)`);
    }
    let catalog = rattrapage.catalog;
    const sourceStates = { ...ctx.sources };
    const stats = { ...ctx.stats };
    const anomalies = [];

    for (const name of toQuery) {
      const source = sources[name];
      let state = sourceStates[name] || {};

      let r;
      try {
        r = await source.discover({ fetch: fetchImpl, now });
      } catch (e) {
        r = { offers: [], errors: [(e && e.message) || String(e)] };
      }

      const failure = r.errors && r.errors.length > 0 && r.offers.length === 0;

      if (failure) {
        // Une coupure reseau n'est pas une panne de la source : la compter
        // gelerait la veille six heures juste au moment ou l'utilisateur
        // rouvre son portable.
        if (offline()) {
          record('warn', `${name} : hors ligne, echec non compte`, { errors: r.errors });
        } else {
          state = afterFailure(state, now, r.errors.join(' ; '));
          record('warn', `${name} : echec`, { errors: r.errors, failures: state.consecutiveFailures });
        }
        sourceStates[name] = { ...state, lastCycle: now, lastError: r.errors.join(' ; ') };
        continue;
      }

      // Credibilite de la liste avant d'en tirer des disparitions.
      const currentSize = r.offers.length;
      const knownSize = state.lastSize;
      const credible = source.completeList
        && Array.isArray(r.offers)
        && (knownSize === undefined
          || currentSize >= Math.floor(knownSize * CREDIBLE_LIST_RATIO));

      if (source.completeList && !credible) {
        anomalies.push(`${name} : liste tombee de ${knownSize} a ${currentSize}, traitee comme partielle`);
        record('warn', anomalies[anomalies.length - 1]);
      }

      state = noteGap(state, now, SCHEDULER_DEFAULTS.horizonMs / 7);

      const integration = integrate(catalog, r.offers, {
        now,
        source: name,
        completeList: credible,
      });
      catalog = integration.catalog;

      // La couche apprenante n'apprend que sur les NOUVELLES offres : une offre
      // deja connue, revue a chaque cycle, gonflerait la case de nos propres
      // heures de sondage -- exactement le biais que la conception combat.
      for (const fresh of integration.freshOffers) {
        stats[name] = observe(stats[name] || emptyStat(), fresh, {
          now,
          lastEmptyPoll: state.lastSuccess ?? null,
        });
      }

      state = afterSuccess(state, now);
      sourceStates[name] = {
        ...state,
        lastSuccess: now,
        lastCycle: now,
        lastError: null,
        lastSize: currentSize,
        // Epic annonce ses prochaines ouvertures : gardees entieres, avec
        // titre et vignette. L'ordonnanceur n'en lit que l'instant ; le popup
        // s'en sert pour montrer ce qui arrive.
        announcedWindows: (r.nextWindows || []).slice(0, 12),
      };

      record('info', `${name} : ${r.offers.length} offre(s), ${integration.freshOffers.length} nouvelle(s)`, {
        dropped: (r.dropped || []).length,
        vanished: integration.vanished.length,
        expired: integration.expired.length,
      });
    }

    const { catalog: purge } = purgeExpired(catalog, { now });
    catalog = purge;

    /* ---- amorcage : le premier cycle ne notifie pas ---- */

    const pending = toNotify(catalog);
    let announcements = [];
    let nextState = { ...ctx.state };

    if (!ctx.state.booted) {
      // On marque tout comme deja annonce, sans rien envoyer. L'agregateur rend
      // une vingtaine d'offres en cours, dont certaines publiees il y a des
      // annees : les annoncer toutes a l'installation ferait couper les
      // notifications, et cette erreur-la ne se rattrape pas.
      for (const o of pending) catalog[o.catalogKey] = { ...o, notifiedAt: now };
      nextState.booted = true;
      record('info', `amorcage : ${pending.length} offre(s) enregistrees sans notification`);
    } else {
      announcements = byUrgency(pending, now);
    }

    const unseen = openOffers(catalog).filter((o) => !o.seen).length;
    nextState = {
      ...nextState,
      lastCycle: now,
      nextCycle: plan.nextWake,
      lastError: anomalies.length ? anomalies.join(' | ') : null,
      unseen,
    };

    // Persister AVANT de notifier. Une mort du worker entre les deux coute une
    // notification, pas une offre.
    await writeCycle(chrome, { catalog, sources: sourceStates, state: nextState, stats });

    /* ---- annonce ---- */

    /* Les magasins que l'utilisateur ne suit pas restent au CATALOGUE mais ne
       declenchent rien. Les retirer du catalogue ferait qu'activer un magasin
       n'y montrerait rien avant le cycle suivant ; les annoncer quand meme
       reviendrait a ignorer le reglage. */
    const watched = onlyWatched(announcements, ctx.settings.watchedStores);

    const decision = decideAnnouncement({
      mode: ctx.settings.notifyMode,
      quiet: ctx.settings.quiet,
      now,
      count: watched.length,
      lastDigestAt: ctx.state.lastDigestAt ?? null,
    });

    if (decision.notify) {
      const first = watched[0];
      const { title, text } = decision.digest
        ? { title: t('notifyDigestTitle', String(watched.length)), text: watched.map((o) => o.title).join(', ') }
        : composeAnnouncement(watched);
      // Le lien de la premiere offre annoncee : cliquer la notification doit
      // mener a l'offre, pas a une page d'accueil.
      await notify({
        title,
        text,
        id: `veille-${now}`,
        url: first.url || first.resolveUrl || null,
      });
    }

    /* ---- rappel avant expiration ---- */

    // Une offre qui se termine bientot et qui n'a pas ete traitee merite un
    // second signal : la premiere notification a pu tomber pendant la nuit. Le
    // seuil est un reglage ; a zero, pas de rappel.
    const closing = endingSoon(onlyWatched(openOffers(catalog), ctx.settings.watchedStores), {
      now,
      hours: ctx.settings.reminderHours,
      isFinal: (v) => FINAL_VERDICTS.includes(v),
    });

    const remind = decideAnnouncement({
      mode: ctx.settings.notifyMode,
      quiet: ctx.settings.quiet,
      now,
      // Un rappel n'attend pas le resume quotidien : l'offre se termine avant.
      count: ctx.state.booted ? closing.length : 0,
      lastDigestAt: null,
    });

    if (remind.notify) {
      const reminded = { ...catalog };
      for (const o of closing) reminded[o.catalogKey] = { ...reminded[o.catalogKey], remindedAt: now };
      catalog = reminded;
      await writeCycle(chrome, { catalog });

      const name = closing[0].title;
      const left = readableHours(closing[0].end - now);
      await notify({
        title: t('notifyEndingTitle', closing.length === 1 ? name : `${name} +${closing.length - 1}`),
        text: t('notifyEndingBody', left),
        id: `expire-${now}`,
        url: closing[0].url || closing[0].resolveUrl || null,
      });
    }

    await updateBadge(badgeCount({
      mode: ctx.settings.badgeMode,
      unseen,
      offers: openOffers(catalog),
      now,
    }));

    /* `notifiedAt` marque ce qui a ete annonce. En heures calmes, ou avant
       l'heure du resume, on ne le pose PAS : c'est exactement ce qui fait la
       difference entre differer une annonce et la perdre. */
    if (watched.length && !decision.hold) {
      const timestamped = { ...catalog };
      for (const o of watched) timestamped[o.catalogKey] = { ...timestamped[o.catalogKey], notifiedAt: now };
      catalog = timestamped;
      await writeCycle(chrome, { catalog });
    }

    if (decision.digest && decision.notify) {
      nextState.lastDigestAt = now;
      await writeCycle(chrome, { state: nextState });
    }

    /* ---- reclamation autonome ---- */

    let claims = [];
    let cadence = ctx.cadence;

    if (autonomousClaim && ctx.settings.autonomousClaim !== false) {
      const result = await claimWhatCanBe({
        chrome,
        now,
        catalog,
        filters: ctx.filters,
        claimableStores,
        // Un magasin decoche n'est pas seulement masque : on n'y touche pas.
        watchedStores: ctx.settings.watchedStores,
        cadence,
        canary: ctx.canary,
        maxReclamations,
        record,
      });
      catalog = result.catalog;
      cadence = result.cadence;
      claims = result.claims;

      if (claims.length) {
        // Le canari part dans la meme transition : un worker mort entre les
        // deux laisserait un magasin marque casse pour une reclamation dont
        // personne n'a garde la trace.
        await writeCycle(chrome, { catalog, cadence, canary: result.canary });
        const succeeded = claims.filter((x) => x.verdict === VERDICTS.CLAIMED).length;
        const manual = claims.filter((x) => x.verdict === VERDICTS.CHALLENGE).length;
        if (succeeded) await notify({
          title: t(succeeded === 1 ? 'notifyClaimedOne' : 'notifyClaimedMany', String(succeeded)),
          text: claims.filter((x) => x.verdict === VERDICTS.CLAIMED).map((x) => x.title).join(', '),
          id: `reclame-${now}`,
        });
        if (manual) await notify({
          title: t('notifyChallengeTitle'),
          text: t('notifyChallengeBody'),
          id: `defi-${now}`,
        });
      }
    }

    return {
      queried: toQuery,
      freshOffers: announcements.length,
      claims,
      nextWake: plan.nextWake,
      anomalies,
      boot: !ctx.state.booted,
      plan,
    };
  }, { now, webLocks });

  if (!result.acquired) {
    record('info', 'cycle deja en cours ailleurs, celui-ci se retire');
    return { ignore: true };
  }
  return result.worth;
}

/* ------------------------------------------------------- reclamation */

/**
 * Les offres du catalogue qu'on peut tenter maintenant, dans l'ordre d'urgence.
 *
 * Une offre deja resolue en verdict definitif n'y revient jamais : reessayer un
 * jeu deja reclame ne sert a rien, et chez certains magasins cela consomme un
 * quota.
 */
export function claimCandidates(catalog, filters, { claimableStores, watchedStores, now }) {
  const openList = Object.values(catalog || {}).filter((o) => {
    if (!o) return false;
    if (FINAL_VERDICTS.includes(o.verdict)) return false;
    if (o.state === STATES.EXPIRED || o.state === STATES.RESOLVED) return false;
    if (isExpired(o, now)) return false;
    if (o.alreadyOwned === true) return false;

    /* Pas encore ouverte : il n'y a rien a prendre, et ouvrir un onglet sur une
       page qui n'offre rien coute un jeton du plafond horaire pour rien.
       `start` etait rempli par makeOffer et personne ne le lisait. */
    if (typeof o.start === 'number' && o.start > now) return false;

    /* Recul apres echec. `attempts` etait incremente et jamais relu : un
       changement de DOM chez un magasin devenait un onglet ouvert toutes les
       heures sur un vrai compte, indefiniment. Les verdicts qui attendent un
       humain echappent a l'abandon -- se reconnecter est une chose que
       l'utilisateur peut faire, et on doit etre pret quand il l'a faite.
       Ils echappent aussi au recul, SAUF le defi de securite : chaque essai
       laisse un onglet ouvert dans la fenetre de l'utilisateur, et un par
       cycle les empilait. */
    const humain = HUMAN_VERDICTS.includes(o.verdict);
    if (!humain && (o.attempts || 0) >= MAX_ATTEMPTS) return false;
    const recule = !humain || MANUAL_VERDICTS.includes(o.verdict);
    if (recule && typeof o.nextAttemptAt === 'number' && o.nextAttemptAt > now) return false;
    return true;
  });

  /**
   * Les magasins decoches ne sont pas seulement masques : on n'y touche pas.
   *
   * C'etait le trou le plus couteux du systeme. `watchedStores` etait applique
   * aux annonces et a l'affichage, jamais a la reclamation : decocher Amazon
   * faisait disparaitre les offres Luna de la liste et des notifications, et
   * l'extension continuait d'ouvrir des onglets sur le compte Amazon la nuit.
   * Une action non consentie sur un vrai compte, invisible par construction
   * puisque l'offre n'apparaissait plus nulle part.
   *
   * Les deux reglages restent distincts et sont combines A LA LECTURE :
   * `allowedStores` est un choix explicite de reclamation, `watchedStores` un
   * choix de suivi. Ecrire l'un dans l'autre ecraserait une decision par une
   * autre.
   */
  const autorises = Array.isArray(watchedStores) && watchedStores.length
    ? claimableStores.filter((s) => watchedStores.includes(s))
    : claimableStores;

  const { claimableCount, dropped } = split(openList, filters, {
    supportedStores: autorises,
  });
  return { candidates: byUrgency(claimableCount, now), dropped };
}

/**
 * Reclame, une offre a la fois, dans la limite du plafond horaire et du budget
 * du cycle.
 *
 * Jamais deux onglets en parallele : c'est la regle qui rend le trafic
 * plausible, et celle qui garantit qu'un seul onglet peut etre orphelin.
 */
export async function claimWhatCanBe({
  chrome,
  now,
  catalog,
  filters,
  claimableStores,
  watchedStores,
  cadence,
  canary = {},
  maxReclamations,
  record = () => {},
}) {
  const next = { ...catalog };
  let timestamps = cadence;
  let canaryNext = canary;
  const claims = [];

  const { candidates, dropped } = claimCandidates(next, filters, {
    claimableStores, watchedStores, now,
  });
  if (dropped.length) {
    record('info', `${dropped.length} offre(s) ecartee(s) par les filtres`, {
      reasons: [...new Set(dropped.map((e) => e.reason))],
    });
  }
  if (!candidates.length) return { catalog: next, cadence: timestamps, claims, canary: canaryNext };

  const { left } = hasRoom(timestamps, now);
  if (!left) {
    record('warn', 'plafond horaire de reclamations atteint, on attend');
    return { catalog: next, cadence: timestamps, claims, canary: canaryNext };
  }

  const howMany = Math.min(candidates.length, left, maxReclamations);
  record('info', `${howMany} reclamation(s) ce cycle sur ${candidates.length} candidate(s)`);

  for (const offer of candidates.slice(0, howMany)) {
    /* On MARQUE avant d'agir.
     *
     * Ceci ajoute deliberement une ecriture par reclamation, et rompt donc la
     * regle 2 de watch/storage.js -- « une seule ecriture par transition ».
     * C'est assume, et voici le prix de l'alternative : le service worker meurt
     * a cinq minutes par evenement, soit exactement le budget d'UNE
     * reclamation. Sans cette marque, un worker tue au milieu laisse une offre
     * dont personne ne sait qu'un onglet a ete ouvert pour elle ; le cycle
     * suivant recommence, et le compteur d'essais n'a jamais bouge.
     *
     * Que la prochaine relecture ne « corrige » donc pas ceci en le fusionnant
     * avec l'ecriture de fin de boucle. */
    const commence = Date.now();
    next[offer.catalogKey] = {
      ...next[offer.catalogKey],
      state: STATES.CLAIMING,
      attemptStartedAt: commence,
    };
    await writeCycle(chrome, { catalog: next });

    const r = await claimOffer(offer, {
      chrome,
      now: commence,
      supportedStores: claimableStores,
      record,
    });

    timestamps = recordClaim(timestamps, Date.now());
    claims.push({ title: offer.title, catalogKey: offer.catalogKey, verdict: r.verdict, details: r.details });

    const attempts = (next[offer.catalogKey].attempts || 0) + 1;
    const definitif = FINAL_VERDICTS.includes(r.verdict);
    const humain = HUMAN_VERDICTS.includes(r.verdict);
    const ongletLaisse = MANUAL_VERDICTS.includes(r.verdict);

    next[offer.catalogKey] = {
      ...next[offer.catalogKey],
      verdict: r.verdict,
      state: definitif ? STATES.RESOLVED : STATES.QUEUED,
      // L'URL trouvee par resolution est memorisee : une offre n'est resolue
      // qu'une fois, meme si la reclamation echoue.
      url: r.resolvedUrl || next[offer.catalogKey].url,
      store: r.store || next[offer.catalogKey].store,
      attempts,
      /* Un verdict definitif n'a plus de prochaine fois. Une reconnexion
         attend l'humain sans reculer. Un defi de securite, lui, recule
         (15 min, 1 h, 4 h, puis 12 h pour toujours) : il a laisse un onglet
         ouvert, en rouvrir un a chaque cycle les empilait. Jamais abandonne --
         « Reessayer maintenant » efface le recul. */
      nextAttemptAt: definitif || (humain && !ongletLaisse) ? null
        : nextAttemptAt(ongletLaisse ? Math.min(attempts, MAX_ATTEMPTS - 1) : attempts, Date.now()),
      // Le motif technique est garde : c'est lui qui dit a l'utilisateur ce
      // qu'il doit faire, quand l'extension ne peut plus rien.
      details: r.details || null,
      attemptStartedAt: null,
      updatedAt: Date.now(),
    };

    record('info', `${offer.title} -> ${r.verdict}`, { details: r.details, attempts });

    /* Le canari lit ce verdict, il n'en provoque aucun.
     *
     * Un echec de selecteur isole ne veut rien dire ; deux d'affilee sur le
     * meme magasin veulent dire que le magasin a bouge. Sans ce comptage,
     * l'echec restait silencieux : le recul espacait poliment les tentatives
     * et personne n'apprenait rien avant de constater un jeu manquant. */
    canaryNext = observeCanary(canaryNext, {
      store: r.store || offer.store,
      verdict: r.verdict,
      details: r.details,
      ts: Date.now(),
    });
  }

  /* Une alerte n'est ecrite qu'a sa naissance. Repetee a chaque cycle, elle
     noierait le journal et finirait ignoree -- exactement le sort qu'on veut
     eviter a un canari. */
  for (const alerte of newAlerts(canary, canaryNext)) {
    record('warn', `canari : ${alertLine(alerte)}`);
  }

  return { catalog: next, cadence: timestamps, claims, canary: canaryNext };
}

/**
 * Rattrape les reclamations qu'un service worker mort a laissees en plan.
 *
 * Une entree marquee CLAIMING depuis plus longtemps que le budget d'une
 * reclamation ne peut plus etre en cours : le worker qui la tenait n'existe
 * plus. On ne sait pas ce qui s'est passe -- l'onglet a peut-etre reclame avant
 * de mourir -- donc le verdict est `undetermined`, qui n'est pas definitif et
 * repasse par le recul. Ni un succes qu'on n'a pas constate, ni un echec qui
 * ferait recommencer tout de suite.
 */
export function reclaimAbandoned(catalog, now, budgetMs = BUDGET_MS) {
  const next = { ...catalog };
  let recovered = 0;

  for (const [key, o] of Object.entries(next)) {
    if (!o || o.state !== STATES.CLAIMING) continue;
    // Sans horodatage de depart on ne peut pas juger : on le pose maintenant,
    // et le cycle suivant tranchera. Deviner ferait perdre une offre valide.
    if (typeof o.attemptStartedAt !== 'number') {
      next[key] = { ...o, attemptStartedAt: now };
      continue;
    }
    if (now - o.attemptStartedAt <= budgetMs) continue;

    const attempts = (o.attempts || 0) + 1;
    next[key] = {
      ...o,
      state: STATES.QUEUED,
      verdict: VERDICTS.UNDETERMINED,
      attempts,
      nextAttemptAt: nextAttemptAt(attempts, now),
      attemptStartedAt: null,
      updatedAt: now,
    };
    recovered++;
  }

  return { catalog: next, recovered };
}

/**
 * L'ordonnanceur ne veut que des instants. Les fenetres annoncees sont
 * stockees entieres pour l'affichage ; on accepte les deux formes, pour ne pas
 * casser un etat ecrit par une version anterieure.
 */
export function windowInstants(windows) {
  return (windows || [])
    .map((f) => (typeof f === 'number' ? f : f && f.start))
    .filter((t) => typeof t === 'number');
}

/** Une source a-t-elle des offres qui attendent encore quelque chose ? */
function hasPendingOffers(catalog, source, now) {
  return Object.values(catalog || {}).some(
    (o) => o.source === source
      && !isExpired(o, now)
      && (o.state === STATES.DISCOVERED || o.state === STATES.RESOLVING),
  );
}

export { KEYS };
