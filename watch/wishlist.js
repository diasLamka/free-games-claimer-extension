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
 * La liste de souhaits STEAM, importee avec Ma collection (2.46.0).
 *
 * A PART de la liste saisie, et pour trois raisons :
 *
 *   - c'est une PHOTOGRAPHIE : chaque importation la remplace entiere, pour
 *     qu'un jeu retire de la liste Steam cesse d'etre attendu ici. Melangee a
 *     la saisie, elle ne pourrait se remplacer sans emporter ce que
 *     l'utilisateur a tape lui-meme ;
 *   - le coeur du popup ne sait retirer qu'un souhait SAISI. Un souhait
 *     importe se retire sur Steam, ou il reviendrait a l'importation suivante ;
 *   - sa borne n'est pas la meme : une liste Steam de huit cents jeux existe,
 *     une saisie a la main de huit cents titres non.
 */
export const KEY_STEAM_WISHLIST = 'veille:souhaits-steam';

/**
 * Nombre de souhaits Steam conserves.
 *
 * Chaque souhait coute une comparaison par offre et par cycle, soit quelques
 * dizaines de milliers au pire : rien. La borne protege le stockage d'une
 * reponse aberrante, pas le processeur.
 */
export const MAX_STEAM_WISHES = 2000;

/**
 * La liste de souhaits GOG (2.66.0), importee avec la bibliotheque GOG de Ma
 * collection. Meme regle que Steam : une photographie, remplacee a chaque
 * importation reussie, et qui se retire sur GOG.
 */
export const KEY_GOG_WISHLIST = 'veille:souhaits-gog';

/** D'ou vient le souhait qui designe une offre. */
export const WISH_ORIGIN = Object.freeze({ MANUAL: 'manual', STEAM: 'steam', GOG: 'gog' });

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
 * La photographie d'une liste importee -- Steam ou GOG --, prete a etre
 * stockee.
 *
 * `entries` : [{ id, title }], l'identifiant du magasin (appid Steam, numero
 * de produit GOG) et le nom -- ou null quand le magasin n'en a rendu aucun. Un
 * souhait sans nom reste : il reconnait encore une offre de SON magasin par
 * son identifiant, il ne reconnait simplement pas le meme jeu offert ailleurs.
 */
export function makeImportedWishlist(entries, normalise, now) {
  const norm = requireNormalise(normalise);
  const vus = new Set();
  const out = [];
  for (const e of entries || []) {
    const id = e && e.id !== undefined && e.id !== null ? String(e.id) : '';
    if (!/^\d+$/.test(id) || vus.has(id)) continue;
    vus.add(id);
    const title = e.title ? String(e.title).trim() : '';
    out.push({ id, title: title || null, key: (title && norm(title)) || null });
    if (out.length >= MAX_STEAM_WISHES) break;
  }
  return { at: now, wishes: out };
}

/** Le nom d'avant la 2.66.0, quand seule la liste Steam s'importait. */
export const makeSteamWishlist = makeImportedWishlist;

/** Les souhaits d'une photographie stockee, ou aucun. */
export function steamWishes(stored) {
  return stored && Array.isArray(stored.wishes) ? stored.wishes : [];
}

/** L'identifiant d'une offre DANS SON magasin, tel qu'une liste importee le porte. */
function storeIdOf(offer, store) {
  if (!offer || offer.store !== store) return null;
  if (store === 'steam' && offer.storeId) return String(offer.storeId);
  // Chez GOG, `storeId` est le slug ; le numero de produit est `sourceId`.
  if (store === 'gog' && offer.source === 'gog' && offer.sourceId) return String(offer.sourceId);
  return null;
}

/** Cette liste importee attend-elle l'offre ? Par identifiant chez son magasin, par titre ailleurs. */
function importedMatch(stored, store, offer, key) {
  const importes = steamWishes(stored);
  if (!importes.length) return false;
  const id = storeIdOf(offer, store);
  if (id && importes.some((w) => w.id === id)) return true;
  return Boolean(key) && importes.some((w) => w.key === key);
}

/**
 * Qui attend cette offre : la saisie, Steam, ou personne (null).
 *
 * La saisie gagne quand les deux l'attendent : c'est elle que le coeur du
 * popup sait retirer, et il doit pouvoir le faire.
 *
 * Cote Steam, deux rapprochements : l'APPID exact pour une offre Steam -- il
 * reconnait le jeu sous un titre traduit -- et le TITRE normalise pour tout le
 * reste, parce que le cas qui compte est le jeu de la liste Steam offert sur
 * Epic ou GOG. Un titre qui se ressemble a tort coute une annonce prioritaire
 * de trop, jamais un jeu rate : c'est pour cela qu'un souhait peut se fier au
 * titre, et le filtre « deja possede » jamais.
 */
export function wishOrigin(list, offer, normalise, steam = null, gog = null) {
  if (!offer) return null;
  const key = offer.title ? normalise(offer.title) : '';
  if (key && wishes(list).some((w) => w.key === key)) return WISH_ORIGIN.MANUAL;
  if (importedMatch(steam, 'steam', offer, key)) return WISH_ORIGIN.STEAM;
  if (importedMatch(gog, 'gog', offer, key)) return WISH_ORIGIN.GOG;
  return null;
}

/**
 * Cette offre est-elle attendue ?
 *
 * Une liste vide ne rend jamais rien attendu -- le cas du premier jour, ou
 * tout rendre prioritaire ferait de la nouveaute une regression.
 */
export function isWished(list, offer, normalise, steam = null, gog = null) {
  return wishOrigin(list, offer, normalise, steam, gog) !== null;
}

/**
 * Pose le drapeau sur un lot d'offres, sans rien toucher d'autre.
 *
 * Le drapeau est DERIVE, jamais persiste comme une decision : la liste peut
 * changer entre deux cycles, et une offre marquee une fois pour toutes
 * resterait prioritaire apres le retrait du souhait.
 */
export function markWished(offers, list, normalise, steam = null, gog = null) {
  return (offers || []).map((o) => ({ ...o, wished: isWished(list, o, normalise, steam, gog) }));
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
