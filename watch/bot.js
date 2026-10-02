/* Le bot Telegram qui REPOND (2.104.0).
 *
 * Jusqu'ici le bot ne faisait qu'ecrire : une alerte, un recap. Il sait
 * maintenant lire UN message de vous et repondre -- « etat », « jeux »,
 * « prends tout », « pause 3 », « pourquoi Hades », « ce soir », « stop ».
 *
 * CE QUE C'EST, ET CE QUE CA COUTE. L'extension interroge `getUpdates` toutes
 * les minutes, par une alarme -- jamais un serveur chez nous, jamais un
 * webhook. Donc : l'ordinateur doit etre allume et le navigateur ouvert, la
 * reponse arrive avec une minute de retard au plus, et un message ecrit
 * ordinateur eteint ne declenche RIEN en rentrant (voir MAX_AGE_MS).
 *
 * QUI PEUT PARLER. Une seule personne : la discussion PRIVEE dont le numero est
 * celui des reglages, et dont l'expediteur est ce meme numero. Un groupe ou un
 * canal est refuse d'emblee -- n'importe quel membre y piloterait votre
 * recuperateur. Tout autre message est ignore sans reponse : on ne se laisse pas
 * transformer en echo pour des inconnus.
 *
 * CE QUI NE PART JAMAIS. Une reponse se compose de titres, de noms de magasin,
 * de durees et de liens de fiches publiques. Jamais un code de rachat, un jeton,
 * une adresse de webhook, un cookie, un identifiant de compte : aucune de ces
 * donnees n'est meme lue ici.
 *
 * AU PLUS UNE FOIS. Le decalage de lecture est ecrit AVANT d'executer : un
 * worker tue en route perd une commande (vous la renvoyez), il ne la rejoue pas.
 *
 * Coupe par defaut. Module pur, sauf `pollBot`, qui recoit son `fetch`, son
 * stockage et ses effets.
 */
import { normaliseTitle, STORE_LABELS } from './offer.js';
import { judge, REASONS } from './filters.js';
import { readPhone, telegramToken, SERVICES } from './phone.js';

/** L'etat de la lecture : { offset, at, ok, note, handled, ignored, recent }. Ecrit par le worker seul. */
export const KEY_BOT = 'veille:bot';

export const ALARM_BOT = 'veille-bot';
export const POLL_MINUTES = 1;

/** Un message plus vieux que cela n'est PAS execute : l'ordinateur dormait, la demande a peut-etre change. */
export const MAX_AGE_MS = 15 * 60 * 1000;
/** Commandes traitees par lecture, et par heure : un bot n'est pas un robinet. */
export const MAX_PER_POLL = 5;
export const MAX_PER_HOUR = 30;
export const TIMEOUT_MS = 10000;
export const MAX_TEXT = 3500;
export const MAX_LISTED = 8;

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* ------------------------------------------------------- la configuration */

/**
 * Ce que le bot a le droit de faire pour ces reglages -- ou null. Telegram, un
 * jeton valide, et une discussion PRIVEE (un numero positif) : jamais un groupe
 * (numero negatif), jamais un @canal.
 */
export function botTarget(rawPhone) {
  const p = readPhone(rawPhone);
  if (!(p.on && p.service === SERVICES.TELEGRAM && p.bot === true)) return null;
  const token = telegramToken(p.token);
  if (!token || !/^\d{1,20}$/.test(p.chat)) return null;
  return { token, chat: p.chat };
}

/** Pourquoi le bot ne peut pas repondre alors qu'on le lui demande : 'service', 'token', 'group' ou null. */
export function botBlocked(rawPhone) {
  const p = readPhone(rawPhone);
  if (!p.on || p.service !== SERVICES.TELEGRAM) return 'service';
  if (!telegramToken(p.token)) return 'token';
  if (!/^\d{1,20}$/.test(p.chat)) return 'group';
  return null;
}

/* ------------------------------------------------------------------ Telegram */

