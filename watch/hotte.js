/* La hotte : les codes en double deviennent un stock a offrir.
 *
 * Un code Humble, GOG ou Luna pour un jeu qu'on a deja se perd aujourd'hui : il reste dans la liste « a echanger » jusqu'a
 * expiration, ou le moteur l'echange pour rien. Ici, il se range a part -- avec un QR code qu'un ami scanne, et la mention
 * « donne » quand c'est fait.
 *
 * TROIS REGLES.
 *
 *  1. UN CODE EST UN PORTEUR : celui qui le lit s'en sert. La hotte vit dans la cle `veille:hotte`, sur cette machine, et
 *     dans AUCUNE liste de sauvegarde (complete, automatique, synchronisee), ni dans le relais, ni dans une alerte. Le QR
 *     ne sert qu'a l'ecran, quand on le demande : il n'est jamais enregistre.
 *  2. RANGER, C'EST DEPLACER. Le code quitte la liste « a echanger » : le moteur ne peut donc plus l'echanger lui-meme
 *     pendant qu'on le garde pour un autre. « Reprendre » le remet dans la liste.
 *  3. LE REPERAGE DIT « PROBABLEMENT », JAMAIS PLUS. Un code est signale « deja a vous » quand son jeu est dans le registre
 *     ou dans la collection importee DU MEME MAGASIN, titre normalise egal. Un code saisi a la main n'a pas de titre : il ne
 *     peut etre range que par un geste de l'utilisateur.
 *
 * Module pur : aucune API d'extension, aucune horloge implicite.
 */
import { sanitiseCollection } from './collection.js';
import { ownedKeys, ownedKeyFor } from './library.js';

/** Ou la hotte vit dans le stockage. */
export const KEY_HOTTE = 'veille:hotte';

/** Une hotte n'est pas un entrepot : au-dela, le plus ancien part. */
export const MAX_HOTTE = 100;

const MAX_CODE = 200;
const MAX_TITLE = 160;

function text(value, max) {
  return typeof value === 'string' && value ? value.slice(0, max) : null;
}

function readItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = text(raw.code, MAX_CODE);
  if (!code) return null;
  return {
    code,
    title: text(raw.title, MAX_TITLE),
    store: text(raw.store, 40),
    deadline: text(raw.deadline, 40),
    at: Number.isFinite(raw.at) ? raw.at : 0,
    given: Number.isFinite(raw.given) ? raw.given : null,
  };
}

/** La hotte, rendue saine : une liste d'objets connus, sans doublon de code, bornee. */
export function readHotte(raw) {
  const list = raw && Array.isArray(raw.items) ? raw.items : [];
  const seen = new Set();
  const items = [];
  for (const r of list) {
    const it = readItem(r);
    if (!it || seen.has(it.code)) continue;
    seen.add(it.code);
    items.push(it);
  }
  return { items: items.slice(-MAX_HOTTE) };
}

/** Range un code dans la hotte. Un code deja range n'est pas range deux fois. */
export function shelve(hotte, entry, now) {
  const h = readHotte(hotte);
  const it = readItem({ ...entry, at: now, given: null });
  if (!it || h.items.some((x) => x.code === it.code)) return h;
  return { items: [...h.items, it].slice(-MAX_HOTTE) };
}

/** Marque un code comme donne (`now`), ou comme de nouveau a donner (`null`). */
export function setGiven(hotte, code, now) {
  const h = readHotte(hotte);
  return { items: h.items.map((x) => (x.code === code ? { ...x, given: Number.isFinite(now) ? now : null } : x)) };
}

/** Sort un code de la hotte. Rend la hotte, et l'entree a remettre dans la liste « a echanger » (ou null). */
export function takeOut(hotte, code) {
  const h = readHotte(hotte);
  const found = h.items.find((x) => x.code === code) || null;
  return {
    hotte: { items: h.items.filter((x) => x.code !== code) },
    entry: found && {
      store: found.store,
      code: found.code,
      title: found.title,
      deadline: found.deadline,
      ts: found.at,
      attempts: 0,
    },
  };
}

/** Le texte du QR code : le code, rien d'autre. */
export function qrText(code) {
  return String(code || '').trim();
}

/** Les cles `magasin|titre normalise` de tout ce qu'on possede : le registre, et la collection importee. */
export function ownedForCodes(library, collection, normalise) {
  const out = ownedKeys(library, normalise);
  const c = sanitiseCollection(collection);
  for (const it of Object.values(c.items)) {
    if (!it || !it.store || !it.title) continue;
    const st = c.stores[it.store];
    // Une importation jamais reussie ne dit rien de ce qu'on possede (voir ownedStoreKeys).
    if (!st || !st.lastOk) continue;
    const titre = normalise(it.title);
    if (titre) out.add(ownedKeyFor(it.store, titre));
  }
  return out;
}

/** Les codes (parmi ceux a echanger) dont le jeu est probablement deja au compte du meme magasin. */
export function duplicateCodes(codes, owned, normalise) {
  const out = new Set();
  for (const c of codes || []) {
    if (!c || !c.code || !c.store || !c.title) continue;
    const titre = normalise(c.title);
    if (titre && owned.has(ownedKeyFor(c.store, titre))) out.add(c.code);
  }
  return out;
}
