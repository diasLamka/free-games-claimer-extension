  if (!IS_EPIC_PAYMENT_FRAME && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Lancer la recuperation maintenant', function () {
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      epicForceRecheck = true;
      dispatch();
    });
    GM_registerMenuCommand('Relancer maintenant (ignorer le delai)', function () {
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      notifyUser('Free Games Claimer', 'Delai de repos remis a zero : la prochaine verification repart immediatement.');
      epicForceRecheck = true;
      dispatch();
    });
    GM_registerMenuCommand('Etat du delai de repos', function () {
      var e = autoCooldownRemaining('epic');
      var l = autoCooldownRemaining('luna');
      var txt = 'Epic : ' + (e ? 'pause ' + formatDelay(e) : 'pret') + ' | Luna : ' + (l ? 'pause ' + formatDelay(l) : 'pret');
      log('CORE', 'info', txt);
      notifyUser('Free Games Claimer', txt);
    });
    GM_registerMenuCommand('Effacer l\'historique de cette plateforme', function () {
      // L'historique est stocke sous le nom de plateforme ("Epic Games", ...),
      // pas sous le hostname.
      var key = 'FGC_history_' + platformNameForHost(location.hostname);
      GM_setValue(key, '{}');
      try { sessionStorage.removeItem('FGC_epic_redirect_counts'); } catch (e) {}
      clearEpicPendingSlug();
      log('CORE', 'info', 'Historique efface pour la cle "' + key + '".');
      notifyUser('Free Games Claimer', 'Historique local efface pour cette plateforme.');
    });
    if (location.hostname.indexOf('epicgames.com') !== -1) {
      GM_registerMenuCommand('Basculer le mode auto hebdo Epic', function () {
        setEpicAutoModeEnabled(!getEpicAutoModeEnabled());
        notifyUser('Free Games Claimer -- Epic Games', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      GM_registerMenuCommand('Verifier maintenant les jeux gratuits (API)', function () {
        clearAutoCooldown('epic');
        checkEpicWeeklyRotation({ auto: false });
      });
    }
    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      GM_registerMenuCommand('Aller a la page des offres Luna', function () {
        location.assign(location.origin + CONFIG.lunaClaimsPath);
      });
      GM_registerMenuCommand('Basculer le mode auto Luna', function () {
        setLunaAutoModeEnabled(!getLunaAutoModeEnabled());
        notifyUser('Free Games Claimer -- Amazon Luna', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      GM_registerMenuCommand('Vider la file Luna en cours', function () {
        saveLunaQueue([]);
        try { sessionStorage.removeItem('FGC_luna_finish_pending'); sessionStorage.removeItem('FGC_luna_batch'); } catch (e) {}
        notifyUser('Free Games Claimer -- Amazon Luna', 'File Luna videe.');
      });
    }
    if (location.hostname.indexOf('gog.com') !== -1) {
      GM_registerMenuCommand('Echanger les codes GOG en attente', function () {
        if (isGogRedeemPage(location.pathname)) dispatch();
        else location.assign(CONFIG.gogRedeemUrl);
      });
    }
    GM_registerMenuCommand('Voir l\'historique de cette plateforme', function () {
      var platform = platformNameForHost(location.hostname);
      var history = getHistory(platform);
      var keys = Object.keys(history);
      if (!keys.length) {
        log('CORE', 'info', 'Historique vide pour ' + platform + '.');
        notifyUser('Free Games Claimer', 'Aucun historique pour ' + platform + '.');
        return;
      }
      keys.sort(function (a, b) { return (history[b].ts || 0) - (history[a].ts || 0); });
      var lines = keys.map(function (k) {
        var e = history[k];
        return new Date(e.ts || 0).toLocaleString() + ' | ' + e.status + ' | ' + k + (e.reason ? ' | ' + e.reason : '');
      });
      log('CORE', 'info', 'Historique ' + platform + ' (' + keys.length + ' entree(s)) :\n' + lines.join('\n'));
      notifyUser('Free Games Claimer', platform + ' : ' + keys.length + ' entree(s) -- detail dans la console (F12).', 15000);
    });
    GM_registerMenuCommand('Voir les codes en attente', function () {
      var text = describePendingCodes();
      log('CORE', 'info', 'Codes en attente :\n' + text);
      notifyUser('Free Games Claimer -- codes en attente', text, 20000);
    });
    GM_registerMenuCommand('Oublier tous les codes en attente', function () {
      savePendingRedeemCodes([]);
      notifyUser('Free Games Claimer', 'File des codes videe.');
    });
  }

