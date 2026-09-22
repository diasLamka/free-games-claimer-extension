/* L'empaquetage : ce qui part chez l'utilisateur, et ce qui reste ici.
 *
 * Le depot n'a jamais produit d'archive. Le seul mode d'installation
 * documente est « Mode developpeur, charger l'extension non empaquetee »,
 * ce qui exclut tout le monde sauf un developpeur -- et prive TOUS les
 * installes des correctifs, y compris les quatre correctifs de securite de
 * la 2.24.0.
 *
 * Deux risques symetriques, et ce fichier tient les deux :
 *
 *  1. EMPAQUETER TROP PEU. C'est la famille ERR_FILE_NOT_FOUND, revenue
 *     trois fois dans ce depot : Chrome charge l'extension sans broncher,
 *     puis le popup s'ouvre vide. Une page ouverte a l'execution --
 *     journal.html, collection.html -- n'est citee par AUCUN manifeste :
 *     une fermeture calculee depuis le seul manifeste les oublierait
 *     toutes les six.
 *
 *  2. EMPAQUETER TROP. Publier src/core, build/ et test/ livre le moteur
 *     en double et 40 fichiers qui n'ont rien a faire chez l'utilisateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

import {
  candidatsAEmpaqueter,
  fichiersDuPaquet,
  fichiersOublies,
  manquants,
  construireZip,
  archive,
} from '../build/package.mjs';

/** Les chemins tels qu'ils apparaitront DANS l'archive. */
function nomsDansLeZip(variante) {
  return new Set(fichiersDuPaquet(variante).map((e) => e.dansLeZip));
}

/* -------------------------------------------------- ce qui doit y etre */

test('la fermeture Chrome porte le manifeste, le worker et le popup', () => {
  const noms = nomsDansLeZip('chrome');

  assert.ok(noms.has('manifest.json'), 'manifest.json');
  assert.ok(noms.has('background.js'), 'background.js');
  assert.ok(noms.has('popup.html'), 'popup.html');
  assert.ok(noms.has('popup.js'), 'popup.js');
});

test('la fermeture suit les imports du service worker jusqu\'a la veille', () => {
  const noms = nomsDansLeZip('chrome');

  /* background.js importe watch/cycle.js, qui importe watch/catalog.js, qui
     importe watch/offer.js. Trois niveaux : une fermeture qui s'arrete au
     premier laisserait le worker mourir a l'import. */
  assert.ok(noms.has('watch/cycle.js'), 'watch/cycle.js');
  assert.ok(noms.has('watch/catalog.js'), 'watch/catalog.js');
  assert.ok(noms.has('watch/offer.js'), 'watch/offer.js');
  assert.ok(noms.has('watch/schedule/scheduler.js'), 'watch/schedule/scheduler.js');
  assert.ok(noms.has('watch/sources/epic.js'), 'watch/sources/epic.js');
});

test('les six pages ouvertes a l\'execution sont du voyage', () => {
  const noms = nomsDansLeZip('chrome');

  /* Aucune n'est citee par un manifeste : elles s'ouvrent par
     chrome.tabs.create ou chrome.offscreen.createDocument, depuis une
     chaine litterale. C'est exactement le cas qu'une fermeture naive rate. */
  for (const page of ['journal.html', 'collection.html', 'sentinel.html',
    'diagnostics.html', 'offscreen-html.html', 'probe-offscreen.html']) {
    assert.ok(noms.has(page), page);
  }
});

test('le moteur genere, la passerelle et les icones sont du voyage', () => {
  const noms = nomsDansLeZip('chrome');

  assert.ok(noms.has('free-games-claimer.js'), 'free-games-claimer.js');
  assert.ok(noms.has('gm-shim.js'), 'gm-shim.js');
  for (const icone of ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']) {
    assert.ok(noms.has(icone), icone);
  }
});

test('les deux locales partent ensemble', () => {
  const noms = nomsDansLeZip('chrome');

  /* default_locale vaut « en ». Ne prendre que la langue par defaut
     livrerait une extension anglaise a un navigateur francais, sans erreur
     et sans recours. */
  assert.ok(noms.has('_locales/en/messages.json'), '_locales/en/messages.json');
  assert.ok(noms.has('_locales/fr/messages.json'), '_locales/fr/messages.json');
});

/* ------------------------------------------------- ce qui doit rester ici */

