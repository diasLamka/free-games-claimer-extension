/* Ce que la veille a le droit de reclamer toute seule.
 *
 * Ce module existe avant l'autonomie, pas apres. Sur la capture reelle du
 * 2026-08-27, treize offres sur vingt viennent de petites boutiques, et la
 * requete ?type=loot en rend quatre-vingt-deux de plus. Sans garde-fou, la
 * premiere nuit autonome reclame vingt petits jeux, chacun coutant un onglet et
 * une requete sur un vrai compte.
 *
 * Deux principes :
 *
 *   - Un ecart n'est jamais silencieux. `evaluer` rend toujours un motif, et
 *     l'interface le montre. Une offre ecartee sans qu'on sache pourquoi est
 *     une offre perdue.
 *   - Les valeurs par defaut ne suppriment rien. Le seuil de valeur est a zero
 *     au depart : c'est a l'utilisateur de decider de sacrifier des offres, pas
 *     au code de le faire dans son dos.
 *
 * Module pur : aucune API d'extension, aucune horloge.
 */
import { STORES, normaliseTitle } from './offer.js';
import { ownedKeyFor } from './library.js';
import { offerStoreKeys } from './collection.js';

export const DEFAULT_FILTERS = Object.freeze({
  /**
   * Seuil, dans la devise de l'offre et sans conversion. 0 = aucun seuil.
   *
   * Ce champ a longtemps ete documente « en dollars », et c'etait faux :
   * Epic publie le prix DU COMPTE, donc en euros sur un compte francais.
   * Comparer 15 a « 23,99 EUR » n'est pas exact, mais c'est le seul
   * rapprochement honnete disponible -- convertir demanderait un taux que
   * personne ici ne peut verifier. L'interface affiche le seuil dans la
   * devise dominante des offres en cours, pour que l'ordre de grandeur
   * soit au moins juste.
   */
  minWorth: 0,
  /** Reclamer une offre dont la source ne publie pas la valeur. */
  claimWithoutWorth: true,
  /**
   * N'ouvrir que ce qu'il y a vraiment quelque chose a garder.
   *
   * Actif par defaut, et c'est le seul defaut de ce module qui supprime des
   * offres. Il se justifie parce qu'il ne supprime rien qu'on puisse gagner :
   * un titre gratuit en permanence n'a rien a reclamer, et l'ouvrir coute un
   * onglet et une requete sur un vrai compte.
   */
  claimOnlyKeepable: true,
  /** Reclamer le contenu additionnel : DLC, butin, cosmetiques. */
  claimExtraContent: false,
  /** Magasins autorises. null = tous ceux qu'on sait reclamer. */
  allowedStores: null,
  /** Titres a ne jamais reclamer. Comparaison sur le titre normalise. */
  excludedTitles: [],
});

export const REASONS = Object.freeze({
  STORE_UNKNOWN: 'magasin non identifie',
  STORE_UNSUPPORTED: 'aucun module de reclamation pour ce magasin',
  STORE_DISABLED: 'magasin desactive dans les reglages',
  BELOW_THRESHOLD: 'valeur inferieure au seuil',
  NO_WORTH: 'valeur inconnue',
  NOTHING_TO_KEEP: 'gratuit en permanence, rien a garder',
  ALREADY_OWNED: 'deja dans la bibliotheque',
  EXTRA_CONTENT: 'contenu additionnel',
  TITLE_EXCLUDED: 'titre exclu',
  NO_DESTINATION: 'aucune page a ouvrir',
});

/* ------------------------------------------------------------------ valeur */

/**
 * Lit la valeur annoncee par la source. Rend un nombre, ou null.
 *
 * Les valeurs observees sont toutes de la forme "$14.99", mais rien ne garantit
 * la devise ni le separateur decimal : on accepte les deux, et on refuse ce
 * qu'on ne sait pas lire plutot que de rendre zero -- zero voudrait dire
 * "gratuit a l'origine", ce qui est faux et ferait passer le seuil.
 */
