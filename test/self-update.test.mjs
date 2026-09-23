/* L'extension se recharge quand son dossier a ete mis a jour (2.53.0).
 *
 * Installee depuis un dossier, elle ne se mettait jamais a jour seule :
 * tools/maj-auto.ps1 fait le `git pull`, watch/self-update.js fait le clic sur
 * « Recharger ». Ces tests tiennent ses trois garde-fous : un dossier
 * seulement, jamais en pleine reclamation, jamais vers le bas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALARM_DISK, compareVersions, diskVersion, reloadDecision, launcherMatches, tabsBusy, checkDisk, updatedNotice,
} from '../watch/self-update.js';

const ROOT = new URL('../', import.meta.url);
const lire = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const MANIFEST = JSON.parse(lire('manifest.json'));

/* ------------------------------------------------------------ versions */

test('les versions se comparent nombre par nombre, pas comme du texte', () => {
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1);
  assert.equal(compareVersions('2.52.0', '2.52.0'), 0);
  assert.equal(compareVersions('2.52', '2.52.0'), 0);
  assert.equal(compareVersions('2.51.9', '2.52.0'), -1);
  assert.equal(compareVersions('3.0.0', '2.99.99'), 1);
});

test('une version qu\'on ne comprend pas ne compare rien', () => {
  for (const v of [null, undefined, '', 'v2.0', '2.0-beta', '2..0', 42]) {
    assert.equal(compareVersions(v, '1.0.0'), null, String(v));
  }
});

/* ------------------------------------------------------------ le disque */

const reponse = (corps, ok = true) => async () => ({ ok, text: async () => corps });

test('la version du disque se lit dans son manifest.json, sans cache', async () => {
  let vu = null;
  const fetch = async (url, init) => { vu = { url, init }; return { ok: true, text: async () => '{"version":"2.53.0"}' }; };
  assert.equal(await diskVersion({ fetch, url: 'chrome-extension://x/manifest.json' }), '2.53.0');
  assert.deepEqual(vu, { url: 'chrome-extension://x/manifest.json', init: { cache: 'no-store' } });
});

test('un manifeste illisible, absent ou sans version rend null', async () => {
  assert.equal(await diskVersion({ fetch: reponse('{pas du json'), url: 'u' }), null);
  assert.equal(await diskVersion({ fetch: reponse('{}'), url: 'u' }), null);
  assert.equal(await diskVersion({ fetch: reponse('{"version":"1"}', false), url: 'u' }), null);
  assert.equal(await diskVersion({ fetch: async () => { throw new Error('x'); }, url: 'u' }), null);
});

/* ------------------------------------------------------------ la decision */

const dev = { installType: 'development', running: '2.52.0', onDisk: '2.53.0', busy: false };

test('dossier, version plus recente, rien en cours : on recharge', () => {
  const d = reloadDecision(dev);
  assert.equal(d.reload, true);
  assert.match(d.reason, /2\.53\.0.*2\.52\.0/);
});

test('les trois garde-fous', () => {
  assert.equal(reloadDecision({ ...dev, installType: 'normal' }).reload, false, 'le Web Store se met a jour seul');
  assert.equal(reloadDecision({ ...dev, busy: true }).reload, false, 'jamais en pleine reclamation');
  assert.match(reloadDecision({ ...dev, busy: true }).reason, /on attendra/);
  assert.equal(reloadDecision({ ...dev, onDisk: '2.51.0' }).reload, false, 'jamais vers le bas');
  assert.equal(reloadDecision({ ...dev, onDisk: '2.52.0' }).reload, false);
  assert.equal(reloadDecision({ ...dev, onDisk: null }).reload, false);
  assert.equal(reloadDecision({ ...dev, onDisk: 'n/a' }).reload, false);
});

/* ------------------------------------------------------------ les onglets */

test('les onglets interroges sont ceux du lanceur, lus dans le manifeste', () => {
  const lanceur = MANIFEST.content_scripts.find((c) => c.js.includes('content/launcher.js'));
  assert.deepEqual(launcherMatches(MANIFEST), lanceur.matches);
  assert.deepEqual(launcherMatches({}), []);
});

function fauxChrome({ onglets = [], reponses = {}, installType = 'development', version = '2.52.0', disque = '2.53.0' } = {}) {
  const journal = { recharge: 0, questions: [], requete: null };
  return {
    journal,
    fetch: async () => ({ ok: true, text: async () => JSON.stringify({ version: disque }) }),
    chrome: {
      management: { getSelf: async () => ({ installType }) },
      runtime: {
        getManifest: () => ({ ...MANIFEST, version }),
        getURL: (p) => `chrome-extension://moi/${p}`,
        reload: () => { journal.recharge++; },
      },
      tabs: {
        query: async (q) => { journal.requete = q; return onglets.map((id) => ({ id })); },
        sendMessage: (id, msg, opts) => {
          journal.questions.push({ id, msg, opts });
          const r = reponses[id];
          if (r === 'muet') return new Promise(() => {});
          if (r === 'absent') return Promise.reject(new Error('Receiving end does not exist'));
          return Promise.resolve(r);
        },
      },
    },
  };
}

