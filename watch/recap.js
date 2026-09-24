/* Le recap du jeudi soir (2.65.0).
 *
 * Epic change ses jeux le jeudi a 17 h, heure de Paris. C'est le seul rendez-
 * vous regulier de la semaine, et le bon moment pour dire en une notification
 * ce que la veille a fait pendant qu'on ne regardait pas :
 *
 *   - ce qu'elle a RECUPERE depuis le jeudi precedent ;
 *   - ce qui reste A PRENDRE SOI-MEME : Steam sans l'option, les jeux mobiles,
 *     une reclamation arretee sur une connexion ou un defi ;
 *   - ce qui a ete RATE -- une offre finie sans que le jeu arrive ;
 *   - ce qu'Epic ANNONCE pour la suite.
 *
 * QUAND. Le jeudi a 18 h, heure de l'ordinateur -- une heure apres la
 * rotation, le temps qu'un cycle voie les nouveaux jeux et les prenne. Un
 * ordinateur eteint le jeudi soir le recoit au reveil, jusqu'au dimanche soir ;
 * passe ce delai, le recap de la semaine n'a plus de sens et ne part pas. Un
 * seul par semaine, quoi qu'il arrive : la date d'envoi est ecrite AVANT la
 * notification, comme partout dans ce depot -- mieux vaut en perdre un que
 * l'envoyer deux fois.
 *
 * Une semaine sans rien a dire ne notifie pas. Un recap « rien de neuf »
 * apprendrait a ignorer tous les autres.
 *
 * Module pur, sauf `runRecap`, qui recoit tout ce qu'il touche.
 */
import { STATES, STORES, displayTitle, isExpired } from './offer.js';
import { claimsMade } from './tally.js';
import { OUTCOMES, outcomeEntries } from './outcomes.js';
import { claimableStoresFor } from './sources/index.js';
import { KEYS, normaliseSettings } from './storage.js';
import { KEY_OUTCOMES } from './outcomes.js';
import { KEY_LIBRARY } from './library.js';

/** Le dernier recap envoye : { at }. Espace de la veille. */
export const KEY_RECAP = 'veille:recap';

/** Jeudi, 18 h, heure locale. */
export const RECAP_DAY = 4;
export const RECAP_HOUR = 18;

const DAY_MS = 24 * 3600 * 1000;

/** Au-dela, le recap de la semaine est perime : il ne part plus. */
export const RECAP_GRACE_MS = 3 * DAY_MS;

/** Les verdicts qui attendent une personne. Les memes que « Ce qui vous attend » du popup. */
const NEEDS_YOU = new Set(['needs_login', 'needs_link', 'challenge', 'quota', 'failed']);

/** Les historiques du moteur : les cles que `claimsMade` sait lire. */
export const HISTORY_KEYS = Object.freeze({
  'Epic Games': 'FGC_history_Epic Games',
  GOG: 'FGC_history_GOG',
  'Amazon Luna': 'FGC_history_Amazon Luna',
});

/** Le dernier jeudi 18 h (heure locale) qui n'est pas dans le futur. */
export function recapWindowStart(now, { day = RECAP_DAY, hour = RECAP_HOUR } = {}) {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  if (d.getTime() > now) d.setDate(d.getDate() - 7);
  return d.getTime();
}

/** Faut-il envoyer le recap maintenant ? */
export function recapDue(now, lastAt, opts) {
  const debut = recapWindowStart(now, opts);
  if (now - debut > RECAP_GRACE_MS) return false;
  return !(typeof lastAt === 'number' && lastAt >= debut);
}

/** Une liste de titres, bornee : « A, B, C +2 ». */
export function titleList(titles, max = 4) {
  const uniques = [...new Set((titles || []).filter(Boolean))];
  if (uniques.length <= max) return uniques.join(', ');
  return `${uniques.slice(0, max).join(', ')} +${uniques.length - max}`;
}

