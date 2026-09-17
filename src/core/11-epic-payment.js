  function runEpicPaymentIframeModule() {
    var PLATFORM = 'Epic Payment (iframe)';
    log(PLATFORM, 'info', 'Module iframe de paiement demarre sur ' + location.hostname + '.');

    var confirmPatterns = EPIC_AGREE_PATTERNS.concat(EPIC_LIBRARY_PATTERNS, [/^continue$/i, /^continuer$/i]);
    // Le repli non ancre, qui manquait ici alors qu'il avait ete ajoute au
    // parcours de la fiche en 2.13.2. Constate le 2026-09-17 sur "Mindcop" :
    // l'iframe affichait "Ajouter a la bibliotheque", le module ne le trouvait
    // pas, et la commande restait a l'ecran jusqu'a l'expiration des 30 s.
    var confirmLoose = EPIC_AGREE_LOOSE_PATTERNS.concat(EPIC_LIBRARY_LOOSE_PATTERNS);

    function findConfirm(step) {
      return findActionElement(document, confirmPatterns, { label: 'Iframe paiement (etape ' + (step + 1) + ')' })
          || findShortestActionElement(document, confirmLoose);
    }

    function stepLoop(step) {
      if (step >= 3) return Promise.resolve();
      var challenge = detectSecurityChallenge();
      if (challenge) {
        log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ') dans l\'iframe de paiement. Arret.', challenge.detail);
        notifyUser('Free Games Claimer -- Epic Games', 'Verification de securite dans le paiement : action manuelle requise.');
        return Promise.resolve();
      }

      /* La PREMIERE etape attend aussi longtemps que la fiche attend sa
         confirmation. Douze secondes fixes etaient un pari sur la vitesse de
         chargement du paiement : passe ce delai le module abandonnait, alors
         que le parcours du dessus, lui, patientait encore dix-huit secondes
         pour rien. Les etapes suivantes sont breves -- une modale qui suit un
         clic apparait tout de suite ou pas du tout. */
      var budget = step === 0 ? CONFIG.epicPaymentCompletionTimeout : 8000;

      return waitForElement(function () {
        return findConfirm(step);
      }, { timeout: budget }).catch(function () { return null; }).then(function (btn) {
        if (!btn) {
          log(PLATFORM, 'info', 'Aucun bouton de confirmation trouve a l\'etape ' + (step + 1) + ' (deja valide, ou structure differente).');
          return;
        }
        var btnText = btn.textContent.trim();
        log(PLATFORM, 'info', 'Clic sur le bouton de confirmation : "' + btnText + '"');
        robustClick(btn);

        /* On enchaine TOUJOURS, au lieu de s'arreter sur un clic qui n'etait
           pas un "j'accepte".

           L'ancienne condition supposait que l'accord precedait la commande.
           La capture du 2026-09-17 montre l'inverse : "Ajouter a la
           bibliotheque" d'abord, puis la modale "droit de retractation" avec
           "J'accepte". Le module s'arretait donc juste avant la derniere
           etape. Enchainer ne risque rien : la boucle est bornee a trois
           tours et s'arrete d'elle-meme des qu'aucun bouton connu n'apparait
           plus. */
        return sleep(1500).then(function () { return stepLoop(step + 1); });
      });
    }

    return stepLoop(0);
  }

  var UI_STATE = { status: 'idle', message: 'Pret' };

