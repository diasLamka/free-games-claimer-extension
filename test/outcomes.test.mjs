/* Ce qui est passe, et comment ca s'est termine.
 *
 * Le bilan compte ce qui a ete PRIS. Personne ne garde ce qui a ete RATE --
 * et c'est pourtant la seule colonne qui apprenne quelque chose : une offre
 * expiree sans etre reclamee est soit un reglage trop strict, soit une panne,
 * soit un choix. Aujourd'hui les trois se ressemblent, parce qu'il n'en reste
 * aucune trace.
 *
 * Le catalogue ne peut pas servir de memoire : il est purge a quatre-vingt-dix
 * jours (`RETENTION_MS`), et le motif d'ecart n'est calcule qu'a l'affichage,
 * donc jamais ecrit. Passe ce delai, l'information n'existe plus nulle part.
 *
 * Ce module fige donc l'issue A L'INSTANT OU L'OFFRE SE TERMINE -- la seule
 * fenetre pendant laquelle tout est encore connu. Meme raisonnement que
 * watch/library.js pour les acquisitions, avec une difference qui compte :
 * une acquisition est rare et precieuse, donc le registre n'a pas de plafond ;
 * une issue arrive pour CHAQUE offre qui passe, donc celui-ci en a un.
 *
 * La page qui lira tout cela viendra plus tard. Le figement part maintenant
 * parce qu'une page branchee sur un magasin vide n'apprend rien : il faut que
 * la collecte ait tourne avant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEY_OUTCOMES,
  MAX_OUTCOMES,
  OUTCOMES,
  TAKING_VERDICTS,
  makeOutcome,
  noteOutcomes,
  outcomeEntries,
  outcomeKey,
  noteOutcomesFromCatalog,
} from '../watch/outcomes.js';
import { STATES, makeOffer } from '../watch/offer.js';
import { DEFAULT_SETTINGS, KEYS } from '../watch/storage.js';
import { runCycle } from '../watch/cycle.js';
import { fakeChrome } from './fake-chrome.mjs';
import { VERDICTS } from '../watch/claim.js';

const T = Date.UTC(2026, 8, 22, 12, 0, 0);
const JOUR = 86400000;

function entree(over = {}) {
  return {
    catalogKey: 'epic:cardpocalypse',
    store: 'epic',
    storeId: 'cardpocalypse',
    source: 'epic-api',
    title: 'Cardpocalypse',
    url: 'https://store.epicgames.com/p/cardpocalypse',
    image: 'https://cdn.example/card.jpg',
    worth: '19.99',
    end: T - JOUR,
    seenAt: T - 8 * JOUR,
    updatedAt: T,
    state: STATES.EXPIRED,
    verdict: null,
    ...over,
  };
}

/* ------------------------------------------------------------ l'identite */

test('l\'identite d\'une issue est celle que le catalogue lui donnait', () => {
  assert.equal(outcomeKey(entree()), 'epic:cardpocalypse');
});

test('sans cle de catalogue, magasin et identifiant suffisent', () => {
  /* Une entree peut arriver d'un chemin qui ne porte pas sa cle. Retomber sur
     une cle construite vaut mieux que de perdre l'issue -- ou, pire, d'en
     ecrire une sous « undefined » qui ecraserait la suivante. */
  assert.equal(outcomeKey(entree({ catalogKey: undefined })), 'epic:cardpocalypse');
});

/* ------------------------------------------------------------- le verdict */

test('une offre expiree sans reclamation est RATEE', () => {
  const o = makeOutcome(entree(), { now: T });

  assert.equal(o.outcome, OUTCOMES.MISSED);
  assert.equal(o.state, STATES.EXPIRED);
});

test('une offre reclamee est PRISE', () => {
  const o = makeOutcome(entree({ state: STATES.RESOLVED, verdict: VERDICTS.CLAIMED }), { now: T });

  assert.equal(o.outcome, OUTCOMES.TAKEN);
});

test('« deja possede » compte comme prise : le jeu est au compte', () => {
  /* Ce n'est pas une reussite de l'extension, mais la question posee par la
     page est « l'ai-je ? », pas « qui l'a mise la ? ». La compter comme ratee
     ferait chercher une panne la ou tout va bien. */
  const o = makeOutcome(entree({ state: STATES.RESOLVED, verdict: VERDICTS.ALREADY_REDEEMED }), { now: T });

  assert.equal(o.outcome, OUTCOMES.TAKEN);
});

