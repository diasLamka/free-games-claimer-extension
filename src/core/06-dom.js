  // ---------------------------------------------------------------------------
  // Garde-caisse
  // ---------------------------------------------------------------------------
  //
  // Un seul travail : empecher un clic de demarrer un parcours de PAIEMENT.
  //
  // La menace est reelle et documentee. Sur itch.io, le formulaire qui contient
  // le lien "No thanks, just take me to the downloads" contient AUSSI les
  // boutons de pourboire, le champ de prix et les boutons Stripe et PayPal :
  // un selecteur un peu large y demarre une caisse dans un onglet invisible.
  // Sur indiegala.com/store, un lien porte cartAddProduct en attribut onclick.
  //
  // Cette garde est centrale plutot que recopiee dans chaque module : c'est la
  // piece la plus rentable du lot, et la seule qu'on veuille impossible a
  // oublier. Elle refuse par defaut : mieux vaut rater une reclamation que
  // lancer un paiement.
  // La garde ne s'applique PAS aux trois magasins deja en production. Leur
  // parcours gratuit passe legitimement par un panier et une commande : Epic
  // fait cliquer "Ajouter au panier" puis "Valider la commande" sur un total a
  // zero. Une garde fondee sur ces mots casserait la reclamation qui marche.
  // Elle vise les magasins non eprouves, ou l'on ne connait pas encore le DOM.
  var PROVEN_HOSTS = /(^|\.)epicgames\.com$|(^|\.)gog\.com$|(^|\.)amazon\.[a-z.]+$/i;

  function checkoutGuardApplies() {
    try { return !PROVEN_HOSTS.test(location.hostname); } catch (e) { return true; }
  }

  // On ne bloque que sur des PREUVES DE PAIEMENT, jamais sur du vocabulaire :
  // un champ de montant, un bouton de prestataire, un pourboire, un panier
  // appele par attribut. Le mot "panier" seul ne prouve rien -- le parcours
  // gratuit d'Epic en est plein.
  var CHECKOUT_PROVIDER = /stripe|paypal|braintree|checkout_|donate|tip_|pourboire/i;
  var CHECKOUT_ONCLICK = /cartAddProduct|addToCart\s*\(|checkout/i;
  var CHECKOUT_FIELDS = 'input[name="price" i], .money_input, input[type="number"][name*="amount" i], input[name*="tip" i]';

  function isCheckoutButton(el) {
    if (!el) return false;
    try {
      var classe = el.className && el.className.baseVal !== undefined
        ? el.className.baseVal
        : (el.className || '');
      var signature = [el.id || '', classe, (el.getAttribute && el.getAttribute('data-testid')) || ''].join(' ');
      if (CHECKOUT_PROVIDER.test(signature)) return true;

      var onclick = (el.getAttribute && el.getAttribute('onclick')) || '';
      if (onclick && CHECKOUT_ONCLICK.test(onclick)) return true;

      // Un champ de montant a portee du clic : c'est le cas itch.io, ou le
      // formulaire du lien "No thanks" contient aussi les boutons de pourboire.
      var form = el.closest && el.closest('form');
      if (form && form.querySelector(CHECKOUT_FIELDS)) return true;
    } catch (e) {
      // Un selecteur refuse par le navigateur ne doit pas ouvrir la voie : dans
      // le doute, on refuse.
      return true;
    }
    return false;
  }

  // Arret d'urgence.
  //
  // Un seul point de controle, et il est ICI plutot que dans chaque module :
  // robustClick est le goulot par lequel passe tout ce que le moteur fait
  // d'irreversible. Un interrupteur pose plus haut laisserait passer le module
  // qu'on aurait oublie de brancher.
  //
  // La lecture doit etre SYNCHRONE, d'ou le prechargement dans ENGINE_KEYS de
  // gm-shim.js : une lecture asynchrone rendrait sa reponse apres le clic.
  function emergencyStopped() {
    try {
      return GM_getValue('FGC_kill_switch', false) === true;
    } catch (e) {
      // Stockage illisible : on ne bloque pas. Un arret d'urgence qui se
      // declenche tout seul serait un arret d'urgence qu'on desactive.
      return false;
    }
  }

  // Memoire des clics deja donnes.
  //
  // Le moteur cliquait le meme bouton a chaque passage de sonde tant qu'il
  // restait affiche. Vu de l'utilisateur : une rafale de clics la ou un seul
  // etait demande, et une fenetre d'achat qui reste figee parce qu'elle a
  // recu le clic suivant au milieu de son animation.
  //
  // WeakMap plutot qu'un tableau : un noeud retire du DOM ne doit pas rester
  // retenu par le journal des clics.
  var CLICK_MEMORY = (function () {
    try { return new WeakMap(); } catch (e) { return null; }
  })();

  function clickHistoryFor(el) {
    if (!CLICK_MEMORY) return null;
    var seen = CLICK_MEMORY.get(el);
    if (!seen) { seen = { count: 0, last: 0, warned: false }; CLICK_MEMORY.set(el, seen); }
    return seen;
  }

  // Trop tot, ou trop souvent ? Le repli est le meme : on ne clique pas.
  function isRepeatClick(el) {
    var seen = clickHistoryFor(el);
    if (!seen || !seen.count) return false;
    if (seen.count >= CONFIG.maxClicksPerElement) return true;
    return (Date.now() - seen.last) < CONFIG.clickCooldownMs;
  }

  function robustClick(el) {
    if (!el) return false;

    if (emergencyStopped()) {
      log('CORE', 'error', 'Clic REFUSE : arret d\'urgence actif.');
      return false;
    }

    if (isRepeatClick(el)) {
      var journal = clickHistoryFor(el);
      // Une seule ligne par bouton : l'avertissement doit rester lisible, pas
      // remplir la console au rythme des sondes.
      if (journal && !journal.warned) {
        journal.warned = true;
        log('CORE', 'warn', 'Clic ignore : "' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '" a deja ete clique ' + journal.count + ' fois. On laisse la page reagir.');
      }
      return false;
    }

    if (checkoutGuardApplies() && isCheckoutButton(el)) {
      log('CORE', 'error', 'Clic REFUSE : cet element ressemble a un parcours de paiement.', {
        id: el.id || null,
        classe: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || null,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      });
      return false;
    }

    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}

    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;

    // UN clic, c'est UN clic.
    //
    // La sequence se terminait par un evenement 'click' dispatche PUIS un
    // appel a el.click(), qui en dispatche un second : deux activations pour
    // un seul appel, sur un bouton qui n'en attend qu'une. Sur Epic, le
    // premier ouvre la fenetre d'achat et le second retombe dedans -- c'est
    // le symptome de la fenetre qui s'ouvre et reste figee, signale le
    // 2026-09-17. el.click() ne sert plus que de REPLI, quand le dispatch a
    // echoue (pas de constructeur d'evenement, element hors document).
    var dispatched = true;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      try {
        var EventCtor = type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
        var init = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: 1,
          button: 0,
          buttons: type === 'pointerdown' || type === 'mousedown' ? 1 : 0,
          clientX: cx,
          clientY: cy
        };
        // Un PointerEvent sans pointerId ni isPrimary est ignore par certains
        // gestionnaires : ils le prennent pour un evenement de test.
        if (type.indexOf('pointer') === 0) {
          init.pointerId = 1;
          init.pointerType = 'mouse';
          init.isPrimary = true;
        }
        el.dispatchEvent(new EventCtor(type, init));
      } catch (e) {
        if (type === 'click') dispatched = false;
      }
    });

    if (!dispatched) {
      try { el.click(); } catch (e) {}
    }

    var seen = clickHistoryFor(el);
    if (seen) { seen.count++; seen.last = Date.now(); }
    return true;
  }

  var ACTION_WARN_SEEN = {};
  var ACTION_WARN_EVERY_MS = 5000;

  // Le libelle d'un controle, ramene a une forme comparable : Epic ecrit ses
  // libelles francais avec des espaces insecables et repartit le texte sur
  // plusieurs descendants, ce qui donne des blancs multiples dans textContent.
  // Un motif ancre en ^...$ echouait dessus alors que le bouton etait le bon.
  function actionText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findActionElement(root, patterns, options) {
    options = options || {};
    var mustBeEnabled = options.mustBeEnabled !== false;
    var label = options.label || '';
    if (!root) return null;

    var candidates = Array.prototype.slice.call(root.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    var found = candidates.find(function (el) {
      var text = actionText(el);
      if (!text) return false;
      var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) return false;
      if (mustBeEnabled && (el.disabled || el.getAttribute('aria-disabled') === 'true')) return false;
      return patterns.some(function (p) { return p.test(text); });
    }) || null;

    if (!found && label) {
      /* Une fois par libelle et par tranche de cinq secondes.
       *
       * Ce message est appele depuis l'interieur d'une attente qui sonde
       * toutes les 300 ms : sans frein, un echec de douze secondes ecrit
       * quarante lignes identiques, et la ligne utile -- celle qui NOMME les
       * boutons vus -- se perd au milieu. Constate le 2026-09-17 sur une
       * capture de console. */
      var now = Date.now();
      if (!(ACTION_WARN_SEEN[label] > now - ACTION_WARN_EVERY_MS)) {
        ACTION_WARN_SEEN[label] = now;
        var sources = patterns.map(function (p) { return p.source; }).join(', ');
        log('CORE', 'warn', 'findActionElement("' + label + '") : aucun element visible ne correspond a [' + sources + ']');
      }
    }
    return found;
  }

  // Tous les candidats visibles et actifs qui portent un des motifs.
  function collectActionElements(root, patterns) {
    if (!root) return [];
    var candidates = Array.prototype.slice.call(root.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    return candidates.filter(function (el) {
      var text = actionText(el);
      if (!text) return false;
      var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return patterns.some(function (p) { return p.test(text); });
    });
  }

  // Le candidat au libelle le PLUS COURT. Sert avec des motifs non ancres :
  // un conteneur role="button" qui embarque le bouton et son paragraphe matche
  // aussi, mais le vrai bouton est celui qui ne porte que son libelle.
  function findShortestActionElement(root, patterns) {
    var all = collectActionElements(root, patterns);
    if (!all.length) return null;
    all.sort(function (a, b) {
      return actionText(a).length - actionText(b).length;
    });
    return all[0];
  }

  // Les libelles des controles visibles de la page, pour un message d'echec
  // qui DIAGNOSTIQUE : "bouton introuvable" n'apprend rien, "boutons vus :
  // Acheter, Liste de souhaits" dit exactement quel motif ajouter.
  function visibleActionLabels(limit) {
    var candidates = Array.prototype.slice.call(document.querySelectorAll('button, a[role="button"], div[role="button"], span[role="button"]'));
    var labels = [];
    for (var i = 0; i < candidates.length && labels.length < (limit || 8); i++) {
      var el = candidates[i];
      var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) continue;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 45) continue;
      if (labels.indexOf(text) === -1) labels.push(text);
    }
    return labels;
  }

  function findAllActionElements(root, patterns, options) {
    options = options || {};
    var mustBeEnabled = options.mustBeEnabled !== false;
    if (!root) return [];
    var candidates = Array.prototype.slice.call(root.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    return candidates.filter(function (el) {
      var text = actionText(el);
      if (!text) return false;
      var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      if (!visible) return false;
      if (mustBeEnabled && (el.disabled || el.getAttribute('aria-disabled') === 'true')) return false;
      return patterns.some(function (p) { return p.test(text); });
    });
  }

  function findCloseButton(container) {
    if (!container) return null;
    var explicit = container.querySelector('button[aria-label*="close" i], button[aria-label*="fermer" i], [role="button"][aria-label*="close" i], [role="button"][aria-label*="fermer" i]');
    if (explicit) return explicit;

    var candidates = Array.prototype.slice.call(container.querySelectorAll('button, [role="button"]'));
    var iconOnly = candidates.find(function (el) {
      var text = (el.textContent || '').trim();
      var visible = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      return visible && !text && (el.querySelector('svg') || el.querySelector('img'));
    });
    return iconOnly || null;
  }

  function findModalContainerFromHeading(heading) {
    if (!heading) return document;
    return heading.closest('[role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="dialog" i]') || heading.parentElement || document;
  }

  var epicLauncherModalSeen = false;

  // Retrouve la modale Epic dont le texte porte le motif.
  //
  // D'abord par les titres -- h1 a h6 ET role="heading", parce qu'Epic a
  // change son balisage : la modale "droit de retractation" observee le
  // 2026-08-27 n'avait plus son titre dans h1-h3, et le guetteur, aveugle,
  // laissait la popup a l'utilisateur. Puis, en repli, par le texte entier
  // des conteneurs de dialogue : un titre rendu dans un <span> ou un <div>
  // stylise echappe a tout balayage de headings, quel qu'il soit.
  function findEpicModalByText(pattern) {
    var headings = Array.prototype.slice.call(
      document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')
    );
    var heading = headings.find(function (h) { return pattern.test(h.textContent || ''); });
    if (heading) return findModalContainerFromHeading(heading);

    var dialogs = Array.prototype.slice.call(
      document.querySelectorAll('[role="dialog"], [aria-modal="true"]')
    );
    return dialogs.find(function (d) { return pattern.test(d.textContent || ''); }) || null;
  }

  // La fenetre d'achat Epic est-elle deja ouverte ?
  //
  // Sert a ne pas recliquer le bouton d'acquisition par-dessus une fenetre qui
  // vient de s'ouvrir : withRetry rappelle la reclamation apres un echec, et
  // le clic de trop laissait la fenetre figee.
  function epicPurchaseOverlayOpen() {
    try {
      // Le conteneur d'achat d'Epic et SON iframe, pas "une iframe dont l'URL
      // contient payment" : ce dernier selecteur sert de repli apres un clic,
      // il serait trop large pour DECIDER de ne pas cliquer. Un faux positif
      // ici, c'est une reclamation qui n'a jamais lieu.
      if (document.querySelector('#webPurchaseContainer, iframe[src*="payment-website-pci" i]')) return true;

      // Une modale de fin d'achat reellement affichee. Le texte seul ne suffit
      // pas : une mention du droit de retractation en pied de page n'est pas
      // une fenetre ouverte.
      var dialogs = Array.prototype.slice.call(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
      return dialogs.some(function (d) {
        var visible = !!(d.offsetWidth || d.offsetHeight || (d.getClientRects && d.getClientRects().length));
        if (!visible) return false;
        var text = d.textContent || '';
        return EPIC_WITHDRAWAL_HEADING_PATTERN.test(text) || EPIC_LAUNCHER_MODAL_HEADING_PATTERN.test(text);
      });
    } catch (e) {}
    return false;
  }

  // Les sondes repassent sur les memes modales : ces deux temoins bornent le
  // RECLIC (le premier clic peut n'avoir pas pris ; un par seconde n'est pas
  // une nouvelle chance). La memoire de robustClick ne suffit pas ici : React
  // remonte parfois un noeud neuf, que le journal des clics ne reconnait pas.
  var lastWithdrawalActionAt = 0;
  var lastLauncherActionAt = 0;

  function handleEpicPostPurchaseModals() {
    var now = Date.now();
    var modal1 = findEpicModalByText(EPIC_WITHDRAWAL_HEADING_PATTERN);
    if (modal1 && now - lastWithdrawalActionAt >= CONFIG.epicModalActionRetryMs) {
      /* Le repli non ancre, ici aussi -- troisieme endroit ou le meme piege
       * coute une version. Le textContent d'un bouton Epic concatene tous ses
       * descendants ; un motif en ^...$ echoue des qu'un span s'y glisse.
       *
       * Et un repli au niveau du DOCUMENT en dernier recours : le conteneur
       * deduit du titre ne contient pas forcement les boutons, selon la facon
       * dont Epic imbrique sa modale. On n'arrive ici que parce que la modale
       * de retractation est bien presente. */
      var agreeBtn = findActionElement(modal1, EPIC_AGREE_PATTERNS, { mustBeEnabled: true })
          || findShortestActionElement(modal1, EPIC_AGREE_LOOSE_PATTERNS)
          || findShortestActionElement(document, EPIC_AGREE_LOOSE_PATTERNS);
      if (agreeBtn) {
        lastWithdrawalActionAt = now;
        log('Epic Games', 'info', 'Popup "droit de retractation" detectee, clic sur "' + (agreeBtn.textContent || '').replace(/\s+/g, ' ').trim() + '".');
        robustClick(agreeBtn);
      } else if (!epicWithdrawalReported) {
        /* Une modale vue sans bouton reconnu est le pire des deux mondes : le
         * parcours s'arrete, et rien ne dit pourquoi. Une seule fois, sinon
         * le guetteur ecrit cette ligne chaque seconde pendant trois minutes. */
        epicWithdrawalReported = true;
        log('Epic Games', 'warn', 'Popup "droit de retractation" detectee, mais aucun bouton d\'accord reconnu. Boutons visibles : '
          + (visibleActionLabels(8).join(' | ') || 'aucun'));
      }
    }

    var modal2 = findEpicModalByText(EPIC_LAUNCHER_MODAL_HEADING_PATTERN);
    if (modal2) {
      epicLauncherModalSeen = true;
      if (now - lastLauncherActionAt < CONFIG.epicModalActionRetryMs) return true;
      lastLauncherActionAt = now;
      var closeBtn = findCloseButton(modal2);
      if (closeBtn) {
        log('Epic Games', 'info', 'Popup "Lanceur Epic Games installe ?" detectee (= succes), fermeture via la croix.');
        robustClick(closeBtn);
      } else {
        log('Epic Games', 'warn', 'Popup "Lanceur" detectee mais pas de croix de fermeture trouvee, tentative via la touche Echap.');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      }
      return true;
    }
    return false;
  }

  // Veille bornee : un balayage des titres chaque seconde a vie sur chaque
  // onglet Epic ouvert etait inutile hors reclamation.
  var epicWithdrawalReported = false;
  var epicModalWatcherId = 0;
  var epicModalWatcherUntil = 0;
  var epicModalWatcherHardStop = 0;

  function startEpicPostPurchaseModalWatcher(durationMs) {
    if (IS_EPIC_PAYMENT_FRAME) return;
    var debut = Date.now();
    epicModalWatcherUntil = debut + (durationMs || CONFIG.epicModalWatchDurationMs);
    epicModalWatcherHardStop = Math.max(epicModalWatcherHardStop, debut + CONFIG.epicModalWatchMaxDurationMs);
    if (epicModalWatcherId) return;
    epicModalWatcherId = setInterval(function () {
      var t = Date.now();
      // Tant que la fenetre d'achat est OUVERTE, la veille ne s'arrete pas :
      // c'est precisement le moment ou les popups arrivent, et un achat lent
      // depassait les trois minutes accordees depuis le debut de la
      // reclamation -- la veille expirait juste avant la popup a fermer. Le
      // plafond dur evite la veille perpetuelle sur une fenetre laissee
      // ouverte sans suite.
      if (t < epicModalWatcherHardStop && epicPurchaseOverlayOpen()) {
        epicModalWatcherUntil = Math.min(t + CONFIG.epicModalWatchDurationMs, epicModalWatcherHardStop);
      }
      if (t > epicModalWatcherUntil) {
        clearInterval(epicModalWatcherId);
        epicModalWatcherId = 0;
        return;
      }
      handleEpicPostPurchaseModals();
    }, CONFIG.epicPostPurchaseModalPollMs);
  }

