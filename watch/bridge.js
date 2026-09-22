/* La passerelle locale : l'extension devient une source de verite.
 *
 * Elle sait ce que vous possedez sur quatre magasins, ce que vous avez
 * recupere, ce qui est passe et ce que vous avez lance. Cette connaissance ne
 * sortait de nulle part : ni Playnite, ni Heroic, ni un script maison ne
 * pouvaient la lire.
 *
 * TROIS CHOSES QUE CETTE PASSERELLE N'EST PAS, et il vaut mieux les ecrire.
 *
 *  1. Ce n'est PAS un serveur. Rien n'ecoute sur un port, rien n'est joignable
 *     depuis le reseau. Un programme local recoit ce que l'extension lui
 *     envoie, sur l'entree standard, et rien d'autre ne peut lui parler.
 *
 *  2. Ce n'est PAS une mise en commun. Le non-objectif du design tient :
 *     aucune donnee ne quitte la machine, et aucun utilisateur ne voit celle
 *     d'un autre.
 *
 *  3. Ce n'est PAS automatique. L'envoi part d'un geste, la permission est
 *     optionnelle, et le programme hote doit avoir ete installe a la main.
 *     Trois obstacles, et c'est voulu : un canal vers un programme local est
 *     la chose la plus puissante qu'une extension puisse demander.
 *
 * Module PUR.
 */

/**
 * Le nom du canal.
 *
 * Il doit correspondre EXACTEMENT au nom declare dans le manifeste de l'hote,
 * sinon la connexion echoue avec un message que le navigateur n'explique pas.
 */
export const BRIDGE_NAME = 'com.free_games_claimer.bridge';

/** La permission a demander. Optionnelle, et jamais dans le manifeste. */
export const BRIDGE_PERMISSION = 'nativeMessaging';

/**
 * La version du format envoye.
 *
 * Elle accompagne CHAQUE instantane, et pas seulement la documentation : un
 * outil tiers qui lit ce fichier doit pouvoir refuser un format qu'il ne
 * connait pas, plutot que d'en deviner les champs. C'est la meme raison qui
 * fait exister `veille:schema` pour le stockage.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Ce que l'extension envoie.
 *
 * VOLONTAIREMENT PAUVRE. Chaque champ ajoute ici sort de la machine qui le
 * produit vers un programme dont l'extension ne sait rien. On envoie donc ce
 * qu'un lanceur de jeux peut utiliser, et rien de plus.
 *
 * CE QUI N'Y EST PAS, et n'y sera pas : les codes de rachat. Un code est un
 * PORTEUR -- qui l'a, l'utilise -- et il n'a aucune raison de traverser une
 * frontiere de processus pour peupler une ludotheque.
 */
export function makeSnapshot({
  collection = {}, library = {}, outcomes = {}, playtime = {}, now,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('instantane : "maintenant" est obligatoire');

  return {
    protocol: PROTOCOL_VERSION,
    at: now,
    owned: Object.values(collection || {})
      .filter((i) => i && i.store && i.id)
      .map((i) => ({ store: i.store, id: i.id, title: i.title || null, kind: i.kind || null })),
    claimed: Object.values(library || {})
      .filter((e) => e && e.store)
      .map((e) => ({ store: e.store, id: e.id || null, title: e.title || null, at: e.ts ?? null })),
    missed: Object.values(outcomes || {})
      .filter((o) => o && o.outcome === 'missed')
      .map((o) => ({ store: o.store, id: o.id || null, title: o.title || null, at: o.ts ?? null })),
    playtime: { ...(playtime || {}) },
  };
}

/* ------------------------------------------------- le cadrage du protocole */

/**
 * Le format de Chrome : quatre octets de longueur, en boutisme NATIF, puis le
 * JSON en UTF-8.
 *
 * Le boutisme natif est le piege du protocole. Sur toutes les machines qui
 * comptent aujourd'hui il est petit, mais l'ecrire en dur ferait un hote qui
 * marche partout sauf la ou il ne marche pas -- et le symptome serait un
 * message illisible, sans erreur.
 *
 * Ces deux fonctions sont RECOPIEES dans host/fgc-host.mjs, qui doit rester un
 * fichier seul : l'utilisateur le copie hors du depot. `test/bridge.test.mjs`
 * verifie que les deux copies s'accordent.
 */
export function encodeMessage(objet, { littleEndian = true } = {}) {
  const corps = new TextEncoder().encode(JSON.stringify(objet));
  const out = new Uint8Array(4 + corps.length);
  new DataView(out.buffer).setUint32(0, corps.length, littleEndian);
  out.set(corps, 4);
  return out;
}

/**
 * Lit autant de messages complets que le tampon en contient.
 *
 * Rend aussi le RESTE, et c'est le point : l'entree standard arrive par
 * morceaux qui ne respectent aucune frontiere de message. Un lecteur qui
 * supposerait un message par morceau perdrait la moitie de ce qu'on lui envoie,
 * sans jamais lever d'erreur.
 */
export function decodeMessages(buffer, { littleEndian = true } = {}) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const vue = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
    const taille = vue.getUint32(0, littleEndian);

    // Message incomplet : on s'arrete et on rend le reste tel quel.
    if (buffer.length - offset - 4 < taille) break;

    const corps = buffer.subarray(offset + 4, offset + 4 + taille);
    try {
      messages.push(JSON.parse(new TextDecoder().decode(corps)));
    } catch {
      /* Un message illisible n'arrete pas le flux : le suivant peut etre bon,
         et jeter le tampon entier ferait perdre ce qui venait apres. */
    }
    offset += 4 + taille;
  }

  return { messages, rest: buffer.subarray(offset) };
}
