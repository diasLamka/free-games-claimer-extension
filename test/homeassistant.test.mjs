/* La maison : Home Assistant (2.116.0).
 *
 * Trois choses a tenir :
 *   - l'adresse du webhook est le SECRET, et le clair ne traverse jamais
 *     l'Internet : http n'est accepte que pour un hote local ;
 *   - le message ne dit que ce que n'importe quelle page de magasin montre, et
 *     part sans cookies, sans suivre une redirection ;
 *   - un envoi rate ne casse rien, et l'etat inchange n'est pas renvoye a tout
 *     bout de champ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENTS, HEARTBEAT_MS, KEY_HOME, KEY_HOME_STATE, MAX_GAMES,
  describeStatus, gameEntry, homeEvent, homeRequest, homeTarget, homeUrl, isLocalHost,
  originPattern, pushHome, readHome, sendHome, shouldSendState, snapshot, stateHash,
} from '../watch/homeassistant.js';
import { declaresOptionalOrigin } from '../watch/permissions.js';
import { UI_COMMANDS, CONTENT_MESSAGES } from '../watch/messaging.js';
import { EXPORT_KEYS } from '../watch/auto-backup.js';
import { BACKUP_KEYS } from '../watch/full-backup.js';
import { fakeChrome } from './fake-chrome.mjs';

const ID = 'fgc-9f3a1c7e5b2d4a6c8e0f';
const URL_LAN = `http://homeassistant.local:8123/api/webhook/${ID}`;
const T = Date.UTC(2026, 10, 5, 9, 0, 0);
const HEURE = 3600000;

/* ------------------------------------------------------------ l'adresse */

test('une adresse de webhook valide, sur le reseau local en http ou n\'importe ou en https', () => {
  assert.equal(homeUrl(URL_LAN), URL_LAN);
  assert.equal(homeUrl(`http://192.168.1.20:8123/api/webhook/${ID}/`), `http://192.168.1.20:8123/api/webhook/${ID}`, 'le / final est retire');
  assert.equal(homeUrl(`https://ha.example.org/api/webhook/${ID}`), `https://ha.example.org/api/webhook/${ID}`);
  assert.equal(homeUrl(`  ${URL_LAN}  `), URL_LAN, 'les espaces autour sont ignores');
  assert.equal(homeUrl('https://hooks.nabu.casa/gAAAAABk1234567890abcdefghijkl'), 'https://hooks.nabu.casa/gAAAAABk1234567890abcdefghijkl');
});

test('le clair n\'est accepte que pour un hote local : jamais http vers Internet', () => {
  for (const hote of ['example.com', '8.8.8.8', '172.32.0.1', '192.169.0.1', '11.0.0.1', 'ha.example.org', '1.1.1.1']) {
    assert.equal(homeUrl(`http://${hote}:8123/api/webhook/${ID}`), null, hote);
  }
  for (const hote of ['localhost', '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.1.1', 'homeassistant', 'ha.local', 'maison.lan', 'ha.home.arpa', '[::1]', '[fd12:3456::1]', '[fe80::1]']) {
    assert.ok(homeUrl(`http://${hote}:8123/api/webhook/${ID}`), hote);
  }
  assert.equal(homeUrl(`http://hooks.nabu.casa/${'a'.repeat(30)}`), null, 'le Cloud exige https');
});

test('une adresse avec identifiants, requete, fragment, ou un autre chemin est refusee', () => {
  assert.equal(homeUrl(`http://user:pass@homeassistant.local:8123/api/webhook/${ID}`), null);
  assert.equal(homeUrl(`${URL_LAN}?x=1`), null);
  assert.equal(homeUrl(`${URL_LAN}#frag`), null);
  assert.equal(homeUrl('http://homeassistant.local:8123/'), null);
  assert.equal(homeUrl('http://homeassistant.local:8123/api/webhook/'), null);
  assert.equal(homeUrl('http://homeassistant.local:8123/api/webhook/court'), null, 'un identifiant trop court ne protege rien');
  assert.equal(homeUrl(`http://homeassistant.local:8123/api/states/${ID}`), null);
  assert.equal(homeUrl(`ftp://homeassistant.local/api/webhook/${ID}`), null);
  assert.equal(homeUrl('pas une adresse'), null);
  assert.equal(homeUrl(''), null);
  assert.equal(homeUrl(undefined), null);
  assert.equal(homeUrl(`https://example.org/hooks.nabu.casa/${'a'.repeat(30)}`), null, 'le raccourci du Cloud ne vaut que sur son hote');
});

