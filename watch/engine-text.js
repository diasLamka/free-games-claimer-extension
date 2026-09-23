/* Les textes du moteur, dans la langue du lecteur (2.55.0).
 *
 * Le moteur est ecrit en ASCII (build/build.mjs le refuse autrement) et ne
 * sait pas quelle langue lit l'utilisateur. Il ecrivait donc ses phrases en
 * francais sans accents pour tout le monde -- « Tous les jeux gratuits de la
 * semaine sont deja recuperes », meme dans une interface en allemand.
 *
 * Il ne compose plus de phrase : `uiText('engX', valeurs...)` rend une PIECE,
 * { key, args }. Deux lecteurs la composent :
 *   - le lanceur, pour l'etat du moteur (bouton, bulle, panneau), avec les
 *     modeles que ce module prepare (engineTemplates) ;
 *   - le worker, pour les notifications (composeEngineText).
 *
 * Une piece vient d'un script de contenu, donc d'une page de magasin : elle
 * est verifiee comme une donnee externe. Seule une cle `eng...` est lue, et
 * ses valeurs sont des chaines bornees.
 *
 * Module PUR.
 */

export const ENGINE_PREFIX = 'eng';
export const MAX_ARGS = 6;
export const MAX_ARG_LENGTH = 300;
export const MAX_TEXT_LENGTH = 1000;

/** Une piece, verifiee ; null si ce n'en est pas une. */
export function readPiece(p) {
  if (!p || typeof p !== 'object' || typeof p.key !== 'string') return null;
  if (!/^eng[A-Za-z0-9]{1,60}$/.test(p.key)) return null;
  const args = Array.isArray(p.args)
    ? p.args.slice(0, MAX_ARGS).map((a) => String(a ?? '').slice(0, MAX_ARG_LENGTH))
    : [];
  return { key: p.key, args };
}

/**
 * Le texte d'une notification du moteur : une chaine (moteur d'avant la
 * 2.55.0, gardee telle quelle), une piece, ou plusieurs pieces mises bout a
 * bout.
 */
export function composeEngineText(text, t) {
  if (typeof text === 'string') return text.slice(0, MAX_TEXT_LENGTH);
  const pieces = (Array.isArray(text) ? text : [text]).map(readPiece).filter(Boolean);
  return pieces.map((p) => t(p.key, ...p.args)).join(' ').slice(0, MAX_TEXT_LENGTH);
}

/** Le titre d'une notification du moteur, avec un vrai tiret. */
export function engineTitle(title) {
  return String(title || 'Free Games Claimer').replace(/ -- /g, ' — ').slice(0, 120);
}

/**
 * Les modeles des etats du moteur, pour le lanceur : chaque phrase avec ses
 * `$1`..`$4` intacts, qu'il remplit lui-meme. Les notifications n'y sont pas
 * -- le lanceur ne les affiche jamais.
 */
export function engineTemplates(t, keys) {
  const out = {};
  for (const k of keys) {
    if (!k.startsWith(ENGINE_PREFIX) || k.startsWith('engNotify')) continue;
    out[k] = t(k, '$1', '$2', '$3', '$4');
  }
  return out;
}
