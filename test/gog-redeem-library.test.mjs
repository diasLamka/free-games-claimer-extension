/* Un echange GOG se juge sur la bibliotheque quand la page ne dit rien de lisible (2.110.0).
 *
 * Le 2026-10-11, GOG a change la phrase de sa page de succes : le moteur ne l'a pas reconnue, et a declare « non confirme » un
 * jeu pourtant ajoute au compte. Les phrases se perdent a chaque refonte ; la bibliotheque, elle, dit la verite. Quand l'attente
 * finit sans phrase ni refus, le moteur interroge donc la bibliotheque du compte (meme origine, meme session) : le titre y est,
 * c'est un succes ; il n'y est pas -- GOG annonce qu'il peut mettre un moment --, l'echange reste « non confirme ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness.mjs';

const { fgc } = loadEngine();

test('l\'adresse de recherche nettoie le titre et le borne', () => {
  const u = fgc.gogLibrarySearchUrl('WarBreeds (Amazon Luna) Giveaway');
  assert.ok(u.startsWith('https://www.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=1&search='));
  assert.equal(decodeURIComponent(u.split('search=')[1]), 'WarBreeds');
  assert.ok(decodeURIComponent(fgc.gogLibrarySearchUrl('x'.repeat(300)).split('search=')[1]).length <= 80);
});

test('le titre est reconnu dans la liste, a la casse et aux editions pres', () => {
  const body = { products: [{ title: 'Warbreeds' }, { title: 'Another Game' }] };
  assert.equal(fgc.gogLibraryHasTitle(body, 'WarBreeds'), true);
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: 'Warbreeds - Deluxe Edition' }] }, 'WarBreeds'), true);
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: 'Other Game' }] }, 'Warbreeds'), false);
});

test('un titre voisin n\'est pas le meme jeu', () => {
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: 'Warbreeds 2' }] }, 'Warbreeds'), false);
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: 'War' }] }, 'Warbreeds'), false);
});

test('une reponse illisible ou un titre vide ne prouvent rien', () => {
  for (const body of [null, undefined, {}, { products: 'x' }, { products: [] }, 'texte']) {
    assert.equal(fgc.gogLibraryHasTitle(body, 'Warbreeds'), false);
  }
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: '' }] }, ''), false);
  assert.equal(fgc.gogLibraryHasTitle({ products: [{ title: 'A' }] }, null), false);
});

test('la lecture de la bibliotheque rend vrai quand le titre y est', async () => {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push([url, opts]);
    return { ok: true, json: async () => ({ products: [{ title: 'Warbreeds' }] }) };
  };
  assert.equal(await fgc.gogOwnedInLibrary('WarBreeds', fetcher), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].credentials, 'include', 'avec la session du compte');
});

test('la lecture rend faux quand le titre n\'y est pas, ou quand rien ne se lit', async () => {
  assert.equal(await fgc.gogOwnedInLibrary('Warbreeds', async () => ({ ok: true, json: async () => ({ products: [] }) })), false);
  assert.equal(await fgc.gogOwnedInLibrary('Warbreeds', async () => ({ ok: false, status: 403, json: async () => ({}) })), false);
  assert.equal(await fgc.gogOwnedInLibrary('Warbreeds', async () => { throw new Error('reseau'); }), false);
  assert.equal(await fgc.gogOwnedInLibrary('Warbreeds', async () => ({ ok: true, json: async () => { throw new Error('pas du json'); } })), false);
});

test('une attente sans verdict est rejugee par la bibliotheque', async () => {
  const has = async () => ({ ok: true, json: async () => ({ products: [{ title: 'Warbreeds' }] }) });
  const hasNot = async () => ({ ok: true, json: async () => ({ products: [] }) });
  const timeout = { type: 'timeout' };
  const rejuge = await fgc.gogSettleOutcome(timeout, 'WarBreeds', has);
  assert.equal(rejuge.type, 'success');
  assert.equal(rejuge.detail, 'bibliotheque');
  assert.equal(await fgc.gogSettleOutcome(timeout, 'WarBreeds', hasNot), timeout, 'absent : le verdict reste non confirme');
});

test('un refus, un captcha ou un succes lu ne sont jamais rejuges', async () => {
  let asked = 0;
  const has = async () => { asked += 1; return { ok: true, json: async () => ({ products: [{ title: 'Warbreeds' }] }) }; };
  for (const outcome of [{ type: 'invalid', detail: 'x' }, { type: 'used' }, { type: 'captcha' }, { type: 'error' }, { type: 'success' }]) {
    assert.equal(await fgc.gogSettleOutcome(outcome, 'Warbreeds', has), outcome);
  }
  assert.equal(asked, 0, 'la bibliotheque n\'est pas interrogee');
});
