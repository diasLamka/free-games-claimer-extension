/* Source de decouverte : GOG, en propre.
 *
 * POURQUOI ELLE EXISTE. Jusqu'ici, GOG n'etait vu que par l'agregateur tiers.
 * Sa disparition est le premier risque du design (§15), et elle laisserait la
 * veille aveugle sur un des trois magasins que l'extension sait reclamer. Deux
 * sources independantes valent mieux qu'une, meme imparfaites.
 *
 * CE QU'ELLE LIT, ET POURQUOI CELA PLUTOT QUE LA PAGE. Le catalogue filtre par
 * prix, en JSON :
 *
 *     /games/ajax/filtered?mediaType=game&price=free&sort=popularity
 *
 * Mesure du 2026-09-17 (voir docs/superpowers/specs/2026-09-17-v6-v7-constats.md) :
 * l'adresse repond 200 en application/json, avec les cles `products`, `page`,
 * `totalPages`, `totalResults`. La meme requete SANS le filtre rend 7 591
 * octets de vrais produits -- l'endpoint n'est donc pas desaffecte, et une
 * liste vide veut vraiment dire « aucun jeu gratuit en ce moment ».
 *
 * Ce controle n'etait pas une precaution de style. Un endpoint desaffecte qui
 * repond 200 avec une liste vide est le piege parfait : la source repondrait
 * « rien » eternellement SANS JAMAIS ECHOUER, donc sans declencher ni le
 * canari, ni le recul, ni la sentinelle. Le mode d'echec silencieux que tout
 * ce projet combat.
 *
 * Le JSON plutot que le HTML, enfin, parce qu'un schema change quand le
 * service change, tandis qu'une classe CSS change quand un designer passe --
 * et parce que la page d'accueil pese 953 Ko contre quelques-uns ici.
 *
 * CE QU'ELLE NE VOIT PAS, ET IL FAUT LE DIRE. Un giveaway GOG s'annonce aussi
 * par une banniere sur la page d'accueil. Aucun giveaway ne tournait au moment
 * de la mesure -- ni element de classe `giveaway`, ni structure de donnees du
 * meme nom -- donc son balisage n'a PAS pu etre observe. Ecrire des selecteurs
 * sans les avoir vus est precisement ce que ROADMAP.md interdit. Si un
 * giveaway apparait sans passer par ce catalogue, l'agregateur le verra, et le
 * journal montrera lequel des deux a parle.
 *
 * Module pur, sauf `discover` qui recoit son `fetch`.
 */
import { makeOffer, STORES } from '../offer.js';
import { describeFetchFailure } from '../net.js';

export const NAME = 'gog';

export const ORIGIN = 'https://www.gog.com';

/**
 * Le filtre du catalogue.
 *
 * `mediaType=game` ecarte les films, que GOG vend aussi et que l'extension ne
 * sait pas reclamer. `price=free` fait le tri cote serveur : demander tout le
 * catalogue pour filtrer ici couterait des centaines de kilo-octets par cycle.
 */
export const FILTERED_URL = `${ORIGIN}/games/ajax/filtered?mediaType=game&price=free&sort=popularity`;

/* ------------------------------------------------------------------ prix */

/** Un montant GOG arrive en chaine (« 3.99 ») : on le lit en nombre, ou null. */
function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ce que le bloc `price` dit d'une offre.
 *
 * La distinction qui compte est celle que la 2.12.0 a etablie pour Epic, et
 * elle se transpose exactement :
 *
 *   baseAmount > 0 et finalAmount === 0  ->  un jeu payant, offert un temps
 *   baseAmount === 0                     ->  gratuit de toute facon
 *
 * Le second n'a rien a reclamer, et l'ouvrir couterait un onglet et une
 * requete sur un vrai compte pour un titre que tout le monde possede deja.
 *
 * `worth` porte la DEVISE, jamais un nombre nu : GOG localise ses prix cote
 * serveur (`currencyCode=EUR` sur un compte francais), et un montant sans
 * devise serait relu plus tard par quelqu'un qui devrait supposer -- c'est
 * exactement le bug de devise corrige en 2.14.0.
 */
