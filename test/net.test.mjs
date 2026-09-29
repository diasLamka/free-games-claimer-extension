/* Reconnaitre une coupure reseau (2.99.4).
 *
 * Un statut HTTP est un serveur qui a repondu ; « Failed to fetch » et ses
 * cousins sont un reseau qui ne repond pas. Les melanger ferait accuser une
 * source de ce qui est la faute du wifi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isNetworkFailure, describeFetchFailure } from '../watch/net.js';

test('isNetworkFailure : un reseau qui ne repond pas, pas un serveur qui repond (2.99.4)', () => {
  for (const m of ['Failed to fetch', 'TypeError: NetworkError when attempting to fetch resource.', 'net::ERR_INTERNET_DISCONNECTED', 'delai depasse (8000 ms)', 'requete abandonnee', 'getaddrinfo ENOTFOUND api.example.org', 'Load failed']) {
    assert.equal(isNetworkFailure(m), true, m);
  }
  for (const m of ['HTTP 503', 'HTTP 404', 'JSON illisible : Unexpected token', 'aucune offre trouvee', '', null, undefined]) {
    assert.equal(isNetworkFailure(m), false, String(m));
  }
});

test('describeFetchFailure : notre minuteur d\'abord, le message ensuite', () => {
  assert.equal(describeFetchFailure(new Error('boum'), { label: 'lecture' }), 'lecture : boum');
  assert.equal(describeFetchFailure(new Error('x'), { timeoutMs: 8000, signal: { aborted: true } }), 'delai depasse (8000 ms)');
  assert.equal(isNetworkFailure(describeFetchFailure(new Error('x'), { timeoutMs: 8000, signal: { aborted: true } })), true);
});
