/* Le registre de ce que vous possedez, et qui survit a la purge.
 *
 * Le probleme qu'il resout est simple et couteux. Le moteur ecrit dans
 * FGC_history_<plateforme> une entree de la forme {status, reason, ts} sous une
 * cle comme 'slug:cardpocalypse'. Le TITRE et la VALEUR ne sont pas la : ils
 * vivent dans le catalogue de veille, qui est purge -- trente jours par
 * pruneNow, quatre-vingt-dix par purgeExpired. Passe ce delai, matchHistory()
 * rend null, et alors :
 *
 *   - le journal affiche un slug embelli, ou juste « Amazon Luna » quand
 *     l'identifiant est opaque ;
 *   - le bilan compte le jeu mais ne sait plus ce qu'il valait ;
 *   - l'export CSV sort une ligne sans titre et sans valeur, c'est-a-dire au
 *     moment ou il servirait le plus : sur les vieilles reclamations.
 *
 * Le registre fige donc, A L'INSTANT DE LA RECLAMATION, ce que le catalogue
 * sait encore. C'est la seule fenetre pendant laquelle l'information existe.
 *
 * Module pur : la plomberie chrome.* est dans background.js.
 */

import { worthSource } from './offer.js';

/** Cle de stockage. Espace de la veille, jamais l'espace FGC_* du moteur. */
export const KEY_LIBRARY = 'veille:bibliotheque';

/** Statuts qui valent acquisition. Les memes que ceux du bilan. */
export const ACQUIRED = Object.freeze(['claimed', 'redeemed']);

/** Plateformes du moteur vers identifiants de magasin. */
export const PLATFORM_STORES = Object.freeze({
  'Epic Games': 'epic',
  GOG: 'gog',
  'Amazon Luna': 'amazon',
});

/**
 * Identite d'une entree du registre.
 *
 * Le magasin plus l'identifiant chez lui. Deux jeux de meme titre sur deux
 * magasins sont deux acquisitions distinctes -- et c'est souvent voulu : un jeu
 * possede sur Epic vaut la peine d'etre repris sur GOG, sans DRM.
 */
export function libraryKey(store, id) {
  return `${store}:${String(id || '').replace(/^(slug|offer|code):/, '')}`;
}

/**
 * Ce qu'on garde d'une acquisition. Volontairement peu : le registre n'a pas de
 * date d'expiration, donc chaque champ est un cout permanent.
 */
export function makeEntry({ store, id, title, url, worth, image, ts, status, wsrc }) {
  return {
    store,
    id: String(id || '').replace(/^(slug|offer|code):/, ''),
    title: title || null,
    url: url || null,
    worth: worth || null,
    image: image || null,
    ts,
    status,
    /* D'ou vient la valeur (2.103.0) : 'store' si le magasin a donne son propre
       prix, 'aggregator' si un site tiers l'a annoncee. Fige a l'instant de la
       reclamation, avec le reste : le catalogue ne s'en souviendra pas. Absent
       quand on ne sait pas -- le bilan le range alors « a confirmer ». */
    ...(wsrc === 'store' || wsrc === 'aggregator' ? { wsrc } : {}),
  };
}

/**
 * Fusionne une entree dans le registre.
 *
 * Deux regles, et elles vont dans le meme sens :
 *
 *   - la PREMIERE date gagne. Une reclamation reussie n'arrive qu'une fois ; un
 *     second passage sur la meme page rend « deja possede » et ne doit pas
 *     redater l'acquisition de deux ans en arriere vers aujourd'hui.
 *   - un champ RENSEIGNE ne se fait jamais ecraser par un champ vide. C'est ce
 *     qui permet d'enrichir plus tard une entree figee sans titre, quand la
 *     veille finit par croiser le jeu.
 */
export function mergeEntry(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    title: incoming.title || existing.title,
    url: incoming.url || existing.url,
    worth: incoming.worth || existing.worth,
    image: incoming.image || existing.image,
    ts: Math.min(existing.ts, incoming.ts),
    status: existing.status || incoming.status,
    ...((existing.wsrc || incoming.wsrc) ? { wsrc: existing.wsrc || incoming.wsrc } : {}),
  };
}

