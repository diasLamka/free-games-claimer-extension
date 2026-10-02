/* L'orchestrateur : ouvrir un onglet de fond, faire reclamer, encaisser le
 * verdict, refermer.
 *
 * Il tourne dans le service worker. Le travail lui-meme reste dans le content
 * script, qui sait deja cliquer sur les bonnes choses : l'orchestrateur ne fait
 * que decider, ouvrir, attendre et nettoyer.
 *
 * Mesure du 2026-08-27 : une reclamation complete prend 23 secondes dans un
 * onglet cache, contre 19 sans bridage. Le budget de cinq minutes est donc une
 * marge, pas une contrainte serree. Il sert a borner un enchainement bloque, a
 * limiter l'exposition du compte, et a couvrir le gel d'onglet sous pression
 * memoire.
 *
 * Le chronometre est ici, pas dans la page : une page throttlee ne peut pas se
 * surveiller elle-meme de facon fiable, c'est justement son timer qui deraille.
 */
import { STORES, storeFromUrl } from './offer.js';
import { readSettings } from './storage.js';
import { localizeFor } from './localizer.js';
import { readOwnership } from './sources/steam.js';
import {
  steamAppUrl, steamPageStep, describeStep, ownedFromStep,
  isSteamLoginUrl, isSteamAgeCheckUrl, missingBaseGame, baseGameLabel, steamErrorText,
} from './steam-claim.js';

export const BUDGET_MS = 5 * 60 * 1000;
export const LOAD_WAIT_MS = 45 * 1000;
export const READY_WAIT_MS = 30 * 1000;

/** Cle de session listant les onglets ouverts par la veille. */
export const KEY_TABS = 'veille:onglets-pilotes';

/**
 * Verdicts. Les neuf premiers sont ceux que le moteur ecrit deja dans son
 * historique ; les trois derniers appartiennent a l'orchestrateur.
 */
export const VERDICTS = Object.freeze({
  CLAIMED: 'claimed',
  REDEEMED: 'redeemed',
  ALREADY_REDEEMED: 'already_redeemed',
  CODE_PENDING: 'code_pending_gog',
  CODE_COPIED: 'code_copied',
  LINK_ACCOUNT: 'needs_link',
  SKIPPED: 'skipped',
  BAD_URL: 'bad_url',
  FAILURE: 'failed',
  LOGIN: 'needs_login',
  CHALLENGE: 'challenge',
  /**
   * Le moteur a lu la page, session et defi en regle, et ne reconnait aucun
   * bouton (2.102.0) : le magasin a change sa page. L'onglet reste ouvert, remonte
   * dans la fenetre de l'utilisateur, et UN clic de sa part apprend le bon bouton.
   */
  TEACH: 'needs_teaching',
  OUT_OF_SCOPE: 'out_of_scope',

  /**
   * Le jeu est DEJA A VOUS (2.106.0) : le compte du magasin le dit, ou vous l'avez
   * dit sur le bandeau. Definitif, et rien n'est ouvert ni demande.
   */
  OWNED: 'owned',
  /**
   * La page ne propose plus rien a prendre (2.106.0) : offre terminee, ou jeu deja
   * a vous dont la page ne le dit pas. PAS definitif d'emblee -- une page mal
   * rendue lui ressemble : deux constats espaces de GONE_CONFIRM_MS le rendent tel.
   */
  GONE: 'gone',

  /** L'offre est terminee. Confirme par une date, jamais par un DOM seul. */
  EXPIRED: 'expired',
  /** Elle n'a pas encore ouvert : rien a faire, et surtout pas un onglet. */
  UPCOMING: 'upcoming',
  /** On ne sait pas ce qui s'est passe. Ni un succes, ni un echec. */
  UNDETERMINED: 'undetermined',
  /** Le magasin ou notre propre plafond dit non pour l'instant. */
  QUOTA: 'quota',
  /**
   * Un DLC Steam dont le jeu de base manque a la bibliotheque (2.80.1). Steam
   * refuserait la licence gratuite ; rien n'est envoye. Le jour ou le jeu de
   * base y est, la prochaine verification le voit.
   */
  NEEDS_BASE: 'needs_base_game',
});

/**
 * Verdicts qui attendent un geste HORS de l'extension (acheter le jeu de base)
 * : jamais abandonnes, relus de loin en loin -- toutes les douze heures --,
 * et sans rien envoyer au magasin pour le savoir.
 */
export const WAITING_VERDICTS = Object.freeze([VERDICTS.NEEDS_BASE]);
export const WAITING_RECHECK_MS = 12 * 3600 * 1000;

/**
 * Verdicts apres lesquels il ne sert a rien de reessayer, jamais.
 *
 * `failed` n'y est PAS, et c'etait le bug : une offre en echec repassait en
 * QUEUED et etait retentee a chaque cycle -- cinq minutes d'onglet et un jeton
 * du plafond horaire, indefiniment, pour un selecteur qui ne reviendra pas.
 * C'est `nextAttemptAt` et le plafond d'essais qui la bornent desormais, pas
 * une place dans cette liste : un echec transitoire merite une seconde chance,
 * pas une infinite.
 *
 * `expired` y est, mais n'est emis que si une DATE le confirme. Un bouton
 * absent parce que le magasin a renomme sa classe ressemble exactement a un
 * giveaway termine, et un expired pose a tort enterre une offre valide.
 */
