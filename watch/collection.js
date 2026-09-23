/* Ma collection : ce que vous possedez sur chaque magasin, pas seulement ce que
 * l'extension a reclame.
 *
 * Le registre (library.js) fige ce que l'extension RECLAME. Il ne sait rien de
 * ce que vous possediez avant elle, ni de ce que vous avez pris a la main --
 * et apres des mois de jeux hebdomadaires, une collection est eparpillee entre
 * quatre launchers. Ce module rassemble les deux : ce que chaque magasin dit
 * que vous possedez (lu avec votre session, en lecture seule), et ce que
 * l'extension a reclame.
 *
 * Depuis la 2.42.0, elle decide d'une seule chose, et sur un IDENTIFIANT
 * exact, jamais sur un titre (ROADMAP, « possede AVANT l'extension ») : ne pas
 * ouvrir d'onglet pour une offre dont le magasin dit que vous l'avez deja.
 * C'est ce qui evite, sur un nouvel ordinateur, de tout retenter. Un titre mal
 * rapproche ne peut toujours pas faire rater un jeu offert : sans identifiant
 * commun, rien n'est ecarte. Et seul un magasin dont une importation a REUSSI
 * compte -- une reponse inattendue ne laisse aucun jeu derriere elle.
 *
 * Module pur : le reseau est dans collection-import.js, l'ecriture dans
 * background.js -- un seul ecrivain, comme pour le catalogue.
 */
import { deckAtLeast, readDeck } from './deck.js';
import { normaliseTitle, webUrl } from './offer.js';
import { ACQUIRED } from './library.js';

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_COLLECTION = 'veille:collection';

/** Les magasins dont on sait LIRE la bibliotheque. */
export const IMPORTABLE_STORES = Object.freeze(['steam', 'gog', 'epic']);

/**
 * Les magasins affiches, dans l'ordre.
 *
 * Amazon n'est pas importable : sa bibliotheque vit derriere une API GraphQL
 * protegee par un jeton de page, et rien n'en a ete mesure. Il ne montre donc
 * que ce que l'extension a reclame -- et la page le dit.
 */
export const COLLECTION_STORES = Object.freeze(['steam', 'gog', 'epic', 'amazon']);

export const IMPORT_STATUS = Object.freeze({
  RUNNING: 'running',
  OK: 'ok',
  /** Session absente : rien n'est efface, on garde la derniere photographie. */
  LOGGED_OUT: 'logged_out',
  /** Reponse lue, mais pas de la forme attendue : c'est la que sert le rapport. */
  SHAPE: 'shape',
  ERROR: 'error',
});

export const KINDS = Object.freeze({ GAME: 'game', DLC: 'dlc', OTHER: 'other' });

/**
 * Au-dela, une importation marquee « en cours » est une importation morte : le
 * service worker a ete arrete en route. Largement au-dessus de ce que prend une
 * bibliotheque de plusieurs milliers de jeux.
 */
export const STALE_RUN_MS = 10 * 60 * 1000;

/* -------------------------------------------------------------- stockage */

export function emptyCollection() {
  return { stores: {}, items: {} };
}

/** Une valeur lue du stockage, rendue exploitable quoi qu'elle contienne. */
export function sanitiseCollection(raw) {
  const ok = (v) => v && typeof v === 'object' && !Array.isArray(v);
  return {
    stores: ok(raw) && ok(raw.stores) ? raw.stores : {},
    items: ok(raw) && ok(raw.items) ? raw.items : {},
  };
}

export function itemKey(store, id) {
  return `${store}:${id}`;
}

/**
 * Ce qu'on garde d'un jeu importe. Peu de champs : une bibliotheque Steam
 * compte des milliers d'entrees, et chaque champ se paie autant de fois.
 */
export function makeItem({ store, id, title, url = null, kind = KINDS.GAME, acquiredAt = null, deck = null }) {
  const clean = title === null || title === undefined ? '' : String(title).trim();
  return {
    store,
    id: String(id),
    title: clean || null,
    /* Le meme filtre que pour les offres, et pour la meme raison : cette URL
       vient d'une reponse de magasin -- la fiche GOG est publiee par
       `account/getFilteredProducts`, lu AVEC la session -- et elle finit dans
       le `href` d'un lien de la page Collection. Elle ne passait par aucun
       controle de schema ; seul un hasard heureux la sauvait, `absoluteGog`
       prefixant un « javascript: » par « https://www.gog.com/ ». */
    url: webUrl(url),
    kind: Object.values(KINDS).includes(kind) ? kind : KINDS.OTHER,
    acquiredAt: Number.isFinite(acquiredAt) && acquiredAt > 0 ? acquiredAt : null,
    /* Steam seulement, et seulement quand Steam l'a dit : un champ absent
       plutot qu'un null par jeu, parce qu'une bibliotheque en compte des
       milliers et que chaque champ se paie autant de fois. */
    ...(readDeck(deck) ? { deck: readDeck(deck) } : {}),
  };
}

