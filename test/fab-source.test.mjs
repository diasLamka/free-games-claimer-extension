/* La source Fab (2.108.0) : les assets offerts par Epic, "Limited-Time Free".
 *
 * Ecrite d'apres la mesure du 2026-10-10 (docs/specs/2026-10-10-humble-fab-constats.md) :
 * la page https://www.fab.com/limited-time-free porte, dans le HTML brut, un
 * bloc <script id="js-json-data-prefetched-data"> dont l'entree
 * "/i/blades/free_content_blade" liste les fiches, leurs licences, leur prix et
 * la fin de la remise. La capture test/fixtures/fab-limited-free.html est cette
 * page, reduite a ce bloc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NAME, PAGE_URL, listingUrl, readBlade, mapFabOffers, discover,
} from '../watch/sources/fab.js';
import {
  SOURCES, CLAIMABLE_STORES, DETECT_ONLY_STORES, activeSourcesFor, claimableStoresFor,
} from '../watch/sources/index.js';
import {
  STORES, STORE_LABELS, FIRST_PARTY_SOURCES, storeFromUrl, makeOffer,
} from '../watch/offer.js';
import { judge } from '../watch/filters.js';
import { declaresOptionalOrigin } from '../watch/permissions.js';
import { fakeChrome } from './fake-chrome.mjs';
import { runCycle } from '../watch/cycle.js';
import { KEYS } from '../watch/storage.js';

const PAGE = readFileSync(new URL('./fixtures/fab-limited-free.html', import.meta.url), 'utf8');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/* La semaine mesuree : remise du 6 au 20 octobre 2026. */
const DEBUT = Date.parse('2026-10-06T14:00:00Z');
const FIN = Date.parse('2026-10-20T13:59:00Z');
const T = Date.parse('2026-10-10T12:00:00Z');

const UID_READY_MAP = '95ff3c25-59f9-441d-aa43-93c3abd63680';
const UID_PATHFINDING = 'e57ff036-fb84-4c86-af7d-8c2a75965c73';
const UID_FARM = 'd8b51a6c-a5b2-41cf-8f49-14e936a27de3';

/** La page de la capture, recopiee : chaque test la modifie sans toucher les autres. */
const blade = () => structuredClone(readBladeOrFail(PAGE));
function readBladeOrFail(html) {
  const b = readBlade(html);
  assert.ok(b, 'la capture doit se lire');
  return b;
}

/** Une page minimale autour d'un bloc, pour fabriquer les cas limites. */
const pageAvec = (donnees) => `<html><head><title>Fab</title></head><body>
<script id="js-json-data-prefetched-data" type="application/json">${JSON.stringify(donnees).replace(/<\//g, '<\\/')}</script></body></html>`;

/* ------------------------------------------------------------ la lecture */

test('la capture : trois fiches dans le bloc des offres a duree limitee', () => {
  const b = readBladeOrFail(PAGE);
  assert.equal(b.isLimitedFreeContent, true);
  assert.deepEqual(b.tiles.map((t) => t.listing.uid), [UID_READY_MAP, UID_PATHFINDING, UID_FARM]);
});

test('une page sans le bloc de donnees, ou avec un JSON abime : null -- la forme a change, ce n\'est pas « aucune offre »', () => {
  assert.equal(readBlade('<html><body>Fab</body></html>'), null);
  assert.equal(readBlade('<script id="js-json-data-prefetched-data" type="application/json">{pas du json</script>'), null);
  assert.equal(readBlade(pageAvec({ '/i/users/me': { isAnonymous: true } })), null, 'le bloc des offres est absent');
  assert.equal(readBlade(''), null);
  assert.equal(readBlade(null), null);
});

test('un bloc qui n\'est pas celui des offres a duree limitee n\'est pas cru', () => {
  const b = blade();
  b.isLimitedFreeContent = false;
  assert.equal(readBlade(pageAvec({ '/i/blades/free_content_blade': b })), null);
});

test('un bloc present mais sans fiche : lisible, et vide -- « aucune offre cette semaine »', () => {
  const b = blade();
  b.tiles = [];
  const lu = readBlade(pageAvec({ '/i/blades/free_content_blade': b }));
  assert.ok(lu);
  assert.deepEqual(mapFabOffers(lu, T).offers, []);
});

test('la fiche : l\'adresse d\'une fiche Fab bien formee, rien d\'autre', () => {
  assert.equal(listingUrl(UID_FARM), `https://www.fab.com/listings/${UID_FARM}`);
  assert.equal(listingUrl('../etc/passwd'), null);
  assert.equal(listingUrl('D8B51A6C-A5B2-41CF-8F49-14E936A27DE3'), `https://www.fab.com/listings/${UID_FARM}`, 'la casse est normalisee');
  assert.equal(listingUrl(''), null);
  assert.equal(listingUrl(null), null);
});

