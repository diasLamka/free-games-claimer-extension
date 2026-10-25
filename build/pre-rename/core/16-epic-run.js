  /* Une recuperation DEMANDEE (le bouton, le menu, ou "Recuperer" du popup)
   * repart de la page, pas de l'historique (2.99.7). L'historique est la memoire
   * du moteur ; s'il s'est trompe un jour (un "Dans la bibliotheque" lu sur la
   * carte d'un autre jeu), il se trompe tant que personne ne l'efface, et le
   * message "tous les jeux de la semaine sont deja recuperes" repond a un
   * utilisateur qui vient justement de dire le contraire. Une demande explicite
   * est plus recente que cette memoire : chaque jeu gratuit est revu sur sa
   * propre fiche, qui sait, elle, si le jeu est a vous. */
  var epicForceRecheck = false;

  /* Une recuperation ORDONNEE (2.115.0) : le worker, l'appli, le bouton de la
   * page ou le menu ont envoye le moteur sur CETTE page pour y prendre le jeu.
   * Seule une telle demande autorise le moteur a lire une fiche que le flux
   * freeGamesPromotions ne liste pas (voir epicOffFeedState) ; une visite
   * ordinaire, le guetteur automatique, n'y touche jamais. Le drapeau se perime
   * (deux minutes) : un ordre ignore parce qu'un passage tournait deja ne doit
   * pas survivre jusqu'a une page que personne n'a demandee. */
  var epicClaimOrderedAt = 0;
  var EPIC_ORDER_FRESH_MS = 2 * 60000;

  function markEpicClaimOrdered(at) {
    epicClaimOrderedAt = typeof at === 'number' ? at : Date.now();
  }

  function takeEpicClaimOrdered() {
    var fresh = !!epicClaimOrderedAt && Date.now() - epicClaimOrderedAt < EPIC_ORDER_FRESH_MS;
    epicClaimOrderedAt = 0;
    return fresh;
  }

  function runEpicGamesModule() {
    var PLATFORM = 'Epic Games';

    if (epicModuleRunSince && Date.now() - epicModuleRunSince < EPIC_MODULE_RUN_STALE_MS) {
      log(PLATFORM, 'info', 'Module Epic deja en cours d\'execution (' + Math.round((Date.now() - epicModuleRunSince) / 1000) + 's) : nouvel appel ignore.');
      return Promise.resolve();
    }
    epicModuleRunSince = Date.now();
    return runEpicGamesModuleInner().then(function (r) {
      epicModuleRunSince = 0;
      return r;
    }, function (err) {
      epicModuleRunSince = 0;
      throw err;
    });
  }

  function runEpicGamesModuleInner() {
    var PLATFORM = 'Epic Games';
    log(PLATFORM, 'info', 'Demarrage du module Epic Games Store.');

    if (isEpicNotFoundPage(location.pathname)) {
      log(PLATFORM, 'warn', 'Page /not-found : aucune reclamation possible ici. Rendez-vous sur ' + epicStoreUrl('/free-games') + '.');
      updateUiState('error', uiText('engEpicWrongPage'));
      return Promise.resolve();
    }

    if (isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Aucune session active detectee. Connectez-vous manuellement puis relancez.');
      notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicLogin'));
      updateUiState('error', uiText('engEpicNotLoggedIn'));
      return Promise.resolve();
    }

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ') avant meme le chargement de la page. Arret.', challenge.detail);
      notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyCaptcha'));
      updateUiState('error', uiText('engCaptcha'));
      return Promise.resolve();
    }

    return withRetry(function () {
      return waitForElement(function () { return document.querySelector('main'); }, { timeout: 12000 });
    }, { label: 'chargement de la page Epic Games Store' }).catch(function (e) {
      log(PLATFORM, 'error', 'La page principale ne s\'est pas chargee a temps.', e);
      updateUiState('error', uiText('engEpicPageNotLoaded'));
      return Promise.reject('STOP');
    }).then(function () {
      return fetchCurrentEpicFreebies().catch(function (e) {
        log(PLATFORM, 'warn', 'API freeGamesPromotions indisponible, repli sur la detection DOM : ' + e.message);
        return null;
      });
    }).then(function (freebies) {
      // Le controle de coherence ci-dessous lit la fiche : on lui laisse le
      // temps de s'afficher (rendu cote client) au lieu de la lire vide.
      var force = epicForceRecheck;
      epicForceRecheck = false;
      var ordered = takeEpicClaimOrdered();
      var currentSlug = extractEpicSlug(location.href);
      var currentFree = freebies && currentSlug && freebies.find(function (g) { return g.slug === currentSlug; });
      var pageReady = currentFree && (force || alreadyHandled(PLATFORM, epicHistoryKeyForSlug(currentFree.slug)))
        ? waitForEpicCtaState(8000)
        : Promise.resolve(null);
      return pageReady.then(function (pageState) { return { freebies: freebies, force: force, ordered: ordered, pageState: pageState }; });
    }).then(function (ctx) {
      var freebies = ctx.freebies;
      var force = ctx.force;
      var currentSlug = extractEpicSlug(location.href);

      // Une fiche que le flux ne liste pas, ordonnee expressement : c'est elle qui dit si le jeu est gratuit.
      if (ctx.ordered && currentSlug && !(freebies && freebies.some(function (g) { return g.slug === currentSlug; }))) {
        return claimOffFeedFiche(PLATFORM, currentSlug, force);
      }

      if (freebies && force) {
        // Demande explicite : l'historique des jeux que ce passage revoit ne decide rien (voir epicForceRecheck, epicGamesToRecheck).
        epicGamesToRecheck(freebies, currentSlug, getHistory(PLATFORM)).forEach(function (g) {
          log(PLATFORM, 'info', 'Recuperation demandee : "' + g.title + '" est revu sur sa fiche, l\'historique est ignore.');
          removeHistoryEntry(PLATFORM, epicHistoryKeyForSlug(g.slug));
        });
      }

      if (freebies) {
        if (currentSlug) {
          var currentGameInList = freebies.find(function (g) { return g.slug === currentSlug; });
          if (currentGameInList) {
            var key = epicHistoryKeyForSlug(currentGameInList.slug);
            if (alreadyHandled(PLATFORM, key) && ctx.pageState === 'unowned') {
              log(PLATFORM, 'warn', 'Historique incoherent detecte pour "' + currentGameInList.title + '" : marque "claimed" mais le bouton d\'achat de la fiche est encore la. Correction de l\'historique et nouvelle tentative.');
              removeHistoryEntry(PLATFORM, key);
            }
          }
        }

        var unclaimed = freebies.filter(function (g) {
          if (alreadyHandled(PLATFORM, epicHistoryKeyForSlug(g.slug))) return false;
          if (isEpicSlugBlocked(PLATFORM, g.slug)) {
            log(PLATFORM, 'warn', '"' + g.title + '" ignore : son URL (' + g.url + ') a recemment mene a une page introuvable. Reclamez-le manuellement.');
            return false;
          }
          return true;
        });
        var titles = unclaimed.map(function (g) { return g.title; });
        log(PLATFORM, 'info', 'API : ' + freebies.length + ' jeu(x) gratuit(s), ' + unclaimed.length + ' non reclame(s).', titles);

        if (unclaimed.length === 0) {
          setAutoCooldown('epic', CONFIG.autoIdleCooldownMs);
          updateUiState('ok', uiText('engEpicAllClaimed'));
          log(PLATFORM, 'info', 'Aucun jeu gratuit restant a reclamer selon l\'API.');
          return;
        }

        var currentMatch = currentSlug ? unclaimed.find(function (g) { return g.slug === currentSlug; }) : null;
        if (currentMatch) {
          log(PLATFORM, 'info', 'Fiche produit courante identifiee comme jeu gratuit non reclame : ' + currentMatch.title);
          return claimCurrentEpicFiche(currentMatch, PLATFORM);
        }

        var successCount = 0;

        /* Une fenetre d'achat ouverte bloque le passage au jeu suivant.
         *
         * Le corps de la boucle n'est pas touche, seulement enveloppe : sans
         * cette garde, processNext cherchait l'ancre du jeu suivant 1,5 s puis
         * naviguait, ce qui emportait la commande en cours avec la page. */
        function processNext(index) {
          return Promise.resolve(waitForPurchaseOverlayToClose(PLATFORM)).then(function () {
            return processNextInner(index);
          });
        }

        function processNextInner(index) {
          if (index >= unclaimed.length) {
            updateUiState(successCount > 0 ? 'ok' : 'error', uiText('engEpicTally', successCount, unclaimed.length));
            log(PLATFORM, 'info', 'Module Epic Games termine (detection API).');
            return;
          }

          var game = unclaimed[index];
          updateUiState('running', uiText('engEpicFindingCard', game.title));

          // Les cartes de /free-games sont rendues cote client : on attend
          // leur apparition avant de decider qu'il faut rediriger.
          var waitMs = /\/free-games/.test(location.pathname) ? CONFIG.epicCardWaitTimeout : 1500;
          return waitForEpicAnchor(game.slug, waitMs).then(function (anchor) {
            if (anchor) {
              log(PLATFORM, 'info', 'Carte trouvee par slug pour : ' + game.title + ' (' + anchor.getAttribute('href') + ')');
              updateUiState('running', uiText('engEpicWorking', game.title));
              // Si le clic sur la carte provoque un rechargement complet (et
              // non une navigation SPA), la fiche reprendra la reclamation.
              setEpicPendingSlug(game.slug);
              resetEpicSettleClock();
              return withRetry(function () {
                return claimEpicGame(anchor, game.title, PLATFORM);
              }, { label: 'recuperation Epic (' + game.title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
                saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(game.slug), 'claimed', result, game.title);
                successCount++;
                log(PLATFORM, 'info', 'OK Recupere avec succes : ' + game.title + ' (' + result + ')');
              }).catch(function (err) {
                log(PLATFORM, 'error', 'ECHEC de la recuperation pour "' + game.title + '" : ' + err.message + '. Aucune entree "claimed" enregistree.');
              }).then(function () {
                // Le clic a ete traite ici (navigation SPA, pas de rechargement) :
                // le marqueur ne doit pas survivre jusqu'a un futur chargement.
                clearEpicPendingSlug();
                return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax);
              }).then(function () { return processNext(index + 1); });
            }

            var redirectCount = getRedirectCount(game.slug);
            if (redirectCount >= CONFIG.epicMaxRedirectsPerSlug) {
              log(PLATFORM, 'error', 'Trop de redirections deja tentees pour "' + game.title + '" (' + redirectCount + ') sans succes. Abandon automatique : reclamez-le manuellement via ' + game.url + '.');
              notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicCannotClaim', game.title));
              updateUiState('error', uiText('engRepeatedFailure', game.title));
              return processNext(index + 1);
            }
            incrementRedirectCount(game.slug);
            setEpicPendingSlug(game.slug);
            log(PLATFORM, 'info', 'Carte non trouvee dans le DOM pour "' + game.title + '" (tentative ' + (redirectCount + 1) + '/' + CONFIG.epicMaxRedirectsPerSlug + '), navigation directe vers ' + game.url);
            location.assign(game.url);
          });
        }
        return processNext(0);
      }

      var cards = findEpicFreeNowCards();

      if (cards.length === 0) {
        log(PLATFORM, 'info', 'Aucun jeu gratuit detecte (ni via l\'API, ni via le DOM). Verifiez que vous etes bien sur ' + epicStoreUrl('/free-games') + ' et que vous etes connecte.');
        updateUiState('ok', uiText('engNoFreeGameHere'));
        return;
      }

      log(PLATFORM, 'info', cards.length + ' jeu(x) gratuit(s) detecte(s) via repli DOM.');
      var successCount2 = 0;

      // Meme garde que processNext : le repli DOM enchaine aussi les jeux.
      function processCard(index) {
        return Promise.resolve(waitForPurchaseOverlayToClose(PLATFORM)).then(function () {
          return processCardInner(index);
        });
      }

      function processCardInner(index) {
        if (index >= cards.length) {
          updateUiState(successCount2 > 0 ? 'ok' : 'error', uiText('engEpicTally', successCount2, cards.length));
          log(PLATFORM, 'info', 'Module Epic Games termine (repli DOM).');
          return;
        }
        var card = cards[index];
        var slug = extractEpicSlug(card.href) || card.href;
        var gameKey = epicHistoryKeyForSlug(slug);
        var titleEl = card.querySelector('h3, h6, [class*="title" i]');
        var title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || slug;

        if (alreadyHandled(PLATFORM, gameKey)) {
          log(PLATFORM, 'info', 'Deja recupere precedemment, ignore : ' + title);
          return processCard(index + 1);
        }

        log(PLATFORM, 'info', 'Traitement de : ' + title);
        updateUiState('running', uiText('engEpicWorking', title));
        resetEpicSettleClock();
        return withRetry(function () {
          return claimEpicGame(card, title, PLATFORM);
        }, { label: 'recuperation Epic (' + title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
          saveHistoryEntry(PLATFORM, gameKey, 'claimed', result, title);
          successCount2++;
          log(PLATFORM, 'info', 'OK Recupere avec succes : ' + title);
        }).catch(function (err) {
          log(PLATFORM, 'error', 'ECHEC de la recuperation pour "' + title + '" : ' + err.message);
        }).then(function () {
          return randomDelay(CONFIG.claimDelayMin, CONFIG.claimDelayMax);
        }).then(function () { return processCard(index + 1); });
      }

      return processCard(0);
    });
  }


  /* Reclame le jeu de la fiche OUVERTE, puis verifie sur la fiche que c'est fait.
   * Partage par le jeu que le flux liste (la fiche courante) et par la fiche
   * ordonnee que le flux ne liste pas (claimOffFeedFiche). */
  function claimCurrentEpicFiche(game, PLATFORM) {
    try { sessionStorage.removeItem('FGC_epic_redirect_counts'); } catch (e) {}

    updateUiState('running', uiText('engEpicWorking', game.title));
    resetEpicSettleClock();
    return withRetry(function () {
      return claimEpicGame(document, game.title, PLATFORM);
    }, { label: 'recuperation Epic (' + game.title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
      // On ne se fie pas au seul enchainement des clics : si le bouton
      // "Obtenir" est encore la, la reclamation n'a pas abouti.
      return sleep(CONFIG.epicClaimVerifyDelayMs).then(function () {
        if (result !== 'ALREADY_OWNED' && isEpicGameUnownedOnCurrentPage()) {
          log(PLATFORM, 'warn', 'Verification : "' + game.title + '" affiche encore le bouton d\'achat. Rien enregistre, nouvelle tentative au prochain passage.');
          notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicUnconfirmed', game.title));
          updateUiState('error', uiText('engEpicUnconfirmed', game.title));
          return;
        }
        saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(game.slug), 'claimed', result, game.title);
        updateUiState('ok', uiText('engEpicClaimed', game.title));
        log(PLATFORM, 'info', 'OK Recupere avec succes : ' + game.title + ' (' + result + ')');
      });
    }).catch(function (err) {
      updateUiState('error', uiText('engEpicFailed', game.title, err.message));
      log(PLATFORM, 'error', 'ECHEC de la recuperation pour "' + game.title + '" : ' + err.message + '. Aucune entree "claimed" enregistree.');
      notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicFailed', game.title, err.message));
    });
  }

  /* Une fiche ordonnee que freeGamesPromotions ne liste pas (2.115.0) : MAFIA
   * HOTEL, offert a 0 EUR par son editeur hors de la rotation de la semaine.
   *
   * Le moteur ne se fie plus au flux pour CETTE page : il lit le bouton principal
   * (voir epicOffFeedState). "Obtenir" / "Get" sans un mot d'argent : il reclame,
   * par le meme parcours que les autres jeux -- le garde de la fenetre d'achat
   * (zero seulement) reste la derniere barriere. Deja dans la bibliotheque : il
   * l'ecrit. Tout le reste -- bouton payant, libelle inconnu, fiche qui ne
   * s'affiche pas : il ne clique RIEN et n'ecrit rien, et c'est le mode pilote
   * qui dit "rien a prendre" ou "montrez-moi le bouton". */
  function claimOffFeedFiche(PLATFORM, slug, force) {
    var key = epicHistoryKeyForSlug(slug);
    if (force) removeHistoryEntry(PLATFORM, key);
    var title = epicFicheTitle(slug);

    if (alreadyHandled(PLATFORM, key)) {
      log(PLATFORM, 'info', 'Fiche "' + title + '" absente du flux, deja recuperee precedemment : rien a faire.');
      updateUiState('ok', uiText('engEpicClaimed', title));
      return Promise.resolve();
    }

    log(PLATFORM, 'info', 'Fiche ordonnee absente du flux freeGamesPromotions : "' + title + '". Le bouton principal de la fiche dit si le jeu est gratuit.');
    updateUiState('running', uiText('engEpicWorking', title));
    return waitForEpicOffFeedState(12000).then(function (state) {
      if (state === 'owned') {
        saveHistoryEntry(PLATFORM, key, 'claimed', 'ALREADY_OWNED', title);
        updateUiState('ok', uiText('engEpicClaimed', title));
        log(PLATFORM, 'info', '"' + title + '" est deja dans la bibliotheque (' + 'fiche hors flux).');
        return;
      }
      if (state !== 'free') {
        var labels = visibleActionLabels(8);
        log(PLATFORM, 'warn', '"' + title + '" : la fiche ' + (state === 'paid' ? 'annonce une depense' : 'ne montre aucun bouton gratuit reconnu')
          + ' -- rien n\'est clique. Boutons visibles : ' + (labels.length ? labels.join(' | ') : 'aucun'));
        updateUiState('error', uiText('engEpicFailed', title, state === 'paid' ? 'jeu payant' : 'bouton gratuit introuvable'));
        return;
      }
      log(PLATFORM, 'info', '"' + title + '" : bouton gratuit sur la fiche, on reclame.');
      return claimCurrentEpicFiche({ title: title, slug: slug }, PLATFORM);
    });
  }
