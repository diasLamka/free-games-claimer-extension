/* Ce que l'extension a le droit de faire toute seule sur un vrai compte.
 *
 * Chaque test de ce fichier correspond a un comportement qui, avant la 2.12.0,
 * ouvrait un onglet et posait une requete sur un compte reel sans que personne
 * puisse le voir. Ce ne sont pas des cas limites : ce sont les cas normaux.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { claimCandidates, reclaimAbandoned, runCycle, KEY_STOP } from '../watch/cycle.js';
import { claimAllNow } from '../watch/commands.js';
import { fakeChrome } from './fake-chrome.mjs';
import {
  VERDICTS, FINAL_VERDICTS, HUMAN_VERDICTS, MANUAL_VERDICTS, MAX_ATTEMPTS, nextAttemptAt, BUDGET_MS,
  awaitVerdict, tabVanished, expectClosure, openHiddenTab, surfaceTab, sweepTabs,
} from '../watch/claim.js';
import { STATES, STORES } from '../watch/offer.js';

const T = Date.UTC(2026, 7, 27, 12, 0, 0);
const MIN = 60000;
const HOUR = 3600000;
const DAY = 24 * HOUR;

const CLAIMABLES = [STORES.EPIC, STORES.GOG, STORES.AMAZON];

const offer = (o = {}) => ({
  store: STORES.EPIC,
  title: 'Jeu',
  url: 'https://store.epicgames.com/p/jeu',
  state: STATES.CONFIRMED,
  verdict: null,
  alreadyOwned: null,
  attempts: 0,
  worth: '$19.99',
  keepable: true,
  catalogKey: 'epic:jeu',
  ...o,
});

const catalog = (...offres) => Object.fromEntries(
  offres.map((o, i) => [o.catalogKey || `k${i}`, o]),
);

const candidats = (cat, opts = {}) =>
  claimCandidates(cat, {}, { claimableStores: CLAIMABLES, now: T, ...opts }).candidates;

/* ------------------------------------------- magasin decoche = intouchable */

test('un magasin decoche n\'est plus reclame', () => {
  /* Le trou le plus couteux d'avant la 2.12.0 : watchedStores etait applique
     aux annonces et a l'affichage, jamais a la reclamation. Decocher Amazon
     faisait disparaitre les offres Luna de la liste, et l'extension continuait
     d'ouvrir des onglets sur le compte Amazon la nuit -- invisible par
     construction, puisque l'offre n'apparaissait plus nulle part. */
  const cat = catalog(
    offer({ store: STORES.EPIC, catalogKey: 'epic:a' }),
    offer({ store: STORES.AMAZON, catalogKey: 'amazon:b', url: 'https://luna.amazon.com/claims/b' }),
  );

  const sans = candidats(cat).map((o) => o.store).sort();
  assert.deepEqual(sans, ['amazon', 'epic'], 'sans reglage, les deux sont candidates');

  const avec = candidats(cat, { watchedStores: ['epic', 'gog', 'steam'] }).map((o) => o.store);
  assert.deepEqual(avec, ['epic'], 'Amazon decoche ne doit plus etre ouvert');
});

test('une liste de magasins vide ne bloque pas tout', () => {
  // Un reglage absent ne doit pas arreter la reclamation : ce mode d'echec
  // ressemble a « l'extension ne marche plus » et se diagnostique tres mal.
  const cat = catalog(offer());
  assert.equal(candidats(cat, { watchedStores: [] }).length, 1);
  assert.equal(candidats(cat, { watchedStores: undefined }).length, 1);
});

/* -------------------------------------------------- offre pas encore ouverte */

test('une offre qui n\'a pas encore ouvert n\'est pas ouverte', () => {
  /* `start` etait rempli par makeOffer et personne ne le lisait : ouvrir un
     onglet sur une page qui n'offre encore rien consommait un jeton du plafond
     horaire, et rendait un echec qui declenchait un nouvel essai. */
  const cat = catalog(offer({ start: T + 2 * DAY }));
  assert.equal(candidats(cat).length, 0);

  const ouverte = catalog(offer({ start: T - HOUR }));
  assert.equal(candidats(ouverte).length, 1);
});

