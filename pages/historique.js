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
import { installLinkLocalizer } from '../watch/localizer.js';
import { STORE_LABELS } from '../watch/offer.js';
import { KEY_OUTCOMES, OUTCOMES } from '../watch/outcomes.js';
import { KEY_LIBRARY } from '../watch/library.js';
import { KEY_RATES } from '../watch/rates.js';
import { worthLabel, sumWorths } from '../lib/money.js';
import { normaliseTitle, displayTitle } from '../watch/offer.js';
import { recurrenceIndex, recurring } from '../watch/recurrence.js';
import {
  filterHistory, groupByMonth, historyRows, summariseHistory,
} from '../watch/history.js';
import { KEY_COVERS, PER_RUN as COVERS_PER_RUN, coverFor, needsCover } from '../watch/covers.js';

const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
installLinkLocalizer(api, document);

const KEY_UI = 'veille:ui';

let rows = [];
let library = {};
/* Les jaquettes trouvees sur Steam (2.83.0, comme « Deja recupere »). */
let covers = {};
/* Les filtres en puces : '' veut dire tout. */
let filtreIssue = '';
let filtreMagasin = '';
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

/** Le libelle, le tampon et son mot pour une issue. Les trois, jamais deux. */
function outcomeLabel(outcome) {
  if (outcome === OUTCOMES.TAKEN) return { text: t('historyTaken'), stamp: 'ok', word: t('stampClaimed') };
  if (outcome === OUTCOMES.MISSED) return { text: t('historyMissed'), stamp: 'miss', word: t('stampMissed') };
  return { text: t('historyUnknown'), stamp: 'unknown', word: t('stampUnknown') };
}

const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

/* Les etiquettes de magasin du popup, pour que la page parle pareil. */
const TAGS = { epic: 'EPIC', 'epic-mobile': 'EPIC MOBILE', gog: 'GOG', amazon: 'LUNA', steam: 'STEAM' };

function storeTag(store) {
  const n = el('span', `store-tag ${store || ''}`, TAGS[store] || String(STORE_LABELS[store] || store || '—').toUpperCase());
  n.title = STORE_LABELS[store] || store || '';
  return n;
}

/** La jaquette : figee avec l'issue, sinon trouvee sur Steam, sinon l'initiale. */
function coverTile(src, title) {
  const box = el('span', 'cover');
  const lettre = () => el('span', 'letter', String(title || '?').trim().charAt(0).toUpperCase() || '?');
  if (!src) { box.append(lettre()); return box; }
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => { box.textContent = ''; box.append(lettre()); });
  box.append(img);
  return box;
}

/* Chaque titre n'est demande qu'une fois par ouverture de la page ; les
   suivants partent quand les premieres jaquettes sont arrivees. */
const DEMANDEES = new Set();

