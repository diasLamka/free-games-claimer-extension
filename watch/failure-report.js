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

function tidy(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EMAIL, '[email]')
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
  return `${u.origin}${u.pathname}`.slice(0, MAX_URL);
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