/* ------------------------------------------------------------ les offres */

test('la vraie page : trois offres, avec fin, valeur, vignette et fiche', () => {
  const { offers, dropped } = mapFabOffers(blade(), T);
  assert.equal(dropped.length, 0);
  assert.equal(offers.length, 3);

  const [carte] = offers;
  assert.equal(carte.source, NAME);
  assert.equal(carte.sourceId, `fab:${UID_READY_MAP}`);
  assert.equal(carte.store, STORES.FAB);
  assert.equal(carte.storeId, UID_READY_MAP);
  assert.equal(carte.title, 'Ready Map Vol 2 - Bridge Environment / Nature');
  assert.equal(carte.url, `https://www.fab.com/listings/${UID_READY_MAP}`);
  assert.equal(carte.start, DEBUT);
  assert.equal(carte.end, FIN);
  assert.equal(carte.worth, '80.32 EUR', 'la licence Personnelle, dans la devise de la page');
  assert.equal(carte.publisher, 'Six Sides Studios');
  assert.equal(carte.platforms, 'Unreal Engine');
  assert.equal(carte.category, 'asset');
  assert.equal(carte.keepable, true, 'ajoute a la bibliotheque pour toujours');
  assert.equal(carte.seenAt, T);
  assert.match(carte.image, /^https:\/\/media\.fab\.com\/image_previews\/gallery_images\/.+\.jpg$/);

  assert.deepEqual(offers.map((o) => o.worth), ['80.32 EUR', '89.24 EUR', '17.84 EUR']);
  assert.deepEqual(offers.map((o) => o.publisher), ['Six Sides Studios', 'NordVader', 'Emberlight Creations']);
});

test('la vignette : la taille moyenne (640 px de large), pas la miniature ni le plein ecran', () => {
  const { offers } = mapFabOffers(blade(), T);
  const images = blade().tiles[0].listing.thumbnails[0].images;
  const attendue = images.find((i) => i.width === 640).url;
  assert.equal(offers[0].image, attendue);
});

test('la fin : la plus proche de toutes les licences gratuites', () => {
  const b = blade();
  const [perso, pro] = b.tiles[0].listing.licenses;
  pro.priceTier.discountEndDate = '2026-10-15T08:00:00Z';
  assert.equal(perso.priceTier.discountEndDate, '2026-10-20T13:59:00Z');
  const { offers } = mapFabOffers(b, T);
  assert.equal(offers[0].end, Date.parse('2026-10-15T08:00:00Z'));
});

test('une licence payante ne compte pas : seule la gratuite donne la fin et la valeur', () => {
  const b = blade();
  const [perso, pro] = b.tiles[0].listing.licenses;
  perso.priceTier.discountedPrice = 12.5; // plus gratuite
  perso.priceTier.discountEndDate = '2026-10-11T00:00:00Z';
  const { offers } = mapFabOffers(b, T);
  assert.equal(offers.length, 1 + 2, 'la fiche reste offerte par sa licence Professionnelle');
  assert.equal(offers[0].end, FIN, 'la fin de la licence payante est ignoree');
  assert.equal(offers[0].worth, `${pro.priceTier.price.toFixed(2)} EUR`);
});

test('plus aucune licence gratuite : la fiche est ecartee, avec sa raison', () => {
  const b = blade();
  for (const l of b.tiles[1].listing.licenses) l.priceTier.discountedPrice = l.priceTier.price;
  const { offers, dropped } = mapFabOffers(b, T);
  assert.deepEqual(offers.map((o) => o.storeId), [UID_READY_MAP, UID_FARM]);
  assert.deepEqual(dropped.map((d) => [d.uid, d.raison]), [[UID_PATHFINDING, 'aucune licence gratuite']]);
});

test('une remise terminee, ou pas encore commencee : pas une offre ouverte', () => {
  const finie = mapFabOffers(blade(), FIN + 1);
  assert.deepEqual(finie.offers, []);
  assert.equal(finie.dropped.length, 3);

  const avant = mapFabOffers(blade(), DEBUT - HOUR);
  assert.deepEqual(avant.offers, []);
  assert.equal(avant.dropped.length, 3);
});

test('gratuit de toute facon (prix d\'origine nul) : rien a garder, pas une offre', () => {
  const b = blade();
  for (const l of b.tiles[2].listing.licenses) { l.priceTier.price = 0; l.priceTier.discountedPrice = 0; }
  const { offers, dropped } = mapFabOffers(b, T);
  assert.deepEqual(offers.map((o) => o.storeId), [UID_READY_MAP, UID_PATHFINDING]);
  assert.equal(dropped[0].uid, UID_FARM);
});

