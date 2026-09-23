/* L'alerte sur le telephone (2.47.0), par ntfy.
 *
 * Les pieges sont ceux d'un canal qui sort de la machine : une adresse en
 * clair, un titre accentue qui fait jeter `fetch` dans un en-tete, un cookie
 * qui partirait avec, un echec qui ferait tomber le cycle. Chaque test en
 * prend un.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PHONE, KEY_PHONE, KEY_PHONE_STATE, PRIORITY,
  describeStatus, incidentsMessage, newTopicUrl, originPattern, phoneTarget,
  publishRequest, pushToPhone, readPhone, sendPhone, topicUrl, wishedMessage,
} from '../watch/phone.js';
import { fakeChrome } from './fake-chrome.mjs';

const T = Date.UTC(2026, 8, 23, 12, 0, 0);

/* ------------------------------------------------------ la configuration */

test('les cles vivent dans l\'espace de la veille, a part des reglages', () => {
  assert.ok(KEY_PHONE.startsWith('veille:'));
  assert.ok(KEY_PHONE_STATE.startsWith('veille:'));
  assert.notEqual(KEY_PHONE, 'veille:reglages', 'les reglages peuvent partir dans la zone sync');
});

test('coupe par defaut', () => {
  assert.equal(DEFAULT_PHONE.on, false);
  assert.equal(readPhone(undefined).on, false);
  assert.equal(phoneTarget(undefined), null);
});

test('une adresse de sujet : https, un chemin, rien d\'autre', () => {
  assert.equal(topicUrl('https://ntfy.sh/fgc-abc'), 'https://ntfy.sh/fgc-abc');
  assert.equal(topicUrl(' https://ntfy.sh/fgc-abc/ '), 'https://ntfy.sh/fgc-abc');
  assert.equal(topicUrl('https://ntfy.example.org/alertes/jeux'), 'https://ntfy.example.org/alertes/jeux');
  assert.equal(topicUrl('http://ntfy.sh/fgc-abc'), null, 'en clair sur le reseau');
  assert.equal(topicUrl('https://ntfy.sh/'), null, 'sans sujet');
  assert.equal(topicUrl('https://ntfy.sh/a?x=1'), null);
  assert.equal(topicUrl('https://ntfy.sh/a#x'), null);
  assert.equal(topicUrl('https://moi:secret@ntfy.sh/a'), null, 'pas d\'identifiants dans l\'adresse');
  assert.equal(topicUrl('https://ntfy.sh/a b'), null);
  assert.equal(topicUrl('javascript:alert(1)'), null);
  assert.equal(topicUrl(''), null);
});

test('la cible n\'existe que si l\'alerte est active ET l\'adresse valide', () => {
  assert.equal(phoneTarget({ on: false, url: 'https://ntfy.sh/a' }), null);
  assert.equal(phoneTarget({ on: true, url: 'http://ntfy.sh/a' }), null);
  assert.deepEqual(phoneTarget({ on: true, url: 'https://ntfy.sh/a' }), { url: 'https://ntfy.sh/a', token: '', wished: true, mobile: true });
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', wished: false }).wished, false);
  // Les jeux mobiles d'Epic (2.57.0) : actifs par defaut, coupables a part.
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', mobile: false }).mobile, false);
});

test('un jeton hors ASCII imprimable est ignore plutot qu\'envoye', () => {
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', token: 'tk_abc123' }).token, 'tk_abc123');
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', token: 'jéton' }).token, '');
  assert.equal(phoneTarget({ on: true, url: 'https://ntfy.sh/a', token: 'a b' }).token, '');
});

test('la permission demandee ne vise que le serveur', () => {
  assert.equal(originPattern('https://ntfy.sh/fgc-abc'), 'https://ntfy.sh/*');
  assert.equal(originPattern('https://ntfy.example.org:8443/a'), 'https://ntfy.example.org:8443/*');
  assert.equal(originPattern('http://ntfy.sh/a'), null);
});

test('un sujet neuf est long, aleatoire, et sur le serveur public', () => {
  const url = newTopicUrl(Array.from({ length: 20 }, (_, i) => i * 7));
  assert.match(url, /^https:\/\/ntfy\.sh\/fgc-[a-z2-7]{20}$/);
  assert.equal(topicUrl(url), url);
  assert.notEqual(newTopicUrl(new Array(20).fill(1)), newTopicUrl(new Array(20).fill(2)));
});

/* ------------------------------------------------------------ le message */

test('les incidents : une ligne humaine chacun, le motif technique entre parentheses', () => {
  const m = incidentsMessage([
    { kind: 'session', key: 'epic', detail: 'HTTP 401' },
    { kind: 'muted', key: null, detail: null },
  ], {
    title: 'Free Games a besoin de vous',
    label: (kind, key) => (kind === 'session' ? `Session ${key} expiree` : 'Notifications bloquees'),
  });
  assert.equal(m.title, 'Free Games a besoin de vous');
  assert.equal(m.message, 'Session epic expiree (HTTP 401)\nNotifications bloquees');
  assert.equal(m.priority, PRIORITY.HIGH);
});

