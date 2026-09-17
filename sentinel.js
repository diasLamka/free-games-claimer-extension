/* La page du mode repli.
 *
 * Elle tient l'horloge, elle affiche, elle N'ECRIT PAS. Chaque tentative est
 * une DEMANDE au service worker, qui reste l'ecrivain unique du catalogue et
 * du journal -- voir l'en-tete de watch/sentinel.js pour ce que ce partage
 * evite.
 *
 * Ce qu'elle apporte, et qui ne se trouve nulle part ailleurs : elle force les
 * sources visees, donc elle passe outre le recul qui les endort des heures
 * apres trois echecs. Ce pouvoir ne vaut que pendant qu'un humain regarde,
 * d'ou le fait qu'il meurt avec l'onglet.
 */
import { t, translateDocument, setLocale, intlLocale } from './i18n.js';
import {
  BEAT_PERIOD_MS,
  beatDelay,
  failingSources,
  recovered,
} from './watch/sentinel.js';
import { KEY_JOURNAL, sanitise } from './watch/journal.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const KEY_UI = 'veille:ui';
const KEY_SOURCES = 'veille:sources';

/** Combien de lignes de journal on montre. Assez pour suivre, pas pour noyer. */
const JOURNAL_LINES = 12;

let sources = {};
/** L'etat au moment de l'ouverture : c'est a lui qu'on compare pour voir un retour. */
let sourcesAtOpen = {};
let cibles = [];
let attempts = 0;
let nextTryAt = 0;
let running = false;
let revenues = [];

/* ------------------------------------------------------------------ outils */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

const DAY_MS = 86400000;

