/* Ce qui est passe, et comment ca s'est termine.
 *
 * Le bilan (`watch/tally.js`) compte ce qui a ete PRIS. Rien ne garde ce qui a
 * ete RATE -- et c'est pourtant la seule colonne qui apprenne quelque chose :
 * une offre expiree sans avoir ete reclamee est soit un reglage trop strict,
 * soit une panne, soit un choix delibere. Les trois se ressemblent aujourd'hui,
 * faute de trace.
 *
 * Le catalogue ne peut pas tenir cette memoire, pour deux raisons :
 *
 *   - il est purge (`RETENTION_MS`, quatre-vingt-dix jours). Passe ce delai
 *     l'information n'existe plus nulle part ;
 *   - le motif d'ecart n'est calcule qu'a l'AFFICHAGE, donc jamais ecrit.
 *
 * Ce module fige donc l'issue a l'instant ou l'offre se termine, seule fenetre
 * pendant laquelle tout est encore connu. Meme raisonnement que
 * `watch/library.js` pour les acquisitions, avec une difference qui commande
 * tout le reste : une acquisition est rare et precieuse, donc le registre n'a
 * pas de plafond ; une issue arrive pour CHAQUE offre qui passe, donc celui-ci
 * en a un.
 *
 * Module PUR : aucune API d'extension, aucun acces reseau, aucune horloge.
 * La plomberie est dans watch/cycle.js.
 */
import { STATES } from './offer.js';

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_OUTCOMES = 'veille:issues';

/**
 * Nombre d'issues conservees.
 *
 * Le calcul : une vingtaine d'offres en cours a tout instant, quelques-unes
 * qui se terminent par semaine. Mille issues couvrent des annees, pour
 * quelques centaines de kilo-octets dans la meme zone que le catalogue, le
 * journal et les codes en attente. Sans plafond, le magasin grossirait
 * indefiniment sans que personne ne le remarque avant le quota.
 */
export const MAX_OUTCOMES = 1000;

/** Les trois facons dont une offre peut finir, du point de vue de l'utilisateur. */
export const OUTCOMES = Object.freeze({
  /** Le jeu est au compte. */
  TAKEN: 'taken',
  /** L'offre s'est terminee sans que le jeu y arrive. */
  MISSED: 'missed',
  /** Elle s'est terminee, et on ne sait pas si le jeu y est. */
  UNKNOWN: 'unknown',
});

/**
 * Les verdicts apres lesquels le jeu est au compte.
 *
 * Recopies de `watch/claim.js` plutot qu'importes, pour garder ce module sans
 * dependance vers la couche de reclamation. Une recopie derive : le test
 * `outcomes.test.mjs` verifie que chacun existe encore la-bas, faute de quoi
 * un verdict renomme ferait classer « ratee » une offre bel et bien prise,
 * en silence et pour toujours.
 *
 * `already_redeemed` en fait partie, et ce n'est pas une reussite de
 * l'extension : la question que pose la page est « l'ai-je ? », pas « qui l'a
 * mise la ? ». Le compter comme rate ferait chercher une panne la ou tout va
 * bien.
 */
export const TAKING_VERDICTS = Object.freeze([
  'claimed',
  'redeemed',
  'already_redeemed',
  'code_copied',
]);

/** Les etats apres lesquels une offre ne bouge plus. Memes que catalog.js. */
const TERMINAL_STATES = new Set([STATES.RESOLVED, STATES.EXPIRED]);

/**
 * L'identite d'une issue.
 *
 * Celle que le catalogue donnait a l'offre, pour que les deux se rapprochent
 * sans effort. Le repli n'est pas cosmetique : une entree arrivee par un
 * chemin qui ne porte pas sa cle s'ecrirait sinon sous « undefined », et la
 * suivante l'ecraserait.
 */
export function outcomeKey(entry) {
  if (entry && entry.catalogKey) return entry.catalogKey;
  return `${(entry && entry.store) || '?'}:${(entry && entry.storeId) || '?'}`;
}

/** Ce verdict veut-il dire que le jeu est au compte ? */
function taken(verdict) {
  return Boolean(verdict) && TAKING_VERDICTS.includes(verdict);
}

/**
 * Comment cette offre s'est-elle terminee ?
 *
 * Trois cas, et le troisieme est celui qu'on refuse de deviner. Un echec, un
 * defi de securite, un compte a associer : l'offre est finie et personne ne
 * sait si le jeu y est. Le dire est utile ; trancher ne l'est pas.
 */
