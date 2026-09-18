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
 * LES CASES SONT ANCREES SUR UN FUSEAU NOMME quand on connait celui de la
 * source, en UTC sinon. Le commentaire precedent pariait que la decroissance
 * par demi-vie absorberait le glissement d'une heure des changements d'heure.
 * Le chiffre dit le contraire : la demi-fenetre chaude de l'ordonnanceur vaut
 * 30 MINUTES (`hotHalfWindowMs`), donc une derive d'une heure ne la frole meme
 * pas -- elle la rate entierement. Et reapprendre demande trois observations
 * dans la nouvelle case, soit trois semaines pour une source hebdomadaire.
 *
 * Le fuseau est donc porte par l'histogramme lui-meme (`stat.zone`), pas par
 * l'appelant : une case rangee dans un fuseau et relue dans un autre serait
 * pire que le bug qu'on corrige. Quand la source change de fuseau, les cases
 * sont TRANSPOSEES -- voir `retuneZone`.
 *
 * Module pur : aucune horloge implicite.
 */
import { localParts, validZone, nextOccurrence } from './clock.js';

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
  return { cells: {}, observations: 0, lastUpdate: null, zone: null };
}

/**
 * Le fuseau dans lequel les cases d'un histogramme sont rangees.
 *
 * `null` -- le cas de tous les histogrammes appris jusqu'ici -- veut dire UTC,
 * et c'est ce qu'ils etaient. Un fuseau inconnu de la plateforme retombe sur
 * UTC plutot que de faire echouer la lecture : une prediction degradee vaut
 * mieux qu'une veille arretee.
 */
export function statZone(stat) {
  const z = stat && typeof stat.zone === 'string' ? stat.zone.trim() : '';
  return z && validZone(z) ? z : 'UTC';
}

/** Cle d'une case : jour de la semaine (0 = dimanche) et heure, dans `zone`. */
export function cellKey(instant, zone = 'UTC') {
  if (!zone || zone === 'UTC') {
    const d = new Date(instant);
    return `${d.getUTCDay()}-${d.getUTCHours()}`;
  }
  const p = localParts(instant, zone);
  return `${p.weekday}-${p.hour}`;
}

export function readKey(key) {
  const [day, hour] = String(key).split('-').map(Number);
  return { day, hour };
}

/* ------------------------------------------------------------ transposition */

/** Decale une cle de case d'un nombre entier d'heures, en bouclant sur la semaine. */
function shiftKey(key, hours) {
  const { day, hour } = readKey(key);
  const total = day * 24 + hour + hours;
  const wrapped = ((total % CELL_COUNT) + CELL_COUNT) % CELL_COUNT;
  return `${Math.floor(wrapped / 24)}-${wrapped % 24}`;
}

/**
 * Range les cases dans un autre fuseau.
 *
 * CE QUE CETTE FONCTION NE PEUT PAS FAIRE, et il faut le dire : une case ne
 * garde ni les dates ni les decalages de ses observations, seulement un poids
 * et un compteur. Une transposition exacte est donc IMPOSSIBLE -- l'information
 * qu'elle demanderait a ete jetee a l'ecriture.
 *
 * Ce qu'elle fait a la place : elle applique le decalage EN VIGUEUR A CET
 * INSTANT entre les deux fuseaux. Les observations faites sous ce decalage --
 * les recentes, donc les seules qui pesent encore -- atterrissent dans la
 * bonne case. Les plus anciennes, faites sous l'autre decalage, se retrouvent
 * a une heure pres : elles l'etaient deja, c'est tout le probleme qu'on
 * corrige, et la demi-vie les efface.
 *
 * C'est strictement mieux que les deux alternatives : rester en UTC garde la
 * derive pour toujours, et repartir de zero coute trois semaines de
 * reapprentissage pour une source hebdomadaire.
 */
export function retuneZone(stat, zone, now) {
  const from = statZone(stat);
  const to = zone && validZone(zone) ? zone : 'UTC';
  const base = { ...emptyStat(), ...stat };
  if (from === to) return { ...base, zone: to === 'UTC' ? (base.zone || null) : to };

  // Les fuseaux a la demi-heure existent (Inde, Terre-Neuve) : une case fait
  // une heure, on arrondit donc au plus proche plutot que de perdre la case.
  const hours = Math.round((offsetAt(now, to) - offsetAt(now, from)) / HOUR);

  const cells = {};
  for (const [key, c] of Object.entries(base.cells || {})) {
    const next = shiftKey(key, hours);
    const prev = cells[next] || { weight: 0, observations: 0 };
    cells[next] = { weight: prev.weight + c.weight, observations: prev.observations + c.observations };
  }

  return { ...base, cells, zone: to === 'UTC' ? null : to };
}

