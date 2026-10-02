  /* ======================================================================
   * APPRENDRE DE VOTRE GESTE (2.101.0), ET LE DEMANDER (2.102.0)
   *
   * Quand un magasin change sa page et que le moteur ne reconnait plus rien, le
   * plus simple est que VOUS recuperiez le jeu a la main, une fois. Ce module
   * regarde, sans rien envoyer nulle part : il retient le libelle ET la forme
   * des controles sur lesquels VOUS avez clique, et -- seulement si la page dit
   * ensuite que le jeu est a vous alors qu'il ne l'etait pas avant votre clic --
   * il les range dans la memoire du navigateur adaptatif (celle de ce magasin,
   * sur cet appareil) : le dernier clic comme "ce qui prend le jeu", celui
   * d'avant, s'il a change de page, comme "ce qui y mene".
   *
   * LE MODE "A APPRENDRE" (2.102.0). Quand le moteur, pilote par la veille, lit
   * la page et ne reconnait aucun bouton, il ne se contente plus d'echouer : il
   * le DIT (verdict needs_teaching), l'onglet est remonte dans votre fenetre, et
   * ce module passe en mode appris pendant dix minutes -- un seul clic suffit,
   * et la preuve (le jeu est a vous) a quatre minutes pour se montrer, parce
   * qu'une commande Epic ou un defi prennent du temps. Une fois appris, le
   * worker est prevenu (fgc-appris), referme l'onglet et reessaie.
   *
   * Ce que cela ne peut PAS faire :
   *   - un clic du moteur (evenement synthetique) n'est jamais une demonstration :
   *     seul un clic de confiance (event.isTrusted) compte ;
   *   - un libelle d'argent, de panier, d'abonnement, d'installation ou de
   *     connexion n'est jamais retenu (memes interdits que le navigateur), ni une
   *     simple confirmation, ni un clic fait sur une page de paiement ;
   *   - la memoire ne fait qu'AJOUTER du sens a un libelle ou a une forme : elle
   *     ne contourne ni les interdits, ni robustClick, ni -- chez Epic -- le
   *     module de paiement, dont les listes sont figees ;
   *   - le moteur ne demande qu'une fois toutes les six heures par magasin ;
   *   - rien ne quitte la page : sessionStorage pour les clics, la memoire
   *     locale du moteur pour ce qui a marche.
   * ====================================================================== */

  var DEMO_KEY = 'FGC_nav_demo';
  var TEACH_KEY = 'FGC_nav_teach';
  var TEACH_ASKED_KEY = 'FGC_teach_asked';
  var DEMO_WINDOW_MS = 90000;
  // Le jeu doit devenir "a vous" peu apres le DERNIER clic : une commande payee a la main, des
  // minutes et des pages plus tard, ne dit rien du bouton qui prend un jeu gratuit.
  var DEMO_EFFECT_MS = 45000;
  var TEACH_WINDOW_MS = 10 * 60000;
  var TEACH_EFFECT_MS = 4 * 60000;
  var TEACH_EVERY_MS = 6 * 3600000;
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

  /* ---------------------------------------------------- le mode "a apprendre" */

  function teachState() {
    try {
      var s = JSON.parse(sessionStorage.getItem(TEACH_KEY) || 'null');
      if (!s || typeof s.until !== 'number' || Date.now() > s.until) return null;
      return s;
    } catch (e) { return null; }
  }

  function teachEnd() {
    try { sessionStorage.removeItem(TEACH_KEY); } catch (e) {}
  }

  /* A-t-on le droit de demander, pour ce magasin ? Une fois toutes les six heures. */
  function teachMayAsk(platform) {
    try {
      var all = JSON.parse(localStorage.getItem(TEACH_ASKED_KEY) || '{}');
      var last = all && typeof all[platform] === 'number' ? all[platform] : 0;
      return Date.now() - last >= TEACH_EVERY_MS;
    } catch (e) { return true; }
  }

  /* Demande a l'utilisateur de montrer le bouton : passe en mode appris. Rend
     false si on a deja demande il y a moins de six heures -- sauf "bypass"
     (l'appli, quand l'utilisateur est devant : il vient de toucher "Recuperer"). */
  function teachBegin(platform, bypass) {
    if (!bypass && !teachMayAsk(platform)) return false;
    try {
      var all = JSON.parse(localStorage.getItem(TEACH_ASKED_KEY) || '{}');
      all[platform] = Date.now();
      localStorage.setItem(TEACH_ASKED_KEY, JSON.stringify(all));
    } catch (e) {}
    try { sessionStorage.setItem(TEACH_KEY, JSON.stringify({ platform: platform, until: Date.now() + TEACH_WINDOW_MS })); } catch (e2) {}
    startDemoLearning();
    log(platform, 'info', 'Bouton non reconnu : en attente de votre clic (dix minutes), le moteur retiendra ce que vous cliquez.');
    return true;
  }

  function teachLearned(platform, label) {
    teachEnd();
    log(platform, 'info', 'Appris : "' + label + '". La recuperation va etre retentee.');
    notifyUser('Free Games Claimer -- ' + platform, uiText('engNotifyLearned', label, platform));
    sendToPilot({ type: 'fgc-appris', plateforme: platform, libelle: String(label).slice(0, 60) });
  }

  /* ---------------------------------------------------------- la demonstration */

  function demoRead() {
    try {
      var list = JSON.parse(sessionStorage.getItem(DEMO_KEY) || '[]');
      if (Object.prototype.toString.call(list) !== '[object Array]') return [];
      var now = Date.now();
      var window_ = teachState() ? TEACH_WINDOW_MS : DEMO_WINDOW_MS;
      return list.filter(function (e) { return e && typeof e.ts === 'number' && now - e.ts <= window_ && typeof e.sig === 'string'; });
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
    // Une page de paiement n'apprend rien : ce qu'on y clique n'est pas ce qui prend un jeu GRATUIT.
    if (/checkout|\/cart|panier|payment|paiement|\/order/i.test(location.pathname)) return;
    var target = ev.target;
    var el = target && typeof target.closest === 'function'
      ? target.closest('button, a[href], [role="button"], input[type="button"], input[type="submit"]')
      : null;
    if (!el) return;
    var text = navText(el);
    if (!text || text.length > 60 || navVetoReason(text)) return;
    // "Continuer", "Accepter", "OK" : des confirmations, deja connues du navigateur comme telles -- pas ce qui prend un jeu.
    if (NAV_LEXICON.confirm.test(text)) return;
    var desc = navDescribe(el);
    if (!desc.sig) return;
    var list = demoRead();
    list.push({ sig: desc.sig, fp: desc.fp, ts: Date.now(), path: location.pathname, ownedBefore: demoOwnedNow(platform) });
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
    if (Date.now() - last.ts > (teachState() ? TEACH_EFFECT_MS : DEMO_EFFECT_MS)) { demoWrite([]); demoStop(); return; }
    // Deja a vous avant le clic : rien n'a ete appris, et il ne faut pas le faire croire.
    if (last.ownedBefore) { demoWrite([]); demoStop(); return; }
    navLearn(platform, 'claim', { sig: last.sig, fp: last.fp || null }, true);
    var learned = '"' + last.sig + '"';
    var before = list.length > 1 ? list[list.length - 2] : null;
    if (before && before.path !== last.path && last.ts - before.ts <= 30000) {
      navLearn(platform, 'goto', { sig: before.sig, fp: before.fp || null }, true);
      learned = '"' + before.sig + '" puis ' + learned;
    }
    log(platform, 'info', 'Appris de votre geste : ' + learned + ' a pris ce jeu. Le moteur le reconnaitra la prochaine fois.');
    if (teachState()) teachLearned(platform, last.sig);
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

  var demoListening = false;

  function startDemoLearning() {
    if (!demoPlatform()) return;
    if (!demoListening) {
      try { document.addEventListener('click', demoOnClick, true); demoListening = true; } catch (e) {}
    }
    // Des clics en attente venus de la page precedente : on reprend la surveillance ici.
    if (demoRead().length) demoArm();
  }
