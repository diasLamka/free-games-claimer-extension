/* Les messages Telegram, mis en page (2.99.1).
 *
 * Jusqu'ici Telegram recevait le meme texte brut que Discord : un titre, des
 * lignes, un lien. Lisible, pas beau. Telegram sait bien plus : du gras, de
 * l'italique, des citations, une image en tete, et de vrais boutons sous le
 * message. Ce module habille chaque alerte -- un jeu attendu, une derniere
 * chance, une panne, le recap du jeudi -- sans que leurs producteurs aient a
 * connaitre Telegram : ils gardent leur `{ title, message, tags, click }`, et
 * n'ajoutent que ce qu'ils sont seuls a savoir (`icons`, `image`).
 *
 * CE QUI EST MIS EN FORME
 *
 *   - le GENRE de l'alerte (`tags[0]`, celui que ntfy affiche deja) donne
 *     l'icone du titre : 🎮 un jeu attendu, ⏰ la derniere chance, 🚨 une
 *     panne, 🗓️ le recap, 🔑 un code a echanger...
 *   - une ligne « Titre -- Magasin -- encore 2 h » devient une carte : le logo
 *     du magasin en emoji, le titre en gras, le reste dessous ;
 *   - le lien devient un BOUTON, pas une adresse a la fin ;
 *   - la jaquette, quand l'alerte en porte une, part en photo, la legende
 *     prenant le message. Si Telegram refuse l'image, le message part quand
 *     meme, sans elle (`fallback`).
 *
 * CE QUI NE CHANGE PAS : rien ne part de plus qu'avant -- aucun code de
 * rachat, aucun identifiant. Une image est l'adresse publique de la jaquette
 * du jeu, que le magasin sert a tout le monde.
 *
 * SURETE : Telegram interprete du HTML. Tout texte venu d'un magasin (un titre
 * de jeu) est echappe avant d'y entrer, et l'arobase est casse : un jeu appele
 * « @quelquun » ne doit mentionner personne dans un groupe.
 *
 * Module pur : ni reseau, ni stockage. `t` vient de lib/i18n.js.
 */
import { t } from '../lib/i18n.js';
import { DEFAULT_ICON, DEFAULT_SPARK, KIND_ICON as ICONES, KIND_SPARK as ETINCELLES, kindOf, parseLine, parseMessage } from './alert-model.js';

/* Les icones, les couleurs, les logos et la lecture des lignes vivent dans le
   modele commun (watch/alert-model.js) : Discord les lit de la meme facon. */
export { KIND_ICON, KIND_SPARK, STORE_ICON, storeIcon } from './alert-model.js';

const SEPARATOR = '▰▰▰▰▰▰▰▰▰▰';
const SIGNATURE = '🕹️ Free Games Claimer';

/** Les limites de Telegram : 4096 signes un message, 1024 la legende d'une photo. */
export const MAX_TEXT = 4096;
export const MAX_CAPTION = 1024;

/**
 * Echappe un texte venu d'ailleurs pour le HTML de Telegram, et casse les
 * mentions (« @nom » avec une espace de largeur nulle).
 */
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=\w)/g, '@\u200b');
}

const gras = (s) => `<b>${esc(s)}</b>`;
const ital = (s) => `<i>${esc(s)}</i>`;

/** Un prix dans un texte prend une bourse : « 24,99 € » -> « 💶 24,99 € ». Sur du texte DEJA echappe. */
function withMoney(escaped) {
  return escaped.replace(/(\d+(?:[.,]\d{1,2})?\s?€)/g, '💶 <b>$1</b>');
}

/** Un noeud du modele, habille en HTML Telegram. */
export function renderNode(n) {
  switch (n.type) {
    case 'game': {
      const detail = [ital(n.store), ...n.chips.map((c) => (c.time ? `⏳ ${ital(c.text)}` : ital(c.text)))].join('  ·  ');
      return `${n.icon} ${gras(n.title)}\n└ ${detail}`;
    }
    case 'mobile':
      return `📱 ${gras(n.title)}\n└ ${n.platforms.map((p) => `${p.icon} ${esc(p.name)}`).join(' · ')}`;
    case 'incident':
      return n.detail
        ? `${n.icon} ${withMoney(esc(n.text))}\n└ <code>${esc(n.detail)}</code>`
        : `${n.icon} ${withMoney(esc(n.text))}`;
    case 'label':
      return `${n.icon} ${gras(n.label)} : ${withMoney(esc(n.value))}`;
    case 'icon':
      return `${n.icon} ${withMoney(esc(n.text))}`;
    default:
      return `${n.icon} ${ital(n.text)}`;
  }
}

