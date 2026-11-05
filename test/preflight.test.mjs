/* Le compte a rebours : deux heures avant la sortie, verifier que tout est pret.
 *
 * La regle qui compte le plus est la derniere de la liste : SILENCE QUAND TOUT VA BIEN. Elle est testee en premier.
 *
 * Les instants sont UTC et explicites : le jeudi 5 novembre 2026, Epic ouvre a 11:00 a New York (heure d'hiver depuis le 1er
 * novembre), soit 16:00Z.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fakeChrome } from './fake-chrome.mjs';
import { inspectHealth } from '../watch/health.js';
import { KEYS, DEFAULT_SETTINGS } from '../watch/storage.js';
import { KEY_INCIDENTS } from '../watch/incidents.js';
import { KEY_SESSIONS } from '../watch/session.js';
import { KEY_RELAY } from '../watch/relay.js';
import { KEY_PHONE, KEY_PHONE_STATE } from '../watch/phone.js';
import {
  KEY_PREFLIGHT, LEAD_MS, PEER_STALE_MS, KINDS, readPreflight, nextDrop, isDue, findProblems,
} from '../watch/preflight.js';

const HEURE = 3600000;
const DROP = Date.UTC(2026, 10, 5, 16, 0, 0);
const DANS_90_MIN = DROP - 90 * 60000;

/** Un poste en bonne sante : la veille a tourne il y a cinq minutes. Rien d'autre ne cloche, sauf ce qu'on y met. */
async function poste({ settings = {}, stockage = {}, now = DANS_90_MIN } = {}) {
  const faux = fakeChrome({ now });
  await faux.chrome.storage.local.set({
    [KEYS.SETTINGS]: { ...DEFAULT_SETTINGS, ...settings },
    ...stockage,
  });
  const envoyees = [];
  const appels = [];
  const fetch = async (url, init) => { appels.push({ url, init }); return { ok: true, status: 200 }; };

  const tour = async (at = now, { telephone = false } = {}) => {
    // La veille vient de tourner : on ne veut pas de "veille arretee" dans ces tests.
    await faux.chrome.storage.local.set({ [KEYS.STATE]: { booted: true, lastCycle: at - 5 * 60000, nextCycle: at + HEURE, unseen: 0 } });
    return inspectHealth({
      chrome: faux.chrome,
      now: at,
      permissionLevel: 'granted',
      notify: async (n) => { envoyees.push(n); },
      setBadge: async () => {},
      record: () => {},
      ...(telephone ? { fetch } : {}),
    });
  };
  const etat = async () => (await faux.chrome.storage.local.get(KEY_PREFLIGHT))[KEY_PREFLIGHT];
  /* Le chien de garde a ses propres notifications (une session perdue en est une) : ces tests ne comptent que celles de la passe. */
  const delaPasse = () => envoyees.filter((n) => String(n.id).startsWith('avant-sortie-'));
  const passe = { get length() { return delaPasse().length; }, get all() { return delaPasse(); } };
  return { faux, envoyees, appels, tour, etat, passe };
}

/* La session est perdue depuis mardi, et le chien de garde l'a dite mardi : c'est ce que la passe doit redire le jeudi. */
const MARDI = DANS_90_MIN - 2 * 24 * HEURE;
const incidentSession = (store, notifiedAt) => ({ [`session:${store}`]: { id: `session:${store}`, kind: 'session', key: store, openedAt: MARDI, lastSeenAt: MARDI, notifiedAt, phonedAt: notifiedAt, detail: null } });
const epicDeconnecte = {
  [KEY_SESSIONS]: { epic: { status: 'logged_out', at: DANS_90_MIN - HEURE, outSince: MARDI } },
  [KEY_INCIDENTS]: incidentSession('epic', MARDI),
};
const epicConnecte = { [KEY_SESSIONS]: { epic: { status: 'ok', at: DANS_90_MIN - HEURE } } };

/* -------------------------------------------- silence quand tout va bien */

