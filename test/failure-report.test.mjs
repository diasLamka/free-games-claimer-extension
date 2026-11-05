/* Le rapport d'echec (2.111.0) : ce que la page montrait quand une recuperation a echoue, garde et copiable.
 *
 * Le 2026-10-11, la phrase de succes de GOG avait change et il a fallu la deviner d'apres une capture envoyee a la main. Quand
 * une recuperation echoue, l'extension garde donc l'adresse, le titre et le debut du texte de la page -- nettoyes : ni
 * adresse electronique, ni longue suite de chiffres ou de signes, ni parametres d'adresse (ils portent des jetons).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PAGE_TEXT, cleanPage, failureOf, isFailureVerdict, buildReport,
  ISSUES_URL, MAX_ISSUE_URL, issueTitle, issueBody, issueUrl,
} from '../watch/failure-report.js';

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

/* Revue de securite du 2026-10-11 : le chemin de l'adresse et les codes a tirets (un code GOG ou Luna ressemble a
   ABCDE-FGHIJ-KLMNO) passaient tels quels. Un code d'echange est un bien : il ne part pas dans un rapport. */
test('un code a tirets est masque dans le texte, le titre et le chemin de l\'adresse', () => {
  const p = cleanPage({ url: 'https://www.gog.com/redeem/ABCDE-FGHIJ-KLMNO?x=1', title: 'Code ABCDE-FGHIJ-KLMNO', text: 'Le code AB12C-DE34F-GH56I-JK78L est deja utilise' });
  assert.ok(!/ABCDE|FGHIJ|KLMNO/.test(p.url + p.title), p.url + ' / ' + p.title);
  assert.ok(!/AB12C|DE34F|GH56I|JK78L/.test(p.text), p.text);
  assert.ok(p.text.includes('deja utilise'));
  assert.ok(p.url.startsWith('https://www.gog.com/redeem/'));
});

test('un segment d\'adresse qui ressemble a un jeton est masque, un nom de jeu ne l\'est pas', () => {
  const p = cleanPage({ url: 'https://store.epicgames.com/p/out-of-sight-b96ca8/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/1234567890123', title: 't', text: '' });
  assert.ok(p.url.includes('/p/out-of-sight-b96ca8/'), p.url);
  assert.ok(!/a1b2c3d4e5f6/.test(p.url) && !/1234567890123/.test(p.url), p.url);
});

test('une phrase en majuscules ou un nom a tirets ne sont pas abimes', () => {
  const p = cleanPage({ url: 'https://x.test/a', title: 'COUNTER-STRIKE 2', text: 'FREE-TO-PLAY now. Spider-Man 2 and X-COM' });
  assert.equal(p.title, 'COUNTER-STRIKE 2');
  assert.equal(p.text, 'FREE-TO-PLAY now. Spider-Man 2 and X-COM');
});

/* ------------------------------------------------------- le signalement (2.118.0) */

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const OFFRE = {
  title: 'Out of Sight', store: 'epic', verdict: 'failed', attempts: 2,
  failure: { at: NOW, verdict: 'failed', details: 'bouton introuvable', page: { url: 'https://store.epicgames.com/p/out-of-sight', title: 'Out of Sight', text: 'Obtenir' } },
};
const lire = (url) => { const q = new URL(url).searchParams; return { title: q.get('title'), body: q.get('body') }; };

test('le signalement ouvre le formulaire du depot, rempli avec le rapport', () => {
  const url = issueUrl(OFFRE, { version: '2.118.0', now: NOW });
  assert.ok(url.startsWith(`${ISSUES_URL}?`), url);
  const { title, body } = lire(url);
  assert.equal(title, 'Echec de recuperation : Out of Sight (epic)');
  assert.ok(body.includes(buildReport(OFFRE, { version: '2.118.0', now: NOW })), 'le rapport entier est dans le corps');
  assert.ok(/ce ticket sera public/.test(body), 'la consigne de relecture est la');
});

test('le signalement : & # + % et accents font l\'aller-retour sans etre abimes', () => {
  const offre = { ...OFFRE, title: 'Tom & Jerry #1 100% + caf\u00e9', failure: { ...OFFRE.failure, details: 'a&b=c#d+e%20f' } };
  const { title, body } = lire(issueUrl(offre, { version: '2.118.0', now: NOW }));
  assert.ok(title.includes('Tom & Jerry #1 100% + caf\u00e9'), title);
  assert.ok(body.includes('motif : a&b=c#d+e%20f'), body);
});

test('le signalement : un lien trop long perd d\'abord le texte de la page, jamais le jeu', () => {
  const enorme = '\u00e9'.repeat(5000); // six caracteres par lettre une fois encode
  const offre = { ...OFFRE, failure: { ...OFFRE.failure, page: { ...OFFRE.failure.page, text: enorme } } };
  const url = issueUrl(offre, { version: '2.118.0', now: NOW });
  assert.ok(url.length <= MAX_ISSUE_URL, String(url.length));
  const { body } = lire(url);
  assert.ok(body.includes('jeu : Out of Sight (epic)'));
  assert.ok(body.includes('verdict : failed'));
  assert.ok(body.includes('page : https://store.epicgames.com/p/out-of-sight'), 'l\'adresse reste');
});

test('le signalement : un rapport de taille normale n\'est pas raccourci', () => {
  const texte = 'Le jeu a deja ete obtenu avec ce compte. '.repeat(7).slice(0, 300).trim();
  const offre = { ...OFFRE, failure: { ...OFFRE.failure, page: { ...OFFRE.failure.page, text: texte } } };
  const url = issueUrl(offre, { version: '2.118.0', now: NOW });
  assert.ok(url.length < MAX_ISSUE_URL, String(url.length));
  assert.ok(lire(url).body.includes(texte));
});

test('le signalement : trois accents graves dans le rapport ne cassent pas le bloc de code', () => {
  const offre = { ...OFFRE, failure: { ...OFFRE.failure, details: 'avant ``` apres' } };
  const { body } = lire(issueUrl(offre, { version: '2.118.0', now: NOW }));
  assert.equal(body.split('```').length - 1, 2, 'une ouverture et une fermeture, pas plus');
});

test('le signalement : sans page lue, le ticket le dit', () => {
  const offre = { title: 'Jeu', store: 'gog', verdict: 'challenge', attempts: 0 };
  const { title, body } = lire(issueUrl(offre, { version: '2.118.0', now: NOW }));
  assert.equal(title, 'Echec de recuperation : Jeu (gog)');
  assert.ok(/aucune page/i.test(body), body);
});

test('le signalement : le titre est nettoye et borne comme le rapport', () => {
  assert.ok(!issueTitle({ title: 'Ecrire a moi@example.com', store: 'epic' }).includes('@'));
  assert.ok(issueTitle({ title: 'x'.repeat(500), store: 'epic' }).length <= 120);
  assert.equal(issueTitle(undefined), 'Echec de recuperation : ? (?)');
});

test('le signalement : le corps est une consigne, un espace a remplir, puis le rapport', () => {
  const corps = issueBody('ligne 1\nligne 2');
  const lignes = corps.split('\n');
  assert.ok(/^Relis ce texte/.test(lignes[0]));
  assert.ok(corps.includes('Ce que j\'ai observe :'));
  assert.ok(corps.endsWith('```text\nligne 1\nligne 2\n```'));
});
