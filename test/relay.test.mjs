/* Le relais PC <-> telephone (2.87.0).
 *
 * Trois choses a tenir :
 *   - le chiffrement est le meme que celui de l'appli, a l'octet pres : le
 *     vecteur de test/fixtures/relais.json est rejoue ici ET dans les tests
 *     Kotlin, et une seconde implementation (OpenSSL, par node:crypto) doit
 *     l'ouvrir aussi ;
 *   - un jeu obtenu par l'autre appareil entre au registre, et n'est plus
 *     retente ; un jeu en cours la-bas est laisse de cote ici ;
 *   - le secret ne part jamais dans une sauvegarde.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDecipheriv, createHash } from 'node:crypto';

import {
  KEY_RELAY, DEFAULT_SERVER, MAX_ENVELOPE, MAX_LOCK_MS, TYPES, ROLES,
  newSecret, pairingCode, parsePairingCode, relayServer, deriveRelay, seal, open,
  applyMessages, heldKeys, fitAlive, message, wireGame, recentGames, readRelay,
  publish, poll, syncRelay, lockKey,
} from '../watch/relay.js';
import { KEY_LIBRARY, libraryKey, makeEntry, mergeEntry, ownedKeys } from '../watch/library.js';
import { normaliseTitle, makeOffer } from '../watch/offer.js';
import { claimWhatCanBe } from '../watch/cycle.js';
import { VERDICTS } from '../watch/claim.js';
import { BACKUP_KEYS } from '../watch/full-backup.js';
import { fakeChrome } from './fake-chrome.mjs';

const FX = JSON.parse(readFileSync(new URL('./fixtures/relais.json', import.meta.url), 'utf8'));
const NOW = FX.message.ts + 60_000;
const helpers = { normalise: normaliseTitle, libraryKey, makeEntry, mergeEntry };

/* ------------------------------------------------------------ association */

test('le code d\'association se relit, et refuse ce qui n\'en est pas un', () => {
  assert.deepEqual(parsePairingCode(FX.code), { secret: FX.secret, server: DEFAULT_SERVER });
  assert.deepEqual(parsePairingCode(`  ${FX.code}\n`), { secret: FX.secret, server: DEFAULT_SERVER });
  const prive = pairingCode(FX.secret, 'https://ntfy.example.org/');
  assert.equal(prive, `${FX.code}@https://ntfy.example.org`);
  assert.deepEqual(parsePairingCode(prive), { secret: FX.secret, server: 'https://ntfy.example.org' });
  assert.equal(parsePairingCode(FX.code.slice(0, -1)), null);
  assert.equal(parsePairingCode(`${FX.code}@http://ntfy.example.org`), null, 'https seulement');
  assert.equal(parsePairingCode(`${FX.code}@https://u:p@ntfy.example.org`), null, 'pas d\'identifiants');
  assert.equal(parsePairingCode('FGC2-' + FX.secret), null);
  assert.equal(relayServer('https://ntfy.sh/sujet'), null, 'une origine, pas un sujet');
  assert.throws(() => newSecret(new Uint8Array(16)));
});

/* ---------------------------------------------------------- chiffrement */

test('le vecteur commun : sujet, ouverture, et chiffrement reproduit a l\'octet', async () => {
  const ctx = await deriveRelay(FX.secret);
  assert.equal(ctx.topic, FX.topic);
  assert.deepEqual(await open(FX.envelope, ctx), FX.message);
  const nonce = Uint8Array.from(Buffer.from(FX.nonce, 'hex'));
  assert.equal(await seal(FX.message, ctx, { nonce }), FX.envelope);
});

test('une seconde implementation (OpenSSL) ouvre le meme message', () => {
  const cle = createHash('sha256').update(`fgc-relais/cle/${FX.secret}`).digest();
  const brut = Buffer.from(FX.envelope.slice(5), 'base64url');
  const d = createDecipheriv('aes-256-gcm', cle, brut.subarray(0, 12));
  d.setAAD(Buffer.from(FX.topic, 'utf8'));
  d.setAuthTag(brut.subarray(brut.length - 16));
  const clair = Buffer.concat([d.update(brut.subarray(12, brut.length - 16)), d.final()]).toString('utf8');
  assert.deepEqual(JSON.parse(clair), FX.message);
});

test('un autre sujet, une autre cle ou un octet change : le message ne s\'ouvre pas', async () => {
  const ctx = await deriveRelay(FX.secret);
  assert.equal(await open(FX.envelope, { ...ctx, topic: 'fgcr-autre' }), null);
  const autre = await deriveRelay(newSecret(new Uint8Array(32).fill(7)));
  assert.equal(await open(FX.envelope, autre), null);
  const abime = FX.envelope.slice(0, 40) + (FX.envelope[40] === 'A' ? 'B' : 'A') + FX.envelope.slice(41);
  assert.equal(await open(abime, ctx), null);
  assert.equal(await open('pas un message', ctx), null);
});

