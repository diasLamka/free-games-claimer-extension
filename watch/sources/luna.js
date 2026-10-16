/* Source de decouverte : la liste des offres d'Amazon Luna (2.114.0).
 *
 * Luna n'a ni API publique ni liste lisible hors du compte. Aucune source ne lui donnait donc de
 * jeu a prendre, la veille ne rouvrait jamais sa page, et rien n'etait recupere en fond -- la ou
 * Epic et GOG, qui ont une API, l'etaient. Cette source fait ce qu'Epic fait avec son API : elle
 * dit QUOI est offert, et la reclamation (watch/claim.js) prend chaque fiche comme n'importe
 * quelle autre offre.
 *
 * Elle ouvre la liste dans une fenetre REDUITE (rien a l'ecran, comme toute reclamation de la
 * veille) et demande au moteur de la LIRE. Un ordre de lecture, jamais de reclamation : le moteur
 * ne clique rien et ne change pas de page pour y repondre (src/core/31-bootstrap.js,
 * `readLunaList`). Connexion perdue, defi de securite, page inattendue : une erreur dite, pas
 * une liste vide.
 *
 * Tout ce que dit la page est borne ici, a l'arrivee : le moteur tourne dans une page qu'Amazon
 * controle.
 */
import { makeOffer, STORES } from '../offer.js';
import {
  LOAD_WAIT_MS, READY_WAIT_MS, awaitLoad, awaitVerdict, closeHiddenWindow, expectClosure,
  forgetPiloted, markPiloted, openHiddenTab,
} from '../claim.js';

export const NAME = 'luna';

/** La liste des jeux ; l'hote est ramene a celui du compte par openHiddenTab (localizeFor). */
export const CLAIMS_URL = 'https://luna.amazon.com/claims/home?filter=Game&g=s';

/** Le moteur attend jusqu'a CONFIG.lunaOffersWaitTimeout (la liste est une page dynamique). */
export const LIST_WAIT_MS = 60 * 1000;

const MAX_CARDS = 60;
const MAX_TITLE = 120;
const MAX_ID = 200;
const LUNA_PAGE = /^https:\/\/luna\.amazon\.[a-z.]+\//i;

const court = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