export const apiUrl = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

/** Lire les messages : `offset` confirme ce qu'on a deja vu ; -1 = seulement le dernier. */
export function updatesUrl(token, offset) {
  const q = new URLSearchParams({ limit: offset === -1 ? '1' : '10', timeout: '0', allowed_updates: JSON.stringify(['message']) });
  if (Number.isInteger(offset)) q.set('offset', String(offset));
  return `${apiUrl(token, 'getUpdates')}?${q.toString()}`;
}

/** Les messages TEXTE d'une reponse getUpdates, et le decalage suivant. Ne jette jamais. */
export function parseUpdates(json) {
  const result = json && json.ok === true && Array.isArray(json.result) ? json.result : null;
  if (!result) return { updates: [], next: null, valid: false };
  const updates = [];
  let max = null;
  for (const u of result) {
    if (!u || !Number.isInteger(u.update_id)) continue;
    max = max === null ? u.update_id : Math.max(max, u.update_id);
    const m = u.message;
    if (!m || typeof m.text !== 'string' || !m.chat || !m.from) continue;
    updates.push({
      id: u.update_id,
      chatId: String(m.chat.id),
      chatType: String(m.chat.type || ''),
      fromId: String(m.from.id),
      fromBot: m.from.is_bot === true,
      text: m.text.slice(0, 300),
      at: Number.isFinite(m.date) ? m.date * 1000 : null,
    });
  }
  updates.sort((a, b) => a.id - b.id);
  return { updates, next: max === null ? null : max + 1, valid: true };
}

/** Ce message vient-il de la seule personne autorisee ? */
export function authorised(update, chat) {
  return Boolean(update) && update.chatType === 'private' && !update.fromBot
    && update.chatId === String(chat) && update.fromId === String(chat);
}

/* ------------------------------------------------------------- les commandes */

export const COMMANDS = Object.freeze({
  HELP: 'help', STATUS: 'status', GAMES: 'games', CLAIM: 'claim', PAUSE: 'pause', RESUME: 'resume', WHY: 'why', TONIGHT: 'tonight', STOP: 'stop', UNKNOWN: 'unknown',
});

const fold = (s) => normaliseTitle(String(s || '').replace(/^\/+/, '').replace(/@\w+/, ' '));

/**
 * Lit un message : { cmd, arg }. Accepte « /pause 3 », « pause 3 jours »,
 * « Pourquoi Hades ? », sans accent ni casse ; une commande /xxx@nom_du_bot aussi.
 */
export function parseCommand(text) {
  const raw = String(text || '').trim();
  const mots = fold(raw);
  if (!mots) return { cmd: COMMANDS.UNKNOWN, arg: '' };
  const [premier, ...reste] = mots.split(' ');
  const suite = reste.join(' ');
  const apres = (n) => raw.replace(/^\/+/, '').replace(/^\S+\s*/, '').trim().slice(0, 120).replace(/[?!.]+$/, '').trim() || reste.slice(n).join(' ');

  if (['aide', 'help', 'start', 'commandes', 'menu'].includes(premier)) return { cmd: COMMANDS.HELP, arg: '' };
  if (['etat', 'status', 'statut', 'bilan'].includes(premier)) return { cmd: COMMANDS.STATUS, arg: '' };
  if (['jeux', 'games', 'gratuit', 'gratuits', 'liste'].includes(premier)) return { cmd: COMMANDS.GAMES, arg: '' };
  if (premier === 'prends' && /^tout/.test(suite)) return { cmd: COMMANDS.CLAIM, arg: '' };
  if (['prendstout', 'claim', 'recupere', 'recuperer'].includes(premier)) return { cmd: COMMANDS.CLAIM, arg: '' };
  if (['pause', 'vacances', 'silence'].includes(premier)) {
    const n = /\d+/.exec(suite);
    return { cmd: COMMANDS.PAUSE, arg: n ? n[0] : '' };
  }
  if (['reprise', 'reprendre', 'resume', 'retour'].includes(premier)) return { cmd: COMMANDS.RESUME, arg: '' };
  if (['pourquoi', 'why'].includes(premier)) return { cmd: COMMANDS.WHY, arg: apres(1) };
  if (premier === 'ce' && /^soir/.test(suite)) return { cmd: COMMANDS.TONIGHT, arg: '' };
  if (['cesoir', 'tonight', 'soiree'].includes(premier)) return { cmd: COMMANDS.TONIGHT, arg: '' };
  if (['stop', 'arret', 'arrete', 'urgence'].includes(premier)) return { cmd: COMMANDS.STOP, arg: '' };
  return { cmd: COMMANDS.UNKNOWN, arg: '' };
}

