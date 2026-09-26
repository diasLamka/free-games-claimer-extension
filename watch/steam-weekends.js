/* Les week-ends gratuits de Steam (2.75.0).
 *
 * Steam ouvre regulierement un jeu payant a tous, quelques jours : « Free
 * Weekend », « Play for free until Sep 28 ». Rien a garder -- le jeu repart a
 * la fin --, donc rien que l'extension doive reclamer, et c'est pourquoi la
 * source Steam les ignore (`is_free_to_keep` faux). Mais c'est exactement ce
 * qu'on aime savoir le vendredi soir : de quoi essayer, et souvent en promo si
 * on veut le garder.
 *
 * CE QUI EST MESURE (2026-09-26, deux week-ends en cours : Squad et Ship
 * Graveyard Simulator) :
 *
 *   - la page d'accueil du magasin declare ses jeux dans
 *     `GStoreItemData.AddStoreItemDataSet({"rgApps": {...}})`, et chacun des
 *     deux y porte `"free_weekend": true` et un texte « Play for free until
 *     Sep 28 @ 10:00am ». La page de recherche, elle, ne les marque pas ;
 *     `api/featuredcategories` ne montre que celui mis en avant (Squad) ;
 *   - `IStoreBrowseService/GetItems` -- deja lu par la source Steam -- rend
 *     pour eux `free_weekend: { start_time, end_time }` en secondes, et rien
 *     pour un free-to-play (Counter-Strike 2) ni pour un jeu ordinaire.
 *
 * D'ou deux lectures : la page d'accueil DESIGNE les candidats, GetItems
 * CONFIRME et date. La page d'accueil pese pres d'1 Mo : elle n'est relue que
 * toutes les six heures, sans cookies, et seulement si Steam est suivi.
 *
 * Module pur, sauf `refreshWeekends`, qui recoit son `fetch`.
 */
import { itemsUrl, steamImage } from './sources/steam.js';

/** Ce qui a ete lu : { at, items: [...], errors }. Espace de la veille. */
export const KEY_WEEKENDS = 'veille:steam-weekends';

/** La page d'accueil, anonyme. */
export const HOME_URL = 'https://store.steampowered.com/';

/** Une lecture toutes les six heures : un week-end dure trois ou quatre jours. */
export const REFRESH_MS = 6 * 3600 * 1000;

/** Apres un echec, on retente dans une heure -- sans effacer ce qu'on savait. */
export const RETRY_MS = 3600 * 1000;

/** Au-dela, la page n'est pas celle qu'on attend : on ne la parcourt pas. */
const MAX_HTML = 5 * 1024 * 1024;

/** L'objet JSON qui commence a `debut`, accolades comptees hors des chaines. */
function objetJson(texte, debut) {
  const i = texte.indexOf('{', debut);
  if (i < 0) return null;
  let profondeur = 0;
  let chaine = false;
  let echappe = false;
  for (let k = i; k < texte.length; k++) {
    const c = texte[k];
    if (chaine) {
      if (echappe) echappe = false;
      else if (c === '\\') echappe = true;
      else if (c === '"') chaine = false;
    } else if (c === '"') chaine = true;
    else if (c === '{') profondeur++;
    else if (c === '}') {
      profondeur--;
      if (profondeur === 0) return texte.slice(i, k + 1);
    }
  }
  return null;
}

/**
 * Les appids que la page d'accueil marque `free_weekend`. Chaque appel a
 * `AddStoreItemDataSet` est lu comme du JSON ; un bloc illisible est saute,
 * jamais devine.
 */
export function weekendCandidates(html) {
  const texte = String(html || '');
  if (texte.length > MAX_HTML) return [];
  const ids = new Set();
  const APPEL = 'GStoreItemData.AddStoreItemDataSet(';
  let i = texte.indexOf(APPEL);
  while (i >= 0) {
    const bloc = objetJson(texte, i + APPEL.length);
    if (bloc) {
      try {
        const apps = (JSON.parse(bloc) || {}).rgApps || {};
        for (const [appid, app] of Object.entries(apps)) {
          if (/^\d{1,10}$/.test(appid) && app && app.free_weekend === true) ids.add(appid);
        }
      } catch { /* bloc illisible : on passe au suivant */ }
    }
    i = texte.indexOf(APPEL, i + APPEL.length);
  }
  return [...ids];
}