test('les jeux attendus : le premier en titre, son lien au toucher', () => {
  const m = wishedMessage([
    { title: 'Hollow Knight', url: 'https://store.epicgames.com/p/hk' },
    { title: 'Celeste', url: 'https://gog.com/x' },
  ], { title: (x) => `Attendu : ${x}`, line: (o) => o.title });
  assert.equal(m.title, 'Attendu : Hollow Knight');
  assert.equal(m.message, 'Hollow Knight\nCeleste');
  assert.equal(m.click, 'https://store.epicgames.com/p/hk');
  assert.equal(wishedMessage([], { title: (x) => x, line: (o) => o.title }), null);
});

/* ------------------------------------------------------------- l'envoi */

test('les parametres passent dans l\'adresse : un titre accentue ne fait pas jeter fetch', () => {
  const r = publishRequest({ url: 'https://ntfy.sh/a', token: '' }, {
    title: 'Récupéré : Élden', message: 'Corps accentué', priority: 4, tags: ['warning'], click: 'https://gog.com/x',
  });
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://ntfy.sh/a');
  assert.equal(u.searchParams.get('title'), 'Récupéré : Élden');
  assert.equal(u.searchParams.get('priority'), '4');
  assert.equal(u.searchParams.get('tags'), 'warning');
  assert.equal(u.searchParams.get('click'), 'https://gog.com/x');
  assert.equal(r.init.body, 'Corps accentué');
  assert.deepEqual(r.init.headers, {}, 'aucun en-tete sans jeton');
  // Ce que fetch refuserait : un en-tete hors latin-1. Il n'y en a aucun.
  for (const v of Object.values(r.init.headers)) assert.match(v, /^[\x20-\x7e]*$/);
});

test('jamais les cookies du navigateur', () => {
  const r = publishRequest({ url: 'https://ntfy.sh/a', token: '' }, { title: 'x', message: 'y' });
  assert.equal(r.init.credentials, 'omit');
  assert.equal(r.init.method, 'POST');
});

test('le jeton part en Bearer, et seulement lui', () => {
  const r = publishRequest({ url: 'https://ntfy.example.org/a', token: 'tk_abc' }, { title: 'x', message: 'y' });
  assert.deepEqual(r.init.headers, { Authorization: 'Bearer tk_abc' });
});

test('un lien de clic qui n\'est pas https n\'est pas repris', () => {
  const r = publishRequest({ url: 'https://ntfy.sh/a', token: '' }, { title: 'x', message: 'y', click: 'javascript:alert(1)' });
  assert.equal(new URL(r.url).searchParams.get('click'), null);
});

test('un envoi reussi, un refus, une panne : jamais d\'exception', async () => {
  const target = { url: 'https://ntfy.sh/a', token: '' };
  const msg = { title: 't', message: 'm' };
  const appels = [];

  const ok = await sendPhone({ fetch: async (url, init) => { appels.push({ url, init }); return { ok: true, status: 200 }; }, target, msg });
  assert.deepEqual(ok, { ok: true, status: 200, note: null });
  assert.equal(appels.length, 1);

  const refus = await sendPhone({ fetch: async () => ({ ok: false, status: 403 }), target, msg });
  assert.equal(refus.ok, false);
  assert.match(refus.note, /jeton/);

  const panne = await sendPhone({ fetch: async () => { throw new TypeError('Failed to fetch'); }, target, msg });
  assert.deepEqual(panne, { ok: false, status: 0, note: 'Failed to fetch' });

  assert.equal((await sendPhone({ fetch: async () => ({ ok: true }), target: null, msg })).ok, false);
});

test('un serveur qui ne repond pas est abandonne a temps', async () => {
  const lent = (url, init) => new Promise((_, ko) => init.signal.addEventListener('abort', () => ko(new Error('aborted'))));
  const r = await sendPhone({ fetch: lent, target: { url: 'https://ntfy.sh/a', token: '' }, msg: { title: 't' }, timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.match(r.note, /delai depasse/);
});

test('les statuts qui demandent un geste se lisent', () => {
  assert.match(describeStatus(401), /jeton/);
  assert.match(describeStatus(404), /introuvable/);
  assert.match(describeStatus(429), /limite/);
  assert.equal(describeStatus(500), 'HTTP 500');
});

test('pushToPhone garde le resultat pour le popup et l\'ecrit au journal', async () => {
  const { chrome } = fakeChrome({ now: T });
  const journal = [];
  const r = await pushToPhone({
    chrome, fetch: async () => ({ ok: false, status: 429 }), target: { url: 'https://ntfy.sh/a', token: '' },
    msg: { title: 't', message: 'm' }, now: T, record: (n, m) => journal.push(`${n}: ${m}`), why: 'essai',
  });
  assert.equal(r.ok, false);
  const etat = (await chrome.storage.local.get(KEY_PHONE_STATE))[KEY_PHONE_STATE];
  assert.deepEqual(etat, { at: T, ok: false, status: 429, note: describeStatus(429), why: 'essai' });
  assert.match(journal[0], /^warn: telephone : essai non envoyee/);
});
