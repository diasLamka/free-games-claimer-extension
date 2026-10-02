/* Le bot Telegram qui repond (2.104.0).
 *
 * Ce que ces tests tiennent :
 *   - une seule personne peut parler : la discussion PRIVEE de l'utilisateur ;
 *   - rien d'ancien ne s'execute au reveil de l'ordinateur ;
 *   - le decalage est ecrit AVANT d'agir (au plus une fois) ;
 *   - aucune reponse, aucun journal ne porte un secret ;
 *   - les gestes sont ceux des boutons du popup, et rien d'autre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_BOT, ALARM_BOT, MAX_AGE_MS, MAX_PER_POLL, MAX_PER_HOUR, MAX_LISTED, COMMANDS,
  botTarget, botBlocked, parseUpdates, authorised, parseCommand, answer, pollBot, updatesUrl, readBotState, recentCount, sortedOpen,
} from '../watch/bot.js';
import { readPhone, DEFAULT_PHONE } from '../watch/phone.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0';
const CHAT = '424242';
const NOW = Date.UTC(2026, 9, 2, 20, 0, 0);
const phone = (o = {}) => ({ on: true, service: 'telegram', token: TOKEN, chat: CHAT, bot: true, ...o });

/* ----------------------------------------------------- qui a le droit de parler */

test('le bot n\'existe que pour Telegram, active, avec un jeton valide et une discussion PRIVEE', () => {
  assert.deepEqual(botTarget(phone()), { token: TOKEN, chat: CHAT });
  assert.equal(botTarget(phone({ bot: false })), null, 'coupe par defaut');
  assert.equal(botTarget(phone({ on: false })), null);
  assert.equal(botTarget(phone({ service: 'ntfy' })), null);
  assert.equal(botTarget(phone({ token: 'pas-un-jeton' })), null);
  assert.equal(botTarget(phone({ chat: '-1001234567890' })), null, 'un groupe : n\'importe quel membre piloterait le recuperateur');
  assert.equal(botTarget(phone({ chat: '@mon_canal' })), null, 'un canal non plus');
  assert.equal(botTarget(null), null);
  assert.equal(DEFAULT_PHONE.bot, false);
  assert.equal(readPhone({}).bot, false);
  assert.equal(readPhone({ bot: 'oui' }).bot, false, 'seulement true');
  assert.equal(readPhone({ bot: true }).bot, true);
});

test('pourquoi le bot ne peut pas repondre, dit pour l\'ecran', () => {
  assert.equal(botBlocked(phone()), null);
  assert.equal(botBlocked(phone({ chat: '-100123' })), 'group');
  assert.equal(botBlocked(phone({ chat: '@canal_x' })), 'group');
  assert.equal(botBlocked(phone({ token: 'x' })), 'token');
  assert.equal(botBlocked(phone({ service: 'discord' })), 'service');
});

const message = ({ update_id = 10, ...o } = {}) => ({
  update_id, message: { text: 'etat', date: Math.floor(NOW / 1000), chat: { id: Number(CHAT), type: 'private' }, from: { id: Number(CHAT), is_bot: false }, ...o },
});

test('on lit les messages TEXTE, dans l\'ordre, et le decalage suivant', () => {
  const r = parseUpdates({ ok: true, result: [message({ text: 'b' }), { update_id: 7, message: { text: 'a', date: 1, chat: { id: 1, type: 'private' }, from: { id: 1 } } }, { update_id: 12, edited_message: {} }, { update_id: 13, message: { photo: [], chat: { id: 1, type: 'private' }, from: { id: 1 } } }] });
  assert.equal(r.valid, true);
  assert.deepEqual(r.updates.map((u) => u.id), [7, 10]);
  assert.equal(r.next, 14, 'le dernier update vu, meme sans texte, est confirme');
  assert.equal(parseUpdates({ ok: false }).valid, false);
  assert.equal(parseUpdates(null).valid, false);
  assert.deepEqual(parseUpdates({ ok: true, result: [] }), { updates: [], next: null, valid: true });
  assert.equal(parseUpdates({ ok: true, result: [message({ text: 'x'.repeat(5000) })] }).updates[0].text.length, 300);
});