export const FINAL_VERDICTS = Object.freeze([
  VERDICTS.CLAIMED, VERDICTS.REDEEMED, VERDICTS.ALREADY_REDEEMED,
  VERDICTS.SKIPPED, VERDICTS.OUT_OF_SCOPE, VERDICTS.BAD_URL,
  VERDICTS.EXPIRED, VERDICTS.OWNED,
]);

/** Verdicts qui demandent un humain : on laisse l'onglet ouvert. */
export const MANUAL_VERDICTS = Object.freeze([VERDICTS.CHALLENGE, VERDICTS.TEACH]);

/**
 * Verdicts qui attendent une action de l'utilisateur, et qu'un recul
 * automatique ne resoudra pas.
 *
 * Ils ne sont jamais abandonnes en silence : se reconnecter est une chose que
 * l'utilisateur peut faire, et l'extension doit encore etre prete quand il l'a
 * faite.
 */
export const HUMAN_VERDICTS = Object.freeze([
  VERDICTS.LOGIN, VERDICTS.LINK_ACCOUNT, VERDICTS.CHALLENGE,
]);

/**
 * « Montrez-moi le bouton » n'est PAS dans la liste ci-dessus (2.106.0). Il y etait
 * depuis la 2.102.0, avec « jamais abandonne » : une offre que la page ne laissait
 * pas prendre -- un jeu deja a vous, une offre finie -- redemandait le bouton a
 * l'infini, un onglet ouvert dans votre fenetre a chaque fois. La question est
 * posee UNE fois par offre (MAX_ASKS) ; ensuite l'offre suit le recul ordinaire et
 * l'abandon au cinquieme essai, comme tout echec, sans plus rien demander.
 */
export const MAX_ASKS = 1;
/** Apres la demande, on laisse a l'utilisateur le temps de repondre avant de retenter. */
export const ASK_WAIT_MS = 24 * 3600 * 1000;
/** Deux constats « rien a prendre » espaces d'au moins cela valent « c'est fini ». */
export const GONE_CONFIRM_MS = 2 * 3600 * 1000;
/** Le premier constat « rien a prendre » se reverifie apres cela. */
export const GONE_RECHECK_MS = 3 * 3600 * 1000;

/** A-t-on deja pose la question « montrez-moi le bouton » pour cette offre ? */
export function alreadyAsked(offer) {
  if (!offer) return false;
  return (offer.asks || 0) >= MAX_ASKS || offer.verdict === VERDICTS.TEACH;
}

/**
 * Recul entre deux tentatives, par nombre d'essais deja faits.
 *
 * Quinze minutes, une heure, quatre heures, douze heures. Au-dela de
 * MAX_ATTEMPTS l'offre est abandonnee -- visiblement, et l'utilisateur peut
 * relancer a la main.
 */
export const BACKOFF_MS = Object.freeze([15 * 60000, 60 * 60000, 4 * 3600000, 12 * 3600000]);
export const MAX_ATTEMPTS = 5;

/**
 * Quand retenter, ou null si c'est fini.
 *
 * `attempts` est le nombre d'essais DEJA faits. Apres le premier, on attend le
 * premier palier -- d'ou le decalage d'un cran, qu'un test a d'abord releve :
 * indexer directement sur `attempts` sautait les quinze minutes et faisait
 * attendre une heure des le premier echec.
 */
export function nextAttemptAt(attempts, now) {
  if (attempts >= MAX_ATTEMPTS) return null;
  const rang = Math.max(0, Math.min(attempts - 1, BACKOFF_MS.length - 1));
  return now + BACKOFF_MS[rang];
}

/* ------------------------------------------------------- bus de messages */

const waiters = new Map();

const waitKey = (tabId, type) => `${tabId}:${type}`;

/**
 * Attend un message precis venant d'un onglet precis.
 *
 * Rend null a l'expiration plutot que de jeter : un onglet muet est un cas
 * normal -- page qui ne charge pas, content script non injecte -- et
 * l'orchestrateur doit pouvoir le traiter comme un verdict, pas comme un bug.
 */
export function awaitVerdict(tabId, type, timeoutMs) {
  return new Promise((resolve) => {
    const key = waitKey(tabId, type);
    const timer = setTimeout(() => {
      waiters.delete(key);
      resolve(null);
    }, timeoutMs);
    waiters.set(key, { resolve, timer });
  });
}

/* --------------------------------------------------------- onglet disparu */

/** Onglets que NOUS fermons. Leur disparition n'est pas un incident. */
const fermeturesVoulues = new Set();

/** A appeler juste avant chrome.tabs.remove sur un onglet pilote. */
export function expectClosure(tabId) {
  fermeturesVoulues.add(Number(tabId));
}

/**
 * L'onglet a disparu sans nous prevenir : on n'attend plus.
 *
 * Sans ceci, fermer l'onglet de fond -- ou un plantage, ou un dechargement par
 * Chrome -- laissait l'attente courir jusqu'au bout de son budget : cinq
 * minutes. Or claimWhatCanBe reclame EN SERIE, et le catalogue n'est ecrit
 * qu'apres la boucle : un seul onglet ferme immobilisait le cycle assez
 * longtemps pour que le worker soit tue avant l'ecriture.
 *
 * Toutes les attentes de cet onglet sont resolues, pas seulement le verdict :
 * un onglet ferme pendant les quarante-cinq secondes de chargement laissait
 * awaitLoad tourner jusqu'a son terme.
 */
