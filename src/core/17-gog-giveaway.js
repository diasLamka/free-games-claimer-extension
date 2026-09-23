  function runGogModule() {
    var PLATFORM = 'GOG';
    log(PLATFORM, 'info', 'Demarrage du module GOG.');
    updateUiState('running', uiText('engGogChecking'));

    if (isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session GOG non detectee.');
      notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogLogin'));
      updateUiState('error', uiText('engGogNotLoggedIn'));
      return Promise.resolve();
    }

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- GOG', uiText('engNotifySecurityCheck'));
      updateUiState('error', uiText('engCaptcha'));
      return Promise.resolve();
    }

    var claimBtn = findActionElement(document, [/^claim$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i, /add to library/i, /ajouter [a\u00e0] (la|ma|votre) biblioth[e\u00e8]que/i, /^get it free$/i], { label: 'GOG: claim' });

    if (!claimBtn) {
      log(PLATFORM, 'info', 'Aucun bouton de recuperation visible (peut-etre deja reclame, ou pas de giveaway actif, ou le texte du bouton a change).');
      updateUiState('ok', uiText('engGogNoGiveaway'));
      return Promise.resolve();
    }

    var titleEl = document.querySelector('.giveaway__title, h1');
    var title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || location.href;
    if (alreadyHandled(PLATFORM, title)) {
      log(PLATFORM, 'info', 'Deja recupere : ' + title);
      updateUiState('ok', uiText('engAlreadyClaimed'));
      return Promise.resolve();
    }

    return withRetry(function () {
      robustClick(claimBtn);
      return waitForElement(function () {
        return findActionElement(document, [/in library/i, /dans (la|ma|votre) biblioth[e\u00e8]que/i, /owned/i, /d[e\u00e9]j[a\u00e0] poss[e\u00e9]d[e\u00e9]/i, /^voir dans la biblioth[e\u00e8]que$/i], { mustBeEnabled: false, label: 'GOG: confirmation' });
      }, { timeout: 8000 });
    }, { label: 'recuperation GOG (' + title + ')', retries: 3 }).then(function () {
      saveHistoryEntry(PLATFORM, title, 'claimed');
      log(PLATFORM, 'info', 'OK Recupere : ' + title);
      updateUiState('ok', uiText('engGogClaimed', title));
    }).catch(function (err) {
      log(PLATFORM, 'error', 'ECHEC pour "' + title + '" : ' + err.message);
      updateUiState('error', uiText('engGogFailed', title));
    });
  }

