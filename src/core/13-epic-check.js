  function fetchCurrentEpicFreebies() {
    var urls = CONFIG.epicFreeGamesApiUrls.slice();
    var lastErr = null;

    function tryNext(index) {
      if (index >= urls.length) return Promise.reject(lastErr || new Error('Aucun endpoint freeGamesPromotions accessible.'));
      return gmFetchJson(urls[index]).then(function (data) {
        var elements = (data && data.data && data.data.Catalog && data.data.Catalog.searchStore && data.data.Catalog.searchStore.elements) || [];
        return mapEpicApiElements(elements);
      }).catch(function (e) {
        lastErr = e;
        log('Epic Games', 'warn', 'Echec de l\'appel API freeGamesPromotions sur ' + urls[index] + ' : ' + e.message);
        return tryNext(index + 1);
      });
    }

    return tryNext(0);
  }

  function checkEpicWeeklyRotation(options) {
    options = options || {};
    var auto = !!options.auto;
    if (location.hostname.indexOf('epicgames.com') === -1 || IS_EPIC_PAYMENT_FRAME) return Promise.resolve();
    if (auto && autoRunBlocked('Epic Games', 'epic')) return Promise.resolve();
    if (auto) setAutoCooldown('epic', CONFIG.autoCooldownMs);

    return fetchCurrentEpicFreebies().catch(function (e) {
      log('Epic Games', 'error', 'Verification hebdomadaire impossible : ' + e.message);
      if (auto) setAutoCooldown('epic', CONFIG.autoFailureCooldownMs);
      return null;
    }).then(function (freebies) {
      if (!freebies) return;

      var unclaimed = freebies.filter(function (g) {
        return !alreadyHandled('Epic Games', epicHistoryKeyForSlug(g.slug)) && !isEpicSlugBlocked('Epic Games', g.slug);
      });
      var titles = unclaimed.map(function (g) { return g.title; });
      log('Epic Games', 'info', 'API : ' + freebies.length + ' jeu(x) gratuit(s) cette semaine, ' + unclaimed.length + ' non reclame(s).', titles);

      if (unclaimed.length === 0) {
        if (auto) setAutoCooldown('epic', CONFIG.autoIdleCooldownMs);
        return;
      }

      if (!auto) {
        notifyUser('Free Games Claimer -- Epic Games', unclaimed.length + ' jeu(x) gratuit(s) detecte(s) : ' + titles.join(', ') + '.');
        return;
      }

      if (!getEpicAutoModeEnabled()) {
        log('Epic Games', 'info', 'Mode auto hebdo desactive : notification seule, pas de redirection automatique.');
        notifyUser('Free Games Claimer -- Epic Games', unclaimed.length + ' nouveau(x) jeu(x) gratuit(s) -- mode auto desactive, cliquez sur Claim manuellement.');
        return;
      }

      if (isUserLikelyBusy()) {
        log('Epic Games', 'info', 'Utilisateur probablement occupe (panier/checkout ouvert) : redirection automatique reportee.');
        return;
      }

      if (isLikelyLoggedOut()) {
        log('Epic Games', 'warn', 'Jeux gratuits detectes mais session non connectee : impossible de rediriger/reclamer automatiquement.');
        notifyUser('Free Games Claimer -- Epic Games', 'Nouveaux jeux gratuits disponibles, mais vous devez vous reconnecter.');
        return;
      }

      // Si l'on est deja sur la fiche d'un jeu gratuit non reclame, on le
      // reclame ici plutot que de repartir vers /free-games (sinon la fiche et
      // la liste se renvoient l'une vers l'autre).
      var currentSlugForAuto = extractEpicSlug(location.href);
      var onUnclaimedProductPage = !!currentSlugForAuto && unclaimed.some(function (g) { return g.slug === currentSlugForAuto; });

      if (!/\/free-games/.test(location.pathname) && !onUnclaimedProductPage) {
        log('Epic Games', 'info', 'Redirection automatique vers /free-games pour reclamer les nouveaux jeux detectes par API.');
        try { sessionStorage.setItem('FGC_epic_auto_redirect', '1'); } catch (e) {}
        location.assign(epicStoreUrl('/free-games'));
        return;
      }

      updateUiState('running', 'Auto hebdo : reclamation en cours...');
      return runEpicGamesModule();
    });
  }

  // Atterrissage sur la page "introuvable" du store apres une redirection
  // lancee par le script : on bloque le slug fautif et on revient a la liste.
  function handleEpicNotFoundLanding() {
    if (!isEpicNotFoundPage(location.pathname)) return false;
    var PLATFORM = 'Epic Games';
    var pendingSlug = takeEpicPendingSlug();
    if (!pendingSlug) {
      log(PLATFORM, 'info', 'Page /not-found sans redirection du script en attente : rien a faire.');
      return true;
    }
    // Marqueur residuel (clic de carte traite en navigation SPA, puis arrivee
    // sur /not-found pour une autre raison) : on ne degrade jamais une entree
    // deja reclamee.
    var existing = getHistory(PLATFORM)[epicHistoryKeyForSlug(pendingSlug)];
    if (existing && existing.status === 'claimed') {
      log(PLATFORM, 'info', 'Page /not-found mais "' + pendingSlug + '" est deja reclame : marqueur residuel ignore.');
      return true;
    }
    saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(pendingSlug), 'bad_url', location.href);
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      counts[pendingSlug] = CONFIG.epicMaxRedirectsPerSlug;
      sessionStorage.setItem('FGC_epic_redirect_counts', JSON.stringify(counts));
    } catch (e) {}
    log(PLATFORM, 'error', 'La fiche construite pour le slug "' + pendingSlug + '" n\'existe pas (' + location.href + '). Slug bloque pendant ' + Math.round(CONFIG.epicBadUrlTtlMs / 86400000) + ' jour(s), retour sur /free-games.');
    notifyUser('Free Games Claimer -- Epic Games', 'URL introuvable pour "' + pendingSlug + '". Reclamez ce jeu manuellement depuis la page des jeux gratuits.');
    updateUiState('error', 'URL introuvable : ' + pendingSlug);
    setTimeout(function () { location.assign(epicStoreUrl('/free-games')); }, 1500);
    return true;
  }

