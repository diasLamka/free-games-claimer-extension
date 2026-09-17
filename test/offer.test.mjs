/* Tests du modele d'Offre.
 *
 * Module pur, importe directement : pas de harnais vm ici, contrairement aux
 * tests du moteur ES5.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORES,
  STATES,
  normaliseTitle,
  storeFromTitle,
  storeFromPlatforms,
  storeFromUrl,
  detectStore,
  readDate,
  strongKey,
  weakKey,
  makeOffer,
  matchUp,
  merge,
  isExpired,
  urgency,
  byUrgency,
} from '../watch/offer.js';

/* --------------------------------------------------------------- titres */

test('normaliserTitre retire accents, ponctuation et casse', () => {
  assert.equal(normaliseTitle('Brütal Legend'), 'brutal legend');
  assert.equal(normaliseTitle("Assassin's Creed: Origins"), 'assassin s creed origins');
  assert.equal(normaliseTitle('  Leaper   '), 'leaper');
  assert.equal(normaliseTitle(''), '');
  assert.equal(normaliseTitle(null), '');
});

test('normaliserTitre retire le suffixe ajoute par l\'agregateur', () => {
  // Titres reels releves le 2026-08-27.
  assert.equal(normaliseTitle('Brutal Legend (itchio) Giveaway'), 'brutal legend');
  assert.equal(normaliseTitle('Leaper (IndieGala) Giveaway'), 'leaper');
  assert.equal(normaliseTitle('Together After Dark (Epic Games) Giveaway'), 'together after dark');
  assert.equal(normaliseTitle('Dwarven Realms (Steam) Key Giveaway'), 'dwarven realms');
});

test('un meme jeu annonce par deux sources se normalise pareil', () => {
  // C'est toute la raison d'etre de la normalisation : l'agregateur decore le
  // titre, l'API Epic ne le fait pas.
  assert.equal(
    normaliseTitle('Together After Dark (Epic Games) Giveaway'),
    normaliseTitle('Together After Dark'),
  );
});

/* -------------------------------------------------------------- magasins */

test('magasinDepuisTitre lit le suffixe entre parentheses', () => {
  assert.equal(storeFromTitle('Brutal Legend (itchio) Giveaway'), STORES.ITCHIO);
  assert.equal(storeFromTitle('Leaper (IndieGala) Giveaway'), STORES.INDIEGALA);
  assert.equal(storeFromTitle('X (Epic Games) Giveaway'), STORES.EPIC);
  assert.equal(storeFromTitle('X (Steam) Key Giveaway'), STORES.STEAM);
  assert.equal(storeFromTitle('X (GOG) Giveaway'), STORES.GOG);
  assert.equal(storeFromTitle('Un jeu sans parentheses'), null);
  assert.equal(storeFromTitle('X (Mobile) Giveaway'), null);
});

test('magasinDepuisPlateformes ignore les supports qui ne sont pas des boutiques', () => {
  // Valeurs reelles observees dans l'API.
  assert.equal(storeFromPlatforms('PC, Epic Games Store'), STORES.EPIC);
  assert.equal(storeFromPlatforms('PC, Steam'), STORES.STEAM);
  assert.equal(storeFromPlatforms('PC, Itch.io, DRM-Free'), STORES.ITCHIO);
  // "PC, DRM-Free" ne designe aucune boutique : il ne doit rien decider.
  assert.equal(storeFromPlatforms('PC, DRM-Free'), null);
  assert.equal(storeFromPlatforms('PC'), null);
  assert.equal(storeFromPlatforms('Android, iOS'), null);
  assert.equal(storeFromPlatforms('VR'), null);
  assert.equal(storeFromPlatforms(''), null);
});

test('magasinDepuisUrl reconnait les hotes des magasins', () => {
  assert.equal(storeFromUrl('https://store.epicgames.com/p/cardpocalypse'), STORES.EPIC);
  assert.equal(storeFromUrl('https://www.gog.com/game/x'), STORES.GOG);
  assert.equal(storeFromUrl('https://store.steampowered.com/app/1'), STORES.STEAM);
  assert.equal(storeFromUrl('https://dev.itch.io/jeu'), STORES.ITCHIO);
  assert.equal(storeFromUrl('https://luna.amazon.fr/claims/home'), STORES.AMAZON);
  assert.equal(storeFromUrl('https://exemple.test/x'), null);
  assert.equal(storeFromUrl('pas une url'), null);
  assert.equal(storeFromUrl(null), null);
});