/* ------------------------------------------------------------ recul et abandon */

test('une offre en echec attend avant d\'etre retentee', () => {
  const cat = catalog(offer({
    verdict: VERDICTS.FAILURE,
    attempts: 1,
    nextAttemptAt: T + 30 * MIN,
  }));
  assert.equal(candidats(cat).length, 0, 'le recul doit tenir');

  const echue = catalog(offer({
    verdict: VERDICTS.FAILURE,
    attempts: 1,
    nextAttemptAt: T - MIN,
  }));
  assert.equal(candidats(echue).length, 1, 'passe le recul, on retente');
});

test('une offre abandonnee apres cinq essais n\'est plus ouverte', () => {
  /* `attempts` etait incremente et jamais relu. Un changement de DOM chez un
     magasin devenait un onglet ouvert toutes les heures sur un vrai compte,
     indefiniment -- et rien dans l'interface ne le disait. */
  const cat = catalog(offer({ verdict: VERDICTS.FAILURE, attempts: MAX_ATTEMPTS }));
  assert.equal(candidats(cat).length, 0);
});

test('le recul croit, puis s\'arrete', () => {
  // L'argument est le nombre d'essais DEJA faits : apres le premier echec on
  // attend le premier palier, pas le second.
  assert.equal(nextAttemptAt(1, T), T + 15 * MIN);
  assert.equal(nextAttemptAt(2, T), T + HOUR);
  assert.equal(nextAttemptAt(3, T), T + 4 * HOUR);
  assert.equal(nextAttemptAt(4, T), T + 12 * HOUR, 'le dernier palier tient');
  assert.equal(nextAttemptAt(MAX_ATTEMPTS, T), null, 'au-dela, c\'est fini');
});

test('un verdict qui attend un humain echappe au recul et a l\'abandon', () => {
  /* Se reconnecter est une chose que l'utilisateur peut faire, et l'extension
     doit encore etre prete quand il l'a faite. L'abandonner apres cinq essais
     la rendrait muette au moment precis ou elle redevient utile. */
  for (const v of HUMAN_VERDICTS.filter((x) => !MANUAL_VERDICTS.includes(x))) {
    const cat = catalog(offer({
      verdict: v,
      attempts: MAX_ATTEMPTS + 3,
      nextAttemptAt: T + 10 * DAY,
    }));
    assert.equal(candidats(cat).length, 1, `${v} doit rester candidat`);
  }
});

test('un bouton a montrer laisse un onglet ouvert, respecte son recul, et SE FINIT (2.106.0)', () => {
  /* Comme un defi : la page est remontee dans la fenetre de l'utilisateur, et la
     rouvrir a chaque cycle empilerait les onglets. Mais, a la difference d'un defi,
     « montrez-moi le bouton » n'est PLUS « jamais abandonne » : avec la 2.102.0, un
     jeu deja a vous (ou une offre finie) le redemandait a l'infini. La question est
     posee une fois par offre ; ensuite, recul ordinaire et abandon au cinquieme
     essai, comme tout echec. */
  assert.ok(MANUAL_VERDICTS.includes(VERDICTS.TEACH), 'l\'onglet doit rester ouvert');
  assert.ok(!HUMAN_VERDICTS.includes(VERDICTS.TEACH), 'plus de « jamais abandonne »');
  const enAttente = catalog(offer({ verdict: VERDICTS.TEACH, attempts: 1, nextAttemptAt: T + 10 * MIN }));
  assert.equal(candidats(enAttente).length, 0, 'un onglet a ete rouvert avant le recul');
  const echu = catalog(offer({ verdict: VERDICTS.TEACH, attempts: 2, nextAttemptAt: T - MIN }));
  assert.equal(candidats(echu).length, 1, 'passe le recul, on retente (sans reposer la question)');
  const abandonne = catalog(offer({ verdict: VERDICTS.TEACH, attempts: MAX_ATTEMPTS, nextAttemptAt: T - MIN }));
  assert.equal(candidats(abandonne).length, 0, 'au cinquieme essai, c\'est fini');
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.TEACH), 'elle revient apres l\'apprentissage (resetForTeaching)');
});