export function tabVanished(tabId) {
  const id = Number(tabId);

  // Fermeture que nous avons demandee : rien a signaler.
  if (fermeturesVoulues.delete(id)) return 0;

  let resolus = 0;
  for (const [key, waiter] of [...waiters.entries()]) {
    if (!key.startsWith(`${id}:`)) continue;
    clearTimeout(waiter.timer);
    waiters.delete(key);
    waiter.resolve(null);
    resolus++;
  }
  return resolus;
}

/** Appele par le service worker a la reception d'un message du content script. */
export function reportVerdict(tabId, type, message) {
  const key = waitKey(tabId, type);
  const waiting = waiters.get(key);
  if (!waiting) return false;
  clearTimeout(waiting.timer);
  waiters.delete(key);
  waiting.resolve(message);
  return true;
}

/* -------------------------------------------------------- onglets pilotes */

function sessionZone(chrome) {
  return chrome.storage.session || chrome.storage.local;
}

export async function markPiloted(chrome, tabId, info) {
  const zone = sessionZone(chrome);
  const { [KEY_TABS]: currentList } = await zone.get(KEY_TABS);
  await zone.set({ [KEY_TABS]: { ...(currentList || {}), [tabId]: info } });
}

export async function forgetPiloted(chrome, tabId) {
  const zone = sessionZone(chrome);
  const { [KEY_TABS]: currentList } = await zone.get(KEY_TABS);
  if (!currentList || !(tabId in currentList)) return;
  const following = { ...currentList };
  delete following[tabId];
  await zone.set({ [KEY_TABS]: following });
}

export async function isPiloted(chrome, tabId) {
  const zone = sessionZone(chrome);
  const { [KEY_TABS]: currentList } = await zone.get(KEY_TABS);
  return Boolean(currentList && currentList[tabId]);
}

/**
 * Referme les onglets de veille abandonnes.
 *
 * Le service worker meurt entre deux reveils : sans ce balayage, un crash en
 * pleine reclamation laisserait un onglet ouvert pour toujours, et ils
 * s'accumuleraient.
 */
export async function sweepTabs(chrome, now) {
  const zone = sessionZone(chrome);
  const { [KEY_TABS]: currentList } = await zone.get(KEY_TABS);
  if (!currentList) return { closed: 0 };

  const remainingCount = {};
  let closed = 0;

  for (const [id, info] of Object.entries(currentList)) {
    // Un onglet laisse expres a l'utilisateur (defi de securite) n'est pas un
    // orphelin : on le laisse, et on cesse simplement de le suivre.
    if (info && info.manual) continue;
    if (info && info.expire > now) { remainingCount[id] = info; continue; }

    // La FENETRE d'abord, quand on la connait : un crash en pleine reclamation
    // laisse une fenetre reduite entiere, pas seulement un onglet -- et une
    // page a pu y ouvrir d'autres onglets, que fermer l'onglet seul epargne.
    let swept = false;
    if (info && info.windowId !== null && info.windowId !== undefined) {
      try { await chrome.windows.remove(info.windowId); swept = true; } catch { /* deja fermee */ }
    }
    if (!swept) {
      try { await chrome.tabs.remove(Number(id)); swept = true; } catch { /* deja ferme */ }
    }
    if (swept) closed++;
  }

  await zone.set({ [KEY_TABS]: remainingCount });
  return { closed };
}

/* -------------------------------------------------------------- utilitaires */

export function awaitLoad(chrome, tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finished = (worth) => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdate); } catch { /* ignore */ }
      clearTimeout(timer);
      // Se retirer du registre : sinon tabVanished resoudrait une attente deja
      // finie, et le prochain onglet portant le meme identifiant heriterait
      // d'une entree fantome.
      waiters.delete(waitKey(tabId, 'chargement'));
      resolve(worth);
    };
    const onUpdate = (id, info) => { if (id === tabId && info.status === 'complete') finished(true); };
    const timer = setTimeout(() => finished(false), timeoutMs);

    /* Inscrite dans le meme registre que les autres attentes, pour qu'un onglet
       ferme pendant les quarante-cinq secondes de chargement l'interrompe. La
       resolution passe par `finished`, qui retire aussi l'ecouteur. */
    waiters.set(waitKey(tabId, 'chargement'), { resolve: () => finished(false), timer });

    chrome.tabs.onUpdated.addListener(onUpdate);
    // L'onglet peut avoir fini de charger avant que l'ecouteur soit pose.
    chrome.tabs.get(tabId).then((t) => { if (t && t.status === 'complete') finished(true); }).catch(() => {});
  });
}

export async function tabUrl(chrome, tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    return (t && t.url) || null;
  } catch {
    return null;
  }
}

/**
 * Ou l'onglet a atterri, en une ligne lisible.
 *
 * Le titre autant que l'URL : quand Steam refuse une licence gratuite, il
 * repond une page dont le TITRE porte le motif. Sans lui, l'echec disait
 * seulement « le paquet n'est pas apparu », ce qui n'aide personne.
 */
