/* Apprendre un libelle a l'extension, sans lui apprendre a payer.
 *
 * Quand un magasin refait sa page, le moteur ne reconnait plus son bouton. Le
 * canari compte les echecs, une alerte part, et ensuite plus rien : il faut
 * attendre une version. Un claimer dans un conteneur attend une nouvelle
 * image.
 *
 * Ce que ce depot rend faisable et que les autres ne rendent pas tient a une
 * decision prise bien avant : LE MOTEUR NE RECONNAIT PAS LES BOUTONS PAR LEUR
 * FORME DANS LE DOCUMENT, MAIS PAR LEUR TEXTE. `lunaClaimLabelAllowed` et
 * `gogSubmitLabelAllowed` sont deja des listes blanches de libelles, ecrites
 * ainsi parce que les formes changent a chaque refonte et pas les mots.
 *
 * Apprendre, c'est donc ajouter un mot a une liste. Pas capturer un chemin CSS
 * qui casserait au rendu suivant.
 *
 * TOUT LE DANGER EST LA, et il justifie la moitie de ce fichier : un libelle
 * appris trop large ferait cliquer un bouton payant, sur un vrai compte, sans
 * que personne ne l'ait demande. Le moteur applique deja `looksPaid` a
 * l'execution ; on refuse EN PLUS des l'apprentissage, pour qu'un libelle
 * dangereux ne dorme jamais dans le stockage en attendant une regression du
 * second garde.
 *
 * Module PUR.
 */

/**
 * Cle de stockage, dans l'espace du MOTEUR.
 *
 * C'est lui qui la lit, de facon synchrone, avant chaque clic. Il ne connait
 * que l'espace FGC_*, et une lecture asynchrone arriverait apres le clic
 * qu'elle devait autoriser. Le prix est une ligne dans ENGINE_KEYS de
 * gm-shim.js ; le prix de l'alternative serait un apprentissage que le moteur
 * n'applique jamais.
 */
export const KEY_TAUGHT = 'FGC_taught_labels';

/** Les deux parcours dont le moteur lit la liste de libelles. */
export const SURFACES = Object.freeze({
  /** Le bouton de reclamation d'une offre Amazon Luna. */
  LUNA: 'luna',
  /** Le bouton de validation du formulaire d'echange GOG. */
  GOG: 'gog',
});

const CONNUES = new Set(Object.values(SURFACES));

/**
 * Libelles conserves par surface.
 *
 * Douze est deja beaucoup. Cent libelles autorises reviendraient a n'en
 * autoriser aucun : la liste blanche cesserait d'etre une liste blanche.
 */
export const MAX_TAUGHT = 12;

/** Un libelle plus court n'a aucun pouvoir discriminant. */
const MIN_LONGUEUR = 3;
/** Au-dela, c'est une page collee, pas un libelle de bouton. */
const MAX_LONGUEUR = 80;

/**
 * Ce qui parle d'argent, et qu'on n'apprend jamais.
 *
 * Volontairement LARGE, et volontairement redondant avec le `looksPaid` du
 * moteur. Deux gardes qui disent la meme chose sont deux gardes : celui-ci
 * empeche d'ecrire, celui-la empeche de cliquer, et il faut que les deux
 * cedent pour qu'un achat parte.
 *
 * Les formes accentuees passent par leur classe de caracteres : ce module est
 * en ES moderne, mais son jumeau de lecture vit dans le moteur ASCII pur.
 */
const ARGENT = new RegExp([
  'achet', 'buy', 'panier', 'cart', 'payer', 'pay\\b', 'paiement', 'payment',
  'checkout', 'commande', 'order', 'precommand', 'pre-?order', 'purchase',
  'abonn', 'subscri', 'souscri', 'carte bancaire', 'credit card',
  // Un montant, quelle que soit la devise ou sa place.
  '[0-9][0-9.,]*\\s*(eur|usd|gbp|\\u20ac|\\$|\\u00a3)', '(eur|usd|gbp|\\u20ac|\\$|\\u00a3)\\s*[0-9]',
].join('|'), 'i');

/** La forme sous laquelle un libelle est compare : aplatie, minuscule. */
function normalise(label) {
  return String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Ce libelle serait-il accepte ?
 *
 * Rend un motif de refus plutot qu'un simple faux : l'interface doit pouvoir
 * dire « celui-la, je ne peux pas, et voici pourquoi » AVANT le clic de
 * confirmation. Un refus muet ferait croire a une panne.
 *
 * Ne modifie rien : c'est un essai, pas un apprentissage.
 */
export function wouldAccept(surface, label) {
  if (!CONNUES.has(surface)) return { ok: false, reason: 'surfaceInconnue' };

  const propre = normalise(label);
  if (propre.length < MIN_LONGUEUR) return { ok: false, reason: 'tropCourt' };
  if (propre.length > MAX_LONGUEUR) return { ok: false, reason: 'tropLong' };
  if (ARGENT.test(propre)) return { ok: false, reason: 'parleArgent' };

  return { ok: true, reason: null, label: propre };
}

/** Les libelles appris pour une surface, du plus recent au plus ancien. */
export function taughtFor(taught, surface) {
  const liste = (taught || {})[surface];
  return Array.isArray(liste) ? [...liste] : [];
}

/**
 * Apprend un libelle.
 *
 * Rend l'etat suivant ET le verdict. Un appelant qui ne regarderait que l'etat
 * ne verrait pas la difference entre « appris » et « refuse pour une bonne
 * raison », et afficherait un succes dans les deux cas.
 */
export function learn(taught, { surface, label, now } = {}) {
  const essai = wouldAccept(surface, label);
  if (!essai.ok) return { learned: false, reason: essai.reason, taught: taught || {} };

  const avant = taughtFor(taught, surface).filter((l) => l !== essai.label);
  return {
    learned: true,
    reason: null,
    taught: { ...(taught || {}), [surface]: [essai.label, ...avant].slice(0, MAX_TAUGHT) },
  };
}

/**
 * Oublie un libelle.
 *
 * Ce qui s'apprend se desapprend. Sans cela, un libelle appris par erreur
 * resterait pour toujours, et la seule issue serait de tout effacer -- donc de
 * perdre aussi ce qui marchait.
 */
export function forget(taught, surface, label) {
  const propre = normalise(label);
  return { ...(taught || {}), [surface]: taughtFor(taught, surface).filter((l) => l !== propre) };
}
