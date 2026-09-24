/* La connaissance de l'extension sort du popup.
 *
 * Sur la fiche d'un jeu, l'extension ne disait rien. C'est pourtant la qu'on se
 * demande si on l'a deja, et depuis quand.
 *
 * Ce module repond a la question. Il n'affiche rien : il rend des FAITS, et la
 * page choisit ce qu'elle en montre. Melanger les deux empecherait de tester ce
 * qu'on sait sans monter un document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { FACTS, lookup } from '../watch/lookup.js';
import { normaliseTitle } from '../watch/offer.js';
import { OUTCOMES } from '../watch/outcomes.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const JOUR = 86400000;

const base = { normalise: normaliseTitle, now: T };

/* --------------------------------------------------------------- possede */

test('le jeu possede se dit, avec ses magasins', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    collection: {
      'gog:1207': { store: 'gog', id: '1207', title: 'Tyranny' },
      'epic:tyranny': { store: 'epic', id: 'tyranny', title: 'Tyranny' },
    },
  });

  assert.deepEqual(f, [{ kind: FACTS.OWNED, stores: ['epic', 'gog'] }]);
});

test('le rapprochement tient malgre la casse et la ponctuation', () => {
  /* Les quatre magasins n'ecrivent pas les titres pareil. La normalisation est
     celle du modele d'offre, la seule avec laquelle ils se recoupent. */
  const f = lookup({
    ...base,
    title: 'HOLLOW KNIGHT: SILKSONG',
    collection: { 'gog:hk': { store: 'gog', id: 'hk', title: 'Hollow Knight Silksong' } },
  });

  assert.equal(f[0].kind, FACTS.OWNED);
});

/* ------------------------------------------------------------ offert maintenant */