test('rien de l\'atelier ne part : ni source du moteur, ni build, ni test', () => {
  const noms = [...nomsDansLeZip('chrome')];

  /* src/core porte le moteur en 34 morceaux, et l'artefact genere est deja
     du voyage : le publier une seconde fois doublerait le poids du paquet
     pour livrer exactement le meme code. */
  const atelier = noms.filter((n) => /^(src|build|test|docs|\.github)\//.test(n));
  assert.deepEqual(atelier, [], 'aucun fichier d\'atelier');
});

test('ni la documentation, ni le manifeste npm', () => {
  const noms = nomsDansLeZip('chrome');

  for (const hors of ['README.md', 'CHANGELOG.md', 'ROADMAP.md', 'SECURITY.md',
    'package.json', '.gitattributes', 'icon.svg']) {
    assert.ok(!noms.has(hors), `${hors} ne doit pas etre publie`);
  }
});

test('les artefacts ecrits hors du depot ne sont jamais atteignables', () => {
  const noms = [...nomsDansLeZip('chrome')];

  /* Le build ecrit free-games-claimer.user.js et test.txt dans le dossier
     PARENT du depot. Un chemin qui remonte signerait une fermeture qui a
     suivi une reference vers l'exterieur. */
  const dehors = noms.filter((n) => n.startsWith('..') || n.includes('/../'));
  assert.deepEqual(dehors, [], 'aucun chemin hors du depot');
});

/* ------------------------------------------------------------- Firefox */

test('Firefox embarque son manifeste sous le nom que la plateforme exige', () => {
  const entrees = fichiersDuPaquet('firefox');
  const noms = new Set(entrees.map((e) => e.dansLeZip));

  /* Une extension n'a qu'un manifeste, et il s'appelle manifest.json. Le
     depot en garde deux parce que MV3 diverge entre les deux navigateurs ;
     l'archive, elle, n'en porte qu'un. */
  assert.ok(noms.has('manifest.json'), 'manifest.json');
  assert.ok(!noms.has('manifest.firefox.json'), 'pas de manifest.firefox.json dans l\'archive');

  const manifeste = entrees.find((e) => e.dansLeZip === 'manifest.json');
  assert.equal(manifeste.surDisque, 'manifest.firefox.json');
});

test('Firefox emporte le code, quelle que soit la forme de son bloc background', () => {
  const noms = new Set(fichiersDuPaquet('firefox').map((e) => e.dansLeZip));

  /* Firefox ne declare pas toujours son fond comme Chrome : « scripts »
     plutot que « service_worker ». Une lecture qui ne connait qu'une des
     deux formes rend une archive sans service worker -- une extension qui
     s'installe, et qui ne fait rien. */
  assert.ok(noms.has('background.js'), 'background.js');
  assert.ok(noms.has('watch/cycle.js'), 'watch/cycle.js');
  assert.ok(noms.has('popup.html'), 'popup.html');
  assert.ok(noms.has('free-games-claimer.js'), 'free-games-claimer.js');
});

/* ------------------------------------------------------ le garde anti-oubli */

test('aucun fichier d\'execution du depot n\'est laisse sur le quai', () => {
  /* Le vrai risque n'est pas la liste d'aujourd'hui, c'est celle de demain :
     une page ajoutee et ouverte par chrome.tabs.create, mais jamais inscrite
     dans PAGES_A_L_EXECUTION. Elle marcherait en mode developpeur -- le
     dossier entier est charge -- et seulement la, ce qui est le pire des
     cas : casse en production, vert en developpement. */
  assert.deepEqual(fichiersOublies('chrome'), []);
  assert.deepEqual(fichiersOublies('firefox'), []);
});

test('le garde nomme ce qui manque, au lieu de se taire', () => {
  const candidats = ['background.js', 'nouvelle-page.html', 'watch/cycle.js'];
  const empaquetes = new Set(['background.js', 'watch/cycle.js']);

  assert.deepEqual(manquants(candidats, empaquetes), ['nouvelle-page.html']);
});

test('le garde ignore l\'atelier, qui n\'a pas vocation a etre publie', () => {
  /* src/core/12-ui.js est du code d'execution, mais il part deja concatene
     dans free-games-claimer.js. Le compter pour manquant refuserait tout
     empaquetage a jamais. */
  const candidats = candidatsAEmpaqueter();

  assert.ok(candidats.includes('background.js'), 'background.js est un candidat');
  assert.ok(candidats.includes('watch/sources/gog.js'), 'watch/sources/gog.js est un candidat');
  assert.ok(!candidats.some((c) => c.startsWith('src/')), 'src/ n\'est pas candidat');
  assert.ok(!candidats.some((c) => c.startsWith('build/')), 'build/ n\'est pas candidat');
  assert.ok(!candidats.some((c) => c.startsWith('test/')), 'test/ n\'est pas candidat');
});

/* ------------------------------------------------------------ l'archive */

/**
 * Un lecteur de ZIP, ici et pas en production.
 *
 * Le depot n'a aucune dependance, et l'archive doit etre lisible par Chrome,
 * par Firefox et par n'importe quel outil -- pas seulement par le code qui
 * l'a ecrite. Relire avec notre propre ecrivain ne prouverait que sa
 * coherence avec lui-meme. Ce lecteur part donc de la FIN, comme le fait la
 * specification : le repertoire central fait foi, pas les en-tetes locaux.
 */
function lireZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  assert.ok(eocd >= 0, 'fin de repertoire central introuvable');

  const nombre = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entrees = [];

  for (let i = 0; i < nombre; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'en-tete de repertoire central');
    const methode = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const tailleCompressee = buf.readUInt32LE(p + 20);
    const tailleBrute = buf.readUInt32LE(p + 24);
    const lNom = buf.readUInt16LE(p + 28);
    const lExtra = buf.readUInt16LE(p + 30);
    const lComm = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lNom);

    assert.equal(buf.readUInt32LE(offset), 0x04034b50, `en-tete local de ${nom}`);
    const lNomLocal = buf.readUInt16LE(offset + 26);
    const lExtraLocal = buf.readUInt16LE(offset + 28);
    const debut = offset + 30 + lNomLocal + lExtraLocal;
    const brut = buf.subarray(debut, debut + tailleCompressee);

    const octets = methode === 0 ? Buffer.from(brut) : inflateRawSync(brut);
    assert.equal(octets.length, tailleBrute, `taille annoncee de ${nom}`);
    assert.equal(crc32(octets) >>> 0, crc >>> 0, `somme de controle de ${nom}`);

    entrees.push({ nom, octets });
    p += 46 + lNom + lExtra + lComm;
  }
  return entrees;
}