test('un defi de securite respecte son recul, mais n\'est jamais abandonne', () => {
  /* Chaque essai laisse un onglet ouvert dans la fenetre de l'utilisateur : le
     rouvrir a chaque cycle les empilait (constate en 2.13.4, deux onglets pour
     la meme offre a une minute d'intervalle). */
  const enAttente = catalog(offer({ verdict: VERDICTS.CHALLENGE, attempts: 1, nextAttemptAt: T + 10 * MIN }));
  assert.equal(candidats(enAttente).length, 0, 'un onglet de defi a ete rouvert avant le recul');

  const echu = catalog(offer({ verdict: VERDICTS.CHALLENGE, attempts: MAX_ATTEMPTS + 3, nextAttemptAt: T - MIN }));
  assert.equal(candidats(echu).length, 1, 'un defi ne doit jamais etre abandonne');
});

/* ------------------------------------------------- « failed » n'est pas final */

test('un echec n\'est pas definitif, mais il n\'est plus infini non plus', () => {
  /* `failed` hors de FINAL_VERDICTS remettait l'offre en QUEUED et la retentait
     a chaque cycle. Le corriger en l'ajoutant a FINAL_VERDICTS aurait enterre
     un echec transitoire : c'est le recul qui borne, pas la liste. */
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.FAILURE), 'un echec merite une seconde chance');
  assert.ok(!FINAL_VERDICTS.includes(VERDICTS.UNDETERMINED), 'l\'incertitude non plus');
  assert.ok(FINAL_VERDICTS.includes(VERDICTS.EXPIRED), 'une offre terminee ne revient pas');
  assert.ok(FINAL_VERDICTS.includes(VERDICTS.CLAIMED));
});

test('un verdict definitif sort definitivement', () => {
  for (const v of FINAL_VERDICTS) {
    assert.equal(candidats(catalog(offer({ verdict: v }))).length, 0, `${v}`);
  }
});

/* --------------------------------------- rattrapage apres mort du worker */

test('une reclamation interrompue est rattrapee, pas perdue', () => {
  /* Le worker MV3 meurt a cinq minutes par evenement, soit exactement le budget
     d'UNE reclamation. Sans rattrapage, l'entree reste marquee CLAIMING pour
     toujours et l'offre n'est plus jamais candidate. */
  const cat = catalog(offer({
    state: STATES.CLAIMING,
    attemptStartedAt: T - BUDGET_MS - MIN,
  }));

  const { catalog: apres, recovered } = reclaimAbandoned(cat, T);
  assert.equal(recovered, 1);

  const o = Object.values(apres)[0];
  assert.equal(o.state, STATES.QUEUED);
  // Ni un succes qu'on n'a pas constate, ni un echec qui ferait recommencer
  // tout de suite : l'onglet a peut-etre reclame avant de mourir.
  assert.equal(o.verdict, VERDICTS.UNDETERMINED);
  assert.equal(o.attempts, 1);
  assert.equal(o.nextAttemptAt, T + 15 * MIN);
  assert.equal(o.attemptStartedAt, null);
});

test('une reclamation encore dans son budget n\'est pas interrompue', () => {
  const cat = catalog(offer({ state: STATES.CLAIMING, attemptStartedAt: T - MIN }));
  const { recovered, catalog: apres } = reclaimAbandoned(cat, T);
  assert.equal(recovered, 0);
  assert.equal(Object.values(apres)[0].state, STATES.CLAIMING);
});

