/* La page de collection.
 *
 * Elle LIT, et elle DEMANDE. L'importation passe par le service worker, seul
 * ecrivain de la cle -- comme pour le journal et le catalogue : chrome.storage
 * n'a pas de transaction, et deux contextes qui font lire-modifier-ecrire sur
 * la meme cle perdent des donnees.
 *
 * Elle se rafraichit sur `storage.onChanged` : pendant une importation, chaque
 * magasin apparait des qu'il est lu, sans sondage.
 */
import { t, translateDocument, setLocale, intlLocale } from './i18n.js';
import { STORE_LABELS } from './watch/offer.js';
import { KEY_LIBRARY } from './watch/library.js';
import {
  KEY_COLLECTION,
  COLLECTION_STORES,
  IMPORTABLE_STORES,
  IMPORT_STATUS,
  sanitiseCollection,
  buildRows,
  filterRows,
  sortRows,
  summarise,
  effectiveStatus,
  storePageUrl,
  launchUrl,
} from './watch/collection.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const KEY_UI = 'veille:ui';

/** Des etiquettes courtes pour les pastilles : « Epic Games Store » ne tient pas dans une ligne de tableau. */
const SHORT_LABELS = Object.freeze({ steam: 'Steam', gog: 'GOG', epic: 'Epic', amazon: 'Amazon' });

/**
 * Ou se connecter quand une importation dit « pas connecte ».
 *
 * Pour Epic, la page des transactions plutot que la connexion nue : c'est elle
 * qui ouvre la session sur accounts.epicgames.com, l'hote que lit
 * l'importation -- on peut etre connecte au magasin sans l'etre la.
 */
const SIGN_IN = Object.freeze({
  steam: 'https://store.steampowered.com/login/',
  gog: 'https://www.gog.com/account',
  epic: 'https://www.epicgames.com/account/transactions',
});

let collection = sanitiseCollection(null);
let library = {};
let rows = [];
let importing = false;

