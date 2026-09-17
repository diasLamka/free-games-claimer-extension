/* Horaires ancres sur un fuseau NOMME.
 *
 * Pourquoi ce module existe : les magasins publient a une heure locale, pas a
 * une heure UTC. Epic lache "a 11:00 heure de New York". Ecrire cette regle
 * comme "17:00 a Paris" est faux deux fois par an : les Etats-Unis et l'Europe
 * ne changent pas d'heure les memes week-ends. En 2026, les Etats-Unis passent
 * a l'heure d'ete le 8 mars et l'Europe le 29 mars : pendant ces trois
 * semaines, 11:00 a New York vaut 16:00 a Paris, pas 17:00. Meme chose entre
 * le 25 octobre et le 1er novembre.
 *
 * Tout passe donc par Intl.DateTimeFormat, seule source de verite sur les
 * fuseaux dans la plateforme, et aucune arithmetique sur les heures.
 *
 * Module pur, sans dependance. Toutes les fonctions prennent l'instant en
 * parametre : aucune ne lit l'horloge.
 */

const DAYS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

/** Un formateur par fuseau : leur construction est couteuse, leur reutilisation gratuite. */
const FORMATTERS = new Map();

function formateur(zone) {
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23', // sinon minuit se formate en "24"
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    FORMATTERS.set(zone, f);
  }
  return f;
}

/** Verifie qu'un fuseau est connu de la plateforme. */
export function validZone(zone) {
  try {
    formateur(zone);
    return true;
  } catch {
    return false;
  }
}

/** L'heure locale, decomposee, a un instant donne. */
export function localParts(instant, zone) {
  const parts = formateur(zone).formatToParts(new Date(instant));
  const readKeys = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : null;
  };
  return {
    year: Number(readKeys('year')),
    month: Number(readKeys('month')),
    day: Number(readKeys('day')),
    hour: Number(readKeys('hour')),
    minute: Number(readKeys('minute')),
    second: Number(readKeys('second')),
    weekday: DAYS[readKeys('weekday')],
  };
}

/** Decalage du fuseau par rapport a UTC, en millisecondes, a cet instant. */
export function offset(instant, zone) {
  const aligned = instant - (instant % 1000);
  const p = localParts(aligned, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - aligned;
}

/**
 * L'instant UTC correspondant a une heure murale dans un fuseau.
 *
 * On ne peut pas simplement soustraire "le" decalage : celui a appliquer
 * depend de l'instant qu'on cherche. Une iteration de point fixe semble
 * marcher, mais elle converge d'un cote ou de l'autre d'une transition selon
 * le sens de celle-ci -- mesure le 2026-08-27 : sur la meme demande de 02:30,
 * elle rendait 01:30 pour New York et 03:30 pour Paris ; et sur une heure
 * ambigue, la premiere occurrence pour New York et la seconde pour Paris.
 * Comportement arbitraire, donc inutilisable.
 *
 * La methode retenue n'itere pas : les decalages de la veille et du lendemain
 * encadrent forcement toute transition, ce qui donne deux candidats. Il suffit
 * ensuite de relire chacun dans le fuseau pour savoir lequel tient :
 *
 *   - deux candidats valides et distincts -> heure AMBIGUE (automne, 02:30
 *     existe deux fois). On rend la PREMIERE, encore en heure d'ete, et
 *     `exact` vaut true. Declencher tot vaut mieux que tard pour une veille.
 *   - un seul valide -> cas normal.
 *   - aucun valide -> heure INEXISTANTE (printemps, on saute de 2h a 3h). On
 *     rend le plus tardif, qui tombe apres le trou, et `exact` vaut false.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

export function instantFromLocal(zone, { year, month, day, hour = 0, minute = 0, second = 0 }) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);

  const matchesQuery = (instant) => {
    const p = localParts(instant, zone);
    return p.year === year
      && p.month === month
      && p.day === day
      && p.hour === hour
      && p.minute === minute;
  };

  const candidates = [
    target - offset(target - DAY_MS, zone),
    target - offset(target + DAY_MS, zone),
  ];

  const valid = [...new Set(candidates)].filter(matchesQuery).sort((a, b) => a - b);
  if (valid.length) return { instant: valid[0], exact: true };

  return { instant: Math.max(...candidates), exact: false };
}

/* ------------------------------------------------------------------ regles */

/**
 * Une regle de calendrier decrit quand une source lache habituellement :
 *
 *   { fuseau: 'America/New_York', jours: [4], heure: 11, minute: 0 }  // jeudi
 *   { fuseau: 'UTC', quotidien: true, heure: 12 }                     // tous les jours
 *
 * `jours` suit la convention JavaScript : 0 = dimanche, 4 = jeudi.
 */
export function validRule(rule) {
  if (!rule || typeof rule !== 'object') return false;
  if (!validZone(rule.zone)) return false;
  const h = rule.hour;
  const m = rule.minute === undefined ? 0 : rule.minute;
  if (!Number.isInteger(h) || h < 0 || h > 23) return false;
  if (!Number.isInteger(m) || m < 0 || m > 59) return false;
  if (rule.daily) return true;
  return Array.isArray(rule.dayCount)
    && rule.dayCount.length > 0
    && rule.dayCount.every((j) => Number.isInteger(j) && j >= 0 && j <= 6);
}

/**
 * Prochaine occurrence d'une regle, strictement apres l'instant donne.
 *
 * L'iteration se fait sur le CALENDRIER LOCAL, jour apres jour, jamais en
 * ajoutant 24 heures : un jour de changement d'heure dure 23 ou 25 heures, et
 * toute arithmetique en millisecondes finit par deriver.
 *
 * Rend null si la regle est invalide, ou si aucune occurrence n'est trouvee en
 * un peu plus d'un an -- ce qui ne peut arriver qu'avec une regle absurde.
 */
export function nextOccurrence(rule, apres, { limiteJours = 370 } = {}) {
  if (!validRule(rule)) return null;

  const minute = rule.minute === undefined ? 0 : rule.minute;
  const startAt = localParts(apres, rule.zone);

  for (let i = 0; i <= limiteJours; i++) {
    // On avance en jours calendaires locaux via Date.UTC, qui sert ici de
    // simple calculatrice de calendrier : aucun fuseau n'intervient.
    const civil = new Date(Date.UTC(startAt.year, startAt.month - 1, startAt.day + i));
    const year = civil.getUTCFullYear();
    const month = civil.getUTCMonth() + 1;
    const day = civil.getUTCDate();
    const weekday = civil.getUTCDay();

    if (!rule.daily && !rule.dayCount.includes(weekday)) continue;

    const { instant, exact } = instantFromLocal(rule.zone, {
      year, month, day, hour: rule.hour, minute,
    });

    if (instant > apres) return { instant, exact, year, month, day, weekday };
  }

  return null;
}

/**
 * Les N prochaines occurrences d'une regle. Sert a peindre les creneaux d'une
 * source sur les 24 heures a venir dans le tableau de bord.
 */
export function nextOccurrences(rule, apres, howMany, options) {
  const then = [];
  let cursor = apres;
  for (let i = 0; i < howMany; i++) {
    const o = nextOccurrence(rule, cursor, options);
    if (!o) break;
    then.push(o);
    cursor = o.instant;
  }
  return then;
}
