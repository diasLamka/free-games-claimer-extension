/* Harnais de test : charge le moteur genere dans un contexte vm muni du
 * strict minimum de navigateur, et rend les fonctions pures exposees par
 * __FGC_EXPOSE_FOR_TESTS__ (voir src/core/32-test-hook.js).
 *
 * Aucune dependance : node --test suffit.
 *
 * Le moteur pose un setInterval au chargement (surveillance des navigations
 * SPA) et un ecouteur 'load'. Les deux sont neutralises ici : sans cela le
 * processus de test ne se terminerait jamais.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'free-games-claimer.js');

const noop = () => {};

function fakeElement() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    children: [],
    setAttribute: noop,
    getAttribute: () => null,
    appendChild: noop,
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
  };
}

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

/**
 * Charge le moteur et renvoie { fgc, gmStore, sandbox }.
 *  - fgc      : l'objet __FGC__ des fonctions pures
 *  - gmStore  : la Map derriere GM_getValue / GM_setValue, pour inspecter
 *  - sandbox  : le contexte complet, si un test a besoin d'aller plus loin
 */
export function loadEngine(options = {}) {
  const hostname = options.hostname || 'store.epicgames.com';
  const pathname = options.pathname || '/';
  const search = options.search || '';

  const gmStore = new Map();

  const location = {
    hostname,
    pathname,
    search,
    hash: '',
    protocol: 'https:',
    origin: 'https://' + hostname,
    href: 'https://' + hostname + pathname + search,
    assign: noop,
    replace: noop,
    reload: noop,
  };

  const document = {
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: fakeElement,
    documentElement: fakeElement(),
    head: fakeElement(),
    body: fakeElement(),
    hidden: false,
    visibilityState: 'visible',
    readyState: options.readyState,
  };

  const sandbox = {
    location,
    document,
    console: { log: noop, warn: noop, error: noop, info: noop },
    // Les timers sont neutralises : le moteur en pose au chargement.
    setTimeout: options.setTimeout || (() => 0),
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    URL,
    Date,
    Math,
    JSON,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    sessionStorage: fakeStorage(),
    localStorage: fakeStorage(),
    navigator: { clipboard: null, userAgent: 'node-test' },
    history: { pushState: noop, replaceState: noop },
    MutationObserver: class { observe() {} disconnect() {} },
    addEventListener: noop,
    removeEventListener: noop,
    open: noop,

    GM_getValue: (k, d) => (gmStore.has(k) ? gmStore.get(k) : d),
    GM_setValue: (k, v) => { gmStore.set(k, v); },
    GM_deleteValue: (k) => { gmStore.delete(k); },
    GM_addStyle: noop,
    GM_notification: noop,
    GM_registerMenuCommand: noop,
    GM_setClipboard: noop,
    GM_openInTab: noop,
    GM_xmlhttpRequest: noop,

    __FGC_EXPOSE_FOR_TESTS__: true,
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(readFileSync(BUNDLE, 'latin1'), sandbox, { filename: 'free-games-claimer.js' });

  if (!sandbox.__FGC__) {
    throw new Error('__FGC__ absent : le hook de test ne s\'est pas execute (garde d\'iframe ?)');
  }

  return { fgc: sandbox.__FGC__, gmStore, sandbox };
}
