/* La page Historique : ce qui est passe, pris ou rate.
 *
 * Elle LIT, elle n'ecrit jamais. Les issues sont figees par le service worker
 * au moment ou l'offre se termine (`watch/outcomes.js`), seule fenetre ou le
 * titre et la valeur existent encore -- le catalogue, lui, est purge a
 * quatre-vingt-dix jours.
 *
 * Le bilan du popup est un tableau de chasse. Ceci est la colonne d'a cote :
 * ce qui a ete manque, et ce que cela valait. C'est la seule qui apprenne
 * quelque chose, parce qu'un taux de capture qui s'effondre a toujours une
 * cause qu'on peut corriger.
 */
import { t, translateDocument, setLocale, intlLocale } from './i18n.js';
import { STORE_LABELS } from './watch/offer.js';
import { KEY_OUTCOMES, OUTCOMES } from './watch/outcomes.js';
import {
  byMonth, filterHistory, historyRows, summariseHistory,
} from './watch/history.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const KEY_UI = 'veille:ui';

let rows = [];

/* ------------------------------------------------------------------ outils */

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function whenText(ts) {
  const d = new Date(ts);
  const loc = intlLocale();
  return `${d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/** Le mois, ecrit dans la langue affichee -- la cle, elle, reste en AAAA-MM. */
function monthText(cle) {
  const [an, mois] = String(cle).split('-').map(Number);
  return new Date(Date.UTC(an, mois - 1, 1))
    .toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Le libelle et la couleur d'une issue. Les trois, jamais deux. */
function outcomeLabel(outcome) {
  if (outcome === OUTCOMES.TAKEN) return { text: t('historyTaken'), level: 'info' };
  if (outcome === OUTCOMES.MISSED) return { text: t('historyMissed'), level: 'warn' };
  return { text: t('historyUnknown'), level: 'error' };
}

function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * L'export, en CSV.
 *
 * Les champs sont entoures de guillemets et les guillemets internes doubles :
 * un titre de jeu contient des virgules bien plus souvent qu'on ne le croit,
 * et une seule ligne mal echappee decale toutes les colonnes du fichier.
 */
function toCsv(liste) {
  const champ = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lignes = [['date', 'titre', 'magasin', 'valeur', 'issue', 'verdict'].join(',')];

  for (const r of liste) {
    lignes.push([
      new Date(r.ts).toISOString(),
      r.title,
      r.store,
      r.worth,
      r.outcome,
      r.verdict,
    ].map(champ).join(','));
  }
  return lignes.join('\r\n');
}

/* ------------------------------------------------------------------ rendu */

function currentFilters() {
  return {
    outcome: document.getElementById('outcome').value || '',
    store: document.getElementById('store').value || '',
    query: document.getElementById('search').value || '',
  };
}

function render() {
  const visibles = filterHistory(rows, currentFilters());

  /* Les compteurs decrivent TOUT l'historique, pas la vue filtree : ils
     repondent a « comment ca se passe », pas a « qu'est-ce que je regarde ».
     Les faire suivre le filtre rendrait le taux de capture absurde des qu'on
     ne regarde que les offres ratees. */
  const total = summariseHistory(rows);
  document.getElementById('count-taken').textContent = String(total.taken);
  document.getElementById('count-missed').textContent = String(total.missed);
  document.getElementById('count-unknown').textContent = String(total.unknown);

  document.getElementById('rate').textContent = total.rate === null
    ? t('historyRateNone')
    : t('historyRate', String(total.rate), total.worthMissed.toFixed(2));

  const corps = document.getElementById('rows');
  const lot = document.createDocumentFragment();

  for (const r of visibles) {
    const tr = el('tr');
    tr.append(el('td', 'when', whenText(r.ts)));

    /* Le titre mene a la fiche quand l'URL a survecu au figement. Sans elle,
       du texte : un lien mort serait pire qu'une absence de lien. */
    const titre = el('td');
    if (r.url) {
      const a = el('a', null, r.title || r.id || '—');
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      titre.append(a);
    } else titre.textContent = r.title || r.id || '—';
    tr.append(titre);

    tr.append(el('td', null, STORE_LABELS[r.store] || r.store || '—'));
    tr.append(el('td', null, r.worth || '—'));

    const issue = outcomeLabel(r.outcome);
    const cell = el('td', issue.level, issue.text);
    /* Le verdict brut en infobulle : « needs_login » n'a rien a faire dans une
       colonne, et tout a faire a portee de souris le jour ou on cherche
       pourquoi une offre est passee a cote. */
    if (r.verdict) cell.title = r.verdict;
    tr.append(cell);

    lot.append(tr);
  }

  corps.textContent = '';
  corps.append(lot);

  const vide = document.getElementById('empty');
  vide.hidden = visibles.length > 0;
  vide.textContent = rows.length ? t('historyNoMatch') : t('historyEmpty');

  const mois = document.getElementById('months');
  const lotMois = document.createDocumentFragment();
  for (const m of byMonth(rows)) {
    const tr = el('tr');
    tr.append(el('td', null, monthText(m.month)));
    tr.append(el('td', 'info', String(m.taken)));
    tr.append(el('td', 'warn', String(m.missed)));
    lotMois.append(tr);
  }
  mois.textContent = '';
  mois.append(lotMois);
}

async function load() {
  const brut = await api.storage.local.get(KEY_OUTCOMES);
  rows = historyRows(brut[KEY_OUTCOMES]);
  render();
}

/* ------------------------------------------------------------------- setup */

async function boot() {
  const raw = await api.storage.local.get(KEY_UI);
  const ui = (raw && raw[KEY_UI]) || {};

  if (ui.language && ui.language !== 'auto') setLocale(ui.language);
  if (ui.theme && ui.theme !== 'system') document.documentElement.dataset.theme = ui.theme;

  translateDocument();
  document.title = t('historyTitle');

  /* La liste des magasins vient des DONNEES, pas d'une constante : un magasin
     qui n'a jamais rien laisse passer n'a pas a encombrer le filtre. */
  const choix = document.getElementById('store');
  const vus = [...new Set(rows.map((r) => r.store).filter(Boolean))].sort();
  for (const store of vus) {
    const option = el('option', null, STORE_LABELS[store] || store);
    option.value = store;
    choix.append(option);
  }

  render();
}

document.getElementById('search').addEventListener('input', render);
for (const id of ['outcome', 'store']) document.getElementById(id).addEventListener('change', render);
document.getElementById('refresh').addEventListener('click', load);
document.getElementById('download').addEventListener('click', () => {
  download(`historique-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', toCsv(rows));
});

api.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && changes[KEY_OUTCOMES]) load();
});

load().then(boot);
