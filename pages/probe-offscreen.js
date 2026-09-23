/* Sonde executee dans le document offscreen (V0-3).
 *
 * Repond a une seule question : une page invisible de l'extension peut-elle
 * interroger une source distante et analyser sa reponse HTML ? C'est la voie
 * de secours du service worker, qui n'a pas de DOMParser.
 */
const api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

const API_URL = 'https://www.gamerpower.com/api/giveaways?type=game';
const URL_HTML = 'https://store.epicgames.com/free-games?lang=fr';

async function mesurer() {
  const out = { domParser: typeof DOMParser !== 'undefined' };

  try {
    const t0 = performance.now();
    const r = await fetch(API_URL, { credentials: 'omit' });
    const j = await r.json();
    out.api = {
      status: r.status,
      count: Array.isArray(j) ? j.length : null,
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    out.api = { error: String((e && e.message) || e) };
  }

  try {
    const t0 = performance.now();
    const r = await fetch(URL_HTML, { credentials: 'omit' });
    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // La mesure du 2026-08-27 a trouve 83 liens produit dans le HTML brut,
    // alors que la page etait reputee entierement rendue cote client. Les
    // liens seuls ne suffisent pas : ce qui compte est de savoir si les
    // LIBELLES de la rotation hebdomadaire y figurent aussi. S'ils y sont, le
    // parsing peut recouper l'API Epic ; sinon l'API reste la seule source.
    const text = doc.body ? doc.body.textContent || '' : '';
    out.html = {
      status: r.status,
      octets: html.length,
      title: (doc.title || '').slice(0, 80),
      liensProduit: doc.querySelectorAll('a[href*="/p/"], a[href*="/bundles/"]').length,
      rotationDansLeTexte: /gratuit jusqu|free until/i.test(text),
      rotationDansLeHtml: /gratuit jusqu|free until/i.test(html),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    out.html = { error: String((e && e.message) || e) };
  }

  return out;
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fgc-diag-offscreen-run') return;
  mesurer().then(sendResponse);
  return true; // reponse asynchrone
});