test('une fiche sans identifiant bien forme, ou sans titre : ecartee, jamais inventee', () => {
  const b = blade();
  b.tiles[0].listing.uid = '../x';
  b.tiles[1].listing.title = '   ';
  const { offers, dropped } = mapFabOffers(b, T);
  assert.deepEqual(offers.map((o) => o.storeId), [UID_FARM]);
  assert.equal(dropped.length, 2);
});

test('des champs absents ou d\'un autre type ne font pas tomber la lecture', () => {
  const b = blade();
  delete b.tiles[0].listing.thumbnails;
  delete b.tiles[0].listing.user;
  delete b.tiles[0].listing.assetFormats;
  b.tiles[1] = { listing: null };
  b.tiles[2].listing.licenses = 'x';
  const { offers, dropped } = mapFabOffers(b, T);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].image, null);
  assert.equal(offers[0].publisher, null);
  assert.equal(offers[0].platforms, null);
  assert.equal(dropped.length, 2);
});

test('la valeur n\'est ecrite qu\'avec une devise a trois lettres', () => {
  const b = blade();
  b.tiles[0].listing.licenses[0].priceTier.currencyCode = 'euro';
  b.tiles[0].listing.licenses[1].priceTier.currencyCode = 'euro';
  const { offers } = mapFabOffers(b, T);
  assert.equal(offers[0].worth, null);
});

/* ------------------------------------------------------------ la decouverte */

function fauxFetch(reponse) {
  const vus = [];
  const f = async (url, init) => {
    vus.push({ url, init });
    if (reponse instanceof Error) throw reponse;
    if (typeof reponse === 'number') return { ok: false, status: reponse, text: async () => '' };
    return { ok: true, status: 200, text: async () => reponse };
  };
  f.vus = vus;
  return f;
}

test('la page lue : complete, sans cookies, a l\'adresse mesuree', async () => {
  const f = fauxFetch(PAGE);
  const r = await discover({ fetch: f, now: T });
  assert.equal(r.complete, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.offers.length, 3);
  assert.equal(f.vus.length, 1);
  assert.equal(f.vus[0].url, PAGE_URL);
  assert.equal(PAGE_URL, 'https://www.fab.com/limited-time-free');
  assert.equal(f.vus[0].init.credentials, 'omit');
});

test('aucune offre cette semaine : une liste vide ET complete -- Fab fait autorite', async () => {
  const b = blade();
  b.tiles = [];
  const r = await discover({ fetch: fauxFetch(pageAvec({ '/i/blades/free_content_blade': b })), now: T });
  assert.equal(r.complete, true);
  assert.deepEqual(r.offers, []);
  assert.deepEqual(r.errors, []);
});

test('une erreur HTTP : une erreur qui le dit, rien de conclu', async () => {
  const r = await discover({ fetch: fauxFetch(403), now: T });
  assert.equal(r.complete, false);
  assert.deepEqual(r.offers, []);
  assert.deepEqual(r.errors, ['HTTP 403']);
});

test('un reseau en panne : une erreur, pas une exception', async () => {
  const r = await discover({ fetch: fauxFetch(new Error('reseau')), now: T });
  assert.equal(r.complete, false);
  assert.deepEqual(r.errors, ['reseau']);
});

test('la page change de forme : une erreur qui le dit -- surtout pas « aucune offre »', async () => {
  const r = await discover({ fetch: fauxFetch('<html><body>Un defi Cloudflare</body></html>'), now: T });
  assert.equal(r.complete, false);
  assert.deepEqual(r.offers, []);
  assert.match(r.errors[0], /bloc des offres absent/);
});

/* ------------------------------------------------------------ le magasin et le registre */

test('Fab est un magasin : son nom, son hote, sa source', () => {
  assert.equal(STORES.FAB, 'fab');
  assert.equal(STORE_LABELS.fab, 'Fab (Epic)');
  assert.equal(storeFromUrl(`https://www.fab.com/listings/${UID_FARM}`), STORES.FAB);
  assert.equal(storeFromUrl('https://fab.com/limited-time-free'), STORES.FAB);
  assert.notEqual(storeFromUrl('https://notfab.com/x'), STORES.FAB);
  assert.ok(FIRST_PARTY_SOURCES.includes(NAME));
});

test('detecte, annonce, jamais reclame : Fab n\'est ni reclamable ni activable par l\'option Steam', () => {
  assert.ok(DETECT_ONLY_STORES.includes(STORES.FAB));
  assert.ok(!CLAIMABLE_STORES.includes(STORES.FAB));
  assert.ok(!claimableStoresFor({ steamAutoClaim: true }).includes(STORES.FAB));
});

