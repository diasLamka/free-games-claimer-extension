  /* ======================================================================
   * LE NAVIGATEUR ADAPTATIF (2.100.0)
   *
   * Un magasin change ses pages, ses libelles, le NOMBRE d'etapes. GOG n'etait
   * qu'un exemple : sur la fiche d'un jeu en giveaway le bouton est "Go to
   * giveaway", qui mene a une seconde page ou il faut cliquer "Ajouter a la
   * bibliotheque". Un moteur qui ne connait qu'un libelle exact sur la page
   * courante ne trouve rien -- et recommence a ne rien trouver a chaque
   * redesign.
   *
   * Ce module ne cherche donc pas un TEXTE : il LIT LA PAGE.
   *
   *   1. ETAT. A quoi ressemble la page ? connexion demandee, defi de securite,
   *      jeu deja a vous, bouton qui prend le jeu, lien qui MENE au bouton,
   *      fenetre de confirmation, offre terminee, ou rien de net.
   *   2. CHOIX. Parmi les controles visibles, celui dont le SENS colle : un
   *      vocabulaire a poids dans six langues (pas une liste de phrases),
   *      la structure (zone principale, taille, proximite d'un compte a
   *      rebours, hors entete et pied de page), et la memoire (voir plus bas).
   *   3. GARDE-FOUS. Un controle qui parle d'argent, de panier, de paiement, de
   *      liste de souhaits, de partage, de connexion ou de cookies n'est JAMAIS
   *      choisi, quel que soit son score. Un prix non nul dans le libelle non
   *      plus. robustClick refuse encore en dernier recours (libelles payants,
   *      parcours de paiement, arret d'urgence, deuxieme clic sur le meme noeud).
   *   4. VERIFICATION. Un clic n'est un succes que si la page change de la
   *      bonne facon : le bouton disparait ou devient "dans la bibliotheque".
   *      Sinon on relit la page et on decide a nouveau.
   *   5. MEMOIRE. Ce qui a marche est retenu (libelle normalise, par magasin) et
   *      pese plus la fois suivante ; ce qui n'a pas marche pese moins. Un
   *      libelle nouveau, jamais vu, passe quand meme par le sens -- et s'il
   *      reussit, il est appris.
   *   6. REPRISE. Aller d'une page a l'autre decharge le moteur. L'ordre en
   *      cours est donc ecrit dans sessionStorage AVANT de partir, et la page
   *      suivante le reprend (voir startPiloted) : deux pages, trois, la
   *      reclamation reste UNE reclamation, avec son budget.
   *
   * Ce que ce module n'est PAS : un moyen d'acheter. Il ne choisit que des
   * controles qui PRENNENT un jeu gratuit ou qui MENENT a eux, et seulement sur
   * le meme site.
   * ====================================================================== */

  var NAV_ORDER_KEY = 'FGC_nav_order';
  var NAV_MEMORY_PREFIX = 'FGC_nav_';
  var NAV_MEMORY_MAX = 24;
  var NAV_THRESHOLD = 6;
  var NAV_MAX_HOPS = 3;
  var NAV_MAX_STEPS = 8;
  var NAV_POLL_MS = 400;

  /* Une recuperation DEMANDEE (clic de l'utilisateur, ordre force du popup) ne
     se fie pas a la memoire d'historique du moteur. */
  var navForceRecheck = false;

  /* Le vocabulaire : [motif, poids]. Les poids disent a quel point un libelle
     PREND (claim) ou MENE (goto). Ecrit en echappements \uXXXX : le moteur est
     en ASCII pur. */
  var NAV_LEXICON = {
    claim: [
      [/add(ed)? (it |this |the game |game )?to (my |your |the )?(library|collection)/i, 9],
      [/ajouter [a\u00e0] (la |ma |votre |sa )?(biblioth[e\u00e8]que|collection)/i, 9],
      [/biblioth[e\u00e8]que hinzuf[u\u00fc]gen|(zur|in die) (meine |deine )?(bibliothek|sammlung)/i, 9],
      [/a[n\u00f1]adir (a |al? )?(la |mi |tu )?(biblioteca|colecci[o\u00f3]n)/i, 9],
      [/aggiungi (alla|al) (tua |mia )?(libreria|raccolta)/i, 9],
      [/adicionar [a\u00e0] (sua |minha |a )?biblioteca/i, 9],
      [/dodaj do (swojej )?biblioteki/i, 9],
      [/\b(claim|redeem|grab)\b/i, 6],
      [/\bget (it |the game |this )?(for )?free\b|^get( it| game)?$/i, 6],
      [/r[e\u00e9]cup[e\u00e9]r(er|ez)|r[e\u00e9]clam(er|ez)|\bobten(ir|ez)\b|\bpren(dre|ez)\b/i, 6],
      [/\bholen\b|jetzt sichern|kostenlos (holen|sichern|erhalten)/i, 6],
      [/\bconseguir\b|\breclamar\b|\bobtener\b/i, 6],
      [/\briscatta\b|\bottieni\b|\britira\b/i, 6],
      [/\bresgatar\b|\bobter\b/i, 6],
      [/\bodbierz\b|pobierz za darmo/i, 6]
    ],
    goto: [
      [/go to (the )?(giveaway|offer|promo(tion)?|deal)/i, 8],
      [/(aller|acc[e\u00e9]der|retourner|passer) (au |a l|[a\u00e0] l|vers l|vers le |[a\u00e0] la )?(giveaway|concours|offre|promotion|promo)/i, 8],
      [/(voir|d[e\u00e9]couvrir) (le |l)?(giveaway|concours|offre)/i, 7],
      [/zum (giveaway|gewinnspiel|angebot)|zur aktion/i, 8],
      [/ir al? (giveaway|sorteo|oferta|promoci[o\u00f3]n)/i, 8],
      [/vai (al|all) ?(giveaway|omaggio|offerta)/i, 8],
      [/ir para (o |a )?(giveaway|sorteio|oferta)/i, 8],
      [/przejd[z\u017a] do (giveaway|oferty)/i, 8],
      [/\b(giveaway|sorteo|sorteio|verlosung|gewinnspiel|omaggio)\b/i, 3]
    ],
    owned: [
      /\bin (your |my |the )?(library|collection)\b/i,
      /\bdans (la |votre |ma |sa )?(biblioth[e\u00e8]que|collection)\b/i,
      /\bin (der|deiner|ihrer|meiner) (bibliothek|sammlung)\b/i,
      /\ben (la |tu |mi )?(biblioteca|colecci[o\u00f3]n)\b/i,
      /\bnella (tua |mia )?(libreria|raccolta)\b/i,
      /\bna (sua |minha )?biblioteca\b/i,
      /\bw (twojej |mojej )?bibliotece\b/i,
      /\balready (in your library|owned|claimed|added|yours)\b/i,
      /d[e\u00e9]j[a\u00e0] (dans votre biblioth[e\u00e8]que|poss[e\u00e9]d[e\u00e9]|r[e\u00e9]cup[e\u00e9]r[e\u00e9]|ajout[e\u00e9])/i,
      /\b(added to|ajout[e\u00e9]e? [a\u00e0]) (your |votre |la )?(library|biblioth[e\u00e8]que)\b/i,
      /\bim besitz\b|\bbereits (in |im )/i,
      /\ben posesi[o\u00f3]n\b|\bin possesso\b|\bj\u00e1 (est\u00e1 )?na biblioteca/i,
      /^owned$/i,
      /^poss[e\u00e9]d[e\u00e9]$/i
    ],
    confirm: /^(i agree|agree|accept|continue|confirm|ok|got it|j.accepte|accepter|continuer|confirmer|ich stimme zu|zustimmen|weiter|best[a\u00e4]tigen|aceptar|continuar|confirmar|accetto|continua|conferma)$/i,
    ended: /(offer|giveaway|promotion|promo|deal) (has |is |was )?(now )?(ended|over|expired|finished)|no longer available|n.est plus disponible|(offre|giveaway|concours) (est )?(termin[e\u00e9]|expir[e\u00e9]|fini)|angebot (ist )?(abgelaufen|beendet)|oferta (ha )?(terminado|finalizado|expirado)/i
  };

  /* Ce qui n'est JAMAIS cliquable ici, quel que soit le score. */
  var NAV_VETO = [
    /\b(buy|purchase|cart|checkout|pay|payment|subscribe|wishlist|follow|share|trailer|watch|play)\b/i,
    /redeem (a |your )?code|enter (a |your )?code|utiliser un code|activer un code|code einl/i,
    /acheter|panier|commander|payer|paiement|souhait|abonn|partager|suivre|bande-annonce|regarder|jouer/i,
    /kaufen|warenkorb|bezahlen|zahlung|wunschliste|abonnieren|teilen|ansehen/i,
    /comprar|carrito|pagar|deseos|suscrib|compartir|ver tr[a\u00e1]iler/i,
    /acquista|carrello|paga\b|desideri|condividi/i,
    /sign in|log in|login|log out|connexion|se connecter|se d[e\u00e9]connecter|anmelden|abmelden|iniciar sesi|accedi|register|sign up|inscri|cr[e\u00e9]er un compte|newsletter|cookie|privacy|confidentialit|datenschutz|privacidad|terms|conditions|cgu|cgv|unsubscribe|d[e\u00e9]sinscri/i,
    /\b(cancel|close|dismiss|later|decline|no thanks)\b|annuler|fermer|plus tard|non merci|refuser|abbrechen|schlie[s\u00df]en|cerrar|cancelar|chiudi/i
  ];
  var NAV_PRICE = /[$\u20ac\u00a3\u00a5]\s?[1-9]|[1-9]\d*[.,]\d{0,2}\s?[$\u20ac\u00a3\u00a5]|[1-9]\d*\s?(eur|usd|gbp)\b/i;
  var NAV_TIMER = /\d+\s?:\s?\d+\s?:\s?\d+|offer ends|ends in|time left|il vous reste|se termine|verbleibend|quedan|rimangono/i;

  var NAV_CHROME_SEL = 'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [class*="cookie" i], [id*="cookie" i], [class*="consent" i]';
  var NAV_MAIN_SEL = 'main, [role="main"], dialog, [role="dialog"], [aria-modal="true"], [class*="giveaway" i], [id*="giveaway" i]';
  var NAV_LIST_SEL = 'li, [class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="tile" i]';

  function navClosest(el, selector) {
    try { return el && el.closest ? el.closest(selector) : null; } catch (e) { return null; }
  }

  function navVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
  }

  /* Le texte VISIBLE. Le bouton de la fiche GOG (mesure du 2026-10-02) porte
     trois etats dans le meme noeud -- "Check out now", "Go to giveaway", "Buy as a
     gift" -- dont un seul est affiche. textContent les concatene tous, et le
     controle entier tombait sous le veto (payer, acheter) alors que ce qu'on
     voit est "Go to giveaway". innerText ne rend que ce qui est affiche. */
  function navVisibleText(el) {
    if (!el) return '';
    return String(typeof el.innerText === 'string' ? el.innerText : (el.textContent || ''));
  }

  function navText(el) {
    var t = navVisibleText(el).replace(/\s+/g, ' ').trim();
    if (!t && el && el.getAttribute) {
      t = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim();
    }
    return t;
  }

  /* La raison pour laquelle ce libelle est interdit, ou null. */
  function navVetoReason(text) {
    for (var i = 0; i < NAV_VETO.length; i++) {
      if (NAV_VETO[i].test(text)) return String(NAV_VETO[i].source).slice(0, 30);
    }
    if (NAV_PRICE.test(text)) return 'prix';
    return null;
  }

  function navSameSite(host) {
    var a = String(host || '').split('.').slice(-2).join('.');
    var b = String(location.hostname || '').split('.').slice(-2).join('.');
    return !!a && a === b;
  }

  /* Ou mene ce controle : { href, path, sameSite, samePage }, ou null. */
  function navUrl(el) {
    var href = '';
    try {
      var isAnchor = el && el.tagName && String(el.tagName).toLowerCase() === 'a';
      var holder = isAnchor ? el : navClosest(el, 'a[href]');
      href = holder && holder.getAttribute ? (holder.getAttribute('href') || '') : '';
    } catch (e) { href = ''; }
    if (!href || /^(javascript:|mailto:|tel:)/i.test(href)) return null;
    var u;
    try { u = new URL(href, location.href); } catch (e2) { return null; }
    var here;
    try { here = new URL(location.href); } catch (e3) { here = null; }
    return {
      href: u.href,
      path: u.pathname + u.search + u.hash,
      sameSite: navSameSite(u.hostname),
      samePage: !!here && u.origin === here.origin && u.pathname === here.pathname && u.search === here.search
    };
  }

  function navSignature(el) {
    var t = navText(el).toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return t.replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /* ------------------------------------------------------------- memoire */

  function navMemoryRead(platform) {
    try {
      var m = JSON.parse(GM_getValue(NAV_MEMORY_PREFIX + platform, '{}'));
      return m && typeof m === 'object' ? m : {};
    } catch (e) { return {}; }
  }

  function navMemoryWrite(platform, memory) {
    try { GM_setValue(NAV_MEMORY_PREFIX + platform, JSON.stringify(memory)); } catch (e) {}
  }

  /* Retient qu'un controle a (ou n'a pas) fait ce qu'on en attendait. */
  function navLearn(platform, kind, elOrSignature, ok) {
    var sig = typeof elOrSignature === 'string' ? elOrSignature : navSignature(elOrSignature);
    if (!sig) return;
    var memory = navMemoryRead(platform);
    var slot = memory[kind] || (memory[kind] = {});
    var e = slot[sig] || (slot[sig] = { ok: 0, ko: 0, ts: 0 });
    if (ok) e.ok++; else e.ko++;
    e.ts = Date.now();
    var keys = Object.keys(slot);
    if (keys.length > NAV_MEMORY_MAX) {
      keys.sort(function (a, b) { return slot[a].ts - slot[b].ts; });
      for (var i = 0; i < keys.length - NAV_MEMORY_MAX; i++) delete slot[keys[i]];
    }
    navMemoryWrite(platform, memory);
  }

  /* ---------------------------------------------------------------- choix */

  /* Le score d'un controle pour un role ('claim' | 'goto'), ou null s'il ne
     peut pas etre candidat. { score, why, text, veto }. */
  function navScore(el, kind, memory) {
    var text = navText(el);
    if (!text || text.length > 90) return null;
    var veto = navVetoReason(text);
    if (veto) return { score: -99, veto: veto, text: text, why: ['interdit : ' + veto] };

    var lexicon = NAV_LEXICON[kind];
    var best = 0;
    for (var i = 0; i < lexicon.length; i++) {
      if (lexicon[i][0].test(text) && lexicon[i][1] > best) best = lexicon[i][1];
    }
    var why = [];
    var score = best;
    if (best) why.push('sens ' + best);

    var known = memory && memory[kind] && memory[kind][navSignature(el)];
    var learned = !!known && known.ok > known.ko;
    // Un libelle dont le sens n'est dans aucun vocabulaire mais qui a DEJA pris le jeu
    // (ou mene a lui) est compris : la memoire etend le vocabulaire.
    if (!best && learned) { best = 8; score = 8; why.push('appris'); }

    var url = navUrl(el);
    if (kind === 'goto') {
      // Mener AILLEURS que sur ce site n'est pas le travail de ce module.
      if (url && !url.sameSite) return null;
      if (url && url.samePage && !best) return null;
      if (best && url && /giveaway|claim|promo|freebie|free-games|deal/i.test(url.path)) { score += 6; why.push('chemin'); }
    }
    if (score <= 0) return null;

    if (navClosest(el, NAV_CHROME_SEL)) { score -= 4; why.push('entete/pied -4'); }
    if (navClosest(el, NAV_MAIN_SEL)) { score += 2; why.push('zone principale +2'); }
    var area = (el.offsetWidth || 0) * (el.offsetHeight || 0);
    if (area >= 20000) { score += 2; why.push('grand +2'); } else if (area >= 5000) { score += 1; why.push('visible +1'); }
    var cls = String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '');
    if (/primary|cta|claim|giveaway|green|main/i.test(cls)) { score += 1; why.push('classe +1'); }
    var box = el.parentElement;
    for (var d = 0; d < 5 && box; d++, box = box.parentElement) {
      var around = String(box.textContent || '');
      if (around.length < 700 && NAV_TIMER.test(around)) { score += 2; why.push('compte a rebours +2'); break; }
    }
    if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) { score -= 10; why.push('inactif'); }

    if (learned && why.indexOf('appris') === -1) { score += 4; why.push('appris +4'); }
    else if (known && known.ko > known.ok) { score -= 3; why.push('echec -3'); }
    return { score: score, why: why, text: text };
  }

  function navCandidates() {
    var nodes;
    try {
      nodes = Array.prototype.slice.call(document.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]'));
    } catch (e) { nodes = []; }
    return nodes.filter(navVisible);
  }

  /* Le meilleur controle pour un role, ou null sous le seuil. */
  function navBest(kind, memory) {
    var pool = navCandidates();
    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var s = navScore(pool[i], kind, memory);
      if (s && s.score > -50) { s.el = pool[i]; scored.push(s); }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored[0];
    if (!top || top.score < NAV_THRESHOLD) return null;
    top.runnerUp = scored[1] ? scored[1].text + ' (' + scored[1].score + ')' : null;
    return top;
  }

  /* La structure seule (2.100.0). Quand aucun libelle ne dit "prends", mais que la
     page est nettement celle d'un giveaway -- un chemin ou une zone "giveaway",
     un compte a rebours a cote -- et qu'il n'y a qu'UN gros controle permis dans
     la zone principale, c'est lui. Un seul, sinon on ne devine pas. S'il reussit,
     la memoire le retient et la structure n'est plus necessaire. */
  function navInferClaim() {
    var pool = navCandidates().filter(function (el) {
      var text = navText(el);
      if (!text || text.length > 60 || navVetoReason(text)) return false;
      if (navClosest(el, NAV_CHROME_SEL) || !navClosest(el, NAV_MAIN_SEL)) return false;
      if (el.disabled) return false;
      // 148 x 52 : le vrai bouton du bandeau GOG (mesure du 2026-10-02).
      if ((el.offsetWidth || 0) * (el.offsetHeight || 0) < 5000) return false;
      var url = navUrl(el);
      if (url && !url.samePage) return false;
      return true;
    });
    if (pool.length !== 1) return null;
    var el = pool[0];
    var giveawayContext = /giveaway|claim|promo/i.test(location.pathname) || !!navClosest(el, '[class*="giveaway" i], [id*="giveaway" i]');
    if (!giveawayContext) return null;
    var box = el.parentElement;
    for (var d = 0; d < 5 && box; d++, box = box.parentElement) {
      var around = String(box.textContent || '');
      if (around.length < 700 && NAV_TIMER.test(around)) {
        return { el: el, score: NAV_THRESHOLD, text: navText(el), why: ['structure seule : un seul gros controle, giveaway, compte a rebours'] };
      }
    }
    return null;
  }

  /* ----------------------------------------------------------------- etat */

  /* Le jeu est-il deja a vous, ICI ? Un libelle "dans la bibliotheque" ne vaut
     que sur un controle de la zone principale, court, qui n'est ni dans une
     liste, un carrousel ou une vignette, ni un lien vers un autre jeu : la page
     d'un magasin en porte des dizaines qui ne parlent pas de CE jeu. */
  function navOwnedEvidence() {
    var pool = navCandidates();
    for (var i = 0; i < pool.length; i++) {
      var el = pool[i];
      var text = navText(el);
      if (!text || text.length > 40) continue;
      var match = false;
      for (var k = 0; k < NAV_LEXICON.owned.length; k++) {
        if (NAV_LEXICON.owned[k].test(text)) { match = true; break; }
      }
      if (!match) continue;
      if (navClosest(el, NAV_CHROME_SEL) || navClosest(el, NAV_LIST_SEL)) continue;
      var url = navUrl(el);
      // Un lien vers la fiche d'UN AUTRE jeu ne parle pas de celui-ci.
      if (url && !url.samePage && /\/(game|games|product|p)\//i.test(url.path)) continue;
      return el;
    }
    return null;
  }

  function navDialogConfirm(memory) {
    var dialogs;
    try { dialogs = Array.prototype.slice.call(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')); } catch (e) { dialogs = []; }
    for (var i = 0; i < dialogs.length; i++) {
      var dlg = dialogs[i];
      if (!navVisible(dlg)) continue;
      // Un bandeau de cookies ou de consentement n'est pas notre fenetre.
      if (/cookie|consent|privacy|confidentialit|datenschutz|privacidad/i.test(String(dlg.textContent || '').slice(0, 600))) continue;
      var buttons = Array.prototype.slice.call(dlg.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(navVisible);
      for (var j = 0; j < buttons.length; j++) {
        var t = navText(buttons[j]);
        if (NAV_LEXICON.confirm.test(t) && !navVetoReason(t)) return buttons[j];
      }
    }
    return null;
  }

  function navEnded() {
    var scope = document.querySelector('main') || document.body;
    var t = String((scope && scope.textContent) || '').slice(0, 4000);
    return NAV_LEXICON.ended.test(t);
  }

  /* L'etat de la page : { state, el?, score?, why?, detail? }. */
  function navClassify(memory) {
    if (isLikelyLoggedOut()) return { state: 'login' };
    var challenge = detectSecurityChallenge();
    if (challenge) return { state: 'captcha', detail: challenge.detail };
    var confirm = navDialogConfirm(memory);
    if (confirm) return { state: 'confirm', el: confirm, why: ['fenetre de confirmation'] };
    var claim = navBest('claim', memory);
    if (claim) return { state: 'claim', el: claim.el, score: claim.score, why: claim.why, text: claim.text, runnerUp: claim.runnerUp };
    var owned = navOwnedEvidence();
    if (owned) return { state: 'owned', el: owned };
    var go = navBest('goto', memory);
    if (go) return { state: 'goto', el: go.el, score: go.score, why: go.why, text: go.text, runnerUp: go.runnerUp };
    var inferred = navInferClaim();
    if (inferred) return { state: 'claim', el: inferred.el, score: inferred.score, why: inferred.why, text: inferred.text };
    if (navEnded()) return { state: 'ended' };
    return { state: 'unknown' };
  }

  /* Attend que la page dise ce qu'elle est (le rendu est cote client). */
  function navWaitState(memory, timeoutMs) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        var st = navClassify(memory);
        if (st.state !== 'unknown' && st.state !== 'ended') { resolve(st); return; }
        if (Date.now() - t0 >= timeoutMs) { resolve(st); return; }
        setTimeout(poll, NAV_POLL_MS);
      }
      poll();
    });
  }

  /* --------------------------------------------------------------- reprise */

  function navOrderSave(order) {
    try { sessionStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
  }

  function navOrderPending() {
    try {
      var raw = sessionStorage.getItem(NAV_ORDER_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.deadline !== 'number' || Date.now() > o.deadline) return null;
      return o;
    } catch (e) { return null; }
  }

  function navOrderClear() {
    try { sessionStorage.removeItem(NAV_ORDER_KEY); } catch (e) {}
  }

  function navTitle() {
    var el = document.querySelector('.giveaway__title') || document.querySelector('h1');
    var t = el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    return (t || document.title || location.href).slice(0, 160);
  }

  /* ----------------------------------------------------------- orchestrateur */

  /* Mene une reclamation de page en page jusqu'a un verdict :
   *   { outcome, title?, trail[] }
   * outcome : claimed | owned | navigating | ended | login | captcha | refused
   *           | stuck | none | stopped. */
  function navRun(platform, options) {
    options = options || {};
    var memory = navMemoryRead(platform);
    var order = navOrderPending();
    if (order && order.platform !== platform) order = null;
    navOrderClear();
    var hops = order ? order.hops : 0;
    var trail = order && order.trail ? order.trail.slice() : [];
    var steps = 0;
    var clickedClaim = false;
    var clickedConfirm = {};
    var seen = {};

    // La page ou l'on est arrive dit si le lien suivi a valu la peine.
    var arrivedFrom = order && order.lastGoto ? order.lastGoto : null;
    // Le titre du jeu, lu sur la page d'ou l'on vient : celle d'arrivee n'a souvent que le nom du site.
    var carriedTitle = order && order.title ? order.title : null;

    function done(outcome, extra) {
      navOrderClear();
      var r = { outcome: outcome, trail: trail };
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      return Promise.resolve(r);
    }

    function describe(st) {
      return '"' + (st.text || navText(st.el)) + '"' + (st.score !== undefined ? ' (score ' + st.score + ' : ' + (st.why || []).join(', ') + (st.runnerUp ? ' ; suivant ' + st.runnerUp : '') + ')' : '');
    }

    function step() {
      if (emergencyStopped()) return done('stopped');
      steps++;
      if (steps > NAV_MAX_STEPS) return done('stuck');
      return navWaitState(memory, options.stateTimeoutMs || 12000).then(function (st) {
        if (arrivedFrom && (st.state === 'claim' || st.state === 'owned')) {
          navLearn(platform, 'goto', { textContent: arrivedFrom, getAttribute: function () { return null; } }, true);
          arrivedFrom = null;
        }
        if (st.state === 'login') return done('login');
        if (st.state === 'captcha') return done('captcha', { detail: st.detail });
        if (st.state === 'owned') {
          return done(clickedClaim ? 'claimed' : 'owned', { title: carriedTitle || navTitle() });
        }
        if (st.state === 'confirm') {
          var csig = navSignature(st.el);
          if (clickedConfirm[csig]) return done('stuck');
          clickedConfirm[csig] = true;
          log(platform, 'info', 'Navigation : fenetre de confirmation, clic sur "' + navText(st.el) + '".');
          trail.push(navText(st.el));
          if (!robustClick(st.el)) return done('refused', { text: navText(st.el) });
          return waitMs(900).then(step);
        }
        if (st.state === 'claim') return actClaim(st);
        if (st.state === 'goto') return actGoto(st);
        if (st.state === 'ended') return done('ended');
        return done('none', { labels: visibleActionLabels(8) });
      });
    }

    function waitMs(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function actClaim(st) {
      var sig = navSignature(st.el);
      if (seen['claim:' + sig]) {
        // Le meme controle apres un clic : la page n'a pas change comme il faut.
        navLearn(platform, 'claim', sig, false);
        return done('stuck', { text: navText(st.el) });
      }
      seen['claim:' + sig] = true;
      var title = carriedTitle || navTitle();
      // Ou le bouton vivait : si lui disparait, c'est ce coin de page qui dira pourquoi.
      var container = navClosest(st.el, NAV_MAIN_SEL) || st.el.parentElement || null;
      log(platform, 'info', 'Navigation : bouton de recuperation ' + describe(st) + '.');
      trail.push(navText(st.el));
      if (!robustClick(st.el)) return done('refused', { text: navText(st.el) });
      clickedClaim = true;
      return waitMs(1200).then(function () {
        // Le clic a-t-il fait ce qu'il devait ? On relit la page : jeu a vous, fenetre a confirmer, ou autre chose.
        return navWaitState(memory, options.verifyTimeoutMs || 10000);
      }).then(function (after) {
        if (after.state === 'captcha') return done('captcha', { detail: after.detail });
        if (after.state === 'login') return done('login');
        if (after.state === 'owned') {
          navLearn(platform, 'claim', sig, true);
          return done('claimed', { title: title });
        }
        if (after.state === 'confirm' || after.state === 'claim') {
          // Une etape de plus (confirmation) ou le bouton est reste : step() tranche.
          return step();
        }
        // Le bouton lui-meme a pris le libelle "dans la bibliotheque", ou l'endroit ou
        // il vivait le dit maintenant. Un bouton qui DISPARAIT sans rien dire ne suffit
        // pas : une fenetre, un defi peuvent l'avoir recouvert. Dans le doute, ce n'est
        // pas un succes -- le prochain passage verra le jeu "a vous" et le dira.
        if (navOwnedLabel(st.el) || (container && document.body.contains(container) && navOwnedLabel(container))) {
          navLearn(platform, 'claim', sig, true);
          return done('claimed', { title: title });
        }
        navLearn(platform, 'claim', sig, false);
        return step();
      });
    }

    function navOwnedLabel(el) {
      var t = navVisibleText(el).replace(/\s+/g, ' ').trim().slice(0, 500);
      for (var i = 0; i < NAV_LEXICON.owned.length; i++) if (NAV_LEXICON.owned[i].test(t)) return true;
      return false;
    }

    function actGoto(st) {
      if (hops >= NAV_MAX_HOPS) return done('stuck', { text: st.text });
      var url = navUrl(st.el);
      var sig = navSignature(st.el);
      if (seen['goto:' + sig]) return done('stuck', { text: st.text });
      seen['goto:' + sig] = true;
      log(platform, 'info', 'Navigation : lien vers l\'offre ' + describe(st) + (url ? ' -> ' + url.path : '') + '.');
      trail.push(navText(st.el));
      var fromPath = location.pathname + location.search;
      navOrderSave({
        platform: platform, hops: hops + 1, trail: trail.slice(), lastGoto: navText(st.el), title: carriedTitle || navTitle(),
        force: !!options.force, deadline: Date.now() + (options.budgetMs || 5 * 60 * 1000)
      });
      // Un lien vers une autre page se SUIT dans cet onglet (jamais dans un nouveau) ;
      // un bouton se clique, et la page peut changer sans se recharger.
      if (url && url.sameSite && !url.samePage) {
        try { location.assign(url.href); } catch (e) { navOrderClear(); return done('refused', { text: st.text }); }
        return waitMs(15000).then(function () { navOrderClear(); return done('navigating'); });
      }
      if (!robustClick(st.el)) { navOrderClear(); return done('refused', { text: navText(st.el) }); }
      return waitMs(1500).then(function () {
        if (location.pathname + location.search !== fromPath) {
          // Navigation par le routeur de la page, sans rechargement : on continue ici.
          navOrderClear();
          hops++;
        } else {
          navOrderClear();
        }
        return step();
      });
    }

    return step();
  }
