/* Le relais PC <-> telephone (2.87.0).
 *
 * L'extension et l'appli Android recuperaient chacune de leur cote, sans
 * rien savoir l'une de l'autre : un jeu pris sur le telephone etait retente
 * par le PC. Le relais les fait se parler, par ntfy -- le transport des
 * alertes, aucun serveur a nous -- et CHIFFRE DE BOUT EN BOUT : ntfy voit un
 * nom de sujet tire au hasard et des octets, jamais un titre.
 *
 * Celui qui est allume recupere. Avant un jeu, il pose un verrou ; apres, il
 * dit « obtenu ». L'autre inscrit le jeu dans son registre et ne le retente
 * pas. Un signe de vie horaire porte les derniers jeux obtenus, pour
 * rattraper un appareil reste eteint plus longtemps que ntfy ne garde ses
 * messages (douze heures sur ntfy.sh).
 *
 * Bloque par une verification humaine (un captcha), il demande de l'aide
 * (2.89.0) : l'autre appareil appelle l'humain, qui finit le jeu LA OU IL EST
 * -- sur le telephone quand il est dehors. Le PC ne resout rien a distance :
 * c'est le telephone qui recupere, avec sa propre session.
 *
 * Le protocole est ecrit dans docs/specs/2026-09-26-relais-design.md, et
 * l'appli le suit a l'octet pres : test/fixtures/relais.json fixe un secret,
 * un sujet et un message chiffre que les deux cotes doivent reproduire.
 *
 * CE QUI NE PASSE JAMAIS : un cookie, un code de rachat, un identifiant de
 * compte. Le secret ne quitte pas le stockage local : jamais synchronise,
 * jamais dans une sauvegarde (il n'est pas dans BACKUP_KEYS).
 *
 * Module pur, sauf les fonctions qui recoivent leur `fetch` ou leur `chrome`.
 */

import { KEY_LIBRARY, enrich, libraryKey, makeEntry, mergeEntry } from './library.js';
import { normaliseTitle } from './offer.js';

/** L'etat du relais. Ecrit par le popup (association) et le worker (lecture). */
export const KEY_RELAY = 'veille:relais';

export const DEFAULT_SERVER = 'https://ntfy.sh';
export const CODE_PREFIX = 'FGC1-';
export const ENVELOPE_PREFIX = 'fgc1.';
export const VERSION = 1;

export const TYPES = Object.freeze({ CLAIMED: 'claimed', LOCK: 'lock', ALIVE: 'alive', HELP: 'help' });
export const ROLES = Object.freeze({ PC: 'pc', PHONE: 'phone' });

/** Un verrou plus long que ceci est ignore : une reclamation dure cinq minutes au plus. */
export const MAX_LOCK_MS = 10 * 60 * 1000;
/** Une demande d'aide vaut un jour au plus : l'humain a eu le temps de la voir. */
export const MAX_HELP_MS = 24 * 3600 * 1000;
/** Au-dela, un message est trop vieux pour dire quoi que ce soit. */
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Un signe de vie par heure au plus. */
export const ALIVE_EVERY_MS = 60 * 60 * 1000;
/** Les derniers jeux qu'un signe de vie porte. */
export const ALIVE_GAMES = 15;
/** Le corps chiffre tient sous cette taille : ntfy passe en piece jointe au-dela de 4 096. */
export const MAX_ENVELOPE = 4000;
export const TIMEOUT_MS = 10000;

const ACQUIRED = ['claimed', 'redeemed'];

/* ------------------------------------------------------------ base64url */