/** Meme regle que le popup : jamais de secondes au-dela d'une minute. */
function readableDelay(ms) {
  const abs = Math.max(0, ms);
  const d = Math.floor(abs / DAY_MS);
  const h = Math.floor((abs % DAY_MS) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  if (d) return t('durationDaysHours', String(d), String(h));
  if (h) return t('durationHoursMinutes', String(h), String(m).padStart(2, '0'));
  if (m) return t('durationMinutes', String(m));
  return t('durationSeconds', String(s));
}

function whenText(ts) {
  const d = new Date(ts);
  const loc = intlLocale();
  return `${d.toLocaleDateString(loc, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Une demande au worker. Ne jette jamais : la page doit rester lisible. */
function ask(payload) {
  return new Promise((resolve) => {
    try {
      api.runtime.sendMessage({ type: 'fgc-sentinel', ...payload }, (r) => {
        void api.runtime.lastError;   // un worker muet ne doit pas laisser d'erreur non lue
        resolve(r || null);
      });
    } catch {
      resolve(null);
    }
  });
}

/* --------------------------------------------------------------- affichage */

function renderState() {
  const zone = document.getElementById('state');
  const texte = document.getElementById('state-text');
  const encore = failingSources(sources);

  zone.classList.toggle('ok', encore.length === 0);
  document.getElementById('try').disabled = running;

  if (running) {
    texte.textContent = t('sentinelTrying');
    return;
  }
  if (encore.length === 0) {
    // Le seul etat qui termine proprement un repli : la veille ordinaire
    // suffit de nouveau, et on le dit au lieu de laisser l'onglet ouvert.
    texte.textContent = revenues.length
      ? t('sentinelRecovered', revenues.join(', '))
      : t('sentinelNothingFailing');
    return;
  }
  const reste = Math.max(0, nextTryAt - Date.now());
  texte.textContent = `${t('sentinelNextTry', readableDelay(reste))} · ${t('sentinelAttempts', String(attempts))}`;
}

function renderSources() {
  const host = document.getElementById('sources');
  host.textContent = '';

  const encore = new Set(failingSources(sources).map((s) => s.name));
  const noms = [...new Set([...cibles, ...encore])];

  if (!noms.length) {
    host.append(el('p', 'sub', t('sentinelNothingFailing')));
    return;
  }

  for (const nom of noms) {
    const s = sources[nom] || {};
    const casse = encore.has(nom);
    const carte = el('div', `card${casse ? '' : ' back'}`);

    const tete = el('div');
    tete.append(el('span', 'name', nom));
    tete.append(el('span', 'count', casse
      ? t('sentinelStillFailing', String(s.consecutiveFailures || 0))
      : t('sentinelBack')));
    carte.append(tete);

    if (casse && s.lastError) carte.append(el('p', 'why', s.lastError));
    carte.append(el('p', 'when', Number.isFinite(s.lastSuccess)
      ? t('sentinelLastSuccess', whenText(s.lastSuccess))
      : t('sentinelNeverSucceeded')));

    host.append(carte);
  }
}

async function renderJournal() {
  const brut = await api.storage.local.get(KEY_JOURNAL);
  const lignes = sanitise(brut[KEY_JOURNAL]).slice(0, JOURNAL_LINES);

  const corps = document.getElementById('rows');
  corps.textContent = '';
  for (const e of lignes) {
    const tr = el('tr', e.level);
    tr.append(el('td', 'when', whenText(e.ts)));
    tr.append(el('td', 'level', e.level));
    tr.append(el('td', null, e.details ? `${e.message} -- ${e.details}` : e.message));
    corps.append(tr);
  }
}

function render() {
  renderState();
  renderSources();
}

/* ------------------------------------------------------------------ cycle */

async function tenter() {
  if (running) return;
  running = true;
  render();

  const r = await ask({ state: 'beat', sources: cibles, attempts });
  attempts += 1;

  if (r && r.sources) {
    const avant = sources;
    sources = r.sources;
    // Ce qui est revenu depuis l'OUVERTURE, pas depuis la tentative
    // precedente : sinon un retour annonce une fois disparaitrait de l'ecran
    // a la tentative suivante.
    revenues = recovered(sourcesAtOpen, sources);
    void avant;
  }

  nextTryAt = Date.now() + beatDelay(attempts);
  running = false;
  render();
  await renderJournal();
}

/** Le battement : il dit au worker qu'un humain surveille, rien de plus. */
function battre() {
  ask({ state: 'ping', sources: cibles, attempts });
}

/* ------------------------------------------------------------------- setup */

async function boot() {
  const raw = await api.storage.local.get([KEY_UI, KEY_SOURCES]);
  const ui = raw[KEY_UI] || {};
  if (ui.language && ui.language !== 'auto') setLocale(ui.language);
  if (ui.theme && ui.theme !== 'system') document.documentElement.dataset.theme = ui.theme;
  translateDocument();

  sources = raw[KEY_SOURCES] || {};
  sourcesAtOpen = sources;
  cibles = failingSources(sources).map((s) => s.name);

  const r = await ask({ state: 'open', sources: cibles });
  if (r && r.sources) {
    sources = r.sources;
    sourcesAtOpen = r.sources;
    cibles = failingSources(sources).map((s) => s.name);
  }

  render();
  await renderJournal();

  // Rien a forcer s'il n'y a rien de casse : la page reste lisible, et elle
  // n'ouvre aucun trafic. Une sentinelle ouverte par curiosite ne doit pas se
  // mettre a marteler des services qui vont bien.
  if (cibles.length) {
    nextTryAt = Date.now() + beatDelay(0);
    render();
  }
}

/* L'horloge de la page : une seconde, ce qu'aucune alarme MV3 ne garantit.
   C'est la raison d'etre du repli, et elle tient en trois lignes. */
setInterval(() => {
  if (!cibles.length || running) return;
  if (Date.now() >= nextTryAt) tenter();
  else renderState();
}, 1000);

setInterval(battre, BEAT_PERIOD_MS);

document.getElementById('try').addEventListener('click', () => { tenter(); });

document.getElementById('close').addEventListener('click', () => {
  ask({ state: 'close' }).then(() => window.close());
});

/* La fermeture est une politesse, pas une garantie : la peremption du
   battement fait le meme travail trois minutes plus tard. Un onglet tue avec
   le navigateur ne laisse donc rien derriere lui. */
window.addEventListener('pagehide', () => {
  try { api.runtime.sendMessage({ type: 'fgc-sentinel', state: 'close' }); } catch { /* deja parti */ }
});

api.storage.onChanged.addListener((changes, zone) => {
  if (zone !== 'local') return;
  if (changes[KEY_JOURNAL]) renderJournal();
  if (changes[KEY_SOURCES]) {
    sources = changes[KEY_SOURCES].newValue || {};
    revenues = recovered(sourcesAtOpen, sources);
    render();
  }
});

boot();
