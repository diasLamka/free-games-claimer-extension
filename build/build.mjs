/* Build du moteur Free Games Auto-Claimer.
 *
 *   node build/build.mjs            -> genere les deux artefacts
 *   node build/build.mjs --verify   -> reconstruit avec la tete historique et
 *                                      compare au fichier de reference
 *
 * Les modules de src/core sont concatenes dans l'ordre de leur nom. Ils vivent
 * tous dans la meme portee (une seule IIFE ouverte par 00-prologue.js et fermee
 * par 99-epilogue.js) : c'est ce qui permet un decoupage sans reecrire un seul
 * appel, et une garantie de reconstruction au bit pres.
 *
 * Contraintes verifiees a chaque build, parce que les trois les ont deja
 * cassees en production :
 *   - ASCII pur (v2.3.0, v2.5.0, v2.7.0 : libelles accentues non matches) ;
 *   - aucun template literal (v2.1.0 : linter Tampermonkey) ;
 *   - fins de ligne CRLF.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash as hash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
/* Temoin de non-regression.
 *
 * build/reference.json designe une copie figee du moteur. --verify la
 * reconstruit a partir des modules et compare les SHA256 : tant que personne ne
 * touche a src/core, la reconstruction doit etre identique au bit pres.
 *
 * Quand une modification VOLONTAIRE du moteur fait diverger la reference, on
 * fige une nouvelle copie avec --freeze plutot que de desactiver le controle.
 * Le fichier JSON garde la date et le motif, pour qu'on sache plus tard ce que
 * chaque temoin protegeait.
 */
const FICHE_REFERENCE = join(ROOT, 'build', 'reference.json');

function lireFicheReference() {
  return JSON.parse(readFileSync(FICHE_REFERENCE, 'utf8'));
}

const VERIFY = process.argv.includes('--verify');
const FREEZE = process.argv.includes('--freeze');

function read(p) { return readFileSync(p, 'latin1'); }
function sha(s) { return hash('sha256').update(Buffer.from(s, 'latin1')).digest('hex').toUpperCase(); }
function stripTrailingCrlf(s) { return s.endsWith('\r\n') ? s.slice(0, -2) : s; }

/* --- concatenation des modules --------------------------------------------- */

const coreDir = join(SRC, 'core');
const moduleNames = readdirSync(coreDir).filter((f) => f.endsWith('.js')).sort();
if (!moduleNames.length) throw new Error('aucun module dans src/core');

const code = stripTrailingCrlf(moduleNames.map((f) => read(join(coreDir, f))).join(''));

/* --- garde-fous ------------------------------------------------------------ */

const problems = [];

const nonAscii = [...code].filter((ch) => ch.charCodeAt(0) > 127).length;
if (nonAscii) problems.push(`${nonAscii} caractere(s) non ASCII : utiliser des echappements \\uXXXX`);

