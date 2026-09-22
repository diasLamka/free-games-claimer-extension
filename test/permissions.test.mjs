/* La veille s'arretait avec la derniere fenetre.
 *
 * Le depot n'avait aucune infrastructure de permission optionnelle : pas de
 * clef `optional_permissions` dans les deux manifestes, pas un seul appel a
 * `permissions.request`, et la note du popup annoncait « seulement tant que
 * Chrome est ouvert » en dur, sans jamais proposer autre chose.
 *
 * Une nuance honnete, et elle vaut d'etre ecrite : la PREDICTION, elle, ne se
 * degrade pas pendant l'absence -- au-dela de vingt-quatre heures elle compte
 * l'observation sans la situer. Le manque est la couverture, pas
 * l'apprentissage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import {
  OPTIONAL, PERMISSION, declaresOptional, describeBackground,
} from '../watch/permissions.js';

const manifeste = (f) => JSON.parse(readFileSync(`C:/Perso/free-games-claimer-extension/${f}`, 'utf8'));

/* -------------------------------------------------------- les manifestes */

test('Chrome declare la permission de fond comme optionnelle', () => {
  /* Demander une permission absente du manifeste echoue -- silencieusement
     dans certaines versions de Chrome, ce qui est le pire cas : la case se
     coche et rien ne change. */
  assert.ok(declaresOptional(manifeste('manifest.json'), OPTIONAL.BACKGROUND));
});

test('Firefox ne la declare pas, et c\'est voulu', () => {
  /* Il ne l'implemente pas. La declarer y ferait apparaitre une case a cocher
     sans effet, ce qui est pire qu'une case absente : elle ferait croire que
     la veille tourne. Meme raisonnement que `offscreen`, deja absent la-bas. */
  assert.equal(declaresOptional(manifeste('manifest.firefox.json'), OPTIONAL.BACKGROUND), false);
});

test('elle n\'est PAS dans les permissions obligatoires', () => {
  /* Une permission du manifeste s'accepte en bloc a l'installation. Celle-ci
     doit rester un choix pose apres coup, et retirable. */
  assert.ok(!manifeste('manifest.json').permissions.includes(OPTIONAL.BACKGROUND));
});

/* ------------------------------------------------------------ l'affichage */

test('accordee : on le dit, et la case reste decochable', () => {
  const d = describeBackground({ granted: true, supported: true });

  assert.equal(d.state, PERMISSION.GRANTED);
  assert.equal(d.toggle, true, 'ce qui s\'accorde se retire');
});

test('pas encore accordee : on la propose', () => {
  const d = describeBackground({ granted: false, supported: true });

  assert.equal(d.state, PERMISSION.OFFERED);
  assert.equal(d.toggle, true);
});

test('plateforme qui l\'ignore : aucune case, et une phrase qui l\'explique', () => {
  /* Cocher sans effet est la pire des trois situations : la case fait croire
     que la veille tourne pendant que le navigateur est ferme. */
  const d = describeBackground({ granted: false, supported: false });

  assert.equal(d.state, PERMISSION.UNSUPPORTED);
  assert.equal(d.toggle, false);
  assert.ok(d.note, 'une phrase, pas un silence');
});

test('chaque etat porte sa propre phrase', () => {
  /* Trois etats et deux phrases voudraient dire qu'on en confond deux. */
  const notes = [
    describeBackground({ granted: true }).note,
    describeBackground({ granted: false }).note,
    describeBackground({ supported: false }).note,
  ];

  assert.equal(new Set(notes).size, 3);
});
