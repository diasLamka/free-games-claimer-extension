/* L'alerte sur le telephone, par ntfy.
 *
 * Les notifications de l'extension s'affichent sur l'ordinateur -- le seul
 * endroit ou personne ne regarde quand une session expire a trois heures du
 * matin, ou quand le systeme a coupe nos notifications. Le chien de garde
 * savait le dire ; il ne savait pas le dire AILLEURS.
 *
 * ntfy (https://ntfy.sh, logiciel libre, auto-hebergeable) recoit un POST sur
 * l'adresse d'un « sujet », et l'application du telephone abonnee a ce sujet
 * sonne. Aucun compte, aucune cle d'API : c'est ce qui le rend compatible avec
 * le design, qui refuse tout serveur a nous. Le serveur est le VOTRE -- celui
 * de ntfy.sh, ou le votre.
 *
 * CE QUI PART, ET CE QUI NE PART JAMAIS. Un titre, une ligne, parfois le nom
 * d'un jeu et le lien de sa fiche. Jamais un code de rachat, jamais un
 * identifiant de compte, jamais un cookie : la requete part sans les cookies
 * du navigateur (`credentials: 'omit'`).
 *
 * LE NOM DU SUJET EST UN SECRET. Sur ntfy.sh, qui connait le nom d'un sujet
 * peut y lire et y ecrire. D'ou `newTopicUrl`, qui en tire un au hasard, et
 * d'ou la cle a part : la configuration ne vit PAS dans les reglages, que
 * `syncSettings` peut recopier dans le compte du navigateur.
 *
 * Coupe par defaut. C'est la troisieme chose qui peut quitter la machine
 * (SECURITY.md), et la seule qui parte vers un hote que l'utilisateur choisit.
 */

/** La configuration. Ecrite par le popup seul ; jamais synchronisee. */
export const KEY_PHONE = 'veille:telephone';

/** Le dernier envoi : ecrit par le service worker seul, lu par le popup. */
export const KEY_PHONE_STATE = 'veille:telephone-etat';

/**
 * Ou partent les alertes (2.71.0). ntfy d'abord -- une appli de telephone,
 * un sujet --, puis Discord (un webhook de salon) et Telegram (un bot et une
 * discussion). Les memes alertes, aux memes moments : seul le transport
 * change.
 */
export const SERVICES = Object.freeze({ NTFY: 'ntfy', DISCORD: 'discord', TELEGRAM: 'telegram' });

export const DEFAULT_PHONE = Object.freeze({
  on: false,
  service: SERVICES.NTFY,
  /** ntfy : l'adresse du sujet. Discord : celle du webhook. Telegram : rien. */
  url: '',
  /** Telegram : la discussion ou le bot ecrit -- un nombre, ou @canal. */
  chat: '',
  /** ntfy : jeton d'acces, pour un serveur prive. Telegram : le jeton du bot. */
  token: '',
  /** Aussi les jeux de la liste de souhaits, pas seulement les pannes. */
  wished: true,
  /** Aussi les jeux mobiles offerts par Epic (2.57.0) : ils se recuperent SUR
      le telephone, c'est la qu'ils doivent arriver. Sans effet tant que le
      magasin « Epic Games (mobile) » n'est pas suivi. */
  mobile: true,
  /** Aussi le recap du jeudi soir (2.65.0). */
  recap: true,
});

/** Le serveur public, celui que « Nouveau sujet » propose. */
export const DEFAULT_SERVER = 'https://ntfy.sh';

/** Priorites ntfy : 3 ordinaire, 4 haute -- le telephone vibre plus fort. */
export const PRIORITY = Object.freeze({ DEFAULT: 3, HIGH: 4 });

/** Au-dela, on abandonne : une alerte ne bloque pas un cycle. */
export const TIMEOUT_MS = 10000;

