/* Les grandes saisons : les semaines ou un magasin offre un jeu CHAQUE JOUR.
 *
 * Pourquoi ce fichier existe : la veille sait quand regarder a l'heure pres --
 * le jeudi 11:00 a New York pour Epic --, mais pas qu'en fin d'annee la regle
 * change. Pendant les quinze jours de cadeaux de decembre, un jeu tombe a la
 * meme heure TOUS les jours ; avec la seule regle du jeudi, six jours sur sept
 * ne sont couverts que par le plancher de verification (trois par jour).
 *
 * Deux choses, et seulement deux :
 *
 *  1. UN CALENDRIER, modifiable : une regle quotidienne bornee a une partie de
 *     l'annee (voir `season` dans clock.js), ajoutee a celles d'Epic. Par
 *     defaut du 15 decembre au 2 janvier, a l'heure habituelle d'Epic.
 *  2. UNE DETECTION, hors calendrier : quand les ouvertures qu'Epic annonce ou
 *     a deja faites sont espacees d'un jour, trois fois de suite, la
 *     prochaine est attendue le lendemain a la meme heure.
 *
 * CE QUE CE MODULE EST, ET N'EST PAS.
 *
 * Il dit QUAND regarder, jamais QUEL jeu. Aucune date de debut ni de fin n'est
 * fabriquee : ce que la source publie reste prioritaire, et une saison qui se
 * trompe de quelques jours coute une quinzaine de requetes par jour inutile,
 * pas un jeu rate. Les dates par defaut sont celles des editions passees
 * (mi-decembre a debut janvier) : Epic ne les publie nulle part a l'avance.
 *
 * Module PUR : l'instant est toujours un parametre.
 */
import { NAME as EPIC } from '../sources/epic.js';
import { localParts, nextOccurrence, validSeason, inSeason } from './clock.js';

/** Ou le reglage vit dans le stockage. */
export const KEY_SEASONS = 'veille:saisons';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** L'heure d'Epic : 11:00 a New York, comme la regle du jeudi (voir rules.js). */
export const SEASON_ZONE = 'America/New_York';
export const SEASON_HOUR = 11;
export const SEASON_MINUTE = 0;

export const DEFAULT_SEASON = Object.freeze({
  from: Object.freeze({ month: 12, day: 15 }),
  until: Object.freeze({ month: 1, day: 2 }),
});

/** Detection : combien d'ouvertures d'un jour d'ecart avant de croire a un regime quotidien. */
export const RUN_MIN = 3;
/** Ecart tolere entre deux ouvertures : un jour, a un changement d'heure et un retard pres. */
export const RUN_GAP_MIN_MS = 22 * HOUR;
export const RUN_GAP_MAX_MS = 26 * HOUR;
/** On ne regarde que les ouvertures recentes : un vieux regime ne dit rien d'aujourd'hui. */
export const RUN_LOOKBACK_MS = 30 * DAY;

function monthDay(x) {
  return x && Number.isInteger(x.month) && Number.isInteger(x.day)
    ? { month: x.month, day: x.day }
    : null;
}

/**
 * Le reglage, rendu sain : `{ on, from, until }`.
 *
 * Absent ou abime, il vaut le defaut (actif, 15 decembre - 2 janvier). Une
 * paire de bornes invalide est rejetee ENTIERE : melanger une borne de
 * l'utilisateur et une borne du defaut ferait une saison que personne n'a
 * choisie.
 */
export function readSeasons(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const from = monthDay(r.from);
  const until = monthDay(r.until);
  const custom = from && until && validSeason({ from, until });
  return {
    on: r.on !== false,
    from: custom ? from : { ...DEFAULT_SEASON.from },
    until: custom ? until : { ...DEFAULT_SEASON.until },
  };
}

/** Les regles de calendrier que la saison ajoute a celles d'Epic -- aucune si elle est coupee. */
export function seasonRules(raw) {
  const s = readSeasons(raw);
  if (!s.on) return [];
  return [{
    zone: SEASON_ZONE,
    daily: true,
    hour: SEASON_HOUR,
    minute: SEASON_MINUTE,
    season: { from: s.from, until: s.until },
  }];
}