test('une notation d\'adresse detournee est lue sous sa forme canonique avant le verdict', () => {
  // 0x7f.1 est 127.0.0.1 : local, donc accepte ; 8.8.8.8 ecrit en entier ne l'est pas.
  assert.ok(homeUrl(`http://0x7f.1:8123/api/webhook/${ID}`));
  assert.equal(homeUrl(`http://134744072:8123/api/webhook/${ID}`), null, '134744072 est 8.8.8.8');
});

test('isLocalHost : les memes verdicts, sans l\'adresse autour', () => {
  assert.equal(isLocalHost('homeassistant'), true);
  assert.equal(isLocalHost('example.com'), false);
  assert.equal(isLocalHost(''), false);
  assert.equal(isLocalHost('999.1.1.1'), false);
});

test('le motif de permission est celui de l\'hote seul, sans port, et le manifeste le couvre', async () => {
  assert.equal(originPattern(URL_LAN), 'http://homeassistant.local/*');
  assert.equal(originPattern(`http://192.168.1.20:8123/api/webhook/${ID}`), 'http://192.168.1.20/*');
  assert.equal(originPattern(`https://ha.example.org/api/webhook/${ID}`), 'https://ha.example.org/*');
  assert.equal(originPattern('http://example.com/api/webhook/' + ID), null);

  for (const nom of ['manifest.json', 'manifest.firefox.json']) {
    const m = JSON.parse((await import('node:fs')).readFileSync(new URL(`../${nom}`, import.meta.url), 'utf8'));
    assert.ok(m.optional_host_permissions.includes('http://*/*'), `${nom} : http est optionnel`);
    assert.ok(!(m.host_permissions || []).some((h) => h.startsWith('http://')), `${nom} : jamais accorde a l'installation`);
    assert.equal(declaresOptionalOrigin(m, originPattern(URL_LAN)), true, nom);
    assert.equal(declaresOptionalOrigin(m, originPattern(`https://ha.example.org/api/webhook/${ID}`)), true, nom);
  }
});

test('la configuration : coupee par defaut, et la cible n\'existe que si tout est valide', () => {
  assert.deepEqual(readHome(undefined), { on: false, url: '' });
  assert.deepEqual(readHome({ on: 'oui', url: 12 }), { on: false, url: '' });
  assert.equal(homeTarget(undefined), null);
  assert.equal(homeTarget({ on: false, url: URL_LAN }), null, 'coupee');
  assert.equal(homeTarget({ on: true, url: 'http://example.com/api/webhook/' + ID }), null, 'adresse refusee');
  assert.deepEqual(homeTarget({ on: true, url: URL_LAN }), { url: URL_LAN });
});

/* ------------------------------------------------------------ le message */

const offre = (title, extra = {}) => ({
  title, store: 'epic', url: `https://store.epicgames.com/p/${title}`, image: `https://cdn1.epicgames.com/${title}.jpg`,
  end: T + 24 * HEURE, worth: '19,99 \u20ac', ...extra,
});
const LABELS = { epic: 'Epic Games', gog: 'GOG' };

test('un jeu : ce qu\'une page de magasin montre, et rien d\'autre', () => {
  const g = gameEntry(offre('Hades', { wished: true, codeRachat: 'ABC-123', accountId: 'u1', cookie: 'x' }), { labels: LABELS });
  assert.deepEqual(Object.keys(g).sort(), ['end', 'image', 'store', 'store_label', 'title', 'url', 'wished', 'worth', 'worth_eur']);
  assert.equal(g.store_label, 'Epic Games');
  assert.equal(g.end, new Date(T + 24 * HEURE).toISOString());
  assert.equal(g.wished, true);
  assert.ok(!JSON.stringify(g).includes('ABC-123'));
});

