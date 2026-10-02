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
 *
 * Depuis la 2.106.0, la question n'est posee qu'une fois par offre : apres elle,
 * l'offre peut avoir deja ete retentee (verdict « failed ») pendant que l'onglet
 * attendait. On repart donc de celles qui ont ete DEMANDEES (`asks`), pas seulement
 * de celles dont le dernier verdict est la demande -- et la question leur est rendue.
 * Les offres closes (resolues) ne repartent jamais.
 */
export function resetForTeaching(catalog, store, now) {
  const out = { ...(catalog || {}) };
  let count = 0;
  for (const [key, offer] of Object.entries(out)) {
    if (!offer || offer.store !== store || offer.state === 'resolved') continue;
    if (offer.verdict === TEACH_VERDICT || (offer.asks || 0) > 0) {
      out[key] = { ...offer, nextAttemptAt: null, attempts: 0, asks: 0, updatedAt: now };
      count++;
    }
  }
  return { catalog: out, count };
}

/** Les reponses que le bandeau propose, en plus de montrer le bouton. */
export const ANSWERS = Object.freeze({ OWNED: 'owned', GONE: 'gone' });

/**
 * Regle une offre d'apres la reponse de l'utilisateur sur le bandeau (2.106.0) :
 * « c'est deja a moi » (verdict `owned`, le jeu entre dans la memoire « deja a
 * vous ») ou « ce n'est plus offert » (verdict `gone`, offre close). Dans les deux
 * cas l'offre est RESOLVED : on ne la redemande plus. Rend { catalog, offer } --
 * `offer` est null si la cle est inconnue ou la reponse invalide. Pure.
 */
export function settleByAnswer(catalog, catalogKey, answer, now) {
  const offer = catalog && catalogKey ? catalog[catalogKey] : null;
  if (!offer || (answer !== ANSWERS.OWNED && answer !== ANSWERS.GONE)) return { catalog: catalog || {}, offer: null };
  const owned = answer === ANSWERS.OWNED;
  const next = {
    ...offer,
    verdict: owned ? 'owned' : 'gone',
    state: 'resolved',
    ...(owned ? { alreadyOwned: true, ownedVia: 'answer' } : {}),
    nextAttemptAt: null,
    attemptStartedAt: null,
    details: owned ? 'vous avez dit : deja a vous' : 'vous avez dit : plus offert',
    updatedAt: now,
  };
  return { catalog: { ...catalog, [catalogKey]: next }, offer: next };
}

/**
 * Le bandeau, injecte dans la page. Fonction AUTONOME : elle est serialisee par
 * `executeScript`, elle ne voit rien de ce module. Un seul element, fixe en haut,
 * qui se ferme au clic, et que la page ne peut ni lire ni restyler (racine fantome
 * fermee).
 */
export function teachBannerInPage(text, ownedLabel, goneLabel) {
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
    /* Deux reponses de plus (2.106.0) : le jeu est deja a vous, ou l'offre est finie.
       Un clic de l'utilisateur, JAMAIS un clic fabrique par la page, regle l'offre : le
       worker ne la redemande plus. */
    const answer = (label, kind) => {
      if (!label) return;
      const b = document.createElement('button');
      b.textContent = String(label).slice(0, 40);
      b.style.cssText = 'display:inline-block;margin:8px 8px 0 0;font:700 14px/1 system-ui,sans-serif;background:#000;color:#e8ff00;border:2px solid #000;padding:8px 12px;cursor:pointer;';
      b.addEventListener('click', (ev) => {
        if (!ev || ev.isTrusted !== true) return;
        try { chrome.runtime.sendMessage({ type: 'fgc-reponse', answer: kind }); } catch (e) { /* le worker n'est plus la */ }
        host.remove();
      });
      bar.appendChild(b);
    };
    answer(ownedLabel, 'owned');
    answer(goneLabel, 'gone');
    root.appendChild(bar);
    (document.documentElement || document.body).appendChild(host);
    return true;
  } catch (e) {
    return false;
  }
}

/** Pose le bandeau sur l'onglet. Ne jette jamais : un bandeau rate ne doit rien casser. */
export async function showTeachBanner(chrome, tabId, text, answers = null) {
  try {
    if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') return false;
    const args = [String(text || '')];
    if (answers && (answers.owned || answers.gone)) args.push(String(answers.owned || ''), String(answers.gone || ''));
    await chrome.scripting.executeScript({ target: { tabId }, func: teachBannerInPage, args });
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
