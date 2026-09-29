/* Le mode vacances (2.84.0).
 *
 * Partir une semaine sans ordinateur, c'est revenir a une pile de
 * notifications : une par jeu, une par rappel, une alerte de session, et le
 * telephone qui a sonne tous les jours pour rien. Or la recuperation, elle,
 * n'a besoin de personne.
 *
 * Le mode vacances est donc des heures calmes qui durent des jours :
 * `effectiveQuiet` (notify-policy.js) les ajoute a celles des reglages, et
 * tout ce qui previent -- annonces, rappels avant la fin, alertes, rappels de
 * code, recap du jeudi, telephone -- les lit. Comme la nuit, ce qui arrive est
 * RETENU, jamais perdu : une offre encore ouverte au retour s'annonce au
 * premier cycle, un code qui expire se rappelle.
 *
 * Et au retour, un seul message : ce qui a ete recupere pendant l'absence, ce
 * qui reste a prendre soi-meme, ce qui a ete rate -- le recap du jeudi,
 * compte depuis le depart. Il remplace le recap de la semaine, qui ne part pas
 * en plus.
 *
 * Module pur, sauf `runReturnSummary`, qui recoit tout ce qu'il touche.
 */
import { readVacation } from './notify-policy.js';
import { HISTORY_KEYS, KEY_RECAP, buildRecap, composeRecap, recapTotal } from './recap.js';
import { KEYS, normaliseSettings } from './storage.js';
import { KEY_OUTCOMES } from './outcomes.js';
import { KEY_LIBRARY } from './library.js';

/** Le resume du retour, deja envoye pour quel depart : { summarizedFor, at }. Espace de la veille. */
export const KEY_VACATION = 'veille:vacances';

const DAY_MS = 24 * 3600 * 1000;

/** Les durees proposees, en jours. */
export const VACATION_CHOICES = Object.freeze([3, 7, 14, 21, 30]);

/** Un retour plus vieux qu'une semaine ne se resume plus : il n'apprendrait rien. */
export const RETURN_GRACE_MS = 7 * DAY_MS;

/** Le depart : maintenant, pour `days` jours (1 a 60). */
export function planVacation(days, now) {
  const n = Math.min(60, Math.max(1, Math.round(Number(days) || 0)));
  return { from: now, until: now + n * DAY_MS };
}

/** Le resume du retour est-il du ? Une fois par depart, dans la semaine qui suit la fin. */
export function returnDue(vacation, state, now) {
  const v = readVacation(vacation);
  if (!v || now < v.until || now - v.until > RETURN_GRACE_MS) return false;
  return !(state && state.summarizedFor === v.until);
}

/**
 * Le message du retour. Les lignes sont celles du recap du jeudi -- recupere,
 * a prendre, rate, annonce -- ; le titre dit d'ou l'on revient.
 */
export function composeReturn(recap, { t, storeLabel = (s) => s, total = null }) {
  const n = recap.claimed.length;
  const title = n
    ? t(n === 1 ? 'vacationBackTitleOne' : 'vacationBackTitleMany', String(n))
    : t('vacationBackTitle');
  const { lines, icons } = composeRecap(recap, { t, storeLabel, total });
  if (!lines.length) { lines.push(t('vacationBackNothing')); icons.push('😌'); }
  return { title, text: lines.join('\n'), icons };
}

/**
 * Le resume du retour, s'il est du : lit, compose, marque, previent.
 *
 * `quietNow` : les heures calmes de la nuit -- le retour attend le matin.
 * Le recap du jeudi est marque fait en meme temps : deux messages pour dire
 * la meme semaine, c'est un de trop.
 */
export async function runReturnSummary({
  chrome, now, t, storeLabel, format, notify, phone = null, quietNow = false, record = () => {},
}) {
  const cles = [KEYS.SETTINGS, KEYS.OFFERS, KEYS.SOURCES, KEY_OUTCOMES, KEY_LIBRARY, KEY_VACATION,
    ...Object.values(HISTORY_KEYS)];
  const raw = await chrome.storage.local.get(cles);
  const settings = normaliseSettings(raw[KEYS.SETTINGS]);
  if (!returnDue(settings.vacation, raw[KEY_VACATION], now)) return { sent: false, why: 'not-due' };
  if (quietNow) return { sent: false, why: 'quiet' };

  const v = readVacation(settings.vacation);
  const lire = (x) => {
    if (typeof x !== 'string') return x || {};
    try { return JSON.parse(x); } catch { return {}; }
  };
  const recap = buildRecap({
    histories: Object.fromEntries(Object.entries(HISTORY_KEYS).map(([p, k]) => [p, lire(raw[k])])),
    catalog: raw[KEYS.OFFERS] || {},
    library: raw[KEY_LIBRARY] || {},
    outcomes: raw[KEY_OUTCOMES] || {},
    sources: raw[KEYS.SOURCES] || {},
    settings,
    now,
    since: v.from,
  });

  await chrome.storage.local.set({ [KEY_VACATION]: { summarizedFor: v.until, at: now }, [KEY_RECAP]: { at: now } });
  const { title, text, icons } = composeReturn(recap, { t, storeLabel, total: recapTotal(recap.claimed, format) });
  if (settings.notifyMode !== 'off') await notify({ id: `retour-${now}`, title, message: text });
  if (phone) await phone({ title, message: text, priority: 3, tags: ['palm_tree'], icons });
  record('info', `retour de vacances : ${recap.claimed.length} recupere(s), ${recap.manual.length} a prendre, ${recap.missed.length} rate(s)`);
  return { sent: true, recap, title, text };
}
