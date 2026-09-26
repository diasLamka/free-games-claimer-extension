/* L'anti-doublon au moment de payer (2.87.0).
 *
 * La fiche d'un jeu savait deja dire « deja a vous » -- dans une bulle
 * discrete, sur Epic, GOG et Steam seulement. Or on paie ailleurs : chez
 * Humble, Fanatical, Green Man Gaming, Gamesplanet, IndieGala. Et c'est
 * exactement la qu'on rachete, sans le savoir, un jeu recupere gratuitement
 * sur Epic il y a deux ans.
 *
 * Ce module decide, a partir de ce que l'extension sait -- le registre des
 * jeux obtenus (y compris par le telephone, via le relais) et Ma collection
 * --, s'il faut alerter sur la fiche ouverte, et en quels mots. Le script
 * content/owned-guard.js ne fait qu'afficher ce qu'il recoit.
 *
 * Deux regles :
 *   - on ne signale que ce qui est possede AILLEURS que sur la boutique de la
 *     page : chez elle, la boutique le dit deja ;
 *   - on se tait quand le jeu est gratuit ici en ce moment : c'est une
 *     recuperation, pas un achat, et le lanceur s'en occupe.
 *
 * Module pur.
 */

/**
 * Les boutiques ou l'on paie, en plus d'Epic, GOG et Steam. Chacune s'active
 * a la demande, avec sa permission d'hote facultative : l'extension ne lit
 * rien chez elles tant qu'on ne l'a pas demande.
 */
export const GUARD_SITES = Object.freeze([
  { id: 'humble', label: 'Humble Bundle', origins: ['https://www.humblebundle.com/*'] },
  { id: 'fanatical', label: 'Fanatical', origins: ['https://www.fanatical.com/*'] },
  { id: 'gmg', label: 'Green Man Gaming', origins: ['https://www.greenmangaming.com/*'] },
  { id: 'gamesplanet', label: 'Gamesplanet', origins: ['https://*.gamesplanet.com/*'] },
  { id: 'indiegala', label: 'IndieGala', origins: ['https://www.indiegala.com/*'] },
]);

/**
 * Les fiches de jeu, par boutique. Le script est injecte sur toute la
 * boutique -- elles changent de page sans recharger -- et ne parle que sur
 * une fiche. content/owned-guard.js en porte une copie, qu'un test compare.
 */
