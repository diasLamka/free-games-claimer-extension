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

/* Le chemin se RESOUT depuis ce fichier, il ne s'ecrit pas.
 *
 * Un chemin absolu passe sur la machine ou il a ete ecrit et nulle part
 * ailleurs : ces trois tests etaient verts en local et rouges des le premier
 * push, sur une machine dont le disque ne s'appelle pas pareil. `import.meta.url`
 * connait sa propre position, et c'est la seule reference qui voyage. */
const manifeste = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));

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

/* ------------------------------------- les hotes demandes (2.47.0) */

import { declaresOptionalOrigin } from '../watch/permissions.js';
import { GAMES_ORIGIN } from '../watch/playtime.js';
import { originPattern, newTopicUrl } from '../watch/phone.js';

for (const f of ['manifest.json', 'manifest.firefox.json']) {
  test(`${f} declare chaque hote que le code demande`, () => {
    /* De la 2.39.0 a la 2.46.0, le temps de jeu demandait steamcommunity.com
       sans qu'aucun manifeste ne le declare : Chrome refusait, la page disait
       « acces refuse », et personne ne l'a jamais lu. */
    const m = manifeste(f);
    assert.ok(declaresOptionalOrigin(m, GAMES_ORIGIN), GAMES_ORIGIN);
    assert.ok(declaresOptionalOrigin(m, originPattern(newTopicUrl(new Array(20).fill(3)))), 'ntfy.sh');
    assert.ok(declaresOptionalOrigin(m, 'https://ntfy.example.org:8443/*'), 'un serveur ntfy prive');
  });
}

test('un hote en clair n\'est jamais couvert', () => {
  assert.equal(declaresOptionalOrigin(manifeste('manifest.json'), 'http://ntfy.sh/*'), false);
});

test('les hotes optionnels ne sont pas des hotes d\'office', () => {
  /* « https://*\/* » en permission OBLIGATOIRE donnerait a l'extension toutes
     les pages du web des l'installation. Optionnel, il ne donne que ce que
     l'utilisateur accorde, un hote a la fois. */
  for (const f of ['manifest.json', 'manifest.firefox.json']) {
    assert.ok(!manifeste(f).host_permissions.includes('https://*/*'), f);
  }
});
