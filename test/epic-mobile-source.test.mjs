/* La source des jeux mobiles d'Epic (2.57.0).
 *
 * Ecrite d'apres la mesure V8 du 2026-09-23 : la rubrique « mobile-*-free-
 * game » de l'API de decouverte, ses offres, `content.title`,
 * `mapping.slug`, `systemSpecs.platform`. Les reponses ci-dessous reprennent
 * exactement cette forme. `purchase` et `media`, non mesures, sont lus avec
 * prudence : ces tests tiennent ce qu'on en tire, et ce qu'on refuse d'en
 * tirer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NAME, PAGE_URL, discoverUrl, baseSlug, freeTopicOffers, readImage, readEnd, mapMobileOffers, discover,
} from '../watch/sources/epic-mobile.js';
import { SOURCES, CLAIMABLE_STORES, DETECT_ONLY_STORES, activeSourcesFor } from '../watch/sources/index.js';
import { STORES, STORE_LABELS, makeOffer } from '../watch/offer.js';
import { fakeChrome } from './fake-chrome.mjs';
import { runCycle } from '../watch/cycle.js';
import { KEYS } from '../watch/storage.js';
import { KEY_PHONE } from '../watch/phone.js';

const T = Date.parse('2026-09-24T18:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------ la forme mesuree */

const offre = (title, slug, platform, extra = {}) => ({
  offerId: `offre-${slug}`,
  sandboxId: 'bac',
  content: {
    title,
    catalogItemId: `cat-${slug}`,
    categories: ['freegames'],
    mapping: { slug },
    systemSpecs: { platform },
    ageRating: { ageRating: { title: 'PEGI 3' } },
    ...extra,
  },
});

/** Une reponse de /discover/home comme celles du rapport V8 : neuf rubriques. */
function decouverte(platform, gratuits, { sansRubrique = false } = {}) {
  const data = [
    { topicId: `mobile-${platform}-top`, type: 'tile', title: 'A la une', offers: [offre('Doki Doki Literature Club!', `doki-doki-literature-club-${platform}-467d8c`, platform)] },
    { topicId: `mobile-${platform}-genre-free`, type: 'tile', title: 'Free-to-play', offers: [offre('Fortnite', `fortnite-${platform}-aaaa11`, platform)] },
  ];
  if (!sansRubrique) data.splice(1, 0, { topicId: `mobile-${platform}-free-game`, type: 'hero', title: 'Jeux gratuits', offers: gratuits });
  return { __typename: 'DiscoverResponse', data, paging: { count: 10, start: 0, total: data.length } };
}

test('l\'adresse : la meme que la mesure, avec le pays et la langue choisis', () => {
  const u = new URL(discoverUrl('DE', 'de', 'ios'));
  assert.equal(u.host, 'egs-platform-service.store.epicgames.com');
  assert.equal(u.pathname, '/api/v2/public/discover/home');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    count: '10', country: 'DE', locale: 'de', platform: 'ios', start: '0', store: 'EGS',
  });
});

test('un slug par plateforme, un seul jeu', () => {
  assert.equal(baseSlug('calico-android-83faf9'), 'calico');
  assert.equal(baseSlug('calico-ios-868e00'), 'calico');
  assert.equal(baseSlug('merchanf-of-the-skies-android-6a55cb'), 'merchanf-of-the-skies');
  assert.equal(baseSlug('android-quest'), 'android-quest', 'un titre qui contient le mot garde son slug');
  for (const mauvais of [null, '', '../x', 'a b', 'x'.repeat(200)]) assert.equal(baseSlug(mauvais), null, String(mauvais));
});

test('seule la rubrique des jeux offerts compte ; son absence n\'est pas « aucun jeu »', () => {
  const r = decouverte('android', [offre('Calico', 'calico-android-83faf9', 'android')]);
  assert.deepEqual(freeTopicOffers(r).map((o) => o.content.title), ['Calico'], 'ni la une, ni les free-to-play');
  assert.deepEqual(freeTopicOffers(decouverte('android', [])), [], 'presente et vide : aucun jeu cette semaine');
  assert.equal(freeTopicOffers(decouverte('android', [], { sansRubrique: true })), null, 'absente : on ne sait plus');
  assert.equal(freeTopicOffers({ data: 'x' }), null);
});

/* ------------------------------------------------------------ ce qui n'est pas mesure */