test('une marque sans horodatage est datee, pas jugee', () => {
  // Deviner ferait perdre une offre valide. On pose l'horodatage, le cycle
  // suivant tranchera.
  const cat = catalog(offer({ state: STATES.CLAIMING, attemptStartedAt: undefined }));
  const { recovered, catalog: apres } = reclaimAbandoned(cat, T);
  assert.equal(recovered, 0);
  assert.equal(Object.values(apres)[0].attemptStartedAt, T);
  assert.equal(Object.values(apres)[0].state, STATES.CLAIMING);
});

test('le rattrapage ne touche pas ce qui n\'est pas en cours', () => {
  const cat = catalog(
    offer({ catalogKey: 'a', state: STATES.CONFIRMED }),
    offer({ catalogKey: 'b', state: STATES.RESOLVED, verdict: VERDICTS.CLAIMED }),
  );
  const { catalog: apres, recovered } = reclaimAbandoned(cat, T);
  assert.equal(recovered, 0);
  assert.deepEqual(apres, cat);
});

test('reclaimAbandoned ne modifie pas le catalogue qu\'on lui passe', () => {
  const cat = catalog(offer({ state: STATES.CLAIMING, attemptStartedAt: T - BUDGET_MS - MIN }));
  const avant = JSON.parse(JSON.stringify(cat));
  reclaimAbandoned(cat, T);
  assert.deepEqual(cat, avant, 'une fonction pure ne mute pas son entree');
});

/* ------------------------------------------------ ordre de travail conserve */

test('l\'ordre d\'urgence est conserve : fin inconnue d\'abord', () => {
  const cat = catalog(
    offer({ catalogKey: 'a', end: T + 5 * DAY }),
    offer({ catalogKey: 'b', end: null }),
    offer({ catalogKey: 'c', end: T + HOUR }),
  );
  const ordre = candidats(cat).map((o) => o.catalogKey);
  // Une date qu'on ignore n'est pas une echeance lointaine.
  assert.equal(ordre[0], 'b');
  assert.equal(ordre[1], 'c');
});

/* ------------------------------------------------------- onglet disparu */

test('un onglet ferme resout ses attentes tout de suite', async () => {
  /* Avant : l'attente courait jusqu'a son budget, cinq minutes. Comme les
     reclamations s'enchainent en serie et que le catalogue n'est ecrit qu'apres
     la boucle, un seul onglet ferme immobilisait le cycle assez longtemps pour
     que le worker soit tue avant l'ecriture. */
  const attente = awaitVerdict(4242, 'fgc-verdict', 5 * 60000);

  const resolus = tabVanished(4242);
  assert.equal(resolus, 1);

  // Sans la resolution, ce await tiendrait cinq minutes et le test expirerait.
  assert.equal(await attente, null);
});

test('toutes les attentes d\'un onglet sont resolues, pas seulement le verdict', () => {
  // Un onglet ferme pendant les quarante-cinq secondes de chargement laissait
  // l'attente de chargement tourner jusqu'a son terme.
  awaitVerdict(77, 'fgc-pret', 30000);
  awaitVerdict(77, 'fgc-verdict', 300000);
  assert.equal(tabVanished(77), 2);
});

test('notre propre fermeture n\'est pas un incident', () => {
  awaitVerdict(88, 'fgc-verdict', 300000);
  expectClosure(88);
  assert.equal(tabVanished(88), 0, 'une fermeture annoncee ne resout rien de force');
  // Et le drapeau ne sert qu'une fois : le prochain onglet 88 sera bien traite.
  assert.equal(tabVanished(88), 1);
});

test('un onglet inconnu ne casse rien', () => {
  assert.equal(tabVanished(999999), 0);
});

/* ------------------------------------------------------- arret d'urgence */

test('l\'arret d\'urgence annule le cycle avant toute ecriture', async () => {
  /* Avant TOUT, y compris la verification de schema : un interrupteur qui
     demande a l'extension de ne rien faire ne doit pas commencer par ecrire un
     numero de version. */
  const { chrome, journal } = fakeChrome();
  await chrome.storage.local.set({ [KEY_STOP]: true });
  const ecritures = journal.filter((e) => e.op === 'set').length;

  const out = await runCycle({
    chrome,
    now: T,
    sources: {},
    fetch: async () => { throw new Error('le reseau ne doit pas etre touche'); },
  });

  assert.equal(out.stopped, true);
  assert.equal(journal.filter((e) => e.op === 'set').length, ecritures, 'aucune ecriture');
});

