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

export const DEFAULT_FILTERS = Object.freeze({
  /** Seuil en unites de la source (dollars). 0 = aucun seuil. */
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
export function judge(offer, filters = {}, { supportedStores = [] } = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters };
  const deny = (reason) => ({ claimable: false, reason });

  if (!offer) return deny(REASONS.NO_DESTINATION);
  if (!offer.url && !offer.resolveUrl) return deny(REASONS.NO_DESTINATION);

  if (!offer.store || offer.store === STORES.UNKNOWN) return deny(REASONS.STORE_UNKNOWN);
  if (!supportedStores.includes(offer.store)) return deny(REASONS.STORE_UNSUPPORTED);
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
