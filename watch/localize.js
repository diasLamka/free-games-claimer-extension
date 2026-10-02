/* Les adresses des magasins, dans LA langue et LE pays de l'utilisateur.
 *
 * POURQUOI CE MODULE EXISTE. `watch/locale.js` regle le pays et la langue pour
 * l'API d'Epic, et rien d'autre. Les pages que l'extension OUVRE -- fenetre de
 * reclamation, clic sur une notification, lien du popup -- restaient donc a la
 * merci de ce que le magasin choisissait : une fiche GOG en `/en/`, une fiche
 * Epic en `/en-US/`, Luna sur `luna.amazon.com`. Un utilisateur francais lisait
 * l'anglais, et le moteur travaillait sur une page qu'il ne lisait pas lui-meme.
 *
 * CE QU'IL FAIT, magasin par magasin :
 *
 *   - Epic : le segment de langue du chemin (`/en-US/p/...` -> `/fr/p/...`),
 *     ou, quand l'adresse n'en porte pas (le schema actuel), le parametre
 *     `?lang=`. Rien d'autre ne bouge : le slug, la requete, l'ancre.
 *   - GOG  : le prefixe de langue du chemin (`/en/game/...` -> `/fr/game/...`),
 *     pose si l'adresse n'en a pas. GOG ne sert que six langues en chemin
 *     (en, de, fr, pl, ru, zh) : pour les autres, l'adresse reste telle quelle
 *     plutot que d'inventer un prefixe que le site refuserait.
 *   - Luna : le domaine du pays (`luna.amazon.fr`). C'est un MARCHE, pas une
 *     langue : le compte Amazon est propre a chaque domaine. Si l'utilisateur
 *     est connecte sur un autre domaine -- le moteur le retient dans
 *     `FGC_luna_host` quand il y voit une session ouverte -- c'est celui-la
 *     qui l'emporte : on ne deconnecte personne pour traduire une page.
 *
 * CE QU'IL NE TOUCHE PAS, ET C'EST VOULU.
 *
 *   - Steam. La reclamation lit des libelles mesures en anglais (`?l=english`,
 *     watch/steam-claim.js) ; les liens affiches a l'utilisateur, eux, suivent
 *     deja la langue de son compte Steam.
 *   - Une adresse qui n'est pas en https, ou d'un autre hote : rendue telle
 *     quelle. Ce module ne decide jamais OU l'on va, seulement DANS QUELLE
 *     LANGUE on y arrive.
 *
 * LA LANGUE LISIBLE PAR LE MOTEUR. Les motifs de clic d'Epic ne connaissent que
 * le francais et l'anglais (CONFIG.epicReadableLangs). Pour OUVRIR une page a
 * reclamer (`forClaim`), la langue est donc ramenee a l'une des deux ; pour
 * AFFICHER un lien a l'utilisateur, toute la langue du pays est permise. Ouvrir
 * en allemand une page dont le moteur ne lit aucun bouton ne reclame plus rien
 * (c'est le bug de la 2.20.0).
 *
 * Module pur : aucune horloge, aucun stockage, aucun reseau. Le moteur en tient
 * une copie ES5 (`src/core/09-locale-urls.js`), gardee par
 * `test/localize.test.mjs` comme les autres duplications du depot.
 */
import { normaliseCountry, normaliseLang } from './locale.js';

/** La cle ecrite par le moteur : le domaine Luna ou une session est ouverte. */
export const KEY_LUNA_HOST = 'FGC_luna_host';

/** Les langues dans lesquelles le moteur sait LIRE une fiche Epic. */
export const EPIC_CLAIM_LANGS = Object.freeze(['fr', 'en']);

/* Les segments de langue qu'Epic met dans le chemin, et celui qu'on pose pour
   chaque langue. Les segments inconnus ne sont pas touches : `/p/...`,
   `/free-games`, `/bundles/...` ne sont pas des langues. */
const EPIC_SEGMENTS = Object.freeze({
  fr: 'fr', en: 'en-US', de: 'de', es: 'es-ES', it: 'it', pt: 'pt-BR', pl: 'pl',
});
const EPIC_KNOWN_SEGMENTS = Object.freeze([
  'ar', 'de', 'en-us', 'es-es', 'es-mx', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-br',
  'ru', 'th', 'tr', 'zh-cn', 'zh-hant',
]);

