/* Le bouclier (2.122.0) : prevenir quand une page se fait passer pour Epic, Steam ou GOG.
 *
 * Il ne tourne que si l'utilisateur l'a demande (case "Bouclier anti-arnaque"), apres une permission facultative qui porte sur
 * tous les sites. Il LIT la page -- son titre, la presence d'un champ de mot de passe, le debut du texte -- et demande au service
 * worker de juger : la decision et les mots viennent de watch/shield.js. Aucun clic, aucune ecriture, aucune requete.
 *
 * Pour ne pas reveiller le worker a chaque page, il ne pose la question que si la page a de quoi la poser : un champ de mot de
 * passe, un titre qui cite un magasin, une promesse dans le titre. Ces motifs sont une copie de watch/shield.js, qu'un test
 * compare.
 *
 * Le bandeau vit dans une racine fantome fermee : la page ne peut ni le lire ni le restyler.
 */
(function () {
  if (window.__fgcShield) return;
  window.__fgcShield = true;

  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  // Copie de BRANDS[*].words et de LURES (watch/shield.js).
  var MARQUES = [/\bepic games\b/i, /\bsteam\b/i, /\bgog(\.com)?\b/i, /\bgog galaxy\b/i];
  var PROMESSES = [
    /\bfree\s+v-?bucks\b/i,
    /\bfree\s+(steam|epic)\s+(wallet|gift\s*cards?|games?\s*generator|key\s*generator)\b/i,
    /\b(steam|epic games|gog)\s+(keys?|codes?|gift\s*cards?)\s+generator\b/i,
    /\b(cartes?\s+cadeaux?|codes?)\s+(steam|epic)\s+gratuit(e)?s?\b/i,
    /\b(steam|epic)\s+(wallet|gift\s*cards?)\s+gratuit(e)?s?\b/i,
    /\bkostenlos(e|er)?\s+(steam|epic)[\s-]*(guthaben|geschenkkarte|gutschein)/i,
  ];

  var ferme = {};
  var hote = null;

  function parmi(liste, texte) {
    for (var i = 0; i < liste.length; i++) if (liste[i].test(texte)) return true;
    return false;
  }

  function valeSAnnoncer(titre, mdp) {
    return mdp || parmi(MARQUES, titre) || parmi(PROMESSES, titre);
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
    var danger = r.level === 'danger';
    hote = document.createElement('div');
    hote.setAttribute('style', 'all:initial;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;');
    var racine = hote.attachShadow({ mode: 'closed' });
    var boite = el('div',
      'box-sizing:border-box;width:min(580px,92vw);background:' + (danger ? '#FF3B30' : '#E8FF00') + ';color:#000;border:3px solid #000;'
      + 'box-shadow:6px 6px 0 #000;padding:12px 44px 12px 14px;position:relative;'
      + 'font:13px/1.45 ui-monospace,"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace;');
    boite.setAttribute('role', 'alert');
    boite.appendChild(el('div', 'display:inline-block;font-weight:700;font-size:15px;letter-spacing:.06em;text-transform:uppercase;'
      + 'margin:2px 0 8px;padding:1px 8px;border:3px double #000;transform:rotate(-3deg);', r.heading));
    for (var i = 0; i < r.lines.length; i++) {
      boite.appendChild(el('div', 'margin:2px 0;padding-left:14px;text-indent:-14px;', '> ' + r.lines[i]));
    }
    if (r.intro) boite.appendChild(el('div', 'margin:8px 0 0;font-size:12px;', r.intro));
    var x = el('button',
      'all:initial;position:absolute;top:8px;right:8px;width:26px;height:26px;background:#000;color:#fff;'
      + 'font:700 15px/26px ui-monospace,monospace;text-align:center;cursor:pointer;', String.fromCharCode(10005));
    x.setAttribute('aria-label', r.close || 'Fermer');
    x.addEventListener('click', function () { ferme[adresse] = true; retirer(); });
    boite.appendChild(x);
    racine.appendChild(boite);
    (document.body || document.documentElement).appendChild(hote);
  }

  function demander(essai) {
    var adresse = location.href;
    if (ferme[adresse]) return;
    var titre = String(document.title || '').slice(0, 300);
    var mdp = !!document.querySelector('input[type="password"]');
    if (!valeSAnnoncer(titre, mdp)) {
      // Les pages se dessinent cote client : on relit deux fois, puis on se tait.
      if (essai < 3) setTimeout(function () { demander(essai + 1); }, 1500);
      return;
    }
    var texte = document.body ? String(document.body.innerText || '').slice(0, 3000) : '';
    try {
      api.runtime.sendMessage({ type: 'fgc-shield', title: titre, hasPassword: mdp, text: texte }, function (r) {
        void api.runtime.lastError;
        if (adresse !== location.href) return;
        if (!r || r.show !== true || !Array.isArray(r.lines) || !r.lines.length) return;
        montrer({
          level: r.level === 'danger' ? 'danger' : 'warn',
          heading: String(r.heading || '').slice(0, 120),
          intro: String(r.intro || '').slice(0, 300),
          close: String(r.close || '').slice(0, 40),
          lines: r.lines.filter(function (l) { return typeof l === 'string'; }).map(function (l) { return l.slice(0, 220); }).slice(0, 6),
        }, adresse);
      });
    } catch (e) { /* l'extension a ete rechargee : plus rien a dire */ }
  }

  demander(0);
})();