test('seule la discussion privee de l\'utilisateur est ecoutee', () => {
  const u = (o) => parseUpdates({ ok: true, result: [message(o)] }).updates[0];
  assert.equal(authorised(u({}), CHAT), true);
  assert.equal(authorised(u({ chat: { id: Number(CHAT), type: 'group' } }), CHAT), false, 'un groupe');
  assert.equal(authorised(u({ chat: { id: 999, type: 'private' }, from: { id: 999 } }), CHAT), false, 'un inconnu');
  assert.equal(authorised(u({ from: { id: 999, is_bot: false } }), CHAT), false, 'meme discussion, autre expediteur');
  assert.equal(authorised(u({ from: { id: Number(CHAT), is_bot: true } }), CHAT), false, 'un bot');
  assert.equal(authorised(null, CHAT), false);
});

/* ------------------------------------------------------------- les commandes */

test('les commandes se lisent en francais et en anglais, avec ou sans accent, slash ou @nom', () => {
  const c = (txt) => parseCommand(txt).cmd;
  for (const t of ['état', 'Etat', '/etat', '/status', 'statut', 'bilan']) assert.equal(c(t), COMMANDS.STATUS, t);
  for (const t of ['jeux', '/jeux@mon_bot', 'Gratuit ?', 'games']) assert.equal(c(t), COMMANDS.GAMES, t);
  for (const t of ['prends tout', 'Prends tout !', '/prendstout', '/claim', 'récupère']) assert.equal(c(t), COMMANDS.CLAIM, t);
  for (const t of ['pause 3', 'pause 3 jours', '/pause 7', 'vacances 14', 'silence 2']) assert.equal(c(t), COMMANDS.PAUSE, t);
  for (const t of ['reprise', 'reprendre', '/resume', 'retour']) assert.equal(c(t), COMMANDS.RESUME, t);
  for (const t of ['pourquoi Hades', '/pourquoi Hades ?', 'why hades']) assert.equal(c(t), COMMANDS.WHY, t);
  for (const t of ['ce soir', 'Ce soir ?', '/cesoir', 'tonight']) assert.equal(c(t), COMMANDS.TONIGHT, t);
  for (const t of ['stop', 'Arrêt', '/urgence']) assert.equal(c(t), COMMANDS.STOP, t);
  for (const t of ['aide', '/start', 'help', 'menu']) assert.equal(c(t), COMMANDS.HELP, t);
  for (const t of ['', '   ', 'bonjour', 'prends un cafe', '????']) assert.equal(c(t), COMMANDS.UNKNOWN, t);

  assert.equal(parseCommand('pause 3 jours').arg, '3');
  assert.equal(parseCommand('pause').arg, '');
  assert.equal(parseCommand('Pourquoi Hades ?').arg, 'Hades');
  assert.equal(parseCommand('/pourquoi Dead Cells!').arg, 'Dead Cells');
});

/* ------------------------------------------------------------- les reponses */

const dit = (k, ...a) => `${k}|${a.join('|')}`;
const offre = (o = {}) => ({
  title: 'Hades', store: 'epic', storeId: 'hades', url: 'https://store.epicgames.com/fr/p/hades', end: NOW + 5 * 3600 * 1000, worth: '24,99 EUR', keepable: true, ...o,
});
const ctx = (o = {}) => ({
  t: dit, now: NOW, open: [offre()], filters: {}, judging: { supportedStores: ['epic', 'gog'], owned: null, ownedIds: null },
  lastCheck: NOW - 20 * 60000, vacation: null, stopped: false, autoClaim: true, incidents: 0, library: {}, tonight: null,
  dateText: (ts) => new Date(ts).toISOString().slice(0, 10), ...o,
});
const cmd = (txt) => parseCommand(txt);

test('etat : combien, depuis quand, et ce qui pese', () => {
  assert.equal(answer(cmd('etat'), ctx()).text, 'botStatusGames|1|1\nbotStatusLast|20 min');
  const lourd = ctx({ stopped: true, vacation: { until: NOW + 3 * 86400000 }, incidents: 2, lastCheck: null, open: [] });
  assert.equal(answer(cmd('etat'), lourd).text, ['botStatusNone|', 'botStatusNever|', 'botStatusStopped|', 'botStatusVacation|2026-10-05', 'botStatusIncidents|2'].join('\n'));
  assert.match(answer(cmd('etat'), ctx({ autoClaim: false })).text, /botStatusAuto/);
  // Un jeu que je ne peux pas prendre seul n'est pas compte comme tel.
  assert.match(answer(cmd('etat'), ctx({ open: [offre(), offre({ title: 'Autre', store: 'steam' })] })).text, /^botStatusGames\|2\|1/);
});