test('un onglet qui reclame retient le rechargement ; les autres non', async () => {
  const f = fauxChrome({ onglets: [1, 2, 3], reponses: { 1: { occupe: false }, 2: 'absent', 3: { occupe: true } } });
  assert.equal(await tabsBusy({ chrome: f.chrome, matches: ['https://*.epicgames.com/*'] }), true);
  assert.deepEqual(f.journal.requete, { url: ['https://*.epicgames.com/*'] });
  assert.deepEqual(f.journal.questions[0], { id: 1, msg: { type: 'fgc-occupe' }, opts: { frameId: 0 } });

  const calme = fauxChrome({ onglets: [1, 2], reponses: { 1: { occupe: false }, 2: 'absent' } });
  assert.equal(await tabsBusy({ chrome: calme.chrome, matches: ['x'] }), false);
});

test('un onglet muet ne bloque pas : passe le delai, il ne compte pas', async () => {
  const f = fauxChrome({ onglets: [1], reponses: { 1: 'muet' } });
  assert.equal(await tabsBusy({ chrome: f.chrome, matches: ['x'], timeoutMs: 20 }), false);
});

/* ------------------------------------------------------------ le tour complet */

test('le tour complet recharge, et le dit au journal', async () => {
  const f = fauxChrome({ onglets: [1], reponses: { 1: { occupe: false } } });
  const lignes = [];
  const d = await checkDisk({ chrome: f.chrome, fetch: f.fetch, record: (n, m) => lignes.push([n, m]) });
  assert.equal(d.reload, true);
  assert.equal(f.journal.recharge, 1);
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0][0], 'info');
});

test('un cycle en cours retient le rechargement sans meme interroger les onglets', async () => {
  const f = fauxChrome({ onglets: [1] });
  const d = await checkDisk({ chrome: f.chrome, fetch: f.fetch, cycleBusy: true });
  assert.equal(d.reload, false);
  assert.equal(f.journal.recharge, 0);
  assert.equal(f.journal.questions.length, 0);
});

test('une installation du Web Store ne lit meme pas le disque', async () => {
  const f = fauxChrome({ installType: 'normal' });
  let lu = false;
  const d = await checkDisk({ chrome: f.chrome, fetch: async () => { lu = true; return null; } });
  assert.equal(d.reload, false);
  assert.equal(lu, false);
  assert.equal(f.journal.recharge, 0);
});

test('a jour : rien au journal, aucun onglet derange', async () => {
  const f = fauxChrome({ disque: '2.52.0', onglets: [1] });
  const lignes = [];
  await checkDisk({ chrome: f.chrome, fetch: f.fetch, record: (...a) => lignes.push(a) });
  assert.equal(lignes.length, 0);
  assert.equal(f.journal.questions.length, 0);
});

test('sans API management (navigateur ancien), rien ne se passe', async () => {
  const f = fauxChrome();
  delete f.chrome.management;
  assert.equal((await checkDisk({ chrome: f.chrome, fetch: f.fetch })).reload, false);
});

/* ------------------------------------------------------------ apres */

test('la notification ne part que si la version a monte', () => {
  assert.deepEqual(updatedNotice({ reason: 'update', previousVersion: '2.52.0' }, '2.53.0'), { from: '2.52.0', to: '2.53.0' });
  assert.equal(updatedNotice({ reason: 'update', previousVersion: '2.53.0' }, '2.53.0'), null, 'un simple « Recharger »');
  assert.equal(updatedNotice({ reason: 'install' }, '2.53.0'), null);
  assert.equal(updatedNotice(null, '2.53.0'), null);
});

/* ------------------------------------------------------------ le branchement */

test('le worker arme l\'alarme, l\'ecoute, et la langue choisie passe avant les textes', () => {
  const bg = lire('background.js');
  assert.match(bg, /alarme\.name === ALARM_DISK/);
  assert.match(bg, /checkDisk\(\{ chrome: api, fetch: .*cycleBusy: !!cycleRunning/);
  assert.match(bg, /armerDisque\(\)\.catch/);
  assert.match(bg, /await langue;\s*\n\s*const raw = await readKeys\(api, \[/, 'la fiche attend la langue');
  assert.equal(ALARM_DISK, 'veille-disque');
});

/* ------------------------------------------------------------ le script Windows */

test('tools/maj-auto.ps1 : ASCII pur, et jamais d\'ecrasement', () => {
  const ps = lire('tools/maj-auto.ps1');
  assert.ok(/^[\x00-\x7F]*$/.test(ps), 'PowerShell 5.1 lit un script sans BOM dans la page de code locale');
  assert.match(ps, /status --porcelain/, 'refuse un fichier modifie a la main');
  assert.match(ps, /merge-base --is-ancestor/, 'refuse un historique qui a diverge');
  assert.match(ps, /merge --ff-only/, 'avance, ne fusionne jamais');
  const commandes = ps.split('\n').filter((l) => /^\s*[$(]?.*AppelGit /.test(l)).join('\n');
  for (const interdit of ['reset', 'checkout', 'clean', 'stash', 'push', '--force']) {
    assert.ok(!commandes.includes(interdit), `aucune commande git « ${interdit} »`);
  }
  assert.ok(!/^\s*function Git\b/m.test(ps), 'une fonction Git masquerait la commande git et s\'appellerait elle-meme');
});