test('tout va bien : aucune notification, aucun envoi -- et la passe est notee', async () => {
  const p = await poste({ stockage: epicConnecte });
  const r = await p.tour(DANS_90_MIN, { telephone: true });

  assert.equal(p.passe.length, 0);
  assert.deepEqual(p.appels, []);
  assert.equal(r.preflight.due, true);
  assert.equal(r.preflight.problems, 0);
  assert.deepEqual(await p.etat(), { for: DROP, at: DANS_90_MIN, problems: 0 });
});

test('une session inconnue (jamais sondee) ne declenche rien : ne pas savoir n\'est pas un echec', async () => {
  const p = await poste({ stockage: { [KEY_SESSIONS]: { epic: { status: 'unknown', at: DANS_90_MIN } } } });
  await p.tour();
  assert.equal(p.passe.length, 0);
});

/* ------------------------------------------------------- quand ca cloche */

test('une session perdue : une notification qui nomme le magasin', async () => {
  const p = await poste({ stockage: epicDeconnecte });
  const r = await p.tour();

  assert.equal(p.passe.length, 1);
  assert.match(p.passe.all[0].message, /Epic/);
  assert.equal(p.passe.all[0].id, `avant-sortie-${DROP}`);
  assert.equal(r.preflight.notified, true);
  assert.equal((await p.etat()).problems, 1);
});

test('une seule notification par ouverture, meme si le tour d\'inspection repasse', async () => {
  const p = await poste({ stockage: epicDeconnecte });
  await p.tour(DANS_90_MIN);
  await p.tour(DANS_90_MIN + 20 * 60000);
  await p.tour(DANS_90_MIN + 40 * 60000);
  assert.equal(p.passe.length, 1);
});

test('chaque session perdue est nommee, et le titre compte les choses a verifier', async () => {
  const p = await poste({
    stockage: { [KEY_SESSIONS]: {
      epic: { status: 'logged_out', at: 1, outSince: 1 },
      gog: { status: 'logged_out', at: 1, outSince: 1 },
    },
    [KEY_INCIDENTS]: { ...incidentSession('epic', MARDI), ...incidentSession('gog', MARDI) } },
  });
  await p.tour();
  assert.equal(p.passe.length, 1);
  assert.match(p.passe.all[0].title, /2/);
  assert.match(p.passe.all[0].message, /Epic/);
  assert.match(p.passe.all[0].message, /GOG/);
});

test('un telephone du relais muet depuis plus de douze heures est dit', async () => {
  const relais = {
    secret: 'a'.repeat(43), dev: '0123abcd', pairedAt: DANS_90_MIN - 30 * 24 * HEURE,
    peer: { at: DANS_90_MIN - 13 * HEURE },
  };
  const p = await poste({ stockage: { ...epicConnecte, [KEY_RELAY]: relais } });
  await p.tour();
  assert.equal(p.passe.length, 1);
  assert.match(p.passe.all[0].message, /relay|relais/i);
});

test('un telephone du relais entendu il y a une heure ne dit rien', async () => {
  const relais = {
    secret: 'a'.repeat(43), dev: '0123abcd', pairedAt: DANS_90_MIN - 30 * 24 * HEURE,
    peer: { at: DANS_90_MIN - HEURE },
  };
  const p = await poste({ stockage: { ...epicConnecte, [KEY_RELAY]: relais } });
  await p.tour();
  assert.equal(p.passe.length, 0);
});

test('l\'alerte telephone en panne depuis son dernier envoi est dite', async () => {
  const p = await poste({
    stockage: {
      ...epicConnecte,
      [KEY_PHONE]: { on: true, url: 'https://ntfy.sh/fgc-test' },
      [KEY_PHONE_STATE]: { at: DANS_90_MIN - 3 * HEURE, ok: false, status: 503, note: 'HTTP 503', why: 'alerte' },
    },
  });
  await p.tour();
  assert.equal(p.passe.length, 1);
});