/** Les ouvertures qu'Epic annonce, la plus proche d'abord, une par jeu. */
export function announcedWindows(sources, now) {
  const windows = [];
  for (const [name, s] of Object.entries(sources || {})) {
    // Seule la source Epic annonce ses fenetres ; le nom le dit.
    const store = name.startsWith('epic') ? STORES.EPIC : null;
    for (const w of (s && s.announcedWindows) || []) {
      // Les premieres versions ne gardaient que l'instant.
      if (typeof w === 'number') { if (w > now) windows.push({ start: w, title: null, store }); }
      else if (w && (w.start ?? w.debut) > now) windows.push({ store, ...w, start: w.start ?? w.debut });
    }
  }
  windows.sort((a, b) => a.start - b.start);

  // Un jeu peut avoir plusieurs fenetres annoncees ; seule la plus proche compte.
  const seen = new Set();
  return windows.filter((w) => {
    const k = (w.title || String(w.start)).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Ce que la semaine raconte. `since` : le debut de la semaine ecoulee.
 */
export function buildRecap({
  histories = {}, catalog = {}, library = {}, outcomes = {}, sources = {}, settings = {}, now, since,
}) {
  const watched = Array.isArray(settings.watchedStores) ? settings.watchedStores : null;
  const suivi = (store) => !watched || watched.includes(store);

  /* Recupere : les reclamations du moteur, sans ce qu'il a seulement trouve
     deja a vous -- plus Steam, que le worker reclame lui-meme et qui ne passe
     pas par l'historique du moteur. */
  const claimed = claimsMade(histories, catalog, { since, library })
    .filter((r) => !r.already)
    .map((r) => ({ title: r.title, store: r.store, worth: r.worth, currency: r.currency }));
  for (const o of Object.values(catalog || {})) {
    if (!o || o.store !== STORES.STEAM || o.verdict !== 'claimed') continue;
    const quand = o.lastAttemptAt || o.updatedAt || 0;
    if (quand >= since && quand <= now) claimed.push({ title: o.title, store: o.store, worth: null, currency: null });
  }

  /* A prendre soi-meme : en cours, suivi, pas deja a vous, et que
     l'extension ne prendra pas -- faute de module, ou parce qu'elle s'est
     arretee sur quelque chose que seule une personne peut regler. */
  const reclamables = claimableStoresFor(settings);
  const manual = Object.values(catalog || {})
    .filter((o) => o && o.title && o.state !== STATES.EXPIRED && o.state !== STATES.RESOLVED)
    .filter((o) => !isExpired(o, now) && !(typeof o.start === 'number' && o.start > now))
    .filter((o) => suivi(o.store) && o.alreadyOwned !== true && o.keepable !== false)
    .filter((o) => !reclamables.includes(o.store) || (NEEDS_YOU.has(o.verdict) && (o.attempts || 0) > 0))
    .sort((a, b) => (typeof a.end === 'number' ? a.end : Infinity) - (typeof b.end === 'number' ? b.end : Infinity))
    .map((o) => ({ title: o.title, store: o.store, end: o.end ?? null }));

  /* Rate : une offre finie cette semaine sans que le jeu arrive. */
  const missed = outcomeEntries(outcomes)
    .filter((e) => e && e.outcome === OUTCOMES.MISSED && suivi(e.store))
    .filter((e) => typeof e.end === 'number' && e.end >= since && e.end <= now)
    .map((e) => ({ title: e.title, store: e.store }));

  /* Annonce : ce qu'Epic ouvrira dans les huit jours. */
  const upcoming = announcedWindows(sources, now)
    .filter((w) => w.title && w.start <= now + 8 * DAY_MS && suivi(w.store || STORES.EPIC))
    .map((w) => ({ title: w.title, start: w.start }));

  return { since, claimed, manual, missed, upcoming };
}

/** Y a-t-il quelque chose a dire ? */
export function hasNews(recap) {
  return Boolean(recap && (recap.claimed.length || recap.manual.length || recap.missed.length || recap.upcoming.length));
}

/**
 * La notification. `t` compose dans la langue choisie ; `total` est la valeur
 * recuperee deja mise en forme, ou null quand elle n'est pas lisible.
 */
export function composeRecap(recap, { t, storeLabel = (s) => s, total = null }) {
  const n = recap.claimed.length;
  /* Le titre tel que le popup l'affiche : « Dwarven Realms (Steam) Key
     Giveaway » de l'agregateur redevient « Dwarven Realms ». */
  const nom = (x) => displayTitle(x || '');
  const title = n === 0 ? t('recapTitle') : t(n === 1 ? 'recapTitleOne' : 'recapTitleMany', String(n));
  const lines = [];
  if (n) {
    const liste = titleList(recap.claimed.map((c) => nom(c.title)));
    lines.push(total ? t('recapClaimedWorth', liste, total) : t('recapClaimed', liste));
  }
  if (recap.manual.length) {
    lines.push(t('recapManual', titleList(recap.manual.map((m) => `${nom(m.title)} (${storeLabel(m.store)})`), 3)));
  }
  if (recap.missed.length) lines.push(t('recapMissed', titleList(recap.missed.map((m) => nom(m.title)), 3)));
  if (recap.upcoming.length) lines.push(t('recapNext', titleList(recap.upcoming.map((u) => nom(u.title)), 3)));
  return { title, lines, text: lines.join('\n') };
}

/** La valeur recuperee, dans une seule devise ; plusieurs devises ne s'additionnent pas. */
export function recapTotal(claimed, format) {
  const parDevise = {};
  for (const c of claimed || []) {
    if (typeof c.worth !== 'number' || !c.currency || c.currency === '?') continue;
    parDevise[c.currency] = (parDevise[c.currency] || 0) + c.worth;
  }
  const devises = Object.keys(parDevise);
  if (devises.length !== 1) return null;
  const montant = Math.round(parDevise[devises[0]] * 100) / 100;
  return montant > 0 ? format(montant, devises[0]) : null;
}

/**
 * Le recap, s'il est du : lit, decide, ecrit la date, puis previent.
 *
 * `notify({ id, title, message })` et `phone(msg)` sont fournis par le
 * worker. L'ordinateur suit `notifyMode` et les heures calmes ; le telephone
 * a son propre interrupteur. En heures calmes, rien n'est marque : le recap
 * repart au premier cycle du matin.
 */
export async function runRecap({
  chrome, now, t, storeLabel, format, notify, phone = null, quietNow = false, record = () => {},
}) {
  const cles = [KEYS.SETTINGS, KEYS.OFFERS, KEYS.SOURCES, KEY_OUTCOMES, KEY_LIBRARY, KEY_RECAP,
    ...Object.values(HISTORY_KEYS)];
  const raw = await chrome.storage.local.get(cles);
  const settings = normaliseSettings(raw[KEYS.SETTINGS]);
  if (settings.weeklyRecap === false) return { sent: false, why: 'off' };
  const dernier = raw[KEY_RECAP] && typeof raw[KEY_RECAP].at === 'number' ? raw[KEY_RECAP].at : null;
  if (!recapDue(now, dernier)) return { sent: false, why: 'not-due' };

  // En heures calmes, ni l'ordinateur ni le telephone : le recap attend le matin.
  if (quietNow) return { sent: false, why: 'quiet' };
  const ordinateur = settings.notifyMode !== 'off';

  const lire = (v) => {
    if (typeof v !== 'string') return v || {};
    try { return JSON.parse(v); } catch { return {}; }
  };
  /* Depuis le recap precedent, pour ne rien compter deux fois ; a defaut,
     depuis le jeudi d'avant. */
  const debut = recapWindowStart(now);
  const since = dernier !== null && dernier > debut - 14 * DAY_MS ? dernier : debut - 7 * DAY_MS;
  const recap = buildRecap({
    histories: Object.fromEntries(Object.entries(HISTORY_KEYS).map(([p, k]) => [p, lire(raw[k])])),
    catalog: raw[KEYS.OFFERS] || {},
    library: raw[KEY_LIBRARY] || {},
    outcomes: raw[KEY_OUTCOMES] || {},
    sources: raw[KEYS.SOURCES] || {},
    settings,
    now,
    since,
  });

  await chrome.storage.local.set({ [KEY_RECAP]: { at: now } });
  if (!hasNews(recap)) {
    record('info', 'recap du jeudi : rien a dire cette semaine');
    return { sent: false, why: 'empty', recap };
  }
  const { title, text } = composeRecap(recap, { t, storeLabel, total: recapTotal(recap.claimed, format) });
  if (ordinateur) await notify({ id: `recap-${now}`, title, message: text });
  if (phone) await phone({ title, message: text, priority: 3, tags: ['calendar'] });
  record('info', `recap du jeudi : ${recap.claimed.length} recupere(s), ${recap.manual.length} a prendre, ${recap.missed.length} rate(s), ${recap.upcoming.length} annonce(s)`);
  return { sent: true, recap, title, text };
}
