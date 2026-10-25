/* Une recuperation demandee ne rejoue pas la semaine (2.114.1).
 *
 * Signale le 2026-10-25 : un nouveau jeu Epic est offert, et l'extension reprend
 * la recuperation d'un ancien jeu, deja pris le jeudi, au lieu de ne prendre que
 * ce qui peut l'etre.
 *
 * Deux causes, deux regles :
 *   - le moteur effacait, sur un ordre force, l'entree "claimed" de TOUS les jeux
 *     gratuits de la semaine, alors qu'il n'en rouvre qu'un (celui de la fiche) :
 *     les autres redevenaient "non reclames" pour le passage suivant ;
 *   - « Tout recuperer » ne tenait pour rien le registre ni la memoire « deja a
 *     toi » : chaque jeu gratuit rouvrait son onglet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEngine } from './harness.mjs';
import { claimWhatCanBe } from '../watch/cycle.js';
import { claimAllNow } from '../watch/commands.js';
import { makeOffer } from '../watch/offer.js';
import { VERDICTS } from '../watch/claim.js';
import { fakeChrome } from './fake-chrome.mjs';

const EPIC = 'Epic Games';
const game = (slug, title = slug) => ({ slug, title });

/* ------------------------------------------------ le moteur : quoi revoir */

function historiqueDeLaSemaine(fgc) {
  fgc.saveHistoryEntry(EPIC, 'slug:home-19212a', 'claimed', 'CLAIMED', 'Home');
  fgc.saveHistoryEntry(EPIC, 'slug:sker-ritual-aac702', 'claimed', 'ALREADY_OWNED', 'Sker Ritual');
  return fgc.getHistory(EPIC);
}

test('sur la fiche d\'un jeu, l\'ordre force ne revoit que ce jeu', () => {
  const { fgc } = loadEngine({ pathname: '/p/sker-ritual-aac702' });
  const histoire = historiqueDeLaSemaine(fgc);
  const semaine = [game('home-19212a'), game('sker-ritual-aac702')];

  const aRevoir = fgc.epicGamesToRecheck(semaine, 'sker-ritual-aac702', histoire).map((g) => g.slug);
  assert.deepEqual(aRevoir, ['sker-ritual-aac702'], 'le jeu pris le jeudi garde son entree');
});

test('sur la fiche d\'un jeu pris pour de bon, l\'ordre force le revoit quand meme : un clic explicite repart de la page', () => {
  const { fgc } = loadEngine({ pathname: '/p/home-19212a' });
  const histoire = historiqueDeLaSemaine(fgc);
  const semaine = [game('home-19212a'), game('sker-ritual-aac702')];

  const aRevoir = fgc.epicGamesToRecheck(semaine, 'home-19212a', histoire).map((g) => g.slug);
  assert.deepEqual(aRevoir, ['home-19212a']);
});

test('sur la liste, une vraie reclamation n\'est pas rejouee, un « deja possede » se revoit', () => {
  const { fgc } = loadEngine({ pathname: '/free-games' });
  const histoire = historiqueDeLaSemaine(fgc);
  const semaine = [game('home-19212a'), game('sker-ritual-aac702'), game('nouveau-1a2b3c')];

  const aRevoir = fgc.epicGamesToRecheck(semaine, null, histoire).map((g) => g.slug);
  assert.deepEqual(aRevoir, ['sker-ritual-aac702'],
    'CLAIMED reste cru (le soin de la 2.99.7 non plus ne le touche pas) ; ALREADY_* a pu etre mal lu ; un jeu sans entree n\'a rien a effacer');
});

test('une fiche qui n\'est pas dans la liste de la semaine compte comme la liste', () => {
  const { fgc } = loadEngine({ pathname: '/p/autre-jeu' });
  const histoire = historiqueDeLaSemaine(fgc);
  const semaine = [game('home-19212a'), game('sker-ritual-aac702')];

  const aRevoir = fgc.epicGamesToRecheck(semaine, 'autre-jeu', histoire).map((g) => g.slug);
  assert.deepEqual(aRevoir, ['sker-ritual-aac702']);
});

