/* Le rapport d'echec (2.111.0) : ce que la page montrait quand une recuperation a echoue.
 *
 * Le 2026-10-11, GOG a change la phrase de sa page de succes. Il a fallu la deviner d'apres une capture envoyee a la main :
 * l'extension savait que la recuperation avait echoue, pas ce que la page disait. Elle garde maintenant, pour chaque echec,
 * l'adresse, le titre et le debut du texte de la page -- et sait les mettre en forme pour qu'on les colle dans un message.
 *
 * Ce qui est garde est NETTOYE avant d'etre garde, pas au moment de le montrer : une page de compte affiche un nom, une
 * adresse electronique, parfois un numero de commande ; un rapport copie ne doit pas les emporter. L'adresse perd ses
 * parametres (ils portent des jetons), le texte perd les adresses electroniques et les longues suites de chiffres ou de signes.
 * Trois cents caracteres : de quoi lire une phrase, pas une page.
 *
 * Module pur : aucune API d'extension, aucune horloge implicite.
 */

/** Les verdicts qui demandent un regard : ce sont eux qui laissent un rapport. */
export const FAILURE_VERDICTS = Object.freeze(['failed', 'challenge', 'needs_login', 'needs_teaching']);

export const MAX_PAGE_TEXT = 300;
const MAX_TITLE = 100;
const MAX_URL = 200;
const MAX_DETAILS = 200;

export function isFailureVerdict(verdict) {
  return FAILURE_VERDICTS.includes(verdict);
}

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
const LONG_DIGITS = /\d{8,}/g;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;
/* Un code d'echange (GOG, Luna) : trois groupes de quatre signes ou plus, majuscules et chiffres, separes par des tirets. C'est un
   bien : il ne part pas dans un rapport. Les noms a tirets en minuscules ou en deux mots (Spider-Man, FREE-TO-PLAY) restent. */
const CODE = /\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}\b/g;

function tidy(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EMAIL, '[email]')
    .replace(CODE, '[code]')
    .replace(LONG_DIGITS, '[nombre]')
    .replace(LONG_TOKEN, '[jeton]')
    .slice(0, max)
    .trim();
}

/** L'adresse sans parametres ni ancre, ou '' si ce n'est pas une adresse web. */
function bareUrl(value) {
  if (typeof value !== 'string') return '';
  let u;
  try { u = new URL(value); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  // Le chemin peut porter un code ou un jeton (/redeem/CODE, /orders/123456789) : chaque segment passe par le meme nettoyage.
  const chemin = u.pathname.split('/').map((s) => (s ? tidySegment(s) : s)).join('/');
  return `${u.origin}${chemin}`.slice(0, MAX_URL);
}

function tidySegment(segment) {
  let s = segment;
  try { s = decodeURIComponent(segment); } catch { /* un segment mal encode reste tel quel, puis nettoye */ }
  return s.replace(EMAIL, '[email]').replace(CODE, '[code]').replace(LONG_DIGITS, '[nombre]').replace(LONG_TOKEN, '[jeton]');
}

/** Ce que la page a montre, nettoye -- ou null quand il n'y a rien de lisible. */
export function cleanPage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const url = bareUrl(raw.url);
  if (!url) return null;
  return { url, title: tidy(raw.title, MAX_TITLE), text: tidy(raw.text, MAX_PAGE_TEXT) };
}

/** Le rapport a garder avec l'offre, ou null : un verdict sans echec efface le precedent. */
export function failureOf({ verdict, details, page } = {}, now) {
  if (!isFailureVerdict(verdict)) return null;
  return {
    at: now,
    verdict,
    details: typeof details === 'string' && details ? details.slice(0, MAX_DETAILS) : null,
    page: cleanPage(page),
  };
}

function iso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z') : '?';
}

