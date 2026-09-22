/* La couche de stockage de la veille.
 *
 * Trois regles, chacune payee par un bug connu :
 *
 *  1. ESPACES DE NOMS DISJOINTS. Les cles de la veille commencent par "veille:".
 *     Aucune ne touche aux cles FGC_* du moteur. Un code GOG perdu est un jeu
 *     perdu, et le moteur precharge ses cles a chaque injection de page.
 *
 *  2. UNE SEULE ECRITURE PAR TRANSITION. chrome.storage n'a pas de transaction,
 *     mais un set() est atomique sur toutes les cles qu'on lui passe. Ecrire le
 *     catalogue puis l'etat en deux set() ouvre une fenetre ou le service worker
 *     peut mourir entre les deux ; les ecrire ensemble la ferme.
 *
 *  3. LE VERROU NE GARANTIT RIEN, L'IDEMPOTENCE SI. Voir avecVerrou.
 */

import { MIGRATED_KEYS, buildV2Patch } from './migrate.js';
import { schedulesWithDefaults } from './schedule/rules.js';
import { KEY_RATES } from './rates.js';
import { KEY_COUNTRY, KEY_LANG, normaliseCountry, normaliseLang } from './locale.js';
/* Le canari possede sa cle, comme la bibliotheque et le journal. Elle est
   importee ici pour une raison precise : son etat doit s'ecrire dans la MEME
   transition que le catalogue et la cadence, sans quoi un worker mort entre
   les deux laisserait un magasin marque casse pour une reclamation qui, elle,
   n'a jamais ete enregistree. */
import { KEY_CANARY } from './canary.js';
import { KEY_LIBRARY } from './library.js';
/* Les issues d'offres terminees. Ecrites dans la MEME transition que le
   catalogue : une mort du worker entre les deux laisserait une offre purgee
   sans que son issue ait ete figee, et l'information n'existe plus nulle part
   ailleurs. */
import { KEY_OUTCOMES } from './outcomes.js';

export const PREFIX = 'veille:';

export const KEYS = Object.freeze({
  SCHEMA: 'veille:schema',
  OFFERS: 'veille:offres',
  SOURCES: 'veille:sources',
  STATS: 'veille:stats',
  SETTINGS: 'veille:reglages',
  SCHEDULES: 'veille:calendriers',
  STATE: 'veille:etat',
  LEASE: 'veille:bail',
  FILTERS: 'veille:filtres',
  CADENCE: 'veille:cadence-reclamation',
  /** id de notification -> URL a ouvrir au clic. Session : rien a garder. */
  NOTIFICATION_LINKS: 'veille:liens-notifications',
});

/**
 * Version du schema que ce code sait lire et ecrire.
 *
 * 1 -> 2 : les champs persistes passent du francais a l'anglais. Voir
 *          watch/migrate.js pour ce qui bouge et ce qui ne bouge pas.
 */
export const SCHEMA_VERSION = 2;

/* ---------------------------------------------------------------- lecture */

/** Lit un jeu de cles. Rend un objet, meme si tout est absent. */
export async function readKeys(chrome, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return chrome.storage.local.get(list);
}

/**
 * Ecrit en UNE seule transition. Passer toutes les cles liees ensemble, jamais
 * en plusieurs appels : c'est la seule atomicite que la plateforme offre.
 */
export async function write(chrome, obj) {
  return chrome.storage.local.set(obj);
}

/* ------------------------------------------------------------- schema */

export const SCHEMA = Object.freeze({
  OK: 'ok',
  INITIALISED: 'initialise',
  TOO_RECENT: 'trop_recent',
  MIGRATED: 'migre',
});

/**
 * Verifie le schema avant tout usage.
 *
 * Un schema plus recent que le code signifie que l'utilisateur a installe une
 * version anterieure par-dessus une plus recente. Dans ce cas la veille ne
 * demarre pas : mieux vaut un etat lisible dans le popup qu'un plantage
 * silencieux dans le service worker.
 */
