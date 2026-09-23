/* Le lanceur : ce que l'extension dit et fait sur la page d'un magasin, dans
 * un seul bouton.
 *
 * Jusqu'a la 2.50.0, deux scripts posaient chacun leur boite dans le coin bas
 * droit de la page : le moteur (son etat, « Claim », « Auto hebdo ») et la
 * surcouche des fiches (« deja a vous sur GOG »). Sur une fiche Epic, les deux
 * se chevauchaient, et masquaient ce que la page affichait dessous.
 *
 * Il n'y a plus qu'un element : l'icone de l'extension, qui arrive en glissant
 * depuis le bord de la fenetre. Un clic ouvre un panneau ; un glisser la pose
 * n'importe ou, et la position est retenue. Si le bouton d'une AUTRE extension
 * occupe deja la place, elle se met a cote (2.52.0). Une pastille compte ce
 * qu'il y a a lire, un point dit ou en est le moteur, et une bulle breve
 * annonce ce qui vient d'arriver -- puis s'efface d'elle-meme.
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
  var ECART = 10;
  var BORD = 12;
  var BULLE_MS = 6000;
  var X_DEFAUT = 1;
  var Y_DEFAUT = 0.7;
  /* La recherche d'une place libre : par pas de 16 px, jamais a plus de
     480 px de la place voulue -- au-dela, mieux vaut rester ou l'on est. */
  var PAS = 16;
  var RAYON_MAX = 480;
  /* L'air laisse entre le bouton et celui d'un voisin. */
  var ESPACE = 6;

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
    pos: { x: X_DEFAUT, y: Y_DEFAUT },
    bulleFaits: false,
  };

  var hote = null;
  var ui = {};
  /* Ou le bouton se tient vraiment, en pixels. Ce n'est pas toujours la place
     voulue (etat.pos) : un voisin peut l'occuper. */
  var place = null;
  var minuterieBulle = null;
  var generationBulle = 0;
  var minuterieVoisins = null;
  var observateur = null;
  var pulsation = null;
  var glisse = null;
  var ignorerClic = false;
  var dernierStatut = 'idle';
  /* Jusqu'a quand l'arrivee se joue : la bulle attend qu'elle soit finie. */
  var arriveeJusqua = 0;

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

  /* La fenetre SANS ses barres de defilement : innerWidth les compte, et le
     bouton se posait dessous. clientWidth ne les compte pas -- sauf en mode
     de compatibilite, ou il mesure le document entier ; on garde alors le
     plus petit des deux. */
  function mesure(client, inner, defaut) {
    if (client > 0 && inner > 0) return Math.min(client, inner);
    return client > 0 ? client : inner > 0 ? inner : defaut;
  }
  function hauteur() {
    var d = document.documentElement;
    return mesure(d && d.clientHeight, window.innerHeight, 600);
  }
  function largeur() {
    var d = document.documentElement;
    return mesure(d && d.clientWidth, window.innerWidth, 800);
  }

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

  function borne(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function fraction(v) { return typeof v === 'number' && v >= 0 && v <= 1; }

  /* La place voulue est retenue en FRACTIONS de la zone ou le bouton peut se
     tenir, pas en pixels : une fenetre agrandie ou reduite le garde au meme
     endroit relatif, et jamais dehors. */
  function versPixels(pos) {
    return {
      left: BORD + borne(pos.x, 0, 1) * Math.max(0, largeur() - TAILLE - 2 * BORD),
      top: BORD + borne(pos.y, 0, 1) * Math.max(0, hauteur() - TAILLE - 2 * BORD),
    };
  }

  function versFraction(px) {
    var w = largeur() - TAILLE - 2 * BORD;
    var h = hauteur() - TAILLE - 2 * BORD;
    return {
      x: w > 0 ? borne((px.left - BORD) / w, 0, 1) : X_DEFAUT,
      y: h > 0 ? borne((px.top - BORD) / h, 0, 1) : Y_DEFAUT,
    };
  }

  function dansLaFenetre(px) {
    return {
      left: borne(px.left, BORD, Math.max(BORD, largeur() - TAILLE - BORD)),
      top: borne(px.top, BORD, Math.max(BORD, hauteur() - TAILLE - BORD)),
    };
  }

  /** Le bouton est-il dans la moitie droite ? Le panneau et la bulle s'ouvrent
      alors vers la gauche : du cote ou il y a de la place. */
  function versLaGauche() {
    return place.left - BORD > largeur() - place.left - TAILLE - BORD;
  }

  function poser(px, doux) {
    if (!hote) return;
    place = dansLaFenetre(px);
    hote.style.transition = doux && !mouvementReduit() ? 'left .28s ease,top .28s ease' : 'none';
    hote.style.left = Math.round(place.left) + 'px';
    hote.style.top = Math.round(place.top) + 'px';
  }

  function lirePosition() {
    try {
      api.storage.local.get(KEY_POSITION, function (items) {
        void api.runtime.lastError;
        var p = items && items[KEY_POSITION];
        if (!p || !fraction(p.y)) return;
        // Avant la 2.52.0, seule la hauteur etait retenue : le bouton vivait au bord droit.
        etat.pos = { x: fraction(p.x) ? p.x : X_DEFAUT, y: p.y };
        if (hote) { poser(versPixels(etat.pos), false); adapter(); }
      });
    } catch (e) { /* contexte invalide apres une mise a jour */ }
  }

  function sauverPosition() {
    var o = {};
    o[KEY_POSITION] = { x: Math.round(etat.pos.x * 1000) / 1000, y: Math.round(etat.pos.y * 1000) / 1000 };
    try { api.storage.local.set(o, function () { void api.runtime.lastError; }); } catch (e) {}
  }

  /* ------------------------------------------------------------ les voisins */

  /**
   * D'autres extensions posent, elles aussi, un bouton flottant : Dealabs, un
   * comparateur de prix, une bulle d'aide. Le lanceur ne se pose pas dessus.
   * Si la place voulue est prise, il prend la place libre la plus proche, et
   * il y revient de lui-meme quand le voisin s'en va.
   *
   * On ne voit pas l'interieur des autres extensions : leurs racines d'ombre
   * sont fermees, comme la notre. On voit ce que le navigateur dit d'un point
   * de l'ecran (`elementsFromPoint`). Un point est pris quand ce qui s'y
   * trouve au premier plan FLOTTE :
   *
   *  - fixe, lui ou un parent, et de taille modeste -- un bouton, une bulle,
   *    pas un en-tete pleine largeur ni une fenetre modale, qu'on ne pourrait
   *    de toute facon pas eviter ;
   *  - ou pose a la racine du document et dessinant HORS de sa propre boite :
   *    la signature d'une racine d'ombre au contenu fixe, la facon dont les
   *    extensions s'installent.
   *
   * La page elle-meme -- un texte, une image, un bloc qui defile -- ne compte
   * pas : le bouton reste la ou vous l'avez mis.
   */
  function flottant(e, x, y, memo) {
    if (memo.has(e)) return memo.get(e);
    var oui = false;
    var r = e.getBoundingClientRect();
    var aLaRacine = e.parentNode === document.body || e.parentNode === document.documentElement;
    if (aLaRacine && !(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) {
      oui = true;
    } else {
      for (var n = e; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        var style = null;
        try { style = window.getComputedStyle(n); } catch (err) { break; }
        if (style && style.position === 'fixed') {
          var b = n.getBoundingClientRect();
          oui = b.width <= Math.min(420, largeur() * 0.5) && b.height <= Math.min(420, hauteur() * 0.6);
          break;
        }
      }
    }
    memo.set(e, oui);
    return oui;
  }

  /* Une grille de 4 x 4 points, sur le bouton et sur une marge autour : deux
     boutons ne se touchent pas, et un petit voisin ne passe pas entre deux
     points. */
  function libre(px, memo) {
    if (typeof document.elementsFromPoint !== 'function') return true;
    var cote = TAILLE + 2 * ESPACE;
    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        var x = px.left - ESPACE + (i * cote) / 3;
        var y = px.top - ESPACE + (j * cote) / 3;
        var pile = document.elementsFromPoint(x, y) || [];
        /* Seul compte le premier plan, le lanceur mis a part. */
        for (var k = 0; k < pile.length; k++) {
          var e = pile[k];
          if (e === hote) continue;
          if (e !== document.body && e !== document.documentElement && flottant(e, x, y, memo)) return false;
          break;
        }
      }
    }
    return true;
  }

  /** La place libre la plus proche de celle voulue : le long du meme bord
      d'abord (au-dessus, au-dessous), puis de cote. */
  function placeLibre(voulu) {
    var memo = new Map();
    var depart = dansLaFenetre(voulu);
    if (libre(depart, memo)) return depart;
    for (var r = PAS; r <= RAYON_MAX; r += PAS) {
      var essais = [[0, -r], [0, r], [-r, 0], [r, 0]];
      for (var k = 0; k < essais.length; k++) {
        var c = dansLaFenetre({ left: depart.left + essais[k][0], top: depart.top + essais[k][1] });
        if (libre(c, memo)) return c;
      }
    }
    return depart;
  }

  /**
   * Remettre le bouton a la place libre la plus proche de celle voulue.
   * `retenir` : cette place devient la place voulue (apres un glisser).
   * Jamais pendant un glisser, ni panneau ouvert : il ne bouge pas sous la main.
   */
  function adapter(retenir) {
    clearTimeout(minuterieVoisins);
    minuterieVoisins = null;
    if (!hote || etat.ouvert || glisse) return;
    var cible = placeLibre(versPixels(etat.pos));
    if (!place || Math.abs(cible.left - place.left) > 1 || Math.abs(cible.top - place.top) > 1) poser(cible, true);
    if (retenir === true) { etat.pos = versFraction(cible); sauverPosition(); }
  }

  function planifierAdaptation() {
    clearTimeout(minuterieVoisins);
    minuterieVoisins = setTimeout(adapter, 250);
  }

  /* La fenetre change : le bouton reste dedans tout de suite, et retrouve sa
     place (ou la plus proche de libre) un instant apres. */
  function redimensionner() {
    if (!hote) return;
    poser(place, false);
    planifierAdaptation();
  }

  /* Les voisins arrivent souvent apres nous. Les extensions s'installent a la
     racine du document : on n'observe que CES ajouts-la, jamais la page
     entiere. Certaines s'affichent sans rien ajouter (une classe qui change
     dans leur racine) : deux regards de plus, puis on s'en remet au reste. */
  function surveillerVoisins() {
    window.addEventListener('resize', redimensionner);
    if (typeof MutationObserver === 'function') {
      observateur = new MutationObserver(planifierAdaptation);
      observateur.observe(document.body, { childList: true });
      if (document.documentElement) observateur.observe(document.documentElement, { childList: true });
    }
    setTimeout(planifierAdaptation, 1500);
    setTimeout(planifierAdaptation, 5000);
  }

  /* ------------------------------------------------------------ animations */

  /* Toutes passent par l'API d'animation, pas par une feuille (regle 5), et
     toutes se reduisent a un fondu quand le systeme demande moins de
     mouvement. */
  function animer(n, images, options) {
    if (!n || typeof n.animate !== 'function') return null;
    if (mouvementReduit()) images = [{ opacity: 0 }, { opacity: 1 }];
    try { return n.animate(images, options); } catch (e) { return null; }
  }

  /** L'arrivee : le bouton glisse depuis le bord le plus proche, depasse un peu
      sa place et s'y pose. Assez pour qu'on le remarque, une seule fois. */
  function arrivee() {
    var aGauche = place.left + TAILLE / 2 < largeur() / 2;
    var loin = aGauche ? -(place.left + TAILLE + 8) : largeur() - place.left + 8;
    var rebond = aGauche ? 6 : -6;
    var a = animer(ui.bouton, [
      { transform: 'translateX(' + loin + 'px) scale(.8)', opacity: 0 },
      { transform: 'translateX(' + rebond + 'px) scale(1.06)', opacity: 1, offset: 0.7 },
      { transform: 'translateX(0) scale(1)', opacity: 1 },
    ], { duration: 620, easing: 'cubic-bezier(.2,.9,.25,1)' });
    if (a) arriveeJusqua = Date.now() + 520;
  }

  /** Une pastille ou un point qui apparait : il eclot. */
  function eclore(n, delai) {
    animer(n, [
      { transform: 'scale(0)' }, { transform: 'scale(1.3)', offset: 0.6 }, { transform: 'scale(1)' },
    ], { duration: 300, delay: delai || 0, easing: 'ease-out', fill: 'backwards' });
  }

  /* ------------------------------------------------------------ construction */

  function construire() {
    if (hote) return;
    /* Sans racine d'ombre (navigateur trop ancien), on se tait plutot que
       d'exposer ce qu'on sait dans le DOM de la page. */
    if (!document.body || typeof document.body.attachShadow !== 'function') return;

    hote = document.createElement('div');
    hote.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:' + TAILLE + 'px;height:' + TAILLE
      + 'px;z-index:2147483646';
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

    var bulle = el('div', 'position:absolute;top:50%;transform:translateY(-50%);'
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
    poser(versPixels(etat.pos), false);
    adapter();
    arrivee();
    surveillerVoisins();
  }

  function construirePanneau() {
    var boite = el('div', 'position:absolute;box-sizing:border-box;width:300px;'
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
    cacherBulle(true);
    if (pulsation) { pulsation.cancel(); pulsation = null; }
    window.removeEventListener('resize', redimensionner);
    if (observateur) { observateur.disconnect(); observateur = null; }
    clearTimeout(minuterieVoisins);
    if (hote) hote.remove();
    hote = null;
    place = null;
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
    var avait = ui.pastille.style.display === 'block';
    ui.pastille.textContent = n ? String(n) : '';
    ui.pastille.style.display = n ? 'block' : 'none';
    if (n && !avait) eclore(ui.pastille, 450);

    var actif = etat.moteur && etat.statut !== 'idle';
    ui.point.style.display = actif ? 'block' : 'none';
    ui.point.style.background = C[etat.statut] || C.idle;
    if (actif && etat.statut !== dernierStatut && etat.statut !== 'running') eclore(ui.point, 0);
    dernierStatut = etat.statut;
    pulser(actif && etat.statut === 'running');

    remplirPanneau();
  }

  function pulser(oui) {
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
    cacherBulle(true);
    etat.ouvert = true;
    var boite = ui.panneau.boite;

    /* Du cote ou il y a le plus de place, horizontalement comme verticalement :
       jamais hors de la fenetre, ou que le bouton ait ete pose. */
    var gauche = versLaGauche();
    var dispo = gauche ? place.left - ECART - BORD : largeur() - place.left - TAILLE - ECART - BORD;
    boite.style.left = gauche ? 'auto' : (TAILLE + ECART) + 'px';
    boite.style.right = gauche ? (TAILLE + ECART) + 'px' : 'auto';
    boite.style.maxWidth = Math.max(180, dispo) + 'px';

    var h = hauteur();
    var bas = place.top + TAILLE / 2 > h / 2;
    if (bas) {
      boite.style.top = 'auto';
      boite.style.bottom = '0';
      boite.style.maxHeight = Math.max(120, place.top + TAILLE - BORD) + 'px';
    } else {
      boite.style.bottom = 'auto';
      boite.style.top = '0';
      boite.style.maxHeight = Math.max(120, h - place.top - BORD) + 'px';
    }
    boite.style.transformOrigin = (gauche ? 'right ' : 'left ') + (bas ? 'bottom' : 'top');
    boite.style.display = 'block';
    animer(boite, [{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
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
    /* Le bouton d'abord, la bulle ensuite : pas les deux dans le meme geste. */
    var reste = arriveeJusqua - Date.now();
    if (reste > 0) { setTimeout(function () { arriveeJusqua = 0; montrerBulle(texte, ton); }, reste); return; }
    var b = ui.bulle;
    generationBulle++;
    var gauche = versLaGauche();
    var dispo = gauche ? place.left - ECART - BORD : largeur() - place.left - TAILLE - ECART - BORD;
    b.textContent = texte;
    b.style.borderLeftColor = C[ton] || C.ambre;
    b.style.left = gauche ? 'auto' : (TAILLE + ECART) + 'px';
    b.style.right = gauche ? (TAILLE + ECART) + 'px' : 'auto';
    b.style.maxWidth = Math.max(140, Math.min(260, dispo)) + 'px';
    var deja = b.style.display === 'block';
    b.style.display = 'block';
    if (!deja) {
      animer(b, [
        { opacity: 0, transform: 'translate(' + (gauche ? 8 : -8) + 'px,-50%)' },
        { opacity: 1, transform: 'translate(0,-50%)' },
      ], { duration: 200, easing: 'ease-out' });
    }
    clearTimeout(minuterieBulle);
    minuterieBulle = setTimeout(cacherBulle, BULLE_MS);
  }

  /** `net` : sans fondu (le panneau s'ouvre, le bouton part). */
  function cacherBulle(net) {
    clearTimeout(minuterieBulle);
    minuterieBulle = null;
    var b = ui.bulle;
    if (!b || b.style.display === 'none') return;
    var gen = ++generationBulle;
    var fondu = net === true ? null : animer(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' });
    if (!fondu) { b.style.display = 'none'; return; }
    /* Une bulle montree pendant le fondu ne doit pas etre effacee a sa fin. */
    fondu.onfinish = function () { if (gen === generationBulle) b.style.display = 'none'; };
  }

  /* ------------------------------------------------------------ glisser */

  function debutGlisse(e) {
    if (e.button !== 0 || !place) return;
    glisse = { x0: e.clientX, y0: e.clientY, depart: { left: place.left, top: place.top }, bouge: false };
    try { ui.bouton.setPointerCapture(e.pointerId); } catch (x) {}
  }

  function pendantGlisse(e) {
    if (!glisse) return;
    var dx = e.clientX - glisse.x0;
    var dy = e.clientY - glisse.y0;
    if (!glisse.bouge && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    if (!glisse.bouge) {
      glisse.bouge = true;
      fermer();
      cacherBulle(true);
      ui.bouton.style.cursor = 'grabbing';
    }
    poser({ left: glisse.depart.left + dx, top: glisse.depart.top + dy }, false);
  }

  function finGlisse() {
    if (!glisse) return;
    var bouge = glisse.bouge;
    glisse = null;
    if (!bouge) return;
    ui.bouton.style.cursor = 'pointer';
    /* Lache sur le bouton d'une autre extension : il se pousse a cote, et
       c'est cette place-la qui est retenue. */
    etat.pos = versFraction(place);
    adapter(true);
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

  /* Avant de recharger l'extension, le worker demande si un onglet est en
     pleine reclamation (watch/self-update.js) : recharger couperait le moteur
     de son worker au milieu d'un jeu. Seule l'extension peut poser la
     question -- une page n'a pas acces a runtime.onMessage. */
  try {
    api.runtime.onMessage.addListener(function (msg, expediteur, repondre) {
      if (!msg || msg.type !== 'fgc-occupe') return;
      repondre({ occupe: etat.statut === 'running' });
    });
  } catch (e) { /* contexte invalide apres une mise a jour */ }

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
