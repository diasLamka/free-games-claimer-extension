// ==UserScript==
// @name         Free Games Auto-Claimer (Epic / GOG / Amazon Luna)
// @namespace    https://local.userscripts/free-games-claimer
// @version      2.7.0
// @description  Detecte et recupere automatiquement les jeux gratuits sur Epic Games Store, GOG et Amazon Luna (uniquement les pages /claims), avec bouton flottant. Ecrit en syntaxe ES5 (sans template literals) pour eviter tout probleme de linter dans l'editeur Tampermonkey.
// @author       (a personnaliser)
// @match        https://store.epicgames.com/*
// @match        https://www.gog.com/*
// @match        https://gog.com/*
// @match        https://luna.amazon.com/claims/*
// @match        https://luna.amazon.fr/claims/*
// @match        https://luna.amazon.de/claims/*
// @match        https://luna.amazon.co.uk/claims/*
// @match        https://luna.amazon.it/claims/*
// @match        https://luna.amazon.es/claims/*
// @match        https://luna.amazon.ca/claims/*
// @match        https://luna.amazon.com.au/claims/*
// @match        https://luna.amazon.co.jp/claims/*
// @match        https://luna.amazon.in/claims/*
// @match        https://luna.amazon.com.mx/claims/*
// @match        https://luna.amazon.com.br/claims/*
// @match        https://luna.amazon.nl/claims/*
// @match        https://luna.amazon.se/claims/*
// @match        https://luna.amazon.pl/claims/*
// @match        https://luna.amazon.com.tr/claims/*
// @include      /^https:\/\/luna\.amazon\.[a-z.]+\/claims(\/|$|\?)/i
// @match        https://gaming.amazon.com/*
// @match        https://payment-website-pci.ol.epicgames.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @connect      store-site-backend-static.ak.epicgames.com
// @connect      store-site-backend-static-ipv4.ak.epicgames.com
// @run-at       document-idle
// ==/UserScript==

/*
 * =============================================================================
 * FREE GAMES AUTO-CLAIMER -- v2.7.0
 * =============================================================================
 * NOUVEAUTES v2.7.0 :
 *  - Modules GOG (giveaway) : les motifs etaient restes sans accents, donc
 *    "Recuperer", "Dans la bibliotheque", "deja possede" ne matchaient jamais
 *    l'interface francaise. Corrige (meme classe de bug que v2.5.0).
 *  - Module Steam retire : il n'avait aucun @match (code jamais execute) et
 *    Steam ne propose pas de jeux a reclamer au sens Epic/Luna.
 *  - La veille des modales de fin d'achat Epic ne tourne plus indefiniment :
 *    elle demarre a la reclamation et s'arrete d'elle-meme au bout de 3 min.
 *  - Le script sort immediatement des iframes tierces (seule l'iframe de
 *    paiement Epic est traitee) : plus d'executions paralleles inutiles.
 *  - Verification apres reclamation Epic : si le bouton "Obtenir" est encore
 *    visible 2,5 s apres, rien n'est enregistre comme "reclame" (le jeu sera
 *    retente) au lieu d'etre perdu pour la semaine.
 *  - Les codes a echanger memorisent leur date limite (affichee par Amazon) ;
 *    elle apparait dans les notifications et dans "Voir les codes en attente".
 *  - Amazon Luna : les offres de contenu en jeu (offer-list-IN_GAME_LOOT) sont
 *    traitees comme les jeux (CONFIG.lunaClaimDlc pour desactiver).
 *  - Menu "Voir l'historique de cette plateforme".
 *
 * CORRECTIF v2.6.0 (relances systematiques) :
 *  - Le mode auto repartait a chaque retour sur l'onglet (visibilitychange),
 *    a chaque chargement de page et a chaque changement d'URL interne. Un
 *    delai de repos persistant (stockage Tampermonkey, partage entre onglets)
 *    encadre desormais les verifications automatiques :
 *      * 30 min apres une verification (CONFIG.autoCooldownMs),
 *      * 6 h quand il n'y a plus rien a reclamer (CONFIG.autoIdleCooldownMs),
 *      * 15 min apres un echec, pour ne pas marteler (autoFailureCooldownMs).
 *    Les actions manuelles (bouton Claim, commandes de menu) ignorent ce delai
 *    et le remettent a zero.
 *  - Le surveillant de navigation interne ne reagit plus qu'a un changement de
 *    CHEMIN : Epic et Amazon reecrivent en permanence la query (suivi, ?lang=),
 *    ce qui relancait un cycle complet toutes les 1,5 s.
 *  - Menu "Relancer maintenant (ignorer le delai)" et etat du delai visible
 *    dans la console au demarrage.
 *
 * CORRECTIF v2.5.0 (etapes finales : "captcha" a tort, boutons non cliques) :
 *  - detectSecurityChallenge ne retenait que le src des iframes : Epic charge
 *    en permanence une iframe hCaptcha/Arkose INVISIBLE, donc chaque clic
 *    finissait en "Defi de securite detecte" alors qu'il suffisait de cliquer.
 *    Seuls un cadre de defi VISIBLE (> 50 px, non masque) ou un champ de code
 *    a usage unique VISIBLE comptent desormais comme defi.
 *  - Les libelles reels du store sont accentues : "Ajouter a la bibliotheque",
 *    "droit de retractation", "Le lanceur Epic Games est-il installe ?",
 *    "Recuperer" (modale Code promo GOG). Les motifs ASCII de v2.4.0 ne
 *    matchaient aucun de ces boutons : l'enchainement s'arretait juste avant
 *    la fin. Tous les motifs tolerent maintenant accents et apostrophe typo.
 *  - Modale GOG "Code promo" : le bouton "Recuperer" est reconnu comme
 *    confirmation finale, "Annuler" reste ignore.
 *
 * NOUVEAUTES v2.4.0 (Amazon Luna automatique + echange des codes GOG) :
 *  - Le module Luna demarre tout seul au chargement d'une page
 *    luna.amazon.<tld>/claims/... (toggle "Auto Luna : ON/OFF" dans le widget et
 *    dans le menu Tampermonkey). Sans session Amazon : simple notification.
 *  - Les libelles francais accentues ("Recuperer le jeu", "Obtenir le jeu",
 *    "Recupere", "bibliotheque") sont reconnus ; les motifs sans accent de
 *    v2.2.0 ne trouvaient aucun bouton sur l'interface francaise.
 *  - Les attributs stables de la page (data-a-target : offer-list-FGWP_FULL,
 *    item-card, FGWPOffer, buy-box, buy-box_call-to-action,
 *    DescriptionItemDetails, LinkAccountButton, ClaimStateClaimCodeContent,
 *    sign-in-button) sont utilises en priorite, le texte en repli.
 *  - La plateforme de destination est deduite du suffixe du slug de l'offre
 *    (/claims/<slug>-<epic|gog|aga|legacy|...>/dp/amzn1.pg.item...) et du
 *    texte "X pour PC sur <magasin>." de la fiche :
 *      * Legacy Games : ignore (jamais reclame) ;
 *      * Epic / Amazon Games / comptes relies : reclamation directe ;
 *      * GOG : le code affiche par Amazon est copie dans le presse-papiers,
 *        mis en attente (stockage Tampermonkey), puis echange automatiquement
 *        sur gog.com/redeem (voir ci-dessous) ;
 *      * Microsoft Store / Xbox : code copie dans le presse-papiers +
 *        notification (clic = ouverture de account.microsoft.com/billing/
 *        redeem) : a coller manuellement.
 *  - Parcours par offre : la page liste construit une file (sessionStorage)
 *    et le script visite chaque fiche l'une apres l'autre (une offre par
 *    chargement de page), clique "Obtenir le jeu", gere l'etape "Complete
 *    Claim", detecte "Associer un compte" (offre passee + notification), puis
 *    revient a la liste avec un resume. Reconnexion Amazon demandee : arret,
 *    la file reprend au prochain chargement de /claims apres connexion.
 *  - Nouveau module GOG "redeem" : sur gog.com/redeem, chaque code en attente
 *    est saisi dans #codeInput, "Continuer" puis "Utiliser le code" sont
 *    cliques, le resultat est lu (ajoute a la bibliotheque / code deja
 *    utilise / code invalide). Le reCAPTCHA invisible de la page ne bloque
 *    pas ; un captcha VISIBLE arrete le script (validation manuelle, puis
 *    reprise). A la fin de la serie Luna, gog.com/redeem s'ouvre dans un
 *    nouvel onglet si des codes GOG sont en attente.
 *  - Nouveaux @grant : GM_setClipboard (copie des codes), GM_openInTab
 *    (ouverture de la page d'echange). Menu : voir les codes en attente,
 *    oublier tous les codes en attente (irreversible), echanger les codes GOG
 *    maintenant, vider la file Luna en cours, basculer le mode auto Luna.
 *  - Revue : lot Luna remis a zero en fin de serie et fiche visitee hors
 *    serie traitee sans toucher a la file ; "Associer un compte" n'est
 *    retenu que s'il apparait APRES le clic (la fiche l'affiche deja avant) ;
 *    pour GOG/Microsoft un succes attend 6 s l'affichage du code ; textes
 *    compares noeud par noeud (textContent concatene sans espace) ; sur
 *    gog.com/redeem la route interne /redeem/<code> ne relance pas le module,
 *    "Code non trouve." est reconnu, un code refuse n'est pas reessaye et un
 *    captcha ne compte pas comme essai.
 *
 * CORRECTIF v2.3.0 (erreur 404 Epic en mode automatique) :
 *  - L'API freeGamesPromotions renvoie parfois un productSlug herite du type
 *    "cardpocalypse/home". Le script construisait alors
 *    store.epicgames.com/p/cardpocalypse/home, qu'Epic redirige vers
 *    www.epicgames.com/site/p/... -> 404. Le slug est desormais resolu en
 *    priorite depuis offerMappings / catalogNs.mappings, puis productSlug
 *    nettoye (suffixe "/home" retire), et urlSlug en dernier recours ; les
 *    hash d'offre (32 hex, ex. jeux mystere) sont ignores car ils menent a
 *    la page /not-found.
 *  - Epic a supprime le prefixe de langue dans le chemin (/fr/free-games
 *    repond 301 vers /free-games?lang=fr). Toutes les URL sont construites
 *    sur ce nouveau schema (CONFIG.epicStoreOrigin + ?lang=CONFIG.epicLang).
 *  - Les bundles sont ouverts via /bundles/<slug>, les jeux/add-ons via
 *    /p/<slug>. extractEpicSlug reconnait les deux formes et tolere
 *    ?lang=xx, l'ancien prefixe /fr/ et le suffixe /home.
 *  - Seules les promos actives maintenant (fenetre de dates + prix remise a
 *    0) sont retenues : les jeux "Bientot disponible" ne sont plus comptes
 *    comme reclamables.
 *  - Sur /free-games le script attend le rendu des cartes (page rendue cote
 *    client) avant de conclure qu'une carte est absente et de rediriger.
 *  - Atterrissage sur store.epicgames.com/not-found apres une redirection du
 *    script : le slug fautif est marque "bad_url" (7 jours), plus aucune
 *    redirection vers lui, retour automatique sur /free-games.
 *  - Sur une fiche produit d'un jeu gratuit non reclame, le mode auto lance
 *    la reclamation sur place au lieu de renvoyer vers /free-games (evite le
 *    ping-pong entre les deux pages).
 *  - Repli DOM realigne sur le libelle actuel des cartes ("Gratuit jusqu'au
 *    ..." / "Free until ...") en excluant "Bientot disponible" et les
 *    free-to-play "Jeu de base".
 *  - Motifs de boutons tolerants aux accents ("Recuperer", "Dans la
 *    bibliotheque") via des echappements \u00e9 / \u00e8.
 *  - La commande de menu "Effacer l'historique" utilisait la cle
 *    FGC_history_<hostname> alors que l'historique est stocke sous
 *    FGC_history_<nom de plateforme> : elle n'effacait rien. Corrige.
 *  - Garde anti-reentrance du module Epic (120 s) : le watcher SPA relancait
 *    le module pendant une reclamation en cours (double clic sur "Obtenir").
 *  - Marqueur de reprise FGC_epic_pending_slug horodate (5 min), efface des
 *    que la reclamation se termine dans le meme document, et jamais utilise
 *    pour degrader une entree deja "claimed" : arrivee sur la fiche visee ->
 *    reclamation sur place ; arrivee sur /not-found -> slug bloque.
 *  - Le rejet interne 'STOP' (arret volontaire deja journalise) n'est plus
 *    affiche comme "Erreur : undefined" dans le widget.
 *
 * CORRECTIF v2.2.0 : les @match Amazon Luna sont desormais restreints au
 * chemin /claims/* (ex. luna.amazon.fr/claims/home) au lieu de tout le
 * domaine. Le script (et donc le widget flottant) ne se charge plus du tout
 * sur les pages de jeu / bibliotheque / accueil Luna, uniquement sur les
 * pages de reclamation des jeux gratuits.
 *
 * CORRECTIF v2.1.0 : plus aucun template literal (backtick) dans tout le
 * fichier. Toutes les chaines interpolees ont ete reecrites en concatenation
 * classique ('a' + b + 'c'), pour eliminer definitivement l'erreur de
 * parsing affichee par le linter integre de certaines versions de
 * Tampermonkey, qui ne reconnait pas la syntaxe ES6 des template literals.
 * =============================================================================
 */

