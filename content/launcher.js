/* Le lanceur : ce que l'extension dit et fait sur la page d'un magasin, dans
 * un seul bouton.
 *
 * Jusqu'a la 2.50.0, deux scripts posaient chacun leur boite dans le coin bas
 * droit de la page : le moteur (son etat, « Claim », « Auto hebdo ») et la
 * surcouche des fiches (« deja a vous sur GOG »). Sur une fiche Epic, les deux
 * se chevauchaient, et masquaient ce que la page affichait dessous.
 *
 * Il n'y a plus qu'un element : l'icone de l'extension, au bord droit de la
 * fenetre. Un clic ouvre un panneau ; un glisser la deplace le long du bord,
 * et la position est retenue. Une pastille compte ce qu'il y a a lire, un
 * point dit ou en est le moteur, et une bulle breve annonce ce qui vient
 * d'arriver -- puis s'efface d'elle-meme.
 *
 * CINQ REGLES, chacune une facon de ne pas nuire a une page qu'on ne possede
 * pas. Les quatre premieres viennent de la surcouche.
 *
 *  1. AUCUN innerHTML. Tout se construit par noeuds et textContent : le titre
 *     affiche vient d'une API tierce.
 *
 *  2. RIEN QUAND IL N'Y A RIEN A DIRE. Le bouton n'existe que si le moteur
 *     tourne sur la page, ou si la fiche a quelque chose a dire. Une fiche
 *     Steam inconnue de l'extension ne recoit rien.
 *
 *  3. CE SCRIPT NE RECLAME RIEN. Les deux commandes du panneau appellent le
 *     moteur, qui les offrait deja par ses propres boutons : lui seul agit.
 *     Ce script n'ecrit qu'une cle, la position du bouton.
 *
 *  4. RIEN DE LISIBLE PAR LA PAGE. Tout vit dans une racine d'ombre FERMEE :
 *     les scripts du magasin voient qu'un element existe, pas ce qu'il dit.
 *     L'etat du moteur, lui, s'ecrivait jusqu'ici dans le DOM ordinaire.
 *
 *  5. LE STYLE PAR PROPRIETE, jamais par feuille. Une feuille injectee peut
 *     changer le rendu de la page, et la politique de securite de certaines
 *     pages la refuse ; une propriete posee par script passe partout. Les
 *     survols et l'animation se font donc en script.
 *
 * Le moteur parle au lanceur par `window.FGC_PAGE_UI`. Les scripts de contenu
 * de l'extension partagent un monde isole que la page ne voit pas : c'est
 * deja par la que gm-shim.js sert le moteur.
 */