test('un hote ne doit pas matcher par simple sous-chaine', () => {
  // "notepicgames.com" ou "gog.com.attaquant.test" ne sont pas nos magasins.
  assert.equal(storeFromUrl('https://notepicgames.com/x'), null);
  assert.equal(storeFromUrl('https://gog.com.exemple.test/x'), null);
});

test('detecterMagasin suit la priorite URL > titre > plateformes', () => {
  // L'URL resolue est la seule verite : elle l'emporte sur un titre trompeur.
  assert.equal(detectStore({
    title: 'X (IndieGala) Giveaway',
    platforms: 'PC, DRM-Free',
    url: 'https://store.epicgames.com/p/x',
  }), STORES.EPIC);

  // Sans URL, le titre l'emporte sur platforms.
  assert.equal(detectStore({
    title: 'X (Itch.io) Giveaway',
    platforms: 'PC, DRM-Free',
  }), STORES.ITCHIO);

  // Sans titre exploitable, platforms sert de repli.
  assert.equal(detectStore({
    title: 'X Giveaway',
    platforms: 'PC, Epic Games Store',
  }), STORES.EPIC);

  assert.equal(detectStore({ title: 'X', platforms: 'PC' }), STORES.UNKNOWN);
  assert.equal(detectStore({}), STORES.UNKNOWN);
});

/* ----------------------------------------------------------------- dates */

test('lireDate refuse une date naive sans fuseau, au lieu de deviner', () => {
  // La supposition douce a deja coute : ces dates etaient lues comme de l'UTC
  // alors qu'elles sont en heure de New York. Quatre heures d'ecart, dans le
  // sens qui fait expirer les offres trop tot, et aucune erreur levee.
  assert.equal(readDate('2026-08-26 21:23:06'), null);
  assert.equal(readDate('2026-08-27 23:59:00'), null);
});

test('lireDate lit une date naive dans le fuseau que la source indique', () => {
  // 2026-08-20 11:02:34 a New York (EDT, UTC-4) = 15:02:34 UTC.
  assert.equal(
    readDate('2026-08-20 11:02:34', 'America/New_York'),
    Date.UTC(2026, 7, 20, 15, 2, 34),
  );
  // En janvier, New York est a UTC-5.
  assert.equal(
    readDate('2026-01-20 11:00:00', 'America/New_York'),
    Date.UTC(2026, 0, 20, 16, 0, 0),
  );
  assert.equal(
    readDate('2026-08-26 21:23:06', 'UTC'),
    Date.UTC(2026, 7, 26, 21, 23, 6),
  );
});

test('lireDate lit sans aide une date qui porte son fuseau', () => {
  assert.equal(readDate('2026-08-26T21:23:06Z'), Date.UTC(2026, 7, 26, 21, 23, 6));
  assert.equal(readDate('2026-08-26T21:23:06.000Z'), Date.UTC(2026, 7, 26, 21, 23, 6));
  assert.equal(readDate('2026-08-26T23:23:06+02:00'), Date.UTC(2026, 7, 26, 21, 23, 6));
});

test('le recoupement qui a revele le bug reste verrouille', () => {
  // L'API Epic ouvre Cardpocalypse a 2026-08-20T15:00:00Z ; l'agregateur le
  // publie a "2026-08-20 11:02:34". Une publication ne peut pas preceder
  // l'ouverture de l'offre.
  const ouvertureEpic = Date.parse('2026-08-20T15:00:00.000Z');
  const publication = readDate('2026-08-20 11:02:34', 'America/New_York');
  assert.ok(publication >= ouvertureEpic, 'publication anterieure a l\'ouverture');
  assert.ok(publication - ouvertureEpic < 10 * 60 * 1000, 'ecart superieur a dix minutes');
});

