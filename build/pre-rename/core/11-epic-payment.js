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
  var epicPaymentStackReported = false;
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

  /* LA MODALE DU DESSUS, ET CE QU'ELLE COUVRE.
   *
   * Regle generale : ce qu'un humain ne peut pas cliquer, le moteur ne le
   * clique pas. Une modale ouverte capture l'interaction ; tout ce qui est
   * derriere est hors de portee, meme si querySelectorAll le trouve.
   *
   * Sans cette regle, capture du 2026-09-17T22:29 :
   *
   *     Action 4/6 : clic sur "Ajouter a la bibliotheque".
   *     Ecran avant : Ajouter a la bibliotheque | Annuler | J'accepte #3
   *
   * "J'accepte" etait a l'ecran -- il est dans la ligne -- et la sentinelle
   * cliquait le bouton de la page DERRIERE la modale. findActionElement rend
   * le premier candidat dans l'ordre du DOM : l'ordre du document gagne,
   * jamais l'ordre des motifs. Et chaque clic empilait une modale de plus,
   * #3 puis #4, #5, #6, jusqu'a epuiser le plafond d'actions. */
  function epicPaymentTopDialog() {
    try {
      var dialogs = Array.prototype.slice.call(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"]')
      ).filter(function (d) {
        return !!(d.offsetWidth || d.offsetHeight || (d.getClientRects && d.getClientRects().length));
      });
      // La derniere dans l'ordre du DOM : les portails React s'ajoutent a la
      // fin du body, donc la derniere est celle du dessus.
      return dialogs.length ? dialogs[dialogs.length - 1] : null;
    } catch (e) {
      return null;
    }
  }

  function epicPaymentVisibleDialogCount() {
    try {
      return Array.prototype.slice.call(
        document.querySelectorAll('[role="dialog"], [aria-modal="true"]')
      ).filter(function (d) {
        return !!(d.offsetWidth || d.offsetHeight || (d.getClientRects && d.getClientRects().length));
      }).length;
    } catch (e) {
      return 0;
    }
  }

  /* La signature d'ecran : de quoi reconnaitre "le meme ecran" d'une passe a
   * l'autre.
   *
   * Elle comptait les dialogues ouverts. C'etait une mauvaise mesure : chaque
   * modale empilee faisait passer un ecran identique pour un ecran NEUF, donc
   * le frein "deja clique, ecran inchange" ne se declenchait jamais. La
   * signature porte desormais sur la modale du dessus -- ses libelles et la
   * taille de son texte -- ou, a defaut de modale, sur les libelles visibles.
   * Deux modales identiques empilees rendent alors la meme signature. */
  function epicPaymentScreenSignature() {
    var dialog = epicPaymentTopDialog();
    if (!dialog) return visibleActionLabels(8).join(' | ');

    var labels = [];
    try {
      labels = collectActionElements(dialog, [/./]).slice(0, 8).map(actionText);
    } catch (e) {}
    var size = 0;
    try { size = ((dialog.textContent || '').replace(/\s+/g, ' ').trim()).length; } catch (e) {}
    return 'modale[' + labels.join(' | ') + '] ~' + size;
  }

  /* Le bouton a cliquer, cherche LA OU IL EST ATTEIGNABLE.
   *
   * Quand une modale est ouverte, on ne cherche que dedans -- et on ne
   * retombe PAS sur le document si elle ne porte aucun bouton autorise :
   * c'est precisement ce repli qui a empile six modales. Dans ce cas on
   * attend, et le filet des 30 s previent. */
  function epicPaymentFindConfirm() {
    var dialog = epicPaymentTopDialog();
    var root = dialog || document;
    return findActionElement(root, epicPaymentConfirmPatterns())
        || findShortestActionElement(root, epicPaymentLoosePatterns());
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
    notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicWaitingClick', text));
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
      notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyPaymentCheck'));
      /* Le cadre du dessus ne voit pas un captcha niche dans cette frame
         (origine differente) : sans ce message il attendait cent cinquante
         secondes une confirmation qui ne pouvait venir, puis concluait mal
         (2.99.7). Rien que le fait qu'un defi est la -- aucune donnee. */
      try { window.top.postMessage({ fgcPaymentChallenge: true }, '*'); } catch (e) { /* cadre inaccessible */ }
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
      // Une modale de PLUS apres un clic est le symptome d'un bouton clique
      // derriere une modale. Une ligne, une seule : c'est ce qu'on veut lire
      // en tete de capture si cela se reproduit sous une autre forme.
      var stacked = epicPaymentVisibleDialogCount();
      if (!epicPaymentStackReported && stacked > epicPaymentPending.dialogs) {
        epicPaymentStackReported = true;
        log(EPIC_PAYMENT_PLATFORM, 'warn', 'Le clic sur "' + epicPaymentPending.label
          + '" a EMPILE une modale (' + epicPaymentPending.dialogs + ' -> ' + stacked
          + '). Un bouton hors de la modale du dessus a ete atteint : a signaler.');
      }
      log(EPIC_PAYMENT_PLATFORM, 'info', 'Apres "' + epicPaymentPending.label + '" : '
        + (signature === epicPaymentPending.before ? 'ecran INCHANGE.' : 'ecran change -> ' + signature));
      epicPaymentPending = null;
    }

    var btn = epicPaymentFindConfirm();
    if (!btn) return false;

    // Un bouton connu a l'ecran : la frame est vivante, la veille se prolonge.
    epicPaymentSawSomethingAt = now;
    var text = actionText(btn);

    /* Le meme libelle, trop tot : on ne PROPOSE meme pas le clic.
     *
     * Le garde-fou du dessous ne couvre que "meme libelle ET meme ecran". Or
     * l'ecran bouge souvent juste apres un clic (une modale s'ouvre) : la
     * sonde repassait alors a la seconde suivante, retrouvait le meme bouton,
     * et se faisait refuser par l'anti-rafale de robustClick. Refus sans
     * consequence, mais une ligne de journal a chaque fois -- et Chrome les
     * compte comme des erreurs. On respecte donc le meme delai de repos que
     * robustClick, en amont. */
    if (text === epicPaymentActionLabel && epicPaymentActionAt
        && now - epicPaymentActionAt < CONFIG.clickCooldownMs) {
      // Ne pas cliquer n'est pas une raison de ne pas VOIR : le filet reste
      // consulte, sinon un ecran bloque ne se signalerait jamais.
      epicPaymentMaybeWarnStuck(now, text);
      return false;
    }

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
    epicPaymentPending = { label: text, before: signature, at: now, dialogs: epicPaymentVisibleDialogCount() };
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

  var UI_STATE = { status: 'idle', message: uiText('engReady') };

