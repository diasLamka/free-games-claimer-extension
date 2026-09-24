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
 * aucune page. Le rendu vit dans content/launcher.js, qui n'a le droit de rien savoir
 * d'autre que ce qui sort d'ici.
 */
import { OUTCOMES } from './outcomes.js';
import { isExtraContent } from './filters.js';
import { RECURRENT_AFTER, recurrenceFor, recurrenceIndex } from './recurrence.js';

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
  /** Il est passe plusieurs fois : celui-la, on peut l'attendre. */
  RECURRING: 'recurring',
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

  /* 5. Revient-il ?
   *
   * Le seul fait de la liste qui puisse changer une decision d'ACHAT. Il est
   * calcule en DERNIER et ajoute a la fin : il complete les autres, il ne les
   * remplace pas -- savoir qu'un jeu revient n'annule pas le fait qu'il soit
   * offert aujourd'hui. */
  const index = recurrenceIndex({ outcomes, library, normalise });
  const revient = recurrenceFor(index, title, normalise);
  if (revient && revient.count >= RECURRENT_AFTER) {
    faits.push({ kind: FACTS.RECURRING, count: revient.count, last: revient.passes[0].ts ?? null });
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

/**
 * Les phrases d'une fiche, dans la langue de l'utilisateur (2.50.0).
 *
 * Composees ICI, cote service worker, et non dans le lanceur : celui-ci est
 * injectee dans une page tierce et doit rester minuscule, sans table de
 * traduction. Elle ecrivait donc ses phrases en francais pour tout le monde,
 * et le magasin sous son identifiant (« sur gog »). Le worker a la table, les
 * noms de magasins et le format de date du lecteur.
 *
 * `t` est la fonction de traduction, `storeLabel` rend le nom d'un magasin,
 * `dateText` un jour lisible. Une phrase vide n'est pas rendue.
 */
export function factLines(facts, { t, storeLabel = (s) => s, dateText = (ts) => String(ts) }) {
  const lignes = [];
  for (const f of facts || []) {
    let l = '';
    if (f.kind === FACTS.OWNED) l = t('overlayOwned', (f.stores || []).map(storeLabel).join(', '));
    else if (f.kind === FACTS.FREE_NOW) {
      l = f.end ? t('overlayFreeNowUntil', storeLabel(f.store), dateText(f.end)) : t('overlayFreeNow', storeLabel(f.store));
    } else if (f.kind === FACTS.CLAIMED) l = f.ts ? t('overlayClaimedOn', dateText(f.ts)) : t('overlayClaimed');
    else if (f.kind === FACTS.RECURRING) l = t('overlayRecurring', String(f.count));
    else if (f.kind === FACTS.MISSED) l = f.ts ? t('overlayMissedOn', dateText(f.ts)) : t('overlayMissed');
    if (l) lignes.push(l);
  }
  return lignes;
}

/**
 * Les mots du lanceur (content/launcher.js, 2.51.0), par nom.
 *
 * Meme raison que les phrases ci-dessus : le lanceur n'a pas de table de
 * traduction. Il recoit ses libelles avec la reponse, dans la langue choisie
 * dans les reglages ; sans reponse, il demande les memes cles au navigateur,
 * qui ignore seulement ce choix. Les cles sont donc recopiees la-bas, et un
 * test verifie que les deux listes n'ont pas diverge.
 */
export const LAUNCHER_LABELS = Object.freeze({
  button: 'launcherButton',
  close: 'sentinelClose',
  claim: 'claimAll',
  autoEpic: 'epicAutoLabel',
  autoLuna: 'lunaAutoLabel',
  /* Le panneau redessine (2.62.0). */
  dashboard: 'dashboardOpen',
  thisPage: 'launcherThisPage',
  freeNow: 'launcherFreeNow',
  seeAll: 'launcherSeeAll',
  dlc: 'tagDlc',
  freeLeft: 'launcherFreeLeft',
  freeNoEnd: 'launcherFreeNoEnd',
  cardLeft: 'launcherCardLeft',
  cardNoEnd: 'launcherCardNoEnd',
  /* Le panneau d'une page de magasin sans rien a dire (2.67.0). */
  nothing: 'launcherNothing',
});

export function launcherLabels(t) {
  const out = {};
  /* Les $1, $2 passent tels quels : « Gratuit sur $1 · encore $2 » est un
     MODELE, que le lanceur remplit. Traduit sans eux, il perdait ses trous et
     disait « Gratuit sur · encore ». */
  for (const [nom, cle] of Object.entries(LAUNCHER_LABELS)) out[nom] = t(cle, '$1', '$2');
  return out;
}

/* ------------------------------------------------------------ le panneau (2.62.0) */

const JOUR = 86400000;

/** « 12 min », « 3 h 20 », « 2 j 4 h » : les unites du popup, par la table. */
export function delayText(ms, t) {
  const abs = Math.max(0, ms);
  const d = Math.floor(abs / JOUR);
  const h = Math.floor((abs % JOUR) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  if (d) return t('durationDaysHours', String(d), String(h));
  if (h) return t('durationHoursMinutes', String(h), String(m).padStart(2, '0'));
  return t('durationMinutes', String(m));
}

/** L'urgence d'une fin, avec les seuils des anneaux du popup. */
export function urgency(end, now) {
  if (typeof end !== 'number') return 'unknown';
  const reste = end - now;
  if (reste <= JOUR) return 'hot';
  if (reste <= 3 * JOUR) return 'warm';
  return 'calm';
}

const https = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]{1,2000}$/.test(u) ? u : null);

