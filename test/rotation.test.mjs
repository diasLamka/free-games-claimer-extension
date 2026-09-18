/* La rotation hebdomadaire d'Epic, et la mort des offres qu'elle remplace.
 *
 * Signale le 2026-09-18, au lendemain d'une rotation : les jeux de la semaine
 * ecoulee etaient encore listes dans le popup et encore annonces. Trois causes
 * distinctes, tenues ici :
 *
 *   - une offre SANS date de fin n'avait aucun moyen de mourir : le balayage
 *     des disparitions ne regardait que le champ `source` de l'entree, que
 *     `merge` fige a la premiere source qui l'a vue ;
 *   - ni les notifications ni le badge ne consultaient l'horloge : l'etat
 *     EXPIRED n'est pose qu'au passage d'un cycle ;
 *   - la regle « jeudi 17 h » n'existait nulle part, alors que clock.js a ete
 *     ecrit pour elle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { integrate, openOffers, STORE_VANISH_DELAY_MS } from '../watch/catalog.js';
import { toNotify } from '../watch/cycle.js';
import { makeOffer, merge, STATES, STORES } from '../watch/offer.js';
import { DEFAULT_SCHEDULES, schedulesWithDefaults } from '../watch/schedule/rules.js';
import { nextOccurrence, localParts, validRule } from '../watch/schedule/clock.js';
import { NAME as EPIC_SOURCE } from '../watch/sources/epic.js';
import { SOURCES } from '../watch/sources/index.js';

const T = Date.UTC(2026, 8, 18, 10, 0, 0); // vendredi 18 septembre 2026, 12 h a Paris

/* ------------------------------------------------ la regle de rotation */

const regleEpic = () => DEFAULT_SCHEDULES[EPIC_SOURCE][0];

test('la regle Epic est valide et ancree sur le fuseau ou elle est vraie', () => {
  const rule = regleEpic();
  assert.ok(validRule(rule));
  /* Le fuseau n'est pas celui de l'utilisateur : Epic publie a 11 h heure de
     New York. Ecrire « 17:00 Europe/Paris » serait faux les semaines ou les
     deux continents n'ont pas encore change d'heure ensemble. */
  assert.equal(rule.zone, 'America/New_York');
  assert.deepEqual([...rule.dayCount], [4]);
  assert.equal(rule.hour, 11);
});

test('la prochaine rotation tombe toujours un jeudi a 11 h a New York', () => {
  /* Quatre instants pieges de 2026, dont les deux fenetres ou l'Europe et les
     Etats-Unis sont decales autrement que d'habitude. */
  const instants = [
    Date.UTC(2026, 0, 10),  // janvier, hiver des deux cotes
    Date.UTC(2026, 2, 15),  // USA en heure d'ete, Europe pas encore
    Date.UTC(2026, 6, 1),   // ete des deux cotes
    Date.UTC(2026, 9, 28),  // Europe revenue a l'heure d'hiver, USA pas encore
  ];

  for (const from of instants) {
    const at = nextOccurrence(regleEpic(), from);
    const ny = localParts(at.instant, 'America/New_York');
    assert.equal(ny.hour, 11, `heure de New York au ${new Date(from).toISOString()}`);
    assert.equal(ny.minute, 0);
    assert.equal(at.weekday, 4, 'un jeudi');
  }
});

test('a Paris, cette regle tombe a 17 h -- sauf quand les fuseaux sont decales', () => {
  const heureParis = (from) => localParts(nextOccurrence(regleEpic(), from).instant, 'Europe/Paris').hour;

  assert.equal(heureParis(Date.UTC(2026, 0, 10)), 17, 'janvier');
  assert.equal(heureParis(Date.UTC(2026, 6, 1)), 17, 'juillet');

  /* Ces deux-la sont la raison d'etre du fuseau nomme : entre le passage a
     l'heure d'ete americain (8 mars) et l'europeen (29 mars), 11 h a New York
     vaut 16 h a Paris. Une regle ecrite « 17:00 Paris » aurait rate
     l'ouverture d'une heure, deux fois par an. */
  assert.equal(heureParis(Date.UTC(2026, 2, 15)), 16, 'mi-mars');
  assert.equal(heureParis(Date.UTC(2026, 9, 28)), 16, 'fin octobre');
});

test('un calendrier pose par l\'utilisateur remplace le notre, meme vide', () => {
  assert.equal(schedulesWithDefaults({})[EPIC_SOURCE].length, 1);
  assert.equal(schedulesWithDefaults(undefined)[EPIC_SOURCE].length, 1);
  /* Une liste vide est un CHOIX -- couper la regle -- pas une absence. */
  assert.deepEqual(schedulesWithDefaults({ [EPIC_SOURCE]: [] })[EPIC_SOURCE], []);
});

