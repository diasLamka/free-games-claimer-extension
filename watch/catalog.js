/* Le catalogue : ce que la veille sait des offres, dans le temps.
 *
 * Il repond a trois questions que les sources ne savent pas traiter seules :
 *   - deux sources annoncent le meme jeu : c'est une offre, pas deux ;
 *   - une offre deja vue revient : ce n'est pas une nouveaute a notifier ;
 *   - une offre disparait de l'API sans avoir expire : que devient-elle ?
 *
 * Module pur. Il ne lit ni n'ecrit rien : il prend un catalogue, rend le
 * suivant. La persistance est le probleme de la couche de stockage, et cette
 * separation est ce qui rend tout ceci testable sans navigateur.
 */
import {
  STATES,
  strongKey,
  weakKey,
  matchKeys,
  merge,
  isExpired,
} from './offer.js';

/** Etats depuis lesquels une offre ne bouge plus. */
const TERMINAL_STATES = new Set([STATES.RESOLVED, STATES.EXPIRED]);

/**
 * Delai de grace avant de considerer comme finie une offre qui a disparu de
 * sa source sans date de fin. Deux cycles de veille suffisent a distinguer un
 * hoquet de l'API d'un retrait reel.
 */
export const VANISH_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Grace accordee quand c'est la source DU MAGASIN, complete et credible, qui
 * ne publie plus l'offre.
 *
 * Zero ne veut pas dire "tout de suite" : le premier passage pose
 * `missingSince` et ne termine rien, donc il faut deux constats successifs.
 * Le doute que les 24 h couvrent -- un hoquet de l'API, une liste tronquee --
 * est deja ecarte ici par `completeList` et par le controle de credibilite du
 * cycle. Attendre un jour de plus, c'est afficher le vendredi les jeux de
 * jeudi : exactement ce qui a ete signale le 2026-09-18.
 */
export const STORE_VANISH_DELAY_MS = 0;

/** Duree de conservation d'une entree terminee. */
export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Index de toutes les cles vers la cle de rangement de leur entree. Evite de
 * reparcourir le catalogue pour chaque offre entrante.
 */
export function indexBy(catalog) {
  const index = new Map();
  for (const [catalogKey, entry] of Object.entries(catalog || {})) {
    for (const k of matchKeys(entry)) {
      if (!index.has(k)) index.set(k, catalogKey);
    }
  }
  return index;
}

/** Cle de rangement d'une offre nouvelle : la plus forte disponible. */
export function storageKey(offer) {
  return strongKey(offer) || weakKey(offer);
}

/**
 * Integre les offres d'un cycle de decouverte.
 *
 * `source`        identifiant de la source qui a produit cette liste
 * `listeComplete` true si la liste represente TOUT ce que la source annonce.
 *                 Dans ce cas, une entree de cette source absente de la liste
 *                 est notee disparue -- c'est ainsi qu'on rattrape les offres
 *                 retirees sans date de fin.
 *
 * Rend le nouveau catalogue et le detail de ce qui a bouge. Les nouveautes
 * sont ce que l'appelant notifiera : une offre deja connue ne redeclenche
 * jamais de notification, meme si elle reapparait dans chaque reponse.
 */
