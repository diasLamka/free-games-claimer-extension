  function runLunaDetailPage(PLATFORM) {
    var offerUrl = location.href.split('?')[0];
    var offerId = extractLunaOfferId(location.href) || offerUrl;
    var queue = getLunaQueue();
    var inQueue = queue.some(function (o) { return o && o.id === offerId; });
    // Fiche visitee hors serie (file vide, fiche absente de la file) : on ne
    // fait pas avancer la file ni gonfler les compteurs d'un lot inexistant.
    var partOfSeries = inQueue || queue.length > 0;
    function proceed(uiMsg) {
      if (partOfSeries) return advanceLunaQueue(PLATFORM, offerId);
      updateUiState('ok', uiMsg || 'Luna : fiche deja traitee, rien a faire');
    }

    return waitForElement('[data-a-target="buy-box"]', { timeout: CONFIG.lunaOffersWaitTimeout }).catch(function () { return null; }).then(function (buyBox) {
      var details = document.querySelector('[data-a-target="DescriptionItemDetails"]');
      var store = detectLunaStore(location.href, details ? details.textContent : '');
      var titleEl = document.querySelector('[data-a-target="buy-box_title"], h1');
      var title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || document.title;
      var label = lunaStoreLabel(store);
      log(PLATFORM, 'info', 'Fiche : "' + title + '" -> ' + label + ' (' + offerId + ').');

      if (isLunaStoreSkipped(store)) {
        saveHistoryEntry(PLATFORM, lunaHistoryKey(offerId), 'skipped', 'Plateforme ignoree : ' + label);
        if (partOfSeries) bumpLunaBatch('skipped');
        log(PLATFORM, 'info', 'Offre ignoree (plateforme ' + label + ' exclue par configuration) : ' + title);
        return proceed('Luna : plateforme ' + label + ' ignoree');
      }

      if (lunaOfferDone(offerId)) {
        log(PLATFORM, 'info', 'Offre deja traitee : ' + title);
        return proceed();
      }

      if (!buyBox) {
        recordLunaFailure(offerId, 'buy-box introuvable');
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'error', 'Bloc "buy-box" introuvable sur la fiche "' + title + '" (structure de page differente ?).');
        return proceed('Luna : fiche illisible (' + title + ')');
      }

      var cta = buyBox.querySelector('[data-a-target="buy-box_call-to-action"]') || findActionElement(buyBox, LUNA_CLAIM_PATTERNS, { mustBeEnabled: true });
      var boxText = spacedText(buyBox);
      if (!cta || cta.disabled || cta.getAttribute('aria-disabled') === 'true') {
        if (LUNA_CLAIMED_TEXT.test(boxText)) {
          // Magasin a code : le code peut deja etre affiche sur la fiche.
          var lateCode = findLunaRevealedCode();
          if (lateCode && !lunaOfferDone(offerId)) {
            handleLunaClaimOutcome(PLATFORM, offerId, title, store, { type: 'code', code: lateCode });
            return proceed('Luna : code recupere pour ' + title);
          }
          saveHistoryEntry(PLATFORM, lunaHistoryKey(offerId), 'claimed', label + ' (deja reclame)');
          log(PLATFORM, 'info', 'Offre deja reclamee : ' + title);
          return proceed('Luna : deja reclame (' + title + ')');
        }
        recordLunaFailure(offerId, 'bouton "Obtenir le jeu" introuvable ou desactive');
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'warn', 'Bouton "Obtenir le jeu" introuvable ou desactive pour "' + title + '".');
        return proceed('Luna : bouton introuvable (' + title + ')');
      }

      updateUiState('running', 'Luna : ' + title + ' (' + label + ')...');
      log(PLATFORM, 'info', 'Clic sur "' + cta.textContent.trim() + '" pour "' + title + '".');
      // Clic direct (pas de sequence d'evenements synthetiques imitant une
      // interaction humaine) : le but est de declencher l'action pour vous,
      // pas de tromper une detection anti-bot.
      var linkBefore = findLunaLinkAccountElement();
      cta.click();

      return watchLunaClaimOutcome(buyBox, CONFIG.lunaClaimOutcomeTimeout, store, linkBefore).then(function (outcome) {
        handleLunaClaimOutcome(PLATFORM, offerId, title, store, outcome);
        return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax);
      }).then(function () {
        if (inQueue || queue.length) return advanceLunaQueue(PLATFORM, offerId);
        var pendingGog = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        if (pendingGog.length && store === 'gog') {
          notifyUser('Free Games Claimer -- GOG', pendingGog.length + ' code(s) GOG a echanger : la page gog.com/redeem s\'ouvre.');
          openInTab(CONFIG.gogRedeemUrl, true);
        }
      });
    });
  }

  function runLunaListPage(PLATFORM) {
    var finishPending = false;
    try {
      finishPending = sessionStorage.getItem('FGC_luna_finish_pending') === '1';
      sessionStorage.removeItem('FGC_luna_finish_pending');
    } catch (e) {}
    if (finishPending) {
      finishLunaBatch(PLATFORM);
      return Promise.resolve();
    }

    return waitForElement(function () {
      var root = document.querySelector('[data-a-target="offer-list-FGWP_FULL"], [data-a-target="offer-list-FGWP"]');
      if (root && root.querySelector('[data-a-target="item-card"], a[href*="/dp/"]')) return root;
      return document.querySelector('a[data-a-target="FGWPOffer"], button[data-a-target="FGWPOffer"]');
    }, { timeout: CONFIG.lunaOffersWaitTimeout }).catch(function () { return null; }).then(function (root) {
      var offers = collectLunaOffers();
      if (getLunaDlcEnabled()) {
        // Contenu en jeu (DLC, butin) : meme parcours que les jeux.
        var lootRoot = document.querySelector('[data-a-target="offer-list-IN_GAME_LOOT"]');
        if (lootRoot) {
          var loot = collectLunaOffers(lootRoot);
          if (loot.length) log(PLATFORM, 'info', loot.length + ' offre(s) de contenu en jeu detectee(s).');
          offers = offers.concat(loot);
        }
      }
      if (!root && !offers.length) {
        log(PLATFORM, 'info', 'Aucune carte d\'offre trouvee sur la liste (structure differente ou chargement trop long).');
        updateUiState('ok', 'Luna : aucune offre detectee');
        return;
      }
      log(PLATFORM, 'info', offers.length + ' carte(s) FGWP detectee(s).');

      var internal = [];
      var external = [];
      offers.forEach(function (o) {
        if (o.collected) {
          if (!lunaOfferDone(o.id)) saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'claimed', 'deja marque comme recupere sur la liste');
          return;
        }
        if (lunaOfferDone(o.id)) return;
        if (isLunaStoreSkipped(o.store)) {
          saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'skipped', 'Plateforme ignoree : ' + lunaStoreLabel(o.store));
          log(PLATFORM, 'info', 'Ignore (' + lunaStoreLabel(o.store) + ') : ' + o.title);
          return;
        }
        if (o.button) internal.push(o);
        else if (o.url && o.hasCta) external.push(o);
      });

      log(PLATFORM, 'info', internal.length + ' offre(s) directe(s) et ' + external.length + ' fiche(s) a visiter.', external.map(function (o) { return o.title + ' [' + o.store + ']'; }));

      if (!internal.length && !external.length) {
        setAutoCooldown('luna', CONFIG.autoIdleCooldownMs);
      updateUiState('ok', 'Luna : rien de nouveau a reclamer');
        log(PLATFORM, 'info', 'Rien de nouveau a reclamer sur Luna.');
        return;
      }

      saveLunaBatch({ total: internal.length + external.length, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false });

      function claimInternal(index) {
        if (index >= internal.length) return Promise.resolve();
        var o = internal[index];
        updateUiState('running', 'Luna : ' + o.title + '...');
        log(PLATFORM, 'info', 'Reclamation directe sur la liste : ' + o.title);
        o.button.click();
        return waitForElement(function () {
          if (isLunaReauthVisible()) throw new Error('MANUAL_LOGIN_REQUIRED');
          var text = spacedText(o.card);
          return LUNA_CLAIMED_TEXT.test(text) || lunaSuccessVisible(o.card) ? o.card : null;
        }, { timeout: 12000 }).then(function () {
          saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'claimed', 'Amazon Games');
          bumpLunaBatch('claimed');
          log(PLATFORM, 'info', 'OK Reclame : ' + o.title);
        }).catch(function (err) {
          if (err && err.message === 'MANUAL_LOGIN_REQUIRED') throw err;
          recordLunaFailure(o.id, 'confirmation non detectee apres le clic direct');
          bumpLunaBatch('failed');
          log(PLATFORM, 'warn', 'Confirmation non detectee pour "' + o.title + '" apres le clic direct.');
        }).then(function () {
          return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax);
        }).then(function () { return claimInternal(index + 1); });
      }

      return claimInternal(0).then(function () {
        saveLunaQueue(external.map(function (o) { return { id: o.id, url: o.url, title: o.title, store: o.store }; }));
        if (!external.length) {
          finishLunaBatch(PLATFORM);
          return;
        }
        log(PLATFORM, 'info', 'Navigation vers la premiere fiche : ' + external[0].title + ' (' + external[0].url + ')');
        updateUiState('running', 'Luna : ' + external.length + ' fiche(s) a traiter...');
        setTimeout(function () { location.assign(external[0].url); }, 1000);
      });
    });
  }

  var lunaModuleRunSince = 0;

