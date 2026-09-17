  function dispatch() {
    if (IS_EPIC_PAYMENT_FRAME) {
      runEpicPaymentIframeModule().catch(function (err) {
        log('Epic Payment (iframe)', 'error', 'Erreur non interceptee.', err);
      });
      return;
    }

    var host = location.hostname;
    var result;
    try {
      if (host.indexOf('epicgames.com') !== -1) result = runEpicGamesModule();
      else if (host.indexOf('gog.com') !== -1) result = isGogRedeemPage(location.pathname) ? runGogRedeemModule() : runGogModule();
      else if (host.indexOf('luna.amazon.') !== -1 || host.indexOf('gaming.amazon.com') !== -1) result = runAmazonLunaModule();
      else {
        log('CORE', 'warn', 'Domaine non pris en charge par le dispatcher : ' + host);
        updateUiState('error', 'Domaine non pris en charge');
        return;
      }
      Promise.resolve(result).catch(function (err) {
        // 'STOP' est un arret volontaire deja journalise par le module.
        if (err === 'STOP') return;
        log('CORE', 'error', 'Erreur non interceptee dans un module.', err);
        updateUiState('error', 'Erreur : ' + (err && err.message));
      });
    } catch (err) {
      log('CORE', 'error', 'Erreur non interceptee dans le dispatcher principal.', err);
      updateUiState('error', 'Erreur : ' + err.message);
    }
  }

