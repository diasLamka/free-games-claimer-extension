/* La sauvegarde complete, et sa restauration (2.74.0). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BACKUP_KEYS, HISTORY_KEYS, backupBlock, mergeCodes, mergeHistory, mergeLibrary, mergeOutcomes, mergeTaught,
  mergeUi, mergeWishes, mergeAnnotations, planRestore, restoreBackup, snapshot,
} from '../watch/full-backup.js';
import { KEY_ANNOTATIONS } from '../watch/annotations.js';
import { KEY_PHONE } from '../watch/phone.js';
import { UI_COMMANDS, messageAllowed } from '../watch/messaging.js';
import { EXPORT_FORMAT, buildExport } from '../watch/tally.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T10:00:00Z');

test('la sauvegarde emporte ce qui ne se reconstruit pas -- et pas le telephone', () => {
  for (const k of ['FGC_pending_codes', 'FGC_history_Epic Games', 'veille:bibliotheque', 'veille:issues', 'veille:souhaits',
    'veille:souhaits-steam', 'veille:souhaits-gog', 'veille:collection', 'FGC_taught_labels', 'veille:ui', 'veille:reglages']) {
    assert.ok(BACKUP_KEYS.includes(k), k);
  }
  assert.ok(!BACKUP_KEYS.includes(KEY_PHONE), 'l\'adresse du telephone est un secret');
  for (const k of ['veille:offres', 'veille:sources', 'veille:journal']) assert.ok(!BACKUP_KEYS.includes(k), `${k} se reconstruit`);
  const s = snapshot({ 'veille:souhaits': [], [KEY_PHONE]: { url: 'https://ntfy.sh/secret' }, autre: 1 });
  assert.deepEqual(Object.keys(s), ['veille:souhaits']);
  const e = buildExport({ now: NOW, backup: s });
  assert.equal(e.exportFormat, EXPORT_FORMAT);
  assert.equal(EXPORT_FORMAT, 2);
  assert.deepEqual(e.backup, s);
});

test('les codes et les historiques : ce qui manque s\'ajoute, ce qui est la reste', () => {
  const c = mergeCodes(JSON.stringify([{ code: 'AAAA-1111', title: 'local' }]),
    [{ code: 'AAAA-1111', title: 'fichier' }, { code: 'BBBB-2222' }, { code: '' }, 'x', { code: 'Z'.repeat(200) }]);
  assert.equal(c.added, 1);
  assert.deepEqual(c.value.map((x) => x.code), ['AAAA-1111', 'BBBB-2222']);
  assert.equal(c.value[0].title, 'local');

  const h = mergeHistory(JSON.stringify({ 'slug:a': { status: 'claimed', ts: 2 } }),
    JSON.stringify({ 'slug:a': { status: 'failed', ts: 9 }, 'slug:b': { status: 'claimed', ts: 1 }, 'slug:c': { status: 3 } }));
  assert.equal(h.added, 1);
  assert.equal(h.value['slug:a'].status, 'claimed', 'une entree deja la n\'est pas remplacee');
  assert.ok(!('slug:c' in h.value), 'une entree mal formee est ignoree');
});

test('le registre garde la premiere date ; les issues et les souhaits se reunissent', () => {
  const l = mergeLibrary({ 'epic:a': { store: 'epic', id: 'a', title: null, ts: 50 } },
    { 'epic:a': { store: 'epic', id: 'a', title: 'Alpha', ts: 10 }, 'gog:b': { store: 'gog', id: 'b', title: 'Beta', ts: 20 }, x: 'y' });
  assert.equal(l.added, 1);
  assert.equal(l.value['epic:a'].ts, 10);
  assert.equal(l.value['epic:a'].title, 'Alpha', 'un champ vide se complete');

  const o = mergeOutcomes({ k1: { outcome: 'taken', ts: 5 } }, { k1: { outcome: 'missed', ts: 6 }, k2: { outcome: 'missed', ts: 7 }, k3: {} });
  assert.deepEqual(Object.keys(o.value).sort(), ['k1', 'k2']);
  assert.equal(o.value.k1.outcome, 'taken');

  const w = mergeWishes([{ title: 'Hollow Knight', key: 'hollow knight' }],
    [{ title: 'HOLLOW KNIGHT', key: 'hollow knight' }, { title: 'Celeste', key: 'celeste' }, { title: 'x' }]);
  assert.deepEqual(w.value.map((x) => x.title), ['Hollow Knight', 'Celeste']);
});

test('un libelle appris repasse par la garde : l\'argent reste refuse', () => {
  const r = mergeTaught({ luna: ['obtenir le jeu'] }, { luna: ['Acheter 19,99 €', 'récupérer maintenant'], gog: ['valider'], inconnue: ['x'] }, NOW);
  assert.ok(!r.value.luna.some((l) => /acheter/i.test(l)));
  assert.ok(r.value.luna.includes('obtenir le jeu'));
  assert.ok(!('inconnue' in r.value));
});

test('les preferences : celles du fichier, les listes reunies', () => {
  const u = mergeUi({ theme: 'dark', pinned: ['a'], dismissed: ['x'] }, { theme: 'light', pinned: ['b'], dismissed: ['x', 3], language: 'fr' });
  assert.equal(u.value.theme, 'light');
  assert.deepEqual(u.value.pinned, ['a', 'b']);
  assert.deepEqual(u.value.dismissed, ['x']);
});

test('les etats des jeux (2.95.0) : ceux du fichier s\'ajoutent, ceux d\'ici gagnent', () => {
  assert.ok(BACKUP_KEYS.includes(KEY_ANNOTATIONS));
  const r = mergeAnnotations(
    { 'steam:1': { status: 'playing', note: '' } },
    { 'steam:1': { status: 'done', note: '' }, 'gog:2': { status: 'notForMe', note: '' }, 'epic:3': { status: 'nimporte', note: '' }, 'epic:4': 'x' },
  );
  assert.deepEqual(r.value, { 'steam:1': { status: 'playing', note: '' }, 'gog:2': { status: 'notForMe', note: '' } });
  assert.equal(r.added, 1);
  assert.equal(planRestore({}, { [KEY_ANNOTATIONS]: { 'steam:9': { status: 'toTry' } } }, { now: NOW }).added[KEY_ANNOTATIONS], 1);
});

test('le plan : la recuperation Steam ne se rallume jamais, les photographies ne remplacent rien', () => {
  const fichier = {
    'veille:reglages': { steamAutoClaim: true, notifyMode: 'digest' },
    'veille:souhaits-steam': { at: 1, wishes: [{ id: '1', title: 'A', key: 'a' }] },
    'veille:souhaits-gog': { at: 1, wishes: [{ id: '2', title: 'B', key: 'b' }] },
    'veille:collection': { stores: {}, items: { 'steam:1': { title: 'A' } } },
    FGC_epic_auto_mode: false,
    FGC_luna_auto_mode: 'oui',
    FGC_epic_country: 'de',
  };
  const p = planRestore({ 'veille:souhaits-gog': { at: 5, wishes: [] } }, fichier, { now: NOW, steamAutoClaim: false });
  assert.equal(p.write['veille:reglages'].steamAutoClaim, false);
  assert.equal(p.write['veille:reglages'].notifyMode, 'digest');
  assert.ok('veille:souhaits-steam' in p.write, 'absente : elle revient');
  assert.ok(!('veille:souhaits-gog' in p.write), 'deja la : on la garde');
  assert.equal(p.added['veille:collection'], 1);
  assert.equal(p.write.FGC_epic_auto_mode, false);
  assert.ok(!('FGC_luna_auto_mode' in p.write), 'pas un booleen : ignore');
  assert.equal(p.write.FGC_epic_country, 'DE');
});

test('une sauvegarde d\'avant la 2.74.0 se restaure encore : codes, filtres, reglages', () => {
  const b = backupBlock({ exportFormat: 1, pendingCodes: [{ code: 'CCCC-3333' }], filters: { minWorth: 1 }, settings: { x: 1 } });
  assert.deepEqual(Object.keys(b).sort(), ['FGC_pending_codes', 'veille:filtres', 'veille:reglages']);
  assert.equal(backupBlock({ autre: 1 }), null);
  assert.equal(backupBlock('texte'), null);
});

function stockage(d = {}) {
  return { d, storage: { local: {
    get: async (cles) => Object.fromEntries(cles.filter((k) => k in d).map((k) => [k, JSON.parse(JSON.stringify(d[k]))])),
    set: async (o) => { Object.assign(d, JSON.parse(JSON.stringify(o))); },
  } } };
}

test('aller-retour : une installation vide retrouve tout ; une seconde restauration n\'ajoute rien', async () => {
  const ancien = stockage({
    FGC_pending_codes: JSON.stringify([{ code: 'DDDD-4444', store: 'gog', title: 'Right and Down' }]),
    'FGC_history_Epic Games': JSON.stringify({ 'slug:x': { status: 'claimed', ts: 100, title: 'X' } }),
    'veille:bibliotheque': { 'epic:x': { store: 'epic', id: 'x', title: 'X', ts: 100, status: 'claimed' } },
    'veille:issues': { 'epic:x': { outcome: 'taken', ts: 100, title: 'X' } },
    'veille:souhaits': [{ title: 'Silksong', key: 'silksong' }],
    'veille:telephone': { on: true, url: 'https://ntfy.sh/secret-topic' },
  });
  const fichier = { exportFormat: 2, backup: snapshot(await ancien.storage.local.get(BACKUP_KEYS)) };
  assert.ok(!JSON.stringify(fichier).includes('secret-topic'));

  const neuf = stockage({});
  const r = await restoreBackup(neuf, JSON.parse(JSON.stringify(fichier)), { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.added['veille:bibliotheque'], 1);
  assert.equal(r.added['FGC_history_Epic Games'], 1);
  for (const k of HISTORY_KEYS.slice(0, 1)) assert.equal(typeof neuf.d[k], 'string', 'le moteur lit ses historiques en texte');
  assert.equal(JSON.parse(neuf.d.FGC_pending_codes)[0].code, 'DDDD-4444');
  assert.deepEqual(neuf.d['veille:souhaits'], [{ title: 'Silksong', key: 'silksong' }]);
  assert.equal(neuf.d['veille:telephone'], undefined);

  const encore = await restoreBackup(neuf, fichier, { now: NOW });
  assert.equal(Object.values(encore.added).reduce((n, x) => n + x, 0), 0);
  assert.deepEqual((await restoreBackup(neuf, { autre: 1 })).reason, 'not-ours');
});

test('la restauration passe par le worker, et seulement depuis une page', () => {
  assert.ok(UI_COMMANDS.includes('fgc-restore'));
  assert.equal(messageAllowed('fgc-restore', 'content'), false);
  assert.match(lire('background.js'), /restoreBackup\(api, msg\.data, \{ now: Date\.now\(\) \}\)/);
  const js = lire('pages/popup.js');
  assert.match(js, /const r = await tell\('fgc-restore', \{ data \}\);/);
  // Depuis la 2.77.0, l'export passe par watch/auto-backup.js, qui lit tout BACKUP_KEYS.
  assert.match(js, /exportFromStorage\(await api\.storage\.local\.get\(EXPORT_KEYS\)/);
  assert.doesNotMatch(js, /setValue\(KEY_CODES, JSON\.stringify\(\[\.\.\.existing/, 'le popup n\'ecrit plus lui-meme');
  const html = lire('pages/popup.html');
  assert.match(html, /data-i18n="backupHint"/);
  assert.match(html, /<b data-i18n="shortcutsInPopup"><\/b> <span data-i18n="shortcutsBody"><\/span>/, 'l\'aide du clavier a rejoint les raccourcis');
});
