/* Applique build/rename-map.mjs au depot.
 *
 *   node build/rename.mjs --dry     -> montre ce qui bougerait
 *   node build/rename.mjs           -> applique
 *
 * Pourquoi un tokeniseur et pas un sed.
 *
 * Un remplacement par expression reguliere avec frontieres de mots touche trois
 * choses qu'il ne doit pas toucher :
 *
 *   - les commentaires, qui sont de la prose francaise et deviendraient un
 *     charabia mi-francais mi-anglais (« une offer par magasin ») ;
 *   - les chaines, dont les cles de storage.local : renommer 'veille:offres'
 *     rend invisibles les codes GOG en attente d'une installation existante ;
 *   - l'interieur des litteraux d'expression reguliere.
 *
 * On ne renomme donc que les jetons IDENTIFIANTS -- voir build/tokenizer.mjs,
 * qui entre bien dans les ${...} des gabarits, parce que ceux-la sont du code.
 *
 * Quatre garde-fous, chacun paye par une erreur reelle de ce meme script :
 *   1. table injective ;
 *   2. aller-retour du tokeniseur identique au bit pres ;
 *   3. aucune cible deja presente comme identifiant libre dans le meme fichier ;
 *   4. syntaxe valide apres coup.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, rmdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CONSTANTES, NOMS, FICHIERS, CHEMINS } from './rename-map.mjs';
import { renameIdentifiers, freeIdentifiers, roundTrips } from './tokenizer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const prefixe = DRY ? '[a blanc] ' : '';

/* --- la table ---------------------------------------------------------------- */

const MAP = { ...CONSTANTES, ...NOMS };

// Injectivite : deux noms francais qui tombent sur le meme nom anglais donnent
// soit une erreur de syntaxe, soit une capture silencieuse. La seconde ne se
// voit pas, donc on refuse avant d'ecrire quoi que ce soit.
const inverse = new Map();
for (const [fr, en] of Object.entries(MAP)) {
  if (inverse.has(en)) {
    console.error(`TABLE NON INJECTIVE : « ${inverse.get(en)} » et « ${fr} » visent tous deux « ${en} »`);
    process.exit(1);
  }
  inverse.set(en, fr);
}

// Une cible qui est aussi une source ferait dependre le resultat de l'ordre.
for (const en of inverse.keys()) {
  if (en in MAP && MAP[en] !== en) {
    console.error(`CHAINE DE RENOMMAGE : « ${en} » est a la fois cible et source`);
    process.exit(1);
  }
}

/* --- chemins d'import ------------------------------------------------------- */

/**
 * Reecrit les specificateurs de module. Ce sont des chaines, donc le tokeniseur
 * les a sautees ; elles ont leur passe a elles.
 *
 * Les remplacements s'appliquent en cascade sur le meme chemin, donc les cles de
 * CHEMINS ne portent PAS de prefixe « ./ » : './planning/horaires.js' devient
 * './schedule/horaires.js' au premier passage, et './horaires.js' n'y matche
 * plus. C'est exactement l'erreur que ce commentaire evite de refaire.
 */
