/* La couche apprenante : a quelles heures cette source lache-t-elle ?
 *
 * Volontairement bete. Un histogramme de 168 cases par source -- jour de la
 * semaine croise avec l'heure -- et rien de plus. Avec quelques dizaines
 * d'evenements par source, tout modele plus riche surapprend sur trois points.
 *
 * LE PIEGE CENTRAL, et la raison d'etre de la moitie de ce fichier : on
 * n'observe pas l'heure du drop, on observe l'heure a laquelle on a regarde.
 * En sondant toutes les huit heures, tous les drops semblent tomber pile aux
 * heures de sondage : l'histogramme apprend son propre rythme et se renforce
 * lui-meme. Ce mode d'echec ne leve aucune erreur et donne l'apparence du bon
 * fonctionnement.
 *
 * Deux corrections, dans cet ordre :
 *   1. quand la source publie la date de mise en ligne, elle prime toujours --
 *      c'est la verite, et l'agregateur la donne sur toutes ses offres ;
 *   2. sinon on credite un INTERVALLE (dernier sondage negatif -> sondage
 *      positif) reparti uniformement, pas une case. Flou, mais non biaise.
 *
 * Les cases sont en UTC. Un magasin suit ses horaires locaux, donc ses cases
 * glissent d'une heure aux changements d'heure ; la decroissance par demi-vie
 * absorbe ce glissement en quelques semaines, et l'alternative -- ancrer
 * l'histogramme sur le fuseau suppose de chaque magasin -- demanderait de
 * connaitre ce fuseau, ce qu'on ne sait pas pour toutes les sources.
 *
 * Module pur : aucune horloge implicite.
 */

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Demi-vie du poids d'une observation. */
export const HALF_LIFE_MS = 90 * DAY;

/**
 * Au-dela de cette duree, un intervalle d'observation n'apprend plus rien :
 * repartir une observation sur trois jours de cases ajoute du bruit partout.
 * C'est le cas typique d'une machine restee eteinte.
 */
export const MAX_INTERVAL_MS = 24 * HOUR;

/** Une case devient chaude au-dela de ces deux seuils, simultanement. */
export const MIN_OBSERVATIONS = 3;
export const ABOVE_AVERAGE_FACTOR = 3;

export const CELL_COUNT = 168;

export function emptyStat() {
  return { cells: {}, observations: 0, lastUpdate: null };
}

/** Cle d'une case : jour de la semaine UTC (0 = dimanche) et heure UTC. */
export function cellKey(instant) {
  const d = new Date(instant);
  return `${d.getUTCDay()}-${d.getUTCHours()}`;
}

export function readKey(key) {
  const [day, hour] = String(key).split('-').map(Number);
  return { day, hour };
}

/* ---------------------------------------------------------- decroissance */

/**
 * Applique la decroissance jusqu'a l'instant donne. Paresseuse : on ne
 * recalcule qu'a l'ecriture, jamais en tache de fond.
 *
 * Sans elle, un magasin qui change d'horaire garderait pour toujours le poids
 * de son ancien rythme, et l'histogramme montrerait un creneau mort.
 */
export function decay(stat, now, halfLifeMs = HALF_LIFE_MS) {
  const base = stat && stat.lastUpdate;
  if (!base || now <= base) return { ...emptyStat(), ...stat };

  const factor = 0.5 ** ((now - base) / halfLifeMs);
  const cells = {};
  for (const [key, c] of Object.entries(stat.cells || {})) {
    const weight = c.weight * factor;
    // Sous ce plancher, la case ne pesera plus jamais rien : on la retire
    // plutot que de la trainer dans le stockage.
    if (weight < 0.001) continue;
    cells[key] = { weight, observations: c.observations };
  }
  return { ...stat, cells, lastUpdate: now };
}

export function totalWeight(stat) {
  let total = 0;
  for (const c of Object.values((stat && stat.cells) || {})) total += c.weight;
  return total;
}

/* -------------------------------------------------------------- credit */

function addOffer(cells, key, weight) {
  const c = cells[key] || { weight: 0, observations: 0 };
  cells[key] = { weight: c.weight + weight, observations: c.observations + 1 };
}

/** Credite la case d'un instant connu. C'est le cas fiable. */
export function creditInstant(stat, instant, now, halfLifeMs = HALF_LIFE_MS) {
  const decayed = decay(stat, now, halfLifeMs);
  const cells = { ...decayed.cells };
  addOffer(cells, cellKey(instant), 1);
  return { cells, observations: (decayed.observations || 0) + 1, lastUpdate: now };
}

/**
 * Credite un intervalle : l'offre est apparue quelque part entre le dernier
 * sondage negatif et le sondage positif, sans qu'on sache ou.
 *
 * Le credit total vaut 1, reparti au prorata du temps passe dans chaque case.
 * Une case survolee deux minutes pese donc dix fois moins qu'une case
 * traversee vingt minutes -- ce qui est exactement ce qu'on sait.
 */