/** Un condense stable de la liste des cartes a bouton direct : une autre liste, une autre cle. */
function fingerprint(ids) {
  let h = 5381;
  for (const ch of [...ids].sort().join('|')) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

/**
 * Les cartes lues par le moteur deviennent des offres, ou sont ecartees avec un motif.
 *
 *   - une fiche a prendre : une offre, avec la page de la fiche ;
 *   - une carte deja prise : une offre decrite comme possedee, pour que la veille ne la rouvre pas
 *     et qu'elle ne soit pas prise pour une offre disparue ;
 *
 * Une fiche porte son identifiant Luna comme `storeId` : c'est la preuve que le magasin l'a publiee sous
 * cette identite, donc son absence de la liste complete la termine au passage suivant (catalog.js).
 * Les cartes a bouton direct n'en ont pas, et gardent la grace longue.
 *   - les cartes a BOUTON direct, qui n'ont pas de fiche : une seule offre, sur la liste -- le
 *     moteur les prend toutes d'un passage, et une offre par carte rouvrirait la liste pour rien.
 */
export function mapLunaList(cards, now) {
  const offers = [];
  const dropped = [];
  const direct = [];
  for (const raw of (Array.isArray(cards) ? cards : []).slice(0, MAX_CARDS)) {
    if (!raw || typeof raw !== 'object') {
      dropped.push({ reasonText: 'carte non exploitable' });
      continue;
    }
    const title = court(raw.title, MAX_TITLE);
    const id = court(raw.id, MAX_ID);
    if (!title || !id) {
      dropped.push({ reasonText: 'titre ou identifiant absent', id: id || null });
      continue;
    }
    const url = typeof raw.url === 'string' && LUNA_PAGE.test(raw.url) ? raw.url.split(/[?#]/)[0] : null;
    if (raw.collected === true) {
      offers.push(make(id, title, url, now, { alreadyOwned: true, storeId: id }));
      continue;
    }
    if (raw.hasButton === true) {
      direct.push({ id, title });
      continue;
    }
    if (!url) {
      dropped.push({ reasonText: 'fiche hors de Luna ou sans adresse', title, id });
      continue;
    }
    offers.push(make(id, title, url, now, { storeId: id }));
  }
  if (direct.length) {
    const more = direct.length > 1 ? ` (+${direct.length - 1})` : '';
    offers.push(make(`direct-${fingerprint(direct.map((d) => d.id))}`, court(direct[0].title + more, MAX_TITLE), CLAIMS_URL, now));
  }
  return { offers, dropped };
}

function make(sourceId, title, url, now, extra = {}) {
  return makeOffer({
    source: NAME,
    sourceId,
    store: STORES.AMAZON,
    title,
    url,
    category: 'game',
    keepable: true,
    seenAt: now,
    ...extra,
  });
}

/** Ce que dit le verdict du moteur quand la liste n'a pas ete lue. */
const FAILURES = Object.freeze({
  needs_login: 'Amazon Luna : session perdue (connexion a refaire)',
  challenge: 'Amazon Luna : verification de securite demandee, que l\'extension ne resout jamais',
  wrong_page: 'Amazon Luna : la page ouverte n\'est pas la liste des offres',
});

export async function discover({
  chrome, now = Date.now(), loadWaitMs = LOAD_WAIT_MS, readyWaitMs = READY_WAIT_MS, listWaitMs = LIST_WAIT_MS,
} = {}) {
  const fail = (message) => ({ offers: [], dropped: [], nextWindows: [], errors: [message], usedUrl: null, complete: false });
  if (!chrome || !chrome.tabs) return fail('Amazon Luna : pas de navigateur pour lire la liste');

  let tabId = null;
  let windowId = null;
  try {
    const opened = await openHiddenTab(chrome, CLAIMS_URL);
    tabId = opened.tabId;
    windowId = opened.windowId;
    await markPiloted(chrome, tabId, {
      offer: null, windowId, openedAt: now, expire: now + loadWaitMs + readyWaitMs + listWaitMs, list: true,
    });
    if (!(await awaitLoad(chrome, tabId, loadWaitMs))) return fail('Amazon Luna : la page n\'a pas fini de charger');
    if (!(await awaitVerdict(tabId, 'fgc-pret', readyWaitMs))) return fail('Amazon Luna : le moteur ne s\'est pas annonce');

    const reponse = awaitVerdict(tabId, 'fgc-liste', listWaitMs);
    await chrome.tabs.sendMessage(tabId, { type: 'fgc-liste-luna' });
    const liste = await reponse;
    if (!liste) return fail('Amazon Luna : le moteur n\'a pas rendu la liste');
    if (FAILURES[liste.verdict]) return fail(FAILURES[liste.verdict]);
    if (liste.verdict === 'empty') {
      // Une page lue sans carte : peut-etre un compte sans offre, peut-etre une page qui a change.
      // Ni erreur ni liste complete -- on ne conclut aucune disparition de ce qu'on n'a pas su lire.
      return { offers: [], dropped: [], nextWindows: [], errors: [], usedUrl: null, complete: false };
    }
    if (liste.verdict !== 'ok') return fail('Amazon Luna : reponse du moteur non reconnue');

    const { offers, dropped } = mapLunaList(liste.offers, now);
    return { offers, dropped, nextWindows: [], errors: [], usedUrl: CLAIMS_URL, complete: true };
  } catch (e) {
    return fail(`Amazon Luna : ${String((e && e.message) || e).slice(0, 160)}`);
  } finally {
    if (tabId !== null) {
      expectClosure(tabId);
      if (windowId !== null) await closeHiddenWindow(chrome, windowId, tabId);
      else { try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ } }
      await forgetPiloted(chrome, tabId);
    }
  }
}
