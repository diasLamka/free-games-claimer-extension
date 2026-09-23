/* La passerelle locale, et les deux copies de son protocole.
 *
 * L'hote (`host/fgc-host.mjs`) doit rester un FICHIER SEUL : on le copie hors
 * du depot, et un import relatif le casserait au premier deplacement. Son
 * cadrage est donc recopie depuis `watch/bridge.js`.
 *
 * Ce fichier tient la meme promesse que ceux du pays, des codes et des libelles
 * appris : les deux implementations s'accordent sur les memes entrees. Un
 * cadrage qui diverge produirait un message illisible, sans erreur, sur un
 * canal qu'on ne peut pas observer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BRIDGE_NAME, BRIDGE_PERMISSION, PROTOCOL_VERSION,
  decodeMessages, encodeMessage, makeSnapshot,
} from '../watch/bridge.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const HOTE = fileURLToPath(new URL('../host/fgc-host.mjs', import.meta.url));

/* ------------------------------------------------------------ l'instantane */

test('l\'instantane porte sa version de protocole', () => {
  /* Un outil tiers doit pouvoir REFUSER un format qu'il ne connait pas, plutot
     que d'en deviner les champs. Meme raison que la version de schema du
     stockage. */
  assert.equal(makeSnapshot({ now: T }).protocol, PROTOCOL_VERSION);
});

test('il porte ce qu'.concat('un lanceur peut utiliser'), () => {
  const s = makeSnapshot({
    now: T,
    collection: { 'gog:1': { store: 'gog', id: '1', title: 'Tyranny', kind: 'game' } },
    library: { a: { store: 'epic', id: 'x', title: 'Cardpocalypse', ts: T } },
    outcomes: { b: { store: 'gog', id: 'y', title: 'Rate', ts: T, outcome: 'missed' } },
    playtime: { 620: 34.6 },
  });

  assert.equal(s.owned.length, 1);
  assert.equal(s.claimed.length, 1);
  assert.equal(s.missed.length, 1);
  assert.equal(s.playtime[620], 34.6);
});

test('LES CODES DE RACHAT N\'Y SONT PAS, et n\'y seront pas', () => {
  /* Le test le plus important du fichier. Un code est un PORTEUR : qui l'a,
     l'utilise. Il n'a aucune raison de traverser une frontiere de processus
     pour peupler une ludotheque. */
  const s = makeSnapshot({ now: T });
  const texte = JSON.stringify(s);

  assert.ok(!('codes' in s));
  assert.ok(!texte.includes('code'), 'aucun champ ne parle de code');
});

test('une issue PRISE n\'est pas rangee parmi les ratees', () => {
  const s = makeSnapshot({
    now: T,
    outcomes: { a: { store: 'gog', title: 'Pris', ts: T, outcome: 'taken' } },
  });

  assert.deepEqual(s.missed, []);
});

test('l\'instantane exige un instant', () => {
  assert.throws(() => makeSnapshot({}), TypeError);
});

/* ------------------------------------------------------------- le cadrage */

test('un message encode se relit', () => {
  const { messages, rest } = decodeMessages(encodeMessage({ salut: 'monde' }));

  assert.deepEqual(messages, [{ salut: 'monde' }]);
  assert.equal(rest.length, 0);
});

test('deux messages colles se relisent tous les deux', () => {
  const a = encodeMessage({ n: 1 });
  const b = encodeMessage({ n: 2 });
  const colle = new Uint8Array(a.length + b.length);
  colle.set(a, 0);
  colle.set(b, a.length);

  assert.deepEqual(decodeMessages(colle).messages, [{ n: 1 }, { n: 2 }]);
});

test('un message COUPE en deux attend la suite', () => {
  /* L'entree standard arrive par morceaux qui ne respectent aucune frontiere
     de message. Un lecteur qui supposerait un message par morceau perdrait la
     moitie de ce qu'on lui envoie, sans jamais lever d'erreur. */
  const entier = encodeMessage({ grand: 'x'.repeat(300) });
  const debut = entier.subarray(0, 100);

  const r = decodeMessages(debut);
  assert.deepEqual(r.messages, []);
  assert.equal(r.rest.length, 100, 'le debut est rendu tel quel');
});

test('un en-tete incomplet ne fait rien perdre', () => {
  const r = decodeMessages(new Uint8Array([1, 2]));

  assert.deepEqual(r.messages, []);
  assert.equal(r.rest.length, 2);
});

/* ------------------------------------------------------ l'hote, pour de vrai */

