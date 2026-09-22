/* « Deja recupere » devait dire la verite, sur n'importe quel ordinateur.
 *
 * Trois defauts vus sur une vraie installation, le 2026-09-22 :
 *
 *   - onze lignes « Amazon Luna — recupere » : des offres Luna deja prises,
 *     constatees sur la liste, ecrites sans titre et sous le statut d'une
 *     reclamation. Le popup n'avait ni nom a montrer, ni moyen de savoir que
 *     l'extension n'avait rien fait ;
 *   - « Card:Wall World 2 Recuperer L... » : une carte sans lien, rangee sous
 *     son texte -- libelle du bouton compris ;
 *   - sur un ordinateur neuf, ou apres une remise a zero, un jeu deja pris
 *     pouvait finir en echec : la fiche Epic rendait « Dans la bibliotheque »
 *     apres le seul controle qui le cherchait, et une fiche deja traitee
 *     n'ecrivait rien, ce que le mode pilote lisait comme un delai depasse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';
import { integrateHistory, ownedKeys } from '../watch/library.js';
import { normaliseTitle } from '../watch/offer.js';

const LUNA = 'Amazon Luna';
const EPIC = 'Epic Games';
const ACTIONS = 'button, a, div[role="button"], span[role="button"]';

/** Les objets du contexte vm n'ont pas le prototype du test : on compare leur JSON. */
const plain = (v) => JSON.parse(JSON.stringify(v));

function history(gmStore, platform) {
  return JSON.parse(gmStore.get('FGC_history_' + platform) || '{}');
}

/* ------------------------------------------------------ le titre est note */

test('une entree d\'historique garde le titre du jeu', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  fgc.saveHistoryEntry(LUNA, 'offer:amzn1.pg.item.abc', 'claimed', 'ALREADY_CLAIMED', '  Wall   World 2 ');

  const e = history(gmStore, LUNA)['offer:amzn1.pg.item.abc'];
  assert.equal(e.title, 'Wall World 2');
  assert.equal(e.status, 'claimed');
  assert.equal(e.reason, 'ALREADY_CLAIMED');
});

test('une ecriture sans titre ne fait pas oublier celui deja note', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  fgc.saveHistoryEntry(LUNA, 'offer:x', 'needs_link', 'GOG', 'Mindcop');
  fgc.saveHistoryEntry(LUNA, 'offer:x', 'claimed', 'GOG');
  assert.equal(history(gmStore, LUNA)['offer:x'].title, 'Mindcop');

  fgc.recordLunaFailure('x', 'bouton introuvable');
  const e = history(gmStore, LUNA)['offer:x'];
  assert.equal(e.status, 'failed');
  assert.equal(e.title, 'Mindcop');
});

test('sans titre connu, l\'entree n\'en invente pas', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  fgc.saveHistoryEntry(LUNA, 'offer:y', 'claimed', 'Amazon Games', '   ');
  assert.equal('title' in history(gmStore, LUNA)['offer:y'], false);
});

/* ---------------------------------------- les anciennes entrees se nomment */

test('une entree sans titre recoit le sien sans changer de date ni de statut', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  const ancienne = { status: 'claimed', reason: 'deja marque comme recupere sur la liste', ts: 1790000000000 };
  gmStore.set('FGC_history_' + LUNA, JSON.stringify({ 'offer:a': ancienne, 'offer:b': { ...ancienne, title: 'Deja nomme' } }));

  const changed = fgc.rememberHistoryTitles(LUNA, { 'offer:a': 'Shogun Showdown', 'offer:b': 'Autre nom', 'offer:absente': 'X' });

  assert.equal(changed, true);
  const h = history(gmStore, LUNA);
  // La date est ce que le mode pilote et le registre lisent pour reperer une
  // nouveaute : la toucher ferait passer une etiquette pour une reclamation.
  assert.equal(h['offer:a'].ts, ancienne.ts);
  assert.equal(h['offer:a'].status, 'claimed');
  assert.equal(h['offer:a'].title, 'Shogun Showdown');
  assert.equal(h['offer:b'].title, 'Deja nomme', 'un titre deja note n\'est pas ecrase');
  assert.equal('offer:absente' in h, false, 'aucune entree n\'est creee');
});