/**
 * Apres un echec, le tour d'inspection attend avant de reessayer.
 *
 * Il repasse toutes les trente minutes : sans ce delai, une adresse mal
 * tapee ecrirait un avertissement au journal quarante-huit fois par jour. Un
 * essai reussi depuis le popup efface l'echec, et libere tout de suite.
 */
export const RETRY_MS = 60 * 60 * 1000;

/** Le lien de l'appli Android, tel que watch/relay.js l'ecrit (appLink). */
const APP_LINK_RE = /^fgclaimer:\/\/finir\?[A-Za-z0-9%+&=._~-]{1,600}$/;

/** Longueur maximale du corps. ntfy en accepte plus ; un telephone en affiche moins. */
const MAX_BODY = 1000;

/* -------------------------------------------------------- la configuration */

/** La configuration stockee, completee de ses defauts. */
export function readPhone(raw) {
  const p = { ...DEFAULT_PHONE, ...(raw && typeof raw === 'object' ? raw : {}) };
  return {
    on: p.on === true,
    service: Object.values(SERVICES).includes(p.service) ? p.service : SERVICES.NTFY,
    chat: typeof p.chat === 'string' ? p.chat.trim() : '',
    url: typeof p.url === 'string' ? p.url.trim() : '',
    token: typeof p.token === 'string' ? p.token.trim() : '',
    wished: p.wished !== false,
    mobile: p.mobile !== false,
    recap: p.recap !== false,
  };
}

/**
 * L'adresse d'un sujet, verifiee -- ou null.
 *
 * HTTPS seulement : le message traverse le reseau, et un sujet ntfy se lit
 * par qui l'intercepte. Un chemin non vide (le sujet), sans requete ni
 * fragment -- les parametres de publication s'y ajoutent -- et sans
 * identifiants dans l'adresse, qui finiraient dans l'historique et le journal.
 */
export function topicUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password || u.search || u.hash) return null;
  const chemin = u.pathname.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9_-]{1,64}(\/[A-Za-z0-9_-]{1,64})*$/.test(chemin)) return null;
  return `${u.origin}${chemin}`;
}

/**
 * L'adresse d'un webhook Discord, verifiee -- ou null (2.71.0).
 *
 * Celle que Discord donne dans Parametres du salon -> Integrations ->
 * Webhooks : `https://discord.com/api/webhooks/<numero>/<jeton>`. Le jeton
 * EST dans l'adresse : qui la connait peut ecrire dans le salon. Elle se garde
 * donc comme le jeton ntfy, sous `veille:telephone`, et ne part jamais au
 * journal.
 */
export function discordWebhookUrl(url) {
  const s = String(url || '').trim();
  const m = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})$/.exec(s);
  return m ? `https://discord.com/api/webhooks/${m[1]}/${m[2]}` : null;
}

/** Le jeton d'un bot Telegram, tel que BotFather le donne (`123456:ABC...`), ou null. */
export function telegramToken(token) {
  const s = String(token || '').trim();
  return /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(s) ? s : null;
}

/** Une discussion Telegram : un numero (negatif pour un groupe) ou @canal. */
export function telegramChat(chat) {
  const s = String(chat || '').trim();
  return /^-?\d{1,20}$/.test(s) || /^@[A-Za-z0-9_]{5,32}$/.test(s) ? s : null;
}

/**
 * L'adresse a laquelle on ecrit, pour ces reglages -- ou null. C'est aussi
 * celle dont la permission d'hote est demandee.
 */
export function serviceUrl(raw) {
  const p = readPhone(raw);
  if (p.service === SERVICES.DISCORD) return discordWebhookUrl(p.url);
  if (p.service === SERVICES.TELEGRAM) {
    const token = telegramToken(p.token);
    return token && telegramChat(p.chat) ? `https://api.telegram.org/bot${token}/sendMessage` : null;
  }
  return topicUrl(p.url);
}

