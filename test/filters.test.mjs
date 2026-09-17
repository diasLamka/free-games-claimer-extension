/* Tests des filtres de reclamation.
 *
 * Ce module decide ce que l'extension a le droit de faire toute seule sur un
 * vrai compte. Chaque test correspond a une facon de se tromper qui coute
 * quelque chose a l'utilisateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_FILTERS,
  REASONS,
  readWorth,
  readCurrency,
  dominantCurrency,
  UNKNOWN_CURRENCY,
  isExtraContent,
  isKeepable,
  judge,
  split,
  preview,
} from '../watch/filters.js';
import { makeOffer, STORES } from '../watch/offer.js';
import * as gp from '../watch/sources/gamerpower.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(readFileSync(join(ICI, 'fixtures', 'gamerpower-giveaways.json'), 'utf8'));
const T = Date.UTC(2026, 7, 27, 10, 0, 0);

const SUPPORTES = [STORES.EPIC, STORES.GOG, STORES.AMAZON];
const opts = { supportedStores: SUPPORTES };

const offer = (extra = {}) => makeOffer({
  source: 'epic-api',
  store: STORES.EPIC,
  storeId: 'x',
  title: 'Jeu de test',
  url: 'https://store.epicgames.com/p/x',
  worth: '$14.99',
  category: 'Game',
  ...extra,
});

/* ------------------------------------------------------------------ valeur */

test('lireValeur lit les formes reellement observees', () => {
  // Toutes les valeurs de la capture sont de la forme "$X.YY".
  assert.equal(readWorth('$14.99'), 14.99);
  assert.equal(readWorth('$0.99'), 0.99);
  assert.equal(readWorth('$2.00'), 2);
  assert.equal(readWorth('$29.99'), 29.99);
  assert.equal(readWorth(9.99), 9.99);
});

test('lireValeur tolere une autre devise et l\'autre separateur decimal', () => {
  assert.equal(readWorth('9,99 €'), 9.99);
  assert.equal(readWorth('€9.99'), 9.99);
  assert.equal(readWorth('$1,299.99'), 1299.99);
  assert.equal(readWorth('1.299,99 €'), 1299.99);
});

test('lireValeur rend null plutot que zero sur ce qu\'elle ne sait pas lire', () => {
  // Zero voudrait dire « gratuit a l'origine » : c'est faux, et cela ferait
  // passer le seuil a une offre dont on ignore la valeur.
  assert.equal(readWorth('N/A'), null);
  assert.equal(readWorth(''), null);
  assert.equal(readWorth(null), null);
  assert.equal(readWorth(undefined), null);
  assert.equal(readWorth('gratuit'), null);
  assert.equal(readWorth(NaN), null);
});

/* -------------------------------------------------------------- categorie */

test('estContenuAdditionnel suit le champ de la source en priorite', () => {
  // ?type=game rend "Game", ?type=loot rend "DLC" : la source est explicite.
  assert.equal(isExtraContent(offer({ category: 'Game' })), false);
  assert.equal(isExtraContent(offer({ category: 'DLC' })), true);
  assert.equal(isExtraContent(offer({ category: 'Early Access' })), true);
});

test('estContenuAdditionnel retombe sur le titre quand la source se tait', () => {
  assert.equal(isExtraContent(offer({ category: null, title: 'Albion Online: Epic Mage Bundle' })), true);
  assert.equal(isExtraContent(offer({ category: null, title: 'Pack de Mage Épique' })), true);
  assert.equal(isExtraContent(offer({ category: null, title: 'Cardpocalypse' })), false);
  assert.equal(isExtraContent(null), false);
});

/* ------------------------------------------------------- refus explicites */

test('une offre sans page a ouvrir n\'est jamais reclamable', () => {
  const r = judge(makeOffer({ store: STORES.EPIC, title: 'X' }), {}, opts);
  assert.equal(r.claimable, false);
  assert.equal(r.reason, REASONS.NO_DESTINATION);
  assert.equal(judge(null, {}, opts).reason, REASONS.NO_DESTINATION);
});

test('un magasin sans module de reclamation est ecarte, pas ignore', () => {
  // L'offre reste au catalogue et reste notifiee : elle n'est simplement pas
  // reclamee toute seule.
  const r = judge(offer({ store: STORES.ITCHIO }), {}, opts);
  assert.equal(r.claimable, false);
  assert.equal(r.reason, REASONS.STORE_UNSUPPORTED);
});

test('un magasin non identifie est ecarte avec son propre motif', () => {
  const r = judge(offer({ store: STORES.UNKNOWN }), {}, opts);
  assert.equal(r.reason, REASONS.STORE_UNKNOWN);
});

test('un magasin desactive dans les reglages se distingue d\'un magasin non supporte', () => {
  const r = judge(offer({ store: STORES.GOG }), { allowedStores: [STORES.EPIC] }, opts);
  assert.equal(r.claimable, false);
  assert.equal(r.reason, REASONS.STORE_DISABLED);
});

/* ------------------------------------------------------------------ seuil */

