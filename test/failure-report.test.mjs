/* Le rapport d'echec (2.111.0) : ce que la page montrait quand une recuperation a echoue, garde et copiable.
 *
 * Le 2026-10-11, la phrase de succes de GOG avait change et il a fallu la deviner d'apres une capture envoyee a la main. Quand
 * une recuperation echoue, l'extension garde donc l'adresse, le titre et le debut du texte de la page -- nettoyes : ni
 * adresse electronique, ni longue suite de chiffres ou de signes, ni parametres d'adresse (ils portent des jetons).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PAGE_TEXT, cleanPage, failureOf, isFailureVerdict, buildReport } from '../watch/failure-report.js';

test('seuls les verdicts qui demandent un regard laissent un rapport', () => {
  for (const v of ['failed', 'challenge', 'needs_login', 'needs_teaching']) assert.equal(isFailureVerdict(v), true, v);
  for (const v of ['claimed', 'redeemed', 'already_redeemed', 'owned', 'gone', 'skipped', undefined, null, '']) assert.equal(isFailureVerdict(v), false, String(v));
});

test('une page est reduite a son adresse sans parametres, son titre et le debut du texte', () => {
  const p = cleanPage({ url: 'https://www.gog.com/redeem?token=SECRET123#frag', title: '  Redeem   code  ', text: 'a '.repeat(500) });
  assert.equal(p.url, 'https://www.gog.com/redeem');
  assert.equal(p.title, 'Redeem code');
  assert.ok(p.text.length <= MAX_PAGE_TEXT);
});

test('une adresse electronique ne reste jamais dans le texte ni le titre', () => {
  const p = cleanPage({ url: 'https://x.test/a', title: 'Compte de moi@exemple.fr', text: 'Connecte en tant que moi@exemple.fr (Prenom.Nom+x@mail.co.uk) ok' });
  assert.ok(!/@/.test(p.title + p.text), p.title + ' / ' + p.text);
  assert.ok(p.text.includes('ok'));
});

test('les longues suites de chiffres ou de signes sont masquees', () => {
  const p = cleanPage({ url: 'https://x.test/a', title: 't', text: 'commande 1234567890123 jeton a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 fin' });
  assert.ok(!/1234567890123/.test(p.text));
  assert.ok(!/a1b2c3d4e5f6a1b2c3d4e5f6/.test(p.text));
  assert.ok(p.text.includes('fin'));
});

test('une phrase ordinaire n\'est pas abimee', () => {
  const phrase = 'Code redeemed successfully! You\'ve successfully added 1 item to your GOG account. Warbreeds - Amazon Luna';
  assert.equal(cleanPage({ url: 'https://www.gog.com/redeem', title: 'GOG', text: phrase }).text, phrase);
});

test('une page absente ou mal formee ne rend rien', () => {
  for (const raw of [null, undefined, 'x', 3, [], {}, { url: 5, title: 5, text: 5 }, { url: 'javascript:alert(1)', title: 't', text: 'x' }]) {
    assert.equal(cleanPage(raw), null, JSON.stringify(raw));
  }
});

test('une page sans texte garde son adresse et son titre', () => {
  const p = cleanPage({ url: 'https://x.test/a?b=1', title: 'Titre' });
  assert.equal(p.url, 'https://x.test/a');
  assert.equal(p.text, '');
});

test('failureOf date l\'echec et garde le motif, avec ou sans page', () => {
  const f = failureOf({ verdict: 'failed', details: 'bouton introuvable', page: { url: 'https://x.test/a', title: 'T', text: 'corps' } }, 1000);
  assert.equal(f.at, 1000);
  assert.equal(f.verdict, 'failed');
  assert.equal(f.details, 'bouton introuvable');
  assert.equal(f.page.text, 'corps');
  const sans = failureOf({ verdict: 'challenge', details: null }, 2000);
  assert.equal(sans.page, null);
  assert.equal(sans.details, null);
});

test('failureOf rend null pour un verdict sans echec : le rapport precedent s\'efface', () => {
  assert.equal(failureOf({ verdict: 'claimed', details: null, page: null }, 1000), null);
});

test('le rapport dit tout ce qu\'il faut pour comprendre, sans rien d\'autre', () => {
  const offer = { title: 'WarBreeds', store: 'gog', verdict: 'failed', attempts: 3, failure: failureOf({ verdict: 'failed', details: 'delai depasse', page: { url: 'https://www.gog.com/redeem', title: 'GOG', text: 'rien de net' } }, Date.UTC(2026, 9, 11, 10, 0, 0)) };
  const r = buildReport(offer, { version: '2.111.0', now: Date.UTC(2026, 9, 11, 12, 0, 0) });
  for (const attendu of ['2.111.0', 'WarBreeds', 'gog', 'failed', '3', 'delai depasse', 'https://www.gog.com/redeem', 'rien de net', '2026-10-11']) {
    assert.ok(r.includes(attendu), `manque : ${attendu}\n${r}`);
  }
});

test("un verdict qui ne compte pas d'essai n'affiche pas essai 0", () => {
  const r = buildReport({ title: 'Jeu', store: 'epic', verdict: 'challenge', attempts: 0 }, { version: '2.111.0', now: 2000 });
  assert.ok(!/essai/.test(r), r);
});

test('un rapport sans page le dit', () => {
  const offer = { title: 'Jeu', store: 'steam', verdict: 'challenge', attempts: 1, failure: failureOf({ verdict: 'challenge', details: null }, 1000) };
  const r = buildReport(offer, { version: '2.111.0', now: 2000 });
  assert.ok(/aucune page/i.test(r), r);
});

test('un rapport pour une offre sans echec garde est quand meme lisible', () => {
  const r = buildReport({ title: 'Jeu', store: 'epic', verdict: 'failed', attempts: 2 }, { version: '2.111.0', now: 2000 });
  assert.ok(r.includes('Jeu') && r.includes('failed'), r);
});
