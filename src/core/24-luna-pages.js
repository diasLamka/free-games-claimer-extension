  function runLunaDetailPage(PLATFORM) {
    /* L'arret d'urgence coupe la SERIE, pas seulement le clic. Sans ce
       controle, chaque fiche verrait son clic refuse puis naviguerait vers la
       suivante : une serie qui continue en echouant n'est pas un arret. La
       file est conservee telle quelle, pour pouvoir reprendre. */
    if (emergencyStopped()) {
      log(PLATFORM, 'error', 'Arret d\'urgence actif : la serie Luna s\'arrete ici (la file est conservee).');
      updateUiState('error', uiText('engLunaEmergency'));
      return Promise.resolve();
    }

    var offerUrl = location.href.split('?')[0];
    var offerId = extractLunaOfferId(location.href) || offerUrl;
    var queue = getLunaQueue();
    var inQueue = queue.some(function (o) { return o && o.id === offerId; });
    // Fiche visitee hors serie (file vide, fiche absente de la file) : on ne
    // fait pas avancer la file ni gonfler les compteurs d'un lot inexistant.
    var partOfSeries = inQueue || queue.length > 0;
    function proceed(uiMsg) {
      if (partOfSeries) return advanceLunaQueue(PLATFORM, offerId);
      updateUiState('ok', uiMsg || uiText('engLunaPageDone'));
    }

    return waitForElement('[data-a-target="buy-box"]', { timeout: CONFIG.lunaOffersWaitTimeout }).catch(function () { return null; }).then(function (buyBox) {
      var details = document.querySelector('[data-a-target="DescriptionItemDetails"]');
      var store = detectLunaStore(location.href, details ? details.textContent : '');
      var titleEl = document.querySelector('[data-a-target="buy-box_title"], h1');
      var title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || document.title;
      var label = lunaStoreLabel(store);
      log(PLATFORM, 'info', 'Fiche : "' + title + '" -> ' + label + ' (' + offerId + ').');

      if (isLunaStoreSkipped(store)) {
        saveHistoryEntry(PLATFORM, lunaHistoryKey(offerId), 'skipped', 'Plateforme ignoree : ' + label, title);
        if (partOfSeries) bumpLunaBatch('skipped');
        log(PLATFORM, 'info', 'Offre ignoree (plateforme ' + label + ' exclue par configuration) : ' + title);
        return proceed(uiText('engLunaPlatformSkipped', label));
      }

      if (lunaOfferDone(offerId)) {
        var named = {};
        named[lunaHistoryKey(offerId)] = title;
        rememberHistoryTitles(PLATFORM, named);
        log(PLATFORM, 'info', 'Offre deja traitee : ' + title);
        return proceed();
      }

      if (!buyBox) {
        recordLunaFailure(offerId, 'buy-box introuvable', title);
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'error', 'Bloc "buy-box" introuvable sur la fiche "' + title + '" (structure de page differente ?).');
        return proceed(uiText('engLunaPageUnreadable', title));
      }

      /* Le bouton est trouve par son ATTRIBUT, et c'est ce qui rend la
         verification de libelle indispensable : "buy-box_call-to-action" est
         le nom d'un emplacement, pas d'une action. Le jour ou Amazon y rend
         "S'abonner a Luna+" ou "Acheter 19,99 EUR", rien ne l'arretait -- le
         garde-caisse, lui, s'efface sur les magasins eprouves (PROVEN_HOSTS).
         On applique donc ici la regle d'Epic : c'est la LISTE DES LIBELLES
         AUTORISES qui borne le risque, pas le selecteur qui a designe le
         bouton. */
      var cta = buyBox.querySelector('[data-a-target="buy-box_call-to-action"]') || findActionElement(buyBox, LUNA_CLAIM_PATTERNS, { mustBeEnabled: true });
      // Ni l'attribut ni un libelle connu : le sens, dans la boite d'achat seulement.
      if (!cta) {
        var meant = navBest('claim', navMemoryRead(PLATFORM), buyBox);
        if (meant) {
          cta = meant.el;
          log(PLATFORM, 'info', 'Bouton retenu pour son sens : "' + meant.text + '" (score ' + meant.score + ').');
        }
      }
      if (cta && !lunaClaimLabelAllowed(cta)) {
        // La trace : ce libelle devient une proposition dans l'interface, au
        // lieu d'une ligne de journal que personne ne peut utiliser.
        noteSeenLabel('luna', actionText(cta));
        recordLunaFailure(offerId, 'libelle inattendu sur le bouton principal : "' + actionText(cta) + '"', title);
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'warn', 'Bouton principal non reconnu pour "' + title + '" : "' + actionText(cta)
          + '". Rien n\'est clique. Boutons visibles : ' + (visibleActionLabels(8).join(' | ') || 'aucun'));
        return proceed(uiText('engLunaUnexpectedLabel', title));
      }
      var boxText = spacedText(buyBox);
      if (!cta || cta.disabled || cta.getAttribute('aria-disabled') === 'true') {
        if (lunaClaimedText(boxText)) {
          // Magasin a code : le code peut deja etre affiche sur la fiche.
          var lateCode = findLunaRevealedCode();
          if (lateCode && !lunaOfferDone(offerId)) {
            handleLunaClaimOutcome(PLATFORM, offerId, title, store, { type: 'code', code: lateCode });
            return proceed(uiText('engLunaCodeReceived', title));
          }
          // Deja pris avant nous -- plus tot, a la main, ou depuis un autre
          // ordinateur : c'est un constat, pas une reclamation. Le motif le dit,
          // et le popup affiche "deja recupere" au lieu de "recupere".
          saveHistoryEntry(PLATFORM, lunaHistoryKey(offerId), 'claimed', 'ALREADY_CLAIMED', title);
          log(PLATFORM, 'info', 'Offre deja reclamee : ' + title);
          return proceed(uiText('engLunaAlreadyClaimed', title));
        }
        recordLunaFailure(offerId, 'bouton "Obtenir le jeu" introuvable ou desactive', title);
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'warn', 'Bouton "Obtenir le jeu" introuvable ou desactive pour "' + title + '".');
        return proceed(uiText('engLunaButtonMissing', title));
      }

      updateUiState('running', uiText('engLunaWorkingOn', title, label));
      log(PLATFORM, 'info', 'Clic sur "' + actionText(cta) + '" pour "' + title + '".');
      /* Par robustClick, comme Epic.
         L'ancien commentaire justifiait le clic direct par une posture -- ne
         pas imiter un humain. Elle ne tient plus : robustClick n'est pas un
         deguisement, c'est le GOULOT ou vivent l'arret d'urgence, le refus des
         libelles payants et l'anti-rafale. Tant que ce parcours l'evitait, le
         bouton d'arret d'urgence ne pouvait pas interrompre une serie Luna. */
      var linkBefore = findLunaLinkAccountElement();
      var ctaSignature = navDescribe(cta);
      if (!robustClick(cta)) {
        recordLunaFailure(offerId, 'clic refuse par les garde-fous', title);
        if (partOfSeries) bumpLunaBatch('failed');
        log(PLATFORM, 'warn', 'Clic refuse pour "' + title + '" (arret d\'urgence, libelle payant ou reclic). Rien n\'a ete tente.');
        return proceed(uiText('engLunaClickRefused', title));
      }

      return watchLunaClaimOutcome(buyBox, CONFIG.lunaClaimOutcomeTimeout, store, linkBefore).then(function (outcome) {
        // Le libelle qui vient de prendre un jeu pese plus la prochaine fois ; un echec, moins.
        if (outcome.type === 'claimed' || outcome.type === 'code') navLearn(PLATFORM, 'claim', ctaSignature, true);
        else if (outcome.type === 'timeout') navLearn(PLATFORM, 'claim', ctaSignature, false);
        handleLunaClaimOutcome(PLATFORM, offerId, title, store, outcome);
        return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax);
      }).then(function () {
        if (inQueue || queue.length) return advanceLunaQueue(PLATFORM, offerId);
        var pendingGog = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        if (pendingGog.length && store === 'gog') {
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogCodesOpenShort', pendingGog.length));
          openInTab(gogRedeemUrl(), true);
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
        updateUiState('ok', uiText('engLunaNoOffer'));
        return;
      }
      log(PLATFORM, 'info', offers.length + ' carte(s) FGWP detectee(s).');

      var internal = [];
      var external = [];
      // Les offres deja connues recoivent leur titre au passage : les entrees
      // ecrites avant qu'il soit note s'affichaient "Amazon Luna".
      var named = {};
      offers.forEach(function (o) {
        if (o.collected) {
          // Deja pris avant ce passage : ALREADY_CLAIMED, pas une reclamation.
          if (!lunaOfferDone(o.id)) saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'claimed', 'ALREADY_CLAIMED', o.knownTitle);
          else named[lunaHistoryKey(o.id)] = o.knownTitle;
          return;
        }
        if (lunaOfferDone(o.id)) { named[lunaHistoryKey(o.id)] = o.knownTitle; return; }
        if (isLunaStoreSkipped(o.store)) {
          saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'skipped', 'Plateforme ignoree : ' + lunaStoreLabel(o.store), o.knownTitle);
          log(PLATFORM, 'info', 'Ignore (' + lunaStoreLabel(o.store) + ') : ' + o.title);
          return;
        }
        if (o.button) internal.push(o);
        else if (o.url && o.hasCta) external.push(o);
      });
      rememberHistoryTitles(PLATFORM, named);

      log(PLATFORM, 'info', internal.length + ' offre(s) directe(s) et ' + external.length + ' fiche(s) a visiter.', external.map(function (o) { return o.title + ' [' + o.store + ']'; }));

      if (!internal.length && !external.length) {
        setAutoCooldown('luna', CONFIG.autoIdleCooldownMs);
      updateUiState('ok', uiText('engLunaNothingNew'));
        log(PLATFORM, 'info', 'Rien de nouveau a reclamer sur Luna.');
        return;
      }

      saveLunaBatch({ total: internal.length + external.length, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false });

      function claimInternal(index) {
        if (index >= internal.length) return Promise.resolve();
        if (emergencyStopped()) {
          log(PLATFORM, 'error', 'Arret d\'urgence actif : ' + (internal.length - index) + ' offre(s) directe(s) non traitee(s).');
          updateUiState('error', uiText('engLunaEmergency'));
          return Promise.resolve();
        }
        var o = internal[index];
        updateUiState('running', uiText('engLunaWorking', o.title));

        /* Un echec ne doit pas arreter le lot : on le compte et on passe a
           l'offre suivante, comme le faisait l'ancienne branche d'erreur. */
        function skipInternal(reason, detail) {
          recordLunaFailure(o.id, reason, o.knownTitle);
          bumpLunaBatch('failed');
          log(PLATFORM, 'warn', detail);
          return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax).then(function () { return claimInternal(index + 1); });
        }

        /* Meme regle que sur la fiche : la carte a ete trouvee par un
           attribut, c'est son LIBELLE qui autorise le clic. */
        if (!lunaClaimLabelAllowed(o.button)) {
          noteSeenLabel('luna', actionText(o.button));
          return skipInternal('libelle inattendu sur la carte : "' + actionText(o.button) + '"',
            'Bouton de carte non reconnu pour "' + o.title + '" : "' + actionText(o.button) + '". Rien n\'est clique.');
        }
        log(PLATFORM, 'info', 'Reclamation directe sur la liste : ' + o.title);
        if (!robustClick(o.button)) {
          return skipInternal('clic refuse par les garde-fous',
            'Clic refuse pour "' + o.title + '" (arret d\'urgence, libelle payant ou reclic). Rien n\'a ete tente.');
        }
        return waitForElement(function () {
          if (isLunaReauthVisible()) throw new Error('MANUAL_LOGIN_REQUIRED');
          var text = spacedText(o.card);
          return lunaClaimedText(text) || lunaSuccessVisible(o.card) ? o.card : null;
        }, { timeout: 12000 }).then(function () {
          saveHistoryEntry(PLATFORM, lunaHistoryKey(o.id), 'claimed', 'Amazon Games', o.knownTitle);
          bumpLunaBatch('claimed');
          log(PLATFORM, 'info', 'OK Reclame : ' + o.title);
        }).catch(function (err) {
          if (err && err.message === 'MANUAL_LOGIN_REQUIRED') throw err;
          recordLunaFailure(o.id, 'confirmation non detectee apres le clic direct', o.knownTitle);
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
        updateUiState('running', uiText('engLunaPagesToDo', external.length));
        setTimeout(function () { location.assign(external[0].url); }, 1000);
      });
    });
  }

  var lunaModuleRunSince = 0;