/* ------------------------------------------------------------------ outils */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function dateText(ts) {
  return new Date(ts).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function flash(text) {
  const n = document.getElementById('flash');
  n.textContent = text || '';
}

function externalLink(className, text, href) {
  const a = el('a', className, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/* ------------------------------------------------------------ les magasins */

/**
 * Ce que la carte d'un magasin dit de sa derniere importation.
 *
 * Un echec ne cache jamais la derniere reussite : « non connecte » avec 800
 * jeux toujours affiches doit dire que ces 800 jeux datent d'avant.
 */
function stateOf(state, now) {
  const status = effectiveStatus(state, now);
  if (!status) return { text: t('collectionNever'), level: '' };
  if (status === IMPORT_STATUS.RUNNING) return { text: t('collectionImporting'), level: 'run' };
  if (status === IMPORT_STATUS.OK) return { text: t('collectionStateOk', dateText(state.at)), level: 'ok' };

  let text;
  if (state.status === IMPORT_STATUS.RUNNING) text = t('collectionStateStale');
  else if (status === IMPORT_STATUS.LOGGED_OUT) text = t('collectionStateLoggedOut');
  else if (status === IMPORT_STATUS.SHAPE) text = t('collectionStateShape');
  else text = t('collectionStateError', state.note || '?');

  if (state.lastOk && state.count) text += ` ${t('collectionKept', dateText(state.lastOk))}`;
  return { text, level: status === IMPORT_STATUS.LOGGED_OUT ? 'warn' : 'err' };
}

/**
 * Les cartes des magasins.
 *
 * Le nombre vit dans l'en-tete de la carte, seul : « 1 jeux » est le genre de
 * faute qu'on ne voit qu'une fois en ligne, et un nombre sans nom a accorder ne
 * peut pas la faire. Il suit le genre choisi, comme la liste.
 */
function renderStores(now, perStore) {
  const box = document.getElementById('stores');
  box.textContent = '';

  for (const store of COLLECTION_STORES) {
    const card = el('section', 'card');
    const head = el('div', 'card-head');
    const n = perStore[store] || 0;
    head.append(el('h2', null, STORE_LABELS[store] || store), el('b', n ? 'card-count' : 'card-count zero', String(n)));
    card.append(head);

    if (!IMPORTABLE_STORES.includes(store)) {
      // Amazon : seulement ce que l'extension a reclame, et la carte le dit.
      card.append(el('p', 'state', t('collectionAmazonState')));
      box.append(card);
      continue;
    }

    const state = collection.stores[store];
    const { text, level } = stateOf(state, now);
    card.append(el('p', `state ${level}`, text));

    const actions = el('div', 'actions');
    const importer = el('button', null, state && state.lastOk ? t('collectionReimport') : t('collectionImport'));
    importer.disabled = importing;
    importer.addEventListener('click', () => startImport([store]));
    actions.append(importer);

    if (effectiveStatus(state, now) === IMPORT_STATUS.LOGGED_OUT && SIGN_IN[store]) {
      actions.append(externalLink('link', t('collectionSignIn'), SIGN_IN[store]));
    }
    if (state && state.report) {
      const copie = el('button', 'ghost', t('collectionCopyReport'));
      copie.addEventListener('click', () => copyReport(store, copie));
      actions.append(copie);
    }
    card.append(actions);
    box.append(card);
  }

  document.getElementById('import-all').disabled = importing;
}

/* ---------------------------------------------------------------- la liste */

function badge(store, copy) {
  const wrap = el('span', `badge ${store}`);
  const page = storePageUrl(store, copy);
  wrap.append(page
    ? externalLink('name', SHORT_LABELS[store] || store, page)
    : el('span', 'name', SHORT_LABELS[store] || store));

  const launch = launchUrl(store, copy);
  if (launch) {
    // Un schema d'URL, pas une page : le navigateur demande avant d'ouvrir Steam.
    const a = el('a', 'launch', '▶');
    a.href = launch;
    a.title = t('collectionLaunch');
    a.setAttribute('aria-label', t('collectionLaunch'));
    wrap.append(a);
  }
  return wrap;
}

function renderRows() {
  const kind = document.getElementById('kind').value || 'game';
  const filters = {
    kind,
    query: document.getElementById('search').value || '',
    store: document.getElementById('store').value || '',
    duplicatesOnly: document.getElementById('duplicates').checked,
  };

  // Les compteurs suivent le genre choisi, pas la recherche : ils decrivent
  // la collection, pas ce qu'on est en train d'y chercher.
  const totaux = summarise(filterRows(rows, { kind }));
  document.getElementById('count-titles').textContent = String(totaux.titles);
  document.getElementById('count-duplicates').textContent = String(totaux.duplicates);
  document.getElementById('count-claimed').textContent = String(totaux.claimed);

  const shown = sortRows(filterRows(rows, filters), document.getElementById('sort').value || 'title', intlLocale());
  const corps = document.getElementById('rows');
  const lot = document.createDocumentFragment();

  for (const r of shown) {
    const tr = el('tr');

    const title = el('td', 'title');
    if (r.title) title.textContent = r.title;
    else {
      const [store] = Object.keys(r.stores);
      title.append(el('span', 'untitled', t('collectionUntitled', r.stores[store].id)));
    }
    if (r.claimed) title.append(el('span', 'tag', t('collectionClaimedTag')));
    tr.append(title);

    const stores = el('td', 'stores');
    for (const store of COLLECTION_STORES) if (r.stores[store]) stores.append(badge(store, r.stores[store]));
    tr.append(stores);

    tr.append(el('td', 'since', r.since ? dateText(r.since) : '—'));
    lot.append(tr);
  }

  corps.textContent = '';
  corps.append(lot);

  const vide = document.getElementById('empty');
  vide.hidden = shown.length > 0;
  // Une collection vide et un filtre qui ne rend rien ne se disent pas pareil.
  vide.textContent = rows.length ? t('collectionNoMatch') : t('collectionEmpty');
}

/** Les compteurs par magasin, pour le genre choisi. */
function perStoreCounts() {
  const kind = document.getElementById('kind').value || 'game';
  return summarise(filterRows(rows, { kind })).perStore;
}

function render() {
  renderStores(Date.now(), perStoreCounts());
  renderRows();
}

async function load() {
  const brut = await api.storage.local.get([KEY_COLLECTION, KEY_LIBRARY]);
  collection = sanitiseCollection(brut[KEY_COLLECTION]);
  library = brut[KEY_LIBRARY] || {};
  rows = buildRows({ collection, library });
  render();
}

/* ------------------------------------------------------------------ actions */

function startImport(stores) {
  if (importing) return;
  importing = true;
  flash(t('collectionImporting'));
  render();

  api.runtime.sendMessage({ type: 'fgc-collection-import', stores }, (res) => {
    void api.runtime.lastError;   // un worker muet ne doit pas laisser d'erreur non lue
    importing = false;
    if (res && res.busy) flash(t('collectionBusy'));
    else if (res && res.ok === false) flash(t('collectionStateError', res.error || '?'));
    else flash('');
    load();
  });
}

async function copyReport(store, bouton) {
  const state = collection.stores[store] || {};
  const texte = [
    `Collection -- ${STORE_LABELS[store] || store} -- extension v${api.runtime.getManifest().version}`,
    `${new Date(state.at || Date.now()).toISOString()} -- statut : ${state.status}${state.note ? ` (${state.note})` : ''}`,
    state.report || '',
  ].join('\n');

  try {
    await navigator.clipboard.writeText(texte);
    bouton.textContent = t('collectionReportCopied');
  } catch {
    // Un refus du navigateur ne doit pas se solder par un « copie » mensonger.
    bouton.textContent = t('collectionCopyFailed');
  }
  setTimeout(() => { bouton.textContent = t('collectionCopyReport'); }, 2000);
}

/* ------------------------------------------------------------------- setup */

async function boot() {
  const raw = await api.storage.local.get(KEY_UI);
  const ui = (raw && raw[KEY_UI]) || {};

  if (ui.language && ui.language !== 'auto') setLocale(ui.language);
  if (ui.theme && ui.theme !== 'system') document.documentElement.dataset.theme = ui.theme;

  translateDocument();
  document.title = t('collectionTitle');

  const choix = document.getElementById('store');
  for (const store of COLLECTION_STORES) {
    const option = el('option', null, STORE_LABELS[store] || store);
    option.value = store;
    choix.append(option);
  }

  await load();
}

document.getElementById('search').addEventListener('input', renderRows);
for (const id of ['store', 'sort', 'duplicates']) document.getElementById(id).addEventListener('change', renderRows);
// Le genre change aussi les compteurs des cartes, pas seulement la liste.
document.getElementById('kind').addEventListener('change', render);
document.getElementById('import-all').addEventListener('click', () => startImport(IMPORTABLE_STORES));

api.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && (changes[KEY_COLLECTION] || changes[KEY_LIBRARY])) load();
});

boot();