export function integrate(catalog, offers, {
  now, source = null, completeList = false, store = null,
} = {}) {
  if (typeof now !== 'number') throw new TypeError('integrer : "maintenant" est obligatoire');

  const next = { ...(catalog || {}) };
  const index = indexBy(next);

  const freshOffers = [];
  const updates = [];
  const skipped = [];
  const seenThisCycle = new Set();

  for (const offer of offers || []) {
    const keys = matchKeys(offer);
    if (!keys.length) {
      skipped.push({ reasonText: 'offre sans cle exploitable', title: offer && offer.title });
      continue;
    }

    let catalogKey = null;
    for (const k of keys) {
      if (index.has(k)) { catalogKey = index.get(k); break; }
    }

    if (catalogKey) {
      const merged = merge(next[catalogKey], { ...offer, updatedAt: now });
      // Une entree qui reapparait n'est plus disparue.
      delete merged.missingSince;

      /*
       * Une offre EXPIREE que la source republie comme active revient a la vie.
       *
       * Sans cela, un jeu remis en promotion sur le meme identifiant restait
       * invisible pour toujours : markExpired saute les etats terminaux et
       * merge conserve l'etat existant. C'est le defaut symetrique de celui
       * qu'on corrige avec la rotation hebdomadaire -- il masquerait les
       * nouveautes du jeudi tout en laissant les anciennes a l'ecran.
       *
       * RESOLVED, lui, reste terminal : un jeu deja reclame l'est pour de bon,
       * et le proposer a nouveau ferait rouvrir un onglet sur un compte reel.
       */
      if (merged.state === STATES.EXPIRED && !isExpired(merged, now)) {
        merged.state = STATES.DISCOVERED;
        merged.verdict = null;
        merged.seen = false;
      }
      merged.catalogKey = catalogKey;
      next[catalogKey] = merged;
      updates.push(merged);
      for (const k of matchKeys(merged)) if (!index.has(k)) index.set(k, catalogKey);
      seenThisCycle.add(catalogKey);
      continue;
    }

    const incoming = storageKey(offer);
    const entry = {
      ...offer,
      catalogKey: incoming,
      seenAt: offer.seenAt ?? now,
      updatedAt: now,
    };
    next[incoming] = entry;
    freshOffers.push(entry);
    for (const k of matchKeys(entry)) index.set(k, incoming);
    seenThisCycle.add(incoming);
  }

  const vanished = completeList && source
    ? noteVanished(next, { now, source, store, seenThisCycle })
    : [];

  const expired = markExpired(next, now);

  return { catalog: next, freshOffers, updates, vanished, expired, skipped };
}

/**
 * Marque les entrees d'une source absentes de sa derniere liste complete, et
 * termine celles absentes depuis assez longtemps.
 *
 * Une offre qui a une date de fin n'est pas concernee : sa disparition de
 * l'API est normale une fois la date passee, et c'est marquerExpirees qui
 * tranche. Ce mecanisme ne sert qu'aux offres sans date de fin -- 8 sur 20
 * dans la capture reelle.
 */
export function noteVanished(catalog, { now, source, store = null, seenThisCycle }) {
  const vanished = [];

  for (const [catalogKey, entry] of Object.entries(catalog)) {
    /*
     * Deux titres a balayer une entree, et ils n'ont pas le meme poids.
     *
     * Par SOURCE : la regle d'origine. Elle rate les entrees dont `merge` a
     * fige le champ `source` a celui de la premiere source qui les a vues --
     * un jeu Epic decouvert par l'agregateur garde `source: 'gamerpower'`.
     *
     * Par MAGASIN : quand la source fait autorite sur ce magasin, son absence
     * de la liste est un fait sur la PROMOTION, pas sur la source qui l'a
     * decouverte. C'est ce titre-la qui rattrape les offres du jeudi restees
     * a l'ecran le vendredi.
     */
    const bySource = entry.source === source;
    const byStore = Boolean(store) && entry.store === store;
    if (!bySource && !byStore) continue;
    if (seenThisCycle.has(catalogKey)) continue;
    if (TERMINAL_STATES.has(entry.state)) continue;
    if (entry.end !== null && entry.end !== undefined) continue;

    if (!entry.missingSince) {
      catalog[catalogKey] = { ...entry, missingSince: now };
      continue;
    }

    /*
     * La grace longue vaut pour un doute sur la liste. Quand la source du
     * MAGASIN publie une liste complete et jugee credible, il n'y a plus de
     * doute a couvrir : deux constats successifs suffisent, et `0` veut dire
     * exactement cela -- pas "tout de suite", mais "au cycle suivant", le
     * premier passage ayant pose `missingSince`.
     *
     * MAIS SEULEMENT SI LE MAGASIN L'A PUBLIEE, et c'est la nuance qui manquait.
     *
     * Une entree decouverte par l'agregateur et marquee `store: 'gog'` n'a pas
     * de `storeId` : elle n'est rapprochee que par titre normalise. Si son
     * titre differe d'une virgule de celui du catalogue, elle reste une entree
     * DISTINCTE -- et un magasin autoritaire la tuerait au deuxieme cycle
     * alors que l'offre court toujours. Meme chose pour un giveaway annonce
     * par la seule banniere d'accueil, que le catalogue filtre ne porte pas.
     *
     * Le `storeId` est la preuve que le magasin a publie cette offre sous
     * cette identite : son absence de la liste complete veut alors dire
     * quelque chose. Sans lui, le silence du magasin prouve beaucoup moins, et
     * la grace longue reprend ses droits.
     */
    const publishedByStore = Boolean(entry.storeId);
    const grace = byStore && publishedByStore ? STORE_VANISH_DELAY_MS : VANISH_DELAY_MS;

    if (now - entry.missingSince >= grace) {
      catalog[catalogKey] = {
        ...entry,
        state: STATES.EXPIRED,
        verdict: entry.verdict || 'disparue de la source',
        updatedAt: now,
      };
      vanished.push(catalog[catalogKey]);
    }
  }

  return vanished;
}

