/* Migration du schema 1 vers le schema 2 : les champs persistes passent en
 * anglais.
 *
 * Pourquoi ce module existe.
 *
 * Le catalogue, l'etat des sources, les reglages et les filtres sont ecrits
 * dans storage.local sous forme d'objets JSON dont les CLES sont les noms de
 * champs du code. Renommer `valeurMinimale` en `minWorth` ne casse donc rien de
 * visible : le code relit un champ qui n'existe plus, trouve `undefined`, et
 * applique sa valeur par defaut. Le seuil de l'utilisateur revient a zero, son
 * plancher a trois, son interrupteur d'autonomie a la valeur d'usine -- sans
 * une seule erreur dans la console.
 *
 * Une migration silencieuse qui perd des reglages est pire qu'un plantage :
 * personne ne la remarque avant d'avoir reperdu ses reglages.
 *
 * Ce qui n'est PAS migre, et pourquoi.
 *
 *   - Les cles de stockage ('veille:offres', 'FGC_pending_codes'...). Une cle
 *     est une donnee, pas un nom de variable. La renommer rendrait invisibles
 *     les codes GOG en attente d'une installation existante, et l'interface
 *     elle-meme rappelle qu'un code perdu est un jeu perdu. Le gain serait
 *     cosmetique et invisible ; le risque, une perte reelle.
 *   - Les cles du catalogue ('epic:witchfire', 'gog:titre:xyz'). Ce sont des
 *     identifiants construits, pas des champs.
 *   - Les VALEURS. Seules les cles d'objet bougent.
 *
 * Module pur : aucune API d'extension. La plomberie est dans storage.js, ce qui
 * rend la transformation testable sur des formes reelles.
 */
import { FIELD_RENAMES } from './field-renames.js';

/**
 * Renomme recursivement les cles d'objet presentes dans `map`.
 *
 * Les tableaux sont parcourus, leurs elements transformes. Tout ce qui n'est ni
 * objet ni tableau est rendu tel quel : c'est une valeur.
 *
 * Une cle absente de la table est conservee sous son nom. Une migration ne
 * jette rien -- meme un champ qu'on ne reconnait pas est peut-etre un champ
 * qu'une version plus recente ecrira.
 */
export function renameFields(value, map = FIELD_RENAMES) {
  if (Array.isArray(value)) return value.map((v) => renameFields(v, map));
  if (value === null || typeof value !== 'object') return value;

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    const renamed = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
    out[renamed] = renameFields(inner, map);
  }
  return out;
}

/**
 * Cles dont le CONTENU porte des noms de champs francais.
 *
 * Volontairement enumerees et non deduites du prefixe : une cle ajoutee plus
 * tard doit etre ajoutee ici sciemment, apres avoir verifie que ses champs sont
 * bien des champs et non des identifiants construits.
 */
export const MIGRATED_KEYS = Object.freeze([
  'veille:offres',
  'veille:sources',
  'veille:stats',
  'veille:reglages',
  'veille:calendriers',
  'veille:etat',
  'veille:filtres',
  'veille:cadence-reclamation',
]);

/**
 * Construit le correctif a ecrire, depuis ce qui est stocke.
 *
 * Rend un objet pret pour un seul `set()`, plus le compte de ce qui a bouge --
 * l'appelant l'ecrit dans son journal, et un compte de zero sur une
 * installation garnie est le signe que quelque chose ne va pas.
 *
 * Les cles absentes ne sont pas creees : migrer un catalogue vide reviendrait a
 * ecrire `{}` par-dessus rien, et a faire croire a une installation initialisee.
 */
export function buildV2Patch(stored = {}) {
  const patch = {};
  let changed = 0;

  for (const key of MIGRATED_KEYS) {
    const before = stored[key];
    if (before === undefined || before === null) continue;

    const after = renameFields(before);
    // Comparaison par serialisation : les formes sont petites (quelques
    // dizaines d'offres) et l'egalite structurelle est ce qu'on veut savoir.
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    patch[key] = after;
    changed++;
  }

  return { patch, changed };
}
