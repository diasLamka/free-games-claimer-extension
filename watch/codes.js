/* Le coffre a cles : ou va chaque code, et ou il en est.
 *
 * L'onglet Codes savait deja lister, copier, dedoublonner, dater et retirer une
 * cle. Trois choses lui manquaient, et les trois ont la meme cause : la
 * destination d'un code se decidait par un ternaire binaire -- GOG d'un cote,
 * l'URL Microsoft pour TOUT le reste -- ecrit en double, dans le moteur et
 * dans le popup.
 *
 * Ce module porte la table, et rien qu'elle. Sa jumelle ES5 vit dans
 * `src/core/01-config.js`, parce que le moteur tourne aussi en userscript,
 * sans modules. La duplication ne peut pas disparaitre ; `test/codes.test.mjs`
 * verifie qu'elle ne derive pas, comme `test/locale.test.mjs` le fait deja
 * pour le pays de la boutique.
 *
 * Module PUR.
 */

/**
 * Ou echanger un code, par magasin.
 *
 * DEUX ENTREES SEULEMENT, et c'est un choix, pas un oubli. Ce sont les deux
 * seules adresses que ce depot ait jamais utilisees, donc les deux seules dont
 * il puisse repondre. Les sept autres magasins que Luna sait distribuer
 * attendent une mesure -- ouvrir la page, constater qu'elle demande bien un
 * code -- et `null` veut dire exactement cela.
 *
 * L'effet de `null` est celui d'aujourd'hui : le message dit « collez-le sur
 * le site de X » sans promettre une adresse. Inventer une URL plausible
 * couterait un onglet ouvert sur une page d'erreur, et surtout la confiance
 * dans toutes les autres.
 */
export const REDEEM_URLS = Object.freeze({
  gog: 'https://www.gog.com/redeem',
  microsoft: 'https://account.microsoft.com/billing/redeem',
  epic: null,
  amazon: null,
  ubisoft: null,
  ea: null,
  blizzard: null,
  legacy: null,
  unknown: null,
});

/** L'adresse d'echange d'un magasin, ou null quand on ne la connait pas. */
export function redeemUrlFor(store) {
  return REDEEM_URLS[store] || null;
}

/**
 * Les magasins dont l'extension sait ECHANGER le code toute seule.
 *
 * GOG seulement. Le moteur a un parcours mesure pour lui -- libelles
 * autorises, detection de page payante, captcha rendu a l'humain,
 * classification des reponses -- et rien de tout cela n'existe ailleurs.
 *
 * Un second parcours ne s'ecrit pas avant d'avoir mesure la page visee : c'est
 * la regle du projet, et c'est aussi la seule qui protege un vrai compte.
 */
export const AUTO_REDEEM_STORES = Object.freeze(['gog']);

/** Ce magasin peut-il etre echange sans intervention ? */
export function canAutoRedeem(store) {
  return AUTO_REDEEM_STORES.includes(store);
}

/* ------------------------------------------------------------- les etats */

/**
 * Ou en est un code.
 *
 * Un code ne portait que `attempts`, `lastTry` et `lastError` : de quoi savoir
 * qu'on a essaye, jamais ce qui s'est passe. « Echange » et « invalide » se
 * ressemblaient donc, alors que l'un veut dire « c'est fait » et l'autre
 * « celui-la ne servira plus jamais ».
 */
export const CODE_STATUS = Object.freeze({
  /** En attente : rien n'a encore abouti. */
  PENDING: 'pending',
  /** Echange avec succes. Le jeu est au compte. */
  REDEEMED: 'redeemed',
  /** Le magasin l'a refuse definitivement. */
  INVALID: 'invalid',
  /** Sa date limite est passee. */
  EXPIRED: 'expired',
});

const ETATS = new Set(Object.values(CODE_STATUS));

/** L'etat d'un code, avec un defaut plutot qu'un trou. */
export function codeStatus(entry) {
  const s = entry && entry.status;
  return ETATS.has(s) ? s : CODE_STATUS.PENDING;
}

/* ------------------------------------------------------------ la saisie */