test('le telephone recoit la meme alerte, une fois', async () => {
  const p = await poste({
    stockage: { ...epicDeconnecte, [KEY_PHONE]: { on: true, url: 'https://ntfy.sh/fgc-test' } },
  });
  await p.tour(DANS_90_MIN, { telephone: true });
  await p.tour(DANS_90_MIN + 20 * 60000, { telephone: true });
  assert.equal(p.appels.length, 1);
  assert.match(p.appels[0].url, /^https:\/\/ntfy\.sh\/fgc-test\?/);
  assert.equal(p.appels[0].init.credentials, 'omit');
  assert.match(p.appels[0].init.body, /Epic/);
});

/* -------------------------------------------- pas de doublon avec le chien de garde */

test('une session que le chien de garde vient de dire n\'est pas redite par la passe', async () => {
  // Aucun incident connu : le tour d'inspection l'ouvre ET le dit a l'instant. La passe se tait.
  const p = await poste({ stockage: { [KEY_SESSIONS]: epicDeconnecte[KEY_SESSIONS] } });
  await p.tour();
  assert.equal(p.envoyees.length, 1, 'le chien de garde l\'a dite');
  assert.equal(p.passe.length, 0, 'et la passe n\'ajoute rien');
  assert.equal((await p.etat()).problems, 0);
});

test('dite il y a cinq heures : pas redite ; dite il y a sept heures : rappelee', async () => {
  const recente = await poste({
    stockage: { [KEY_SESSIONS]: epicDeconnecte[KEY_SESSIONS], [KEY_INCIDENTS]: incidentSession('epic', DANS_90_MIN - 5 * HEURE) },
  });
  await recente.tour();
  assert.equal(recente.passe.length, 0);

  const ancienne = await poste({
    stockage: { [KEY_SESSIONS]: epicDeconnecte[KEY_SESSIONS], [KEY_INCIDENTS]: incidentSession('epic', DANS_90_MIN - 7 * HEURE) },
  });
  await ancienne.tour();
  assert.equal(ancienne.passe.length, 1);
});

/* ---------------------------------------------------------------- le moment */

test('trop tot (trois heures avant) : rien, et la passe n\'est pas notee', async () => {
  const p = await poste({ stockage: epicDeconnecte, now: DROP - 3 * HEURE });
  const r = await p.tour(DROP - 3 * HEURE);
  assert.equal(p.passe.length, 0);
  assert.equal(r.preflight.due, false);
  assert.equal(await p.etat(), undefined);
});

test('apres l\'ouverture : rien, la passe n\'a plus de sens', async () => {
  const p = await poste({ stockage: epicDeconnecte, now: DROP + 20 * 60000 });
  const r = await p.tour(DROP + 20 * 60000);
  assert.equal(p.passe.length, 0);
  assert.equal(r.preflight.due, false);
});

test('la sortie suivante a sa propre passe', async () => {
  const p = await poste({ stockage: epicDeconnecte });
  await p.tour(DANS_90_MIN);
  const semaine = 7 * 24 * HEURE;
  await p.tour(DANS_90_MIN + semaine);
  assert.equal(p.passe.length, 2);
  assert.equal((await p.etat()).for, DROP + semaine);
});

/* ------------------------------------------------------------ les reglages */

test('le compte a rebours se coupe : plus rien ne part', async () => {
  const p = await poste({ settings: { preflight: false }, stockage: epicDeconnecte });
  const r = await p.tour();
  assert.equal(p.passe.length, 0);
  assert.equal(r.preflight.due, false);
});

test('sans Epic parmi les magasins suivis, il n\'y a pas de sortie a attendre', async () => {
  const p = await poste({ settings: { watchedStores: ['gog'] }, stockage: epicDeconnecte });
  await p.tour();
  assert.equal(p.passe.length, 0);
});

test('heures calmes : rien ne part, rien n\'est note, et la passe repart apres', async () => {
  // 14:30Z est 09:30 a New York ; on declare des heures calmes qui couvrent 14:00Z-15:30Z a Paris... en UTC explicite.
  const settings = { quiet: { on: true, start: '00:00', end: '23:59' } };
  const p = await poste({ settings, stockage: epicDeconnecte });
  const r = await p.tour();
  assert.equal(p.passe.length, 0);
  assert.equal(r.preflight.notified, false);
  assert.equal(await p.etat(), undefined, 'rien de note : la passe repart au tour suivant');
});

