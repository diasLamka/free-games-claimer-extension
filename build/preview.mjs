/* Voir le popup sans recharger l'extension.
 *
 *   npm run preview                  donnees de demonstration
 *   npm run preview -- --chrome      une COPIE EN LECTURE de vos donnees Chrome
 *   npm run preview -- --chrome DIR  ... depuis ce dossier de base precis
 *   npm run preview -- --data F.json un export du popup, ou un instantane du stockage
 *   options : --port 5178, --lang fr|en
 *
 * Pourquoi. La 2.36.0 a livre un popup VIDE pendant quatre versions : une
 * `const` lue avant sa declaration arretait le module au chargement, et aucun
 * test ne charge popup.js. Il fallait recharger l'extension dans Chrome pour le
 * voir -- donc ne pas le voir. Ici, le vrai popup.html et le vrai popup.js
 * tournent dans un navigateur ordinaire, sur un faux `chrome.*` nourri de
 * donnees ; la page s'ouvre en une commande.
 *
 * Trois regles, et elles ne se negocient pas :
 *
 *   - RIEN N'EST ECRIT. Les ecritures du popup restent en memoire, dans la
 *     page ; le profil Chrome n'est ouvert qu'en lecture (build/leveldb.mjs).
 *   - LOCAL SEULEMENT. Le serveur n'ecoute que 127.0.0.1 : vos donnees ne sont
 *     joignables depuis aucune autre machine.
 *   - DANS LE DEPOT SEULEMENT. Un chemin qui sort du dossier rend 404.
 *
 * Le script vit dans build/, que l'archive de l'extension exclut.
 */
import http from 'node:http';
import os from 'node:os';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readDatabase, storageValues, findExtensionDatabases, chromeUserDataDirs } from './leveldb.mjs';
import { demoStorage } from './preview-demo.mjs';
import { KEYS } from '../watch/storage.js';
import { KEY_CODES } from '../watch/backup.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STUB_PATH = '/__preview-stub.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/* ----------------------------------------------------------------- donnees */

/**
 * Un export du popup (Sauvegarde -> Exporter) remis sous les cles du stockage.
 * Un objet qui n'est pas un export est pris pour un instantane du stockage.
 */
export function fromExport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  if (data.exportFormat === undefined) return data;

  const out = {};
  for (const [platform, h] of Object.entries(data.histories || {})) {
    // Le moteur relit son historique en JSON serialise (GM_getValue).
    out[`FGC_history_${platform}`] = JSON.stringify(h || {});
  }
  if (data.catalog) out[KEYS.OFFERS] = data.catalog;
  if (data.sources) out[KEYS.SOURCES] = data.sources;
  if (data.settings) out[KEYS.SETTINGS] = data.settings;
  if (data.filters) out[KEYS.FILTERS] = data.filters;
  if (Array.isArray(data.pendingCodes)) out[KEY_CODES] = JSON.stringify(data.pendingCodes);
  return out;
}

/* ------------------------------------------------------------ faux chrome */

/**
 * Le script qui pose `chrome.*` avant popup.js.
 *
 * Il ne cherche pas a etre complet : ce que les pages appellent, avec les
 * formes que Chrome rend (promesse ET rappel). Les ecritures vivent dans la
 * page et declenchent storage.onChanged, comme dans l'extension -- c'est ce
 * qui permet de voir le popup se redessiner.
 */
