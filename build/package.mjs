/* Empaquetage du paquet publiable.
 *
 *   node build/package.mjs        -> dist/*.zip pour Chrome et pour Firefox
 *
 * Ce qui part chez l'utilisateur est une LISTE BLANCHE calculee, jamais le
 * contenu du dossier. Le depot porte le moteur en deux exemplaires -- les 34
 * modules de src/core ET l'artefact genere -- plus le build, les tests, les
 * temoins figes et la documentation. Publier le dossier livrerait tout cela.
 *
 * La liste part de points d'entree et suit les references. Les points
 * d'entree sont de DEUX natures, et oublier la seconde est le piege :
 *
 *   - ce que le manifeste designe : worker, scripts de contenu, popup, icones ;
 *   - ce qui s'ouvre a l'EXECUTION, par chrome.tabs.create ou
 *     chrome.offscreen.createDocument, depuis une chaine litterale que
 *     aucun manifeste ne mentionne. Six pages sont dans ce cas.
 *
 * Une fermeture calculee depuis le seul manifeste les oublierait toutes les
 * six, et le symptome serait celui d'ERR_FILE_NOT_FOUND, revenu trois fois
 * ici : Chrome charge l'extension sans broncher, puis la page s'ouvre vide.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les pages que le code ouvre a l'execution.
 *
 * Elles ne sont citees par aucun manifeste. Tenue a la main, et c'est
 * assume : la liste est courte, et le controle de completude plus bas refuse
 * l'empaquetage si une page du depot n'est jointe par personne.
 */
const PAGES_A_L_EXECUTION = Object.freeze([
  'pages/journal.html',
  'pages/collection.html',
  'pages/sentinel.html',
  'pages/diagnostics.html',
  'pages/historique.html',
  'pages/offscreen-html.html',
  'pages/probe-offscreen.html',
]);

/** Les manifestes, par variante. La cle est le nom DANS l'archive. */
const MANIFESTE = Object.freeze({
  chrome: 'manifest.json',
  firefox: 'manifest.firefox.json',
});

function existe(chemin) {
  try { statSync(join(ROOT, chemin)); return true; } catch { return false; }
}

function lire(chemin) {
  return readFileSync(join(ROOT, chemin), 'utf8');
}

/** Resout un chemin relatif depuis le fichier qui le cite. */
function resoudre(depuis, spec) {
  return join(dirname(depuis), spec).replace(/\\/g, '/');
}

/**
 * Les fichiers qu'un manifeste designe.
 *
 * Les valeurs __MSG_*__ sont des cles de traduction, pas des chemins, et un
 * motif d'hote n'est pas un fichier.
 */