/** La cible d'envoi, seulement si l'alerte est active ET la configuration valide. */
export function phoneTarget(raw) {
  const p = readPhone(raw);
  if (!p.on) return null;
  const url = serviceUrl(p);
  if (!url) return null;
  const choix = { wished: p.wished, mobile: p.mobile, recap: p.recap };
  if (p.service === SERVICES.DISCORD) return { service: p.service, url, ...choix };
  if (p.service === SERVICES.TELEGRAM) return { service: p.service, url, chat: telegramChat(p.chat), ...choix };
  // Un jeton porte dans un en-tete HTTP : rien hors de l'ASCII imprimable.
  const token = /^[\x21-\x7e]{1,200}$/.test(p.token) ? p.token : '';
  return { url, token, ...choix };
}

/** Le motif de permission a demander pour ce serveur : `https://hote/*`. */
export function originPattern(url) {
  const ok = topicUrl(url) || discordWebhookUrl(url) || telegramUrl(url);
  return ok ? `${new URL(ok).origin}/*` : null;
}

/** L'adresse d'envoi d'un bot Telegram, verifiee -- ou null. */
function telegramUrl(url) {
  const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/sendMessage$/.exec(String(url || ''));
  return m && telegramToken(m[1]) ? String(url) : null;
}

/**
 * Un sujet neuf, au hasard, sur le serveur public.
 *
 * Vingt caracteres en base 32 : cent bits, qu'on ne devine pas. `bytes` est
 * injecte -- `crypto.getRandomValues` dans le popup, une suite fixe dans les
 * tests.
 */
export function newTopicUrl(bytes, server = DEFAULT_SERVER) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let s = '';
  for (let i = 0; i < 20; i++) s += alphabet[(bytes[i] ?? 0) % 32];
  return `${server.replace(/\/+$/, '')}/fgc-${s}`;
}

/** Peut-on reessayer, au vu du dernier envoi ? */
export function mayRetry(state, now) {
  if (!state || state.ok !== false || typeof state.at !== 'number') return true;
  return now - state.at >= RETRY_MS;
}

/* --------------------------------------------------------------- le message */

/**
 * Les incidents, en une alerte.
 *
 * `label(kind, key)` rend la phrase humaine d'un genre ; le motif technique
 * suit entre parentheses quand il existe -- c'est lui qui a suffi a corriger
 * plus d'une version. Le genre `muted` y a sa place, et c'est meme la raison
 * d'etre de ce canal : le seul qui puisse dire que l'autre est coupe.
 */
export function incidentsMessage(incidents, { title, label }) {
  const lignes = (incidents || []).map((i) => {
    const phrase = label(i.kind, i.key);
    return i.detail ? `${phrase} (${i.detail})` : phrase;
  });
  return { title, message: lignes.join('\n'), priority: PRIORITY.HIGH, tags: ['warning'] };
}

/**
 * Des jeux attendus, en une alerte : le premier en titre, les autres dessous.
 * Le lien est celui du premier -- toucher la notification ouvre sa fiche.
 */
export function wishedMessage(offers, { title, line }) {
  const liste = (offers || []).filter((o) => o && o.title);
  if (!liste.length) return null;
  return {
    title: title(liste[0].title),
    message: liste.map(line).join('\n'),
    priority: PRIORITY.HIGH,
    tags: ['video_game'],
    click: liste[0].url || liste[0].resolveUrl || null,
  };
}

/**
 * Les jeux mobiles offerts par Epic, pour le telephone (2.57.0). Pas urgents
 * comme un jeu attendu : une priorite ordinaire, et le lien de la page.
 */
export function mobileMessage(offers, { title, line }) {
  const liste = (offers || []).filter((o) => o && o.title);
  if (!liste.length) return null;
  return {
    title: title(liste[0].title),
    message: liste.map(line).join('\n'),
    priority: PRIORITY.DEFAULT,
    tags: ['mobile_phone'],
    click: liste[0].url || null,
  };
}