test('un verdict qui ne conclut pas ne se laisse pas classer', () => {
  /* Un echec, un defi de securite, un compte a associer : l'offre est
     terminee, et on ne sait pas si le jeu est au compte. Le dire est utile ;
     deviner ne l'est pas. */
  for (const verdict of [VERDICTS.FAILURE, VERDICTS.CHALLENGE, VERDICTS.LINK_ACCOUNT, VERDICTS.UNDETERMINED]) {
    const o = makeOutcome(entree({ state: STATES.RESOLVED, verdict }), { now: T });
    assert.equal(o.outcome, OUTCOMES.UNKNOWN, verdict);
  }
});

test('les verdicts qui valent prise existent tous dans watch/claim.js', () => {
  /* Cette liste est recopiee ici pour garder le module pur. Une recopie qui
     ne se verifie pas derive : un verdict renomme laisserait ce module
     classer « ratee » une offre bel et bien prise, en silence. */
  const connus = new Set(Object.values(VERDICTS));
  for (const v of TAKING_VERDICTS) assert.ok(connus.has(v), `verdict inconnu : ${v}`);
});

/* -------------------------------------------------------- ce qui est fige */

test('l\'issue emporte de quoi remplir une page sans le catalogue', () => {
  const o = makeOutcome(entree(), { now: T });

  assert.equal(o.title, 'Cardpocalypse');
  assert.equal(o.store, 'epic');
  assert.equal(o.worth, '19.99');
  assert.equal(o.url, 'https://store.epicgames.com/p/cardpocalypse');
  assert.equal(o.end, T - JOUR);
  assert.equal(o.firstSeen, T - 8 * JOUR);
  assert.equal(o.ts, T, 'l\'instant du figement');
  assert.equal(o.source, 'epic-api');
});

test('le figement exige un instant, comme tout ce qui est pur ici', () => {
  /* Meme regle que catalog.openOffers : une valeur par defaut a Date.now()
     ferait rentrer l'horloge par la fenetre dans un module pur, et les tests
     de la veille deviendraient dependants de l'heure a laquelle ils tournent. */
  assert.throws(() => makeOutcome(entree(), {}), TypeError);
});

/* ---------------------------------------------------------- l'integration */

test('seules les offres terminees donnent une issue', () => {
  const encours = [
    entree({ state: STATES.DISCOVERED }),
    entree({ state: STATES.QUEUED }),
    entree({ state: STATES.CLAIMING }),
  ];

  const r = noteOutcomes({}, encours, { now: T });

  assert.equal(r.added, 0);
  assert.deepEqual(r.outcomes, {});
});

test('la PREMIERE issue gagne : un cycle rejoue ne redate rien', () => {
  /* Le cycle est rejouable par conception -- c'est ce qui remplace le verrou.
     Une seconde passe sur la meme offre terminee ne doit pas repousser la
     date de l'issue, sinon toute la chronologie de la page glisse a chaque
     reveil du service worker. */
  const un = noteOutcomes({}, [entree()], { now: T });
  const deux = noteOutcomes(un.outcomes, [entree()], { now: T + 5 * JOUR });

  assert.equal(deux.added, 0);
  assert.equal(deux.outcomes['epic:cardpocalypse'].ts, T);
});

test('deux offres distinctes donnent deux issues', () => {
  const r = noteOutcomes({}, [
    entree(),
    entree({ catalogKey: 'gog:tyranny', store: 'gog', storeId: 'tyranny', title: 'Tyranny' }),
  ], { now: T });

  assert.equal(r.added, 2);
  assert.equal(Object.keys(r.outcomes).length, 2);
});

/* ------------------------------------------------------------- le plafond */

test('le magasin est borne, et ce sont les plus vieilles qui partent', () => {
  /* Une issue arrive pour chaque offre qui passe. Sans plafond, le magasin
     grossit indefiniment dans chrome.storage.local -- et c'est la meme zone
     que le catalogue, le journal et les codes en attente. */
  let outcomes = {};
  for (let i = 0; i < MAX_OUTCOMES + 25; i++) {
    const r = noteOutcomes(outcomes, [entree({
      catalogKey: `epic:jeu-${i}`,
      storeId: `jeu-${i}`,
    })], { now: T + i });
    outcomes = r.outcomes;
  }

  const gardees = Object.keys(outcomes);
  assert.equal(gardees.length, MAX_OUTCOMES);
  assert.ok(!outcomes['epic:jeu-0'], 'la plus vieille est partie');
  assert.ok(outcomes[`epic:jeu-${MAX_OUTCOMES + 24}`], 'la plus recente est la');
});