test('rien a completer, rien d\'ecrit', () => {
  const { fgc, gmStore } = loadEngine({ hostname: 'luna.amazon.fr' });
  gmStore.set('FGC_history_' + LUNA, JSON.stringify({ 'offer:a': { status: 'claimed', reason: '', ts: 1, title: 'A' } }));
  let writes = 0;
  const set = gmStore.set.bind(gmStore);
  gmStore.set = (k, v) => { writes++; return set(k, v); };

  assert.equal(fgc.rememberHistoryTitles(LUNA, { 'offer:a': 'B' }), false);
  assert.equal(writes, 0);
});

/* ------------------------------------------ une carte sans lien a un nom */

test('la cle d\'une carte sans lien ne depend pas du libelle de son bouton', () => {
  const { fgc } = loadEngine({ hostname: 'luna.amazon.fr' });
  const avant = fgc.lunaCardKey('Wall World 2', 'Wall World 2 Récupérer le jeu');
  const apres = fgc.lunaCardKey('Wall World 2', 'Wall World 2 Récupéré');

  assert.equal(avant, apres);
  assert.equal(avant, 'card:wall-world-2');
});

test('la cle d\'une carte ignore accents et ponctuation', () => {
  const { fgc } = loadEngine({ hostname: 'luna.amazon.fr' });
  assert.equal(fgc.lunaCardKey('Été : Édition Deluxe!', ''), 'card:ete-edition-deluxe');
  assert.equal(fgc.lunaCardKey(null, ''), 'card:sans-titre');
});

/* ------------------------------ une fiche deja traitee rend un verdict */

test('une fiche Epic deja prise rend « deja recupere », pas un delai depasse', () => {
  const { fgc } = loadEngine({ pathname: '/p/mindcop-78e6c1' });
  fgc.saveHistoryEntry(EPIC, 'slug:mindcop-78e6c1', 'claimed', 'CLAIMED', 'Mindcop');

  const found = plain(fgc.standingEntry(EPIC, 'https://store.epicgames.com/p/mindcop-78e6c1?lang=fr'));
  assert.deepEqual(found, { key: 'slug:mindcop-78e6c1', statusLine: 'claimed', reasonText: 'ALREADY_CLAIMED' });
});

test('une fiche Luna deja prise rend son entree', () => {
  const { fgc } = loadEngine({ hostname: 'luna.amazon.fr' });
  fgc.saveHistoryEntry(LUNA, 'offer:amzn1.pg.item.1c490f2e-c698', 'code_copied', 'Legacy Games', 'Jeu');

  const found = plain(fgc.standingEntry(LUNA, 'https://luna.amazon.fr/claims/jeu-legacy/dp/amzn1.pg.item.1c490f2e-c698?ref=x'));
  assert.equal(found.key, 'offer:amzn1.pg.item.1c490f2e-c698');
  assert.equal(found.statusLine, 'code_copied');
  // Hors reclamation, le motif d'origine est garde : il dit ou coller le code.
  assert.equal(found.reasonText, 'Legacy Games');
});

test('ni une fiche inconnue, ni un echec, ni une page sans jeu ne rendent de verdict', () => {
  const { fgc } = loadEngine({ pathname: '/free-games' });
  fgc.saveHistoryEntry(EPIC, 'slug:rate', 'failed', 'bouton introuvable');

  assert.equal(fgc.standingEntry(EPIC, 'https://store.epicgames.com/p/inconnu'), null);
  assert.equal(fgc.standingEntry(EPIC, 'https://store.epicgames.com/p/rate'), null);
  assert.equal(fgc.standingEntry(EPIC, 'https://store.epicgames.com/free-games'), null);
  assert.equal(fgc.standingEntry('GOG', 'https://www.gog.com/fr/game/x'), null);
});

/* ----------------------- « Dans la bibliotheque » rendu apres le chargement */

