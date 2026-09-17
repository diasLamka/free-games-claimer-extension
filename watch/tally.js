/* Ce qui a ete recupere, et comment le sortir de l'extension.
 *
 * Deux besoins qui n'ont rien a voir, mais qui lisent les memes donnees :
 *
 *   - un bilan lisible : combien de jeux, pour quelle valeur, ou. C'est la
 *     seule chose qui rende visible ce que l'extension a fait pendant qu'on ne
 *     regardait pas.
 *   - un export : l'historique et surtout LES CODES EN ATTENTE. Un code GOG
 *     perdu est un jeu perdu, et rien ne les sauvegarde aujourd'hui -- ni git,
 *     ni synchronisation. Une desinstallation les emporte.
 *
 * Le bilan est honnete sur ce qu'il ignore : beaucoup de recuperations sont
 * anterieures a la veille, ou viennent de magasins dont on n'a jamais connu la
 * valeur. Il compte donc separement ce qu'il a pu valoriser.
 *
 * Module pur.
 */
import { readWorth, readCurrency, UNKNOWN_CURRENCY } from './filters.js';
import { STORE_LABELS, STORES } from './offer.js';

/** Statuts qui signifient « le jeu est a moi ». */
export const ACQUIRED_STATUSES = Object.freeze(['claimed', 'redeemed']);

/** Cles d'historique du moteur, par nom de plateforme. */
export const PLATFORMS = Object.freeze({
  'Epic Games': STORES.EPIC,
  GOG: STORES.GOG,
  'Amazon Luna': STORES.AMAZON,
});

/**
 * Rapproche une entree d'historique du catalogue de la veille, pour lui rendre
 * son titre et sa valeur.
 *
 * L'historique est indexe par slug (`slug:cardpocalypse`), le catalogue par
 * magasin et identifiant (`epic:cardpocalypse`) : le rapprochement est direct
 * quand la veille connaissait l'offre, et impossible sinon. Impossible n'est
 * pas grave -- on garde l'entree, sans valeur.
 */
export function matchHistory(key, store, catalog) {
  const nu = String(key).replace(/^(slug|offer|code):/, '');
  return (catalog && (catalog[`${store}:${nu}`] || catalog[`epic:${nu}`])) || null;
}

/**
 * Toutes les recuperations, la plus recente d'abord.
 *
 * `historiques` : { 'Epic Games': {...}, GOG: {...}, 'Amazon Luna': {...} }
 */
export function claimsMade(histories = {}, catalog = {}, { since = 0, library = {} } = {}) {
  const out = [];

  for (const [plateforme, store] of Object.entries(PLATFORMS)) {
    const histo = histories[plateforme] || {};
    for (const [key, e] of Object.entries(histo)) {
      if (!e || !e.ts || e.ts < since) continue;
      if (!ACQUIRED_STATUSES.includes(e.status)) continue;

      /* Deux sources, et l'ordre compte.
       *
       * Le catalogue est frais mais purge -- trente jours, puis quatre-vingt-dix.
       * Le registre (watch/library.js) fige titre et valeur A L'INSTANT de la
       * reclamation et ne disparait jamais. Il a ete ecrit exactement pour ce
       * cas, et le bilan ne l'avait jamais lu : passe la purge, les vieilles
       * reclamations perdaient leur titre et leur prix, c'est-a-dire au moment
       * ou l'une et l'autre servent le plus.
       *
       * Champ par champ, et non objet par objet : un catalogue qui connait le
       * titre mais pas le prix ne doit pas masquer le prix que le registre a
       * garde. */
      const known = matchHistory(key, store, catalog);
      const frozen = matchHistory(key, store, library);
      const worth = (known && known.worth) || (frozen && frozen.worth) || null;

      out.push({
        key,
        store,
        title: (known && known.title) || (frozen && frozen.title) || null,
        worth: readWorth(worth),
        currency: readCurrency(worth),
        ts: e.ts,
        status: e.status,
      });
    }
  }

  return out.sort((a, b) => b.ts - a.ts);
}

/** Arrondi comptable, applique une fois a la fin plutot qu'a chaque addition. */
function roundTotals(totals) {
  const out = {};
  for (const [devise, montant] of Object.entries(totals)) {
    out[devise] = Math.round(montant * 100) / 100;
  }
  return out;
}

/**
 * Le bilan.
 *
 * `priced` compte les recuperations dont on connaissait la valeur : sans ce
 * chiffre, « 48 EUR pour 20 jeux » laisserait croire que les 20 ont ete
 * comptes, alors que la moitie sont anterieures a la veille.
 *
 * Les totaux sont rendus PAR DEVISE, et ne sont jamais additionnes entre eux.
 * Ce n'est pas du purisme : gamerpower publie des dollars, Epic publie la
 * devise du compte, et faire la somme des deux produirait un nombre qui ne
 * designe rien. Les convertir demanderait un taux que personne ici ne peut
 * verifier -- l'ancien code n'essayait meme pas, il collait un $ sur le tout.
 */
export function tally(rows = []) {
  let priced = 0;
  const totals = {};
  const byStore = {};
  const byMonth = {};

  for (const l of rows) {
    // Une valeur lisible dont la devise ne l'est pas reste une valeur : elle
    // compte, sous une devise qui s'affiche sans symbole.
    const devise = typeof l.worth === 'number' ? (l.currency || UNKNOWN_CURRENCY) : null;
    if (devise) {
      totals[devise] = (totals[devise] || 0) + l.worth;
      priced++;
    }

    const m = byStore[l.store] || { count: 0, totals: {} };
    m.count++;
    if (devise) m.totals[devise] = (m.totals[devise] || 0) + l.worth;
    byStore[l.store] = m;

    const month = new Date(l.ts).toISOString().slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  for (const stats of Object.values(byStore)) stats.totals = roundTotals(stats.totals);

  return {
    count: rows.length,
    priced,
    totals: roundTotals(totals),
    byStore,
    byMonth,
  };
}

/** Le magasin qui a le plus rapporte, pour une phrase d'une ligne. */
export function mainStore(summary) {
  const entryPairs = Object.entries(summary.byStore || {});
  if (!entryPairs.length) return null;
  const [store, stats] = entryPairs.sort((a, b) => b[1].count - a[1].count)[0];
  return { store, libelle: STORE_LABELS[store] || store, ...stats };
}

/* --------------------------------------------------------------- export */

export const EXPORT_FORMAT = 1;

/**
 * Tout ce qui merite de survivre a une desinstallation.
 *
 * Les codes en attente viennent en premier et sans filtre : ce sont les seules
 * donnees irremplacables du lot. Le reste se reconstruit en un cycle de veille.
 */
export function buildExport({
  codes = [],
  histories = {},
  catalog = {},
  library = {},
  sources = {},
  settings = {},
  filters = {},
  version = null,
  now,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('exporter : "maintenant" est obligatoire');

  const rows = claimsMade(histories, catalog, { library });

  return {
    exportFormat: EXPORT_FORMAT,
    exportedAt: new Date(now).toISOString(),
    extensionVersion: version,

    // Irremplacable : un code perdu est un jeu perdu.
    pendingCodes: codes,

    tally: tally(rows),
    claimsMade: rows,
    histories,
    settings,
    filters,

    // Le catalogue et l'etat des sources se reconstruisent seuls ; ils sont la
    // pour le diagnostic, pas pour la restauration.
    catalog,
    sources,
  };
}

/** Nom de fichier stable et trie chronologiquement. */
export function exportFileName(now) {
  const d = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `free-games-claimer-${d}.json`;
}