/* ------------------------------------------------------ possession exacte */

/**
 * Les sources dont l'identifiant d'offre EST l'identifiant du magasin, et donc
 * celui que l'importation range.
 *
 *   - epic-api : `el.id`, l'offre du catalogue Epic -- l'historique des
 *     commandes porte le meme `offerId` ;
 *   - gog      : l'identifiant de produit, celui de `getFilteredProducts` ;
 *   - steam    : l'appid.
 *
 * L'agregateur n'y est pas : son identifiant est le sien, pas celui d'un
 * magasin, et une offre qu'on ne sait pas identifier n'est jamais ecartee.
 */
export const STORE_ID_SOURCES = Object.freeze({ 'epic-api': 'epic', gog: 'gog', steam: 'steam' });

/** Les cles de collection qu'une offre designe exactement, s'il y en a une. */
export function offerStoreKeys(offer) {
  if (!offer || offer.sourceId === null || offer.sourceId === undefined) return [];
  // makeOffer ecrit String(null) quand la source n'a rien donne : « null »
  // n'identifie aucun jeu.
  const id = String(offer.sourceId);
  if (!id || id === 'null' || id === 'undefined') return [];
  const store = STORE_ID_SOURCES[offer.source];
  // L'offre doit viser le magasin que sa source decrit : un identifiant Epic
  // n'a rien a dire d'une offre qui atterrirait ailleurs.
  if (!store || store !== offer.store) return [];
  return [itemKey(store, id)];
}

/**
 * Les cles exactes de ce que les magasins disent que vous possedez.
 *
 * Seuls comptent les magasins dont une importation a reussi au moins une fois
 * (`lastOk`) : la photographie est alors celle d'une reponse verifiee sur VOTRE
 * compte. Une importation ratee plus tard ne l'efface pas -- on ne perd pas un
 * jeu parce qu'une session a expire.
 */
export function ownedStoreKeys(collection) {
  const c = sanitiseCollection(collection);
  const out = new Set();
  for (const it of Object.values(c.items)) {
    if (!it || !it.store || it.id === null || it.id === undefined) continue;
    const st = c.stores[it.store];
    if (!st || !st.lastOk) continue;
    out.add(itemKey(it.store, String(it.id)));
  }
  return out;
}

/** Le nombre de jeux d'un magasin dans la collection. */
function countFor(items, store) {
  let n = 0;
  for (const it of Object.values(items)) if (it && it.store === store) n++;
  return n;
}

/**
 * Integre le resultat d'une importation.
 *
 * Une importation REUSSIE remplace tout ce que le magasin avait : c'est une
 * photographie, pas un ajout -- un jeu rembourse doit pouvoir disparaitre.
 *
 * Une importation RATEE ne touche a aucun jeu. Une session expiree ou une
 * reponse inattendue ne prouvent pas que la bibliotheque est vide, et effacer
 * huit cents jeux sur un 401 serait pire que de ne rien afficher. C'est la
 * regle de readOwned (watch/sources/steam.js), appliquee a toute la collection.
 */
export function applyImport(collection, store, result, now) {
  const base = sanitiseCollection(collection);
  const before = base.stores[store] || {};
  const items = { ...base.items };

  if (result.status === IMPORT_STATUS.OK) {
    for (const [k, it] of Object.entries(items)) if (it && it.store === store) delete items[k];
    for (const it of result.items || []) items[itemKey(store, it.id)] = it;
  }

  return {
    stores: {
      ...base.stores,
      [store]: {
        status: result.status,
        at: now,
        lastOk: result.status === IMPORT_STATUS.OK ? now : (before.lastOk || null),
        count: countFor(items, store),
        note: result.note || null,
        report: result.report || null,
      },
    },
    items,
  };
}