const backticks = (code.match(/`/g) || []).length;
if (backticks) problems.push(`${backticks} backtick(s) : les template literals cassent le linter Tampermonkey`);

const lfSeuls = (code.match(/(?<!\r)\n/g) || []).length;
if (lfSeuls) problems.push(`${lfSeuls} fin(s) de ligne LF sans CR : le projet est en CRLF`);

/* --- garde-fous du service worker ------------------------------------------ */

/**
 * Un service worker MV3 doit enregistrer ses listeners de facon synchrone au
 * demarrage. Un import() dynamique, ou un import statique place apres du code,
 * decale cet enregistrement : les evenements sont alors perdus, SANS message
 * d'erreur. Le symptome est une extension qui ne fait plus rien du tout.
 */
function verifierServiceWorker(fichier) {
  const src = readFileSync(join(ROOT, fichier), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')     // commentaires de bloc
    .replace(/^\s*\/\/.*$/gm, '');        // commentaires de ligne

  const ennuis = [];

  if (/\bimport\s*\(/.test(src)) {
    ennuis.push(`${fichier} : import() dynamique interdit dans un service worker`);
  }

  // Un import peut tenir sur plusieurs lignes. Sans suivre l'etat, les lignes
  // de continuation passent pour du code et l'import suivant semble mal place :
  // le garde-fou se declenchait sur sa propre naivete.
  const lignes = src.split(/\r?\n/);
  let premierCode = -1;
  let dansImport = false;
  const debutsImport = [];

  lignes.forEach((l, i) => {
    const t = l.trim();
    if (!t) return;

    if (!dansImport && /^import\b/.test(t)) {
      debutsImport.push(i);
      // Termine sur la meme ligne ? Sinon on consomme jusqu'au "from '...'".
      dansImport = !/\bfrom\s+['"][^'"]+['"]\s*;?\s*$/.test(t) && !/^import\s+['"][^'"]+['"]\s*;?\s*$/.test(t);
      return;
    }
    if (dansImport) {
      if (/\bfrom\s+['"][^'"]+['"]\s*;?\s*$/.test(t)) dansImport = false;
      return;
    }
    if (premierCode === -1) premierCode = i;
  });

  for (const i of debutsImport) {
    if (premierCode !== -1 && i > premierCode) {
      ennuis.push(`${fichier} ligne ${i + 1} : import statique place apres du code`);
    }
  }

  return ennuis;
}

problems.push(...verifierServiceWorker('background.js'));

/* --- garde-fous des references de fichiers ---------------------------------- */

/**
 * Toute reference vers un fichier du paquet doit designer un fichier qui existe.
 *
 * C'est le garde-fou contre ERR_FILE_NOT_FOUND, qui est revenu trois fois. Le
 * symptome est toujours le meme et toujours muet : Chrome charge l'extension
 * sans broncher, puis le popup s'ouvre vide, ou le service worker ne demarre
 * jamais. Rien dans la console de la page, parce que l'erreur est dans une
 * console differente de celle qu'on regarde.
 *
 * Les causes reelles, dans l'ordre ou elles se sont produites :
 *   - un dossier renomme (veille/ -> watch/) alors qu'un import le citait ;
 *   - un fichier liste dans le manifeste et jamais ecrit ;
 *   - un artefact genere absent parce que le build avait echoue avant.
 *
 * Aucune de ces trois n'aurait survecu a ce controle.
 */
function existe(chemin) {
  try { statSync(join(ROOT, chemin)); return true; } catch { return false; }
}

/** Resout un specificateur relatif depuis le fichier qui l'importe. */
function resoudre(depuis, spec) {
  return join(dirname(depuis), spec).replace(/\\/g, '/');
}

function referencesManifeste(fichier) {
  const m = JSON.parse(readFileSync(join(ROOT, fichier), 'utf8'));
  const refs = [];

  if (m.background?.service_worker) refs.push(m.background.service_worker);
  for (const cs of m.content_scripts || []) {
    refs.push(...(cs.js || []), ...(cs.css || []));
  }
  if (m.action?.default_popup) refs.push(m.action.default_popup);
  for (const table of [m.action?.default_icon, m.icons]) {
    if (table) refs.push(...Object.values(table));
  }
  for (const war of m.web_accessible_resources || []) {
    refs.push(...(war.resources || []));
  }
  // Les valeurs __MSG_*__ sont des cles i18n, pas des chemins.
  return refs.filter((r) => typeof r === 'string' && !r.startsWith('__MSG_') && !r.includes('*'));
}

for (const fichier of ['manifest.json', 'manifest.firefox.json']) {
  for (const ref of referencesManifeste(fichier)) {
    if (!existe(ref)) problems.push(`${fichier} designe « ${ref} », qui n'existe pas`);
  }
  // _locales est exige des qu'un __MSG_*__ apparait.
  const brut = readFileSync(join(ROOT, fichier), 'utf8');
  if (brut.includes('__MSG_')) {
    const defaut = JSON.parse(brut).default_locale;
    if (!defaut) problems.push(`${fichier} utilise __MSG_*__ sans default_locale`);
    else if (!existe(`_locales/${defaut}/messages.json`)) {
      problems.push(`${fichier} : _locales/${defaut}/messages.json manquant`);
    }
  }
}

/**
 * Imports statiques : chaque chemin relatif doit exister.
 *
 * Seuls les specificateurs relatifs sont verifies. Un import nu ('node:fs')
 * designe un module de la plateforme, pas un fichier du paquet.
 */
const AVEC_IMPORTS = [
  'background.js', 'popup.js', 'diagnostics.js', 'probe-offscreen.js', 'i18n.js',
  ...readdirSync(join(ROOT, 'watch')).filter((f) => f.endsWith('.js')).map((f) => `watch/${f}`),
  ...readdirSync(join(ROOT, 'watch', 'schedule')).map((f) => `watch/schedule/${f}`),
  ...readdirSync(join(ROOT, 'watch', 'sources')).map((f) => `watch/sources/${f}`),
];

