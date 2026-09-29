/* Les messages Telegram, mis en page (2.99.1).
 *
 * La demande : « plus jolis, avec le maximum de logos, d'icones, d'emoticones ».
 * Ce qui est verifie ici, c'est autant le joli que le sur : tout texte venu
 * d'un magasin passe par l'echappement HTML, et rien ne part de plus qu'avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KIND_ICON, STORE_ICON, MAX_TEXT, MAX_CAPTION,
  esc, storeIcon, formatLine, telegramText, telegramRequests,
} from '../watch/telegram-format.js';
import * as P from '../watch/phone.js';
import { STORE_LABELS } from '../watch/offer.js';
import { composeRecap } from '../watch/recap.js';
import { composeReturn } from '../watch/vacation.js';
import { composeReminder } from '../watch/code-reminders.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';
import { setLocale } from '../lib/i18n.js';

const BOT = '123456789:AAEhBOweik6ad7oXbqYCpTAShdSyRKcXgQ0';
const cible = P.phoneTarget({ on: true, service: 'telegram', token: BOT, chat: '42' });
const corps = (r) => JSON.parse(r.init.body);

test('chaque magasin connu a son logo, et rien d\'autre n\'en prend un', () => {
  for (const [id, label] of Object.entries(STORE_LABELS)) {
    if (id === 'unknown') continue;
    assert.ok(storeIcon(label), `${id} : ${label}`);
  }
  assert.equal(storeIcon('Steam'), '♨️');
  assert.equal(storeIcon('gog.com'), '🟣', 'sans egard a la casse');
  assert.equal(storeIcon('Android, iOS'), null);
  assert.equal(storeIcon(''), null);
  assert.ok(Object.keys(STORE_ICON).length >= 12);
});

test('l\'echappement neutralise le balisage et les mentions', () => {
  assert.equal(esc('<b>Tom & Jerry</b>'), '&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;');
  assert.equal(esc('@quelquun'), '@​quelquun');
  assert.equal(esc('a@b'), 'a@​b');
  assert.equal(esc(null), '');
  const t = telegramText({ title: '<script>alert(1)</script>', message: 'Jeu <i>x</i> -- Steam', tags: ['video_game'] });
  assert.ok(!t.includes('<script>') && !/<i>x<\/i>/.test(t));
  assert.ok(t.includes('&lt;script&gt;'));
});

test('une ligne « Titre -- Magasin -- delai » devient une carte avec le logo du magasin', () => {
  const l = formatLine('Hades -- GOG.com -- 2 j 23 h pour le prendre.');
  assert.equal(l, '🟣 <b>Hades</b>\n└ <i>GOG.com</i>  ·  ⏳ <i>2 j 23 h pour le prendre.</i>');
  assert.equal(formatLine('Hades -- Epic Games Store'), '🛡️ <b>Hades</b>\n└ <i>Epic Games Store</i>');
  // Un titre a chevrons ne casse pas la carte.
  assert.ok(formatLine('<3 Game -- Steam').startsWith('♨️ <b>&lt;3 Game</b>'));
});

test('un jeu mobile montre ses plateformes en icones', () => {
  assert.equal(formatLine('Fortnite -- Android, iOS'), '📱 <b>Fortnite</b>\n└ 🤖 Android · 🍎 iOS');
  // Autre chose qu\'une plateforme : pas de faux emoji.
  assert.ok(!formatLine('Titre -- autre chose').includes('🤖'));
});

test('une panne : la phrase, et le motif technique en monospace dessous', () => {
  const l = formatLine('Steam a changé sa page (steam : 2 echec(s) de selecteur d\'affilee)', { icon: '🧩', kind: 'warning' });
  assert.equal(l, '🧩 Steam a changé sa page\n└ <code>steam : 2 echec(s) de selecteur d\'affilee</code>');
  assert.equal(formatLine('La veille ne tourne plus', { icon: '💤', kind: 'warning' }), '💤 La veille ne tourne plus');
});

test('une ligne « Etiquette : valeur » met l\'etiquette en gras, et un prix prend une bourse', () => {
  assert.equal(formatLine('Récupérés : Hades, Celeste (valeur 40,98 €)', { icon: '✅' }), '✅ <b>Récupérés</b> : Hades, Celeste (valeur 💶 <b>40,98 €</b>)');
  assert.equal(formatLine('Rien de structuré ici'), '💬 <i>Rien de structuré ici</i>');
});

test('le titre porte l\'icone du genre, chaque genre a la sienne', () => {
  for (const [genre, icone] of Object.entries(KIND_ICON)) {
    const t = telegramText({ title: 'T', message: 'x', tags: [genre] });
    assert.ok(t.startsWith(`${icone} <b>T</b>`), genre);
  }
  assert.ok(telegramText({ title: 'T', message: 'x', tags: ['inconnu'] }).startsWith('🎁 <b>T</b>'));
  assert.ok(telegramText({ title: 'T', message: 'x' }).startsWith('🎁 <b>T</b>'));
  const t = telegramText({ title: 'Un jeu attendu est gratuit : Hades', message: 'Hades -- GOG.com', tags: ['video_game'] });
  assert.match(t, /^🎮 <b>Un jeu attendu est gratuit : Hades<\/b> ✨\n▰+\n🟣 <b>Hades<\/b>\n└ <i>GOG\.com<\/i>\n▰+\n<i>🕹️ Free Games Claimer<\/i>$/);
});

test('le lien devient un bouton, seulement en https', () => {
  setLocale('fr');
  const r = telegramRequests(cible, { title: 'T', message: 'x', tags: ['video_game'], click: 'https://store.epicgames.com/p/hades' });
  const c = corps(r);
  assert.equal(c.parse_mode, 'HTML');
  assert.deepEqual(c.reply_markup, { inline_keyboard: [[{ text: '🎁 Voir le jeu', url: 'https://store.epicgames.com/p/hades' }]] });
  assert.equal(r.url, cible.url);
  const code = corps(telegramRequests(cible, { title: 'T', message: 'x', tags: ['key'], click: 'https://www.gog.com/redeem' }));
  assert.match(code.reply_markup.inline_keyboard[0][0].text, /^🔑 /);
  const autre = corps(telegramRequests(cible, { title: 'T', message: 'x', tags: ['calendar'], click: 'https://exemple.org/' }));
  assert.match(autre.reply_markup.inline_keyboard[0][0].text, /^🔗 /);
  for (const mauvais of ['http://exemple.org/', 'javascript:alert(1)', 'fgclaimer://finir?s=a&i=b&t=c', '', null]) {
    assert.equal(corps(telegramRequests(cible, { title: 'T', message: 'x', click: mauvais })).reply_markup, undefined, String(mauvais));
  }
  // Le libelle suit la langue choisie.
  setLocale('de');
  assert.match(corps(telegramRequests(cible, { title: 'T', message: 'x', tags: ['video_game'], click: 'https://a.org/' })).reply_markup.inline_keyboard[0][0].text, /Spiel ansehen/);
  setLocale(null);
});

test('avec une jaquette : une photo, la legende dit le message, et un repli sans photo existe', () => {
  const msg = { title: 'Un jeu attendu est gratuit : Hades', message: 'Hades -- GOG.com', tags: ['video_game'], click: 'https://www.gog.com/game/hades', image: 'https://images.gog-statics.com/hades.jpg' };
  const r = telegramRequests(cible, msg);
  assert.equal(r.url, cible.url.replace('/sendMessage', '/sendPhoto'));
  const c = corps(r);
  assert.equal(c.photo, msg.image);
  assert.ok(c.caption.includes('Hades') && c.caption.length <= MAX_CAPTION);
  assert.equal(c.parse_mode, 'HTML');
  assert.ok(c.reply_markup.inline_keyboard);
  assert.equal(r.fallback.url, cible.url);
  assert.ok(corps(r.fallback).text.includes('Hades'));
  // Une image qui n'est pas en https ne part pas.
  for (const mauvaise of ['http://x.org/a.jpg', 'data:image/png;base64,AAAA', '', null]) {
    const q = telegramRequests(cible, { ...msg, image: mauvaise });
    assert.equal(q.url, cible.url, String(mauvaise));
    assert.equal(q.fallback, undefined);
  }
});

test('une photo refusee (400) : le message part quand meme, sans photo', async () => {
  const msg = { title: 'T', message: 'Hades -- GOG.com', tags: ['video_game'], image: 'https://exemple.org/i.jpg' };
  const appels = [];
  const fetchImpl = async (url, init) => {
    appels.push(url);
    return url.endsWith('/sendPhoto') ? { ok: false, status: 400, json: async () => ({ description: 'Bad Request: wrong file identifier/HTTP URL specified' }) } : { ok: true, status: 200 };
  };
  const r = await P.sendPhone({ fetch: fetchImpl, target: cible, msg });
  assert.equal(r.ok, true);
  assert.deepEqual(appels.map((u) => u.split('/').pop()), ['sendPhoto', 'sendMessage']);
  // Un autre refus (403 : bot bloque) n'est pas retente en texte : ce serait refuse pareil.
  const bloque = [];
  const r2 = await P.sendPhone({ fetch: async (u) => { bloque.push(u); return { ok: false, status: 403, json: async () => ({ description: 'Forbidden: bot was blocked by the user' }) }; }, target: cible, msg });
  assert.equal(r2.ok, false);
  assert.equal(bloque.length, 1);
  assert.match(r2.note, /bloque/);
});

test('la limite de Telegram est tenue, et la coupe ne casse jamais un balisage', () => {
  const longue = Array.from({ length: 400 }, (_, i) => `Jeu numero ${i} <b> -- Steam -- encore ${i} h`).join('\n');
  const t = telegramText({ title: 'T', message: longue, tags: ['video_game'] });
  assert.ok(t.length <= MAX_TEXT);
  assert.ok(t.includes('…'));
  // Chaque <b> ouvert est ferme.
  assert.equal((t.match(/<b>/g) || []).length, (t.match(/<\/b>/g) || []).length);
  assert.equal((t.match(/<i>/g) || []).length, (t.match(/<\/i>/g) || []).length);
  const c = telegramText({ title: 'T', message: longue, tags: ['video_game'] }, MAX_CAPTION);
  assert.ok(c.length <= MAX_CAPTION);
  assert.ok(c.endsWith('</i>'), 'le pied reste');
});

test('les alertes reelles, de bout en bout', () => {
  // Un jeu attendu.
  const attendu = P.wishedMessage([{ title: 'Hades', store: 'gog', url: 'https://www.gog.com/game/hades', image: 'https://images.gog-statics.com/hades.jpg' }], {
    title: (x) => `Un jeu attendu est gratuit : ${x}`,
    line: (o) => `${o.title} -- ${STORE_LABELS[o.store]}`,
  });
  assert.equal(attendu.image, 'https://images.gog-statics.com/hades.jpg');
  const r = telegramRequests(cible, attendu);
  assert.match(corps(r).caption, /🟣 <b>Hades<\/b>/);
  // Une panne : une icone par genre.
  const panne = P.incidentsMessage(
    [{ kind: 'selector', key: 'steam', detail: 'steam : 2 echec(s)' }, { kind: 'stalled', key: null, detail: 'dernier cycle il y a 10 h' }],
    { title: 'Free Games : l\'extension a besoin de vous', label: (k, key) => (k === 'selector' ? `${key} a changé sa page` : 'La veille ne tourne plus') },
  );
  assert.deepEqual(panne.icons, ['🧩', '💤']);
  const t = corps(telegramRequests(cible, panne)).text;
  assert.ok(t.startsWith('🚨 <b>Free Games'));
  assert.match(t, /🧩 steam a changé sa page\n└ <code>steam : 2 echec\(s\)<\/code>/);
  assert.match(t, /💤 La veille ne tourne plus\n└ <code>dernier cycle il y a 10 h<\/code>/);
});

test('recap, retour de vacances et rappel de code : une icone par ligne', () => {
  const t = (cle, ...a) => `${cle}:${a.join('|')}`;
  const recap = { claimed: [{ title: 'Hades' }], manual: [{ title: 'Tunic', store: 'epic' }], missed: [{ title: 'Gris' }], upcoming: [{ title: 'Celeste' }] };
  const r = composeRecap(recap, { t });
  assert.deepEqual(r.icons, ['✅', '🖐️', '❌', '🔜']);
  assert.equal(r.icons.length, r.lines.length);
  const v = composeReturn({ claimed: [], manual: [], missed: [], upcoming: [] }, { t });
  assert.equal(v.icons.length, 1);
  assert.equal(v.icons[0], '😌');
  const deux = composeReturn(recap, { t });
  assert.equal(deux.icons.length, 4);
  const rappel = composeReminder(
    [{ store: 'gog', title: 'Hades', deadline: '2026-10-01', left: 1, code: 'SECRET-CODE-1234' }],
    { t, storeLabel: (s) => s },
  );
  assert.deepEqual(rappel.icons, ['🔑', '💡']);
  // Jamais un code de rachat dans ce qui part.
  assert.ok(!JSON.stringify(corps(telegramRequests(cible, { title: rappel.title, message: rappel.text, tags: ['key'], icons: rappel.icons }))).includes('SECRET-CODE'));
});

test('l\'essai, les reglages et les libelles', () => {
  assert.equal(DEFAULT_SETTINGS.taste, true);
  const essai = telegramText({ title: 'Free Games : essai reçu', message: 'Les alertes de l\'extension arriveront ici.', tags: ['white_check_mark'] });
  assert.match(essai, /^✅ <b>Free Games : essai reçu<\/b> 🎉/);
  assert.match(essai, /💬 <i>Les alertes de l'extension arriveront ici\.<\/i>/);
});