export function creditInterval(stat, start, end, now, halfLifeMs = HALF_LIFE_MS) {
  if (!(end > start)) return creditInstant(stat, end, now, halfLifeMs);
  if (end - start > MAX_INTERVAL_MS) {
    // Trop large pour apprendre quoi que ce soit : on compte l'observation
    // sans la situer, plutot que de saupoudrer du bruit sur trois jours.
    const decayed = decay(stat, now, halfLifeMs);
    return { ...decayed, observations: (decayed.observations || 0) + 1, lastUpdate: now };
  }

  const decayed = decay(stat, now, halfLifeMs);
  const cells = { ...decayed.cells };
  const duration = end - start;

  let cursor = start;
  while (cursor < end) {
    const cellEnd = Math.floor(cursor / HOUR) * HOUR + HOUR;
    const clamp = Math.min(cellEnd, end);
    addOffer(cells, cellKey(cursor), (clamp - cursor) / duration);
    cursor = clamp;
  }

  return { cells, observations: (decayed.observations || 0) + 1, lastUpdate: now };
}

/**
 * Enregistre une offre nouvellement constatee.
 *
 * `dernierSondageNegatif` est l'instant du dernier cycle de cette source qui
 * n'avait pas vu cette offre. Sans lui, et sans date de publication, on ne peut
 * rien apprendre : on compte l'observation sans la situer.
 */
export function observe(stat, offer, { now, lastEmptyPoll = null, halfLifeMs = HALF_LIFE_MS } = {}) {
  if (typeof now !== 'number') throw new TypeError('observer : "maintenant" est obligatoire');

  // La date publiee par la source prime toujours : c'est la seule mesure non
  // biaisee de l'heure du drop.
  if (offer && typeof offer.start === 'number') {
    return creditInstant(stat, offer.start, now, halfLifeMs);
  }
  if (typeof lastEmptyPoll === 'number') {
    return creditInterval(stat, lastEmptyPoll, now, now, halfLifeMs);
  }
  const decayed = decay(stat, now, halfLifeMs);
  return { ...decayed, observations: (decayed.observations || 0) + 1, lastUpdate: now };
}

/* ---------------------------------------------------------- creneaux chauds */

/**
 * Les cases significativement au-dessus du bruit.
 *
 * Deux conditions simultanees : assez d'observations pour que ce ne soit pas
 * un accident, et un poids nettement superieur a ce que donnerait un hasard
 * uniforme. La seconde seule ferait declarer chaude la premiere case observee.
 */
export function hotCells(stat, { now = null, halfLifeMs = HALF_LIFE_MS } = {}) {
  const s = now === null ? stat : decay(stat, now, halfLifeMs);
  const total = totalWeight(s);
  if (!total) return [];

  const average = total / CELL_COUNT;
  const threshold = average * ABOVE_AVERAGE_FACTOR;

  return Object.entries(s.cells || {})
    .filter(([, c]) => c.observations >= MIN_OBSERVATIONS && c.weight >= threshold)
    .map(([key, c]) => ({ ...readKey(key), key, weight: c.weight, observations: c.observations }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Les prochaines occurrences des cases chaudes, en instants, prets pour
 * l'ordonnanceur.
 *
 * Une case chaude « jeudi 15 h UTC » devient l'instant du prochain jeudi 15:00
 * UTC. Pas de fuseau ici : les cases sont en UTC et le restent.
 */
export function learnedHotInstants(stat, now, { horizonMs = 7 * DAY, halfLifeMs = HALF_LIFE_MS } = {}) {
  const hotKeys = hotCells(stat, { now, halfLifeMs });
  const instants = [];

  for (const c of hotKeys) {
    const d = new Date(now);
    const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), c.hour);
    for (let i = 0; i <= 7; i++) {
      const candidate = base + i * DAY;
      if (candidate <= now) continue;
      if (candidate - now > horizonMs) break;
      if (new Date(candidate).getUTCDay() !== c.day) continue;
      instants.push(candidate);
      break;
    }
  }

  return [...new Set(instants)].sort((a, b) => a - b);
}

/* ------------------------------------------------------------- affichage */

/**
 * Vingt-quatre intensites de 0 a 1, pour peindre les prochaines 24 heures.
 *
 * L'interface doit pouvoir montrer ce que la prediction croit savoir : une
 * prediction qu'on ne peut pas inspecter est une prediction qu'on ne peut pas
 * corriger.
 */
export function band24h(stat, now, { halfLifeMs = HALF_LIFE_MS } = {}) {
  const s = decay(stat, now, halfLifeMs);
  const total = totalWeight(s);
  const max = Math.max(0, ...Object.values(s.cells || {}).map((c) => c.weight));

  const bands = [];
  for (let i = 0; i < 24; i++) {
    const instant = now + i * HOUR;
    const key = cellKey(instant);
    const c = (s.cells || {})[key];
    bands.push({
      instant,
      hour: new Date(instant).getUTCHours(),
      intensity: max > 0 && c ? c.weight / max : 0,
      observations: c ? c.observations : 0,
    });
  }
  return { bands, total, observations: s.observations || 0 };
}

/** Assez de matiere pour que la prediction veuille dire quelque chose ? */
export function isTrustworthy(stat) {
  return Boolean(stat) && (stat.observations || 0) >= MIN_OBSERVATIONS * 2;
}
