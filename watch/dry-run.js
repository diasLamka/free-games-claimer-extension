/* Tester la recuperation, sans rien recuperer (2.64.0).
 *
 * La panne la plus frequente de ce projet est un magasin qui change sa page :
 * un libelle, un bouton, une modale. Le canari (watch/canary.js) la voit, mais
 * APRES deux echecs de vraies reclamations -- c'est-a-dire quand un jeu a deja
 * failli etre rate. Ici, l'utilisateur demande avant : pour chaque magasin que
 * l'extension reclame, elle ouvre la page d'un jeu offert en ce moment, dans
 * la meme fenetre reduite qu'une reclamation, et regarde si elle y trouve le
 * bouton qu'elle cliquerait.
 *
 * RIEN N'EST CLIQUE. Le moteur recoit `fgc-inspecte` au lieu de `fgc-reclame`
 * et ne fait que lire (src/core/31-bootstrap.js, inspectPage). Steam rejoue
 * son etape en `dryRun`, la meme qui sert de seconde lecture apres un clic.
 *
 * Le canari ne voulait pas de sonde automatique : elle couterait une requete
 * sur un vrai compte pour apprendre ce que le prochain echec dira de toute
 * facon. Il a raison pour une sonde qui part seule. Celle-ci ne part que sur
 * un geste, comme la sonde de session et l'importation de collection.
 *
 * Module sans etat : ce qu'il touche de la plateforme lui est passe.
 */
import { STATES, STORES, isExpired, storeFromUrl } from './offer.js';
import { claimableStoresFor } from './sources/index.js';
import {
  LOAD_WAIT_MS, READY_WAIT_MS, awaitLoad, awaitVerdict, expectClosure,
  forgetPiloted, markPiloted, openHiddenTab, tabUrl,
} from './claim.js';
import {
  describeStep, isSteamAgeCheckUrl, isSteamLoginUrl, steamAppUrl, steamPageStep,
} from './steam-claim.js';

/** Le dernier essai, lu par le popup. Espace de la veille. */
export const KEY_DRY_RUN = 'veille:essai-a-blanc';

/** Ce que la page a montre. Les cinq premiers viennent du moteur. */
export const DRY = Object.freeze({
  /** Le bouton qu'on aurait clique est la, et il est autorise. */
  READY: 'ready',
  /** Le jeu est deja au compte, et la page le dit comme prevu. */
  OWNED: 'owned',
  LOGIN: 'needs_login',
  CHALLENGE: 'challenge',
  /** Aucun bouton reconnu : c'est ici qu'un magasin qui a bouge se voit. */
  NO_BUTTON: 'no_button',
  /** Un bouton est la, mais les garde-fous du clic l'auraient refuse. */
  REFUSED: 'refused',
  /** La page ouverte n'est pas une page de reclamation connue. */
  WRONG_PAGE: 'wrong_page',
  /** Aucun jeu offert en ce moment dans ce magasin : rien a ouvrir. */
  NOTHING: 'nothing',
  /** L'essai lui-meme n'a pas abouti (page trop lente, moteur muet). */
  ERROR: 'error',
  /** En cours, pour l'affichage pendant l'essai. */
  RUNNING: 'running',
});

const ENGINE_VERDICTS = new Set([
  DRY.READY, DRY.OWNED, DRY.LOGIN, DRY.CHALLENGE, DRY.NO_BUTTON, DRY.REFUSED, DRY.WRONG_PAGE,
]);

/** Le moteur attend 15 s qu'un bouton apparaisse ; on lui en laisse le double. */
export const INSPECT_WAIT_MS = 30 * 1000;

/** Une page reconnue : l'extension saurait y faire son travail. */
export function recognised(status) {
  return status === DRY.READY || status === DRY.OWNED;
}

/**
 * Les magasins a tester : ceux que l'extension reclame POUR CES reglages, et
 * que l'utilisateur suit. Steam n'y est que si sa recuperation est activee --
 * tester un parcours qui ne tourne jamais ne dirait rien d'utile.
 */
export function storesToTest(settings) {
  const watched = settings && Array.isArray(settings.watchedStores) ? settings.watchedStores : null;
  return claimableStoresFor(settings).filter((s) => !watched || watched.includes(s));
}

/**
 * Le jeu dont on ouvrira la page, pour ce magasin : offert en ce moment, avec
 * une page connue. Un jeu pas encore pris d'abord -- c'est sur lui que le
 * bouton de reclamation doit etre la ; a defaut, un jeu deja pris, dont la
 * page doit dire « dans la bibliotheque ». Le plus proche de sa fin d'abord.
 */
export function pickTestOffer(catalog, store, now) {
  const candidats = Object.entries(catalog || {})
    .map(([catalogKey, o]) => (o ? { ...o, catalogKey } : null))
    .filter((o) => o && o.store === store && o.title && o.state !== STATES.EXPIRED)
    .filter((o) => !isExpired(o, now) && !(typeof o.start === 'number' && o.start > now))
    .filter((o) => (store === STORES.STEAM
      ? /^\d+$/.test(String(o.storeId || '')) && /^\d+$/.test(String(o.packageId || ''))
      : Boolean(o.url || o.resolveUrl)));
  const fin = (o) => (typeof o.end === 'number' ? o.end : Infinity);
  candidats.sort((a, b) => (Number(a.state === STATES.RESOLVED) - Number(b.state === STATES.RESOLVED)) || fin(a) - fin(b));
  return candidats[0] || null;
}