test('seules les entrees "claimed" sont concernees : un echec ou un historique vide ne casse rien', () => {
  const { fgc } = loadEngine({ pathname: '/free-games' });
  fgc.saveHistoryEntry(EPIC, 'slug:rate', 'failed', 'bouton introuvable', 'Rate');
  const semaine = [game('rate'), game('jamais-vu')];

  // Des tableaux d'un autre contexte vm : on compte plutot qu'on ne compare leur forme.
  assert.equal(fgc.epicGamesToRecheck(semaine, null, fgc.getHistory(EPIC)).length, 0);
  assert.equal(fgc.epicGamesToRecheck(semaine, null, {}).length, 0);
  assert.equal(fgc.epicGamesToRecheck(semaine, null, undefined).length, 0);
  assert.equal(fgc.epicGamesToRecheck(null, null, null).length, 0);
});

/* ---------------------------------- le cycle : « Tout recuperer » en bloc */

const NOW = Date.UTC(2026, 9, 25, 9, 0, 0);
const J = 86400000;

const offre = (id, title) => ({
  ...makeOffer({ source: 'epic', store: 'epic', storeId: id, title, url: `https://store.epicgames.com/p/${id}`, end: NOW + 4 * J }),
  catalogKey: `epic:${id}`,
});

function semaineEpic() {
  const home = offre('home-19212a', 'Home - A Unique Horror Adventure');
  const sker = offre('sker-ritual-aac702', 'Sker Ritual');
  const library = {
    'epic:home-19212a': {
      store: 'epic', id: 'home-19212a', title: 'Home - A Unique Horror Adventure', status: 'claimed', ts: NOW - 3 * J,
    },
  };
  return { home, sker, library, catalog: { [home.catalogKey]: home, [sker.catalogKey]: sker } };
}

function pose({ catalog, library }, extra) {
  const appels = [];
  return {
    appels,
    args: {
      chrome: fakeChrome({ now: NOW }).chrome, now: NOW, catalog, filters: {},
      claimableStores: ['epic'], watchedStores: ['epic'], cadence: [], maxReclamations: 3, library,
      claim: async (o, opts) => { appels.push({ titre: o.title, force: opts.force }); return { verdict: VERDICTS.CLAIMED }; },
      ...extra,
    },
  };
}

test('en bloc, le jeu pris jeudi n\'est pas rouvert : seul le nouveau est reclame, et relu sur sa page', async () => {
  const semaine = semaineEpic();
  const { appels, args } = pose(semaine, { forced: true, trustKnownOwned: true });
  await claimWhatCanBe(args);
  assert.deepEqual(appels, [{ titre: 'Sker Ritual', force: true }]);
});

test('un clic sur UNE offre garde l\'ancienne regle : il ignore le registre', async () => {
  const semaine = semaineEpic();
  const { appels, args } = pose(semaine, { forced: true });
  await claimWhatCanBe(args);
  assert.deepEqual(appels.map((a) => a.titre).sort(), ['Home - A Unique Horror Adventure', 'Sker Ritual']);
});

test('« Tout recuperer » (claimAllNow) respecte le registre', async () => {
  const semaine = semaineEpic();
  const { chrome } = fakeChrome({ now: NOW });
  await chrome.storage.local.set({
    'veille:offres': semaine.catalog,
    'veille:bibliotheque': semaine.library,
  });
  const appels = [];
  const out = await claimAllNow({
    chrome, now: NOW, claimableStores: ['epic'],
    claim: async (o, opts) => { appels.push({ titre: o.title, force: opts.force }); return { verdict: VERDICTS.CLAIMED }; },
  });
  assert.deepEqual(appels, [{ titre: 'Sker Ritual', force: true }]);
  assert.equal(out.claimed, 1);
});
