  function scheduleEpicAutoWatcher() {
    if (location.hostname.indexOf('epicgames.com') === -1 || IS_EPIC_PAYMENT_FRAME) return;

    if (handleEpicNotFoundLanding()) return;

    // Arrivee sur la fiche produit vers laquelle processNext() a redirige (ou
    // dont la carte a ete cliquee) : on enchaine la reclamation sans attendre
    // un nouveau clic sur "Claim", et on saute la verification immediate pour
    // ne pas lancer deux fois le module.
    var pendingSlug = takeEpicPendingSlug();
    var currentSlug = extractEpicSlug(location.href);
    var landedOnPendingProduct = !!(pendingSlug && currentSlug && pendingSlug === currentSlug);
    if (landedOnPendingProduct) {
      log('Epic Games', 'info', 'Arrivee sur la fiche "' + currentSlug + '" via le script : lancement de la reclamation.');
      setTimeout(function () {
        updateUiState('running', 'Epic : reclamation en cours...');
        runEpicGamesModule();
      }, 2000);
    } else {
      checkEpicWeeklyRotation({ auto: true });
    }

    setInterval(function () { checkEpicWeeklyRotation({ auto: true }); }, CONFIG.epicAutoCheckIntervalMs);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkEpicWeeklyRotation({ auto: true });
    });

    var cameFromAutoRedirect = false;
    try {
      cameFromAutoRedirect = sessionStorage.getItem('FGC_epic_auto_redirect') === '1';
      sessionStorage.removeItem('FGC_epic_auto_redirect');
    } catch (e) {}

    if (cameFromAutoRedirect && /\/free-games/.test(location.pathname)) {
      log('Epic Games', 'info', 'Arrivee via redirection automatique : lancement du claim sans action utilisateur.');
      setTimeout(function () {
        updateUiState('running', 'Auto hebdo : reclamation en cours...');
        runEpicGamesModule();
      }, 2000);
    }
  }

  function waitForEpicPaymentCompletion() {
    epicLauncherModalSeen = false;
    return waitForElement(function () {
      handleEpicPostPurchaseModals();
      if (epicLauncherModalSeen) return document.body;

      var ownershipBtn = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
      if (ownershipBtn) return ownershipBtn;

      var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,p'));
      var thankYou = nodes.find(function (n) {
        return /thank you|merci pour votre commande|order confirm|commande confirmee|ajoute(e)? a votre bibliotheque|added to your library/i.test(n.textContent || '');
      });
      return thankYou || null;
    }, { timeout: CONFIG.epicPaymentCompletionTimeout, interval: 500, label: 'Epic: confirmation de paiement (iframe)' });
  }

  function isEpicGameUnownedOnCurrentPage() {
    var mainCta = findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { mustBeEnabled: true });
    var owned = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
    return !!mainCta && !owned;
  }

