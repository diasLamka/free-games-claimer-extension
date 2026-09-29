/* Le rappel avant qu'un code expire (2.73.0).
 *
 * Luna donne certains jeux sous forme de CODE a echanger ailleurs -- GOG,
 * Microsoft -- avec une date limite : « a utiliser avant le 31 octobre 2026 ».
 * L'onglet Codes l'affiche, en rouge a sept jours. Encore faut-il l'ouvrir :
 * un code oublie au fond de l'onglet est un jeu perdu, sans bruit, et c'est
 * exactement le genre de perte que cette extension existe pour eviter.
 *
 * Deux rappels par code, pas plus : a SEPT JOURS, le temps de s'en occuper
 * tranquillement, et le DERNIER JOUR (la veille ou le jour meme). Chacun ne
 * part qu'une fois : ce qui a ete dit est retenu, et un code echange, refuse
 * ou retire sort du registre.
 *
 * LE CODE LUI-MEME NE PART JAMAIS -- ni dans la notification, ni vers le
 * telephone. Le titre du jeu, le magasin et la date suffisent a savoir quoi
 * faire ; le code, lui, reste dans l'onglet Codes. C'est la regle ecrite dans
 * SECURITY.md pour le telephone, et elle vaut aussi pour l'ecran, qu'un
 * voisin peut lire.
 *
 * Module pur, sauf `runCodeReminders`, qui recoit tout ce qu'il touche.
 */
import { CODE_STATUS, codeStatus, deadlineDay, redeemUrlFor } from './codes.js';
import { KEY_CODES } from './backup.js';

/** Ce qui a deja ete rappele : { [code]: 'week' | 'last' }. Espace de la veille. */
export const KEY_CODE_REMINDERS = 'veille:rappels-codes';

const DAY_MS = 24 * 3600 * 1000;

/** Les deux rappels, du plus tot au plus tard. */
export const LEVELS = Object.freeze({ WEEK: 'week', LAST: 'last' });
export const WEEK_DAYS = 7;

/**
 * Les jours qui restent, comptes comme l'onglet Codes les compte : jusqu'au
 * debut du jour limite, heure locale. 0 = c'est le dernier jour ; negatif =
 * passe ; null = date illisible.
 */
export function daysLeft(deadline, now) {
  const d = deadlineDay(deadline);
  if (!d) return null;
  const n = Math.ceil((new Date(d.year, d.month, d.day).getTime() - now) / DAY_MS);
  return n === 0 ? 0 : n; // jamais -0 : le jour meme est 0
}

/** Le rappel que merite ce nombre de jours, ou null. */
export function levelFor(left) {
  if (left === null || left < 0) return null;
  if (left <= 1) return LEVELS.LAST;
  if (left <= WEEK_DAYS) return LEVELS.WEEK;
  return null;
}

/** Les codes, tels que le stockage les rend : un tableau, ou son texte JSON. */
export function readCodes(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v.filter((c) => c && typeof c.code === 'string' && c.code) : [];
}

/**
 * Les rappels a faire maintenant, et le registre suivant.
 *
 * Un code deja rappele a sept jours peut encore l'etre le dernier jour ; un
 * code rappele le dernier jour ne l'est plus. Le registre ne garde que les
 * codes encore en attente : il ne grossit pas.
 */
export function dueReminders(codes, sent, now) {
  const registre = sent && typeof sent === 'object' ? sent : {};
  const suivant = {};
  const dus = [];
  for (const c of codes || []) {
    if (codeStatus(c) !== CODE_STATUS.PENDING) continue;
    const deja = registre[c.code] || null;
    if (deja) suivant[c.code] = deja;
    const left = daysLeft(c.deadline, now);
    const niveau = levelFor(left);
    // Deja dit a ce niveau, ou deja dit le dernier jour : plus rien a dire.
    if (!niveau || deja === niveau || deja === LEVELS.LAST) continue;
    dus.push({ code: c.code, title: c.title || null, store: c.store || null, deadline: c.deadline, left, level: niveau });
    suivant[c.code] = niveau;
  }
  dus.sort((a, b) => a.left - b.left);
  return { due: dus, sent: suivant };
}

/**
 * Le texte du rappel -- sans le code. `t` compose dans la langue choisie,
 * `storeLabel` nomme le magasin.
 */
export function composeReminder(due, { t, storeLabel = (s) => s }) {
  if (!due.length) return null;
  const premier = due[0];
  const nom = (d) => d.title || storeLabel(d.store);
  const quand = (d) => (d.left <= 0 ? t('codeRemindToday') : d.left === 1 ? t('codeRemindTomorrow') : t('codeRemindDays', String(d.left)));
  const title = due.length === 1
    ? t('codeRemindTitleOne', storeLabel(premier.store), quand(premier))
    : t('codeRemindTitleMany', String(due.length));
  const lines = due.slice(0, 4).map((d) => t('codeRemindLine', nom(d), storeLabel(d.store), d.deadline));
  const icons = lines.map(() => '🔑');
  if (due.length > 4) { lines.push(`+${due.length - 4}`); icons.push('➕'); }
  lines.push(t(due.length === 1 ? 'codeRemindWhere' : 'codeRemindWhereMany'));
  icons.push('💡');
  return { title, text: lines.join('\n'), icons, url: redeemUrlFor(premier.store) };
}

/**
 * Les rappels, s'il y en a : lit, decide, ecrit le registre, puis previent.
 *
 * `notify` et `phone` sont fournis par le worker. Les heures calmes retiennent
 * tout -- rien n'est marque, le rappel repart au matin : un code a sept jours
 * peut attendre la nuit, et un « dernier jour » vu a 8 h laisse la journee.
 */
export async function runCodeReminders({
  chrome, now, t, storeLabel, notify, phone = null, quietNow = false, computer = true, record = () => {},
}) {
  if (quietNow) return { sent: 0, why: 'quiet' };
  const raw = await chrome.storage.local.get([KEY_CODES, KEY_CODE_REMINDERS]);
  const { due, sent } = dueReminders(readCodes(raw[KEY_CODES]), raw[KEY_CODE_REMINDERS], now);
  const avant = JSON.stringify(raw[KEY_CODE_REMINDERS] || {});
  if (JSON.stringify(sent) !== avant) await chrome.storage.local.set({ [KEY_CODE_REMINDERS]: sent });
  if (!due.length) return { sent: 0, why: 'none' };

  const msg = composeReminder(due, { t, storeLabel });
  if (computer) await notify({ id: `code-${now}`, title: msg.title, message: msg.text, url: msg.url });
  if (phone) await phone({ title: msg.title, message: msg.text, priority: 4, tags: ['key'], click: msg.url || null, icons: msg.icons });
  record('info', `rappel de code : ${due.length} code(s) bientot perime(s)`);
  return { sent: due.length, due };
}