test('la source ne tourne que si le magasin est suivi', () => {
  const base = { activeSources: ['epic-api', 'gamerpower'] };
  assert.ok(!activeSourcesFor(base).includes(NAME));
  assert.ok(activeSourcesFor({ ...base, watchedStores: ['epic', 'fab'] }).includes(NAME));
  assert.ok(!activeSourcesFor({ activeSources: ['fab'], watchedStores: ['epic'] }).includes(NAME), 'decoche : coupee, meme listee');
  assert.ok(activeSourcesFor({ ...base, steamAutoClaim: true }).includes('steam'), 'l\'option Steam garde son effet');

  const reg = SOURCES[NAME];
  assert.equal(reg.authoritativeFor, STORES.FAB);
  assert.equal(reg.completeList, true);
  assert.equal(reg.onlyWhenActive, true);
  assert.equal(reg.autoClaim, false);
  assert.ok(reg.minIntervalMs >= HOUR);
});

test('le filtre : une offre Fab n\'est jamais reclamee par l\'extension, et dit pourquoi', () => {
  const [o] = mapFabOffers(blade(), T).offers;
  const verdict = judge(o, {}, { supportedStores: CLAIMABLE_STORES });
  assert.equal(verdict.claimable, false);
  assert.match(verdict.reason, /magasin|store/i);
});

/* ------------------------------------------------------------ dans un vrai cycle */

function sourceFactice(name, reponses, options = {}) {
  let i = 0;
  return {
    name,
    completeList: true,
    authoritativeFor: options.authoritativeFor,
    onlyWhenActive: options.onlyWhenActive,
    minIntervalMs: 0,
    appels: 0,
    async discover() {
      this.appels++;
      const r = reponses[Math.min(i, reponses.length - 1)];
      i++;
      return r;
    },
  };
}

const jeuPc = (title) => makeOffer({ source: 'test', store: STORES.EPIC, storeId: title, title, url: `https://store.epicgames.com/p/${title}` });
const rep = (offers) => ({ offers, dropped: [], errors: [], complete: true });

async function cycleFab({ watched }) {
  const faux = fakeChrome({ now: T });
  const fab = sourceFactice(NAME, [rep([]), rep(mapFabOffers(blade(), T + DAY).offers)], { onlyWhenActive: true, authoritativeFor: STORES.FAB });
  const pc = sourceFactice('test', [rep([jeuPc('Jeu A')])]);
  await faux.chrome.storage.local.set({ [KEYS.SETTINGS]: { activeSources: ['test'], watchedStores: watched } });
  const notifications = [];
  const run = (now) => runCycle({
    chrome: faux.chrome, now, sources: { test: pc, [NAME]: fab },
    notify: async (n) => { notifications.push(n); }, updateBadge: async () => {}, record: () => {},
    force: true, fetch: async () => ({ ok: false, status: 503 }),
  });
  await run(T);
  await run(T + DAY);
  return { fab, pc, notifications, faux };
}

test('« Verifier maintenant » ne paie pas la source Fab pour un magasin non suivi', async () => {
  const { fab, pc } = await cycleFab({ watched: ['epic', 'gog'] });
  assert.equal(pc.appels, 2);
  assert.equal(fab.appels, 0);
});

test('suivi : les assets sont annonces, et restent au catalogue sans etre reclames', async () => {
  const { fab, notifications, faux } = await cycleFab({ watched: ['epic', 'fab'] });
  assert.equal(fab.appels, 2);
  const textes = notifications.map((n) => `${n.title} ${n.text}`).join('\n');
  assert.match(textes, /Ready Map Vol 2/);
  const stocke = await faux.chrome.storage.local.get([KEYS.OFFERS]);
  const catalogue = Object.values(stocke[KEYS.OFFERS] || {});
  const fabs = catalogue.filter((o) => o.store === STORES.FAB);
  assert.equal(fabs.length, 3);
  assert.ok(fabs.every((o) => o.state !== 'claiming' && o.state !== 'resolved' && !o.attempts), 'jamais tentee');
});

/* ------------------------------------------------------------ l'acces au site */

test('Fab n\'est pas dans les hotes du manifeste : il se demande en cochant, et les deux manifestes le permettent', () => {
  for (const fichier of ['../manifest.json', '../manifest.firefox.json']) {
    const manifeste = JSON.parse(readFileSync(new URL(fichier, import.meta.url), 'utf8'));
    const hotes = [...(manifeste.host_permissions || []), ...(manifeste.content_scripts || []).flatMap((c) => c.matches || [])];
    assert.ok(!hotes.some((h) => /fab\.com/.test(h)), `${fichier} : aucun acces permanent a fab.com`);
    assert.equal(declaresOptionalOrigin(manifeste, 'https://www.fab.com/' + '*'), true, `${fichier} : l'acces peut etre demande`);
  }
});