/**
 * Une offre du catalogue, telle que le panneau de la page l'affiche : rien que
 * ce qu'il montre, deja traduit. Une adresse qui n'est pas https ne part pas.
 */
export function launcherOffer(o, { now, t, storeLabel = (s) => s }) {
  const end = typeof o.end === 'number' ? o.end : null;
  return {
    title: String(o.title || '').replace(/\s+/g, ' ').trim().slice(0, 140),
    store: String(o.store || ''),
    storeLabel: storeLabel(o.store),
    end,
    left: end === null ? t('noEndDate') : delayText(end - now, t),
    urgency: urgency(end, now),
    image: https(o.image),
    url: https(o.url),
    dlc: isExtraContent(o),
  };
}

/**
 * Ce qui est gratuit en ce moment, pour le panneau : les memes offres que la
 * liste du popup -- magasins suivis, ni terminees, ni refusees, ni cachees
 * parce que deja possedees --, la fin la plus proche d'abord, une fin
 * inconnue en dernier.
 */
export function freeNowList(catalog, {
  now, t, storeLabel, watched = null, dismissed = [], hideOwned = false, limit = 5,
}) {
  const lignes = Object.entries(catalog || {})
    .filter(([, o]) => o && o.title && o.state !== 'expired' && o.state !== 'resolved')
    .filter(([, o]) => typeof o.end !== 'number' || o.end > now)
    .filter(([, o]) => !Array.isArray(watched) || watched.includes(o.store))
    .filter(([cle]) => !dismissed.includes(cle))
    .filter(([, o]) => !(hideOwned && o.alreadyOwned === true));
  lignes.sort(([, a], [, b]) => (typeof a.end === 'number' ? a.end : Infinity) - (typeof b.end === 'number' ? b.end : Infinity));
  return {
    total: lignes.length,
    offers: lignes.slice(0, limit).map(([, o]) => launcherOffer(o, { now, t, storeLabel })),
  };
}

/**
 * Le jeu de la page, s'il est offert en ce moment : l'offre du catalogue au
 * meme titre, celle du magasin de la page d'abord. null sinon -- le panneau
 * n'affiche alors que les faits.
 */
export function pageGame(catalog, { title, store = null, normalise, now, t, storeLabel }) {
  const cle = normalise(title);
  if (!cle) return null;
  const vivantes = Object.values(catalog || {}).filter((o) => o && o.title && normalise(o.title) === cle
    && o.state !== 'expired' && (typeof o.end !== 'number' || o.end > now));
  if (!vivantes.length) return null;
  const ici = vivantes.find((o) => o.store === store) || vivantes[0];
  return launcherOffer(ici, { now, t, storeLabel });
}
