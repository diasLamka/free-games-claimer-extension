  function runEpicPaymentIframeModule() {
    var PLATFORM = 'Epic Payment (iframe)';
    log(PLATFORM, 'info', 'Module iframe de paiement demarre sur ' + location.hostname + '.');

    var confirmPatterns = EPIC_AGREE_PATTERNS.concat(EPIC_LIBRARY_PATTERNS, [/^continue$/i, /^continuer$/i]);

    function stepLoop(step) {
      if (step >= 3) return Promise.resolve();
      var challenge = detectSecurityChallenge();
      if (challenge) {
        log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ') dans l\'iframe de paiement. Arret.', challenge.detail);
        notifyUser('Free Games Claimer -- Epic Games', 'Verification de securite dans le paiement : action manuelle requise.');
        return Promise.resolve();
      }

      return waitForElement(function () {
        return findActionElement(document, confirmPatterns, { label: 'Iframe paiement (etape ' + (step + 1) + ')' });
      }, { timeout: 12000 }).catch(function () { return null; }).then(function (btn) {
        if (!btn) {
          log(PLATFORM, 'info', 'Aucun bouton de confirmation trouve a l\'etape ' + (step + 1) + ' (deja valide, ou structure differente).');
          return;
        }
        var btnText = btn.textContent.trim();
        log(PLATFORM, 'info', 'Clic sur le bouton de confirmation : "' + btnText + '"');
        robustClick(btn);
        return sleep(1500).then(function () {
          if (!EPIC_AGREE_PATTERNS.some(function (p) { return p.test(btnText); })) {
            log(PLATFORM, 'info', 'Confirmation finale envoyee. Le module iframe a termine son role.');
            return;
          }
          return stepLoop(step + 1);
        });
      });
    }

    return stepLoop(0);
  }

  var UI_STATE = { status: 'idle', message: 'Pret' };