/* --------------------------------------------------------------- les reponses */

/** 7 h, 2 j : la meme lecture que les notifications. */
function readableLeft(ms) {
  const h = Math.max(1, Math.round(ms / HOUR_MS));
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`;
}

const VERDICT_KEYS = Object.freeze({
  claimed: 'verdictClaimed', redeemed: 'verdictRedeemed', already_redeemed: 'verdictAlreadyRedeemed',
  code_pending_gog: 'verdictCodePending', code_copied: 'verdictCodeCopied', needs_link: 'verdictNeedsLink',
  needs_login: 'verdictNeedsLogin', challenge: 'verdictChallenge', needs_teaching: 'verdictTeach', owned: 'verdictOwned', gone: 'verdictGone', skipped: 'verdictSkipped',
  bad_url: 'verdictBadUrl', failed: 'verdictFailed', expired: 'verdictExpired', upcoming: 'verdictUpcoming',
  undetermined: 'verdictUndetermined', quota: 'verdictQuota', needs_base: 'verdictNeedsBase',
});

const DROP_KEYS = Object.freeze({
  [REASONS.STORE_UNSUPPORTED]: 'dropUnsupported',
  [REASONS.STORE_UNKNOWN]: 'dropUnknownStore',
  [REASONS.STORE_DISABLED]: 'dropDisabled',
  [REASONS.BELOW_THRESHOLD]: 'dropBelow',
  [REASONS.NO_WORTH]: 'dropNoWorth',
  [REASONS.NOTHING_TO_KEEP]: 'dropNothingToKeep',
  [REASONS.ALREADY_OWNED]: 'dropAlreadyOwned',
  [REASONS.EXTRA_CONTENT]: 'dropExtra',
  [REASONS.TITLE_EXCLUDED]: 'dropExcluded',
  [REASONS.NO_DESTINATION]: 'dropNoPage',
});

const shown = (o) => String(o.title || '').replace(/\s*\([^)]*\)\s*(key\s+)?giveaway\s*$/i, '').trim() || String(o.title || '');
const storeName = (s) => STORE_LABELS[s] || s;
const link = (o) => (o.url || o.resolveUrl || '').replace(/^(?!https:\/\/).*$/, '');

/** Les offres ouvertes, la plus proche de sa fin d'abord (une fin inconnue en dernier). */
export function sortedOpen(offers) {
  return [...offers].sort((a, b) => (a.end ?? Infinity) - (b.end ?? Infinity) || String(a.title).localeCompare(String(b.title)));
}

/**
 * Compose la reponse a une commande. Pure : `ctx` apporte tout ce qu'elle lit.
 *
 *   ctx.now, ctx.t, ctx.open (offres ouvertes), ctx.filters, ctx.judging
 *   ({ supportedStores, owned, ownedIds }), ctx.lastCheck, ctx.vacation
 *   ({ until } | null), ctx.stopped, ctx.autoClaim, ctx.incidents (nombre),
 *   ctx.library, ctx.attempts (par cle de catalogue), ctx.tonight (jeu | null),
 *   ctx.dateText(ts).
 *
 * Rend { text, effect } : `effect` est ce que le worker doit FAIRE
 * ({ kind: 'claim' | 'vacation' | 'resume' | 'stop' }), jamais ce que ce module
 * fait lui-meme -- il n'agit sur rien.
 */
export function answer(command, ctx) {
  const { t, now } = ctx;
  const claimable = (o) => judge(o, ctx.filters || {}, ctx.judging || {}).claimable;

  switch (command.cmd) {
    case COMMANDS.HELP:
      return { text: t('botHelp') };

    case COMMANDS.STATUS: {
      const open = ctx.open;
      const lignes = [open.length
        ? t('botStatusGames', String(open.length), String(open.filter(claimable).length))
        : t('botStatusNone')];
      lignes.push(ctx.lastCheck ? t('botStatusLast', readableAgo(now - ctx.lastCheck)) : t('botStatusNever'));
      if (ctx.stopped) lignes.push(t('botStatusStopped'));
      else if (ctx.autoClaim === false) lignes.push(t('botStatusAuto'));
      if (ctx.vacation) lignes.push(t('botStatusVacation', ctx.dateText(ctx.vacation.until)));
      if (ctx.incidents > 0) lignes.push(t('botStatusIncidents', String(ctx.incidents)));
      return { text: lignes.join('\n') };
    }

    case COMMANDS.GAMES: {
      const liste = sortedOpen(ctx.open);
      if (!liste.length) return { text: t('botStatusNone') };
      const lignes = [t('botGamesHeader')];
      for (const o of liste.slice(0, MAX_LISTED)) {
        const reste = typeof o.end === 'number' && o.end > now ? readableLeft(o.end - now) : '∞';
        lignes.push(t('botGameLine', shown(o), storeName(o.store), reste));
        const l = link(o);
        if (l) lignes.push(`   ${l}`);
      }
      if (liste.length > MAX_LISTED) lignes.push(t('botGamesMore', String(liste.length - MAX_LISTED)));
      return { text: lignes.join('\n') };
    }

    case COMMANDS.CLAIM: {
      if (ctx.stopped) return { text: t('botClaimStopped') };
      if (ctx.autoClaim === false) return { text: t('botStatusAuto') };
      const n = ctx.open.filter(claimable).length;
      if (!n) return { text: t('botClaimNothing') };
      return { text: t('botClaimStart', String(n)), effect: { kind: 'claim' } };
    }

    case COMMANDS.PAUSE: {
      const days = Number.parseInt(command.arg, 10);
      if (!Number.isFinite(days) || days < 1 || days > 60) return { text: t('botPauseBad') };
      const until = now + days * DAY_MS;
      return { text: t('botPauseDone', String(days), ctx.dateText(until)), effect: { kind: 'vacation', days } };
    }

    case COMMANDS.RESUME:
      if (ctx.stopped) return { text: t('botResumeStop'), effect: { kind: 'resume' } };
      if (ctx.vacation) return { text: t('botResumeDone'), effect: { kind: 'resume' } };
      return { text: t('botResumeNothing') };

    case COMMANDS.STOP:
      return { text: t('botStopDone'), effect: { kind: 'stop' } };

    case COMMANDS.WHY:
      return { text: why(command.arg, ctx, claimable) };

    case COMMANDS.TONIGHT: {
      const g = ctx.tonight;
      if (!g) return { text: t('botTonightNone') };
      return { text: [t('botTonight', g.title), g.page || ''].filter(Boolean).join('\n') };
    }

    default:
      return { text: t('botUnknown') };
  }
}

function readableAgo(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 90) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`;
}