export function readPrice(price) {
  if (!price || typeof price !== 'object') return { worth: null, keepable: null };

  const base = amount(price.baseAmount);
  const final = amount(price.finalAmount ?? price.amount);
  const currency = typeof price.currency === 'string' ? price.currency.trim() : '';

  if (base === null || final === null) return { worth: null, keepable: null };
  if (base <= 0) return { worth: null, keepable: false };

  return {
    worth: currency ? `${price.baseAmount} ${currency}` : String(price.baseAmount),
    keepable: final === 0,
  };
}

/* ------------------------------------------------------------- projection */

/** Les URL de GOG arrivent sans protocole (`//images-3.gog-statics.com/...`). */
function absolute(url, base) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const v = url.trim();
  if (v.startsWith('//')) return `https:${v}`;
  if (v.startsWith('/')) return `${base}${v}`;
  return v;
}

/**
 * Un produit brut devient une Offre, ou est ecarte avec un motif.
 *
 * Ecarte, jamais perdu en silence : une entree qu'on ne sait pas lire est un
 * signal que l'API a change, et ce signal doit remonter au journal.
 */
export function mapProduct(raw, now) {
  if (!raw || typeof raw !== 'object') {
    return { skippedItem: { reasonText: 'entree non exploitable', raw } };
  }

  // Le titre arrive parfois avec une espace de tete -- observe tel quel dans
  // la capture du 2026-09-17.
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) return { skippedItem: { reasonText: 'titre absent', id: raw.id ?? null } };

  if (raw.isMovie === true || raw.isGame === false) {
    return { skippedItem: { reasonText: 'ce n\'est pas un jeu', title, id: raw.id ?? null } };
  }
  if (raw.isComingSoon === true) {
    return { skippedItem: { reasonText: 'pas encore sorti', title, id: raw.id ?? null } };
  }
  /* `isAvailable` a false veut dire que la fiche existe mais que le produit ne
     s'obtient pas : ouvrir un onglet dessus ne peut rien donner. */
  if (raw.availability && raw.availability.isAvailable === false) {
    return { skippedItem: { reasonText: 'indisponible', title, id: raw.id ?? null } };
  }

  const url = absolute(raw.url, ORIGIN);
  if (!url) return { skippedItem: { reasonText: 'aucune page a ouvrir', title, id: raw.id ?? null } };

  const { worth, keepable } = readPrice(raw.price);

  /* La fin de la promotion, quand GOG la publie : `salesVisibility.to` est en
     SECONDES, comme `from`. Lue en millisecondes, une offre qui se termine
     dans trois jours paraitrait expiree depuis 1970 -- et le catalogue la
     rangerait aussitot parmi les offres terminees. */
  const to = raw.salesVisibility && Number(raw.salesVisibility.to);
  const end = Number.isFinite(to) && to > 0 ? to * 1000 : null;

  const offer = makeOffer({
    source: NAME,
    sourceId: raw.id,
    store: STORES.GOG,
    storeId: raw.slug || null,
    title,
    url,
    end,
    worth,
    keepable,
    image: absolute(raw.boxImage || raw.image, ORIGIN),
    category: raw.category || null,
    seenAt: now,
    updatedAt: now,
  });

  return { offer };
}

/**
 * La reponse dit-elle elle-meme qu'elle tient sur une seule page ?
 *
 * C'est la question qui decide si une absence veut dire quelque chose. GOG
 * publie `page` et `totalPages` a la racine : plutot que de deviner le nom du
 * parametre de pagination pour aller chercher les pages suivantes, on le
 * CROIT quand il annonce une page unique, et on ne conclut rien quand il en
 * annonce plusieurs.
 *
 * Prudent par construction : une reponse qui ne porte pas ces deux champs, ou
 * qui n'est pas a la page 1, n'est PAS declaree complete. Ne rien savoir et
 * croire savoir ne se ressemblent que de loin.
 *
 * `totalPages: 0` est une reponse reellement observee le 2026-09-17 (aucun jeu
 * gratuit ce jour-la) : zero page vaut bien une liste complete, elle est vide.
 * A noter, parce que cela mord : `totalResults` arrive en CHAINE la ou
 * `totalGamesFound` est un nombre -- d'ou la lecture par Number().
 */
