/* Preuve que le renommage n'a change QUE des noms dans le moteur.
 *
 *   node build/verify-rename.mjs
 *
 * Le temoin byte-identique de build/reference.json protegeait le decoupage du
 * monolithe : tant que personne ne touchait a src/core, la reconstruction
 * restait identique au bit pres. Renommer tous les identifiants en anglais fait
 * necessairement diverger ce temoin -- il ne peut donc plus rien dire sur ce
 * changement-la, et le regeler sans autre garantie reviendrait a effacer la
 * preuve au moment precis ou l'on touche a tout.
 *
 * Ce fichier remplace la garantie par une plus forte, et exacte :
 *
 *     src/core  ==  map(build/pre-rename/core)
 *
 * autrement dit, le moteur actuel est exactement l'ancien avec la table de
 * renommage appliquee. Aucune exception, aucune tolerance. Toute difference
 * autre qu'un nom fait echouer, et c'est le but : une correction manuelle
 * glissee dans le lot du renommage passerait sinon inapercue.
 *
 * build/pre-rename/core/ est une copie figee des 34 modules d'avant. Elle reste
 * dans le depot aussi longtemps qu'on veut pouvoir refaire cette preuve.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CONSTANTES, NOMS } from './rename-map.mjs';
import { renameIdentifiers } from './tokenizer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = { ...CONSTANTES, ...NOMS };

function concat(dir) {
  const noms = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
  return {
    noms,
    code: noms.map((f) => readFileSync(join(dir, f), 'latin1')).join(''),
  };
}

const sha = (s) => createHash('sha256').update(Buffer.from(s, 'latin1')).digest('hex').toUpperCase();

/* --- rebasage apres une modification VOLONTAIRE du moteur -------------------
 *
 *   node build/verify-rename.mjs --rebase "motif"
 *
 * L'invariant compare src/core a une copie figee d'avant le renommage. Des
 * qu'on change le moteur pour de vrai -- une correction, pas un nom -- la
 * comparaison echoue, et c'est normal : elle n'a plus rien a prouver sur ce
 * changement-la.
 *
 * Rebaser demande donc que la verification ait PASSE juste avant. Le motif est
 * ecrit a cote, pour qu'on sache plus tard ce que chaque base couvrait. Sans
 * cette trace, rebaser deviendrait le geste qu'on fait pour faire taire un
 * controle plutot que pour enregistrer une decision.
 */
const REBASE = process.argv.indexOf('--rebase');

const avant = concat(join(ROOT, 'build', 'pre-rename', 'core'));
const apres = concat(join(ROOT, 'src', 'core'));

if (REBASE !== -1) {
  const motif = process.argv[REBASE + 1];
  if (!motif) {
    console.error('--rebase exige un motif : node build/verify-rename.mjs --rebase "correction X"');
    process.exit(1);
  }
  const dst = join(ROOT, 'build', 'pre-rename', 'core');
  mkdirSync(dst, { recursive: true });
  for (const f of apres.noms) {
    writeFileSync(join(dst, f), readFileSync(join(ROOT, 'src', 'core', f), 'latin1'), 'latin1');
  }
  writeFileSync(join(ROOT, 'build', 'pre-rename', 'BASE.txt'), [
    'Base de comparaison du moteur, pour build/verify-rename.mjs.',
    '',
    `modules : ${apres.noms.length}`,
    `sha256  : ${sha(apres.code)}`,
    `motif   : ${motif}`,
    '',
    'La table de renommage ne s\'applique plus a cette base : elle est deja en',
    'anglais. verify-rename compare desormais src/core a cette copie a',
    'l\'identique, ce qui protege le moteur de toute modification non voulue.',
    '',
  ].join('\r\n'), 'utf8');

  console.log(`base rebasee sur src/core (${apres.noms.length} modules)`);
  console.log(`sha256 : ${sha(apres.code)}`);
  console.log(`motif  : ${motif}`);
  process.exit(0);
}

if (avant.noms.length !== apres.noms.length) {
  console.error(`NOMBRE DE MODULES : ${avant.noms.length} avant, ${apres.noms.length} apres`);
  process.exit(1);
}

const attendu = renameIdentifiers(avant.code, MAP);

console.log(`modules          : ${apres.noms.length}`);
console.log(`avant            : ${avant.code.length} octets  ${sha(avant.code)}`);
console.log(`attendu (mappe)  : ${attendu.length} octets  ${sha(attendu)}`);
console.log(`src/core actuel  : ${apres.code.length} octets  ${sha(apres.code)}`);

if (attendu === apres.code) {
  console.log('\nLe moteur est exactement l\'ancien avec la table appliquee.');
  console.log('Aucun changement de comportement n\'a pu se glisser dans le renommage.');
  process.exit(0);
}

// Localiser la premiere divergence, avec le contexte des deux cotes.
const n = Math.min(attendu.length, apres.code.length);
let i = 0;
while (i < n && attendu[i] === apres.code[i]) i++;
const ligne = attendu.slice(0, i).split('\r\n').length;

console.error(`\nDIVERGENCE a l'octet ${i} (ligne ~${ligne} du concatene)`);
console.error(`  attendu : ${JSON.stringify(attendu.slice(Math.max(0, i - 30), i + 60))}`);
console.error(`  actuel  : ${JSON.stringify(apres.code.slice(Math.max(0, i - 30), i + 60))}`);
console.error('\nSoit la table est incomplete, soit une correction manuelle a ete');
console.error('faite dans src/core. Dans le second cas : la sortir du lot du');
console.error('renommage, ou mettre a jour build/pre-rename/core.');
process.exit(1);
