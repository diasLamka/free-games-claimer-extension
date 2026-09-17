  /* LA SENTINELLE DE LA FRAME D'ACHAT.
   *
   * Ce qui surveille un achat doit vivre aussi longtemps que l'achat, et la ou
   * l'achat se passe. La version precedente faisait l'inverse : trois etapes,
   * puis plus rien.
   *
   * Capture du 2026-09-17, jeu "MindCop", iframe store.epicgames.com/purchase :
   *
   *     27.068  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
   *     28.574  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
   *     30.083  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
   *     30.084  Clic ignore : "Ajouter a la bibliotheque" a deja ete clique 1 fois.
   *
   * Trois defauts en trois lignes. La boucle comptait des PASSES et non des
   * actions : elle rappelait l'etape suivante sans regarder ce que robustClick
   * avait rendu, donc deux clics REFUSES par l'anti-rafale ont quand meme
   * consomme deux etapes. Elle ne regardait jamais si l'ecran avait change :
   * meme recherche, meme noeud, meme clic. Et elle etait mortelle : a la
   * troisieme etape le module rendait la main, alors que la modale "droit de
   * retractation" n'etait pas encore affichee. Personne ne l'a jamais cliquee.
   *
   * D'ou cette reecriture, en trois idees :
   *
   *   - une FONCTION DE PASSE idempotente, appelee par le guetteur qui existe
   *     deja (06-dom.js) plutot qu'un second setInterval -- c'est aussi ce qui
   *     la rend testable, le harnais neutralisant setInterval ;
   *   - une SIGNATURE D'ECRAN, pour repondre a la question que le module ne se
   *     posait pas : est-ce que quelque chose a change depuis mon clic ?
   *   - un comptage des ACTIONS REELLES : une tentative n'est consommee que si
   *     le clic a ete accepte. */
  var EPIC_PAYMENT_PLATFORM = 'Epic Payment (iframe)';

  var epicPaymentStarted = false;
  var epicPaymentStopped = false;
  var epicPaymentActions = 0;
  var epicPaymentSawSomethingAt = 0;
  var epicPaymentScreen = '';
  var epicPaymentActionAt = 0;
  var epicPaymentActionLabel = '';
  var epicPaymentActionScreen = '';
  var epicPaymentSameScreenRetries = 0;
  var epicPaymentPending = null;
  var epicPaymentNoticeSent = false;
  var epicPaymentCapReported = false;
  var epicPaymentWaitReported = {};

  /* CE QUE CE MODULE A LE DROIT DE CLIQUER, ET OU.
   *
   * Dans l'iframe du prestataire de paiement, le parcours est eprouve depuis
   * des versions : accord, bibliotheque, commande, continuer.
   *
   * Dans une AUTRE sous-iframe d'Epic -- celle ou se termine une commande
   * gratuite, qui n'a pas d'etape carte bancaire -- la liste se reduit a ce
   * qui ne peut pas depenser d'argent : "Ajouter a la bibliotheque", puis
   * l'accord de retractation qui suit. "Valider la commande" en est exclue,
   * parce que ces iframes-la n'ont pas ete mesurees une par une et qu'un
   * panier payant en ouvre aussi.
   *
   * C'est cette liste, et non l'adresse de l'iframe, qui borne le risque.
   * Elle n'a pas bouge d'un caractere depuis la 2.15.1, et deux tests la
   * figent : la duree de vie de la sentinelle ne l'elargit pas. */
  function epicPaymentConfirmPatterns() {
    return IS_EPIC_PCI_FRAME
      ? EPIC_AGREE_PATTERNS.concat(EPIC_LIBRARY_PATTERNS, [/^continue$/i, /^continuer$/i])
      : EPIC_AGREE_PATTERNS.concat(EPIC_FREE_ORDER_PATTERNS);
  }

  // Le repli non ancre : le textContent d'un bouton Epic concatene tous ses
  // descendants, un span de lecteur d'ecran suffit a faire echouer un ^...$.
  function epicPaymentLoosePatterns() {
    return IS_EPIC_PCI_FRAME
      ? EPIC_AGREE_LOOSE_PATTERNS.concat(EPIC_LIBRARY_LOOSE_PATTERNS)
      : EPIC_AGREE_LOOSE_PATTERNS.concat(EPIC_FREE_ORDER_LOOSE_PATTERNS);
  }

  // La signature d'ecran : de quoi reconnaitre "le meme ecran" d'une passe a
  // l'autre. Les libelles visibles et le nombre de dialogues suffisent, et
  // c'est exactement ce qu'on veut lire dans le journal quand ca coince.
  function epicPaymentScreenSignature() {
    var dialogs = 0;
    try {
      dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length;
    } catch (e) {}
    return visibleActionLabels(8).join(' | ') + ' #' + dialogs;
  }

  function epicPaymentFindConfirm() {
    return findActionElement(document, epicPaymentConfirmPatterns())
        || findShortestActionElement(document, epicPaymentLoosePatterns());
  }

  // Le filet : une modale qui attend un clic humain doit se VOIR, au lieu
  // d'echouer en silence pendant que le reste du moteur enchaine.
  function epicPaymentMaybeWarnStuck(now, text) {
    if (epicPaymentNoticeSent) return;
    if (!epicPaymentActionAt || now - epicPaymentActionAt < CONFIG.epicPaymentFrameStuckNoticeMs) return;
    epicPaymentNoticeSent = true;
    log(EPIC_PAYMENT_PLATFORM, 'warn', 'La frame d\'achat n\'a pas bouge depuis '
      + Math.round((now - epicPaymentActionAt) / 1000) + 's alors que "' + text
      + '" est toujours a l\'ecran. Ecran : ' + epicPaymentScreen);
    notifyUser('Free Games Claimer -- Epic Games',
      'Une fenetre Epic attend un clic sur "' + text + '". Terminez-la dans l\'onglet.');
  }

  // Une passe. Rend true quand elle a REELLEMENT clique quelque chose.
  function epicPaymentFramePass() {
    if (epicPaymentStopped) return false;
    var now = Date.now();

    var challenge = detectSecurityChallenge();
    if (challenge) {
      epicPaymentStopped = true;
      epicPaymentSawSomethingAt = 0;
      log(EPIC_PAYMENT_PLATFORM, 'warn', 'Defi de securite (' + challenge.type + ') dans la frame d\'achat. Sentinelle arretee.', challenge.detail);
      notifyUser('Free Games Claimer -- Epic Games', 'Verification de securite dans le paiement : action manuelle requise.');
      return false;
    }

    var signature = epicPaymentScreenSignature();
    if (signature !== epicPaymentScreen) {
      epicPaymentScreen = signature;
      epicPaymentSawSomethingAt = now;
      log(EPIC_PAYMENT_PLATFORM, 'info', 'Ecran : ' + signature);
    }

    // Le verdict du clic precedent. C'est l'information qui manquait le
    // 2026-09-17 : le module ne savait pas, et le journal ne disait pas, que
    // le clic n'avait rien produit.
    if (epicPaymentPending && now - epicPaymentPending.at >= 1500) {
      log(EPIC_PAYMENT_PLATFORM, 'info', 'Apres "' + epicPaymentPending.label + '" : '
        + (signature === epicPaymentPending.before ? 'ecran INCHANGE.' : 'ecran change -> ' + signature));
      epicPaymentPending = null;
    }

    var btn = epicPaymentFindConfirm();
    if (!btn) return false;

    // Un bouton connu a l'ecran : la frame est vivante, la veille se prolonge.
    epicPaymentSawSomethingAt = now;
    var text = actionText(btn);

    // "Deja clique, et l'ecran n'a pas change" : on attend, on ne consomme
    // rien. Une seule seconde chance, passe le delai de repos, parce qu'un
    // premier clic peut n'avoir pas pris.
    if (text === epicPaymentActionLabel && signature === epicPaymentActionScreen) {
      var tooSoon = now - epicPaymentActionAt < CONFIG.epicPaymentFrameRetrySameMs;
      if (epicPaymentSameScreenRetries >= 1 || tooSoon) {
        if (!epicPaymentWaitReported[text]) {
          epicPaymentWaitReported[text] = 1;
          log(EPIC_PAYMENT_PLATFORM, 'info', '"' + text + '" a deja ete clique et l\'ecran n\'a pas change : on laisse la page reagir (aucune tentative consommee).');
        }
        epicPaymentMaybeWarnStuck(now, text);
        return false;
      }
      epicPaymentSameScreenRetries++;
    } else {
      epicPaymentSameScreenRetries = 0;
    }

    if (epicPaymentActions >= CONFIG.epicPaymentFrameMaxActions) {
      if (!epicPaymentCapReported) {
        epicPaymentCapReported = true;
        log(EPIC_PAYMENT_PLATFORM, 'warn', 'Plafond de ' + CONFIG.epicPaymentFrameMaxActions
          + ' actions atteint dans la frame. Dernier ecran : ' + signature);
      }
      epicPaymentMaybeWarnStuck(now, text);
      return false;
    }

    // LE point de comptage : seul un clic ACCEPTE compte. Un refus de
    // l'anti-rafale, de l'arret d'urgence ou du garde-caisse ne coute rien.
    if (!robustClick(btn)) {
      epicPaymentMaybeWarnStuck(now, text);
      return false;
    }

    epicPaymentActions++;
    epicPaymentActionAt = now;
    epicPaymentActionLabel = text;
    epicPaymentActionScreen = signature;
    epicPaymentPending = { label: text, before: signature, at: now };
    log(EPIC_PAYMENT_PLATFORM, 'info', 'Action ' + epicPaymentActions + '/' + CONFIG.epicPaymentFrameMaxActions
      + ' : clic sur "' + text + '". Ecran avant : ' + signature);
    return true;
  }

  // La frame montre-t-elle encore quelque chose ? Tant que oui, la veille se
  // prolonge ; passe ce silence, la commande est finie ou perdue.
  function epicPaymentFrameAlive() {
    if (epicPaymentStopped || !epicPaymentSawSomethingAt) return false;
    return (Date.now() - epicPaymentSawSomethingAt) < CONFIG.epicPaymentFrameQuietMs;
  }

  function runEpicPaymentIframeModule() {
    if (epicPaymentStarted) {
      log(EPIC_PAYMENT_PLATFORM, 'info', 'Sentinelle deja en place dans cette frame : appel ignore.');
      return Promise.resolve();
    }
    epicPaymentStarted = true;
    epicPaymentSawSomethingAt = Date.now();

    // Le role de la frame ET ce qu'il autorise. La capture du 2026-09-17
    // disait "sous-iframe Epic : commande gratuite seulement" sans jamais dire
    // ce que cela laissait cliquer -- c'est pourtant la premiere question
    // qu'on se pose en lisant un journal.
    log(EPIC_PAYMENT_PLATFORM, 'info', 'Sentinelle d\'achat sur ' + location.hostname + location.pathname
      + (IS_EPIC_PCI_FRAME ? ' (prestataire, parcours eprouve).' : ' (sous-iframe Epic : commande gratuite seulement).')
      + ' Autorise : [' + epicPaymentConfirmPatterns().map(function (p) { return p.source; }).join(', ') + ']'
      + '. Passe toutes les ' + CONFIG.epicPostPurchaseModalPollMs + 'ms, '
      + CONFIG.epicPaymentFrameMaxActions + ' actions au plus.');

    epicPaymentFramePass();
    startEpicPostPurchaseModalWatcher();
    return Promise.resolve();
  }

  var UI_STATE = { status: 'idle', message: 'Pret' };