async function tabWhere(chrome, tabId) {
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t) return null;
    const title = String(t.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const url = String(t.url || '').split('?')[0];
    return [title, url].filter(Boolean).join(' - ') || null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- onglet invisible */

/**
 * Ouvre la page de reclamation sans rien montrer a l'utilisateur.
 *
 * Un onglet cree avec `active: false` ne vole pas le focus, mais il APPARAIT
 * dans la barre d'onglets -- et le voir surgir puis disparaitre toutes les
 * quelques heures ressemble a un navigateur hante. Chrome n'a pas d'onglet
 * cache ; ce qu'il a, c'est la fenetre REDUITE : un `windows.create` avec
 * `state: 'minimized'` vit dans la barre des taches, pas dans la fenetre de
 * l'utilisateur, et ne touche ni a son focus ni a sa barre d'onglets.
 *
 * Deux consequences assumees :
 *
 *   - une page reduite est consideree cachee par Chrome : ses minuteries
 *     peuvent etre alignees a la seconde. Le moteur sonde a 500 ms et son
 *     budget est de cinq minutes ; mesure sur les onglets d'arriere-plan, le
 *     ralentissement etait de +24 % -- sans incidence a cette echelle.
 *   - la mise en page reste calculee (ce n'est pas du display:none), donc les
 *     controles de visibilite du moteur (offsetWidth, getClientRects)
 *     continuent de dire la verite.
 *
 * Le repli sur l'onglet inactif couvre le harnais de test (pas de
 * chrome.windows) et les plateformes ou la creation de fenetre echoue.
 */
export async function openHiddenTab(chrome, url) {
  /* La page s'ouvre dans la langue et le pays du reglage (GOG en /fr/, Epic en
     ?lang=fr, Luna sur son domaine) : c'est cette page-la que le moteur lit.
     Une langue que le moteur ne lit pas est ramenee a l'anglais (forClaim). */
  url = await localizeFor(chrome, url, { forClaim: true });
  if (chrome.windows && typeof chrome.windows.create === 'function') {
    try {
      const win = await chrome.windows.create({ url, type: 'normal', state: 'minimized' });
      const tab = win && win.tabs && win.tabs[0];
      if (tab && tab.id !== undefined) {
        return { tabId: tab.id, windowId: win.id, hidden: true };
      }
      // Fenetre creee mais onglet illisible : on la referme plutot que de la
      // laisser vivre sans suivi -- une fenetre orpheline ne serait jamais
      // balayee, KEY_TABS ne connait que des identifiants d'onglet.
      if (win && win.id !== undefined) {
        try { await chrome.windows.remove(win.id); } catch { /* deja fermee */ }
      }
    } catch { /* repli ci-dessous */ }
  }

  const tab = await chrome.tabs.create({ url, active: false });
  return { tabId: tab.id, windowId: null, hidden: false };
}

/**
 * Ramene un onglet laisse a l'utilisateur dans SA fenetre.
 *
 * Le cas est precis : un defi de securite attend un humain, et l'onglet vit
 * dans une fenetre reduite que personne ne trouvera. L'invisibilite est la
 * bonne politique tant que tout va bien ; a l'instant ou l'extension a besoin
 * de l'utilisateur, elle s'inverse.
 */
export async function surfaceTab(chrome, tabId) {
  let own;
  try { const t = await chrome.tabs.get(tabId); own = t ? t.windowId : undefined; } catch { own = undefined; }

  /* La derniere fenetre utilisee -- mais PAS celle de l'onglet lui-meme ni une
     fenetre reduite. Un navigateur qui vient d'ouvrir la fenetre reduite de la
     reclamation peut la rendre « derniere utilisee » : deplacer l'onglet dans sa
     propre fenetre, puis refermer cette fenetre, emportait l'onglet qu'on voulait
     montrer (constate en 2.102.0, avec un onglet « montrez-moi le bouton »). */
  try {
    const last = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (last && last.id !== undefined && last.id !== own && last.state !== 'minimized') {
      await chrome.tabs.move(tabId, { windowId: last.id, index: -1 });
      return true;
    }
  } catch { /* on cherche une autre fenetre */ }

  try {
    if (typeof chrome.windows.getAll === 'function') {
      const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const other = (all || []).find((w) => w && w.id !== undefined && w.id !== own && w.state !== 'minimized');
      if (other) {
        await chrome.tabs.move(tabId, { windowId: other.id, index: -1 });
        return true;
      }
    }
  } catch { /* la fenetre reduite reste, la notification menera a l'offre */ }

  /* Aucune fenetre de l'utilisateur : celle de l'onglet devient la sienne. Rendre
     'own' dit a l'appelant de NE PAS la refermer. */
  try {
    if (own !== undefined && typeof chrome.windows.update === 'function') {
      await chrome.windows.update(own, { state: 'normal', focused: true });
      return 'own';
    }
  } catch { /* rien de plus a tenter */ }
  return false;
}

/* ------------------------------------------------------------ reclamation */

/**
 * Reclame une offre.
 *
 * `offre.url`           page du magasin, quand on la connait (sources natives)
 * `offre.urlResolution` redirection a suivre quand on ne la connait pas
 *
 * L'agregateur ne publie jamais l'URL du magasin, et sa redirection repond 403
 * hors navigateur : c'est l'ouverture de l'onglet qui sert d'etape de
 * resolution. L'URL trouvee est rendue dans le resultat pour etre memorisee --
 * une offre n'est resolue qu'une fois.
 */
export async function claimOffer(offer, {
  chrome,
  now,
  budgetMs = BUDGET_MS,
  supportedStores = [],
  record = () => {},
  fetch: fetchImpl,
  steamTiming,
  force = false,
  /* Faux : le moteur ne demande PAS « montrez-moi le bouton » (2.106.0), l'offre a
     deja eu sa question. */
  teach = true,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('reclamer : "maintenant" est obligatoire');

  // Steam n'a pas de moteur injecte : son parcours est a part, et optionnel.
  if (offer.store === STORES.STEAM) {
    return claimSteamOffer(offer, { chrome, now, budgetMs, record, fetch: fetchImpl, timing: steamTiming });
  }

  const target = offer.url || offer.resolveUrl;
  if (!target) return { verdict: VERDICTS.BAD_URL, details: 'aucune page a ouvrir' };

  const toResolve = !offer.url && Boolean(offer.resolveUrl);
  let tabId = null;
  let resolvedUrl = offer.url || null;
  let store = offer.store;
  let leaveOpen = false;
  let windowId = null;

  try {
    const opened = await openHiddenTab(chrome, target);
    tabId = opened.tabId;
    windowId = opened.windowId;
    await markPiloted(chrome, tabId, {
      offer: offer.catalogKey || null,
      // La fenetre est retenue avec l'onglet : c'est ELLE qu'il faudra fermer.
      // Ne fermer que notre onglet laissait la fenetre reduite survivre des
      // qu'une page y avait ouvert un onglet de plus (echange GOG, _blank).
      windowId,
      openedAt: now,
      expire: now + budgetMs,
    });

    const charge = await awaitLoad(chrome, tabId, LOAD_WAIT_MS);
    if (!charge) {
      return { verdict: VERDICTS.FAILURE, details: 'la page n\'a pas fini de charger', resolvedUrl };
    }

    if (toResolve) {
      resolvedUrl = await tabUrl(chrome, tabId);
      if (!resolvedUrl) {
        return { verdict: VERDICTS.FAILURE, details: 'URL d\'atterrissage illisible' };
      }
      // APRES resolution, l'URL est la seule verite. Pas de repli sur le titre
      // ni sur le champ platforms : une offre intitulee « ... (Epic Games)
      // Giveaway » peut parfaitement atterrir sur un site tiers a formulaire,
      // et retomber sur son titre reviendrait a cliquer n'importe ou.
      store = storeFromUrl(resolvedUrl) || STORES.UNKNOWN;
      record('info', `resolution : ${offer.title} -> ${store}`, { resolvedUrl });

      if (store === STORES.UNKNOWN || !supportedStores.includes(store)) {
        // Atterrissage hors perimetre : un site a compte et formulaire, ou un
        // magasin dont on n'a pas de module. On note l'URL pour ne pas
        // recommencer, et on previent une seule fois.
        return { verdict: VERDICTS.OUT_OF_SCOPE, details: store, resolvedUrl, store };
      }
    }

    // Le content script s'annonce quand il a compris qu'il est pilote.
    const ready = await awaitVerdict(tabId, 'fgc-pret', READY_WAIT_MS);
    if (!ready) {
      return { verdict: VERDICTS.FAILURE, details: 'le moteur ne s\'est pas annonce', resolvedUrl, store };
    }

    const promesseVerdict = awaitVerdict(tabId, 'fgc-verdict', budgetMs);
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'fgc-reclame', budgetMs, force: force === true, ...(teach === false ? { teach: false } : {}),
      });
    } catch (e) {
      return { verdict: VERDICTS.FAILURE, details: `ordre non transmis : ${(e && e.message) || e}`, resolvedUrl, store };
    }

    const response = await promesseVerdict;
    if (!response) {
      return { verdict: VERDICTS.FAILURE, details: `aucun verdict en ${Math.round(budgetMs / 1000)} s`, resolvedUrl, store };
    }

    leaveOpen = MANUAL_VERDICTS.includes(response.verdict);
    return {
      verdict: response.verdict,
      details: response.reasonText || null,
      key: response.key || null,
      resolvedUrl,
      store,
      tabId: leaveOpen ? tabId : null,
    };
  } finally {
    if (tabId !== null) {
      if (leaveOpen) {
        // Un defi de securite attend un humain : l'onglet reste, mais on le
        // marque pour que le balayage des orphelins ne le referme pas.
        // Et on le sort de sa fenetre reduite : un onglet qui a besoin d'un
        // humain ne doit pas vivre dans une fenetre que personne ne trouvera.
        const surfaced = await surfaceTab(chrome, tabId);
        // L'offre est retenue : une reponse du bandeau (« deja a moi », « plus offert ») sait ainsi laquelle elle regle.
        await markPiloted(chrome, tabId, { manual: true, openedAt: now, offer: offer.catalogKey || null });
        // Notre onglet est parti ailleurs : la fenetre reduite ne contient
        // plus que d'eventuels onglets ouverts par la page. On la ferme --
        // sauf si c'est elle, devenue celle de l'utilisateur, qui le porte.
        if (surfaced !== 'own') await closeEmptiedWindow(chrome, windowId, tabId);
      } else {
        // Annoncer NOTRE fermeture avant de la faire : sans cela, l'ecouteur
        // onRemoved la prendrait pour une disparition subie.
        expectClosure(tabId);
        // La FENETRE entiere, pas seulement notre onglet. Fermer l'onglet
        // seul laissait la fenetre survivre dans la barre des taches des
        // qu'une page y avait ouvert quelque chose -- et c'est l'utilisateur
        // qui devait faire le menage.
        if (windowId !== null) {
          await closeHiddenWindow(chrome, windowId, tabId);
        } else {
          try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ }
        }
        await forgetPiloted(chrome, tabId);
      }
    }
  }
}

