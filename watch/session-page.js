/* Charger la page du compte pour lire la session (2.99.6).
 *
 * Voir `PAGE_URLS` dans watch/session.js pour POURQUOI : c'est le chargement de
 * la page qui renouvelle les jetons de Steam et d'Epic, et c'est ce que
 * l'utilisateur faisait a la main quand la sonde rapide se trompait.
 *
 * CE QUE CA FAIT, ET RIEN DE PLUS. Une fenetre reduite (la meme que celle d'une
 * reclamation) charge la page du compte, on lit ou elle a atterri et son titre,
 * on la referme. Rien n'est clique, rien n'est lu dans la page, aucun script n'y
 * est injecte : seulement l'adresse et le titre de l'onglet.
 *
 * Module sans etat : ce qu'il touche de la plateforme lui est passe.
 */
import { PAGE_URLS } from './session.js';
import {
  LOAD_WAIT_MS, awaitLoad, expectClosure, forgetPiloted, markPiloted, openHiddenTab,
} from './claim.js';

/** Le temps de laisser un routeur JavaScript renvoyer vers la connexion, une fois la page chargee. */
export const SETTLE_MS = Object.freeze({ steam: 2000, epic: 4000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `{ url, title }` de la page ou `store` a atterri, ou `null` si elle n'a pas
 * charge. Ne jette jamais.
 */
export async function landOnPage(store, { chrome, now, loadWaitMs = LOAD_WAIT_MS, settle = sleep } = {}) {
  const target = PAGE_URLS[store];
  if (!target) return null;
  let tabId = null;
  let windowId = null;
  try {
    const opened = await openHiddenTab(chrome, target);
    tabId = opened.tabId;
    windowId = opened.windowId;
    await markPiloted(chrome, tabId, {
      offer: null, windowId, openedAt: now, expire: now + loadWaitMs + 10000, test: true,
    });
    if (!(await awaitLoad(chrome, tabId, loadWaitMs))) return null;
    await settle(SETTLE_MS[store] || 2000);
    const tab = await chrome.tabs.get(tabId);
    return tab ? { url: tab.url || null, title: tab.title || null } : null;
  } catch {
    return null;
  } finally {
    if (tabId !== null) {
      expectClosure(tabId);
      if (windowId !== null) {
        try { await chrome.windows.remove(windowId); } catch {
          try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ }
        }
      } else {
        try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ }
      }
      await forgetPiloted(chrome, tabId);
    }
  }
}