export function toB64url(bytes) {
  let bin = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  const s = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* --------------------------------------------------------- l'association */

/** Un secret neuf : 32 octets au hasard, en base64url. `bytes` vient de crypto.getRandomValues. */
export function newSecret(bytes) {
  if (!bytes || bytes.length !== 32) throw new TypeError('relais : il faut 32 octets au hasard');
  return toB64url(bytes);
}

/** Un identifiant d'appareil : huit caracteres hexadecimaux. */
export function newDeviceId(bytes) {
  return hex(bytes).slice(0, 8);
}

/** Le serveur, verifie : une origine https, sans chemin ni identifiants -- ou null. */
export function relayServer(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.origin;
}

/** Le code a scanner ou a copier. Le serveur public n'y figure pas. */
export function pairingCode(secret, server = DEFAULT_SERVER) {
  const s = relayServer(server) || DEFAULT_SERVER;
  return CODE_PREFIX + secret + (s === DEFAULT_SERVER ? '' : `@${s}`);
}

/** Le code relu : { secret, server }, ou null s'il n'a pas la bonne forme. */
export function parsePairingCode(text) {
  const t = String(text || '').trim();
  const m = /^FGC1-([A-Za-z0-9_-]{43})(?:@(https:\/\/[^\s]+))?$/.exec(t);
  if (!m) return null;
  const server = m[2] ? relayServer(m[2]) : DEFAULT_SERVER;
  if (!server) return null;
  if (fromB64url(m[1]).length !== 32) return null;
  return { secret: m[1], server };
}

/* --------------------------------------------------------- la cryptographie */

/** Le sujet et la cle, tires du secret -- a l'identique dans l'appli. */
export async function deriveRelay(secret, subtle = globalThis.crypto.subtle) {
  const sujet = await subtle.digest('SHA-256', enc.encode(`fgc-relais/sujet/${secret}`));
  const brut = await subtle.digest('SHA-256', enc.encode(`fgc-relais/cle/${secret}`));
  const key = await subtle.importKey('raw', brut, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { topic: `fgcr-${hex(sujet).slice(0, 32)}`, key };
}

/** Chiffre un message. `nonce` (12 octets) est injectable pour les tests. */
export async function seal(message, { key, topic }, { subtle = globalThis.crypto.subtle, nonce } = {}) {
  const iv = nonce || globalThis.crypto.getRandomValues(new Uint8Array(12));
  const clair = enc.encode(JSON.stringify(message));
  const chiffre = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(topic), tagLength: 128 }, key, clair,
  ));
  const tout = new Uint8Array(iv.length + chiffre.length);
  tout.set(iv, 0);
  tout.set(chiffre, iv.length);
  return ENVELOPE_PREFIX + toB64url(tout);
}

