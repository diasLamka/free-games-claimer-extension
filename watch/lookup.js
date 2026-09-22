/* Ce que l'extension sait d'un jeu, repondu a une page de magasin.
 *
 * Toute la connaissance de l'extension vivait dans son popup. Sur la fiche
 * d'un jeu, chez Epic, GOG ou Steam, elle ne disait rien -- alors que c'est
 * exactement la qu'on se demande si on l'a deja, et depuis quand.
 *
 * Augmented Steam connait Steam. Les extensions GOG connaissent GOG. Aucune ne
 * connait vos quatre magasins PLUS ce que vous avez reclame, parce qu'aucune
 * ne les lit toutes.
 *
 * Module PUR : il repond a une question, il n'affiche rien et ne touche a
 * aucune page. Le rendu vit dans overlay.js, qui n'a le droit de rien savoir
 * d'autre que ce qui sort d'ici.
 */
import { OUTCOMES } from './outcomes.js';

/** Les faits qu'une fiche peut porter, du plus utile au moins utile. */
export const FACTS = Object.freeze({
  /** Vous l'avez, et voici ou. */
  OWNED: 'owned',
  /** Il est offert en ce moment, ici ou ailleurs. */
  FREE_NOW: 'freeNow',
  /** Vous l'avez reclame par l'extension, a telle date. */
  CLAIMED: 'claimed',
  /** Il est deja passe en offre, et vous l'avez rate. */
  MISSED: 'missed',
});

/**
 * Tout ce que l'extension peut dire de ce titre.
 *
 * Le rapprochement se fait sur le TITRE NORMALISE, et la normalisation est
 * passee plutot qu'importee : c'est la meme que celle du modele d'offre, la
 * seule avec laquelle les quatre magasins se recoupent.
 *
 * Rend une LISTE de faits, jamais une phrase. Composer la phrase ici
 * melangerait ce qu'on sait et comment on le dit, et la page ne pourrait plus
 * choisir ce qu'elle a la place d'afficher.
 */
export function lookup({
  title,
  store = null,
  catalog = {},
  library = {},
  collection = {},
  outcomes = {},
  normalise,
  now,
} = {}) {
  if (typeof normalise !== 'function') {
    throw new TypeError('lookup : la normalisation des titres est obligatoire');
  }
  if (typeof now !== 'number') throw new TypeError('lookup : "maintenant" est obligatoire');

  const cle = normalise(title);
  if (!cle) return [];

  const faits = [];

  /* 1. Le possedez-vous ? La question que se pose quelqu'un avec trois cents
        jeux, et la seule a laquelle aucune autre extension ne repond pour
        quatre magasins a la fois. */
  /* La collection est passee sous sa forme STOCKEE : une carte plate d'articles
     portant chacun son magasin, et non les lignes regroupees que la page Ma
     collection construit pour l'affichage. Lire la forme d'affichage
     obligerait a rejouer son regroupement ici, donc a le maintenir en
     double. */
  const chez = [];
  for (const item of Object.values(collection || {})) {
    if (!item || !item.title || normalise(item.title) !== cle) continue;
    if (item.store && !chez.includes(item.store)) chez.push(item.store);
  }
  if (chez.length) faits.push({ kind: FACTS.OWNED, stores: chez.sort() });

  /* 2. Est-il offert maintenant ? Y compris sur un AUTRE magasin que celui de
        la page : c'est precisement ce qu'on ne peut pas voir soi-meme. */
  for (const offre of Object.values(catalog || {})) {
    if (!offre || !offre.title || normalise(offre.title) !== cle) continue;
    if (typeof offre.end === 'number' && offre.end <= now) continue;
    faits.push({ kind: FACTS.FREE_NOW, store: offre.store, end: offre.end ?? null, url: offre.url || null });
  }

  /* 3. L'avez-vous deja pris par l'extension ? La date vient du registre, qui
        n'est jamais purge -- contrairement au catalogue. */
  for (const acquis of Object.values(library || {})) {
    if (!acquis || !acquis.title || normalise(acquis.title) !== cle) continue;
    faits.push({ kind: FACTS.CLAIMED, store: acquis.store, ts: acquis.ts ?? null });
  }

  /* 4. L'avez-vous rate ? C'est le seul fait qui puisse changer une decision
        d'ACHAT : ce jeu a deja ete offert une fois, il peut l'etre encore.

        La source est ce que l'extension a elle-meme observe. L'agregateur
        public n'expose que les offres ACTIVES -- mesure le 2026-09-22 -- donc
        il n'existe aucune archive a interroger, et une histoire inventee
        vaudrait moins que rien. */
  for (const issue of Object.values(outcomes || {})) {
    if (!issue || !issue.title || normalise(issue.title) !== cle) continue;
    if (issue.outcome !== OUTCOMES.MISSED) continue;
    faits.push({ kind: FACTS.MISSED, store: issue.store, ts: issue.ts ?? null });
  }

  return dedupe(faits);
}

/**
 * Un fait par genre et par magasin.
 *
 * Le catalogue peut porter la meme offre sous deux cles -- forte et faible --
 * et le registre deux acquisitions du meme jeu sur le meme magasin. Afficher
 * deux fois « offert sur GOG » ferait douter de tout le reste.
 */
function dedupe(faits) {
  const vus = new Set();
  const out = [];
  for (const f of faits) {
    const k = `${f.kind}:${f.store || ''}`;
    if (vus.has(k)) continue;
    vus.add(k);
    out.push(f);
  }
  return out;
}
