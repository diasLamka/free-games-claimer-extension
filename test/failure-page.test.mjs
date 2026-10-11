/* Le moteur joint ce que la page montre a chaque verdict d'echec (2.111.0).
 *
 * L'extension et l'appli lisent le meme message `fgc-verdict` ; c'est ici, une seule fois, que la page est lue. Le moteur n'envoie
 * qu'un extrait borne (adresse sans parametres, titre, six cents caracteres) : le nettoyage -- adresses electroniques, jetons --
 * se fait chez chacun de ceux qui le gardent, voir watch/failure-report.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness.mjs';

function moteur({ texte = 'Something went wrong. Please try again later.', titre = 'GOG.com', search = '?token=SECRET' } = {}) {
  const { fgc, sandbox } = loadEngine({ hostname: 'www.gog.com', pathname: '/en/game/hades', search });
  const envoyes = [];
  sandbox.chrome = { runtime: { sendMessage: (m) => envoyes.push(m) } };
  sandbox.document.title = titre;
  sandbox.document.body.innerText = texte;
  return { fgc, envoyes };
}

test('un echec emporte l\'adresse sans parametres, le titre et le debut du texte', () => {
  const { fgc, envoyes } = moteur();
  fgc.sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'delai depasse', plateforme: 'GOG' });
  assert.equal(envoyes.length, 1);
  const page = envoyes[0].page;
  assert.equal(page.url, 'https://www.gog.com/en/game/hades');
  assert.equal(page.title, 'GOG.com');
  assert.equal(page.text, 'Something went wrong. Please try again later.');
  assert.equal(envoyes[0].reasonText, 'delai depasse', 'le reste du message est intact');
});

test('les verdicts qui demandent un regard emportent la page, les autres non', () => {
  for (const v of ['failed', 'challenge', 'needs_login', 'needs_teaching']) {
    const { fgc, envoyes } = moteur();
    fgc.sendToPilot({ type: 'fgc-verdict', verdict: v, plateforme: 'GOG' });
    assert.ok(envoyes[0].page, v);
  }
  for (const v of ['claimed', 'redeemed', 'already_redeemed', 'gone', 'owned']) {
    const { fgc, envoyes } = moteur();
    fgc.sendToPilot({ type: 'fgc-verdict', verdict: v, plateforme: 'GOG' });
    assert.equal('page' in envoyes[0], false, v);
  }
});

test('un message qui n\'est pas un verdict est laisse tel quel', () => {
  const { fgc, envoyes } = moteur();
  fgc.sendToPilot({ type: 'fgc-inspection', verdict: 'failed' });
  assert.equal('page' in envoyes[0], false);
});

test('le texte est borne a six cents caracteres, les blancs ramenes a un', () => {
  const { fgc, envoyes } = moteur({ texte: ('mot   \n\n suivant ').repeat(300) });
  fgc.sendToPilot({ type: 'fgc-verdict', verdict: 'failed', plateforme: 'GOG' });
  const t = envoyes[0].page.text;
  assert.ok(t.length <= 600, String(t.length));
  assert.ok(!/\s{2,}/.test(t));
});

test('une page illisible n\'empeche pas le verdict de partir', () => {
  const { fgc, sandbox } = loadEngine({ hostname: 'www.gog.com', pathname: '/en/game/hades' });
  const envoyes = [];
  sandbox.chrome = { runtime: { sendMessage: (m) => envoyes.push(m) } };
  Object.defineProperty(sandbox.document, 'body', { get() { throw new Error('page fermee'); } });
  fgc.sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'x', plateforme: 'GOG' });
  assert.equal(envoyes.length, 1, 'le verdict part');
  assert.equal(envoyes[0].verdict, 'failed');
  assert.equal(envoyes[0].page == null, true, 'sans page');
});
