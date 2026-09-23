/* Ma collection : ce que chaque magasin dit que vous possedez.
 *
 * Les reponses de GOG et d'Epic ci-dessous ne sont PAS des captures : aucune
 * bibliotheque reelle n'a ete lue depuis ce depot. Elles portent la forme que
 * le code suppose, et ce fichier ne pretend pas prouver cette forme -- la page
 * de collection le fera, avec son rapport. Ce qu'il prouve, ce sont les
 * promesses qui tiennent QUELLE QUE SOIT la forme :
 *
 *   - une importation ratee n'efface rien ;
 *   - une pagination incomplete ne s'applique pas ;
 *   - une forme inattendue est un statut, pas une liste vide ;
 *   - le rapport ne recopie jamais une valeur -- ni titre, ni prix, ni id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_STATUS,
  KINDS,
  STALE_RUN_MS,
  applyImport,
  buildRows,
  describeShape,
  effectiveStatus,
  emptyCollection,
  filterRows,
  launchUrl,
  makeItem,
  markRunning,
  sanitiseCollection,
  sortRows,
  storePageUrl,
  summarise,
} from '../watch/collection.js';
import {
  importEpic,
  importGog,
  importSteam,
  importStore,
  readSteamWishlist,
  epicPageUrl,
  gogPageUrl,
} from '../watch/collection-import.js';
import { OWNED_URL } from '../watch/sources/steam.js';
import { MAX_STEAM_WISHES } from '../watch/wishlist.js';

/* ----------------------------------------------------------------- outils */

/** Une reponse fetch minimale : ce que fetchJson lit, rien de plus. */
function reponse({ status = 200, body = '', type = 'application/json', url = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Un faux fetch qui journalise ses appels et repond selon une fonction. */
function fauxFetch(repondre) {
  const appels = [];
  const f = async (url, init) => {
    appels.push({ url, init });
    const r = await repondre(url, init, appels.length);
    return reponse({ url, ...r });
  };
  f.appels = appels;
  return f;
}

const sansPause = async () => {};

/* ---------------------------------------------------------------- rapport */

test('le rapport montre la forme, jamais une valeur', () => {
  const secret = {
    title: 'Un Titre Tres Secret',
    price: 1999,
    owner: { email: 'quelqu.un@example.com' },
    list: [{ id: 424242, name: 'Autre Secret' }],
    '1207658924': { a: 1 },
  };
  const forme = describeShape(secret);

  for (const valeur of ['Secret', '1999', 'example.com', '424242', '1207658924']) {
    assert.ok(!forme.includes(valeur), `la valeur « ${valeur} » a fuite : ${forme}`);
  }
  assert.match(forme, /title: texte/);
  assert.match(forme, /price: nombre/);
  assert.match(forme, /list: \[1 x \{id: nombre, name: texte\}\]/);
  // Une cle qui est un identifiant est une donnee : remplacee par « ? ».
  assert.match(forme, /\?: \{a: nombre\}/);
});

test('un dictionnaire range par identifiants ne montre que son nombre de cles', () => {
  const forme = describeShape({ 101: { t: 'x' }, 202: { t: 'y' }, 303: { t: 'z' } });
  assert.equal(forme, '{3 x ?: {t: texte}}');
});

/* ------------------------------------------------------------- integration */

const steam = (id, title) => makeItem({ store: 'steam', id, title, kind: KINDS.GAME });

test('une importation reussie remplace tout le magasin, et seulement lui', () => {
  let c = emptyCollection();
  c = applyImport(c, 'steam', { status: IMPORT_STATUS.OK, items: [steam('1', 'A'), steam('2', 'B')] }, 1000);
  c = applyImport(c, 'gog', { status: IMPORT_STATUS.OK, items: [makeItem({ store: 'gog', id: '9', title: 'G' })] }, 1000);

  // Le jeu 2 a ete rembourse : une photographie, pas un ajout.
  c = applyImport(c, 'steam', { status: IMPORT_STATUS.OK, items: [steam('1', 'A')] }, 2000);

  assert.deepEqual(Object.keys(c.items).sort(), ['gog:9', 'steam:1']);
  assert.equal(c.stores.steam.count, 1);
  assert.equal(c.stores.steam.lastOk, 2000);
  assert.equal(c.stores.gog.count, 1, 'GOG ne bouge pas quand Steam s\'importe');
});

test('une importation ratee n\'efface aucun jeu', () => {
  let c = applyImport(emptyCollection(), 'steam', { status: IMPORT_STATUS.OK, items: [steam('1', 'A'), steam('2', 'B')] }, 1000);

  for (const status of [IMPORT_STATUS.LOGGED_OUT, IMPORT_STATUS.SHAPE, IMPORT_STATUS.ERROR]) {
    c = applyImport(c, 'steam', { status, items: [], note: 'x' }, 5000);
    assert.equal(Object.keys(c.items).length, 2, `${status} a efface la bibliotheque`);
    assert.equal(c.stores.steam.status, status);
    assert.equal(c.stores.steam.lastOk, 1000, 'la derniere reussite reste connue');
    assert.equal(c.stores.steam.count, 2);
  }
});

test('une importation morte en route ne reste pas « en cours » pour toujours', () => {
  const c = markRunning(emptyCollection(), 'gog', 1000);
  assert.equal(effectiveStatus(c.stores.gog, 1000 + 1000), IMPORT_STATUS.RUNNING);
  assert.equal(effectiveStatus(c.stores.gog, 1000 + STALE_RUN_MS + 1), IMPORT_STATUS.ERROR);
  assert.equal(effectiveStatus(undefined, 0), null);
});

test('une valeur de stockage abimee donne une collection vide, pas une exception', () => {
  for (const brut of [undefined, null, 42, 'x', [], { stores: [], items: 'x' }]) {
    const c = sanitiseCollection(brut);
    assert.equal(typeof c.stores, 'object');
    assert.equal(typeof c.items, 'object');
  }
});

/* ------------------------------------------------------------------ lignes */

test('un meme jeu sur deux magasins fait une ligne et un doublon', () => {
  let c = applyImport(emptyCollection(), 'steam', { status: IMPORT_STATUS.OK, items: [steam('620', 'Portal 2')] }, 1);
  c = applyImport(c, 'gog', {
    status: IMPORT_STATUS.OK,
    items: [makeItem({ store: 'gog', id: '7', title: 'Portal 2', url: 'https://www.gog.com/game/portal_2' })],
  }, 1);

  const rows = buildRows({ collection: c, library: {} });
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0].stores).sort(), ['gog', 'steam']);
  assert.equal(summarise(rows).duplicates, 1);
});

