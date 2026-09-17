  function claimEpicGame(startEl, title, PLATFORM) {
    // Les modales de fin d'achat vont arriver : on (re)lance la veille.
    startEpicPostPurchaseModalWatcher();
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
          || findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { label: 'Epic: bouton d\'acquisition (Obtenir / Ajouter au panier / Ajouter a la bibliotheque)' })
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
      var checkoutPatterns = [/^check\s*out$/i, /passer ([a\u00e0] la caisse|commande)/i];
      return waitForElement(function () {
        return findActionElement(document, checkoutPatterns, { mustBeEnabled: false });
      }, { timeout: 6000 }).catch(function () { return null; });
    }).then(function (nextStep) {
      var challenge = detectSecurityChallenge();
      if (challenge) throw new Error('Defi de securite (' + challenge.type + ') detecte apres le clic principal.');

      if (nextStep) {
        log(PLATFORM, 'info', 'Etape panier detectee, clic sur "Passer commande".');
        robustClick(nextStep);
      } else {
        log(PLATFORM, 'info', 'Pas d\'etape panier intermediaire detectee, le paiement a peut-etre demarre directement.');
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
        }).then(function () { return null; });
      }
      return waitForElement('#webPurchaseContainer, iframe[src*="payment-website-pci" i], iframe[src*="payment" i]', { timeout: 8000 }).catch(function () { return null; });
    }).then(function (paymentFrame) {
      if (!paymentFrame) {
        log(PLATFORM, 'warn', 'Aucune iframe de paiement detectee apres le clic -- si votre navigateur bloque les iframes tierces, la reclamation ne pourra pas se terminer automatiquement.');
      } else {
        log(PLATFORM, 'info', 'Iframe de paiement detectee. Le clic final est gere par le module dedie qui s\'execute dans cette iframe.');
      }
      return settleEpicClaim(PLATFORM);
    });
  }

  // Attend la confirmation de l'acquisition, et ne declare l'echec qu'apres
  // avoir verifie la possession. La confirmation peut prendre une forme que le
  // guetteur ne connait pas encore -- Epic change ses modales -- mais le bouton
  // "Dans la bibliotheque" qui remplace le bouton d'achat, lui, dit la verite.
  function settleEpicClaim(PLATFORM) {
    return waitForEpicPaymentCompletion().catch(function (err) {
      var owned = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
      if (owned) {
        log(PLATFORM, 'info', 'Confirmation non reconnue, mais le jeu est marque comme possede : succes.');
        return null;
      }
      throw err;
    });
  }

  // Le watcher SPA relance dispatch() a chaque changement d'URL, y compris
  // celui provoque par le clic du script sur une carte : sans garde-fou, deux
  // executions du module se chevauchent et cliquent deux fois sur "Obtenir".
  var epicModuleRunSince = 0;
  var EPIC_MODULE_RUN_STALE_MS = 120000;