test('la vignette : la premiere image https, ou rien', () => {
  assert.equal(readImage({ thumbnail: { imageSrc: 'https://cdn1.epicgames.com/offer/calico/wide.jpg?h=480' } }),
    'https://cdn1.epicgames.com/offer/calico/wide.jpg?h=480');
  assert.equal(readImage([{ type: 'video', src: 'https://cdn.example/v.mp4' }, { src: 'https://cdn.example/i.png' }]), 'https://cdn.example/i.png');
  assert.equal(readImage({ src: 'http://cdn.example/i.png' }), null, 'pas en clair');
  assert.equal(readImage({ src: 'javascript:alert(1)//.png' }), null);
  assert.equal(readImage(undefined), null);
});

test('la date de fin : une cle qui dit « fin », une date a venir -- ou rien', () => {
  const futur = '2026-10-01T15:00:00.000Z';
  assert.equal(readEnd({ discount: { discountEndDate: futur } }, T), Date.parse(futur));
  assert.equal(readEnd([{ promotion: { endDate: futur } }], T), Date.parse(futur));
  assert.equal(readEnd({ expiresAt: futur }, T), Date.parse(futur));
  assert.equal(readEnd({ weekend: futur, legend: futur, startDate: futur }, T), null, 'ni weekend, ni legend, ni debut');
  assert.equal(readEnd({ endDate: '2026-01-01T00:00:00Z' }, T), null, 'une fin passee ne dit rien');
  assert.equal(readEnd({ endDate: 'bientot' }, T), null);
  // Deux fins : la plus proche.
  assert.equal(readEnd({ a: { endDate: '2026-10-08T15:00:00Z' }, b: { endDate: futur } }, T), Date.parse(futur));
});

/* ------------------------------------------------------------ les offres */

test('Android et iOS : un jeu, deux plateformes, jamais reclamable', () => {
  const fin = '2026-10-01T15:00:00.000Z';
  const { offers, dropped } = mapMobileOffers({
    android: [offre('Calico', 'calico-android-83faf9', 'android', {
      media: { card: { imageSrc: 'https://cdn1.epicgames.com/calico.jpg' } },
      purchase: [{ discount: { discountEndDate: fin } }],
    })],
    ios: [
      offre('Calico', 'calico-ios-868e00', 'ios'),
      offre('Mutazione', 'mutazione-ios-c09172', 'ios'),
      { content: { title: '', mapping: { slug: 'x-ios-123456' } } },
    ],
  }, T);

  assert.equal(dropped.length, 1);
  assert.equal(offers.length, 2);
  const calico = offers.find((o) => o.title === 'Calico');
  assert.equal(calico.store, STORES.EPIC_MOBILE);
  assert.equal(calico.storeId, 'calico');
  assert.equal(calico.source, NAME);
  assert.equal(calico.platforms, 'Android, iOS');
  assert.equal(calico.url, PAGE_URL);
  assert.equal(calico.image, 'https://cdn1.epicgames.com/calico.jpg');
  assert.equal(calico.end, Date.parse(fin));
  assert.equal(calico.keepable, true);
  assert.equal(offers.find((o) => o.title === 'Mutazione').platforms, 'iOS');
  assert.equal(offers.find((o) => o.title === 'Mutazione').end, null, 'sans date lue : on ne sait pas');

  assert.equal(STORE_LABELS[STORES.EPIC_MOBILE], 'Epic Games (mobile)');
  assert.ok(!CLAIMABLE_STORES.includes(STORES.EPIC_MOBILE), 'ils se recuperent dans l\'appli, jamais par l\'extension');
  assert.ok(DETECT_ONLY_STORES.includes(STORES.EPIC_MOBILE));
});

/* ------------------------------------------------------------ la decouverte */