/** Ouvre un message, ou rend null : mauvaise cle, autre sujet, texte abime. */
export async function open(envelope, { key, topic }, { subtle = globalThis.crypto.subtle } = {}) {
  const t = String(envelope || '');
  if (!t.startsWith(ENVELOPE_PREFIX)) return null;
  try {
    const tout = fromB64url(t.slice(ENVELOPE_PREFIX.length));
    if (tout.length < 12 + 16) return null;
    const clair = await subtle.decrypt(
      { name: 'AES-GCM', iv: tout.slice(0, 12), additionalData: enc.encode(topic), tagLength: 128 },
      key, tout.slice(12),
    );
    const msg = JSON.parse(dec.decode(clair));
    return msg && typeof msg === 'object' && !Array.isArray(msg) ? msg : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ les messages */

/** Un jeu, tel qu'il voyage : le strict necessaire. */
export function wireGame(g, { withLinks = true } = {}) {
  const out = { s: String(g.store || g.s || ''), i: String(g.id ?? g.i ?? ''), t: String(g.title || g.t || '').slice(0, 140) };
  const at = g.ts ?? g.at;
  if (typeof at === 'number') out.at = at;
  const st = g.status || g.st;
  if (st) out.st = String(st);
  const w = g.worth || g.w;
  if (w) out.w = String(w).slice(0, 40);
  const u = g.url || g.u;
  if (withLinks && typeof u === 'string' && /^https:\/\//.test(u)) out.u = u.slice(0, 300);
  if (typeof g.until === 'number') out.until = g.until;
  return out;
}

export function message({ type, dev, role, now, games = [], stores = null }) {
  const m = { v: VERSION, dev, role, type, ts: now, games };
  if (stores) m.stores = stores;
  return m;
}

/** Les derniers jeux obtenus, du plus recent au plus ancien. */
export function recentGames(library, n = ALIVE_GAMES) {
  return Object.values(library || {})
    .filter((e) => e && e.store && e.title && (!e.status || ACQUIRED.includes(e.status)) && typeof e.ts === 'number')
    .sort((a, b) => b.ts - a.ts)
    .slice(0, n);
}

/**
 * Un signe de vie qui tient dans un message ntfy : sans liens d'abord, puis
 * avec de moins en moins de jeux. `size` mesure le message chiffre.
 */
export async function fitAlive(base, games, size) {
  let avecLiens = true;
  let n = games.length;
  for (;;) {
    const m = { ...base, games: games.slice(0, n).map((g) => wireGame(g, { withLinks: avecLiens })) };
    if ((await size(m)) <= MAX_ENVELOPE || n === 0) return m;
    if (avecLiens) avecLiens = false;
    else n = Math.max(0, n - 3);
  }
}

/**
 * Le lien qui ouvre l'appli sur un jeu (2.89.0) : `fgclaimer://finir?s=&i=&t=`.
 * Il ne porte que le magasin, l'identifiant et le titre -- l'appli retrouve
 * le jeu dans SES offres, et ne suit jamais une adresse venue du lien.
 */
export const APP_LINK = 'fgclaimer://finir';

export function appLink(g) {
  const q = new URLSearchParams({
    s: String(g.store || g.s || ''),
    i: String(g.id ?? g.i ?? '').slice(0, 200),
    t: String(g.title || g.t || '').slice(0, 140),
  });
  return `${APP_LINK}?${q.toString()}`;
}

/* ------------------------------------------------------------ l'integration */

/** La cle d'un verrou : le magasin et le titre normalise, comme ownedKeys. */
export function lockKey(store, normalisedTitle) {
  return `${store}|${normalisedTitle}`;
}

/**
 * Integre des messages ouverts : les jeux obtenus ailleurs entrent au
 * registre, les verrous, les demandes d'aide et le signe de vie de l'autre
 * sont notes.
 *
 * Rend { state, library, added, imaged, helped } -- `added` compte les entrees
 * nouvelles du registre, `imaged` les cles d'entrees DEJA la qui viennent de
 * recevoir leur jaquette, `helped` les cles des demandes d'aide nouvelles.
 *
 * `imageFor(magasin, id, titre)` rend la jaquette que CET appareil connait pour
 * ce jeu, ou null (2.114.1). Le message du relais ne porte pas d'image -- elle
 * pese, et l'enveloppe est petite --, donc un jeu pris sur l'autre appareil
 * entrait au registre sans jaquette, et la liste « Recuperes » montrait sa
 * premiere lettre. L'offre, elle, est dans le catalogue de CET appareil tant
 * qu'elle court : c'est la seule fenetre pour la lui rattacher.
 *
 * Pure : ni horloge, ni stockage.
 */
export function applyMessages(state, messages, { library = {}, now, normalise, libraryKey, makeEntry, mergeEntry, imageFor = () => null }) {
  const st = { ...state, locks: { ...(state.locks || {}) }, help: { ...(state.help || {}) } };
  const lib = { ...library };
  let added = 0;
  const imaged = [];
  const helped = [];
  for (const m of messages) {
    if (!m || m.v !== VERSION || typeof m.ts !== 'number') continue;
    if (m.dev === st.dev) continue;
    if (now - m.ts > MAX_AGE_MS || m.ts - now > 5 * 60 * 1000) continue;
    const role = m.role === ROLES.PC || m.role === ROLES.PHONE ? m.role : null;
    const games = Array.isArray(m.games) ? m.games : [];
    const via = role === ROLES.PC ? 'pc' : 'telephone';

    if (m.type === TYPES.CLAIMED || m.type === TYPES.ALIVE) {
      for (const g of games) {
        if (!g || typeof g.s !== 'string' || !g.s || typeof g.t !== 'string' || !g.t) continue;
        if (g.st && !ACQUIRED.includes(g.st)) continue;
        const k = libraryKey(g.s, g.i || normalise(g.t));
        const entry = {
          ...makeEntry({
            store: g.s, id: g.i || normalise(g.t), title: g.t,
            url: typeof g.u === 'string' && /^https:\/\//.test(g.u) ? g.u : null,
            worth: typeof g.w === 'string' ? g.w : null, image: imageFor(g.s, g.i || normalise(g.t), g.t) || null,
            ts: typeof g.at === 'number' ? g.at : m.ts, status: g.st || 'claimed',
          }),
          via,
        };
        const avant = lib[k];
        const merged = avant ? { ...mergeEntry(avant, entry), via: avant.via || via } : entry;
        if (!avant) added++;
        else if (!avant.image && merged.image) imaged.push(k);
        lib[k] = merged;
      }
    }
    if (m.type === TYPES.LOCK) {
      for (const g of games) {
        if (!g || typeof g.s !== 'string' || typeof g.t !== 'string') continue;
        const until = typeof g.until === 'number' ? Math.min(g.until, m.ts + MAX_LOCK_MS) : m.ts + MAX_LOCK_MS;
        if (until <= now) continue;
        st.locks[lockKey(g.s, normalise(g.t))] = { until, dev: m.dev };
      }
    }
    /* L'autre est bloque par une verification humaine sur ces jeux : a
       l'humain de le finir ici. Une demande par jeu, la plus recente. */
    if (m.type === TYPES.HELP) {
      for (const g of games) {
        if (!g || typeof g.s !== 'string' || !g.s || typeof g.t !== 'string' || !g.t) continue;
        const until = Math.min(typeof g.until === 'number' ? g.until : m.ts + MAX_HELP_MS, m.ts + MAX_HELP_MS);
        if (until <= now) continue;
        const k = lockKey(g.s, normalise(g.t));
        const avant = st.help[k];
        if (avant && avant.at >= m.ts) continue;
        st.help[k] = {
          s: g.s.slice(0, 40), i: typeof g.i === 'string' ? g.i.slice(0, 200) : '', t: g.t.slice(0, 140),
          u: typeof g.u === 'string' && /^https:\/\//.test(g.u) ? g.u.slice(0, 300) : null,
          until, at: m.ts, dev: m.dev, role,
        };
        if (!avant) helped.push(k);
      }
    }
    if (m.type === TYPES.ALIVE || m.type === TYPES.CLAIMED || m.type === TYPES.LOCK || m.type === TYPES.HELP) {
      if (!st.peer || !(st.peer.at > m.ts)) {
        st.peer = {
          role, dev: m.dev, at: m.ts,
          stores: m.type === TYPES.ALIVE && m.stores && typeof m.stores === 'object'
            ? Object.fromEntries(Object.entries(m.stores).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').slice(0, 12))
            : (st.peer && st.peer.stores) || null,
        };
      }
    }
  }
  // Les verrous passes ne servent plus a rien.
  for (const [k, v] of Object.entries(st.locks)) if (!v || v.until <= now) delete st.locks[k];
  // Une demande d'aide s'eteint a son terme, ou quand le jeu est obtenu -- ici ou la-bas.
  const acquis = new Set(Object.values(lib)
    .filter((e) => e && e.store && e.title && (!e.status || ACQUIRED.includes(e.status)))
    .map((e) => lockKey(e.store, normalise(e.title))));
  for (const [k, v] of Object.entries(st.help)) if (!v || v.until <= now || acquis.has(k)) delete st.help[k];
  return { state: st, library: lib, added, imaged, helped: helped.filter((k) => st.help[k]) };
}

/** Les demandes d'aide encore ouvertes, de la plus recente a la plus ancienne. */
export function openHelp(state, now) {
  return Object.entries((state && state.help) || {})
    .filter(([, v]) => v && v.until > now)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.at - a.at);
}

/** Les verrous de l'autre appareil encore valides : des cles « magasin|titre ». */
export function heldKeys(state, now) {
  const out = new Set();
  for (const [k, v] of Object.entries((state && state.locks) || {})) {
    if (v && v.until > now && v.dev !== state.dev) out.add(k);
  }
  return out;
}

/** L'etat stocke, relu avec la forme qu'il doit avoir -- ou null s'il n'y a pas d'association. */
export function readRelay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = parsePairingCode(CODE_PREFIX + String(raw.secret || '') + (raw.server && raw.server !== DEFAULT_SERVER ? `@${raw.server}` : ''));
  if (!code || typeof raw.dev !== 'string' || !/^[0-9a-f]{8}$/.test(raw.dev)) return null;
  return {
    secret: code.secret,
    server: code.server,
    dev: raw.dev,
    pairedAt: typeof raw.pairedAt === 'number' ? raw.pairedAt : null,
    since: typeof raw.since === 'string' && /^[A-Za-z0-9]{1,32}$/.test(raw.since) ? raw.since : null,
    lastAlive: typeof raw.lastAlive === 'number' ? raw.lastAlive : null,
    lastSync: typeof raw.lastSync === 'number' ? raw.lastSync : null,
    lastError: typeof raw.lastError === 'string' ? raw.lastError.slice(0, 200) : null,
    peer: raw.peer && typeof raw.peer === 'object' ? raw.peer : null,
    locks: raw.locks && typeof raw.locks === 'object' ? raw.locks : {},
    help: raw.help && typeof raw.help === 'object' ? raw.help : {},
  };
}

/* ------------------------------------------------------------- le transport */

async function withTimeout(fetchImpl, url, init, timeoutMs = TIMEOUT_MS) {
  const stop = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stop ? setTimeout(() => stop.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, { ...init, credentials: 'omit', signal: stop ? stop.signal : undefined });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Publie un message chiffre. Rend { ok, status }. */
export async function publish({ fetch: fetchImpl, server, topic, envelope }) {
  try {
    const r = await withTimeout(fetchImpl, `${server}/${topic}`, {
      method: 'POST',
      headers: { 'X-Firebase': 'no', 'Content-Type': 'text/plain' },
      body: envelope,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, note: (e && e.message) || String(e) };
  }
}

/** Les messages parus depuis `since` (un id ntfy, ou « 12h »). Rend { ok, messages, last }. */
export async function poll({ fetch: fetchImpl, server, topic, since }) {
  try {
    const r = await withTimeout(fetchImpl, `${server}/${topic}/json?poll=1&since=${encodeURIComponent(since || '12h')}`, { method: 'GET' });
    if (!r.ok) return { ok: false, status: r.status, messages: [], last: since || null };
    const lignes = String(await r.text()).split('\n');
    const messages = [];
    let last = since || null;
    for (const l of lignes) {
      if (!l.trim()) continue;
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (!o || o.event !== 'message' || typeof o.message !== 'string') continue;
      messages.push(o.message);
      if (typeof o.id === 'string') last = o.id;
    }
    return { ok: true, status: r.status, messages, last };
  } catch (e) {
    return { ok: false, status: 0, messages: [], last: since || null, note: (e && e.message) || String(e) };
  }
}

/* ------------------------------------------------------ avec le stockage */

/** Le relais configure, avec son sujet et sa cle -- ou null. */
export async function relayContext(chrome) {
  const raw = (await chrome.storage.local.get(KEY_RELAY))[KEY_RELAY];
  const cfg = readRelay(raw);
  if (!cfg) return null;
  return { cfg, ...(await deriveRelay(cfg.secret)) };
}

async function patchRelay(chrome, patch) {
  const raw = (await chrome.storage.local.get(KEY_RELAY))[KEY_RELAY];
  // Dissocie entre-temps : on n'ecrit rien, surtout pas un etat sans secret.
  if (!readRelay(raw)) return;
  await chrome.storage.local.set({ [KEY_RELAY]: { ...raw, ...patch } });
}

/**
 * La jaquette que le catalogue de cet appareil connait pour un jeu, ou null.
 *
 * Par identifiant chez le magasin d'abord (la cle commune des deux appareils),
 * puis par titre dans le MEME magasin : l'autre appareil peut ranger le jeu
 * sous un identifiant que celui-ci ne connait pas.
 */
export function catalogImageLookup(catalog) {
  if (!catalog || typeof catalog !== 'object') return () => null;
  return (store, id, title) => {
    const known = enrich(store, id, catalog);
    if (known && known.image) return known.image;
    const t = normaliseTitle(title);
    if (!t) return null;
    for (const o of Object.values(catalog)) {
      if (o && o.store === store && o.image && normaliseTitle(o.title) === t) return o.image;
    }
    return null;
  };
}

/**
 * Lit le relais et integre ce qui est arrive. Rend { held, library, ctx, help }
 * -- `held` : les jeux que l'autre appareil est en train de prendre ; `help` :
 * ses demandes d'aide nouvelles -- ou null s'il n'y a pas d'association.
 */
export async function syncRelay({ chrome, fetch: fetchImpl, now, record = () => {}, catalog = null }) {
  const ctx = await relayContext(chrome);
  if (!ctx) return null;
  const { cfg } = ctx;
  const p = await poll({ fetch: fetchImpl, server: cfg.server, topic: ctx.topic, since: cfg.since });
  if (!p.ok) {
    record('warn', `relais : lecture impossible (${p.status || p.note || '?'})`);
    await patchRelay(chrome, { lastError: `lecture ${p.status || p.note || '?'}` });
    const state = { ...cfg, locks: cfg.locks };
    return { held: heldKeys(state, now), library: null, ctx, help: [] };
  }
  const ouverts = [];
  for (const e of p.messages) {
    const m = await open(e, ctx);
    if (m) ouverts.push(m);
  }
  const library0 = (await chrome.storage.local.get(KEY_LIBRARY))[KEY_LIBRARY] || {};
  const r = applyMessages({ dev: cfg.dev, locks: cfg.locks, peer: cfg.peer, help: cfg.help }, ouverts, {
    library: library0, now, normalise: normaliseTitle, libraryKey, makeEntry, mergeEntry,
    imageFor: catalogImageLookup(catalog),
  });
  let library = null;
  if (r.added || r.imaged.length) {
    // Relu juste avant d'ecrire : l'historique du moteur a pu y entrer entre-temps.
    const frais = (await chrome.storage.local.get(KEY_LIBRARY))[KEY_LIBRARY] || {};
    library = { ...frais };
    for (const [k, v] of Object.entries(r.library)) if (!library[k]) library[k] = v;
    // Une entree deja la, sans jaquette : elle recoit celle que le catalogue vient de connaitre.
    for (const k of r.imaged) {
      if (library[k] && !library[k].image && r.library[k].image) library[k] = { ...library[k], image: r.library[k].image };
    }
    await chrome.storage.local.set({ [KEY_LIBRARY]: library });
    if (r.added) record('info', `relais : ${r.added} jeu(x) obtenu(s) par l'autre appareil`);
  }
  await patchRelay(chrome, {
    since: p.last, lastSync: now, lastError: null, locks: r.state.locks, peer: r.state.peer || cfg.peer, help: r.state.help,
  });
  return { held: heldKeys(r.state, now), library, ctx, help: r.helped.map((k) => ({ key: k, ...r.state.help[k] })) };
}

/** Publie un message du relais ; une panne est notee, jamais propagee. */
export async function announce({ chrome, fetch: fetchImpl, ctx, now, type, games, record = () => {} }) {
  if (!ctx) return false;
  try {
    const m = message({ type, dev: ctx.cfg.dev, role: ROLES.PC, now, games: games.map((g) => wireGame(g)) });
    const envelope = await seal(m, ctx);
    const r = await publish({ fetch: fetchImpl, server: ctx.cfg.server, topic: ctx.topic, envelope });
    if (!r.ok) {
      record('warn', `relais : envoi « ${type} » refuse (${r.status || r.note || '?'})`);
      await patchRelay(chrome, { lastError: `envoi ${r.status || r.note || '?'}` });
    }
    return r.ok;
  } catch (e) {
    record('warn', `relais : envoi « ${type} » impossible -- ${(e && e.message) || e}`);
    return false;
  }
}

/** Le signe de vie, au plus une fois par heure, avec les derniers jeux obtenus. */
export async function maybeAlive({ chrome, fetch: fetchImpl, ctx, now, library, record = () => {} }) {
  if (!ctx) return false;
  if (ctx.cfg.lastAlive && now - ctx.cfg.lastAlive < ALIVE_EVERY_MS) return false;
  const base = message({ type: TYPES.ALIVE, dev: ctx.cfg.dev, role: ROLES.PC, now, games: [] });
  const m = await fitAlive(base, recentGames(library), async (x) => (await seal(x, ctx)).length);
  const envelope = await seal(m, ctx);
  const r = await publish({ fetch: fetchImpl, server: ctx.cfg.server, topic: ctx.topic, envelope });
  if (r.ok) await patchRelay(chrome, { lastAlive: now });
  else record('warn', `relais : signe de vie refuse (${r.status || r.note || '?'})`);
  return r.ok;
}
