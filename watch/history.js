/* L'historique : la colonne d'a cote du tableau de chasse.
 *
 * Le bilan (`watch/tally.js`) compte ce qui a ete PRIS. Les issues figees
 * depuis la 2.27.0 savent aussi ce qui a ete RATE, avec le titre et la valeur
 * que la purge du catalogue emportait a quatre-vingt-dix jours.
 *
 * Un taux de capture qui s'effondre est soit un reglage trop strict, soit une
 * panne -- et les deux se corrigent, a condition de les voir.
 *
 * Module PUR : lire, filtrer, compter. Les comptes sont exactement ce qu'on ne
 * peut pas verifier a l'oeil sur une page, donc ils se testent ici.
 */
import { OUTCOMES, outcomeEntries } from './outcomes.js';
import { readWorth } from './filters.js';

/** Les issues, de la plus recente a la plus ancienne. */
export function historyRows(outcomes) {
  return outcomeEntries(outcomes);
}

/**
 * Filtre sur ce que la page propose, et rien d'autre.
 *
 * Un critere absent ou vide ne filtre PAS. C'est ce qui permet de composer les
 * trois sans ecrire huit branches, et d'ouvrir la page sur tout.
 */
export function filterHistory(rows, { outcome = '', store = '', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();

  return (rows || []).filter((r) => {
    if (outcome && r.outcome !== outcome) return false;
    if (store && r.store !== store) return false;
    if (q && !String(r.title || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Ce que la periode affichee raconte.
 *
 * DEUX DECISIONS y sont prises, et les deux portent sur l'honnetete du
 * chiffre.
 *
 * Les issues INCONNUES sortent du ratio. Une reclamation arretee par un defi
 * de securite ne dit pas si le jeu est au compte : la compter comme ratee
 * accuserait l'extension a tort, la compter comme prise la flatterait. Leur
 * nombre reste affiche a cote, pour qu'on sache ce qu'on ne sait pas.
 *
 * Un historique vide rend un taux NUL, pas zero. Zero pour cent sur rien du
 * tout ferait croire a une panne le premier jour.
 */
export function summariseHistory(rows) {
  const liste = rows || [];
  let taken = 0;
  let missed = 0;
  let unknown = 0;
  let worthTaken = 0;
  let worthMissed = 0;

  for (const r of liste) {
    /* readWorth lit les deux separateurs decimaux et rend null sur ce qu'il ne
       comprend pas. Additionner sans ce garde ferait un NaN, qui contamine
       toute la somme et rend la page entiere illisible. */
    const valeur = readWorth(r.worth);
    const montant = typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0;

    if (r.outcome === OUTCOMES.TAKEN) { taken++; worthTaken += montant; continue; }
    if (r.outcome === OUTCOMES.MISSED) { missed++; worthMissed += montant; continue; }
    unknown++;
  }

  const juges = taken + missed;
  return {
    total: liste.length,
    taken,
    missed,
    unknown,
    rate: juges ? Math.round((taken / juges) * 100) : null,
    worthTaken,
    worthMissed,
  };
}

/**
 * Le decoupage par mois, du plus recent au plus ancien.
 *
 * Les cles sont en UTC et au format « AAAA-MM », donc elles se trient comme du
 * texte. C'est volontaire : un tri sur des dates reconstruites depuis un
 * libelle localise se casse la premiere fois qu'on change de langue.
 */
export function byMonth(rows) {
  const table = new Map();

  for (const r of rows || []) {
    if (!Number.isFinite(r.ts)) continue;
    const d = new Date(r.ts);
    const mois = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    const vu = table.get(mois) || { month: mois, taken: 0, missed: 0, unknown: 0 };
    if (r.outcome === OUTCOMES.TAKEN) vu.taken++;
    else if (r.outcome === OUTCOMES.MISSED) vu.missed++;
    else vu.unknown++;
    table.set(mois, vu);
  }

  return [...table.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
}