/** Marque un magasin « en cours », sans rien perdre de ce qu'on en savait. */
export function markRunning(collection, store, now) {
  const base = sanitiseCollection(collection);
  return {
    stores: {
      ...base.stores,
      [store]: { ...(base.stores[store] || {}), status: IMPORT_STATUS.RUNNING, startedAt: now },
    },
    items: base.items,
  };
}

/** L'etat a afficher : une importation « en cours » depuis trop longtemps est morte. */
export function effectiveStatus(storeState, now) {
  if (!storeState || !storeState.status) return null;
  if (storeState.status === IMPORT_STATUS.RUNNING
    && (!storeState.startedAt || now - storeState.startedAt > STALE_RUN_MS)) {
    return IMPORT_STATUS.ERROR;
  }
  return storeState.status;
}

/* ----------------------------------------------------------------- rapport */

/* Une cle qui est un IDENTIFIANT est une donnee, pas un nom de champ : un
   dictionnaire range par numero de produit dirait ce que vous possedez. On
   n'en montre que le nombre. */
function looksLikeData(key) {
  return /^\d+$/.test(key) || /^[0-9a-f]{12,}$/i.test(key) || !/^[A-Za-z_$][\w$-]{0,40}$/.test(key);
}

/**
 * La FORME d'une valeur, sans aucune de ses valeurs.
 *
 * C'est tout le rapport de mesure : il doit dire quel champ porte le titre et
 * lequel pagine, sans jamais recopier un titre, un prix ou un identifiant de
 * commande. Les chaines deviennent « texte », les nombres « nombre », une
 * liste montre sa longueur et la forme de son premier element.
 */
export function describeShape(value, { depth = 4, maxKeys = 30 } = {}) {
  function walk(v, d) {
    if (v === null) return 'null';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return d <= 0 ? `[${v.length}]` : `[${v.length} x ${walk(v[0], d - 1)}]`;
    }
    if (typeof v === 'string') return 'texte';
    if (typeof v === 'number') return 'nombre';
    if (typeof v === 'boolean') return 'booleen';
    if (typeof v !== 'object') return typeof v;

    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    if (d <= 0) return `{${keys.length} cle(s)}`;
    if (keys.every(looksLikeData)) return `{${keys.length} x ?: ${walk(v[keys[0]], d - 1)}}`;

    const shown = keys.slice(0, maxKeys)
      .map((k) => `${looksLikeData(k) ? '?' : k}: ${walk(v[k], d - 1)}`);
    if (keys.length > maxKeys) shown.push(`+${keys.length - maxKeys}`);
    return `{${shown.join(', ')}}`;
  }
  return walk(value, depth);
}

/* ------------------------------------------------------------------ lignes */

/** « together-after-dark » -> « together after dark » : mieux qu'un slug nu. */
function titleFromId(id) {
  const bare = String(id || '').replace(/^(slug|offer|code):/, '');
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(bare) ? bare.replace(/[-_]+/g, ' ') : null;
}

/**
 * Les jeux regroupes par titre, tous magasins confondus.
 *
 * Le regroupement se fait sur le titre NORMALISE, le meme que le rapprochement
 * du catalogue : c'est lui qui dit « vous l'avez deja sur Steam ». Il ne sert
 * qu'a l'affichage -- deux jeux distincts au meme titre se retrouveraient sur
 * une seule ligne, et c'est pour cela qu'aucune decision ne s'appuie dessus.
 *
 * Un jeu sans titre (retire d'un magasin, identifiant opaque) garde sa propre
 * ligne : le fusionner avec un autre inconnu serait inventer un doublon.
 */