test('lireDate rend null sur ce qui n\'est pas une date', () => {
  // 8 offres sur 20 arrivent avec "N/A".
  assert.equal(readDate('N/A'), null);
  assert.equal(readDate('n/a'), null);
  assert.equal(readDate(''), null);
  assert.equal(readDate('   '), null);
  assert.equal(readDate(null), null);
  assert.equal(readDate(undefined), null);
  assert.equal(readDate('pas une date'), null);
  assert.equal(readDate(NaN), null);
});

test('lireDate accepte un horodatage deja numerique', () => {
  assert.equal(readDate(1756246986000), 1756246986000);
});

/* -------------------------------------------------------------- identite */

test('cleForte n\'existe qu\'avec un identifiant de magasin', () => {
  assert.equal(strongKey({ store: 'epic', storeId: 'cardpocalypse' }), 'epic:cardpocalypse');
  assert.equal(strongKey({ store: 'epic', storeId: null }), null);
  assert.equal(strongKey({ storeId: 'x' }), null);
  assert.equal(strongKey(null), null);
});

test('cleFaible repose sur le titre normalise', () => {
  assert.equal(
    weakKey({ store: 'epic', title: 'Together After Dark (Epic Games) Giveaway' }),
    'epic:titre:together after dark',
  );
  assert.equal(weakKey({ store: 'epic', title: '' }), null);
});

/* ---------------------------------------------------------- construction */

test('creerOffre ne garde que des URL http(s) venues des sources', () => {
  const o = makeOffer({
    title: 'Piege',
    url: 'javascript:alert(1)',
    resolveUrl: 'chrome://settings',
    image: 'pas une url',
  });
  assert.equal(o.url, null);
  assert.equal(o.resolveUrl, null);
  assert.equal(o.image, null);

  const ok = makeOffer({ title: 'Leaper', url: 'https://store.epicgames.com/p/leaper', image: 'http://cdn.example/x.jpg' });
  assert.equal(ok.url, 'https://store.epicgames.com/p/leaper');
  assert.equal(ok.image, 'http://cdn.example/x.jpg');
});

test('creerOffre normalise tout ce qui entre', () => {
  const o = makeOffer({
    source: 'gamerpower',
    sourceId: 3316,
    title: 'Leaper (IndieGala) Giveaway',
    platforms: 'PC, DRM-Free',
    naiveDateZone: 'America/New_York',
    start: '2026-08-26 07:55:48',
    end: 'N/A',
    resolveUrl: 'https://www.gamerpower.com/open/leaper-indiegala-giveaway',
    worth: '$4.99',
  });

  assert.equal(o.source, 'gamerpower');
  assert.equal(o.sourceId, '3316');           // toujours une chaine
  assert.equal(o.store, STORES.INDIEGALA); // depuis le titre, pas platforms
  assert.equal(o.normalisedTitle, 'leaper');
  assert.equal(o.start, Date.UTC(2026, 7, 26, 11, 55, 48)); // 07:55 a New York
  assert.equal(o.end, null);                   // "N/A" n'est pas une date
  assert.equal(o.state, STATES.DISCOVERED);
  assert.equal(o.storeId, null);
  assert.equal(o.url, null);
});

/* ------------------------------------------------------------ rapprochement */

test('rapprocher retrouve la meme offre par cle forte malgre un titre different', () => {
  const catalog = {
    a: makeOffer({ store: 'epic', storeId: 'together-after-dark', title: 'Together After Dark' }),
  };
  const venantDeLAgregateur = makeOffer({
    store: 'epic',
    storeId: 'together-after-dark',
    title: 'Un titre marketing completement different',
  });
  assert.equal(matchUp(catalog, venantDeLAgregateur), catalog.a);
});

test('rapprocher retrouve la meme offre par titre quand aucun identifiant n\'est connu', () => {
  const catalog = {
    a: makeOffer({ source: 'epic-api', store: 'epic', title: 'Together After Dark' }),
  };
  const venantDeLAgregateur = makeOffer({
    source: 'gamerpower',
    store: 'epic',
    title: 'Together After Dark (Epic Games) Giveaway',
  });
  assert.equal(matchUp(catalog, venantDeLAgregateur), catalog.a);
});

