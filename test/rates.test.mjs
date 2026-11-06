/* Le taux de change, et surtout ce qu'il refuse de faire.
 *
 * Ce depot a longtemps refuse toute conversion, pour une raison qui tient
 * toujours : un montant converti affiche comme exact est un mensonge. La
 * conversion a ete demandee explicitement -- lire des euros partout -- et ces
 * tests tiennent le prix de cette demande : on convertit quand on SAIT, on
 * rend le montant d'origine quand on ne sait pas, et jamais l'inverse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRates,
  shouldRefresh,
  tooOld,
  toBase,
  refreshRates,
  REFRESH_AFTER_MS,
  TRUST_FOR_MS,
  RATES_URL,
} from '../watch/rates.js';

const T = Date.UTC(2026, 8, 18, 12, 0, 0);

/* La forme reelle de la reponse : des taux POUR UN EURO. */
const reponseBCE = () => ({
  amount: 1,
  base: 'EUR',
  date: '2026-09-17',
  rates: { USD: 1.08, GBP: 0.85, PLN: 4.3 },
});

const tauxConnu = () => parseRates(reponseBCE(), T);

/* ------------------------------------------------------------- lecture */

test('une reponse de la BCE est lue avec sa date', () => {
  const r = tauxConnu();
  assert.equal(r.base, 'EUR');
  assert.equal(r.date, '2026-09-17');
  assert.equal(r.rates.USD, 1.08);
  assert.equal(r.fetchedAt, T);
});

test('une reponse illisible est refusee, jamais devinee', () => {
  for (const mauvais of [null, undefined, {}, { rates: null }, { rates: {} }, 'nope',
    { rates: { USD: 'beaucoup' } }, { rates: { USD: 0 } }, { rates: { USD: -1 } }]) {
    assert.equal(parseRates(mauvais, T), null, JSON.stringify(mauvais));
  }
});

/* --------------------------------------------------------- conversion */

test('un montant en dollars devient des euros', () => {
  // 19,99 $ a 1,08 $ pour un euro : environ 18,51 euros.
  const euros = toBase(19.99, 'USD', tauxConnu(), T);
  assert.ok(Math.abs(euros - 18.5093) < 0.001, String(euros));
});

test('un montant deja en euros n\'est jamais touche', () => {
  assert.equal(toBase(23.99, 'EUR', tauxConnu(), T), 23.99);
  /* Meme sans aucun taux : l'euro n'a pas besoin d'etre converti en euro. */
  assert.equal(toBase(23.99, 'EUR', null, T), 23.99);
});

test('sans taux, on ne convertit pas -- on ne devine pas', () => {
  assert.equal(toBase(19.99, 'USD', null, T), null);
  assert.equal(toBase(19.99, 'USD', { rates: {} }, T), null);
  /* Une devise que la BCE ne publie pas : idem, silence plutot qu'invention. */
  assert.equal(toBase(19.99, 'JPY', tauxConnu(), T), null);
});

test('un taux trop vieux cesse de servir', () => {
  const vieux = tauxConnu();
  assert.ok(Number.isFinite(toBase(10, 'USD', vieux, T + TRUST_FOR_MS - 1000)));
  /* Un taux de la semaine derniere reste un ordre de grandeur honnete ; un
     taux d'il y a six mois n'en est plus un. Le montant redevient alors
     visiblement en dollars, plutot qu'en euros faux. */
  assert.equal(toBase(10, 'USD', vieux, T + TRUST_FOR_MS), null);
  assert.ok(tooOld(vieux, T + TRUST_FOR_MS));
});

test('un montant illisible ne produit pas un euro', () => {
  assert.equal(toBase(NaN, 'USD', tauxConnu(), T), null);
  assert.equal(toBase(null, 'USD', tauxConnu(), T), null);
  assert.equal(toBase(10, null, tauxConnu(), T), null);
});

/* ------------------------------------------------------ rafraichissement */

test('on redemande une fois par jour, pas a chaque cycle', () => {
  const r = tauxConnu();
  assert.equal(shouldRefresh(r, T + 1000), false);
  assert.equal(shouldRefresh(r, T + REFRESH_AFTER_MS), true);
  assert.equal(shouldRefresh(null, T), true);
});

