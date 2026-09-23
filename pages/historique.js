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
import { t, translateDocument, setLocale, intlLocale } from '../lib/i18n.js';
import { STORE_LABELS } from '../watch/offer.js';
import { KEY_OUTCOMES, OUTCOMES } from '../watch/outcomes.js';
import { KEY_LIBRARY } from '../watch/library.js';
import { KEY_RATES } from '../watch/rates.js';
import { worthLabel, sumWorths } from '../lib/money.js';
import { normaliseTitle, displayTitle } from '../watch/offer.js';
import { recurrenceIndex, recurring } from '../watch/recurrence.js';
import {
  byMonth, filterHistory, historyRows, summariseHistory,
} from '../watch/history.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const KEY_UI = 'veille:ui';

let rows = [];
let library = {};
/* Le taux du jour, pose par le cycle de veille. Sans lui, les montants restent
   dans leur devise d'origine. */
let rates = null;

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
    /* La valeur ratee est reprise ligne a ligne, convertie : summariseHistory
       additionne des nombres sans devise, et melangeait dollars et euros. */
    : t('historyRate', String(total.rate),
      sumWorths(rows.filter((r) => r.outcome === OUTCOMES.MISSED).map((r) => r.worth).filter(Boolean), rates, Date.now()));

  const corps = document.getElementById('rows');
  const lot = document.createDocumentFragment();

  for (const r of visibles) {
    const tr = el('tr');
    tr.append(el('td', 'when', whenText(r.ts)));

    /* Le titre mene a la fiche quand l'URL a survecu au figement. Sans elle,
       du texte : un lien mort serait pire qu'une absence de lien. */
    const titre = el('td');
    if (r.url) {
      const a = el('a', null, r.title ? displayTitle(r.title) : (r.id || '—'));
      a.href = r.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      titre.append(a);
    } else titre.textContent = r.title ? displayTitle(r.title) : (r.id || '—');
    tr.append(titre);

    tr.append(el('td', null, STORE_LABELS[r.store] || r.store || '—'));
    if (r.worth) {
      const shown = worthLabel(r.worth, rates, Date.now());
      const valeur = el('td', null, shown.text);
      if (shown.title) valeur.title = shown.title;
      tr.append(valeur);
    } else tr.append(el('td', null, '—'));

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

  /* Ce qui revient : le seul tableau de la page qui parle d'AVENIR. Les autres
     racontent ce qui s'est passe ; celui-ci dit ce qu'on peut attendre plutot
     qu'acheter. */
  const index = recurrenceIndex({
    outcomes: Object.fromEntries(rows.map((r, i) => [String(i), r])),
    library,
    normalise: normaliseTitle,
  });
  const cible = document.getElementById('recurring');
  const lotRevient = document.createDocumentFragment();

  for (const e of recurring(index).slice(0, 25)) {
    const tr = el('tr');
    tr.append(el('td', null, e.title));
    tr.append(el('td', 'info', String(e.count)));
    tr.append(el('td', 'when', e.passes[0].ts ? whenText(e.passes[0].ts) : '—'));
    lotRevient.append(tr);
  }
  cible.textContent = '';
  cible.append(lotRevient);
}

async function load() {
  const brut = await api.storage.local.get([KEY_OUTCOMES, KEY_LIBRARY, KEY_RATES]);
  rates = brut[KEY_RATES] || null;
  rows = historyRows(brut[KEY_OUTCOMES]);
  /* Le registre entre ici, et pas seulement les issues : il n'est JAMAIS
     purge, donc il porte seul les passages anterieurs a la 2.27.0. */
  library = brut[KEY_LIBRARY] || {};
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
