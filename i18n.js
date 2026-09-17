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
export const LOCALES = Object.freeze(['en', 'fr']);

const api = (typeof chrome !== 'undefined' && chrome.i18n) ? chrome : null;

let override = null;

/**
 * Force a locale regardless of the browser UI language, or pass a falsy value
 * to hand resolution back to Chrome.
 */
export function setLocale(locale) {
  override = LOCALES.includes(locale) ? locale : null;
}

export function currentLocale() {
  if (override) return override;
  const ui = api && api.i18n.getUILanguage ? api.i18n.getUILanguage() : 'en';
  const base = String(ui || 'en').toLowerCase().split('-')[0];
  return LOCALES.includes(base) ? base : 'en';
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
  // An override must beat Chrome, which only ever answers in the UI language.
  if (!override && api) {
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
export function intlLocale() {
  return currentLocale() === 'fr' ? 'fr-FR' : 'en-US';
}
