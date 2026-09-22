/* Popup: the product's face.
 *
 * It reads the same storage the content script writes and IMPORTS the watch
 * modules instead of copying their rules, so a worth threshold or a drop reason
 * cannot drift between what the interface shows and what the service worker
 * does.
 *
 * Two divisions of labour worth knowing before editing:
 *
 *   - The CATALOGUE HAS ONE WRITER, the service worker. Anything here that
 *     would change an offer goes through a message, never a direct write. What
 *     the popup owns outright: pending codes, filters, settings, and its own
 *     presentation preferences.
 *
 *   - TEXT COMES FROM _locales, never from a literal in this file. `t('key')`
 *     everywhere; the build refuses a key that does not exist in both locales,
 *     which is the only way a missing translation shows up before shipping.
 */
import { t, translateDocument, setLocale, intlLocale } from './i18n.js';
import { STORE_LABELS, STORES, normaliseTitle } from './watch/offer.js';
import {
  preview, judge, REASONS, readWorth, readCurrency, UNKNOWN_CURRENCY,
} from './watch/filters.js';
import { KEY_RATES, toBase, baseOf } from './watch/rates.js';
import { KEY_COUNTRY, KEY_LANG, COUNTRIES, currencyFor, normaliseCountry, normaliseLang } from './watch/locale.js';
import { claimsMade, tally, mainStore, buildExport, exportFileName } from './watch/tally.js';
import { band24h, isTrustworthy } from './watch/schedule/prediction.js';
import { claimableStoresFor } from './watch/sources/index.js';
import { DEFAULT_SETTINGS } from './watch/storage.js';

import { KEY_LIBRARY, ownedTitles, ownedKeys } from './watch/library.js';
import { KEY_CANARY, alerts as canaryAlerts } from './watch/canary.js';
import { KEY_INCIDENTS, KINDS as INCIDENT_KINDS, openIncidents } from './watch/incidents.js';
import { KEY_WISHLIST, isWished } from './watch/wishlist.js';
import { REDEEM_URLS, addCodes, parseCodes, redeemUrlFor } from './watch/codes.js';
import { OPTIONAL, declaresOptional, describeBackground } from './watch/permissions.js';
import { KEY_SYNC_CODES } from './watch/backup.js';
import { failingSources, reasonText } from './watch/sentinel.js';
import {
  KEY_SESSIONS, SESSION, PROBED_STORES, LOGIN_URLS, readSession, summarise, isStale,
} from './watch/session.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

/* ------------------------------------------------------------------- stores */

/**
 * The four the product is actually about. Everything else is opt-in.
 *
 * `claim` says whether the extension claims there WITHOUT being asked. Steam
 * does not: its subscriber agreement forbids scripted interaction with its
 * services (4.C), with termination and no notice (4.D). It is detected, shown,
 * put one click away -- and claimed only if the user turns on `steamAutoClaim`
 * after reading the warning, in which case its row says so.
 */
const PRIMARY = [
  { id: STORES.EPIC, tag: 'EPIC', claim: true, mode: 'FGC_epic_auto_mode', history: 'FGC_history_Epic Games', url: 'https://store.epicgames.com/free-games' },
  { id: STORES.GOG, tag: 'GOG', claim: true, mode: null, history: 'FGC_history_GOG', url: 'https://www.gog.com/redeem' },
  { id: STORES.AMAZON, tag: 'LUNA', claim: true, mode: 'FGC_luna_auto_mode', history: 'FGC_history_Amazon Luna', url: 'https://luna.amazon.com/claims/home?filter=Game&g=s' },
  { id: STORES.STEAM, tag: 'STEAM', claim: false, mode: null, history: null, url: 'https://store.steampowered.com/search/?maxprice=free&specials=1' },
];

/**
 * Watched only if asked. None of these has a claim module, so checking one means
 * "show it and tell me", never "take it for me" -- and the label in the panel
 * says exactly that rather than implying more.
 */
const SECONDARY = [
  { id: STORES.MICROSOFT, tag: 'MS' },
  { id: STORES.UBISOFT, tag: 'UBI' },
  { id: STORES.EA, tag: 'EA' },
  { id: STORES.BLIZZARD, tag: 'BNET' },
  { id: STORES.INDIEGALA, tag: 'IG' },
  { id: STORES.FANATICAL, tag: 'FAN' },
  { id: STORES.HUMBLE, tag: 'HUMBLE' },
  { id: STORES.LEGACY, tag: 'LEGACY' },
];

const TAGS = Object.fromEntries([...PRIMARY, ...SECONDARY].map((s) => [s.id, s.tag]));
const DEFAULT_WATCHED = PRIMARY.map((s) => s.id);

const HISTORY_KEYS = {
  'Epic Games': 'FGC_history_Epic Games',
  GOG: 'FGC_history_GOG',
  'Amazon Luna': 'FGC_history_Amazon Luna',
};

/* Engine verdicts, and the technical reasons it sometimes files under `reason`.
   Without a translation the reason showed up verbatim IN PLACE OF the game's
   title -- "ALREADY_OWNED" as a name. These are statuses, not titles. */
const VERDICT_KEYS = {
  claimed: ['verdictClaimed', 'ok'],
  redeemed: ['verdictRedeemed', 'ok'],
  already_redeemed: ['verdictAlreadyRedeemed', 'wait'],
  code_pending_gog: ['verdictCodePending', 'wait'],
  code_copied: ['verdictCodeCopied', 'wait'],
  needs_link: ['verdictNeedsLink', 'wait'],
  needs_login: ['verdictNeedsLogin', 'wait'],
  challenge: ['verdictChallenge', 'wait'],
  skipped: ['verdictSkipped', 'wait'],
  bad_url: ['verdictBadUrl', 'ko'],
  failed: ['verdictFailed', 'ko'],
  expired: ['verdictExpired', 'wait'],
  upcoming: ['verdictUpcoming', 'wait'],
  undetermined: ['verdictUndetermined', 'wait'],
  quota: ['verdictQuota', 'wait'],
};

const REASON_KEYS = {
  ALREADY_OWNED: ['reasonAlreadyOwned', 'ok'],
  ALREADY_CLAIMED: ['reasonAlreadyClaimed', 'ok'],
  STOP: ['reasonStop', 'wait'],
};

/* Pourquoi une offre ne sera pas prise pour vous. Les motifs viennent de
   judge(), la meme fonction que la veille utilise : la puce ne peut donc pas
   dire quelque chose que le moteur contredirait. */
const DROP_KEYS = {
  [REASONS.STORE_UNSUPPORTED]: 'dropUnsupported',
  [REASONS.STORE_UNKNOWN]: 'dropUnknownStore',
  [REASONS.STORE_DISABLED]: 'dropDisabled',
  [REASONS.BELOW_THRESHOLD]: 'dropBelow',
  [REASONS.NO_WORTH]: 'dropNoWorth',
  [REASONS.NOTHING_TO_KEEP]: 'dropNothingToKeep',
  [REASONS.ALREADY_OWNED]: 'dropAlreadyOwned',
  [REASONS.EXTRA_CONTENT]: 'dropExtra',
  [REASONS.TITLE_EXCLUDED]: 'dropExcluded',
  [REASONS.NO_DESTINATION]: 'dropNoPage',
};

const SOURCE_LABELS = { 'epic-api': 'Epic Games', gamerpower: 'GamerPower', gog: 'GOG', steam: 'Steam' };

/* ------------------------------------------------------------------ storage */

const KEY_UI = 'veille:ui';
const KEY_SETTINGS = 'veille:reglages';
const KEY_FILTERS = 'veille:filtres';
const KEY_CATALOG = 'veille:offres';
const KEY_STATE = 'veille:etat';
const KEY_SOURCES = 'veille:sources';
const KEY_STATS = 'veille:stats';
const KEY_CODES = 'FGC_pending_codes';
/* Arret d'urgence. Espace FGC_* parce que le MOTEUR doit le lire de facon
   synchrone avant chaque clic, et il ne connait que cet espace. */
const KEY_STOP = 'FGC_kill_switch';

/* Enumerated, not storage.local.get(null): the latter would also drag in the
   whole offer catalogue and the hourly histograms just to draw three toggles. */
const KEYS_READ = [
  KEY_CODES,
  'FGC_epic_auto_mode',
  'FGC_luna_auto_mode',
  'FGC_luna_claim_dlc',
  'FGC_auto_state',
  ...Object.values(HISTORY_KEYS),
  KEY_STATE, KEY_SOURCES, KEY_SETTINGS, KEY_CATALOG, KEY_FILTERS, KEY_STATS, KEY_UI, KEY_STOP, KEY_LIBRARY,
  KEY_RATES,
  KEY_CANARY,
  KEY_COUNTRY, KEY_LANG,
  KEY_SESSIONS,
  KEY_INCIDENTS,
  KEY_WISHLIST,
];

const readAll = () => api.storage.local.get(KEYS_READ);