test('l\'hote ecrit ce que l\'extension lui envoie', () => {
  /* L'hote est lance comme le navigateur le lance : un programme, un flux sur
     l'entree standard. C'est la seule facon de verifier que les deux copies du
     cadrage s'accordent -- une comparaison de code source ne prouverait
     rien. */
  const sortie = join(tmpdir(), `fgc-bridge-test-${PROTOCOL_VERSION}.json`);
  try { rmSync(sortie); } catch { /* absent : c'est le cas normal */ }

  const instantane = makeSnapshot({
    now: T,
    library: { a: { store: 'gog', id: '1', title: 'Tyranny', ts: T } },
  });

  const reponse = execFileSync(process.execPath, [HOTE, sortie], {
    input: Buffer.from(encodeMessage(instantane)),
  });

  const ecrit = JSON.parse(readFileSync(sortie, 'utf8'));
  assert.equal(ecrit.protocol, PROTOCOL_VERSION);
  assert.equal(ecrit.claimed[0].title, 'Tyranny');

  /* L'accuse de reception repart cadre de la meme facon : c'est la preuve que
     l'hote sait ECRIRE le protocole autant que le lire. */
  const { messages } = decodeMessages(new Uint8Array(reponse));
  assert.equal(messages[0].ok, true);

  rmSync(sortie);
});

test('l\'hote rassemble un message arrive en plusieurs morceaux', () => {
  /* Un instantane de trois cents jeux n'arrive jamais d'un seul bloc. Sans
     tampon cote hote, aucun ne serait lisible. */
  const sortie = join(tmpdir(), `fgc-bridge-test-morceaux-${PROTOCOL_VERSION}.json`);
  try { rmSync(sortie); } catch { /* absent */ }

  const gros = makeSnapshot({
    now: T,
    library: Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`k${i}`, { store: 'gog', id: String(i), title: `Jeu ${i}`, ts: T }]),
    ),
  });

  execFileSync(process.execPath, [HOTE, sortie], { input: Buffer.from(encodeMessage(gros)) });

  assert.equal(JSON.parse(readFileSync(sortie, 'utf8')).claimed.length, 400);
  rmSync(sortie);
});

test('l\'hote ignore les arguments que Chrome lui passe (2.48.0)', () => {
  /* Chrome donne toujours l'origine de l'appelant en premier argument, et
     `--parent-window=` sous Windows. Jusqu'a la 2.47.0, l'hote prenait
     l'origine pour son chemin de sortie : l'ecriture echouait a chaque envoi. */
  const sortie = join(tmpdir(), `fgc-bridge-test-origine-${PROTOCOL_VERSION}.json`);
  try { rmSync(sortie); } catch { /* absent */ }
  const instantane = makeSnapshot({ now: T, library: {} });

  const reponse = execFileSync(process.execPath, [HOTE, 'chrome-extension://abcdefghijklmnop/', '--parent-window=0', sortie], {
    input: Buffer.from(encodeMessage(instantane)),
  });
  assert.equal(JSON.parse(readFileSync(sortie, 'utf8')).protocol, PROTOCOL_VERSION);
  assert.equal(decodeMessages(new Uint8Array(reponse)).messages[0].ok, true);
  rmSync(sortie);

  // Sans chemin, l'origine seule ne remplace pas la sortie par defaut.
  const maison = mkdtempSync(join(tmpdir(), 'fgc-maison-'));
  execFileSync(process.execPath, [HOTE, 'chrome-extension://abcdefghijklmnop/'], {
    input: Buffer.from(encodeMessage(instantane)),
    env: { ...process.env, HOME: maison, USERPROFILE: maison },
  });
  assert.equal(JSON.parse(readFileSync(join(maison, 'free-games-claimer-snapshot.json'), 'utf8')).protocol, PROTOCOL_VERSION);
  rmSync(maison, { recursive: true });
});

/* ------------------------------------------------------------- les noms */

test('le nom du canal et la permission sont ceux que le manifeste attend', () => {
  /* Un nom qui diverge du manifeste de l'hote fait echouer la connexion avec
     un message que le navigateur n'explique pas. */
  assert.equal(BRIDGE_NAME, 'com.free_games_claimer.bridge');
  assert.equal(BRIDGE_PERMISSION, 'nativeMessaging');

  const manifeste = JSON.parse(
    readFileSync(new URL('../host/com.free_games_claimer.bridge.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifeste.name, BRIDGE_NAME);
  assert.equal(manifeste.type, 'stdio');
});