/**
 * Une ligne du message, mise en page.
 *
 * `icon` : celle que le producteur a choisie pour cette ligne (`msg.icons`),
 * s'il en a choisi une. `kind` : le genre de l'alerte.
 */
export function formatLine(line, opts = {}) {
  const n = parseLine(line, opts);
  return n ? renderNode(n) : '';
}

/** Coupe aux lignes entieres pour tenir dans `max` signes : jamais au milieu d'un balisage. */
function fit(blocs, max) {
  const out = [];
  let taille = 0;
  for (const b of blocs) {
    const ajout = (out.length ? 1 : 0) + b.length;
    if (taille + ajout > max - 2) { out.push('…'); break; }
    out.push(b);
    taille += ajout;
  }
  return out.join('\n');
}

/** Le texte HTML d'une alerte. `max` : la limite du contenant (message ou legende). */
export function telegramText(msg, max = MAX_TEXT) {
  const kind = kindOf(msg);
  const icon = ICONES[kind] || DEFAULT_ICON;
  const spark = ETINCELLES[kind] || DEFAULT_SPARK;
  const titre = String(msg.title || '').trim();

  const tete = titre ? [`${icon} <b>${esc(titre)}</b> ${spark}`, SEPARATOR] : [];
  const lignes = parseMessage(msg).map(renderNode);
  // Le pied compte dans la limite : il est reserve avant de couper le reste.
  const pied = [SEPARATOR, `<i>${SIGNATURE}</i>`];
  const reserve = pied.join('\n').length + 1;
  const milieu = fit([...tete, ...lignes], max - reserve);
  return [milieu, ...pied].filter(Boolean).join('\n');
}

/** Le texte du bouton, selon ce que la page est. */
function buttonLabel(kind) {
  if (kind === 'key') return `🔑 ${t('tgBtnRedeem')}`;
  if (kind === 'video_game' || kind === 'alarm_clock' || kind === 'mobile_phone') return `🎁 ${t('tgBtnGame')}`;
  return `🔗 ${t('tgBtnOpen')}`;
}

const HTTPS = /^https:\/\/[^\s]{1,1800}$/i;

/**
 * Les requetes d'un envoi Telegram : la principale, et -- quand elle porte une
 * photo -- celle de repli, sans photo, si Telegram ne veut pas de l'image.
 *
 * `target.url` est l'adresse `.../sendMessage` du bot ; la photo part vers
 * `.../sendPhoto`, meme bot.
 */
export function telegramRequests(target, msg) {
  const kind = kindOf(msg);
  const bouton = typeof msg.click === 'string' && HTTPS.test(msg.click)
    ? { inline_keyboard: [[{ text: buttonLabel(kind), url: msg.click }]] }
    : null;
  const enTete = { 'Content-Type': 'application/json' };
  const commun = { credentials: 'omit', cache: 'no-store', redirect: 'error', method: 'POST', headers: enTete };

  const texte = {
    url: target.url,
    init: {
      ...commun,
      body: JSON.stringify({
        chat_id: target.chat,
        text: telegramText(msg, MAX_TEXT),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(bouton ? { reply_markup: bouton } : {}),
      }),
    },
  };

  if (typeof msg.image === 'string' && HTTPS.test(msg.image) && /\/sendMessage$/.test(target.url)) {
    return {
      url: target.url.replace(/\/sendMessage$/, '/sendPhoto'),
      init: {
        ...commun,
        body: JSON.stringify({
          chat_id: target.chat,
          photo: msg.image,
          caption: telegramText(msg, MAX_CAPTION),
          parse_mode: 'HTML',
          ...(bouton ? { reply_markup: bouton } : {}),
        }),
      },
      fallback: texte,
    };
  }
  return texte;
}