/* --------------------------------- une offre sans date de fin peut mourir */

const offreSansFin = (extra = {}) => makeOffer({
  source: 'gamerpower',
  sourceId: 3316,
  store: STORES.EPIC,
  title: 'Jeu de la semaine derniere (Epic Games) Giveaway',
  url: 'https://www.gamerpower.com/jeu',
  end: null,
  seenAt: T - 3 * 24 * 60 * 60 * 1000,
  ...extra,
});

/** Un cycle ou la source d'Epic publie une liste complete SANS l'offre. */
function cycleSansLoffre(catalog, now) {
  return integrate(catalog, [], {
    now,
    source: EPIC_SOURCE,
    completeList: true,
    store: STORES.EPIC,
  });
}

test('la source du magasin fait mourir une offre sans date de fin, au deuxieme constat', () => {
  const depart = integrate({}, [offreSansFin()], { now: T - 1000, source: 'gamerpower', completeList: false });

  const un = cycleSansLoffre(depart.catalog, T);
  assert.equal(un.vanished.length, 0, 'le premier constat ne tue pas : il note l\'absence');

  const deux = cycleSansLoffre(un.catalog, T + 60000);
  assert.equal(deux.vanished.length, 1, 'le second constat termine l\'offre');
  assert.equal(Object.values(deux.catalog)[0].state, STATES.EXPIRED);
});

test('elle meurt meme si c\'est l\'agregateur qui l\'avait decouverte', () => {
  const depart = integrate({}, [offreSansFin()], { now: T - 1000, source: 'gamerpower', completeList: false });
  const entree = Object.values(depart.catalog)[0];

  /* Le champ `source` dit « gamerpower » et le restera : merge le fige. C'est
     `store` qui doit commander, sinon l'entree echappe a jamais au balayage
     d'Epic -- c'est exactement ce qui laissait les jeux de jeudi a l'ecran le
     vendredi. */
  assert.equal(entree.source, 'gamerpower');
  assert.equal(entree.store, STORES.EPIC);

  const fin = cycleSansLoffre(cycleSansLoffre(depart.catalog, T).catalog, T + 60000);
  assert.equal(Object.values(fin.catalog)[0].state, STATES.EXPIRED);
});

test('une source qui ne fait autorite sur aucun magasin ne termine rien chez les autres', () => {
  const depart = integrate({}, [offreSansFin()], { now: T - 1000, source: 'gamerpower', completeList: false });

  /* L'agregateur couvre plusieurs magasins : son silence sur une offre Epic ne
     prouve rien sur la promotion. Sans `store`, seule la regle d'origine
     s'applique -- et elle accorde les 24 h de grace. */
  const un = integrate(depart.catalog, [], { now: T, source: 'gamerpower', completeList: true });
  const deux = integrate(un.catalog, [], { now: T + 60000, source: 'gamerpower', completeList: true });
  assert.equal(deux.vanished.length, 0);
  assert.equal(Object.values(deux.catalog)[0].state, STATES.DISCOVERED);
});

test('la grace courte est bien une affaire de constats, pas de duree', () => {
  assert.equal(STORE_VANISH_DELAY_MS, 0);
});

test('Epic et Steam font autorite sur leur magasin, l\'agregateur sur aucun', () => {
  assert.equal(SOURCES['epic-api'].authoritativeFor, STORES.EPIC);
  assert.equal(SOURCES.steam.authoritativeFor, STORES.STEAM);
  assert.equal(SOURCES.gamerpower.authoritativeFor, undefined);
  assert.equal(SOURCES.gog.authoritativeFor, undefined);
});

/* ------------------------------- l'horloge decide, pas l'etat enregistre */

const offreFinie = () => makeOffer({
  source: 'epic-api',
  store: STORES.EPIC,
  storeId: 'jeu-de-jeudi',
  title: 'Jeu de jeudi',
  url: 'https://store.epicgames.com/p/jeu-de-jeudi',
  end: T - 60 * 60 * 1000, // finie il y a une heure
  seenAt: T - 1000,
});

test('une offre finie n\'est plus annoncee, meme pas encore marquee expiree', () => {
  const catalog = { a: { ...offreFinie(), state: STATES.DISCOVERED, notifiedAt: null } };

  /* L'etat dit DISCOVERED parce qu'aucun cycle n'est passe depuis la rotation.
     C'est precisement le cas ou une notification partait pour un jeu qui
     n'etait plus a prendre. */
  assert.equal(toNotify(catalog, T).length, 0);
  assert.equal(toNotify(catalog, T - 2 * 60 * 60 * 1000).length, 1, 'avant sa fin, elle s\'annonce');
});

