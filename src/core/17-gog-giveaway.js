  /* Les libelles GOG, nommes (2.64.0) : l'essai a blanc les relit sans
     cliquer, et deux copies d'une meme liste finiraient par diverger. */
  var GOG_CLAIM_PATTERNS = [/^claim$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i, /add to library/i, /ajouter [a\u00e0] (la|ma|votre) biblioth[e\u00e8]que/i, /^get it free$/i];
  var GOG_OWNED_PATTERNS = [/in library/i, /dans (la|ma|votre) biblioth[e\u00e8]que/i, /owned/i, /d[e\u00e9]j[a\u00e0] poss[e\u00e9]d[e\u00e9]/i, /^voir dans la biblioth[e\u00e8]que$/i];

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

    /* Le navigateur adaptatif (2.100.0, voir 17-adaptive-nav.js) : la page dit ce
       qu'elle est -- fiche d'un jeu en giveaway ("Go to giveaway"), page du
       giveaway ("Ajouter a la bibliotheque"), jeu deja a vous, fenetre de
       confirmation -- et le moteur suit le route, de page en page, au lieu de
       chercher UN libelle exact sur la page ou il se trouve. */
    var force = navForceRecheck;
    navForceRecheck = false;
    return navRun(PLATFORM, { force: force }).then(function (r) {
      var route = r.trail && r.trail.length ? r.trail.join(' > ') : '';
      switch (r.outcome) {
        case 'claimed':
          saveHistoryEntry(PLATFORM, r.title, 'claimed', 'CLAIMED', r.title);
          log(PLATFORM, 'info', 'OK Recupere : ' + r.title + (route ? ' (' + route + ')' : ''));
          updateUiState('ok', uiText('engGogClaimed', r.title));
          return;
        case 'owned':
          saveHistoryEntry(PLATFORM, r.title, 'claimed', 'ALREADY_OWNED', r.title);
          log(PLATFORM, 'info', 'Deja dans la bibliotheque : ' + r.title);
          updateUiState('ok', uiText('engAlreadyClaimed'));
          return;
        case 'navigating':
          // La page va changer : la suivante reprend l'ordre (startPiloted).
          updateUiState('running', uiText('engGogChecking'));
          return;
        case 'ended':
          log(PLATFORM, 'info', 'L\'offre semble terminee (rien a recuperer).');
          updateUiState('ok', uiText('engGogNoGiveaway'));
          return;
        case 'login':
          log(PLATFORM, 'warn', 'Session GOG non detectee.');
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogLogin'));
          updateUiState('error', uiText('engGogNotLoggedIn'));
          return;
        case 'captcha':
          log(PLATFORM, 'warn', 'Defi de securite detecte (' + (r.detail || 'captcha') + ').');
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifySecurityCheck'));
          updateUiState('error', uiText('engCaptcha'));
          return;
        default:
          // Rien de net, ou un clic sans effet : le diagnostic nomme ce que la page montrait.
          log(PLATFORM, 'warn', 'Aucune etape de recuperation reconnue (' + r.outcome + '). Chemin : ' + (route || 'aucun')
            + '. Boutons visibles : ' + ((r.labels && r.labels.length) ? r.labels.join(' | ') : 'aucun'));
          updateUiState('error', uiText('engGogFailed', navTitle()));
      }
    }).catch(function (err) {
      log(PLATFORM, 'error', 'ECHEC GOG : ' + ((err && err.message) || err));
      updateUiState('error', uiText('engGogFailed', navTitle()));
    });
  }