function ownedButton() {
  return {
    textContent: 'Dans la bibliothèque',
    offsetWidth: 120,
    offsetHeight: 40,
    disabled: true,
    getClientRects: () => [1],
    getAttribute: () => null,
  };
}

/** Le bouton n'existe pas au premier regard, et apparait ensuite. */
function showOwnedLate(sandbox) {
  let looks = 0;
  sandbox.document.querySelectorAll = (sel) => {
    if (sel !== ACTIONS) return [];
    looks++;
    return looks > 1 ? [ownedButton()] : [];
  };
}

/* Les minuteries du moteur sont neutralisees : une attente qui ne trouve rien
   reste pendante. La course contre setImmediate la fait echouer tout de suite,
   au lieu de laisser le fichier bloque jusqu'a l'expiration du lanceur. */
const PENDING = Symbol('en attente');
function settleNow(promise) {
  return Promise.race([promise, new Promise((resolve) => setImmediate(() => resolve(PENDING)))]);
}

test('un jeu deja possede est reconnu meme si la fiche l\'affiche en retard', async () => {
  const { fgc, sandbox } = loadEngine({ pathname: '/p/shogun-showdown-61832d' });
  showOwnedLate(sandbox);

  const result = await settleNow(fgc.claimEpicGame(sandbox.document, 'Shogun Showdown', EPIC));
  assert.equal(result, 'ALREADY_OWNED');
});

test('hors fiche produit, un libelle croise ne vaut pas possession', async () => {
  const { fgc, sandbox } = loadEngine({ pathname: '/free-games' });
  showOwnedLate(sandbox);

  const result = await settleNow(fgc.claimEpicGame(sandbox.document, 'Shogun Showdown', EPIC));
  assert.equal(result, PENDING);
});

test('la fiche d\'ou part le clic ne prete pas sa possession au jeu suivant', async () => {
  /* Sur la fiche d'un jeu deja possede, le clic vers le suivant lance une
     navigation : tant qu'elle n'a pas eu lieu, « Dans la bibliotheque » est
     celui du jeu PRECEDENT. Le compter ferait noter pris un jeu jamais pris. */
  const { fgc, sandbox } = loadEngine({ pathname: '/p/mindcop-78e6c1' });
  showOwnedLate(sandbox);
  const lien = {
    textContent: 'Shogun Showdown', id: '', className: '', disabled: false,
    offsetWidth: 80, offsetHeight: 20, getClientRects: () => [{}], getAttribute: () => null,
    closest: () => null, scrollIntoView() {}, click() {}, dispatchEvent: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 20 }),
  };

  const result = await settleNow(fgc.claimEpicGame(lien, 'Shogun Showdown', EPIC));
  assert.equal(result, PENDING);
});

/* ------------------------------------------ le registre prend le titre */

test('le registre prend le titre note par le moteur quand le catalogue l\'ignore', () => {
  const added = [{
    key: 'offer:amzn1.pg.item.fe9fbd08',
    entry: { status: 'claimed', reason: 'ALREADY_CLAIMED', ts: 1790000000000, title: 'Wall World 2' },
  }];
  const { library, changed } = integrateHistory({}, { platform: LUNA, added, catalog: {} });

  assert.equal(changed, 1);
  assert.equal(library['amazon:amzn1.pg.item.fe9fbd08'].title, 'Wall World 2');
  // C'est ce qui permet au filtre de ne pas rouvrir d'onglet sur ce jeu.
  assert.ok(ownedKeys(library, normaliseTitle).has('amazon|' + normaliseTitle('Wall World 2')));
});

test('le catalogue garde la priorite sur le titre du moteur', () => {
  const added = [{ key: 'slug:cardpocalypse', entry: { status: 'claimed', reason: 'CLAIMED', ts: 1, title: 'Cardpocalypse' } }];
  const catalog = { 'epic:cardpocalypse': { title: 'Cardpocalypse Standard Edition' } };
  const { library } = integrateHistory({}, { platform: EPIC, added, catalog });
  assert.equal(library['epic:cardpocalypse'].title, 'Cardpocalypse Standard Edition');
});
