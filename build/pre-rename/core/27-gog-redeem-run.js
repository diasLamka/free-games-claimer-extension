  function getRedeemableGogCodes() {
    return getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; })
      .sort(function (a, b) { return ((a.attempts || 0) - (b.attempts || 0)) || ((a.lastTry || 0) - (b.lastTry || 0)); });
  }

  var gogRedeemRunSince = 0;

  function runGogRedeemModule() {
    if (gogRedeemRunSince && Date.now() - gogRedeemRunSince < EPIC_MODULE_RUN_STALE_MS) {
      log('GOG', 'info', 'Echange GOG deja en cours : nouvel appel ignore.');
      return Promise.resolve();
    }
    gogRedeemRunSince = Date.now();
    return runGogRedeemModuleInner().then(function (r) {
      gogRedeemRunSince = 0;
      return r;
    }, function (err) {
      gogRedeemRunSince = 0;
      throw err;
    });
  }

  function runGogRedeemModuleInner() {
    var PLATFORM = 'GOG';
    var pending = getRedeemableGogCodes();
    var exhausted = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) >= CONFIG.gogRedeemMaxAttempts; });

    if (!pending.length) {
      if (exhausted.length) {
        log(PLATFORM, 'warn', exhausted.length + ' code(s) GOG ont depasse le nombre d\'essais automatiques. A saisir manuellement :\n' + describePendingCodes());
        updateUiState('error', 'GOG : ' + exhausted.length + ' code(s) a saisir manuellement (voir console)');
      } else {
        log(PLATFORM, 'info', 'Aucun code GOG en attente d\'echange.');
        updateUiState('ok', 'GOG : aucun code en attente');
      }
      return Promise.resolve();
    }

    var entry = pending[0];
    log(PLATFORM, 'info', 'Echange du code GOG pour "' + entry.title + '" (' + pending.length + ' en attente, essai ' + ((entry.attempts || 0) + 1) + '/' + CONFIG.gogRedeemMaxAttempts + ').');
    updateUiState('running', 'GOG : echange du code pour ' + entry.title + '...');

    var form = null;
    var submit = null;

    return waitForElement('#codeInput', { timeout: 15000 }).catch(function () {
      throw new Error('Champ #codeInput introuvable sur ' + location.href + ' (page changee ou connexion requise).');
    }).then(function (input) {
      if (isLikelyLoggedOut()) {
        log(PLATFORM, 'warn', 'Session GOG non detectee : connectez-vous sur GOG puis revenez sur ' + CONFIG.gogRedeemUrl + '.');
        notifyUser('Free Games Claimer -- GOG', 'Connectez-vous sur GOG puis rouvrez gog.com/redeem : ' + pending.length + ' code(s) en attente.');
        updateUiState('error', 'GOG : connexion requise');
        return Promise.reject('STOP');
      }
      form = input.closest('form') || document;
      submit = form.querySelector('[type="submit"]') || findActionElement(form, [/^continuer$/i, /^continue$/i, /^valider$/i, /^suivant$/i, /^next$/i], { mustBeEnabled: false });
      if (!submit) throw new Error('Bouton "Continuer" introuvable a cote de #codeInput.');
      setInputValue(input, entry.code);
      updatePendingRedeemCode(entry.code, { attempts: (entry.attempts || 0) + 1, lastTry: Date.now() });
      return sleep(600);
    }).then(function () {
      log(PLATFORM, 'info', 'Code saisi, clic sur "' + (submit.textContent || submit.value || 'Continuer').trim() + '".');
      submit.click();
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, false);
    }).then(function (outcome) {
      if (outcome.type !== 'confirm') return outcome;
      log(PLATFORM, 'info', 'Jeu reconnu par GOG, clic sur "' + (outcome.button.textContent || '').trim() + '" pour l\'ajouter a la bibliotheque.');
      outcome.button.click();
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, true);
    }).then(function (outcome) {
      var remaining;
      if (outcome.type === 'success') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'OK "' + entry.title + '" ajoute a votre bibliotheque GOG. ' + remaining.length + ' code(s) restant(s).');
        notifyUser('Free Games Claimer -- GOG', '"' + entry.title + '" ajoute a votre bibliotheque GOG.');
        updateUiState('ok', 'GOG : ' + entry.title + ' ajoute');
      } else if (outcome.type === 'used') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'already_redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'Le code de "' + entry.title + '" avait deja ete utilise (' + outcome.detail + '). Retire de la file.');
        updateUiState('ok', 'GOG : code deja utilise (' + entry.title + ')');
      } else if (outcome.type === 'captcha') {
        // Un captcha n'est pas un echec du code : on ne compte pas l'essai.
        updatePendingRedeemCode(entry.code, { attempts: entry.attempts || 0 });
        log(PLATFORM, 'warn', 'Captcha GOG visible : validez-le manuellement puis relancez via le menu Tampermonkey ("Echanger les codes GOG en attente").');
        notifyUser('Free Games Claimer -- GOG', 'Captcha GOG : validez-le puis relancez l\'echange (menu Tampermonkey).');
        updateUiState('error', 'GOG : captcha a valider manuellement');
        return;
      } else {
        var attempts = (entry.attempts || 0) + 1;
        if (outcome.type === 'invalid') {
          // Refus deterministe de GOG : inutile de reessayer ce code.
          attempts = CONFIG.gogRedeemMaxAttempts;
          updatePendingRedeemCode(entry.code, { attempts: attempts, lastError: outcome.detail || 'invalid' });
        }
        log(PLATFORM, 'error', 'Echange non confirme pour "' + entry.title + '" (' + outcome.type + (outcome.detail ? ' : ' + outcome.detail : '') + '), essai ' + attempts + '/' + CONFIG.gogRedeemMaxAttempts + '.');
        if (attempts >= CONFIG.gogRedeemMaxAttempts) {
          notifyUser('Free Games Claimer -- GOG', 'Impossible d\'echanger automatiquement le code de "' + entry.title + '" : ' + entry.code + ' (copie dans le presse-papiers). Saisissez-le sur gog.com/redeem.', 20000);
          copyToClipboard(entry.code);
        }
        updateUiState('error', 'GOG : echange non confirme (' + entry.title + ')');
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts && c.code !== entry.code; });
        if (outcome.type === 'timeout') return;
      }
      if (remaining && remaining.length) {
        log(PLATFORM, 'info', 'Rechargement de ' + CONFIG.gogRedeemUrl + ' pour le code suivant.');
        setTimeout(function () { location.assign(CONFIG.gogRedeemUrl); }, 2500);
      }
    }).catch(function (err) {
      if (err === 'STOP') return;
      log(PLATFORM, 'error', 'Erreur pendant l\'echange du code GOG : ' + (err && err.message));
      updateUiState('error', 'GOG : ' + (err && err.message));
    });
  }

  function scheduleGogRedeemWatcher() {
    if (location.hostname.indexOf('gog.com') === -1 || !isGogRedeemPage(location.pathname)) return;
    var pending = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (!pending.length) return;
    log('GOG', 'info', pending.length + ' code(s) GOG en attente : echange automatique dans 2s.');
    setTimeout(function () {
      updateUiState('running', 'GOG : echange automatique des codes...');
      dispatch();
    }, 2000);
  }

