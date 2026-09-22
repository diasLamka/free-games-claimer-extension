/* Ce qui revient.
 *
 * Un jeu offert une fois peut l'etre encore. C'est le seul signal de toute
 * l'extension qui puisse changer une decision d'ACHAT, et pas seulement une
 * decision de reclamation.
 *
 * LA SOURCE A ETE CHOISIE APRES UNE MESURE, et la mesure a change le plan.
 * L'agregateur public n'expose que les offres ACTIVES : verifie le
 * 2026-09-22, le seul statut present dans sa reponse est « Active », et aucun
 * champ ne designe une offre passee. Il n'existe donc aucune archive a
 * interroger.
 *
 * L'histoire vient donc de ce que l'extension a ELLE-MEME observe : les issues
 * figees depuis la 2.27.0, et le registre d'acquisitions, qui n'est jamais
 * purge. C'est plus pauvre au debut, puisque cela part de rien. C'est plus
 * honnete ensuite, parce que chaque ligne est verifiable dans l'historique de
 * celui qui la lit.
 *
 * Module PUR.
 */

/**
 * L'index des passages, par titre normalise.
 *
 * Les deux sources sont fusionnees plutot que choisies : le registre sait ce
 * qui a ete PRIS et survit a toutes les purges ; les issues savent aussi ce
 * qui a ete RATE, mais s'arretent aux mille dernieres. Ni l'un ni l'autre ne
 * suffit, et leur recoupement se fait sur le magasin et le jour.
 */
export function recurrenceIndex({ outcomes = {}, library = {}, normalise } = {}) {
  if (typeof normalise !== 'function') {
    throw new TypeError('recurrence : la normalisation des titres est obligatoire');
  }

  const index = new Map();

  const ajouter = (titre, passage) => {
    const cle = normalise(titre);
    if (!cle) return;

    const vu = index.get(cle) || { key: cle, title: titre, passes: [] };
    /* Meme magasin, meme jour : c'est le meme passage vu par les deux sources.
       Compter deux fois ferait croire a une recurrence qui n'existe pas, et ce
       chiffre est precisement celui sur lequel quelqu'un va s'appuyer pour ne
       PAS acheter. */
    const jour = Number.isFinite(passage.ts) ? Math.floor(passage.ts / 86400000) : null;
    const double = vu.passes.some(
      (p) => p.store === passage.store
        && (jour === null ? p.ts === passage.ts : Math.floor(p.ts / 86400000) === jour),
    );
    if (double) return;

    vu.passes.push(passage);
    index.set(cle, vu);
  };

  for (const e of Object.values(library || {})) {
    if (!e || !e.title) continue;
    ajouter(e.title, { store: e.store || null, ts: e.ts ?? null, taken: true });
  }
  for (const i of Object.values(outcomes || {})) {
    if (!i || !i.title) continue;
    ajouter(i.title, { store: i.store || null, ts: i.ts ?? null, taken: i.outcome === 'taken' });
  }

  for (const entree of index.values()) {
    entree.passes.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    entree.count = entree.passes.length;
  }
  return index;
}

/**
 * Ce que l'index sait d'un titre.
 *
 * Rend null plutot qu'une entree a zero passage : « jamais vu » et « vu une
 * fois » ne se disent pas pareil, et une entree vide ferait afficher un
 * bandeau qui n'apprend rien.
 */
export function recurrenceFor(index, title, normalise) {
  const cle = normalise(title);
  if (!cle) return null;
  return index.get(cle) || null;
}

/**
 * Le seuil a partir duquel un titre « revient ».
 *
 * Deux passages, pas trois. Un jeu vu deux fois en offre est deja un jeu qu'on
 * peut attendre plutot qu'acheter, et exiger trois passages rendrait le signal
 * inutilisable pendant des annees, vu la profondeur reelle des donnees.
 */
export const RECURRENT_AFTER = 2;

/** Les titres qui reviennent, du plus frequent au moins frequent. */
export function recurring(index, { min = RECURRENT_AFTER } = {}) {
  return [...index.values()]
    .filter((e) => e.count >= min)
    .sort((a, b) => b.count - a.count
      || (b.passes[0] ? b.passes[0].ts || 0 : 0) - (a.passes[0] ? a.passes[0].ts || 0 : 0));
}
