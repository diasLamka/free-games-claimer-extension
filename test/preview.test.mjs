/* L'apercu du popup (build/preview.mjs) et sa lecture du profil Chrome.
 *
 * Deux promesses a tenir : ne rien servir hors du depot, et lire la base
 * LevelDB comme le navigateur la lit -- la plus haute sequence gagne, une
 * suppression efface. Les fichiers sont fabriques ici, octet par octet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { fromExport, stubScript, injectStub, resolveInside, createPreviewServer } from '../build/preview.mjs';
import { snappyDecompress, decodeLog, decodeTable, readDatabase, storageValues, readVarint } from '../build/leveldb.mjs';
import { demoStorage } from '../build/preview-demo.mjs';
import { KEYS } from '../watch/storage.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------ fabrication */

function varint(n) {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** Un fichier journal d'un seul lot, en un seul fragment. */
function logFile(seq, ops) {
  const parts = [];
  const header = Buffer.alloc(12);
  header.writeBigUInt64LE(BigInt(seq), 0);
  header.writeUInt32LE(ops.length, 8);
  parts.push(header);
  for (const [key, value] of ops) {
    parts.push(Buffer.from([value === null ? 0 : 1]), varint(Buffer.byteLength(key)), Buffer.from(key));
    if (value !== null) parts.push(varint(Buffer.byteLength(value)), Buffer.from(value));
  }
  const record = Buffer.concat(parts);
  const head = Buffer.alloc(7);
  head.writeUInt16LE(record.length, 4);
  head[6] = 1; // FULL
  return Buffer.concat([head, record]);
}

/** Un bloc de table sans compression, une entree par point de redemarrage. */
function block(entries) {
  const parts = [];
  const restarts = [];
  let off = 0;
  for (const [key, value] of entries) {
    restarts.push(off);
    const e = Buffer.concat([varint(0), varint(key.length), varint(value.length), key, value]);
    parts.push(e);
    off += e.length;
  }
  const tail = Buffer.alloc(4 * restarts.length + 4);
  restarts.forEach((r, i) => tail.writeUInt32LE(r, i * 4));
  tail.writeUInt32LE(restarts.length, 4 * restarts.length);
  return Buffer.concat([...parts, tail]);
}

function internalKey(key, seq, type) {
  const tail = Buffer.alloc(8);
  tail.writeBigUInt64LE((BigInt(seq) << 8n) | BigInt(type));
  return Buffer.concat([Buffer.from(key), tail]);
}

/** Une table d'un bloc de donnees : bloc + trailer, index + trailer, pied. */
function tableFile(entries) {
  const data = block(entries.map(([k, v, seq]) => [internalKey(k, seq, v === null ? 0 : 1), Buffer.from(v || '')]));
  const trailer = Buffer.alloc(5);
  const dataHandle = Buffer.concat([varint(0), varint(data.length)]);
  const index = block([[internalKey(entries[entries.length - 1][0], 0, 1), dataHandle]]);
  const indexOffset = data.length + 5;
  const footer = Buffer.alloc(48);
  const handles = Buffer.concat([varint(0), varint(0), varint(indexOffset), varint(index.length)]);
  handles.copy(footer, 0);
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40);
  return Buffer.concat([data, trailer, index, trailer, footer]);
}

/* ------------------------------------------------------------------ leveldb */

test('un varint se relit, y compris sur plusieurs octets', () => {
  assert.deepEqual(readVarint(varint(300), 0), [300, 2]);
  assert.deepEqual(readVarint(varint(1790000000000), 0)[0], 1790000000000);
});

test('snappy : un litteral puis une copie', () => {
  // "abcabcabc" : litteral « abc » (tag (3-1)<<2), puis copie de 6 a distance 3.
  const src = Buffer.from([9, (3 - 1) << 2, 0x61, 0x62, 0x63, ((6 - 4) << 2) | 1, 3]);
  assert.equal(snappyDecompress(src).toString(), 'abcabcabc');
});

test('snappy refuse une copie qui pointe avant le debut', () => {
  assert.throws(() => snappyDecompress(Buffer.from([4, ((4 - 4) << 2) | 1, 9])), /hors bornes/);
});

test('le journal rend chaque entree avec sa sequence', () => {
  const entries = decodeLog(logFile(41, [['veille:etat', '{"a":1}'], ['FGC_x', null]]));
  assert.deepEqual(entries, [
    { key: 'veille:etat', value: '{"a":1}', seq: 41 },
    { key: 'FGC_x', value: null, seq: 42 },
  ]);
});

test('une table rend ses cles, sequences et suppressions', () => {
  const entries = decodeTable(tableFile([['a', '"1"', 5], ['b', null, 6]]));
  assert.deepEqual(entries, [
    { key: 'a', value: '"1"', seq: 5 },
    { key: 'b', value: null, seq: 6 },
  ]);
});