test('une offre en cours sur un AUTRE magasin est dite', () => {
  /* C'est precisement ce qu'on ne peut pas voir soi-meme en regardant une
     fiche Steam : que le meme jeu est gratuit chez GOG aujourd'hui. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    store: 'steam',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: T + JOUR, url: 'https://www.gog.com/x' } },
  });

  assert.equal(f[0].kind, FACTS.FREE_NOW);
  assert.equal(f[0].store, 'gog');
  assert.equal(f[0].url, 'https://www.gog.com/x');
});

test('une offre terminee ne se dit pas comme une offre en cours', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: T - JOUR } },
  });

  assert.deepEqual(f, []);
});

test('une offre sans date de fin reste une offre en cours', () => {
  /* Huit offres sur vingt n'ont pas de date chez l'agregateur. Les taire
     serait pire que les annoncer -- meme regle que l'annonce. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: { 'gog:t': { title: 'Tyranny', store: 'gog', end: null } },
  });

  assert.equal(f[0].kind, FACTS.FREE_NOW);
});

/* ---------------------------------------------------------------- reclame */

test('une acquisition par l\'extension se dit, avec sa date', () => {
  /* La date vient du registre, qui n'est JAMAIS purge -- contrairement au
     catalogue, vide a quatre-vingt-dix jours. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    library: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T - 300 * JOUR } },
  });

  assert.equal(f[0].kind, FACTS.CLAIMED);
  assert.equal(f[0].ts, T - 300 * JOUR);
});

/* ------------------------------------------------------------------ rate */

test('un jeu deja passe en offre et rate se dit', () => {
  /* Le seul fait qui puisse changer une decision d'ACHAT : ce jeu a deja ete
     offert, il peut l'etre encore. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    outcomes: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T - 60 * JOUR, outcome: OUTCOMES.MISSED } },
  });

  assert.equal(f[0].kind, FACTS.MISSED);
});

test('un jeu passe en offre et PRIS ne se dit pas comme rate', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    outcomes: { 'gog:t': { title: 'Tyranny', store: 'gog', ts: T, outcome: OUTCOMES.TAKEN } },
  });

  assert.deepEqual(f, []);
});

/* --------------------------------------------------------- rien a dire */

test('un titre inconnu ne produit aucun fait', () => {
  /* Le cas de l'immense majorite des fiches. La surcouche ne doit alors rien
     afficher du tout : un bandeau vide sur chaque page de magasin serait une
     nuisance permanente. */
  assert.deepEqual(lookup({ ...base, title: 'Un jeu jamais vu' }), []);
});

test('un titre vide ne produit aucun fait', () => {
  assert.deepEqual(lookup({ ...base, title: '' }), []);
  assert.deepEqual(lookup({ ...base, title: null }), []);
});

/* ------------------------------------------------------------ dedoublonnage */

test('le meme fait n\'est jamais dit deux fois', () => {
  /* Le catalogue porte la meme offre sous deux cles, forte et faible. Afficher
     deux fois « offert sur GOG » ferait douter de tout le reste. */
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: {
      'gog:1207': { title: 'Tyranny', store: 'gog', end: T + JOUR },
      'gog:tyranny': { title: 'Tyranny', store: 'gog', end: T + JOUR },
    },
  });

  assert.equal(f.length, 1);
});

test('deux magasins differents restent deux faits', () => {
  const f = lookup({
    ...base,
    title: 'Tyranny',
    catalog: {
      a: { title: 'Tyranny', store: 'gog', end: T + JOUR },
      b: { title: 'Tyranny', store: 'epic', end: T + JOUR },
    },
  });

  assert.equal(f.length, 2);
});

/* ------------------------------------------------------- les obligations */

test('la normalisation et l\'instant sont obligatoires', () => {
  /* Meme regle que partout ailleurs dans la veille : un module pur ne fait
     entrer ni l'horloge ni une comparaison approximative par la fenetre. */
  assert.throws(() => lookup({ title: 'x', now: T }), TypeError);
  assert.throws(() => lookup({ title: 'x', normalise: normaliseTitle }), TypeError);
});

/* ------------------------------------------ les phrases traduites (2.50.0) */

import { factLines } from '../watch/lookup.js';

test('les phrases de la surcouche viennent de la table, avec les noms de magasins', () => {
  const vus = [];
  const t = (cle, ...args) => { vus.push(cle); return `${cle}(${args.join('|')})`; };
  const lignes = factLines([
    { kind: FACTS.OWNED, stores: ['gog', 'steam'] },
    { kind: FACTS.FREE_NOW, store: 'epic', end: 1000 },
    { kind: FACTS.FREE_NOW, store: 'epic', end: null },
    { kind: FACTS.CLAIMED, ts: 2000 },
    { kind: FACTS.RECURRING, count: 3 },
    { kind: FACTS.MISSED, ts: null },
    { kind: 'inconnu' },
  ], { t, storeLabel: (s) => s.toUpperCase(), dateText: (ts) => `J${ts}` });

  assert.deepEqual(lignes, [
    'overlayOwned(GOG, STEAM)',
    'overlayFreeNowUntil(EPIC|J1000)',
    'overlayFreeNow(EPIC)',
    'overlayClaimedOn(J2000)',
    'overlayRecurring(3)',
    'overlayMissed()',
  ], 'un fait inconnu ne produit pas de phrase vide');
});

/* ------------------------------------------------------------ le panneau de la page (2.62.0) */

import { delayText, urgency, freeNowList, pageGame, launcherOffer } from '../watch/lookup.js';

const tt = (k, ...a) => `${k}(${a.join(',')})`;
const MAINTENANT = Date.parse('2026-09-24T08:00:00Z');
const H = 3600000;
const cat = {
  'steam:4355480': { title: 'Dying Light: The Beast - Discharge Weapon Pack', store: 'steam', source: 'steam', category: 'DLC', state: 'discovered',
    end: MAINTENANT + 6 * H, image: 'https://shared.akamai.steamstatic.com/h.jpg', url: 'https://store.steampowered.com/app/4355480/' },
  'epic:mindcop': { title: 'Mindcop', store: 'epic', category: 'Game', state: 'confirmed', end: MAINTENANT + 7 * H, image: 'https://cdn1.epicgames.com/m.jpg', url: 'https://store.epicgames.com/p/mindcop' },
  'epic-mobile:mindcop': { title: 'Mindcop', store: 'epic-mobile', category: 'game', state: 'discovered', end: MAINTENANT + 7 * H },
  'gog:vieux': { title: 'Vieux', store: 'gog', state: 'expired', end: MAINTENANT - H },
  'gog:fini': { title: 'Fini', store: 'gog', state: 'discovered', end: MAINTENANT - 1 },
  'steam:pris': { title: 'Pris', store: 'steam', state: 'resolved', end: MAINTENANT + H },
  'itchio:x': { title: 'Itch', store: 'itchio', state: 'discovered', end: null },
  'epic:refuse': { title: 'Refuse', store: 'epic', state: 'discovered', end: MAINTENANT + 2 * H },
  'epic:possede': { title: 'Possede', store: 'epic', state: 'discovered', end: null, alreadyOwned: true, url: 'javascript:alert(1)' },
};

test('le temps qui reste, dans les unites du popup ; l\'urgence, avec ses seuils', () => {
  assert.equal(delayText(6 * H + 4 * 60000, tt), 'durationHoursMinutes(6,04)');
  assert.equal(delayText(26 * H, tt), 'durationDaysHours(1,2)');
  assert.equal(delayText(12 * 60000, tt), 'durationMinutes(12)');
  assert.equal(delayText(-5, tt), 'durationMinutes(0)');
  assert.equal(urgency(MAINTENANT + 6 * H, MAINTENANT), 'hot');
  assert.equal(urgency(MAINTENANT + 50 * H, MAINTENANT), 'warm');
  assert.equal(urgency(MAINTENANT + 100 * H, MAINTENANT), 'calm');
  assert.equal(urgency(null, MAINTENANT), 'unknown');
});

test('gratuit en ce moment : les offres du popup, la fin la plus proche d\'abord', () => {
  const l = freeNowList(cat, {
    now: MAINTENANT, t: tt, storeLabel: (s) => s.toUpperCase(),
    watched: ['epic', 'gog', 'steam', 'epic-mobile'], dismissed: ['epic:refuse'], hideOwned: true,
  });
  assert.equal(l.total, 3, 'ni terminees, ni prises, ni refusees, ni cachees, ni hors des magasins suivis');
  assert.deepEqual(l.offers.map((o) => [o.title, o.store]), [
    ['Dying Light: The Beast - Discharge Weapon Pack', 'steam'], ['Mindcop', 'epic'], ['Mindcop', 'epic-mobile'],
  ]);
  assert.equal(l.offers[0].dlc, true);
  assert.equal(l.offers[0].left, 'durationHoursMinutes(6,00)');
  assert.equal(l.offers[0].storeLabel, 'STEAM');
  assert.equal(freeNowList(cat, { now: MAINTENANT, t: tt, limit: 1 }).offers.length, 1);
  // Sans magasins suivis ni preferences : toutes les offres vivantes, une fin inconnue en dernier.
  const tout = freeNowList(cat, { now: MAINTENANT, t: tt, limit: 20 });
  assert.equal(tout.total, 6);
  assert.equal(tout.offers.at(-1).end, null);
});

test('une offre du panneau : rien qu\'une adresse https ne sort, une fin inconnue le dit', () => {
  const o = launcherOffer(cat['epic:possede'], { now: MAINTENANT, t: tt });
  assert.equal(o.url, null);
  assert.equal(o.left, 'noEndDate()');
  assert.equal(o.urgency, 'unknown');
});

test('le jeu de la page : l\'offre au meme titre, celle du magasin de la page d\'abord', () => {
  const opts = { normalise: normaliseTitle, now: MAINTENANT, t: tt, storeLabel: (s) => s };
  assert.equal(pageGame(cat, { ...opts, title: 'Mindcop', store: 'epic-mobile' }).store, 'epic-mobile');
  assert.equal(pageGame(cat, { ...opts, title: 'Mindcop', store: 'steam' }).store, 'epic', 'ailleurs : la premiere');
  assert.equal(pageGame(cat, { ...opts, title: 'Fini', store: 'gog' }), null, 'une offre terminee ne fait pas de carte');
  assert.equal(pageGame(cat, { ...opts, title: '', store: 'gog' }), null);
});

test('les modeles du lanceur gardent leurs trous : il les remplit lui-meme', async () => {
  const { launcherLabels } = await import('../watch/lookup.js');
  const { t, setLocale } = await import('../lib/i18n.js');
  setLocale('fr');
  try {
    const l = launcherLabels(t);
    assert.equal(l.freeLeft, 'Gratuit sur $1 · encore $2');
    assert.equal(l.freeNoEnd, 'Gratuit sur $1 · fin inconnue');
    assert.equal(l.seeAll, 'Tout voir');
  } finally { setLocale(null); }
});
