/* L'anti-doublon sur la fiche d'un jeu (2.87.0).
 *
 * Il LIT la page -- son titre, son og:title, son premier h1 -- et demande au
 * service worker si ce jeu est deja a vous ailleurs. Si oui, un bandeau le
 * dit, en haut de la page, avant le bouton d'achat. Rien d'autre : aucun
 * clic, aucune ecriture, aucune requete. Les mots viennent du worker, dans
 * la langue choisie ; la decision aussi (watch/owned-guard.js).
 *
 * Le bandeau vit dans une racine fantome fermee : la page ne peut ni le lire
 * ni le restyler, et il ne peut pas casser la page.
 */
(function () {
  if (window.__fgcOwnedGuard) return;
  window.__fgcOwnedGuard = true;

  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  /* Les fiches de jeu : copie de PRODUCT_PAGES (watch/owned-guard.js), qu'un
     test compare. Ailleurs dans la boutique, le script se tait. */
  var FICHES = [
    /^https:\/\/store\.steampowered\.com\/app\/\d+/,
    /^https:\/\/store\.epicgames\.com\/[^/]+\/p\/[^/?#]+/,
    /^https:\/\/(www\.)?gog\.com\/([a-z]{2}\/)?game\/[^/?#]+/,
    /^https:\/\/www\.humblebundle\.com\/store\/(?!search\b)[^/?#]+/,
    /^https:\/\/www\.fanatical\.com\/[^/]+\/(game|dlc)\/[^/?#]+/,
    /^https:\/\/www\.greenmangaming\.com\/games\/[^/?#]+/,
    /^https:\/\/([^/]+\.)?gamesplanet\.com\/game\/[^/?#]+/,
    /^https:\/\/www\.indiegala\.com\/store\/game\/[^/?#]+/,
  ];
  function surUneFiche() {
    for (var i = 0; i < FICHES.length; i++) if (FICHES[i].test(location.href)) return true;
    return false;
  }
  var ferme = {};
  var pageVue = null;
  var hote = null;

  function texte(n) {
    return n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  function candidats() {
    var out = [];
    // Le titre du jeu la ou chaque magasin le range, avant les titres de page habilles.
    var propre = texte(document.querySelector('#appHubAppName, [data-testid="pdp-title"], .productcard-basics__title'));
    if (propre) out.push(propre);
    var og = document.querySelector('meta[property="og:title"]');
    if (og && og.getAttribute('content')) out.push(og.getAttribute('content'));
    var h1 = texte(document.querySelector('h1'));
    if (h1) out.push(h1);
    if (document.title) out.push(document.title);
    return out.map(function (s) { return String(s).slice(0, 200); }).slice(0, 5);
  }

  function retirer() {
    if (hote && hote.parentNode) hote.parentNode.removeChild(hote);
    hote = null;
  }

  function el(tag, style, contenu) {
    var n = document.createElement(tag);
    if (style) n.setAttribute('style', style);
    if (contenu) n.textContent = contenu;
    return n;
  }

  function montrer(r, adresse) {
    retirer();
    hote = document.createElement('div');
    hote.setAttribute('style', 'all:initial;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483646;');
    var racine = hote.attachShadow({ mode: 'closed' });
    var boite = el('div',
      'box-sizing:border-box;width:min(560px,92vw);background:#E8FF00;color:#000;border:3px solid #000;'
      + 'box-shadow:6px 6px 0 #000;padding:12px 44px 12px 14px;position:relative;'
      + 'font:13px/1.45 ui-monospace,"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace;');
    boite.setAttribute('role', 'alert');
    boite.appendChild(el('div', 'font-weight:700;font-size:15px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 4px;', r.heading));
    if (r.title) boite.appendChild(el('div', 'font-weight:700;margin:0 0 6px;', r.title));
    for (var i = 0; i < r.lines.length; i++) {
      var ligne = el('div', 'margin:2px 0;padding-left:14px;text-indent:-14px;', '> ' + r.lines[i]);
      boite.appendChild(ligne);
    }
    if (r.intro) boite.appendChild(el('div', 'margin:8px 0 0;font-size:12px;', r.intro));
    var x = el('button',
      'all:initial;position:absolute;top:8px;right:8px;width:26px;height:26px;background:#000;color:#E8FF00;'
      + 'font:700 15px/26px ui-monospace,monospace;text-align:center;cursor:pointer;', '\u2715');
    x.setAttribute('aria-label', r.close || 'Fermer');
    x.addEventListener('click', function () { ferme[adresse] = true; retirer(); });
    boite.appendChild(x);
    racine.appendChild(boite);
    (document.body || document.documentElement).appendChild(hote);
  }

  function demander(essai) {
    var adresse = location.href;
    if (ferme[adresse]) return;
    var c = candidats();
    if (!c.length) {
      if (essai < 8) setTimeout(function () { demander(essai + 1); }, 800);
      return;
    }
    try {
      api.runtime.sendMessage({ type: 'fgc-owned-guard', candidates: c, url: adresse }, function (r) {
        void api.runtime.lastError;
        if (adresse !== location.href) return;
        if (!r || r.show !== true || !Array.isArray(r.lines) || !r.lines.length) {
          // Les boutiques rendent leur fiche cote client : on relit une fois ou deux.
          if (essai < 3) setTimeout(function () { demander(essai + 1); }, 1500);
          return;
        }
        montrer({
          heading: String(r.heading || '').slice(0, 80),
          title: String(r.title || '').slice(0, 140),
          intro: String(r.intro || '').slice(0, 300),
          close: String(r.close || '').slice(0, 40),
          lines: r.lines.filter(function (l) { return typeof l === 'string'; }).map(function (l) { return l.slice(0, 200); }).slice(0, 6),
        }, adresse);
      });
    } catch (e) { /* contexte invalide apres une mise a jour */ }
  }

  /* Les boutiques changent de fiche sans recharger la page : on suit
     l'adresse, et chaque nouvelle fiche repose la question. */
  function surveiller() {
    if (location.href === pageVue) return;
    pageVue = location.href;
    retirer();
    if (surUneFiche()) setTimeout(function () { demander(0); }, 900);
  }
  surveiller();
  setInterval(surveiller, 1000);
})();