export async function checkSchema(chrome) {
  const { [KEYS.SCHEMA]: current } = await readKeys(chrome, KEYS.SCHEMA);

  if (current === undefined) {
    await write(chrome, { [KEYS.SCHEMA]: SCHEMA_VERSION });
    return { state: SCHEMA.INITIALISED, version: SCHEMA_VERSION };
  }
  if (current > SCHEMA_VERSION) {
    return {
      state: SCHEMA.TOO_RECENT,
      version: current,
      message: `donnees de veille en version ${current}, ce code lit la version ${SCHEMA_VERSION}`,
    };
  }
  if (current < SCHEMA_VERSION) {
    const stored = await readKeys(chrome, MIGRATED_KEYS);
    const { patch, changed } = buildV2Patch(stored);

    /* Le correctif ET le numero de version dans le MEME set(). En deux appels,
       une mort du service worker entre les deux laisserait des donnees migrees
       marquees version 1 -- la migration se rejouerait, renommerait des champs
       deja anglais en... eux-memes, ce qui est inoffensif, ou bien s'appliquerait
       a une forme intermediaire, ce qui ne l'est pas. */
    await write(chrome, { ...patch, [KEYS.SCHEMA]: SCHEMA_VERSION });
    return { state: SCHEMA.MIGRATED, from: current, version: SCHEMA_VERSION, changed };
  }
  return { state: SCHEMA.OK, version: current };
}

/* ------------------------------------------------------------------ verrou */

/** Duree au bout de laquelle un bail abandonne est considere comme perime. */
export const LEASE_TTL_MS = 5 * 60 * 1000;

/**
 * Execute `travail` en exclusion mutuelle, si possible.
 *
 * Deux mecanismes, dans cet ordre :
 *
 *   1. L'API Web Locks quand la plateforme la fournit. C'est un vrai verrou :
 *      il serialise tous les contextes de l'origine et se libere tout seul si
 *      le service worker meurt en le tenant.
 *
 *   2. Sinon, un bail horodate. Il faut le dire clairement : ce n'est PAS un
 *      verrou correct. Sa surete repose sur une relecture apres ecriture, et
 *      deux appelants qui relisent chacun avant que l'autre n'ecrive passent
 *      tous les deux. Mesure de la sonde du 2026-08-27 : dix chevauchements
 *      sur vingt-cinq essais sans temporisation.
 *
 * La vraie garantie n'est donc pas le verrou, c'est l'IDEMPOTENCE du travail :
 * integrer() rend zero nouveaute sur une seconde passe, et la notification est
 * conditionnee par un champ persiste, pas par le resultat du cycle. Le verrou
 * evite du travail inutile ; il n'evite pas la double execution.
 *
 * Rend { acquis: false } sans rien executer quand le verrou est deja pris.
 */
export async function withLease(chrome, name, job, { now, ttlMs = LEASE_TTL_MS, webLocks } = {}) {
  const locks = webLocks
    ?? (typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null);

  if (locks && typeof locks.request === 'function') {
    return locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return { acquired: false };
      return { acquired: true, worth: await job() };
    });
  }

  const zone = chrome.storage.session || chrome.storage.local;
  // L'identifiant doit etre unique par TENTATIVE, pas par instant : deux
  // reveils simultanes au meme horodatage ecrivaient le meme identifiant, se
  // relisaient tous les deux avec succes, et passaient tous les deux.
  const ident = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  const { [KEYS.LEASE]: existingList } = await zone.get(KEYS.LEASE);
  if (existingList && existingList.expire > now) return { acquired: false };

  await zone.set({ [KEYS.LEASE]: { id: ident, takenAt: now, expire: now + ttlMs } });

  // Relecture : le dernier ecrivain gagne, les autres se retirent.
  const { [KEYS.LEASE]: reread } = await zone.get(KEYS.LEASE);
  if (!reread || reread.id !== ident) return { acquired: false };

  try {
    return { acquired: true, worth: await job() };
  } finally {
    const { [KEYS.LEASE]: more } = await zone.get(KEYS.LEASE);
    if (more && more.id === ident) await zone.remove(KEYS.LEASE);
  }
}

/* --------------------------------------------------------------- reglages */

/**
 * Les reglages que le service worker lit. Source unique : le popup les importe
 * plutot que d'en tenir sa propre copie, sinon un defaut change d'un cote
 * seulement, et l'interface montre autre chose que ce qui s'applique.
 */