test('la base rend la plus haute sequence, et oublie ce qui est supprime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fgc-ldb-'));
  try {
    writeFileSync(join(dir, '000005.ldb'), tableFile([['garde', '"ancien"', 3], ['supprime', '"x"', 4]]));
    writeFileSync(join(dir, '000009.log'), logFile(10, [['garde', '"nouveau"'], ['supprime', null], ['neuf', '{"n":2}']]));
    const raw = readDatabase(dir);
    assert.deepEqual(raw, { garde: '"nouveau"', neuf: '{"n":2}' });
    assert.deepEqual(storageValues(raw), { garde: 'nouveau', neuf: { n: 2 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ apercu */

test('un export du popup redevient des cles de stockage', () => {
  const data = fromExport({
    exportFormat: 1,
    histories: { 'Epic Games': { 'slug:x': { status: 'claimed', ts: 1 } } },
    catalog: { 'epic:x': { title: 'X' } },
    pendingCodes: [{ code: 'ABCDE-FGHIJ-KLMNO' }],
  });
  assert.equal(typeof data['FGC_history_Epic Games'], 'string', 'le moteur relit du JSON serialise');
  assert.deepEqual(data[KEYS.OFFERS], { 'epic:x': { title: 'X' } });
  assert.equal(JSON.parse(data.FGC_pending_codes).length, 1);
  assert.deepEqual(fromExport({ 'veille:ui': { a: 1 } }), { 'veille:ui': { a: 1 } }, 'un instantane passe tel quel');
  assert.deepEqual(fromExport(null), {});
  assert.deepEqual(fromExport([1]), {});
});

test('le faux chrome est du JavaScript valide, et pose chrome avant la page', () => {
  const src = stubScript(demoStorage(Date.UTC(2026, 8, 22)), { manifest: { version: '9.9.9' } });
  assert.doesNotThrow(() => new vm.Script(src));
  const html = injectStub('<html><body><script type="module" src="popup.js"></script></body></html>');
  assert.ok(html.indexOf('__preview-stub.js') < html.indexOf('popup.js'));
});

test('le faux chrome lit, ecrit et previent comme le vrai', async () => {
  const sandbox = { window: {}, console, JSON, Promise, Object, Array, String };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(stubScript({ a: 1 }, { manifest: { version: '1' } }), sandbox);
  const { chrome } = sandbox;
  const vus = [];
  chrome.storage.onChanged.addListener((changes, area) => vus.push([Object.keys(changes), area]));
  assert.equal((await chrome.storage.local.get('a')).a, 1);
  await chrome.storage.local.set({ b: 2 });
  assert.equal((await chrome.storage.local.get(['b'])).b, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(vus)), [[['b'], 'local']]);
  assert.equal(chrome.runtime.getManifest().version, '1');
});

test('aucun chemin ne sort du depot', () => {
  assert.equal(resolveInside(ROOT, '/pages/popup.html'), join(ROOT, 'pages', 'popup.html'));
  assert.equal(resolveInside(ROOT, '/../package.json'), null);
  assert.equal(resolveInside(ROOT, '/%2e%2e/%2e%2e/secret'), null);
  assert.equal(resolveInside(ROOT, '/..%5C..%5Csecret'), null);
  assert.equal(resolveInside(ROOT, '/%E0%A4%A'), null, 'un encodage casse ne passe pas');
  assert.equal(resolveInside(ROOT, '/x%00.html'), null);
});

function get(server, path, method = 'GET') {
  return new Promise((ok, ko) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', ko);
    req.end();
  });
}

test('le serveur sert le vrai popup avec le faux chrome', async () => {
  const server = createPreviewServer({ data: { 'veille:etat': { booted: true } } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await get(server, '/pages/popup.html');
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('__preview-stub.js'));

    const stub = await get(server, '/__preview-stub.js');
    assert.ok(stub.body.includes('"veille:etat"'));

    assert.equal((await get(server, '/')).status, 302);
    assert.equal((await get(server, '/pages/popup.html', 'POST')).status, 405);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('un fichier a cote du dossier servi reste hors d\'atteinte', async () => {
  /* Le secret vit a cote du dossier servi. Le parseur d'URL ramene deja les
     « .. » dans la racine ; la barre oblique encodee, elle, passe le parseur
     et n'est arretee que par resolveInside. */
  const base = mkdtempSync(join(tmpdir(), 'fgc-apercu-'));
  const site = join(base, 'site');
  try {
    writeFileSync(join(base, 'secret.txt'), 'NE PAS SERVIR');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(site);
    writeFileSync(join(site, 'manifest.json'), '{"version":"0"}');
    writeFileSync(join(site, 'page.html'), '<html><body><script src="a.js"></script></body></html>');

    const server = createPreviewServer({ root: site, data: {} });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      assert.equal((await get(server, '/page.html')).status, 200);
      for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2Fsecret.txt', '/..%5Csecret.txt', '/%2e%2e%2fsecret.txt']) {
        const r = await get(server, path);
        assert.ok(!r.body.includes('NE PAS SERVIR'), `${path} a servi le secret`);
        assert.equal(r.status, 404, path);
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
