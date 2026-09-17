  function claimEpicGame(startEl, title, PLATFORM) {
    // Les modales de fin d'achat vont arriver : on (re)lance la veille.
    startEpicPostPurchaseModalWatcher();

    // La fenetre d'achat est deja ouverte : ne rien recliquer.
    //
    // withRetry rappelle claimEpicGame apres un echec -- typiquement une
    // confirmation qui a mis trop longtemps. La fenetre, elle, est toujours
    // la. Recliquer "Obtenir" par-dessus relance tout depuis le debut : c'est
    // le cas signale le 2026-09-17, une popup ouverte qui reste figee pendant
    // que le moteur clique dessous. On attend la confirmation au lieu
    // d'ajouter un clic dont personne n'a besoin.
    if (epicPurchaseOverlayOpen()) {
      log(PLATFORM, 'info', 'Fenetre d\'achat Epic deja ouverte : on attend sa confirmation au lieu de recliquer.');
      return settleEpicClaim(PLATFORM).then(function () { return 'CLAIMED'; });
    }

    if (startEl && startEl !== document) robustClick(startEl);

    var alreadyOwned = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
    if (alreadyOwned) {
      log(PLATFORM, 'info', '"' + title + '" est deja dans la bibliotheque, rien a reclamer.');
      return Promise.resolve('ALREADY_OWNED');
    }

    // Epic presente DEUX formes de page gratuite, et c'est le point ou
    // l'extension echouait : elle n'attendait que le bouton panier.
    //
    //   - Parcours PANIER : un bouton "Obtenir"/"Get"/"Ajouter au panier", puis
    //     une etape "Passer commande", puis l'iframe de paiement a 0.
    //   - Parcours DIRECT : "Ajouter a la bibliotheque" affiche d'emblee sur la
    //     fiche, sans panier. Observe le 2026-08-27 sur "Rival Stars Horse
    //     Racing : Desktop Edition" -- attendre le bouton panier expirait a
    //     10 s, et rien n'etait reclame.
    //
    // On accepte donc les deux d'entree, et on branche selon celui qui apparait.
    // Le repli non ancre couvre les balisages imbriques : un span invisible
    // dans le bouton suffit a faire echouer un motif ^...$.
    return waitForElement(function () {
      return findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: true })
          || findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { label: 'Epic: bouton panier (Obtenir / Ajouter au panier)' })
          || findShortestActionElement(document, EPIC_LIBRARY_LOOSE_PATTERNS);
    }, { timeout: 12000 }).catch(function () {
      // L'echec porte son diagnostic : les libelles reellement visibles disent
      // quel motif manque, et la prochaine capture d'ecran suffit a corriger.
      var labels = visibleActionLabels(8);
      throw new Error('bouton d\'acquisition introuvable en 12 s. Boutons visibles : ' + (labels.length ? labels.join(' | ') : 'aucun'));
    }).then(function (btn) {
      var challenge = detectSecurityChallenge();
      if (challenge) throw new Error('Defi de securite (' + challenge.type + ') detecte avant le clic initial.');

      var text = (btn.textContent || '').trim();
      var direct = EPIC_LIBRARY_LOOSE_PATTERNS.some(function (p) { return p.test(text); });

      log(PLATFORM, 'info', 'Clic sur "' + text + '"' + (direct ? ' (parcours direct bibliotheque).' : ' (parcours panier).'));
      robustClick(btn);

      return direct ? claimEpicDirect(PLATFORM) : claimEpicViaCart(PLATFORM);
    }).then(function () { return 'CLAIMED'; });
  }

  // Parcours DIRECT : le bouton "Ajouter a la bibliotheque" vient d'etre
  // clique -- c'est l'acte de reclamation. Tout ce qui suit (modale "droit de
  // retractation", eventuelle iframe de paiement a 0, modale du lanceur) est
  // gere par le sondage de waitForEpicPaymentCompletion, qui appelle
  // handleEpicPostPurchaseModals toutes les 500 ms.
  //
  // La premiere version de ce parcours regardait UNE fois si une iframe de
  // paiement existait et concluait CLAIMED sinon -- c'est-a-dire au moment
  // precis ou la modale de retractation venait d'apparaitre. Resultat observe
  // le 2026-08-27 : le script declarait le succes et laissait deux popups a
  // l'utilisateur. On attend desormais une CONFIRMATION, jamais une absence.
  function claimEpicDirect(PLATFORM) {
    return sleep(800).then(function () {
      handleEpicPostPurchaseModals();
      return settleEpicClaim(PLATFORM);
    });
  }

  // Parcours PANIER : le bouton "Obtenir" vient d'etre clique, on enchaine
  // panier -> commande -> paiement.
  function claimEpicViaCart(PLATFORM) {
    return sleep(1000).then(function () {
      // Le clic sur "Obtenir" a peut-etre deja ouvert la fenetre d'achat : il
      // n'y a alors pas d'etape panier, et chercher un bouton a cliquer dans
      // la page derriere la fenetre ne peut que la deranger.
      if (epicPurchaseOverlayOpen()) return null;

      var checkoutPatterns = [/^check\s*out$/i, /passer ([a\u00e0] la caisse|commande)/i];
      // Le bouton doit etre ACTIF : cliquer un "Passer commande" grise ne fait
      // rien, sinon consommer le clic unique auquel la page a droit.
      return waitForElement(function () {
        return findShortestActionElement(document, checkoutPatterns);
      }, { timeout: 6000 }).catch(function () { return null; });
    }).then(function (nextStep) {
      var challenge = detectSecurityChallenge();
      if (challenge) throw new Error('Defi de securite (' + challenge.type + ') detecte apres le clic principal.');

      if (!nextStep) {
        // Rien a dire si la fenetre d'achat est deja ouverte : l'etape panier
        // n'existe pas sur ce parcours, ce n'est pas une anomalie.
        if (!epicPurchaseOverlayOpen()) {
          log(PLATFORM, 'info', 'Pas d\'etape panier intermediaire detectee, le paiement a peut-etre demarre directement.');
        }
        return null;
      }
      log(PLATFORM, 'info', 'Etape panier detectee, clic sur "' + (nextStep.textContent || '').replace(/\s+/g, ' ').trim() + '".');
      robustClick(nextStep);
      // On LAISSE la page reagir avant de chercher l'etape suivante. Les deux
      // clics partaient auparavant dans le meme tour de boucle : de l'exterieur
      // c'est un double-clic, et la fenetre qui venait de s'ouvrir le recevait
      // en pleine ouverture.
      return sleep(1500);
    }).then(function () {
      if (epicPurchaseOverlayOpen()) {
        log(PLATFORM, 'info', 'Fenetre d\'achat ouverte : le clic final revient au module qui s\'execute dans l\'iframe.');
        return settleEpicClaim(PLATFORM);
      }

      // La modale "C'est gratuit. Ajoutez cela a votre bibliotheque" peut etre
      // rendue dans la page elle-meme : on clique alors le bouton sur place.
      var libraryBtn = findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: true });
      if (libraryBtn) {
        log(PLATFORM, 'info', 'Bouton "' + libraryBtn.textContent.trim() + '" detecte dans la page, clic.');
        robustClick(libraryBtn);
        return sleep(1500).then(function () {
          handleEpicPostPurchaseModals();
          return sleep(1000);
        }).then(function () {
          var agreeBtn2 = findActionElement(document, EPIC_AGREE_PATTERNS, { mustBeEnabled: true });
          if (agreeBtn2) {
            log(PLATFORM, 'info', 'Confirmation "' + agreeBtn2.textContent.trim() + '", clic.');
            robustClick(agreeBtn2);
            return sleep(1500);
          }
        }).then(function () { return settleEpicClaim(PLATFORM); });
      }

      return waitForElement('#webPurchaseContainer, iframe[src*="payment-website-pci" i], iframe[src*="payment" i]', { timeout: 8000 })
        .catch(function () { return null; })
        .then(function (paymentFrame) {
          if (!paymentFrame) {
            log(PLATFORM, 'warn', 'Aucune iframe de paiement detectee apres le clic -- si votre navigateur bloque les iframes tierces, la reclamation ne pourra pas se terminer automatiquement.');
          } else {
            log(PLATFORM, 'info', 'Iframe de paiement detectee. Le clic final est gere par le module dedie qui s\'execute dans cette iframe.');
          }
          return settleEpicClaim(PLATFORM);
        });
    });
  }

  // Attend la confirmation de l'acquisition, et ne declare l'echec qu'apres
  // avoir verifie la possession. La confirmation peut prendre une forme que le
  // guetteur ne connait pas encore -- Epic change ses modales -- mais le bouton
  // "Dans la bibliotheque" qui remplace le bouton d'achat, lui, dit la verite.
  /* Ce que la fiche voit vraiment comme iframes.
   *
   * Ecrit une seule fois, au moment de l'echec, et c'est ce qui manquait le
   * 2026-09-17 : on a suppose pendant deux versions que la commande gratuite
   * se terminait chez le prestataire de paiement. Une ligne comme celle-ci
   * l'aurait dementi du premier coup. */
  function describeFrames() {
    try {
      var frames = Array.prototype.slice.call(document.querySelectorAll('iframe'));
      if (!frames.length) return 'aucune iframe';
      return frames.slice(0, 6).map(function (f) {
        var src = f.getAttribute('src') || '(sans src)';
        var visible = !!(f.offsetWidth || f.offsetHeight);
        return src.slice(0, 120) + (visible ? '' : ' [masquee]');
      }).join(' | ');
    } catch (e) { return 'inventaire impossible : ' + ((e && e.message) || e); }
  }

  /* L'ECHEANCE EST PAR JEU, PAS PAR TENTATIVE.
   *
   * Trente secondes fixes etaient un pari sur la vitesse d'Epic. La sentinelle
   * de la frame d'achat, elle, travaille tant que la fenetre est a l'ecran :
   * la fiche declarait donc l'echec pendant que l'achat aboutissait. On attend
   * desormais tant que la fenetre est ouverte, par tours de 30 s -- et pendant
   * chaque tour waitForEpicPaymentCompletion continue d'appeler
   * handleEpicPostPurchaseModals toutes les 500 ms, donc le cadre du dessus
   * reste actif sur SES modales.
   *
   * withRetry rappelle claimEpicGame : l'echeance doit vivre en dehors, sinon
   * chaque tentative repartirait pour 150 s. */
  var epicSettleSince = 0;
  var epicSettleNoticeSent = false;

  function resetEpicSettleClock() {
    epicSettleSince = 0;
    epicSettleNoticeSent = false;
  }

  function settleEpicClaim(PLATFORM) {
    if (!epicSettleSince) epicSettleSince = Date.now();

    function round() {
      return waitForEpicPaymentCompletion().catch(function (err) {
        var owned = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
        if (owned) {
          log(PLATFORM, 'info', 'Confirmation non reconnue, mais le jeu est marque comme possede : succes.');
          return null;
        }

        var elapsed = Date.now() - epicSettleSince;
        var stillOpen = epicPurchaseOverlayOpen();

        if (stillOpen && elapsed < CONFIG.epicPurchaseSettleMaxMs) {
          log(PLATFORM, 'info', 'Fenetre d\'achat toujours ouverte apres ' + Math.round(elapsed / 1000)
            + 's : la sentinelle de la frame a la main, on continue d\'attendre.');
          if (!epicSettleNoticeSent && elapsed >= CONFIG.epicPurchaseStuckNoticeMs) {
            epicSettleNoticeSent = true;
            updateUiState('running', 'Epic : fenetre d\'achat ouverte, en attente...');
            notifyUser('Free Games Claimer -- Epic Games', 'Une fenetre d\'achat Epic attend une confirmation depuis '
              + Math.round(elapsed / 1000) + 's. Jetez-y un oeil si elle reste bloquee.');
          }
          return round();
        }

        log(PLATFORM, 'warn', 'Aucune confirmation apres ' + Math.round(elapsed / 1000) + 's. Fenetre d\'achat : '
          + (stillOpen ? 'TOUJOURS OUVERTE' : 'fermee') + '. Iframes presentes sur la fiche : ' + describeFrames());
        throw err;
      });
    }

    return round();
  }

  /* Pourquoi on ne passe pas encore au jeu suivant.
   *
   * Rend une raison nommee plutot qu'un booleen : une raison se journalise et
   * se teste. Le cadre du dessus lit SON propre DOM -- #webPurchaseContainer
   * lui appartient -- donc les deux frames se coordonnent sans messagerie. */
  function nextGameGateReason() {
    if (epicPurchaseOverlayOpen()) return 'purchase-open';
    return null;
  }

  /* Ne jamais enchainer sur un achat ouvert.
   *
   * C'est le seul chemin du code qui pouvait DETRUIRE une commande en cours :
   * processNext ne cherche l'ancre du jeu suivant que 1,5 s hors /free-games,
   * puis fait location.assign -- ce qui emporte la fenetre d'achat, la modale
   * et la commande avec la page. */
  function waitForPurchaseOverlayToClose(PLATFORM) {
    if (!nextGameGateReason()) return Promise.resolve(null);

    log(PLATFORM, 'info', 'Une fenetre d\'achat est encore ouverte : on ne passe pas au jeu suivant.');
    return waitForElement(function () {
      return nextGameGateReason() ? null : (document.body || document.documentElement);
    }, { timeout: CONFIG.epicPurchaseSettleMaxMs, interval: 1000 }).then(function () {
      log(PLATFORM, 'info', 'Fenetre d\'achat refermee : passage au jeu suivant.');
      return null;
    }).catch(function () {
      log(PLATFORM, 'warn', 'Fenetre d\'achat toujours ouverte apres '
        + Math.round(CONFIG.epicPurchaseSettleMaxMs / 1000) + 's : on passe au suivant. Terminez-la manuellement.');
      notifyUser('Free Games Claimer -- Epic Games', 'Une fenetre d\'achat Epic est restee ouverte : terminez-la manuellement.');
      updateUiState('error', 'Epic : fenetre d\'achat restee ouverte');
      return null;
    });
  }

  // Le watcher SPA relance dispatch() a chaque changement d'URL, y compris
  // celui provoque par le clic du script sur une carte : sans garde-fou, deux
  // executions du module se chevauchent et cliquent deux fois sur "Obtenir".
  var epicModuleRunSince = 0;
  /* Cinq minutes, et non deux.
   *
   * Cette garde empeche deux executions concurrentes du module Epic (le
   * guetteur SPA rappelle dispatch toutes les 1,5 s). Depuis que la fiche
   * attend jusqu'a 150 s la fermeture de la fenetre d'achat, une reclamation
   * legitime depassait les deux minutes : la garde se perimait toute seule et
   * une seconde execution demarrait par-dessus la premiere. Le correctif
   * fabriquait le bug qu'il corrige. */
  var EPIC_MODULE_RUN_STALE_MS = 5 * 60000;

