#!/usr/bin/env node
/* L'hote de la passerelle : il recoit, il ecrit un fichier, il se tait.
 *
 *   node host/fgc-host.mjs [chemin de sortie]
 *
 * Il est lance par le NAVIGATEUR, jamais par vous. Chrome le demarre quand
 * l'extension se connecte, lui parle sur l'entree standard, et le tue quand la
 * connexion se ferme. Voir host/README.md pour l'installer.
 *
 * FICHIER SEUL, DELIBEREMENT. Il n'importe rien du depot, parce qu'on le copie
 * hors du depot -- un import relatif le casserait au premier deplacement. Le
 * cadrage du protocole est donc recopie depuis watch/bridge.js, et
 * test/bridge.test.mjs verifie que les deux copies s'accordent.
 *
 * CE QU'IL NE FAIT PAS, et c'est la moitie de son interet :
 *   - il n'ouvre aucun port, n'ecoute rien, ne parle a personne d'autre ;
 *   - il ne renvoie rien a l'extension, sinon un accuse de reception ;
 *   - il n'ecrit QUE le fichier qu'on lui a designe.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/* La sortie par defaut : un fichier dans le dossier personnel. Un chemin
   passe en argument le remplace, ce qui permet a chacun de le poser la ou son
   lanceur de jeux ira le lire. */
const SORTIE = process.argv[2] || join(homedir(), 'free-games-claimer-snapshot.json');

/* --- cadrage : quatre octets de longueur, boutisme natif, puis du JSON --- */

const PETIT_BOUTISME = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function encodeMessage(objet) {
  const corps = Buffer.from(JSON.stringify(objet), 'utf8');
  const entete = Buffer.alloc(4);
  if (PETIT_BOUTISME) entete.writeUInt32LE(corps.length, 0);
  else entete.writeUInt32BE(corps.length, 0);
  return Buffer.concat([entete, corps]);
}

function decodeMessages(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const taille = PETIT_BOUTISME ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
    if (buffer.length - offset - 4 < taille) break;

    const corps = buffer.subarray(offset + 4, offset + 4 + taille);
    try { messages.push(JSON.parse(corps.toString('utf8'))); } catch { /* on continue */ }
    offset += 4 + taille;
  }
  return { messages, rest: buffer.subarray(offset) };
}

/* ------------------------------------------------------------- la boucle */

let tampon = Buffer.alloc(0);

process.stdin.on('data', (morceau) => {
  /* L'entree standard arrive par morceaux qui ne respectent aucune frontiere
     de message. Sans ce tampon, un instantane de trois cents jeux arriverait
     en plusieurs paquets et aucun ne serait lisible. */
  tampon = Buffer.concat([tampon, morceau]);

  const { messages, rest } = decodeMessages(tampon);
  tampon = rest;

  for (const message of messages) {
    try {
      writeFileSync(SORTIE, `${JSON.stringify(message, null, 2)}\n`, 'utf8');
      process.stdout.write(encodeMessage({ ok: true, written: SORTIE }));
    } catch (e) {
      /* L'erreur repart vers l'extension plutot que dans le vide : un hote qui
         echoue en silence laisse l'utilisateur devant un bouton qui a l'air
         d'avoir marche. */
      process.stdout.write(encodeMessage({ ok: false, error: String((e && e.message) || e) }));
    }
  }
});

/* Chrome ferme l'entree standard quand la connexion se termine. On sort
   proprement plutot que de rester en memoire jusqu'a la fin de la session. */
process.stdin.on('end', () => process.exit(0));