/**
 * Un jeu de GetItems en week-end gratuit, ou null. Les dates viennent de
 * `free_weekend`, en secondes ; un week-end fini ne sort pas.
 */
export function mapWeekend(item, now) {
  const fw = item && item.free_weekend;
  const end = fw && Number(fw.end_time) > 0 ? Number(fw.end_time) * 1000 : null;
  if (!end || end <= now) return null;
  const start = Number(fw.start_time) > 0 ? Number(fw.start_time) * 1000 : null;
  const appid = String(item.appid || item.id || '');
  if (!/^\d+$/.test(appid)) return null;
  const achat = item.best_purchase_option || {};
  const texte = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);
  const remise = Number(achat.discount_pct);
  return {
    appid,
    title: String(item.name || `Application ${appid}`).slice(0, 120),
    url: item.store_url_path ? `https://store.steampowered.com/${item.store_url_path}` : `https://store.steampowered.com/app/${appid}/`,
    image: steamImage(item.assets),
    start,
    end,
    /* Le prix si on veut le garder apres l'essai : souvent en promotion
       pendant le week-end (Ship Graveyard Simulator a -93 % le 2026-09-26). */
    price: texte(achat.formatted_final_price),
    originalPrice: texte(achat.formatted_original_price),
    discount: Number.isFinite(remise) && remise > 0 && remise < 100 ? remise : null,
  };
}

/** Faut-il relire ? Jamais lu, lu il y a plus de six heures -- et pas juste apres un echec. */
export function weekendsDue(stored, now) {
  if (stored && typeof stored.failedAt === 'number' && now - stored.failedAt < RETRY_MS) return false;
  return !stored || typeof stored.at !== 'number' || now - stored.at >= REFRESH_MS;
}

/**
 * Ce qu'il faut ecrire apres une lecture. Un echec garde la liste connue et
 * note l'heure ; une reussite -- meme vide -- remplace tout.
 */
export function nextWeekends(previous, result) {
  if (result.failed) return { ...(previous || { items: [] }), failedAt: result.at, errors: result.errors };
  return { at: result.at, items: result.items, errors: result.errors };
}

/** Ce qui est encore ouvert, le plus proche de sa fin d'abord. */
export function openWeekends(stored, now) {
  const items = stored && Array.isArray(stored.items) ? stored.items : [];
  return items.filter((w) => w && typeof w.end === 'number' && w.end > now).sort((a, b) => a.end - b.end);
}

/**
 * Lit la page d'accueil, puis GetItems pour les candidats. Ne jette jamais :
 * un echec rend la liste vide et dit pourquoi dans `errors`.
 */
export async function refreshWeekends({ fetch: fetchImpl = fetch, now = Date.now(), timeoutMs = 20000 } = {}) {
  const errors = [];
  const arret = typeof AbortController === 'function' ? new AbortController() : null;
  const minuterie = arret ? setTimeout(() => arret.abort(), timeoutMs) : null;
  const signal = arret ? arret.signal : undefined;
  try {
    const page = await fetchImpl(HOME_URL, { credentials: 'omit', signal });
    if (!page.ok) return { at: now, items: [], errors: [`accueil : HTTP ${page.status}`], failed: true };
    const ids = weekendCandidates(await page.text());
    if (!ids.length) return { at: now, items: [], errors };

    const r = await fetchImpl(itemsUrl(ids.slice(0, 50)), { credentials: 'omit', headers: { Accept: 'application/json' }, signal });
    if (!r.ok) return { at: now, items: [], errors: [`items : HTTP ${r.status}`], failed: true };
    const data = await r.json();
    const liste = (data && data.response && data.response.store_items) || [];
    const items = liste.map((it) => mapWeekend(it, now)).filter(Boolean);
    if (items.length < ids.length) errors.push(`${ids.length - items.length} candidat(s) sans week-end confirme`);
    return { at: now, items, errors };
  } catch (e) {
    return { at: now, items: [], errors: [String((e && e.message) || e)], failed: true };
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}