function renameImports(src) {
  return src.replace(/(from\s+|import\s+|import\()(['"])([^'"]+)\2/g, (all, tete, q, chemin) => {
    let neuf = chemin;
    for (const [avant, apres] of Object.entries(CHEMINS)) {
      if (neuf.includes(avant)) neuf = neuf.split(avant).join(apres);
    }
    return `${tete}${q}${neuf}${q}`;
  });
}

/* --- parcours --------------------------------------------------------------- */

const IGNORE = new Set(['node_modules', '.git', 'build', 'docs', '_locales']);

/* HTML est exclu volontairement. Le tokeniseur est un tokeniseur JavaScript :
   lache sur du HTML il renommerait des mots de prose francaise dans les
   paragraphes et des fragments de noms de classe CSS (« .jeu-titre » devenant
   « .jeu-title »). popup.html est deja reecrit en anglais ; diagnostics.html
   n'a rien a renommer. */
const EXTENSIONS = /\.(js|mjs|json)$/;

/* Artefacts generes, temoins figes, et les fichiers deja ecrits en anglais. */
const EXCLUS = new Set([
  'free-games-claimer.js',
  'popup.js',
  'i18n.js',
  'i18n-tables.js',
  'watch/field-renames.js',
  'package-lock.json',
]);

function lister(dir, acc = []) {
  for (const nom of readdirSync(dir)) {
    if (IGNORE.has(nom)) continue;
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) lister(p, acc);
    else if (EXTENSIONS.test(nom)) acc.push(p);
  }
  return acc;
}

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const fichiers = lister(ROOT).filter((p) => !EXCLUS.has(rel(p)));

/* --- invariant du tokeniseur ------------------------------------------------ */

/**
 * Passe a vide, le tokeniseur doit rendre chaque fichier octet pour octet.
 *
 * C'est le seul controle qui detecte une erreur de contexte. Une apostrophe
 * dans « il n'y a rien » au milieu d'un gabarit a fait prendre le reste du
 * fichier pour une chaine, et le renommage sortait un fichier tronque qui
 * passait quand meme --check ailleurs. Un renommage refuse coute cinq minutes ;
 * un renommage silencieusement tronque coute la confiance dans tout le lot.
 */
const nonReversibles = fichiers
  .filter((p) => !p.endsWith('.json'))
  .filter((p) => !roundTrips(readFileSync(p, 'utf8')))
  .map(rel);

if (nonReversibles.length) {
  console.error('TOKENISEUR : aller-retour non identique sur');
  for (const f of nonReversibles) console.error('  - ' + f);
  process.exit(1);
}

/* --- collisions reelles ----------------------------------------------------- */

/**
 * Un nom anglais DEJA present comme identifiant libre dans un fichier ou l'on
 * introduit ce meme nom est une collision.
 *
 * Le cas dangereux : `suite` -> `then` alors que le fichier a deja une liaison
 * `then`. Une table injective ne le voit pas, parce que la collision n'est pas
 * entre deux entrees de la table mais entre une entree et le code existant.
 *
 * Libre veut dire : ni `objet.then`, ni `{ then: ... }`. Un `title` local
 * coexiste sans peine avec un `offre.title`, et compter ces deux cas rendait le
 * controle inutilisable -- 36 fausses alertes pour 2 vraies.
 */
const collisions = [];
for (const p of fichiers) {
  if (p.endsWith('.json')) continue;
  const presents = freeIdentifiers(readFileSync(p, 'utf8'));
  for (const [fr, en] of Object.entries(MAP)) {
    if (fr === en) continue;
    if (presents.has(fr) && presents.has(en)) {
      collisions.push(`${rel(p)} : « ${fr} » -> « ${en} », mais « ${en} » y est deja`);
    }
  }
}
if (collisions.length) {
  console.error('COLLISIONS :');
  for (const c of collisions) console.error('  - ' + c);
  console.error("\nCorriger la table avant d'appliquer.");
  process.exit(1);
}

/* --- reecriture ------------------------------------------------------------- */

let touches = 0;
for (const p of fichiers) {
  const avant = readFileSync(p, 'utf8');
  // Le JSON n'a pas d'identifiants : seuls ses chemins peuvent bouger.
  const apres = p.endsWith('.json')
    ? renameImports(avant)
    : renameImports(renameIdentifiers(avant, MAP));
  if (avant === apres) continue;
  touches++;
  if (!DRY) writeFileSync(p, apres, 'utf8');
}

/* --- deplacements ----------------------------------------------------------- */

const deplaces = [];
for (const [avant, apres] of Object.entries(FICHIERS)) {
  const src = join(ROOT, avant);
  const dst = join(ROOT, apres);
  try { statSync(src); } catch { continue; }
  deplaces.push(`${avant} -> ${apres}`);
  if (DRY) continue;
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
}

// Les dossiers vides laisses derriere. Du plus profond au plus haut.
if (!DRY) {
  for (const d of ['veille/planning', 'veille/sources', 'veille']) {
    try { rmdirSync(join(ROOT, d)); } catch { /* pas vide, ou deja parti */ }
  }
}

/* La table de champs pour la migration est generee par build/build.mjs, qui
   compose les trois passes de renommage. Elle l'etait ici, mais une seule
   passe ne suffit pas : voir le commentaire la-bas. */

/* --- controle de syntaxe ---------------------------------------------------- */

if (!DRY) {
  /* src/core est exclu : ses 34 modules sont des FRAGMENTS d'une seule IIFE,
     ouverte par 00-prologue.js et fermee par 99-epilogue.js. Aucun ne parse
     seul, et c'est voulu. Le moteur se verifie sur son concatene, par
     build/verify-rename.mjs. */
  const aVerifier = lister(ROOT)
    .filter((p) => /\.(js|mjs)$/.test(p))
    .filter((p) => !EXCLUS.has(rel(p)))
    .filter((p) => !rel(p).startsWith('src/core/'));

  const casses = [];
  for (const p of aVerifier) {
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      casses.push(`${rel(p)} : ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ').trim()}`);
    }
  }
  if (casses.length) {
    console.error('SYNTAXE CASSEE apres renommage :');
    for (const c of casses) console.error('  - ' + c);
    process.exit(1);
  }
}

console.log(`${prefixe}fichiers reecrits : ${touches}`);
console.log(`${prefixe}fichiers deplaces : ${deplaces.length}`);
for (const d of deplaces) console.log('  ' + d);
console.log(`table             : ${Object.keys(MAP).length} noms, injective`);