export const DEFAULT_SETTINGS = Object.freeze({
  floorPerDay: 3,
  overrides: {},
  /**
   * Les sources INTERROGEES. Regarder, pas cliquer.
   *
   * Steam y figure depuis la 2.27.0, et la distinction est tout le sujet.
   * Jusque-la, lire Steam et cliquer sur Steam etaient le meme interrupteur :
   * la source ne s'activait qu'avec `steamAutoClaim`, coupe par defaut. Qui
   * refusait le clic -- le cas par defaut, volontairement -- ne voyait de
   * Steam que ce que l'agregateur en dit, c'est-a-dire des cles offertes sur
   * des sites tiers, sans numero de paquet, que le filtre rejette.
   *
   * La recherche Steam est publique et part SANS cookie. Lire ce que le compte
   * possede, lui, en demande -- et cela n'a lieu qu'avec l'option de
   * reclamation, qui en a besoin pour ne pas reclamer deux fois. Voir le
   * `withOwned` transmis par watch/cycle.js.
   */
  activeSources: ['epic-api', 'gamerpower', 'gog', 'steam'],
  autonomousClaim: true,

  /**
   * Recuperer aussi sur Steam. COUPE par defaut, et il doit le rester : le
   * contrat Steam interdit les scripts (section 4.C) et prevoit la fermeture
   * du compte sans preavis (4.D). Le popup ne l'active qu'apres un
   * avertissement explicite. Voir watch/steam-claim.js.
   */
  steamAutoClaim: false,

  /** 'every' | 'digest' | 'off'. Voir watch/notify-policy.js. */
  notifyMode: 'every',

  /**
   * Le canal des INCIDENTS : selecteur mort, source en repli, session perdue,
   * veille arretee. 'on' | 'off'.
   *
   * Separe de `notifyMode`, et actif par defaut. Quelqu'un qui ne veut plus
   * etre prevenu des jeux gratuits veut probablement savoir que son extension
   * est cassee -- ce sont deux questions differentes.
   *
   * Mais lui envoyer des notifications apres qu'il les a coupees serait la
   * trahison que ce depot nomme deja. D'ou la traduction unique dans
   * `normaliseSettings` : un `notifyMode: 'off'` deja choisi eteint aussi ce
   * canal-la, une fois, apres quoi les deux sont independants.
   */
  alertMode: 'on',
  /** 'unseen' | 'endingToday' | 'off'. */
  badgeMode: 'unseen',
  /** Plage ou les annonces sont DIFFEREES, jamais supprimees. */
  quiet: Object.freeze({ on: false, start: '23:00', end: '08:00' }),
  /** Heures avant la fin d'une offre pour un second signal. 0 coupe. */
  reminderHours: 6,
  /** Magasins suivis. Le catalogue garde tout ; ceci filtre les annonces. */
  watchedStores: Object.freeze(['epic', 'gog', 'amazon', 'steam']),

  /**
   * Recopier les codes en attente dans chrome.storage.sync.
   *
   * Coupe par defaut, et ce n'est pas de la prudence de facade : la zone sync
   * traverse le compte du navigateur. Y poser les codes de quelqu'un sans le
   * lui demander serait prendre une decision a sa place. Voir watch/backup.js.
   */
  syncCodes: false,
});

/**
 * Applique les defauts et traduit les reglages des versions anterieures.
 *
 * Une seule fonction, appelee par readSettings ET par readContext. Elle
 * l'etait en deux endroits : la traduction n'y etait qu'une fois, et le cycle
 * -- qui passe par readContext -- continuait de notifier un utilisateur qui
 * avait coupe les notifications.
 */