/* ------------------------------------------------------------------ l'envoi */

/**
 * La requete de publication.
 *
 * Les parametres passent dans l'ADRESSE, pas dans des en-tetes : un en-tete
 * HTTP n'accepte que le latin-1, et un titre accentue -- « Récupéré » --
 * ferait jeter `fetch` avant meme de partir. Le corps, lui, est de l'UTF-8.
 */
export function publishRequest(target, msg) {
  /* Le lien d'une alerte : une page web, ou -- pour ntfy seulement, dont
     l'appli ouvre n'importe quel lien -- celui de l'appli Android (2.89.0),
     qui ouvre le jeu a finir sur le telephone. */
  const appli = typeof msg.click === 'string' && APP_LINK_RE.test(msg.click)
    && target.service !== SERVICES.DISCORD && target.service !== SERVICES.TELEGRAM;
  const click = msg.click && (/^https:\/\//i.test(msg.click) || appli) ? msg.click : null;
  const corps = String(msg.message || '').trim();
  const titre = String(msg.title || '').trim();

  /* Discord et Telegram (2.71.0) : du JSON, un seul champ de texte. Le titre
     en tete, le lien a la fin. Ni mention ni mise en forme interpretee : un
     titre de jeu ne doit pas pouvoir notifier tout un salon (@everyone) ni
     casser un balisage. */
  if (target.service === SERVICES.DISCORD || target.service === SERVICES.TELEGRAM) {
    const lignes = [titre, corps, click].filter(Boolean);
    const discord = target.service === SERVICES.DISCORD;
    const payload = discord
      ? { content: lignes.join('\n').slice(0, 2000), allowed_mentions: { parse: [] } }
      : { chat_id: target.chat, text: lignes.join('\n').slice(0, 4096), disable_web_page_preview: true };
    return {
      url: target.url,
      init: {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      },
    };
  }

  const q = new URLSearchParams();
  if (msg.title) q.set('title', String(msg.title).slice(0, 250));
  if (msg.priority) q.set('priority', String(msg.priority));
  if (msg.tags && msg.tags.length) q.set('tags', msg.tags.join(','));
  if (click) q.set('click', click);

  const headers = {};
  if (target.token) headers.Authorization = `Bearer ${target.token}`;

  return {
    url: `${target.url}?${q.toString()}`,
    init: {
      method: 'POST',
      body: String(msg.message || msg.title || '').slice(0, MAX_BODY),
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    },
  };
}

/**
 * Envoie. Ne jette jamais : rend `{ ok, status, note }`.
 *
 * Une alerte qui echoue ne doit rien casser d'autre -- ni le cycle, ni le
 * tour d'inspection. L'appelant decide de ce qu'un echec veut dire ; ce
 * module se contente de le dire juste.
 */
export async function sendPhone({ fetch: fetchImpl, target, msg, timeoutMs = TIMEOUT_MS }) {
  if (!target || !msg) return { ok: false, status: 0, note: 'rien a envoyer' };
  const { url, init } = publishRequest(target, msg);
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(url, { ...init, signal: stopwatch ? stopwatch.signal : undefined });
    if (r.ok) return { ok: true, status: r.status, note: null };
    const raison = target.service === SERVICES.TELEGRAM ? await telegramReason(r) : null;
    return { ok: false, status: r.status, note: describeStatus(r.status, target.service, raison) };
  } catch (e) {
    const aborted = stopwatch && stopwatch.signal.aborted;
    return { ok: false, status: 0, note: aborted ? `delai depasse (${timeoutMs} ms)` : ((e && e.message) || String(e)) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * La raison que Telegram donne a un refus (le champ `description` de sa
 * reponse), ou null. Jamais le jeton : il est dans l'adresse, pas dans le corps.
 */
async function telegramReason(r) {
  try {
    const corps = typeof r.json === 'function' ? await r.json() : null;
    return corps && typeof corps.description === 'string' ? corps.description.slice(0, 200) : null;
  } catch { return null; }
}

/**
 * Un 403 de Telegram, dit selon sa raison (2.78.1). « Pas acces » couvre cinq
 * pannes qui ne se corrigent pas pareil : le bot jamais demarre, bloque, un
 * identifiant de bot au lieu du votre, un groupe ou un canal qui ne l'a pas,
 * une discussion supprimee.
 */
function telegramForbidden(raison) {
  const r = String(raison || '');
  if (/can't initiate conversation/i.test(r)) return 'le bot ne peut pas ecrire le premier -- ouvrez-le dans Telegram et appuyez sur Demarrer';
  if (/blocked by the user/i.test(r)) return 'vous avez bloque le bot -- debloquez-le dans Telegram, puis appuyez sur Demarrer';
  // « bot can't send messages to bots », ou « the bot can't send messages to the bot » (mesure du 2026-09-26).
  if (/send messages to (?:the )?bots?\b/i.test(r)) return 'cet identifiant est celui d\'un bot (le numero au debut du jeton est celui du bot) -- il faut le votre, que @userinfobot donne';
  if (/administrator rights/i.test(r)) return 'le bot doit etre administrateur du canal';
  if (/not a member|kicked/i.test(r)) return 'le bot n\'est pas membre de ce groupe ou canal -- ajoutez-le (administrateur, pour un canal)';
  if (/deactivated|chat was deleted/i.test(r)) return 'cette discussion n\'existe plus';
  return r ? `le bot n'a pas acces a cette discussion (${r})` : 'le bot n\'a pas acces a cette discussion';
}

/** Ce qu'un statut veut dire, pour qui doit corriger sa configuration. */
export function describeStatus(status, service = SERVICES.NTFY, raison = null) {
  if (service === SERVICES.DISCORD) {
    if (status === 401 || status === 403 || status === 404) return `HTTP ${status} : webhook Discord supprime, ou adresse fausse`;
    if (status === 429) return 'HTTP 429 : Discord limite, trop de messages';
    return `HTTP ${status}`;
  }
  if (service === SERVICES.TELEGRAM) {
    if (status === 401 || status === 404) return `HTTP ${status} : jeton du bot refuse`;
    if (status === 400) return 'HTTP 400 : discussion introuvable -- ecrivez d\'abord au bot, ou verifiez le numero';
    if (status === 403) return `HTTP 403 : ${telegramForbidden(raison)}`;
    if (status === 429) return 'HTTP 429 : Telegram limite, trop de messages';
    return `HTTP ${status}`;
  }
  if (status === 401 || status === 403) return `HTTP ${status} : ce sujet demande un jeton, ou le jeton est refuse`;
  if (status === 404) return 'HTTP 404 : adresse du sujet introuvable';
  if (status === 413) return 'HTTP 413 : message trop long';
  if (status === 429) return 'HTTP 429 : trop de messages, le serveur limite';
  return `HTTP ${status}`;
}

/**
 * Envoie, et garde la trace du resultat pour le popup.
 *
 * La SEULE fonction de ce module qui touche au stockage, et elle le recoit
 * en parametre. Le resultat part au journal : une alerte ratee en silence est
 * le defaut que ce canal existe pour corriger.
 */
export async function pushToPhone({ chrome, fetch: fetchImpl, target, msg, now, record = () => {}, why = 'alerte' }) {
  const r = await sendPhone({ fetch: fetchImpl, target, msg });
  record(r.ok ? 'info' : 'warn', r.ok ? `telephone : ${why} envoyee` : `telephone : ${why} non envoyee -- ${r.note}`);
  try {
    await chrome.storage.local.set({ [KEY_PHONE_STATE]: { at: now, ok: r.ok, status: r.status, note: r.note, why } });
  } catch { /* l'etat est un confort, pas une garantie */ }
  return r;
}
