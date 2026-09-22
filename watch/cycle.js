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
import { noteOutcomesFromCatalog } from './outcomes.js';
import { NOTICE } from './notify-actions.js';
import { markWished } from './wishlist.js';
import { STATES, STORES, STORE_LABELS, isExpired, byUrgency, normaliseTitle } from './offer.js';
import { claimableStoresFor, activeSourcesFor } from './sources/index.js';
import { steamGate } from './steam-claim.js';
import {
  schedule,
  afterSuccess,
  afterFailure,
  DEFAULTS as SCHEDULER_DEFAULTS,
} from './schedule/scheduler.js';
import { observe, learnedHotInstants, emptyStat } from './schedule/prediction.js';
import { KEY_CANARY, observe as observeCanary, newAlerts, alertLine } from './canary.js';
import { ownedKeys } from './library.js';
import { ownedStoreKeys } from './collection.js';
import { refreshRates } from './rates.js';
import { currencyFor } from './locale.js';
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

/**
 * Les offres du catalogue qui n'ont jamais ete annoncees.
 *
 * `now` n'est pas optionnel par confort : l'etat EXPIRED n'est pose qu'au
 * passage d'un cycle, donc une offre finie depuis la rotation du jeudi 17 h
 * peut encore porter l'etat calcule au dernier passage. Sans consulter
 * l'horloge, on annoncait un jeu qui n'etait plus a prendre -- signale le
 * 2026-09-18, le lendemain d'une rotation.
 *
 * Une fin INCONNUE ne vaut pas une fin passee : `isExpired` rend false, et
 * l'offre reste annoncable. C'est voulu -- l'agregateur laisse huit offres sur
 * vingt sans date, et les taire serait pire que de les annoncer.
 */
