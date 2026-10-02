/* Le carnet : une chaine d'empreintes SHA-256 (2.105.0).
 *
 * Ce que ces tests tiennent :
 *   - modifier, retirer, inserer ou echanger une ligne se voit, et dit OU ;
 *   - le carnet ne se vide jamais d'une ligne par oubli, ni ne note deux fois un jeu ;
 *   - le plafond fait sortir les plus anciennes SANS casser la verification ;
 *   - un code, une adresse ou un compte n'entrent jamais dans une ligne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  KEY_LEDGER, GENESIS, MAX_ENTRIES, KEEP_ENTRIES, KINDS,
  emptyLedger, readLedger, payload, sha256Hex, appendEntries, verifyLedger, shortHead, exportLedger, readExport, mergeLedger, itemsFromTouched,
} from '../watch/ledger.js';
import { integrateHistory } from '../watch/library.js';
import { BACKUP_KEYS, planRestore } from '../watch/full-backup.js';
import { DEFAULT_SETTINGS } from '../watch/storage.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.UTC(2026, 9, 2, 20, 0, 0);
const jeu = (n, o = {}) => ({ ts: NOW + n, store: 'epic', id: `jeu-${n}`, title: `Jeu ${n}`, status: 'claimed', kind: 'taken', worth: '19.99 EUR', wsrc: 'store', ...o });

async function carnet(n) {
  let l = emptyLedger();
  for (let i = 1; i <= n; i++) l = (await appendEntries(l, [jeu(i)])).ledger;
  return l;
}
const copie = (l) => JSON.parse(JSON.stringify(l));

test('SHA-256 : le vecteur de reference', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('chaque ligne porte l\'empreinte de la precedente, la premiere part de la graine', async () => {
  const l = await carnet(3);
  assert.equal(l.entries[0].prev, GENESIS);
  assert.equal(l.entries[1].prev, l.entries[0].hash);
  assert.equal(l.entries[2].prev, l.entries[1].hash);
  assert.equal(l.head, l.entries[2].hash);
  assert.deepEqual(l.entries.map((e) => e.n), [1, 2, 3]);
  assert.equal(l.entries[0].hash, await sha256Hex(`${GENESIS}\n${payload(l.entries[0])}`));
  const r = await verifyLedger(l);
  assert.deepEqual(r, { ok: true, count: 3, head: l.head, badAt: null, reason: null });
  assert.equal(shortHead(l.head).length, 12);
  assert.equal(shortHead(GENESIS), '');
  assert.equal((await verifyLedger(emptyLedger())).ok, true, 'un carnet vide est intact');
});

test('modifier une ligne se voit, et dit laquelle', async () => {
  for (const [champ, valeur] of [['title', 'Autre titre'], ['ts', 1], ['worth', '99.99 EUR'], ['store', 'gog'], ['id', 'autre'], ['status', 'redeemed'], ['kind', 'already'], ['wsrc', 'aggregator']]) {
    const l = copie(await carnet(5));
    l.entries[2][champ] = valeur;
    const r = await verifyLedger(l);
    assert.equal(r.ok, false, champ);
    assert.equal(r.badAt, 3, champ);
    assert.equal(r.reason, 'hash', champ);
  }
});

test('retirer, inserer ou echanger des lignes se voit', async () => {
  const base = await carnet(5);

  const retire = copie(base);
  retire.entries.splice(2, 1); // la ligne 3 disparait
  let r = await verifyLedger(retire);
  assert.equal(r.ok, false);
  assert.equal(r.badAt, 4, 'la ligne qui suit ne tient plus a sa voisine');

  const insere = copie(base);
  insere.entries.splice(2, 0, { ...base.entries[1], n: 3 });
  r = await verifyLedger(insere);
  assert.equal(r.ok, false);

  const echange = copie(base);
  [echange.entries[1], echange.entries[2]] = [echange.entries[2], echange.entries[1]];
  r = await verifyLedger(echange);
  assert.equal(r.ok, false);

  const renum = copie(base);
  renum.entries[3].n = 99;
  assert.equal((await verifyLedger(renum)).reason, 'n');
});

test('refaire la chaine apres une modification : seule l\'empreinte de tete notee ailleurs le trahit', async () => {
  const base = await carnet(4);
  const noteeAilleurs = base.head;
  // Un tricheur qui tient le disque recalcule TOUTE la chaine apres avoir change la ligne 2.
  const triche = copie(base);
  triche.entries[1].title = 'Falsifie';
  let prev = triche.base;
  for (const e of triche.entries) {
    e.prev = prev;
    e.hash = await sha256Hex(`${prev}\n${payload(e)}`);
    prev = e.hash;
  }
  triche.head = prev;
  assert.equal((await verifyLedger(triche)).ok, true, 'seule, la chaine est coherente');
  const r = await verifyLedger(triche, { expectedHead: noteeAilleurs });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'head', 'avec l\'empreinte gardee, la reecriture se voit');
  // Et retirer les DERNIERES lignes ne se voit que de la meme facon.
  const tronque = copie(base);
  tronque.entries.pop();
  assert.equal((await verifyLedger(tronque)).ok, true);
  assert.equal((await verifyLedger(tronque, { expectedHead: noteeAilleurs })).reason, 'head');
});

test('un jeu n\'est note qu\'une fois ; un constat « deja a vous » est une autre ligne', async () => {
  let l = await carnet(2);
  const r = await appendEntries(l, [jeu(1), jeu(2), jeu(3), jeu(3)]);
  assert.equal(r.added.length, 1, 'seul le jeu 3, une fois');
  assert.equal(r.ledger.entries.length, 3);
  l = r.ledger;
  const constat = await appendEntries(l, [jeu(3, { kind: KINDS.ALREADY })]);
  assert.equal(constat.added.length, 1, 'le meme jeu constate « deja a vous » est un autre fait');
  assert.equal((await appendEntries(l, [])).added.length, 0);
  assert.equal((await appendEntries(l, [null, 'x', { store: 'epic' }])).added.length, 0, 'sans identifiant : rien');
});

test('une ligne ne garde que des champs connus, tronques ; jamais un code ni une adresse', async () => {
  const sale = jeu(1, { code: 'SECRET-CODE', redeemCode: 'SECRET', token: 'SECRET', url: 'https://x/?k=SECRET', title: 'T'.repeat(500), wsrc: 'pirate' });
  const { ledger } = await appendEntries(emptyLedger(), [sale]);
  const e = ledger.entries[0];
  assert.deepEqual(Object.keys(e).sort(), ['hash', 'id', 'kind', 'n', 'prev', 'status', 'store', 'title', 'ts', 'worth', 'wsrc'].sort());
  assert.equal(e.title.length, 160);
  assert.equal(e.wsrc, null, 'une provenance inconnue n\'est pas gardee');
  assert.ok(!JSON.stringify(ledger).includes('SECRET'));
  assert.equal((await verifyLedger(ledger)).ok, true);
});

test('le plafond fait sortir les plus anciennes lignes sans casser la verification', async () => {
  let l = emptyLedger();
  const lot = Array.from({ length: MAX_ENTRIES }, (_, i) => jeu(i + 1));
  l = (await appendEntries(l, lot)).ledger;
  assert.equal(l.entries.length, MAX_ENTRIES);
  const apres = await appendEntries(l, [jeu(MAX_ENTRIES + 1)]);
  assert.equal(apres.ledger.entries.length, KEEP_ENTRIES);
  assert.equal(apres.ledger.baseN, MAX_ENTRIES + 1 - KEEP_ENTRIES);
  assert.equal(apres.ledger.entries[0].n, apres.ledger.baseN + 1, 'la numerotation continue');
  assert.equal(apres.ledger.base, l.entries[apres.ledger.baseN - 1].hash, 'la base est l\'empreinte de la derniere sortie');
  const r = await verifyLedger(apres.ledger);
  assert.equal(r.ok, true);
  assert.equal(r.head, apres.ledger.head);
});

test('lire un carnet abime ne jette pas et ne verifie pas', () => {
  for (const x of [null, undefined, 'x', 3, [], { entries: 'x' }, { entries: [null, 1, 'a'] }, { base: 'pas-un-hash' }]) {
    const l = readLedger(x);
    assert.deepEqual(l.entries, []);
    assert.equal(l.base, GENESIS);
    assert.equal(l.head, GENESIS);
  }
});

test('l\'export se relit tel quel et se verifie sans l\'extension', async () => {
  const l = await carnet(4);
  const fichier = exportLedger(l, { now: NOW, version: '2.105.0' });
  assert.equal(fichier.format, 'fgc-carnet-1');
  assert.equal(fichier.count, 4);
  assert.equal(fichier.head, l.head);
  assert.match(fichier.note, /pas un recu signe par un magasin/);
  const lu = readExport(JSON.parse(JSON.stringify(fichier)));
  assert.equal((await verifyLedger(lu.ledger, { expectedHead: lu.declaredHead })).ok, true);
  assert.equal(readExport({ format: 'autre' }), null);
  assert.equal(readExport(null), null);
  // Un fichier retouche a la main ne passe pas.
  const retouche = JSON.parse(JSON.stringify(fichier));
  retouche.entries[1].worth = '1 EUR';
  const r2 = readExport(retouche);
  assert.equal((await verifyLedger(r2.ledger, { expectedHead: r2.declaredHead })).ok, false);
});

test('la sauvegarde garde le carnet le plus long', async () => {
  const court = await carnet(2);
  const long = await carnet(5);
  assert.deepEqual(mergeLedger(court, long), { value: readLedger(long), added: 3 });
  assert.equal(mergeLedger(long, court).added, 0);
  assert.equal(mergeLedger(long, long).added, 0);
  assert.equal(mergeLedger(null, null).value.entries.length, 0);
  assert.ok(BACKUP_KEYS.includes(KEY_LEDGER));
  const plan = planRestore({}, { [KEY_LEDGER]: long }, { now: NOW });
  assert.equal(plan.write[KEY_LEDGER].entries.length, 5);
  assert.equal(plan.added[KEY_LEDGER], 5);
  const garde = planRestore({ [KEY_LEDGER]: long }, { [KEY_LEDGER]: court }, { now: NOW });
  assert.equal(garde.write[KEY_LEDGER].entries.length, 5, 'une sauvegarde plus courte ne raccourcit pas le carnet');
});

test('de l\'historique du moteur au carnet : seules les prises NOUVELLES, constats a part', async () => {
  const catalog = { 'epic:hades': { store: 'epic', storeId: 'hades', title: 'Hades', worth: '24,99 EUR', source: 'epic-api', origin: { worth: 'epic-api' } } };
  const added = [
    { key: 'slug:hades', entry: { status: 'claimed', ts: 1000 } },
    { key: 'slug:deja', entry: { status: 'claimed', ts: 2000, reason: 'ALREADY_OWNED', title: 'Deja Chez Moi' } },
    { key: 'slug:echec', entry: { status: 'failed', ts: 3000 } },
  ];
  const r = integrateHistory({}, { platform: 'Epic Games', added, catalog });
  const lignes = itemsFromTouched(r.touched);
  assert.equal(lignes.length, 2, 'l\'echec n\'entre pas');
  assert.deepEqual(lignes.map((x) => [x.id, x.kind, x.wsrc ?? null]), [['hades', 'taken', 'store'], ['deja', 'already', null]]);
  // Un second passage sur le meme historique n'ajoute rien : rien de nouveau.
  const encore = integrateHistory(r.library, { platform: 'Epic Games', added, catalog });
  assert.equal(itemsFromTouched(encore.touched).length, 0);
  const { ledger } = await appendEntries(emptyLedger(), lignes);
  assert.equal(ledger.entries.length, 2);
});

test('branche partout : worker, popup, reglage coupe par defaut', () => {
  assert.equal(DEFAULT_SETTINGS.libraryWatch, false);
  assert.equal(KEY_LEDGER, 'veille:carnet');
  const bg = lire('background.js');
  assert.match(bg, /if \(lignes\.length\) await appendToLedger\(lignes\);/);
  assert.match(bg, /appendEntries\(raw\[KEY_LEDGER\], items, \{ subtle: crypto\.subtle \}\)/);
  assert.match(bg, /await maybeLibraryWatch\(now\);/);
  const popup = lire('pages/popup.js');
  assert.match(popup, /writeBehaviour\(\{ libraryWatch: e\.target\.checked \}\)/);
  assert.match(popup, /verifyLedger\(lu\.ledger, \{ expectedHead: lu\.declaredHead \}\)/);
  assert.match(lire('pages/popup.html'), /id="ledger-verify"/);
});

test('les phrases du carnet et du gardien existent dans les quatre langues, avec leurs trous', () => {
  const trous = { ledgerCount: 2, ledgerOk: 2, ledgerBad: 2, ledgerFileOk: 2, ledgerFileBad: 1, libWatchState: 2, libWatchPending: 1, libWatchLost: 1, libWatchTitleMany: 1, libWatchLine: 3, libWatchMore: 1 };
  const cles = ['ledgerTitle', 'ledgerHint', 'ledgerEmpty', 'ledgerVerify', 'ledgerReasonHash', 'ledgerReasonPrev', 'ledgerReasonN', 'ledgerReasonHead', 'ledgerExport', 'ledgerCheckFile',
    'ledgerFileInLive', 'ledgerFileNotInLive', 'libWatchLabel', 'libWatchHint', 'libWatchNever', 'libWatchNeedsImport', 'libWatchTitleOne', 'libWatchWhy', ...Object.keys(trous)];
  for (const l of ['fr', 'en', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${l}/messages.json`));
    for (const c of cles) {
      assert.ok(table[c] && table[c].message, `${l} ${c}`);
      for (let i = 1; i <= (trous[c] || 0); i++) assert.ok(table[c].message.includes(`$${i}`), `${l} ${c} $${i}`);
    }
  }
});
