/* Les cles qui signent l'appli Android ne vivent pas dans le depot.
 *
 * Elles y ont vecu (android/keystore/, avec leurs mots de passe) : quiconque lisait
 * le depot pouvait signer une « mise a jour » que l'appli installe sans geste,
 * apres seulement avoir verifie que la signature est la sienne. Depuis, les cles
 * et leurs mots de passe sont des secrets du workflow android.yml, ecrits dans
 * android/keystore/ le temps du build ; ce dossier est ignore par git.
 *
 * Seule la chaine de rotation (android/signing/lineage.bin : ancienne cle ->
 * nouvelle) est dans le depot : elle ne contient que des certificats, publics.
 *
 * Ce fichier tient quatre choses, pour que personne ne remette une cle par megarde :
 *  1. aucun fichier de cle ni de mots de passe n'est suivi par git ;
 *  2. git ignore android/keystore/ ;
 *  3. le workflow lit les deux cles dans les secrets, resigne avec la chaine de
 *     rotation, et refuse de publier un APK qui n'est pas signe par nos cles ;
 *  4. la chaine de rotation est la, et le workflow la reference.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: racine, encoding: 'utf8' });
const workflow = () => readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');

test('aucune cle de signature ni mot de passe de cle n\'est suivi par git', () => {
  const suivis = git('ls-files', '-z').split('\0').filter(Boolean);
  const cles = suivis.filter((f) => /\.(jks|keystore|p12|pfx)$/i.test(f) || /(^|\/)keystore[-\w]*\.properties$/i.test(f));
  assert.deepEqual(cles, [], `fichiers de signature suivis par git : ${cles.join(', ')}`);
});

test('git ignore android/keystore/', () => {
  // `git check-ignore` rend 0 quand le chemin est ignore, 1 sinon.
  const chemins = [
    'android/keystore/release.jks', 'android/keystore/keystore.properties',
    'android/keystore/release-next.jks', 'android/keystore/keystore-next.properties',
  ];
  for (const chemin of chemins) {
    let ignore = true;
    try { git('check-ignore', '--quiet', chemin); } catch { ignore = false; }
    assert.ok(ignore, `${chemin} n'est pas ignore`);
  }
});

test('le workflow android lit les deux cles dans les secrets et verifie la signature de l\'APK', () => {
  const yml = workflow();
  const secrets = [
    'ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
    'ANDROID_NEXT_KEYSTORE_BASE64', 'ANDROID_NEXT_KEYSTORE_PASSWORD', 'ANDROID_NEXT_KEY_ALIAS', 'ANDROID_NEXT_KEY_PASSWORD',
  ];
  for (const secret of secrets) {
    assert.match(yml, new RegExp(`secrets\\.${secret}\\b`), `${secret} n'est pas lu dans les secrets`);
  }
  assert.match(yml, /apksigner"?\s+verify\b/, 'la signature de l\'APK n\'est pas verifiee');
  assert.match(yml, /SIGNING_SHA256/, 'l\'empreinte attendue du certificat n\'est pas dans le workflow');
  assert.match(yml, /SIGNING_ORIGIN_SHA256/, 'l\'empreinte de la cle d\'origine n\'est pas dans le workflow');
});

test('la chaine de rotation est dans le depot et le workflow resigne avec elle', () => {
  const chaine = new URL('../android/signing/lineage.bin', import.meta.url);
  assert.ok(existsSync(chaine), 'android/signing/lineage.bin manque');
  assert.ok(statSync(chaine).size > 500, 'android/signing/lineage.bin est vide ou tronquee');
  assert.match(git('ls-files', 'android/signing/lineage.bin'), /lineage\.bin/, 'lineage.bin n\'est pas suivi par git');
  assert.match(workflow(), /--lineage\s+android\/signing\/lineage\.bin/, 'le workflow ne resigne pas avec la chaine de rotation');
  assert.match(workflow(), /--next-signer/, 'le workflow ne signe pas avec la nouvelle cle');
});

test('les empreintes du workflow sont des SHA-256 et la nouvelle n\'est pas l\'ancienne', () => {
  const yml = workflow();
  const lire = (nom) => yml.match(new RegExp(`${nom}: '([0-9A-F:]+)'`))?.[1];
  const nouvelle = lire('SIGNING_SHA256');
  const origine = lire('SIGNING_ORIGIN_SHA256');
  for (const f of [nouvelle, origine]) assert.match(f ?? '', /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/, `empreinte mal formee : ${f}`);
  assert.notEqual(nouvelle, origine);
});
