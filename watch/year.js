/* Votre annee en jeux gratuits (2.93.0).
 *
 * Une image a partager -- sur Discord, sur un reseau -- qui dit ce que l'annee
 * a rapporte : combien de jeux, pour quelle valeur, sur quels magasins, le mois
 * record, les trois plus chers, le mieux note. Aucun outil ne peut la faire :
 * il faut avoir PRIS les jeux, sur tous les magasins, et s'en souvenir.
 *
 * La source est le registre (watch/library.js), jamais purge : ce que
 * l'extension a pris, ce que le telephone a pris (relais), ce qui a ete
 * restaure d'une sauvegarde. Un jeu trouve deja a vous n'y compte pas -- il ne
 * vous a rien rapporte cette annee.
 *
 * Module pur : il compte, il ne dessine pas (lib/year-card.js dessine).
 */
import { readWorth, readCurrency } from './filters.js';
import { toBase } from './rates.js';
import { alreadyYours } from './tally.js';
import { percent, ratingFor } from './steam-ratings.js';

const ACQUIS = ['claimed', 'redeemed'];

/** Les annees ou le registre a quelque chose, de la plus recente a la plus ancienne. */
export function yearsOf(library) {
  const ans = new Set();
  for (const e of Object.values(library || {})) {
    if (e && typeof e.ts === 'number' && (!e.status || ACQUIS.includes(e.status)) && !alreadyYours(e)) {
      ans.add(new Date(e.ts).getUTCFullYear());
    }
  }
  return [...ans].sort((a, b) => b - a);
}

/**
 * Le bilan d'une annee. `rates` convertit pour classer les plus chers ; sans
 * taux, un montant dans une autre devise se classe a sa valeur brute.
 */
export function yearRecap({ library = {}, ratings = {}, year, rates = null, now = Date.now() } = {}) {
  const jeux = Object.values(library || {}).filter((e) => (
    e && typeof e.ts === 'number' && new Date(e.ts).getUTCFullYear() === year
    && (!e.status || ACQUIS.includes(e.status)) && !alreadyYours(e) && e.title
  ));

  const valeur = (e) => {
    const n = readWorth(e.worth);
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    const cur = readCurrency(e.worth);
    const base = cur ? toBase(n, cur, rates, now) : null;
    return base === null ? n : base;
  };

  const parMagasin = {};
  const parMois = {};
  for (const e of jeux) {
    parMagasin[e.store] = (parMagasin[e.store] || 0) + 1;
    const m = new Date(e.ts).toISOString().slice(0, 7);
    parMois[m] = (parMois[m] || 0) + 1;
  }
  const mois = Object.entries(parMois).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;

  const chiffres = jeux.map((e) => ({ e, v: valeur(e) })).filter((x) => x.v !== null && x.v > 0);
  const top = chiffres.sort((a, b) => b.v - a.v).slice(0, 3)
    .map(({ e }) => ({ title: e.title, store: e.store, worth: e.worth, image: e.image || null }));

  let mieux = null;
  for (const e of jeux) {
    const r = ratingFor(ratings, { title: e.title, store: e.store, storeId: e.id });
    const p = percent(r);
    if (p === null || (r.total || 0) < 50) continue;
    if (!mieux || p > mieux.percent || (p === mieux.percent && r.total > mieux.total)) {
      mieux = { title: e.title, store: e.store, percent: p, total: r.total };
    }
  }

  return {
    year,
    count: jeux.length,
    worths: jeux.map((e) => e.worth).filter(Boolean),
    priced: chiffres.length,
    stores: Object.entries(parMagasin).sort((a, b) => b[1] - a[1]).map(([store, count]) => ({ store, count })),
    bestMonth: mois ? { month: mois[0], count: mois[1] } : null,
    top,
    bestRated: mieux,
    viaPhone: jeux.filter((e) => e.via === 'telephone').length,
  };
}

/** Le nom du fichier : free-games-2026.png. */
export function yearFileName(year) {
  return `free-games-${year}.png`;
}