/**
 * L'historique d'une plateforme, tel que le stockage le rend.
 *
 * Le moteur l'ecrit par GM_setValue, donc en TEXTE JSON, et storage.onChanged
 * rend ce texte tel quel. addedEntries le parcourait caractere par caractere,
 * n'y trouvait aucune entree datee, et le registre n'a jamais rien recu hors
 * des tests -- qui, eux, lui passaient des objets.
 */
export function readHistory(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return {}; }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Les entrees d'historique qu'un changement de storage vient d'ajouter.
 *
 * saveHistoryEntry reecrit l'OBJET ENTIER de l'historique de la plateforme a
 * chaque appel, donc `newValue` porte des dizaines d'entrees et `oldValue`
 * autant. Sans cette difference, la premiere ecriture ferait tout re-ingerer
 * comme si tout venait d'arriver -- et le registre daterait toute une
 * collection du meme jour.
 *
 * `oldValue` absent est le cas normal a la premiere ecriture : on prend tout,
 * ce qui est correct puisque le registre est vide. C'est aussi ce que fait le
 * rattrapage, qui passe l'historique entier : `mergeEntry` rend l'operation
 * sans effet sur ce qui est deja connu.
 */
export function addedEntries(oldValue, newValue) {
  const avant = readHistory(oldValue);
  const apres = readHistory(newValue);
  const out = [];

  for (const [key, entry] of Object.entries(apres)) {
    if (!entry || !entry.ts) continue;
    const ancien = avant[key];
    // Meme cle, meme horodatage : rien n'a bouge pour celle-la.
    if (ancien && ancien.ts === entry.ts && ancien.status === entry.status) continue;
    out.push({ key, entry });
  }
  return out;
}

/**
 * Enrichit une entree avec ce que le catalogue sait encore du jeu.
 *
 * C'est ici que se joue tout l'interet du registre : le catalogue a le titre,
 * la valeur et la vignette, et il ne les aura plus dans trente jours.
 */
export function enrich(store, id, catalog) {
  const bare = String(id || '').replace(/^(slug|offer|code):/, '');
  const direct = catalog[`${store}:${bare}`];
  if (direct) return direct;

  // Repli : l'offre peut etre rangee sous sa cle faible (magasin:titre:norme).
  for (const o of Object.values(catalog || {})) {
    if (o && o.store === store && o.storeId === bare) return o;
  }
  return null;
}

/**
 * Integre un lot d'entrees d'historique dans le registre.
 *
 * Rend le registre suivant et le compte de ce qui a change. Un compte de zero
 * sur un lot non vide veut dire que tout etait deja connu -- normal apres un
 * second passage sur la meme page.
 */
export function integrateHistory(library, { platform, added, catalog = {} }) {
  const store = PLATFORM_STORES[platform];
  if (!store) return { library, changed: 0 };

  const next = { ...library };
  let changed = 0;
  /* Ce qui vient d'entrer ou de changer, pour le carnet (2.105.0) : `isNew`
     distingue une prise d'un simple enrichissement, `already` un constat
     (« deja a vous ») d'une vraie reclamation. */
  const touched = [];

  for (const { key, entry } of added) {
    if (!ACQUIRED.includes(entry.status)) continue;

    const known = enrich(store, key, catalog);
    const fresh = makeEntry({
      store,
      id: key,
      /* Le titre que le moteur a lu sur la page, a defaut du catalogue. Une
         offre Luna n'y est presque jamais rangee sous son identifiant opaque :
         sans ce repli, l'entree restait sans titre, et `ownedKeys` -- qui
         ignore les entrees sans titre -- ne pouvait pas empecher de rouvrir un
         onglet sur un jeu deja pris. */
      title: (known && known.title) || entry.title || null,
      url: known ? (known.url || known.resolveUrl) : null,
      worth: known ? known.worth : null,
      image: known ? known.image : null,
      ts: entry.ts,
      status: entry.status,
      wsrc: known ? worthSource(known) : null,
    });

    const k = libraryKey(store, key);
    const merged = mergeEntry(next[k], fresh);
    if (JSON.stringify(merged) === JSON.stringify(next[k])) continue;
    touched.push({ key: k, entry: merged, isNew: !next[k], already: isAlreadyEntry(entry) });
    next[k] = merged;
    changed++;
  }

  return { library: next, changed, touched };
}