test('deux jeux homonymes sur des magasins differents restent distincts', () => {
  const catalog = {
    a: makeOffer({ store: 'epic', title: 'Limbo' }),
  };
  const surGog = makeOffer({ store: 'gog', title: 'Limbo' });
  assert.equal(matchUp(catalog, surGog), null);
});

test('rapprocher tolere un catalogue vide', () => {
  assert.equal(matchUp({}, makeOffer({ title: 'X' })), null);
  assert.equal(matchUp(null, makeOffer({ title: 'X' })), null);
});

/* ----------------------------------------------------------------- fusion */

test('fusionner ne remplace jamais une information par une absence', () => {
  const known = makeOffer({
    store: 'epic',
    storeId: 'x',
    title: 'Jeu X',
    url: 'https://store.epicgames.com/p/x',
    end: '2026-09-03T23:59:00.000Z',
    worth: '$19.99',
  });
  const pauvre = makeOffer({ store: 'epic', title: 'Jeu X' });

  const f = merge(known, pauvre);
  assert.equal(f.storeId, 'x');
  assert.equal(f.url, 'https://store.epicgames.com/p/x');
  assert.equal(f.end, Date.UTC(2026, 8, 3, 23, 59, 0));
  assert.equal(f.worth, '$19.99');
});

test('fusionner complete ce qui manquait', () => {
  const pauvre = makeOffer({ store: STORES.UNKNOWN, title: 'Jeu X' });
  const riche = makeOffer({
    store: 'epic',
    storeId: 'x',
    title: 'Jeu X',
    url: 'https://store.epicgames.com/p/x',
    end: '2026-09-03T23:59:00.000Z',
  });

  const f = merge(pauvre, riche);
  assert.equal(f.store, 'epic');   // "unknown" se laisse remplacer
  assert.equal(f.storeId, 'x');
  assert.equal(f.url, 'https://store.epicgames.com/p/x');
  assert.equal(f.end, Date.UTC(2026, 8, 3, 23, 59, 0));
});

test('la source de reference l\'emporte sur la date de fin, dans les deux sens', () => {
  // L'API Epic donne l'instant exact de fermeture ; l'agregateur arrondit a
  // 23:59 et dans un autre fuseau. Sans priorite par champ, la premiere source
  // a decouvrir l'offre figeait sa date pour toujours.
  const depuisEpic = makeOffer({
    source: 'epic-api', store: 'epic', storeId: 'x', title: 'Jeu X',
    end: '2026-09-03T15:00:00.000Z',
  });
  const depuisAgregateur = makeOffer({
    source: 'gamerpower', store: 'epic', title: 'Jeu X (Epic Games) Giveaway',
    naiveDateZone: 'America/New_York', end: '2026-09-03 23:59:00',
  });

  const exact = Date.parse('2026-09-03T15:00:00.000Z');
  assert.equal(merge(depuisEpic, depuisAgregateur).end, exact, 'Epic puis agregateur');
  assert.equal(merge(depuisAgregateur, depuisEpic).end, exact, 'agregateur puis Epic');
});

test('la fusion enregistre la provenance de chaque champ conteste', () => {
  const depuisAgregateur = makeOffer({
    source: 'gamerpower', store: 'epic', title: 'Jeu X (Epic Games) Giveaway',
    naiveDateZone: 'America/New_York', end: '2026-09-03 23:59:00',
    resolveUrl: 'https://www.gamerpower.com/open/x',
  });
  const depuisEpic = makeOffer({
    source: 'epic-api', store: 'epic', storeId: 'x', title: 'Jeu X',
    url: 'https://store.epicgames.com/p/x?lang=fr', end: '2026-09-03T15:00:00.000Z',
  });

  const f = merge(depuisAgregateur, depuisEpic);
  assert.equal(f.origin.end, 'epic-api');
  assert.equal(f.origin.url, 'epic-api');
  assert.equal(f.origin.storeId, 'epic-api');
  // L'URL de resolution n'est pas un champ conteste : seul l'agregateur la donne.
  assert.equal(f.resolveUrl, 'https://www.gamerpower.com/open/x');
});