/* ------------------------------------------------------------------ Steam */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delais du parcours Steam. Injectables pour les tests, qui n'attendent pas. */
export const STEAM_TIMING = Object.freeze({
  /** Apres le clic, le formulaire est soumis : on attend la page suivante. */
  navigationMs: 20 * 1000,
  /** Frequence a laquelle on regarde ou en est l'onglet pendant cette attente. */
  pollMs: 500,
  /** La bibliotheque se relit plusieurs fois : l'ajout n'y est pas instantane. */
  confirmTries: 8,
  confirmDelayMs: 3000,
});

/**
 * Attend que l'onglet ait quitte la page de depart et fini de charger.
 *
 * Le clic declenche une soumission de formulaire, donc une navigation -- mais
 * l'ecouteur ne peut pas etre pose avant le clic, qui vit dans la page. On
 * sonde donc l'onglet : parti ailleurs, ou vu en chargement, puis complet.
 * Rend false a l'expiration sans que ce soit un echec : la preuve, de toute
 * facon, se lit dans la bibliotheque.
 */
async function awaitNavigation(chrome, tabId, fromUrl, timeoutMs, pollMs = STEAM_TIMING.pollMs) {
  const t0 = Date.now();
  let sawLoading = false;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(pollMs);
    let t;
    try { t = await chrome.tabs.get(tabId); } catch { return false; }
    if (!t) return false;
    if (t.status === 'loading') sawLoading = true;
    if (t.status === 'complete' && (sawLoading || (t.url && t.url !== fromUrl))) return true;
  }
  return false;
}