/* ------------------------------------------------------------ integration */

test('un jeu obtenu par le telephone entre au registre, et le filtre ne le retente plus', () => {
  const r = applyMessages({ dev: 'c0ffee01', locks: {} }, [FX.message], { library: {}, now: NOW, ...helpers });
  assert.equal(r.added, 1);
  const e = r.library[libraryKey('epic', 'hades')];
  assert.equal(e.title, 'Hades');
  assert.equal(e.via, 'telephone');
  assert.equal(e.status, 'claimed');
  assert.ok(ownedKeys(r.library, normaliseTitle).has(`epic|${normaliseTitle('Hades')}`));
  assert.equal(r.state.peer.role, ROLES.PHONE);
  // Rejouer le meme message n'ajoute rien.
  assert.equal(applyMessages(r.state, [FX.message], { library: r.library, now: NOW, ...helpers }).added, 0);
});

test('ses propres messages, les trop vieux et les statuts non acquis sont ignores', () => {
  const vieux = { ...FX.message, ts: NOW - 8 * 24 * 3600 * 1000 };
  const moi = { ...FX.message, dev: 'a1b2c3d4' };
  const rate = { ...FX.message, dev: 'ffffffff', games: [{ s: 'gog', i: 'x', t: 'X', st: 'failed' }] };
  const r = applyMessages({ dev: 'a1b2c3d4', locks: {} }, [vieux, moi, rate], { library: {}, now: NOW, ...helpers });
  assert.equal(r.added, 0);
});

test('un verrou de l\'autre laisse le jeu de cote, dix minutes au plus', () => {
  const lock = message({ type: TYPES.LOCK, dev: 'b0b0b0b0', role: ROLES.PHONE, now: NOW,
    games: [wireGame({ store: 'epic', id: 'hades', title: 'Hades', until: NOW + 60 * 60 * 1000 })] });
  const r = applyMessages({ dev: 'c0ffee01', locks: {} }, [lock], { library: {}, now: NOW, ...helpers });
  const k = lockKey('epic', normaliseTitle('Hades'));
  assert.equal(r.state.locks[k].until, NOW + MAX_LOCK_MS, 'plafonne');
  assert.ok(heldKeys(r.state, NOW + 60_000).has(k));
  assert.equal(heldKeys(r.state, NOW + MAX_LOCK_MS + 1).size, 0);
});

test('le signe de vie rattrape les jeux et tient dans un message ntfy', async () => {
  const ctx = await deriveRelay(FX.secret);
  const library = {};
  for (let i = 0; i < 40; i++) {
    library[`epic:jeu-${i}`] = makeEntry({ store: 'epic', id: `jeu-${i}`, title: `Un jeu au titre assez long numero ${i}`,
      url: `https://store.epicgames.com/p/un-jeu-au-titre-assez-long-${i}?avec=des&parametres=longs`, worth: '19,99 €', ts: NOW - i * 1000, status: 'claimed' });
  }
  const base = message({ type: TYPES.ALIVE, dev: 'c0ffee01', role: ROLES.PC, now: NOW });
  const m = await fitAlive(base, recentGames(library), async (x) => (await seal(x, ctx)).length);
  assert.ok((await seal(m, ctx)).length <= MAX_ENVELOPE);
  assert.ok(m.games.length > 0 && m.games.length <= 15);
  assert.equal(m.games[0].t, 'Un jeu au titre assez long numero 0', 'le plus recent d\'abord');

  const r = applyMessages({ dev: 'a1b2c3d4', locks: {} }, [m], { library: {}, now: NOW, ...helpers });
  assert.equal(r.added, m.games.length);
  assert.equal(Object.values(r.library)[0].via, 'pc');
});

/* ------------------------------------------------------------- transport */

