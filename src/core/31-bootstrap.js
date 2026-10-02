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

  var PILOT_SETTLE_MS = 3000;
  var PILOT_DONE_STATUSES = { claimed: true, redeemed: true, code_copied: true, code_pending_gog: true, skipped: true };

  // L'entree d'historique de la fiche ouverte, quand elle est deja traitee.
  //
  // Le verdict pilote est une entree NOUVELLE. Un jeu que le moteur sait deja
  // pris n'en produit aucune -- il n'y a rien a faire -- et l'orchestrateur
  // attendait alors tout son budget pour conclure "failed, delai depasse" :
  // un echec affiche pour un jeu qui est bel et bien au compte.
  function standingEntry(platform, href) {
    var key = null;
    if (platform === 'Epic Games') {
      var slug = extractEpicSlug(href);
      key = slug ? epicHistoryKeyForSlug(slug) : null;
    } else if (platform === 'Amazon Luna') {
      var offerId = extractLunaOfferId(href);
      key = offerId ? lunaHistoryKey(offerId) : null;
    }
    if (!key) return null;
    var e = getHistory(platform)[key];
    if (!e || !PILOT_DONE_STATUSES[e.status]) return null;
    return {
      key: key,
      statusLine: e.status,
      reasonText: e.status === 'claimed' ? 'ALREADY_CLAIMED' : (e.reason || null)
    };
  }

  // Le module a-t-il fini pour de bon ? Rendu depuis PILOT_SETTLE_MS, et
  // aucune execution Epic ou Luna encore en cours : un module deja lance rend
  // tout de resumedOrder une promesse resolue pendant que l'autre travaille encore,
  // et conclure a ce moment-la annoncerait un echec avant la reclamation.
  function pilotSettled(moduleDoneAt, now) {
    return !!moduleDoneAt && now - moduleDoneAt >= PILOT_SETTLE_MS && !epicModuleRunSince && !lunaModuleRunSince;
  }

  // Le motif d'un module fini sans rien noter. Volontairement pas dans les
  // motifs "de notre fait" du canari (watch/canary.js) : un bouton introuvable
  // finit exactement ainsi, et c'est le magasin qui a bouge.
  var PILOT_EMPTY_REASON = 'le module a termine sans rien noter';

  function runClaimOrder(budgetMs, force) {
    var platform = platformNameForHost(location.hostname);
    if (force) navForceRecheck = true;
    /* Une recuperation FORCEE (le geste de l'utilisateur) ne se fie pas a la
       memoire du moteur (2.99.7) : voir epicForceRecheck. */
    if (force && platform === 'Epic Games') {
      epicForceRecheck = true;
      var slugForce = extractEpicSlug(location.href);
      if (slugForce) removeHistoryEntry(platform, epicHistoryKeyForSlug(slugForce));
    }
    var before = historyFingerprint(platform);
    var debut = Date.now();
    var moduleDoneAt = 0;

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

    var markDone = function () { moduleDoneAt = Date.now(); };
    Promise.resolve(dispatch()).then(markDone, markDone);

    var timer = setInterval(function () {
      // Une entree nouvelle d'abord ; a defaut, et seulement une fois le
      // module termine, l'entree deja la. Le delai laisse passer une ecriture
      // tardive, qui dirait mieux ce qui vient de se passer.
      var settled = pilotSettled(moduleDoneAt, Date.now());
      var found = freshEntry(platform, before);
      /* Un defi a l'ecran passe AVANT une entree d'historique deja la (2.99.7) :
         "deja recupere" dit sur une page qui demande un humain, c'est exactement
         ce qui cachait le captcha. Une entree NOUVELLE, elle, est un fait. */
      if (!found && settled && !detectSecurityChallenge()) found = standingEntry(platform, location.href);
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
      // Fini, rien de nouveau, rien de deja traite, pas de defi : c'est un
      // echec, et l'attendre jusqu'au bout du budget -- cinq minutes -- ne
      // changerait que le moment ou on le dit. Meme verdict qu'a l'expiration,
      // pour que le recul et le canari le lisent comme avant.
      if (settled) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: PILOT_EMPTY_REASON, plateforme: platform });
        return;
      }
      if (Date.now() - debut > budgetMs) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'delai depasse', plateforme: platform });
      }
    }, PILOT_POLL_MS);
  }

  // ---------------------------------------------------------------------------
  // Essai a blanc (2.64.0) : lire la page comme pour reclamer, sans cliquer
  // ---------------------------------------------------------------------------
  //
  // Ordonne par le bouton "Tester la recuperation" du popup. Le moteur fait
  // ce qu'il fait avant son premier clic -- session, defi de securite, bouton
  // reconnu -- et s'arrete la. Il rend ce qu'il a vu : le libelle du bouton
  // qu'il aurait clique, ou, faute de mieux, ceux qu'il a vus a la place.
  //
  // C'est la reponse a la question que le canari ne pose qu'apres coup. Le
  // canari compte les echecs de vraies reclamations ; ici, l'utilisateur
  // demande AVANT qu'un jeu soit rate. Le bogue GOG de la 2.62.0 -- chaque
  // jeu pris pour un DLC -- n'aurait pas ete vu ainsi, mais un libelle qui
  // change, la panne la plus frequente du changelog, l'aurait ete.
  //
  // AUCUN CLIC. Ce bloc n'appelle que des lectures : findActionElement,
  // findShortestActionElement, collectLunaOffers, visibleActionLabels,
  // isLikelyLoggedOut, detectSecurityChallenge. Un test verifie que
  // robustClick n'y apparait pas.

  var INSPECT_WAIT_MS = 15000;

  // Ce qu'il faut chercher sur cette page : le signe "deja possede" et le
  // bouton qu'on aurait clique. null quand la page n'est pas une page de
  // reclamation que le moteur connait.
  function inspectionTargets() {
    var host = location.hostname;
    var enabled = function (el) { return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true'; };
    if (host.indexOf('epicgames.com') !== -1) {
      if (isEpicNotFoundPage(location.pathname)) return null;
      return {
        owned: function () { return epicOwnedHere(); },
        claim: function () {
          return findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: true })
            || findActionElement(document, EPIC_MAIN_CTA_PATTERNS)
            || findShortestActionElement(document, EPIC_LIBRARY_LOOSE_PATTERNS)
            // Lecture seule : le bouton que le SENS designerait (libelle inconnu).
            || epicAdaptiveClaimButton('Epic Games');
        }
      };
    }
    if (host.indexOf('gog.com') !== -1) {
      if (isGogRedeemPage(location.pathname)) return null;
      return {
        owned: function () { return navOwnedEvidence(); },
        claim: function () {
          // Lecture seule : le bouton knownButton, sinon celui que le sens designe, sinon le lien qui y mene.
          var knownButton = findActionElement(document, GOG_CLAIM_PATTERNS);
          if (knownButton) return knownButton;
          var memoire = navMemoryRead('GOG');
          var best = navBest('claim', memoire) || navBest('goto', memoire);
          return best ? best.el : null;
        }
      };
    }
    if (host.indexOf('luna.amazon.') !== -1) {
      if (isLunaOfferDetailPage(location.pathname)) {
        var lunaCta = function () {
          var box = document.querySelector('[data-a-target="buy-box"]');
          if (!box) return null;
          return { box: box, cta: box.querySelector('[data-a-target="buy-box_call-to-action"]') || findActionElement(box, LUNA_CLAIM_PATTERNS, { mustBeEnabled: true }) };
        };
        return {
          owned: function () {
            var r = lunaCta();
            return r && !enabled(r.cta) && lunaClaimedText(spacedText(r.box)) ? r.box : null;
          },
          claim: function () {
            var r = lunaCta();
            return r && enabled(r.cta) ? r.cta : null;
          },
          allowed: lunaClaimLabelAllowed
        };
      }
      if (isLunaClaimsListPage(location.pathname)) {
        return {
          owned: function () {
            var offers = collectLunaOffers();
            return offers.length && offers.every(function (o) { return o.collected; }) ? offers[0].card : null;
          },
          claim: function () {
            var offers = collectLunaOffers().filter(function (o) { return !o.collected && o.hasCta; });
            if (!offers.length) return null;
            return offers[0].button || offers[0].card.querySelector('[data-a-target="FGWPOffer"]') || offers[0].card;
          },
          allowed: lunaClaimLabelAllowed
        };
      }
    }
    return null;
  }

  function inspectPage(then) {
    var platform = platformNameForHost(location.hostname);
    function done(verdict, el, extra) {
      var r = { type: 'fgc-inspection', verdict: verdict, plateforme: platform, url: String(location.href).split(/[?#]/)[0] };
      if (el) r.label = actionText(el).slice(0, 80);
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      then(r);
    }

    // Les deux arrets nets de la reclamation, dans le meme ordre.
    if (isLikelyLoggedOut()) { done('needs_login'); return; }
    if (document.querySelector('[data-a-target="sign-in-button"]')
      || (location.hostname.indexOf('luna.amazon.') !== -1 && isLunaReauthVisible())) { done('needs_login'); return; }
    if (detectSecurityChallenge()) { done('challenge'); return; }
    if (location.hostname.indexOf('luna.amazon.') !== -1) rememberLunaHost();

    var targets = inspectionTargets();
    if (!targets) { done('wrong_page', null, { visible: visibleActionLabels(8) }); return; }

    var owned = false;
    waitForElement(function () {
      var o = targets.owned();
      if (o) { owned = true; return o; }
      return targets.claim();
    }, { timeout: INSPECT_WAIT_MS, interval: 500 }).then(function (el) {
      if (owned) { done('owned', el); return; }
      // Les memes garde-fous qu'au clic : un libelle qui parle d'argent, ou
      // que la liste Luna n'autorise pas, aurait ete refuse.
      var text = actionText(el);
      if (looksPaid(text) || (targets.allowed && !targets.allowed(el))) {
        done('refused', el, { visible: visibleActionLabels(8) });
        return;
      }
      done('ready', el);
    }, function () {
      if (detectSecurityChallenge()) { done('challenge'); return; }
      if (isLikelyLoggedOut()) { done('needs_login'); return; }
      done('no_button', null, { visible: visibleActionLabels(8) });
    });
  }

  function listenForOrders() {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg) return;
        if (msg.type === 'fgc-inspecte') {
          sendResponse({ recu: true });
          inspectPage(sendToPilot);
          return true;
        }
        if (msg.type !== 'fgc-reclame') return;
        sendResponse({ recu: true });
        runClaimOrder(msg.budgetMs || 5 * 60 * 1000, msg.force === true);
        return true;
      });
    } catch (e) {}
  }

  function startPiloted() {
    log('CORE', 'info', 'Onglet pilote par la veille : le moteur attend un ordre.');
    listenForOrders();
    sendToPilot({ type: 'fgc-pret', url: location.href });
    /* Une reclamation qui a change de page (2.100.0) : l'ordre a ete ecrit avant
       de partir, et personne ne le renverra a CETTE page -- l'onglet est le meme,
       le verdict attendu aussi. On le reprend ici, avec ce qui reste du budget. */
    var resumedOrder = navOrderPending();
    if (resumedOrder && resumedOrder.platform === platformNameForHost(location.hostname)) {
      log('CORE', 'info', 'Reprise de la reclamation apres changement de page (etape ' + resumedOrder.hops + ').');
      runClaimOrder(Math.max(30000, resumedOrder.deadline - Date.now()), resumedOrder.force === true);
    }
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
      updateUiState('idle', uiText('engReady'));
      scheduleEpicAutoWatcher();
      startEpicPostPurchaseModalWatcher();
      var pauseEpic = autoCooldownRemaining('epic');
      var pauseLuna = autoCooldownRemaining('luna');
      if (pauseEpic || pauseLuna) log('CORE', 'info', 'Delai de repos en cours -- Epic : ' + (pauseEpic ? formatDelay(pauseEpic) : 'pret') + ', Luna : ' + (pauseLuna ? formatDelay(pauseLuna) : 'pret') + '.');
      scheduleLunaAutoWatcher();
      scheduleGogRedeemWatcher();
      startDemoLearning();
    }, 1500);
  }

  // Hook de test (inactif dans Tampermonkey) : expose les fonctions pures
  // (URL Epic, offres Luna, codes GOG) a un harnais Node qui les verifie
  // contre de vraies reponses / de vrais extraits de page.