for (const fichier of AVEC_IMPORTS) {
  if (!existe(fichier)) { problems.push(`fichier attendu absent : ${fichier}`); continue; }
  const src = readFileSync(join(ROOT, fichier), 'utf8');
  const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const cible = resoudre(fichier, m[1]);
    if (!existe(cible)) problems.push(`${fichier} importe « ${m[1] } » -> ${cible}, qui n'existe pas`);
  }
}

/** Sources locales citees par une page HTML de l'extension. */
for (const page of ['popup.html', 'diagnostics.html', 'probe-offscreen.html']) {
  if (!existe(page)) { problems.push(`page attendue absente : ${page}`); continue; }
  const src = readFileSync(join(ROOT, page), 'utf8');
  const re = /(?:src|href)="([^"#:]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    if (!existe(resoudre(page, m[1]))) problems.push(`${page} designe « ${m[1]} », qui n'existe pas`);
  }
}

/* --- garde-fou des references ------------------------------------------------ */

/**
 * Aucun appel vers un nom qui n'existe pas.
 *
 * `node --check` valide la syntaxe, pas les references : un appel a une fonction
 * jamais definie passe tout, et casse a l'execution. En 2.12.0, un renommage a
 * transforme `sinceText` en `since` ; du code ecrit apres appelait encore
 * l'ancien nom, et l'exception etait levee au MILIEU du rendu de la liste des
 * jeux -- donc plus aucun jeu, plus aucune vignette, sans autre explication
 * qu'une ligne rouge dans une console que personne ne regarde.
 *
 * Les tests ne couvrent pas ce cas : ils ne chargent pas popup.js, qui a besoin
 * d'un DOM.
 */
const { undefinedRefs } = await import('./undefined-refs.mjs');

for (const fichier of ['popup.js', 'background.js', 'diagnostics.js', 'i18n.js', 'probe-offscreen.js']) {
  for (const { mot, ligne } of undefinedRefs(join(ROOT, fichier))) {
    problems.push(`${fichier} ligne ~${ligne} : « ${mot} » n'est defini nulle part`);
  }
}

/* --- garde-fous i18n -------------------------------------------------------- */

/**
 * Les deux locales doivent porter exactement le meme jeu de cles, et chaque cle
 * citee par l'interface doit exister.
 *
 * Une cle absente ne casse rien : elle s'affiche telle quelle. « emptyGames »
 * en plein milieu de la liste des jeux est un bug qu'aucun test unitaire ne
 * verrait, parce que le code fonctionne parfaitement.
 */
function lireLocale(code) {
  const brut = JSON.parse(readFileSync(join(ROOT, '_locales', code, 'messages.json'), 'utf8'));
  const table = {};
  for (const [cle, valeur] of Object.entries(brut)) table[cle] = valeur.message;
  return table;
}

const LOCALES = ['en', 'fr'];
const tables = {};
for (const code of LOCALES) tables[code] = lireLocale(code);

const clesReference = new Set(Object.keys(tables.en));
for (const code of LOCALES.slice(1)) {
  const cles = new Set(Object.keys(tables[code]));
  for (const c of clesReference) if (!cles.has(c)) problems.push(`_locales/${code} : cle manquante « ${c} »`);
  for (const c of cles) if (!clesReference.has(c)) problems.push(`_locales/${code} : cle en trop « ${c} »`);
}

/**
 * Cles citees par l'interface. On lit les attributs data-i18n du HTML et les
 * appels t('...') du JavaScript -- litteraux seulement : une cle calculee ne se
 * verifie pas statiquement, et le code n'en construit aucune.
 */
function clesCitees(fichiers) {
  const vues = new Map();
  for (const f of fichiers) {
    // Sans retirer les commentaires, une phrase qui CITE la forme d'un appel --
    // « t('key') partout » dans l'en-tete de popup.js -- devient une cle
    // inconnue et refuse le build. Le controle porte sur le code.
    const src = readFileSync(join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const r of [/data-i18n="([^"]+)"/g, /data-i18n-attr="([^"]+)"/g]) {
      let m;
      while ((m = r.exec(src))) {
        // data-i18n-attr porte des paires « attribut:cle ».
        const brut = m[1].includes(':') ? m[1].split(',').map((p) => p.split(':')[1]) : [m[1]];
        for (const c of brut) if (c && c.trim()) vues.set(c.trim(), f);
      }
    }

    /* Toutes les chaines litterales d'un appel t(...), pas seulement la
       premiere. `t(actif ? 'seeLess' : 'seeAll')` en porte deux, et une regex
       ancree sur le guillemet suivant le t( n'en voyait aucune -- donc une
       faute de frappe dans une des deux passait le controle. */
    const appels = /\bt\(([^)]*)\)/g;
    let m;
    while ((m = appels.exec(src))) {
      /* En position de CLE seulement : au tout debut de l'appel, ou apres un
         « ? » ou un « : » de ternaire. Sans cette restriction,
         `t(store === 'gog' ? 'redeemOnGog' : 'openRedeemPage')` faisait passer
         « gog » pour une cle, et le build refusait un code correct. */
      const cles = /(^|[?:]\s*)'([A-Za-z][\w]*)'/g;
      let c;
      while ((c = cles.exec(m[1]))) vues.set(c[2], f);
    }
  }
  return vues;
}

