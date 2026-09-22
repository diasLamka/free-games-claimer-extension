/* L'affichage des montants, partage par le popup et l'Historique.
 *
 * Il vivait dans popup.js seul : l'Historique montrait donc le montant brut de
 * la source -- « $14.99 » a cote de « 23,99 € » -- et son total de valeur ratee
 * additionnait dollars et euros comme un seul nombre.
 *
 * Les regles sont celles de watch/rates.js : un montant deja dans la devise
 * visee n'est jamais touche, un montant converti porte « ≈ » et son origine en
 * infobulle, et sans taux utilisable le montant d'origine reste INTACT.
 */
import { t, intlLocale } from './i18n.js';
import { readWorth, readCurrency, UNKNOWN_CURRENCY } from './watch/filters.js';
import { toBase, baseOf } from './watch/rates.js';

/* Le symbole n'est jamais choisi par l'interface : il vient de la donnee.
   Cette fonction ne fait que la MISE EN FORME. */
export function money(n, currency) {
  const loc = intlLocale();
  if (!currency || currency === UNKNOWN_CURRENCY) {
    return new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(n);
  } catch {
    // An ISO code Intl does not know still beats losing the amount.
    return `${new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;
  }
}

/**
 * Un montant de la source, rendu dans la devise de la table de taux.
 *
 * La devise VISEE est celle de la table, pas celle du reglage : une table
 * encore dans l'ancienne base ne sait pas convertir vers la nouvelle, et
 * afficher une devise qu'on n'a pas su calculer serait un chiffre invente.
 */
export function worthLabel(raw, rates, now) {
  const original = String(raw);
  const currency = readCurrency(raw);
  const target = baseOf(rates);
  if (!currency || currency === target) return { text: original, approx: false, title: '' };

  const converted = toBase(readWorth(raw), currency, rates, now);
  if (converted === null) return { text: original, approx: false, title: '' };

  return {
    text: `≈ ${money(converted, target)}`,
    approx: true,
    title: t('approxFrom', original, (rates && rates.date) || '?'),
  };
}

/**
 * La somme de montants bruts, ramenee a la devise visee.
 *
 * Ce qui n'a pas pu etre converti garde sa devise, a cote, plutot que de
 * disparaitre ou d'etre additionne a tort.
 */
export function sumWorths(raws, rates, now) {
  const target = baseOf(rates);
  let sum = 0;
  let converted = false;
  const untouched = new Map();

  for (const raw of raws) {
    const n = readWorth(raw);
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const currency = readCurrency(raw);
    if (!currency || currency === target) { sum += n; continue; }
    const inBase = toBase(n, currency, rates, now);
    if (inBase === null) { untouched.set(currency, (untouched.get(currency) || 0) + n); continue; }
    sum += inBase;
    converted = true;
  }

  const head = (converted ? '≈ ' : '') + money(sum, target);
  const rest = [];
  for (const [currency, n] of untouched) rest.push(money(n, currency));
  return [head, ...rest].join(' + ');
}
