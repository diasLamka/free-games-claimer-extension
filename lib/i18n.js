/* Translation lookup for every surface that shows text.
 *
 * Three consumers, three constraints:
 *
 *   - The popup and the options page run inside the extension, so
 *     `chrome.i18n.getMessage` is there and Chrome has already picked the
 *     locale from the browser UI language.
 *   - The service worker needs the same table for notification bodies.
 *   - The test harness runs in plain Node with no `chrome` object at all, so
 *     every lookup must survive its absence rather than throw.
 *
 * On top of Chrome's own resolution sits one override: `ui.language` in
 * settings. Chrome offers no way to ask for a locale other than the browser's,
 * so an explicit choice is served from the bundled tables instead. That is the
 * only reason `MESSAGES` is duplicated here rather than read from _locales.
 */

/* The tables are imported, not registered.
 *
 * They used to be pushed in by a `registerTables` call from the generated
 * module, which meant every consumer had to remember to import that module for
 * its side effect. The service worker did not, so `t()` returned raw keys and
 * notifications read "notifyOneStore". A dependency that has to be remembered
 * is a dependency that gets forgotten; importing it here cannot be forgotten.
 *
 * i18n-tables.js is generated from _locales at build time, so the two cannot
 * drift, and the build refuses to ship if the file is missing.
 */
import { TABLES } from './i18n-tables.js';

const bundled = TABLES;

/**
 * Locales shipped with the extension. `en` is the default in the manifest, so
 * it is also the fallback whenever a key is missing from another locale.
 */
export const LOCALES = Object.freeze(['en', 'fr', 'de', 'es']);

/* Une region par langue, pour qu'Intl ecrive les dates dans l'ordre du
   lecteur : « 23.09.2026 », « 23/9/2026 », pas l'ordre americain. */
const INTL_TAGS = Object.freeze({ en: 'en-US', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' });

const api = (typeof chrome !== 'undefined' && chrome.i18n) ? chrome : null;

let override = null;

/**
 * Force a locale regardless of the browser UI language, or pass a falsy value
 * to hand resolution back to Chrome.
 */
export function setLocale(locale) {
  override = LOCALES.includes(locale) ? locale : null;
}

/** The two-letter base of the browser UI language, or null if unreadable. */
function browserBase() {
  const ui = api && api.i18n.getUILanguage ? api.i18n.getUILanguage() : null;
  if (!ui) return null;
  return String(ui).toLowerCase().split('-')[0] || null;
}

/**
 * The locale to speak, in order of authority: the explicit setting, then the
 * browser UI language, then the languages the user told the browser they read.
 *
 * That third step is not cosmetics. `getUILanguage` answers the language
 * Chrome's own menus are in, which is not always the reader's: a browser
 * installed in German by an employer, or in English on a second-hand machine,
 * used by someone whose `navigator.languages` starts with `fr-FR`. Defaulting
 * such a reader to English was throwing away the one honest answer available.
 * A UI language we do ship still wins -- it is the more deliberate signal.
 */
export function currentLocale() {
  if (override) return override;

  const base = browserBase();
  if (base && LOCALES.includes(base)) return base;

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const accepted = nav && Array.isArray(nav.languages) && nav.languages.length
    ? nav.languages
    : (nav && nav.language ? [nav.language] : []);
  for (const tag of accepted) {
    const candidate = String(tag || '').toLowerCase().split('-')[0];
    if (LOCALES.includes(candidate)) return candidate;
  }
  return 'en';
}

function fromTables(key, locale) {
  if (!bundled) return null;
  const table = bundled[locale] || bundled.en;
  const hit = (table && table[key]) ?? (bundled.en && bundled.en[key]);
  return typeof hit === 'string' ? hit : null;
}

/**
 * Look up `key` and substitute `$1`..`$9` with `subs`.
 *
 * Returns the key itself when nothing matches. A visible key is a bug report
 * on screen; an empty string is a bug that hides.
 */
export function t(key, ...subs) {
  const flat = subs.length === 1 && Array.isArray(subs[0]) ? subs[0] : subs;
  const locale = currentLocale();

  let raw = null;
  /* Chrome only ever answers in the UI language, so it is asked only when that
     language IS the one we resolved. An override beats it, and so does a
     locale that came from `navigator.languages`: otherwise the tables would say
     French while `getMessage` kept answering in English, in the same popup. */
  if (!override && api && browserBase() === locale) {
    const viaChrome = api.i18n.getMessage(key, flat.map(String));
    if (viaChrome) return viaChrome;
  }
  raw = fromTables(key, locale);
  if (raw === null && api) raw = api.i18n.getMessage(key, flat.map(String)) || null;
  if (raw === null) return key;

  return raw.replace(/\$(\d)/g, (_, d) => {
    const value = flat[Number(d) - 1];
    return value === undefined ? '' : String(value);
  });
}

/**
 * Translate a document in place.
 *
 * `data-i18n` fills textContent. `data-i18n-attr="title:someKey"` fills an
 * attribute, one pair per entry, comma separated. Both are read from the DOM
 * rather than assigned in script so the markup stays readable as markup.
 */
export function translateDocument(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    }
  }
  const html = root.documentElement || document.documentElement;
  if (html) html.lang = currentLocale();
}

/* ------------------------------------------------------------- formatting */

/**
 * The BCP-47 tag to hand to Intl. Kept separate from `currentLocale` because
 * Intl wants a region for sensible date order and `fr` alone gets it wrong on
 * some platforms.
 */
/** The keys starting with `prefix`, from the bundled tables (2.55.0). */
export function keysWith(prefix) {
  return Object.keys((bundled && bundled.en) || {}).filter((k) => k.startsWith(prefix));
}

export function intlLocale() {
  return INTL_TAGS[currentLocale()] || 'en-US';
}