export function stubScript(data, { manifest = {}, lang = 'fr' } = {}) {
  return `/* Faux chrome.* de build/preview.mjs. Rien de ce qui s'ecrit ici ne quitte la page. */
(() => {
  const listeners = [];
  const zone = (name, initial) => {
    const data = initial;
    const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const pick = (keys) => {
      if (keys === null || keys === undefined) return copy(data);
      const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
      const out = {};
      for (const k of list) {
        if (k in data) out[k] = copy(data[k]);
        else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
      }
      return out;
    };
    const fire = (changes) => { for (const l of listeners) { try { l(changes, name); } catch (e) { console.error(e); } } };
    const done = (cb, v) => { if (typeof cb === 'function') cb(v); return Promise.resolve(v); };
    return {
      get: (keys, cb) => done(typeof keys === 'function' ? keys : cb, pick(typeof keys === 'function' ? null : keys)),
      set: (obj, cb) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj || {})) { changes[k] = { oldValue: copy(data[k]), newValue: copy(v) }; data[k] = copy(v); }
        fire(changes);
        return done(cb);
      },
      remove: (keys, cb) => {
        const changes = {};
        for (const k of [].concat(keys)) if (k in data) { changes[k] = { oldValue: copy(data[k]) }; delete data[k]; }
        fire(changes);
        return done(cb);
      },
      clear: (cb) => { for (const k of Object.keys(data)) delete data[k]; return done(cb); },
      getBytesInUse: (keys, cb) => done(typeof keys === 'function' ? keys : cb, JSON.stringify(pick(typeof keys === 'function' ? null : keys)).length),
    };
  };
  const reply = (cb) => { if (typeof cb === 'function') cb({}); return Promise.resolve({}); };
  window.__preview = { sent: [], opened: [] };
  window.chrome = {
    storage: {
      local: zone('local', ${JSON.stringify(data)}),
      sync: zone('sync', {}),
      onChanged: { addListener: (l) => listeners.push(l), removeListener: () => {} },
    },
    runtime: {
      id: 'apercu',
      lastError: undefined,
      getManifest: () => (${JSON.stringify(manifest)}),
      getURL: (p) => (String(p).startsWith('/') ? '' : '/') + String(p),
      sendMessage: (msg, cb) => { window.__preview.sent.push(msg); return reply(cb); },
      onMessage: { addListener: () => {} },
    },
    i18n: { getUILanguage: () => ${JSON.stringify(lang)}, getMessage: () => '' },
    tabs: {
      create: (o) => { window.__preview.opened.push(o && o.url); return Promise.resolve({}); },
      query: () => Promise.resolve([]),
    },
    permissions: {
      contains: () => Promise.resolve(false),
      request: () => Promise.resolve(false),
      remove: () => Promise.resolve(true),
    },
  };
})();
`;
}

/** Le faux chrome passe avant tout autre script de la page. */
export function injectStub(html) {
  const tag = `<script src="${STUB_PATH}"></script>\n`;
  const i = html.search(/<script\b/i);
  return i === -1 ? html.replace(/<\/body>/i, `${tag}</body>`) : html.slice(0, i) + tag + html.slice(i);
}

/** Le fichier que designe un chemin d'URL, ou null s'il sort du depot. */
export function resolveInside(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const file = resolve(root, `.${decoded.startsWith('/') ? '' : '/'}${decoded}`);
  return file === root || file.startsWith(root + sep) ? file : null;
}

/* --------------------------------------------------------------- serveur */

export function createPreviewServer({ root = ROOT, data = {}, lang = 'fr' } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  const stub = stubScript(data, { manifest, lang });

  return http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, 'text/plain', 'lecture seule'); return; }

    const { pathname } = new URL(req.url, 'http://127.0.0.1');
    if (pathname === STUB_PATH) { send(200, TYPES['.js'], stub); return; }
    if (pathname === '/') { res.writeHead(302, { location: '/popup.html' }); res.end(); return; }

    const file = resolveInside(root, pathname);
    if (!file || !existsSync(file) || statSync(file).isDirectory()) { send(404, 'text/plain', '404'); return; }

    const ext = extname(file).toLowerCase();
    if (ext === '.html') { send(200, TYPES['.html'], injectStub(readFileSync(file, 'utf8'))); return; }
    send(200, TYPES[ext] || 'application/octet-stream', readFileSync(file));
  });
}

/* ------------------------------------------------------------------- CLI */

function parseArgs(argv) {
  const out = { port: 5178, lang: 'fr', chrome: null, data: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : null);
    if (a === '--port') out.port = Number(next()) || out.port;
    else if (a === '--lang') out.lang = next() || out.lang;
    else if (a === '--chrome') out.chrome = next() || true;
    else if (a === '--data') out.data = next();
  }
  return out;
}

function loadData(args) {
  if (args.data) {
    return { data: fromExport(JSON.parse(readFileSync(resolve(args.data), 'utf8'))), from: args.data };
  }
  if (args.chrome) {
    const dir = typeof args.chrome === 'string'
      ? args.chrome
      : (findExtensionDatabases(chromeUserDataDirs({ home: os.homedir() }))[0] || {}).dir;
    if (!dir) throw new Error('aucune base de cette extension trouvee dans les profils Chrome (--chrome DIR pour la designer)');
    return { data: storageValues(readDatabase(dir)), from: `${dir} (lecture seule)` };
  }
  return { data: demoStorage(Date.now()), from: 'donnees de demonstration' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const { data, from } = loadData(args);
  createPreviewServer({ data, lang: args.lang }).listen(args.port, '127.0.0.1', () => {
    console.log(`apercu : http://127.0.0.1:${args.port}/popup.html`);
    console.log(`donnees : ${from}, ${Object.keys(data).length} cle(s)`);
    console.log('aussi : /collection.html, /historique.html, /journal.html -- Ctrl+C pour arreter');
  });
}
