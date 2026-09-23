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
  NATIVE_UPDATE, INSTALL_COMMAND, readUpdateReply, requestUpdate, updateMessage,
} from '../watch/self-update.js';
import { messageAllowed } from '../watch/messaging.js';

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

/* ------------------------------------------------------------ les declencheurs (2.54.0) */

test('checkDisk peut differer le rechargement, le temps de repondre au popup', async () => {
  const f = fauxChrome({ onglets: [] });
  const minuteries = [];
  const avant = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => { minuteries.push(ms); fn(); return 0; };
  try {
    const d = await checkDisk({ chrome: f.chrome, fetch: f.fetch, delayMs: 1200 });
    assert.equal(d.reload, true);
    assert.equal(d.onDisk, '2.53.0', 'la version lue sur le disque est rendue');
  } finally { globalThis.setTimeout = avant; }
  assert.deepEqual(minuteries, [1200]);
  assert.equal(f.journal.recharge, 1);
});

test('le bouton : un message sans commande, au seul relais de l\'extension', async () => {
  let vu = null;
  const chrome = { runtime: { sendNativeMessage: async (nom, msg) => { vu = { nom, msg }; return { ok: true, etat: 'mis-a-jour', avant: '2.53.0', apres: '2.54.0', detail: 'x' }; } } };
  const r = await requestUpdate({ chrome });
  assert.deepEqual(vu, { nom: NATIVE_UPDATE, msg: { cmd: 'maj' } });
  assert.deepEqual(r, { ok: true, etat: 'mis-a-jour', avant: '2.53.0', apres: '2.54.0', detail: 'x' });
});

test('le bouton : chaque panne de Chrome devient un etat que le popup sait dire', async () => {
  const echoue = (m) => ({ runtime: { sendNativeMessage: async () => { throw new Error(m); } } });
  assert.equal((await requestUpdate({ chrome: { runtime: {} } })).etat, 'sans-permission');
  assert.equal((await requestUpdate({ chrome: echoue('Specified native messaging host not found.') })).etat, 'sans-relais');
  assert.equal((await requestUpdate({ chrome: echoue('Access to the specified native messaging host is forbidden.') })).etat, 'refuse-origine');
  const r = await requestUpdate({ chrome: echoue('Native host has exited.') });
  assert.deepEqual([r.etat, r.detail], ['echec', 'Native host has exited.']);
});

test('la reponse du relais est verifiee comme une source externe', () => {
  assert.equal(readUpdateReply(null).etat, 'echec');
  assert.equal(readUpdateReply({ ok: true, etat: 'rm -rf' }).etat, 'echec');
  const r = readUpdateReply({ ok: 'oui', etat: 'a-jour', avant: 'x'.repeat(99), detail: 7 });
  assert.deepEqual(r, { ok: false, etat: 'a-jour', avant: 'x'.repeat(20), apres: '', detail: '' }, 'ok doit valoir true, pas « oui »');
});

test('ce que le popup dit, pour chaque issue', () => {
  const ok = (etat, extra = {}) => ({ ok: true, etat, avant: '2.53.0', apres: '2.54.0', ...extra });
  assert.deepEqual(updateMessage(ok('mis-a-jour'), { disk: { reload: true, onDisk: '2.54.0' } }), ['updateReloading', '2.54.0']);
  assert.deepEqual(updateMessage(ok('mis-a-jour'), { disk: { reload: false, busy: true, onDisk: '2.54.0' } }), ['updateAfterClaim', '2.54.0']);
  assert.deepEqual(updateMessage(ok('mis-a-jour'), { disk: { reload: false } }), ['updatePulled', '2.54.0']);
  assert.deepEqual(updateMessage(ok('a-jour', { apres: '2.53.0' }), { disk: { reload: false }, running: '2.53.0' }), ['updateUpToDate', '2.53.0']);
  // Deja a jour pour git, mais l'heure precedente avait ramene une version pas encore chargee.
  assert.deepEqual(updateMessage(ok('a-jour'), { disk: { reload: true, onDisk: '2.54.0' } }), ['updateReloading', '2.54.0']);

  const ko = (etat) => updateMessage({ ok: false, etat, detail: 'd' }, { id: 'abcd' });
  assert.deepEqual(ko('sans-relais'), ['updateNoHost', INSTALL_COMMAND]);
  assert.deepEqual(ko('refuse-origine'), ['updateWrongId', `${INSTALL_COMMAND} -IdExtension abcd`]);
  for (const [etat, cle] of [['sans-permission', 'updateDenied'], ['sans-git', 'updateNoGit'], ['pas-depot', 'updateNotRepo'],
    ['modifie', 'updateModified'], ['branche', 'updateBranch'], ['divergent', 'updateDiverged'], ['reseau', 'updateNetwork'],
    ['occupe', 'updateBusyHost']]) {
    assert.deepEqual(ko(etat), [cle], etat);
  }
  assert.deepEqual(ko('echec'), ['updateFailed', 'd']);
});