export function toNotify(catalog, now) {
  if (typeof now !== 'number') throw new TypeError('aAnnoncer : "maintenant" est obligatoire');
  return Object.values(catalog || {}).filter(
    (o) => !o.notifiedAt && o.state !== STATES.EXPIRED && !isExpired(o, now),
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
  /**
   * Magasins ou l'extension a le droit de cliquer, SANS option. Steam n'y est
   * jamais : il n'y entre qu'a la lecture des reglages, si `steamAutoClaim`
   * est active (claimableStoresFor).
   */
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

    /* `force` vaut true -- tout interroger, comme « Verifier maintenant » --
       ou une LISTE de sources a forcer, ce que demande la sentinelle.
       La distinction n'est pas cosmetique : forcer toutes les sources pour en
       reparer une seule ferait payer les saines pour la cassee, et sur des API
       tierces c'est exactement le trafic qu'on ne veut pas produire. */
    const forceAll = force === true;
    const forcedList = Array.isArray(force) ? force.filter((n) => sources[n]) : null;

    // La source Steam s'active avec l'option Steam : elle seule donne le paquet.
    const actives = activeSourcesFor(ctx.settings);
    const names = Object.keys(sources).filter(
      (n) => forceAll
        || (forcedList ? forcedList.includes(n) : actives.includes(n)),
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

    // Forcer, c'est passer outre le recul et le plan -- le seul interet d'une
    // reprise en main, qu'elle vienne d'un bouton ou de la sentinelle.
    const toQuery = (forceAll || forcedList) ? names : plan.dueList;
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
        /* Le pays et la langue ne concernent qu'Epic -- seul magasin a exposer
           ces parametres. Les autres sources les ignorent, et c'est plus sain
           que de leur inventer une option qu'elles n'honoreraient pas. */
        r = await source.discover({
          fetch: fetchImpl,
          now,
          country: ctx.locale && ctx.locale.country,
          lang: ctx.locale && ctx.locale.lang,
          /* Lire ce que le compte possede demande les cookies de la session,
             et SECURITY.md promet que l'extension ne lit jamais un compte de
             sa propre initiative. Seule l'option de reclamation le justifie :
             elle en a besoin pour ne pas reclamer deux fois. La detection,
             elle, se contente d'une recherche publique.

             Compare a `true`, jamais a la veracite : ce qui declenche une
             requete porteuse de cookies merite la meme severite que
             claimableStoresFor. Les sources qui ne connaissent pas cette
             option l'ignorent. */
          withOwned: ctx.settings && ctx.settings.steamAutoClaim === true,
        });
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

      /*
       * « Liste complete » est un FAIT PAR REPONSE quand la source en publie
       * un, et seulement une promesse statique sinon.
       *
       * GOG porte `page` et `totalPages` dans sa reponse : il dit lui-meme si
       * elle tient sur une page. Croire la reponse vaut mieux que deviner le
       * nom d'un parametre de pagination -- et le jour ou elle annonce
       * plusieurs pages, la veille cesse d'elle-meme d'en conclure des
       * disparitions, ce cycle-la seulement.
       */
      const announced = typeof r.complete === 'boolean' ? r.complete : null;
      const claimsComplete = announced === null ? Boolean(source.completeList) : announced;

      const credible = claimsComplete
        && Array.isArray(r.offers)
        && (knownSize === undefined
          || currentSize >= Math.floor(knownSize * CREDIBLE_LIST_RATIO));

      if (announced === false) {
        // La mesure que ROADMAP.md attendait, prise en marche.
        record('info', `${name} : reponse partielle annoncee (plusieurs pages), aucune disparition conclue ce cycle`);
      }

      if (claimsComplete && !credible) {
        anomalies.push(`${name} : liste tombee de ${knownSize} a ${currentSize}, traitee comme partielle`);
        record('warn', anomalies[anomalies.length - 1]);
      }

      state = noteGap(state, now, SCHEDULER_DEFAULTS.horizonMs / 7);

      const integration = integrate(catalog, r.offers, {
        now,
        source: name,
        completeList: credible,
        /*
         * Le magasin sur lequel cette source fait autorite, quand elle en
         * designe un. C'est ce qui permet au balayage de reconnaitre une
         * offre Epic decouverte par l'agregateur : son champ `source` dit
         * « gamerpower » pour toujours, mais son `store` dit « epic ».
         */
        store: source.authoritativeFor || null,
      });
      catalog = integration.catalog;

      // La couche apprenante n'apprend que sur les NOUVELLES offres : une offre
      // deja connue, revue a chaque cycle, gonflerait la case de nos propres
      // heures de sondage -- exactement le biais que la conception combat.
      for (const fresh of integration.freshOffers) {
        stats[name] = observe(stats[name] || emptyStat(), fresh, {
          now,
          lastEmptyPoll: state.lastSuccess ?? null,
          /* Le fuseau ou l'heure de publication de cette source veut dire
             quelque chose. Sans lui, les cases restent en UTC et glissent
             d'une heure a chaque changement d'heure -- soit, pour une source
             hebdomadaire, trois semaines a reapprendre deux fois par an. */
          zone: source.zone || null,
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

    const pending = toNotify(catalog, now);
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
      /* Ce que l'utilisateur ATTENDAIT passe devant, et echappe au resume :
         un jeu guette depuis des mois ne se noie pas dans « 5 jeux gratuits ».
         Le drapeau est derive a la lecture, jamais persiste. */
      announcements = byUrgency(markWished(pending, ctx.wishlist, normaliseTitle), now);
    }

    const unseen = openOffers(catalog, now).filter((o) => !o.seen).length;
    nextState = {
      ...nextState,
      lastCycle: now,
      nextCycle: plan.nextWake,
      lastError: anomalies.length ? anomalies.join(' | ') : null,
      unseen,
    };

    /* Le taux du jour, pour afficher en euros ce que l'agregateur publie en
       dollars. Une panne de taux ne fait jamais echouer un cycle : le pire
       qu'elle produise est un montant affiche dans sa devise d'origine. */
    const rateRun = await refreshRates({
      now,
      stored: ctx.rates,
      fetch: fetchImpl,
      record,
      // La devise visee suit le pays choisi, au lieu d'etre l'euro en dur.
      base: currencyFor(ctx.locale && ctx.locale.country),
    });

    /* Figer l'issue de ce qui vient de se terminer, AVANT que la purge de
       quatre-vingt-dix jours n'emporte l'entree. Passe ce delai, ni le titre
       ni la valeur n'existent plus nulle part : c'est la seule fenetre.
       
       On balaie le catalogue entier plutot que les listes rendues par
       l'integration. Une offre devient terminale par trois chemins -- sa date
       passe, elle disparait de sa source, une reclamation la resout -- et
       suivre les trois separement offrirait trois occasions d'en oublier un,
       sans que rien ne le signale. Le balayage est sur parce que la premiere
       issue gagne : repasser sur une offre deja figee ne coute qu'une
       comparaison. */
    const issues = noteOutcomesFromCatalog(ctx.outcomes, catalog, { now });
    if (issues.added) record('info', `${issues.added} issue(s) figee(s)`);

    // Persister AVANT de notifier. Une mort du worker entre les deux coute une
    // notification, pas une offre.
    await writeCycle(chrome, {
      catalog,
      outcomes: issues.added ? issues.outcomes : undefined,
      sources: sourceStates,
      state: nextState,
      stats,
      rates: rateRun.changed ? rateRun.rates : undefined,
    });

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

    /* Un jeu ATTENDU ne se noie pas dans « 5 jeux gratuits ».
     *
     * C'est la difference entre savoir qu'il y a des offres et savoir que
     * CELLE-LA est arrivee. Le resume quotidien reste le bon comportement pour
     * le tout-venant ; il devient le mauvais des l'instant ou la liste porte
     * quelque chose que l'utilisateur guettait. `byUrgency` l'a deja mis en
     * tete, donc la notification individuelle parle bien de lui. */
    const attendu = watched.some((o) => o.wished);
    if (attendu && decision.digest) {
      decision.digest = false;
      record('info', 'un jeu attendu est annonce a part');
    }

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
        /* Le genre commande les boutons, la cle designe SUR QUOI ils agissent.
           Sans la seconde, un bouton « Recuperer » cliqué trois heures plus
           tard ne saurait pas de quelle offre on parle : le service worker a
           tout oublie entre-temps. */
        kind: NOTICE.OFFER,
        catalogKey: first.catalogKey,
      });
    }

    /* ---- rappel avant expiration ---- */

    // Une offre qui se termine bientot et qui n'a pas ete traitee merite un
    // second signal : la premiere notification a pu tomber pendant la nuit. Le
    // seuil est un reglage ; a zero, pas de rappel.
    const closing = endingSoon(onlyWatched(openOffers(catalog, now), ctx.settings.watchedStores), {
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
        /* Un rappel ne propose PAS de reporter : l'offre se termine dans
           quelques heures, et reporter reviendrait a la refuser en croyant
           gagner du temps. Voir watch/notify-actions.js. */
        kind: NOTICE.REMINDER,
        catalogKey: closing[0].catalogKey,
      });
    }

    await updateBadge(badgeCount({
      mode: ctx.settings.badgeMode,
      unseen,
      offers: openOffers(catalog, now),
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
        claimableStores: claimableStoresFor(ctx.settings, claimableStores),
        fetch: fetchImpl,
        // Un magasin decoche n'est pas seulement masque : on n'y touche pas.
        watchedStores: ctx.settings.watchedStores,
        cadence,
        canary: ctx.canary,
        library: ctx.library,
        collection: ctx.collection,
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
export function claimCandidates(catalog, filters, { claimableStores, watchedStores, now, owned = null, ownedIds = null }) {
  const openList = Object.values(catalog || {}).filter((o) => {
    if (!o) return false;
    if (FINAL_VERDICTS.includes(o.verdict)) return false;
    if (o.state === STATES.EXPIRED || o.state === STATES.RESOLVED) return false;
    if (isExpired(o, now)) return false;
    if (o.alreadyOwned === true) return false;

    /* Mise de cote par l'utilisateur, jusqu'a une echeance qui se perime toute
       seule. Different de la croix, qui exclut le TITRE pour toujours : ici
       l'offre revient d'elle-meme. Un clic explicite passe outre -- voir
       claimOneNow. */
    if (typeof o.snoozedUntil === 'number' && o.snoozedUntil > now) return false;

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
    owned,
    ownedIds,
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
  library = null,
  /* Ma collection : ce que les magasins disent que vous possedez. Compare par
     identifiant exact seulement (voir collection.js). */
  collection = null,
  maxReclamations,
  record = () => {},
  fetch: fetchImpl,
  /* Le geste de reclamation lui-meme, injectable.
   *
   * Par defaut c'est claimOffer, qui ouvre un onglet et joue l'etape dans la
   * page. Le rendre remplacable permet de tester les chemins QUI DECIDENT --
   * qui est candidat, dans quel ordre, sous quel plafond -- sans monter un
   * faux navigateur complet a chaque fois. Meme raison d'etre que le fetch
   * injecte juste au-dessus. */
  claim = claimOffer,
}) {
  const next = { ...catalog };
  let timestamps = cadence;
  let canaryNext = canary;
  const claims = [];
  let steamThisRun = 0;
  let steamHeld = null;

  /* Ce que l'extension possede deja, pour ne pas rouvrir un onglet dessus.
     Construit une fois par cycle, pas une fois par offre. */
  const owned = library ? ownedKeys(library, normaliseTitle) : null;
  const ownedIds = collection ? ownedStoreKeys(collection) : null;

  const { candidates, dropped } = claimCandidates(next, filters, {
    claimableStores, watchedStores, now, owned, ownedIds,
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

  let done = 0;
  for (const offer of candidates) {
    if (done >= howMany) break;

    /* Steam, en option : plus lent que tout le reste, EN PLUS du plafond
       horaire. Une offre retenue ne consomme pas de place -- la suivante, sur
       un autre magasin, passe. Voir steamGate (watch/steam-claim.js). */
    if (offer.store === STORES.STEAM) {
      const gate = steamGate(next, Date.now(), { claimedThisRun: steamThisRun });
      if (!gate.allowed) {
        steamHeld = gate.reason;
        continue;
      }
      steamThisRun++;
    }
    done++;

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

    const r = await claim(offer, {
      chrome,
      now: commence,
      supportedStores: claimableStores,
      record,
      fetch: fetchImpl,
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
      // Garde, lui : c'est sur cette date que se regle le rythme de Steam.
      lastAttemptAt: commence,
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

  if (steamHeld) record('info', `steam : attend son tour (${steamHeld})`);

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