test('jeux : la fin la plus proche d\'abord, des liens https seulement, huit au plus', () => {
  const open = [
    offre({ title: 'Tard', end: NOW + 48 * 3600e3 }),
    offre({ title: 'Bientot', end: NOW + 2 * 3600e3, url: 'javascript:alert(1)', resolveUrl: null }),
    offre({ title: 'Sans fin', end: null }),
  ];
  const lignes = answer(cmd('jeux'), ctx({ open })).text.split('\n');
  assert.equal(lignes[0], 'botGamesHeader|');
  assert.equal(lignes[1], 'botGameLine|Bientot|Epic Games Store|2 h');
  assert.equal(lignes[2], 'botGameLine|Tard|Epic Games Store|2 j');
  assert.ok(lignes.some((l) => l.includes('|Sans fin|') && l.endsWith('∞')));
  assert.ok(!answer(cmd('jeux'), ctx({ open })).text.includes('javascript:'), 'jamais un lien qui n\'est pas https');
  const beaucoup = Array.from({ length: 12 }, (_, i) => offre({ title: `Jeu ${i}`, end: NOW + (i + 1) * 3600e3 }));
  const r = answer(cmd('jeux'), ctx({ open: beaucoup })).text;
  assert.equal(r.split('\n').filter((l) => l.startsWith('botGameLine')).length, MAX_LISTED);
  assert.match(r, /botGamesMore\|4$/);
  assert.equal(answer(cmd('jeux'), ctx({ open: [] })).text, 'botStatusNone|');
  assert.deepEqual(sortedOpen([offre({ title: 'b', end: 2 }), offre({ title: 'a', end: 1 })]).map((o) => o.title), ['a', 'b']);
});

test('prends tout : le meme geste que le bouton, et ses garde-fous', () => {
  const ok = answer(cmd('prends tout'), ctx());
  assert.deepEqual(ok.effect, { kind: 'claim' });
  assert.equal(ok.text, 'botClaimStart|1');
  assert.equal(answer(cmd('prends tout'), ctx({ stopped: true })).effect, undefined, 'arret d\'urgence : rien');
  assert.equal(answer(cmd('prends tout'), ctx({ stopped: true })).text, 'botClaimStopped|');
  assert.equal(answer(cmd('prends tout'), ctx({ autoClaim: false })).effect, undefined, 'recuperation automatique coupee : rien');
  assert.equal(answer(cmd('prends tout'), ctx({ open: [offre({ store: 'steam' })] })).effect, undefined, 'rien que je puisse prendre seul');
  assert.equal(answer(cmd('prends tout'), ctx({ open: [offre({ keepable: false })] })).text, 'botClaimNothing|');
});

test('pause : de 1 a 60 jours, sinon on redemande', () => {
  const r = answer(cmd('pause 3'), ctx());
  assert.deepEqual(r.effect, { kind: 'vacation', days: 3 });
  assert.equal(r.text, 'botPauseDone|3|2026-10-05');
  for (const mauvais of ['pause', 'pause 0', 'pause 61', 'pause abc', 'pause 3.5 5000']) {
    const x = answer(cmd(mauvais), ctx());
    if (mauvais === 'pause 3.5 5000') { assert.ok(x.effect === undefined || x.effect.days === 3, mauvais); continue; }
    assert.equal(x.effect, undefined, mauvais);
    assert.equal(x.text, 'botPauseBad|', mauvais);
  }
});

test('reprise et stop', () => {
  assert.deepEqual(answer(cmd('reprise'), ctx({ stopped: true })).effect, { kind: 'resume' });
  assert.equal(answer(cmd('reprise'), ctx({ stopped: true })).text, 'botResumeStop|');
  assert.deepEqual(answer(cmd('reprise'), ctx({ vacation: { until: NOW + 1 } })).effect, { kind: 'resume' });
  assert.equal(answer(cmd('reprise'), ctx()).effect, undefined);
  assert.deepEqual(answer(cmd('stop'), ctx()).effect, { kind: 'stop' });
});

