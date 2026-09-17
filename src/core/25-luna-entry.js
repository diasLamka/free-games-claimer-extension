  function runAmazonLunaModule() {
    var PLATFORM = 'Amazon Luna';
    if (lunaModuleRunSince && Date.now() - lunaModuleRunSince < EPIC_MODULE_RUN_STALE_MS) {
      log(PLATFORM, 'info', 'Module Luna deja en cours d\'execution : nouvel appel ignore.');
      return Promise.resolve();
    }
    lunaModuleRunSince = Date.now();
    return runAmazonLunaModuleInner().then(function (r) {
      lunaModuleRunSince = 0;
      return r;
    }, function (err) {
      lunaModuleRunSince = 0;
      if (err && err.message === 'MANUAL_LOGIN_REQUIRED') {
        log(PLATFORM, 'warn', 'Amazon demande une reconnexion : arret, aucune manipulation d\'identifiants. La serie reprendra au prochain chargement de /claims apres connexion.');
        notifyUser('Free Games Claimer -- Amazon Luna', 'Reconnexion Amazon demandee : connectez-vous, la reclamation reprendra ensuite.');
        updateUiState('error', 'Luna : reconnexion Amazon requise');
        return;
      }
      throw err;
    });
  }

  function runAmazonLunaModuleInner() {
    var PLATFORM = 'Amazon Luna';
    log(PLATFORM, 'info', 'Demarrage du module Amazon Luna.');
    updateUiState('running', 'Luna : verification...');

    if (location.hostname.indexOf('gaming.amazon.com') !== -1) {
      log(PLATFORM, 'warn', 'gaming.amazon.com est l\'ancien domaine Prime Gaming, retire depuis le passage a Amazon Luna.');
      notifyUser('Free Games Claimer -- Amazon Luna', 'Domaine obsolete. Rendez-vous sur luna.amazon.com' + CONFIG.lunaClaimsPath + ' (ou votre variante locale, ex. luna.amazon.fr).');
      updateUiState('error', 'Domaine obsolete, allez sur luna.amazon.*');
      return Promise.resolve();
    }

    if (document.querySelector('[data-a-target="sign-in-button"]') || isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session Amazon/Luna non detectee (bouton "Se connecter" visible).');
      notifyUser('Free Games Claimer -- Amazon Luna', 'Connexion Amazon requise : connectez-vous sur Luna, la reclamation demarrera au prochain chargement.');
      updateUiState('error', 'Non connecte sur Amazon');
      return Promise.resolve();
    }

    if (isLunaReauthVisible()) return Promise.reject(new Error('MANUAL_LOGIN_REQUIRED'));

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- Amazon Luna', 'Captcha/2FA Amazon detecte : action manuelle requise.');
      updateUiState('error', 'Captcha/2FA detecte');
      return Promise.resolve();
    }

    if (isLunaOfferDetailPage(location.pathname)) return runLunaDetailPage(PLATFORM);
    if (isLunaClaimsListPage(location.pathname)) return runLunaListPage(PLATFORM);

    log(PLATFORM, 'info', 'Page actuelle (' + location.pathname + ') hors du parcours de reclamation. Rendez-vous sur ' + CONFIG.lunaClaimsPath + '.');
    updateUiState('ok', 'Rendez-vous sur ' + CONFIG.lunaClaimsPath);
    return Promise.resolve();
  }

  function scheduleLunaAutoWatcher() {
    if (location.hostname.indexOf('luna.amazon.') === -1) return;
    var queue = getLunaQueue();
    var finishPending = false;
    try { finishPending = sessionStorage.getItem('FGC_luna_finish_pending') === '1'; } catch (e) {}
    if (!queue.length && !finishPending && getLunaAutoModeEnabled() && autoRunBlocked('Amazon Luna', 'luna')) return;
    if (queue.length || finishPending || getLunaAutoModeEnabled()) {
      if (!queue.length && !finishPending) setAutoCooldown('luna', CONFIG.autoCooldownMs);
      log('Amazon Luna', 'info', queue.length ? 'File Luna en cours (' + queue.length + ' fiche(s)) : reprise automatique.' : 'Mode auto Luna actif : verification des offres.');
      setTimeout(function () {
        updateUiState('running', 'Luna : verification automatique...');
        dispatch();
      }, 2000);
    }
  }