/**
 * Une cle est-elle mentionnee QUELQUE PART dans le code ?
 *
 * Plus laxiste que clesCitees, et c'est voulu : certaines cles ne passent pas
 * par un appel t() mais par une table -- `claimed: ['verdictClaimed', 'ok']` --
 * puis sont resolues plus tard. Assez bon pour un avertissement, trop lache
 * pour un refus.
 */
function citeeQuelquePart(cle, sources) {
  /* Le mot, sans exiger de guillemets autour : dans le HTML les cles
     d'attribut apparaissent nues au milieu d'une valeur, comme
     `data-i18n-attr="aria-label:workingLabel"`. */
  const mot = new RegExp(`(?<![\\w$])${cle}(?![\\w$])`);
  return sources.some((src) => mot.test(src));
}

const citees = clesCitees(['popup.html', 'popup.js', 'background.js', 'watch/cycle.js']);
for (const [cle, fichier] of citees) {
  if (!clesReference.has(cle)) problems.push(`${fichier} : cle i18n inconnue « ${cle} »`);
}

/* Les cles que plus rien ne cite. Un AVERTISSEMENT, pas un refus : une cle
   ajoutee avant la feature qui l'utilisera est legitime. Mais la traduire, la
   relire et la maintenir coute, et six l'etaient deja sans que personne le
   sache. Autant que ce soit dit a chaque build. */
const MSG_MANIFESTE = new Set(['appName', 'appDesc']);
/* Les commentaires JavaScript sont retires avant le balayage laxiste : ils sont
   en prose, et « ended » dans « that is how ALREADY_OWNED ended up... » faisait
   passer une cle morte pour vivante. Le HTML garde ses commentaires -- ce qu'on
   y cherche vit dans les attributs. */
const SOURCES_I18N = ['popup.html', 'popup.js', 'background.js', 'watch/cycle.js'].map((f) => {
  const src = readFileSync(join(ROOT, f), 'utf8');
  return f.endsWith('.html')
    ? src
    : src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
});

const orphelines = [...clesReference].filter(
  (c) => !MSG_MANIFESTE.has(c) && !citeeQuelquePart(c, SOURCES_I18N),
);
if (orphelines.length) {
  console.warn(`i18n : ${orphelines.length} cle(s) que plus rien ne cite -- ${orphelines.join(', ')}`);
}

if (problems.length) {
  console.error('BUILD REFUSE :');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

/* --- verification : reconstruire l'original -------------------------------- */

const legacy = read(join(SRC, 'meta', 'legacy-header.txt'));

if (FREEZE) {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const nom = `reference-v${version}.js`;
  const contenu = legacy + code;

  writeFileSync(join(ROOT, 'build', nom), contenu, 'latin1');
  const motif = process.argv[process.argv.indexOf('--freeze') + 1] || 'non precise';
  writeFileSync(FICHE_REFERENCE, JSON.stringify({
    fichier: nom,
    sha256: sha(contenu),
    octets: contenu.length,
    version,
    motif,
  }, null, 2) + '\n', 'utf8');

  console.log(`nouveau temoin fige : build/${nom}`);
  console.log(`sha256              : ${sha(contenu)}`);
  console.log(`motif               : ${motif}`);
  process.exit(0);
}

if (VERIFY) {
  const fiche = lireFicheReference();
  const rebuilt = legacy + code;
  const original = read(join(ROOT, 'build', fiche.fichier));

  const a = sha(rebuilt);
  const b = sha(original);

  console.log(`temoin       : ${fiche.fichier} (${fiche.motif})`);
  console.log(`modules      : ${moduleNames.length}`);
  console.log(`reconstruit  : ${rebuilt.length} octets  ${a}`);
  console.log(`reference    : ${original.length} octets  ${b}`);

  if (a === b) {
    console.log('\nIDENTIQUE au bit pres. Le decoupage ne change aucun comportement.');
    process.exit(0);
  }

  // Localiser la premiere divergence pour un diagnostic immediat.
  const n = Math.min(rebuilt.length, original.length);
  let i = 0;
  while (i < n && rebuilt[i] === original[i]) i++;
  const ligne = original.slice(0, i).split('\r\n').length;
  console.error(`\nDIVERGENCE a l'octet ${i} (ligne ~${ligne})`);
  console.error(`  reference   : ${JSON.stringify(original.slice(i, i + 70))}`);
  console.error(`  reconstruit : ${JSON.stringify(rebuilt.slice(i, i + 70))}`);
  process.exit(1);
}

/* --- version : une seule source ------------------------------------------- */

// package.json fait foi. Le numero etait recopie dans cinq fichiers ; il n'y
// est plus edite a la main nulle part.
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) throw new Error(`version invalide dans package.json : ${VERSION}`);

