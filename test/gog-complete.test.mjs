/* Une offre GOG doit pouvoir mourir -- mais seulement quand GOG l'affirme.
 *
 * La 2.17.0 a fait balayer les entrees par MAGASIN quand une source fait
 * autorite dessus. GOG n'avait pas ce marqueur : sa source etait declaree
 * `completeList: false`, faute d'avoir mesure la pagination du catalogue. Une
 * offre GOG sans date de fin n'etait donc retiree ni par expiration (pas de
 * date), ni par disparition (aucune autorite) -- exactement le bug corrige la
 * veille, encore ouvert sur un autre magasin.
 *
 * Le correctif ne devine pas la pagination : il CROIT la reponse. GOG publie
 * `page` et `totalPages` a sa racine, donc il dit lui-meme si sa reponse tient
 * sur une page. « Liste complete » cesse d'etre une promesse statique de la
 * source pour devenir un fait par reponse.
 *
 * Et la contrepartie, testee ici aussi : une entree que le magasin n'a jamais
 * publiee sous cette identite -- connue par titre seulement, sans `storeId` --
 * garde la grace longue. La tuer au deuxieme cycle serait enterrer une offre
 * qui court toujours.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import { runCycle } from '../watch/cycle.js';
import { KEYS } from '../watch/storage.js';
import { makeOffer, STATES, STORES } from '../watch/offer.js';
import { announcesSinglePage, mapResponse, discover } from '../watch/sources/gog.js';

const T = Date.UTC(2026, 8, 18, 10, 0, 0);

/* ------------------------------------------------ ce que la reponse annonce */

test('une page unique est reconnue, plusieurs pages ne le sont pas', () => {
  assert.equal(announcesSinglePage({ page: 1, totalPages: 1 }), true);
  /* Reponse reellement observee le 2026-09-17 : aucun jeu gratuit ce jour-la.
     Zero page vaut bien une liste complete -- elle est vide. */
  assert.equal(announcesSinglePage({ page: 1, totalPages: 0 }), true);

  assert.equal(announcesSinglePage({ page: 1, totalPages: 2 }), false);
  assert.equal(announcesSinglePage({ page: 2, totalPages: 2 }), false);
});

test('ne rien savoir n\'est pas savoir que la liste est complete', () => {
  for (const data of [null, undefined, {}, { page: 1 }, { totalPages: 1 }, { page: 'un', totalPages: 1 }]) {
    assert.equal(announcesSinglePage(data), false, `declaree complete a tort : ${JSON.stringify(data)}`);
  }
});

test('les champs se lisent par Number : totalResults est une CHAINE', () => {
  /* Mesure du 2026-09-17 : `totalResults` arrive en chaine la ou
     `totalGamesFound` est un nombre. Le meme flottement peut toucher `page`. */
  assert.equal(announcesSinglePage({ page: '1', totalPages: '1', totalResults: '0' }), true);
});

test('mapResponse publie le fait, pas une promesse', () => {
  const partielle = mapResponse({ products: [], page: 1, totalPages: 3 }, T);
  assert.equal(partielle.complete, false);

  const complete = mapResponse({ products: [], page: 1, totalPages: 1 }, T);
  assert.equal(complete.complete, true);

  /* Une reponse illisible ne promet rien. */
  assert.equal(mapResponse({}, T).complete, false);
});

/* -------------------------------------------------------- jusqu'a discover */

const reponseHttp = (data) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

test('discover remonte le fait jusqu\'au cycle', async () => {
  const une = await discover({ fetch: async () => reponseHttp({ products: [], page: 1, totalPages: 1 }), now: T });
  assert.equal(une.complete, true);

  const plusieurs = await discover({ fetch: async () => reponseHttp({ products: [], page: 1, totalPages: 4 }), now: T });
  assert.equal(plusieurs.complete, false);
});