/**
 * Relit la fiche APRES le clic, a blanc, et rend ce que la page repond.
 *
 * Seconde preuve, utilisee quand `dynamicstore/userdata` est reste muet
 * pendant toutes les tentatives. On revient sur la fiche -- le clic a
 * navigue ailleurs -- et on rejoue l'etape en `dryRun` : elle ne clique
 * rien, elle decrit.
 *
 * Ne jette jamais et rend null quand la plateforme ne permet pas le detour
 * (pas de `tabs.update`, onglet deja parti) : l'appelant traduit null en
 * « on ne sait pas », ce qui est la verite.
 */
async function inspectAgain(chrome, tabId, url, packageId, t) {
  if (!chrome.tabs || typeof chrome.tabs.update !== 'function') return null;
  const base = url.split('?')[0];
  try {
    await chrome.tabs.update(tabId, { url });

    /* On attend d'etre REVENU sur la fiche, pas seulement « une page a fini de
       charger » : juste apres le clic l'onglet est encore sur la reponse du
       formulaire, et elle est complete. Un chargement suffisant comme preuve
       aurait fait relire la mauvaise page. */
    let back = false;
    const t0 = Date.now();
    while (Date.now() - t0 < t.navigationMs) {
      await sleep(t.pollMs);
      let tab;
      try { tab = await chrome.tabs.get(tabId); } catch { return null; }
      if (!tab) return null;
      if (tab.status === 'complete' && String(tab.url || '').startsWith(base)) { back = true; break; }
    }
    if (!back) return null;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: steamPageStep,
      args: [packageId, true],
    });
    return injection ? injection.result : null;
  } catch {
    return null;
  }
}

/**
 * Recupere une offre Steam. OPTIONNEL, coupe par defaut : voir
 * watch/steam-claim.js pour le contrat Steam et ce qui a ete mesure.
 *
 * L'ordre des etapes est la securite :
 *
 *   1. l'option est RELUE ici. L'appelant ne devrait jamais venir jusqu'ici
 *      sans elle ; si un jour il le fait, rien ne se passe ;
 *   2. la bibliotheque est lue AVANT tout onglet, pour NE RIEN FAIRE sur un
 *      jeu deja acquis -- le quota d'activations de Steam compte « deja
 *      possede » comme un echec. Mais une lecture vide ou illisible n'arrete
 *      plus rien : voir ci-dessous ;
 *   3. dans la fenetre reduite, l'etape injectee lit d'abord la SESSION sur la
 *      page, puis verifie le bloc du PAQUET, le formulaire de licence gratuite
 *      et le libelle exact, puis clique une fois ;
 *   4. la preuve est le paquet dans `rgOwnedPackages` ; a defaut, la page
 *      rechargee qui dit « deja possede ». Jamais un texte lu avant le clic.
 *
 * POURQUOI LA LECTURE DE BIBLIOTHEQUE N'EST PLUS UN VERROU (2.22.2). Elle
 * l'etait : `logged_out` rendait « connexion requise », et toute autre
 * anomalie un echec -- sans ouvrir la moindre page. Or `dynamicstore/userdata`
 * lu depuis un service worker peut rendre des listes vides ou une reponse
 * illisible alors que la session existe bel et bien dans le navigateur. Le
 * resultat, signale par un utilisateur connecte : « aucune action », a chaque
 * cycle, pour toujours -- l'extension refusait d'aller voir la seule chose qui
 * sait repondre. Desormais elle y va : la page est rendue avec les vrais
 * cookies, et c'est elle qui tranche. Ce que la lecture prealable garde, c'est
 * son seul pouvoir utile : empecher une tentative sur un jeu deja acquis.
 *
 * Aucun moteur n'est injecte sur Steam : seule cette fonction touche une page
 * Steam, et seulement quand l'option est active.
 */