test('le seuil de valeur ecarte ce qui est en dessous, et rien d\'autre', () => {
  const filters = { minWorth: 5 };
  assert.equal(judge(offer({ worth: '$4.99' }), filters, opts).reason, REASONS.BELOW_THRESHOLD);
  assert.equal(judge(offer({ worth: '$5.00' }), filters, opts).claimable, true);
  assert.equal(judge(offer({ worth: '$14.99' }), filters, opts).claimable, true);
});

test('par defaut aucun seuil ne s\'applique', () => {
  // Les valeurs par defaut ne suppriment rien : c'est a l'utilisateur de
  // decider de sacrifier des offres.
  assert.equal(DEFAULT_FILTERS.minWorth, 0);
  assert.equal(judge(offer({ worth: '$0.99' }), {}, opts).claimable, true);
});

test('une valeur inconnue est reclamee par defaut, et refusable sur demande', () => {
  assert.equal(judge(offer({ worth: 'N/A' }), {}, opts).claimable, true);
  assert.equal(
    judge(offer({ worth: 'N/A' }), { claimWithoutWorth: false }, opts).reason,
    REASONS.NO_WORTH,
  );
});

test('une valeur inconnue ne se fait pas ecarter par le seuil', () => {
  // Le piege : lire « valeur inconnue » comme zero la ferait tomber sous
  // n'importe quel seuil, et on perdrait des offres sans savoir pourquoi.
  const r = judge(offer({ worth: 'N/A' }), { minWorth: 10 }, opts);
  assert.equal(r.claimable, true);
});

/* ---------------------------------------------------- contenu additionnel */

test('le contenu additionnel est ecarte par defaut', () => {
  // ?type=loot rend 82 offres de DLC contre 20 jeux : sans ce defaut, la
  // bibliotheque se remplit de cosmetiques.
  assert.equal(judge(offer({ category: 'DLC' }), {}, opts).reason, REASONS.EXTRA_CONTENT);
  assert.equal(
    judge(offer({ category: 'DLC' }), { claimExtraContent: true }, opts).claimable,
    true,
  );
});

/* ------------------------------------------------------------ liste noire */

test('un titre exclu l\'est quelle que soit sa graphie', () => {
  const filters = { excludedTitles: ['Albion Online'] };
  assert.equal(judge(offer({ title: 'Albion Online: Epic Mage Bundle', category: 'Game' }), filters, opts).reason, REASONS.TITLE_EXCLUDED);
  assert.equal(judge(offer({ title: 'ALBION ONLINE', category: 'Game' }), filters, opts).reason, REASONS.TITLE_EXCLUDED);
  assert.equal(judge(offer({ title: 'Cardpocalypse' }), filters, opts).claimable, true);
});

test('une liste noire vide n\'exclut rien', () => {
  assert.equal(judge(offer(), { excludedTitles: [] }, opts).claimable, true);
  assert.equal(judge(offer(), { excludedTitles: ['', '   '] }, opts).claimable, true);
});

/* ------------------------------------------------------- sur des vraies donnees */

test('sur la capture reelle, le partage est complet et motive', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);
  const { claimableCount, dropped } = split(offers, {}, opts);

  assert.equal(claimableCount.length + dropped.length, offers.length, 'des offres ont disparu');
  for (const e of dropped) {
    assert.ok(e.reason, `ecart sans motif : "${e.offer.title}"`);
    assert.ok(Object.values(REASONS).includes(e.reason), `motif inconnu : ${e.reason}`);
  }
});

test('sur la capture reelle, seules les offres Epic sont reclamables aujourd\'hui', () => {
  // itch.io, IndieGala et Steam n'ont pas encore de module : elles doivent
  // toutes tomber dans « aucun module de reclamation », pas ailleurs.
  const { offers } = gp.mapResponse(CAPTURE, T);
  const { claimableCount } = split(offers, {}, opts);
  for (const o of claimableCount) assert.ok(SUPPORTES.includes(o.store));

  const { byReason } = preview(offers, {}, opts);
  assert.ok(byReason[REASONS.STORE_UNSUPPORTED] >= 1);
});

test('apercu compte sans rien reclamer, pour montrer l\'effet d\'un reglage', () => {
  const { offers } = gp.mapResponse(CAPTURE, T);

  const sansSeuil = preview(offers, {}, opts);
  const avecSeuil = preview(offers, { minWorth: 100 }, opts);

  assert.ok(avecSeuil.claimableCount <= sansSeuil.claimableCount,
    'un seuil eleve devrait reduire le nombre de reclamables');
  assert.equal(sansSeuil.claimableCount + sansSeuil.dropped, offers.length);
});

test('l\'ordre des refus est stable : la destination avant le magasin, le magasin avant la valeur', () => {
  // Un motif qui change selon un reglage sans rapport rendrait l'interface
  // incomprehensible.
  const sansUrl = makeOffer({ store: STORES.ITCHIO, title: 'X', worth: '$0.01', category: 'DLC' });
  assert.equal(judge(sansUrl, { minWorth: 99 }, opts).reason, REASONS.NO_DESTINATION);

  const mauvaisMagasin = offer({ store: STORES.ITCHIO, worth: '$0.01', category: 'DLC' });
  assert.equal(judge(mauvaisMagasin, { minWorth: 99 }, opts).reason, REASONS.STORE_UNSUPPORTED);

  const dlc = offer({ category: 'DLC', worth: '$0.01' });
  assert.equal(judge(dlc, { minWorth: 99 }, opts).reason, REASONS.EXTRA_CONTENT);
});