/** « Pourquoi Hades ? » : ce que la veille sait de ce jeu, en phrases. */
function why(query, ctx, claimable) {
  const { t, now } = ctx;
  const q = normaliseTitle(query);
  if (!q) return t('botWhyAsk');
  const trouve = ctx.open.filter((o) => normaliseTitle(o.title).includes(q)).slice(0, 3);
  const lignes = [];

  for (const o of trouve) {
    lignes.push(t('botWhyHeader', shown(o), storeName(o.store)));
    const key = o.catalogKey || o.key;
    const essai = (ctx.attempts && key && ctx.attempts[key]) || null;
    const verdict = (essai && essai.verdict) || o.verdict || null;
    if (typeof o.end === 'number' && o.end > now) lignes.push(t('botWhyEnds', readableLeft(o.end - now)));
    const jugement = judge(o, ctx.filters || {}, ctx.judging || {});
    if (!jugement.claimable) {
      const k = DROP_KEYS[jugement.reason];
      lignes.push(t('botWhyDrop', k ? t(k) : String(jugement.reason)));
      continue;
    }
    if (verdict && verdict !== 'claimed' && VERDICT_KEYS[verdict]) lignes.push(t('botWhyVerdict', t(VERDICT_KEYS[verdict])));
    const nextAt = (essai && essai.nextAttemptAt) || o.nextAttemptAt || null;
    if (typeof nextAt === 'number' && nextAt > now) lignes.push(t('botWhyBackoff', readableLeft(nextAt - now)));
    else if (!verdict) lignes.push(t('botWhyWaiting'));
  }

  if (!trouve.length) {
    const deja = Object.values(ctx.library || {}).find((e) => e && e.title && normaliseTitle(e.title).includes(q));
    if (deja) return t('botWhyOwned', deja.title, storeName(deja.store), typeof deja.ts === 'number' ? ctx.dateText(deja.ts) : '?');
    return t('botWhyNone', query);
  }
  return lignes.join('\n');
}