export function announcesSinglePage(data) {
  if (!data || typeof data !== 'object') return false;
  const page = Number(data.page);
  const totalPages = Number(data.totalPages);
  if (!Number.isFinite(page) || page !== 1) return false;
  if (!Number.isFinite(totalPages)) return false;
  return totalPages <= 1;
}

/**
 * Projette une reponse complete. Deduplique sur l'identifiant produit : rien
 * ne garantit que l'API ne repete jamais une entree, et un doublon ferait
 * ouvrir deux onglets pour le meme jeu.
 */
export function mapResponse(data, now) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
    return { offers: [], dropped: [], erreur: 'la reponse ne porte pas de tableau « products »', complete: false };
  }

  const offers = [];
  const dropped = [];
  const seen = new Set();

  for (const raw of data.products) {
    const { offer, skippedItem } = mapProduct(raw, now);
    if (skippedItem) { dropped.push(skippedItem); continue; }

    const key = offer.sourceId || offer.storeId || offer.normalisedTitle;
    if (seen.has(key)) {
      dropped.push({ reasonText: 'doublon dans la reponse', title: offer.title, id: offer.sourceId });
      continue;
    }
    seen.add(key);
    offers.push(offer);
  }

  return { offers, dropped, erreur: null, complete: announcesSinglePage(data) };
}

/* -------------------------------------------------------------- decouverte */

/**
 * Interroge le catalogue. Ne jette jamais : une source en panne doit degrader
 * la veille, pas l'arreter.
 */
export async function discover({
  fetch: fetchImpl = fetch,
  now = Date.now(),
  url = FILTERED_URL,
  timeoutMs = 15000,
} = {}) {
  const errors = [];
  const stopwatch = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = stopwatch ? setTimeout(() => stopwatch.abort(), timeoutMs) : null;
  const pourquoi = (e, label) => describeFetchFailure(e, { timeoutMs, label, signal: stopwatch ? stopwatch.signal : undefined });

  try {
    const response = await fetchImpl(url, {
      /* Sans les cookies, et c'est un choix.
       *
       * Connecte, GOG personnalise le catalogue -- il masque notamment ce que
       * le compte possede deja. La veille verrait alors disparaitre une offre
       * simplement parce qu'elle a ete reclamee, et `completeList` la
       * traiterait comme terminee. Une lecture anonyme rend toujours la meme
       * liste a tout le monde, ce qui est la seule chose sur laquelle un
       * rapprochement peut se fonder. */
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: stopwatch ? stopwatch.signal : undefined,
    });

    if (!response.ok) {
      return { offers: [], dropped: [], errors: [`HTTP ${response.status}`], complete: false };
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      /* Meme piege que chez l'agregateur : notre propre abandon remonte ici,
         les en-tetes deja recues et le corps non. Voir watch/net.js. */
      return { offers: [], dropped: [], errors: [pourquoi(e, 'JSON illisible')], complete: false };
    }

    const { offers, dropped, erreur, complete } = mapResponse(data, now);
    if (erreur) errors.push(erreur);
    /* `complete` remonte au cycle, qui decide alors s'il peut conclure a des
       disparitions. Le jour ou GOG rend `totalPages > 1`, la veille cesse
       d'elle-meme d'en conclure, et le journal le dit -- c'est cette ligne de
       journal qui fournira la mesure que ROADMAP.md reclamait, au lieu de
       l'attendre. */
    return { offers, dropped, errors, complete };
  } catch (e) {
    return { offers: [], dropped: [], errors: [pourquoi(e)], complete: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