test('publier : sans cookies, sans Firebase ; lire : les lignes ntfy, et le dernier id', async () => {
  const vus = [];
  const fetchImpl = async (url, init) => {
    vus.push({ url, init });
    if (init.method === 'POST') return { ok: true, status: 200 };
    return {
      ok: true, status: 200,
      text: async () => [
        JSON.stringify({ id: 'a1', event: 'open' }),
        JSON.stringify({ id: 'a2', event: 'message', message: 'fgc1.x' }),
        'pas du json',
        JSON.stringify({ id: 'a3', event: 'message', message: 'fgc1.y' }),
        '',
      ].join('\n'),
    };
  };
  const p = await publish({ fetch: fetchImpl, server: DEFAULT_SERVER, topic: FX.topic, envelope: 'fgc1.z' });
  assert.equal(p.ok, true);
  assert.equal(vus[0].url, `${DEFAULT_SERVER}/${FX.topic}`);
  assert.equal(vus[0].init.credentials, 'omit');
  assert.equal(vus[0].init.headers['X-Firebase'], 'no');
  const l = await poll({ fetch: fetchImpl, server: DEFAULT_SERVER, topic: FX.topic, since: null });
  assert.deepEqual(l.messages, ['fgc1.x', 'fgc1.y']);
  assert.equal(l.last, 'a3');
  assert.match(vus[1].url, /\/json\?poll=1&since=12h$/);
});

test('syncRelay : lit, integre au registre, retient le dernier id ; sans association, rien', async () => {
  const { chrome, payload } = fakeChrome({ now: NOW });
  assert.equal(await syncRelay({ chrome, fetch: async () => { throw new Error('pas d\'appel'); }, now: NOW }), null);

  await chrome.storage.local.set({ [KEY_RELAY]: { secret: FX.secret, server: DEFAULT_SERVER, dev: 'c0ffee01', pairedAt: NOW - 1000 } });
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'z9', event: 'message', message: FX.envelope }) + '\n' });
  const r = await syncRelay({ chrome, fetch: fetchImpl, now: NOW });
  assert.ok(r.library[libraryKey('epic', 'hades')]);
  const stocke = payload();
  assert.ok(stocke[KEY_LIBRARY][libraryKey('epic', 'hades')]);
  assert.equal(stocke[KEY_RELAY].since, 'z9');
  assert.equal(stocke[KEY_RELAY].peer.role, 'phone');
  assert.equal(readRelay(stocke[KEY_RELAY]).secret, FX.secret);
});

test('le secret du relais ne part jamais dans une sauvegarde', () => {
  assert.ok(!BACKUP_KEYS.includes(KEY_RELAY));
});

/* ----------------------------------------------------- dans la reclamation */

test('claimWhatCanBe : un jeu en cours ailleurs est saute ; verrou avant, avis apres', async () => {
  const { chrome } = fakeChrome({ now: NOW });
  const a = { ...makeOffer({ source: 'epic', store: 'epic', storeId: 'hades', title: 'Hades', url: 'https://store.epicgames.com/p/hades', end: NOW + 86400000 }), catalogKey: 'epic:hades' };
  const b = { ...makeOffer({ source: 'epic', store: 'epic', storeId: 'gris', title: 'Gris', url: 'https://store.epicgames.com/p/gris', end: NOW + 86400000 }), catalogKey: 'epic:gris' };
  const ordre = [];
  const r = await claimWhatCanBe({
    chrome,
    now: NOW,
    catalog: { [a.catalogKey]: a, [b.catalogKey]: b },
    filters: {},
    claimableStores: ['epic'],
    watchedStores: ['epic'],
    cadence: [],
    maxReclamations: 3,
    held: new Set([lockKey('epic', normaliseTitle('Hades'))]),
    onClaimStart: async (o) => { ordre.push(`verrou ${o.title}`); },
    onClaimed: async (o, v) => { ordre.push(`obtenu ${o.title} ${v.verdict}`); },
    claim: async (o) => { ordre.push(`reclame ${o.title}`); return { verdict: VERDICTS.CLAIMED }; },
  });
  assert.deepEqual(r.claims.map((c) => c.title), ['Gris']);
  assert.deepEqual(ordre, ['verrou Gris', 'reclame Gris', 'obtenu Gris claimed']);
});

test('une panne du relais n\'arrete pas une reclamation', async () => {
  const { chrome } = fakeChrome({ now: NOW });
  const a = { ...makeOffer({ source: 'epic', store: 'epic', storeId: 'gris', title: 'Gris', url: 'https://store.epicgames.com/p/gris', end: NOW + 86400000 }), catalogKey: 'epic:gris' };
  const r = await claimWhatCanBe({
    chrome, now: NOW, catalog: { [a.catalogKey]: a }, filters: {}, claimableStores: ['epic'], watchedStores: ['epic'],
    cadence: [], maxReclamations: 3,
    onClaimStart: async () => { throw new Error('ntfy injoignable'); },
    onClaimed: async () => { throw new Error('ntfy injoignable'); },
    claim: async () => ({ verdict: VERDICTS.CLAIMED }),
  });
  assert.equal(r.claims[0].verdict, VERDICTS.CLAIMED);
});
