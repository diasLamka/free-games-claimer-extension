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
      var currentSlug = extractEpicSlug(location.href);

      if (freebies) {
        if (currentSlug) {
          var currentGameInList = freebies.find(function (g) { return g.slug === currentSlug; });
          if (currentGameInList) {
            var key = epicHistoryKeyForSlug(currentGameInList.slug);
            if (alreadyHandled(PLATFORM, key) && isEpicGameUnownedOnCurrentPage()) {
              log(PLATFORM, 'warn', 'Historique incoherent detecte pour "' + currentGameInList.title + '" : marque "claimed" mais le bouton "Obtenir" est encore visible. Correction de l\'historique et nouvelle tentative.');
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
          try { sessionStorage.removeItem('FGC_epic_redirect_counts'); } catch (e) {}

          log(PLATFORM, 'info', 'Fiche produit courante identifiee comme jeu gratuit non reclame : ' + currentMatch.title);
          updateUiState('running', uiText('engEpicWorking', currentMatch.title));
          resetEpicSettleClock();
          return withRetry(function () {
            return claimEpicGame(document, currentMatch.title, PLATFORM);
          }, { label: 'recuperation Epic (' + currentMatch.title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
            // On ne se fie pas au seul enchainement des clics : si le bouton
            // "Obtenir" est encore la, la reclamation n'a pas abouti.
            return sleep(CONFIG.epicClaimVerifyDelayMs).then(function () {
              if (result !== 'ALREADY_OWNED' && isEpicGameUnownedOnCurrentPage()) {
                log(PLATFORM, 'warn', 'Verification : "' + currentMatch.title + '" affiche encore le bouton d\'achat. Rien enregistre, nouvelle tentative au prochain passage.');
                notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicUnconfirmed', currentMatch.title));
                updateUiState('error', uiText('engEpicUnconfirmed', currentMatch.title));
                return;
              }
              saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(currentMatch.slug), 'claimed', result, currentMatch.title);
              updateUiState('ok', uiText('engEpicClaimed', currentMatch.title));
              log(PLATFORM, 'info', 'OK Recupere avec succes : ' + currentMatch.title + ' (' + result + ')');
            });
          }).catch(function (err) {
            updateUiState('error', uiText('engEpicFailed', currentMatch.title, err.message));
            log(PLATFORM, 'error', 'ECHEC de la recuperation pour "' + currentMatch.title + '" : ' + err.message + '. Aucune entree "claimed" enregistree.');
            notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicFailed', currentMatch.title, err.message));
          });
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