/** Les langues que GOG accepte comme prefixe de chemin. */
export const GOG_PATH_LANGS = Object.freeze(['en', 'de', 'fr', 'pl', 'ru', 'zh']);
const GOG_FIRST_SEGMENTS = Object.freeze(['game', 'games', 'redeem']);

/** Le domaine Luna de chaque pays. Ce qui n'y est pas retombe sur `.com`. */
const LUNA_BY_COUNTRY = Object.freeze({
  FR: 'luna.amazon.fr', BE: 'luna.amazon.fr', LU: 'luna.amazon.fr', CH: 'luna.amazon.fr',
  DE: 'luna.amazon.de', GB: 'luna.amazon.co.uk', IE: 'luna.amazon.co.uk',
  IT: 'luna.amazon.it', ES: 'luna.amazon.es', CA: 'luna.amazon.ca',
  NL: 'luna.amazon.nl', PL: 'luna.amazon.pl',
});
const LUNA_HOST_FORM = /^luna\.amazon\.(com|fr|de|co\.uk|it|es|ca|com\.au|co\.jp|in|com\.mx|com\.br|nl|se|pl|com\.tr)$/;

export function lunaHostFor(country) {
  return LUNA_BY_COUNTRY[normaliseCountry(country)] || 'luna.amazon.com';
}

/** Un domaine Luna connu, ou null. Jamais un hote quelconque. */
export function normaliseLunaHost(raw) {
  const host = String(raw || '').trim().toLowerCase();
  return LUNA_HOST_FORM.test(host) ? host : null;
}

/** La langue d'une page Epic : celle du reglage, ramenee au lisible si on reclame. */
export function epicPageLang(lang, forClaim) {
  const l = String(lang || '').toLowerCase();
  if (forClaim) return EPIC_CLAIM_LANGS.indexOf(l) !== -1 ? l : 'en';
  return Object.prototype.hasOwnProperty.call(EPIC_SEGMENTS, l) ? l : 'en';
}

function localizeEpic(u, lang, forClaim) {
  const page = epicPageLang(lang, forClaim);
  const first = /^\/([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)(?=\/|$)/.exec(u.pathname);
  if (first && EPIC_KNOWN_SEGMENTS.indexOf(first[1].toLowerCase()) !== -1) {
    const segment = EPIC_SEGMENTS[page];
    if (segment && first[1] !== segment) u.pathname = `/${segment}${u.pathname.slice(first[0].length)}`;
    return;
  }
  if (u.searchParams.get('lang') !== page) u.searchParams.set('lang', page);
}

function localizeGog(u, lang) {
  if (GOG_PATH_LANGS.indexOf(lang) === -1) return;
  const first = /^\/(en|de|fr|pl|ru|zh)(?=\/|$)/.exec(u.pathname);
  if (first) {
    if (first[1] !== lang) u.pathname = `/${lang}${u.pathname.slice(first[0].length)}`;
    return;
  }
  const head = u.pathname.split('/')[1] || '';
  if (head === '' || GOG_FIRST_SEGMENTS.indexOf(head) !== -1) {
    u.pathname = `/${lang}${u.pathname === '/' ? '/' : u.pathname}`;
  }
}

function localizeLuna(u, country, lunaHost) {
  if (!/^\/claims(\/|$)/.test(u.pathname)) return;
  const host = normaliseLunaHost(lunaHost) || lunaHostFor(country);
  if (u.hostname !== host) u.hostname = host;
}

/**
 * Cette adresse, dans la langue et le pays demandes.
 *
 * Rend la chaine d'origine, OCTET POUR OCTET, quand rien ne change : aucune
 * normalisation d'URL ne doit transformer un lien deja bon (`new URL` ajoute
 * un `/` a une origine nue, par exemple).
 */
export function localizeUrl(raw, { country, lang, lunaHost = null, forClaim = false } = {}) {
  if (typeof raw !== 'string' || !raw) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (u.protocol !== 'https:') return raw;

  const c = normaliseCountry(country);
  const l = normaliseLang(lang, c);
  const host = u.hostname.toLowerCase();

  if (host === 'store.epicgames.com') localizeEpic(u, l, forClaim);
  else if (host === 'www.gog.com' || host === 'gog.com') localizeGog(u, l);
  else if (/^luna\.amazon\./.test(host)) localizeLuna(u, c, lunaHost);
  else return raw;

  const out = u.toString();
  /* Une origine nue gagne un « / » sous `new URL` : ce n'est pas un
     changement, on garde l'adresse que l'on a recue. */
  return out === raw || out === `${raw}/` ? raw : out;
}
