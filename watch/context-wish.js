/* Clic droit : « Me prevenir quand ce jeu sera gratuit » (2.79.0).
 *
 * La liste de souhaits existe depuis la 2.31.0, mais s'y ajouter voulait dire
 * ouvrir le popup et taper le nom. Or c'est sur la fiche du jeu, en le
 * regardant, qu'on se dit « celui-la, s'il passe gratuit... ». Le menu du
 * clic droit le fait la, sur la fiche Steam, Epic ou GOG -- ou sur un lien
 * vers l'une d'elles, depuis n'importe quelle page.
 *
 * LE TITRE, sur une fiche, se lit comme le panneau de la page le lit deja
 * (content/launcher.js, pageTitle) : un selecteur par magasin, puis le titre du
 * document. Sur un lien : son texte, sinon l'adresse elle-meme -- l'identifiant
 * de Steam porte le nom (/app/393380/Squad/), ceux d'Epic et de GOG aussi. Le
 * rapprochement se fait sur le titre normalise : « Astrea: Six-Sided Oracles »
 * lu sur Steam reconnait « Astrea: Six Sided Oracles » offert sur Epic.
 *
 * La permission `contextMenus` n'ouvre l'acces a rien : Chrome ne l'annonce
 * meme pas a l'installation. Le menu n'apparait que sur les fiches de jeu.
 *
 * Module pur, sauf `readPageTitle`, injecte dans la page tel quel, et
 * `wishFromClick`, qui recoit tout ce qu'il touche.
 */
import { STORE_LABELS, displayTitle, normaliseTitle } from './offer.js';
import { KEY_GOG_WISHLIST, KEY_STEAM_WISHLIST, KEY_WISHLIST, wishOrigin } from './wishlist.js';
import { KEYS } from './storage.js';
import { openOffers } from './catalog.js';
import { wish } from './commands.js';

export const MENU_PAGE = 'fgc-wish-page';
export const MENU_LINK = 'fgc-wish-link';

/** Les fiches de jeu des trois magasins dont on sait lire le titre. */
export const GAME_PAGES = Object.freeze([
  'https://store.steampowered.com/app/*',
  'https://store.epicgames.com/*/p/*',
  'https://store.epicgames.com/p/*',
  'https://www.gog.com/*/game/*',
  'https://www.gog.com/game/*',
]);

/** Le magasin d'une adresse de fiche, ou null. */
export function storeOfUrl(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.hostname === 'store.steampowered.com' && /^\/app\/\d+/.test(u.pathname)) return 'steam';
  if (u.hostname === 'store.epicgames.com' && /(^|\/)p\/[^/]+/.test(u.pathname)) return 'epic';
  if (/^(www\.)?gog\.com$/.test(u.hostname) && /(^|\/)game\/[^/]+/.test(u.pathname)) return 'gog';
  return null;
}

/**
 * Le nom que l'adresse porte : `/app/393380/Squad/`, `/p/astrea-six-sided-oracles`,
 * `/game/astrea_six_sided_oracles`. Moins joli qu'un titre, mais il se
 * normalise pareil. Epic suffixe parfois un identifiant hexadecimal : retire.
 */