test('l\'arret d\'urgence bloque aussi « Tout recuperer »', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ [KEY_STOP]: true });

  const out = await claimAllNow({ chrome, now: T, claimableStores: CLAIMABLES });
  assert.equal(out.stopped, true);
  assert.equal(out.claimed, 0);
});

test('sans arret, le cycle repart', async () => {
  const { chrome } = fakeChrome();
  await chrome.storage.local.set({ [KEY_STOP]: false });
  const out = await runCycle({ chrome, now: T, sources: {}, fetch: async () => ({}) });
  assert.notEqual(out.stopped, true);
});

/* ---------------------------------------------------- fenetre invisible */

test('la reclamation s\'ouvre dans une fenetre reduite, pas dans un onglet', async () => {
  /* Un onglet `active: false` ne vole pas le focus mais APPARAIT dans la barre
     d'onglets -- le voir surgir puis disparaitre ressemble a un navigateur
     hante. La fenetre reduite vit dans la barre des taches, hors de la vue. */
  const created = [];
  const chrome = {
    windows: {
      async create(opts) {
        created.push(opts);
        return { id: 7, tabs: [{ id: 42 }] };
      },
    },
    tabs: { async create() { throw new Error('le repli ne doit pas servir ici'); } },
  };

  const out = await openHiddenTab(chrome, 'https://store.epicgames.com/p/x');
  assert.deepEqual(out, { tabId: 42, windowId: 7, hidden: true });
  assert.equal(created[0].state, 'minimized');
  assert.equal(created[0].url, 'https://store.epicgames.com/p/x');
});

test('sans chrome.windows, on retombe sur l\'onglet inactif', async () => {
  // C'est aussi le chemin du harnais de test : son stub n'a pas de windows.
  const chrome = {
    tabs: { async create({ url, active }) { assert.equal(active, false); return { id: 9, url }; } },
  };
  const out = await openHiddenTab(chrome, 'https://x.test');
  assert.deepEqual(out, { tabId: 9, windowId: null, hidden: false });
});

test('une creation de fenetre qui echoue retombe sur l\'onglet, sans jeter', async () => {
  const chrome = {
    windows: { async create() { throw new Error('no window available'); } },
    tabs: { async create() { return { id: 11 }; } },
  };
  const out = await openHiddenTab(chrome, 'https://x.test');
  assert.equal(out.tabId, 11);
  assert.equal(out.hidden, false);
});

test('une fenetre creee sans onglet lisible est refermee, pas abandonnee', async () => {
  /* KEY_TABS ne connait que des identifiants d'onglet : une fenetre sans
     onglet suivi ne serait jamais balayee. */
  const removed = [];
  const chrome = {
    windows: {
      async create() { return { id: 5, tabs: [] }; },
      async remove(id) { removed.push(id); },
    },
    tabs: { async create() { return { id: 12 }; } },
  };
  const out = await openHiddenTab(chrome, 'https://x.test');
  assert.deepEqual(removed, [5]);
  assert.equal(out.tabId, 12);
});

test('un defi de securite fait remonter l\'onglet dans la fenetre de l\'utilisateur', async () => {
  /* L'invisibilite est la bonne politique tant que tout va bien ; a l'instant
     ou l'extension a besoin d'un humain, elle s'inverse : un onglet enterre
     dans une fenetre reduite ne serait jamais trouve. */
  const moved = [];
  const chrome = {
    windows: { async getLastFocused() { return { id: 3 }; } },
    tabs: { async move(tabId, opts) { moved.push({ tabId, ...opts }); } },
  };
  assert.equal(await surfaceTab(chrome, 42), true);
  assert.deepEqual(moved, [{ tabId: 42, windowId: 3, index: -1 }]);
});