test('une source en panne ne declare jamais une liste complete', async () => {
  const http = await discover({ fetch: async () => ({ ok: false, status: 503 }), now: T });
  assert.equal(http.complete, false);

  const casse = await discover({ fetch: async () => { throw new Error('reseau coupe'); }, now: T });
  assert.equal(casse.complete, false);
  assert.deepEqual(casse.offers, []);
});

/* ------------------------------------------------ et jusqu'aux disparitions */

const offreGog = (extra = {}) => makeOffer({
  source: 'gog',
  store: STORES.GOG,
  storeId: 'jeu-gratuit-du-moment',
  title: 'Jeu gratuit du moment',
  url: 'https://www.gog.com/game/jeu_gratuit_du_moment',
  end: null, // GOG ne publie pas toujours salesVisibility.to
  ...extra,
});

/** Une source GOG factice : on lui dicte ses reponses, `complete` compris. */
function sourceGog(reponses) {
  let i = 0;
  return {
    name: 'gog',
    completeList: false,
    authoritativeFor: STORES.GOG,
    minIntervalMs: 0,
    async discover() {
      const r = reponses[Math.min(i, reponses.length - 1)];
      i++;
      return { dropped: [], errors: [], ...r };
    },
  };
}

async function contexte(source) {
  const faux = fakeChrome({ now: T });
  const journal = [];
  await faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { activeSources: ['gog'] } });
  return {
    faux,
    journal,
    catalogue: () => Object.values(faux.payload()[KEYS.OFFERS] || {}),
    async cycle(now, extra = {}) {
      return runCycle({
        chrome: faux.chrome,
        now,
        sources: { gog: source },
        notify: async () => {},
        updateBadge: async () => {},
        record: (niveau, message) => journal.push(`${niveau}: ${message}`),
        ...extra,
      });
    },
  };
}

test('une reponse annoncant plusieurs pages ne fait mourir personne', async () => {
  const c = await contexte(sourceGog([
    { offers: [offreGog()], complete: true },
    { offers: [], complete: false },
    { offers: [], complete: false },
  ]));

  await c.cycle(T);
  await c.cycle(T + 60000, { force: true });
  await c.cycle(T + 120000, { force: true });

  assert.equal(c.catalogue()[0].state, STATES.DISCOVERED);
  /* Et le journal le dit : c'est cette ligne qui fournit la mesure de
     pagination que ROADMAP.md attendait, au lieu de l'attendre. */
  assert.ok(
    c.journal.some((l) => l.includes('reponse partielle annoncee')),
    `journal : ${c.journal.join(' | ')}`,
  );
});

test('une page unique fait mourir une offre GOG sans date de fin, au deuxieme constat', async () => {
  const c = await contexte(sourceGog([
    { offers: [offreGog()], complete: true },
    { offers: [], complete: true },
    { offers: [], complete: true },
  ]));

  await c.cycle(T);
  assert.equal(c.catalogue()[0].state, STATES.DISCOVERED);

  await c.cycle(T + 60000, { force: true });
  assert.equal(c.catalogue()[0].state, STATES.DISCOVERED, 'le premier constat note l\'absence, il ne tue pas');

  await c.cycle(T + 120000, { force: true });
  assert.equal(c.catalogue()[0].state, STATES.EXPIRED);
});

test('une offre connue par titre seulement survit aux deux constats', async () => {
  /* Une entree venue de l'agregateur et marquee `store: 'gog'` n'a pas de
     `storeId` : si son titre differe d'une virgule de celui du catalogue, elle
     reste une entree DISTINCTE que GOG ne peut pas contredire. */
  const c = await contexte(sourceGog([
    { offers: [offreGog({ source: 'gamerpower', storeId: null, sourceId: 3316 })], complete: true },
    { offers: [], complete: true },
    { offers: [], complete: true },
  ]));

  await c.cycle(T);
  await c.cycle(T + 60000, { force: true });
  await c.cycle(T + 120000, { force: true });

  assert.equal(c.catalogue()[0].storeId, null);
  assert.equal(c.catalogue()[0].state, STATES.DISCOVERED);
});