test('un lien ou une jaquette qui n\'est pas en https est ecarte, pas envoye', () => {
  const g = gameEntry(offre('X', { url: 'http://exemple.com/x', resolveUrl: 'javascript:alert(1)', image: 'data:image/png;base64,AAA' }));
  assert.equal(g.url, null);
  assert.equal(g.image, null);
  assert.equal(gameEntry(offre('Y', { url: null, resolveUrl: 'https://www.gamerpower.com/open/y' })).url, 'https://www.gamerpower.com/open/y');
});

test('l\'etat : le compte dit tout, la liste est bornee, la plus pressante vient d\'abord', () => {
  const offers = [];
  for (let i = 0; i < 15; i++) offers.push(offre(`Jeu ${i}`, { end: T + (30 - i) * HEURE }));
  offers.push(offre('Sans fin', { end: null }));
  const s = snapshot(offers, { labels: LABELS });
  assert.equal(s.count, 16, 'le compte n\'est pas borne');
  assert.equal(s.games.length, MAX_GAMES);
  assert.equal(s.games[0].title, 'Jeu 14', 'la fin la plus proche d\'abord');
  assert.equal(s.next_end_title, 'Jeu 14');
  assert.equal(s.next_end, new Date(T + 16 * HEURE).toISOString());
  assert.ok(!s.games.some((g) => g.title === 'Sans fin'), 'une offre sans fin passe apres les autres');
  assert.match(s.titles, /^Jeu 14, Jeu 13/);
});

test('rien a prendre : un etat vide, pas une erreur', () => {
  const s = snapshot([], {});
  assert.deepEqual(s, { count: 0, titles: '', next_end: null, next_end_title: null, games: [] });
  assert.equal(snapshot(undefined).count, 0);
});

test('un evenement porte l\'etat complet, et le champ propre a son genre', () => {
  const offers = [offre('Hades'), offre('Celeste')];
  const nouveau = homeEvent(EVENTS.NEW, { offers, fresh: [offers[0]], now: T, quiet: true, labels: LABELS });
  assert.equal(nouveau.source, 'free-games-claimer');
  assert.equal(nouveau.format, 1);
  assert.equal(nouveau.event, 'new_offers');
  assert.equal(nouveau.at, new Date(T).toISOString());
  assert.equal(nouveau.quiet, true);
  assert.equal(nouveau.count, 2);
  assert.deepEqual(nouveau.new.map((g) => g.title), ['Hades']);
  assert.equal(nouveau.claimed, undefined);

  const pris = homeEvent(EVENTS.CLAIMED, { offers: [offers[1]], claimed: ['Hades', '', 5], now: T });
  assert.deepEqual(pris.claimed, ['Hades']);
  assert.equal(pris.count, 1);
  assert.equal(pris.new, undefined);
  assert.equal(pris.quiet, false);

  const essai = homeEvent(EVENTS.TEST, { offers, now: T, version: '2.116.0' });
  assert.equal(essai.event, 'test');
  assert.equal(essai.version, '2.116.0');
  assert.equal(homeEvent(EVENTS.STATE, { offers, now: T }).version, undefined);
});

test('la requete : un POST en JSON, sans cookies, sans suivre de redirection', () => {
  const r = homeRequest({ url: URL_LAN }, homeEvent(EVENTS.TEST, { offers: [offre('Hades')], now: T }));
  assert.equal(r.url, URL_LAN);
  assert.equal(r.init.method, 'POST');
  assert.equal(r.init.headers['Content-Type'], 'application/json');
  assert.equal(r.init.credentials, 'omit');
  assert.equal(r.init.redirect, 'error');
  assert.equal(r.init.cache, 'no-store');
  assert.equal(JSON.parse(r.init.body).games[0].title, 'Hades');
  assert.ok(!Object.keys(r.init.headers).some((k) => /authorization|cookie/i.test(k)));
});

/* ----------------------------------------------------------- l'etat envoye */