const get = (all, key, fallback) => {
  const raw = all[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
};

const setValue = (key, value) => api.storage.local.set({ [key]: value });

/** Presentation preferences. Never read by the service worker. */
const DEFAULT_UI = {
  theme: 'system',
  density: 'cosy',
  language: 'auto',
  sort: 'ending',
  hideOwned: false,
  pinned: [],
  dismissed: [],
  onboarded: false,
  syncSettings: false,
  showAllLog: false,
};

/* Behaviour the service worker reads too. Imported, never re-declared: a
   default that exists in two places drifts, and then the interface shows one
   thing while the worker applies another. */
const DEFAULT_BEHAVIOUR = DEFAULT_SETTINGS;

let ui = { ...DEFAULT_UI };

/* ------------------------------------------------------------- it's working */

/* Deferred reveal: a 50 ms read does not deserve a flicker, a ten-second check
   deserves to be announced. A counter, because two jobs can overlap and the
   first to finish must not switch off the second one's indicator. */
let workCount = 0;
let workTimer = null;

function showWorking(immediate) {
  workCount++;
  if (workCount > 1) return;
  const reveal = () => { document.getElementById('working').hidden = false; };
  if (immediate) reveal();
  else workTimer = setTimeout(reveal, 180);
}

function hideWorking() {
  workCount = Math.max(0, workCount - 1);
  if (workCount > 0) return;
  clearTimeout(workTimer);
  workTimer = null;
  document.getElementById('working').hidden = true;
}

async function withWorking(job, { immediate = false } = {}) {
  showWorking(immediate);
  try { return await job(); } finally { hideWorking(); }
}

/* ------------------------------------------------------------------ formats */

const DAY_MS = 86400000;

/* "12 min", "3 h 20", "2 j 4 h" -- never seconds: nobody reopens a popup for
   them. The units go through the tables like every other piece of text: the
   day used to be a hardcoded "d", so a French reader was told "2 d 4 h" in an
   interface that was French everywhere else. */
function readableDelay(ms) {
  const abs = Math.max(0, ms);
  const d = Math.floor(abs / DAY_MS);
  const h = Math.floor((abs % DAY_MS) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (d) return t('durationDaysHours', String(d), String(h));
  if (h) return t('durationHoursMinutes', String(h), String(m).padStart(2, '0'));
  return t('durationMinutes', String(m));
}

function since(instant, now = Date.now()) {
  if (typeof instant !== 'number') return null;
  const d = now - instant;
  return d >= 0 ? t('ago', readableDelay(d)) : t('inFuture', readableDelay(-d));
}

function shortDateTime(ms) {
  const d = new Date(ms);
  const loc = intlLocale();
  return `${d.toLocaleDateString(loc, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}

function openTab(url) {
  api.tabs.create({ url, active: true });
  window.close();
}

/** "together-after-dark" -> "Together After Dark" */
function prettySlug(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
}

/* Deadline text on a pending code. The engine stores it as the store printed
   it, in words, so it is parsed rather than assumed to be a timestamp. */
const MONTHS = {
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
};

function daysUntil(deadline) {
  if (!deadline) return null;
  const m = String(deadline).match(/(\d{1,2})(?:er|st|nd|rd|th)?\s+([a-zÀ-ſ.]+)\s+(\d{4})/i);
  if (!m) return null;
  const stem = m[2].toLowerCase().replace('.', '').normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3);
  let month = -1;
  for (const names of Object.values(MONTHS)) {
    const hit = names.findIndex((n) => n.startsWith(stem));
    if (hit >= 0) { month = hit; break; }
  }
  if (month < 0) return null;
  return Math.ceil((new Date(Number(m[3]), month, Number(m[1])) - Date.now()) / DAY_MS);
}

/* --------------------------------------------------------------- the ring */

/**
 * How much of the offer's window is left, as a percentage.
 *
 * The first attempt measured runway against a fixed two-week horizon, on the
 * argument that it needed no second rule. Rendered, it was useless: a 39-minute
 * offer and a nine-hour offer both landed on the 3% floor, so the ring said the
 * same thing about the two cards that differed most. One rule that says nothing
 * is worse than two rules that say something.
 *
 * Share of the window uses the whole range and empties towards the deadline
 * whatever the window was. Urgency is carried by the chip's colour and digits;
 * the ring carries how far through the window we are.
 */
const NOMINAL_WINDOW_MS = 7 * DAY_MS;

function ringShare(offer, now) {
  const total = typeof offer.start === 'number' && offer.end > offer.start
    ? offer.end - offer.start
    // No start: the aggregator often omits it. A week is what a store promotion
    // usually runs for, so the ring still degrades sensibly.
    : NOMINAL_WINDOW_MS;
  // Never quite zero: an empty ring is indistinguishable from a missing one.
  return Math.max(3, Math.min(100, ((offer.end - now) / total) * 100));
}

/** calm / warm / hot: the colour IS the message. */
function tier(remaining) {
  if (remaining < 3600000) return 'hot final';
  if (remaining < DAY_MS) return 'hot';
  if (remaining < 3 * DAY_MS) return 'warm';
  return 'calm';
}

/* ---------------------------------------------------------------- elements */

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------- plis */

/* Un pli ferme ne doit rien avaler d'important.
 *
 * Replier Magasins et Veille a un cout precis : ce sont les deux seuls
 * endroits ou l'extension crie -- le canari qui signale un selecteur mort,
 * la source mise en repli, la session perdue. Un chevron par-dessus, et
 * l'alerte n'existe plus.
 *
 * D'ou deux regles, et la seconde compte autant que la premiere.
 *
 *   `foldSay`  garde la ligne de verdict VISIBLE sur le pli ferme. On lit
 *              « 4 suivis » ou « autonome » sans rien ouvrir.
 *   `foldOpen` ouvre le pli quand il a une alerte a montrer -- UNE FOIS par
 *              ouverture du popup. `render()` retourne apres chaque clic ;
 *              sans ce souvenir, un pli que l'utilisateur vient de refermer
 *              se rouvrirait sous ses doigts, et l'interface discuterait avec
 *              lui. Il a ferme, c'est une reponse. */
const PLIS_OUVERTS = new Set();

function foldSay(id, texte) {
  const n = document.getElementById(`${id}-say`);
  if (n) n.textContent = texte || '';
}

function foldOpen(id, alerte) {
  if (!alerte || PLIS_OUVERTS.has(id)) return;
  const pli = document.getElementById(id);
  if (!pli) return;
  PLIS_OUVERTS.add(id);
  pli.open = true;
}

function storeTag(store) {
  const n = el('span', `store-tag ${store}`, TAGS[store] || (STORE_LABELS[store] || store).toUpperCase());
  n.title = STORE_LABELS[store] || store;
  return n;
}

/* Thumbnails come from the stores' CDNs: no referrer, and a letter tile if the
   request fails. A broken image icon in a list of games reads as a bug. */
function artwork(offer) {
  const box = el('div', 'art');
  if (offer.image) {
    const img = el('img');
    img.src = offer.image;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(letterTile(offer)));
    box.append(img);
  } else {
    box.append(letterTile(offer));
  }
  return box;
}

function letterTile(offer) {
  return el('div', 'letter', (offer.title || '?').trim().charAt(0).toUpperCase());
}

function thumb(src) {
  const img = el('img', 'mini');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove());
  return img;
}

/* -------------------------------------------------------------------- undo */

let undoAction = null;
let undoTimer = null;

/** A lost code is a lost game, so removing one is undoable for twelve seconds. */
function offerUndo(message, action) {
  undoAction = action;
  document.getElementById('undo-text').textContent = message;
  document.getElementById('undo').hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(dismissUndo, 12000);
}

function dismissUndo() {
  undoAction = null;
  clearTimeout(undoTimer);
  document.getElementById('undo').hidden = true;
}

/* ------------------------------------------------------------------- games */

let searchQuery = '';

function openOffers(catalog, behaviour, now) {
  const watched = behaviour.watchedStores || DEFAULT_WATCHED;
  return Object.entries(catalog)
    .filter(([, o]) => o && o.state !== 'expired' && o.state !== 'resolved')
    .filter(([, o]) => o.end === null || o.end === undefined || o.end > now)
    .filter(([, o]) => watched.includes(o.store))
    .filter(([key]) => !ui.dismissed.includes(key))
    .filter(([, o]) => !(ui.hideOwned && o.alreadyOwned === true))
    .map(([key, o]) => ({ key, offer: o }));
}

function matchesQuery(offer) {
  if (!searchQuery) return true;
  const hay = `${offer.title || ''} ${STORE_LABELS[offer.store] || ''} ${TAGS[offer.store] || ''}`.toLowerCase();
  return hay.includes(searchQuery);
}

function sortOffers(rows, now) {
  /* readWorth rather than a local parse: stripping everything but digits and
     dots turns "23,99 EUR" into 2399, so the cheapest French offer sorted
     above the most expensive one. The watch module already knows both decimal
     separators, and the filters compare against the same reading. */
  const worthOf = (o) => {
    const n = readWorth(o.worth);
    return typeof n === 'number' ? n : -1;
  };
  const runway = (o) => (o.end == null ? -1 : o.end - now);

  /* La priorite se lit sur l'OFFRE depuis la 2.29.0, plus dans les preferences
     d'affichage. Elle y etait purement decorative : le service worker ne lit
     jamais `veille:ui`, donc l'etoile ordonnait la liste et ne changeait rien
     a ce qui etait reclame en premier. Le popup et le worker trient desormais
     sur le meme champ, ce qui est la seule facon qu'ils s'accordent. */
  const pinnedFirst = (a, b) => {
    const pa = a.offer.priority === true ? 0 : 1;
    const pb = b.offer.priority === true ? 0 : 1;
    return pa - pb;
  };

  const by = {
    // Unknown end first, then nearest deadline: the order the scheduler would
    // work them in. A date we do not know is not a distant one.
    ending: (a, b) => runway(a.offer) - runway(b.offer),
    added: (a, b) => (b.offer.updatedAt || 0) - (a.offer.updatedAt || 0),
    worth: (a, b) => worthOf(b.offer) - worthOf(a.offer),
    store: (a, b) => String(a.offer.store).localeCompare(String(b.offer.store)) || runway(a.offer) - runway(b.offer),
  }[ui.sort] || ((a, b) => runway(a.offer) - runway(b.offer));

  return rows.slice().sort((a, b) => pinnedFirst(a, b) || by(a, b));
}

/** Titles free on more than one store at once, so the card can say so. */
function crossStore(rows) {
  const byTitle = new Map();
  for (const { offer } of rows) {
    const k = offer.normalisedTitle || String(offer.title || '').toLowerCase();
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, new Set());
    byTitle.get(k).add(offer.store);
  }
  return byTitle;
}

/* ------------------------------------------------------------- horizons */

/**
 * Where an offer sits on the calendar.
 *
 * The thresholds are the ones `tier()` already uses for the ring and the chip:
 * the list gets the structure the cards were carrying one by one.
 *
 * "No end date" is deliberately FIRST, not last. Eight of twenty aggregator
 * offers have no announced end, and the scheduler puts them at the front of the
 * queue on purpose -- a date we do not know is not a distant one. A section
 * relegated to the bottom would contradict the order the watcher actually works
 * in.
 */
const HORIZONS = [
  { key: 'unknown', label: 'horizonUnknown', holds: (r) => r === null },
  { key: 'today', label: 'horizonToday', holds: (r) => r < DAY_MS },
  { key: 'week', label: 'horizonWeek', holds: (r) => r < 7 * DAY_MS },
  { key: 'later', label: 'horizonLater', holds: () => true },
];

function horizonOf(offer, now) {
  const remaining = offer.end == null ? null : offer.end - now;
  return HORIZONS.find((h) => h.holds(remaining)) || HORIZONS[HORIZONS.length - 1];
}

/* ------------------------------------------------------- what needs you */

/** Verdicts that stopped on something only a person can resolve. */
const NEEDS_YOU = new Set(['needs_login', 'needs_link', 'challenge', 'quota', 'failed']);

/**
 * Offers whose last autonomous attempt stopped on a human.
 *
 * Without this lane they were indistinguishable from offers nobody had touched
 * yet: the extension knew it was blocked and had no way to say so.
 */
function waitingOnYou(rows) {
  return rows.filter(({ offer }) => (
    offer.verdict && NEEDS_YOU.has(offer.verdict) && (offer.attempts || 0) > 0
  ));
}

/* ---------------------------------------------------------- what changed */

/* Frozen ONCE per popup opening, not per render.
 *
 * Opening the Games tab sends 'fgc-mark-seen', which flips every offer to seen
 * at the very moment the news becomes visible. Taking the snapshot per render
 * would erase the mark on the first tab switch -- and taking it later is not an
 * option, because openTab() closes the popup and a message from a closing popup
 * is not guaranteed to arrive. */
let freshSnapshot = null;

function markFresh(rows) {
  if (freshSnapshot === null) {
    freshSnapshot = new Set(rows.filter(({ offer }) => offer.seen !== true).map(({ key }) => key));
  }
  return freshSnapshot;
}

/* ------------------------------------------------------------------ cards */

function gameCard({ key, offer }, ctx) {
  const { now, alsoOn, owned, fresh, filters, behaviour } = ctx;
  const link = offer.url || offer.resolveUrl;

  const card = el(link ? 'button' : 'div', 'game');
  if (fresh.has(key)) card.classList.add('fresh');
  if (link) {
    card.title = t('openOfferTitle');
    card.addEventListener('click', (e) => {
      if (e.target.closest('.pin')) return;
      openTab(link);
    });
  }

  const art = artwork(offer);
  const ring = el('span', 'ring');
  if (offer.end == null) {
    ring.classList.add('unknown');
  } else {
    ring.classList.add(tier(offer.end - now).split(' ')[0]);
    ring.style.setProperty('--p', ringShare(offer, now).toFixed(1));
  }
  art.append(ring);

  const body = el('div', 'game-body');
  body.append(el('span', 'game-title', offer.title));

  const meta = el('span', 'game-meta');
  meta.append(storeTag(offer.store));

  /* One aside, in order of what a person most needs to know: already yours,
     free elsewhere too, or what it is worth. Three lines would not fit at
     328 px, and stacking them would push the countdown off the row. */
  const twins = alsoOn.get(offer.normalisedTitle || String(offer.title || '').toLowerCase());
  const mine = owned.get(offer.normalisedTitle || String(offer.title || '').toLowerCase());

  if (mine) {
    /* Le registre le sait, donc on le dit -- meme magasin ou non. La question
       que se pose un joueur avec trois cents jeux est « est-ce que je l'ai
       deja », pas « est-ce que je l'ai deja ailleurs ». */
    const quand = new Date(mine.ts).toLocaleDateString(intlLocale(), { month: 'short', year: 'numeric' });
    meta.append(el('span', 'worth own', t('alreadyYours', STORE_LABELS[mine.store] || mine.store, quand)));
  } else if (offer.alreadyOwned === true) {
    meta.append(el('span', 'worth own', t('alreadyOwned')));
  } else if (twins && twins.size > 1) {
    const others = [...twins].filter((s) => s !== offer.store).map((s) => TAGS[s] || s);
    meta.append(el('span', 'worth', t('alsoFreeOn', others.join(', '))));
  } else if (offer.worth) {
    const shown = worthLabel(offer.worth, now);
    const tag = el('span', shown.approx ? 'worth approx' : 'worth', shown.text);
    if (shown.title) tag.title = shown.title;
    meta.append(tag);
  }

  const left = el('span', 'left');
  if (offer.end == null) {
    left.classList.add('unknown');
    left.textContent = t('noEndDate');
  } else {
    for (const c of tier(offer.end - now).split(' ')) left.classList.add(c);
    left.textContent = readableDelay(offer.end - now);
  }
  meta.append(left);

  /* Mise de cote, avec son echeance. Une pause se voit, sinon elle ressemble a
     une offre qu'on a oubliee. */
  if (typeof offer.snoozedUntil === 'number' && offer.snoozedUntil > now) {
    meta.append(el('span', 'aside', t('snoozedFor', readableDelay(offer.snoozedUntil - now))));
  }

  /* Les actions ont leur propre rangee depuis la 2.35.0.
   *
   * Elles vivaient dans la ligne d'information, a cote du magasin, de la
   * valeur et du compte a rebours. Deux suffisaient a l'etroit ; cinq -- le
   * souhait, la priorite, la reclamation, le report, le refus -- ne laissaient
   * plus rien se lire a 328 px de large.
   *
   * Separer les deux rangees separe aussi deux natures : ce que l'offre EST,
   * et ce qu'on peut en FAIRE. */
  const actions = el('span', 'game-actions');

  /* L'etoile ecrit sur le CATALOGUE, via le worker qui en est seul ecrivain.
     Elle vivait dans `veille:ui`, que le worker ne lit jamais : elle ordonnait
     la liste et ne changeait rien a ce qui etait reclame en premier. */
  /* Le souhait porte sur le TITRE, pas sur cette offre : c'est ce qui lui
     permet de reconnaitre le meme jeu quand il repassera sur un autre magasin,
     dans six mois. Un coeur accroche a l'offre disparaitrait avec elle. */
  const wished = isWished(ctx.wishlist, offer, normaliseTitle);
  const heart = el('button', `pin${wished ? ' on' : ''}`, wished ? '♥' : '♡');
  heart.title = t(wished ? 'unwishTitle' : 'wishTitle');
  heart.addEventListener('click', async (e) => {
    e.stopPropagation();
    await tell('fgc-wish', { title: offer.title, on: !wished });
    await load();
  });
  actions.append(heart);

  const pinned = offer.priority === true;
  const pin = el('button', `pin${pinned ? ' on' : ''}`, pinned ? '★' : '☆');
  pin.title = t(pinned ? 'unpinTitle' : 'pinTitle');
  pin.addEventListener('click', async (e) => {
    e.stopPropagation();
    await tell('fgc-prioritise', { catalogKey: key, on: !pinned });
    await load();
  });
  actions.append(pin);

  /* « Celle-ci, maintenant. »
   *
   * Le bouton passe par le meme chemin que « Tout recuperer » : memes filtres,
   * meme canari, meme registre, meme plafond horaire. Il n'apparait donc que
   * si l'offre est reellement reclamable -- un bouton qui ne ferait rien
   * apprendrait a s'en mefier. */
  const claimable = judge(offer, filters, {
    supportedStores: claimableStoresFor(behaviour),
  }).claimable;

  if (claimable) {
    const takeIt = el('button', 'pin go', '▸');
    takeIt.title = t('claimThisTitle');
    takeIt.addEventListener('click', async (e) => {
      e.stopPropagation();
      takeIt.disabled = true;
      await withWorking(() => tell('fgc-claim-one', { catalogKey: key }), { immediate: true });
      await load();
    });
    actions.append(takeIt);

    /* « Plus tard », qui n'est pas « jamais ». La croix exclut le TITRE pour
       toujours ; ceci pose une echeance qui se perime toute seule. Les deux
       gestes voisinent parce qu'on les confond, et la difference tient dans
       leur libelle. */
    if (!(typeof offer.snoozedUntil === 'number' && offer.snoozedUntil > now)) {
      const later = el('button', 'pin', '⏾');
      later.title = t('snoozeTitle');
      later.addEventListener('click', async (e) => {
        e.stopPropagation();
        await tell('fgc-snooze', { catalogKey: key });
        await load();
      });
      actions.append(later);
    }
  }

  /* Un seul geste pour « je n'en veux pas ».
   *
   * Masquer l'offre et exclure son titre sont la MEME intention exprimee a deux
   * echelles : l'une vaut pour cette offre, l'autre pour la fois ou le meme jeu
   * repassera sur un autre magasin. Les separer en deux boutons obligerait a
   * comprendre la difference avant de pouvoir agir ; les fusionner et rendre le
   * geste annulable donne le meme pouvoir sans la lecon.
   *
   * `dismissed` et `excludedTitles` existaient dans le modele depuis le debut,
   * et rien ne savait les ecrire. */
  const drop = el('button', 'pin drop', '✕');
  drop.title = t('neverThis');
  drop.addEventListener('click', async (e) => {
    e.stopPropagation();
    const filters = ctx.filters;
    const titre = offer.title;

    const avantUi = { dismissed: [...ui.dismissed] };
    const avantFiltres = [...(filters.excludedTitles || [])];

    await writeFilters({ excludedTitles: [...avantFiltres, titre] });
    await writeUi({ dismissed: [...ui.dismissed, key] });

    offerUndo(t('undoNever', titre), async () => {
      await writeFilters({ excludedTitles: avantFiltres });
      await writeUi(avantUi);
    });
  });
  actions.append(drop);

  body.append(meta);
  body.append(actions);

  /* Why this one will not be taken for you.
   *
   * The chip comes from judge(), the same function the watcher uses, so it can
   * never say something the engine would contradict. Without it a filtered
   * offer sat in the list looking exactly like one that was about to be
   * claimed, and the only way to find out was to wait and see nothing happen. */
  if (behaviour.autonomousClaim !== false) {
    const verdict = judge(offer, filters, { supportedStores: claimableStoresFor(behaviour) });
    if (!verdict.claimable) {
      const cle = DROP_KEYS[verdict.reason];
      if (cle) body.append(el('span', 'why', t(cle)));
    }
  }

  card.append(art, body);
  return card;
}

/* ------------------------------------------------------------------ liste */

function renderGames(all, behaviour) {
  const catalog = get(all, KEY_CATALOG, {});
  const library = get(all, KEY_LIBRARY, {});
  const filters = get(all, KEY_FILTERS, {});
  const now = Date.now();

  const rows = openOffers(catalog, behaviour, now);
  const visible = sortOffers(rows.filter(({ offer }) => matchesQuery(offer)), now);

  const ctx = {
    now,
    filters,
    behaviour,
    alsoOn: crossStore(rows),
    owned: ownedTitles(library, normaliseTitle),
    fresh: markFresh(rows),
    wishlist: get(all, KEY_WISHLIST, []),
  };

  document.getElementById('n-games').textContent = rows.length || '';

  const claimableStores = claimableStoresFor(behaviour);
  const claimable = rows.filter(({ offer }) => claimableStores.includes(offer.store)).length;
  document.getElementById('claim-all-row').hidden = claimable < 2 || behaviour.autonomousClaim === false;

  /* --- ce qui vous attend --- */

  const bloques = waitingOnYou(rows);
  const laneSection = document.getElementById('waiting-section');
  const lane = document.getElementById('waiting');
  lane.textContent = '';
  laneSection.hidden = bloques.length === 0;
  document.getElementById('waiting-count').textContent = bloques.length || '';

  for (const { key, offer } of bloques) {
    const link = offer.url || offer.resolveUrl;
    const row = el(link ? 'button' : 'div', 'row');
    if (link) row.addEventListener('click', () => openTab(link));
    row.append(el('span', 'label', offer.title));

    const [cle] = VERDICT_KEYS[offer.verdict] || [];
    const aside = el('span', 'aside hi', cle ? t(cle) : offer.verdict);
    aside.title = offer.details || '';
    row.append(aside);

    /* Reessayer maintenant : efface le recul, sans toucher au compteur
       d'essais. Se reconnecter est exactement le genre de chose qu'on vient de
       faire avant d'appuyer ici, et attendre douze heures pour le verifier
       n'aurait aucun sens. */
    const retry = el('button', 'link', t('retryNow'));
    retry.addEventListener('click', async (e) => {
      e.stopPropagation();
      retry.disabled = true;
      await tell('fgc-retry', { catalogKey: key });
      await withWorking(requestCycle, { immediate: true });
      await load();
    });
    row.append(retry);
    lane.append(row);
  }

  /* --- ce qui a change --- */

  const nouvelles = visible.filter(({ key }) => ctx.fresh.has(key)).length;
  const state = get(all, KEY_STATE, {});
  const change = document.getElementById('changed');
  change.textContent = nouvelles
    ? t('changedSome', String(nouvelles))
    : (state.lastCycle ? t('changedNone', since(state.lastCycle)) : '');
  change.hidden = !change.textContent;

  /* --- la liste --- */

  const host = document.getElementById('games');
  host.textContent = '';

  if (!visible.length) {
    host.append(el('p', 'empty', t(rows.length ? 'emptyGamesFiltered' : 'emptyGames')));
    return;
  }

  /* Les separateurs d'echeance n'ont de sens QUE sous le tri par echeance :
     sous « par magasin » ou « valeur », ils decriraient un ordre que la liste
     ne suit pas. Les epinglees restent au-dessus du premier separateur, sinon
     l'epinglage cesse de vouloir dire quelque chose. */
  const grouper = ui.sort === 'ending';
  let horizonCourant = null;

  for (const ligne of visible) {
    if (grouper && !ui.pinned.includes(ligne.key)) {
      const h = horizonOf(ligne.offer, now);
      if (h.key !== horizonCourant) {
        horizonCourant = h.key;
        const compte = visible.filter(
          (r) => !ui.pinned.includes(r.key) && horizonOf(r.offer, now).key === h.key,
        ).length;
        const sep = el('div', 'horizon');
        sep.append(el('span', null, t(h.label)), el('span', 'n', String(compte)));
        host.append(sep);
      }
    }
    host.append(gameCard(ligne, ctx));
  }
}

/* ---------------------------------------------------------------- upcoming */

function renderUpcoming(all) {
  const sources = get(all, KEY_SOURCES, {});
  const now = Date.now();

  const windows = [];
  for (const s of Object.values(sources)) {
    for (const w of s.announcedWindows || []) {
      // Earlier versions stored only the instant.
      if (typeof w === 'number') { if (w > now) windows.push({ start: w, title: null }); }
      else if (w && (w.start ?? w.debut) > now) windows.push({ ...w, start: w.start ?? w.debut });
    }
  }
  windows.sort((a, b) => a.start - b.start);

  // One game can have several announced windows; only the nearest matters.
  // Without this filter "Breathedge" showed up twice.
  const seen = new Set();
  const next = windows.filter((w) => {
    const k = (w.title || String(w.start)).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const section = document.getElementById('upcoming-section');
  const host = document.getElementById('upcoming');
  host.textContent = '';

  if (!next.length) { section.hidden = true; return; }
  section.hidden = false;

  for (const w of next.slice(0, 6)) {
    /* La ligne mene a la fiche quand l'adresse existe.
     *
     * C'est ce qu'on veut faire en lisant « Cardpocalypse, jeudi 17:00 » :
     * aller voir de quoi il s'agit. La section l'annoncait depuis des versions
     * sans jamais y mener, parce que la source ne gardait pas l'adresse -- ce
     * que la 2.35.0 corrige en amont.
     *
     * Sans adresse, la ligne reste un div : un bouton qui n'ouvre rien
     * apprendrait a se mefier de tous les autres. */
    const row = el(w.url ? 'button' : 'div', `row${w.url ? ' go' : ''}`);
    if (w.url) {
      row.title = t('upcomingOpen', w.title || '');
      row.addEventListener('click', () => openTab(w.url));
    }
    if (w.image) row.append(thumb(w.image));
    row.append(el('span', 'label', w.title || t('upcomingUnannounced')));
    row.append(el('span', 'aside hi', shortDateTime(w.start)));
    host.append(row);
  }
}

/* -------------------------------------------------------------------- log */

function renderLog(all) {
  const host = document.getElementById('log');
  host.textContent = '';
  const catalog = get(all, KEY_CATALOG, {});
  const library = get(all, KEY_LIBRARY, {});
  const rows = [];

  for (const [label, key] of Object.entries(HISTORY_KEYS)) {
    const history = get(all, key, {});
    for (const [entryKey, e] of Object.entries(history)) {
      if (!e || !e.ts) continue;

      // The game's title, in order: the one the watcher knows, then the slug
      // made readable. Never the `reason` field: it carries a technical motive,
      // not a name -- that is how "ALREADY_OWNED" ended up where a title goes.
      const bare = entryKey.replace(/^(slug|offer|code):/, '');

      /* Le catalogue d'abord, puis la BIBLIOTHEQUE.
       *
       * Le catalogue est purge a trente puis quatre-vingt-dix jours : passe ce
       * delai il ne sait plus rien, et la ligne retombait sur un slug embelli
       * -- ou sur « Amazon Luna » quand l'identifiant est opaque. La
       * bibliotheque, elle, a fige le titre a l'instant de la reclamation et ne
       * l'oublie jamais. C'est tout l'interet de l'avoir ecrite.  */
      const known = catalog[`epic:${bare}`] || catalog[`gog:${bare}`] || catalog[`amazon:${bare}`]
        || library[`epic:${bare}`] || library[`gog:${bare}`] || library[`amazon:${bare}`];

      // An opaque identifier does not get dressed up as a title: "Amzn1.pg.item.abc"
      // teaches nothing. Naming the store honestly is better.
      const opaque = /^amzn1\./i.test(bare) || /^[0-9a-f]{16,}$/i.test(bare);
      rows.push({
        ts: e.ts,
        status: e.status,
        reason: e.reason,
        label: (known && known.title) || (opaque ? label : prettySlug(bare)),
      });
    }
  }

  rows.sort((a, b) => b.ts - a.ts);

  const toggle = document.getElementById('show-all-log');
  toggle.hidden = rows.length <= 8;
  toggle.textContent = t(ui.showAllLog ? 'seeLess' : 'seeAll');

  if (!rows.length) {
    const empty = el('li', 'empty', t('emptyLog'));
    host.append(empty);
    return;
  }

  for (const row of ui.showAllLog ? rows.slice(0, 60) : rows.slice(0, 8)) {
    // A known technical reason describes the outcome better than the generic
    // status: "already owned" beats "claimed" when the game already was.
    const [key, css] = REASON_KEYS[row.reason] || VERDICT_KEYS[row.status] || [null, ''];
    const li = el('li');
    li.append(el('time', null, shortDateTime(row.ts)));
    li.append(el('span', 'what', row.label));
    li.append(el('span', `st ${css}`, key ? t(key) : String(row.status || '')));
    host.append(li);
  }
}

/* ------------------------------------------------------------------- codes */

/**
 * Ajoute a la main les cles recues ailleurs.
 *
 * Humble Choice, IndieGala, Fanatical : rien de tout cela ne passe par Luna, et
 * ces cles n'avaient donc aucun endroit ou entrer. Le champ accepte un COLLAGE
 * entier -- titres, puces, lignes vides -- parce qu'une expression reguliere
 * sait ignorer ce bruit, et que demander a l'utilisateur de nettoyer serait lui
 * faire faire le travail de la machine.
 */
async function addCodesByHand(texte, store) {
  const trouves = parseCodes(texte);
  if (!trouves.length) { flashCodes(t('codesNoneFound')); return; }

  const avant = get(await readAll(), KEY_CODES, []);
  const apres = addCodes(avant, trouves.map((code) => ({
    store,
    code,
    title: null,
    ts: Date.now(),
    attempts: 0,
    manual: true,
  })));

  const ajoutes = apres.length - avant.length;
  await setValue(KEY_CODES, JSON.stringify(apres));
  flashCodes(ajoutes ? t('codesAdded', String(ajoutes)) : t('codesAllKnown'));
  await load();
}

function flashCodes(message) {
  const zone = document.getElementById('codes-flash');
  if (!zone) return;
  zone.textContent = message;
  setTimeout(() => { zone.textContent = ''; }, 4000);
}

function renderCodes(codes) {
  const host = document.getElementById('codes');
  host.textContent = '';
  document.getElementById('codes-count').textContent = codes.length ? String(codes.length) : '';
  document.getElementById('n-codes').textContent = codes.length || '';

  if (!codes.length) {
    host.append(el('p', 'empty', t('emptyCodes')));
    return;
  }

  codes.forEach((entry, i) => {
    const ticket = el('div', 'ticket');
    ticket.style.animationDelay = `${i * 45}ms`;

    const head = el('div', 'ticket-head');
    head.append(el('span', 'ticket-title', entry.title || t('untitledGame')));
    head.append(storeTag(entry.store));
    ticket.append(head);

    const row = el('div', 'code-row');
    row.append(el('code', 'code', entry.code));
    const copy = el('button', 'copy', t('copy'));
    copy.addEventListener('click', async () => {
      // Refusee si le popup n'a pas le focus : pas de « copie » affiche a tort.
      try { await navigator.clipboard.writeText(entry.code); } catch { return; }
      copy.textContent = t('copied');
      copy.classList.add('done');
      setTimeout(() => { copy.textContent = t('copy'); copy.classList.remove('done'); }, 1400);
    });
    row.append(copy);
    ticket.append(row);

    if (entry.deadline) {
      const left = daysUntil(entry.deadline);
      const line = el('div', `deadline${left !== null && left <= 7 ? ' urgent' : ''}`);
      line.textContent = left === null ? t('deadlineBefore', entry.deadline)
        : left < 0 ? t('deadlineExpired', entry.deadline)
        : left === 0 ? t('deadlineLastDay', entry.deadline)
        : t('deadlineDaysLeft', String(left), entry.deadline);
      ticket.append(line);
    }

    const actions = el('div', 'code-row');
    actions.style.marginTop = '8px';

    /* La destination vient de la TABLE, plus d'un ternaire binaire.
     *
     * Jusqu'a la 2.33.0, tout ce qui n'etait pas GOG ouvrait la page de
     * Microsoft : un code Ubisoft, EA ou Battle.net menait donc a un formulaire
     * qui le refuse. Un magasin dont l'adresse n'a pas ete mesuree n'a plus de
     * bouton du tout -- ne rien promettre vaut mieux que promettre a cote. */
    const cible = redeemUrlFor(entry.store);
    const go = el('button', null, t(entry.store === 'gog' ? 'redeemOnGog' : 'openRedeemPage'));
    go.style.flex = '1';
    go.disabled = !cible;
    if (!cible) go.title = t('redeemUnknownHint');
    go.addEventListener('click', () => { if (cible) openTab(cible); });

    const drop = el('button', 'link', t('remove'));
    drop.addEventListener('click', async () => {
      const before = get(await readAll(), KEY_CODES, []);
      await setValue(KEY_CODES, JSON.stringify(before.filter((c) => c.code !== entry.code)));
      offerUndo(t('undoRemovedCode', entry.title || entry.code), () => setValue(KEY_CODES, JSON.stringify(before)));
      await load();
    });

    actions.append(go, drop);
    ticket.append(actions);
    host.append(ticket);
  });
}

/* ------------------------------------------------------------------ status */

function renderStatus(all) {
  const state = get(all, KEY_STATE, {});
  const zone = document.getElementById('status');
  zone.textContent = '';

  // By nodes, never innerHTML: lastError can carry text from a third-party API.
  const strong = (text) => el('b', null, text);

  if (!state.lastCycle) {
    zone.append(t('statusNeverRan'));
  } else {
    zone.append(t('statusChecked', ''), strong(since(state.lastCycle)));
    if (state.nextCycle) zone.append(' · ', t('statusNext', ''), strong(since(state.nextCycle)));
  }
  if (state.lastError) {
    zone.append(el('span', 'ko', ` · ${state.lastError}`));
  }
}

/* ------------------------------------------------------------------ stores */

/* Le canari, en tete des magasins.
 *
 * Il n'apparait que lorsqu'il a quelque chose a dire : deux echecs de
 * selecteur d'affilee sur un magasin qui marchait. Le motif technique est
 * recopie tel quel -- c'est lui qui nomme le bouton manquant, et une capture
 * de cette ligne a suffi a corriger la 2.13.2. */
function renderCanary(all) {
  const host = document.getElementById('canary');
  host.textContent = '';

  const alertes = canaryAlerts(get(all, KEY_CANARY, {}));
  // Un canari sous un pli ferme ne sert a rien : le pli s'ouvre.
  foldOpen('fold-stores', alertes.length > 0);

  for (const a of alertes) {
    const bloc = el('div', 'canary');
    const titre = el('div', 'canary-head');
    titre.append(el('span', 'canary-store', STORE_LABELS[a.store] || a.store));
    titre.append(el('span', 'canary-count', t('canaryStreak', String(a.streak))));

    const seen = el('button', 'link', t('canaryAck'));
    seen.addEventListener('click', () => {
      // L'etat n'a qu'un ecrivain, le service worker. Le popup demande.
      api.runtime.sendMessage({ type: 'fgc-canary-ack', store: a.store }, () => {
        void api.runtime.lastError;
        load();
      });
    });
    titre.append(seen);
    bloc.append(titre);

    if (a.lastDetails) bloc.append(el('p', 'canary-why', a.lastDetails));
    bloc.append(el('p', 'hint', t('canaryHint')));
    host.append(bloc);
  }
}

/**
 * Une ligne d'etat de session.
 *
 * Trois etats, trois traitements, et la nuance compte :
 *   - connecte  : discret, avec la date de la mesure. Une mesure sans date ne
 *                 dit rien d'aujourd'hui, et le dire vaut mieux que se taire.
 *   - deconnecte: en rouge, avec un lien pour aller se reconnecter. C'est le
 *                 seul etat qui appelle un geste.
 *   - inconnu   : neutre. On n'envoie PAS se reconnecter quelqu'un qui l'est
 *                 peut-etre deja : c'est exactement l'erreur de la 2.22.2.
 */
function renderSessionsHead(sessions, watched) {
  const quand = document.getElementById('sessions-when');
  if (!quand) return;
  const bilan = summarise(sessions, { watchedStores: watched });
  const dates = bilan.rows.map((r) => r.at).filter((x) => typeof x === 'number');
  /* La plus ANCIENNE des mesures, pas la plus recente : c'est elle qui dit
     depuis quand le tableau peut mentir. */
  const plusAncienne = dates.length ? Math.min(...dates) : null;
  quand.textContent = plusAncienne
    ? t('sessionsChecked', since(plusAncienne) || '')
    : t('sessionsNever');
  /* Passe six heures, la mesure ne dit plus rien d'aujourd'hui. Le dire vaut
     mieux que laisser croire que le tableau est a jour. */
  quand.classList.toggle('hi', isStale({ at: plusAncienne }, Date.now()));
}

function sessionLine(entry, storeId) {
  const line = el('div', 'session');
  const etat = entry.status === SESSION.OK ? t('sessionIn')
    : entry.status === SESSION.OUT ? t('sessionOut')
    : t('sessionUnknown');
  const teinte = entry.status === SESSION.OK ? 'ok' : entry.status === SESSION.OUT ? 'out' : '';
  line.append(el('span', `who ${teinte}`.trim(), etat));

  if (entry.at) line.append(el('span', null, since(entry.at)));
  else line.append(el('span', null, t('sessionNever')));

  if (entry.status === SESSION.OUT && LOGIN_URLS[storeId]) {
    const lien = el('button', 'link', t('sessionSignIn'));
    lien.addEventListener('click', () => openTab(LOGIN_URLS[storeId]));
    line.append(lien);
  }
  return line;
}

function renderStores(all, behaviour) {
  const host = document.getElementById('stores');
  host.textContent = '';
  const cooldowns = get(all, 'FGC_auto_state', {});
  const watched = behaviour.watchedStores || DEFAULT_WATCHED;
  const sessions = get(all, KEY_SESSIONS, {});
  renderSessionsHead(sessions, watched);

  foldSay('fold-stores', t('foldStoresCount', String(watched.length)));
  /* Une session perdue ouvre le pli -- et SEULEMENT elle. `actionable` ne
     compte que les `logged_out` : un `inconnu` n'appelle aucun geste, et
     ouvrir le pli pour lui ferait passer une ignorance pour une alerte. */
  foldOpen('fold-stores', summarise(sessions, { watchedStores: watched }).actionable.length > 0);

  for (const store of PRIMARY) {
    const row = el('div', 'row');

    const on = watched.includes(store.id);
    const autoOff = store.mode ? all[store.mode] === false : false;
    const remaining = Math.max(0, (cooldowns[store.id] || 0) - Date.now());

    row.append(el('span', `dot ${!on ? 'off' : autoOff || remaining ? 'paused' : 'ready'}`));

    const name = el('button', 'label', STORE_LABELS[store.id] || store.id);
    name.style.cssText = 'background:none;border:0;padding:0;text-align:left;cursor:pointer;color:inherit;font:inherit;';
    name.addEventListener('click', () => openTab(store.url));
    row.append(name);

    const claimed = store.history
      ? Object.values(get(all, store.history, {})).filter((e) => e && (e.status === 'claimed' || e.status === 'redeemed')).length
      : 0;

    // The risky opt-in shows on the row itself: nobody should have to open
    // the settings to learn that Steam is being clicked.
    const steamAuto = store.id === STORES.STEAM && behaviour.steamAutoClaim === true;
    const state = !on ? t('storeOff')
      : steamAuto ? t('storeSteamAuto')
      : !store.claim ? t('storeDetectOnly')
      : autoOff ? t('storeAutoOff')
      : remaining ? t('storePaused', readableDelay(remaining))
      : claimed ? t('storeReadyCount', String(claimed))
      : t('storeReady');

    row.append(el('span', 'aside', state));
    host.append(row);

    /* L'etat de session, sous la ligne du magasin.
     *
     * C'est la reponse a la question que l'extension ne savait pas poser, et
     * qui a coute trois versions en septembre : « suis-je connecte ? ». Elle
     * ne s'affiche que pour les magasins qu'on sait sonder, et seulement s'ils
     * sont suivis -- afficher l'etat d'un magasin decoche reviendrait a avoir
     * lu un compte que personne n'a demande. */
    if (on && PROBED_STORES.includes(store.id)) {
      host.append(sessionLine(readSession(sessions, store.id), store.id));
    }
  }

  /* Secondary stores. The label says "watched and notified, never claimed",
     because none of them has a claim module -- promising more would be a lie
     the first autonomous night would expose. */
  const grid = document.getElementById('extra-stores');
  grid.textContent = '';
  let count = 0;

  for (const store of SECONDARY) {
    const on = watched.includes(store.id);
    if (on) count++;

    const label = el('label', 'check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = on;
    box.addEventListener('change', async () => {
      const next = box.checked
        ? [...new Set([...watched, store.id])]
        : watched.filter((s) => s !== store.id);
      await writeBehaviour({ watchedStores: next });
    });
    label.append(box, el('span', 'box'), el('span', null, STORE_LABELS[store.id] || store.id));
    grid.append(label);
  }

  document.getElementById('more-stores-count').textContent = count ? t('moreStoresCount', String(count)) : '';
}

/* ----------------------------------------------------------------- sources */

/**
 * Les deux incidents que rien d'autre ne sait dire.
 *
 * Trois des cinq genres ont deja leur bandeau, avec leur geste propre : le
 * selecteur mort s'acquitte, la source en repli ouvre la sentinelle, la
 * session perdue mene a la page de connexion. Les repeter ici ferait deux
 * alertes pour une panne, et la seconde userait la premiere.
 *
 * Restent les deux qui parlent de l'extension ELLE-MEME, et qui n'avaient
 * aucune voix : la veille arretee, et le systeme qui bloque nos
 * notifications. Le second est le seul cas ou ce bandeau est la DERNIERE
 * chose capable d'expliquer le silence.
 */
/**
 * La veille survit-elle a la fermeture de la derniere fenetre ?
 *
 * Trois etats, et le troisieme est celui qu'on refuse de maquiller : une
 * plateforme qui ignore la permission n'obtient AUCUNE case. Cocher sans effet
 * ferait croire que la veille tourne pendant que le navigateur est ferme, ce
 * qui est pire que de ne rien proposer.
 *
 * La demande elle-meme exige un geste utilisateur : elle vit dans l'ecouteur
 * du bas, jamais dans un rendu.
 */
async function renderBackground() {
  const supported = Boolean(api.permissions)
    && declaresOptional(api.runtime.getManifest(), OPTIONAL.BACKGROUND);

  let granted = false;
  if (supported) {
    try {
      granted = await api.permissions.contains({ permissions: [OPTIONAL.BACKGROUND] });
    } catch { granted = false; }
  }

  const vue = describeBackground({ granted, supported });
  document.getElementById('background-row').hidden = !vue.toggle;
  document.getElementById('background-permission').checked = granted;
  document.getElementById('watch-note').textContent = t(vue.note);
}

function renderHealth(all) {
  const host = document.getElementById('health-banner');
  host.textContent = '';

  const propres = new Set([INCIDENT_KINDS.STALLED, INCIDENT_KINDS.MUTED]);
  const ouverts = openIncidents(get(all, KEY_INCIDENTS, {})).filter((i) => propres.has(i.kind));

  host.hidden = ouverts.length === 0;
  if (!ouverts.length) return;

  for (const i of ouverts) {
    if (i.kind === INCIDENT_KINDS.MUTED) {
      host.append(el('span', null, t('healthMuted')));
      continue;
    }
    host.append(el('span', null, t('healthStalled', since(i.openedAt) || '')));
  }

  /* Le journal plutot qu'un bouton de reparation : le chien de garde aboie, il
     ne repare pas. Ce qui s'est passe avant l'arret y est ecrit, et c'est cela
     qu'il faut lire. */
  const voir = el('button', null, t('openJournal'));
  voir.addEventListener('click', () => openTab(api.runtime.getURL('journal.html')));
  host.append(voir);
}

/* Le repli, propose et jamais impose.
 *
 * Trois echecs consecutifs endorment une source pendant des heures : c'est le
 * bon comportement quand personne ne regarde, et le mauvais quand quelqu'un
 * vient justement de l'ouvrir. Le bouton mene a l'onglet qui reessaie sous
 * surveillance -- il ne lance rien d'ici. */
function renderFallback(all) {
  const host = document.getElementById('fallback');
  host.textContent = '';

  const casse = failingSources(get(all, KEY_SOURCES, {}));
  foldOpen('fold-watch', casse.length > 0);
  if (!casse.length) return;

  const bloc = el('div', 'canary');
  const tete = el('div', 'canary-head');
  tete.append(el('span', 'canary-store', t('sentinelBanner', casse.map((s) => s.name).join(', '))));

  const ouvrir = el('button', 'link', t('openSentinel'));
  ouvrir.addEventListener('click', () => openTab(api.runtime.getURL('sentinel.html')));
  tete.append(ouvrir);
  bloc.append(tete);

  const pourquoi = reasonText(casse);
  if (pourquoi) bloc.append(el('p', 'canary-why', pourquoi));
  bloc.append(el('p', 'hint', t('sentinelBannerHint')));
  host.append(bloc);
}

function renderSources(all, behaviour) {
  const sources = get(all, KEY_SOURCES, {});
  const host = document.getElementById('sources');
  host.textContent = '';

  const names = Object.keys(sources);
  foldSay('fold-watch', names.length ? t('foldSourcesCount', String(names.length)) : '');
  if (!names.length) host.append(el('p', 'empty', t('emptySources')));

  for (const name of names) {
    const s = sources[name];
    const row = el('div', 'row');
    row.append(el('span', 'label', SOURCE_LABELS[name] || name));
    const aside = el('span', `aside${s.lastError ? ' ko' : ''}`);
    aside.textContent = s.lastError ? String(s.lastError).slice(0, 36) : (since(s.lastSuccess) || t('never'));
    row.append(aside);
    host.append(row);
  }

  const floor = Number.isFinite(behaviour.floorPerDay) ? behaviour.floorPerDay : 3;
  document.getElementById('floor').value = String(floor);
  document.getElementById('floor-value').textContent = String(floor);
}

/* -------------------------------------------------------------- prediction */

function renderPrediction(all) {
  const stats = get(all, KEY_STATS, {});
  const host = document.getElementById('prediction');
  host.textContent = '';

  const names = Object.keys(stats).filter((n) => isTrustworthy(stats[n]));
  if (!names.length) {
    host.append(el('p', 'hint', t('predictionLearning')));
    return;
  }

  const now = Date.now();
  for (const name of names) {
    const { bands } = band24h(stats[name], now);

    const block = el('div', 'pred');
    const head = el('div', 'pred-name', SOURCE_LABELS[name] || name);

    // A uniformly dull band is accurate -- nothing is expected before tomorrow
    // -- but it looks like a bug. So it says so.
    const peak = bands.reduce((a, b) => (b.intensity > a.intensity ? b : a), bands[0]);
    // Rounded to the hour: a cell is an hour wide, showing minutes would be
    // false precision ("peak around 17:53").
    const peakHour = new Date(Math.floor(peak.instant / 3600000) * 3600000);
    head.append(el('span', 'peak', peak.intensity > 0.35
      ? t('predictionPeak', peakHour.toLocaleTimeString(intlLocale(), { hour: '2-digit' }))
      : t('predictionNothing')));

    const band = el('div', 'pred-band');
    band.title = t('predictionBandTitle');
    for (const b of bands) {
      const bar = el('i');
      bar.style.opacity = String(0.1 + b.intensity * 0.9);
      // A marker every six hours: without it there is no telling which bar is when.
      if (b.hour % 6 === 0) bar.classList.add('mark');
      band.append(bar);
    }

    const axis = el('div', 'pred-axis');
    axis.append(el('span', null, t('now')), el('span', null, t('plus24h')));

    block.append(head, band, axis);
    host.append(block);
  }
}

/* ------------------------------------------------------------------- tally */

function renderTally(all) {
  const histories = Object.fromEntries(
    Object.entries(HISTORY_KEYS).map(([label, key]) => [label, get(all, key, {})]),
  );
  const b = tally(claimsMade(histories, get(all, KEY_CATALOG, {}), { library: get(all, KEY_LIBRARY, {}) }));
  const zone = document.getElementById('tally');
  zone.textContent = '';

  foldSay('fold-tally', b.count ? t('foldTallyCount', String(b.count)) : '');

  if (!b.count) {
    zone.className = 'empty';
    zone.textContent = t('tallyNone');
    document.getElementById('tally-stores').textContent = '';
    return;
  }
  zone.className = 'tally';
  zone.textContent = t(b.count > 1 ? 'tallyMany' : 'tallyOne', String(b.count));

  // Honest about what it ignores: many claims predate the watcher and never had
  // a known worth.
  if (b.priced) {
    zone.append(t('tallyValued', String(b.priced), moneyTotals(b.totals)));
  }

  /* Le mois le plus riche et le magasin dominant.
   *
   * `byMonth` et `mainStore()` etaient calcules depuis la V2 et n'ont jamais
   * ete affiches nulle part. C'est pourtant la seule forme sous laquelle des
   * annees d'accumulation deviennent visibles : « 8 jeux recuperes » ne dit
   * rien du rythme, « votre meilleur mois : mars 2026, 6 jeux » si. */
  const mois = Object.entries(b.byMonth || {}).sort((a, c) => c[1] - a[1])[0];
  const dominant = mainStore(b);
  const lignes = [];

  if (mois && mois[1] > 1) {
    const [aaaaMm, combien] = mois;
    const [an, m] = aaaaMm.split('-');
    const nom = new Date(Date.UTC(Number(an), Number(m) - 1, 1))
      .toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
    lignes.push(t('tallyBestMonth', nom, String(combien)));
  }
  if (dominant && Object.keys(b.byStore).length > 1) {
    lignes.push(t('tallyMainStore', STORE_LABELS[dominant] || dominant));
  }
  document.getElementById('tally-extra').textContent = lignes.join(' · ');

  const host = document.getElementById('tally-stores');
  host.textContent = '';
  for (const [store, stats] of Object.entries(b.byStore).sort((a, c) => c[1].count - a[1].count)) {
    const row = el('div', 'row');
    row.append(el('span', 'label', STORE_LABELS[store] || store));
    const somme = moneyTotals(stats.totals);
    row.append(el('span', 'aside', somme ? `${stats.count} · ${somme}` : String(stats.count)));
    host.append(row);
  }
}

/* Le symbole n'est jamais choisi par l'interface : il vient de la donnee.
   Cette fonction ne fait que la MISE EN FORME -- la conversion, elle, vit dans
   libelleValeur ci-dessous. */
function money(n, currency) {
  const loc = intlLocale();
  if (!currency || currency === UNKNOWN_CURRENCY) {
    return new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(n);
  } catch {
    // An ISO code Intl does not know still beats losing the amount.
    return `${new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;
  }
}

/* TOUT S'AFFICHE EN EUROS -- et ce qui est converti le dit.
 *
 * Epic publie le prix DU COMPTE, donc deja en euros ici. L'agregateur ne
 * connait que le dollar : vingt montants sur vingt dans la capture reelle, et
 * pas meme un code de devise dans sa structure. Les deux se retrouvaient cote
 * a cote dans la meme liste, « 23,99 € » au-dessus de « $14.99 ».
 *
 * Trois regles, dans cet ordre :
 *   - un montant deja en euros n'est jamais touche ;
 *   - un montant converti porte le signe « environ » et, en infobulle, son
 *     montant d'origine avec la date du taux ;
 *   - sans taux utilisable, le montant d'origine est rendu INTACT. Une
 *     approximation sans taux serait un chiffre invente.
 */
function worthLabel(raw, now) {
  const original = String(raw);
  const currency = readCurrency(raw);
  /* La devise VISEE est celle de la table de taux, pas celle du reglage : une
     table encore dans l'ancienne base ne sait pas convertir vers la nouvelle,
     et afficher une devise qu'on n'a pas su calculer serait un chiffre
     invente. Le cycle suivant rebase la table (`refreshRates`). */
  const target = baseOf(ratesCache);
  if (!currency || currency === target) return { text: original, approx: false, title: '' };

  const converted = toBase(readWorth(raw), currency, ratesCache, now);
  if (converted === null) return { text: original, approx: false, title: '' };

  return {
    text: `\u2248 ${money(converted, target)}`,
    approx: true,
    title: t('approxFrom', original, (ratesCache && ratesCache.date) || '?'),
  };
}

/**
 * Le bilan, en euros.
 *
 * Les totaux restent tenus PAR DEVISE en amont (watch/tally.js) : additionner
 * des devises produirait un nombre qui ne designe rien. C'est ici, et
 * seulement ici, qu'on les ramene a l'euro pour les montrer -- et ce qui n'a
 * pas pu etre converti garde sa devise, a cote, plutot que de disparaitre.
 */
function moneyTotals(totals = {}, now = Date.now()) {
  const target = baseOf(ratesCache);
  const entries = Object.entries(totals);
  if (!entries.length) return money(0, target);

  let sum = 0;
  let converted = false;
  let anyNative = false;
  const untouched = [];

  for (const [currency, amount] of entries) {
    if (currency === target) { sum += amount; anyNative = true; continue; }
    const inBase = toBase(amount, currency, ratesCache, now);
    if (inBase === null) { untouched.push(money(amount, currency)); continue; }
    sum += inBase;
    converted = true;
  }

  if (!converted && !anyNative) return untouched.join(' + ');
  const head = (converted ? '\u2248 ' : '') + money(sum, target);
  return untouched.length ? [head, ...untouched].join(' + ') : head;
}

/** The currency the threshold slider speaks, read off the offers on screen. */
let seuilDevise = null;

/*
 * Le curseur parle euros, comme tout le reste de l'ecran.
 *
 * Il parlait la devise MAJORITAIRE des offres : vingt offres de l'agregateur
 * contre une ou deux d'Epic, et une interface francaise affichait
 * « Ne recuperer qu'au-dessus de $15.00 ».
 *
 * A savoir, et assume : la COMPARAISON, elle, se fait toujours dans la devise
 * de chaque offre, sans conversion (watch/filters.js). Un seuil a 15 ecarte
 * donc « $14.99 » comme « 14,99 € ». Pour une valeur indicative, l'ordre de
 * grandeur suffit ; convertir dans le filtre demanderait de faire entrer un
 * taux dans un module pur, et de le faire entrer dans ses tests.
 */
function thresholdCurrency() {
  /* Le curseur, lui, parle la devise du PAYS choisi et non celle de la table :
     c'est le seuil de l'utilisateur, pas une conversion. Il prend donc effet
     des le changement de pays, sans attendre un cycle. */
  return currencyFor(localeCache.country);
}

/* ------------------------------------------------------------ code backup */

/* L'etat dit ce qui est REELLEMENT sauvegarde, pas ce qui devrait l'etre.
   Une sauvegarde qu'on croit faite est pire que pas de sauvegarde : c'est
   celle sur laquelle on compte le jour de la reinstallation. */
function renderSyncCodes(behaviour) {
  const on = behaviour.syncCodes === true;
  document.getElementById('sync-codes').checked = on;

  const zone = document.getElementById('sync-state');
  if (!api.storage.sync) {
    zone.textContent = t('syncUnavailable');
    return;
  }
  if (!on) { zone.textContent = ''; return; }

  api.storage.sync.get(KEY_SYNC_CODES, (raw) => {
    void api.runtime.lastError;
    const n = Array.isArray(raw && raw[KEY_SYNC_CODES]) ? raw[KEY_SYNC_CODES].length : 0;
    zone.textContent = n ? t('syncCodesState', String(n)) : t('syncCodesEmpty');
  });
}

/* ----------------------------------------------------------------- filters */

function renderFilters(all, behaviour) {
  const filters = get(all, KEY_FILTERS, {});
  const catalog = get(all, KEY_CATALOG, {});

  const threshold = Number.isFinite(filters.minWorth) ? filters.minWorth : 0;
  seuilDevise = thresholdCurrency();
  document.getElementById('min-worth').value = String(threshold);
  document.getElementById('min-worth-value').textContent = threshold > 0 ? money(threshold, seuilDevise) : t('noThreshold');
  document.getElementById('include-dlc').checked = filters.claimExtraContent === true;
  document.getElementById('keepable-only').checked = filters.claimOnlyKeepable !== false;
  document.getElementById('autonomous').checked = behaviour.autonomousClaim !== false;
  document.getElementById('steam-auto').checked = behaviour.steamAutoClaim === true;

  // Showing what a setting does BEFORE the slider moves beats letting someone
  // discover afterwards what they suppressed.
  const now = Date.now();
  const open = openOffers(catalog, behaviour, now).map(({ offer }) => offer);
  // Le meme registre que le cycle, sinon l'apercu promet des reclamations que
  // la veille ecartera -- et c'est l'apercu qu'on regarde pour decider.
  const seen = preview(open, filters, {
    supportedStores: claimableStoresFor(behaviour),
    owned: ownedKeys(get(all, KEY_LIBRARY, {}), normaliseTitle),
  });
  document.getElementById('filters-preview').textContent = open.length
    ? t('filtersPreview', String(open.length), String(seen.claimableCount), String(seen.dropped))
    : t('filtersPreviewNone');

  /* Le reglage le plus lourd de la page tient en un mot sur le pli ferme :
     l'extension reclame-t-elle toute seule, oui ou non ? */
  foldSay('fold-claim', t(behaviour.autonomousClaim !== false ? 'foldClaimOn' : 'foldClaimOff'));
}

/* ----------------------------------------------------- notifications, look */

function renderNotifications(behaviour) {
  document.getElementById('notify-mode').value = behaviour.notifyMode || 'every';

  const quiet = behaviour.quiet || DEFAULT_BEHAVIOUR.quiet;
  document.getElementById('quiet-on').checked = quiet.on === true;
  document.getElementById('quiet-start').value = quiet.start || '23:00';
  document.getElementById('quiet-end').value = quiet.end || '08:00';
  document.getElementById('quiet-range').hidden = quiet.on !== true;

  const hours = Number.isFinite(behaviour.reminderHours) ? behaviour.reminderHours : 6;
  document.getElementById('reminder').value = String(hours);
  document.getElementById('reminder-value').textContent = hours > 0 ? String(hours) : t('reminderOff');
}

function applyLook() {
  document.documentElement.dataset.theme = ui.theme === 'system' ? '' : ui.theme;
  if (ui.theme === 'system') document.documentElement.removeAttribute('data-theme');
  document.getElementById('theme').value = ui.theme;

  /* La densite, posee sur BODY -- c'est la que la regle l'attend, et elle
     l'attendait depuis longtemps : le reglage etait enregistre, la regle CSS
     ecrite, et personne ne faisait le lien. On retire l'attribut plutot que
     de poser une chaine vide, pour que `[data-density]` ne matche pas. */
  const dense = ui.density === 'compact';
  if (dense) document.body.dataset.density = 'compact';
  else document.body.removeAttribute('data-density');
  document.getElementById('density').value = dense ? 'compact' : 'cosy';
  document.getElementById('language').value = ui.language;
  document.getElementById('hide-owned').checked = ui.hideOwned === true;
  document.getElementById('sort').value = ui.sort;
}

/* Le selecteur de pays est rempli DEPUIS la table : une liste recopiee dans
   le HTML finirait par proposer un pays que la veille refuse. */
function fillCountries() {
  const select = document.getElementById('epic-country');
  if (!select || select.options.length) return;
  for (const [code, info] of Object.entries(COUNTRIES)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${info.label} (${info.currency})`;
    select.append(option);
  }
}

/* -------------------------------------------------------------------- load */

let behaviourCache = { ...DEFAULT_BEHAVIOUR };

/* Le taux du jour, pose par le cycle de veille (watch/rates.js). Null tant
   qu'aucun cycle n'a tourne : les montants restent alors dans leur devise. */
let ratesCache = null;

/* Le pays et la langue choisis. Defaut cable : l'extension doit savoir quoi
   faire avant toute lecture de stockage. */
let localeCache = { country: normaliseCountry(null), lang: normaliseLang(null, null) };

async function load() {
  return withWorking(render);
}

async function render() {
  const all = await readAll();

  ui = { ...DEFAULT_UI, ...get(all, KEY_UI, {}) };
  behaviourCache = { ...DEFAULT_BEHAVIOUR, ...get(all, KEY_SETTINGS, {}) };
  ratesCache = get(all, KEY_RATES, null);

  /* Les etoiles posees avant la 2.29.0 deviennent de vraies priorites.
   *
   * Elles vivaient dans les preferences d'affichage, que le service worker ne
   * lit jamais : elles ordonnaient la liste sans rien changer a ce qui etait
   * reclame en premier. Les jeter ferait perdre un choix deja exprime ; les
   * laisser la ferait cohabiter deux notions de priorite, dont une muette.
   *
   * La traduction est faite UNE fois, puis la liste est videe -- c'est elle
   * qui sert de marqueur, et non une cle de version de plus. */
  if (Array.isArray(ui.pinned) && ui.pinned.length) {
    const catalogue = get(all, KEY_CATALOG, {});
    for (const key of ui.pinned) {
      if (catalogue[key]) await tell('fgc-prioritise', { catalogKey: key, on: true });
    }
    await writeUi({ pinned: [] });
    return render();
  }
  localeCache = {
    country: normaliseCountry(all[KEY_COUNTRY]),
    lang: normaliseLang(all[KEY_LANG], all[KEY_COUNTRY]),
  };

  setLocale(ui.language === 'auto' ? null : ui.language);
  translateDocument();
  applyLook();

  document.getElementById('version').textContent = `v${api.runtime.getManifest().version}`;

  renderStatus(all);
  renderGames(all, behaviourCache);
  renderUpcoming(all);
  renderLog(all);
  renderCodes(get(all, KEY_CODES, []));
  renderTally(all);
  renderFilters(all, behaviourCache);
  renderHealth(all);
  renderBackground();
  renderCanary(all);
  renderStores(all, behaviourCache);
  renderFallback(all);
  renderSources(all, behaviourCache);
  renderPrediction(all);
  renderNotifications(behaviourCache);
  renderSyncCodes(behaviourCache);

  document.getElementById('epic-auto').checked = all.FGC_epic_auto_mode !== false;
  document.getElementById('luna-auto').checked = all.FGC_luna_auto_mode !== false;
  document.getElementById('luna-dlc').checked = all.FGC_luna_claim_dlc !== false;
  document.getElementById('epic-country').value = localeCache.country;

  const state = get(all, KEY_STATE, {});

  // L'arret d'urgence est le seul etat que le popup montre AVANT tout le reste.
  const arrete = all[KEY_STOP] === true;
  document.getElementById('stopped-banner').hidden = !arrete;
  document.getElementById('stop-all').disabled = arrete;

  const cooldowns = get(all, 'FGC_auto_state', {});
  const paused = Object.values(cooldowns).filter((ts) => ts > Date.now()).length;
  document.getElementById('foot').textContent = t(paused ? 'footPaused' : 'footIdle');
}

/* ------------------------------------------------------------------ writes */

async function writeUi(patch = {}) {
  ui = { ...ui, ...patch };
  await setValue(KEY_UI, ui);
  await load();
}

async function writeBehaviour(patch) {
  const next = { ...behaviourCache, ...patch, updatedAt: Date.now() };
  await setValue(KEY_SETTINGS, next);

  /* Settings only, and only when asked. Codes and history never leave this
     machine: chrome.storage.sync is replicated through the user's Google
     account, and a redeem code is a bearer token. */
  if (ui.syncSettings && api.storage.sync) {
    try { await api.storage.sync.set({ [KEY_SETTINGS]: next }); } catch { /* quota, offline */ }
  }
  await load();
}

async function writeFilters(patch) {
  const all = await readAll();
  await setValue(KEY_FILTERS, { ...get(all, KEY_FILTERS, {}), ...patch });
  await load();
}

/* A cycle hits the network: several seconds, sometimes the time to wake the
   service worker. Waiting for its answer beats handing back control at once
   with unchanged data. */
function requestCycle() {
  return new Promise((resolve) => {
    api.runtime.sendMessage({ type: 'fgc-check-now' }, () => {
      void api.runtime.lastError;
      resolve();
    });
  });
}

function tell(type, payload = {}) {
  return new Promise((resolve) => {
    api.runtime.sendMessage({ type, ...payload }, (answer) => {
      void api.runtime.lastError;
      resolve(answer);
    });
  });
}

/* -------------------------------------------------------------------- tabs */

const TAB_NAMES = ['games', 'codes', 'settings'];

function showTab(name) {
  for (const n of TAB_NAMES) {
    const tab = document.getElementById(`tab-${n}`);
    const pane = document.getElementById(`pane-${n}`);
    const active = n === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    pane.hidden = !active;

    // Replay the entry animation: a class already set does not replay on its
    // own, it has to be removed with a reflow forced in between.
    pane.classList.remove('enter');
    if (active) {
      void pane.offsetWidth;
      pane.classList.add('enter');
    }
  }
  // The popup keeps its scroll position between tabs, which reads as truncated
  // content.
  window.scrollTo(0, 0);

  // Looking at the Games tab IS having seen the offers. The badge counted
  // "unseen" offers while nothing ever marked them, so it showed every active
  // offer, for ever. The service worker writes, because the catalogue has one
  // writer.
  if (name === 'games') tell('fgc-mark-seen');
}

/* --------------------------------------------------------------- exports */

function download(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  // The popup closes as soon as it loses focus: the URL is not revoked right
  // away, the download has already started.
}

/** Une cellule CSV : entre guillemets si elle contient une virgule, un
    guillemet ou un saut de ligne. Sans cela un titre comme « Portal 2, GOTY »
    decale toutes les colonnes qui suivent. */
function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function say(message) {
  document.getElementById('backup-state').textContent = message;
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------ wiring */

document.getElementById('search').addEventListener('input', async (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  const all = await readAll();
  renderGames(all, behaviourCache);
});

document.getElementById('sort').addEventListener('change', (e) => writeUi({ sort: e.target.value }));
document.getElementById('theme').addEventListener('change', (e) => writeUi({ theme: e.target.value }));
document.getElementById('density').addEventListener('change', (e) => writeUi({ density: e.target.value }));
document.getElementById('language').addEventListener('change', (e) => writeUi({ language: e.target.value }));
/* Un seul reglage, deux lecteurs : la veille le relit dans le meme espace de
   stockage (watch/storage.js) et le moteur par GM_getValue. La langue suit le
   pays -- c'est la langue de la BOUTIQUE, pas celle de l'interface, qui a son
   propre reglage juste au-dessus. */
document.getElementById('epic-country').addEventListener('change', async (e) => {
  const country = normaliseCountry(e.target.value);
  await setValue(KEY_COUNTRY, country);
  await setValue(KEY_LANG, normaliseLang(null, country));
});
document.getElementById('hide-owned').addEventListener('change', (e) => writeUi({ hideOwned: e.target.checked }));

document.getElementById('show-all-log').addEventListener('click', () => writeUi({ showAllLog: !ui.showAllLog }));

document.getElementById('undo-do').addEventListener('click', async () => {
  const action = undoAction;
  dismissUndo();
  if (action) { await action(); await load(); }
});

/* --- claim all */

document.getElementById('claim-all').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  try {
    const answer = await withWorking(() => tell('fgc-claim-all'), { immediate: true });
    if (answer && typeof answer.claimed === 'number') {
      say(t('claimAllDone', String(answer.claimed), String(answer.left || 0)));
    }
  } finally {
    button.disabled = false;
    await load();
  }
});

/* --- filters and behaviour */

document.getElementById('min-worth').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  document.getElementById('min-worth-value').textContent = v > 0 ? money(v, seuilDevise) : t('noThreshold');
});
document.getElementById('min-worth').addEventListener('change', (e) => writeFilters({ minWorth: Number(e.target.value) }));
document.getElementById('include-dlc').addEventListener('change', (e) => writeFilters({ claimExtraContent: e.target.checked }));
document.getElementById('keepable-only').addEventListener('change', (e) => writeFilters({ claimOnlyKeepable: e.target.checked }));
document.getElementById('autonomous').addEventListener('change', (e) => writeBehaviour({ autonomousClaim: e.target.checked }));

/* --- Steam: never on a single click.
   Ticking the box does not turn it on: it goes back to off, and the warning
   opens. Only "turn on anyway" writes the setting -- after the user has read
   what the Steam agreement says. Turning it OFF needs no confirmation. */
document.getElementById('steam-auto').addEventListener('change', (e) => {
  const warn = document.getElementById('steam-warn');
  if (e.target.checked) {
    e.target.checked = false;
    warn.hidden = false;
    return;
  }
  warn.hidden = true;
  writeBehaviour({ steamAutoClaim: false });
});
document.getElementById('steam-accept').addEventListener('click', async () => {
  document.getElementById('steam-warn').hidden = true;
  await writeBehaviour({ steamAutoClaim: true });
  /* Without this, nothing moved until the next planned cycle -- hours, on a
     quiet day. The user has just decided: look now, like "Check now" does.
     The emergency stop still wins: a stopped extension cancels the cycle. */
  await withWorking(requestCycle, { immediate: true });
  await load();
});
document.getElementById('steam-cancel').addEventListener('click', () => {
  document.getElementById('steam-warn').hidden = true;
});
document.getElementById('sync-codes').addEventListener('change', (e) => writeBehaviour({ syncCodes: e.target.checked }));

document.getElementById('notify-mode').addEventListener('change', (e) => writeBehaviour({ notifyMode: e.target.value }));
document.getElementById('quiet-on').addEventListener('change', (e) => writeBehaviour({
  quiet: { ...(behaviourCache.quiet || DEFAULT_BEHAVIOUR.quiet), on: e.target.checked },
}));
for (const id of ['quiet-start', 'quiet-end']) {
  document.getElementById(id).addEventListener('change', () => writeBehaviour({
    quiet: {
      ...(behaviourCache.quiet || DEFAULT_BEHAVIOUR.quiet),
      start: document.getElementById('quiet-start').value,
      end: document.getElementById('quiet-end').value,
    },
  }));
}

document.getElementById('reminder').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  document.getElementById('reminder-value').textContent = v > 0 ? String(v) : t('reminderOff');
});
document.getElementById('reminder').addEventListener('change', (e) => writeBehaviour({ reminderHours: Number(e.target.value) }));

/* The slider writes the floor; the daily cap follows from it on the scheduler
   side, and is never entered separately. */
document.getElementById('floor').addEventListener('input', (e) => {
  document.getElementById('floor-value').textContent = e.target.value;
});
document.getElementById('floor').addEventListener('change', async (e) => {
  await writeBehaviour({ floorPerDay: Number(e.target.value) });
  await withWorking(requestCycle, { immediate: true });
  await load();
});

/* Sonder les sessions. Un geste explicite : chaque sonde lit un compte avec
   la session de l'utilisateur, exactement comme l'importation de collection,
   et pour la meme raison elle ne part jamais toute seule. */
document.getElementById('session-probe').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  const avant = button.textContent;
  button.textContent = t('sessionsChecking');
  try {
    await tell('fgc-session-probe');
  } finally {
    button.disabled = false;
    button.textContent = avant;
    await load();
  }
});

document.getElementById('check-now').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  button.textContent = t('checking');
  try {
    await withWorking(requestCycle, { immediate: true });
  } finally {
    button.disabled = false;
    button.textContent = t('checkNow');
    await load();
  }
});

/* --- on-page claiming */

document.getElementById('epic-auto').addEventListener('change', (e) => setValue('FGC_epic_auto_mode', e.target.checked));
document.getElementById('luna-auto').addEventListener('change', (e) => setValue('FGC_luna_auto_mode', e.target.checked));
document.getElementById('luna-dlc').addEventListener('change', (e) => setValue('FGC_luna_claim_dlc', e.target.checked));
document.getElementById('open-epic').addEventListener('click', async () => {
  await setValue('FGC_auto_state', JSON.stringify({}));
  openTab(PRIMARY[0].url);
});
document.getElementById('open-luna').addEventListener('click', () => openTab(PRIMARY[2].url));

/* --- backup */

document.getElementById('export-json').addEventListener('click', async () => {
  const all = await readAll();
  const payload = buildExport({
    codes: get(all, KEY_CODES, []),
    histories: Object.fromEntries(Object.entries(HISTORY_KEYS).map(([l, k]) => [l, get(all, k, {})])),
    catalog: get(all, KEY_CATALOG, {}),
    library: get(all, KEY_LIBRARY, {}),
    sources: get(all, KEY_SOURCES, {}),
    settings: get(all, KEY_SETTINGS, {}),
    filters: get(all, KEY_FILTERS, {}),
    version: api.runtime.getManifest().version,
    now: Date.now(),
  });
  download(exportFileName(Date.now()), 'application/json', JSON.stringify(payload, null, 2));
  say(t('exported', String(payload.pendingCodes.length), String(payload.tally.count)));
});

document.getElementById('export-csv').addEventListener('click', async () => {
  const all = await readAll();
  const histories = Object.fromEntries(Object.entries(HISTORY_KEYS).map(([l, k]) => [l, get(all, k, {})]));
  const rows = claimsMade(histories, get(all, KEY_CATALOG, {}), { library: get(all, KEY_LIBRARY, {}) });

  // La devise a sa colonne : une valeur sans devise n'est pas exploitable dans
  // un tableur, et les deux ne se melangent pas dans la meme cellule.
  const header = ['date', 'title', 'store', 'worth', 'currency', 'status'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      new Date(r.ts).toISOString(),
      r.title || '',
      STORE_LABELS[r.store] || r.store || '',
      r.worth ?? '',
      r.currency || '',
      r.status || '',
    ].map(csvCell).join(','));
  }
  // A BOM, so Excel opens UTF-8 without mangling accented titles.
  download(exportFileName(Date.now()).replace(/\.json$/, '.csv'), 'text/csv', `﻿${lines.join('\r\n')}\r\n`);
  say(t('exportedCsv', String(rows.length)));
});

document.getElementById('import').addEventListener('click', () => document.getElementById('import-file').click());

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    // `formatExport` is what versions up to 2.10 wrote. A backup is worthless
    // if the version that can read it is the one you no longer run.
    if (!data || typeof data !== 'object' || !('exportFormat' in data || 'formatExport' in data)) {
      say(t('importNotOurs'));
      return;
    }

    // Only what cannot be rebuilt is restored. The catalogue and the sources'
    // state come back in one cycle; the codes, never.
    const all = await readAll();
    const existing = get(all, KEY_CODES, []);
    const known = new Set(existing.map((c) => c.code));
    const added = (Array.isArray(data.pendingCodes) ? data.pendingCodes : [])
      .filter((c) => c && typeof c.code === 'string' && c.code && !known.has(c.code));

    if (added.length) await setValue(KEY_CODES, JSON.stringify([...existing, ...added]));
    // Un fichier choisi a la main reste une entree non fiable : un tableau ou
    // une chaine a la place d'un objet corromprait les reglages du worker.
    if (isPlainObject(data.filters)) await setValue(KEY_FILTERS, data.filters);
    if (isPlainObject(data.settings)) await setValue(KEY_SETTINGS, data.settings);

    say(added.length ? t('importRestored', String(added.length)) : t('importNoNew'));
    await load();
  } catch (err) {
    say(t('importFailed', (err && err.message) || String(err)));
  } finally {
    e.target.value = '';
  }
});

/* --- arret d'urgence */

/* Un seul interrupteur, ecrit dans le stockage plutot que dans une variable :
   le service worker peut mourir a tout instant, et le moteur tourne dans des
   pages qui ne savent rien de ce popup. */
document.getElementById('stop-all').addEventListener('click', async () => {
  await setValue(KEY_STOP, true);
  // Les onglets deja ouverts ne se refermeront pas seuls : on le demande.
  await tell('fgc-sweep-tabs');
  await load();
});

document.getElementById('resume').addEventListener('click', async () => {
  await setValue(KEY_STOP, false);
  await load();
});

/* --- the collection, on its own page: a whole library does not fit either */

document.getElementById('open-collection').addEventListener('click', (e) => {
  e.preventDefault();
  openTab(api.runtime.getURL('collection.html'));
});

/* --- the watch log, on its own page: 500 lines do not fit in 328 px */

/* Le menu des magasins de saisie est construit depuis la TABLE, pas ecrit a
   la main : ajouter un magasin ne doit demander qu'une ligne, au meme endroit
   que sa destination d'echange. */
{
  const menu = document.getElementById('codes-store');
  for (const store of Object.keys(REDEEM_URLS)) {
    if (store === 'unknown') continue;
    const option = el('option', null, STORE_LABELS[store] || store);
    option.value = store;
    menu.append(option);
  }
  menu.value = 'gog';
}

/* La demande DOIT partir d'un geste : Chrome refuse
   `permissions.request` hors d'un clic, et le refus n'est pas une erreur --
   c'est un silence, donc un interrupteur qui ne bouge pas sans rien dire. */
document.getElementById('background-permission').addEventListener('change', async (e) => {
  const veut = e.target.checked;
  try {
    if (veut) await api.permissions.request({ permissions: [OPTIONAL.BACKGROUND] });
    else await api.permissions.remove({ permissions: [OPTIONAL.BACKGROUND] });
  } catch { /* refus ou plateforme muette : l'etat reel est relu juste apres */ }
  await renderBackground();
});

document.getElementById('codes-add').addEventListener('click', async () => {
  const zone = document.getElementById('codes-paste');
  await addCodesByHand(zone.value, document.getElementById('codes-store').value);
  zone.value = '';
});

document.getElementById('open-history').addEventListener('click', () => openTab(api.runtime.getURL('historique.html')));
document.getElementById('open-journal').addEventListener('click', (e) => {
  e.preventDefault();
  openTab(api.runtime.getURL('journal.html'));
});

/* --- diagnostics stays in the foreground during its measurements */

document.getElementById('open-diagnostics').addEventListener('click', (e) => {
  e.preventDefault();
  openTab(api.runtime.getURL('diagnostics.html'));
});

/* --- tabs and keyboard */

TAB_NAMES.forEach((name, i) => {
  const tab = document.getElementById(`tab-${name}`);
  tab.addEventListener('click', () => showTab(name));
  tab.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TAB_NAMES[(i + step + TAB_NAMES.length) % TAB_NAMES.length];
    showTab(next);
    document.getElementById(`tab-${next}`).focus();
  });
});

document.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

  if (e.key === 'Escape' && e.target.id === 'search') {
    e.target.value = '';
    e.target.dispatchEvent(new Event('input'));
    e.target.blur();
    return;
  }
  if (inField) return;

  if (e.key === '/') {
    e.preventDefault();
    showTab('games');
    document.getElementById('search').focus();
    return;
  }
  if (e.key === 'Enter') {
    // Entree sur un bouton l'active deja : ouvrir EN PLUS le premier jeu
    // fermait le popup sous les doigts de qui navigue au clavier.
    if (e.target.closest('button, a, summary, label')) return;
    const first = document.querySelector('#games .game');
    if (first && first.tagName === 'BUTTON') first.click();
    return;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= TAB_NAMES.length) {
    showTab(TAB_NAMES[n - 1]);
    document.getElementById(`tab-${TAB_NAMES[n - 1]}`).focus();
  }
});

/* --- boot */

showTab('games');
/* Apres le premier rendu, pas avant : c'est lui qui applique la langue choisie
   dans les reglages. Pose plus tot, l'invite restait dans celle du navigateur.
   Elle dit pourquoi sauvegarder : le catalogue se refait en un cycle, les codes
   jamais. */
fillCountries();
load().then(() => say(t('backupHint')));