test('la vignette suit le meme ordre de fiabilite que les autres champs', () => {
  const epic = makeOffer({
    source: 'epic-api', store: 'epic', storeId: 'x', title: 'Jeu X',
    image: 'https://cdn1.epicgames.com/offer/x/cards2_1200x1600',
  });
  const agregateur = makeOffer({
    source: 'gamerpower', store: 'epic', title: 'Jeu X (Epic Games) Giveaway',
    image: 'https://www.gamerpower.com/offers/1/abc.jpg',
  });

  const attendu = 'https://cdn1.epicgames.com/offer/x/cards2_1200x1600';
  assert.equal(merge(epic, agregateur).image, attendu);
  assert.equal(merge(agregateur, epic).image, attendu);
});

test('une offre sans vignette porte quand meme le champ', () => {
  assert.equal(makeOffer({ title: 'X' }).image, null);
});

test('une source moins fiable ne degrade pas un champ deja renseigne', () => {
  const bon = makeOffer({
    source: 'epic-api', store: 'epic', storeId: 'x', title: 'Jeu X',
    url: 'https://store.epicgames.com/p/x?lang=fr',
  });
  const moinsBon = makeOffer({
    source: 'gamerpower', store: 'epic', title: 'Jeu X (Epic Games) Giveaway',
    url: 'https://exemple.test/mauvaise-url',
  });
  assert.equal(merge(bon, moinsBon).url, 'https://store.epicgames.com/p/x?lang=fr');
});

test('fusionner tolere une moitie absente', () => {
  const o = makeOffer({ title: 'X' });
  assert.equal(merge(null, o), o);
  assert.equal(merge(o, null), o);
});

/* --------------------------------------------------------------- urgence */

const T = Date.UTC(2026, 7, 27, 12, 0, 0);

test('estExpiree ne se prononce pas sans date de fin', () => {
  assert.equal(isExpired({ end: T - 1 }, T), true);
  assert.equal(isExpired({ end: T }, T), true);
  assert.equal(isExpired({ end: T + 1 }, T), false);
  assert.equal(isExpired({ end: null }, T), false);
  assert.equal(isExpired(null, T), false);
});

test('une fin inconnue passe en tete de file, pas en queue', () => {
  // Le piege : lire "pas de date de fin" comme "pas urgent" ferait perdre les
  // 8 offres sur 20 que l'agregateur livre sans date.
  const inconnue = makeOffer({ title: 'Inconnue', end: 'N/A' });
  const bientot = makeOffer({ title: 'Bientot', end: '2026-08-27T23:59:00.000Z' });
  const plusTard = makeOffer({ title: 'Plus tard', end: '2026-09-30T23:59:00.000Z' });

  assert.ok(urgency(inconnue, T) < urgency(bientot, T));
  assert.ok(urgency(bientot, T) < urgency(plusTard, T));

  const triees = byUrgency([plusTard, bientot, inconnue], T);
  assert.deepEqual(triees.map((o) => o.title), ['Inconnue', 'Bientot', 'Plus tard']);
});

test('a urgence egale, la plus recemment publiee passe devant', () => {
  const ancienne = makeOffer({ title: 'Ancienne', end: 'N/A', start: '2026-07-01T10:00:00.000Z' });
  const recente = makeOffer({ title: 'Recente', end: 'N/A', start: '2026-08-26T10:00:00.000Z' });
  const triees = byUrgency([ancienne, recente], T);
  assert.deepEqual(triees.map((o) => o.title), ['Recente', 'Ancienne']);
});

test('parUrgence ne modifie pas la liste d\'origine', () => {
  const list = [
    makeOffer({ title: 'B', end: '2026-09-30T23:59:00.000Z' }),
    makeOffer({ title: 'A', end: '2026-08-27T23:59:00.000Z' }),
  ];
  const before = list.map((o) => o.title);
  byUrgency(list, T);
  assert.deepEqual(list.map((o) => o.title), before);
});
