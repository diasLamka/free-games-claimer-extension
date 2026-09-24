/* Lire ce que chaque magasin dit que vous possedez.
 *
 * LECTURE SEULE, avec votre session : aucun de ces appels ne modifie un compte,
 * et aucun ne part sans que vous l'ayez demande depuis la page de collection.
 *
 * CE QUI EST MESURE ET CE QUI NE L'EST PAS. La regle du depot veut qu'une
 * hypothese se mesure avant de s'ecrire. Ici, la mesure ne peut se faire
 * qu'avec VOTRE session, depuis VOTRE navigateur -- aucun banc de test ne
 * possede de bibliotheque. Chaque importation est donc aussi une mesure :
 *
 *   - Steam : `dynamicstore/userdata` est deja lu par la source Steam, et
 *     `IStoreBrowseService/GetItems` aussi. Rien de neuf.
 *   - GOG : `account/getFilteredProducts`, l'adresse que lisent depuis des
 *     annees les outils de sauvegarde de bibliotheque GOG. Mesuree le
 *     2026-09-19 SANS session seulement : 403 et un corps JSON qui dit
 *     « Full authentication is required ». Avec session : jamais mesuree ici.
 *   - Epic : `account/v2/payment/ajaxGetOrderHistory`, la page « Transactions »
 *     du compte. Mesuree le meme jour sans session : une chaine de
 *     redirections jusqu'a www.epicgames.com/id/login. Avec session : jamais.
 *
 * D'ou trois regles. La forme de chaque reponse est VERIFIEE avant qu'on en
 * tire quoi que ce soit ; une forme inattendue est un statut a part entiere,
 * pas une liste vide. Une importation incomplete ne s'applique pas -- une page
 * 3 ratee sur 5 effacerait les jeux des pages 3 a 5. Et chaque importation rend
 * un RAPPORT : la forme des reponses, jamais leurs valeurs (describeShape),
 * que la page propose de copier. C'est lui qui confirmera ou corrigera ces
 * hypotheses.
 */
import { IMPORT_STATUS, KINDS, makeItem, describeShape } from './collection.js';
import { describeFetchFailure } from './net.js';
import { OWNED_URL, itemsUrl, readOwnership } from './sources/steam.js';
import { normaliseTitle } from './offer.js';
import { MAX_STEAM_WISHES } from './wishlist.js';
import { deckFromItem } from './deck.js';

export const GOG_LIBRARY_URL = 'https://www.gog.com/account/getFilteredProducts';

/* La liste de souhaits GOG (2.66.0). Mesure du 2026-09-24, SANS session : 403
   et le meme corps que la bibliotheque, « Full authentication is required » --
   alors qu'une adresse inventee au meme endroit rend 404. L'adresse existe
   donc, et demande la session. Sa forme AVEC session, les outils de
   bibliotheque GOG la donnent pour celle de getFilteredProducts : `products`
   et `totalPages`. Elle n'a pas pu etre vue d'ici ; le rapport la decrit. */
export const GOG_WISHLIST_URL = 'https://www.gog.com/account/wishlist/search';

/* L'hote des comptes, pas www. Mesure du 2026-09-19 : l'adresse historique
   sur www.epicgames.com repond 302 vers accounts.epicgames.com, qui renvoie
   lui-meme vers la connexion quand il n'y a pas de session. On vise
   directement la destination : une redirection de moins, memes cookies. */
export const EPIC_ORDERS_URL = 'https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory';

/** Taille d'un lot de noms Steam. Prudente : la limite de GetItems n'est pas documentee. */
export const STEAM_BATCH = 50;

/** Bornes de pagination : une reponse qui paginerait a l'infini ne fige pas le worker. */
export const MAX_PAGES = 200;

const TIMEOUT_MS = 20000;

/** Pause entre deux requetes vers le meme hote : on lit une bibliotheque, on ne la martele pas. */
function defaultPause() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/* ------------------------------------------------------------------ outils */

