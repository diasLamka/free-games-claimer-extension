/* Un stockage de demonstration, pour `npm run preview` sans rien d'autre.
 *
 * Il montre chaque etat que les sections savent afficher -- une offre en
 * cours, une fenetre annoncee cliquable, une reclamation, un jeu « deja
 * recupere », un « deja possede » -- avec des dates relatives a l'instant, pour
 * que « il y a 2 h » ne devienne pas « il y a trois mois » avec le temps.
 *
 * Aucune donnee reelle : titres et identifiants sont inventes ou publics.
 */
import { makeOffer, STORES, STATES } from '../watch/offer.js';
import { KEYS } from '../watch/storage.js';
import { KEY_LIBRARY, makeEntry } from '../watch/library.js';

const H = 3600000;
const D = 24 * H;

export function demoStorage(now = Date.now()) {
  const offer = (key, raw) => ({
    ...makeOffer({ seenAt: now - 2 * H, updatedAt: now - H, ...raw }),
    state: STATES.CONFIRMED,
    catalogKey: key,
  });

  const catalog = {
    'epic:jeu-de-la-semaine': offer('epic:jeu-de-la-semaine', {
      source: 'epic-api', sourceId: 'demo-offre-epic', store: STORES.EPIC, storeId: 'jeu-de-la-semaine',
      title: 'Jeu de la semaine', url: 'https://store.epicgames.com/p/jeu-de-la-semaine',
      end: now + 3 * D, worth: '19,99 €', keepable: true,
    }),
    'gog:classique-offert': offer('gog:classique-offert', {
      source: 'gog', sourceId: 1, store: STORES.GOG, storeId: 'classique-offert',
      title: 'Classique offert', url: 'https://www.gog.com/fr/game/classique-offert',
      end: now + 20 * H, worth: '9,99 €', keepable: true,
    }),
  };

  const history = (entries) => JSON.stringify(entries);

  return {
    [KEYS.OFFERS]: catalog,
    [KEYS.STATE]: { booted: true, lastCycle: now - 2 * H, nextCycle: now + 4 * H, lastError: null, unseen: 0 },
    [KEYS.SOURCES]: {
      'epic-api': {
        lastSuccess: now - 2 * H, lastCycle: now - 2 * H, lastCall: now - 2 * H, lastError: null, consecutiveFailures: 0,
        announcedWindows: [
          { title: 'Prochain jeu Epic', image: null, url: 'https://store.epicgames.com/p/prochain-jeu', start: now + 2 * D, end: now + 9 * D },
          { title: 'Fenetre sans adresse', image: null, start: now + 9 * D, end: now + 16 * D },
        ],
      },
    },
    'FGC_history_Epic Games': history({
      'slug:jeu-pris': { status: 'claimed', reason: 'CLAIMED', ts: now - 3 * H, title: 'Jeu pris par l’extension' },
      'slug:jeu-possede': { status: 'claimed', reason: 'ALREADY_OWNED', ts: now - 26 * H, title: 'Jeu deja possede' },
    }),
    'FGC_history_Amazon Luna': history({
      'offer:amzn1.pg.item.demo-1': { status: 'claimed', reason: 'ALREADY_CLAIMED', ts: now - 5 * H, title: 'Offre Luna deja prise' },
      'offer:amzn1.pg.item.demo-2': { status: 'failed', reason: 'bouton introuvable', ts: now - 30 * H, attempts: 1, title: 'Offre Luna en echec' },
    }),
    'FGC_history_GOG': history({}),
    [KEY_LIBRARY]: {
      'epic:jeu-pris': makeEntry({ store: 'epic', id: 'jeu-pris', title: 'Jeu pris par l’extension', ts: now - 3 * H, status: 'claimed', worth: '14,99 €' }),
    },
  };
}