function classify(entry) {
  if (taken(entry.verdict)) return OUTCOMES.TAKEN;
  /* EXPIREE sans verdict de prise : le jeu n'est pas au compte, et le motif
     importe peu ici -- qu'elle ait echoue, demande une connexion ou n'ait
     jamais ete tentee, l'utilisateur ne l'a pas. Le verdict brut reste fige a
     cote, pour qui veut la nuance. */
  if (entry.state === STATES.EXPIRED) return OUTCOMES.MISSED;
  return OUTCOMES.UNKNOWN;
}

/**
 * Ce qu'on fige d'une offre terminee.
 *
 * Volontairement peu, et chaque champ a sa raison : de quoi rendre une ligne
 * de page SANS le catalogue -- titre, magasin, valeur, lien, vignette -- plus
 * les deux dates qui donnent sa duree a l'offre, et le verdict tel quel pour
 * que le motif reste lisible quand la classification aura evolue.
 */
export function makeOutcome(entry, { now } = {}) {
  if (typeof now !== 'number') throw new TypeError('figer une issue : "maintenant" est obligatoire');

  return {
    store: entry.store || null,
    id: entry.storeId || null,
    source: entry.source || null,
    title: entry.title || null,
    url: entry.url || entry.resolveUrl || null,
    image: entry.image || null,
    worth: entry.worth || null,
    /** Quand l'offre s'est terminee, si elle l'a annonce. */
    end: entry.end ?? null,
    /** Quand la veille l'a vue pour la premiere fois. */
    firstSeen: entry.seenAt ?? null,
    /** Quand l'issue a ete figee. C'est la date que la page trie. */
    ts: now,
    state: entry.state || null,
    verdict: entry.verdict || null,
    outcome: classify(entry),
  };
}

/**
 * Ramene le magasin sous son plafond, les plus vieilles issues d'abord.
 *
 * Coupe par la date de figement et non par l'ordre d'insertion : un objet
 * JavaScript garde l'ordre d'insertion pour ses cles textuelles, mais s'y
 * fier ferait dependre la purge d'un detail de langage plutot que du sens.
 */
function trim(outcomes) {
  const cles = Object.keys(outcomes);
  if (cles.length <= MAX_OUTCOMES) return outcomes;

  const gardees = cles
    .sort((a, b) => (outcomes[b].ts || 0) - (outcomes[a].ts || 0))
    .slice(0, MAX_OUTCOMES);

  const next = {};
  for (const k of gardees) next[k] = outcomes[k];
  return next;
}

/**
 * Fige l'issue des offres terminees d'un lot.
 *
 * Deux regles, chacune payee par une propriete du cycle :
 *
 *   - RIEN QUI NE SOIT TERMINE. Une offre en cours n'a pas d'issue, et lui en
 *     ecrire une la figerait avant la fin.
 *   - LA PREMIERE GAGNE. Le cycle est rejouable par conception -- c'est ce qui
 *     remplace le verrou, qui ne garantit rien. Une seconde passe sur la meme
 *     offre terminee ne doit pas repousser la date, sinon toute la chronologie
 *     glisse a chaque reveil du service worker.
 */
export function noteOutcomes(outcomes, entries, { now } = {}) {
  if (typeof now !== 'number') throw new TypeError('noter des issues : "maintenant" est obligatoire');

  let next = { ...(outcomes || {}) };
  let added = 0;

  for (const entry of entries || []) {
    if (!entry || !TERMINAL_STATES.has(entry.state)) continue;

    const k = outcomeKey(entry);
    if (next[k]) continue;

    next[k] = makeOutcome(entry, { now });
    added++;
  }

  if (added) next = trim(next);
  return { outcomes: next, added };
}

/** Les issues, de la plus recente a la plus ancienne. */
export function outcomeEntries(outcomes) {
  return Object.values(outcomes || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/**
 * Fige l'issue de tout ce qui est terminal dans un catalogue.
 *
 * Une offre devient terminale par trois chemins : sa date passe
 * (`markExpired`), elle disparait de sa source (`noteVanished`), ou une
 * reclamation la resout. Suivre les trois listes separement demanderait trois
 * cablages, donc trois occasions d'en oublier un -- et un oubli ici ne se voit
 * pas : la page serait simplement un peu moins complete, sans erreur.
 *
 * Balayer le catalogue avant d'ecrire les prend tous. C'est sur, parce que
 * `noteOutcomes` est idempotent : la premiere issue gagne, et repasser sur une
 * offre deja figee ne coute qu'une comparaison.
 */
export function noteOutcomesFromCatalog(outcomes, catalog, { now } = {}) {
  return noteOutcomes(outcomes, Object.values(catalog || {}), { now });
}