/* ----------------------------------------------------------------- la lecture */

/** Garde-fou de debit : combien de commandes dans la derniere heure ? */
export function recentCount(recent, now) {
  return (Array.isArray(recent) ? recent : []).filter((ts) => typeof ts === 'number' && now - ts < HOUR_MS).length;
}

export function readBotState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    offset: Number.isInteger(r.offset) ? r.offset : null,
    at: typeof r.at === 'number' ? r.at : null,
    ok: r.ok !== false,
    note: typeof r.note === 'string' ? r.note : null,
    handled: Number.isInteger(r.handled) ? r.handled : 0,
    ignored: Number.isInteger(r.ignored) ? r.ignored : 0,
    recent: (Array.isArray(r.recent) ? r.recent : []).filter((x) => typeof x === 'number').slice(-MAX_PER_HOUR * 2),
  };
}

/** Ce qu'un statut de Telegram veut dire, sans jamais citer l'adresse (elle porte le jeton). */
export function describeBotStatus(status) {
  if (status === 401 || status === 404) return `HTTP ${status} : jeton du bot refuse`;
  if (status === 409) return 'HTTP 409 : un webhook ou un autre programme lit deja les messages de ce bot';
  if (status === 429) return 'HTTP 429 : Telegram limite';
  return `HTTP ${status}`;
}

async function call(fetchImpl, url, init = {}) {
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), TIMEOUT_MS) : null;
  try {
    return await fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: arret ? arret.signal : undefined, ...init });
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}

/** Envoie une reponse en texte simple (aucun balisage a echapper). Ne jette jamais. */
export async function reply({ fetch: fetchImpl, target, text }) {
  try {
    const r = await call(fetchImpl, apiUrl(target.token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: Number(target.chat), text: String(text).slice(0, MAX_TEXT), disable_web_page_preview: true }),
    });
    return r.ok;
  } catch { return false; }
}

/**
 * Une lecture : les nouveaux messages, ce qu'ils demandent, les reponses.
 *
 * Tout ce qui touche au monde est RECU : `fetch`, `read`/`write` du stockage
 * (la cle KEY_BOT), `context()` (les donnees des reponses), `effects` (agir) et
 * `record` (le journal, qui ne recoit jamais une adresse). Rend un resume.
 */