export function buildRows({ collection, library }) {
  const rows = new Map();

  function add({ store, id, title, url, kind, acquiredAt, imported, claimed, deck }) {
    const shown = title || titleFromId(id);
    const norme = shown ? normaliseTitle(shown) : '';
    const key = norme || `?${store}:${id}`;

    let row = rows.get(key);
    if (!row) {
      row = { key, title: shown || null, kind, stores: {}, since: null, claimed: false };
      rows.set(key, row);
    }
    // Le titre du magasin l'emporte sur un slug embelli.
    if (title && (!row.title || imported)) row.title = title;
    // Un seul exemplaire « jeu » suffit a faire de la ligne un jeu.
    if (kind === KINDS.GAME) row.kind = KINDS.GAME;
    else if (row.kind !== KINDS.GAME && kind === KINDS.DLC) row.kind = KINDS.DLC;

    const copy = row.stores[store] || { id, url: null, acquiredAt: null, imported: false, claimed: false };
    copy.url = copy.url || url || null;
    copy.imported = copy.imported || Boolean(imported);
    copy.claimed = copy.claimed || Boolean(claimed);
    if (acquiredAt) copy.acquiredAt = copy.acquiredAt ? Math.min(copy.acquiredAt, acquiredAt) : acquiredAt;
    row.stores[store] = copy;

    if (acquiredAt) row.since = row.since ? Math.min(row.since, acquiredAt) : acquiredAt;
    row.claimed = row.claimed || Boolean(claimed);
    if (readDeck(deck)) row.deck = deck;
  }

  for (const it of Object.values(sanitiseCollection(collection).items)) {
    if (!it || !it.store || it.id === undefined) continue;
    add({ ...it, imported: true, claimed: false });
  }

  for (const e of Object.values(library || {})) {
    if (!e || !e.store) continue;
    if (e.status && !ACQUIRED.includes(e.status)) continue;
    add({
      store: e.store,
      id: e.id,
      title: e.title,
      url: e.url,
      kind: KINDS.GAME,
      acquiredAt: e.ts,
      imported: false,
      claimed: true,
    });
  }

  return [...rows.values()];
}

export function storeCount(row) {
  return Object.keys(row.stores).length;
}

/**
 * Filtre les lignes.
 *
 * `kind` vaut 'game' par defaut : une bibliotheque Steam porte autant de bandes
 * originales, d'outils et de DLC que de jeux, et les montrer d'emblee noierait
 * ce qu'on cherche. 'all' les rend tous.
 */
export function filterRows(rows, {
  query = '', store = '', duplicatesOnly = false, kind = KINDS.GAME, deck = '',
} = {}) {
  const q = normaliseTitle(query);
  return rows.filter((r) => {
    if (kind !== 'all' && r.kind !== kind) return false;
    // Au moins ce niveau sur Steam Deck ; un jeu dont on ne sait rien ne passe pas.
    if (!deckAtLeast(r.deck, deck)) return false;
    if (store && !r.stores[store]) return false;
    if (duplicatesOnly && storeCount(r) < 2) return false;
    if (q && !r.key.includes(q)) return false;
    return true;
  });
}

/** Trie sans modifier l'entree. 'title', 'since' (recent d'abord) ou 'stores'. */
export function sortRows(rows, by = 'title', locale = 'fr') {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byTitle = (a, b) => collator.compare(a.title || '', b.title || '');
  const out = [...rows];
  if (by === 'since') {
    out.sort((a, b) => ((b.since || 0) - (a.since || 0)) || byTitle(a, b));
  } else if (by === 'stores') {
    out.sort((a, b) => (storeCount(b) - storeCount(a)) || byTitle(a, b));
  } else {
    out.sort(byTitle);
  }
  return out;
}

/** Les chiffres de l'en-tete, sur les lignes deja filtrees par genre. */
export function summarise(rows) {
  const perStore = {};
  for (const s of COLLECTION_STORES) perStore[s] = 0;
  let duplicates = 0;
  let claimed = 0;
  for (const r of rows) {
    for (const s of Object.keys(r.stores)) perStore[s] = (perStore[s] || 0) + 1;
    if (storeCount(r) > 1) duplicates++;
    if (r.claimed) claimed++;
  }
  return { titles: rows.length, duplicates, claimed, perStore };
}

/* ------------------------------------------------------------------ liens */

/** La fiche du jeu sur son magasin, quand on sait la construire. */
export function storePageUrl(store, copy) {
  // Filtree une seconde fois : une collection ecrite par une version
  // anterieure a ce controle peut encore porter n'importe quoi.
  const propre = webUrl(copy && copy.url);
  if (propre) return propre;
  if (store === 'steam' && /^\d+$/.test(String(copy && copy.id))) {
    return `https://store.steampowered.com/app/${copy.id}/`;
  }
  return null;
}

/**
 * Lancer le jeu dans son launcher.
 *
 * Steam seulement : `steam://run/<appid>` est documente par Valve. Les autres
 * launchers ont des schemas d'URL, mais aucun n'a ete verifie ici -- un bouton
 * qui n'ouvre rien serait pire que pas de bouton.
 */
export function launchUrl(store, copy) {
  if (store === 'steam' && /^\d+$/.test(String(copy && copy.id))) return `steam://run/${copy.id}`;
  return null;
}