/* ------------------------------------------------------------- a garder ? */

test('isKeepable croit la source avant de deduire du prix', () => {
  // Le champ de la source a le dernier mot : Epic sait, par construction, si le
  // prix d'origine etait superieur a zero.
  assert.equal(isKeepable(offer({ keepable: false, worth: '$39.99' })), false);
  assert.equal(isKeepable(offer({ keepable: true, worth: null })), true);
});

test('isKeepable deduit du prix quand la source ne dit rien', () => {
  assert.equal(isKeepable(offer({ worth: '$39.99' })), true);
  assert.equal(isKeepable(offer({ worth: '$0.00' })), false);
  // « N/A » n'est pas zero : c'est l'absence d'information.
  assert.equal(isKeepable(offer({ worth: 'N/A' })), null);
  assert.equal(isKeepable(offer({ worth: null })), null);
});

test('un titre gratuit en permanence n\'est pas reclame', () => {
  const permanent = offer({ keepable: false, worth: null });
  assert.equal(judge(permanent, {}, opts).claimable, false);
  assert.equal(judge(permanent, {}, opts).reason, REASONS.NOTHING_TO_KEEP);
});

test('« on ne sait pas » laisse passer : l\'ignorance n\'est pas un refus', () => {
  // Traiter null comme false ferait rater de vrais jeux offerts par les sources
  // qui ne publient pas de prix.
  const inconnu = offer({ keepable: null, worth: 'N/A' });
  assert.equal(judge(inconnu, {}, opts).claimable, true);
});

test('le reglage peut etre coupe, et alors le permanent repasse', () => {
  const permanent = offer({ keepable: false, worth: '$0.00' });
  assert.equal(judge(permanent, { claimOnlyKeepable: false }, opts).claimable, true);
});

test('le filtre « a garder » passe avant le seuil de valeur', () => {
  // Un fait sur l'offre l'emporte sur une preference : un titre gratuit en
  // permanence n'a rien a prendre, quel que soit le seuil.
  const permanent = offer({ keepable: false, worth: '$0.00' });
  assert.equal(judge(permanent, { minWorth: 99 }, opts).reason, REASONS.NOTHING_TO_KEEP);
});

test('le defaut est actif : c\'est le seul defaut qui supprime des offres', () => {
  assert.equal(DEFAULT_FILTERS.claimOnlyKeepable, true);
  // Et il ne supprime rien qu'on puisse gagner.
  assert.equal(judge(offer({ keepable: true }), {}, opts).claimable, true);
});

/* --------------------------------------------------------------- devises */

test('la devise est lue dans le montant, sans jamais etre supposee', () => {
  // Le cas qui a motive tout ceci : Epic publie le prix du COMPTE. Sur un
  // compte francais, un $ pose devant fait lire des dollars la ou il y a des
  // euros -- et personne ne peut s'en apercevoir sur le chiffre seul.
  assert.equal(readCurrency('23,99 \u20AC'), 'EUR');
  assert.equal(readCurrency('$14.99'), 'USD');
  assert.equal(readCurrency('\u00A31.50'), 'GBP');
  assert.equal(readCurrency('1 299,00 EUR'), 'EUR');
});

test('les marques qui se terminent par $ passent avant le dollar nu', () => {
  // « R$ 29,90 » lu en dollars, c'est un facteur cinq sur le bilan.
  assert.equal(readCurrency('R$ 29,90'), 'BRL');
  assert.equal(readCurrency('CA$ 19.99'), 'CAD');
  assert.equal(readCurrency('A$ 19.99'), 'AUD');
  assert.equal(readCurrency('MX$ 199'), 'MXN');
});

test('une devise illisible rend null plutot qu\'une devise inventee', () => {
  assert.equal(readCurrency('19.99'), null);
  assert.equal(readCurrency('N/A'), null);
  assert.equal(readCurrency(''), null);
  assert.equal(readCurrency(null), null);
  assert.equal(readCurrency(19.99), null, 'un nombre nu ne porte aucune devise');
});

test('la devise dominante sert a libeller le seuil', () => {
  const lot = [
    { worth: '23,99 \u20AC' },
    { worth: '9,99 \u20AC' },
    { worth: '$14.99' },
    { worth: null },
  ];
  assert.equal(dominantCurrency(lot), 'EUR');
  assert.equal(dominantCurrency([]), null);
  assert.equal(dominantCurrency([{ worth: '19.99' }]), null, 'aucune devise lisible, aucune dominante');
});

test('le marqueur d\'inconnu est distinct de toute devise reelle', () => {
  assert.equal(UNKNOWN_CURRENCY, '?');
  assert.equal(readCurrency(UNKNOWN_CURRENCY), null);
});