export function slugTitle(url) {
  const store = storeOfUrl(url);
  if (!store) return '';
  const chemin = new URL(url).pathname;
  let brut = '';
  if (store === 'steam') brut = (/^\/app\/\d+\/([^/?#]+)/.exec(chemin) || [])[1] || '';
  else if (store === 'epic') brut = ((/\/p\/([^/?#]+)/.exec(chemin) || [])[1] || '').replace(/-(?=[0-9a-f]*\d)[0-9a-f]{5,}$/, '');
  else brut = (/\/game\/([^/?#]+)/.exec(chemin) || [])[1] || '';
  let texte = brut;
  try { texte = decodeURIComponent(brut); } catch { /* garde tel quel */ }
  texte = texte.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Epic et GOG ecrivent tout en minuscules : une capitale par mot, pour l'oeil.
  return store === 'steam' ? texte : texte.replace(/(^|\s)(\p{Ll})/gu, (m, sp, c) => sp + c.toUpperCase());
}

/**
 * Le titre du document, sans le magasin : « Mechabellum | Download and Buy
 * Today - Epic Games Store », « Astrea: Six-Sided Oracles on GOG.com »,
 * « Save 50% on Squad on Steam ».
 */
export function cleanDocTitle(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  s = s.split(/\s+[|–—]\s+/)[0];
  s = s.replace(/\s+-\s+Epic Games Store$/i, '');
  s = s.replace(/\s+(on|sur|auf|en|su)\s+(Steam|GOG\.com)$/i, '');
  s = s.replace(/^(Save|Économisez|Economisez|Spare|Ahorra|Risparmia)\s+\d+\s*%\s+(on|sur|bei|en|su)\s+/i, '');
  // GOG en promotion : « The Witcher 3 ... 50% de réduction | GOG.COM » (mesure du 2026-09-26).
  s = s.replace(/\s+-?\d+\s*%\s*(off|de réduction|de reduction|rabatt|de descuento|di sconto)$/i, '');
  return s.trim();
}

/** Un texte de lien qui ne nomme pas un jeu : « Acheter », « En savoir plus »... */
const LIENS_MUETS = /^(buy|acheter|kaufen|comprar|more|plus|voir|view|see|learn more|en savoir plus|mehr|ver m[aá]s|play|jouer|get|obtenir|free|gratuit|\W*)$/i;

/* La page d'attente de Cloudflare, que Epic sert parfois a la place de la
   fiche : « One more step », « Just a moment... » (mesure du 2026-09-26). Ce
   n'est pas un jeu, et l'ajouter ferait un souhait qui n'attend rien. */
const PAGES_ATTENTE = /^(one more step|just a moment|attention required|access denied|un instant|checking your browser|verifying you are human|please wait)\b/i;

/** Un titre acceptable : assez long pour nommer un jeu, assez court pour ne pas etre une page. */
function titreSain(s) {
  const t = displayTitle(String(s || '').replace(/\s+/g, ' ').trim());
  if (PAGES_ATTENTE.test(t)) return '';
  return t.length >= 2 && t.length <= 140 && normaliseTitle(t) ? t : '';
}

/**
 * Le titre a retenir. Sur une fiche : ce que la page affiche, puis le titre du
 * document, puis l'adresse. Sur un lien : son texte, puis l'adresse.
 */
export function chooseTitle({ scraped = '', docTitle = '', linkText = '', url = '', link = false } = {}) {
  if (link) {
    const texte = String(linkText || '').trim();
    return (!LIENS_MUETS.test(texte) && titreSain(texte)) || titreSain(slugTitle(url));
  }
  return titreSain(scraped) || titreSain(cleanDocTitle(docTitle)) || titreSain(slugTitle(url));
}

/**
 * Injecte dans la fiche : le titre affiche, et celui du document en repli.
 * Autonome -- `scripting.executeScript` n'emporte que le texte de la fonction.
 * Les memes selecteurs que content/launcher.js.
 */
export function readPageTitle() {
  var h = location.hostname;
  var sel = null;
  if (/^store\.epicgames\.com$/.test(h)) sel = 'h1[data-testid="pdp-title"], h1';
  else if (/(^|\.)gog\.com$/.test(h)) sel = 'h1.productcard-basics__title, h1';
  else if (/^store\.steampowered\.com$/.test(h)) sel = '#appHubAppName, .apphub_AppName, h1';
  var n = sel ? document.querySelector(sel) : null;
  var texte = n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  return { title: texte.slice(0, 200), doc: String(document.title || '').slice(0, 300) };
}

/** Les deux entrees du menu, telles que `contextMenus.create` les attend. */
export function menuItems(title) {
  return [
    { id: MENU_PAGE, title, contexts: ['page'], documentUrlPatterns: [...GAME_PAGES] },
    { id: MENU_LINK, title, contexts: ['link'], targetUrlPatterns: [...GAME_PAGES] },
  ];
}

/**
 * Le clic : lit le titre, l'ajoute s'il n'est pas deja attendu (a la main, ou
 * par la liste Steam ou GOG importee), et dit ce qui a ete fait -- y compris,
 * s'il est gratuit EN CE MOMENT, ou.
 */
export async function wishFromClick({ info, tab, chrome, t, notify, record = () => {}, now = Date.now() }) {
  const link = info.menuItemId === MENU_LINK;
  const url = link ? info.linkUrl : (info.pageUrl || (tab && tab.url) || '');
  let lu = null;
  if (!link && tab && typeof tab.id === 'number' && tab.id >= 0) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [info.frameId || 0] }, func: readPageTitle,
      });
      lu = r && r.result;
    } catch { lu = null; }
  }
  const title = chooseTitle({
    link, url, linkText: info.linkText || '',
    scraped: (lu && lu.title) || '', docTitle: (lu && lu.doc) || (tab && tab.title) || '',
  });
  if (!title) {
    await notify({ id: `souhait-${now}`, title: t('ctxWishFailTitle'), message: t('ctxWishFail') });
    return { added: false, title: null };
  }
  const raw = await chrome.storage.local.get([KEY_WISHLIST, KEY_STEAM_WISHLIST, KEY_GOG_WISHLIST, KEYS.OFFERS]);
  /* L'appid d'une fiche Steam reconnait le jeu dans la liste Steam importee,
     meme sous un titre traduit. */
  const appid = storeOfUrl(url) === 'steam' ? (/\/app\/(\d+)/.exec(new URL(url).pathname) || [])[1] : null;
  const offre = appid ? { title, store: 'steam', storeId: appid } : { title };
  const deja = wishOrigin(raw[KEY_WISHLIST], offre, normaliseTitle, raw[KEY_STEAM_WISHLIST], raw[KEY_GOG_WISHLIST]);
  if (!deja) await wish({ chrome, title, on: true });
  const cle = normaliseTitle(title);
  const libre = openOffers(raw[KEYS.OFFERS] || {}, now).find((o) => (o.normalisedTitle || normaliseTitle(o.title)) === cle) || null;
  record('info', `souhait par clic droit : ${title}${deja ? ' (deja attendu)' : ''}`);
  await notify({
    id: `souhait-${now}`,
    title: t(deja ? 'ctxWishAlready' : 'ctxWishAdded', title),
    message: libre ? t('ctxWishFreeNow', STORE_LABELS[libre.store] || libre.store) : t('ctxWishBody'),
    url: libre ? (libre.url || libre.resolveUrl || null) : null,
  });
  return { added: !deja, title, already: deja, freeNow: libre ? libre.store : null };
}
