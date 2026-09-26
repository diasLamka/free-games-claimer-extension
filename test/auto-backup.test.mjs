/* La sauvegarde automatique, chaque semaine (2.77.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EVERY_MS, EXPORT_KEYS, FOLDER, KEEP, KEY_AUTO_BACKUP, PERMISSION, RETRY_MS,
  autoBackupDue, autoFileName, compactExport, dataUrl, describeAutoBackup, exportFromStorage,
  fingerprint, planPrune, runAutoBackup,
} from '../watch/auto-backup.js';
import { BACKUP_KEYS, backupBlock, planRestore } from '../watch/full-backup.js';
import { KEY_PHONE } from '../watch/phone.js';
import { UI_COMMANDS, messageAllowed } from '../watch/messaging.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T10:00:00Z');
const DAY = 24 * 3600 * 1000;

/** Un stockage d'extension ordinaire : un jeu recupere, un code, un souhait, et le telephone. */
function stockage() {
  return {
    FGC_pending_codes: JSON.stringify([{ code: 'AAAA-BBBB', store: 'gog', title: 'Jeu code', deadline: '2026-10-31' }]),
    'FGC_history_Epic Games': JSON.stringify({ 'jeu-a': { title: 'Jeu A', status: 'claimed', ts: NOW - DAY } }),
    'veille:offres': { 'epic:jeu-a': { store: 'epic', title: 'Jeu A', worth: 19.99, currency: 'EUR' } },
    'veille:sources': { epic: { ok: true } },
    'veille:souhaits': [{ title: 'Hades', normalised: 'hades' }],
    'veille:reglages': { watchedStores: ['epic'] },
    [KEY_PHONE]: { service: 'ntfy', url: 'https://ntfy.sh/secret-topic' },
  };
}

/** Un faux chrome : stockage, permission, et des telechargements qui se terminent. */
function fauxChrome({ granted = true, raw = stockage(), echec = null } = {}) {
  const data = { ...raw };
  const downloads = [];
  const effaces = [];
  const retires = [];
  let prochain = 1;
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const liste = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(liste.filter((k) => data[k] !== undefined).map((k) => [k, structuredClone(data[k])]));
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = JSON.parse(JSON.stringify(v)); },
      },
    },
    permissions: { async contains({ permissions }) { return granted && permissions.includes(PERMISSION); } },
    downloads: {
      async download(opts) {
        const id = prochain++;
        downloads.push({ id, ...opts, asked: opts.filename, state: echec ? 'interrupted' : 'complete', error: echec, filename: `Downloads/${opts.filename}` });
        return id;
      },
      async search({ id }) { return downloads.filter((d) => d.id === id); },
      async removeFile(id) { effaces.push(id); },
      async erase({ id }) { retires.push(id); return [id]; },
    },
  };
  return { chrome, data, downloads, effaces, retires };
}

/** Le texte JSON derriere une adresse data: base64. */
const lireDataUrl = (url) => JSON.parse(Buffer.from(url.split(',')[1], 'base64').toString('utf8'));

test('une fois par semaine, jamais juste apres un echec', () => {
  assert.equal(autoBackupDue(undefined, NOW), true, 'jamais faite');
  assert.equal(autoBackupDue({ at: NOW - EVERY_MS + 1000 }, NOW), false);
  assert.equal(autoBackupDue({ at: NOW - EVERY_MS }, NOW), true);
  assert.equal(autoBackupDue({ at: NOW - 30 * DAY, failedAt: NOW - RETRY_MS + 1000 }, NOW), false, 'on ne martele pas');
  assert.equal(autoBackupDue({ at: NOW - 30 * DAY, failedAt: NOW - RETRY_MS }, NOW), true);
  assert.equal(EVERY_MS, 7 * DAY);
});

test('quatre fichiers gardes, les plus recents', () => {
  const f = (id, jours) => ({ id, at: NOW - jours * DAY, name: `f${id}` });
  const { keep, remove } = planPrune([f(1, 28), f(5, 0), f(2, 21), f(4, 7), f(3, 14), { id: 'x' }, null]);
  assert.equal(KEEP, 4);
  assert.deepEqual(keep.map((x) => x.id), [5, 4, 3, 2]);
  assert.deepEqual(remove.map((x) => x.id), [1]);
  assert.deepEqual(planPrune(undefined), { keep: [], remove: [] });
});

