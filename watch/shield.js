/* Le bouclier : reconnaitre un faux site de jeux gratuits ou une fausse page de connexion.
 *
 * Un faux " Epic Games " ou " Steam " vole un compte avec une adresse qui ressemble a la vraie. L'extension connait deja les
 * magasins ; ce module sait seulement dire, d'apres l'adresse et ce que la page montre, si une page SE FAIT PASSER pour l'un
 * d'eux sans en etre. Il ne bloque rien, ne ferme rien, ne conclut jamais a la place de l'utilisateur : il avertit.
 *
 * CONSERVATEUR PAR CONSTRUCTION. Un avertissement a tort apprend a ignorer les vrais. Donc :
 *
 *  - Les sites officiels (et leurs CDN) ne declenchent JAMAIS rien.
 *  - Un nom de domaine qui CONTIENT " steam " ne suffit pas : steamdb.info, steamgifts.com, steamspy.com sont des sites
 *    legitimes. Seuls les noms composes qu'un magasin utilise vraiment (steampowered, steamcommunity, epicgames) comptent, et
 *    seul un nom qui IMITE le leur (une lettre de travers, un chiffre a la place d'une lettre) est une faute en soi.
 *  - Un nom qui n'imite rien ne devient suspect qu'avec UN SIGNE DE PLUS sur la page : un champ de mot de passe sous un titre
 *    qui cite la marque, ou une promesse du genre " V-Bucks gratuits ".
 *  - " Danger " est reserve aux imitations d'adresse AVEC un signe de page ; un champ de mot de passe sous un titre qui cite la
 *    marque, sur une adresse qui n'imite rien, reste un " attention ".
 *
 * Tout est calcule sur la machine, d'apres des textes que la page montre deja : aucune requete, aucun cookie.
 *
 * Module pur.
 */

/** Les magasins surveilles : leurs domaines officiels (enregistrables), les noms composes qui les imitent, les mots qui les citent. */
export const BRANDS = Object.freeze({
  epic: Object.freeze({
    label: 'Epic Games',
    domains: Object.freeze(['epicgames.com', 'epic.games', 'unrealengine.com', 'fab.com', 'epicgames.dev']),
    names: Object.freeze(['epicgames']),
    words: Object.freeze([/\bepic games\b/i]),
  }),
  steam: Object.freeze({
    label: 'Steam',
    domains: Object.freeze(['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steam-chat.com', 's.team', 'valvesoftware.com']),
    names: Object.freeze(['steampowered', 'steamcommunity']),
    words: Object.freeze([/\bsteam\b/i]),
  }),
  gog: Object.freeze({
    label: 'GOG',
    domains: Object.freeze(['gog.com', 'gog-statics.com', 'gogcdn.net']),
    names: Object.freeze(['gog']),
    words: Object.freeze([/\bgog(\.com)?\b/i, /\bgog galaxy\b/i]),
  }),
});

/** Les promesses typiques des faux sites. Strictes : " des jeux gratuits sur Epic cette semaine " n'en est pas une. */
export const LURES = Object.freeze([
  /\bfree\s+v-?bucks\b/i,
  /\bfree\s+(steam|epic)\s+(wallet|gift\s*cards?|games?\s*generator|key\s*generator)\b/i,
  /\b(steam|epic games|gog)\s+(keys?|codes?|gift\s*cards?)\s+generator\b/i,
  /\b(cartes?\s+cadeaux?|codes?)\s+(steam|epic)\s+gratuit(e)?s?\b/i,
  /\b(steam|epic)\s+(wallet|gift\s*cards?)\s+gratuit(e)?s?\b/i,
  /\bkostenlos(e|er)?\s+(steam|epic)[\s-]*(guthaben|geschenkkarte|gutschein)/i,
]);

/** Les mots d'une page de connexion, dans les quatre langues de l'extension. */
const LOGIN_WORDS = /\b(sign in|log in|login|connexion|se connecter|anmelden|iniciar sesi[o\u00f3]n)\b/i;

/** Les deuxiemes niveaux a trois parties (co.uk, com.au...) : le domaine enregistrable en prend une de plus. */
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);