/** Decalage d'un fuseau par rapport a UTC, en millisecondes, a cet instant. */
function offsetAt(instant, zone) {
  if (!zone || zone === 'UTC') return 0;
  const p = localParts(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (instant - (instant % 1000));
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
  addOffer(cells, cellKey(instant, statZone(decayed)), 1);
  return { cells, observations: (decayed.observations || 0) + 1, lastUpdate: now, zone: decayed.zone || null };
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

  const zone = statZone(decayed);
  let cursor = start;
  while (cursor < end) {
    const cellEnd = Math.floor(cursor / HOUR) * HOUR + HOUR;
    const clamp = Math.min(cellEnd, end);
    addOffer(cells, cellKey(cursor, zone), (clamp - cursor) / duration);
    cursor = clamp;
  }

  return { cells, observations: (decayed.observations || 0) + 1, lastUpdate: now, zone: decayed.zone || null };
}

/**
 * Enregistre une offre nouvellement constatee.
 *
 * `dernierSondageNegatif` est l'instant du dernier cycle de cette source qui
 * n'avait pas vu cette offre. Sans lui, et sans date de publication, on ne peut
 * rien apprendre : on compte l'observation sans la situer.
 */
export function observe(stat, offer, { now, lastEmptyPoll = null, halfLifeMs = HALF_LIFE_MS, zone = null } = {}) {
  if (typeof now !== 'number') throw new TypeError('observer : "maintenant" est obligatoire');

  /* Le fuseau de la source, quand elle en declare un, commande le rangement.
     S'il differe de celui des cases, elles sont transposees ICI, une fois, et
     tout ce qui suit travaille dans le bon fuseau. */
  const tuned = retuneZone(stat, zone, now);

  // La date publiee par la source prime toujours : c'est la seule mesure non
  // biaisee de l'heure du drop.
  if (offer && typeof offer.start === 'number') {
    return creditInstant(tuned, offer.start, now, halfLifeMs);
  }
  if (typeof lastEmptyPoll === 'number') {
    return creditInterval(tuned, lastEmptyPoll, now, now, halfLifeMs);
  }
  const decayed = decay(tuned, now, halfLifeMs);
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
 * DEUX INSTANTS PAR CASE, et ce n'est pas un luxe. Une case couvre une heure
 * pleine, tandis que la fenetre chaude de l'ordonnanceur s'etend sur 30 minutes
 * de part et d'autre d'un instant : n'annoncer que le debut de la case
 * (« jeudi 15:00 ») laissait la SECONDE MOITIE de toute case apprise
 * decouverte. Avec 15:00 et 15:30, la couverture va de 14:30 a 16:00 -- la case
 * entiere, plus une avance qui rattrape un drop legerement anticipe.
 *
 * L'occurrence est calculee par `nextOccurrence`, qui itere sur le CALENDRIER
 * LOCAL du fuseau : aucune arithmetique en millisecondes ne survit a un jour de
 * 23 heures.
 */
export function learnedHotInstants(stat, now, { horizonMs = 7 * DAY, halfLifeMs = HALF_LIFE_MS } = {}) {
  const zone = statZone(stat);
  const hotKeys = hotCells(stat, { now, halfLifeMs });
  const instants = [];

  for (const c of hotKeys) {
    for (const minute of [0, 30]) {
      const next = nextOccurrence({ zone, dayCount: [c.day], hour: c.hour, minute }, now);
      if (!next) continue;
      if (next.instant - now > horizonMs) continue;
      instants.push(next.instant);
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
  const zone = statZone(s);
  const total = totalWeight(s);
  const max = Math.max(0, ...Object.values(s.cells || {}).map((c) => c.weight));

  const bands = [];
  for (let i = 0; i < 24; i++) {
    const instant = now + i * HOUR;
    const key = cellKey(instant, zone);
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