/**
 * Le motif d'un code d'echange.
 *
 * Copie a l'IDENTIQUE de `REDEEM_CODE_PATTERN` (src/core/19-luna-parse.js), et
 * verifiee telle par le test de parite. Deux formes : des groupes separes par
 * des tirets, ou un long bloc alphanumerique portant au moins un chiffre --
 * cette derniere condition existe pour ne pas prendre un mot en capitales pour
 * un code.
 */
export const CODE_PATTERN = /\b[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,5}\b|\b(?=[A-Z]*[0-9])[A-Z0-9]{12,30}\b/;

/**
 * Extrait les codes d'un texte colle.
 *
 * Une liste collee depuis un courriel ou un bon de commande porte des titres,
 * des puces et des lignes vides. On ne demande pas a l'utilisateur de nettoyer
 * ce qu'une expression reguliere sait ignorer.
 *
 * Les codes sont mis en CAPITALES : le motif ne reconnait qu'elles, et un code
 * colle en minuscules serait sinon refuse sans explication.
 */
export function parseCodes(text) {
  const global = new RegExp(CODE_PATTERN.source, 'g');
  const vus = new Set();

  for (const ligne of String(text || '').split(/[\s,;]+/)) {
    const maj = ligne.toUpperCase();
    let m;
    global.lastIndex = 0;
    while ((m = global.exec(maj)) !== null) vus.add(m[0]);
  }
  return [...vus];
}

/**
 * Ajoute des codes a la liste en attente, sans doublon.
 *
 * Le dedoublonnage porte sur le CODE et non sur le titre : le meme jeu peut
 * donner deux cles, et deux cles differentes valent deux jeux.
 */
export function addCodes(list, entries) {
  const existants = new Set((list || []).map((c) => c && c.code));
  const ajouts = (entries || []).filter((e) => e && e.code && !existants.has(e.code));
  return [...(list || []), ...ajouts];
}

/** Change l'etat d'un code. Un etat inconnu laisse la liste intacte. */
export function setCodeStatus(list, code, status, now) {
  if (!ETATS.has(status)) return list || [];
  return (list || []).map((c) => (
    c && c.code === code ? { ...c, status, statusAt: now } : c
  ));
}

/* ----------------------------------------------------- la date limite */

/** Les mois, sans accents, dans les deux langues des pages que le moteur lit. */
const MONTHS = Object.freeze({
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  fr: ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
});

const COMBINING = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Le mois d'un mot, ou -1.
 *
 * Le nom entier d'abord, puis une abreviation -- a condition qu'elle ne
 * designe qu'UN mois. Jusqu'a la 2.45.0, le popup comparait les trois
 * premieres lettres et prenait le premier mois qui commencait ainsi : « jui »
 * designait juin, et un code valable jusqu'au 15 juillet s'affichait expire
 * depuis un mois. Une abreviation ambigue rend -1 : mieux vaut ne pas dater
 * un code que le dater faux.
 */
function monthOf(word) {
  for (const names of Object.values(MONTHS)) {
    const exact = names.indexOf(word);
    if (exact >= 0) return exact;
  }
  if (word.length < 3) return -1;
  for (const names of Object.values(MONTHS)) {
    const hits = names.filter((n) => n.startsWith(word));
    if (hits.length === 1) return names.indexOf(hits[0]);
  }
  return -1;
}

/**
 * Le jour d'une date limite ecrite en toutes lettres, tel que la page
 * d'echange le recopie : « 31 decembre 2026 », « 1er aout 2026 »,
 * « 3rd June 2026 ». Rend { year, month, day }, le mois de 0 a 11, ou null.
 *
 * Un JOUR, pas un instant : la page ne dit ni l'heure ni le fuseau, et en
 * inventer un serait affirmer ce qu'on ne sait pas.
 */
export function deadlineDay(deadline) {
  if (!deadline) return null;
  const m = String(deadline).match(/(\d{1,2})(?:er|st|nd|rd|th)?\s+([a-zÀ-ſ.]+)\s+(\d{4})/i);
  if (!m) return null;
  const word = m[2].toLowerCase().replace(/\./g, '').normalize('NFD').replace(COMBINING, '');
  const month = monthOf(word);
  if (month < 0) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return { year: Number(m[3]), month, day };
}
