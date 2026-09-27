/* Le backlog : la premiere donnee de l'extension qui vienne de l'utilisateur.
 *
 * Tout ce que l'extension savait venait des magasins ou du moteur. L'inventaire
 * complet des cles `veille:` ne contenait rien de personnel : la page Ma
 * collection savait filtrer, trier, poser un lien de lancement, et aucune
 * donnee produite par l'utilisateur ne s'y accrochait.
 *
 * Elle cesse donc d'etre un inventaire pour devenir un outil de gestion.
 *
 * CE MODULE N'ATTEINT JAMAIS LA RECLAMATION. Un etat « abandonne » ne doit pas
 * empecher de prendre le meme jeu offert sur un autre magasin : c'est un
 * jugement sur une partie jouee, pas une consigne d'acquisition. Le seul
 * endroit qui refuse une offre reste le filtre, et il ne lit pas d'ici.
 *
 * Module PUR. Ecrit par les pages -- Ma collection, et depuis la 2.95.0 le
 * popup (« Ce soir je joue a... ») -- chacune relisant la cle juste avant
 * d'ecrire. Le service worker n'y touche jamais.
 */

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_ANNOTATIONS = 'veille:annotations';

/** Longueur maximale d'une note. Le stockage est partage avec le catalogue. */
export const MAX_NOTE = 500;

/** Ou en est-on avec ce jeu ? */
export const STATUS = Object.freeze({
  /** Rien de dit. L'etat de l'immense majorite d'une collection. */
  NONE: 'none',
  TO_TRY: 'toTry',
  PLAYING: 'playing',
  DONE: 'done',
  DROPPED: 'dropped',
  /** Ecarte sans y avoir joue (« Ce soir je joue a... », 2.95.0) : ne revient plus dans la pile. */
  NOT_FOR_ME: 'notForMe',
});

const VALIDES = new Set(Object.values(STATUS));

/**
 * L'identite d'une annotation.
 *
 * Le magasin ET l'identifiant, comme le registre d'acquisitions : le meme jeu
 * possede sur Epic et sur GOG fait deux entrees, parce qu'on peut l'avoir joue
 * sur l'un et pas sur l'autre.
 */
export function annotationKey(store, id) {
  return `${store}:${String(id || '')}`;
}

/**
 * Ce que l'on sait de ce jeu, avec des valeurs toujours definies.
 *
 * La page affiche cet etat pour CHAQUE ligne de la collection, dont des
 * centaines n'ont jamais ete annotees. Rendre `undefined` obligerait chaque
 * appelant a s'en souvenir, et le premier oubli afficherait « undefined » a
 * cote d'un titre.
 */
export function readAnnotation(annotations, key) {
  const brut = (annotations || {})[key];
  return {
    status: brut && VALIDES.has(brut.status) ? brut.status : STATUS.NONE,
    note: (brut && typeof brut.note === 'string') ? brut.note : '',
  };
}

/** Une entree qui ne dit plus rien n'a pas a occuper de place. */
function store(annotations, key, entree) {
  const next = { ...(annotations || {}) };
  if (entree.status === STATUS.NONE && !entree.note) delete next[key];
  else next[key] = entree;
  return next;
}

/**
 * Pose un etat.
 *
 * Un etat inconnu est REFUSE plutot qu'ecrit : il ne casserait rien a
 * l'ecriture, et casserait tous les comptes et tous les filtres a la lecture,
 * sans jamais lever d'erreur.
 */
export function setStatus(annotations, key, status) {
  const actuel = readAnnotation(annotations, key);
  const valide = VALIDES.has(status) ? status : STATUS.NONE;
  return store(annotations, key, { ...actuel, status: valide });
}

/**
 * Pose une note.
 *
 * Trop longue, elle est COUPEE et non refusee : refuser ferait perdre ce qui
 * vient d'etre tape.
 */
export function setNote(annotations, key, note) {
  const actuel = readAnnotation(annotations, key);
  const propre = String(note || '').trim().slice(0, MAX_NOTE);
  return store(annotations, key, { ...actuel, note: propre });
}

/** Combien de jeux dans chaque etat. Ce qui n'est pas annote ne compte pas. */
export function countByStatus(annotations) {
  const n = {};
  for (const brut of Object.values(annotations || {})) {
    const s = brut && VALIDES.has(brut.status) ? brut.status : STATUS.NONE;
    if (s === STATUS.NONE) continue;
    n[s] = (n[s] || 0) + 1;
  }
  return n;
}

/**
 * Un jeu au hasard parmi ceux qu'on voulait essayer.
 *
 * Le hasard est INJECTE, et c'est ce qui rend ce tirage testable. Un
 * `Math.random` en dur rendrait la fonction impossible a verifier -- et une
 * fonction de tirage non testee finit toujours par rendre le premier element.
 *
 * Rend null quand la liste est vide : proposer un jeu au hasard parmi rien
 * ferait ressortir un jeu deja fini, ce qui est le contraire du service rendu.
 */
export function pickToTry(keys, annotations, random = Math.random) {
  const candidats = (keys || []).filter(
    (k) => readAnnotation(annotations, k).status === STATUS.TO_TRY,
  );
  if (!candidats.length) return null;
  return candidats[Math.min(candidats.length - 1, Math.floor(random() * candidats.length))];
}