export async function claimSteamOffer(offer, {
  chrome,
  now,
  budgetMs = BUDGET_MS,
  record = () => {},
  fetch: fetchImpl = globalThis.fetch,
  timing,
} = {}) {
  const t = { ...STEAM_TIMING, ...(timing || {}) };
  const store = STORES.STEAM;

  const settings = await readSettings(chrome);
  if (settings.steamAutoClaim !== true) {
    return { verdict: VERDICTS.UNDETERMINED, details: 'recuperation Steam coupee : rien fait', store };
  }

  const appid = /^\d+$/.test(String(offer.storeId || '')) ? String(offer.storeId) : null;
  const packageId = /^\d+$/.test(String(offer.packageId || '')) ? String(offer.packageId) : null;
  if (!appid || !packageId) {
    return { verdict: VERDICTS.FAILURE, details: 'paquet Steam inconnu : seule la source Steam le donne', store };
  }

  const avant = await readOwnership({ fetch: fetchImpl, now: Date.now() });
  if (avant.status === 'ok' && (avant.packages.has(packageId) || avant.apps.has(appid))) {
    return { verdict: VERDICTS.CLAIMED, details: 'deja dans la bibliotheque Steam', store };
  }
  /* Un DLC sans son jeu de base : Steam refuserait, et le refus compterait
     dans son quota d'activations. On le dit, sans rien ouvrir ni envoyer. */
  const manque = missingBaseGame(offer, avant);
  if (manque) {
    const nom = await baseGameLabel(manque, { fetch: fetchImpl });
    return {
      verdict: VERDICTS.NEEDS_BASE,
      details: `DLC : il faut d'abord posseder le jeu de base sur Steam -- ${nom || `appid ${manque}`}`,
      store,
      // Rien n'a ete envoye a Steam : ni le rythme ni le plafond n'en paient le prix.
      touched: false,
    };
  }
  if (avant.status !== 'ok') {
    /* On continue, et le journal dit pourquoi. C'est le correctif de la 2.22.2 :
       une bibliotheque muette n'est pas une preuve d'absence de session. */
    record('info', avant.status === 'logged_out'
      ? 'steam : bibliotheque vide depuis le worker, la page va trancher'
      : `steam : bibliotheque illisible (${avant.note}), la page va trancher`);
  }

  const url = steamAppUrl(appid);
  let tabId = null;
  let windowId = null;

  try {
    const opened = await openHiddenTab(chrome, url);
    tabId = opened.tabId;
    windowId = opened.windowId;
    await markPiloted(chrome, tabId, {
      offer: offer.catalogKey || null,
      windowId,
      openedAt: now,
      expire: now + budgetMs,
    });

    if (!(await awaitLoad(chrome, tabId, LOAD_WAIT_MS))) {
      return { verdict: VERDICTS.FAILURE, details: 'la page Steam n\'a pas fini de charger', store };
    }
    const landed = await tabUrl(chrome, tabId);
    if (isSteamAgeCheckUrl(landed)) {
      return { verdict: VERDICTS.FAILURE, details: 'controle d\'age Steam : a passer une fois a la main', store };
    }
    if (isSteamLoginUrl(landed)) return { verdict: VERDICTS.LOGIN, details: 'Steam demande la connexion', store };

    let step = null;
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: steamPageStep,
        args: [packageId, false],
      });
      step = injection ? injection.result : null;
    } catch (e) {
      return { verdict: VERDICTS.FAILURE, details: `injection impossible : ${(e && e.message) || e}`, store };
    }
    if (!step || !step.ok) {
      if (step && step.reason === 'deja-possede') {
        return { verdict: VERDICTS.CLAIMED, details: 'Steam dit : deja dans la bibliotheque', store };
      }
      /* La page, elle, sait : son menu de compte porte un lien de connexion.
         C'est le seul « pas connecte » auquel on se fie desormais. */
      if (step && step.reason === 'non-connecte') {
        return { verdict: VERDICTS.LOGIN, details: 'la page Steam n\'est pas connectee', store };
      }
      return { verdict: VERDICTS.FAILURE, details: `page Steam : ${describeStep(step)}`, store };
    }
    const geste = step.via === 'formulaire' ? 'formulaire envoye' : 'clic';
    record('info', `steam : ${geste} pour le paquet ${packageId} (« Add to Account »)`);
    if (step.via === 'formulaire' && step.sessionid === false) {
      record('warn', 'steam : le formulaire ne porte pas de sessionid -- le POST va probablement etre refuse');
    }

    await awaitNavigation(chrome, tabId, landed || url, t.navigationMs, t.pollMs);
    const after = await tabUrl(chrome, tabId);
    if (isSteamLoginUrl(after)) return { verdict: VERDICTS.LOGIN, details: 'Steam a demande la connexion', store };
    /* Ou la demande a atterri. Lu MAINTENANT, avant que la seconde lecture ne
       renvoie l'onglet sur la fiche : c'est cette page-la qui porte le motif
       d'un refus, et elle ne sera plus affichee ensuite. */
    const atterrissage = await tabWhere(chrome, tabId);
    /* « Erreur du site » ne dit rien : le paragraphe dessous dit pourquoi
       (2.80.1). Lu seulement hors de la fiche, sur la page de la licence. */
    let motif = '';
    if (/\/freelicense\//.test(String(after || ''))) {
      try {
        const [lu] = await chrome.scripting.executeScript({ target: { tabId }, func: steamErrorText });
        motif = (lu && typeof lu.result === 'string') ? lu.result : '';
      } catch { motif = ''; }
    }

    /* La preuve, d'abord dans la bibliotheque. On retient si elle a seulement
       SU repondre : une bibliotheque muette ne prouve pas l'echec, et c'est
       toute la difference entre « rate » et « on ne sait pas ». */
    let readable = false;
    let derniere = null;
    for (let i = 0; i < t.confirmTries; i++) {
      if (i) await sleep(t.confirmDelayMs);
      const check = await readOwnership({ fetch: fetchImpl, now: Date.now() });
      if (check.status !== 'ok') continue;
      readable = true;
      derniere = check;
      if (check.packages.has(packageId)) return { verdict: VERDICTS.CLAIMED, details: null, store };
    }

    /* La bibliotheque n'a pas montre le paquet -- lisible ou non. On ne conclut
       PAS encore : on retourne sur la fiche et on la relit a blanc. Elle sait
       deux choses que `userdata` peut mettre du temps a dire : que le paquet
       est acquis (« You already have this item »), ou que le bouton est
       toujours la, donc que rien ne s'est passe. */
    const second = await inspectAgain(chrome, tabId, url, packageId, t);
    if (ownedFromStep(second)) {
      return { verdict: VERDICTS.CLAIMED, details: 'confirme par la page', store };
    }

    const ou = (atterrissage ? ` -- arrive sur : ${atterrissage}` : '') + (motif ? ` (« ${motif} »)` : '');

    /* La bibliotheque etait illisible avant l'envoi, lisible apres : si le jeu
       de base n'y est pas, c'est lui qui a fait refuser -- pas la page. */
    const manqueApres = missingBaseGame(offer, derniere);
    if (manqueApres) {
      const nom = await baseGameLabel(manqueApres, { fetch: fetchImpl });
      return {
        verdict: VERDICTS.NEEDS_BASE,
        details: `DLC : Steam a refuse, le jeu de base manque -- ${nom || `appid ${manqueApres}`}${ou}`,
        store,
      };
    }
    if (second && second.ok) {
      return {
        verdict: VERDICTS.FAILURE,
        details: `${geste}, mais la page propose toujours « Add to Account »${ou}`,
        store,
      };
    }
    if (readable) {
      return {
        verdict: VERDICTS.FAILURE,
        details: `${geste}, mais le paquet n'est pas apparu dans la bibliotheque Steam${ou}`,
        store,
      };
    }
    /* Ni l'une ni l'autre n'a repondu : ni succes, ni echec. `undetermined`
       n'est pas definitif, donc l'offre repassera apres le recul -- et le
       compte n'aura pas ete declare en echec pour une mesure absente. */
    return {
      verdict: VERDICTS.UNDETERMINED,
      details: `${geste}, resultat invisible (${describeStep(second)})${ou}`,
      store,
    };
  } finally {
    if (tabId !== null) {
      expectClosure(tabId);
      if (windowId !== null) await closeHiddenWindow(chrome, windowId, tabId);
      else { try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ } }
      await forgetPiloted(chrome, tabId);
    }
  }
}