test('l\'empreinte ne bouge que si l\'etat bouge', () => {
  const a = homeEvent(EVENTS.STATE, { offers: [offre('Hades')], now: T });
  const b = homeEvent(EVENTS.STATE, { offers: [offre('Hades')], now: T + 5 * 60000 });
  const c = homeEvent(EVENTS.STATE, { offers: [offre('Hades'), offre('Celeste')], now: T });
  assert.equal(stateHash(a), stateHash(b), 'l\'heure n\'entre pas dans l\'empreinte');
  assert.notEqual(stateHash(a), stateHash(c));
});

test('l\'etat inchange n\'est renvoye qu\'apres six heures ; un changement part tout de suite', () => {
  const corps = homeEvent(EVENTS.STATE, { offers: [offre('Hades')], now: T });
  assert.equal(shouldSendState(undefined, corps, T), true, 'jamais envoye');
  assert.equal(shouldSendState({ hash: stateHash(corps), stateAt: T }, corps, T + 5 * 60000), false);
  assert.equal(shouldSendState({ hash: stateHash(corps), stateAt: T }, corps, T + HEARTBEAT_MS), true, 'le signe de vie');
  const autre = homeEvent(EVENTS.STATE, { offers: [], now: T });
  assert.equal(shouldSendState({ hash: stateHash(corps), stateAt: T }, autre, T + 60000), true);
  assert.equal(shouldSendState({ at: T, ok: false }, corps, T), true, 'un essai ou un echec n\'a pas d\'empreinte');
});

/* ------------------------------------------------------------- l'envoi */

test('sendHome : un succes, un refus qui s\'explique, un reseau muet, un delai -- jamais d\'exception', async () => {
  const corps = homeEvent(EVENTS.TEST, { offers: [], now: T });
  const ok = await sendHome({ fetch: async () => ({ ok: true, status: 200 }), target: { url: URL_LAN }, corps });
  assert.deepEqual(ok, { ok: true, status: 200, note: null });

  const refus = await sendHome({ fetch: async () => ({ ok: false, status: 404 }), target: { url: URL_LAN }, corps });
  assert.equal(refus.ok, false);
  assert.match(refus.note, /404.*introuvable/);

  const muet = await sendHome({ fetch: async () => { throw new Error('boom ' + URL_LAN); }, target: { url: URL_LAN }, corps });
  assert.equal(muet.ok, false);
  assert.match(muet.note, /ne repond pas/);
  assert.ok(!muet.note.includes(ID), 'le message d\'erreur de fetch, qui porte l\'adresse, n\'est pas repris');

  const lent = await sendHome({
    fetch: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort')))),
    target: { url: URL_LAN }, corps, timeoutMs: 20,
  });
  assert.equal(lent.ok, false);
  assert.match(lent.note, /delai depasse/);

  assert.deepEqual(await sendHome({ fetch: async () => ({ ok: true }), target: null, corps }), { ok: false, status: 0, note: 'rien a envoyer' });
});

test('describeStatus dit ce qu\'un statut veut dire', () => {
  assert.match(describeStatus(404), /introuvable/);
  assert.match(describeStatus(405), /pas l'adresse d'un webhook/);
  assert.match(describeStatus(403), /proxy/);
  assert.equal(describeStatus(500), 'HTTP 500');
});