/** Le domaine enregistrable d'un nom d'hote : `store.epicgames.com` -> `epicgames.com`. Approximatif, sans liste publique. */
export function registrable(hostname) {
  const labels = String(hostname || '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const [tld, sld] = [labels[labels.length - 1], labels[labels.length - 2]];
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** Les domaines officiels d'une marque a montrer a l'utilisateur : les deux premiers, les plus connus. */
export function officialDomains(brand) {
  const b = BRANDS[brand];
  return b ? b.domains.slice(0, 2) : [];
}

/** Ce nom d'hote est-il un domaine officiel d'un des magasins ? Rend la marque, ou null. */
export function officialBrand(hostname) {
  const reg = registrable(hostname);
  for (const [brand, b] of Object.entries(BRANDS)) {
    if (b.domains.some((d) => reg === d || String(hostname).toLowerCase() === d || String(hostname).toLowerCase().endsWith(`.${d}`))) return brand;
  }
  return null;
}

/**
 * La silhouette d'un nom : ce qu'un oeil presse confond. Les chiffres qui ressemblent a une lettre, " rn " pour " m ", " vv " pour
 * " w ", et i/l/1 ensemble. Les deux cotes d'une comparaison passent par la meme fonction.
 */
export function skeleton(name) {
  return String(name || '').toLowerCase()
    .replace(/[-_.]/g, '')
    .replace(/rn/g, 'm').replace(/vv/g, 'w')
    .replace(/0/g, 'o').replace(/[1i|]/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/\$/g, 's');
}

/** La distance d'edition de Levenshtein, bornee a `max + 1` (assez pour decider). */
export function editDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** La tolerance selon la longueur du nom officiel : un nom court ne se laisse pas tordre. */
function tolerance(length) {
  if (length >= 12) return 2;
  if (length >= 8) return 1;
  return 0;
}

/**
 * Ce que l'adresse seule dit : `{ kind, brand }`, `kind` valant :
 *   'official'       un domaine officiel (ou un de ses sous-domaines) ;
 *   'typo'           une imitation : une lettre de travers, un chiffre a la place d'une lettre, la meme silhouette ;
 *   'brand-in-name'  le nom compose d'un magasin, habille (epicgames-free.com) ;
 *   'same-name'      le meme nom sous une autre extension (epicgames.net) ;
 *   null             rien a dire.
 */
export function assessHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return { kind: null, brand: null };
  const dejaOfficiel = officialBrand(host);
  if (dejaOfficiel) return { kind: 'official', brand: dejaOfficiel };

  const reg = registrable(host);
  const name = reg.split('.')[0];
  const flat = name.replace(/-/g, '');
  const parts = name.split('-');
  const sk = skeleton(name);

  for (const [brand, b] of Object.entries(BRANDS)) {
    for (const n of b.names) {
      const nsk = skeleton(n);
      if (sk === nsk) return { kind: flat === n ? 'same-name' : 'typo', brand };
      const tol = tolerance(n.length);
      if (tol > 0 && editDistance(sk, nsk, tol) <= tol) return { kind: 'typo', brand };
      // Le nom compose, habille : seulement les noms assez longs pour ne pas tomber sur le premier mot venu.
      if (n.length >= 8 && flat.includes(n)) return { kind: 'brand-in-name', brand };
      // Un nom court (gog) ne compte que comme mot entier d'un nom a tirets : gog-games, free-gog-keys.
      if (n.length < 8 && parts.length > 1 && parts.includes(n)) return { kind: 'brand-in-name', brand };
    }
  }
  return { kind: null, brand: null };
}

/** Le texte cite-t-il un des magasins, et lequel ? */
function brandMentioned(text) {
  for (const [brand, b] of Object.entries(BRANDS)) {
    if (b.words.some((re) => re.test(text))) return brand;
  }
  return null;
}

/** Les niveaux, du plus calme au plus grave. */
export const LEVELS = Object.freeze({ OK: 'ok', WARN: 'warn', DANGER: 'danger' });

/** Les raisons, que le worker et le popup traduisent. */
export const REASONS = Object.freeze({
  TYPO: 'typo',
  BRAND_IN_NAME: 'brand-in-name',
  SAME_NAME: 'same-name',
  FAKE_LOGIN: 'fake-login',
  LURE: 'lure',
});

/**
 * Juge une page : `{ level, brand, host, reasons }`.
 *
 * `page` : `{ url, title, text, hasPassword }` -- ce que la page montre. `text` n'a besoin que des premiers milliers de signes.
 */
export function assessPage(page = {}) {
  const calme = { level: LEVELS.OK, brand: null, host: null, reasons: [] };
  let u;
  try { u = new URL(String(page.url || '')); } catch { return calme; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return calme;
  const host = u.hostname.toLowerCase();
  const h = assessHost(host);
  if (h.kind === 'official') return { ...calme, host, brand: h.brand };

  const title = String(page.title || '').slice(0, 300);
  const text = String(page.text || '').slice(0, 3000);
  const cited = brandMentioned(title);
  const brand = h.brand || cited;
  const hasPassword = page.hasPassword === true;
  const login = hasPassword || LOGIN_WORDS.test(title);
  const lure = LURES.some((re) => re.test(`${title} ${text}`));
  const reasons = [];

  const imitates = h.kind === 'typo' || h.kind === 'brand-in-name' || h.kind === 'same-name';
  if (h.kind === 'typo') reasons.push(REASONS.TYPO);
  if (h.kind === 'brand-in-name') reasons.push(REASONS.BRAND_IN_NAME);
  if (h.kind === 'same-name') reasons.push(REASONS.SAME_NAME);
  if (login && (imitates || (cited && hasPassword))) reasons.push(REASONS.FAKE_LOGIN);
  if (lure) reasons.push(REASONS.LURE);

  let level = LEVELS.OK;
  if (h.kind === 'typo') {
    // Une imitation d'adresse est deja une faute ; avec un signe de page, c'est un danger.
    level = login || lure || cited ? LEVELS.DANGER : LEVELS.WARN;
  } else if (h.kind === 'brand-in-name') {
    // Un nom compose qui contient la marque ne dit rien tout seul : il faut une page de connexion ou une promesse.
    level = login || lure ? LEVELS.DANGER : LEVELS.OK;
  } else if (h.kind === 'same-name') {
    level = login && cited ? LEVELS.DANGER : (lure ? LEVELS.WARN : LEVELS.OK);
  } else if (cited && hasPassword) {
    level = LEVELS.WARN;
  } else if (lure && (cited || brandMentioned(text))) {
    level = LEVELS.WARN;
  }

  if (level === LEVELS.OK) return { ...calme, host };
  return { level, brand, host, reasons };
}

/** Ce qu'un banc de pages sans danger ne declenche jamais : sert aux tests, et a la pre-selection du script de page. */
export function looksWorthAsking({ title = '', hasPassword = false } = {}) {
  if (hasPassword) return true;
  const t = String(title).slice(0, 300);
  return brandMentioned(t) !== null || LURES.some((re) => re.test(t));
}

/** L'identifiant du script enregistre, et les adresses qu'il demande : facultatives, et DEJA declarees au manifeste. */
export const SHIELD_SCRIPT_ID = 'fgc-bouclier';
export const SHIELD_ORIGINS = Object.freeze(['https://*/*', 'http://*/*']);

/**
 * Les phrases d'un verdict, dans la langue de l'utilisateur : `t(cle, ...arguments)` est la traduction (injectee, pour que ce
 * module reste pur). Une phrase par raison, jamais plus de cinq.
 */
export function shieldLines(r, t) {
  const label = (BRANDS[r && r.brand] || {}).label || '';
  const host = (r && r.host) || '';
  const phrase = {
    [REASONS.TYPO]: () => t('shieldReasonTypo', host, label),
    [REASONS.BRAND_IN_NAME]: () => t('shieldReasonBrandInName', host, label),
    [REASONS.SAME_NAME]: () => t('shieldReasonSameName', host, label),
    [REASONS.FAKE_LOGIN]: () => t('shieldReasonFakeLogin', label || host),
    [REASONS.LURE]: () => t('shieldReasonLure'),
  };
  return ((r && r.reasons) || []).map((k) => (phrase[k] ? phrase[k]() : '')).filter(Boolean).slice(0, 5);
}