test('l\'archive se relit entiere, octet pour octet', () => {
  const source = [
    { nom: 'manifest.json', octets: Buffer.from('{"manifest_version":3}', 'utf8') },
    { nom: 'watch/cycle.js', octets: Buffer.from('export const x = 1;\r\n'.repeat(200), 'utf8') },
    { nom: 'icon16.png', octets: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]) },
  ];

  const relu = lireZip(construireZip(source));

  assert.deepEqual(relu.map((e) => e.nom), source.map((e) => e.nom));
  for (let i = 0; i < source.length; i++) {
    assert.ok(relu[i].octets.equals(source[i].octets), source[i].nom);
  }
});

test('un fichier vide traverse l\'archive sans la casser', () => {
  /* Taille nulle et somme de controle nulle : le cas ou une longueur mal
     ecrite ne se voit sur aucun octet de contenu. */
  const relu = lireZip(construireZip([{ nom: 'vide.txt', octets: Buffer.alloc(0) }]));

  assert.equal(relu.length, 1);
  assert.equal(relu[0].octets.length, 0);
});

test('deux empaquetages de la meme entree rendent le meme octet', () => {
  /* Ce depot compare deja le moteur au bit pres a chaque build. Une archive
     horodatee a l'heure courante rendrait deux paquets differents pour un
     code identique, et personne ne pourrait verifier qu'un zip publie
     correspond bien a un commit. */
  const source = [{ nom: 'a.js', octets: Buffer.from('const a = 1;', 'utf8') }];

  assert.ok(construireZip(source).equals(construireZip(source)));
});

test('les chemins de l\'archive vont dans le sens de la barre oblique', () => {
  /* La specification ZIP impose « / », y compris pour une archive produite
     sous Windows. Une barre inverse donne un fichier nomme « watch\cycle.js »
     a la racine, et un import qui ne resout plus. */
  const relu = lireZip(construireZip([
    { nom: 'watch/schedule/clock.js', octets: Buffer.from('x', 'utf8') },
  ]));

  assert.equal(relu[0].nom, 'watch/schedule/clock.js');
});

/* --------------------------------------------- l'archive du vrai depot */

test('le moteur genere traverse l\'archive sans perdre un octet', () => {
  /* free-games-claimer.js est ecrit en latin1 par le build, et il porte des
     echappements \uXXXX pour les libelles accentues. Le lire en utf8 pour
     l'empaqueter remplacerait chaque octet haut par U+FFFD -- un moteur qui
     ne reconnait plus aucun bouton, sans la moindre erreur au chargement. */
  const relu = lireZip(archive('chrome'));
  const moteur = relu.find((e) => e.nom === 'free-games-claimer.js');

  assert.ok(moteur, 'free-games-claimer.js est dans l\'archive');
  assert.ok(moteur.octets.equals(readFileSync('free-games-claimer.js')));
});

test('une icone PNG traverse l\'archive sans perdre un octet', () => {
  const relu = lireZip(archive('chrome'));
  const icone = relu.find((e) => e.nom === 'icon128.png');

  assert.ok(icone, 'icon128.png est dans l\'archive');
  assert.ok(icone.octets.equals(readFileSync('icon128.png')));
});

test('l\'archive Firefox porte bien le manifeste de Firefox', () => {
  const relu = lireZip(archive('firefox'));
  const manifeste = relu.find((e) => e.nom === 'manifest.json');

  assert.ok(manifeste.octets.equals(readFileSync('manifest.firefox.json')));
  assert.ok(JSON.parse(manifeste.octets.toString('utf8')).browser_specific_settings);
});

test('les deux archives portent le meme numero de version que package.json', () => {
  const attendue = JSON.parse(readFileSync('package.json', 'utf8')).version;

  for (const variante of ['chrome', 'firefox']) {
    const relu = lireZip(archive(variante));
    const manifeste = JSON.parse(
      relu.find((e) => e.nom === 'manifest.json').octets.toString('utf8'),
    );
    assert.equal(manifeste.version, attendue, variante);
  }
});
