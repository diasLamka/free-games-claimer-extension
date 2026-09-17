/* Tests du mode repli.
 *
 * Deux proprietes comptent plus que les autres, et chaque test s'y rapporte :
 * le repli ne devient JAMAIS le mode par defaut (un onglet ferme rend la main
 * tout seul), et il ne ment pas sur ce qui ne va pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import {
  KEY_SENTINEL,
  FALLBACK_AFTER,
  BEAT_STALE_MS,
  BEAT_PERIOD_MS,
  QUICK_ATTEMPTS,
  QUICK_DELAY_MS,
  SLOW_DELAY_MS,
  beatDelay,
  failingSources,
  shouldOffer,
  recovered,
  reasonText,
  isDriving,
  writeBeat,
  readBeat,
  clearBeat,
} from '../watch/sentinel.js';

const T = Date.UTC(2026, 8, 17, 12, 0, 0);

const source = (extra = {}) => ({ consecutiveFailures: 0, lastError: null, lastSuccess: T - 3600000, ...extra });

/* ------------------------------------------------------------ diagnostic */

test('trois echecs consecutifs declenchent la proposition, pas deux', () => {
  // Le seuil vient du design (§10). Deux, et le recul ordinaire suffit encore.
  const deux = { gamerpower: source({ consecutiveFailures: 2 }) };
  const trois = { gamerpower: source({ consecutiveFailures: 3 }) };

  assert.equal(shouldOffer(deux), false);
  assert.equal(shouldOffer(trois), true);
  assert.equal(FALLBACK_AFTER, 3);
});

test('les sources en panne sortent de la plus cassee a la moins cassee', () => {
  const etats = {
    'epic-api': source({ consecutiveFailures: 3, lastError: 'HTTP 503' }),
    gamerpower: source({ consecutiveFailures: 7, lastError: 'Failed to fetch' }),
    steam: source({ consecutiveFailures: 0 }),
  };
  const casse = failingSources(etats);

  assert.deepEqual(casse.map((s) => s.name), ['gamerpower', 'epic-api']);
  assert.equal(casse[0].failures, 7);
  assert.equal(casse[0].lastError, 'Failed to fetch');
});

test('une source qui n\'a jamais reussi se distingue d\'une source tombee hier', () => {
  // L'interface doit pouvoir le dire : ce module ne masque pas l'absence.
  const etats = {
    jamais: source({ consecutiveFailures: 4, lastSuccess: undefined }),
    tombee: source({ consecutiveFailures: 4, lastSuccess: T - 86400000 }),
  };
  const casse = failingSources(etats);

  assert.equal(casse.find((s) => s.name === 'jamais').lastSuccess, null);
  assert.equal(casse.find((s) => s.name === 'tombee').lastSuccess, T - 86400000);
});

test('un etat illisible ne fait pas tomber la page', () => {
  assert.deepEqual(failingSources(null), []);
  assert.deepEqual(failingSources({ x: null }), []);
  assert.deepEqual(failingSources({ x: { consecutiveFailures: 'beaucoup' } }), []);
  assert.equal(reasonText([]), null);
  assert.equal(reasonText(null), null);
});

test('le motif nomme les sources et recopie la derniere erreur', () => {
  const texte = reasonText(failingSources({
    gamerpower: source({ consecutiveFailures: 4, lastError: 'HTTP 503 Service Unavailable' }),
  }));
  assert.match(texte, /gamerpower \(4\)/);
  assert.match(texte, /HTTP 503 Service Unavailable$/);
});

/* -------------------------------------------------------------- retour */

test('une source revenue est constatee, et c\'est ce qui termine le repli', () => {
  // Sans ce constat, l'onglet resterait ouvert indefiniment -- et un repli qui
  // ne se referme pas est devenu le mode par defaut.
  const avant = {
    gamerpower: source({ consecutiveFailures: 4 }),
    'epic-api': source({ consecutiveFailures: 3 }),
  };
  const apres = {
    gamerpower: source({ consecutiveFailures: 0, lastSuccess: T }),
    'epic-api': source({ consecutiveFailures: 5 }),
  };

  assert.deepEqual(recovered(avant, apres), ['gamerpower']);
  assert.deepEqual(recovered(avant, avant), [], 'rien n\'est revenu, rien n\'est annonce');
});

/* ------------------------------------------------------------ cadence */

test('la cadence ralentit apres une demi-heure d\'essais rapproches', () => {
  // Forcer, c'est frapper un service tiers deja en difficulte. Une demi-heure
  // couvre la panne passagere ; au-dela c'est une vraie panne, et rien ne presse.
  assert.equal(beatDelay(0), QUICK_DELAY_MS);
  assert.equal(beatDelay(QUICK_ATTEMPTS - 1), QUICK_DELAY_MS);
  assert.equal(beatDelay(QUICK_ATTEMPTS), SLOW_DELAY_MS);
  assert.equal(beatDelay(999), SLOW_DELAY_MS);
  assert.equal(beatDelay(undefined), QUICK_DELAY_MS, 'un compteur absent ne doit pas ralentir');
});

/* ---------------------------------------------------------- battement */

test('un onglet ferme rend la main tout seul', () => {
  // LA propriete de surete : rien de ce que la sentinelle laisse derriere elle
  // ne peut faire croire a la veille qu'elle est prise en charge.
  assert.equal(isDriving({ at: T }, T + 1000), true);
  assert.equal(isDriving({ at: T }, T + BEAT_STALE_MS + 1), false);
  assert.equal(isDriving(null, T), false);
  assert.equal(isDriving({}, T), false);
  assert.equal(isDriving({ at: 'hier' }, T), false);
});

test('le battement est trois fois plus frequent que sa peremption', () => {
  // Sinon un ralentissement passager ferait clignoter l'etat entre « active »
  // et « fermee » a chaque cycle.
  assert.ok(BEAT_PERIOD_MS * 3 <= BEAT_STALE_MS);
});

test('une horloge qui saute en avant ne fait pas clignoter l\'etat', () => {
  assert.equal(isDriving({ at: T + 60000 }, T), true);
});

/* ----------------------------------------------------------- stockage */

test('le battement se relit tel qu\'il a ete ecrit', async () => {
  const { chrome } = fakeChrome();
  await writeBeat(chrome, { at: T, attempts: 2, sources: ['gamerpower'] });

  const relu = await readBeat(chrome);
  assert.equal(relu.at, T);
  assert.equal(relu.attempts, 2);
  assert.deepEqual(Array.from(relu.sources), ['gamerpower']);
});

test('un battement absent ou illisible se lit comme absent', async () => {
  const { chrome } = fakeChrome();
  assert.equal(await readBeat(chrome), null);

  await chrome.storage.local.set({ [KEY_SENTINEL]: 'pas un objet' });
  assert.equal(await readBeat(chrome), null);
});

test('effacer le battement rend la cle absente, pas vide', async () => {
  const { chrome } = fakeChrome();
  await writeBeat(chrome, { at: T, attempts: 0, sources: [] });
  await clearBeat(chrome);

  assert.deepEqual(await chrome.storage.local.get(KEY_SENTINEL), {});
  assert.equal(await readBeat(chrome), null);
});

test('la cle vit dans l\'espace de la veille, jamais dans celui du moteur', () => {
  assert.ok(KEY_SENTINEL.startsWith('veille:'));
});
