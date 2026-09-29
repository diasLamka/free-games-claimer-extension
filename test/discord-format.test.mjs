/* Les alertes Discord, en cartes (2.99.3).
 *
 * Meme lecture des lignes que Telegram (watch/alert-model.js), autre habillage :
 * du Markdown dans une carte a liseré. Ce qui compte autant que le joli : un
 * titre de jeu venu d'un magasin ne casse pas le Markdown et ne mentionne
 * personne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { escMd, renderNode, discordEmbed, discordRequests, MAX_TITLE, MAX_DESCRIPTION } from '../watch/discord-format.js';
import { parseLine, parseMessage, kindOf, KIND_COLOR, KIND_ICON } from '../watch/alert-model.js';
import { formatLine, telegramText } from '../watch/telegram-format.js';
import * as P from '../watch/phone.js';
import { STORE_LABELS } from '../watch/offer.js';
import { setLocale } from '../lib/i18n.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdef';
const cible = P.phoneTarget({ on: true, service: 'discord', url: WEBHOOK });
const corps = (r) => JSON.parse(r.init.body);

test('le modele lit une ligne une fois, Telegram et Discord l\'habillent chacun', () => {
  const n = parseLine('Hades -- GOG.com -- 2 j 23 h pour le prendre.');
  assert.deepEqual(n, {
    type: 'game', icon: '🟣', title: 'Hades', store: 'GOG.com',
    chips: [{ text: '2 j 23 h pour le prendre.', time: true }],
  });
  assert.equal(renderNode(n), '🟣 **Hades**\n└ *GOG\\.com*  ·  ⏳ *2 j 23 h pour le prendre\\.*'.replace(/\\\./g, '.'));
  assert.equal(formatLine('Hades -- GOG.com -- 2 j 23 h pour le prendre.'), '🟣 <b>Hades</b>\n└ <i>GOG.com</i>  ·  ⏳ <i>2 j 23 h pour le prendre.</i>');
  assert.deepEqual(parseLine('Fortnite -- Android, iOS').platforms.map((p) => p.icon), ['🤖', '🍎']);
  assert.equal(parseLine('Rien de structure ici').type, 'note');
  assert.equal(parseLine('Recuperes : A, B', { icon: '✅' }).type, 'label');
  assert.equal(parseLine('Steam a change (motif)', { kind: 'warning', icon: '🧩' }).detail, 'motif');
  assert.equal(parseLine(''), null);
  assert.equal(kindOf({ tags: ['key'] }), 'key');
  assert.equal(kindOf({}), null);
  assert.deepEqual(parseMessage({ message: 'a\n\n  b  ', tags: [] }).map((x) => x.text), ['a', 'b']);
});

test('le Markdown d\'un titre venu d\'un magasin est neutralise, les mentions coupees', () => {
  assert.equal(escMd('**gras** _it_ ~~x~~ `c` |s| > # [l](u) <@1>'), '\\*\\*gras\\*\\* \\_it\\_ \\~\\~x\\~\\~ \\`c\\` \\|s\\| \\> \\# \\[l\\]\\(u\\) \\<@\u200b1\\>');
  assert.equal(escMd('@everyone'), '@\u200beveryone');
  assert.equal(escMd(null), '');
  const n = renderNode(parseLine('[Evil](https://x.org) *Game* -- Steam'));
  assert.ok(!n.includes('[Evil](https'), 'aucun lien fabrique par un titre');
  assert.ok(n.startsWith('♨️ **\\[Evil\\]\\(https://x.org\\) \\*Game\\***'));
});

test('une carte : liseré du genre, titre-lien, description en cartes de jeu, pied', () => {
  setLocale('fr');
  const e = discordEmbed({
    title: 'Un jeu attendu est gratuit : Hades', message: 'Hades -- GOG.com', tags: ['video_game'],
    click: 'https://www.gog.com/game/hades', image: 'https://images.gog-statics.com/hades.jpg',
  });
  assert.equal(e.title, '🎮 Un jeu attendu est gratuit : Hades ✨');
  assert.equal(e.url, 'https://www.gog.com/game/hades');
  assert.equal(e.color, KIND_COLOR.video_game);
  assert.equal(e.image.url, 'https://images.gog-statics.com/hades.jpg');
  assert.equal(e.description, '🟣 **Hades**\n└ *GOG.com*\n\n[🎁 Voir le jeu](https://www.gog.com/game/hades)');
  assert.equal(e.footer.text, '🕹️ Free Games Claimer');
  assert.equal(discordEmbed({ title: 'x', message: 'y' }, { avecImage: false }).image, undefined);
  setLocale(null);
});

test('chaque genre a sa couleur et son icone', () => {
  for (const genre of Object.keys(KIND_ICON)) {
    assert.ok(Number.isInteger(KIND_COLOR[genre]), genre);
    const e = discordEmbed({ title: 'T', message: 'x', tags: [genre] });
    assert.ok(e.title.startsWith(KIND_ICON[genre]), genre);
    assert.equal(e.color, KIND_COLOR[genre]);
  }
  assert.equal(discordEmbed({ title: 'T', message: 'x' }).color, 0xE8FF00);
});

test('le lien et l\'image ne partent qu\'en https', () => {
  for (const mauvais of ['http://x.org/', 'javascript:alert(1)', 'fgclaimer://finir?s=a&i=b&t=c', '', null, 'https://x.org/a b']) {
    const e = discordEmbed({ title: 'T', message: 'x', click: mauvais, image: mauvais });
    assert.equal(e.url, undefined, String(mauvais));
    assert.equal(e.image, undefined, String(mauvais));
    assert.ok(!(e.description || '').includes('](' ), String(mauvais));
  }
  // Une parenthese dans l'adresse casserait le lien Markdown : elle est refusee.
  assert.equal(discordEmbed({ title: 'T', message: 'x', click: 'https://x.org/a(b)' }).url, undefined);
});

test('les limites de Discord sont tenues', () => {
  const longue = Array.from({ length: 500 }, (_, i) => `Jeu numero ${i} -- Steam -- encore ${i} h`).join('\n');
  const e = discordEmbed({ title: 'T'.repeat(400), message: longue, tags: ['video_game'], click: 'https://x.org/jeu' });
  assert.ok(e.title.length <= MAX_TITLE);
  assert.ok(e.description.length <= MAX_DESCRIPTION);
  assert.ok(e.description.includes('…'));
  assert.ok(e.description.endsWith('(https://x.org/jeu)'), 'le lien reste, meme quand on coupe');
});

test('la requete : embed, jamais de mention, et un repli sans image', () => {
  const msg = { title: 'T', message: 'Hades -- GOG.com', tags: ['video_game'], image: 'https://x.org/i.jpg' };
  const r = discordRequests(cible, msg);
  assert.equal(r.url, WEBHOOK);
  assert.equal(r.init.credentials, 'omit');
  const c = corps(r);
  assert.deepEqual(c.allowed_mentions, { parse: [] });
  assert.equal(c.username, 'Free Games Claimer');
  assert.equal(c.embeds[0].image.url, 'https://x.org/i.jpg');
  assert.equal(corps(r.fallback).embeds[0].image, undefined);
  assert.equal(discordRequests(cible, { ...msg, image: null }).fallback, undefined);
  // Sans rien a dire, un message sobre plutot qu'une carte vide (que Discord refuserait).
  const vide = corps(discordRequests(cible, { tags: [] }));
  assert.equal(vide.embeds, undefined);
  assert.ok(vide.content);
});

test('une image refusee (400) : la carte part quand meme, sans image', async () => {
  const msg = { title: 'T', message: 'Hades -- GOG.com', tags: ['video_game'], image: 'https://x.org/i.jpg' };
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    return b.embeds[0].image ? { ok: false, status: 400 } : { ok: true, status: 204 };
  };
  const r = await P.sendPhone({ fetch: fetchImpl, target: cible, msg });
  assert.equal(r.ok, true);
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0].embeds[0].image && !bodies[1].embeds[0].image);
});

test('les alertes reelles, sur Discord', () => {
  setLocale('fr');
  const derniere = corps(discordRequests(cible, {
    title: 'Dernière chance : Celeste', tags: ['alarm_clock'], click: 'https://store.epicgames.com/p/celeste',
    message: `Celeste -- ${STORE_LABELS.epic} -- 2 h pour le prendre.\nTunic -- Steam -- 45 min pour le prendre.`,
  })).embeds[0];
  assert.equal(derniere.color, KIND_COLOR.alarm_clock);
  assert.match(derniere.description, /🛡️ \*\*Celeste\*\*\n└ \*Epic Games Store\*  ·  ⏳ \*2 h pour le prendre\.\*/);
  assert.match(derniere.description, /♨️ \*\*Tunic\*\*/);
  const panne = corps(discordRequests(cible, P.incidentsMessage(
    [{ kind: 'selector', key: 'steam', detail: 'steam : 2 echec(s)' }],
    { title: 'Free Games : l\'extension a besoin de vous', label: () => 'Steam a changé sa page' },
  ))).embeds[0];
  assert.equal(panne.color, KIND_COLOR.warning);
  assert.equal(panne.description, '🧩 Steam a changé sa page\n└ `steam : 2 echec(s)`');
  const recap = corps(discordRequests(cible, {
    title: 'Votre semaine', tags: ['calendar'], icons: ['✅', '❌'], message: 'Récupérés : Hades (valeur 40,98 €)\nRatés : Gris',
  })).embeds[0];
  assert.equal(recap.description, '✅ **Récupérés** : Hades \\(valeur 💶 **40,98 €**\\)\n❌ **Ratés** : Gris');
  setLocale(null);
});

test('Telegram et Discord disent la meme chose des memes alertes', () => {
  const msg = { title: 'T', tags: ['video_game'], message: 'Hades -- GOG.com -- 2 h pour le prendre.\nFortnite -- Android, iOS' };
  const tg = telegramText(msg).replace(/<\/?[bi]>/g, '');
  const dc = discordEmbed(msg).description.replace(/\*\*?/g, '').replace(/\\/g, '');
  for (const mot of ['🟣', 'Hades', 'GOG.com', '⏳', '2 h pour le prendre.', '📱', 'Fortnite', '🤖 Android', '🍎 iOS']) {
    assert.ok(tg.includes(mot), `Telegram : ${mot}`);
    assert.ok(dc.includes(mot), `Discord : ${mot}`);
  }
});
