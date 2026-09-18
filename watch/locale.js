/* Le pays et la langue, ecrits UNE fois.
 *
 * POURQUOI CE MODULE EXISTE. `locale=fr-FR&country=FR&allowCountries=FR` etait
 * recopie a deux endroits -- `watch/sources/epic.js` et `src/core/01-config.js`
 * -- et le reglage de langue de l'interface ne touchait ni l'un ni l'autre. Un
 * utilisateur belge, suisse ou canadien lisait donc des prix francais.
 *
 * CE QU'IL NE PEUT PAS FAIRE, et il vaut mieux le dire que le laisser croire :
 *
 *   - GOG et GamerPower n'acceptent AUCUN parametre de pays. Leurs reponses ne
 *     changent pas d'un pays a l'autre, et ce reglage ne les concerne pas. Il
 *     ne s'applique qu'a Epic -- le seul magasin qui expose ces parametres --
 *     et, par ricochet, a la devise visee par la conversion ;
 *   - le moteur (`src/core`) tourne aussi en userscript, sans `chrome.storage`
 *     et sans ce module : il relit les memes deux valeurs par `GM_getValue`,
 *     avec les memes defauts cables. C'est la duplication assumee du depot,
 *     tenue par un test de parite (`test/locale.test.mjs`), comme celle des
 *     slugs Epic (`test/epic-parite.test.mjs`).
 *
 * Module pur : aucune horloge, aucun stockage, aucun reseau.
 */

/* Les cles de stockage, nommees ici et nulle part ailleurs.
 *
 * Ce sont des cles du MOTEUR (prefixe FGC_), pas des cles de veille : le
 * moteur doit pouvoir les lire de facon SYNCHRONE par GM_getValue avant de
 * construire une URL, ce qui impose leur prechargement dans `ENGINE_KEYS`
 * (gm-shim.js). Une seule ecriture, deux lecteurs. */
export const KEY_COUNTRY = 'FGC_epic_country';
export const KEY_LANG = 'FGC_epic_lang';

/** Ce que l'extension utilise quand rien n'a ete choisi -- et sans stockage. */
export const DEFAULT_COUNTRY = 'FR';
export const DEFAULT_LANG = 'fr';

/**
 * Les pays proposes, avec leur langue et leur devise.
 *
 * Table close, et c'est deliberement conservateur : accepter un code de pays
 * quelconque obligerait a DEVINER sa devise, et un montant converti dans une
 * devise devinee serait un chiffre invente -- exactement ce que la conversion
 * de la 2.17.0 s'interdit.
 *
 * Seul `FR` est mesure contre l'API vivante ; les autres suivent la meme forme
 * de parametres, qui est celle de l'URL deja utilisee. Si Epic refusait l'un
 * d'eux, la source echouerait visiblement (canari, recul, sentinelle) plutot
 * que de repondre faux en silence.
 */
export const COUNTRIES = Object.freeze({
  FR: Object.freeze({ lang: 'fr', currency: 'EUR', label: 'France' }),
  BE: Object.freeze({ lang: 'fr', currency: 'EUR', label: 'Belgique' }),
  LU: Object.freeze({ lang: 'fr', currency: 'EUR', label: 'Luxembourg' }),
  CH: Object.freeze({ lang: 'fr', currency: 'CHF', label: 'Suisse' }),
  CA: Object.freeze({ lang: 'en', currency: 'CAD', label: 'Canada' }),
  US: Object.freeze({ lang: 'en', currency: 'USD', label: 'United States' }),
  GB: Object.freeze({ lang: 'en', currency: 'GBP', label: 'United Kingdom' }),
  IE: Object.freeze({ lang: 'en', currency: 'EUR', label: 'Ireland' }),
  DE: Object.freeze({ lang: 'de', currency: 'EUR', label: 'Deutschland' }),
  ES: Object.freeze({ lang: 'es', currency: 'EUR', label: 'Espana' }),
  IT: Object.freeze({ lang: 'it', currency: 'EUR', label: 'Italia' }),
  PT: Object.freeze({ lang: 'pt', currency: 'EUR', label: 'Portugal' }),
  NL: Object.freeze({ lang: 'nl', currency: 'EUR', label: 'Nederland' }),
  PL: Object.freeze({ lang: 'pl', currency: 'PLN', label: 'Polska' }),
});

/** Les deux hotes de l'API : le second sert de repli en IPv4 pur. */
export const EPIC_API_HOSTS = Object.freeze([
  'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions',
  'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions',
]);

/** Un code de pays connu, ou le defaut. Jamais une valeur inventee. */
export function normaliseCountry(raw) {
  const code = String(raw || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code) ? code : DEFAULT_COUNTRY;
}

/**
 * La langue : celle qui est demandee si elle a la forme d'un code, celle du
 * pays sinon. « auto » -- la valeur du selecteur d'interface -- veut dire
 * « celle du pays », pas « l'anglais ».
 */
export function normaliseLang(raw, country = DEFAULT_COUNTRY) {
  const code = String(raw || '').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(code)) return code;
  return COUNTRIES[normaliseCountry(country)].lang;
}

/** L'etiquette de langue attendue par Epic : « fr-FR », « en-US ». */
export function localeTag(country, lang) {
  const c = normaliseCountry(country);
  return `${normaliseLang(lang, c)}-${c}`;
}

/**
 * La devise du pays choisi.
 *
 * C'est elle que vise la conversion, au lieu de l'euro en dur. Un pays
 * reglable ne rend pas la conversion inutile : Epic servira bien la devise du
 * compte, mais l'agregateur ne publie que des dollars -- c'est structurel chez
 * lui, sa structure ne porte meme pas de code de devise.
 */
export function currencyFor(country) {
  return COUNTRIES[normaliseCountry(country)].currency;
}

/** Les URL de l'API Epic pour ce pays et cette langue. */
export function epicApiUrls(country, lang) {
  const c = normaliseCountry(country);
  const tag = localeTag(c, lang);
  return EPIC_API_HOSTS.map((host) => `${host}?locale=${encodeURIComponent(tag)}`
    + `&country=${encodeURIComponent(c)}`
    + `&allowCountries=${encodeURIComponent(c)}`);
}
