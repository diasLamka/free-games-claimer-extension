/* Seconde passe de renommage : corrige les noms que la premiere a mal choisis.
 *
 *   node build/rename-pass2.mjs --dry
 *   node build/rename-pass2.mjs
 *
 * Memes garde-fous que la premiere passe -- injectivite, aller-retour du
 * tokeniseur, collisions par fichier, syntaxe -- parce que ce sont exactement
 * les memes risques.
 *
 * Une difference : src/core est EXCLU. L'invariant verifie par
 * build/verify-rename.mjs est « src/core == PASSE_1(build/pre-rename/core) », et
 * appliquer une seconde table au moteur le casserait sans rien apporter : les
 * noms a corriger sont tous dans la couche ESM.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as tables from './rename-map.mjs';
import { renameIdentifiers, freeIdentifiers, roundTrips } from './tokenizer.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

/* Quelle table appliquer. Le script sert a toutes les passes correctives : la
   premiere passe deplace des fichiers et genere des tables, celles-ci ne font
   que renommer. --table=PASSE_3 pour la suivante. */
const NOM_TABLE = (process.argv.find((a) => a.startsWith('--table=')) || '--table=PASSE_2').slice(8);
const TABLE = tables[NOM_TABLE];
if (!TABLE) {
  console.error(`table inconnue : ${NOM_TABLE}`);
  process.exit(1);
}

/* --- injectivite ------------------------------------------------------------ */

const inverse = new Map();
for (const [avant, apres] of Object.entries(TABLE)) {
  if (inverse.has(apres)) {
    console.error(`NON INJECTIVE : « ${inverse.get(apres)} » et « ${avant} » visent « ${apres} »`);
    process.exit(1);
  }
  inverse.set(apres, avant);
}

/* --- parcours --------------------------------------------------------------- */

const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

function lister(dir, acc = []) {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) lister(p, acc);
    else if (/\.(js|mjs)$/.test(nom)) acc.push(p);
  }
  return acc;
}

const fichiers = [
  ...lister(join(ROOT, 'watch')),
  ...lister(join(ROOT, 'test')).filter((p) => /\.mjs$/.test(p)),
  join(ROOT, 'background.js'),
  join(ROOT, 'pages/diagnostics.js'),
  /* popup.js n'est ici que pour la premiere passe corrective, ou il portait
     encore quelques noms issus de la table. Il est ecrit en anglais des le
     depart, et il garde des replis DELIBERES vers les anciens noms de champs
     (`w.start ?? w.debut`) pour le cas ou il s'ouvre avant que le service
     worker n'ait migre le stockage. Renommer ces replis les replierait sur
     eux-memes, ce qui les supprimerait en silence. */
  ...(NOM_TABLE === 'PASSE_2' ? [join(ROOT, 'pages/popup.js')] : []),
];

/* --- garde-fous ------------------------------------------------------------- */

const casses = [];

for (const p of fichiers) {
  if (!roundTrips(readFileSync(p, 'utf8'))) casses.push(`tokeniseur : ${rel(p)}`);
}

for (const p of fichiers) {
  const presents = freeIdentifiers(readFileSync(p, 'utf8'));
  for (const [avant, apres] of Object.entries(TABLE)) {
    if (presents.has(avant) && presents.has(apres)) {
      casses.push(`${rel(p)} : « ${avant} » -> « ${apres} », mais « ${apres} » y est deja`);
    }
  }
}

if (casses.length) {
  for (const c of casses) console.error('  - ' + c);
  process.exit(1);
}

/* --- reecriture ------------------------------------------------------------- */

let touches = 0;
for (const p of fichiers) {
  const avant = readFileSync(p, 'utf8');
  const apres = renameIdentifiers(avant, TABLE);
  if (avant === apres) continue;
  touches++;
  if (!DRY) writeFileSync(p, apres, 'utf8');
}

if (!DRY) {
  const mauvais = [];
  for (const p of fichiers) {
    try {
      execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    } catch (e) {
      mauvais.push(`${rel(p)} : ${String(e.stderr || e.message).split('\n').slice(0, 2).join(' ').trim()}`);
    }
  }
  if (mauvais.length) {
    console.error('SYNTAXE CASSEE :');
    for (const m of mauvais) console.error('  - ' + m);
    process.exit(1);
  }
}

console.log(`${DRY ? '[a blanc] ' : ''}fichiers reecrits : ${touches} / ${fichiers.length}`);
console.log(`table             : ${Object.keys(TABLE).length} corrections`);