/* -------------------------------------------------------------- lectures */

test('la lecture rend les issues de la plus recente a la plus ancienne', () => {
  const r = noteOutcomes({}, [
    entree({ catalogKey: 'a:1', updatedAt: T }),
    entree({ catalogKey: 'b:2', updatedAt: T }),
  ], { now: T });
  const r2 = noteOutcomes(r.outcomes, [entree({ catalogKey: 'c:3' })], { now: T + JOUR });

  const liste = outcomeEntries(r2.outcomes);

  assert.equal(liste.length, 3);
  assert.equal(liste[0].ts, T + JOUR);
});

test('la cle de stockage vit dans l\'espace de la veille', () => {
  /* Regle 1 de watch/storage.js : aucune cle de la veille ne touche a
     l'espace FGC_* du moteur, ou vivent les codes de rachat. */
  assert.ok(KEY_OUTCOMES.startsWith('veille:'));
});

/* ------------------------------------------------- le balayage du catalogue */

test('le balayage prend tout ce qui est terminal, quel que soit le chemin', () => {
  /* Une offre devient terminale par trois chemins : sa date passe
     (markExpired), elle disparait de sa source (noteVanished), ou une
     reclamation la resout. Suivre les trois listes separement voudrait dire
     trois cablages et trois occasions d'en oublier un. Balayer le catalogue
     avant d'ecrire les prend tous, et reste idempotent puisque la premiere
     issue gagne. */
  const catalog = {
    'epic:a': entree({ catalogKey: 'epic:a', state: STATES.EXPIRED }),
    'gog:b': entree({ catalogKey: 'gog:b', state: STATES.RESOLVED, verdict: VERDICTS.CLAIMED }),
    'epic:c': entree({ catalogKey: 'epic:c', state: STATES.QUEUED }),
  };

  const r = noteOutcomesFromCatalog({}, catalog, { now: T });

  assert.equal(r.added, 2);
  assert.equal(r.outcomes['epic:a'].outcome, OUTCOMES.MISSED);
  assert.equal(r.outcomes['gog:b'].outcome, OUTCOMES.TAKEN);
  assert.ok(!r.outcomes['epic:c'], 'une offre en cours n\'a pas d\'issue');
});

test('un catalogue vide ou absent ne fait rien exploser', () => {
  assert.equal(noteOutcomesFromCatalog({}, {}, { now: T }).added, 0);
  assert.equal(noteOutcomesFromCatalog({}, null, { now: T }).added, 0);
});

/* --------------------------------------------------- de bout en bout */

test('un cycle fige l\'issue d\'une offre expiree, sous sa cle de veille', async () => {
  const faux = fakeChrome({ now: T });

  /* Une offre dont la date est passee, et une source qui ne rend rien : le
     cycle doit la passer en expiree, puis figer son issue. */
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, activeSources: ['epic-api'] },
    [KEYS.STATE]: { booted: true },
    [KEYS.OFFERS]: {
      'epic:cardpocalypse': makeOffer({
        source: 'epic-api',
        store: 'epic',
        storeId: 'cardpocalypse',
        title: 'Cardpocalypse',
        url: 'https://store.epicgames.com/p/cardpocalypse',
        worth: '19.99',
        end: new Date(T - JOUR).toISOString(),
        seenAt: T - 8 * JOUR,
      }),
    },
  });

  await runCycle({
    chrome: faux.chrome,
    now: T,
    sources: {
      'epic-api': {
        name: 'epic-api',
        completeList: true,
        minIntervalMs: 0,
        async discover() { return { offers: [], dropped: [], errors: [] }; },
      },
    },
    fetch: async () => ({ ok: true, async json() { return {}; }, async text() { return ''; } }),
    claimableStores: [],
  });

  const issues = faux.payload()[KEY_OUTCOMES];
  assert.ok(issues, 'la cle des issues est ecrite');

  const liste = outcomeEntries(issues);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].title, 'Cardpocalypse');
  assert.equal(liste[0].outcome, OUTCOMES.MISSED);
  assert.equal(liste[0].worth, '19.99', 'la valeur survit a la purge du catalogue');
});
