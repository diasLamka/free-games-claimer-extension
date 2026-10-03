/* La cle qui signe l'appli Android ne vit pas dans le depot.
 *
 * Elle y a vecu (android/keystore/, avec ses mots de passe) : quiconque lisait
 * le depot pouvait signer une « mise a jour » que l'appli installe sans geste,
 * apres seulement avoir verifie que la signature est la sienne. Depuis, la cle
 * et ses mots de passe sont des secrets du workflow android.yml, ecrits dans
 * android/keystore/ le temps du build ; ce dossier est ignore par git.
 *
 * Ce fichier tient trois choses, pour que personne ne la remette par megarde :
 *  1. aucun fichier de cle ni de mots de passe n'est suivi par git ;
 *  2. git ignore android/keystore/ ;
 *  3. le workflow lit la cle dans les secrets, et refuse de publier un APK
 *     qui n'est pas signe par la bonne cle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: racine, encoding: 'utf8' });

test('aucune cle de signature ni mot de passe de cle n\'est suivi par git', () => {
  const suivis = git('ls-files', '-z').split('\0').filter(Boolean);
  const cles = suivis.filter((f) => /\.(jks|keystore|p12|pfx)$/i.test(f) || /(^|\/)keystore\.properties$/i.test(f));
  assert.deepEqual(cles, [], `fichiers de signature suivis par git : ${cles.join(', ')}`);
});

test('git ignore android/keystore/', () => {
  // `git check-ignore` rend 0 quand le chemin est ignore, 1 sinon.
  for (const chemin of ['android/keystore/release.jks', 'android/keystore/keystore.properties']) {
    let ignore = true;
    try { git('check-ignore', '--quiet', chemin); } catch { ignore = false; }
    assert.ok(ignore, `${chemin} n'est pas ignore`);
  }
});

test('le workflow android lit la cle dans les secrets et verifie la signature de l\'APK', () => {
  const yml = readFileSync(new URL('../.github/workflows/android.yml', import.meta.url), 'utf8');
  for (const secret of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    assert.match(yml, new RegExp(`secrets\\.${secret}\\b`), `${secret} n'est pas lu dans les secrets`);
  }
  assert.match(yml, /apksigner"?\s+verify\b/, 'la signature de l\'APK n\'est pas verifiee');
  assert.match(yml, /SIGNING_SHA256/, 'l\'empreinte attendue du certificat n\'est pas dans le workflow');
});