test('le badge ne compte plus une offre finie', () => {
  const catalog = { a: { ...offreFinie(), state: STATES.DISCOVERED } };
  assert.equal(openOffers(catalog, T).length, 0);
  assert.equal(openOffers(catalog, T - 2 * 60 * 60 * 1000).length, 1);
});

test('une fin INCONNUE n\'est pas une fin passee', () => {
  const catalog = { a: { ...offreSansFin(), state: STATES.DISCOVERED, notifiedAt: null } };
  /* L'agregateur laisse huit offres sur vingt sans date : les taire serait
     pire que de les annoncer. C'est le balayage par magasin qui les traite. */
  assert.equal(toNotify(catalog, T).length, 1);
  assert.equal(openOffers(catalog, T).length, 1);
});

/* ------------------------------------- le prix du magasin bat l'agregateur */

const epicAvecPrix = () => makeOffer({
  source: 'epic-api',
  store: STORES.EPIC,
  storeId: 'meme-jeu',
  title: 'Meme jeu',
  url: 'https://store.epicgames.com/p/meme-jeu',
  worth: '23,99 €',
  end: T + 86400000,
});

const agregateurAvecPrix = () => makeOffer({
  source: 'gamerpower',
  sourceId: 42,
  store: STORES.EPIC,
  title: 'Meme jeu (Epic Games) Giveaway',
  url: 'https://www.gamerpower.com/meme-jeu',
  worth: '$19.99',
});

test('le prix d\'Epic gagne, quel que soit l\'ordre de passage des sources', () => {
  /* Avant, `worth` tombait dans « le dernier non vide gagne » : le meme jeu
     valait 23,99 euros ou 19,99 dollars selon l'ordre des sources dans le
     cycle. La fusion doit etre commutative, comme pour la date de fin. */
  assert.equal(merge(epicAvecPrix(), agregateurAvecPrix()).worth, '23,99 €');
  assert.equal(merge(agregateurAvecPrix(), epicAvecPrix()).worth, '23,99 €');
});

test('un prix d\'agregateur reste quand le magasin n\'en donne aucun', () => {
  const sansPrix = makeOffer({ ...epicAvecPrix(), worth: null });
  assert.equal(merge(sansPrix, agregateurAvecPrix()).worth, '$19.99');
});

/* ------------------------------------ une offre expiree peut revenir */

test('un jeu remis en promotion redevient visible', () => {
  const finie = { ...offreFinie(), state: STATES.EXPIRED, verdict: 'disparue de la source' };
  const catalog = { [finie.catalogKey || 'a']: { ...finie, catalogKey: 'a' } };

  /* Epic le republie, avec une NOUVELLE fenetre qui court. Sans reveil, il
     serait reste invisible pour toujours : markExpired saute les etats
     terminaux et merge conserve l'etat existant. */
  const revenu = makeOffer({ ...offreFinie(), end: T + 7 * 24 * 60 * 60 * 1000 });
  const apres = integrate(catalog, [revenu], {
    now: T, source: EPIC_SOURCE, completeList: true, store: STORES.EPIC,
  });

  const entree = Object.values(apres.catalog)[0];
  assert.equal(entree.state, STATES.DISCOVERED);
  assert.equal(entree.verdict, null);
  assert.equal(openOffers(apres.catalog, T).length, 1);
});

test('un jeu deja reclame, lui, ne revient pas', () => {
  const pris = { ...offreFinie(), state: STATES.RESOLVED, catalogKey: 'a' };
  const apres = integrate({ a: pris }, [makeOffer({ ...offreFinie(), end: T + 86400000 })], {
    now: T, source: EPIC_SOURCE, completeList: true, store: STORES.EPIC,
  });

  /* Le reproposer ferait rouvrir un onglet sur un compte reel pour un jeu
     deja dans la bibliotheque. */
  assert.equal(Object.values(apres.catalog)[0].state, STATES.RESOLVED);
});

test('une source peut corriger sa propre date de fin, une autre non', () => {
  const hier = makeOffer({ ...epicAvecPrix(), end: T - 86400000 });
  const corrige = makeOffer({ ...epicAvecPrix(), end: T + 86400000 });

  /* Deux lectures de la MEME source : la seconde est plus recente, elle gagne.
     Sans cela, Epic ne pouvait pas corriger une date qu'il avait lui-meme
     publiee, et un jeu remis en promotion restait expire pour toujours. */
  assert.equal(merge(hier, corrige).end, corrige.end);

  /* Entre sources differentes, la stabilite a egalite reste : c'est elle qui
     rend la fusion commutative, et c'est teste ailleurs. */
  const parAgregateur = makeOffer({ ...agregateurAvecPrix(), end: T + 7 * 86400000 });
  assert.equal(merge(corrige, parAgregateur).end, corrige.end);
});