/** Le texte a coller dans un message : tout ce qu'il faut pour comprendre, rien d'autre. */
export function buildReport(offer, { version, now } = {}) {
  const o = offer || {};
  const f = o.failure || null;
  const lines = [
    'Free Games Claimer -- rapport d\'echec',
    `version : ${version || '?'}`,
    `date : ${iso(now)}`,
    `jeu : ${o.title || '?'} (${o.store || '?'})`,
    `verdict : ${o.verdict || (f && f.verdict) || '?'}${Number.isFinite(o.attempts) && o.attempts > 0 ? ` (essai ${o.attempts})` : ''}`,
  ];
  const motif = (f && f.details) || o.details;
  if (motif) lines.push(`motif : ${motif}`);
  if (f && Number.isFinite(f.at)) lines.push(`constate : ${iso(f.at)}`);
  if (f && f.page) {
    lines.push(`page : ${f.page.url}`);
    if (f.page.title) lines.push(`titre de la page : ${f.page.title}`);
    lines.push(`texte de la page : ${f.page.text || '(vide)'}`);
  } else {
    lines.push('page : aucune page lue (l\'echec s\'est produit avant, ou hors d\'une page)');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------- le signalement (2.118.0) */

/** Le formulaire de nouveau ticket du depot public : il s'ouvre rempli, rien n'est envoye avant le clic de l'utilisateur. */
export const ISSUES_URL = 'https://github.com/diasLamka/free-games-claimer-extension/issues/new';

/* GitHub refuse un lien trop long (l'ordre de grandeur est de huit mille caracteres) : on se garde une marge, et c'est le TEXTE DE LA
   PAGE qui raccourcit en premier -- le jeu, le magasin, le verdict et l'adresse sont ce qui permet de comprendre. */
export const MAX_ISSUE_URL = 6000;
const MAX_ISSUE_TITLE = 120;

/** Le titre du ticket : le jeu et le magasin, deja nettoyes comme le reste du rapport. */
export function issueTitle(offer) {
  const o = offer || {};
  return tidy(`Echec de recuperation : ${o.title || '?'} (${o.store || '?'})`, MAX_ISSUE_TITLE);
}

/**
 * Le corps du ticket : une consigne de relecture, un espace pour dire ce qu'on a vu, et le rapport dans un bloc de code.
 * Le ticket est PUBLIC : la premiere ligne le dit, et c'est la premiere chose que l'utilisateur lit avant d'envoyer.
 */
export function issueBody(report) {
  return [
    'Relis ce texte avant de l\'envoyer : ce ticket sera public. Les codes, les adresses electroniques et les parametres d\'adresse sont deja retires du rapport.',
    '',
    'Ce que j\'ai observe :',
    '',
    '',
    'Rapport de l\'extension :',
    '',
    '```text',
    String(report).replace(/`{3,}/g, '\'\'\''),
    '```',
  ].join('\n');
}

function issueLink(title, body) {
  return `${ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * Le lien qui ouvre un ticket deja rempli avec le rapport de cet echec.
 *
 * Trop long, le lien perd d'abord le texte de la page (par moities), puis tout le bloc de la page : un lien qui ouvre un
 * formulaire a moitie rempli vaut mieux qu'un lien qui n'ouvre rien.
 */
export function issueUrl(offer, { version, now } = {}) {
  const title = issueTitle(offer);
  const f = offer && offer.failure;
  let text = f && f.page ? f.page.text || '' : '';
  for (let i = 0; i < 10; i++) {
    const copy = f && f.page ? { ...offer, failure: { ...f, page: { ...f.page, text } } } : offer;
    const url = issueLink(title, issueBody(buildReport(copy, { version, now })));
    if (url.length <= MAX_ISSUE_URL) return url;
    if (!text) break;
    text = text.length > 40 ? text.slice(0, Math.floor(text.length / 2)).trim() : '';
  }
  const bare = { ...(offer || {}), failure: f ? { ...f, page: null } : null };
  return issueLink(title, issueBody(buildReport(bare, { version, now }))).slice(0, MAX_ISSUE_URL);
}
