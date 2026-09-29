/* Les alertes Discord, en cartes (2.99.3).
 *
 * Un webhook Discord recevait le meme texte brut que Telegram avant la 2.99.1 :
 * un titre, des lignes, une adresse. Discord sait faire une CARTE (un
 * « embed ») : un liseré de couleur, un titre qui est un lien, du Markdown, une
 * grande image, un pied. Les alertes en profitent, avec les memes icones, les
 * memes logos de magasin et les memes lignes que Telegram -- la lecture des
 * lignes est celle de watch/alert-model.js.
 *
 * Un webhook ne peut pas porter de boutons (il faut une appli Discord pour
 * cela) : le lien est le TITRE de la carte, et une ligne « 🎁 Voir le jeu » en
 * bas de la carte.
 *
 * SURETE : une alerte contient des titres de jeux venus des magasins. Le
 * Markdown de Discord y est neutralise (`* _ ~ | > # [ ] ( ) \` et `<`), et
 * les mentions sont coupees a deux endroits : `allowed_mentions: { parse: [] }`
 * ne notifie personne quoi qu'il arrive, et l'arobase est casse pour qu'un
 * titre « @everyone » ne s'affiche pas non plus comme une mention.
 *
 * Module pur.
 */
import { t } from '../lib/i18n.js';
import {
  DEFAULT_COLOR, DEFAULT_ICON, DEFAULT_SPARK, KIND_COLOR, KIND_ICON, KIND_SPARK, kindOf, parseMessage,
} from './alert-model.js';

const SIGNATURE = '🕹️ Free Games Claimer';
/** Les limites des cartes Discord. */
export const MAX_TITLE = 256;
export const MAX_DESCRIPTION = 4096;

/** Neutralise le Markdown et les mentions d'un texte venu d'ailleurs. */
export function escMd(text) {
  return String(text ?? '')
    .replace(/[\\*_~|`>#[\]()<]/g, '\\$&')
    .replace(/@(?=\w)/g, '@​');
}

const gras = (s) => `**${escMd(s)}**`;
const ital = (s) => `*${escMd(s)}*`;
const code = (s) => `\`${String(s ?? '').replace(/`/g, "'")}\``;

/** Un prix prend une bourse. Sur du texte DEJA echappe : les montants n'ont rien a echapper. */
function withMoney(escaped) {
  return escaped.replace(/(\d+(?:[.,]\d{1,2})?\s?€)/g, '💶 **$1**');
}

/** Un noeud du modele, habille en Markdown Discord. */
export function renderNode(n) {
  switch (n.type) {
    case 'game': {
      const detail = [ital(n.store), ...n.chips.map((c) => (c.time ? `⏳ ${ital(c.text)}` : ital(c.text)))].join('  ·  ');
      return `${n.icon} ${gras(n.title)}\n└ ${detail}`;
    }
    case 'mobile':
      return `📱 ${gras(n.title)}\n└ ${n.platforms.map((p) => `${p.icon} ${escMd(p.name)}`).join(' · ')}`;
    case 'incident':
      return n.detail
        ? `${n.icon} ${withMoney(escMd(n.text))}\n└ ${code(n.detail)}`
        : `${n.icon} ${withMoney(escMd(n.text))}`;
    case 'label':
      return `${n.icon} ${gras(n.label)} : ${withMoney(escMd(n.value))}`;
    case 'icon':
      return `${n.icon} ${withMoney(escMd(n.text))}`;
    default:
      return `${n.icon} ${ital(n.text)}`;
  }
}

function buttonLabel(kind) {
  if (kind === 'key') return `🔑 ${t('tgBtnRedeem')}`;
  if (kind === 'video_game' || kind === 'alarm_clock' || kind === 'mobile_phone') return `🎁 ${t('tgBtnGame')}`;
  return `🔗 ${t('tgBtnOpen')}`;
}

const HTTPS = /^https:\/\/[^\s)]{1,1800}$/i;

/** Coupe aux lignes entieres pour tenir dans `max` signes. */
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

/** La carte d'une alerte. `avecImage` faux : la meme, sans la grande image (le repli). */
export function discordEmbed(msg, { avecImage = true } = {}) {
  const kind = kindOf(msg);
  const icon = KIND_ICON[kind] || DEFAULT_ICON;
  const spark = KIND_SPARK[kind] || DEFAULT_SPARK;
  const titre = String(msg.title || '').trim();
  const lien = typeof msg.click === 'string' && HTTPS.test(msg.click) ? msg.click : null;

  const blocs = parseMessage(msg).map(renderNode);
  // Le lien en bas de la carte : le titre en est un aussi, mais on ne le voit pas toujours.
  const pied = lien ? [`[${buttonLabel(kind)}](${lien})`] : [];
  const reserve = pied.join('\n').length + (pied.length ? 2 : 0);
  const description = [fit(blocs, MAX_DESCRIPTION - reserve), ...pied].filter(Boolean).join('\n\n');

  const embed = {
    title: titre ? `${icon} ${escMd(titre)} ${spark}`.slice(0, MAX_TITLE) : undefined,
    description: description || undefined,
    url: lien || undefined,
    color: KIND_COLOR[kind] ?? DEFAULT_COLOR,
    footer: { text: SIGNATURE },
  };
  if (avecImage && typeof msg.image === 'string' && HTTPS.test(msg.image)) embed.image = { url: msg.image };
  return embed;
}

/**
 * La requete d'un envoi Discord, et -- quand la carte porte une image -- celle
 * de repli, sans image, si Discord refuse la carte (un 400).
 */
export function discordRequests(target, msg) {
  const commun = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
  };
  const requete = (embed) => {
    const vide = !embed.title && !embed.description;
    return {
      url: target.url,
      init: {
        ...commun,
        body: JSON.stringify({
          username: 'Free Games Claimer',
          // Jamais de notification a quelqu'un : un titre de jeu ne mentionne personne.
          allowed_mentions: { parse: [] },
          ...(vide ? { content: SIGNATURE } : { embeds: [embed] }),
        }),
      },
    };
  };
  const principale = requete(discordEmbed(msg));
  if (typeof msg.image === 'string' && HTTPS.test(msg.image)) principale.fallback = requete(discordEmbed(msg, { avecImage: false }));
  return principale;
}
