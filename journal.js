/* La page du journal.
 *
 * Elle LIT, elle n'ecrit pas -- sauf pour vider, et alors elle le demande au
 * service worker. Le journal a un seul ecrivain, pour la meme raison que le
 * catalogue : chrome.storage n'a pas de transaction, et deux contextes qui
 * font lire-modifier-ecrire sur le meme tableau perdent des entrees.
 *
 * Elle se rafraichit sur `storage.onChanged` plutot qu'a intervalle : une
 * page ouverte pendant un cycle voit les lignes arriver, sans sonder.
 */
import { t, translateDocument, setLocale, intlLocale } from './i18n.js';
import {
  KEY_JOURNAL,
  filterEntries,
  countByLevel,
  sanitise,
  toText,
  journalFileName,
} from './watch/journal.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const KEY_UI = 'veille:ui';

let entries = [];

/* ------------------------------------------------------------------ outils */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

/** Date lisible, dans la langue affichee -- pas l'ISO du fichier exporte. */
function whenText(ts) {
  const d = new Date(ts);
  const loc = intlLocale();
  return `${d.toLocaleDateString(loc, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoquer tout de suite couperait le telechargement dans certains cas.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/* --------------------------------------------------------------- affichage */

function render() {
  const level = document.getElementById('level').value || null;
  const query = document.getElementById('search').value || '';
  const vues = filterEntries(entries, { level, query });

  const counts = countByLevel(entries);
  document.getElementById('count-info').textContent = String(counts.info);
  document.getElementById('count-warn').textContent = String(counts.warn);
  document.getElementById('count-error').textContent = String(counts.error);

  const corps = document.getElementById('rows');
  corps.textContent = '';

  for (const e of vues) {
    const tr = el('tr', e.level);
    tr.append(el('td', 'when', whenText(e.ts)));
    tr.append(el('td', 'level', e.level));

    const what = el('td', 'what', e.message);
    if (e.details) what.append(el('span', 'details', e.details));
    tr.append(what);
    corps.append(tr);
  }

  const vide = document.getElementById('empty');
  vide.hidden = vues.length > 0;
  // Un journal vide et un filtre qui ne rend rien ne se disent pas pareil :
  // le premier veut dire « rien ne s'est passe », le second « pas ici ».
  vide.textContent = entries.length ? t('journalNoMatch') : t('journalEmpty');
}

async function load() {
  const brut = await api.storage.local.get(KEY_JOURNAL);
  entries = sanitise(brut[KEY_JOURNAL]);
  render();
}

/* ------------------------------------------------------------------- setup */

async function boot() {
  const raw = await api.storage.local.get(KEY_UI);
  const ui = (raw && raw[KEY_UI]) || {};

  if (ui.language && ui.language !== 'auto') setLocale(ui.language);
  if (ui.theme && ui.theme !== 'system') document.documentElement.dataset.theme = ui.theme;

  translateDocument();
  await load();
}

document.getElementById('level').addEventListener('change', render);
document.getElementById('search').addEventListener('input', render);
document.getElementById('refresh').addEventListener('click', () => { load(); });

document.getElementById('copy').addEventListener('click', async () => {
  const bouton = document.getElementById('copy');
  try {
    await navigator.clipboard.writeText(toText(entries));
    bouton.textContent = t('journalCopied');
  } catch {
    // Un refus du navigateur ne doit pas se solder par un « copie » mensonger.
    bouton.textContent = t('journalCopyFailed');
  }
  setTimeout(() => { bouton.textContent = t('journalCopy'); }, 2000);
});

document.getElementById('download').addEventListener('click', () => {
  download(journalFileName(Date.now()), 'text/plain', toText(entries));
});

document.getElementById('clear').addEventListener('click', () => {
  // Le worker est l'ecrivain : effacer depuis ici pendant qu'il ecrit
  // perdrait des entrees des deux cotes.
  api.runtime.sendMessage({ type: 'fgc-journal-clear' }, () => {
    void api.runtime.lastError;   // un worker muet ne doit pas laisser d'erreur non lue
    load();
  });
});

/* Le journal s'ecrit pendant qu'on le regarde : une page ouverte au moment
   d'un cycle voit les lignes arriver, sans sondage. */
api.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && changes[KEY_JOURNAL]) {
    entries = sanitise(changes[KEY_JOURNAL].newValue);
    render();
  }
});

boot();