test('surfaceTab n\'echoue jamais : sans fenetre utilisateur, il rend false', async () => {
  const chrome = { windows: { async getLastFocused() { throw new Error('aucune fenetre'); } } };
  assert.equal(await surfaceTab(chrome, 42), false);
});

test('surfaceTab ne deplace pas un onglet dans sa propre fenetre reduite (2.102.0)', async () => {
  /* La fenetre reduite qu'on vient d'ouvrir peut etre la « derniere utilisee » :
     y deplacer l'onglet, puis la refermer, perdait l'onglet a montrer. */
  const moved = [];
  const chrome = {
    windows: {
      async getLastFocused() { return { id: 9, state: 'minimized' }; },
      async getAll() { return [{ id: 9, state: 'minimized' }, { id: 2, state: 'normal' }]; },
    },
    tabs: { async get() { return { id: 42, windowId: 9 }; }, async move(tabId, opts) { moved.push({ tabId, ...opts }); } },
  };
  assert.equal(await surfaceTab(chrome, 42), true);
  assert.deepEqual(moved, [{ tabId: 42, windowId: 2, index: -1 }], 'dans la vraie fenetre de l\'utilisateur');
});

test('sans autre fenetre, c\'est la sienne qui remonte, et l\'appelant ne la ferme pas', async () => {
  const updates = [];
  const chrome = {
    windows: {
      async getLastFocused() { return { id: 9, state: 'minimized' }; },
      async getAll() { return [{ id: 9, state: 'minimized' }]; },
      async update(id, o) { updates.push({ id, ...o }); },
    },
    tabs: { async get() { return { id: 42, windowId: 9 }; }, async move() { throw new Error('ne doit pas bouger'); } },
  };
  assert.equal(await surfaceTab(chrome, 42), 'own');
  assert.deepEqual(updates, [{ id: 9, state: 'normal', focused: true }]);
});

/* ------------------------------------------- fenetres qui ne trainent pas */

test('le balayage ferme la FENETRE d\'une reclamation abandonnee', async () => {
  /* Un service worker mort en pleine reclamation laisse une fenetre reduite
     entiere -- et une page a pu y ouvrir d'autres onglets, que fermer notre
     seul onglet epargnerait. */
  const { chrome } = fakeChrome();
  const fermes = { windows: [], tabs: [] };
  chrome.windows = { async remove(id) { fermes.windows.push(id); } };
  chrome.tabs = { async remove(id) { fermes.tabs.push(id); } };

  await chrome.storage.session.set({
    'veille:onglets-pilotes': {
      101: { windowId: 7, openedAt: T - 10 * MIN, expire: T - MIN },
    },
  });

  const { closed } = await sweepTabs(chrome, T);
  assert.equal(closed, 1);
  assert.deepEqual(fermes.windows, [7], 'la fenetre entiere, pas l\'onglet');
  assert.deepEqual(fermes.tabs, [], 'pas de double fermeture');
});

test('le balayage retombe sur l\'onglet quand la fenetre resiste', async () => {
  const { chrome } = fakeChrome();
  const fermes = [];
  chrome.windows = { async remove() { throw new Error('deja fermee'); } };
  chrome.tabs = { async remove(id) { fermes.push(id); } };

  await chrome.storage.session.set({
    'veille:onglets-pilotes': {
      102: { windowId: 8, openedAt: T - 10 * MIN, expire: T - MIN },
    },
  });

  const { closed } = await sweepTabs(chrome, T);
  assert.equal(closed, 1);
  assert.deepEqual(fermes, [102]);
});

test('une entree sans fenetre (repli onglet inactif) se balaie comme avant', async () => {
  const { chrome } = fakeChrome();
  const fermes = [];
  chrome.tabs = { async remove(id) { fermes.push(id); } };

  await chrome.storage.session.set({
    'veille:onglets-pilotes': {
      103: { openedAt: T - 10 * MIN, expire: T - MIN },
    },
  });

  const { closed } = await sweepTabs(chrome, T);
  assert.equal(closed, 1);
  assert.deepEqual(fermes, [103]);
});