(function () {
  'use strict';

  var CONFIG = {
    pollInterval: 1500,
    maxRetries: 5,
    retryDelayBase: 1200,
    claimDelayMin: 800,
    claimDelayMax: 2200,
    waitForElementTimeout: 15000,
    epicAutoCheckIntervalMs: 6 * 60 * 60 * 1000,
    epicMaxRedirectsPerSlug: 2,
    epicPaymentCompletionTimeout: 30000,
    epicPostPurchaseModalPollMs: 1000,
    // Un meme bouton ne recoit pas une rafale de clics. Le guetteur des
    // modales de fin d'achat repasse toutes les secondes, et l'attente de
    // confirmation toutes les 500 ms : sans ces bornes, le meme "J'accepte"
    // prenait plusieurs clics par seconde, et une modale React cliquee
    // pendant sa transition ne se referme plus.
    clickCooldownMs: 4000,
    maxClicksPerElement: 3,
    // Delai avant de RECLIQUER l'action d'une modale toujours affichee : le
    // premier clic peut n'avoir pas pris, mais un par seconde n'est pas une
    // nouvelle chance, c'est du martelage.
    epicModalActionRetryMs: 5000,
    // Plafond dur de la veille des modales : elle se prolonge tant que la
    // fenetre d'achat est ouverte, jamais au-dela.
    epicModalWatchMaxDurationMs: 10 * 60 * 1000,
    // Veille de la frame d'achat (la sentinelle). Sa fenetre se reprolonge
    // tant que la frame MONTRE ou CHANGE quelque chose ; passe ce silence, la
    // commande est finie, ou perdue, et il n'y a plus rien a y faire.
    epicPaymentFrameWatchDurationMs: 20000,
    epicPaymentFrameQuietMs: 20000,
    // Actions REELLES (clics acceptes par robustClick) autorisees dans une
    // frame d'achat. Le parcours du prestataire en demande quatre : accord,
    // bibliotheque, commande, continuer. Six laisse une marge, pas un
    // blanc-seing.
    epicPaymentFrameMaxActions: 6,
    // Deuxieme chance sur le MEME bouton et le MEME ecran : un premier clic
    // peut n'avoir pas pris. Une seule, et pas avant douze secondes -- au-dela
    // c'est du martelage, et le 2026-09-17 a montre ce que ca coute.
    epicPaymentFrameRetrySameMs: 12000,
    epicPaymentFrameStuckNoticeMs: 30000,
    // Le cadre du dessus attend tant que SA fenetre d'achat est a l'ecran,
    // jamais au-dela : un onglet pilote a cinq minutes en tout
    // (watch/claim.js), et la verification finale doit tenir dans ce budget.
    epicPurchaseSettleMaxMs: 150000,
    epicPurchaseStuckNoticeMs: 60000,
    epicFreeGamesApiUrls: [
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR',
      'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=fr-FR&country=FR&allowCountries=FR'
    ],
    // Nouveau schema d'URL Epic : plus de prefixe de langue dans le chemin,
    // la langue passe en parametre ?lang=xx (mettre '' pour laisser Epic choisir).
    epicStoreOrigin: 'https://store.epicgames.com',
    epicLang: 'fr',
    // Temps d'attente du rendu cote client des cartes sur /free-games avant
    // de conclure qu'une carte est absente et de rediriger vers sa fiche.
    epicCardWaitTimeout: 8000,
    // Duree pendant laquelle un slug ayant mene a /not-found reste bloque.
    epicBadUrlTtlMs: 7 * 24 * 60 * 60 * 1000,
    // Duree de validite du marqueur de reprise pose avant une navigation
    // lancee par le script (au-dela, un residu est ignore).
    epicPendingSlugTtlMs: 5 * 60 * 1000,
    lunaClaimsPath: '/claims/home?filter=Game&g=s',
    // Delais de repos des verifications AUTOMATIQUES (les actions manuelles
    // les ignorent). Mettre 0 pour revenir au comportement d'avant v2.6.0.
    autoCooldownMs: 30 * 60 * 1000,
    autoIdleCooldownMs: 6 * 60 * 60 * 1000,
    autoFailureCooldownMs: 15 * 60 * 1000,
    // Duree de veille des modales de fin d'achat Epic (au lieu d'une veille
    // permanente sur chaque onglet).
    epicModalWatchDurationMs: 3 * 60 * 1000,
    // Delai avant de verifier que la reclamation Epic a bien abouti.
    epicClaimVerifyDelayMs: 2500,
    // Reclamer aussi le contenu en jeu (DLC) propose sur Amazon Luna.
    lunaClaimDlc: true,
    // Amazon Luna : attente du rendu des offres / de la fiche, observation du
    // resultat apres le clic, nombre d'essais par offre avant abandon.
    lunaOffersWaitTimeout: 15000,
    lunaClaimOutcomeTimeout: 20000,
    lunaMaxAttemptsPerOffer: 2,
    // Plateformes de destination a ne jamais reclamer (suffixe du slug).
    lunaSkipStores: ['legacy'],
    // Echange des codes sur les magasins partenaires.
    gogRedeemUrl: 'https://www.gog.com/redeem',
    gogRedeemMaxAttempts: 3,
    gogRedeemOutcomeTimeout: 20000,
    microsoftRedeemUrl: 'https://account.microsoft.com/billing/redeem'
  };

  var IS_EPIC_HOST = /(^|\.)epicgames\.com$/i.test(location.hostname);
  var IS_EPIC_PCI_FRAME = /payment-website-pci/i.test(location.hostname) && IS_EPIC_HOST;

  // Le script est injecte dans toutes les iframes de la page (publicites,
  // lecteurs video, widgets) : seules les iframes d'Epic nous interessent.
  var IS_TOP_FRAME = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();

  /* TOUTE sous-iframe d'Epic, et pas seulement celle du prestataire.
   *
   * Constate le 2026-09-17 sur "Mindcop" : la commande GRATUITE se termine
   * dans une iframe qui n'est PAS payment-website-pci -- il n'y a pas d'etape
   * carte bancaire pour un total a zero. Le module de paiement ne demarrait
   * donc jamais, la fiche attendait trente secondes une confirmation que
   * personne n'allait produire, et le bouton restait a l'ecran.
   *
   * On ne devine pas l'adresse de cette iframe : on accepte toutes celles
   * d'Epic, et c'est ce que le module a le droit d'y CLIQUER qui borne le
   * risque. Voir runEpicPaymentIframeModule : dans une sous-iframe autre que
   * celle du prestataire, il ne peut cliquer que "Ajouter a la bibliotheque"
   * puis "J'accepte" -- jamais "Valider la commande". Le premier ne peut pas
   * depenser d'argent, le second si. */
  var IS_EPIC_SUBFRAME = !IS_TOP_FRAME && IS_EPIC_HOST && !IS_EPIC_PCI_FRAME;
  var IS_EPIC_PAYMENT_FRAME = IS_EPIC_PCI_FRAME || IS_EPIC_SUBFRAME;

  if (!IS_TOP_FRAME && !IS_EPIC_PAYMENT_FRAME) return;

  // Les libelles reels du store sont accentues ("Recuperer", "Dans la
  // bibliotheque") : on tolere les deux graphies via des echappements unicode
  // pour garder le fichier en ASCII pur.
  var EPIC_MAIN_CTA_PATTERNS = [/^add to cart$/i, /^ajouter au panier$/i, /^get$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i];
  var APOS = "['\u2019]";
  var EPIC_OWNERSHIP_PATTERNS = [/in library/i, /dans la biblioth[e\u00e8]que/i, /^play$/i, /^jouer$/i];
  // Cartes de la rotation hebdomadaire sur /free-games : "Gratuit jusqu'au
  // 27 aout a 17:00" / "Free until ...". Les cartes "Bientot disponible" et
  // les free-to-play permanents ("Jeu de base ... Gratuit") sont exclus.
  var EPIC_FREE_NOW_CARD_PATTERN = /gratuit jusqu|free until|free now|gratuit maintenant|r[e\u00e9]cup[e\u00e9]rer maintenant|-\s*100\s*%/i;
  var EPIC_UPCOMING_CARD_PATTERN = /bient[o\u00f4]t disponible|coming soon|prochainement|[a\u00e0] venir|mystery game|jeu myst[e\u00e8]re/i;
  var EPIC_BASE_GAME_CARD_PATTERN = /^jeu de base|^base game/i;
  var EPIC_WITHDRAWAL_HEADING_PATTERN = /droit de r[e\u00e9]tractation|right of withdrawal/i;
  var EPIC_LAUNCHER_MODAL_HEADING_PATTERN = /lanceur epic games est-il install[e\u00e9]|is the epic games launcher installed/i;
  // Derniere etape de l'achat gratuit (iframe de paiement) : cf. captures.
  var EPIC_LIBRARY_PATTERNS = [/^ajouter [a\u00e0] la biblioth[e\u00e8]que$/i, /^add to library$/i, /^place order$/i, /^valider la commande$/i];
  // Variante NON ancree, en repli : le textContent d'un bouton Epic concatene
  // tous ses descendants, et un span invisible (lecteur d'ecran, spinner)
  // suffit a faire echouer un motif ancre en ^...$. Utilisee uniquement avec
  // findShortestActionElement, qui prefere le candidat au libelle le plus
  // court -- le vrai bouton, pas un conteneur qui l'embarque.
  var EPIC_LIBRARY_LOOSE_PATTERNS = [/ajouter [a\u00e0] la biblioth[e\u00e8]que/i, /add to library/i, /place order/i, /valider la commande/i];
  /* Les SEULS boutons qu'une sous-iframe Epic non-prestataire a le droit de
   * cliquer. La liste est courte a dessein : "Ajouter a la bibliotheque" ne
   * peut pas depenser d'argent, "Valider la commande" si -- et cette derniere
   * reste reservee a l'iframe du prestataire, ou le parcours est eprouve. */
  var EPIC_FREE_ORDER_PATTERNS = [/^ajouter [a\u00e0] la biblioth[e\u00e8]que$/i, /^add to library$/i];
  var EPIC_FREE_ORDER_LOOSE_PATTERNS = [/ajouter [a\u00e0] la biblioth[e\u00e8]que/i, /add to library/i];
  var EPIC_AGREE_PATTERNS = [/^j['\u2019]accepte$/i, /^i agree$/i, /^accepter$/i, /^accept$/i];
  // Variante NON ancree, meme raison que EPIC_LIBRARY_LOOSE_PATTERNS : un span
  // invisible dans le bouton fait echouer un motif ^...$. Volontairement plus
  // etroite que la liste ancree -- "accepter" seul, non ancre, matcherait
  // "Ne pas accepter".
  var EPIC_AGREE_LOOSE_PATTERNS = [/j['\u2019]accepte/i, /i agree/i];

  function log(platform, level, var_args) {
    var prefix = '[FGC][' + platform + '][' + level.toUpperCase() + ']';
    var fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
    var extraArgs = Array.prototype.slice.call(arguments, 2);
    var callArgs = [prefix, new Date().toISOString()].concat(extraArgs);
    fn.apply(console, callArgs);
  }

  function notifyUser(title, text, timeout) {
    timeout = typeof timeout === 'undefined' ? 8000 : timeout;
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title: title, text: text, timeout: timeout, silent: false });
      } else {
        console.log('[FGC][NOTIFY] ' + title + ': ' + text);
      }
    } catch (e) {
      console.error('[FGC] Echec de la notification', e);
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function randomDelay(min, max) {
    return sleep(min + Math.random() * (max - min));
  }

  function waitForElement(selectorOrFn, options) {
    options = options || {};
    var root = options.root || document;
    var timeout = typeof options.timeout === 'undefined' ? CONFIG.waitForElementTimeout : options.timeout;
    var interval = options.interval || 300;

    return new Promise(function (resolve, reject) {
      function resolveIfFound() {
        try {
          return typeof selectorOrFn === 'function' ? selectorOrFn() : root.querySelector(selectorOrFn);
        } catch (e) {
          return null;
        }
      }

      var existing = resolveIfFound();
      if (existing) { resolve(existing); return; }

      var settled = false;
      function cleanup() {
        observe.disconnect();
        clearInterval(pollId);
        clearTimeout(timeoutId);
      }

      var observe = new MutationObserver(function () {
        if (settled) return;
        var el = resolveIfFound();
        if (el) { settled = true; cleanup(); resolve(el); }
      });
      observe.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });

      var pollId = setInterval(function () {
        if (settled) return;
        var el = resolveIfFound();
        if (el) { settled = true; cleanup(); resolve(el); }
      }, interval);

      var timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('waitForElement: timeout apres ' + timeout + 'ms'));
      }, timeout);
    });
  }

  function withRetry(fn, options) {
    options = options || {};
    var retries = options.retries || CONFIG.maxRetries;
    var baseDelay = options.baseDelay || CONFIG.retryDelayBase;
    var label = options.label || 'operation';

    var attempt = 0;
    function tryOnce() {
      attempt++;
      return Promise.resolve()
        .then(function () { return fn(attempt); })
        .catch(function (err) {
          if (attempt >= retries) throw err;
          var delay = baseDelay * attempt + Math.random() * 400;
          log('CORE', 'warn', label + ' a echoue (tentative ' + attempt + '/' + retries + ') : ' + err.message + '. Nouvel essai dans ' + Math.round(delay) + 'ms.');
          return sleep(delay).then(tryOnce);
        });
    }
    return tryOnce();
  }

  function gmFetchJson(url, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest non disponible (permission @grant manquante ?).'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: timeout,
        headers: { Accept: 'application/json' },
        onload: function (res) {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error('HTTP ' + res.status + ' sur ' + url));
              return;
            }
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error('Reponse JSON invalide depuis ' + url + ' : ' + e.message));
          }
        },
        onerror: function () { reject(new Error('Echec reseau sur ' + url)); },
        ontimeout: function () { reject(new Error('Timeout reseau sur ' + url)); }
      });
    });
  }

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

    /* Le repli du dernier recours sort de sa prison.
     *
     * Jusqu'ici il vivait DANS le "if (modal1 ...)" : si la modale n'etait pas
     * reconnue -- titre hors des h1-h6, conteneur sans role="dialog" -- le
     * repli qui aurait trouve le bouton n'etait jamais evalue. Un repli qui ne
     * se declenche que quand on n'en a pas besoin.
     *
     * Il s'applique desormais aussi sans modale reconnue, mais SOUS GARDE :
     * uniquement quand une fenetre d'achat est ouverte. Hors de ce contexte,
     * un bouton "J'accepte" de la page n'a rien a voir avec nous. */
    if (!modal1 && epicPurchaseOverlayOpen() && now - lastWithdrawalActionAt >= CONFIG.epicModalActionRetryMs) {
      var accordSeul = findShortestActionElement(document, EPIC_AGREE_LOOSE_PATTERNS);
      if (accordSeul) {
        lastWithdrawalActionAt = now;
        log('Epic Games', 'info', 'Fenetre d\'achat ouverte et bouton d\'accord "'
          + actionText(accordSeul) + '" visible sans modale reconnue : clic.');
        robustClick(accordSeul);
      }
    }

    // Le temoin de diagnostic est par MODALE, pas par page : global et jamais
    // remis a faux, il taisait tous les incidents apres le premier.
    if (!modal1) epicWithdrawalReported = false;

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

  /* UN SEUL GUETTEUR, ET IL SAIT DANS QUELLE FRAME IL TOURNE.
   *
   * La garde "if (IS_EPIC_PAYMENT_FRAME) return" est levee : c'est elle qui
   * laissait la frame d'achat sans surveillance des que son module a tir
   * unique avait fini (2026-09-17, "MindCop"). Mais la lever ne suffit pas,
   * il faut AIGUILLER -- les deux passes ne font pas le meme travail et ne
   * doivent jamais echanger leurs roles :
   *
   *   - handleEpicPostPurchaseModals ne doit JAMAIS tourner dans la frame
   *     d'achat. findModalContainerFromHeading degenere en "document" quand
   *     rien de mieux ne matche : dans une frame qui EST la modale, "modale
   *     trouvee" deviendrait "le mot retractation apparait quelque part", y
   *     compris dans la mention legale affichee sous le recapitulatif. Son
   *     repli ultime au niveau du document court-circuiterait la liste des
   *     boutons autorises, qui vit dans 11-epic-payment.js. Et sa seconde
   *     branche envoie Echap ou clique une croix : le geste exactement
   *     contre-indique au milieu d'une commande.
   *   - epicPaymentFramePass ne doit JAMAIS tourner dans le cadre du dessus,
   *     ou il cliquerait "Ajouter a la bibliotheque" sur la fiche produit en
   *     dehors de tout parcours de reclamation. */
  function epicPostPurchasePass() {
    return IS_EPIC_PAYMENT_FRAME ? epicPaymentFramePass() : handleEpicPostPurchaseModals();
  }

  function epicPurchaseStillOnScreen() {
    return IS_EPIC_PAYMENT_FRAME ? epicPaymentFrameAlive() : epicPurchaseOverlayOpen();
  }

  function epicModalWatchWindowMs() {
    return IS_EPIC_PAYMENT_FRAME ? CONFIG.epicPaymentFrameWatchDurationMs : CONFIG.epicModalWatchDurationMs;
  }

  // Une passe de la veille, sortie du setInterval pour etre testable : le
  // harnais neutralise setInterval, un guetteur ne se teste pas "en marche".
  function epicPostPurchaseWatcherTick() {
    var t = Date.now();
    if (t < epicModalWatcherHardStop && epicPurchaseStillOnScreen()) {
      epicModalWatcherUntil = Math.min(t + epicModalWatchWindowMs(), epicModalWatcherHardStop);
    }
    if (t > epicModalWatcherUntil) {
      if (epicModalWatcherId) { clearInterval(epicModalWatcherId); epicModalWatcherId = 0; }
      log('CORE', 'info', 'Veille de fin d\'achat terminee ('
        + (IS_EPIC_PAYMENT_FRAME
            ? 'frame d\'achat, ' + epicPaymentActions + ' action(s), dernier ecran : ' + epicPaymentScreen
            : 'cadre principal') + ').');
      return false;
    }
    epicPostPurchasePass();
    return true;
  }

  function startEpicPostPurchaseModalWatcher(durationMs) {
    var start = Date.now();
    epicModalWatcherUntil = Math.max(epicModalWatcherUntil, start + (durationMs || epicModalWatchWindowMs()));
    epicModalWatcherHardStop = Math.max(epicModalWatcherHardStop, start + CONFIG.epicModalWatchMaxDurationMs);
    if (epicModalWatcherId) return;
    epicModalWatcherId = setInterval(epicPostPurchaseWatcherTick, CONFIG.epicPostPurchaseModalPollMs);
  }

  function isLikelyLoggedOut() {
    var loginPatterns = [/^sign in$/i, /^se connecter$/i, /^log in$/i, /^connexion$/i, /^connectez-vous$/i];
    return !!findActionElement(document, loginPatterns, { mustBeEnabled: false });
  }

  // Un cadre de captcha n'est un DEFI que s'il est reellement affiche : Epic,
  // GOG et Amazon chargent en permanence des iframes hCaptcha / reCAPTCHA /
  // Arkose invisibles. Les prendre pour un defi arretait le script juste avant
  // les derniers clics ("Ajouter a la bibliotheque", "J'accepte", "Recuperer").
  function isElementVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if (rect.width < 50 || rect.height < 50) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) return false;
    return true;
  }

  function detectSecurityChallenge() {
    var iframes = Array.prototype.slice.call(document.querySelectorAll('iframe'));
    var iframeHit = iframes.find(function (f) {
      return /captcha|hcaptcha|recaptcha|arkose|funcaptcha|challenge/i.test(f.src || '') && isElementVisible(f);
    });
    if (iframeHit) return { type: 'captcha', detail: iframeHit.src };

    // Defi Cloudflare (page 403 "Un instant...") : l'iframe Turnstile vit dans un
    // shadow root ferme, invisible a querySelectorAll. Seule la page de defi
    // charge le script d'orchestration ; le script jsd des pages saines et le
    // widget Turnstile d'un formulaire (GOG /redeem) ne comptent pas.
    var cfScript = Array.prototype.slice.call(document.querySelectorAll('script[src]')).find(function (s) {
      return /\/cdn-cgi\/challenge-platform\/.*\/orchestrate\//.test(s.src || '');
    });
    if (cfScript) return { type: 'captcha', detail: cfScript.src };

    var otpInput = document.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[maxlength="6"], input[maxlength="8"]');
    if (otpInput && (otpInput.offsetWidth || otpInput.offsetHeight)) {
      var bodyText = document.body ? document.body.innerText : '';
      if (/verification code|two-factor|authentification a deux facteurs|code de securite|security code|code de verification/i.test(bodyText)) {
        return { type: '2fa', detail: 'Champ de code de verification detecte avec texte contextuel associe.' };
      }
    }
    return null;
  }

  function isUserLikelyBusy() {
    var busySelectors = ['[class*="cart-drawer" i]', '[class*="checkout" i][class*="form" i]', 'iframe[src*="payment" i]', 'iframe[src*="checkout" i]'];
    return busySelectors.some(function (sel) {
      try {
        var el = document.querySelector(sel);
        return !!(el && (el.offsetWidth || el.offsetHeight));
      } catch (e) { return false; }
    });
  }

  function getHistory(platform) {
    try {
      var raw = GM_getValue('FGC_history_' + platform, '{}');
      return JSON.parse(raw);
    } catch (e) {
      log(platform, 'error', 'Historique corrompu, reinitialisation.', e);
      return {};
    }
  }

  function saveHistoryEntry(platform, gameKey, status, reason) {
    var history = getHistory(platform);
    history[gameKey] = { status: status, reason: reason || '', ts: Date.now() };
    GM_setValue('FGC_history_' + platform, JSON.stringify(history));
  }

  function removeHistoryEntry(platform, gameKey) {
    var history = getHistory(platform);
    if (history[gameKey]) {
      delete history[gameKey];
      GM_setValue('FGC_history_' + platform, JSON.stringify(history));
    }
  }

  function alreadyHandled(platform, gameKey) {
    var history = getHistory(platform);
    return !!(history[gameKey] && history[gameKey].status === 'claimed');
  }

  // ---------------------------------------------------------------------------
  // Delai de repos des verifications automatiques
  // ---------------------------------------------------------------------------
  // Partage entre onglets (stockage Tampermonkey) : sans lui, chaque onglet,
  // chaque rechargement et chaque retour sur l'onglet relancait un cycle.
  function getAutoState() {
    try { return JSON.parse(GM_getValue('FGC_auto_state', '{}')) || {}; } catch (e) { return {}; }
  }

  function autoCooldownRemaining(key) {
    var until = getAutoState()[key] || 0;
    return Math.max(0, until - Date.now());
  }

  function setAutoCooldown(key, ms) {
    var st = getAutoState();
    st[key] = Date.now() + (ms || 0);
    GM_setValue('FGC_auto_state', JSON.stringify(st));
  }

  function clearAutoCooldown(key) {
    var st = getAutoState();
    delete st[key];
    GM_setValue('FGC_auto_state', JSON.stringify(st));
  }

  function formatDelay(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  // Renvoie true si la verification automatique doit etre sautee.
  function autoRunBlocked(platform, key) {
    var left = autoCooldownRemaining(key);
    if (!left) return false;
    log(platform, 'info', 'Verification automatique en pause encore ' + formatDelay(left) + ' (cliquez sur Claim ou utilisez le menu pour forcer).');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Epic : resolution des slugs et construction des URL
  // ---------------------------------------------------------------------------

  // Ramene un slug brut de l'API ou d'une URL a la forme canonique attendue par
  // le store ("cardpocalypse"). Retourne null si la valeur ne peut pas donner
  // une URL valide :
  //  - "cardpocalypse/home"  -> "cardpocalypse" (suffixe herite retire)
  //  - "[]"                  -> null (jeu mystere sans page)
  //  - "3f18c54a6e00424b..." -> null (hash d'offre 32 hex : mene a /not-found)
  function normalizeEpicSlug(raw) {
    if (raw === null || typeof raw === 'undefined') return null;
    var s = String(raw).trim().toLowerCase();
    s = s.split('?')[0].split('#')[0];
    s = s.replace(/^\/+|\/+$/g, '');
    s = s.split('/')[0];
    if (!s || s === '[]') return null;
    if (/^[0-9a-f]{32}$/.test(s)) return null;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(s)) return null;
    return s;
  }

  function epicStoreUrl(path) {
    var url = CONFIG.epicStoreOrigin + path;
    if (CONFIG.epicLang) url += (path.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(CONFIG.epicLang);
    return url;
  }

  function epicPathBaseFor(el) {
    var isBundle = (el && el.offerType === 'BUNDLE') || ((el && el.categories) || []).some(function (c) { return c && c.path === 'bundles'; });
    return isBundle ? '/bundles/' : '/p/';
  }

  function buildEpicUrl(pathBase, slug) {
    return epicStoreUrl(pathBase + slug);
  }

  // Ordre de priorite (aligne sur les projets communautaires de claim Epic) :
  // offerMappings[].pageSlug (page de l'offre : jeu, add-on, bundle), puis
  // catalogNs.mappings[].pageSlug (page produit du namespace), puis productSlug
  // nettoye, puis urlSlug en dernier recours (souvent un identifiant interne).
  function resolveEpicSlug(el) {
    if (!el) return null;
    var candidates = [];
    ((el.offerMappings) || []).forEach(function (m) { if (m) candidates.push(m.pageSlug); });
    ((el.catalogNs && el.catalogNs.mappings) || []).forEach(function (m) { if (m) candidates.push(m.pageSlug); });
    candidates.push(el.productSlug);
    candidates.push(el.slugUrl);
    for (var i = 0; i < candidates.length; i++) {
      var slug = normalizeEpicSlug(candidates[i]);
      if (slug) return slug;
    }
    return null;
  }

  // Une promo est reclamable si l'une de ses fenetres est en cours ET que le
  // prix remise est a 0 (quand l'API fournit le prix).
  function isEpicPromoActiveNow(el, now) {
    now = typeof now === 'number' ? now : Date.now();
    var batches = (el && el.promotions && el.promotions.promotionalOffers) || [];
    var active = batches.some(function (batch) {
      return ((batch && batch.promotionalOffers) || []).some(function (offer) {
        if (!offer) return false;
        var start = offer.startDate ? new Date(offer.startDate).getTime() : -Infinity;
        var end = offer.endDate ? new Date(offer.endDate).getTime() : Infinity;
        if (isNaN(start)) start = -Infinity;
        if (isNaN(end)) end = Infinity;
        return start <= now && now < end;
      });
    });
    if (!active) return false;
    var total = el.price && el.price.totalPrice;
    if (total && typeof total.discountPrice === 'number') return total.discountPrice === 0;
    return true;
  }

  // Est-ce le jeu offert de la semaine, ou quelque chose de gratuit de toute
  // facon ?
  //
  // La difference se lit dans le prix d'origine, et nulle part ailleurs :
  //   originalPrice > 0 et discountPrice === 0  -> jeu payant, offert un temps
  //   originalPrice === 0                       -> gratuit en permanence
  //
  // Sur la capture reelle du 2026-08-27, le flux freeGamesPromotions rend deux
  // offres actives : Cardpocalypse a 23,99 EUR remis a zero, et un "Pack de
  // Mage Epique" a 0 EUR -- un cosmetique permanent, offerType ADD_ON, qu'il
  // n'y a rien a prendre. Sans ce controle le moteur ouvrait sa page a chaque
  // passage sur le magasin.
  //
  // Rend null quand l'API ne donne pas de prix : on ne devine pas.
  function isEpicFreeToKeep(el) {
    var total = el && el.price && el.price.totalPrice;
    if (!total || typeof total.originalPrice !== 'number') return null;
    if (total.originalPrice <= 0) return false;
    return total.discountPrice === 0;
  }

  // Transforme la liste "elements" de freeGamesPromotions en jeux reclamables
  // maintenant, avec un slug et une URL valides.
  function mapEpicApiElements(elements, now) {
    var games = [];
    (elements || []).forEach(function (el) {
      if (!el || !isEpicPromoActiveNow(el, now)) return;
      if (isEpicFreeToKeep(el) === false) {
        log('Epic Games', 'info', 'Ignore "' + el.title + '" : gratuit en permanence, rien a garder.');
        return;
      }
      var slug = resolveEpicSlug(el);
      if (!slug) {
        log('Epic Games', 'warn', 'Offre gratuite sans slug de page exploitable, ignoree : "' + el.title + '" (productSlug=' + el.productSlug + ', urlSlug=' + el.slugUrl + ').');
        return;
      }
      var pathBase = epicPathBaseFor(el);
      games.push({
        title: el.title,
        slug: slug,
        url: buildEpicUrl(pathBase, slug),
        pathBase: pathBase,
        offerType: el.offerType,
        id: el.id
      });
    });
    return games;
  }

  // Extrait le slug d'une URL de fiche Epic, quelle que soit sa forme :
  // /p/<slug>, /bundles/<slug>, /fr/p/<slug>, /p/<slug>/home, ...?lang=fr
  function extractEpicSlug(url) {
    var pathname;
    try {
      pathname = new URL(url, location.origin).pathname;
    } catch (e) {
      pathname = String(url || '').split('?')[0].split('#')[0];
    }
    var m = pathname.match(/\/(?:p|bundles)\/([^/?#]+)/i);
    return m ? normalizeEpicSlug(m[1]) : null;
  }

  function isEpicNotFoundPage(pathname) {
    return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?not-found\/?$/i.test(pathname || '');
  }

  function findEpicAnchorForSlug(slug) {
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/p/"], a[href*="/bundles/"]'));
    return anchors.find(function (a) { return extractEpicSlug(a.href) === slug; }) || null;
  }

  // La page /free-games est rendue cote client : les cartes de la semaine
  // apparaissent apres le premier rendu. On leur laisse le temps d'arriver.
  function waitForEpicAnchor(slug, timeout) {
    var immediate = findEpicAnchorForSlug(slug);
    if (immediate) return Promise.resolve(immediate);
    return waitForElement(function () { return findEpicAnchorForSlug(slug); }, { timeout: timeout, interval: 400 })
      .catch(function () { return null; });
  }

  function findEpicFreeNowCards() {
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/p/"], a[href*="/bundles/"]'));
    return anchors.filter(function (a) {
      var text = ((a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
      if (!text) return false;
      if (EPIC_UPCOMING_CARD_PATTERN.test(text)) return false;
      if (EPIC_BASE_GAME_CARD_PATTERN.test((a.textContent || '').replace(/\s+/g, ' ').trim())) return false;
      return EPIC_FREE_NOW_CARD_PATTERN.test(text) && !!extractEpicSlug(a.href);
    });
  }

  // Slug ayant mene a /not-found recemment : on ne redirige plus vers lui.
  function isEpicSlugBlocked(platform, slug) {
    var entry = getHistory(platform)[epicHistoryKeyForSlug(slug)];
    if (!entry || entry.status !== 'bad_url') return false;
    if (Date.now() - (entry.ts || 0) > CONFIG.epicBadUrlTtlMs) {
      removeHistoryEntry(platform, epicHistoryKeyForSlug(slug));
      return false;
    }
    return true;
  }

  // Marqueur de reprise "slug|timestamp" : il n'est honore qu'au chargement
  // qui suit de pres une navigation lancee par le script, et il est efface des
  // que la reclamation s'est terminee dans le meme document (navigation SPA).
  function setEpicPendingSlug(slug) {
    try { sessionStorage.setItem('FGC_epic_pending_slug', slug ? slug + '|' + Date.now() : ''); } catch (e) {}
  }

  function clearEpicPendingSlug() {
    try { sessionStorage.removeItem('FGC_epic_pending_slug'); } catch (e) {}
  }

  function takeEpicPendingSlug() {
    try {
      var raw = sessionStorage.getItem('FGC_epic_pending_slug') || '';
      sessionStorage.removeItem('FGC_epic_pending_slug');
      var parts = raw.split('|');
      var ts = parseInt(parts[1], 10);
      if (!parts[0] || isNaN(ts) || Date.now() - ts > CONFIG.epicPendingSlugTtlMs) return null;
      return parts[0];
    } catch (e) { return null; }
  }

  function platformNameForHost(host) {
    host = host || '';
    if (host.indexOf('epicgames.com') !== -1) return 'Epic Games';
    if (host.indexOf('gog.com') !== -1) return 'GOG';
    if (host.indexOf('luna.amazon.') !== -1 || host.indexOf('gaming.amazon.com') !== -1) return 'Amazon Luna';
    return host;
  }

  function epicHistoryKeyForSlug(slug) {
    return 'slug:' + slug;
  }

  function getRedirectCount(slug) {
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      return counts[slug] || 0;
    } catch (e) { return 0; }
  }

  function incrementRedirectCount(slug) {
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      counts[slug] = (counts[slug] || 0) + 1;
      sessionStorage.setItem('FGC_epic_redirect_counts', JSON.stringify(counts));
      return counts[slug];
    } catch (e) { return 1; }
  }

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

  var UI_STATE = { status: 'idle', message: 'Pret' };

  function getEpicAutoModeEnabled() { return GM_getValue('FGC_epic_auto_mode', true); }
  function setEpicAutoModeEnabled(val) { GM_setValue('FGC_epic_auto_mode', !!val); }

  function injectFloatingButton() {
    if (document.getElementById('fgc-floating-btn')) return;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(
        '#fgc-widget { position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 8px; font-family: system-ui, sans-serif; font-size: 13px; }\n' +
        '#fgc-floating-btn, #fgc-auto-toggle { background: #2c2f33; color: #fff; border: 1px solid #555; border-radius: 8px; padding: 10px 14px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }\n' +
        '#fgc-floating-btn:hover, #fgc-auto-toggle:hover { background: #3a3d42; }\n' +
        '#fgc-auto-toggle.fgc-auto-on { border-color: #4caf50; }\n' +
        '#fgc-auto-toggle.fgc-auto-off { border-color: #e74c3c; opacity: 0.8; }\n' +
        '#fgc-status-badge { background: rgba(0,0,0,0.75); color: #fff; border-radius: 6px; padding: 6px 10px; max-width: 280px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }\n' +
        '#fgc-status-badge.fgc-running { border-left: 3px solid #f5a623; }\n' +
        '#fgc-status-badge.fgc-ok { border-left: 3px solid #4caf50; }\n' +
        '#fgc-status-badge.fgc-error { border-left: 3px solid #e74c3c; }'
      );
    }

    var wrapper = document.createElement('div');
    wrapper.id = 'fgc-widget';

    var badge = document.createElement('div');
    badge.id = 'fgc-status-badge';
    badge.textContent = UI_STATE.message;

    var btn = document.createElement('button');
    btn.id = 'fgc-floating-btn';
    btn.type = 'button';
    btn.textContent = '\uD83C\uDFAE Claim';
    btn.title = 'Lancer la recuperation des jeux gratuits sur cette page';
    btn.addEventListener('click', function () {
      // Action manuelle : on ignore et on remet a zero le delai de repos.
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      updateUiState('running', 'Recherche en cours...');
      dispatch();
    });

    wrapper.appendChild(badge);
    wrapper.appendChild(btn);

    if (location.hostname.indexOf('epicgames.com') !== -1 && !IS_EPIC_PAYMENT_FRAME) {
      var toggle = document.createElement('button');
      toggle.id = 'fgc-auto-toggle';
      toggle.type = 'button';
      function refreshToggleLabel() {
        var enabled = getEpicAutoModeEnabled();
        toggle.textContent = enabled ? '\u23F1\uFE0F Auto hebdo : ON' : '\u23F1\uFE0F Auto hebdo : OFF';
        toggle.classList.toggle('fgc-auto-on', enabled);
        toggle.classList.toggle('fgc-auto-off', !enabled);
      }
      toggle.addEventListener('click', function () {
        setEpicAutoModeEnabled(!getEpicAutoModeEnabled());
        refreshToggleLabel();
        log('Epic Games', 'info', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      refreshToggleLabel();
      wrapper.appendChild(toggle);
    }

    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      var lunaToggle = document.createElement('button');
      lunaToggle.id = 'fgc-auto-toggle';
      lunaToggle.type = 'button';
      function refreshLunaToggleLabel() {
        var enabled = getLunaAutoModeEnabled();
        lunaToggle.textContent = enabled ? '\u23f1\ufe0f Auto Luna : ON' : '\u23f1\ufe0f Auto Luna : OFF';
        lunaToggle.classList.toggle('fgc-auto-on', enabled);
        lunaToggle.classList.toggle('fgc-auto-off', !enabled);
      }
      lunaToggle.addEventListener('click', function () {
        setLunaAutoModeEnabled(!getLunaAutoModeEnabled());
        refreshLunaToggleLabel();
        log('Amazon Luna', 'info', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      refreshLunaToggleLabel();
      wrapper.appendChild(lunaToggle);
    }

    (document.body || document.documentElement).appendChild(wrapper);
  }

  function updateUiState(status, message) {
    UI_STATE.status = status;
    UI_STATE.message = message;
    var badge = document.getElementById('fgc-status-badge');
    if (!badge) return;
    badge.classList.remove('fgc-running', 'fgc-ok', 'fgc-error');
    if (status === 'running') badge.classList.add('fgc-running');
    if (status === 'ok') badge.classList.add('fgc-ok');
    if (status === 'error') badge.classList.add('fgc-error');
    badge.textContent = message;
  }

  function fetchCurrentEpicFreebies() {
    var urls = CONFIG.epicFreeGamesApiUrls.slice();
    var lastErr = null;

    function tryNext(index) {
      if (index >= urls.length) return Promise.reject(lastErr || new Error('Aucun endpoint freeGamesPromotions accessible.'));
      return gmFetchJson(urls[index]).then(function (data) {
        var elements = (data && data.data && data.data.Catalog && data.data.Catalog.searchStore && data.data.Catalog.searchStore.elements) || [];
        return mapEpicApiElements(elements);
      }).catch(function (e) {
        lastErr = e;
        log('Epic Games', 'warn', 'Echec de l\'appel API freeGamesPromotions sur ' + urls[index] + ' : ' + e.message);
        return tryNext(index + 1);
      });
    }

    return tryNext(0);
  }

  function checkEpicWeeklyRotation(options) {
    options = options || {};
    var auto = !!options.auto;
    if (location.hostname.indexOf('epicgames.com') === -1 || IS_EPIC_PAYMENT_FRAME) return Promise.resolve();
    if (auto && autoRunBlocked('Epic Games', 'epic')) return Promise.resolve();
    if (auto) setAutoCooldown('epic', CONFIG.autoCooldownMs);

    return fetchCurrentEpicFreebies().catch(function (e) {
      log('Epic Games', 'error', 'Verification hebdomadaire impossible : ' + e.message);
      if (auto) setAutoCooldown('epic', CONFIG.autoFailureCooldownMs);
      return null;
    }).then(function (freebies) {
      if (!freebies) return;

      var unclaimed = freebies.filter(function (g) {
        return !alreadyHandled('Epic Games', epicHistoryKeyForSlug(g.slug)) && !isEpicSlugBlocked('Epic Games', g.slug);
      });
      var titles = unclaimed.map(function (g) { return g.title; });
      log('Epic Games', 'info', 'API : ' + freebies.length + ' jeu(x) gratuit(s) cette semaine, ' + unclaimed.length + ' non reclame(s).', titles);

      if (unclaimed.length === 0) {
        if (auto) setAutoCooldown('epic', CONFIG.autoIdleCooldownMs);
        return;
      }

      if (!auto) {
        notifyUser('Free Games Claimer -- Epic Games', unclaimed.length + ' jeu(x) gratuit(s) detecte(s) : ' + titles.join(', ') + '.');
        return;
      }

      if (!getEpicAutoModeEnabled()) {
        log('Epic Games', 'info', 'Mode auto hebdo desactive : notification seule, pas de redirection automatique.');
        notifyUser('Free Games Claimer -- Epic Games', unclaimed.length + ' nouveau(x) jeu(x) gratuit(s) -- mode auto desactive, cliquez sur Claim manuellement.');
        return;
      }

      if (isUserLikelyBusy()) {
        log('Epic Games', 'info', 'Utilisateur probablement occupe (panier/checkout ouvert) : redirection automatique reportee.');
        return;
      }

      if (isLikelyLoggedOut()) {
        log('Epic Games', 'warn', 'Jeux gratuits detectes mais session non connectee : impossible de rediriger/reclamer automatiquement.');
        notifyUser('Free Games Claimer -- Epic Games', 'Nouveaux jeux gratuits disponibles, mais vous devez vous reconnecter.');
        return;
      }

      // Si l'on est deja sur la fiche d'un jeu gratuit non reclame, on le
      // reclame ici plutot que de repartir vers /free-games (sinon la fiche et
      // la liste se renvoient l'une vers l'autre).
      var currentSlugForAuto = extractEpicSlug(location.href);
      var onUnclaimedProductPage = !!currentSlugForAuto && unclaimed.some(function (g) { return g.slug === currentSlugForAuto; });

      if (!/\/free-games/.test(location.pathname) && !onUnclaimedProductPage) {
        log('Epic Games', 'info', 'Redirection automatique vers /free-games pour reclamer les nouveaux jeux detectes par API.');
        try { sessionStorage.setItem('FGC_epic_auto_redirect', '1'); } catch (e) {}
        location.assign(epicStoreUrl('/free-games'));
        return;
      }

      updateUiState('running', 'Auto hebdo : reclamation en cours...');
      return runEpicGamesModule();
    });
  }

  // Atterrissage sur la page "introuvable" du store apres une redirection
  // lancee par le script : on bloque le slug fautif et on revient a la liste.
  function handleEpicNotFoundLanding() {
    if (!isEpicNotFoundPage(location.pathname)) return false;
    var PLATFORM = 'Epic Games';
    var pendingSlug = takeEpicPendingSlug();
    if (!pendingSlug) {
      log(PLATFORM, 'info', 'Page /not-found sans redirection du script en attente : rien a faire.');
      return true;
    }
    // Marqueur residuel (clic de carte traite en navigation SPA, puis arrivee
    // sur /not-found pour une autre raison) : on ne degrade jamais une entree
    // deja reclamee.
    var existing = getHistory(PLATFORM)[epicHistoryKeyForSlug(pendingSlug)];
    if (existing && existing.status === 'claimed') {
      log(PLATFORM, 'info', 'Page /not-found mais "' + pendingSlug + '" est deja reclame : marqueur residuel ignore.');
      return true;
    }
    saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(pendingSlug), 'bad_url', location.href);
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      counts[pendingSlug] = CONFIG.epicMaxRedirectsPerSlug;
      sessionStorage.setItem('FGC_epic_redirect_counts', JSON.stringify(counts));
    } catch (e) {}
    log(PLATFORM, 'error', 'La fiche construite pour le slug "' + pendingSlug + '" n\'existe pas (' + location.href + '). Slug bloque pendant ' + Math.round(CONFIG.epicBadUrlTtlMs / 86400000) + ' jour(s), retour sur /free-games.');
    notifyUser('Free Games Claimer -- Epic Games', 'URL introuvable pour "' + pendingSlug + '". Reclamez ce jeu manuellement depuis la page des jeux gratuits.');
    updateUiState('error', 'URL introuvable : ' + pendingSlug);
    setTimeout(function () { location.assign(epicStoreUrl('/free-games')); }, 1500);
    return true;
  }

  function scheduleEpicAutoWatcher() {
    if (location.hostname.indexOf('epicgames.com') === -1 || IS_EPIC_PAYMENT_FRAME) return;

    if (handleEpicNotFoundLanding()) return;

    // Arrivee sur la fiche produit vers laquelle processNext() a redirige (ou
    // dont la carte a ete cliquee) : on enchaine la reclamation sans attendre
    // un nouveau clic sur "Claim", et on saute la verification immediate pour
    // ne pas lancer deux fois le module.
    var pendingSlug = takeEpicPendingSlug();
    var currentSlug = extractEpicSlug(location.href);
    var landedOnPendingProduct = !!(pendingSlug && currentSlug && pendingSlug === currentSlug);
    if (landedOnPendingProduct) {
      log('Epic Games', 'info', 'Arrivee sur la fiche "' + currentSlug + '" via le script : lancement de la reclamation.');
      setTimeout(function () {
        updateUiState('running', 'Epic : reclamation en cours...');
        runEpicGamesModule();
      }, 2000);
    } else {
      checkEpicWeeklyRotation({ auto: true });
    }

    setInterval(function () { checkEpicWeeklyRotation({ auto: true }); }, CONFIG.epicAutoCheckIntervalMs);

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkEpicWeeklyRotation({ auto: true });
    });

    var cameFromAutoRedirect = false;
    try {
      cameFromAutoRedirect = sessionStorage.getItem('FGC_epic_auto_redirect') === '1';
      sessionStorage.removeItem('FGC_epic_auto_redirect');
    } catch (e) {}

    if (cameFromAutoRedirect && /\/free-games/.test(location.pathname)) {
      log('Epic Games', 'info', 'Arrivee via redirection automatique : lancement du claim sans action utilisateur.');
      setTimeout(function () {
        updateUiState('running', 'Auto hebdo : reclamation en cours...');
        runEpicGamesModule();
      }, 2000);
    }
  }

  function waitForEpicPaymentCompletion() {
    epicLauncherModalSeen = false;
    return waitForElement(function () {
      handleEpicPostPurchaseModals();
      if (epicLauncherModalSeen) return document.body;

      var ownershipBtn = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
      if (ownershipBtn) return ownershipBtn;

      var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,p'));
      var thankYou = nodes.find(function (n) {
        return /thank you|merci pour votre commande|order confirm|commande confirmee|ajoute(e)? a votre bibliotheque|added to your library/i.test(n.textContent || '');
      });
      return thankYou || null;
    }, { timeout: CONFIG.epicPaymentCompletionTimeout, interval: 500, label: 'Epic: confirmation de paiement (iframe)' });
  }

  function isEpicGameUnownedOnCurrentPage() {
    var mainCta = findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { mustBeEnabled: true });
    var owned = findActionElement(document, EPIC_OWNERSHIP_PATTERNS, { mustBeEnabled: false });
    return !!mainCta && !owned;
  }

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
      updateUiState('error', 'Page introuvable -- retournez sur /free-games');
      return Promise.resolve();
    }

    if (isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Aucune session active detectee. Connectez-vous manuellement puis relancez.');
      notifyUser('Free Games Claimer -- Epic Games', 'Connexion requise. Connectez-vous manuellement puis relancez le script.');
      updateUiState('error', 'Non connecte sur Epic');
      return Promise.resolve();
    }

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ') avant meme le chargement de la page. Arret.', challenge.detail);
      notifyUser('Free Games Claimer -- Epic Games', 'Captcha/2FA detecte : intervention manuelle necessaire.');
      updateUiState('error', 'Captcha/2FA detecte');
      return Promise.resolve();
    }

    return withRetry(function () {
      return waitForElement(function () { return document.querySelector('main'); }, { timeout: 12000 });
    }, { label: 'chargement de la page Epic Games Store' }).catch(function (e) {
      log(PLATFORM, 'error', 'La page principale ne s\'est pas chargee a temps.', e);
      updateUiState('error', 'Page Epic non chargee');
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
          updateUiState('ok', 'Tous les jeux gratuits de la semaine sont deja recuperes');
          log(PLATFORM, 'info', 'Aucun jeu gratuit restant a reclamer selon l\'API.');
          return;
        }

        var currentMatch = currentSlug ? unclaimed.find(function (g) { return g.slug === currentSlug; }) : null;
        if (currentMatch) {
          try { sessionStorage.removeItem('FGC_epic_redirect_counts'); } catch (e) {}

          log(PLATFORM, 'info', 'Fiche produit courante identifiee comme jeu gratuit non reclame : ' + currentMatch.title);
          updateUiState('running', 'Epic : ' + currentMatch.title + '...');
          resetEpicSettleClock();
          return withRetry(function () {
            return claimEpicGame(document, currentMatch.title, PLATFORM);
          }, { label: 'recuperation Epic (' + currentMatch.title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
            // On ne se fie pas au seul enchainement des clics : si le bouton
            // "Obtenir" est encore la, la reclamation n'a pas abouti.
            return sleep(CONFIG.epicClaimVerifyDelayMs).then(function () {
              if (result !== 'ALREADY_OWNED' && isEpicGameUnownedOnCurrentPage()) {
                log(PLATFORM, 'warn', 'Verification : "' + currentMatch.title + '" affiche encore le bouton d\'achat. Rien enregistre, nouvelle tentative au prochain passage.');
                notifyUser('Free Games Claimer -- Epic Games', 'Reclamation non confirmee pour "' + currentMatch.title + '" : terminez-la manuellement si besoin.');
                updateUiState('error', 'Epic : non confirme (' + currentMatch.title + ')');
                return;
              }
              saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(currentMatch.slug), 'claimed', result);
              updateUiState('ok', 'Epic : ' + currentMatch.title + ' recupere');
              log(PLATFORM, 'info', 'OK Recupere avec succes : ' + currentMatch.title + ' (' + result + ')');
            });
          }).catch(function (err) {
            updateUiState('error', 'Epic : echec (' + currentMatch.title + ') -- ' + err.message);
            log(PLATFORM, 'error', 'ECHEC de la recuperation pour "' + currentMatch.title + '" : ' + err.message + '. Aucune entree "claimed" enregistree.');
            notifyUser('Free Games Claimer -- Epic Games', 'Echec pour "' + currentMatch.title + '" : ' + err.message);
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
            updateUiState(successCount > 0 ? 'ok' : 'error', 'Epic : ' + successCount + '/' + unclaimed.length + ' recupere(s)');
            log(PLATFORM, 'info', 'Module Epic Games termine (detection API).');
            return;
          }

          var game = unclaimed[index];
          updateUiState('running', 'Epic : recherche de la carte "' + game.title + '"...');

          // Les cartes de /free-games sont rendues cote client : on attend
          // leur apparition avant de decider qu'il faut rediriger.
          var waitMs = /\/free-games/.test(location.pathname) ? CONFIG.epicCardWaitTimeout : 1500;
          return waitForEpicAnchor(game.slug, waitMs).then(function (anchor) {
            if (anchor) {
              log(PLATFORM, 'info', 'Carte trouvee par slug pour : ' + game.title + ' (' + anchor.getAttribute('href') + ')');
              updateUiState('running', 'Epic : ' + game.title + '...');
              // Si le clic sur la carte provoque un rechargement complet (et
              // non une navigation SPA), la fiche reprendra la reclamation.
              setEpicPendingSlug(game.slug);
              resetEpicSettleClock();
              return withRetry(function () {
                return claimEpicGame(anchor, game.title, PLATFORM);
              }, { label: 'recuperation Epic (' + game.title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
                saveHistoryEntry(PLATFORM, epicHistoryKeyForSlug(game.slug), 'claimed', result);
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
              notifyUser('Free Games Claimer -- Epic Games', 'Impossible de reclamer automatiquement "' + game.title + '". Cliquez sur Claim manuellement sur sa page.');
              updateUiState('error', 'Echec repete : ' + game.title);
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
        updateUiState('ok', 'Aucun jeu gratuit ici');
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
          updateUiState(successCount2 > 0 ? 'ok' : 'error', 'Epic : ' + successCount2 + '/' + cards.length + ' recupere(s)');
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
        updateUiState('running', 'Epic : ' + title + '...');
        resetEpicSettleClock();
        return withRetry(function () {
          return claimEpicGame(card, title, PLATFORM);
        }, { label: 'recuperation Epic (' + title + ')', retries: 2, baseDelay: 2000 }).then(function (result) {
          saveHistoryEntry(PLATFORM, gameKey, 'claimed', result);
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

  function runGogModule() {
    var PLATFORM = 'GOG';
    log(PLATFORM, 'info', 'Demarrage du module GOG.');
    updateUiState('running', 'GOG : verification...');

    if (isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session GOG non detectee.');
      notifyUser('Free Games Claimer -- GOG', 'Connexion requise sur GOG.');
      updateUiState('error', 'Non connecte sur GOG');
      return Promise.resolve();
    }

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- GOG', 'Verification de securite detectee : action manuelle requise.');
      updateUiState('error', 'Captcha/2FA detecte');
      return Promise.resolve();
    }

    var claimBtn = findActionElement(document, [/^claim$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i, /add to library/i, /ajouter [a\u00e0] (la|ma|votre) biblioth[e\u00e8]que/i, /^get it free$/i], { label: 'GOG: claim' });

    if (!claimBtn) {
      log(PLATFORM, 'info', 'Aucun bouton de recuperation visible (peut-etre deja reclame, ou pas de giveaway actif, ou le texte du bouton a change).');
      updateUiState('ok', 'Aucun giveaway actif ici');
      return Promise.resolve();
    }

    var titleEl = document.querySelector('.giveaway__title, h1');
    var title = (titleEl && titleEl.textContent && titleEl.textContent.trim()) || location.href;
    if (alreadyHandled(PLATFORM, title)) {
      log(PLATFORM, 'info', 'Deja recupere : ' + title);
      updateUiState('ok', 'Deja recupere');
      return Promise.resolve();
    }

    return withRetry(function () {
      robustClick(claimBtn);
      return waitForElement(function () {
        return findActionElement(document, [/in library/i, /dans (la|ma|votre) biblioth[e\u00e8]que/i, /owned/i, /d[e\u00e9]j[a\u00e0] poss[e\u00e9]d[e\u00e9]/i, /^voir dans la biblioth[e\u00e8]que$/i], { mustBeEnabled: false, label: 'GOG: confirmation' });
      }, { timeout: 8000 });
    }, { label: 'recuperation GOG (' + title + ')', retries: 3 }).then(function () {
      saveHistoryEntry(PLATFORM, title, 'claimed');
      log(PLATFORM, 'info', 'OK Recupere : ' + title);
      updateUiState('ok', 'GOG : ' + title + ' recupere');
    }).catch(function (err) {
      log(PLATFORM, 'error', 'ECHEC pour "' + title + '" : ' + err.message);
      updateUiState('error', 'GOG : echec (' + title + ')');
    });
  }

  // ===========================================================================
  // AMAZON LUNA (ex-Prime Gaming) -- offres "Recuperer le jeu" (FGWP)
  // ===========================================================================
  //
  // Parcours (une offre par chargement de page, pour ne pas dependre du
  // comportement SPA de la page) :
  //   /claims/home  -> liste des offres -> file d'attente (sessionStorage)
  //                    -> navigation vers la premiere fiche
  //   /claims/<slug>-<store>/dp/amzn1.pg.item.<id> -> clic "Obtenir le jeu"
  //                    -> observation du resultat -> fiche suivante ...
  //   file vide     -> retour sur la liste + resume + ouverture de gog.com/redeem
  //                    si des codes GOG sont en attente.
  //
  // Libelles reels observes le 26/08/2026 sur luna.amazon.fr :
  //   carte : a[data-a-target="FGWPOffer"] "Recuperer le jeu" (accentue),
  //   fiche : button[data-a-target="buy-box_call-to-action"] "Obtenir le jeu",
  //   [data-a-target="DescriptionItemDetails"] "Right and Down pour PC sur GOG.com."

  var LUNA_CLAIM_PATTERNS = [/^claim( game| the game)?$/i, /^r[e\u00e9]cup[e\u00e9]rer( le jeu)?$/i, /^get( the)? game$/i, /^obtenir( le jeu)?$/i, /^get$/i];
  var LUNA_COMPLETE_PATTERNS = [/^complete claim$/i, /^terminer( la r[e\u00e9]clamation)?$/i, /^finaliser/i, /^continuer$/i, /^continue$/i, /^confirm(er)?$/i];
  var LUNA_LINK_ACCOUNT_PATTERNS = [/associer (un|votre|mon|le) compte/i, /link (game |your |a )?account/i, /lier (un|votre|mon|le) compte/i];
  var LUNA_CLAIMED_TEXT = /\bclaimed\b|\bcollected\b|r[e\u00e9]cup[e\u00e9]r[e\u00e9]e?(?![a-z\u00e0-\u00ff])|successfully|\bsuccess\b|succ[e\u00e8]s(?![a-z\u00e0-\u00ff])|in your library|dans votre biblioth[e\u00e8]que|ajout[e\u00e9]e? [a\u00e0] votre|d[e\u00e9]j[a\u00e0] (r[e\u00e9]cup[e\u00e9]r[e\u00e9]|obtenu|r[e\u00e9]clam[e\u00e9])/i;

  var LUNA_STORE_SUFFIXES = {
    epic: 'epic', gog: 'gog', aga: 'amazon', amazon: 'amazon', legacy: 'legacy',
    ms: 'microsoft', msstore: 'microsoft', microsoft: 'microsoft', xbox: 'microsoft', windows: 'microsoft',
    ubisoft: 'ubisoft', uplay: 'ubisoft', ea: 'ea', origin: 'ea', battlenet: 'blizzard', blizzard: 'blizzard'
  };
  var LUNA_STORE_LABELS = {
    epic: 'Epic Games Store', gog: 'GOG.com', amazon: 'Amazon Games', legacy: 'Legacy Games',
    microsoft: 'Microsoft Store', ubisoft: 'Ubisoft Connect', ea: 'EA app', blizzard: 'Battle.net', unknown: 'plateforme inconnue'
  };

  function getLunaAutoModeEnabled() { return GM_getValue('FGC_luna_auto_mode', true); }
  // Pilotable depuis le popup de l'extension (meme cle de stockage).
  function getLunaDlcEnabled() { return GM_getValue('FGC_luna_claim_dlc', CONFIG.lunaClaimDlc); }
  function setLunaAutoModeEnabled(val) { GM_setValue('FGC_luna_auto_mode', !!val); }

  function isLunaClaimsListPage(pathname) {
    return /^\/claims\/?(home\/?)?$/i.test(pathname || '');
  }

  function isLunaOfferDetailPage(pathname) {
    return /^\/claims\/[^/]+\/dp\//i.test(pathname || '');
  }

  function extractLunaOfferSlug(url) {
    var pathname;
    try {
      pathname = new URL(url, location.origin).pathname;
    } catch (e) {
      pathname = String(url || '').split('?')[0].split('#')[0];
    }
    var m = pathname.match(/\/claims\/([^/?#]+)\/dp\//i);
    return m ? m[1].toLowerCase() : null;
  }

  function extractLunaOfferId(url) {
    var m = String(url || '').match(/amzn1\.pg\.item\.[0-9a-z-]+/i);
    return m ? m[0].toLowerCase() : null;
  }

  // Plateforme de destination : texte de la fiche ("... pour PC sur GOG.com.")
  // en priorite, puis suffixe du slug (right-and-down-gog -> gog).
  function detectLunaStore(url, detailsText) {
    var text = String(detailsText || '');
    if (text) {
      if (/\bgog\b/i.test(text)) return 'gog';
      if (/epic/i.test(text)) return 'epic';
      if (/microsoft|xbox|windows store/i.test(text)) return 'microsoft';
      if (/legacy games/i.test(text)) return 'legacy';
      if (/amazon games/i.test(text)) return 'amazon';
      if (/ubisoft|uplay/i.test(text)) return 'ubisoft';
      if (/\bea\b|\borigin\b/i.test(text)) return 'ea';
      if (/battle\.net|blizzard/i.test(text)) return 'blizzard';
    }
    var slug = extractLunaOfferSlug(url) || '';
    var suffix = slug.split('-').pop();
    if (suffix && LUNA_STORE_SUFFIXES.hasOwnProperty(suffix)) return LUNA_STORE_SUFFIXES[suffix];
    return 'unknown';
  }

  function lunaStoreLabel(store) {
    return LUNA_STORE_LABELS[store] || LUNA_STORE_LABELS.unknown;
  }

  function isLunaStoreSkipped(store) {
    return (CONFIG.lunaSkipStores || []).indexOf(store) !== -1;
  }

  // Codes d'echange : "ABCDE-12345-FGHIJ" ou bloc alphanumerique long avec au
  // moins un chiffre (pour ne pas confondre un mot avec un code).
  var REDEEM_CODE_PATTERN = /\b[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,5}\b|\b(?=[A-Z]*[0-9])[A-Z0-9]{12,30}\b/;

  // Date limite d'utilisation affichee par Amazon ("avant le 5 octobre 2026",
  // "before October 5, 2026") : conservee pour prevenir avant l'expiration.
  function parseRedeemDeadline(text) {
    var t = String(text || '').replace(/\s+/g, ' ');
    var m = t.match(/(?:avant le|jusqu'au|before|until|expire[a-z]* le|expires? on)\s+([0-9]{1,2}(?:er)? [a-z\u00e0-\u00ff.]+ [0-9]{4}|[a-z]+ [0-9]{1,2},? [0-9]{4}|[0-9]{1,2}[/.][0-9]{1,2}[/.][0-9]{2,4})/i);
    return m ? m[1].trim() : null;
  }

  function findLunaCodeDeadline() {
    var scopes = [lunaModalRoot(), document.querySelector('[data-a-target="faq-section"]'), document.querySelector('[data-a-target="buy-box"]'), document.body];
    for (var i = 0; i < scopes.length; i++) {
      if (!scopes[i]) continue;
      var d = parseRedeemDeadline(scopes[i].textContent);
      if (d) return d;
    }
    return null;
  }

  function parseRedeemCode(text) {
    var t = String(text || '').replace(/^\s*(your code|votre code)\s*:?\s*/i, '').trim();
    var m = t.toUpperCase().match(REDEEM_CODE_PATTERN);
    return m ? m[0] : null;
  }

  function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(text, 'text'); return true; }
    } catch (e) {}
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return true; }
    } catch (e) {}
    return false;
  }

  function openInTab(url, active) {
    try {
      if (typeof GM_openInTab === 'function') { GM_openInTab(url, { active: !!active, insert: true }); return true; }
    } catch (e) {}
    try { window.open(url, '_blank'); return true; } catch (e) {}
    return false;
  }

  // File de codes a echanger sur les magasins partenaires (stockage GM, donc
  // partagee entre luna.amazon.* et gog.com).
  function getPendingRedeemCodes(store) {
    var all;
    try { all = JSON.parse(GM_getValue('FGC_pending_codes', '[]')); } catch (e) { all = []; }
    if (!Array.isArray(all)) all = [];
    return store ? all.filter(function (c) { return c && c.store === store; }) : all;
  }

  function savePendingRedeemCodes(list) {
    GM_setValue('FGC_pending_codes', JSON.stringify(list || []));
  }

  function addPendingRedeemCode(entry) {
    var all = getPendingRedeemCodes();
    if (all.some(function (c) { return c.code === entry.code; })) return all;
    all.push(entry);
    savePendingRedeemCodes(all);
    return all;
  }

  function updatePendingRedeemCode(code, patch) {
    var all = getPendingRedeemCodes();
    all.forEach(function (c) {
      if (c.code !== code) return;
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
    });
    savePendingRedeemCodes(all);
    return all;
  }

  function removePendingRedeemCode(code) {
    var all = getPendingRedeemCodes().filter(function (c) { return c.code !== code; });
    savePendingRedeemCodes(all);
    return all;
  }

  function describePendingCodes() {
    var all = getPendingRedeemCodes();
    if (!all.length) return 'Aucun code en attente.';
    return all.map(function (c) {
      return lunaStoreLabel(c.store) + ' : ' + c.code + ' (' + c.title + ', ' + (c.attempts || 0) + ' essai(s)' + (c.deadline ? ', a utiliser avant le ' + c.deadline : '') + ')';
    }).join('\n');
  }

  // File des fiches Luna a visiter (sessionStorage : propre a l'onglet).
  function getLunaQueue() {
    try {
      var q = JSON.parse(sessionStorage.getItem('FGC_luna_queue') || '[]');
      return Array.isArray(q) ? q : [];
    } catch (e) { return []; }
  }

  function saveLunaQueue(queue) {
    try { sessionStorage.setItem('FGC_luna_queue', JSON.stringify(queue || [])); } catch (e) {}
  }

  function getLunaBatch() {
    try {
      return JSON.parse(sessionStorage.getItem('FGC_luna_batch') || 'null') || { total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false };
    } catch (e) { return { total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false }; }
  }

  function saveLunaBatch(batch) {
    try { sessionStorage.setItem('FGC_luna_batch', JSON.stringify(batch)); } catch (e) {}
  }

  function bumpLunaBatch(field) {
    var batch = getLunaBatch();
    batch[field] = (batch[field] || 0) + 1;
    saveLunaBatch(batch);
    return batch;
  }

  function lunaHistoryKey(offerId) { return 'offer:' + offerId; }

  var LUNA_DONE_STATUSES = { claimed: true, redeemed: true, code_copied: true, code_pending_gog: true, skipped: true };
  var LUNA_NEEDS_LINK_RETRY_MS = 24 * 60 * 60 * 1000;

  function lunaOfferDone(offerId) {
    var entry = getHistory('Amazon Luna')[lunaHistoryKey(offerId)];
    if (!entry) return false;
    if (LUNA_DONE_STATUSES[entry.status]) return true;
    if (entry.status === 'needs_link') return Date.now() - (entry.ts || 0) < LUNA_NEEDS_LINK_RETRY_MS;
    if (entry.status === 'failed' && (entry.attempts || 0) >= CONFIG.lunaMaxAttemptsPerOffer) return true;
    return false;
  }

  function recordLunaFailure(offerId, reason) {
    var history = getHistory('Amazon Luna');
    var previous = history[lunaHistoryKey(offerId)];
    var attempts = (previous && previous.status === 'failed' ? (previous.attempts || 0) : 0) + 1;
    history[lunaHistoryKey(offerId)] = { status: 'failed', reason: reason || '', ts: Date.now(), attempts: attempts };
    GM_setValue('FGC_history_Amazon Luna', JSON.stringify(history));
    return attempts;
  }

  // Amazon peut redemander une confirmation de connexion avant de finaliser
  // une reclamation -- avec OU sans champ mot de passe visible. On ne clique
  // JAMAIS a travers cette etape, meme quand aucun mot de passe n'est
  // demande : c'est une verification de securite posee intentionnellement
  // par Amazon, pas un simple ecran de chargement a court-circuiter. Le
  // module s'arrete et vous notifie plutot que de la franchir a votre place.
  function isLunaReauthVisible() {
    var passwordField = document.querySelector('input[type="password"]');
    if (passwordField && (passwordField.offsetWidth || passwordField.offsetHeight)) return true;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,p'));
    return nodes.some(function (n) {
      return /sign in to your amazon account|connectez-vous [a\u00e0] votre compte amazon|confirm(er)? your identity|confirmer votre identit[e\u00e9]/i.test(n.textContent || '');
    });
  }

  function checkLunaReauthPopup() {
    if (isLunaReauthVisible()) throw new Error('MANUAL_LOGIN_REQUIRED');
  }

  // textContent concatene les noeuds texte sans separateur ("Right and DownRecupere") :
  // on joint chaque noeud texte par un espace avant de tester les motifs.
  function spacedText(el) {
    if (!el) return '';
    var out = [];
    (function walk(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) {
          var t = String(k.nodeValue || '').replace(/\s+/g, ' ').trim();
          if (t) out.push(t);
        } else if (k.nodeType === 1) {
          walk(k);
        }
      }
    })(el);
    return out.length ? out.join(' ') : String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function nearestCard(el) {
    var node = el;
    for (var i = 0; i < 6 && node; i++) {
      if (node.getAttribute && node.getAttribute('data-a-target') === 'item-card') return node;
      if (node.matches && node.matches('article, li, [class*="card" i], [class*="offer" i]')) return node;
      node = node.parentElement;
    }
    return el.closest('div') || el.parentElement || el;
  }

  function cardTitle(card) {
    if (!card) return null;
    var heading = card.querySelector('h1, h2, h3, h4, [data-a-target="item-card-detail-footer-primary-text"], [class*="title" i]');
    return (heading && heading.textContent && heading.textContent.trim()) || null;
  }

  function lunaModalRoot() {
    return document.querySelector('[role="dialog"], [aria-modal="true"], [data-a-target*="modal" i]') || null;
  }

  function findLunaLinkAccountElement() {
    var explicit = document.querySelector('[data-a-target="LinkAccountButton"], [data-a-target="link-account-modal"], [class*="LinkAccount" i]');
    if (explicit && (explicit.offsetWidth || explicit.offsetHeight)) return explicit;
    var root = lunaModalRoot() || document.querySelector('[data-a-target="buy-box"]') || document;
    return findActionElement(root, LUNA_LINK_ACCOUNT_PATTERNS, { mustBeEnabled: false });
  }

  function findLunaRevealedCode() {
    var explicit = document.querySelector('[data-a-target="ClaimStateClaimCodeContent"], [data-a-target*="ClaimCode" i], [data-a-target*="copy-code" i]');
    if (explicit) {
      var code0 = parseRedeemCode(explicit.value || explicit.textContent);
      if (code0) return code0;
    }
    var root = lunaModalRoot() || document.querySelector('[data-a-target="buy-box"]') || document;
    var candidates = Array.prototype.slice.call(root.querySelectorAll('input[type="text"], input[readonly], code, [class*="code" i], [class*="key" i]'));
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.tagName === 'INPUT' && el.type === 'search') continue;
      var code = parseRedeemCode(el.value || el.textContent);
      if (code) return code;
    }
    return null;
  }

  function lunaSuccessVisible(scopeEl) {
    if (document.querySelector('.thank-you-title, [data-a-target*="success" i], [data-a-target*="ClaimStateClaimed" i]')) return true;
    var modal = lunaModalRoot();
    var scopes = [modal, scopeEl].filter(Boolean);
    return scopes.some(function (s) { return LUNA_CLAIMED_TEXT.test(spacedText(s)); });
  }

  // Observe la page apres le clic sur "Obtenir le jeu" jusqu'a un resultat
  // identifiable : code affiche, succes, liaison de compte requise, etape
  // intermediaire "Complete Claim" (cliquee une fois), reconnexion, captcha.
  // Magasins ou un "succes" n'a de valeur qu'accompagne d'un code a echanger.
  var LUNA_CODE_STORES = { gog: true, microsoft: true, legacy: true, unknown: true };

  function watchLunaClaimOutcome(buyBox, timeout, store, linkBefore) {
    var started = Date.now();
    var completeClicked = false;
    var successSince = 0;
    return new Promise(function (resolve, reject) {
      function tick() {
        try {
          if (isLunaReauthVisible()) { reject(new Error('MANUAL_LOGIN_REQUIRED')); return; }
          var challenge = detectSecurityChallenge();
          if (challenge) { reject(new Error('Defi de securite (' + challenge.type + ') detecte apres le clic.')); return; }

          var code = findLunaRevealedCode();
          if (code) { resolve({ type: 'code', code: code }); return; }

          // Liaison requise seulement si un element NOUVEAU apparait (la fiche
          // -epic affiche deja un bouton "Associer un compte" avant tout clic).
          var linkEl = findLunaLinkAccountElement();
          if (linkEl && linkEl !== linkBefore) { resolve({ type: 'needs_link' }); return; }

          if (!completeClicked) {
            var root = lunaModalRoot() || buyBox || document;
            var completeBtn = findActionElement(root, LUNA_COMPLETE_PATTERNS, { mustBeEnabled: true });
            if (completeBtn) {
              completeClicked = true;
              log('Amazon Luna', 'info', 'Etape intermediaire "' + completeBtn.textContent.trim() + '" detectee, clic.');
              completeBtn.click();
              setTimeout(tick, 1200);
              return;
            }
          }

          if (lunaSuccessVisible(buyBox)) {
            if (!LUNA_CODE_STORES[store]) { resolve({ type: 'claimed' }); return; }
            // Magasin a code : on laisse au code le temps d'apparaitre apres le succes.
            if (!successSince) successSince = Date.now();
            if (Date.now() - successSince > 6000) { resolve({ type: 'claimed' }); return; }
            setTimeout(tick, 500);
            return;
          }

          if (Date.now() - started > timeout) { resolve({ type: 'timeout' }); return; }
          setTimeout(tick, 500);
        } catch (e) {
          reject(e);
        }
      }
      setTimeout(tick, 800);
    });
  }

  function lunaListUrl() {
    return location.origin + CONFIG.lunaClaimsPath;
  }

  // Cartes de la page liste -> offres { id, url, title, store, button, card, hasCta, collected }
  function collectLunaOffers(rootEl) {
    var root = rootEl || document.querySelector('[data-a-target="offer-list-FGWP_FULL"]') || document.querySelector('[data-a-target="offer-list-FGWP"]') || document;
    var cards = Array.prototype.slice.call(root.querySelectorAll('[data-a-target="item-card"]'));
    if (!cards.length) {
      var anchors = Array.prototype.slice.call(root.querySelectorAll('a[href*="/claims/"][href*="/dp/"]'));
      var seenCards = [];
      anchors.forEach(function (a) {
        var c = nearestCard(a);
        if (seenCards.indexOf(c) === -1) seenCards.push(c);
      });
      cards = seenCards;
    }
    var seen = {};
    var offers = [];
    cards.forEach(function (card) {
      if (card.querySelector('[data-a-target="LunaOffer"]')) return;
      var link = card.querySelector('a[data-a-target="FGWPOffer"]') || card.querySelector('a[href*="/claims/"][href*="/dp/"]');
      var button = card.querySelector('button[data-a-target="FGWPOffer"]');
      var href = link ? link.href : null;
      var id = extractLunaOfferId(href);
      var text = spacedText(card);
      var hasCta = !!(card.querySelector('[data-a-target="FGWPOffer"]') || findActionElement(card, LUNA_CLAIM_PATTERNS, { mustBeEnabled: false }));
      if (!id && !button) return;
      var key = id || ('card:' + text.slice(0, 60));
      if (seen[key]) return;
      seen[key] = true;
      offers.push({
        id: key,
        url: href ? href.split('?')[0] : null,
        title: cardTitle(card) || text.slice(0, 60),
        store: href ? detectLunaStore(href, '') : 'amazon',
        button: button,
        card: card,
        hasCta: hasCta,
        collected: !hasCta && LUNA_CLAIMED_TEXT.test(text)
      });
    });
    return offers;
  }

  function finishLunaBatch(PLATFORM) {
    var batch = getLunaBatch();
    var summary = 'Luna : ' + batch.claimed + ' reclame(s), ' + batch.codes + ' code(s), ' + batch.skipped + ' ignore(s), ' + batch.failed + ' echec(s)';
    updateUiState(batch.failed > 0 && batch.claimed + batch.codes === 0 ? 'error' : 'ok', summary);
    log(PLATFORM, 'info', 'Serie Luna terminee. ' + summary + '.');
    if (batch.total > 0) notifyUser('Free Games Claimer -- Amazon Luna', summary + '.');
    setAutoCooldown('luna', batch.failed > 0 ? CONFIG.autoFailureCooldownMs : CONFIG.autoIdleCooldownMs);

    var gogCodes = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (gogCodes.length && !batch.gogHandoffDone) {
      batch.gogHandoffDone = true;
      saveLunaBatch(batch);
      log(PLATFORM, 'info', gogCodes.length + ' code(s) GOG en attente : ouverture de ' + CONFIG.gogRedeemUrl + ' pour l\'echange automatique.');
      notifyUser('Free Games Claimer -- GOG', gogCodes.length + ' code(s) GOG a echanger : la page gog.com/redeem s\'ouvre, l\'echange est automatique si vous etes connecte sur GOG.');
      openInTab(CONFIG.gogRedeemUrl, true);
    }
    saveLunaQueue([]);
    // Fin de serie : compteurs remis a zero pour que le lot ne soit pas rejoue
    // lors d'une visite ulterieure d'une fiche hors serie dans ce meme onglet.
    saveLunaBatch({ total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: batch.gogHandoffDone });
  }

  function advanceLunaQueue(PLATFORM, currentId) {
    var queue = getLunaQueue().filter(function (o) { return o && o.id !== currentId; });
    saveLunaQueue(queue);
    if (queue.length) {
      log(PLATFORM, 'info', queue.length + ' fiche(s) restante(s), navigation vers : ' + queue[0].title + ' (' + queue[0].url + ')');
      updateUiState('running', 'Luna : ' + queue.length + ' offre(s) restante(s)...');
      setTimeout(function () { location.assign(queue[0].url); }, 1200);
      return;
    }
    if (!isLunaClaimsListPage(location.pathname)) {
      var batch = getLunaBatch();
      if (batch.total > 0) {
        log(PLATFORM, 'info', 'Derniere fiche traitee, retour sur la liste des offres.');
        try { sessionStorage.setItem('FGC_luna_finish_pending', '1'); } catch (e) {}
        setTimeout(function () { location.assign(lunaListUrl()); }, 1500);
        return;
      }
    }
    finishLunaBatch(PLATFORM);
  }

  function handleLunaClaimOutcome(PLATFORM, offerId, title, store, outcome) {
    var key = lunaHistoryKey(offerId);
    var label = lunaStoreLabel(store);

    if (outcome.type === 'claimed') {
      saveHistoryEntry(PLATFORM, key, 'claimed', label);
      bumpLunaBatch('claimed');
      log(PLATFORM, 'info', 'OK Reclame : "' + title + '" (' + label + ').');
      updateUiState('ok', 'Luna : ' + title + ' reclame');
      return;
    }

    if (outcome.type === 'code') {
      var code = outcome.code;
      var deadline = findLunaCodeDeadline();
      var copied = copyToClipboard(code);
      bumpLunaBatch('codes');
      if (store === 'gog') {
        addPendingRedeemCode({ store: 'gog', code: code, title: title, offerId: offerId, ts: Date.now(), attempts: 0, deadline: deadline });
        saveHistoryEntry(PLATFORM, key, 'code_pending_gog', code);
        log(PLATFORM, 'info', 'Code GOG pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers)' : '') + '. Echange automatique sur gog.com/redeem a la fin de la serie.');
        updateUiState('ok', 'Luna : code GOG obtenu pour ' + title);
        return;
      }
      addPendingRedeemCode({ store: store, code: code, title: title, offerId: offerId, ts: Date.now(), attempts: CONFIG.gogRedeemMaxAttempts, deadline: deadline });
      saveHistoryEntry(PLATFORM, key, 'code_copied', label + ' : ' + code + (deadline ? ' (avant le ' + deadline + ')' : ''));
      var redeemUrl = store === 'microsoft' ? CONFIG.microsoftRedeemUrl : null;
      var msg = 'Code ' + label + ' pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers).' : '.') + (deadline ? ' A utiliser avant le ' + deadline + '.' : '') + (redeemUrl ? ' Collez-le sur ' + redeemUrl : ' Collez-le sur le site de ' + label + '.');
      log(PLATFORM, 'info', msg);
      updateUiState('ok', 'Luna : code ' + label + ' copie (' + title + ')');
      try {
        if (typeof GM_notification === 'function') {
          GM_notification({ title: 'Free Games Claimer -- Amazon Luna', text: msg + (redeemUrl ? ' (cliquez pour ouvrir la page d\'echange)' : ''), timeout: 20000, silent: false, onclick: function () { if (redeemUrl) openInTab(redeemUrl, true); } });
        } else {
          notifyUser('Free Games Claimer -- Amazon Luna', msg, 20000);
        }
      } catch (e) {
        notifyUser('Free Games Claimer -- Amazon Luna', msg, 20000);
      }
      return;
    }

    if (outcome.type === 'needs_link') {
      saveHistoryEntry(PLATFORM, key, 'needs_link', label);
      bumpLunaBatch('skipped');
      log(PLATFORM, 'warn', '"' + title + '" : liaison du compte ' + label + ' requise (parametres Luna > Associer un compte). Offre passee.');
      notifyUser('Free Games Claimer -- Amazon Luna', '"' + title + '" : associez d\'abord votre compte ' + label + ' dans les parametres Luna, puis relancez.');
      updateUiState('error', 'Luna : liaison ' + label + ' requise (' + title + ')');
      return;
    }

    var attempts = recordLunaFailure(offerId, 'Aucun resultat identifiable apres le clic (' + outcome.type + ')');
    bumpLunaBatch('failed');
    log(PLATFORM, 'error', 'ECHEC pour "' + title + '" (' + label + ') : aucun resultat identifiable apres le clic (essai ' + attempts + '/' + CONFIG.lunaMaxAttemptsPerOffer + ').');
    updateUiState('error', 'Luna : echec (' + title + ')');
  }

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

  function runAmazonLunaModule() {
    var PLATFORM = 'Amazon Luna';
    if (lunaModuleRunSince && Date.now() - lunaModuleRunSince < EPIC_MODULE_RUN_STALE_MS) {
      log(PLATFORM, 'info', 'Module Luna deja en cours d\'execution : nouvel appel ignore.');
      return Promise.resolve();
    }
    lunaModuleRunSince = Date.now();
    return runAmazonLunaModuleInner().then(function (r) {
      lunaModuleRunSince = 0;
      return r;
    }, function (err) {
      lunaModuleRunSince = 0;
      if (err && err.message === 'MANUAL_LOGIN_REQUIRED') {
        log(PLATFORM, 'warn', 'Amazon demande une reconnexion : arret, aucune manipulation d\'identifiants. La serie reprendra au prochain chargement de /claims apres connexion.');
        notifyUser('Free Games Claimer -- Amazon Luna', 'Reconnexion Amazon demandee : connectez-vous, la reclamation reprendra ensuite.');
        updateUiState('error', 'Luna : reconnexion Amazon requise');
        return;
      }
      throw err;
    });
  }

  function runAmazonLunaModuleInner() {
    var PLATFORM = 'Amazon Luna';
    log(PLATFORM, 'info', 'Demarrage du module Amazon Luna.');
    updateUiState('running', 'Luna : verification...');

    if (location.hostname.indexOf('gaming.amazon.com') !== -1) {
      log(PLATFORM, 'warn', 'gaming.amazon.com est l\'ancien domaine Prime Gaming, retire depuis le passage a Amazon Luna.');
      notifyUser('Free Games Claimer -- Amazon Luna', 'Domaine obsolete. Rendez-vous sur luna.amazon.com' + CONFIG.lunaClaimsPath + ' (ou votre variante locale, ex. luna.amazon.fr).');
      updateUiState('error', 'Domaine obsolete, allez sur luna.amazon.*');
      return Promise.resolve();
    }

    if (document.querySelector('[data-a-target="sign-in-button"]') || isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session Amazon/Luna non detectee (bouton "Se connecter" visible).');
      notifyUser('Free Games Claimer -- Amazon Luna', 'Connexion Amazon requise : connectez-vous sur Luna, la reclamation demarrera au prochain chargement.');
      updateUiState('error', 'Non connecte sur Amazon');
      return Promise.resolve();
    }

    if (isLunaReauthVisible()) return Promise.reject(new Error('MANUAL_LOGIN_REQUIRED'));

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- Amazon Luna', 'Captcha/2FA Amazon detecte : action manuelle requise.');
      updateUiState('error', 'Captcha/2FA detecte');
      return Promise.resolve();
    }

    if (isLunaOfferDetailPage(location.pathname)) return runLunaDetailPage(PLATFORM);
    if (isLunaClaimsListPage(location.pathname)) return runLunaListPage(PLATFORM);

    log(PLATFORM, 'info', 'Page actuelle (' + location.pathname + ') hors du parcours de reclamation. Rendez-vous sur ' + CONFIG.lunaClaimsPath + '.');
    updateUiState('ok', 'Rendez-vous sur ' + CONFIG.lunaClaimsPath);
    return Promise.resolve();
  }

  function scheduleLunaAutoWatcher() {
    if (location.hostname.indexOf('luna.amazon.') === -1) return;
    var queue = getLunaQueue();
    var finishPending = false;
    try { finishPending = sessionStorage.getItem('FGC_luna_finish_pending') === '1'; } catch (e) {}
    if (!queue.length && !finishPending && getLunaAutoModeEnabled() && autoRunBlocked('Amazon Luna', 'luna')) return;
    if (queue.length || finishPending || getLunaAutoModeEnabled()) {
      if (!queue.length && !finishPending) setAutoCooldown('luna', CONFIG.autoCooldownMs);
      log('Amazon Luna', 'info', queue.length ? 'File Luna en cours (' + queue.length + ' fiche(s)) : reprise automatique.' : 'Mode auto Luna actif : verification des offres.');
      setTimeout(function () {
        updateUiState('running', 'Luna : verification automatique...');
        dispatch();
      }, 2000);
    }
  }

  // ===========================================================================
  // GOG -- echange des codes en attente sur gog.com/redeem
  // ===========================================================================
  //
  // Page observee le 26/08/2026 : input#codeInput (placeholder "saisissez votre
  // code ici"), <form action="https://www.gog.com/redeem"> soumis par
  // [type="submit"], reCAPTCHA v2 INVISIBLE (iframe recaptcha toujours
  // presente : on ne s'arrete que si un defi captcha devient visible).

  function isGogRedeemPage(pathname) {
    return /^\/([a-z]{2}\/)?redeem\/?/i.test(pathname || '');
  }

  function setInputValue(input, value) {
    try {
      var proto = Object.getPrototypeOf(input);
      var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
      if (desc && desc.set) desc.set.call(input, value); else input.value = value;
    } catch (e) {
      input.value = value;
    }
    try { input.focus(); } catch (e) {}
    ['input', 'change', 'keyup', 'blur'].forEach(function (type) {
      try { input.dispatchEvent(new Event(type, { bubbles: true })); } catch (e) {}
    });
  }

  function isVisibleCaptchaChallenge() {
    var frames = Array.prototype.slice.call(document.querySelectorAll('iframe[src*="recaptcha"][src*="bframe"], iframe[src*="hcaptcha"], iframe[src*="challenge"]'));
    return frames.some(function (f) {
      var rect = f.getBoundingClientRect();
      var style = window.getComputedStyle ? window.getComputedStyle(f) : null;
      return rect.width > 50 && rect.height > 50 && (!style || (style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'));
    });
  }

  // Classe un message d'avertissement GOG : used / invalid / captcha / error.
  function classifyGogWarning(text) {
    var t = String(text || '');
    if (!t.trim()) return null;
    if (/captcha/i.test(t)) return 'captcha';
    if (/d[e\u00e9]j[a\u00e0] (\u00e9t\u00e9 |ete )?utilis|already (been )?(used|redeemed|activated)|code_used/i.test(t)) return 'used';
    if (/invalide|invalid|introuvable|non trouv|n'existe pas|does not exist|not (found|valid)|incorrect|inconnu|unknown code|code_not_found|expir/i.test(t)) return 'invalid';
    if (/erreur|error|impossible|failed|\u00e9chec|echec/i.test(t)) return 'error';
    return null;
  }

  var GOG_REDEEM_SUCCESS_TEXT = /a \u00e9t\u00e9 ajout|ont \u00e9t\u00e9 ajout|vient d'\u00eatre ajout|has been added|have been added|was added to your|f[e\u00e9]licitations|congratulations|successfully redeemed|code utilis[e\u00e9] avec succ|est maintenant dans votre biblioth|is now in your library/i;
  var GOG_REDEEM_CONFIRM_PATTERNS = [/^r[e\u00e9]cup[e\u00e9]rer$/i, /utiliser (le|ce|mon) code/i, /^utiliser$/i, /^redeem$/i, /redeem (the |this )?code/i, /ajouter [a\u00e0] (ma|la|votre) biblioth/i, /add to (my |your )?(account|library)/i, /^obtenir$/i, /^get it$/i, /^confirmer$/i, /^confirm$/i];

  function gogRedeemRoot(form) {
    return (form && (form.closest('[class*="redeem" i], section, main') || form.parentElement)) || document.querySelector('[class*="redeem" i]') || document;
  }

  function findGogWarning(root) {
    var nodes = Array.prototype.slice.call(root.querySelectorAll('.warning-message, [class*="warning" i], [class*="error" i], [class*="alert" i], [role="alert"]'));
    var visible = nodes.find(function (n) {
      var text = (n.textContent || '').trim();
      if (!text || !(n.offsetWidth || n.offsetHeight)) return false;
      // Le bloc .warning-message de GOG est toujours remonte, meme non classe.
      return /(^|\s)warning-message(\s|$)/i.test(String(n.className || '')) || !!classifyGogWarning(text);
    });
    return visible ? (visible.textContent || '').trim() : null;
  }

  function watchGogRedeemOutcome(form, originalSubmit, timeout, afterConfirm) {
    var started = Date.now();
    var root = gogRedeemRoot(form);
    return new Promise(function (resolve) {
      function tick() {
        try {
          if (isVisibleCaptchaChallenge()) { resolve({ type: 'captcha' }); return; }

          var warning = findGogWarning(root);
          if (warning) { resolve({ type: classifyGogWarning(warning) || 'error', detail: warning }); return; }

          var rootText = (root.textContent || '').replace(/\s+/g, ' ');
          if (GOG_REDEEM_SUCCESS_TEXT.test(rootText)) { resolve({ type: 'success' }); return; }

          if (!afterConfirm) {
            var confirmBtn = findActionElement(root, GOG_REDEEM_CONFIRM_PATTERNS, { mustBeEnabled: true });
            if (!confirmBtn) {
              var submits = Array.prototype.slice.call(root.querySelectorAll('[type="submit"]')).filter(function (b) {
                return b !== originalSubmit && (b.offsetWidth || b.offsetHeight) && !b.disabled;
              });
              var codeInput = document.getElementById('codeInput');
              var inputGone = !codeInput || !(codeInput.offsetWidth || codeInput.offsetHeight);
              if (submits.length && inputGone) confirmBtn = submits[0];
            }
            if (confirmBtn) { resolve({ type: 'confirm', button: confirmBtn }); return; }
          }

          if (Date.now() - started > timeout) { resolve({ type: 'timeout' }); return; }
          setTimeout(tick, 500);
        } catch (e) {
          resolve({ type: 'error', detail: e.message });
        }
      }
      setTimeout(tick, 1000);
    });
  }

  // Codes encore eligibles, les moins essayes d'abord (puis les plus anciens
  // essais) : apres un echec, le rechargement traite bien un AUTRE code.
  function getRedeemableGogCodes() {
    return getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; })
      .sort(function (a, b) { return ((a.attempts || 0) - (b.attempts || 0)) || ((a.lastTry || 0) - (b.lastTry || 0)); });
  }

  var gogRedeemRunSince = 0;

  function runGogRedeemModule() {
    if (gogRedeemRunSince && Date.now() - gogRedeemRunSince < EPIC_MODULE_RUN_STALE_MS) {
      log('GOG', 'info', 'Echange GOG deja en cours : nouvel appel ignore.');
      return Promise.resolve();
    }
    gogRedeemRunSince = Date.now();
    return runGogRedeemModuleInner().then(function (r) {
      gogRedeemRunSince = 0;
      return r;
    }, function (err) {
      gogRedeemRunSince = 0;
      throw err;
    });
  }

  function runGogRedeemModuleInner() {
    var PLATFORM = 'GOG';
    var pending = getRedeemableGogCodes();
    var exhausted = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) >= CONFIG.gogRedeemMaxAttempts; });

    if (!pending.length) {
      if (exhausted.length) {
        log(PLATFORM, 'warn', exhausted.length + ' code(s) GOG ont depasse le nombre d\'essais automatiques. A saisir manuellement :\n' + describePendingCodes());
        updateUiState('error', 'GOG : ' + exhausted.length + ' code(s) a saisir manuellement (voir console)');
      } else {
        log(PLATFORM, 'info', 'Aucun code GOG en attente d\'echange.');
        updateUiState('ok', 'GOG : aucun code en attente');
      }
      return Promise.resolve();
    }

    var entry = pending[0];
    log(PLATFORM, 'info', 'Echange du code GOG pour "' + entry.title + '" (' + pending.length + ' en attente, essai ' + ((entry.attempts || 0) + 1) + '/' + CONFIG.gogRedeemMaxAttempts + ').');
    updateUiState('running', 'GOG : echange du code pour ' + entry.title + '...');

    var form = null;
    var submit = null;

    return waitForElement('#codeInput', { timeout: 15000 }).catch(function () {
      throw new Error('Champ #codeInput introuvable sur ' + location.href + ' (page changee ou connexion requise).');
    }).then(function (input) {
      if (isLikelyLoggedOut()) {
        log(PLATFORM, 'warn', 'Session GOG non detectee : connectez-vous sur GOG puis revenez sur ' + CONFIG.gogRedeemUrl + '.');
        notifyUser('Free Games Claimer -- GOG', 'Connectez-vous sur GOG puis rouvrez gog.com/redeem : ' + pending.length + ' code(s) en attente.');
        updateUiState('error', 'GOG : connexion requise');
        return Promise.reject('STOP');
      }
      form = input.closest('form') || document;
      submit = form.querySelector('[type="submit"]') || findActionElement(form, [/^continuer$/i, /^continue$/i, /^valider$/i, /^suivant$/i, /^next$/i], { mustBeEnabled: false });
      if (!submit) throw new Error('Bouton "Continuer" introuvable a cote de #codeInput.');
      setInputValue(input, entry.code);
      updatePendingRedeemCode(entry.code, { attempts: (entry.attempts || 0) + 1, lastTry: Date.now() });
      return sleep(600);
    }).then(function () {
      log(PLATFORM, 'info', 'Code saisi, clic sur "' + (submit.textContent || submit.value || 'Continuer').trim() + '".');
      submit.click();
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, false);
    }).then(function (outcome) {
      if (outcome.type !== 'confirm') return outcome;
      log(PLATFORM, 'info', 'Jeu reconnu par GOG, clic sur "' + (outcome.button.textContent || '').trim() + '" pour l\'ajouter a la bibliotheque.');
      outcome.button.click();
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, true);
    }).then(function (outcome) {
      var remaining;
      if (outcome.type === 'success') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'OK "' + entry.title + '" ajoute a votre bibliotheque GOG. ' + remaining.length + ' code(s) restant(s).');
        notifyUser('Free Games Claimer -- GOG', '"' + entry.title + '" ajoute a votre bibliotheque GOG.');
        updateUiState('ok', 'GOG : ' + entry.title + ' ajoute');
      } else if (outcome.type === 'used') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'already_redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'Le code de "' + entry.title + '" avait deja ete utilise (' + outcome.detail + '). Retire de la file.');
        updateUiState('ok', 'GOG : code deja utilise (' + entry.title + ')');
      } else if (outcome.type === 'captcha') {
        // Un captcha n'est pas un echec du code : on ne compte pas l'essai.
        updatePendingRedeemCode(entry.code, { attempts: entry.attempts || 0 });
        log(PLATFORM, 'warn', 'Captcha GOG visible : validez-le manuellement puis relancez via le menu Tampermonkey ("Echanger les codes GOG en attente").');
        notifyUser('Free Games Claimer -- GOG', 'Captcha GOG : validez-le puis relancez l\'echange (menu Tampermonkey).');
        updateUiState('error', 'GOG : captcha a valider manuellement');
        return;
      } else {
        var attempts = (entry.attempts || 0) + 1;
        if (outcome.type === 'invalid') {
          // Refus deterministe de GOG : inutile de reessayer ce code.
          attempts = CONFIG.gogRedeemMaxAttempts;
          updatePendingRedeemCode(entry.code, { attempts: attempts, lastError: outcome.detail || 'invalid' });
        }
        log(PLATFORM, 'error', 'Echange non confirme pour "' + entry.title + '" (' + outcome.type + (outcome.detail ? ' : ' + outcome.detail : '') + '), essai ' + attempts + '/' + CONFIG.gogRedeemMaxAttempts + '.');
        if (attempts >= CONFIG.gogRedeemMaxAttempts) {
          notifyUser('Free Games Claimer -- GOG', 'Impossible d\'echanger automatiquement le code de "' + entry.title + '" : ' + entry.code + ' (copie dans le presse-papiers). Saisissez-le sur gog.com/redeem.', 20000);
          copyToClipboard(entry.code);
        }
        updateUiState('error', 'GOG : echange non confirme (' + entry.title + ')');
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts && c.code !== entry.code; });
        if (outcome.type === 'timeout') return;
      }
      if (remaining && remaining.length) {
        log(PLATFORM, 'info', 'Rechargement de ' + CONFIG.gogRedeemUrl + ' pour le code suivant.');
        setTimeout(function () { location.assign(CONFIG.gogRedeemUrl); }, 2500);
      }
    }).catch(function (err) {
      if (err === 'STOP') return;
      log(PLATFORM, 'error', 'Erreur pendant l\'echange du code GOG : ' + (err && err.message));
      updateUiState('error', 'GOG : ' + (err && err.message));
    });
  }

  function scheduleGogRedeemWatcher() {
    if (location.hostname.indexOf('gog.com') === -1 || !isGogRedeemPage(location.pathname)) return;
    var pending = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (!pending.length) return;
    log('GOG', 'info', pending.length + ' code(s) GOG en attente : echange automatique dans 2s.');
    setTimeout(function () {
      updateUiState('running', 'GOG : echange automatique des codes...');
      dispatch();
    }, 2000);
  }

  function dispatch() {
    if (IS_EPIC_PAYMENT_FRAME) {
      runEpicPaymentIframeModule().catch(function (err) {
        log('Epic Payment (iframe)', 'error', 'Erreur non interceptee.', err);
      });
      return;
    }

    var host = location.hostname;
    var result;
    try {
      if (host.indexOf('epicgames.com') !== -1) result = runEpicGamesModule();
      else if (host.indexOf('gog.com') !== -1) result = isGogRedeemPage(location.pathname) ? runGogRedeemModule() : runGogModule();
      else if (host.indexOf('luna.amazon.') !== -1 || host.indexOf('gaming.amazon.com') !== -1) result = runAmazonLunaModule();
      else {
        log('CORE', 'warn', 'Domaine non pris en charge par le dispatcher : ' + host);
        updateUiState('error', 'Domaine non pris en charge');
        return;
      }
      Promise.resolve(result).catch(function (err) {
        // 'STOP' est un arret volontaire deja journalise par le module.
        if (err === 'STOP') return;
        log('CORE', 'error', 'Erreur non interceptee dans un module.', err);
        updateUiState('error', 'Erreur : ' + (err && err.message));
      });
    } catch (err) {
      log('CORE', 'error', 'Erreur non interceptee dans le dispatcher principal.', err);
      updateUiState('error', 'Erreur : ' + err.message);
    }
  }

  if (!IS_EPIC_PAYMENT_FRAME) {
    (function watchSpaNavigation() {
      var lastHref = location.href;
      var lastPath = location.pathname;

      function rerun() {
        // Seul un changement de chemin compte : Epic et Amazon reecrivent en
        // permanence la query (suivi, ?lang=), ce qui relancait tout un cycle.
        if (location.pathname !== lastPath || (location.href !== lastHref && !isGogRedeemPage(location.pathname))) {
          var prevHref = lastHref;
          lastHref = location.href;
          if (location.pathname === lastPath) { return; }
          lastPath = location.pathname;
          // gog.com/redeem pousse /redeem/<code> apres "Continuer" : le module
          // d'echange est deja en cours, ne pas le relancer.
          if (location.hostname.indexOf('gog.com') !== -1 && isGogRedeemPage(location.pathname) && /\/redeem(\/|$|\?)/i.test(prevHref)) {
            log('CORE', 'info', 'Route interne GOG /redeem : pas de relance du module.');
            return;
          }
          log('CORE', 'info', 'Navigation SPA detectee -> ' + location.href);
          setTimeout(dispatch, 1000);
        }
      }

      var origPushState = history.pushState;
      history.pushState = function () {
        origPushState.apply(this, arguments);
        rerun();
      };

      var origReplaceState = history.replaceState;
      history.replaceState = function () {
        origReplaceState.apply(this, arguments);
        rerun();
      };

      window.addEventListener('popstate', rerun);
      setInterval(rerun, CONFIG.pollInterval);
    })();
  }

  if (!IS_EPIC_PAYMENT_FRAME && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Lancer la recuperation maintenant', function () {
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      dispatch();
    });
    GM_registerMenuCommand('Relancer maintenant (ignorer le delai)', function () {
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      notifyUser('Free Games Claimer', 'Delai de repos remis a zero : la prochaine verification repart immediatement.');
      dispatch();
    });
    GM_registerMenuCommand('Etat du delai de repos', function () {
      var e = autoCooldownRemaining('epic');
      var l = autoCooldownRemaining('luna');
      var txt = 'Epic : ' + (e ? 'pause ' + formatDelay(e) : 'pret') + ' | Luna : ' + (l ? 'pause ' + formatDelay(l) : 'pret');
      log('CORE', 'info', txt);
      notifyUser('Free Games Claimer', txt);
    });
    GM_registerMenuCommand('Effacer l\'historique de cette plateforme', function () {
      // L'historique est stocke sous le nom de plateforme ("Epic Games", ...),
      // pas sous le hostname.
      var key = 'FGC_history_' + platformNameForHost(location.hostname);
      GM_setValue(key, '{}');
      try { sessionStorage.removeItem('FGC_epic_redirect_counts'); } catch (e) {}
      clearEpicPendingSlug();
      log('CORE', 'info', 'Historique efface pour la cle "' + key + '".');
      notifyUser('Free Games Claimer', 'Historique local efface pour cette plateforme.');
    });
    if (location.hostname.indexOf('epicgames.com') !== -1) {
      GM_registerMenuCommand('Basculer le mode auto hebdo Epic', function () {
        setEpicAutoModeEnabled(!getEpicAutoModeEnabled());
        notifyUser('Free Games Claimer -- Epic Games', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      GM_registerMenuCommand('Verifier maintenant les jeux gratuits (API)', function () {
        clearAutoCooldown('epic');
        checkEpicWeeklyRotation({ auto: false });
      });
    }
    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      GM_registerMenuCommand('Aller a la page des offres Luna', function () {
        location.assign(location.origin + CONFIG.lunaClaimsPath);
      });
      GM_registerMenuCommand('Basculer le mode auto Luna', function () {
        setLunaAutoModeEnabled(!getLunaAutoModeEnabled());
        notifyUser('Free Games Claimer -- Amazon Luna', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      GM_registerMenuCommand('Vider la file Luna en cours', function () {
        saveLunaQueue([]);
        try { sessionStorage.removeItem('FGC_luna_finish_pending'); sessionStorage.removeItem('FGC_luna_batch'); } catch (e) {}
        notifyUser('Free Games Claimer -- Amazon Luna', 'File Luna videe.');
      });
    }
    if (location.hostname.indexOf('gog.com') !== -1) {
      GM_registerMenuCommand('Echanger les codes GOG en attente', function () {
        if (isGogRedeemPage(location.pathname)) dispatch();
        else location.assign(CONFIG.gogRedeemUrl);
      });
    }
    GM_registerMenuCommand('Voir l\'historique de cette plateforme', function () {
      var platform = platformNameForHost(location.hostname);
      var history = getHistory(platform);
      var keys = Object.keys(history);
      if (!keys.length) {
        log('CORE', 'info', 'Historique vide pour ' + platform + '.');
        notifyUser('Free Games Claimer', 'Aucun historique pour ' + platform + '.');
        return;
      }
      keys.sort(function (a, b) { return (history[b].ts || 0) - (history[a].ts || 0); });
      var lines = keys.map(function (k) {
        var e = history[k];
        return new Date(e.ts || 0).toLocaleString() + ' | ' + e.status + ' | ' + k + (e.reason ? ' | ' + e.reason : '');
      });
      log('CORE', 'info', 'Historique ' + platform + ' (' + keys.length + ' entree(s)) :\n' + lines.join('\n'));
      notifyUser('Free Games Claimer', platform + ' : ' + keys.length + ' entree(s) -- detail dans la console (F12).', 15000);
    });
    GM_registerMenuCommand('Voir les codes en attente', function () {
      var text = describePendingCodes();
      log('CORE', 'info', 'Codes en attente :\n' + text);
      notifyUser('Free Games Claimer -- codes en attente', text, 20000);
    });
    GM_registerMenuCommand('Oublier tous les codes en attente', function () {
      savePendingRedeemCodes([]);
      notifyUser('Free Games Claimer', 'File des codes videe.');
    });
  }

  // ---------------------------------------------------------------------------
  // Mode pilote : la veille a ouvert cet onglet
  // ---------------------------------------------------------------------------
  //
  // Ouvert par l'orchestrateur, le moteur ne demarre PAS tout seul : il
  // s'annonce et attend un ordre. Sans cela, deux logiques se disputeraient le
  // meme bouton -- le mode auto habituel et la reclamation pilotee.
  //
  // Seul le service worker connait l'identifiant de cet onglet : c'est donc a
  // lui qu'on pose la question. Sous Tampermonkey, chrome.runtime n'existe pas,
  // la reponse est "non pilote", et rien ne change.
  //
  // Le VERDICT ne demande aucune plomberie nouvelle : les modules ecrivent deja
  // une entree d'historique avec le vocabulaire attendu (claimed, failed,
  // needs_link, bad_url...). Le mode pilote se contente de guetter cette
  // entree, ce qui evite d'instrumenter quatre modules.

  var PILOT_POLL_MS = 500;

  function askIfPiloted(then) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        then(false);
        return;
      }
      chrome.runtime.sendMessage({ type: 'fgc-suis-je-pilote' }, function (rep) {
        try { void chrome.runtime.lastError; } catch (e) {}
        then(!!(rep && rep.piloted));
      });
    } catch (e) {
      then(false);
    }
  }

  function sendToPilot(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        try { void chrome.runtime.lastError; } catch (e) {}
      });
    } catch (e) {}
  }

  // Empreinte de l'historique de la plateforme : sert a reperer l'entree que la
  // reclamation vient d'ecrire, sans savoir a l'avance sous quelle cle.
  function historyFingerprint(platform) {
    var histo = getHistory(platform);
    var fingerprint = {};
    Object.keys(histo).forEach(function (k) {
      fingerprint[k] = (histo[k] && histo[k].ts) || 0;
    });
    return fingerprint;
  }

  function freshEntry(platform, before) {
    var histo = getHistory(platform);
    var keys = Object.keys(histo);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var e = histo[k];
      if (!e || !e.ts) continue;
      if (!(k in before) || e.ts > before[k]) {
        return { key: k, statusLine: e.status, reasonText: e.reason || null, ts: e.ts };
      }
    }
    return null;
  }

  function runClaimOrder(budgetMs) {
    var platform = platformNameForHost(location.hostname);
    var before = historyFingerprint(platform);
    var debut = Date.now();

    // Deux arrets nets, avant meme d'essayer : inutile de cliquer sur une page
    // deconnectee, et un defi de securite demande un humain.
    if (isLikelyLoggedOut()) {
      sendToPilot({ type: 'fgc-verdict', verdict: 'needs_login', plateforme: platform });
      return;
    }
    if (detectSecurityChallenge()) {
      sendToPilot({ type: 'fgc-verdict', verdict: 'challenge', plateforme: platform });
      return;
    }

    dispatch();

    var timer = setInterval(function () {
      var found = freshEntry(platform, before);
      if (found) {
        clearInterval(timer);
        sendToPilot({
          type: 'fgc-verdict',
          verdict: found.statusLine,
          key: found.key,
          reasonText: found.reasonText,
          plateforme: platform
        });
        return;
      }
      if (detectSecurityChallenge()) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'challenge', plateforme: platform });
        return;
      }
      if (Date.now() - debut > budgetMs) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'delai depasse', plateforme: platform });
      }
    }, PILOT_POLL_MS);
  }

  function listenForOrders() {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || msg.type !== 'fgc-reclame') return;
        sendResponse({ recu: true });
        runClaimOrder(msg.budgetMs || 5 * 60 * 1000);
        return true;
      });
    } catch (e) {}
  }

  function startPiloted() {
    log('CORE', 'info', 'Onglet pilote par la veille : le moteur attend un ordre.');
    listenForOrders();
    sendToPilot({ type: 'fgc-pret', url: location.href });
  }

  // run_at document_idle peut injecter le script APRES l'evenement load : un
  // simple addEventListener('load') ne partait alors jamais, et le moteur ne
  // demarrait pas -- page rapide, page en cache, petite iframe de paiement.
  function whenLoaded(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', fn);
  }

  if (IS_EPIC_PAYMENT_FRAME) {
    whenLoaded(function () { setTimeout(dispatch, 800); });
  } else {
    whenLoaded(function () {
      askIfPiloted(function (piloted) {
        if (piloted) { startPiloted(); return; }
        demarrerNormalement();
      });
    });
  }

  function demarrerNormalement() {
    setTimeout(function () {
      injectFloatingButton();
      updateUiState('idle', 'Pret -- cliquez sur Claim');
      scheduleEpicAutoWatcher();
      startEpicPostPurchaseModalWatcher();
      var pauseEpic = autoCooldownRemaining('epic');
      var pauseLuna = autoCooldownRemaining('luna');
      if (pauseEpic || pauseLuna) log('CORE', 'info', 'Delai de repos en cours -- Epic : ' + (pauseEpic ? formatDelay(pauseEpic) : 'pret') + ', Luna : ' + (pauseLuna ? formatDelay(pauseLuna) : 'pret') + '.');
      scheduleLunaAutoWatcher();
      scheduleGogRedeemWatcher();
    }, 1500);
  }

  // Hook de test (inactif dans Tampermonkey) : expose les fonctions pures
  // (URL Epic, offres Luna, codes GOG) a un harnais Node qui les verifie
  // contre de vraies reponses / de vrais extraits de page.
  if (typeof globalThis !== 'undefined' && globalThis.__FGC_EXPOSE_FOR_TESTS__) {
    globalThis.__FGC__ = {
      normalizeEpicSlug: normalizeEpicSlug,
      resolveEpicSlug: resolveEpicSlug,
      isEpicPromoActiveNow: isEpicPromoActiveNow,
      isEpicFreeToKeep: isEpicFreeToKeep,
      mapEpicApiElements: mapEpicApiElements,
      extractEpicSlug: extractEpicSlug,
      epicStoreUrl: epicStoreUrl,
      buildEpicUrl: buildEpicUrl,
      isEpicNotFoundPage: isEpicNotFoundPage,
      platformNameForHost: platformNameForHost,
      isLunaClaimsListPage: isLunaClaimsListPage,
      isLunaOfferDetailPage: isLunaOfferDetailPage,
      extractLunaOfferSlug: extractLunaOfferSlug,
      extractLunaOfferId: extractLunaOfferId,
      detectLunaStore: detectLunaStore,
      lunaStoreLabel: lunaStoreLabel,
      isLunaStoreSkipped: isLunaStoreSkipped,
      parseRedeemCode: parseRedeemCode,
      parseRedeemDeadline: parseRedeemDeadline,
      getPendingRedeemCodes: getPendingRedeemCodes,
      addPendingRedeemCode: addPendingRedeemCode,
      updatePendingRedeemCode: updatePendingRedeemCode,
      removePendingRedeemCode: removePendingRedeemCode,
      isGogRedeemPage: isGogRedeemPage,
      autoCooldownRemaining: autoCooldownRemaining,
      setAutoCooldown: setAutoCooldown,
      clearAutoCooldown: clearAutoCooldown,
      formatDelay: formatDelay,
      classifyGogWarning: classifyGogWarning,
      isCheckoutButton: isCheckoutButton,
      robustClick: robustClick,
      findActionElement: findActionElement,
      findShortestActionElement: findShortestActionElement,
      epicPurchaseOverlayOpen: epicPurchaseOverlayOpen,
      epicPaymentFramePass: epicPaymentFramePass,
      epicPaymentFrameAlive: epicPaymentFrameAlive,
      epicPaymentScreenSignature: epicPaymentScreenSignature,
      epicPaymentFindConfirm: epicPaymentFindConfirm,
      epicPaymentTopDialog: epicPaymentTopDialog,
      epicPostPurchaseWatcherTick: epicPostPurchaseWatcherTick,
      handleEpicPostPurchaseModals: handleEpicPostPurchaseModals,
      startEpicPostPurchaseModalWatcher: startEpicPostPurchaseModalWatcher,
      nextGameGateReason: nextGameGateReason,
      epicPaymentFrameState: function () {
        return {
          actions: epicPaymentActions,
          screen: epicPaymentScreen,
          alive: epicPaymentFrameAlive(),
          stopped: epicPaymentStopped,
          noticeSent: epicPaymentNoticeSent
        };
      },
      CONFIG: CONFIG,
      emergencyStopped: emergencyStopped,
      checkoutGuardApplies: checkoutGuardApplies,
      detectSecurityChallenge: detectSecurityChallenge,
      LUNA_CLAIM_PATTERNS: LUNA_CLAIM_PATTERNS,
      LUNA_CLAIMED_TEXT: LUNA_CLAIMED_TEXT,
      GOG_REDEEM_SUCCESS_TEXT: GOG_REDEEM_SUCCESS_TEXT,
      GOG_REDEEM_CONFIRM_PATTERNS: GOG_REDEEM_CONFIRM_PATTERNS,
      EPIC_LIBRARY_PATTERNS: EPIC_LIBRARY_PATTERNS,
      EPIC_LIBRARY_LOOSE_PATTERNS: EPIC_LIBRARY_LOOSE_PATTERNS,
      EPIC_AGREE_PATTERNS: EPIC_AGREE_PATTERNS,
      EPIC_AGREE_LOOSE_PATTERNS: EPIC_AGREE_LOOSE_PATTERNS,
      EPIC_FREE_ORDER_PATTERNS: EPIC_FREE_ORDER_PATTERNS,
      EPIC_FREE_ORDER_LOOSE_PATTERNS: EPIC_FREE_ORDER_LOOSE_PATTERNS
    };
  }
})();