test('pourquoi : ce que la veille sait du jeu, sans deviner', () => {
  const r = answer(cmd('pourquoi hades'), ctx({ open: [offre({ verdict: 'needs_login' })] })).text.split('\n');
  assert.equal(r[0], 'botWhyHeader|Hades|Epic Games Store');
  assert.equal(r[1], 'botWhyEnds|5 h');
  assert.equal(r[2], 'botWhyVerdict|verdictNeedsLogin|', 'le dernier essai, dans les mots du popup');

  const ecarte = answer(cmd('pourquoi hades'), ctx({ filters: { minWorth: 50 }, open: [offre()] })).text;
  assert.match(ecarte, /botWhyDrop\|dropBelow/);
  const jamais = answer(cmd('pourquoi hades'), ctx({ filters: { excludedTitles: ['hades'] } })).text;
  assert.match(jamais, /botWhyDrop\|dropExcluded/);
  assert.match(answer(cmd('pourquoi hades'), ctx({ open: [offre({ nextAttemptAt: NOW + 3 * 3600e3, verdict: 'failed' })] })).text, /botWhyBackoff\|3 h/);
  assert.match(answer(cmd('pourquoi hades'), ctx()).text, /botWhyWaiting/);

  assert.equal(answer(cmd('pourquoi'), ctx()).text, 'botWhyAsk|');
  assert.equal(answer(cmd('pourquoi zzz'), ctx()).text, 'botWhyNone|zzz');
  const deja = answer(cmd('pourquoi celeste'), ctx({ library: { 'epic:celeste': { store: 'epic', title: 'Celeste', ts: NOW - 86400000 } } })).text;
  assert.equal(deja, 'botWhyOwned|Celeste|Epic Games Store|2026-10-01');
});

test('ce soir, aide, et ce qu\'on ne comprend pas', () => {
  assert.equal(answer(cmd('ce soir'), ctx({ tonight: { title: 'Hollow Knight', page: 'https://store.steampowered.com/app/367520' } })).text, 'botTonight|Hollow Knight\nhttps://store.steampowered.com/app/367520');
  assert.equal(answer(cmd('ce soir'), ctx()).text, 'botTonightNone|');
  assert.equal(answer(cmd('aide'), ctx()).text, 'botHelp|');
  assert.equal(answer(cmd('blabla'), ctx()).text, 'botUnknown|');
});

test('JAMAIS un secret dans une reponse : codes, jetons, adresses ne sont meme pas lus', () => {
  const secret = 'SECRET-CODE-XYZ';
  const sale = offre({ code: secret, redeemCode: secret, token: secret, cookie: secret, webhook: `https://discord.com/api/webhooks/1/${secret}` });
  const c = ctx({ open: [sale], library: { 'epic:hades': { store: 'epic', title: 'Hades', ts: 1, code: secret, token: secret } }, codes: [{ code: secret }], phone: { token: TOKEN } });
  for (const t of ['etat', 'jeux', 'prends tout', 'pause 2', 'reprise', 'stop', 'pourquoi hades', 'ce soir', 'aide', 'zut']) {
    const texte = answer(cmd(t), c).text;
    assert.ok(!texte.includes(secret), t);
    assert.ok(!texte.includes(TOKEN), t);
  }
});

/* --------------------------------------------------------------- la lecture */