/**
 * Referme la fenetre reduite APRES que l'onglet l'a quittee pour la fenetre de
 * l'utilisateur -- sans jamais toucher a l'onglet.
 *
 * Un navigateur referme de lui-meme une fenetre dont le dernier onglet part :
 * `windows.remove` echoue alors, et le repli de `closeHiddenWindow` (fermer
 * l'onglet) emportait l'onglet qu'on venait de montrer a l'utilisateur. C'etait
 * vrai pour un defi de securite, et pour « montrez-moi le bouton » (2.102.0).
 * Ici : la fenetre est relue, fermee seulement s'il n'y reste pas NOTRE onglet,
 * et une fenetre deja partie n'est pas une erreur.
 */
async function closeEmptiedWindow(chrome, windowId, tabId) {
  if (windowId === null || windowId === undefined) return;
  try {
    const w = await chrome.windows.get(windowId, { populate: true });
    if (!w) return;
    if ((w.tabs || []).some((t) => t && t.id === tabId)) return;
    await chrome.windows.remove(windowId);
  } catch { /* deja fermee : un navigateur referme seul une fenetre vide */ }
}

/**
 * Ferme une fenetre de reclamation, et retombe sur l'onglet si la fenetre
 * resiste. Ne jette jamais : un menage qui echoue ne doit pas transformer un
 * verdict acquis en erreur.
 */
async function closeHiddenWindow(chrome, windowId, tabId) {
  if (windowId === null || windowId === undefined) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    try { await chrome.tabs.remove(tabId); } catch { /* deja ferme */ }
  }
}

/* -------------------------------------------------------------- cadence */

export const KEY_CADENCE = 'veille:cadence-reclamation';
export const MAX_PER_HOUR = 10;

/**
 * Combien de reclamations dans la derniere heure, et reste-t-il de la place ?
 *
 * Trente reclamations en dix minutes ne ressemblent a rien d'humain. Ce plafond
 * est le seul garde-fou qui protege le compte plutot que le programme.
 */
export function hasRoom(timestamps, now, max = MAX_PER_HOUR) {
  const recent = (timestamps || []).filter((t) => now - t < 3600000);
  return { recent, left: Math.max(0, max - recent.length) };
}

export function recordClaim(timestamps, now) {
  return [...(timestamps || []), now].filter((t) => now - t < 3600000);
}
