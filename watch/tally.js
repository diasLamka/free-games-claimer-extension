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
import { readWorth } from './filters.js';
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
export function claimsMade(histories = {}, catalog = {}, { since = 0 } = {}) {
  const out = [];

  for (const [plateforme, store] of Object.entries(PLATFORMS)) {
    const histo = histories[plateforme] || {};
    for (const [key, e] of Object.entries(histo)) {
      if (!e || !e.ts || e.ts < since) continue;
      if (!ACQUIRED_STATUSES.includes(e.status)) continue;

      const known = matchHistory(key, store, catalog);
      out.push({
        key,
        store,
        title: known ? known.title : null,
        worth: known ? readWorth(known.worth) : null,
        ts: e.ts,
        status: e.status,
      });
    }
  }

  return out.sort((a, b) => b.ts - a.ts);
}

/**
 * Le bilan.
 *
 * `valorisees` compte les recuperations dont on connaissait la valeur : sans ce
 * chiffre, « 48 $ pour 20 jeux » laisserait croire que les 20 ont ete comptes,
 * alors que la moitie sont anterieures a la veille.
 */
export function tally(rows = []) {
  let totalWorth = 0;
  let priced = 0;
  const byStore = {};
  const byMonth = {};

  for (const l of rows) {
    if (typeof l.worth === 'number') {
      totalWorth += l.worth;
      priced++;
    }

    const m = byStore[l.store] || { count: 0, worth: 0 };
    m.count++;
    if (typeof l.worth === 'number') m.worth += l.worth;
    byStore[l.store] = m;

    const month = new Date(l.ts).toISOString().slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
  }

  return {
    count: rows.length,
    priced,
    totalWorth: Math.round(totalWorth * 100) / 100,
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
  sources = {},
  settings = {},
  filters = {},
  version = null,
  now,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('exporter : "maintenant" est obligatoire');

  const rows = claimsMade(histories, catalog);

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