test('le fichier de la semaine se restaure, et ne porte aucun secret', () => {
  const raw = stockage();
  const complet = exportFromStorage(raw, { version: '2.77.0', now: NOW });
  const f = compactExport(complet);
  assert.equal(f.automatic, true);
  assert.deepEqual(Object.keys(f).sort(), ['automatic', 'backup', 'exportFormat', 'exportedAt', 'extensionVersion', 'pendingCodes', 'tally']);
  // Le bilan est calcule avec le catalogue, qui n'est pas dans le fichier.
  assert.equal(f.tally.count, 1);
  assert.equal(f.tally.priced, 1);
  assert.deepEqual(Object.values(f.tally.totals), [19.99]);
  assert.ok(!('catalog' in f) && !('sources' in f), 'le diagnostic se reconstruit');
  assert.ok(!JSON.stringify(f).includes('secret-topic'), 'jamais le telephone');
  assert.ok(!EXPORT_KEYS.includes(KEY_PHONE));
  for (const k of BACKUP_KEYS) assert.ok(EXPORT_KEYS.includes(k), `${k} : tout ce que la restauration relit`);
  // Ce que l'import relit : le bloc, et une restauration qui ajoute.
  const bloc = backupBlock(JSON.parse(JSON.stringify(f)));
  assert.ok(bloc && bloc.FGC_pending_codes);
  const plan = planRestore({}, bloc, { now: NOW });
  assert.equal(plan.added.FGC_pending_codes, 1);
  // L'export a la main garde son catalogue, pour le diagnostic.
  assert.ok(complet.catalog['epic:jeu-a']);
});

test('adresse data: en UTF-8, et nom range dans son dossier', () => {
  const url = dataUrl(JSON.stringify({ t: 'Économisé — 日本' }));
  assert.match(url, /^data:application\/json;base64,/);
  assert.deepEqual(lireDataUrl(url), { t: 'Économisé — 日本' });
  // Plus grand qu'un morceau de conversion : rien ne se perd a la couture.
  const long = 'é'.repeat(70000);
  assert.equal(lireDataUrl(dataUrl(JSON.stringify(long))), long);
  assert.equal(autoFileName(NOW), `${FOLDER}/free-games-claimer-2026-09-26-10-00-00.json`);
  assert.equal(fingerprint('a'), fingerprint('a'));
  assert.notEqual(fingerprint('a'), fingerprint('b'));
  assert.match(fingerprint(''), /^[0-9a-f]{8}$/);
});

test('sans la permission, rien ne se passe', async () => {
  const { chrome, downloads } = fauxChrome({ granted: false });
  assert.deepEqual(await runAutoBackup({ chrome, now: NOW }), { done: false, why: 'off' });
  const sansApi = { storage: chrome.storage };
  assert.deepEqual(await runAutoBackup({ chrome: sansApi, now: NOW }), { done: false, why: 'off' });
  assert.equal(downloads.length, 0);
});

test('la premiere sauvegarde se depose, sans dialogue, et le registre la retient', async () => {
  const { chrome, data, downloads } = fauxChrome();
  const r = await runAutoBackup({ chrome, now: NOW, version: '2.77.0' });
  assert.equal(r.done, true);
  assert.equal(downloads.length, 1);
  const d = downloads[0];
  assert.equal(d.asked, autoFileName(NOW));
  assert.equal(d.saveAs, false, 'jamais de boite « Enregistrer sous »');
  assert.equal(d.conflictAction, 'uniquify');
  const fichier = lireDataUrl(d.url);
  assert.equal(fichier.extensionVersion, '2.77.0');
  assert.ok(!d.url.includes('secret') && !JSON.stringify(fichier).includes('secret-topic'));
  const etat = data[KEY_AUTO_BACKUP];
  assert.equal(etat.at, NOW);
  assert.equal(etat.files.length, 1);
  assert.equal(etat.files[0].id, 1);
  assert.match(etat.fingerprint, /^[0-9a-f]{8}$/);
});

test('les heures calmes et la semaine pas finie la retiennent -- le clic, non', async () => {
  const { chrome, downloads } = fauxChrome();
  assert.equal((await runAutoBackup({ chrome, now: NOW, quietNow: true })).why, 'quiet');
  await runAutoBackup({ chrome, now: NOW });
  assert.equal((await runAutoBackup({ chrome, now: NOW + DAY })).why, 'not-due');
  assert.equal((await runAutoBackup({ chrome, now: NOW + DAY, force: true, quietNow: true })).done, true);
  assert.equal(downloads.length, 2);
});