/** Passe en EXPIREE tout ce dont la date de fin est derriere nous. */
export function markExpired(catalog, now) {
  const expired = [];
  for (const [catalogKey, entry] of Object.entries(catalog)) {
    if (TERMINAL_STATES.has(entry.state)) continue;
    if (!isExpired(entry, now)) continue;
    catalog[catalogKey] = { ...entry, state: STATES.EXPIRED, updatedAt: now };
    expired.push(catalog[catalogKey]);
  }
  return expired;
}

/**
 * Retire les entrees terminees depuis assez longtemps.
 *
 * Rien qui soit encore en cours n'est purge, quelle que soit son anciennete :
 * une offre bloquee depuis trois mois sur "compte a associer" est un probleme
 * a montrer, pas a effacer.
 */
export function purgeExpired(catalog, { now, retentionMs = RETENTION_MS } = {}) {
  const next = {};
  const removed = [];

  for (const [catalogKey, entry] of Object.entries(catalog || {})) {
    const finishedOne = TERMINAL_STATES.has(entry.state);
    const age = now - (entry.updatedAt ?? entry.seenAt ?? now);
    if (finishedOne && age >= retentionMs) {
      removed.push(entry);
      continue;
    }
    next[catalogKey] = entry;
  }

  return { catalog: next, removed };
}

/* -------------------------------------------------------------- lectures */

/**
 * Les offres encore ouvertes, dans l'ordre ou il faut s'en occuper.
 *
 * `now` compte : l'etat EXPIRED n'est pose qu'au passage d'un cycle, et entre
 * la rotation du jeudi 17 h et le cycle suivant le catalogue porte encore
 * l'etat d'avant. Sans consulter l'horloge, le badge comptait des offres
 * terminees -- le popup, lui, filtrait deja sur `end`, d'ou l'ecart entre les
 * deux. La regle vit dans `isExpired`, et nulle part ailleurs.
 */
export function openOffers(catalog, now) {
  // L'instant est OBLIGATOIRE, comme pour integrer : ce module est pur, et une
  // valeur par defaut a Date.now() ferait rentrer l'horloge par la fenetre.
  if (typeof now !== 'number') throw new TypeError('enCours : "maintenant" est obligatoire');
  return Object.values(catalog || {})
    .filter((e) => !TERMINAL_STATES.has(e.state))
    .filter((e) => !isExpired(e, now));
}

/** Compte par etat, pour le tableau de bord et le journal. */
export function resume(catalog) {
  const count = {};
  for (const entry of Object.values(catalog || {})) {
    count[entry.state] = (count[entry.state] || 0) + 1;
  }
  return count;
}