/** Une rangee de puces : « Tout », puis chaque valeur avec son compte. */
function chipRow(id, valeurs, active, libelle, choisir) {
  const hote = document.getElementById(id);
  for (const n of [...hote.querySelectorAll('.chip')]) n.remove();
  for (const [valeur, compte] of valeurs) {
    const b = el('button', 'chip');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(valeur === active));
    b.append(document.createTextNode(valeur ? libelle(valeur) : t('historyChipAll')));
    b.append(el('span', 'n', String(compte)));
    b.addEventListener('click', () => { choisir(valeur); render(); });
    hote.append(b);
  }
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
    outcome: filtreIssue,
    store: filtreMagasin,
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

  /* Les puces, avec leurs comptes sur TOUT l'historique -- comme les
     compteurs du haut : elles disent ce qu'il y a, pas ce qu'on regarde. */
  const parIssue = [OUTCOMES.TAKEN, OUTCOMES.MISSED, OUTCOMES.UNKNOWN]
    .map((o) => [o, rows.filter((r) => r.outcome === o).length]).filter(([, n]) => n > 0);
  chipRow('outcome-chips', [['', rows.length], ...parIssue], filtreIssue,
    (o) => cap(outcomeLabel(o).text), (v) => { filtreIssue = v; });
  const magasins = [...new Set(rows.map((r) => r.store).filter(Boolean))].sort();
  chipRow('store-chips', [['', rows.length], ...magasins.map((m) => [m, rows.filter((r) => r.store === m).length])],
    filtreMagasin, (m) => STORE_LABELS[m] || m, (v) => { filtreMagasin = v; });

  /* La liste, groupee par mois : l'en-tete porte les comptes du mois (ce
     que disait le tableau « Mois par mois »), sur la vue filtree. */
  const liste = document.getElementById('list');
  const lot = document.createDocumentFragment();
  const aDemander = [];

  for (const mois of groupByMonth(visibles)) {
    const bloc = el('section', 'month');
    const tete = el('h3', 'month-head', monthText(mois.month));
    const comptes = [[mois.taken, 'historyTaken'], [mois.missed, 'historyMissed'], [mois.unknown, 'historyUnknown']]
      .filter(([n]) => n > 0).map(([n, cle]) => `${t(cle)} ${n}`).join(' · ');
    tete.append(el('span', 'n', comptes));
    bloc.append(tete);

    const ul = el('ul', 'games');
    for (const r of mois.rows) {
      const nom = r.title ? displayTitle(r.title) : (r.id || '—');
      const li = el('li', 'game');

      const image = r.image || coverFor(covers, nom);
      if (!image && r.title && !DEMANDEES.has(nom) && needsCover(covers, nom, Date.now())) aDemander.push(nom);
      li.append(coverTile(image, nom));

      /* Le titre mene a la fiche quand l'URL a survecu au figement. Sans elle,
         du texte : un lien mort serait pire qu'une absence de lien. */
      const info = el('div', 'g-info');
      let titre;
      if (r.url) {
        titre = el('a', 'title', nom);
        titre.href = r.url;
        titre.target = '_blank';
        titre.rel = 'noreferrer';
      } else titre = el('span', 'title', nom);
      titre.title = nom;
      info.append(titre);

      const meta = el('div', 'meta');
      meta.append(storeTag(r.store));
      if (r.worth) {
        const shown = worthLabel(r.worth, rates, Date.now());
        const valeur = el('span', 'worth', shown.text);
        if (shown.title) valeur.title = shown.title;
        meta.append(valeur);
      }
      meta.append(el('span', 'when', whenText(r.ts)));
      info.append(meta);
      li.append(info);

      /* L'issue en tampon (2.97.0, comme le popup) ; ses mots, et le verdict
         brut, au survol : « needs_login » n'a rien a faire dans la liste, et
         tout a faire a portee de souris le jour ou on cherche pourquoi une
         offre est passee a cote. */
      const issue = outcomeLabel(r.outcome);
      const mots = cap(issue.text) + (r.verdict ? ` (${r.verdict})` : '');
      const tampon = el('span', `stamp ${issue.stamp}`, issue.word);
      tampon.title = mots;
      tampon.setAttribute('aria-label', mots);
      li.append(tampon);
      ul.append(li);
    }
    bloc.append(ul);
    lot.append(bloc);
  }

  liste.textContent = '';
  liste.append(lot);

  const vide = document.getElementById('empty');
  vide.hidden = visibles.length > 0;
  vide.textContent = rows.length ? t('historyNoMatch') : t('historyEmpty');

  /* Les jaquettes manquantes, par lots : le worker cherche, ecrit, et le
     changement de stockage redessine la page -- qui demande alors les
     suivantes. */
  const lotDemande = aDemander.slice(0, COVERS_PER_RUN);
  if (lotDemande.length) {
    for (const nom of lotDemande) DEMANDEES.add(nom);
    try { api.runtime.sendMessage({ type: 'fgc-covers', titles: lotDemande }, () => void api.runtime.lastError); } catch { /* worker endormi */ }
  }

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
  // Sans rien qui revienne, une phrase plutot qu'un tableau aux en-tetes vides.
  const aucun = !cible.children.length;
  document.getElementById('recurring-table').hidden = aucun;
  document.getElementById('recurring-none').hidden = !aucun;
}

async function load() {
  const brut = await api.storage.local.get([KEY_OUTCOMES, KEY_LIBRARY, KEY_RATES, KEY_COVERS]);
  rates = brut[KEY_RATES] || null;
  covers = brut[KEY_COVERS] || {};
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

  /* Les puces des magasins viennent des DONNEES, pas d'une constante : un
     magasin qui n'a jamais rien laisse passer n'a pas a encombrer le filtre
     (voir render). */
  render();
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('refresh').addEventListener('click', load);
document.getElementById('download').addEventListener('click', () => {
  download(`historique-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', toCsv(rows));
});

api.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && (changes[KEY_OUTCOMES] || changes[KEY_COVERS])) load();
});

load().then(boot);