test('ce que l\'extension a reclame rejoint la ligne importee du meme magasin', () => {
  const c = applyImport(emptyCollection(), 'epic', {
    status: IMPORT_STATUS.OK,
    items: [makeItem({ store: 'epic', id: 'offre-1', title: 'Cardpocalypse', acquiredAt: 5000 })],
  }, 1);
  const library = {
    'epic:cardpocalypse': { store: 'epic', id: 'cardpocalypse', title: 'Cardpocalypse', url: 'https://store.epicgames.com/p/cardpocalypse', ts: 3000, status: 'claimed' },
    'epic:rate': { store: 'epic', id: 'rate', title: 'Rate', ts: 3000, status: 'failed' },
    'amazon:x': { store: 'amazon', id: 'x', title: 'Jeu Luna', ts: 4000, status: 'claimed' },
  };

  const rows = buildRows({ collection: c, library });
  const card = rows.find((r) => r.title === 'Cardpocalypse');
  assert.ok(card);
  assert.equal(Object.keys(card.stores).length, 1, 'meme magasin : un seul exemplaire');
  assert.equal(card.stores.epic.imported, true);
  assert.equal(card.stores.epic.claimed, true);
  assert.equal(card.since, 3000, 'la plus ancienne date connue fait foi');
  assert.equal(card.stores.epic.url, 'https://store.epicgames.com/p/cardpocalypse');

  assert.ok(!rows.some((r) => r.title === 'Rate'), 'un echec n\'est pas une acquisition');
  assert.ok(rows.some((r) => r.title === 'Jeu Luna' && r.stores.amazon), 'Amazon vient du registre');
});