test('un taux frais n\'est pas redemande, et rien n\'est ecrit', async () => {
  let appels = 0;
  const run = await refreshRates({
    now: T + 1000,
    stored: tauxConnu(),
    fetch: async () => { appels++; throw new Error('ne devrait pas etre appele'); },
  });
  assert.equal(appels, 0);
  assert.equal(run.changed, false);
});

test('une requete qui aboutit remplace le taux', async () => {
  let vue = null;
  const run = await refreshRates({
    now: T + REFRESH_AFTER_MS,
    stored: tauxConnu(),
    fetch: async (url) => {
      vue = url;
      return { ok: true, status: 200, json: async () => ({ ...reponseBCE(), date: '2026-09-18' }) };
    },
  });
  assert.equal(vue, RATES_URL);
  assert.equal(run.changed, true);
  assert.equal(run.rates.date, '2026-09-18');
});

test('une panne de taux garde l\'ancien et ne fait echouer personne', async () => {
  const avant = tauxConnu();
  const lignes = [];

  for (const panne of [
    async () => { throw new Error('reseau coupe'); },
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => ({ ok: true, status: 200, json: async () => ({ rates: {} }) }),
  ]) {
    const run = await refreshRates({
      now: T + REFRESH_AFTER_MS,
      stored: avant,
      fetch: panne,
      record: (niveau, message) => lignes.push([niveau, message]),
    });
    /* L'ancien taux survit : le pire qu'une panne doive produire est un
       montant affiche dans sa devise d'origine, pas un catalogue sans prix. */
    assert.equal(run.rates, avant);
    assert.equal(run.changed, false);
  }

  assert.equal(lignes.length, 3);
  assert.ok(lignes.every(([niveau]) => niveau === 'warn'));
});

test('sans fetch injecte, le module ne cherche pas a en trouver un', async () => {
  const run = await refreshRates({ now: T + REFRESH_AFTER_MS, stored: null, fetch: undefined });
  assert.equal(run.rates, null);
  assert.equal(run.changed, false);
});

/* ------------------------------------------- chasse aux dollars (2.123.0) */

import { moneyInBase } from '../lib/money.js';
import { reasonText } from '../watch/bargain.js';

test('moneyInBase : un montant en dollars se lit en euros, marque environ ; un montant en euros reste intact', () => {
  const fmt = moneyInBase(tauxConnu(), T);
  const converti = fmt(10.8, 'USD');
  assert.ok(converti.startsWith('\u2248'), converti);
  assert.ok(/10[,.]00/.test(converti) && converti.includes('\u20ac'), converti);
  const euros = fmt(12.49, 'EUR');
  assert.ok(!euros.startsWith('\u2248'), euros);
  assert.ok(euros.includes('\u20ac'), euros);
});

test('moneyInBase : sans taux, une devise inconnue ou un taux trop vieux, le montant garde sa devise', () => {
  const sans = moneyInBase(null, T)(10, 'USD');
  assert.ok(!sans.startsWith('\u2248') && /\$|USD/.test(sans), sans);
  const inconnue = moneyInBase(tauxConnu(), T)(10, 'JPY');
  assert.ok(!inconnue.startsWith('\u2248'), inconnue);
  const vieux = moneyInBase(tauxConnu(), T + TRUST_FOR_MS + 1)(10, 'USD');
  assert.ok(!vieux.startsWith('\u2248'), vieux);
  assert.ok(!moneyInBase(tauxConnu(), T)(10, null).startsWith('\u2248'));
});

test('piege ou bonne affaire : les montants de la comparaison, en dollars, se disent en euros', () => {
  const t = (cle, ...args) => `${cle}(${args.join('|')})`;
  const nombre = (n) => String(n);
  const dollars = reasonText({ key: 'bargainInflated', args: ['24.99 USD', '9.99 USD'] }, t, { money: (n, c) => `${n} ${c}`, number: nombre });
  assert.match(dollars, /24\.99 USD/, 'sans conversion, le formateur de base voit des dollars');
  const euros = reasonText({ key: 'bargainInflated', args: ['24.99 USD', '9.99 USD'] }, t, { money: moneyInBase(tauxConnu(), T), number: nombre });
  assert.ok(!/USD|\$/.test(euros), euros);
  assert.equal((euros.match(/\u2248/g) || []).length, 2, euros);
});
