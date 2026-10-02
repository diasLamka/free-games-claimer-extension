/* Le pont entre `localize.js` (pur) et le stockage de l'extension.
 *
 * Trois usages, un seul reglage lu :
 *
 *   - `localizeFor(chrome, url)` : le service worker, juste avant d'ouvrir une
 *     page (fenetre de reclamation, clic sur une notification) ;
 *   - `installLinkLocalizer(chrome, doc)` : les pages de l'extension, dont les
 *     liens vers les magasins sont ecrits a cent endroits. Plutot que de les
 *     reprendre un par un, l'adresse est reecrite A L'INSTANT DU CLIC (clic,
 *     clic du milieu, menu contextuel), de facon synchrone, avec le reglage lu
 *     au chargement et tenu a jour par `storage.onChanged` ;
 *   - `readLocale(chrome)` : le reglage lui-meme, ou null s'il est illisible.
 *
 * Aucune de ces fonctions ne jette : si le stockage ne repond pas, l'adresse
 * part telle quelle. Une langue ratee ne doit jamais empecher d'ouvrir une page.
 *
 * `forClaim` n'est vrai que pour les pages que le MOTEUR va lire : la langue y
 * est ramenee a celles dont il connait les boutons (voir localize.js).
 */
import { KEY_COUNTRY, KEY_LANG, normaliseCountry, normaliseLang } from './locale.js';
import { KEY_LUNA_HOST, localizeUrl, normaliseLunaHost } from './localize.js';

const KEYS = [KEY_COUNTRY, KEY_LANG, KEY_LUNA_HOST];

function shape(raw) {
  const country = normaliseCountry(raw && raw[KEY_COUNTRY]);
  return {
    country,
    lang: normaliseLang(raw && raw[KEY_LANG], country),
    lunaHost: normaliseLunaHost(raw && raw[KEY_LUNA_HOST]),
  };
}

/** Le pays, la langue et le domaine Luna retenu ; null si le stockage est muet. */
export async function readLocale(chrome) {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) return null;
    return shape(await chrome.storage.local.get(KEYS));
  } catch {
    return null;
  }
}

/** Cette adresse dans la langue du reglage, ou telle quelle si on ne sait pas. */
export async function localizeFor(chrome, url, { forClaim = false } = {}) {
  const locale = await readLocale(chrome);
  if (!locale) return url;
  try { return localizeUrl(url, { ...locale, forClaim }); } catch { return url; }
}

/**
 * Reecrit les liens d'une page de l'extension au moment ou on les utilise.
 *
 * Rend une fonction `localize(url)` synchrone, utilisable pour un
 * `tabs.create` direct. Le reglage est lu une fois, puis suit les changements.
 * Tant qu'il n'est pas lu (les premieres millisecondes), les liens partent
 * tels quels -- jamais d'attente devant un clic.
 */
export function installLinkLocalizer(chrome, doc) {
  let locale = null;
  const refresh = () => readLocale(chrome).then((l) => { if (l) locale = l; });
  refresh();
  try {
    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && KEYS.some((k) => k in changes)) refresh();
      });
    }
  } catch { /* pas d'ecoute : le reglage lu au chargement reste valable */ }

  const localize = (url, opts) => (locale ? localizeUrl(url, { ...locale, ...(opts || {}) }) : url);

  if (doc && typeof doc.addEventListener === 'function') {
    const rewrite = (event) => {
      const target = event && event.target;
      const a = target && typeof target.closest === 'function' ? target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || !/^https:\/\//i.test(href)) return;
      const next = localize(href);
      if (next !== href) a.setAttribute('href', next);
    };
    for (const type of ['click', 'auxclick', 'contextmenu']) doc.addEventListener(type, rewrite, true);
  }
  return localize;
}