test('deux jeux sans titre ne deviennent pas un faux doublon', () => {
  const c = applyImport(emptyCollection(), 'steam', {
    status: IMPORT_STATUS.OK,
    items: [makeItem({ store: 'steam', id: '11', title: null, kind: KINDS.OTHER }), makeItem({ store: 'steam', id: '12', title: null, kind: KINDS.OTHER })],
  }, 1);
  const rows = buildRows({ collection: c, library: {} });
  assert.equal(rows.length, 2);
  assert.equal(summarise(rows).duplicates, 0);
});

test('par defaut on ne voit que les jeux ; « all » rend les DLC et le reste', () => {
  const c = applyImport(emptyCollection(), 'steam', {
    status: IMPORT_STATUS.OK,
    items: [
      makeItem({ store: 'steam', id: '1', title: 'Jeu', kind: KINDS.GAME }),
      makeItem({ store: 'steam', id: '2', title: 'Jeu - Soundtrack', kind: KINDS.OTHER }),
      makeItem({ store: 'steam', id: '3', title: 'Jeu - Extension', kind: KINDS.DLC }),
    ],
  }, 1);
  const rows = buildRows({ collection: c, library: {} });
  assert.deepEqual(filterRows(rows).map((r) => r.title), ['Jeu']);
  assert.equal(filterRows(rows, { kind: 'all' }).length, 3);
  assert.deepEqual(filterRows(rows, { kind: KINDS.DLC }).map((r) => r.title), ['Jeu - Extension']);
});

test('recherche, magasin, doublons et tri', () => {
  let c = applyImport(emptyCollection(), 'steam', { status: IMPORT_STATUS.OK, items: [steam('1', 'Zeta'), steam('2', 'Alpha Édition')] }, 1);
  c = applyImport(c, 'gog', { status: IMPORT_STATUS.OK, items: [makeItem({ store: 'gog', id: '3', title: 'Zeta' })] }, 1);
  const rows = buildRows({ collection: c, library: {} });

  assert.deepEqual(filterRows(rows, { query: 'alpha edition' }).map((r) => r.title), ['Alpha Édition'], 'la recherche ignore les accents');
  assert.deepEqual(filterRows(rows, { store: 'gog' }).map((r) => r.title), ['Zeta']);
  assert.deepEqual(filterRows(rows, { duplicatesOnly: true }).map((r) => r.title), ['Zeta']);
  assert.deepEqual(sortRows(rows, 'title').map((r) => r.title), ['Alpha Édition', 'Zeta']);
  assert.deepEqual(sortRows(rows, 'stores').map((r) => r.title), ['Zeta', 'Alpha Édition']);
});

test('les liens : une fiche pour chaque magasin connu, un lancement pour Steam seulement', () => {
  assert.equal(storePageUrl('steam', { id: '620' }), 'https://store.steampowered.com/app/620/');
  assert.equal(storePageUrl('gog', { id: '7', url: 'https://www.gog.com/game/x' }), 'https://www.gog.com/game/x');
  assert.equal(storePageUrl('epic', { id: 'offre' }), null);
  assert.equal(launchUrl('steam', { id: '620' }), 'steam://run/620');
  assert.equal(launchUrl('gog', { id: '7' }), null);
});

/* ------------------------------------------------------------------- Steam */

test('Steam : la possession vient de userdata, les noms de GetItems par lots', async () => {
  const f = fauxFetch((url) => {
    if (url === OWNED_URL) return { body: { rgOwnedApps: [10, 20, 30], rgWishlist: [] } };
    const lot = JSON.parse(decodeURIComponent(url.split('input_json=')[1])).ids.map((i) => i.appid);
    // Type 4 : le DLC, mesure le 2026-09-19 (« Dying Light: The Beast - Discharge Weapon Pack »).
    const connus = { 10: { name: 'Un Jeu Secret', type: 0 }, 20: { name: 'Son DLC', type: 4 } };
    return {
      body: { response: { store_items: lot.filter((id) => connus[id]).map((id) => ({ appid: id, ...connus[id] })) } },
    };
  });

  const r = await importSteam({ fetch: f, pause: sansPause, batch: 2 });

  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.equal(f.appels.length, 3, 'userdata, puis deux lots de noms');
  assert.equal(f.appels[0].init.credentials, 'include', 'la possession se lit avec la session');
  assert.equal(f.appels[1].init.credentials, 'omit', 'les noms sont publics');

  const parId = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(parId['10'].title, 'Un Jeu Secret');
  assert.equal(parId['10'].kind, KINDS.GAME);
  assert.equal(parId['20'].kind, KINDS.DLC);
  assert.equal(parId['30'].title, null, 'un jeu retire du magasin reste, sans titre');
  assert.equal(parId['30'].kind, KINDS.OTHER);
  assert.ok(!r.report.includes('Secret'), 'le rapport ne recopie aucun titre');
});

