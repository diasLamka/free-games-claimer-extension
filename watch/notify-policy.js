/* Quand prevenir, et par quel canal.
 *
 * Ce module est pur : il decide, il n'affiche rien. C'est ce qui permet de
 * tester « 23 h 30 est dans la plage 23 h - 8 h » sans navigateur et sans
 * attendre 23 h 30.
 *
 * Une regle traverse tout le fichier : une notification retenue n'est pas une
 * notification perdue. Les heures calmes DIFFERENT l'annonce -- l'offre n'est
 * pas marquee comme annoncee, donc le premier cycle apres la plage la reprend.
 * Supprimer l'annonce reviendrait a punir l'utilisateur d'avoir demande le
 * silence la nuit, et une offre qui se termine a 7 h serait perdue en silence.
 */
import { localParts } from './schedule/clock.js';

export const MODES = Object.freeze({
  /** Une notification par lot d'offres nouvelles. */
  EVERY: 'every',
  /** Au plus une par jour, avec le compte. */
  DIGEST: 'digest',
  /** Aucune. Le badge reste, lui. */
  OFF: 'off',
});

export const BADGES = Object.freeze({
  UNSEEN: 'unseen',
  ENDING_TODAY: 'endingToday',
  OFF: 'off',
});

/** Deux annonces groupees ne se suivent pas a moins de vingt heures. */
export const DIGEST_INTERVAL_MS = 20 * 60 * 60 * 1000;

/* --------------------------------------------------------- heures calmes */

/** "23:00" -> 1380 minutes. Rend null sur une valeur illisible. */
export function readClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * L'instant tombe-t-il dans la plage calme ?
 *
 * La plage traverse minuit dans le cas normal (23 h -> 8 h), et c'est le cas
 * par defaut : on teste donc l'appartenance a une union de deux intervalles, et
 * jamais par soustraction d'heures.
 *
 * `zone` est un fuseau IANA. Sans lui on prendrait celui de la machine, ce qui
 * est le bon comportement en production et le pire des choix dans un test :
 * la suite passerait ou echouerait selon la region du portable qui la lance.
 */
export function inQuietHours(quiet, instant, zone) {
  /* Le mode vacances (2.84.0) : des heures calmes qui durent des jours. Tout
     ce qui passe par ici -- annonces, rappels, alertes, telephone -- est
     RETENU, comme la nuit, et non perdu. Voir effectiveQuiet. */
  const conge = quiet ? readVacation(quiet.vacation) : null;
  if (conge && instant >= conge.from && instant < conge.until) return true;
  if (!quiet || quiet.on !== true) return false;

  const start = readClock(quiet.start);
  const end = readClock(quiet.end);
  // Une plage illisible ne fait pas taire l'extension : en cas de doute, on
  // previent. Le silence est le mode qui perd des jeux.
  if (start === null || end === null || start === end) return false;

  const { hour, minute } = localParts(instant, zone);
  const nowMin = hour * 60 + minute;

  return start < end
    ? nowMin >= start && nowMin < end            // 08:00 -> 22:00, dans la journee
    : nowMin >= start || nowMin < end;           // 23:00 -> 08:00, a cheval sur minuit
}

/* -------------------------------------------------------------- vacances */

/** Le plus long depart accepte : deux mois. Au-dela, c'est une faute de saisie. */
export const VACATION_MAX_MS = 62 * 24 * 3600 * 1000;

/** Le mode vacances des reglages, relu : { from, until } en millisecondes, ou null. */
export function readVacation(v) {
  if (!v || typeof v !== 'object') return null;
  const from = Number(v.from);
  const until = Number(v.until);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from || until - from > VACATION_MAX_MS) return null;
  return { from, until };
}

/** Est-on en vacances a cet instant ? */
export function onVacation(v, now) {
  const r = readVacation(v);
  return Boolean(r && now >= r.from && now < r.until);
}

/**
 * Les heures calmes a appliquer : celles des reglages, plus les vacances.
 * C'est ce que tout ce qui previent doit lire -- et seulement ce qui
 * previent : la sauvegarde automatique, elle, ne se tait pas en vacances.
 */
export function effectiveQuiet(settings) {
  const quiet = (settings && settings.quiet) || {};
  const conge = readVacation(settings && settings.vacation);
  return conge ? { ...quiet, vacation: conge } : quiet;
}

/* ------------------------------------------------------------- decision */

/**
 * Faut-il annoncer maintenant, et sous quelle forme ?
 *
 * Rend `{ notify, hold, digest }` :
 *   - `notify` : envoyer une notification ;
 *   - `hold`   : ne PAS marquer les offres comme annoncees, pour reprendre plus
 *                tard. C'est la difference entre differer et supprimer ;
 *   - `digest` : la notification doit porter un compte plutot qu'un titre.
 */
