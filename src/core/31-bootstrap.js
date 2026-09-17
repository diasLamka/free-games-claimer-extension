  // ---------------------------------------------------------------------------
  // Mode pilote : la veille a ouvert cet onglet
  // ---------------------------------------------------------------------------
  //
  // Ouvert par l'orchestrateur, le moteur ne demarre PAS tout seul : il
  // s'annonce et attend un ordre. Sans cela, deux logiques se disputeraient le
  // meme bouton -- le mode auto habituel et la reclamation pilotee.
  //
  // Seul le service worker connait l'identifiant de cet onglet : c'est donc a
  // lui qu'on pose la question. Sous Tampermonkey, chrome.runtime n'existe pas,
  // la reponse est "non pilote", et rien ne change.
  //
  // Le VERDICT ne demande aucune plomberie nouvelle : les modules ecrivent deja
  // une entree d'historique avec le vocabulaire attendu (claimed, failed,
  // needs_link, bad_url...). Le mode pilote se contente de guetter cette
  // entree, ce qui evite d'instrumenter quatre modules.

  var PILOT_POLL_MS = 500;

  function askIfPiloted(then) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        then(false);
        return;
      }
      chrome.runtime.sendMessage({ type: 'fgc-suis-je-pilote' }, function (rep) {
        try { void chrome.runtime.lastError; } catch (e) {}
        then(!!(rep && rep.piloted));
      });
    } catch (e) {
      then(false);
    }
  }

  function sendToPilot(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        try { void chrome.runtime.lastError; } catch (e) {}
      });
    } catch (e) {}
  }

  // Empreinte de l'historique de la plateforme : sert a reperer l'entree que la
  // reclamation vient d'ecrire, sans savoir a l'avance sous quelle cle.
  function historyFingerprint(platform) {
    var histo = getHistory(platform);
    var fingerprint = {};
    Object.keys(histo).forEach(function (k) {
      fingerprint[k] = (histo[k] && histo[k].ts) || 0;
    });
    return fingerprint;
  }

  function freshEntry(platform, before) {
    var histo = getHistory(platform);
    var keys = Object.keys(histo);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var e = histo[k];
      if (!e || !e.ts) continue;
      if (!(k in before) || e.ts > before[k]) {
        return { key: k, statusLine: e.status, reasonText: e.reason || null, ts: e.ts };
      }
    }
    return null;
  }

  function runClaimOrder(budgetMs) {
    var platform = platformNameForHost(location.hostname);
    var before = historyFingerprint(platform);
    var debut = Date.now();

    // Deux arrets nets, avant meme d'essayer : inutile de cliquer sur une page
    // deconnectee, et un defi de securite demande un humain.
    if (isLikelyLoggedOut()) {
      sendToPilot({ type: 'fgc-verdict', verdict: 'needs_login', plateforme: platform });
      return;
    }
    if (detectSecurityChallenge()) {
      sendToPilot({ type: 'fgc-verdict', verdict: 'challenge', plateforme: platform });
      return;
    }

    dispatch();

    var timer = setInterval(function () {
      var found = freshEntry(platform, before);
      if (found) {
        clearInterval(timer);
        sendToPilot({
          type: 'fgc-verdict',
          verdict: found.statusLine,
          key: found.key,
          reasonText: found.reasonText,
          plateforme: platform
        });
        return;
      }
      if (detectSecurityChallenge()) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'challenge', plateforme: platform });
        return;
      }
      if (Date.now() - debut > budgetMs) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'delai depasse', plateforme: platform });
      }
    }, PILOT_POLL_MS);
  }

  function listenForOrders() {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || msg.type !== 'fgc-reclame') return;
        sendResponse({ recu: true });
        runClaimOrder(msg.budgetMs || 5 * 60 * 1000);
        return true;
      });
    } catch (e) {}
  }

  function startPiloted() {
    log('CORE', 'info', 'Onglet pilote par la veille : le moteur attend un ordre.');
    listenForOrders();
    sendToPilot({ type: 'fgc-pret', url: location.href });
  }

  // run_at document_idle peut injecter le script APRES l'evenement load : un
  // simple addEventListener('load') ne partait alors jamais, et le moteur ne
  // demarrait pas -- page rapide, page en cache, petite iframe de paiement.
  function whenLoaded(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn);
  }

  if (IS_EPIC_PAYMENT_FRAME) {
    whenLoaded(function () { setTimeout(dispatch, 800); });
  } else {
    whenLoaded(function () {
      askIfPiloted(function (piloted) {
        if (piloted) { startPiloted(); return; }
        demarrerNormalement();
      });
    });
  }

  function demarrerNormalement() {
    setTimeout(function () {
      injectFloatingButton();
      updateUiState('idle', 'Pret -- cliquez sur Claim');
      scheduleEpicAutoWatcher();
      startEpicPostPurchaseModalWatcher();
      var pauseEpic = autoCooldownRemaining('epic');
      var pauseLuna = autoCooldownRemaining('luna');
      if (pauseEpic || pauseLuna) log('CORE', 'info', 'Delai de repos en cours -- Epic : ' + (pauseEpic ? formatDelay(pauseEpic) : 'pret') + ', Luna : ' + (pauseLuna ? formatDelay(pauseLuna) : 'pret') + '.');
      scheduleLunaAutoWatcher();
      scheduleGogRedeemWatcher();
    }, 1500);
  }

  // Hook de test (inactif dans Tampermonkey) : expose les fonctions pures
  // (URL Epic, offres Luna, codes GOG) a un harnais Node qui les verifie
  // contre de vraies reponses / de vrais extraits de page.