export function normaliseSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS, ...(raw || {}) };

  /* Jusqu'a la 2.10, couper les notifications s'ecrivait `notifications: false`.
     Le reglage est devenu un mode a trois valeurs, et sans cette traduction un
     utilisateur qui les avait coupees les verrait revenir apres la mise a jour.
     Une preference perdue en silence est une trahison silencieuse. */
  if (raw && raw.notifications === false && raw.notifyMode === undefined) {
    settings.notifyMode = 'off';
  }

  /* Le canal des incidents arrive en 2.28.0, apres que des gens ont deja
     choisi le silence. Le leur imposer serait exactement la trahison
     ci-dessus : ils ont coupe les notifications, pas demande un genre nouveau.

     La condition porte sur l'ABSENCE de choix explicite -- `alertMode ===
     undefined`. Sans elle, il serait impossible de couper les offres et de
     garder les alertes, qui est precisement la combinaison la plus utile. */
  if (raw && raw.alertMode === undefined && settings.notifyMode === 'off') {
    settings.alertMode = 'off';
  }

  /* Une source livree APRES coup doit s'activer chez ceux qui ont deja des
     reglages enregistres -- sans quoi elle ne tournerait que sur les nouvelles
     installations, et la seule personne a en profiter serait celle qui n'en a
     pas besoin.
     
     C'est defendable AUJOURD'HUI pour une raison precise : la liste des
     sources n'est editable nulle part dans l'interface. Son absence n'exprime
     donc aucun choix. Le jour ou elle le devient, ce bloc doit disparaitre :
     il reactiverait ce que l'utilisateur vient de decocher. */
  if (Array.isArray(settings.activeSources)) {
    const manquantes = DEFAULT_SETTINGS.activeSources.filter((n) => !settings.activeSources.includes(n));
    if (manquantes.length) settings.activeSources = [...settings.activeSources, ...manquantes];
  }

  return settings;
}

export async function readSettings(chrome) {
  const { [KEYS.SETTINGS]: r } = await readKeys(chrome, KEYS.SETTINGS);
  return normaliseSettings(r);
}

/* ------------------------------------------------------------------- etat */

export const DEFAULT_STATE = Object.freeze({
  /**
   * Faux tant que le premier cycle n'a pas eu lieu.
   *
   * Le premier cycle remplit le catalogue SANS notifier : l'agregateur rend une
   * vingtaine d'offres deja en cours, dont certaines publiees il y a des
   * annees. Vingt notifications a l'installation, c'est l'utilisateur qui coupe
   * les notifications pour toujours -- et cette erreur-la ne se rattrape pas.
   */
  booted: false,
  lastCycle: null,
  nextCycle: null,
  lastError: null,
  unseen: 0,
});

export async function readState(chrome) {
  const { [KEYS.STATE]: e } = await readKeys(chrome, KEYS.STATE);
  return { ...DEFAULT_STATE, ...(e || {}) };
}

/* --------------------------------------------------------------- lecture globale */

/** Lit d'un coup tout ce qu'un cycle a besoin de connaitre. */
export async function readContext(chrome) {
  const raw = await readKeys(chrome, [
    KEYS.OFFERS, KEYS.SOURCES, KEYS.SETTINGS, KEYS.SCHEDULES, KEYS.STATE,
    KEYS.STATS, KEYS.FILTERS, KEYS.CADENCE, KEY_CANARY, KEY_LIBRARY, KEY_RATES,
    KEY_OUTCOMES,
    /* Le pays et la langue vivent sous les cles du MOTEUR, pas sous une cle
       de veille a part. Une seule ecriture, deux lecteurs : le moteur les lit
       par GM_getValue (synchrone, prechargees par gm-shim), la veille ici. Un
       reglage recopie a deux endroits finit toujours par diverger -- c'est le
       defaut meme que ce chantier corrige. */
    KEY_COUNTRY, KEY_LANG,
  ]);
  return {
    catalog: raw[KEYS.OFFERS] || {},
    sources: raw[KEYS.SOURCES] || {},
    settings: normaliseSettings(raw[KEYS.SETTINGS]),
    // Les horaires connus des magasins, sauf si l'utilisateur en a pose
    // d'autres : sans cela la cle restait vide et la rotation hebdomadaire
    // n'etait jamais anticipee (cf. watch/schedule/rules.js).
    schedules: schedulesWithDefaults(raw[KEYS.SCHEDULES]),
    state: { ...DEFAULT_STATE, ...(raw[KEYS.STATE] || {}) },
    stats: raw[KEYS.STATS] || {},
    filters: raw[KEYS.FILTERS] || {},
    cadence: raw[KEYS.CADENCE] || [],
    canary: raw[KEY_CANARY] || {},
    library: raw[KEY_LIBRARY] || {},
    rates: raw[KEY_RATES] || null,
    outcomes: raw[KEY_OUTCOMES] || {},
    locale: {
      country: normaliseCountry(raw[KEY_COUNTRY]),
      lang: normaliseLang(raw[KEY_LANG], raw[KEY_COUNTRY]),
    },
  };
}