test('le silence demande par l\'utilisateur vaut aussi pour la passe : rien ne part, la passe est notee', async () => {
  const p = await poste({ settings: { alertMode: 'off' }, stockage: epicDeconnecte });
  await p.tour();
  assert.equal(p.passe.length, 0);
  assert.equal((await p.etat()).problems, 1);
});

/* --------------------------------------------------------- le module pur */

test('readPreflight : un etat abime est un etat vide', () => {
  for (const raw of [undefined, null, 'x', 4, [], { for: 'demain' }]) {
    assert.deepEqual(readPreflight(raw), { for: null, at: null, problems: 0 }, JSON.stringify(raw));
  }
  assert.deepEqual(readPreflight({ for: 5, at: 6, problems: 2 }), { for: 5, at: 6, problems: 2 });
});

test('nextDrop : la premiere ouverture strictement apres maintenant', () => {
  assert.equal(nextDrop([30, 10, 20], 15), 20);
  assert.equal(nextDrop([10, 20], 20), null, 'pile maintenant n\'est plus a venir');
  assert.equal(nextDrop([], 0), null);
  assert.equal(nextDrop(undefined, 0), null);
  assert.equal(nextDrop([NaN, 'x', 40], 0), 40);
});

test('isDue : dans les deux heures, une seule fois par ouverture', () => {
  assert.equal(isDue(null, DROP, DROP - LEAD_MS), true, 'pile deux heures avant');
  assert.equal(isDue(null, DROP, DROP - LEAD_MS - 1), false);
  assert.equal(isDue(null, DROP, DROP), false);
  assert.equal(isDue(null, null, DROP), false);
  assert.equal(isDue({ for: DROP }, DROP, DROP - HEURE), false, 'deja faite');
  assert.equal(isDue({ for: DROP - 7 * 24 * HEURE }, DROP, DROP - HEURE), true, 'celle de la semaine derniere ne compte pas');
});

test('findProblems : seuls les magasins suivis et sondables, seul un "deconnecte" confirme', () => {
  const sessions = {
    epic: { status: 'logged_out', at: 1 },
    gog: { status: 'logged_out', at: 1 },
    steam: { status: 'unknown', at: 1 },
  };
  const p = findProblems({ sessions, watchedStores: ['epic', 'steam', 'amazon'], now: 10 });
  assert.deepEqual(p, [{ kind: KINDS.SESSION, key: 'epic', detail: null }], 'gog non suivi, steam inconnu, amazon non sondable');
});

test('findProblems : un relais sans date n\'est pas accuse, un relais recemment associe non plus', () => {
  const now = 100 * HEURE;
  assert.deepEqual(findProblems({ relay: { peer: null, pairedAt: null }, now }), []);
  assert.deepEqual(findProblems({ relay: { peer: null, pairedAt: now - HEURE }, now }), [], 'jamais entendu mais associe depuis une heure');
  assert.equal(findProblems({ relay: { peer: null, pairedAt: now - PEER_STALE_MS - 1 }, now }).length, 1, 'jamais entendu depuis l\'association, il y a plus de douze heures');
  assert.deepEqual(findProblems({ relay: { peer: { at: now - HEURE }, pairedAt: 0 }, now }), []);
});

test('findProblems : le telephone n\'est accuse que s\'il est configure ET que son dernier envoi a rate', () => {
  const rate = { ok: false, note: 'HTTP 503' };
  assert.equal(findProblems({ phoneOn: true, phoneState: rate, now: 1 }).length, 1);
  assert.equal(findProblems({ phoneOn: false, phoneState: rate, now: 1 }).length, 0);
  assert.equal(findProblems({ phoneOn: true, phoneState: { ok: true }, now: 1 }).length, 0);
  assert.equal(findProblems({ phoneOn: true, phoneState: null, now: 1 }).length, 0);
});