test('toutes les cles que le popup peut recevoir existent dans les quatre langues', () => {
  const cles = [...lire('watch/self-update.js').matchAll(/\['(update[A-Za-z]+)'/g)].map((m) => m[1]);
  assert.ok(cles.length >= 14);
  for (const loc of ['en', 'fr', 'de', 'es']) {
    const table = JSON.parse(lire(`_locales/${loc}/messages.json`));
    for (const c of [...cles, 'updateTitle', 'updateNow', 'updateHint', 'updateWorking', 'updateVersion']) {
      assert.ok(table[c] && table[c].message, `${loc} : ${c}`);
    }
  }
});

test('fgc-maj ne vient que d\'une page de l\'extension, et le worker y repond avant de recharger', () => {
  assert.equal(messageAllowed('fgc-maj', 'page'), true);
  assert.equal(messageAllowed('fgc-maj', 'content'), false, 'une page de magasin ne declenche rien');
  const bg = lire('background.js');
  assert.match(bg, /msg\.type === 'fgc-maj'[\s\S]{0,600}delayMs: 1200[\s\S]{0,200}sendResponse/);
});

test('le popup demande la permission avant tout await, et ne montre la section qu\'a un dossier', () => {
  const js = lire('pages/popup.js');
  const clic = js.slice(js.indexOf("getElementById('update-now').addEventListener"));
  const premier = clic.indexOf('await ');
  assert.ok(premier > 0 && clic.slice(premier).startsWith('await api.permissions.request'), 'Firefox refuse une demande apres un await');
  assert.match(js, /installType !== 'development'\) return;\s*\n\s*document\.getElementById\('update-section'\)\.hidden = false/);
  assert.match(lire('pages/popup.html'), /<section id="update-section" hidden>/);
});

test('le script : le relais n\'execute rien de ce qu\'il recoit, la sonnette non plus', () => {
  const ps = lire('tools/maj-auto.ps1');
  assert.ok(/^[\x00-\x7F]*$/.test(ps));
  for (const interdit of ['Invoke-Expression', 'iex ', 'ScriptBlock]::Create', '.message', 'Add-Type']) {
    assert.ok(!ps.includes(interdit), interdit);
  }
  assert.match(ps, /\$m\.cmd -ne 'maj'/, 'un seul message accepte');
  assert.match(ps, /\$taille -gt 4096/, 'un message trop long est ignore');
  assert.match(ps, /Local\\FreeGamesAutoClaimer-maj'/, 'un verrou : trois declencheurs, une ecriture git a la fois');
  assert.match(ps, /'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'/, 'la session, sans droits d\'administrateur');
  assert.ok(!/HKLM:/.test(ps), 'rien sous HKLM : aucun droit d\'administrateur');
});

test('la sonnette de GitHub : seulement sur main, secret facultatif, jamais bloquante', () => {
  const ci = lire('.github/workflows/check.yml');
  const etape = ci.slice(ci.indexOf('- name: Sonnette de mise a jour'));
  assert.match(etape, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(etape, /MAJ_NTFY: \$\{\{ secrets\.MAJ_NTFY \}\}/);
  assert.match(etape, /if \[ -z "\$MAJ_NTFY" \]; then .*exit 0; fi/);
  assert.match(etape, /\|\| echo "ntfy injoignable/);
  assert.match(ci, /permissions:\s*\n\s*contents: read/, 'le workflow reste en lecture seule');
});