/* Un constat « deja a vous » plutot qu'une prise : meme lecture que watch/tally.js
   (alreadyYours), recopiee ici -- tally.js passe par filters.js, qui importe ce
   module. */
const ALREADY_RE = /ALREADY_(OWNED|CLAIMED)|deja marque comme recupere|\(deja reclame\)$/i;
function isAlreadyEntry(entry) {
  return ALREADY_RE.test(String((entry && entry.reason) || ''));
}

/* ---------------------------------------------------------------- lecture */

/**
 * Les entrees Epic « deja possede » ecrites a tort (2.99.7), a effacer.
 *
 * Avant la 2.99.7 le moteur concluait « deja possede » sur n'importe quel
 * « Dans la bibliotheque » de la page -- la carte d'un autre jeu suffisait. Il
 * l'ecrivait `claimed` avec la raison `ALREADY_OWNED` (ou `ALREADY_CLAIMED`),
 * et tout ce qui suivait s'y fiait. On ne distingue pas ici celles qui etaient
 * justes : on les efface TOUTES (les trente derniers jours), car la revue de la
 * fiche les reecrit si elles l'etaient, et une entree `claimed` ordinaire --
 * celle d'une vraie reclamation, qui compte dans le bilan -- n'est jamais touchee.
 *
 * Rend l'historique et le registre sans elles, et les cles retirees. Pure.
 */
export const FALSE_OWNERSHIP_DAYS = 30;
export function falseOwnership(historyValue, library, now) {
  const history = { ...readHistory(historyValue) };
  const lib = { ...(library || {}) };
  const removed = [];
  for (const [key, entry] of Object.entries(history)) {
    if (!entry || entry.status !== 'claimed') continue;
    if (!/^ALREADY_/.test(String(entry.reason || ''))) continue;
    if (!entry.ts || now - entry.ts > FALSE_OWNERSHIP_DAYS * 86400000) continue;
    delete history[key];
    delete lib[libraryKey('epic', key)];
    removed.push(key);
  }
  return { history, library: lib, removed };
}

/** Les titres normalises deja possedes, pour le rapprochement. */
export function ownedTitles(library, normalise) {
  const out = new Map();
  for (const e of Object.values(library || {})) {
    if (!e || !e.title) continue;
    const k = normalise(e.title);
    if (!k) continue;
    // La plus ancienne acquisition fait foi : c'est celle qu'on veut montrer.
    const vu = out.get(k);
    if (!vu || e.ts < vu.ts) out.set(k, e);
  }
  return out;
}

/**
 * Les cles « magasin|titre normalise » de ce qui est deja acquis.
 *
 * Le filtre de reclamation s'en sert pour ne pas rouvrir un onglet sur un jeu
 * qu'on possede. Le MAGASIN fait partie de la cle, et ce n'est pas un detail :
 * posseder un titre sur Epic ne le donne pas sur GOG, et la copie GOG vaut
 * d'etre prise. Confondre les deux ferait rater de vraies offres.
 */
export function ownedKeys(library, normalise) {
  const out = new Set();
  for (const e of Object.values(library || {})) {
    if (!e || !e.title || !e.store) continue;
    if (e.status && !ACQUIRED.includes(e.status)) continue;
    const titre = normalise(e.title);
    if (titre) out.add(`${e.store}|${titre}`);
  }
  return out;
}

/** La cle que `ownedKeys` produit, pour une offre. */
export function ownedKeyFor(store, normalisedTitle) {
  return `${store}|${normalisedTitle}`;
}

/** Le registre, du plus recent au plus ancien. */
export function entries(library) {
  return Object.values(library || {}).sort((a, b) => b.ts - a.ts);
}