/** Un faux Telegram + un faux stockage : tout ce qui part, dans l'ordre. */
function monde({ updates = [], status = 200, state = null, reject = false, effects = null } = {}) {
  const log = [];
  let etat = state;
  const envoyes = [];
  const fetchFalse = async (url, init = {}) => {
    log.push({ url, init });
    if (reject) throw new Error('hors ligne');
    if (url.includes('/sendMessage')) { envoyes.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
    return { ok: status < 400, status, json: async () => ({ ok: true, result: updates }) };
  };
  const journal = [];
  const faits = [];
  return {
    log, envoyes, journal, faits,
    get etat() { return etat; },
    run: (o = {}) => pollBot({
      fetch: fetchFalse, target: { token: TOKEN, chat: CHAT }, now: NOW,
      read: async () => etat, write: async (e) => { log.push({ write: e }); etat = e; },
      context: async () => ctx(), t: dit,
      effects: effects || (async (e) => { faits.push(e); log.push({ effet: e.kind }); return null; }),
      record: (niveau, msg) => journal.push(`${niveau}: ${msg}`),
      ...o,
    }),
  };
}

test('rien ne se lit tant que le bot est coupe', async () => {
  const m = monde();
  assert.deepEqual(await m.run({ target: null }), { skipped: 'off' });
  assert.equal(m.log.length, 0);
});

test('premiere lecture : on se cale sur le dernier message, sans rien executer ni repondre', async () => {
  const m = monde({ updates: [message({ text: 'prends tout' })] });
  assert.deepEqual(await m.run(), { primed: true });
  assert.ok(m.log[0].url.includes('offset=-1'));
  assert.equal(m.etat.offset, 11);
  assert.equal(m.envoyes.length, 0);
  assert.equal(m.faits.length, 0, 'un vieux « prends tout » ne part pas a l\'activation');
});

test('une commande de l\'utilisateur : lue, confirmee AVANT d\'agir, executee, repondue', async () => {
  const m = monde({ state: { offset: 10 }, updates: [message({ text: 'prends tout', update_id: 10 })] });
  const r = await m.run();
  assert.equal(r.handled, 1);
  assert.ok(m.log[0].url.includes('/getUpdates') && m.log[0].url.includes('offset=10'));
  assert.equal(m.log[0].init.credentials, 'omit', 'aucun cookie');
  const ordre = m.log.map((x) => (x.write ? `ecrit:${x.write.offset}` : x.effet ? `effet:${x.effet}` : x.url.includes('sendMessage') ? 'envoi' : 'lecture'));
  assert.deepEqual(ordre.slice(0, 4), ['lecture', 'ecrit:11', 'envoi', 'effet:claim'], 'le decalage est ecrit avant l\'effet');
  assert.equal(m.envoyes[0].chat_id, Number(CHAT));
  assert.equal(m.envoyes[0].text, 'botClaimStart|1');
  assert.equal(m.envoyes[0].disable_web_page_preview, true);
  assert.equal(m.etat.offset, 11);
  assert.equal(m.etat.handled, 1);
});

test('le resultat d\'une reclamation est dit dans un second message', async () => {
  const m = monde({ state: { offset: 1 }, updates: [message({ text: 'prends tout', update_id: 1 })], effects: async () => ({ text: 'botClaimDone|2|0' }) });
  await m.run();
  assert.deepEqual(m.envoyes.map((e) => e.text), ['botClaimStart|1', 'botClaimDone|2|0']);
});

test('un effet qui echoue se dit, sans detail dans le message', async () => {
  const m = monde({ state: { offset: 1 }, updates: [message({ text: 'stop', update_id: 1 })], effects: async () => { throw new Error(`boom ${TOKEN}`); } });
  await m.run();
  assert.equal(m.envoyes[m.envoyes.length - 1].text, 'botError|');
  assert.ok(!JSON.stringify(m.envoyes).includes(TOKEN));
});

test('un inconnu, un groupe, un autre expediteur : ignores, sans reponse', async () => {
  const m = monde({ state: { offset: 1 }, updates: [
    message({ update_id: 1, chat: { id: 999, type: 'private' }, from: { id: 999, is_bot: false } }),
    message({ update_id: 2, chat: { id: Number(CHAT), type: 'group' } }),
    message({ update_id: 3, from: { id: 5, is_bot: false } }),
  ] });
  const r = await m.run();
  assert.equal(r.handled, 0);
  assert.equal(r.ignored, 3);
  assert.equal(m.envoyes.length, 0, 'on n\'est pas un echo pour des inconnus');
  assert.equal(m.faits.length, 0);
  assert.equal(m.etat.offset, 4, 'et leurs messages sont confirmes : on ne les relit pas');
});

test('un message ancien n\'est PAS execute : on le dit, une fois', async () => {
  const vieux = (id) => message({ update_id: id, text: 'prends tout', date: Math.floor((NOW - MAX_AGE_MS - 60000) / 1000) });
  const m = monde({ state: { offset: 1 }, updates: [vieux(1), vieux(2)] });
  const r = await m.run();
  assert.equal(r.handled, 0);
  assert.equal(m.faits.length, 0);
  assert.equal(m.envoyes.length, 1);
  assert.match(m.envoyes[0].text, /^botStale\|1[5-9] min|^botStale\|\d+ min/);
  // Un message sans date lisible est traite comme ancien.
  const sans = monde({ state: { offset: 1 }, updates: [message({ update_id: 1, date: undefined })] });
  await sans.run();
  assert.equal(sans.faits.length, 0);
});

test('cinq commandes par lecture au plus, trente par heure', async () => {
  const ups = Array.from({ length: 8 }, (_, i) => message({ update_id: i + 1, text: 'etat' }));
  const m = monde({ state: { offset: 1 }, updates: ups });
  const r = await m.run();
  assert.equal(r.handled, MAX_PER_POLL);
  assert.equal(m.envoyes.length, MAX_PER_POLL);
  assert.equal(m.etat.offset, MAX_PER_POLL + 1, 'les trois suivantes restent chez Telegram, lues a la minute d\'apres');

  const recent = Array.from({ length: MAX_PER_HOUR }, (_, i) => NOW - i * 1000);
  const sature = monde({ state: { offset: 1, recent }, updates: [message({ update_id: 1 }), message({ update_id: 2 })] });
  const s = await sature.run();
  assert.equal(s.handled, 0);
  assert.deepEqual(sature.envoyes.map((e) => e.text), ['botSlowDown|'], 'une seule fois');
  assert.equal(recentCount(recent, NOW), MAX_PER_HOUR);
  assert.equal(recentCount([NOW - 2 * 3600e3], NOW), 0);
});

test('une panne de Telegram se dit, sans jamais citer l\'adresse (elle porte le jeton)', async () => {
  for (const [status, attendu] of [[409, /409.*webhook/], [401, /401.*jeton/], [429, /429/], [500, /HTTP 500/]]) {
    const m = monde({ state: { offset: 5 }, status });
    const r = await m.run();
    assert.equal(r.skipped, 'status');
    assert.equal(m.etat.ok, false);
    assert.match(m.etat.note, attendu);
    assert.equal(m.etat.offset, 5, 'rien n\'est confirme');
    assert.ok(![...m.journal, JSON.stringify(m.etat)].join('\n').includes(TOKEN), 'ni le journal ni l\'etat ne portent le jeton');
  }
  const hors = monde({ state: { offset: 5 }, reject: true });
  assert.equal((await hors.run()).skipped, 'network');
  assert.equal(hors.etat.note, 'Telegram injoignable');
  // Le meme avertissement ne se repete pas a chaque minute.
  const encore = monde({ state: { offset: 5, ok: false, note: 'HTTP 409 : un webhook ou un autre programme lit deja les messages de ce bot' }, status: 409 });
  await encore.run();
  assert.equal(encore.journal.length, 0);
});

test('l\'etat stocke est relu avec ses defauts', () => {
  assert.deepEqual(readBotState(null), { offset: null, at: null, ok: true, note: null, handled: 0, ignored: 0, recent: [] });
  assert.equal(readBotState({ offset: 'x' }).offset, null);
  assert.equal(readBotState({ offset: 4, ok: false, note: 'n' }).ok, false);
  assert.ok(updatesUrl(TOKEN, 5).includes('allowed_updates=%5B%22message%22%5D'), 'seulement les messages');
  assert.ok(updatesUrl(TOKEN, -1).includes('limit=1'));
  assert.equal(KEY_BOT, 'veille:bot');
});

/* ----------------------------------------------------- branchement et phrases */

test('branche partout : alarme, worker, reglages, popup', () => {
  const bg = lire('background.js');
  assert.match(bg, /alarme\.name === ALARM_BOT/);
  assert.match(bg, /periodInMinutes: BOT_POLL_MINUTES/);
  assert.match(bg, /if \(area === 'local' && changes\[KEY_PHONE\]\) armBot\(\)/, 'le bot s\'arme et se desarme avec ses reglages');
  assert.match(bg, /effect\.kind === 'claim'[\s\S]*claimAllNow\(\{ chrome: api, claimableStores: CLAIMABLE_STORES/, 'le meme geste que « Tout recuperer »');
  assert.match(bg, /if \(botBusy\) return null;/, 'une lecture a la fois');
  assert.equal(ALARM_BOT, 'veille-bot');
  const popup = lire('pages/popup.js');
  assert.match(popup, /writePhone\(\{ bot: e\.target\.checked \}\)/);
  assert.match(lire('pages/popup.html'), /id="phone-bot"/);
  const manifest = JSON.parse(lire('manifest.json'));
  assert.ok(!manifest.permissions.includes('webRequest'), 'aucune permission nouvelle');
  assert.ok(manifest.permissions.includes('alarms'));
});

test('chaque phrase du bot existe dans les quatre langues, avec ses trous', () => {
  const source = lire('watch/bot.js');
  const cles = new Set([...source.matchAll(/'(bot[A-Z][A-Za-z]+)'/g)].map((m) => m[1]));
  assert.ok(cles.size >= 30);
  const trous = { botGameLine: 3, botStatusGames: 2, botWhyOwned: 3, botWhyHeader: 2, botClaimDone: 2, botPauseDone: 2 };
  for (const l of ['fr', 'en', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const c of cles) {
      assert.ok(table[c] && table[c].message, `${l} ${c}`);
      for (let i = 1; i <= (trous[c] || 0); i++) assert.ok(table[c].message.includes(`$${i}`), `${l} ${c} $${i}`);
    }
    for (const c of ['phoneBotLabel', 'phoneBotHint', 'phoneBotListening', 'phoneBotWaiting', 'phoneBotFailed', 'phoneBotGroup']) assert.ok(table[c].message, `${l} ${c}`);
  }
});