export const PRODUCT_PAGES = Object.freeze({
  steam: /^https:\/\/store\.steampowered\.com\/app\/\d+/,
  epic: /^https:\/\/store\.epicgames\.com\/[^/]+\/p\/[^/?#]+/,
  gog: /^https:\/\/(www\.)?gog\.com\/([a-z]{2}\/)?game\/[^/?#]+/,
  humble: /^https:\/\/www\.humblebundle\.com\/store\/(?!search\b)[^/?#]+/,
  fanatical: /^https:\/\/www\.fanatical\.com\/[^/]+\/(game|dlc)\/[^/?#]+/,
  gmg: /^https:\/\/www\.greenmangaming\.com\/games\/[^/?#]+/,
  gamesplanet: /^https:\/\/([^/]+\.)?gamesplanet\.com\/game\/[^/?#]+/,
  indiegala: /^https:\/\/www\.indiegala\.com\/store\/game\/[^/?#]+/,
});

/** Cette adresse est-elle la fiche d'un jeu, chez une boutique connue ? */
export function isProductPage(url) {
  const store = guardStoreOf(url);
  return Boolean(store && PRODUCT_PAGES[store] && PRODUCT_PAGES[store].test(String(url)));
}

/** L'identifiant du script enregistre pour une boutique. */
export function guardScriptId(site) {
  return `fgc-anti-doublon-${site}`;
}

/** La boutique d'une adresse : un magasin de l'extension, une boutique ci-dessus, ou null. */
export function guardStoreOf(url) {
  let h;
  try { h = new URL(String(url || '')).hostname.toLowerCase(); } catch { return null; }
  if (h === 'store.steampowered.com') return 'steam';
  if (h === 'store.epicgames.com') return 'epic';
  if (h === 'www.gog.com' || h === 'gog.com') return 'gog';
  if (h === 'www.humblebundle.com') return 'humble';
  if (h === 'www.fanatical.com') return 'fanatical';
  if (h === 'www.greenmangaming.com') return 'gmg';
  if (h === 'gamesplanet.com' || h.endsWith('.gamesplanet.com')) return 'gamesplanet';
  if (h === 'www.indiegala.com') return 'indiegala';
  return null;
}

/**
 * Le nom du jeu, tire d'un titre de page ou d'un og:title.
 *
 * Les boutiques l'habillent : « Buy Hades from the Humble Store »,
 * « Hades | PC Steam Game | Fanatical », « Hades - Steam key - Gamesplanet ».
 * On retire l'habillage connu, on coupe au premier separateur.
 */
export function cleanTitle(raw, { cut = true } = {}) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Steam en promotion : « Save 50% on Hades on Steam », sinon « Hades on Steam ».
  const steam = /^(?:save\s+\d+%\s+on\s+)?(.+?)\s+on\s+steam$/i.exec(s);
  if (steam) s = steam[1];
  s = s.replace(/^(buy|acheter|kaufen|comprar|compra|pre-?order|précommander)\s+/i, '');
  s = s.replace(/\s+(from|on|sur|bei|en|auf)\s+(the\s+)?(humble|fanatical|green man gaming|gamesplanet|indiegala)(\s+store)?\s*$/i, '');
  s = s.split(/\s+[|–—]\s+/)[0];
  // « Jeu - Steam key », mais aussi « Disco Elysium - The Final Cut » : couper
  // au tiret est une variante, pas la seule lecture (voir ownedElsewhere).
  if (cut) s = s.split(/\s+-\s+/)[0];
  s = s.replace(/\s*\((pc|mac|steam|download|digital)[^)]*\)\s*$/i, '');
  s = s.replace(/\s+(pc\s+)?(steam|gog|epic|uplay|ubisoft connect|origin|ea app)\s+(cd\s+)?key\s*$/i, '');
  s = s.replace(/\s+(pc|mac)\s+(game|download)\s*$/i, '');
  return s.trim().slice(0, 140);
}

/**
 * Ce qu'on possede de ce jeu, AILLEURS que sur `pageStore`.
 *
 * `candidates` : les titres lus sur la page (og:title, h1, titre du
 * document), dans l'ordre de confiance. Le premier qui correspond a quelque
 * chose l'emporte. Rend { title, owned: [{ store, ts, via, source }] } ou null.
 */
export function ownedElsewhere({ candidates = [], pageStore = null, library = {}, collection = {}, catalog = {}, normalise, now }) {
  if (typeof normalise !== 'function') throw new TypeError('anti-doublon : la normalisation est obligatoire');
  const vus = new Set();
  const lectures = [];
  for (const brut of candidates) lectures.push(cleanTitle(brut, { cut: false }), cleanTitle(brut));
  for (const titre of lectures) {
    const cle = normalise(titre);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);

    // Gratuit ici, maintenant : une recuperation, pas un achat.
    const gratuitIci = Object.values(catalog || {}).some((o) => o && o.title && o.store === pageStore
      && normalise(o.title) === cle && !(typeof o.end === 'number' && o.end <= now)
      && !(typeof o.start === 'number' && o.start > now));
    if (gratuitIci) return null;

    const owned = [];
    const deja = new Set();
    for (const e of Object.values(library || {})) {
      if (!e || !e.title || !e.store || e.store === pageStore) continue;
      if (e.status && !['claimed', 'redeemed'].includes(e.status)) continue;
      if (normalise(e.title) !== cle || deja.has(e.store)) continue;
      deja.add(e.store);
      owned.push({ store: e.store, ts: typeof e.ts === 'number' ? e.ts : null, via: e.via || null, source: 'library' });
    }
    for (const item of Object.values(collection || {})) {
      if (!item || !item.title || !item.store || item.store === pageStore) continue;
      if (normalise(item.title) !== cle || deja.has(item.store)) continue;
      deja.add(item.store);
      owned.push({ store: item.store, ts: typeof item.acquiredAt === 'number' ? item.acquiredAt : null, via: null, source: 'collection' });
    }
    if (owned.length) {
      owned.sort((a, b) => (a.ts ?? Infinity) - (b.ts ?? Infinity));
      return { title: titre, owned };
    }
  }
  return null;
}

/** Les lignes du bandeau, dans la langue de l'utilisateur. */
export function guardLines(result, { t, storeLabel = (s) => s, dateText = (ts) => String(ts) }) {
  if (!result) return [];
  return result.owned.map((o) => {
    const ou = storeLabel(o.store);
    if (o.source === 'library' && o.ts && o.via === 'telephone') return t('guardClaimedByPhone', ou, dateText(o.ts));
    if (o.source === 'library' && o.ts) return t('guardClaimedOn', ou, dateText(o.ts));
    if (o.ts) return t('guardOwnedSince', ou, dateText(o.ts));
    return t('guardOwned', ou);
  });
}
