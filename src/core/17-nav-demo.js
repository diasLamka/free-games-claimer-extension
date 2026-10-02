  /* ======================================================================
   * APPRENDRE DE VOTRE GESTE (2.101.0)
   *
   * Quand un magasin change sa page et que le moteur ne reconnait plus rien,
   * le plus simple est que VOUS recuperiez le jeu a la main, une fois. Ce module
   * regarde, sans rien envoyer nulle part : il retient le libelle des controles
   * sur lesquels VOUS avez clique, et -- seulement si la page dit ensuite que le
   * jeu est a vous alors qu'il ne l'etait pas avant votre clic -- il les range
   * dans la memoire du navigateur adaptatif (celle de ce magasin, sur cet
   * appareil) : le dernier clic comme "ce qui prend le jeu", celui d'avant,
   * s'il a change de page, comme "ce qui y mene".
   *
   * Ce que cela ne peut PAS faire :
   *   - un clic du moteur (evenement synthetique) n'est jamais une demonstration :
   *     seul un clic de confiance (event.isTrusted) compte ;
   *   - un libelle d'argent, de panier, d'abonnement ou de connexion n'est jamais
   *     retenu (memes interdits que le navigateur) ;
   *   - la memoire ne fait qu'AJOUTER du sens a un libelle : elle ne contourne
   *     ni les interdits, ni robustClick, ni -- chez Epic -- le module de
   *     paiement, dont les listes sont figees ;
   *   - rien ne quitte la page : sessionStorage pour les clics (90 s), la
   *     memoire locale du moteur pour ce qui a marche.
   * ====================================================================== */

  var DEMO_KEY = 'FGC_nav_demo';
  var DEMO_WINDOW_MS = 90000;
  // Le jeu doit devenir "a vous" peu apres le DERNIER clic : une commande payee a la main, des
  // minutes et des pages plus tard, ne dit rien du bouton qui prend un jeu gratuit.
  var DEMO_EFFECT_MS = 45000;
  var DEMO_MAX = 4;
  var DEMO_POLL_MS = 2500;
  var demoTimer = 0;

  function demoPlatform() {
    var name = platformNameForHost(location.hostname);
    return name === 'GOG' || name === 'Epic Games' || name === 'Amazon Luna' ? name : null;
  }

  /* La page dit-elle, MAINTENANT, que le jeu est a vous ? */
  function demoOwnedNow(platform) {
    try {
      if (platform === 'GOG') return !!navOwnedEvidence();
      if (platform === 'Epic Games') return !!epicOwnedHere();
      if (platform === 'Amazon Luna') {
        var box = document.querySelector('[data-a-target="buy-box"]');
        return !!box && lunaClaimedText(spacedText(box));
      }
    } catch (e) {}
    return false;
  }

  function demoRead() {
    try {
      var list = JSON.parse(sessionStorage.getItem(DEMO_KEY) || '[]');
      if (Object.prototype.toString.call(list) !== '[object Array]') return [];
      var now = Date.now();
      return list.filter(function (e) { return e && typeof e.ts === 'number' && now - e.ts <= DEMO_WINDOW_MS && typeof e.sig === 'string'; });
    } catch (e) { return []; }
  }

  function demoWrite(list) {
    try {
      if (list.length) sessionStorage.setItem(DEMO_KEY, JSON.stringify(list.slice(-DEMO_MAX)));
      else sessionStorage.removeItem(DEMO_KEY);
    } catch (e) {}
  }

  /* Un clic de l'utilisateur sur un controle : on retient de quoi il s'agit. */
  function demoOnClick(ev) {
    if (!ev || ev.isTrusted !== true) return;
    var platform = demoPlatform();
    if (!platform) return;
    var target = ev.target;
    var el = target && typeof target.closest === 'function'
      ? target.closest('button, a[href], [role="button"], input[type="button"], input[type="submit"]')
      : null;
    if (!el) return;
    var text = navText(el);
    if (!text || text.length > 60 || navVetoReason(text)) return;
    // "Continuer", "Accepter", "OK" : des confirmations, deja connues du navigateur comme telles -- pas ce qui prend un jeu.
    if (NAV_LEXICON.confirm.test(text)) return;
    var sig = navSignature(el);
    if (!sig) return;
    var list = demoRead();
    list.push({ sig: sig, ts: Date.now(), path: location.pathname, ownedBefore: demoOwnedNow(platform) });
    demoWrite(list);
    demoArm();
  }

  /* Le jeu est-il maintenant a vous ? Alors ces clics ont pris le jeu. */
  function demoCheck() {
    var platform = demoPlatform();
    var list = demoRead();
    if (!platform || !list.length) { demoStop(); return; }
    if (!demoOwnedNow(platform)) return;
    var last = list[list.length - 1];
    if (Date.now() - last.ts > DEMO_EFFECT_MS) { demoWrite([]); demoStop(); return; }
    // Deja a vous avant le clic : rien n'a ete appris, et il ne faut pas le faire croire.
    if (last.ownedBefore) { demoWrite([]); demoStop(); return; }
    navLearn(platform, 'claim', last.sig, true);
    var learned = '"' + last.sig + '"';
    var before = list.length > 1 ? list[list.length - 2] : null;
    if (before && before.path !== last.path && last.ts - before.ts <= 30000) {
      navLearn(platform, 'goto', before.sig, true);
      learned = '"' + before.sig + '" puis ' + learned;
    }
    log(platform, 'info', 'Appris de votre geste : ' + learned + ' a pris ce jeu. Le moteur le reconnaitra la prochaine fois.');
    demoWrite([]);
    demoStop();
  }

  function demoStop() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = 0; }
  }

  function demoArm() {
    if (demoTimer) return;
    demoTimer = setInterval(demoCheck, DEMO_POLL_MS);
  }

  function startDemoLearning() {
    if (!demoPlatform()) return;
    try { document.addEventListener('click', demoOnClick, true); } catch (e) {}
    // Des clics en attente venus de la page precedente : on reprend la surveillance ici.
    if (demoRead().length) demoArm();
  }
