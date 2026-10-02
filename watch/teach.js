/* Le claimer qui se repare seul : la partie du worker (2.102.0).
 *
 * Le moteur (src/core/17-nav-demo.js) lit la page, ne reconnait aucun bouton, et
 * le dit : verdict `needs_teaching`. L'onglet reste ouvert, remonte dans la
 * fenetre de l'utilisateur, et un bandeau lui demande UN clic. Quand le moteur a
 * appris ce clic (la page dit ensuite « a vous »), il previent le worker
 * (`fgc-appris`) ; le worker referme l'onglet et remet les offres du magasin en
 * file.
 *
 * Ce module ne decide rien d'autre : il ne clique jamais, ne lit jamais la page,
 * et le bandeau ne porte qu'un texte que le worker lui donne.
 */
import { STORES } from './offer.js';
import { KEY_TABS } from './claim.js';

export const TEACH_VERDICT = 'needs_teaching';

/** Le magasin d'un nom de plateforme du moteur, ou null. */
export function storeOfPlatform(platform) {
  switch (String(platform || '')) {
    case 'GOG': return STORES.GOG;
    case 'Epic Games': return STORES.EPIC;
    case 'Amazon Luna': return STORES.AMAZON;
    default: return null;
  }
}

/**
 * Les offres d'un magasin qui attendaient qu'on leur montre le bouton repartent
 * a zero : plus de recul, plus d'essais comptes. Rend { catalog, count }.
 */
export function resetForTeaching(catalog, store, now) {
  const out = { ...(catalog || {}) };
  let count = 0;
  for (const [key, offer] of Object.entries(out)) {
    if (offer && offer.store === store && offer.verdict === TEACH_VERDICT) {
      out[key] = { ...offer, nextAttemptAt: null, attempts: 0, updatedAt: now };
      count++;
    }
  }
  return { catalog: out, count };
}

/**
 * Le bandeau, injecte dans la page. Fonction AUTONOME : elle est serialisee par
 * `executeScript`, elle ne voit rien de ce module. Un seul element, fixe en haut,
 * qui se ferme au clic, et que la page ne peut ni lire ni restyler (racine fantome
 * fermee).
 */
export function teachBannerInPage(text) {
  try {
    if (document.getElementById('fgc-apprendre')) return true;
    const host = document.createElement('div');
    host.id = 'fgc-apprendre';
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'font:600 15px/1.35 system-ui,sans-serif;background:#e8ff00;color:#000;border-bottom:4px solid #000;padding:12px 44px 12px 16px;position:relative;';
    bar.textContent = String(text || '').slice(0, 240);
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'x');
    close.style.cssText = 'position:absolute;right:8px;top:6px;font:700 20px/1 system-ui;background:none;border:0;cursor:pointer;color:#000;';
    close.addEventListener('click', () => host.remove());
    bar.appendChild(close);
    root.appendChild(bar);
    (document.documentElement || document.body).appendChild(host);
    return true;
  } catch (e) {
    return false;
  }
}

/** Pose le bandeau sur l'onglet. Ne jette jamais : un bandeau rate ne doit rien casser. */
export async function showTeachBanner(chrome, tabId, text) {
  try {
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') return false;
    await chrome.scripting.executeScript({ target: { tabId }, func: teachBannerInPage, args: [String(text || '')] });
    return true;
  } catch {
    return false;
  }
}

/** Cet onglet est-il un onglet que la veille a laisse ouvert pour un humain ? */
export async function isManualPilotTab(chrome, tabId) {
  try {
    const zone = chrome.storage.session || chrome.storage.local;
    const { [KEY_TABS]: list } = await zone.get(KEY_TABS);
    const info = list && list[tabId];
    return Boolean(info && info.manual);
  } catch {
    return false;
  }
}