export function readWorth(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (!raw) return null;

  const text = String(raw).trim();
  if (!text || /^n\/?a$/i.test(text)) return null;

  // "$1,299.99" -> 1299.99 ; "9,99 €" -> 9.99
  const digits = text.replace(/[^\d.,]/g, '');
  if (!digits) return null;

  const lastPoint = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  const separator = lastPoint > lastComma ? '.' : ',';

  const normalised = digits
    .split(separator)
    .map((p, i, tab) => (i === tab.length - 1 && tab.length > 1 ? p : p.replace(/[.,]/g, '')))
    .join('.');

  const n = Number.parseFloat(normalised);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ devise */

/**
 * Marques de devise, de la plus specifique a la plus generale.
 *
 * L'ordre est significatif : « R$ » et « CA$ » se terminent par « $ », donc le
 * dollar nu vient en dernier, sinon un prix bresilien serait lu en dollars.
 *
 * La liste couvre ce que l'extension peut reellement rencontrer -- les regions
 * Luna declarees dans le manifeste, plus Epic, GOG et Steam. Une devise absente
 * de cette liste rend null, et un total sans symbole vaut mieux qu'un total
 * portant le mauvais.
 */
const CURRENCY_MARKS = Object.freeze([
  ['R$', 'BRL'],
  ['CA$', 'CAD'],
  ['C$', 'CAD'],
  ['AU$', 'AUD'],
  ['A$', 'AUD'],
  ['NZ$', 'NZD'],
  ['MX$', 'MXN'],
  ['US$', 'USD'],
  ['\u20AC', 'EUR'],
  ['\u00A3', 'GBP'],
  ['\u00A5', 'JPY'],
  ['\u20B9', 'INR'],
  ['\u20BA', 'TRY'],
  ['$', 'USD'],
]);

/** Marques faites de lettres : elles demandent une frontiere, pas une sous-chaine. */
const CURRENCY_WORDS = Object.freeze([
  [/(^|[^a-z])z\u0142([^a-z]|$)/i, 'PLN'],
  [/(^|[^a-z])kr([^a-z]|$)/i, 'SEK'],
]);

/** Codes ISO reconnus quand la source les ecrit en toutes lettres. */
const CURRENCY_CODES = /(^|[^A-Z])(EUR|USD|GBP|JPY|CAD|AUD|NZD|INR|TRY|BRL|MXN|PLN|SEK|CHF|DKK|NOK)([^A-Z]|$)/;

/** Ce qu'on affiche quand le montant existe mais que sa devise est illisible. */
export const UNKNOWN_CURRENCY = '?';

/**
 * La devise d'un montant, lue dans le montant lui-meme. Rend un code ISO, ou null.
 *
 * Les sources ne s'accordent pas, et c'est la le piege : gamerpower publie des
 * dollars et le dit (« $14.99 »), tandis qu'Epic publie le prix DU COMPTE --
 * « 23,99 EUR » sur un compte francais, avec son currencyCode a cote. Un $ pose
 * devant les deux est faux une fois sur deux, et faux dans le sens qui compte :
 * il fait lire vingt-quatre dollars la ou il y a vingt-quatre euros.
 *
 * Rendre null plutot que deviner. Un total sans symbole se corrige d'un coup
 * d'oeil ; un total dans la mauvaise devise se croit.
 */
export function readCurrency(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return null;

  const text = String(raw).trim();
  if (!text || /^n\/?a$/i.test(text)) return null;

  const code = text.toUpperCase().match(CURRENCY_CODES);
  if (code) return code[2];

  for (const [motif, devise] of CURRENCY_WORDS) {
    if (motif.test(text)) return devise;
  }
  for (const [marque, devise] of CURRENCY_MARKS) {
    if (text.includes(marque)) return devise;
  }
  return null;
}

/**
 * La devise la plus representee dans un lot d'offres, ou null.
 *
 * Sert a afficher le seuil de valeur : un curseur qui affiche « 15,00 EUR »
 * devant un catalogue en euros dit la verite, la ou un $ fixe ment. A egalite,
 * la premiere rencontree gagne -- il n'y a rien de mieux a faire, et le cas ne
 * se produit que sur deux offres.
 */
export function dominantCurrency(offers = []) {
  const comptes = new Map();
  for (const o of offers) {
    const devise = readCurrency(o && o.worth);
    if (!devise) continue;
    comptes.set(devise, (comptes.get(devise) || 0) + 1);
  }
  let gagnante = null;
  let meilleur = 0;
  for (const [devise, n] of comptes) {
    if (n > meilleur) { gagnante = devise; meilleur = n; }
  }
  return gagnante;
}

/* -------------------------------------------------------------- categorie */

const EXTRA_CONTENT_WORDS = /\b(dlc|loot|butin|skin|pack|bundle|cosmetic|currency|booster|in-?game)\b/i;

/**
 * Une offre est-elle du contenu additionnel plutot qu'un jeu ?
 *
 * L'agregateur le dit franchement dans son champ `type` : "Game" pour les jeux,
 * "DLC" pour tout ce que rend ?type=loot. Le titre sert de repli quand la
 * source ne categorise pas.
 */
export function isExtraContent(offer) {
  if (!offer) return false;
  const category = String(offer.category || '');
  if (/^game$/i.test(category)) return false;
  if (category && !/^game$/i.test(category)) return true;
  return EXTRA_CONTENT_WORDS.test(offer.title || '');
}

/* ------------------------------------------------------------- a garder ? */

/**
 * Y a-t-il quelque chose a GARDER dans cette offre ?
 *
 * Rend true / false / null, et les trois comptent :
 *
 *   - la source l'a dit (champ `keepable`), et elle a le dernier mot. L'API
 *     Epic distingue un prix d'origine a 23,99 EUR remis a zero -- le jeu de la
 *     semaine -- d'un prix d'origine a zero, qui est gratuit de toute facon ;
 *   - sinon, une valeur annoncee superieure a zero dit que le titre etait
 *     payant. L'agregateur ecrit "$39.99" pour un jeu offert et "N/A" pour un
 *     acces beta ou un objet de jeu ;
 *   - sinon on ne sait pas, et on le dit.
 */
export function isKeepable(offer) {
  if (!offer) return null;
  if (offer.keepable === true || offer.keepable === false) return offer.keepable;

  const worth = readWorth(offer.worth);
  if (worth === null) return null;
  return worth > 0;
}

/* -------------------------------------------------------------- evaluation */

/**
 * Une offre est-elle reclamable automatiquement, et sinon pourquoi ?
 *
 * `magasinsPrisEnCharge` est un fait du code -- la liste des magasins pour
 * lesquels un module de reclamation existe -- et non un reglage. Une offre
 * ailleurs reste au catalogue et reste notifiee : elle n'est simplement pas
 * reclamee toute seule.
 */
export function judge(offer, filters = {}, { supportedStores = [], owned = null, ownedIds = null } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const deny = (reason) => ({ claimable: false, reason });

  if (!offer) return deny(REASONS.NO_DESTINATION);
  if (!offer.url && !offer.resolveUrl) return deny(REASONS.NO_DESTINATION);

  if (!offer.store || offer.store === STORES.UNKNOWN) return deny(REASONS.STORE_UNKNOWN);
  if (!supportedStores.includes(offer.store)) return deny(REASONS.STORE_UNSUPPORTED);
  /* Steam, en option, ne sait recuperer qu'une licence gratuite identifiee par
     son PAQUET -- et seule la source Steam le donne. Une entree Steam sans
     paquet (une cle offerte sur un site tiers, vue par l'agregateur) n'a rien
     que le module sache prendre : la tenter echouait, et occupait pour vingt
     minutes le creneau Steam des vraies offres, a chaque nouvel essai. */
  if (offer.store === STORES.STEAM && !offer.packageId) return deny(REASONS.STORE_UNSUPPORTED);
  if (f.allowedStores && !f.allowedStores.includes(offer.store)) {
    return deny(REASONS.STORE_DISABLED);
  }

  /* Rien a garder : on n'ouvre pas.
   *
   * Place AVANT les filtres de valeur, parce que c'est un fait sur l'offre et
   * non une preference : un titre gratuit en permanence n'a rien a reclamer,
   * quel que soit le seuil. `null` -- la source ne dit pas -- laisse passer :
   * traiter l'ignorance comme un refus ferait rater de vrais jeux offerts. */
  if (f.claimOnlyKeepable && isKeepable(offer) === false) {
    return deny(REASONS.NOTHING_TO_KEEP);
  }

  if (!f.claimExtraContent && isExtraContent(offer)) {
    return deny(REASONS.EXTRA_CONTENT);
  }

  const title = offer.normalisedTitle || normaliseTitle(offer.title);

  /* Deja dans la bibliotheque : on n'ouvre pas.
   *
   * Le registre sait ce que l'extension a reclame, et jusqu'ici personne ne le
   * lui demandait avant d'agir. Une offre qui revient sous une autre cle --
   * une autre source, un giveaway rejoue -- faisait rouvrir un onglet et
   * consommait un jeton du plafond horaire, c'est-a-dire precisement la
   * ressource qui protege le compte, pour un jeu qu'on possede.
   *
   * Sans registre (`owned` a null), rien ne change : ne pas savoir n'est pas
   * une raison de refuser. */
  if (owned && owned.has(ownedKeyFor(offer.store, title))) {
    return deny(REASONS.ALREADY_OWNED);
  }
  /* Ce que le MAGASIN dit que vous possedez, importe dans Ma collection.
   *
   * Par identifiant exact seulement : un faux « deja possede » ferait rater un
   * jeu offert, ce qui coute plus cher qu'un onglet de trop. Une offre dont la
   * source ne donne pas l'identifiant du magasin n'est jamais ecartee ici. */
  if (ownedIds && offerStoreKeys(offer).some((k) => ownedIds.has(k))) {
    return deny(REASONS.ALREADY_OWNED);
  }
  for (const excludedTitle of f.excludedTitles || []) {
    const reason = normaliseTitle(excludedTitle);
    if (reason && title.includes(reason)) return deny(REASONS.TITLE_EXCLUDED);
  }

  const worth = readWorth(offer.worth);
  if (worth === null) {
    if (!f.claimWithoutWorth) return deny(REASONS.NO_WORTH);
  } else if (f.minWorth > 0 && worth < f.minWorth) {
    return deny(REASONS.BELOW_THRESHOLD);
  }

  return { claimable: true, reason: null };
}

/** Separe une liste en reclamables et ecartees, chaque ecart portant son motif. */
export function split(offers, filters, options) {
  const claimableCount = [];
  const dropped = [];
  for (const offer of offers || []) {
    const { claimable, reason } = judge(offer, filters, options);
    if (claimable) claimableCount.push(offer);
    else dropped.push({ offer, reason });
  }
  return { claimableCount, dropped };
}

/**
 * Ce que les reglages actuels donneraient, sans rien reclamer.
 *
 * Sert a l'interface : montrer « 3 reclamables, 12 ecartees » AVANT de bouger
 * un curseur vaut mieux que de laisser l'utilisateur decouvrir apres coup ce
 * qu'il a supprime.
 */
export function preview(offers, filters, options) {
  const { claimableCount, dropped } = split(offers, filters, options);
  const byReason = {};
  for (const e of dropped) byReason[e.reason] = (byReason[e.reason] || 0) + 1;
  return { claimableCount: claimableCount.length, dropped: dropped.length, byReason };
}