function referencesManifeste(chemin) {
  const m = JSON.parse(lire(chemin));
  const refs = [];

  /* Deux formes pour la meme chose. Chrome declare un `service_worker`,
     Firefox une liste de `scripts` -- et ne connaitre que la premiere rend
     une archive Firefox sans code de fond : une extension qui s'installe
     proprement, et qui ne fait rien. */
  if (m.background) {
    if (m.background.service_worker) refs.push(m.background.service_worker);
    refs.push(...(m.background.scripts || []));
  }
  for (const cs of m.content_scripts || []) {
    refs.push(...(cs.js || []), ...(cs.css || []));
  }
  if (m.action && m.action.default_popup) refs.push(m.action.default_popup);
  /* La page d'options porte une requete (le tableau de bord, 2.58.0) : le
     fichier est ce qui la precede. */
  for (const page of [m.options_ui && m.options_ui.page, m.options_page]) {
    if (typeof page === 'string') refs.push(page.split(/[?#]/)[0]);
  }
  for (const table of [m.action && m.action.default_icon, m.icons]) {
    if (table) refs.push(...Object.values(table));
  }
  for (const war of m.web_accessible_resources || []) {
    refs.push(...(war.resources || []));
  }
  return refs.filter((r) => typeof r === 'string' && !r.startsWith('__MSG_') && !r.includes('*'));
}

/** Toutes les locales presentes, pas seulement celle du manifeste. */
function locales() {
  return readdirSync(join(ROOT, '_locales'))
    .map((code) => `_locales/${code}/messages.json`)
    .filter(existe);
}

/**
 * Ce que ce fichier cite, s'il cite quelque chose.
 *
 * Un module ES cite ses imports relatifs ; une page cite ses sources et ses
 * feuilles. Un import nu -- 'node:fs' -- designe la plateforme, pas un
 * fichier du paquet, et un href absolu part sur le web.
 */
function references(chemin) {
  if (chemin.endsWith('.js')) {
    const src = lire(chemin);
    const re = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
    const vus = [];
    let m;
    while ((m = re.exec(src))) vus.push(resoudre(chemin, m[1]));
    return vus;
  }
  if (chemin.endsWith('.html')) {
    const src = lire(chemin);
    const re = /(?:src|href)="([^"#:]+)"/g;
    const vus = [];
    let m;
    while ((m = re.exec(src))) vus.push(resoudre(chemin, m[1]));
    return vus;
  }
  return [];
}

/**
 * La liste blanche, pour une variante.
 *
 * Rend des couples : le nom DANS l'archive, et le fichier sur le disque. Les
 * deux ne coincident que pour Chrome -- Firefox embarque
 * manifest.firefox.json sous le nom manifest.json, puisqu'une extension n'a
 * qu'un manifeste et qu'il porte toujours ce nom-la.
 */
export function fichiersDuPaquet(variante) {
  const manifeste = MANIFESTE[variante];
  if (!manifeste) throw new Error(`variante inconnue : ${variante}`);

  const paquet = new Map();
  paquet.set('manifest.json', manifeste);

  const aVoir = [
    ...referencesManifeste(manifeste),
    ...PAGES_A_L_EXECUTION,
    ...locales(),
  ];

  while (aVoir.length) {
    const chemin = aVoir.shift();
    if (paquet.has(chemin)) continue;
    if (!existe(chemin)) throw new Error(`${variante} : « ${chemin} » est cite mais n'existe pas`);
    paquet.set(chemin, chemin);
    aVoir.push(...references(chemin));
  }

  return [...paquet.entries()]
    .map(([dansLeZip, surDisque]) => ({ dansLeZip, surDisque }))
    .sort((a, b) => (a.dansLeZip < b.dansLeZip ? -1 : 1));
}

/* ------------------------------------------------------ le garde anti-oubli */

/**
 * Les dossiers d'atelier. Leur contenu ne s'empaquette jamais.
 *
 * src/ est le cas interessant : c'est bien du code d'execution, mais il part
 * DEJA, concatene dans free-games-claimer.js. Le compter pour manquant
 * refuserait tout empaquetage a jamais.
 */
const ATELIER = Object.freeze([
  'src', 'build', 'test', 'docs', '.github', '.git', 'dist', 'store',
  /* Le programme de la passerelle tourne HORS du navigateur : il s'installe
     a la main et n'a rien a faire dans l'archive de l'extension. */
  'host',
]);

/**
 * Les fichiers d'execution du depot, que l'archive DEVRAIT porter.
 *
 * Le code d'execution de ce depot tient a la racine et sous watch/. Tout
 * .js et tout .html de ces deux endroits est un candidat : s'il n'est joint
 * par personne, c'est soit un oubli, soit du code mort -- et les deux
 * meritent qu'on le dise.
 */
export function candidatsAEmpaqueter() {
  const vus = [];

  const parcourir = (relatif) => {
    for (const nom of readdirSync(join(ROOT, relatif || '.'), { withFileTypes: true })) {
      const chemin = relatif ? `${relatif}/${nom.name}` : nom.name;
      if (nom.isDirectory()) {
        if (ATELIER.includes(chemin)) continue;
        if (chemin === '_locales') continue;
        parcourir(chemin);
        continue;
      }
      if (/\.(js|html)$/.test(nom.name)) vus.push(chemin);
    }
  };

  parcourir('');
  return vus.sort();
}

/** Ceux des candidats que l'archive ne porte pas. Liste, jamais booleen. */
export function manquants(candidats, empaquetes) {
  return candidats.filter((c) => !empaquetes.has(c));
}

/**
 * Ce que l'empaquetage laisserait sur le quai.
 *
 * Le vrai risque n'est pas la liste d'aujourd'hui : c'est la page ajoutee
 * demain, ouverte par chrome.tabs.create depuis une chaine litterale, et
 * jamais inscrite dans PAGES_A_L_EXECUTION. Elle marcherait en mode
 * developpeur -- ou le dossier entier est charge -- et SEULEMENT la.
 */
export function fichiersOublies(variante) {
  const empaquetes = new Set(fichiersDuPaquet(variante).map((e) => e.surDisque));
  return manquants(candidatsAEmpaqueter(), empaquetes);
}

/* ------------------------------------------------------------- l'archive */

/**
 * Horodatage fige, et c'est le point.
 *
 * Ce depot compare deja le moteur au bit pres a chaque build. Une archive
 * horodatee a l'heure courante rendrait deux paquets differents pour un code
 * identique : personne ne pourrait verifier qu'un zip publie correspond bien
 * a un commit. 1980-01-01 00:00:00 est le plancher du format -- la plus
 * ancienne date qu'un champ MS-DOS sache ecrire.
 */
const DATE_FIGEE = 0x0021; // annee 1980, mois 1, jour 1
const HEURE_FIGEE = 0x0000;

/** Methode de compression : 8 = deflate, 0 = tel quel. */
const DEFLATE = 8;
const TEL_QUEL = 0;

/**
 * Ecrit une archive ZIP, sans dependance.
 *
 * Le format tient en trois parties : un en-tete par fichier suivi de ses
 * octets, puis un repertoire central qui les recense, puis une fin de
 * repertoire qui dit ou ce dernier commence. Un lecteur serieux part de la
 * FIN : c'est le repertoire central qui fait foi, pas les en-tetes locaux.
 *
 * Aucun descripteur de flux, aucun ZIP64, aucune entree de dossier : les
 * chemins portent leurs barres obliques et cela suffit a tous les lecteurs.
 * Un paquet d'extension ne s'approche pas des 4 Go ou ZIP64 devient
 * necessaire.
 */
export function construireZip(entrees) {
  const morceaux = [];
  const repertoire = [];
  let position = 0;

  for (const { nom, octets } of entrees) {
    const nomOctets = Buffer.from(nom, 'utf8');
    const somme = crc32(octets) >>> 0;

    /* Comprimer un fichier deja comprime -- une PNG, une icone -- le fait
       grossir. Quand le deflate ne gagne rien, on stocke tel quel : le
       format le prevoit, et le lecteur s'en moque. */
    const comprime = deflateRawSync(octets, { level: 9 });
    const gagnant = comprime.length < octets.length;
    const corps = gagnant ? comprime : octets;
    const methode = gagnant ? DEFLATE : TEL_QUEL;

    const enTete = Buffer.alloc(30);
    enTete.writeUInt32LE(0x04034b50, 0);
    enTete.writeUInt16LE(20, 4);            // version minimale du lecteur
    enTete.writeUInt16LE(0, 6);             // aucun drapeau
    enTete.writeUInt16LE(methode, 8);
    enTete.writeUInt16LE(HEURE_FIGEE, 10);
    enTete.writeUInt16LE(DATE_FIGEE, 12);
    enTete.writeUInt32LE(somme, 14);
    enTete.writeUInt32LE(corps.length, 18);
    enTete.writeUInt32LE(octets.length, 22);
    enTete.writeUInt16LE(nomOctets.length, 26);
    enTete.writeUInt16LE(0, 28);            // aucun champ supplementaire

    repertoire.push({ nomOctets, methode, somme, comprimee: corps.length, brute: octets.length, offset: position });

    morceaux.push(enTete, nomOctets, corps);
    position += enTete.length + nomOctets.length + corps.length;
  }

  const debutRepertoire = position;

  for (const e of repertoire) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);                 // version de l'ecrivain
    c.writeUInt16LE(20, 6);                 // version minimale du lecteur
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(e.methode, 10);
    c.writeUInt16LE(HEURE_FIGEE, 12);
    c.writeUInt16LE(DATE_FIGEE, 14);
    c.writeUInt32LE(e.somme, 16);
    c.writeUInt32LE(e.comprimee, 20);
    c.writeUInt32LE(e.brute, 24);
    c.writeUInt16LE(e.nomOctets.length, 28);
    c.writeUInt16LE(0, 30);                 // champ supplementaire
    c.writeUInt16LE(0, 32);                 // commentaire
    c.writeUInt16LE(0, 34);                 // disque de depart
    c.writeUInt16LE(0, 36);                 // attributs internes
    c.writeUInt32LE(0, 38);                 // attributs externes
    c.writeUInt32LE(e.offset, 42);

    morceaux.push(c, e.nomOctets);
    position += c.length + e.nomOctets.length;
  }

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(0, 4);                  // numero de ce disque
  fin.writeUInt16LE(0, 6);                  // disque du repertoire
  fin.writeUInt16LE(repertoire.length, 8);
  fin.writeUInt16LE(repertoire.length, 10);
  fin.writeUInt32LE(position - debutRepertoire, 12);
  fin.writeUInt32LE(debutRepertoire, 16);
  fin.writeUInt16LE(0, 20);                 // aucun commentaire

  morceaux.push(fin);
  return Buffer.concat(morceaux);
}

/* --------------------------------------------------- l'archive du depot */

/**
 * L'archive d'une variante, prete a etre ecrite ou envoyee.
 *
 * Les octets sont lus SANS encodage, donc tels quels. C'est la seule facon
 * correcte : free-games-claimer.js est ecrit en latin1 par le build, et les
 * icones sont binaires. Les lire en utf8 remplacerait chaque octet haut par
 * U+FFFD -- un moteur qui ne reconnait plus aucun bouton, et des icones
 * illisibles, sans la moindre erreur au chargement.
 */
export function archive(variante) {
  const oublies = fichiersOublies(variante);
  if (oublies.length) {
    throw new Error(
      `${variante} : ${oublies.length} fichier(s) d'execution hors du paquet -- ${oublies.join(', ')}`,
    );
  }

  return construireZip(fichiersDuPaquet(variante).map(({ dansLeZip, surDisque }) => ({
    nom: dansLeZip,
    octets: readFileSync(join(ROOT, surDisque)),
  })));
}

/* ----------------------------------------------------- ligne de commande */

/**
 * Ecrit les deux archives dans dist/, et rien d'autre.
 *
 * L'empreinte est affichee parce qu'elle est la seule chose qu'un
 * utilisateur puisse verifier lui-meme : l'archive etant reproductible, deux
 * personnes qui empaquettent le meme commit obtiennent le meme SHA256.
 *
 * Ce bloc ne s'execute que si le fichier est lance directement. Importe par
 * un test, il n'ecrit rien.
 */
function principal() {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const dist = join(ROOT, 'dist');
  mkdirSync(dist, { recursive: true });

  for (const variante of Object.keys(MANIFESTE)) {
    const octets = archive(variante);
    const nom = `free-games-claimer-${variante}-v${version}.zip`;
    writeFileSync(join(dist, nom), octets);

    const empreinte = createHash('sha256').update(octets).digest('hex').toUpperCase();
    const fichiers = fichiersDuPaquet(variante).length;
    console.log(`dist/${nom}`);
    console.log(`  fichiers : ${fichiers}`);
    console.log(`  octets   : ${octets.length}`);
    console.log(`  sha256   : ${empreinte}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal();
