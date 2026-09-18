/* Le taux du jour, pour afficher en euros ce qui est publie en dollars.
 *
 * POURQUOI CE MODULE EXISTE, ET CE QU'IL NE PRETEND PAS ETRE.
 *
 * Le depot a longtemps refuse toute conversion, et le refus etait motive :
 * convertir demande un taux que personne ici ne peut verifier, et un montant
 * converti affiche comme exact est un mensonge. Les totaux sont donc tenus par
 * devise, jamais additionnes entre eux, et c'est toujours le cas.
 *
 * Ce qui a change : l'utilisateur, en France, a demande a lire des euros
 * partout. Epic lui en donne deja -- il publie le prix DU COMPTE. L'agregateur
 * n'a que des dollars : dans la capture reelle, vingt montants sur vingt sont
 * en « $ », et sa structure ne porte meme pas de code de devise.
 *
 * Trois regles tiennent l'honnetete de la chose :
 *
 *   1. la donnee STOCKEE ne bouge pas. On convertit a l'affichage, jamais dans
 *      le catalogue : le jour ou le taux change, rien n'est a reecrire, et la
 *      verite de la source reste lisible ;
 *   2. un montant converti se DIT approximatif, et porte la date de son taux ;
 *   3. sans taux, on affiche le montant d'origine avec sa devise. Une
 *      approximation sans taux serait un chiffre invente.
 *
 * La source est la Banque centrale europeenne, via api.frankfurter.app : pas
 * de cle, pas de compte, un taux de reference publie chaque jour ouvre. Les
 * taux sont donnes POUR UN EURO -- « USD: 1.08 » veut dire qu'un euro vaut
 * 1,08 dollar -- donc on DIVISE pour revenir a l'euro.
 *
 * Module pur : il ne lit ni l'horloge ni le reseau, les deux lui sont passes.
 */

export const KEY_RATES = 'veille:taux';

/** Une unite de la devise de base vaut combien de chaque autre devise. */
export function ratesUrl(base = 'EUR') {
  return `https://api.frankfurter.app/latest?from=${encodeURIComponent(base)}`;
}

/** L'adresse par defaut, quand aucun pays n'a ete choisi. */
export const RATES_URL = ratesUrl('EUR');

/** Au-dela, on redemande. La BCE ne publie qu'une fois par jour ouvre. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Au-dela, on cesse de convertir.
 *
 * Un taux de la semaine derniere reste un ordre de grandeur honnete pour une
 * valeur indicative ; un taux d'il y a six mois n'en est plus un. Passe ce
 * delai, le montant d'origine reprend sa place -- visiblement en dollars,
 * plutot qu'en euros faux.
 */
export const TRUST_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Valide une reponse de l'API avant de la garder.
 *
 * Une reponse illisible ne doit jamais ecraser un taux qui marchait : le repli
 * d'une conversion ratee est un montant en dollars, pas une page vide.
 */
export function parseRates(payload, now) {
  if (!payload || typeof payload !== 'object') return null;
  const table = payload.rates;
  if (!table || typeof table !== 'object') return null;

  const rates = {};
  for (const [currency, value] of Object.entries(table)) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) rates[currency] = n;
  }
  if (!Object.keys(rates).length) return null;

  return {
    // La devise de base que l'API dit avoir utilisee, pas celle qu'on croyait
    // demander : c'est elle qui decide ce que la table sait convertir.
    base: typeof payload.base === 'string' ? payload.base : 'EUR',
    // La date que la BCE donne a SON taux, pas l'instant du telechargement :
    // c'est elle qu'on montre a l'utilisateur.
    date: typeof payload.date === 'string' ? payload.date : null,
    rates,
    fetchedAt: now,
  };
}

/** Assez vieux pour redemander ? Absent compte comme vieux. */
export function shouldRefresh(stored, now, afterMs = REFRESH_AFTER_MS) {
  if (!stored || !Number.isFinite(stored.fetchedAt)) return true;
  return now - stored.fetchedAt >= afterMs;
}

/** Trop vieux pour convertir ? */
export function tooOld(stored, now, trustMs = TRUST_FOR_MS) {
  if (!stored || !Number.isFinite(stored.fetchedAt)) return true;
  return now - stored.fetchedAt >= trustMs;
}

/** La devise vers laquelle une table de taux sait convertir. */
export function baseOf(stored) {
  return (stored && typeof stored.base === 'string' && stored.base) || 'EUR';
}

/**
 * Convertit un montant vers la devise de BASE de la table -- celle du pays
 * choisi, l'euro par defaut. Rend null quand on ne SAIT pas : jamais une
 * approximation de secours, jamais un chiffre invente.
 */
export function toBase(amount, currency, stored, now) {
  if (!Number.isFinite(amount)) return null;
  if (!currency) return null;
  const base = baseOf(stored);
  if (currency === base) return amount;
  if (tooOld(stored, now)) return null;

  // La table dit combien d'unites de `currency` vaut UNE unite de base : on
  // divise donc pour revenir a la base.
  const perBase = stored && stored.rates ? Number(stored.rates[currency]) : NaN;
  if (!Number.isFinite(perBase) || perBase <= 0) return null;
  return amount / perBase;
}

/**
 * Rafraichit le taux si besoin. Rend toujours un etat exploitable : celui
 * qu'on avait quand la requete echoue.
 *
 * Une panne de taux ne doit jamais faire echouer un cycle de veille : le pire
 * qu'elle produit est un montant affiche dans sa devise d'origine.
 */
export async function refreshRates({ now, stored, fetch: fetchImpl, record = () => {}, base = 'EUR' }) {
  /* Un changement de pays change la devise de base : la table precedente ne
     sait plus convertir vers la bonne, meme fraiche. C'est le seul cas ou l'on
     redemande avant l'heure. */
  const staleBase = baseOf(stored) !== base;
  if (!staleBase && !shouldRefresh(stored, now)) return { rates: stored, changed: false };
  if (typeof fetchImpl !== 'function') return { rates: stored, changed: false };

  try {
    const response = await fetchImpl(ratesUrl(base), { headers: { Accept: 'application/json' } });
    if (!response || !response.ok) throw new Error(`HTTP ${response && response.status}`);
    const parsed = parseRates(await response.json(), now);
    if (!parsed) throw new Error('reponse de taux illisible');
    return { rates: parsed, changed: true };
  } catch (e) {
    record('warn', `taux de change indisponible : ${e && e.message}. Les montants restent dans leur devise.`);
    return { rates: stored, changed: false };
  }
}
