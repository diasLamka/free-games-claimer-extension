/* La liste de souhaits : la premiere fois que l'utilisateur dit ce qu'il VEUT.
 *
 * Jusqu'a la 2.31.0 il ne pouvait exprimer qu'un refus -- la croix, qui exclut
 * un titre pour toujours. L'extension savait tout de ce qu'il ne voulait pas,
 * et rien de ce qu'il attendait.
 *
 * UN SOUHAIT PORTE SUR UN TITRE, jamais sur une offre, et c'est precisement
 * son interet : le jeu attendu depuis des mois n'est dans aucun catalogue. Le
 * souhait doit survivre a son absence, et se reconnaitre le jour ou il parait,
 * sur n'importe quel magasin. Un souhait accroche a une offre disparaitrait
 * avec elle.
 *
 * Module PUR. La normalisation lui est passee -- la meme que celle du
 * rapprochement d'offres -- plutot qu'importee : ce module ne doit rien savoir
 * du modele d'offre pour rester testable seul.
 */

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_WISHLIST = 'veille:souhaits';

/**
 * Nombre de souhaits conserves.
 *
 * Deux cents titres couvrent largement une liste d'attente reelle. La borne
 * existe parce que la liste est comparee a chaque offre de chaque cycle : sans
 * plafond, une importation malheureuse la rendrait couteuse sans que personne
 * ne voie pourquoi.
 */
export const MAX_WISHES = 200;

/**
 * Ce qu'on garde d'un souhait.
 *
 * Le titre TEL QUE SAISI pour l'affichage, et sa forme normalisee pour le
 * rapprochement. Garder les deux evite de renormaliser a chaque comparaison,
 * et surtout de montrer a l'utilisateur la forme aplatie de ce qu'il a ecrit.
 */
function makeWish(title, key) {
  return { title: String(title).trim(), key };
}

/** Les souhaits, du plus recent au plus ancien. */
export function wishes(list) {
  return Array.isArray(list) ? [...list] : [];
}

/**
 * Ajoute un souhait, en tete.
 *
 * Idempotent sur la forme NORMALISEE : « Hollow Knight: Silksong » et
 * « hollow knight silksong » sont le meme souhait. Deux entrees pour un seul
 * jeu voudraient dire deux annonces prioritaires pour une seule offre.
 */
export function addWish(list, title, normalise) {
  const key = requireNormalise(normalise)(title);
  if (!key) return wishes(list);

  const reste = wishes(list).filter((w) => w.key !== key);
  return [makeWish(title, key), ...reste].slice(0, MAX_WISHES);
}

/** Retire un souhait, quelle que soit la forme sous laquelle on le nomme. */
export function removeWish(list, title, normalise) {
  const key = requireNormalise(normalise)(title);
  return wishes(list).filter((w) => w.key !== key);
}

/**
 * Cette offre est-elle attendue ?
 *
 * Une liste vide ne rend jamais rien attendu -- le cas du premier jour, ou
 * tout rendre prioritaire ferait de la nouveaute une regression.
 */
export function isWished(list, offer, normalise) {
  const titre = offer && offer.title;
  if (!titre) return false;
  const key = normalise(titre);
  if (!key) return false;
  return wishes(list).some((w) => w.key === key);
}

/**
 * Pose le drapeau sur un lot d'offres, sans rien toucher d'autre.
 *
 * Le drapeau est DERIVE, jamais persiste comme une decision : la liste peut
 * changer entre deux cycles, et une offre marquee une fois pour toutes
 * resterait prioritaire apres le retrait du souhait.
 */
export function markWished(offers, list, normalise) {
  return (offers || []).map((o) => ({ ...o, wished: isWished(list, o, normalise) }));
}

/**
 * Aucune normalisation par defaut, et c'est delibere.
 *
 * Un repli faible -- minuscules et espaces, sans la ponctuation -- ferait de
 * « Hollow Knight: Silksong » et « hollow knight silksong » deux souhaits
 * distincts. L'erreur ne leverait rien : elle produirait deux annonces
 * prioritaires pour un seul jeu, ou pire, un souhait qui ne reconnait jamais
 * l'offre qu'il attend.
 *
 * Exiger la fonction oblige chaque appelant a passer CELLE du modele d'offre,
 * qui est la seule avec laquelle le rapprochement veut dire quelque chose.
 */
function requireNormalise(normalise) {
  if (typeof normalise !== 'function') {
    throw new TypeError('souhaits : la normalisation des titres est obligatoire');
  }
  return normalise;
}