test('pushHome : garde le resultat pour le popup, ecrit l\'empreinte d\'un envoi reussi, n\'ecrit jamais l\'adresse', async () => {
  const { chrome, payload } = fakeChrome({ now: T });
  const journal = [];
  const record = (niveau, texte) => journal.push(`${niveau}: ${texte}`);
  const corps = homeEvent(EVENTS.NEW, { offers: [offre('Hades')], fresh: [offre('Hades')], now: T });

  const r = await pushHome({ chrome, fetch: async () => ({ ok: true, status: 200 }), target: { url: URL_LAN }, corps, now: T, record, why: 'nouvelles offres' });
  assert.equal(r.ok, true);
  const etat = payload()[KEY_HOME_STATE];
  assert.equal(etat.ok, true);
  assert.equal(etat.why, 'nouvelles offres');
  assert.equal(etat.hash, stateHash(corps));
  assert.equal(etat.stateAt, T);

  // Un echec ulterieur garde l'empreinte du dernier etat envoye : il ne la perd pas.
  await pushHome({ chrome, fetch: async () => ({ ok: false, status: 503 }), target: { url: URL_LAN }, corps, now: T + 60000, record, why: 'etat' });
  const apres = payload()[KEY_HOME_STATE];
  assert.equal(apres.ok, false);
  assert.equal(apres.hash, stateHash(corps));

  // Un essai n'est pas un etat : il ne marque rien comme envoye.
  const { chrome: c2, payload: p2 } = fakeChrome({ now: T });
  await pushHome({ chrome: c2, fetch: async () => ({ ok: true, status: 200 }), target: { url: URL_LAN }, corps: homeEvent(EVENTS.TEST, { offers: [], now: T }), now: T, record });
  assert.equal(p2()[KEY_HOME_STATE].hash, undefined);

  assert.ok(journal.length >= 3);
  assert.ok(!journal.join('\n').includes(ID), 'l\'adresse est le secret : jamais au journal');
});

test('pushHome ne jette pas quand le stockage refuse', async () => {
  const cass\u00e9 = { storage: { local: { get: async () => { throw new Error('plein'); }, set: async () => { throw new Error('plein'); } } } };
  const r = await pushHome({ chrome: cass\u00e9, fetch: async () => ({ ok: true, status: 200 }), target: { url: URL_LAN }, corps: homeEvent(EVENTS.TEST, { now: T }), now: T });
  assert.equal(r.ok, true);
});

/* -------------------------------------------------- ce qui reste prive */

test('l\'adresse du webhook ne sort jamais dans une sauvegarde ni dans un export', () => {
  assert.ok(!EXPORT_KEYS.includes(KEY_HOME));
  assert.ok(!EXPORT_KEYS.includes(KEY_HOME_STATE));
  assert.ok(!BACKUP_KEYS.includes(KEY_HOME), 'la sauvegarde complete non plus');
});

test('l\'essai du popup est une commande de page : un script de contenu ne peut pas la demander', () => {
  assert.ok(UI_COMMANDS.includes('fgc-home-test'));
  assert.ok(!CONTENT_MESSAGES.includes('fgc-home-test'));
});

/* ------------------------------------------- chasse aux dollars (2.123.0) */

import { worthInEuros } from '../watch/homeassistant.js';
import { parseRates } from '../watch/rates.js';

test('worth_eur : la valeur ecrite en dollars par la source, convertie en euros au taux du jour', () => {
  const taux = parseRates({ amount: 1, base: 'EUR', date: '2026-10-16', rates: { USD: 1.125 } }, 1000);
  assert.equal(worthInEuros('$22.50', taux, 2000), 20);
  assert.equal(worthInEuros('22.50 USD', taux, 2000), 20);
  assert.equal(worthInEuros('19,99 \u20ac', taux, 2000), 19.99, 'deja en euros : tel quel');
  assert.equal(worthInEuros('Gratuit', taux, 2000), null);
  assert.equal(worthInEuros(null, taux, 2000), null);
  assert.equal(worthInEuros('$22.50', null, 2000), null, 'sans taux : jamais un chiffre invente');
  assert.equal(worthInEuros('$22.50', { ...taux, base: 'GBP' }, 2000), null, 'une autre base n\'est pas des euros');
});

test('worth_eur : dans le jeu envoye, a cote de la valeur d\'origine', () => {
  const taux = parseRates({ amount: 1, base: 'EUR', date: '2026-10-16', rates: { USD: 1.125 } }, 1000);
  const g = gameEntry({ title: 'Hades', store: 'epic', worth: '$22.50' }, { rates: taux, now: 2000 });
  assert.equal(g.worth, '$22.50');
  assert.equal(g.worth_eur, 20);
  assert.equal(gameEntry({ title: 'Hades', store: 'epic', worth: '$22.50' }).worth_eur, null);
});