function stampManifest(file) {
  const p = join(ROOT, file);
  const before = readFileSync(p, 'utf8');
  const after = before.replace(/("version"\s*:\s*")[^"]*(")/, `$1${VERSION}$2`);
  if (before === after) return false;
  writeFileSync(p, after, 'utf8');
  return true;
}

/* --- generation des artefacts ---------------------------------------------- */

const banner = read(join(SRC, 'meta', 'banner.txt'))
  .replace(/v\d+\.\d+\.\d+/, 'v' + VERSION);
const userscriptHeader = read(join(SRC, 'meta', 'userscript-header.txt'))
  .replace(/(@version\s+)\S+/, `$1${VERSION}`);

// userscript-header.txt s'arrete sur "// ==/UserScript==" : la ligne vide qui
// le separait du bandeau est reinjectee ici.
const contentScript = banner + code;
const userscript = userscriptHeader + '\r\n' + banner + code;

writeFileSync(join(ROOT, 'free-games-claimer.js'), contentScript, 'latin1');
// Les deux copies du userscript a la racine du lecteur restent synchronisees :
// free-games-claimer.user.js est le nom canonique, test.txt le fichier
// historiquement colle dans Tampermonkey.
writeFileSync(join(ROOT, '..', 'free-games-claimer.user.js'), userscript, 'latin1');
writeFileSync(join(ROOT, '..', 'test.txt'), userscript, 'latin1');

const manifestsTouches = ['manifest.json', 'manifest.firefox.json'].filter(stampManifest);

/* --- table de champs pour la migration -------------------------------------- */

/**
 * Les champs persistes qui ont change de nom, du francais vers leur nom final.
 *
 * Compose les TROIS passes de renommage, dans l'ordre. Sans la composition, la
 * migration mapperait `statut` vers `statusLine` -- un nom que plus aucun code
 * ne lit apres la seconde passe -- et le reglage serait perdu tout en donnant
 * l'impression d'avoir migre. Un bug de migration silencieux double la perte :
 * on perd les donnees, et on perd la trace de la perte.
 *
 * Genere a chaque build depuis build/rename-map.mjs, jamais edite a la main.
 */
const { NOMS: RENOMMAGES, PASSE_2, PASSE_3 } = await import('./rename-map.mjs');

/**
 * Noms qui n'ont JAMAIS ete des champs stockes, et qui n'ont donc rien a faire
 * dans une table de migration.
 *
 * La table de renommage couvre tous les identifiants, variables locales
 * comprises. Deux d'entre elles entrent en collision une fois composees :
 * `compte`, une variable locale de catalogue.js qui comptait des etats, tombe
 * sur `count` comme `nombre`, un vrai champ du bilan. Migrer les deux ferait
 * ecraser l'un par l'autre.
 *
 * Verifie apres exclusion : la table doit rester injective, sinon le build
 * refuse. C'est le seul controle qui empeche une migration de perdre un champ
 * en silence.
 */
const PAS_UN_CHAMP = new Set([
  'compte',      // variable locale de catalogue.js (resume par etat)
  'credible',    // variable locale de cycle.js
  'preview',     // fonction de filters.js
  'render',      // fonction du popup
  'say',         // fonction du popup
  'gauche',      // noeud DOM du popup (extremite gauche de l'axe)
  'reste',       // affichage du temps restant, jamais stocke
  'ensuite',     // continuation locale
  'suivant',     // accumulateur local
  'trouvee',     // variable locale de steam.js
  'trouves',     // variable locale de steam.js
]);

/* Chacun de ces noms a ete verifie dans build/pre-rename : aucun n'apparait
   comme cle d'objet dans le code d'avant, donc aucun n'a jamais ete ecrit dans
   storage.local. Exclure un vrai champ ici le perdrait en silence -- c'est
   exactement le risque que la table de migration existe pour couvrir. */

const champsMigres = {};
for (const [fr, pass1] of Object.entries(RENOMMAGES)) {
  if (!/^[a-z]/.test(fr)) continue;              // une CONSTANTE n'est pas un champ
  if (PAS_UN_CHAMP.has(fr)) continue;
  const pass2 = PASSE_2[pass1] ?? pass1;
  const final = PASSE_3[pass2] ?? pass2;
  if (final === fr) continue;                    // renommage identique : rien a migrer
  champsMigres[fr] = final;
}
/* Les noms que seule une passe ulterieure a touches : `debut` n'etait pas dans
 * la premiere table du tout.
 *
 * Filtre essentiel : on n'ajoute une source des passes correctives que si elle
 * n'est PAS une cible de la premiere passe. `secondOf` est un nom que la
 * premiere passe a produit ; aucune donnee stockee ne l'a jamais porte, et
 * l'inscrire ferait viser « second » a la fois par `seconde` -- le vrai champ
 * -- et par lui. `debut`, lui, est un champ que la premiere passe a manque. */
const ciblesPasse1 = new Set(Object.values(RENOMMAGES));

for (const table of [PASSE_2, PASSE_3]) {
  for (const [avant, apres] of Object.entries(table)) {
    if (!/^[a-z]/.test(avant) || PAS_UN_CHAMP.has(avant) || avant === apres) continue;
    if (ciblesPasse1.has(avant)) continue;
    if (!(avant in champsMigres)) champsMigres[avant] = apres;
  }
}

// Injectivite : deux champs francais qui visent le meme nom anglais se
// recouvrent pendant la migration, et le second gagne selon l'ordre des cles.
const parCible = new Map();
for (const [avant, apres] of Object.entries(champsMigres)) {
  if (parCible.has(apres)) {
    problems.push(`migration : « ${parCible.get(apres)} » et « ${avant} » visent tous deux « ${apres} »`);
  }
  parCible.set(apres, avant);
}
// Une cible qui reste une source ferait dependre le resultat de l'ordre.
for (const apres of parCible.keys()) {
  if (apres in champsMigres) problems.push(`migration : « ${apres} » est a la fois cible et source`);
}
if (problems.length) {
  console.error('BUILD REFUSE :');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

writeFileSync(join(ROOT, 'watch', 'field-renames.js'), [
  '/* GENERE par build/build.mjs depuis build/rename-map.mjs. Ne pas editer. */',
  '',
  '/** Champs persistes renommes au passage du schema 1 au schema 2. */',
  `export const FIELD_RENAMES = Object.freeze(${JSON.stringify(champsMigres, null, 2)});`,
  '',
].join('\r\n'), 'utf8');

/* --- tables i18n embarquees ------------------------------------------------- */

/**
 * chrome.i18n ne sait rendre que la langue de l'interface du navigateur. Un
 * choix explicite de langue dans les reglages a donc besoin des tables en clair,
 * et le harnais de test n'a pas d'objet chrome du tout.
 *
 * Le fichier est GENERE depuis _locales : c'est ce qui empeche les deux de
 * diverger. Ne pas l'editer a la main.
 */
const tablesJs = [
  '/* GENERE par build/build.mjs depuis _locales/. Ne pas editer a la main. */',
  '',
  '/** Une entree par locale, cle -> message. */',
  `export const TABLES = Object.freeze(${JSON.stringify(tables, null, 2)});`,
  '',
].join('\r\n');

writeFileSync(join(ROOT, 'i18n-tables.js'), tablesJs, 'utf8');

console.log(`version                        : ${VERSION}`);
console.log(`modules                        : ${moduleNames.length}`);
console.log(`free-games-claimer.js          : ${contentScript.length} octets`);
console.log(`../free-games-claimer.user.js  : ${userscript.length} octets`);
console.log(`../test.txt                    : ${userscript.length} octets`);
if (manifestsTouches.length) console.log(`manifestes remis a jour        : ${manifestsTouches.join(', ')}`);
console.log(`i18n-tables.js                 : ${LOCALES.length} locales, ${clesReference.size} cles`);