export async function pollBot({ fetch: fetchImpl, target, now, read, write, context, effects, t, record = () => {} }) {
  if (!target) return { skipped: 'off' };
  const state = readBotState(await read());
  const save = (patch) => write({ ...state, at: now, ...patch });

  /* Premiere lecture : on se cale sur le dernier message sans l'executer. Les
     vieux messages d'une discussion existante ne doivent pas partir d'un coup. */
  if (state.offset === null) {
    const r = await call(fetchImpl, updatesUrl(target.token, -1)).catch(() => null);
    if (!r || !r.ok) { await save({ ok: false, note: r ? describeBotStatus(r.status) : 'Telegram injoignable' }); return { skipped: 'prime' }; }
    const { next } = parseUpdates(await r.json().catch(() => null));
    await save({ offset: next === null ? 0 : next, ok: true, note: null });
    record('info', 'bot Telegram : en ecoute');
    return { primed: true };
  }

  const r = await call(fetchImpl, updatesUrl(target.token, state.offset)).catch(() => null);
  if (!r) { await save({ ok: false, note: 'Telegram injoignable' }); return { skipped: 'network' }; }
  if (!r.ok) {
    const note = describeBotStatus(r.status);
    if (state.ok || state.note !== note) record('warn', `bot Telegram : ${note}`);
    await save({ ok: false, note });
    return { skipped: 'status', status: r.status };
  }
  const { updates, next, valid } = parseUpdates(await r.json().catch(() => null));
  if (!valid) { await save({ ok: false, note: 'reponse illisible' }); return { skipped: 'invalid' }; }
  if (next === null) { await save({ ok: true, note: null }); return { handled: 0 }; }

  /* Au plus MAX_PER_POLL commandes par lecture : les suivantes restent chez
     Telegram, non confirmees, et se lisent a la minute d'apres. */
  let offset = next;
  let consumed = updates;
  let voulues = 0;
  for (let i = 0; i < updates.length; i++) {
    if (authorised(updates[i], target.chat) && ++voulues > MAX_PER_POLL) {
      consumed = updates.slice(0, i);
      offset = updates[i].id;
      break;
    }
  }

  // Au plus une fois : le decalage est ecrit AVANT d'agir.
  let ignored = state.ignored;
  const recent = state.recent.filter((ts) => now - ts < HOUR_MS);
  await write({ ...state, offset, at: now, ok: true, note: null, recent });

  let handled = 0;
  let stale = false;
  let ctx = null;
  for (const u of consumed) {
    if (!authorised(u, target.chat)) { ignored++; continue; }
    if (recent.length >= MAX_PER_HOUR) {
      if (recent.length === MAX_PER_HOUR) { recent.push(now); await reply({ fetch: fetchImpl, target, text: t('botSlowDown') }); }
      continue;
    }
    if (u.at === null || now - u.at > MAX_AGE_MS) {
      if (!stale) { stale = true; await reply({ fetch: fetchImpl, target, text: t('botStale', readableAgo(now - (u.at ?? now))) }); }
      continue;
    }
    handled++;
    recent.push(now);
    const cmd = parseCommand(u.text);
    ctx = ctx || { ...(await context()), t, now };
    let res;
    try { res = answer(cmd, ctx); } catch (e) { record('warn', `bot Telegram : reponse impossible (${cmd.cmd})`, e); res = { text: t('botError') }; }
    await reply({ fetch: fetchImpl, target, text: res.text });
    record('info', `bot Telegram : commande ${cmd.cmd}`);
    if (res.effect && effects) {
      try {
        const done = await effects(res.effect);
        if (done && done.text) await reply({ fetch: fetchImpl, target, text: done.text });
      } catch (e) {
        record('warn', `bot Telegram : ${cmd.cmd} en echec`, e);
        await reply({ fetch: fetchImpl, target, text: t('botError') });
      }
      ctx = null; // l'etat a change : la prochaine commande relit tout
    }
  }
  await write({ ...state, offset, at: now, ok: true, note: null, handled: state.handled + handled, ignored, recent });
  return { handled, ignored: ignored - state.ignored };
}