(function () {
  'use strict';

  /* Une seule fois par page -- deux entrees du manifeste qui le citeraient
     l'executeraient deux fois -- et dans le cadre principal seulement. */
  if (window.FGC_PAGE_UI && typeof window.FGC_PAGE_UI.engine === 'function') return;
  try { if (window.top !== window.self) return; } catch (e) { return; }

  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  var KEY_POSITION = 'veille:lanceur';
  var TAILLE = 40;
  var MARGE = 12;
  var ECART = 10;
  var BORD = 8;
  var BULLE_MS = 6000;
  var Y_DEFAUT = 0.7;

  var C = {
    fond: '#14101F', bord: '#2E2745', texte: '#EDE9F5', doux: '#9A90B8',
    ambre: '#FFB454', ambreClair: '#FFC47A', icone: '#FFA554', encre: '#181128',
    eteint: '#3A3350', idle: '#9A90B8', running: '#F5A623', ok: '#4CC38A', error: '#E5484D',
  };
  var POLICE = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  /* Les libelles, par nom. Ceux du worker d'abord : ils suivent la langue
     choisie dans les reglages. Sans reponse, ceux du navigateur. Les cles
     sont recopiees de watch/lookup.js (LAUNCHER_LABELS), et un test verifie
     que les deux listes n'ont pas diverge. */
  var CLES = {
    button: 'launcherButton',
    close: 'sentinelClose',
    claim: 'claimAll',
    autoEpic: 'epicAutoLabel',
    autoLuna: 'lunaAutoLabel',
  };

  var etat = {
    moteur: null,
    statut: 'idle',
    message: '',
    lignes: [],
    libelles: {},
    ouvert: false,
    y: Y_DEFAUT,
    bulleFaits: false,
  };

  var hote = null;
  var ui = {};
  var minuterieBulle = null;
  var pulsation = null;
  var glisse = null;
  var ignorerClic = false;

  /* ------------------------------------------------------------ outils */

  function libelle(nom) {
    var v = etat.libelles[nom];
    if (typeof v === 'string' && v) return v;
    try { v = api.i18n.getMessage(CLES[nom]); } catch (e) { v = ''; }
    return v || '';
  }

  function el(tag, style, texte) {
    var n = document.createElement(tag);
    if (style) n.style.cssText = style;
    if (texte !== undefined && texte !== null) n.textContent = texte;
    return n;
  }

  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, String(attrs[k]));
    }
    return n;
  }

  function survol(n, dedans, dehors) {
    n.addEventListener('mouseenter', dedans);
    n.addEventListener('mouseleave', dehors);
    n.addEventListener('focus', dedans);
    n.addEventListener('blur', dehors);
  }

  /* Un anneau au clavier seulement : `all:initial` retire celui du navigateur,
     et un anneau a chaque clic de souris serait du bruit. */
  function anneauFocus(n, couleur) {
    n.addEventListener('focus', function () {
      var clavier = true;
      try { clavier = n.matches(':focus-visible'); } catch (e) {}
      if (clavier) { n.style.outline = '2px solid ' + couleur; n.style.outlineOffset = '2px'; }
    });
    n.addEventListener('blur', function () { n.style.outline = ''; });
  }

  function mouvementReduit() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  function hauteur() { return window.innerHeight || document.documentElement.clientHeight || 600; }
  function largeur() { return window.innerWidth || document.documentElement.clientWidth || 800; }

  /** L'icone de l'extension, en aplats : un degrade ou un masque passent par
      des references #id, que les racines d'ombre resolvent mal selon le
      navigateur. Les encoches sont peintes de la couleur du fond. */
  function icone() {
    var s = svg('svg', { viewBox: '0 0 128 128', width: TAILLE, height: TAILLE, 'aria-hidden': 'true', focusable: 'false' });
    s.style.display = 'block';
    s.appendChild(svg('rect', { x: 2.5, y: 2.5, width: 123, height: 123, rx: 28.8, fill: C.icone }));
    s.appendChild(svg('rect', { x: 23.7, y: 39, width: 80.6, height: 49.9, rx: 9.6, fill: C.encre }));
    s.appendChild(svg('circle', { cx: 23.7, cy: 64, r: 10.9, fill: C.icone }));
    s.appendChild(svg('circle', { cx: 104.3, cy: 64, r: 10.9, fill: C.icone }));
    s.appendChild(svg('line', {
      x1: 77.4, y1: 44, x2: 77.4, y2: 84, stroke: C.icone, 'stroke-width': 5.1, 'stroke-dasharray': '7.2 5.3',
    }));
    return s;
  }

  /* ------------------------------------------------------------ position */

  function placer() {
    if (!hote) return;
    var h = hauteur();
    var top = Math.max(BORD, Math.min(h - TAILLE - BORD, etat.y * h));
    hote.style.top = Math.round(top) + 'px';
  }

  function lirePosition() {
    try {
      api.storage.local.get(KEY_POSITION, function (items) {
        void api.runtime.lastError;
        var p = items && items[KEY_POSITION];
        if (p && typeof p.y === 'number' && p.y >= 0 && p.y <= 1) { etat.y = p.y; placer(); }
      });
    } catch (e) { /* contexte invalide apres une mise a jour */ }
  }

  function sauverPosition() {
    var o = {};
    o[KEY_POSITION] = { y: Math.round(etat.y * 1000) / 1000 };
    try { api.storage.local.set(o, function () { void api.runtime.lastError; }); } catch (e) {}
  }

  /* ------------------------------------------------------------ construction */

  function construire() {
    if (hote) return;
    /* Sans racine d'ombre (navigateur trop ancien), on se tait plutot que
       d'exposer ce qu'on sait dans le DOM de la page. */
    if (!document.body || typeof document.body.attachShadow !== 'function') return;

    hote = document.createElement('div');
    hote.style.cssText = 'all:initial;position:fixed;right:' + MARGE + 'px;top:0;width:' + TAILLE + 'px;height:'
      + TAILLE + 'px;z-index:2147483646';
    var racine = hote.attachShadow({ mode: 'closed' });

    var bouton = el('button', 'all:initial;position:relative;display:block;width:' + TAILLE + 'px;height:' + TAILLE
      + 'px;border-radius:11px;cursor:pointer;touch-action:none;box-shadow:0 4px 14px rgba(0,0,0,.35);'
      + 'transition:transform .12s ease,box-shadow .12s ease');
    bouton.type = 'button';
    bouton.setAttribute('aria-haspopup', 'dialog');
    bouton.appendChild(icone());
    survol(bouton,
      function () { bouton.style.transform = 'scale(1.06)'; bouton.style.boxShadow = '0 6px 18px rgba(0,0,0,.45)'; },
      function () { bouton.style.transform = ''; bouton.style.boxShadow = '0 4px 14px rgba(0,0,0,.35)'; });
    anneauFocus(bouton, C.ambre);

    /* La pastille : combien la fiche a de choses a dire. */
    var pastille = el('span', 'position:absolute;top:-6px;left:-6px;min-width:16px;height:16px;padding:0 3px;'
      + 'box-sizing:border-box;border-radius:8px;border:2px solid ' + C.fond + ';background:' + C.texte + ';color:'
      + C.encre + ';font:700 9px/12px ' + POLICE + ';text-align:center;display:none');
    pastille.setAttribute('aria-hidden', 'true');
    bouton.appendChild(pastille);

    /* Le point : ou en est le moteur. */
    var point = el('span', 'position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:50%;'
      + 'border:2px solid ' + C.fond + ';display:none');
    point.setAttribute('aria-hidden', 'true');
    bouton.appendChild(point);

    var bulle = el('div', 'position:absolute;right:' + (TAILLE + ECART) + 'px;top:50%;transform:translateY(-50%);'
      + 'box-sizing:border-box;width:max-content;max-width:260px;padding:7px 10px;border-radius:10px;cursor:pointer;'
      + 'background:' + C.fond + ';color:' + C.texte + ';border:1px solid ' + C.bord + ';border-left:3px solid '
      + C.ambre + ';font:12.5px/1.4 ' + POLICE + ';box-shadow:0 6px 20px rgba(0,0,0,.35);display:none');
    bulle.setAttribute('role', 'status');
    bulle.addEventListener('click', function () { ouvrir(); });

    var panneau = construirePanneau();

    racine.appendChild(bouton);
    racine.appendChild(bulle);
    racine.appendChild(panneau.boite);

    bouton.addEventListener('pointerdown', debutGlisse);
    bouton.addEventListener('pointermove', pendantGlisse);
    bouton.addEventListener('pointerup', finGlisse);
    bouton.addEventListener('pointercancel', function () { glisse = null; });
    bouton.addEventListener('click', function () {
      if (ignorerClic) { ignorerClic = false; return; }
      if (etat.ouvert) fermer(); else ouvrir();
    });

    ui = { bouton: bouton, pastille: pastille, point: point, bulle: bulle, panneau: panneau };
    document.body.appendChild(hote);
    window.addEventListener('resize', placer);
    placer();
  }

  function construirePanneau() {
    var boite = el('div', 'position:absolute;right:' + (TAILLE + ECART) + 'px;box-sizing:border-box;width:300px;'
      + 'padding:12px;border-radius:12px;background:' + C.fond + ';color:' + C.texte + ';border:1px solid ' + C.bord
      + ';font:13px/1.45 ' + POLICE + ';box-shadow:0 10px 30px rgba(0,0,0,.45);overflow-y:auto;color-scheme:dark;'
      + 'text-align:left;display:none');
    boite.setAttribute('role', 'dialog');
    boite.setAttribute('aria-label', 'Free Games Auto-Claimer');

    var tete = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px');
    tete.appendChild(el('div', 'font-weight:600;font-size:11px;letter-spacing:.02em;color:' + C.ambre,
      'Free Games Auto-Claimer'));
    var fermerBtn = el('button', 'all:initial;cursor:pointer;color:' + C.doux + ';font:18px/1 ' + POLICE
      + ';padding:2px 5px;margin:-4px -6px 0 0;border-radius:6px', '×');
    fermerBtn.type = 'button';
    fermerBtn.addEventListener('click', function () { fermer(); ui.bouton.focus(); });
    survol(fermerBtn, function () { fermerBtn.style.color = C.texte; }, function () { fermerBtn.style.color = C.doux; });
    anneauFocus(fermerBtn, C.ambre);
    tete.appendChild(fermerBtn);
    boite.appendChild(tete);

    var section = 'margin-top:10px;padding-top:10px;border-top:1px solid ' + C.bord;

    var statut = el('div', section + ';display:none;align-items:flex-start;gap:8px');
    var statutPoint = el('span', 'flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%');
    var statutTexte = el('span', 'min-width:0;overflow-wrap:anywhere');
    statut.appendChild(statutPoint);
    statut.appendChild(statutTexte);
    boite.appendChild(statut);

    var faits = el('div', section + ';display:none');
    boite.appendChild(faits);

    var actions = el('div', section + ';display:none');
    var reclamer = el('button', 'all:initial;display:block;box-sizing:border-box;width:100%;padding:8px 10px;'
      + 'border-radius:8px;background:' + C.ambre + ';color:' + C.encre + ';font:600 13px/1.2 ' + POLICE
      + ';text-align:center;cursor:pointer');
    reclamer.type = 'button';
    reclamer.addEventListener('click', function () {
      if (etat.moteur) etat.moteur.claim();
    });
    survol(reclamer, function () { reclamer.style.background = C.ambreClair; }, function () { reclamer.style.background = C.ambre; });
    actions.appendChild(reclamer);

    var auto = el('button', 'all:initial;display:flex;align-items:center;justify-content:space-between;gap:10px;'
      + 'box-sizing:border-box;width:100%;margin-top:8px;padding:4px 0;color:' + C.texte + ';font:13px/1.35 ' + POLICE
      + ';cursor:pointer');
    auto.type = 'button';
    auto.setAttribute('role', 'switch');
    var autoTexte = el('span', 'min-width:0');
    var rail = el('span', 'flex:none;position:relative;width:32px;height:18px;border-radius:9px;transition:background .15s');
    var curseur = el('span', 'position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;'
      + 'background:#fff;transition:transform .15s');
    rail.appendChild(curseur);
    auto.appendChild(autoTexte);
    auto.appendChild(rail);
    auto.addEventListener('click', function () {
      var a = etat.moteur && etat.moteur.auto;
      if (!a) return;
      a.set(!a.get());
      mettreAJour();
    });
    anneauFocus(auto, C.ambre);
    anneauFocus(reclamer, C.texte);
    actions.appendChild(auto);
    boite.appendChild(actions);

    return {
      boite: boite, fermer: fermerBtn, statut: statut, statutPoint: statutPoint, statutTexte: statutTexte,
      faits: faits, actions: actions, reclamer: reclamer, auto: auto, autoTexte: autoTexte, rail: rail, curseur: curseur,
    };
  }

  function detruire() {
    fermer();
    cacherBulle();
    if (pulsation) { pulsation.cancel(); pulsation = null; }
    window.removeEventListener('resize', placer);
    if (hote) hote.remove();
    hote = null;
    ui = {};
  }

  /* ------------------------------------------------------------ rendu */

  function visible() { return !!etat.moteur || etat.lignes.length > 0; }

  function mettreAJour() {
    if (!visible()) { if (hote) detruire(); return; }
    construire();
    if (!hote) return;

    var nom = libelle('button') || 'Free Games Auto-Claimer';
    ui.bouton.setAttribute('aria-label', nom);
    ui.bouton.title = nom;
    ui.bouton.setAttribute('aria-expanded', etat.ouvert ? 'true' : 'false');

    var n = etat.lignes.length;
    ui.pastille.textContent = n ? String(n) : '';
    ui.pastille.style.display = n ? 'block' : 'none';

    var actif = etat.moteur && etat.statut !== 'idle';
    ui.point.style.display = actif ? 'block' : 'none';
    ui.point.style.background = C[etat.statut] || C.idle;
    animer(actif && etat.statut === 'running');

    remplirPanneau();
  }

  function animer(oui) {
    if (!oui) { if (pulsation) { pulsation.cancel(); pulsation = null; } return; }
    if (pulsation || mouvementReduit() || typeof ui.point.animate !== 'function') return;
    pulsation = ui.point.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.45)', opacity: 0.45 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 1200, iterations: Infinity });
  }

  function remplirPanneau() {
    var p = ui.panneau;
    p.fermer.setAttribute('aria-label', libelle('close') || 'Close');
    p.fermer.title = libelle('close');

    /* L'etat du moteur, sauf au repos : « pret » n'apprend rien. */
    var dire = etat.moteur && etat.statut !== 'idle' && etat.message;
    p.statut.style.display = dire ? 'flex' : 'none';
    p.statutPoint.style.background = C[etat.statut] || C.idle;
    p.statutTexte.textContent = dire ? etat.message : '';

    while (p.faits.firstChild) p.faits.removeChild(p.faits.firstChild);
    for (var i = 0; i < etat.lignes.length; i++) {
      p.faits.appendChild(el('div', i ? 'margin-top:4px' : '', etat.lignes[i]));
    }
    p.faits.style.display = etat.lignes.length ? 'block' : 'none';

    p.actions.style.display = etat.moteur ? 'block' : 'none';
    p.reclamer.textContent = libelle('claim') || 'Claim';

    var a = etat.moteur && etat.moteur.auto;
    p.auto.style.display = a ? 'flex' : 'none';
    if (a) {
      var on = !!a.get();
      p.autoTexte.textContent = libelle(a.kind === 'luna' ? 'autoLuna' : 'autoEpic');
      p.auto.setAttribute('aria-checked', on ? 'true' : 'false');
      p.rail.style.background = on ? C.ok : C.eteint;
      p.curseur.style.transform = on ? 'translateX(14px)' : '';
    }

    /* Aucune separation au-dessus de la premiere section visible. */
    var premiere = true;
    var zones = [p.statut, p.faits, p.actions];
    for (var j = 0; j < zones.length; j++) {
      if (zones[j].style.display === 'none') continue;
      zones[j].style.borderTopWidth = premiere ? '0' : '1px';
      zones[j].style.paddingTop = premiere ? '0' : '10px';
      premiere = false;
    }
  }

  /* ------------------------------------------------------------ panneau */

  function ouvrir() {
    if (!hote || etat.ouvert) return;
    cacherBulle();
    etat.ouvert = true;
    var boite = ui.panneau.boite;
    boite.style.maxWidth = Math.max(200, largeur() - TAILLE - MARGE - ECART - 16) + 'px';

    /* Le panneau s'ouvre vers le haut quand le bouton est dans la moitie
       basse, vers le bas sinon : jamais hors de la fenetre. */
    var top = hote.getBoundingClientRect().top;
    var h = hauteur();
    if (top + TAILLE / 2 > h / 2) {
      boite.style.top = 'auto';
      boite.style.bottom = '0';
      boite.style.maxHeight = Math.max(120, top + TAILLE - BORD) + 'px';
    } else {
      boite.style.bottom = 'auto';
      boite.style.top = '0';
      boite.style.maxHeight = Math.max(120, h - top - BORD) + 'px';
    }
    boite.style.display = 'block';
    mettreAJour();
    document.addEventListener('pointerdown', clicDehors, true);
    document.addEventListener('keydown', echap, true);
  }

  function fermer() {
    if (!etat.ouvert) return;
    etat.ouvert = false;
    if (ui.panneau) ui.panneau.boite.style.display = 'none';
    if (ui.bouton) ui.bouton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', clicDehors, true);
    document.removeEventListener('keydown', echap, true);
  }

  /* Un clic dans la racine fermee arrive au document avec l'hote pour cible. */
  function clicDehors(e) {
    if (hote && !hote.contains(e.target)) fermer();
  }

  function echap(e) {
    if (e.key !== 'Escape') return;
    var dedans = document.activeElement === hote;
    fermer();
    if (dedans && ui.bouton) ui.bouton.focus();
  }

  /* ------------------------------------------------------------ bulle */

  function montrerBulle(texte, ton) {
    if (!hote || etat.ouvert || !texte) return;
    var b = ui.bulle;
    b.textContent = texte;
    b.style.borderLeftColor = C[ton] || C.ambre;
    b.style.maxWidth = Math.max(160, Math.min(260, largeur() - TAILLE - MARGE - ECART - 16)) + 'px';
    b.style.display = 'block';
    clearTimeout(minuterieBulle);
    minuterieBulle = setTimeout(cacherBulle, BULLE_MS);
  }

  function cacherBulle() {
    clearTimeout(minuterieBulle);
    minuterieBulle = null;
    if (ui.bulle) ui.bulle.style.display = 'none';
  }

  /* ------------------------------------------------------------ glisser */

  function debutGlisse(e) {
    if (e.button !== 0) return;
    glisse = { y0: e.clientY, top0: hote.getBoundingClientRect().top, bouge: false };
    try { ui.bouton.setPointerCapture(e.pointerId); } catch (x) {}
  }

  function pendantGlisse(e) {
    if (!glisse) return;
    var dy = e.clientY - glisse.y0;
    if (!glisse.bouge && Math.abs(dy) < 5) return;
    if (!glisse.bouge) { glisse.bouge = true; fermer(); cacherBulle(); }
    etat.y = Math.max(0, Math.min(1, (glisse.top0 + dy) / hauteur()));
    placer();
  }

  function finGlisse() {
    if (!glisse) return;
    var bouge = glisse.bouge;
    glisse = null;
    if (!bouge) return;
    sauverPosition();
    /* Le relachement d'un glisser produit aussi un clic : il ne doit pas
       ouvrir le panneau. S'il ne vient pas, le drapeau tombe tout seul. */
    ignorerClic = true;
    setTimeout(function () { ignorerClic = false; }, 0);
  }

  /* ------------------------------------------------------------ le moteur */

  var STATUTS = { idle: 1, running: 1, ok: 1, error: 1 };

  window.FGC_PAGE_UI = {
    /** Le moteur declare ce qu'il sait faire : reclamer, et peut-etre une
        bascule automatique ({ kind: 'epic'|'luna', get, set }). */
    engine: function (spec) {
      var auto = spec && spec.auto;
      etat.moteur = spec && typeof spec.claim === 'function'
        ? {
          claim: spec.claim,
          auto: auto && typeof auto.get === 'function' && typeof auto.set === 'function' ? auto : null,
        }
        : null;
      mettreAJour();
    },

    /** Ou en est le moteur. Une fin (reussite ou echec) s'annonce dans la
        bulle ; le reste attend qu'on ouvre le panneau. */
    status: function (statut, message) {
      etat.statut = STATUTS[statut] ? statut : 'idle';
      etat.message = String(message || '');
      mettreAJour();
      if (etat.moteur && (etat.statut === 'ok' || etat.statut === 'error')) montrerBulle(etat.message, etat.statut);
    },
  };

  /* ------------------------------------------------------------ la fiche */

  /**
   * Le titre du jeu, lu sur la page -- sur les trois magasins dont on sait lire
   * une fiche, et nulle part ailleurs. Un selecteur par magasin, et un repli
   * sur le titre du document : un rapprochement approximatif vaut mieux qu'un
   * silence, puisque le pire qui puisse arriver est de ne rien afficher.
   */
  function storeOfHost() {
    var h = location.hostname;
    if (/^store\.epicgames\.com$/.test(h)) return 'epic';
    if (/(^|\.)gog\.com$/.test(h)) return 'gog';
    if (/^store\.steampowered\.com$/.test(h) && /^\/app\//.test(location.pathname)) return 'steam';
    return null;
  }

  function pageTitle(store) {
    var sel = null;
    if (store === 'epic') sel = 'h1[data-testid="pdp-title"], h1';
    else if (store === 'gog') sel = 'h1.productcard-basics__title, h1';
    else if (store === 'steam') sel = '#appHubAppName, .apphub_AppName, h1';
    if (!sel) return '';

    var n = document.querySelector(sel);
    var texte = n && n.textContent ? n.textContent.replace(/\s+/g, ' ').trim() : '';
    if (texte) return texte;
    /* Le titre du document porte presque toujours le nom du jeu suivi du nom
       du magasin. On coupe au premier separateur usuel. */
    return String(document.title || '').split(/\s+[|–—-]\s+/)[0].trim();
  }

  /**
   * Ce que l'extension sait de cette fiche, et les mots pour le dire.
   *
   * Hors des fiches, la question part sans titre : le worker ne repond alors
   * que les libelles. Un titre vide ne correspond a rien.
   */
  function ask() {
    var store = storeOfHost();
    try {
      api.runtime.sendMessage(
        { type: 'fgc-lookup', title: pageTitle(store), store: store },
        function (reponse) {
          // Le worker peut dormir : une absence de reponse n'est pas une erreur.
          void api.runtime.lastError;
          if (!reponse) return;

          var libelles = {};
          var recus = reponse.labels || {};
          for (var nom in CLES) {
            if (typeof recus[nom] === 'string' && recus[nom]) libelles[nom] = recus[nom];
          }
          etat.libelles = libelles;

          var facts = Array.isArray(reponse.facts) ? reponse.facts : [];
          var lignes = Array.isArray(reponse.lines) && reponse.lines.length === facts.length ? reponse.lines : [];
          etat.lignes = lignes.filter(function (l) { return typeof l === 'string' && l; });

          mettreAJour();
          /* La premiere fois qu'une fiche a quelque chose a dire, on le dit
             une fois, brievement ; ensuite la pastille suffit. */
          if (etat.lignes.length && !etat.bulleFaits) {
            etat.bulleFaits = true;
            montrerBulle(etat.lignes[0], 'ambre');
          }
        },
      );
    } catch (e) { /* contexte invalide apres une mise a jour : on se tait */ }
  }

  lirePosition();

  /* Les magasins rendent leur fiche cote client : le titre n'existe pas encore
     au moment ou ce script s'execute. Une seule relecture differee suffit, et
     elle evite un observateur permanent sur une page qu'on ne possede pas. */
  if (document.readyState === 'complete') ask();
  else window.addEventListener('load', ask, { once: true });
  setTimeout(ask, 2500);
}());
