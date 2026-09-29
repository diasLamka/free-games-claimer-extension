/* Le modele commun des alertes mises en page (2.99.3).
 *
 * Telegram parle en HTML, Discord en Markdown ; ce qu'ils ont a dire est la
 * meme chose. Ce module lit une alerte -- `{ title, message, tags, icons }`,
 * telle que les producteurs l'ecrivent depuis toujours -- et en tire des
 * NOEUDS, sans un seul signe de balisage :
 *
 *   game      « Titre -- Magasin[ -- encore 2 h] » : une carte de jeu ;
 *   mobile    « Titre -- Android, iOS » : un jeu mobile ;
 *   incident  « phrase (motif technique) » : une panne ;
 *   label     « Recuperes : A, B » : une etiquette et sa valeur ;
 *   icon      une ligne que le producteur a marquee d'une icone ;
 *   note      le reste.
 *
 * Chaque service n'a plus qu'a habiller les noeuds a sa maniere
 * (watch/telegram-format.js, watch/discord-format.js) : les regles de lecture
 * -- ce qui est un magasin, un delai, une plateforme -- ne vivent qu'ici.
 *
 * Module pur.
 */

/** Le genre de l'alerte -> l'icone du titre. Les genres sont ceux de ntfy (`tags`). */
export const KIND_ICON = Object.freeze({
  warning: '🚨',
  video_game: '🎮',
  mobile_phone: '📱',
  alarm_clock: '⏰',
  lock: '🔐',
  key: '🔑',
  calendar: '🗓️',
  palm_tree: '🏝️',
  white_check_mark: '✅',
});

/** Le petit plus qui ferme le titre : une alerte importante se voit de loin. */
export const KIND_SPARK = Object.freeze({
  warning: '⚠️',
  video_game: '✨',
  mobile_phone: '✨',
  alarm_clock: '🔥',
  lock: '🛑',
  key: '🗝️',
  calendar: '📅',
  palm_tree: '🌴',
  white_check_mark: '🎉',
});

/** La couleur du liseré d'une carte Discord, par genre (RVB en entier). */
export const KIND_COLOR = Object.freeze({
  warning: 0xE5484D,
  video_game: 0xE8FF00,
  mobile_phone: 0x00C2FF,
  alarm_clock: 0xFF7A00,
  lock: 0xFF3B7A,
  key: 0xF5C518,
  calendar: 0x7C5CFF,
  palm_tree: 0x22C55E,
  white_check_mark: 0x22C55E,
});
export const DEFAULT_COLOR = 0xE8FF00;

export const DEFAULT_ICON = '🎁';
export const DEFAULT_SPARK = '✨';

/** Le logo de chaque magasin, en emoji : ni Telegram ni Discord n'en acceptent d'autre dans un texte. */
export const STORE_ICON = Object.freeze({
  'epic games store': '🛡️',
  'epic games (mobile)': '📱',
  'gog.com': '🟣',
  steam: '♨️',
  'amazon games': '📦',
  'amazon luna': '🌙',
  'prime gaming': '👑',
  'microsoft store': '🪟',
  'ubisoft connect': '🌀',
  'ea app': '🎯',
  'battle.net': '❄️',
  'itch.io': '🕹️',
  indiegala: '🎲',
  fanatical: '🔥',
  'humble bundle': '💝',
  'legacy games': '📜',
});

/** Le logo du magasin nomme par ce texte, ou null si ce n'est pas un magasin. */
export function storeIcon(name) {
  return STORE_ICON[String(name || '').trim().toLowerCase()] || null;
}

/** Ce qu'on sait dire des plateformes d'un jeu mobile. */
export const PLATFORM_ICON = Object.freeze({ android: '🤖', ios: '🍎', iphone: '🍎', ipad: '🍎' });

/** « Android, iOS » -> [{ icon: '🤖', name: 'Android' }, ...], ou null si ce n'en sont pas. */
export function platforms(text) {
  const mots = String(text).split(/[,/·]|\bet\b|\band\b|\bund\b|\by\b/i).map((x) => x.trim()).filter(Boolean);
  if (!mots.length || !mots.every((m) => PLATFORM_ICON[m.toLowerCase()])) return null;
  return mots.map((name) => ({ icon: PLATFORM_ICON[name.toLowerCase()], name }));
}

/** Le genre d'une alerte : son premier marqueur, ou null. */
export function kindOf(msg) {
  return (msg && msg.tags && msg.tags[0]) || null;
}

/**
 * Une ligne, lue. `icon` : celle que le producteur a choisie pour cette ligne
 * (`msg.icons`), s'il en a choisi une. `kind` : le genre de l'alerte.
 */
export function parseLine(line, { icon = null, kind = null } = {}) {
  const parts = String(line).split(' -- ').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;

  if (parts.length >= 2 && storeIcon(parts[1])) {
    return {
      type: 'game',
      icon: storeIcon(parts[1]),
      title: parts[0],
      store: parts[1],
      // Un delai (un chiffre, et pas un nom de magasin) prend le sablier.
      chips: parts.slice(2).map((text) => ({ text, time: /\d/.test(text) && !storeIcon(text) })),
    };
  }
  if (parts.length === 2) {
    const p = platforms(parts[1]);
    if (p) return { type: 'mobile', icon: '📱', title: parts[0], platforms: p };
  }

  const un = parts.join(' — ');

  if (kind === 'warning') {
    const m = /^(.*?)\s+\((.+)\)$/.exec(un);
    return { type: 'incident', icon: icon || '⚠️', text: m ? m[1] : un, detail: m ? m[2] : null };
  }

  const etiquette = /^([^:]{2,40}?)\s:\s(.+)$/.exec(un);
  if (etiquette) return { type: 'label', icon: icon || '▪️', label: etiquette[1], value: etiquette[2] };
  if (icon) return { type: 'icon', icon, text: un };
  return { type: 'note', icon: '💬', text: un };
}

/** Le message en noeuds : les lignes du corps, sans les vides. */
export function parseMessage(msg) {
  const kind = kindOf(msg);
  const icons = Array.isArray(msg && msg.icons) ? msg.icons : [];
  return String((msg && msg.message) || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l, i) => parseLine(l, { icon: icons[i] || null, kind }))
    .filter(Boolean);
}