function fauxFetch(reponses) {
  const vus = [];
  const f = async (url, init) => {
    vus.push({ url, init });
    const plateforme = new URL(url).searchParams.get('platform');
    const r = reponses[plateforme];
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
  f.vus = vus;
  return f;
}

test('les deux plateformes lues : la liste est complete, sans cookies', async () => {
  const f = fauxFetch({
    android: decouverte('android', [offre('Calico', 'calico-android-83faf9', 'android')]),
    ios: decouverte('ios', [offre('Calico', 'calico-ios-868e00', 'ios')]),
  });
  const r = await discover({ fetch: f, now: T, country: 'FR', lang: 'fr' });
  assert.equal(r.complete, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.offers.map((o) => [o.title, o.platforms]), [['Calico', 'Android, iOS']]);
  assert.equal(f.vus.length, 2);
  for (const v of f.vus) assert.equal(v.init.credentials, 'omit');
});

test('une plateforme en panne : pas complete -- un jeu iOS ne doit pas passer pour termine', async () => {
  const r = await discover({
    fetch: fauxFetch({ android: decouverte('android', [offre('Calico', 'calico-android-83faf9', 'android')]), ios: 503 }),
    now: T,
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.errors, ['ios : HTTP 503']);
  assert.equal(r.offers.length, 1);
});

test('la rubrique disparue : une erreur qui le dit, et rien de conclu', async () => {
  const r = await discover({
    fetch: fauxFetch({ android: decouverte('android', [], { sansRubrique: true }), ios: new Error('reseau') }),
    now: T,
  });
  assert.equal(r.complete, false);
  assert.equal(r.offers.length, 0);
  assert.match(r.errors[0], /rubrique des jeux offerts absente/);
  assert.match(r.errors[1], /ios : reseau/);
});

/* ------------------------------------------------------------ l'activation */

test('la source ne tourne que si le magasin est suivi', () => {
  const base = { activeSources: ['epic-api', 'gamerpower'] };
  assert.ok(!activeSourcesFor(base).includes(NAME));
  assert.ok(activeSourcesFor({ ...base, watchedStores: ['epic', 'epic-mobile'] }).includes(NAME));
  assert.ok(!activeSourcesFor({ activeSources: ['epic-mobile'], watchedStores: ['epic'] }).includes(NAME), 'decoche : coupee, meme listee');
  // L'option Steam garde son effet.
  assert.ok(activeSourcesFor({ ...base, steamAutoClaim: true }).includes('steam'));

  const reg = SOURCES[NAME];
  assert.equal(reg.authoritativeFor, STORES.EPIC_MOBILE);
  assert.equal(reg.onlyWhenActive, true);
  assert.ok(reg.minIntervalMs >= 3 * HOUR);
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
const jeuMobile = (title) => makeOffer({ source: NAME, store: STORES.EPIC_MOBILE, storeId: title.toLowerCase(), title, url: PAGE_URL, platforms: 'Android, iOS' });
const rep = (offers) => ({ offers, dropped: [], errors: [], complete: true });

async function cycleMobile({ watched, phone }) {
  const faux = fakeChrome({ now: T });
  const mobile = sourceFactice(NAME, [rep([]), rep([jeuMobile('Calico')])], { onlyWhenActive: true, authoritativeFor: STORES.EPIC_MOBILE });
  const pc = sourceFactice('test', [rep([jeuPc('Jeu A')])]);
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { activeSources: ['test'], watchedStores: watched },
    ...(phone ? { [KEY_PHONE]: phone } : {}),
  });
  const appels = [];
  // Seuls les envois au telephone comptent : le cycle lit aussi les taux de change.
  const f = async (url, init) => {
    if (!String(url).startsWith('https://ntfy.sh/')) return { ok: false, status: 503 };
    appels.push({ url, init });
    return { ok: true, status: 200 };
  };
  const notifications = [];
  const run = (now) => runCycle({
    chrome: faux.chrome, now, sources: { test: pc, [NAME]: mobile },
    notify: async (n) => { notifications.push(n); }, updateBadge: async () => {}, record: () => {},
    force: true, fetch: f,
  });
  await run(T);
  await run(T + DAY);
  return { mobile, pc, appels, notifications };
}

test('« Verifier maintenant » ne paie pas la source mobile pour un magasin non suivi', async () => {
  const { mobile, pc } = await cycleMobile({ watched: ['epic', 'gog'] });
  assert.equal(pc.appels, 2);
  assert.equal(mobile.appels, 0);
});

test('suivi : le jeu mobile est annonce, et part au telephone -- une fois', async () => {
  const { mobile, appels, notifications } = await cycleMobile({
    watched: ['epic', 'epic-mobile'],
    phone: { on: true, url: 'https://ntfy.sh/fgc-test' },
  });
  assert.equal(mobile.appels, 2);
  assert.equal(notifications.length, 1);
  assert.match(`${notifications[0].title} ${notifications[0].text}`, /Calico/);
  assert.equal(appels.length, 1, 'le telephone, une fois');
  const u = new URL(appels[0].url);
  assert.match(u.searchParams.get('title'), /Calico/);
  assert.equal(u.searchParams.get('click'), PAGE_URL);
  assert.match(appels[0].init.body, /Android, iOS/);
});

test('l\'option « jeux mobiles » coupee : rien ne part au telephone', async () => {
  const { appels, notifications } = await cycleMobile({
    watched: ['epic', 'epic-mobile'],
    phone: { on: true, url: 'https://ntfy.sh/fgc-test', mobile: false },
  });
  assert.equal(notifications.length, 1, 'l\'ordinateur, lui, est prevenu');
  assert.equal(appels.length, 0);
});