/**
 * Les regles de toutes les sources, saison comprise.
 *
 * Une liste Epic VIDE posee par l'utilisateur est un choix (voir
 * `schedulesWithDefaults`) : il a coupe la regle d'Epic, la saison ne la
 * rallume pas. Elle a de toute facon son propre interrupteur. `stored` est ce
 * que l'utilisateur a pose, avant les defauts.
 */
export function withSeasons(schedules, raw, stored) {
  const cut = stored && Array.isArray(stored[EPIC]) && stored[EPIC].length === 0;
  if (cut) return schedules;
  const extra = seasonRules(raw);
  if (!extra.length) return schedules;
  return { ...schedules, [EPIC]: [...(schedules[EPIC] || []), ...extra] };
}

/**
 * Ou en est la saison, pour le dire dans les reglages :
 * `{ state: 'off' }`, `{ state: 'on', until }` ou `{ state: 'soon', from }`.
 *
 * L'instant present se lit dans le calendrier de New York, celui de la regle :
 * le 15 decembre a 22 h a Paris est deja le 15 a New York, mais le 15 a 03 h
 * du matin a Paris est encore le 14 la-bas.
 */
export function seasonStatus(raw, now) {
  const s = readSeasons(raw);
  if (!s.on) return { state: 'off' };
  const p = localParts(now, SEASON_ZONE);
  if (inSeason(s, p.month, p.day)) return { state: 'on', until: s.until };
  return { state: 'soon', from: s.from };
}

/* ------------------------------------------------------------- detection */

/** Les ouvertures observees d'une source : le DEBUT de ses offres, recentes. */
export function startsOf(catalog, source, now) {
  const out = [];
  for (const o of Object.values(catalog || {})) {
    if (!o || o.source !== source || typeof o.start !== 'number') continue;
    if (o.start < now - RUN_LOOKBACK_MS) continue;
    out.push(o.start);
  }
  return out;
}

/**
 * Le regime quotidien le plus recent dans une liste d'ouvertures, ou null.
 *
 * Les ouvertures sont triees et dedoublonnees a l'heure pres (deux jeux qui
 * tombent ensemble ne font qu'un jour), puis on cherche une suite d'au moins
 * `RUN_MIN` ouvertures espacees d'un jour. Rend `{ length, first, last }`.
 */
export function dailyRun(starts) {
  const sorted = [...new Set((starts || []).filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  const days = [];
  for (const t of sorted) {
    if (days.length && t - days[days.length - 1] < HOUR) continue;
    days.push(t);
  }

  let best = null;
  let from = 0;
  for (let i = 1; i <= days.length; i++) {
    const gap = i < days.length ? days[i] - days[i - 1] : null;
    const goesOn = gap !== null && gap >= RUN_GAP_MIN_MS && gap <= RUN_GAP_MAX_MS;
    if (goesOn) continue;
    const length = i - from;
    if (length >= RUN_MIN) best = { length, first: days[from], last: days[i - 1] };
    from = i;
  }
  return best;
}

/**
 * La prochaine ouverture attendue d'un regime quotidien : le lendemain de la
 * derniere, a la meme heure de New York -- ou rien.
 *
 * Un seul jour au-dela de la derniere ouverture connue : si le regime
 * continue, la source annoncera le suivant ; s'il est fini, le pari coute une
 * fenetre chaude (une quinzaine de requetes), pas davantage. Un regime dont la
 * derniere ouverture date de plus d'un jour et demi est tenu pour fini.
 */
export function projectDailyRun(starts, now) {
  const run = dailyRun(starts);
  if (!run) return [];
  if (run.last < now - 36 * HOUR) return [];
  const p = localParts(run.last, SEASON_ZONE);
  const next = nextOccurrence(
    { zone: SEASON_ZONE, daily: true, hour: p.hour, minute: p.minute },
    run.last,
  );
  return next ? [next.instant] : [];
}
