  function lunaListUrl() {
    return location.origin + CONFIG.lunaClaimsPath;
  }

  // Cartes de la page liste -> offres { id, url, title, store, button, card, hasCta, collected }
  function collectLunaOffers(rootEl) {
    var root = rootEl || document.querySelector('[data-a-target="offer-list-FGWP_FULL"]') || document.querySelector('[data-a-target="offer-list-FGWP"]') || document;
    var cards = Array.prototype.slice.call(root.querySelectorAll('[data-a-target="item-card"]'));
    if (!cards.length) {
      var anchors = Array.prototype.slice.call(root.querySelectorAll('a[href*="/claims/"][href*="/dp/"]'));
      var seenCards = [];
      anchors.forEach(function (a) {
        var c = nearestCard(a);
        if (seenCards.indexOf(c) === -1) seenCards.push(c);
      });
      cards = seenCards;
    }
    var seen = {};
    var offers = [];
    cards.forEach(function (card) {
      if (card.querySelector('[data-a-target="LunaOffer"]')) return;
      var link = card.querySelector('a[data-a-target="FGWPOffer"]') || card.querySelector('a[href*="/claims/"][href*="/dp/"]');
      var button = card.querySelector('button[data-a-target="FGWPOffer"]');
      var href = link ? link.href : null;
      var id = extractLunaOfferId(href);
      var text = spacedText(card);
      var hasCta = !!(card.querySelector('[data-a-target="FGWPOffer"]') || findActionElement(card, LUNA_CLAIM_PATTERNS, { mustBeEnabled: false }));
      if (!id && !button) return;
      var key = id || ('card:' + text.slice(0, 60));
      if (seen[key]) return;
      seen[key] = true;
      offers.push({
        id: key,
        url: href ? href.split('?')[0] : null,
        title: cardTitle(card) || text.slice(0, 60),
        store: href ? detectLunaStore(href, '') : 'amazon',
        button: button,
        card: card,
        hasCta: hasCta,
        collected: !hasCta && LUNA_CLAIMED_TEXT.test(text)
      });
    });
    return offers;
  }

  function finishLunaBatch(PLATFORM) {
    var batch = getLunaBatch();
    var summary = 'Luna : ' + batch.claimed + ' reclame(s), ' + batch.codes + ' code(s), ' + batch.skipped + ' ignore(s), ' + batch.failed + ' echec(s)';
    updateUiState(batch.failed > 0 && batch.claimed + batch.codes === 0 ? 'error' : 'ok', summary);
    log(PLATFORM, 'info', 'Serie Luna terminee. ' + summary + '.');
    if (batch.total > 0) notifyUser('Free Games Claimer -- Amazon Luna', summary + '.');
    setAutoCooldown('luna', batch.failed > 0 ? CONFIG.autoFailureCooldownMs : CONFIG.autoIdleCooldownMs);

    var gogCodes = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (gogCodes.length && !batch.gogHandoffDone) {
      batch.gogHandoffDone = true;
      saveLunaBatch(batch);
      log(PLATFORM, 'info', gogCodes.length + ' code(s) GOG en attente : ouverture de ' + CONFIG.gogRedeemUrl + ' pour l\'echange automatique.');
      notifyUser('Free Games Claimer -- GOG', gogCodes.length + ' code(s) GOG a echanger : la page gog.com/redeem s\'ouvre, l\'echange est automatique si vous etes connecte sur GOG.');
      openInTab(CONFIG.gogRedeemUrl, true);
    }
    saveLunaQueue([]);
    // Fin de serie : compteurs remis a zero pour que le lot ne soit pas rejoue
    // lors d'une visite ulterieure d'une fiche hors serie dans ce meme onglet.
    saveLunaBatch({ total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: batch.gogHandoffDone });
  }

  function advanceLunaQueue(PLATFORM, currentId) {
    var queue = getLunaQueue().filter(function (o) { return o && o.id !== currentId; });
    saveLunaQueue(queue);
    if (queue.length) {
      log(PLATFORM, 'info', queue.length + ' fiche(s) restante(s), navigation vers : ' + queue[0].title + ' (' + queue[0].url + ')');
      updateUiState('running', 'Luna : ' + queue.length + ' offre(s) restante(s)...');
      setTimeout(function () { location.assign(queue[0].url); }, 1200);
      return;
    }
    if (!isLunaClaimsListPage(location.pathname)) {
      var batch = getLunaBatch();
      if (batch.total > 0) {
        log(PLATFORM, 'info', 'Derniere fiche traitee, retour sur la liste des offres.');
        try { sessionStorage.setItem('FGC_luna_finish_pending', '1'); } catch (e) {}
        setTimeout(function () { location.assign(lunaListUrl()); }, 1500);
        return;
      }
    }
    finishLunaBatch(PLATFORM);
  }

  function handleLunaClaimOutcome(PLATFORM, offerId, title, store, outcome) {
    var key = lunaHistoryKey(offerId);
    var label = lunaStoreLabel(store);

    if (outcome.type === 'claimed') {
      saveHistoryEntry(PLATFORM, key, 'claimed', label);
      bumpLunaBatch('claimed');
      log(PLATFORM, 'info', 'OK Reclame : "' + title + '" (' + label + ').');
      updateUiState('ok', 'Luna : ' + title + ' reclame');
      return;
    }

    if (outcome.type === 'code') {
      var code = outcome.code;
      var deadline = findLunaCodeDeadline();
      var copied = copyToClipboard(code);
      bumpLunaBatch('codes');
      if (store === 'gog') {
        addPendingRedeemCode({ store: 'gog', code: code, title: title, offerId: offerId, ts: Date.now(), attempts: 0, deadline: deadline });
        // Le FAIT, pas le secret : le code vit dans FGC_pending_codes, qui
        // sait le retirer une fois echange. L'historique, lui, n'est jamais
        // purge et part dans l'export -- un porteur y dormait pour toujours,
        // en double, sans que rien ne le relise.
        saveHistoryEntry(PLATFORM, key, 'code_pending_gog', 'code en attente d\'echange');
        log(PLATFORM, 'info', 'Code GOG pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers)' : '') + '. Echange automatique sur gog.com/redeem a la fin de la serie.');
        updateUiState('ok', 'Luna : code GOG obtenu pour ' + title);
        return;
      }
      addPendingRedeemCode({ store: store, code: code, title: title, offerId: offerId, ts: Date.now(), attempts: CONFIG.gogRedeemMaxAttempts, deadline: deadline });
      saveHistoryEntry(PLATFORM, key, 'code_copied', label + (deadline ? ' (avant le ' + deadline + ')' : ''));
      var redeemUrl = redeemUrlFor(store);
      var msg = 'Code ' + label + ' pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers).' : '.') + (deadline ? ' A utiliser avant le ' + deadline + '.' : '') + (redeemUrl ? ' Collez-le sur ' + redeemUrl : ' Collez-le sur le site de ' + label + '.');
      log(PLATFORM, 'info', msg);
      updateUiState('ok', 'Luna : code ' + label + ' copie (' + title + ')');
      try {
        if (typeof GM_notification === 'function') {
          GM_notification({ title: 'Free Games Claimer -- Amazon Luna', text: msg + (redeemUrl ? ' (cliquez pour ouvrir la page d\'echange)' : ''), timeout: 20000, silent: false, onclick: function () { if (redeemUrl) openInTab(redeemUrl, true); } });
        } else {
          notifyUser('Free Games Claimer -- Amazon Luna', msg, 20000);
        }
      } catch (e) {
        notifyUser('Free Games Claimer -- Amazon Luna', msg, 20000);
      }
      return;
    }

    if (outcome.type === 'needs_link') {
      saveHistoryEntry(PLATFORM, key, 'needs_link', label);
      bumpLunaBatch('skipped');
      log(PLATFORM, 'warn', '"' + title + '" : liaison du compte ' + label + ' requise (parametres Luna > Associer un compte). Offre passee.');
      notifyUser('Free Games Claimer -- Amazon Luna', '"' + title + '" : associez d\'abord votre compte ' + label + ' dans les parametres Luna, puis relancez.');
      updateUiState('error', 'Luna : liaison ' + label + ' requise (' + title + ')');
      return;
    }

    var attempts = recordLunaFailure(offerId, 'Aucun resultat identifiable apres le clic (' + outcome.type + ')');
    bumpLunaBatch('failed');
    log(PLATFORM, 'error', 'ECHEC pour "' + title + '" (' + label + ') : aucun resultat identifiable apres le clic (essai ' + attempts + '/' + CONFIG.lunaMaxAttemptsPerOffer + ').');
    updateUiState('error', 'Luna : echec (' + title + ')');
  }

