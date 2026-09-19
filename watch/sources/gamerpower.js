/* Source de decouverte : l'API publique gamerpower.com.
 *
 * C'est la source large : une seule requete couvre toutes les boutiques, y
 * compris celles pour lesquelles nous n'avons aucun adaptateur propre. Elle
 * dit QUOI est gratuit et QUAND l'offre a ete publiee.
 *
 * Elle ne dit jamais OU. Verifie le 2026-08-27 : le champ open_giveaway_url
 * pointe sur une redirection gamerpower.com/open/<slug> qui repond 403 a toute
 * requete hors navigateur -- User-Agent Chrome et Referer corrects compris. La
 * page d'offre elle-meme ne contient aucun lien externe vers le magasin.
 * L'URL du magasin ne s'obtient donc qu'en ouvrant un vrai onglet, ce que fait
 * l'etape de resolution (vague V3). Ici, on se contente de porter l'URL a
 * ouvrir dans le champ urlResolution.
 */
import { makeOffer, detectStore, STORES } from '../offer.js';
import { describeFetchFailure } from '../net.js';

export const NAME = 'gamerpower';

export const API_URL = 'https://www.gamerpower.com/api/giveaways';

/**
 * L'API ecrit ses horodatages sans indication de fuseau ("2026-08-26 21:23:06").
 * Ils sont en heure de New York, pas en UTC.
 *
 * Etabli le 2026-08-27 en recoupant nos deux captures reelles : l'API Epic
 * ouvre Cardpocalypse a 2026-08-20T15:00:00Z, l'agregateur le publie a
 * "2026-08-20 11:02:34". Lu en UTC, cela placerait la publication quatre
 * heures avant l'ouverture de l'offre. Lu en heure de New York, deux minutes
 * et demie apres le drop.
 */
export const DATE_ZONE = 'America/New_York';

/** Une seule requete suffit : le budget de decouverte est negligeable. */
export function buildUrl({ type = 'game' } = {}) {
  const u = new URL(API_URL);
  if (type) u.searchParams.set('type', type);
  return u.toString();
}

/* ------------------------------------------------------------- projection */

/**
 * Une entree brute de l'API devient une Offre, ou est ecartee avec un motif.
 *
 * Ecartee, jamais perdue en silence : une entree qu'on ne sait pas lire est un
 * signal que l'API a change, et ce signal doit remonter au journal.
 */
export function mapEntry(raw, now) {
  if (!raw || typeof raw !== 'object') {
    return { skippedItem: { reasonText: 'entree non exploitable', raw } };
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) {
    return { skippedItem: { reasonText: 'titre absent', id: raw.id ?? null } };
  }

  // "Active" est la seule valeur observee, mais l'API expose le champ : une
  // offre expiree ou suspendue ne doit pas entrer dans le catalogue comme si
  // elle courait.
  if (raw.status && String(raw.status).toLowerCase() !== 'active') {
    return { skippedItem: { reasonText: `statut "${raw.status}"`, title, id: raw.id ?? null } };
  }

  const resolveUrl = raw.open_giveaway_url || raw.open_giveaway || raw.gamerpower_url || null;
  if (!resolveUrl) {
    return { skippedItem: { reasonText: 'aucune URL a ouvrir', title, id: raw.id ?? null } };
  }

  const offer = makeOffer({
    source: NAME,
    sourceId: raw.id,
    title,
    platforms: raw.platforms || null,
    category: raw.type || null,
    // published_date est la vraie heure de mise en ligne, pas l'heure ou nous
    // avons regarde : c'est elle qui affranchit la statistique horaire du biais
    // d'observation. Encore faut-il la lire dans le bon fuseau.
    naiveDateZone: DATE_ZONE,
    start: raw.published_date,
    end: raw.end_date,
    worth: raw.worth && raw.worth !== 'N/A' ? raw.worth : null,
    // thumbnail est la petite vignette, image la grande. Le popup affiche des
    // tuiles de 56 px : la petite suffit et coute dix fois moins cher.
    image: raw.thumbnail || raw.image || null,
    resolveUrl,
    seenAt: now,
    updatedAt: now,
  });

  return { offer };
}

/**
 * Projette une reponse complete. Deduplique sur idSource : rien ne garantit
 * que l'API ne repete jamais une entree, et une offre en double ferait ouvrir
 * deux onglets pour le meme jeu.
 */
export function mapResponse(data, now) {
  if (!Array.isArray(data)) {
    return { offers: [], dropped: [], erreur: 'la reponse n\'est pas un tableau' };
  }

  const offers = [];
  const dropped = [];
  const seenKeys = new Set();

  for (const raw of data) {
    const { offer, skippedItem } = mapEntry(raw, now);
    if (skippedItem) { dropped.push(skippedItem); continue; }

    const key = offer.sourceId || offer.normalisedTitle;
    if (seenKeys.has(key)) {
      dropped.push({ reasonText: 'doublon dans la reponse', title: offer.title, id: offer.sourceId });
      continue;
    }
    seenKeys.add(key);
    offers.push(offer);
  }

  return { offers, dropped, erreur: null };
}

/* -------------------------------------------------------------- decouverte */

/**
 * Interroge l'API. Ne jette jamais : une source en panne doit degrader la
 * veille, pas l'arreter.
 *
 * Vingt secondes, comme la source Steam. C'etait quinze, et trois expirations
 * d'affilee ont endormi la source -- alors qu'une relance sept secondes plus
 * tard rendait bien ses vingt offres. Le CDN est parfois lent, pas casse.
 */
export async function discover({
  fetch: fetchImpl = fetch,
  now = Date.now(),
  url = buildUrl(),
  timeoutMs = 20000,
} = {}) {
  const errors = [];
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), timeoutMs) : null;
  const signal = stopwatch ? stopwatch.signal : undefined;
  const pourquoi = (e, label) => describeFetchFailure(e, { timeoutMs, signal, label });

  try {
    const response = await fetchImpl(url, {
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal,
    });

    if (!response.ok) {
      return { offers: [], dropped: [], errors: [`HTTP ${response.status}`] };
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      /* L'abandon de NOTRE minuteur remonte ici, pas dans le catch exterieur :
         les en-tetes etaient arrivees, le corps non. Le dire « JSON illisible »
         accusait l'API d'avoir change de format -- voir watch/net.js. */
      return { offers: [], dropped: [], errors: [pourquoi(e, 'JSON illisible')] };
    }

    const { offers, dropped, erreur } = mapResponse(data, now);
    if (erreur) errors.push(erreur);
    return { offers, dropped, errors };
  } catch (e) {
    return { offers: [], dropped: [], errors: [pourquoi(e)] };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ----------------------------------------------------------------- filtres */

/**
 * Les offres dont le magasin reste inconnu ne sont reclamables par aucun de
 * nos modules : mobile, VR, sites a compte et formulaire. Elles restent au
 * catalogue et notifiables, mais ne rejoignent jamais la file de reclamation.
 */
export function isClaimable(offer) {
  return Boolean(offer) && offer.store !== STORES.UNKNOWN;
}

/** Re-detecte le magasin apres resolution, quand l'URL reelle est connue. */
export function redetectStore(offer, resolvedUrl) {
  return detectStore({
    title: offer.title,
    platforms: offer.platforms,
    url: resolvedUrl,
  });
}