test('Steam : des listes vides veulent dire « pas connecte », et n\'effacent rien', async () => {
  const f = fauxFetch(() => ({ body: { rgOwnedApps: [], rgWishlist: [] } }));
  const r = await importSteam({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.LOGGED_OUT);
  assert.equal(r.items.length, 0);
  assert.equal(f.appels.length, 1, 'aucun lot de noms pour rien');
});

test('Steam : une reponse sans rgOwnedApps est une forme inattendue', async () => {
  const f = fauxFetch(() => ({ body: { autreChose: true } }));
  const r = await importSteam({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.SHAPE);
  assert.match(r.report, /autreChose: booleen/);
});

test('Steam : la liste de souhaits vient de la meme reponse, nommee par les memes lots', async () => {
  const f = fauxFetch((url) => {
    if (url === OWNED_URL) return { body: { rgOwnedApps: [10], rgWishlist: [367520, 10, 999] } };
    const lot = JSON.parse(decodeURIComponent(url.split('input_json=')[1])).ids.map((i) => i.appid);
    const connus = { 10: { name: 'Deja A Moi', type: 0 }, 367520: { name: 'Hollow Knight', type: 0 } };
    return {
      body: { response: { store_items: lot.filter((id) => connus[id]).map((id) => ({ appid: id, ...connus[id] })) } },
    };
  });

  const r = await importSteam({ fetch: f, pause: sansPause, batch: 50 });

  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.equal(f.appels.length, 2, 'userdata, puis un seul lot pour la bibliotheque ET les souhaits');
  assert.deepEqual(r.wishlist.map((w) => [w.id, w.title]), [['367520', 'Hollow Knight'], ['10', 'Deja A Moi'], ['999', null]]);
  assert.equal(r.items.length, 1, 'un souhait n\'entre pas dans la collection');
  assert.match(r.note, /3 souhait/);
  assert.match(r.report, /liste de souhaits : 3 jeu\(x\), 1 sans nom/);
  assert.ok(!r.report.includes('Hollow'), 'le rapport ne recopie aucun titre');
});

test('Steam : sans rgWishlist, la liste importee avant est gardee (null, pas vide)', async () => {
  const f = fauxFetch((url) => (url === OWNED_URL
    ? { body: { rgOwnedApps: [10] } }
    : { body: { response: { store_items: [] } } }));
  const r = await importSteam({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.equal(r.wishlist, null);
  assert.match(r.report, /rgWishlist absent, la precedente est gardee/);
});

test('Steam : une liste de souhaits demesuree est bornee avant d\'etre nommee', async () => {
  const beaucoup = Array.from({ length: MAX_STEAM_WISHES + 120 }, (_, i) => 1000 + i);
  const f = fauxFetch((url) => (url === OWNED_URL
    ? { body: { rgOwnedApps: [10], rgWishlist: beaucoup } }
    : { body: { response: { store_items: [] } } }));
  const r = await importSteam({ fetch: f, pause: sansPause, batch: 50 });
  assert.equal(r.wishlist.length, MAX_STEAM_WISHES);
  assert.equal(f.appels.length - 1, Math.ceil((1 + MAX_STEAM_WISHES) / 50), 'aucun lot pour un souhait qu\'on ne garde pas');
  assert.match(r.report, /gardes/);
});

test('readSteamWishlist : nombres, chaines ou { appid } ; une forme inconnue rend null', () => {
  assert.deepEqual(readSteamWishlist({ rgWishlist: [1, '2', { appid: 3 }, 1] }), ['1', '2', '3']);
  assert.deepEqual(readSteamWishlist({ rgWishlist: [] }), [], 'une vraie liste vide remplace');
  assert.equal(readSteamWishlist({ rgWishlist: [{ id: 'x' }] }), null, 'des elements illisibles ne sont pas une liste vide');
  assert.equal(readSteamWishlist({ rgWishlist: {} }), null);
  assert.equal(readSteamWishlist({}), null);
  assert.equal(readSteamWishlist(null), null);
});

/* --------------------------------------------------------------------- GOG */

function pageGog(page, totalPages, produits) {
  return { page, totalPages, totalProducts: 3, products: produits };
}

test('GOG : toutes les pages annoncees sont lues, puis appliquees ensemble', async () => {
  const f = fauxFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    return page === 1
      ? { body: pageGog(1, 2, [{ id: 1, title: 'Titre Prive Un', url: '/game/un' }, { id: 2, title: 'Deux', url: '/game/deux' }]) }
      : { body: pageGog(2, 2, [{ id: 3, title: 'Trois', url: '//www.gog.com/game/trois' }]) };
  });

  const r = await importGog({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.deepEqual(f.appels.map((a) => a.url), [gogPageUrl(1), gogPageUrl(2)]);
  assert.equal(f.appels[0].init.credentials, 'include');
  assert.deepEqual(r.items.map((i) => i.url), [
    'https://www.gog.com/game/un', 'https://www.gog.com/game/deux', 'https://www.gog.com/game/trois',
  ]);
  assert.ok(!r.report.includes('Prive'), 'le rapport ne recopie aucun titre');
});

test('GOG : une page ratee au milieu annule tout -- jamais une photographie tronquee', async () => {
  const f = fauxFetch((url) => {
    const page = Number(new URL(url).searchParams.get('page'));
    return page === 1 ? { body: pageGog(1, 3, [{ id: 1, title: 'Un' }]) } : { status: 500, body: 'oups', type: 'text/plain' };
  });
  const r = await importGog({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.ERROR);
  assert.equal(r.items.length, 0);
  assert.match(r.note, /page 2 sur 3/);
});

test('GOG : les trois facons de ne pas etre connecte', async () => {
  const cas = [
    { status: 401, body: { error: 'x' } },
    { status: 200, url: 'https://login.gog.com/auth?client_id=1', body: '<html></html>', type: 'text/html' },
    { status: 200, body: { errorCode: 'errors.com.epicgames.common.authentication.token_verification_failed' } },
  ];
  for (const c of cas) {
    const r = await importGog({ fetch: fauxFetch(() => c), pause: sansPause });
    assert.equal(r.status, IMPORT_STATUS.LOGGED_OUT, JSON.stringify(c));
  }
});

test('GOG : son vrai refus sans session dit « non connecte » (mesure du 2026-09-19)', async () => {
  /* Capture reelle, pas une forme supposee : ce que www.gog.com rend a qui
     n'a pas de session. Un 403 -- mais le corps dit que c'est une question
     d'authentification, et c'est le corps qui tranche. */
  const mesure = { status: 403, code: 403, message: 'Full authentication is required to access this resource.' };
  const r = await importGog({ fetch: fauxFetch(() => ({ status: 403, body: mesure })), pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.LOGGED_OUT);
  assert.match(r.report, /corps : \{status: nombre, code: nombre, message: texte\}/);
});

test('GOG : un 403 en HTML n\'est pas « reconnectez-vous », et du HTML n\'est pas une liste vide', async () => {
  /* Mesure du meme jour : c'est ce qu'Epic rend a un agent « HeadlessChrome »
     -- un mur anti-robot. Le titre de la page part dans la note. */
  const refus = await importGog({
    fetch: fauxFetch(() => ({ status: 403, body: '<html><head><title>Access Denied</title></head></html>', type: 'text/html' })),
    pause: sansPause,
  });
  assert.equal(refus.status, IMPORT_STATUS.ERROR);
  assert.match(refus.note, /HTTP 403 \(page « Access Denied »\)/);

  const pagination = await importGog({ fetch: fauxFetch(() => ({ status: 400, body: { message: 'invalid nextPageToken' } })), pause: sansPause });
  assert.equal(pagination.status, IMPORT_STATUS.ERROR, 'un jeton de pagination refuse n\'est pas une deconnexion');

  const html = await importGog({ fetch: fauxFetch(() => ({ body: '<html>accueil</html>', type: 'text/html' })), pause: sansPause });
  assert.equal(html.status, IMPORT_STATUS.SHAPE);
  assert.match(html.note, /non JSON/);
});

test('GOG : trop de pages annoncees, on refuse des la premiere', async () => {
  const f = fauxFetch(() => ({ body: pageGog(1, 999, [{ id: 1, title: 'Un' }]) }));
  const r = await importGog({ fetch: f, pause: sansPause, maxPages: 10 });
  assert.equal(r.status, IMPORT_STATUS.ERROR);
  assert.equal(f.appels.length, 1);
});

/* -------------------------------------------------------------------- Epic */

test('Epic : les pages suivent le jeton, les remboursements sont ecartes', async () => {
  const f = fauxFetch((url) => {
    const token = new URL(url).searchParams.get('nextPageToken');
    if (!token) {
      return {
        body: {
          orders: [
            { orderType: 'PURCHASE', createdAtMillis: 3000, items: [{ description: 'Jeu Achete Secret', offerId: 'o1', namespace: 'n1' }] },
            { orderType: 'REFUND', createdAtMillis: 2500, items: [{ description: 'Rembourse', offerId: 'o2', namespace: 'n2' }] },
          ],
          nextPageToken: 'jeton-2',
        },
      };
    }
    return {
      body: {
        orders: [{ orderType: 'PURCHASE', createdAtMillis: 1000, items: [{ description: 'Jeu Achete Secret', offerId: 'o1', namespace: 'n1' }] }],
        nextPageToken: null,
      },
    };
  });

  const r = await importEpic({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.deepEqual(f.appels.map((a) => a.url), [epicPageUrl(null), epicPageUrl('jeton-2')]);
  assert.equal(r.items.length, 1, 'meme offre sur deux pages : un seul jeu');
  assert.equal(r.items[0].acquiredAt, 1000, 'la plus ancienne commande fait la date');
  assert.match(r.report, /PURCHASE x2, REFUND x1 ; 1 ecartee/);
  assert.ok(!r.report.includes('Secret'), 'le rapport ne recopie aucun titre');
  assert.ok(!r.report.includes('jeton-2'), 'ni un jeton de pagination');
});

test('Epic : un jeton qui revient ne fait pas tourner la pagination en rond', async () => {
  const f = fauxFetch(() => ({ body: { orders: [{ orderType: 'PURCHASE', items: [{ description: 'X', offerId: 'o' }] }], nextPageToken: 'toujours-le-meme' } }));
  const r = await importEpic({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.OK);
  assert.equal(f.appels.length, 2, 'le second passage voit le jeton deja lu et s\'arrete');
});

test('Epic : redirige vers la connexion, ou sans « orders »', async () => {
  const deconnecte = await importEpic({
    fetch: fauxFetch(() => ({ url: 'https://www.epicgames.com/id/login?redirectUrl=x', body: '<html></html>', type: 'text/html' })),
    pause: sansPause,
  });
  assert.equal(deconnecte.status, IMPORT_STATUS.LOGGED_OUT);

  const forme = await importEpic({ fetch: fauxFetch(() => ({ body: { commandes: [] } })), pause: sansPause });
  assert.equal(forme.status, IMPORT_STATUS.SHAPE);
  assert.match(forme.report, /commandes: \[\]/);
});

test('Epic : une deuxieme page ratee annule tout', async () => {
  const f = fauxFetch((url, init, n) => (n === 1
    ? { body: { orders: [{ orderType: 'PURCHASE', items: [{ description: 'X', offerId: 'o' }] }], nextPageToken: 't2' } }
    : { status: 502, body: 'x', type: 'text/plain' }));
  const r = await importEpic({ fetch: f, pause: sansPause });
  assert.equal(r.status, IMPORT_STATUS.ERROR);
  assert.equal(r.items.length, 0);
});

/* ------------------------------------------------------------------ entree */

test('importStore ne leve jamais : une exception devient un statut', async () => {
  const inconnu = await importStore('amazon', {});
  assert.equal(inconnu.status, IMPORT_STATUS.ERROR);

  const panne = await importStore('gog', { fetch: async () => { throw new Error('reseau coupe'); }, pause: sansPause });
  assert.equal(panne.status, IMPORT_STATUS.ERROR);
  assert.match(panne.note, /reseau coupe/);
});
