/* Le miroir : recupere contre lance.
 *
 * « 340 jeux recuperes, 12 lances » ne dit pas d'en prendre plus. Cela dit de
 * jouer a ce qu'on a, et c'est la seule phrase de tout le produit qui retourne
 * sa proposition.
 *
 * Deux choses doivent etre justes, et les deux peuvent accuser quelqu'un a
 * tort : ne pas confondre « jamais lance » avec « hors portee », et ne pas
 * calculer un ratio sur ce qu'on ne mesure pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAMES_ORIGIN, GAMES_URL, KEY_PLAYTIME, mirror, parseGamesXml, playtimeTable,
} from '../watch/playtime.js';

/* Une reponse Steam, dans la forme documentee. Le troisieme jeu n'a PAS de
   hoursOnRecord : c'est ainsi que Steam dit « jamais lance ». */
const XML = `<?xml version="1.0"?>
<gamesList>
  <games>
    <game>
      <appID>620</appID>
      <name><![CDATA[Portal 2]]></name>
      <hoursOnRecord>34.6</hoursOnRecord>
    </game>
    <game>
      <appID>440</appID>
      <name>Team Fortress 2</name>
      <hoursOnRecord>1,204.2</hoursOnRecord>
    </game>
    <game>
      <appID>2000040</appID>
      <name>Space Menace</name>
    </game>
  </games>
</gamesList>`;

/* --------------------------------------------------------------- lecture */

test('les trois jeux sont lus, avec leur identifiant', () => {
  const jeux = parseGamesXml(XML);

  assert.deepEqual(jeux.map((j) => j.appid), ['620', '440', '2000040']);
});

test('une section CDATA ne laisse pas ses balises dans le titre', () => {
  assert.equal(parseGamesXml(XML)[0].title, 'Portal 2');
});

test('un millier d\'heures se lit malgre le separateur de milliers', () => {
  /* Steam ecrit « 1,204.2 ». Un parseFloat naif s'arrete a 1 et transforme
     mille deux cents heures de jeu en une seule -- donc un joueur assidu en
     quelqu'un qui n'a jamais lance le jeu. */
  assert.ok(Math.abs(parseGamesXml(XML)[1].hours - 1204.2) < 0.01);
});

test('« jamais lance » se distingue de « zero heure »', () => {
  /* Steam OMET le champ pour un jeu jamais lance. Le lire comme zero
     confondrait deux etats differents : zero peut vouloir dire « lance deux
     minutes ». */
  assert.equal(parseGamesXml(XML)[2].hours, null);
});

test('une reponse vide ou abimee ne fait rien exploser', () => {
  for (const brut of ['', null, '<gamesList></gamesList>', 'pas du xml du tout']) {
    assert.deepEqual(parseGamesXml(brut), []);
  }
});

test('un bloc sans identifiant est ignore', () => {
  assert.deepEqual(parseGamesXml('<game><name>Sans id</name></game>'), []);
});

/* ---------------------------------------------------------------- table */

test('la table ne garde que l\'identifiant et les heures', () => {
  /* Une bibliotheque Steam compte des milliers d'entrees : chaque champ garde
     s'y paie autant de fois, et le titre vit deja dans la collection. */
  const table = playtimeTable(parseGamesXml(XML));

  assert.deepEqual(Object.keys(table).sort(), ['2000040', '440', '620']);
  assert.equal(table['2000040'], null);
});

/* --------------------------------------------------------------- miroir */

test('le miroir compte ce qui est lance et ce qui ne l\'est pas', () => {
  const m = mirror({
    library: {
      a: { store: 'steam', id: '620', title: 'Portal 2' },
      b: { store: 'steam', id: '2000040', title: 'Space Menace' },
    },
    playtime: { 620: 34.6, 2000040: null },
  });

  assert.equal(m.claimed, 2);
  assert.equal(m.covered, 2);
  assert.equal(m.played, 1);
  assert.equal(m.never, 1);
  assert.equal(m.rate, 50);
});

test('un jeu d\'un AUTRE magasin n\'est pas « jamais lance »', () => {
  /* Le test le plus important du fichier. GOG et Epic ne publient aucun temps
     de jeu : compter leurs acquisitions comme ignorees accuserait
     l'utilisateur de ne pas jouer a des jeux qu'on ne sait tout simplement pas
     mesurer. */
  const m = mirror({
    library: {
      a: { store: 'steam', id: '620' },
      b: { store: 'gog', id: '1207' },
      c: { store: 'epic', id: 'tyranny' },
    },
    playtime: { 620: 34.6 },
  });

  assert.equal(m.claimed, 3, 'les trois sont bien des acquisitions');
  assert.equal(m.covered, 1, 'une seule est mesurable');
  assert.equal(m.never, 0);
});

test('le ratio porte sur ce qui est couvert, jamais sur le total', () => {
  /* Le calculer sur le total ferait passer trois magasins sans temps de jeu
     pour trois magasins de jeux jamais lances. */
  const m = mirror({
    library: {
      a: { store: 'steam', id: '620' },
      b: { store: 'gog', id: '1' },
      c: { store: 'gog', id: '2' },
      d: { store: 'gog', id: '3' },
    },
    playtime: { 620: 10 },
  });

  assert.equal(m.rate, 100, 'un sur un, et non un sur quatre');
});

test('un jeu Steam absent de la reponse n\'est pas compte', () => {
  /* La liste ne porte que ce que le profil expose. Un jeu manquant veut dire
     « pas de reponse », pas « jamais lance ». */
  const m = mirror({
    library: { a: { store: 'steam', id: '999999' } },
    playtime: { 620: 10 },
  });

  assert.equal(m.covered, 0);
  assert.equal(m.rate, null, 'pas de ratio sans mesure');
});

test('un seuil permet d\'ignorer les jeux a peine ouverts', () => {
  /* Trente minutes ne sont pas une partie. Le seuil est un reglage, pas une
     valeur en dur, parce que la reponse depend du genre de jeu. */
  const lib = { a: { store: 'steam', id: '620' } };

  assert.equal(mirror({ library: lib, playtime: { 620: 0.3 }, minutesPlayed: 0 }).played, 1);
  assert.equal(mirror({ library: lib, playtime: { 620: 0.3 }, minutesPlayed: 30 }).never, 1);
});

test('une bibliotheque vide ne rend pas un ratio de zero', () => {
  /* Zero pour cent sur rien ferait croire que rien n'est jamais lance. */
  assert.equal(mirror({}).rate, null);
});

/* ------------------------------------------------------------ les adresses */

test('la cle vit dans l\'espace de la veille et l\'hote est hors manifeste', () => {
  assert.ok(KEY_PLAYTIME.startsWith('veille:'));
  assert.match(GAMES_URL, /^https:\/\/steamcommunity\.com\/my\/games/);
  assert.equal(GAMES_ORIGIN, 'https://steamcommunity.com/*');
});

test('l\'adresse passe par /my/, donc sans identifiant a stocker', () => {
  /* Steam resout /my/ cote serveur vers le profil connecte : aucun nom de
     profil a demander, aucun identifiant a garder. */
  assert.ok(GAMES_URL.includes('/my/'));
  assert.ok(GAMES_URL.includes('xml=1'));
});