/** L'adresse sans sa requete : un jeton de pagination n'a rien a faire dans un rapport. */
function withoutQuery(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return String(url || '').split('?')[0];
  }
}

/**
 * Une requete, et ce qu'il faut pour la juger.
 *
 * Le corps est lu en TEXTE puis parse : une session expiree rend souvent une
 * page de connexion en HTML, et `r.json()` n'en dirait qu'une exception.
 */
async function fetchJson(fetchImpl, url, { credentials = 'include' } = {}) {
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), TIMEOUT_MS) : null;
  try {
    const r = await fetchImpl(url, {
      credentials,
      redirect: 'follow',
      headers: { Accept: 'application/json' },
      signal: stopwatch ? stopwatch.signal : undefined,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    const type = (r.headers && typeof r.headers.get === 'function' && r.headers.get('content-type')) || '';
    // Le titre d'une page HTML dit souvent ce qu'elle est : connexion, ou mur anti-robot.
    const titre = json === undefined ? /<title[^>]*>([^<]{1,120})<\/title>/i.exec(text) : null;
    return {
      ok: r.ok,
      status: r.status,
      type: type.split(';')[0],
      bytes: text.length,
      finalUrl: r.url || url,
      json,
      title: titre ? titre[1].trim() : null,
    };
  } catch (e) {
    const reason = describeFetchFailure(e, { timeoutMs: TIMEOUT_MS, signal: stopwatch ? stopwatch.signal : undefined });
    return { ok: false, status: 0, type: '', bytes: 0, finalUrl: url, json: undefined, error: reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Une ligne de rapport sur une reponse : statut, type, taille, redirection. */
function describeResponse(res, asked) {
  if (res.error) return `echec reseau : ${res.error}`;
  const parts = [`HTTP ${res.status}`, res.type || 'type inconnu', `${res.bytes} octets`];
  if (res.title) parts.push(`page « ${res.title} »`);
  if (withoutQuery(res.finalUrl) !== withoutQuery(asked)) parts.push(`redirige vers ${withoutQuery(res.finalUrl)}`);
  return parts.join(', ');
}

/**
 * Ce qu'un corps JSON dit de l'authentification, s'il le dit.
 *
 * Mesure du 2026-09-19, sans session : GOG repond 403 avec
 * {"status":403,"code":403,"message":"Full authentication is required to
 * access this resource."}. Son 403 n'est donc PAS un mur anti-robot -- le
 * corps le dit, et c'est le corps qu'on lit. Rend le message, ou null.
 */
function authRefusal(json) {
  if (!json || typeof json !== 'object') return null;
  const said = [json.errorCode, json.error, json.message, json.error_description]
    .filter((v) => typeof v === 'string')
    .join(' ');
  // Pas « token » seul : « nextPageToken invalide » n'est pas une deconnexion.
  return /authenticat|unauthori[sz]ed|oauth|login|log in|sign in|credential/i.test(said) ? said.slice(0, 160) : null;
}

/** La forme du corps d'une reponse refusee : ce qui dit POURQUOI, sans ses valeurs. */
function bodyLine(lines, res) {
  if (res.json && typeof res.json === 'object') lines.push(`  corps : ${describeShape(res.json)}`);
}

/**
 * Le verdict d'une reponse, avant d'en lire le contenu.
 *
 * Trois facons de dire « pas connecte » : un 401, une redirection vers une
 * page de connexion, ou un code d'erreur d'authentification en JSON. Un 403
 * n'en fait PAS partie : c'est aussi ce que rend une protection anti-robot, et
 * dire « reconnectez-vous » a qui l'est deja l'enverrait tourner en rond.
 */
/** Une page de connexion, par son hote (login.gog.com) ou par son chemin (/id/login, /login/). */
function isLoginUrl(url) {
  return /\/\/(login|signin|auth)\.|\/(login|signin|sign-in)(\/|$)/i.test(withoutQuery(url));
}

function judge(res) {
  if (res.error) return { status: IMPORT_STATUS.ERROR, note: res.error };
  if (res.status === 401) return { status: IMPORT_STATUS.LOGGED_OUT, note: 'HTTP 401' };
  if (isLoginUrl(res.finalUrl)) return { status: IMPORT_STATUS.LOGGED_OUT, note: 'redirige vers la connexion' };
  const refus = authRefusal(res.json);
  if (refus) return { status: IMPORT_STATUS.LOGGED_OUT, note: refus };
  /* Mesure du meme jour : un agent « HeadlessChrome » recoit d'Epic un 403 en
     HTML, sans redirection -- un mur anti-robot. Le titre de la page part dans
     la note : c'est lui qui distingue ce cas d'une vraie panne. */
  if (!res.ok) return { status: IMPORT_STATUS.ERROR, note: `HTTP ${res.status}${res.title ? ` (page « ${res.title} »)` : ''}` };
  /* Une page HTML a la place du JSON veut souvent dire « pas connecte » -- mais
     pas toujours : l'adresse peut aussi avoir change. Le statut reste « forme
     inattendue », et la note dit les deux pistes. */
  if (res.json === undefined) {
    return {
      status: IMPORT_STATUS.SHAPE,
      note: `reponse non JSON (${res.type || 'type inconnu'}) : session absente, ou adresse qui a change`,
    };
  }
  return null;
}

function result(status, { items = [], note = null, lines = [], wishlist = null } = {}) {
  return { status, items, note, report: lines.join('\n'), wishlist };
}

/* ------------------------------------------------------------------- Steam */

/**
 * Le genre d'une application Steam, d'apres GetItems.
 *
 * `type` 4 est un DLC -- mesure du 2026-09-19 sur un DLC offert ce jour-la ;
 * la 2.21.0 lisait 1, comme la source Steam, et se trompait avec elle. Tout le
 * reste hors 0 -- demos, bandes originales, outils, videos -- va dans
 * « autre », cache par defaut : une bibliotheque Steam en compte des centaines.
 */
export function steamKind(type) {
  if (type === 0) return KINDS.GAME;
  if (type === 4) return KINDS.DLC;
  return KINDS.OTHER;
}

/**
 * La liste de souhaits, lue dans la MEME reponse que la bibliotheque.
 *
 * `rgWishlist` voyage dans `dynamicstore/userdata` a cote de `rgOwnedApps` :
 * aucune requete de plus vers un compte, aucune permission de plus. Sa forme
 * CONNECTEE n'a pas ete mesuree dans ce depot -- une suite d'appids, sous
 * forme de nombres, est la forme connue. D'ou la prudence :
 *
 *   - absente, ou d'une forme non reconnue : null, et la liste importee la
 *     fois precedente reste telle quelle. Ne pas savoir n'est pas « vide » ;
 *   - un tableau d'appids, meme vide : la photographie, qui remplace.
 *
 * Un element peut aussi etre un objet `{ appid }` : la forme de
 * `IWishlistService`, que Steam pourrait un jour reprendre ici.
 */
export function readSteamWishlist(json) {
  const raw = json && json.rgWishlist;
  if (!Array.isArray(raw)) return null;
  const ids = [];
  for (const v of raw) {
    const id = v && typeof v === 'object' ? v.appid : v;
    if ((typeof id === 'number' || typeof id === 'string') && /^\d+$/.test(String(id))) ids.push(String(id));
  }
  // Des elements, dont aucun n'est lisible : une forme inconnue, pas une liste vide.
  if (raw.length && !ids.length) return null;
  return [...new Set(ids)];
}

export async function importSteam({ fetch: fetchImpl = fetch, country = 'FR', pause = defaultPause, batch = STEAM_BATCH } = {}) {
  const lines = [`Steam -- ${withoutQuery(OWNED_URL)}`];

  const owned = await fetchJson(fetchImpl, OWNED_URL);
  lines.push(`  ${describeResponse(owned, OWNED_URL)}`);
  const bad = judge(owned);
  if (bad) {
    bodyLine(lines, owned);
    return result(bad.status, { note: bad.note, lines });
  }

  lines.push(`  forme : ${describeShape(owned.json)}`);
  const apps = owned.json && owned.json.rgOwnedApps;
  if (!Array.isArray(apps)) {
    return result(IMPORT_STATUS.SHAPE, { note: 'rgOwnedApps absent', lines });
  }
  /* Steam repond 200 avec des listes VIDES a qui n'est pas connecte. Une vraie
     bibliotheque vide existe, mais la confondre avec une session absente
     effacerait une collection entiere : on garde la photographie precedente. */
  if (!apps.length) {
    return result(IMPORT_STATUS.LOGGED_OUT, { note: 'aucun jeu lu : session Steam absente, ou bibliotheque vide', lines });
  }

  const ids = [...new Set(apps.map(String))].filter((id) => /^\d+$/.test(id));
  const lue = readSteamWishlist(owned.json);
  if (lue === null) {
    lines.push(`  liste de souhaits : ${Array.isArray(owned.json.rgWishlist) ? 'forme inattendue' : 'rgWishlist absent'}, la precedente est gardee`);
  }
  // Bornee AVANT d'etre nommee : des lots pour des souhaits qu'on ne gardera pas seraient des requetes pour rien.
  const wishIds = lue && lue.slice(0, MAX_STEAM_WISHES);
  if (lue && lue.length > wishIds.length) lines.push(`  liste de souhaits : ${lue.length} jeux, ${wishIds.length} gardes`);

  /* Les noms des souhaits viennent des memes lots GetItems que ceux de la
     bibliotheque : c'est le nom qui reconnaitra le jeu offert sur Epic ou
     GOG. Un souhait deja possede n'a pas a etre nomme deux fois. */
  const idSet = new Set(ids);
  const toName = [...ids, ...(wishIds || []).filter((id) => !idSet.has(id))];
  const names = new Map();
  let failed = 0;
  let lots = 0;

  for (let i = 0; i < toName.length; i += batch) {
    const lot = toName.slice(i, i + batch);
    const url = itemsUrl(lot, { lang: 'english', pays: country });
    const res = await fetchJson(fetchImpl, url, { credentials: 'omit' });
    lots++;
    const list = res.ok && res.json && res.json.response && res.json.response.store_items;
    if (!Array.isArray(list)) {
      failed++;
      if (failed === 1) lines.push(`  GetItems en echec : ${describeResponse(res, url)}`);
    } else {
      if (lots - failed === 1 && list.length) lines.push(`  forme d'un element GetItems : ${describeShape(list[0])}`);
      for (const it of list) {
        if (it && it.appid !== undefined && it.name) names.set(String(it.appid), { name: it.name, type: it.type, deck: deckFromItem(it) });
      }
    }
    if (i + batch < toName.length) await pause();
  }

  /* Un nom manquant n'annule pas l'importation : la POSSESSION vient de
     userdata, qui a repondu. Le jeu reste, sans titre, range dans « autre ». */
  const items = ids.map((id) => {
    const n = names.get(id);
    return makeItem({
      store: 'steam',
      id,
      title: n ? n.name : null,
      url: `https://store.steampowered.com/app/${id}/`,
      kind: n ? steamKind(n.type) : KINDS.OTHER,
      deck: n ? n.deck : null,
    });
  });

  const unnamed = ids.filter((id) => !names.has(id)).length;
  lines.push(`  ${ids.length} application(s), ${lots} lot(s) de noms, ${failed} en echec, ${unnamed} sans nom`);
  let note = unnamed ? `${ids.length} applications, ${unnamed} sans nom` : `${ids.length} applications`;

  let wishlist = null;
  if (wishIds !== null) {
    wishlist = wishIds.map((id) => ({ id, title: names.has(id) ? names.get(id).name : null }));
    const sansNom = wishlist.filter((w) => !w.title).length;
    lines.push(`  liste de souhaits : ${wishlist.length} jeu(x), ${sansNom} sans nom`);
    note += ` · ${wishlist.length} souhait(s)`;
  }
  return result(IMPORT_STATUS.OK, { items, note, lines, wishlist });
}

/* --------------------------------------------------------------------- GOG */

function absoluteGog(url) {
  const s = String(url || '');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  return `https://www.gog.com${s.startsWith('/') ? '' : '/'}${s}`;
}

export function gogPageUrl(page) {
  return `${GOG_LIBRARY_URL}?mediaType=1&sortBy=title&page=${page}`;
}

export function gogWishlistPageUrl(page) {
  return `${GOG_WISHLIST_URL}?hiddenFlag=0&mediaType=0&sortBy=date_added&page=${page}`;
}

/**
 * La liste de souhaits GOG : [{ id, title }], ou null quand elle n'a pas pu
 * etre lue ENTIERE. Null garde la precedente -- une liste tronquee ferait
 * oublier des jeux attendus. Un echec ici ne fait jamais echouer l'import de
 * la bibliotheque, qui a deja reussi.
 */
export async function readGogWishlist({ fetch: fetchImpl = fetch, pause = defaultPause, maxPages = MAX_PAGES, lines = [] } = {}) {
  const out = new Map();
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const url = gogWishlistPageUrl(page);
    const res = await fetchJson(fetchImpl, url);
    const bad = judge(res);
    if (bad) {
      lines.push(`  liste de souhaits : ${describeResponse(res, url)} (${bad.note}), la precedente est gardee`);
      return null;
    }
    const j = res.json;
    const products = j && j.products;
    const pages = Number(j && j.totalPages);
    if (page === 1) lines.push(`  liste de souhaits, forme : ${describeShape(j, { depth: 2 })}`);
    if (!Array.isArray(products) || !Number.isFinite(pages)) {
      lines.push('  liste de souhaits : products ou totalPages absent, la precedente est gardee');
      return null;
    }
    if (page === 1) {
      totalPages = Math.max(1, pages);
      if (totalPages > maxPages) {
        lines.push(`  liste de souhaits : ${totalPages} pages annoncees, la precedente est gardee`);
        return null;
      }
    }
    for (const p of products) {
      if (!p || p.id === undefined || p.id === null || !/^\d+$/.test(String(p.id))) continue;
      out.set(String(p.id), { id: String(p.id), title: p.title ? String(p.title) : null });
      if (out.size >= MAX_STEAM_WISHES) break;
    }
    if (page < totalPages) await pause();
  }
  lines.push(`  liste de souhaits : ${out.size} jeu(x)`);
  return [...out.values()];
}

export async function importGog({ fetch: fetchImpl = fetch, pause = defaultPause, maxPages = MAX_PAGES } = {}) {
  const lines = [`GOG -- ${GOG_LIBRARY_URL}`];
  const items = new Map();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page++) {
    const url = gogPageUrl(page);
    const res = await fetchJson(fetchImpl, url);
    if (page === 1) lines.push(`  ${describeResponse(res, url)}`);

    const bad = judge(res);
    if (bad) {
      // Une page ratee au milieu rendrait une photographie incomplete.
      if (page > 1) lines.push(`  page ${page} : ${describeResponse(res, url)}`);
      bodyLine(lines, res);
      return result(page === 1 ? bad.status : IMPORT_STATUS.ERROR, {
        note: page === 1 ? bad.note : `page ${page} sur ${totalPages} : ${bad.note}`,
        lines,
      });
    }

    const j = res.json;
    if (page === 1) lines.push(`  forme : ${describeShape(j, { depth: 2 })}`);
    const products = j && j.products;
    const pages = Number(j && j.totalPages);
    if (!Array.isArray(products) || !Number.isFinite(pages)) {
      return result(IMPORT_STATUS.SHAPE, { note: 'products ou totalPages absent', lines });
    }
    if (page === 1) {
      totalPages = Math.max(1, pages);
      if (products.length) lines.push(`  forme d'un produit : ${describeShape(products[0])}`);
      if (totalPages > maxPages) {
        // Tronquer, c'est rendre une photographie fausse : on refuse plutot.
        return result(IMPORT_STATUS.ERROR, { note: `${totalPages} pages annoncees, plus que les ${maxPages} permises`, lines });
      }
    }

    for (const p of products) {
      if (!p || p.id === undefined || p.id === null || !p.title) continue;
      items.set(String(p.id), makeItem({ store: 'gog', id: p.id, title: p.title, url: absoluteGog(p.url), kind: KINDS.GAME }));
    }
    if (page < totalPages) await pause();
  }

  lines.push(`  ${items.size} jeu(x) sur ${totalPages} page(s)`);
  const wishlist = await readGogWishlist({ fetch: fetchImpl, pause, maxPages, lines });
  const note = `${items.size} jeux${wishlist ? ` · ${wishlist.length} souhait(s)` : ''}`;
  return result(IMPORT_STATUS.OK, { items: [...items.values()], note, lines, wishlist });
}

/* -------------------------------------------------------------------- Epic */

export function epicPageUrl(token) {
  return `${EPIC_ORDERS_URL}?sortDir=DESC&sortBy=DATE&locale=en-US`
    + (token ? `&nextPageToken=${encodeURIComponent(token)}` : '');
}

/* Une commande qui ANNULE une acquisition. Les valeurs reelles de `orderType`
   ne sont pas mesurees : le rapport les compte, et c'est lui qui dira si ce
   motif en oublie une. */
const UNDONE = /refund|chargeback|revok|cancel/i;

export async function importEpic({ fetch: fetchImpl = fetch, pause = defaultPause, maxPages = MAX_PAGES } = {}) {
  const lines = [`Epic -- ${EPIC_ORDERS_URL}`];
  const items = new Map();
  const types = new Map();
  const seen = new Set();
  let token = null;
  let pages = 0;
  let undone = 0;

  for (;;) {
    if (pages >= maxPages) {
      return result(IMPORT_STATUS.ERROR, { note: `plus de ${maxPages} pages de commandes`, lines });
    }
    const url = epicPageUrl(token);
    const res = await fetchJson(fetchImpl, url);
    pages++;
    if (pages === 1) lines.push(`  ${describeResponse(res, url)}`);

    const bad = judge(res);
    if (bad) {
      if (pages > 1) lines.push(`  page ${pages} : ${describeResponse(res, url)}`);
      bodyLine(lines, res);
      return result(pages === 1 ? bad.status : IMPORT_STATUS.ERROR, {
        note: pages === 1 ? bad.note : `page ${pages} : ${bad.note}`,
        lines,
      });
    }

    const j = res.json;
    const orders = j && j.orders;
    if (pages === 1) lines.push(`  forme : ${describeShape(j, { depth: 2 })}`);
    if (!Array.isArray(orders)) {
      return result(IMPORT_STATUS.SHAPE, { note: 'orders absent', lines });
    }
    if (pages === 1 && orders.length) {
      lines.push(`  forme d'une commande : ${describeShape(orders[0], { depth: 3 })}`);
    }

    for (const o of orders) {
      if (!o || typeof o !== 'object') continue;
      const type = String(o.orderType || '');
      types.set(type || '(vide)', (types.get(type || '(vide)') || 0) + 1);
      if (UNDONE.test(`${type} ${o.orderStatus || ''} ${o.status || ''}`)) { undone++; continue; }

      const when = Number(o.createdAtMillis) || Date.parse(o.createdAt) || null;
      for (const it of Array.isArray(o.items) ? o.items : []) {
        if (!it || !it.description) continue;
        // L'offre fait l'identite ; a defaut, l'espace de noms et le titre.
        const id = it.offerId || `${it.namespace || '?'}:${normaliseTitle(it.description)}`;
        const prev = items.get(String(id));
        const acquiredAt = prev && prev.acquiredAt && when ? Math.min(prev.acquiredAt, when) : (when || (prev && prev.acquiredAt) || null);
        items.set(String(id), makeItem({ store: 'epic', id, title: it.description, kind: KINDS.GAME, acquiredAt }));
      }
    }

    const next = j.nextPageToken;
    // Un jeton deja vu ferait tourner la pagination en rond.
    if (!next || !orders.length || seen.has(next)) break;
    seen.add(next);
    token = next;
    await pause();
  }

  const typesText = [...types.entries()].map(([t, n]) => `${t} x${n}`).join(', ') || 'aucune';
  lines.push(`  ${items.size} article(s) sur ${pages} page(s) ; types de commande : ${typesText} ; ${undone} ecartee(s)`);
  return result(IMPORT_STATUS.OK, { items: [...items.values()], note: `${items.size} jeux`, lines });
}

/* ------------------------------------------------------------------ entree */

/* --------------------------------------------------------- sonde de session */

/**
 * Etes-vous connecte a ce magasin ? Une requete, et rien de plus.
 *
 * POURQUOI ICI, et pas dans un module a part. Repondre a cette question, c'est
 * exactement ce que `judge` fait deja depuis la 2.21.0 -- avec ses trois
 * facons mesurees de dire « pas connecte » (un 401, une redirection vers une
 * page de connexion, un refus d'authentification dans le corps) et son refus
 * assume de compter le 403 parmi elles. Ecrire une seconde logique a cote
 * aurait produit deux verites sur la meme question, et elles auraient
 * diverge -- le depot en a deja fait l'experience avec `--rail`.
 *
 * On demande donc le MOINS possible : la premiere page, jamais la
 * pagination. Une sonde ne rapatrie pas une bibliotheque.
 *
 * Steam est a part, et c'est mesure : sans session, `dynamicstore/userdata`
 * repond 200 avec des listes VIDES -- `judge` n'y verrait rien d'anormal.
 * C'est `readOwnership` qui sait lire ce cas, et c'est lui qu'on appelle.
 */
export async function probeSession(store, { fetch: fetchImpl = fetch } = {}) {
  if (store === 'steam') {
    const r = await readOwnership({ fetch: fetchImpl, now: Date.now() });
    if (r.status === 'ok') return { status: IMPORT_STATUS.OK, note: `${r.apps.size} jeu(x) vus` };
    if (r.status === 'logged_out') return { status: IMPORT_STATUS.LOGGED_OUT, note: 'listes vides' };
    return { status: IMPORT_STATUS.ERROR, note: r.note || 'illisible' };
  }

  const url = store === 'gog' ? gogPageUrl(1) : store === 'epic' ? epicPageUrl() : null;
  if (!url) return { status: IMPORT_STATUS.ERROR, note: `magasin sans sonde : ${store}` };

  const res = await fetchJson(fetchImpl, url);
  const verdict = judge(res);
  // `judge` rend null quand la reponse n'a rien d'anormal : c'est un oui.
  return verdict || { status: IMPORT_STATUS.OK, note: describeResponse(res, url) };
}

const IMPORTERS = Object.freeze({ steam: importSteam, gog: importGog, epic: importEpic });

/**
 * Importe un magasin. Ne leve jamais : une exception devient un statut, pour
 * que la page ait toujours quelque chose a afficher.
 */
export async function importStore(store, options = {}) {
  const run = IMPORTERS[store];
  if (!run) return result(IMPORT_STATUS.ERROR, { note: `magasin non importable : ${store}` });
  try {
    return await run(options);
  } catch (e) {
    return result(IMPORT_STATUS.ERROR, { note: (e && e.message) || String(e) });
  }
}