export function decideAnnouncement({
  mode = MODES.EVERY,
  quiet,
  zone,
  now,
  count,
  lastDigestAt = null,
} = {}) {
  if (!count) return { notify: false, hold: false, digest: false };

  /* Mode « jamais » : rien n'est retenu. L'utilisateur n'a pas demande un
     report, il a demande le silence -- garder les offres en attente d'annonce
     ferait tout partir d'un coup le jour ou il rallume les notifications. */
  if (mode === MODES.OFF) return { notify: false, hold: false, digest: false };

  if (inQuietHours(quiet, now, zone)) return { notify: false, hold: true, digest: false };

  if (mode === MODES.DIGEST) {
    const due = lastDigestAt === null || now - lastDigestAt >= DIGEST_INTERVAL_MS;
    // Pas encore l'heure du resume : on retient, on n'oublie pas.
    return due
      ? { notify: true, hold: false, digest: true }
      : { notify: false, hold: true, digest: false };
  }

  return { notify: true, hold: false, digest: false };
}

/**
 * Les offres qui meritent un rappel avant de se terminer.
 *
 * `hours` a zero coupe le rappel. La borne est en heures parce que c'est ainsi
 * que le reglage est presente ; la convertir ici plutot que dans l'interface
 * evite qu'une des deux moities se trompe d'unite.
 */
export function endingSoon(offers, { now, hours = 6, isFinal = () => false }) {
  if (!hours) return [];
  const window = hours * 3600000;
  return (offers || []).filter((o) => (
    o
    && o.end !== null && o.end !== undefined
    && o.end - now > 0
    && o.end - now <= window
    && !o.remindedAt
    && !isFinal(o.verdict)
  ));
}

/**
 * Le nombre a poser sur le badge.
 *
 * Le badge est le canal de repli : quand les notifications sont coupees au
 * niveau du systeme, chrome.notifications.create reussit sans rien afficher et
 * rien ne le signale. Le badge, lui, se voit.
 */
export function badgeCount({ mode = BADGES.UNSEEN, unseen = 0, offers = [], now }) {
  if (mode === BADGES.OFF) return 0;
  if (mode === BADGES.ENDING_TODAY) {
    return (offers || []).filter((o) => (
      o && typeof o.end === 'number' && o.end - now > 0 && o.end - now <= 24 * 3600000
    )).length;
  }
  return unseen;
}

/** Les offres des magasins que l'utilisateur suit. Le catalogue garde tout. */
export function onlyWatched(offers, watched) {
  if (!Array.isArray(watched) || !watched.length) return offers || [];
  return (offers || []).filter((o) => o && watched.includes(o.store));
}

/* ------------------------------------------------- le canal de fonctionnement */

/**
 * Le canal des incidents. Deux valeurs seulement, et c'est voulu.
 *
 * Un incident n'a pas de « resume quotidien » : il y en a zero ou un, il dure,
 * et le grouper n'aurait aucun sens. Trois modes la ou deux suffisent
 * inviteraient a inventer un troisieme comportement pour l'occuper.
 */
export const ALERTS = Object.freeze({
  ON: 'on',
  OFF: 'off',
});

/**
 * Faut-il dire cet incident maintenant ?
 *
 * Meme forme que `decideAnnouncement`, et la meme distinction cruciale entre
 * `hold` et rien :
 *
 *   - HEURES CALMES -> differe. Un selecteur mort a trois heures du matin
 *     n'appelle aucun geste avant le lever, mais l'oublier ferait disparaitre
 *     la seule alerte qu'on aura jamais pour cette panne.
 *   - MODE COUPE -> supprime. L'utilisateur n'a pas demande un report, il a
 *     demande le silence ; retenir ferait tout partir d'un coup le jour ou il
 *     rallume.
 */
export function decideAlert({ mode = ALERTS.ON, quiet, zone, now, count } = {}) {
  if (!count) return { notify: false, hold: false };
  if (mode !== ALERTS.ON) return { notify: false, hold: false };
  if (inQuietHours(quiet, now, zone)) return { notify: false, hold: true };
  return { notify: true, hold: false };
}

/* ------------------------------------------------------------------ badge */

/** Couleur ordinaire du badge : le compte d'offres. */
export const BADGE_COLOR = '#FF8A3D';

/** Couleur d'un incident ouvert. Distincte, et pas seulement plus foncee. */
export const BADGE_ALERT_COLOR = '#C0392B';

/**
 * Ce qu'il faut peindre sur l'icone.
 *
 * Un incident ouvert PRIME sur le compte : une panne compte plus qu'un
 * decompte, que le popup affiche de toute facon. C'est aussi le seul canal qui
 * reste quand le systeme refuse nos notifications -- d'ou le fait qu'il
 * ignore `badgeMode`. Ce reglage dit « ne me compte pas les offres », pas
 * « ne me dis jamais rien », et confondre les deux enterrerait la derniere
 * voix disponible.
 */
export function badgeState({ mode = BADGES.UNSEEN, unseen = 0, offers = [], now, incidents } = {}) {
  if (incidents && Object.keys(incidents).length) {
    return { text: '!', color: BADGE_ALERT_COLOR };
  }
  const n = badgeCount({ mode, unseen, offers, now });
  return { text: n > 0 ? String(n) : '', color: BADGE_COLOR };
}