/**
 * Ecrit le resultat d'un cycle en UNE transition.
 *
 * Le catalogue est ecrit AVANT toute notification, jamais apres : entre les
 * deux, le service worker peut mourir. On prefere perdre une notification
 * qu'en envoyer deux, et le champ notifieLe rend la reprise possible.
 */
export async function writeCycle(chrome, { catalog, sources, state, stats, cadence, canary, rates, outcomes }) {
  const obj = {};
  if (catalog !== undefined) obj[KEYS.OFFERS] = catalog;
  if (sources !== undefined) obj[KEYS.SOURCES] = sources;
  if (state !== undefined) obj[KEYS.STATE] = state;
  if (stats !== undefined) obj[KEYS.STATS] = stats;
  if (cadence !== undefined) obj[KEYS.CADENCE] = cadence;
  if (canary !== undefined) obj[KEY_CANARY] = canary;
  if (rates !== undefined) obj[KEY_RATES] = rates;
  if (outcomes !== undefined) obj[KEY_OUTCOMES] = outcomes;
  return write(chrome, obj);
}

/* ------------------------------------------------------ notifications */

/** Au plus, liens gardes en memoire. Au-dela, les plus vieux sont oublies. */
const MAX_LINKS = 30;

/**
 * Retient ou mene une notification.
 *
 * Sans cela, cliquer une notification ouvrait la page de diagnostic : le
 * service worker avait perdu la memoire entre l'envoi et le clic, qui peut
 * survenir des heures plus tard.
 */
export async function rememberNotificationLink(chrome, id, url) {
  return rememberNotification(chrome, id, { url });
}

/**
 * Retient DE QUOI AGIR sur une notification, pas seulement ou aller.
 *
 * La table ne gardait qu'un couple identifiant -> URL. Rien ne savait donc sur
 * QUELLE offre agir des heures plus tard -- et des heures plus tard est le cas
 * normal : le service worker meurt trente secondes apres le dernier evenement,
 * et le clic arrive quand l'utilisateur revient.
 *
 * Une entree sans rien a retenir n'est pas ecrite : elle consommerait une
 * place du plafond et chasserait un lien utile.
 */
export async function rememberNotification(chrome, id, { url = null, catalogKey = null, kind = null } = {}) {
  if (!id || (!url && !catalogKey)) return;
  const zone = chrome.storage.session || chrome.storage.local;
  const { [KEYS.NOTIFICATION_LINKS]: links } = await zone.get(KEYS.NOTIFICATION_LINKS);
  const following = { ...(links || {}), [id]: { url, catalogKey, kind } };

  const keys = Object.keys(following);
  if (keys.length > MAX_LINKS) for (const k of keys.slice(0, keys.length - MAX_LINKS)) delete following[k];

  await zone.set({ [KEYS.NOTIFICATION_LINKS]: following });
}

/**
 * Ce qu'une notification a retenu, sous sa forme complete.
 *
 * Les entrees ecrites avant la 2.30.0 ne portaient qu'une chaine. Les ignorer
 * ferait que le premier clic apres une mise a jour retombe sur le popup au
 * lieu de l'offre : un bug minuscule, une seule fois, et parfaitement
 * evitable.
 */
export async function readNotification(chrome, id) {
  const zone = chrome.storage.session || chrome.storage.local;
  const { [KEYS.NOTIFICATION_LINKS]: links } = await zone.get(KEYS.NOTIFICATION_LINKS);
  const brut = links && links[id];
  if (!brut) return null;
  if (typeof brut === 'string') return { url: brut, catalogKey: null, kind: null };
  return { url: brut.url || null, catalogKey: brut.catalogKey || null, kind: brut.kind || null };
}

/** L'URL seule. Conservee pour le clic sur le corps de la notification. */
export async function readNotificationLink(chrome, id) {
  const lu = await readNotification(chrome, id);
  return (lu && lu.url) || null;
}

/* ------------------------------------------------------------------ mesure */

/** Occupation reelle, comptee comme Chromium la compte. */
export async function usedSize(chrome) {
  const everything = await chrome.storage.local.get(null);
  let total = 0;
  const byKey = {};
  for (const [k, v] of Object.entries(everything)) {
    const n = k.length + JSON.stringify(v).length;
    byKey[k] = n;
    total += n;
  }
  return { total, byKey };
}