test('rien de change en une semaine : pas de nouveau fichier', async () => {
  const { chrome, data, downloads } = fauxChrome();
  await runAutoBackup({ chrome, now: NOW });
  const r = await runAutoBackup({ chrome, now: NOW + EVERY_MS });
  assert.deepEqual(r, { done: false, why: 'unchanged' });
  assert.equal(downloads.length, 1);
  assert.equal(data[KEY_AUTO_BACKUP].at, NOW + EVERY_MS, 'la relecture compte, pour ne pas relire a chaque cycle');
  // Un souhait de plus : le fichier suivant part.
  data['veille:souhaits'] = [...data['veille:souhaits'], { title: 'Celeste', normalised: 'celeste' }];
  assert.equal((await runAutoBackup({ chrome, now: NOW + 2 * EVERY_MS })).done, true);
  assert.equal(downloads.length, 2);
});

test('le cinquieme fichier efface le premier, du disque et de la liste', async () => {
  const { chrome, data, effaces, retires } = fauxChrome();
  for (let i = 0; i < 5; i++) {
    data['veille:souhaits'] = [{ title: `Jeu ${i}`, normalised: `jeu ${i}` }];
    assert.equal((await runAutoBackup({ chrome, now: NOW + i * EVERY_MS })).done, true);
  }
  assert.deepEqual(effaces, [1]);
  assert.deepEqual(retires, [1]);
  assert.deepEqual(data[KEY_AUTO_BACKUP].files.map((f) => f.id), [5, 4, 3, 2]);
});

test('un echec garde les fichiers connus, se dit, et retente plus tard', async () => {
  const ok = fauxChrome();
  await runAutoBackup({ chrome: ok.chrome, now: NOW });
  const { chrome, data } = fauxChrome({ raw: ok.data, echec: 'FILE_NO_SPACE' });
  data['veille:souhaits'] = [];
  const r = await runAutoBackup({ chrome, now: NOW + EVERY_MS });
  assert.equal(r.done, false);
  assert.match(r.error, /FILE_NO_SPACE/);
  const etat = data[KEY_AUTO_BACKUP];
  assert.equal(etat.files.length, 1, 'le fichier d\'avant reste');
  assert.equal(etat.failedAt, NOW + EVERY_MS);
  assert.equal(autoBackupDue(etat, NOW + EVERY_MS + 1000), false);
  assert.equal(describeAutoBackup(etat).kind, 'failed');
});

test('ce que Reglages affiche', () => {
  assert.deepEqual(describeAutoBackup(undefined), { kind: 'none', last: null });
  const etat = { at: NOW, files: [{ id: 2, at: NOW - DAY }, { id: 3, at: NOW }] };
  const v = describeAutoBackup(etat);
  assert.equal(v.kind, 'ok');
  assert.equal(v.last.id, 3);
  assert.equal(v.count, 2);
  // Un echec plus ancien que le dernier fichier ne compte plus.
  assert.equal(describeAutoBackup({ ...etat, failedAt: NOW - 2 * DAY, error: 'x' }).kind, 'ok');
});

test('la permission est optionnelle, Chrome seulement, et la commande reservee aux pages', () => {
  const chrome = JSON.parse(lire('manifest.json'));
  assert.ok(chrome.optional_permissions.includes(PERMISSION));
  assert.ok(!chrome.permissions.includes(PERMISSION), 'jamais a l\'installation');
  const firefox = JSON.parse(lire('manifest.firefox.json'));
  assert.ok(!(firefox.permissions || []).includes(PERMISSION) && !(firefox.optional_permissions || []).includes(PERMISSION));
  assert.ok(UI_COMMANDS.includes('fgc-auto-backup'));
  assert.equal(messageAllowed('fgc-auto-backup', 'content'), false, 'un script de page ne remplit pas le disque');
  assert.equal(messageAllowed('fgc-auto-backup', 'page'), true);
});

test('le popup et le worker produisent le meme export', () => {
  const popup = lire('pages/popup.js');
  assert.match(popup, /exportFromStorage\(await api\.storage\.local\.get\(EXPORT_KEYS\)/);
  assert.ok(!/buildExport\(/.test(popup), 'un seul endroit construit le fichier');
  const bg = lire('background.js');
  assert.match(bg, /await maybeAutoBackup\(now\);/, 'aussi au reveil, sans attendre un cycle');
  assert.match(bg, /msg\.type === 'fgc-auto-backup'/);
});
