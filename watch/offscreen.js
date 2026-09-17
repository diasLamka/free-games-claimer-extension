/* Lire du HTML depuis un service worker qui n'a pas de DOM.
 *
 * C'est la parade que le design reserve au premier risque du projet (§10 et
 * §15) : aujourd'hui gamerpower porte a lui seul GOG et tout ce qui n'est ni
 * Epic ni Steam, et sa disparition rendrait la veille aveugle sur ces
 * magasins. Une source qui lit une page HTML demande un DOMParser ; un service
 * worker MV3 n'en a pas, et le faire a coups d'expressions regulieres produit
 * du code qui casse tous les deux mois.
 *
 * La mesure V0-3 (2026-08-27, diagnostics.js) a confirme qu'un document
 * offscreen parse le HTML correctement. La permission `offscreen` est dans le
 * manifeste depuis. Ce module est ce qui manquait entre les deux.
 *
 * CE QU'IL NE FAIT PAS, ET C'EST VOULU : il ne connait aucun magasin. Il rend
 * des extraits bruts -- le texte et les attributs des elements qui repondent a
 * un selecteur -- et laisse a chaque source le soin d'en faire des offres,
 * dans une fonction PURE et testable sans navigateur. Mettre la connaissance
 * d'un magasin dans une page qu'aucun test ne peut charger reviendrait a
 * renoncer a la tester.
 *
 * TROIS CONTRAINTES DE LA PLATEFORME :
 *
 *   UN SEUL DOCUMENT A LA FOIS, pour toute l'extension. `createDocument`
 *   REJETTE s'il en existe deja un, et c'est une erreur ordinaire -- pas un
 *   plantage. D'ou `ensureDocument`, qui verifie avant et rattrape apres.
 *
 *   IL N'EXISTE PAS PARTOUT. Firefox n'a pas `chrome.offscreen`. Une source
 *   HTML doit donc pouvoir se declarer indisponible plutot que de jeter.
 *
 *   IL COUTE UN PROCESSUS. On le ferme des qu'on a fini : le laisser ouvert
 *   entre deux cycles maintiendrait le service worker en vie pour rien.
 */

export const OFFSCREEN_URL = 'offscreen-html.html';

/** Le motif declare a Chrome. Il doit correspondre a l'usage reel. */
export const REASON = 'DOM_PARSER';

export const JUSTIFICATION =
  'Analyser le HTML des pages de magasin pour detecter les offres gratuites, '
  + 'un service worker MV3 n\'ayant pas de DOMParser.';

/** Au-dela, on n'attend plus : une page qui ne repond pas a fini de servir. */
export const DEFAULT_TIMEOUT_MS = 20000;

/** La plateforme offre-t-elle des documents offscreen ici ? */
export function hasOffscreen(chrome) {
  return Boolean(chrome && chrome.offscreen && typeof chrome.offscreen.createDocument === 'function');
}

/**
 * Garantit qu'un document existe, sans jamais en creer deux.
 *
 * `hasDocument()` n'existe pas dans toutes les versions : quand il manque, on
 * tente la creation et on accepte l'echec qui dit « il y en a deja un ». Se
 * fier a la seule presence de l'API aurait laisse les anciennes versions
 * creer un second document et echouer bruyamment.
 */
export async function ensureDocument(chrome) {
  if (!hasOffscreen(chrome)) return false;

  try {
    if (typeof chrome.offscreen.hasDocument === 'function' && await chrome.offscreen.hasDocument()) {
      return true;
    }
  } catch { /* on tentera la creation */ }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [REASON],
      justification: JUSTIFICATION,
    });
    return true;
  } catch (e) {
    // « Only a single offscreen document may be created » : il est deja la,
    // ce qui est exactement ce qu'on voulait.
    if (/single offscreen|already/i.test(String((e && e.message) || e))) return true;
    return false;
  }
}

/** Ferme le document. Ne jette jamais : un menage rate n'annule pas un resultat. */
export async function closeDocument(chrome) {
  if (!hasOffscreen(chrome) || typeof chrome.offscreen.closeDocument !== 'function') return;
  try { await chrome.offscreen.closeDocument(); } catch { /* aucun document ouvert */ }
}

/**
 * Pose une question a une page distante et rend des extraits bruts.
 *
 * `queries` : [{ name, selector, attr? }]. Sans `attr`, c'est le texte de
 * l'element ; avec, la valeur de cet attribut, resolue en URL absolue quand
 * c'est un href ou un src.
 *
 * `patterns` : [{ name, source, flags }] -- des expressions regulieres a
 * chercher dans le texte rendu. Elles voyagent en pieces detachees parce
 * qu'une RegExp ne traverse pas `sendMessage`.
 *
 * Rend toujours un objet, jamais une exception : une source muette doit se
 * lire comme une source muette, pas faire tomber le cycle qui l'interroge.
 */
export async function queryHtml(chrome, { url, queries = [], patterns = [], timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!hasOffscreen(chrome)) return { ok: false, error: 'offscreen indisponible sur cette plateforme' };
  if (!url) return { ok: false, error: 'aucune URL' };

  const ouvert = await ensureDocument(chrome);
  if (!ouvert) return { ok: false, error: 'document offscreen impossible a creer' };

  try {
    const reponse = await chrome.runtime.sendMessage({
      type: 'fgc-offscreen-html',
      url,
      queries,
      patterns,
      timeoutMs,
    });
    if (!reponse) return { ok: false, error: 'aucune reponse du document offscreen' };
    return reponse;
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    // Toujours, y compris apres un echec : un document laisse ouvert tient le
    // service worker eveille et consomme un processus pour rien.
    await closeDocument(chrome);
  }
}

/* ------------------------------------------------------------- extraits */

/**
 * Le premier texte non vide d'un extrait, ou null.
 *
 * Les sources travaillent sur ce que rend `queryHtml` : des objets simples,
 * serialisables, que les tests peuvent fabriquer a la main. C'est la
 * frontiere entre ce qui demande un navigateur et ce qui n'en demande pas.
 */
export function firstText(rows) {
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = r && typeof r.text === 'string' ? r.text.trim() : '';
    if (t) return t;
  }
  return null;
}

/** La premiere valeur d'attribut non vide d'un extrait, ou null. */
export function firstValue(rows) {
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = r && typeof r.value === 'string' ? r.value.trim() : '';
    if (v) return v;
  }
  return null;
}