/** La reponse de l'etape Steam, dans le vocabulaire commun. */
export function fromSteamStep(step) {
  if (!step) return { status: DRY.ERROR, details: 'aucune reponse de la page' };
  if (step.ok) return { status: DRY.READY, label: 'Add to Account', details: step.via === 'formulaire' ? 'formulaire de licence gratuite' : null };
  if (step.reason === 'deja-possede') return { status: DRY.OWNED };
  if (step.reason === 'non-connecte') return { status: DRY.LOGIN };
  if (step.reason === 'libelle-payant' || step.reason === 'formulaire-non-gratuit' || step.reason === 'action-inconnue') {
    return { status: DRY.REFUSED, details: describeStep(step) };
  }
  return { status: DRY.NO_BUTTON, visible: Array.isArray(step.labels) ? step.labels : [], details: describeStep(step) };
}

/** La reponse du moteur, bornee : elle vient d'une page, elle en garde la forme. */
export function fromEngine(message) {
  if (!message || !ENGINE_VERDICTS.has(message.verdict)) {
    return { status: DRY.ERROR, details: 'le moteur n\'a pas repondu' };
  }
  const court = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const r = { status: message.verdict };
  if (message.label) r.label = court(message.label, 80);
  if (Array.isArray(message.visible)) r.visible = message.visible.slice(0, 8).map((s) => court(s, 45)).filter(Boolean);
  return r;
}

async function closeTest(chrome, tabId, windowId) {
  if (tabId === null) return;
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

/**
 * Ouvre la page de `offer` dans une fenetre reduite, la fait lire, la ferme.
 * Ne jette jamais : un essai qui echoue est un resultat, `error`.
 */
export async function inspectOffer(offer, {
  chrome, now, loadWaitMs = LOAD_WAIT_MS, readyWaitMs = READY_WAIT_MS, inspectWaitMs = INSPECT_WAIT_MS,
} = {}) {
  const steam = offer.store === STORES.STEAM;
  const target = steam ? steamAppUrl(offer.storeId) : (offer.url || offer.resolveUrl);
  let tabId = null;
  let windowId = null;
  try {
    const opened = await openHiddenTab(chrome, target);
    tabId = opened.tabId;
    windowId = opened.windowId;
    await markPiloted(chrome, tabId, {
      offer: offer.catalogKey || null, windowId, openedAt: now, expire: now + loadWaitMs + readyWaitMs + inspectWaitMs, test: true,
    });
    if (!(await awaitLoad(chrome, tabId, loadWaitMs))) return { status: DRY.ERROR, details: 'la page n\'a pas fini de charger' };
    const landed = await tabUrl(chrome, tabId);

    if (steam) {
      if (isSteamLoginUrl(landed)) return { status: DRY.LOGIN };
      if (isSteamAgeCheckUrl(landed)) return { status: DRY.ERROR, details: 'controle d\'age Steam : a passer une fois a la main' };
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId }, func: steamPageStep, args: [String(offer.packageId), true],
      });
      return fromSteamStep(injection ? injection.result : null);
    }

    /* Une offre de l'agregateur n'a qu'une redirection : l'onglet la suit, et
       c'est la page d'arrivee qui dit si l'on est au bon endroit. */
    if (!offer.url && storeFromUrl(landed) !== offer.store) {
      return { status: DRY.WRONG_PAGE, details: landed ? String(landed).split('?')[0].slice(0, 120) : null };
    }

    const ready = await awaitVerdict(tabId, 'fgc-pret', readyWaitMs);
    if (!ready) return { status: DRY.ERROR, details: 'le moteur ne s\'est pas annonce' };
    const reponse = awaitVerdict(tabId, 'fgc-inspection', inspectWaitMs);
    await chrome.tabs.sendMessage(tabId, { type: 'fgc-inspecte' });
    return fromEngine(await reponse);
  } catch (e) {
    return { status: DRY.ERROR, details: String((e && e.message) || e).slice(0, 160) };
  } finally {
    await closeTest(chrome, tabId, windowId);
  }
}

/**
 * Teste chaque magasin, l'un apres l'autre, et ecrit l'avancement a chaque
 * pas : le popup affiche « en cours » sur le magasin qu'on lit.
 *
 * `write(etat)` persiste l'etat ; `inspect` est injectable pour les tests.
 */
export async function dryRunStores(stores, {
  chrome, catalog, now, write, record = () => {}, inspect = inspectOffer,
}) {
  const etat = { at: now, running: true, results: {} };
  for (const store of stores) etat.results[store] = { status: DRY.RUNNING };
  await write(etat);

  for (const store of stores) {
    const offer = pickTestOffer(catalog, store, now);
    let r;
    if (!offer) {
      r = { status: DRY.NOTHING };
    } else {
      r = await inspect(offer, { chrome, now });
      r = { ...r, title: offer.title, url: offer.url || null };
    }
    etat.results[store] = { ...r, at: Date.now() };
    record(recognised(r.status) ? 'info' : 'warn',
      `essai a blanc ${store} : ${r.status}${r.label ? ` (« ${r.label} »)` : ''}${r.details ? ` -- ${r.details}` : ''}`);
    await write(etat);
  }
  etat.running = false;
  await write(etat);
  return etat;
}
