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
    // Les deux hotes de l'API, SANS parametres : le pays et la langue sont
    // desormais un reglage (getEpicApiUrls), plus une URL figee recopiee ici et
    // dans watch/sources/epic.js. Le second hote est la voie IPv4 pure.
    epicApiHosts: [
      'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions',
      'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions'
    ],
    // Nouveau schema d'URL Epic : plus de prefixe de langue dans le chemin,
    // la langue passe en parametre ?lang=xx (mettre '' pour laisser Epic choisir).
    epicStoreOrigin: 'https://store.epicgames.com',
    // Defauts CABLES, et ils comptent : en userscript il n'y a pas de popup
    // pour ecrire ces cles, et le moteur doit savoir quoi faire sans stockage.
    epicCountry: 'FR',
    epicLang: 'fr',
    // Les langues dans lesquelles le moteur sait LIRE une fiche Epic : ses
    // motifs (03-patterns-epic.js) ne connaissent que celles-ci. La langue du
    // pays sert a l'API ; une page, elle, ne s'ouvre que dans l'une de ces
    // langues, et en anglais a defaut (getEpicPageLang). Ajouter une langue
    // ici sans ses motifs, mesures sur la vraie page, rouvrirait le bug de la
    // 2.20.0 : des fiches ou le moteur ne reconnait plus aucun bouton.
    epicReadableLangs: ['fr', 'en'],
    epicFallbackPageLang: 'en',
    // Temps d'attente du rendu cote client des cartes sur /free-games avant
    // de conclure qu'une carte est absente et de rediriger vers sa fiche.
    epicCardWaitTimeout: 8000,
    // Avant de laisser le SENS choisir le bouton d'une fiche Epic (libelle inconnu),
    // on laisse aux libelles livres le temps d'apparaitre (15-epic-claim.js).
    epicAdaptiveGraceMs: 6000,
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

  /* Ou echanger un code, par magasin.
   *
   * Jusqu'a la 2.33.0, la destination se decidait par un ternaire binaire :
   * GOG d'un cote, l'URL Microsoft pour TOUT le reste. Les sept autres
   * magasins que Luna sait distribuer recevaient donc l'adresse de Microsoft,
   * qui refuse leurs codes.
   *
   * DEUX ENTREES RENSEIGNEES SEULEMENT, et c'est un choix. Ce sont les deux
   * seules adresses que ce depot ait jamais utilisees, donc les deux seules
   * dont il puisse repondre. Les autres attendent une mesure, et "null" veut
   * dire exactement cela -- le message dit alors "collez-le sur le site de X"
   * sans promettre une adresse. Inventer une URL plausible couterait un onglet
   * ouvert sur une erreur, et la confiance dans toutes les autres.
   *
   * Jumelle de REDEEM_URLS dans watch/codes.js. La duplication ne peut pas
   * disparaitre -- ce fichier tourne aussi en userscript, sans modules -- et
   * test/codes.test.mjs verifie qu'elle ne derive pas.
   */
  var REDEEM_URLS = {
    gog: CONFIG.gogRedeemUrl,
    microsoft: CONFIG.microsoftRedeemUrl,
    epic: null,
    amazon: null,
    ubisoft: null,
    ea: null,
    blizzard: null,
    legacy: null,
    unknown: null
  };

  function redeemUrlFor(store) {
    return REDEEM_URLS[store] || null;
  }

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

  /* Un texte pour l'utilisateur (2.55.0) : une cle de _locales et ses
     valeurs, jamais une phrase. Le moteur est en ASCII et ne sait pas quelle
     langue lit l'utilisateur ; le lanceur (etat du moteur) et le worker
     (notifications) composent la phrase, accentuee, dans la langue choisie.
     Plusieurs morceaux se passent en tableau, mis bout a bout. */
  function uiText(key) {
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(String(arguments[i]));
    return { key: key, args: args };
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

  /* Un libelle qui annonce une DEPENSE.
   *
   * Complement du garde-caisse, et non son doublon : celui-la regarde la
   * structure (champ de montant, bouton d'un prestataire) et s'efface sur les
   * magasins eprouves, ou le parcours gratuit passe legitimement par un panier
   * a zero. Celui-ci regarde ce qui est ECRIT sur le bouton, et vaut partout.
   *
   * Il existe parce qu'un bouton Luna est trouve par son attribut
   * "data-a-target", jamais par son texte : le jour ou Amazon rend
   * " S'abonner a Luna+ " ou " Acheter 19,99 EUR " dans la meme buy-box, rien
   * ne l'arretait. Les mots de panier en sont volontairement absents : Epic
   * fait cliquer "Ajouter au panier" sur un total a zero.
   */
  var PAID_LABEL = /\bacheter\b|\bbuy\b|\bpayer\b|\bpay now\b|\bs['\u2019]abonner\b|\bsubscribe\b|\babonnement\b|\bpr[e\u00e9]commander\b|\bpre-?order\b|\bupgrade\b|\d[\d\s.,]*\s*[\u20ac$\u00a3]|[\u20ac$\u00a3]\s*\d/i;

  function looksPaid(text) {
    return PAID_LABEL.test(String(text || ''));
  }

  function robustClick(el, options) {
    options = options || {};
    if (!el) return false;

    if (emergencyStopped()) {
      log('CORE', 'error', 'Clic REFUSE : arret d\'urgence actif.');
      return false;
    }

    /* Le libelle prime sur l'attribut qui a servi a trouver le bouton. Un
       "Acheter 19,99 EUR" ne se clique jamais, quel que soit le selecteur qui
       l'a designe et quel que soit l'hote. */
    if (looksPaid(actionText(el))) {
      log('CORE', 'error', 'Clic REFUSE : ce libelle annonce une depense.', {
        text: actionText(el).slice(0, 60)
      });
      return false;
    }

    /* "allowRepeat" : une SECONDE action, voulue, sur le meme noeud -- le cas
       de l'echange GOG, ou le bouton d'envoi peut etre relabellise en bouton
       de confirmation au lieu d'etre remplace. L'arret d'urgence, le
       garde-caisse et le refus des libelles payants, eux, s'appliquent
       toujours : ce n'est pas une porte de sortie, c'est une exception nommee. */
    if (!options.allowRepeat && isRepeatClick(el)) {
      var journal = clickHistoryFor(el);
      // Une seule ligne par bouton : l'avertissement doit rester lisible, pas
      // remplir la console au rythme des sondes.
      if (journal && !journal.warned) {
        journal.warned = true;
        // 'info', pas 'warn' : un reclic refuse est le fonctionnement NORMAL
        // de l'anti-rafale, pas une anomalie. Chrome compte chaque
        // console.warn d'un script de contenu comme une erreur dans
        // chrome://extensions -- une ligne de bon fonctionnement n'a rien a y
        // faire, et noie celles qui comptent.
        log('CORE', 'info', 'Clic ignore : "' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '" a deja ete clique ' + journal.count + ' fois. On laisse la page reagir.');
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
    /* Tolerant a l'absence de noeud : cette fonction sert autant a decider
       qu'a journaliser, et un message d'erreur ne doit pas lever une erreur. */
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
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
        // 'info' : ce message est emis PENDANT une attente, donc tant que le
        // bouton n'est pas encore apparu. C'est un temoin de recherche, pas
        // un echec -- l'echec, lui, est journalise quand l'attente expire.
        log('CORE', 'info', 'findActionElement("' + label + '") : aucun element visible ne correspond a [' + sources + ']');
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

  /* Un defi niche dans la fenetre d'achat (2.99.7). La frame d'achat, d'une autre
     origine, nous le dit par message ; il ne compte que tant que la fenetre est
     ouverte et moins de dix minutes. Seul le fait est accepte, de la part d'un
     hote epicgames.com : aucune donnee ne transite. */
  var epicPaymentChallengeAt = 0;
  if (!IS_EPIC_PAYMENT_FRAME && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || d.fgcPaymentChallenge !== true) return;
      var host = '';
      try { host = new URL(ev.origin).hostname; } catch (e) { return; }
      if (!/(^|\.)epicgames\.com$/i.test(host)) return;
      epicPaymentChallengeAt = Date.now();
    });
  }

  function detectSecurityChallenge() {
    if (!IS_EPIC_PAYMENT_FRAME && epicPaymentChallengeAt && Date.now() - epicPaymentChallengeAt < 10 * 60000 && epicPurchaseOverlayOpen()) {
      return { type: 'captcha', detail: 'defi dans la fenetre d\'achat Epic' };
    }
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

  // Le titre du jeu, tel que la page l'affiche. Sans lui, une cle opaque
  // ("offer:amzn1.pg.item...") ne se lisait nulle part : le popup montrait
  // "Amazon Luna" a la place du nom, et le registre ne pouvait rien rapprocher.
  function historyTitle(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 200) : null;
  }

  function saveHistoryEntry(platform, gameKey, status, reason, title) {
    var history = getHistory(platform);
    var previous = history[gameKey];
    var entry = { status: status, reason: reason || '', ts: Date.now() };
    // Une ecriture qui ne connait pas le titre ne fait pas oublier celui deja note.
    var name = historyTitle(title) || (previous && previous.title) || null;
    if (name) entry.title = name;
    history[gameKey] = entry;
    GM_setValue('FGC_history_' + platform, JSON.stringify(history));
  }

  // Complete le titre d'entrees existantes, sans toucher a leur statut ni a
  // leur date : c'est une correction d'etiquette, pas un nouvel evenement. Le
  // mode pilote et le registre reperent les nouveautes a leur date, et une
  // date rafraichie ici passerait pour une reclamation qui vient d'avoir lieu.
  // Une seule ecriture pour tout le lot.
  function rememberHistoryTitles(platform, titlesByKey) {
    var history = getHistory(platform);
    var changed = false;
    Object.keys(titlesByKey || {}).forEach(function (k) {
      var entry = history[k];
      var name = historyTitle(titlesByKey[k]);
      if (!entry || entry.title || !name) return;
      entry.title = name;
      changed = true;
    });
    if (changed) GM_setValue('FGC_history_' + platform, JSON.stringify(history));
    return changed;
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

  /* Les adresses des magasins dans la langue et le pays du reglage.
   *
   * COPIE ES5 de watch/localize.js (le moteur tourne aussi en userscript, sans
   * modules). test/localize.test.mjs compare les deux sur une table d'adresses :
   * une divergence fait echouer le test, pas l'utilisateur.
   *
   * Epic : segment de langue du chemin, ou ?lang= a defaut. GOG : prefixe de
   * langue du chemin (six langues seulement). Luna : domaine du pays, sauf si
   * une session a ete vue ailleurs (FGC_luna_host) -- on ne deconnecte personne
   * pour traduire une page. Steam n'est pas touche : sa reclamation lit des
   * libelles mesures en anglais. */
  var LOCALE_EPIC_SEGMENTS = { fr: 'fr', en: 'en-US', de: 'de', es: 'es-ES', it: 'it', pt: 'pt-BR', pl: 'pl' };
  var LOCALE_EPIC_KNOWN = ['ar', 'de', 'en-us', 'es-es', 'es-mx', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'th', 'tr', 'zh-cn', 'zh-hant'];
  var LOCALE_GOG_LANGS = ['en', 'de', 'fr', 'pl', 'ru', 'zh'];
  var LOCALE_GOG_HEADS = ['game', 'games', 'redeem'];
  var LOCALE_LUNA_BY_COUNTRY = {
    FR: 'luna.amazon.fr', BE: 'luna.amazon.fr', LU: 'luna.amazon.fr', CH: 'luna.amazon.fr',
    DE: 'luna.amazon.de', GB: 'luna.amazon.co.uk', IE: 'luna.amazon.co.uk',
    IT: 'luna.amazon.it', ES: 'luna.amazon.es', CA: 'luna.amazon.ca',
    NL: 'luna.amazon.nl', PL: 'luna.amazon.pl'
  };
  var LOCALE_LUNA_FORM = /^luna\.amazon\.(com|fr|de|co\.uk|it|es|ca|com\.au|co\.jp|in|com\.mx|com\.br|nl|se|pl|com\.tr)$/;

  function readLunaHost() {
    var host = String(GM_getValue('FGC_luna_host', '') || '').trim().toLowerCase();
    return LOCALE_LUNA_FORM.test(host) ? host : '';
  }

  /* Retient le domaine Luna ou une session est ouverte. Appele seulement
     apres avoir vu la page SANS bouton de connexion. */
  function rememberLunaHost() {
    var host = String(location.hostname || '').toLowerCase();
    if (!LOCALE_LUNA_FORM.test(host) || readLunaHost() === host) return;
    try { GM_setValue('FGC_luna_host', host); } catch (e) { /* stockage indisponible */ }
  }

  function localizeStoreUrl(raw, forClaim) {
    if (typeof raw !== 'string' || !raw) return raw;
    var u;
    try { u = new URL(raw); } catch (e) { return raw; }
    if (u.protocol !== 'https:') return raw;
    var country = getEpicCountry();
    var lang = getEpicLang();
    var host = u.hostname.toLowerCase();
    var first;

    if (host === 'store.epicgames.com') {
      var page = lang;
      if (forClaim) page = CONFIG.epicReadableLangs.indexOf(lang) !== -1 ? lang : 'en';
      else if (!Object.prototype.hasOwnProperty.call(LOCALE_EPIC_SEGMENTS, lang)) page = 'en';
      first = /^\/([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)(?=\/|$)/.exec(u.pathname);
      if (first && LOCALE_EPIC_KNOWN.indexOf(first[1].toLowerCase()) !== -1) {
        var segment = LOCALE_EPIC_SEGMENTS[page];
        if (segment && first[1] !== segment) u.pathname = '/' + segment + u.pathname.slice(first[0].length);
      } else if (u.searchParams.get('lang') !== page) {
        u.searchParams.set('lang', page);
      }
    } else if (host === 'www.gog.com' || host === 'gog.com') {
      if (LOCALE_GOG_LANGS.indexOf(lang) === -1) return raw;
      first = /^\/(en|de|fr|pl|ru|zh)(?=\/|$)/.exec(u.pathname);
      if (first) {
        if (first[1] !== lang) u.pathname = '/' + lang + u.pathname.slice(first[0].length);
      } else {
        var head = u.pathname.split('/')[1] || '';
        if (head === '' || LOCALE_GOG_HEADS.indexOf(head) !== -1) {
          u.pathname = '/' + lang + (u.pathname === '/' ? '/' : u.pathname);
        }
      }
    } else if (/^luna\.amazon\./.test(host)) {
      if (!/^\/claims(\/|$)/.test(u.pathname)) return raw;
      var target = readLunaHost() || LOCALE_LUNA_BY_COUNTRY[country] || 'luna.amazon.com';
      if (u.hostname !== target) u.hostname = target;
    } else {
      return raw;
    }

    var out = u.toString();
    return out === raw || out === raw + '/' ? raw : out;
  }

  function gogRedeemUrl() {
    return localizeStoreUrl(CONFIG.gogRedeemUrl, false);
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

  /* PAYS ET LANGUE DE LA BOUTIQUE.
   *
   * Lus dans le stockage, avec les defauts cables de CONFIG. Le popup les
   * ecrit, la veille les relit dans le meme espace (watch/storage.js), et le
   * moteur ici : un seul reglage, trois lecteurs, aucune recopie.
   *
   * La lecture est SYNCHRONE (GM_getValue) parce qu'elle sert a construire une
   * URL au moment de l'appel -- d'ou le prechargement de ces deux cles dans
   * ENGINE_KEYS (gm-shim.js). En userscript, GM_getValue est natif et rend le
   * defaut cable tant que rien n'a ete ecrit.
   *
   * La forme est verifiee plutot que la valeur : un code a deux lettres passe,
   * le reste retombe sur le defaut. Le moteur n'a pas besoin de la table des
   * pays -- c'est le popup qui borne le choix (watch/locale.js). */
  function getEpicCountry() {
    var raw = String(GM_getValue('FGC_epic_country', CONFIG.epicCountry) || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(raw) ? raw : CONFIG.epicCountry;
  }

  function getEpicLang() {
    var raw = String(GM_getValue('FGC_epic_lang', CONFIG.epicLang) || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(raw) ? raw : CONFIG.epicLang;
  }

  /* LA LANGUE DE LA PAGE N'EST PAS CELLE DE L'API.
   *
   * Le moteur choisit ses boutons par ce qui est ECRIT dessus (2.18.0), et ses
   * motifs ne lisent que CONFIG.epicReadableLangs. La 2.20.0 envoyait la langue
   * du pays jusque dans l'URL des fiches : regle sur l'Allemagne, le moteur
   * ouvrait des pages en allemand, ou aucun motif ne reconnait rien. Aucun
   * clic, donc aucun danger -- mais plus aucune reclamation non plus.
   *
   * L'API garde la langue du pays (titres, descriptions) ; la page prend celle
   * du reglage si le moteur la lit, l'anglais sinon. Une langue vide reste
   * vide : c'est le "laisser Epic choisir" de CONFIG.epicStoreOrigin. */
  function getEpicPageLang() {
    var lang = getEpicLang();
    if (!lang) return lang;
    return CONFIG.epicReadableLangs.indexOf(lang) !== -1 ? lang : CONFIG.epicFallbackPageLang;
  }

  function getEpicApiUrls() {
    var country = getEpicCountry();
    var locale = getEpicLang() + '-' + country;
    return CONFIG.epicApiHosts.map(function (host) {
      return host + '?locale=' + encodeURIComponent(locale)
        + '&country=' + encodeURIComponent(country)
        + '&allowCountries=' + encodeURIComponent(country);
    });
  }

  function epicStoreUrl(path) {
    var url = CONFIG.epicStoreOrigin + path;
    var lang = getEpicPageLang();
    if (lang) url += (path.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(lang);
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
    candidates.push(el.urlSlug);
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
        log('Epic Games', 'warn', 'Offre gratuite sans slug de page exploitable, ignoree : "' + el.title + '" (productSlug=' + el.productSlug + ', urlSlug=' + el.urlSlug + ').');
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

  /* LA POSSESSION SE LIT SUR LE BOUTON D'ACHAT DE CETTE FICHE (2.99.7).
   *
   * Jusqu'ici "Dans la bibliotheque" se cherchait n'importe ou dans la page :
   * tout bouton, tout lien visible dont le texte contenait ces mots. Or une
   * page Epic en porte plusieurs sans que CE jeu soit pris -- la carte du
   * second jeu gratuit de la semaine quand le premier est deja au compte, une
   * extension ou une autre edition possedee, une vignette "Dans la
   * bibliotheque" dans un carrousel. Le moteur concluait "deja possede",
   * l'ecrivait "claimed" dans son historique, et tout ce qui suivait -- le
   * module ("tous les jeux de la semaine sont deja recuperes"), l'ordre
   * pilote ("deja recupere") -- s'appuyait sur cette ligne fausse. Signale le
   * 2026-10-01 : des jeux Epic non recuperes, un anti-bot a l'ecran, et
   * "deja recupere".
   *
   * Desormais :
   *   - la fiche d'UN jeu seulement : sur une liste, personne n'est "possede ici" ;
   *   - le bouton d'achat PRINCIPAL, tel qu'Epic le marque
   *     (data-testid="purchase-cta-button"), fait foi quand il est la : son
   *     texte, et lui seul. Un "In Library" ailleurs ne le contredit pas ;
   *   - sinon, le repli par le texte -- mais court (un bouton, pas une
   *     vignette de jeu) et jamais dans un lien vers un AUTRE jeu. */
  var EPIC_CTA_SELECTOR = '[data-testid="purchase-cta-button"]';
  var EPIC_OWNERSHIP_MAX_TEXT = 40;

  function epicElementVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
  }

  function epicOwnershipText(text) {
    return EPIC_OWNERSHIP_PATTERNS.some(function (p) { return p.test(text); });
  }

  // Les boutons d'achat principaux visibles de la page, dans l'ordre du DOM.
  function epicPurchaseButtons() {
    var list;
    try { list = Array.prototype.slice.call(document.querySelectorAll(EPIC_CTA_SELECTOR)); } catch (e) { list = []; }
    return list.filter(epicElementVisible);
  }

  // L'element qui dit "ce jeu est dans votre bibliotheque", ou null.
  function epicOwnedHere() {
    var slug = extractEpicSlug(location.href);
    if (!slug) return null;

    var principaux = epicPurchaseButtons();
    if (principaux.length) {
      // Le libelle livre d'abord ; le sens (navigateur adaptatif) ensuite, pour
      // les langues et les tournures que les motifs ne connaissent pas -- sur
      // CE bouton seulement, jamais sur une vignette d'ailleurs.
      var ctaText = actionText(principaux[0]);
      return (epicOwnershipText(ctaText) || navOwnedText(ctaText)) ? principaux[0] : null;
    }

    var candidates = Array.prototype.slice.call(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    return candidates.find(function (el) {
      if (!epicElementVisible(el)) return false;
      var text = actionText(el);
      if (!text || text.length > EPIC_OWNERSHIP_MAX_TEXT || !epicOwnershipText(text)) return false;
      var anchor = el.closest ? el.closest('a[href*="/p/"], a[href*="/bundles/"]') : null;
      if (anchor) {
        var otherSlug = extractEpicSlug(anchor.getAttribute('href') || '');
        if (otherSlug && otherSlug !== slug) return false;
      }
      return true;
    }) || null;
  }

  // 'owned' | 'unowned' | null (la fiche n'a pas fini de s'afficher, ou ne dit rien).
  function epicCtaState(mustBeEnabled) {
    if (!extractEpicSlug(location.href)) return null;
    if (epicOwnedHere()) return 'owned';
    var principaux = epicPurchaseButtons();
    if (principaux.length) {
      var t = actionText(principaux[0]);
      var achetable = EPIC_MAIN_CTA_PATTERNS.some(function (p) { return p.test(t); })
        || EPIC_LIBRARY_PATTERNS.some(function (p) { return p.test(t); })
        || navClaimsLabel(principaux[0], 'Epic Games');
      return achetable ? 'unowned' : null;
    }
    var cta = findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { mustBeEnabled: mustBeEnabled !== false })
      || findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: mustBeEnabled !== false });
    return cta ? 'unowned' : null;
  }

  // Attend que la fiche dise ce qu'elle est (le rendu est cote client). null au bout du delai.
  function waitForEpicCtaState(timeoutMs) {
    return waitForElement(function () { return epicCtaState(false); }, { timeout: timeoutMs, interval: 500 })
      .catch(function () { return null; });
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

  function getEpicAutoModeEnabled() { return GM_getValue('FGC_epic_auto_mode', true); }
  function setEpicAutoModeEnabled(val) { GM_setValue('FGC_epic_auto_mode', !!val); }

  /* L'interface sur la page appartient au lanceur (content/launcher.js,
     2.51.0) : un seul bouton, dans une racine d'ombre fermee. Le moteur n'y
     pose plus rien lui-meme -- ni element, ni feuille de style. Il declare ce
     qu'il sait faire et dit ou il en est ; sans lanceur, il se tait. */
  function pageUi() {
    var ui = window.FGC_PAGE_UI;
    return ui && typeof ui.engine === 'function' && typeof ui.status === 'function' ? ui : null;
  }

  function autoModeSwitch() {
    if (location.hostname.indexOf('epicgames.com') !== -1 && !IS_EPIC_PAYMENT_FRAME) {
      return {
        kind: 'epic',
        get: getEpicAutoModeEnabled,
        set: function (val) {
          setEpicAutoModeEnabled(val);
          log('Epic Games', 'info', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
        }
      };
    }
    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      return {
        kind: 'luna',
        get: getLunaAutoModeEnabled,
        set: function (val) {
          setLunaAutoModeEnabled(val);
          log('Amazon Luna', 'info', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
        }
      };
    }
    return null;
  }

  function injectFloatingButton() {
    var ui = pageUi();
    if (!ui) return;
    ui.engine({
      claim: function () {
        // Action manuelle : on ignore et on remet a zero le delai de repos.
        clearAutoCooldown('epic');
        clearAutoCooldown('luna');
        epicForceRecheck = true;
        navForceRecheck = true;
        updateUiState('running', uiText('engSearching'));
        dispatch();
      },
      auto: autoModeSwitch()
    });
    ui.status(UI_STATE.status, UI_STATE.message);
  }

  function updateUiState(status, message) {
    UI_STATE.status = status;
    UI_STATE.message = message;
    var ui = pageUi();
    if (ui) ui.status(status, message);
  }

  function fetchCurrentEpicFreebies() {
    var urls = getEpicApiUrls();
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
        notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicFound', unclaimed.length, titles.join(', ')));
        return;
      }

      if (!getEpicAutoModeEnabled()) {
        log('Epic Games', 'info', 'Mode auto hebdo desactive : notification seule, pas de redirection automatique.');
        notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicAutoOff', unclaimed.length));
        return;
      }

      if (isUserLikelyBusy()) {
        log('Epic Games', 'info', 'Utilisateur probablement occupe (panier/checkout ouvert) : redirection automatique reportee.');
        return;
      }

      if (isLikelyLoggedOut()) {
        log('Epic Games', 'warn', 'Jeux gratuits detectes mais session non connectee : impossible de rediriger/reclamer automatiquement.');
        notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyEpicRelogin'));
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

      updateUiState('running', uiText('engAutoWeeklyRunning'));
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
    notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyUrlNotFound', pendingSlug));
    updateUiState('error', uiText('engUrlNotFound', pendingSlug));
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
        updateUiState('running', uiText('engEpicClaiming'));
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
        updateUiState('running', uiText('engAutoWeeklyRunning'));
        runEpicGamesModule();
      }, 2000);
    }
  }

  function waitForEpicPaymentCompletion() {
    epicLauncherModalSeen = false;
    return waitForElement(function () {
      handleEpicPostPurchaseModals();
      if (epicLauncherModalSeen) return document.body;

      // Un defi a resoudre ne se confirme pas en attendant : on le dit tout de suite (2.99.7).
      var defi = detectSecurityChallenge();
      if (defi) return { challenge: defi };

      var ownershipBtn = epicOwnedHere();
      if (ownershipBtn) return ownershipBtn;

      var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,p'));
      var thankYou = nodes.find(function (n) {
        return /thank you|merci pour votre commande|order confirm|commande confirmee|ajoute(e)? a votre bibliotheque|added to your library/i.test(n.textContent || '');
      });
      return thankYou || null;
    }, { timeout: CONFIG.epicPaymentCompletionTimeout, interval: 500, label: 'Epic: confirmation de paiement (iframe)' });
  }

  function isEpicGameUnownedOnCurrentPage() {
    return epicCtaState(true) === 'unowned';
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

    // La fiche d'ou part le clic, pour ne pas lui attribuer ce qui suit.
    var clickedAway = !!startEl && startEl !== document;
    var slugBeforeClick = clickedAway ? extractEpicSlug(location.href) : null;
    if (clickedAway) robustClick(startEl);

    // Ce controle ne vaut que sur la fiche DEJA ouverte. Apres un clic sur une
    // carte la page est encore la liste, ou la fiche d'un autre jeu : un
    // "Dans la bibliotheque" vu la ne dit rien de celui-ci (2.99.7). La
    // boucle d'attente ci-dessous reprend, sur la bonne fiche.
    var alreadyOwned = clickedAway ? null : epicOwnedHere();
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
    //
    // "Dans la bibliotheque" est guette pendant la meme attente. Le controle
    // ci-dessus ne regarde qu'une fois, souvent avant que la fiche ait rendu
    // ses boutons : un jeu deja pris -- depuis un autre ordinateur, ou avec un
    // historique remis a zero -- attendait alors douze secondes un bouton
    // d'achat qui n'existe pas, et finissait en echec. Sur la fiche de CE jeu
    // seulement : pendant la navigation, la page affichee est encore celle
    // d'ou l'on vient -- la liste, ou la fiche d'un autre jeu deja possede --
    // et un libelle croise la ne dit rien de celui-ci.
    var ownedEl = null;
    var waitStart = Date.now();
    var adaptive = false;
    return waitForElement(function () {
      var slugNow = extractEpicSlug(location.href);
      var onThisGame = !!slugNow && !(clickedAway && slugNow === slugBeforeClick);
      ownedEl = onThisGame ? epicOwnedHere() : null;
      if (ownedEl) return ownedEl;
      var known = findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: true })
          || findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { label: 'Epic: bouton panier (Obtenir / Ajouter au panier)' })
          || findShortestActionElement(document, EPIC_LIBRARY_LOOSE_PATTERNS);
      if (known) { adaptive = false; return known; }
      // Aucun libelle livre ne convient : Epic a peut-etre change son mot. On
      // laisse d'abord a la fiche le temps de s'afficher, puis le SENS decide.
      if (!onThisGame || Date.now() - waitStart < CONFIG.epicAdaptiveGraceMs) return null;
      var guess = epicAdaptiveClaimButton(PLATFORM);
      adaptive = !!guess;
      return guess;
    }, { timeout: 12000 }).catch(function () {
      // L'echec porte son diagnostic : les libelles reellement visibles disent
      // quel motif manque, et la prochaine capture d'ecran suffit a corriger.
      var labels = visibleActionLabels(8);
      throw new Error('bouton d\'acquisition introuvable en 12 s. Boutons visibles : ' + (labels.length ? labels.join(' | ') : 'aucun'));
    }).then(function (btn) {
      if (btn === ownedEl) {
        log(PLATFORM, 'info', '"' + title + '" est deja dans la bibliotheque, rien a reclamer.');
        return 'ALREADY_OWNED';
      }

      var challenge = detectSecurityChallenge();
      if (challenge) throw new Error('Defi de securite (' + challenge.type + ') detecte avant le clic initial.');

      var text = (btn.textContent || '').trim();
      var direct = EPIC_LIBRARY_LOOSE_PATTERNS.some(function (p) { return p.test(text); })
        || (adaptive && /librar|biblioth|sammlung|colecci|raccolta/i.test(text));
      var desc = navDescribe(btn);

      log(PLATFORM, 'info', 'Clic sur "' + text + '"' + (adaptive ? ' (libelle inconnu, retenu pour son sens)' : '') + (direct ? ' (parcours direct bibliotheque).' : ' (parcours panier).'));
      robustClick(btn);

      return (direct ? claimEpicDirect(PLATFORM) : claimEpicViaCart(PLATFORM)).then(function () {
        // Ce libelle a pris le jeu : il pese plus la prochaine fois.
        navLearn(PLATFORM, 'claim', desc, true);
        return 'CLAIMED';
      }, function (err) {
        if (adaptive) navLearn(PLATFORM, 'claim', desc, false);
        throw err;
      });
    });
  }

  /* LE BOUTON D'ACQUISITION, QUAND LE MOT A CHANGE (2.101.0).
   *
   * Les libelles livres ("Obtenir", "Get", "Ajouter a la bibliotheque") sont
   * tout ce que le moteur reconnaissait : qu'Epic ecrive "Recuperer" ou
   * "Claim now" et la fiche restait sans bouton pendant douze secondes, puis
   * un echec. Ici le SENS prend le relais -- le meme vocabulaire a poids que
   * GOG, la meme memoire, les memes interdits (argent, panier, abonnement, prix).
   *
   * Ce que cela ne change PAS : le clic passe par robustClick (libelles payants
   * refuses), et l'argent reste garde par le module de l'iframe de paiement,
   * dont les listes de confirmation sont figees et ne lisent pas ce
   * vocabulaire. Un bouton de plus a cliquer sur la fiche, jamais un bouton
   * de plus dans la fenetre d'achat.
   *
   * Seulement sur la fiche d'UN jeu, et seulement le bouton d'achat principal
   * qu'Epic marque (data-testid), ou, a defaut, un controle de la zone
   * principale hors liste (une extension vendue dans une rangee n'est pas le
   * jeu). */
  function epicAdaptiveClaimButton(PLATFORM) {
    if (!extractEpicSlug(location.href)) return null;
    var memory = navMemoryRead(PLATFORM);
    var principaux = epicPurchaseButtons();
    var el = null;
    if (principaux.length) {
      var s = navScore(principaux[0], 'claim', memory);
      el = s && s.score >= NAV_THRESHOLD ? principaux[0] : null;
    } else {
      var pool = navCandidates().filter(function (c) { return !navClosest(c, NAV_LIST_SEL) && !navClosest(c, NAV_CHROME_SEL); });
      var best = null;
      pool.forEach(function (c) {
        var sc = navScore(c, 'claim', memory);
        if (sc && sc.score >= NAV_THRESHOLD && (!best || sc.score > best.score)) best = { el: c, score: sc.score };
      });
      el = best ? best.el : null;
    }
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return null;
    if (looksPaid(actionText(el))) return null;
    return el;
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
      return waitForEpicPaymentCompletion().then(function (found) {
        if (found && found.challenge) {
          var e = new Error('Defi de securite (' + found.challenge.type + ') dans la fenetre d\'achat : a resoudre a la main, puis relancer.');
          e.fgcChallenge = true;
          throw e;
        }
        return found;
      }).catch(function (err) {
        if (err && err.fgcChallenge) throw err;
        var owned = epicOwnedHere();
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
            updateUiState('running', uiText('engEpicPurchaseWaiting'));
            notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyPurchaseWaiting', Math.round(elapsed / 1000)));
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
      notifyUser('Free Games Claimer -- Epic Games', uiText('engNotifyPurchaseStuck'));
      updateUiState('error', uiText('engEpicPurchaseStuck'));
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

  /* Une recuperation DEMANDEE (le bouton, le menu, ou "Recuperer" du popup)
   * repart de la page, pas de l'historique (2.99.7). L'historique est la memoire
   * du moteur ; s'il s'est trompe un jour (un "Dans la bibliotheque" lu sur la
   * carte d'un autre jeu), il se trompe tant que personne ne l'efface, et le
   * message "tous les jeux de la semaine sont deja recuperes" repond a un
   * utilisateur qui vient justement de dire le contraire. Une demande explicite
   * est plus recente que cette memoire : chaque jeu gratuit est revu sur sa
   * propre fiche, qui sait, elle, si le jeu est a vous. */
  var epicForceRecheck = false;

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
      var currentSlug = extractEpicSlug(location.href);
      var currentFree = freebies && currentSlug && freebies.find(function (g) { return g.slug === currentSlug; });
      var pageReady = currentFree && (force || alreadyHandled(PLATFORM, epicHistoryKeyForSlug(currentFree.slug)))
        ? waitForEpicCtaState(8000)
        : Promise.resolve(null);
      return pageReady.then(function (pageState) { return { freebies: freebies, force: force, pageState: pageState }; });
    }).then(function (ctx) {
      var freebies = ctx.freebies;
      var force = ctx.force;
      var currentSlug = extractEpicSlug(location.href);

      if (freebies && force) {
        // Demande explicite : l'historique de ces jeux ne decide rien (voir epicForceRecheck).
        freebies.forEach(function (g) {
          var k = epicHistoryKeyForSlug(g.slug);
          if (alreadyHandled(PLATFORM, k)) {
            log(PLATFORM, 'info', 'Recuperation demandee : "' + g.title + '" est revu sur sa fiche, l\'historique est ignore.');
            removeHistoryEntry(PLATFORM, k);
          }
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

  /* ======================================================================
   * LE NAVIGATEUR ADAPTATIF (2.100.0)
   *
   * Un magasin change ses pages, ses libelles, le NOMBRE d'etapes. GOG n'etait
   * qu'un exemple : sur la fiche d'un jeu en giveaway le bouton est "Go to
   * giveaway", qui mene a une seconde page ou il faut cliquer "Ajouter a la
   * bibliotheque". Un moteur qui ne connait qu'un libelle exact sur la page
   * courante ne trouve rien -- et recommence a ne rien trouver a chaque
   * redesign.
   *
   * Ce module ne cherche donc pas un TEXTE : il LIT LA PAGE.
   *
   *   1. ETAT. A quoi ressemble la page ? connexion demandee, defi de securite,
   *      jeu deja a vous, bouton qui prend le jeu, lien qui MENE au bouton,
   *      fenetre de confirmation, offre terminee, ou rien de net.
   *   2. CHOIX. Parmi les controles visibles, celui dont le SENS colle : un
   *      vocabulaire a poids dans six langues (pas une liste de phrases),
   *      la structure (zone principale, taille, proximite d'un compte a
   *      rebours, hors entete et pied de page), et la memoire (voir plus bas).
   *   3. GARDE-FOUS. Un controle qui parle d'argent, de panier, de paiement, de
   *      liste de souhaits, de partage, de connexion ou de cookies n'est JAMAIS
   *      choisi, quel que soit son score. Un prix non nul dans le libelle non
   *      plus. robustClick refuse encore en dernier recours (libelles payants,
   *      parcours de paiement, arret d'urgence, deuxieme clic sur le meme noeud).
   *   4. VERIFICATION. Un clic n'est un succes que si la page change de la
   *      bonne facon : le bouton disparait ou devient "dans la bibliotheque".
   *      Sinon on relit la page et on decide a nouveau.
   *   5. MEMOIRE. Ce qui a marche est retenu (libelle normalise, par magasin) et
   *      pese plus la fois suivante ; ce qui n'a pas marche pese moins. Un
   *      libelle nouveau, jamais vu, passe quand meme par le sens -- et s'il
   *      reussit, il est appris.
   *   6. REPRISE. Aller d'une page a l'autre decharge le moteur. L'ordre en
   *      cours est donc ecrit dans sessionStorage AVANT de partir, et la page
   *      suivante le reprend (voir startPiloted) : deux pages, trois, la
   *      reclamation reste UNE reclamation, avec son budget.
   *
   * Ce que ce module n'est PAS : un moyen d'acheter. Il ne choisit que des
   * controles qui PRENNENT un jeu gratuit ou qui MENENT a eux, et seulement sur
   * le meme site.
   * ====================================================================== */

  var NAV_ORDER_KEY = 'FGC_nav_order';
  var NAV_MEMORY_PREFIX = 'FGC_nav_';
  var NAV_MEMORY_MAX = 24;
  var NAV_FP_MAX = 8;
  var NAV_THRESHOLD = 6;
  var NAV_MAX_HOPS = 3;
  var NAV_MAX_STEPS = 8;
  var NAV_POLL_MS = 400;

  /* Une recuperation DEMANDEE (clic de l'utilisateur, ordre force du popup) ne
     se fie pas a la memoire d'historique du moteur. */
  var navForceRecheck = false;

  /* Le vocabulaire : [motif, poids]. Les poids disent a quel point un libelle
     PREND (claim) ou MENE (goto). Ecrit en echappements \uXXXX : le moteur est
     en ASCII pur. */
  var NAV_LEXICON = {
    claim: [
      [/add(ed)? (it |this |the game |game )?to (my |your |the )?(library|collection)/i, 9],
      [/ajouter [a\u00e0] (la |ma |votre |sa )?(biblioth[e\u00e8]que|collection)/i, 9],
      [/biblioth[e\u00e8]que hinzuf[u\u00fc]gen|(zur|in die) (meine |deine )?(bibliothek|sammlung)/i, 9],
      [/a[n\u00f1]adir (a |al? )?(la |mi |tu )?(biblioteca|colecci[o\u00f3]n)/i, 9],
      [/aggiungi (alla|al) (tua |mia )?(libreria|raccolta)/i, 9],
      [/adicionar [a\u00e0] (sua |minha |a )?biblioteca/i, 9],
      [/dodaj do (swojej )?biblioteki/i, 9],
      [/\b(claim|redeem|grab)\b/i, 6],
      [/\bget (it |the game |this )?(for )?free\b|^get( it| game)?$/i, 6],
      [/r[e\u00e9]cup[e\u00e9]r(er|ez)|r[e\u00e9]clam(er|ez)|\bobten(ir|ez)\b|\bpren(dre|ez)\b/i, 6],
      [/\bholen\b|jetzt sichern|kostenlos (holen|sichern|erhalten)/i, 6],
      [/\bconseguir\b|\breclamar\b|\bobtener\b/i, 6],
      [/\briscatta\b|\bottieni\b|\britira\b/i, 6],
      [/\bresgatar\b|\bobter\b/i, 6],
      [/\bodbierz\b|pobierz za darmo/i, 6]
    ],
    goto: [
      [/go to (the )?(giveaway|offer|promo(tion)?|deal)/i, 8],
      [/(aller|acc[e\u00e9]der|retourner|passer) (au |a l|[a\u00e0] l|vers l|vers le |[a\u00e0] la )?(giveaway|concours|offre|promotion|promo)/i, 8],
      [/(voir|d[e\u00e9]couvrir) (le |l)?(giveaway|concours|offre)/i, 7],
      [/zum (giveaway|gewinnspiel|angebot)|zur aktion/i, 8],
      [/ir al? (giveaway|sorteo|oferta|promoci[o\u00f3]n)/i, 8],
      [/vai (al|all) ?(giveaway|omaggio|offerta)/i, 8],
      [/ir para (o |a )?(giveaway|sorteio|oferta)/i, 8],
      [/przejd[z\u017a] do (giveaway|oferty)/i, 8],
      [/\b(giveaway|sorteo|sorteio|verlosung|gewinnspiel|omaggio)\b/i, 3]
    ],
    owned: [
      /\bin (your |my |the )?(library|collection)\b/i,
      /\bdans (la |votre |ma |sa )?(biblioth[e\u00e8]que|collection)\b/i,
      /\bin (der|deiner|ihrer|meiner) (bibliothek|sammlung)\b/i,
      /\ben (la |tu |mi )?(biblioteca|colecci[o\u00f3]n)\b/i,
      /\bnella (tua |mia )?(libreria|raccolta)\b/i,
      /\bna (sua |minha )?biblioteca\b/i,
      /\bw (twojej |mojej )?bibliotece\b/i,
      /\balready (in your library|owned|claimed|added|yours)\b/i,
      /d[e\u00e9]j[a\u00e0] (dans votre biblioth[e\u00e8]que|poss[e\u00e9]d[e\u00e9]|r[e\u00e9]cup[e\u00e9]r[e\u00e9]|ajout[e\u00e9])/i,
      /\b(added to|ajout[e\u00e9]e? [a\u00e0]) (your |votre |la )?(library|biblioth[e\u00e8]que)\b/i,
      /\bim besitz\b|\bbereits (in |im )/i,
      /\ben posesi[o\u00f3]n\b|\bin possesso\b|\bj\u00e1 (est\u00e1 )?na biblioteca/i,
      /^owned$/i,
      /^poss[e\u00e9]d[e\u00e9]$/i
    ],
    confirm: /^(i agree|agree|accept|continue|confirm|ok|got it|j.accepte|accepter|continuer|confirmer|ich stimme zu|zustimmen|weiter|best[a\u00e4]tigen|aceptar|continuar|confirmar|accetto|continua|conferma)$/i,
    ended: /(offer|giveaway|promotion|promo|deal) (has |is |was )?(now )?(ended|over|expired|finished)|no longer available|n.est plus disponible|(offre|giveaway|concours) (est )?(termin[e\u00e9]|expir[e\u00e9]|fini)|angebot (ist )?(abgelaufen|beendet)|oferta (ha )?(terminado|finalizado|expirado)/i
  };

  /* Ce qui n'est JAMAIS cliquable ici, quel que soit le score. */
  var NAV_VETO = [
    /\b(buy|purchase|cart|checkout|pay|payment|subscribe|wishlist|follow|share|trailer|watch|play)\b/i,
    /redeem (a |your )?code|enter (a |your )?code|utiliser un code|activer un code|code einl/i,
    /acheter|panier|commander|payer|paiement|souhait|abonn|partager|suivre|bande-annonce|regarder|jouer/i,
    /kaufen|warenkorb|bezahlen|zahlung|wunschliste|abonnieren|teilen|ansehen/i,
    /comprar|carrito|pagar|deseos|suscrib|compartir|ver tr[a\u00e1]iler/i,
    /acquista|carrello|paga\b|desideri|condividi/i,
    /sign in|log in|login|log out|connexion|se connecter|se d[e\u00e9]connecter|anmelden|abmelden|iniciar sesi|accedi|register|sign up|inscri|cr[e\u00e9]er un compte|newsletter|cookie|privacy|confidentialit|datenschutz|privacidad|terms|conditions|cgu|cgv|unsubscribe|d[e\u00e9]sinscri/i,
    /\b(install|launch|download|update)\b|installer|lancer|t[e\u00e9]l[e\u00e9]charger|mettre [a\u00e0] jour|herunterladen|installieren|descargar|instalar|scarica|installa/i,
    /\b(trial|join|upgrade|renew)\b|luna ?\+|check out|essai|essayer|rejoindre|mettre [a\u00e0] niveau|caisse|testen|beitreten|kasse|probar|prueba|unirse|caja|prova|iscriviti|cassa/i,
    /\b(cancel|close|dismiss|later|decline|no thanks)\b|annuler|fermer|plus tard|non merci|refuser|abbrechen|schlie[s\u00df]en|cerrar|cancelar|chiudi/i
  ];
  var NAV_PRICE = /[$\u20ac\u00a3\u00a5]\s?[1-9]|[1-9]\d*[.,]\d{0,2}\s?[$\u20ac\u00a3\u00a5]|[1-9]\d*\s?(eur|usd|gbp)\b/i;
  var NAV_TIMER = /\d+\s?:\s?\d+\s?:\s?\d+|offer ends|ends in|time left|il vous reste|se termine|verbleibend|quedan|rimangono/i;

  var NAV_CHROME_SEL = 'header, nav, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [class*="cookie" i], [id*="cookie" i], [class*="consent" i]';
  var NAV_MAIN_SEL = 'main, [role="main"], dialog, [role="dialog"], [aria-modal="true"], [class*="giveaway" i], [id*="giveaway" i]';
  var NAV_LIST_SEL = 'li, [class*="carousel" i], [class*="slider" i], [class*="swiper" i], [class*="tile" i]';

  function navClosest(el, selector) {
    try { return el && el.closest ? el.closest(selector) : null; } catch (e) { return null; }
  }

  function navVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
  }

  /* Le texte VISIBLE. Le bouton de la fiche GOG (mesure du 2026-10-02) porte
     trois etats dans le meme noeud -- "Check out now", "Go to giveaway", "Buy as a
     gift" -- dont un seul est affiche. textContent les concatene tous, et le
     controle entier tombait sous le veto (payer, acheter) alors que ce qu'on
     voit est "Go to giveaway". innerText ne rend que ce qui est affiche. */
  function navVisibleText(el) {
    if (!el) return '';
    return String(typeof el.innerText === 'string' ? el.innerText : (el.textContent || ''));
  }

  function navText(el) {
    var t = navVisibleText(el).replace(/\s+/g, ' ').trim();
    if (!t && el && el.getAttribute) {
      t = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim();
    }
    return t;
  }

  /* La raison pour laquelle ce libelle est interdit, ou null. */
  function navVetoReason(text) {
    for (var i = 0; i < NAV_VETO.length; i++) {
      if (NAV_VETO[i].test(text)) return String(NAV_VETO[i].source).slice(0, 30);
    }
    if (NAV_PRICE.test(text)) return 'prix';
    return null;
  }

  function navSameSite(host) {
    var a = String(host || '').split('.').slice(-2).join('.');
    var b = String(location.hostname || '').split('.').slice(-2).join('.');
    return !!a && a === b;
  }

  /* Ou mene ce controle : { href, path, sameSite, samePage }, ou null. */
  function navUrl(el) {
    var href = '';
    try {
      var isAnchor = el && el.tagName && String(el.tagName).toLowerCase() === 'a';
      var holder = isAnchor ? el : navClosest(el, 'a[href]');
      href = holder && holder.getAttribute ? (holder.getAttribute('href') || '') : '';
    } catch (e) { href = ''; }
    if (!href || /^(javascript:|mailto:|tel:)/i.test(href)) return null;
    var u;
    try { u = new URL(href, location.href); } catch (e2) { return null; }
    var here;
    try { here = new URL(location.href); } catch (e3) { here = null; }
    return {
      href: u.href,
      path: u.pathname + u.search + u.hash,
      sameSite: navSameSite(u.hostname),
      samePage: !!here && u.origin === here.origin && u.pathname === here.pathname && u.search === here.search
    };
  }

  function navSignature(el) {
    var t = navText(el).toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return t.replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /* ------------------------------------------------------------- memoire */

  function navMemoryRead(platform) {
    try {
      var m = JSON.parse(GM_getValue(NAV_MEMORY_PREFIX + platform, '{}'));
      return m && typeof m === 'object' ? m : {};
    } catch (e) { return {}; }
  }

  function navMemoryWrite(platform, memory) {
    try { GM_setValue(NAV_MEMORY_PREFIX + platform, JSON.stringify(memory)); } catch (e) {}
  }

  /* L'EMPREINTE STRUCTURELLE (2.102.0).
   *
   * Un libelle change -- "Add to library" devient "Prends-le" --, la structure
   * du bouton, elle, ne bouge pas toujours : meme marque de test, meme cible,
   * memes classes lisibles. Quand un controle a pris un jeu, on retient donc
   * aussi COMMENT il est fait, et un controle qui lui ressemble est reconnu
   * meme sous un mot que personne ne connait.
   *
   * Ce que l'empreinte ne remplace jamais : le libelle doit rester LISIBLE
   * (navScore l'exige) pour que les interdits s'appliquent -- argent, panier,
   * abonnement, installation. Elle ne fait qu'ajouter du sens, comme la memoire
   * de libelle ; elle ne passe devant aucun interdit. */
  function navStableClass(token) {
    // Une classe lisible, pas le hash d'une feuille de style (css-1x2y3z, sc-AbCd, _a1b2c3).
    if (!token || token.length > 32) return false;
    if (/^(css|sc|jsx|svelte|ng|ember|emotion|_)/i.test(token)) return false;
    if (/\d{3,}/.test(token) || /^[a-z]{1,2}\d/i.test(token)) return false;
    return /^[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]+)*$/i.test(token);
  }

  /* La forme d'une adresse, sans ce qui varie d'un jeu a l'autre. */
  function navHrefShape(path) {
    var p = String(path || '');
    var hash = p.indexOf('#') !== -1 ? p.slice(p.indexOf('#')) : '';
    var base = p.split('#')[0].split('?')[0];
    var parts = base.split('/');
    if (parts.length >= 4) parts[parts.length - 1] = '*';
    return (parts.join('/') + hash).slice(0, 80);
  }

  function navFingerprint(el) {
    if (!el || !el.getAttribute) return null;
    var fp = { t: String(el.tagName || '').toLowerCase() };
    try {
      var role = el.getAttribute('role');
      if (role) fp.r = String(role).toLowerCase().slice(0, 20);
      var tid = el.getAttribute('data-testid');
      if (tid) fp.i = String(tid).slice(0, 60);
      var at = el.getAttribute('data-a-target');
      if (at) fp.a = String(at).slice(0, 60);
      var cls = String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '')
        .split(/\s+/).filter(navStableClass).slice(0, 6);
      if (cls.length) fp.c = cls;
      var url = navUrl(el);
      if (url && url.sameSite) fp.h = navHrefShape(url.path);
    } catch (e) { return null; }
    // Rien de distinctif (un <button> nu) : pas d'empreinte, on ne retient pas une forme que tous partagent.
    return (fp.i || fp.a || (fp.c && fp.c.length >= 2) || fp.h) ? fp : null;
  }

  function navFpSame(a, b) {
    if (!a || !b || a.t !== b.t) return false;
    if (a.i && b.i) return a.i === b.i;
    if (a.a && b.a) return a.a === b.a;
    if (a.c && b.c) {
      var shared = 0;
      for (var i = 0; i < a.c.length; i++) if (b.c.indexOf(a.c[i]) !== -1) shared++;
      if (shared >= Math.max(2, Math.ceil(Math.min(a.c.length, b.c.length) * 0.66))) return true;
    }
    return !!(a.h && b.h && a.h === b.h && (a.r || '') === (b.r || ''));
  }

  /* Ce controle ressemble-t-il a un controle qui a deja rempli ce role ? */
  function navFpMatch(el, kind, memory) {
    var list = memory && memory.fp && memory.fp[kind];
    if (!list || !list.length) return false;
    var cur = navFingerprint(el);
    if (!cur) return false;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e || !(e.ok > e.ko)) continue;
      // Une empreinte faite de classes ou d'une adresse seules est moins nette qu'une marque de test : deux fois.
      var net = !!((e.fp && e.fp.i) || (e.fp && e.fp.a));
      if (!net && e.ok < 2) continue;
      if (navFpSame(cur, e.fp)) return true;
    }
    return false;
  }

  /* Un controle AVANT son clic : le libelle et l'empreinte (apres, la page a pu changer). */
  function navDescribe(el) {
    return { sig: navSignature(el), fp: navFingerprint(el) };
  }

  /* Retient qu'un controle a (ou n'a pas) fait ce qu'on en attendait. "subject" :
     un libelle normalise, un element, ou un navDescribe(). */
  function navLearn(platform, kind, subject, ok) {
    var sig;
    var fp = null;
    if (typeof subject === 'string') {
      sig = subject;
    } else if (subject && typeof subject.sig === 'string') {
      sig = subject.sig;
      fp = subject.fp || null;
    } else {
      sig = navSignature(subject);
      fp = navFingerprint(subject);
    }
    if (!sig) return;
    var memory = navMemoryRead(platform);
    var slot = memory[kind] || (memory[kind] = {});
    var e = slot[sig] || (slot[sig] = { ok: 0, ko: 0, ts: 0 });
    if (ok) e.ok++; else e.ko++;
    e.ts = Date.now();
    var keys = Object.keys(slot);
    if (keys.length > NAV_MEMORY_MAX) {
      keys.sort(function (a, b) { return slot[a].ts - slot[b].ts; });
      for (var i = 0; i < keys.length - NAV_MEMORY_MAX; i++) delete slot[keys[i]];
    }
    if (fp) {
      var all = memory.fp || (memory.fp = {});
      var list = all[kind] || (all[kind] = []);
      var found = null;
      for (var j = 0; j < list.length; j++) if (navFpSame(fp, list[j].fp) && navFpSame(list[j].fp, fp)) { found = list[j]; break; }
      if (!found) { found = { fp: fp, ok: 0, ko: 0, ts: 0 }; list.push(found); }
      if (ok) found.ok++; else found.ko++;
      found.ts = Date.now();
      if (list.length > NAV_FP_MAX) {
        list.sort(function (a, b) { return b.ts - a.ts; });
        list.length = NAV_FP_MAX;
      }
    }
    navMemoryWrite(platform, memory);
  }

  /* ---------------------------------------------------------------- choix */

  /* Le score d'un controle pour un role ('claim' | 'goto'), ou null s'il ne
     peut pas etre candidat. { score, why, text, veto }. */
  function navScore(el, kind, memory) {
    var text = navText(el);
    if (!text || text.length > 90) return null;
    var veto = navVetoReason(text);
    if (veto) return { score: -99, veto: veto, text: text, why: ['interdit : ' + veto] };
    // Un controle qui dit deja "dans la bibliotheque" ne PREND plus rien : meme reconnu par sa forme, il n'est pas a cliquer.
    if (kind === 'claim' && navOwnedText(text)) return null;

    var lexicon = NAV_LEXICON[kind];
    var best = 0;
    for (var i = 0; i < lexicon.length; i++) {
      if (lexicon[i][0].test(text) && lexicon[i][1] > best) best = lexicon[i][1];
    }
    var why = [];
    var score = best;
    if (best) why.push('sens ' + best);

    var known = memory && memory[kind] && memory[kind][navSignature(el)];
    var learned = !!known && known.ok > known.ko;
    // Un libelle dont le sens n'est dans aucun vocabulaire mais qui a DEJA pris le jeu
    // (ou mene a lui) est compris : la memoire etend le vocabulaire.
    if (!best && learned) { best = 8; score = 8; why.push('appris'); }
    // Meme chose par la STRUCTURE : un controle fait comme un controle qui a pris le jeu,
    // sous un mot nouveau (l'empreinte, voir navFingerprint).
    var shaped = navFpMatch(el, kind, memory);
    if (!best && shaped) { best = 8; score = 8; why.push('empreinte'); }

    var url = navUrl(el);
    if (kind === 'goto') {
      // Mener AILLEURS que sur ce site n'est pas le travail de ce module.
      if (url && !url.sameSite) return null;
      if (url && url.samePage && !best) return null;
      if (best && url && /giveaway|claim|promo|freebie|free-games|deal/i.test(url.path)) { score += 6; why.push('chemin'); }
    }
    if (score <= 0) return null;

    if (navClosest(el, NAV_CHROME_SEL)) { score -= 4; why.push('entete/pied -4'); }
    if (navClosest(el, NAV_MAIN_SEL)) { score += 2; why.push('zone principale +2'); }
    var area = (el.offsetWidth || 0) * (el.offsetHeight || 0);
    if (area >= 20000) { score += 2; why.push('grand +2'); } else if (area >= 5000) { score += 1; why.push('visible +1'); }
    var cls = String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '');
    if (/primary|cta|claim|giveaway|green|main/i.test(cls)) { score += 1; why.push('classe +1'); }
    var box = el.parentElement;
    for (var d = 0; d < 5 && box; d++, box = box.parentElement) {
      var around = String(box.textContent || '');
      if (around.length < 700 && NAV_TIMER.test(around)) { score += 2; why.push('compte a rebours +2'); break; }
    }
    if (el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')) { score -= 10; why.push('inactif'); }

    if (shaped && why.indexOf('empreinte') === -1) { score += 3; why.push('empreinte +3'); }
    if (learned && why.indexOf('appris') === -1) { score += 4; why.push('appris +4'); }
    else if (known && known.ko > known.ok) { score -= 3; why.push('echec -3'); }
    return { score: score, why: why, text: text };
  }

  /* Les controles visibles : de toute la page, ou d'une zone (root) quand un
     module sait deja OU regarder -- la boite d'achat d'une fiche, par exemple. */
  function navCandidates(root) {
    var nodes;
    try {
      nodes = Array.prototype.slice.call((root || document).querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]'));
    } catch (e) { nodes = []; }
    return nodes.filter(navVisible);
  }

  /* Le meilleur controle pour un role, ou null sous le seuil. */
  function navBest(kind, memory, root) {
    var pool = navCandidates(root);
    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var s = navScore(pool[i], kind, memory);
      if (s && s.score > -50) { s.el = pool[i]; scored.push(s); }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored[0];
    if (!top || top.score < NAV_THRESHOLD) return null;
    top.runnerUp = scored[1] ? scored[1].text + ' (' + scored[1].score + ')' : null;
    return top;
  }

  /* Ce controle PREND-il un jeu, d'apres le sens de son libelle ? (2.101.0)
     Pour les modules qui ont deja trouve leur bouton par un attribut ou une
     liste de libelles (Epic, Luna) : quand le magasin change le mot, le sens
     decide -- sans jamais passer devant les interdits (argent, panier,
     abonnement), qui sont evalues dans navScore avant tout vocabulaire. */
  function navClaimsLabel(el, platform) {
    var s = navScore(el, 'claim', navMemoryRead(platform));
    return !!s && s.score >= NAV_THRESHOLD;
  }

  /* Ce libelle dit-il que le jeu est deja a vous ? Texte court seulement. */
  function navOwnedText(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60) return false;
    return navOwnedAnywhere(t);
  }

  /* Idem sur un bloc de texte plus long (la boite d'achat d'une fiche). */
  function navOwnedAnywhere(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < NAV_LEXICON.owned.length; i++) if (NAV_LEXICON.owned[i].test(t)) return true;
    return false;
  }

  /* La structure seule (2.100.0). Quand aucun libelle ne dit "prends", mais que la
     page est nettement celle d'un giveaway -- un chemin ou une zone "giveaway",
     un compte a rebours a cote -- et qu'il n'y a qu'UN gros controle permis dans
     la zone principale, c'est lui. Un seul, sinon on ne devine pas. S'il reussit,
     la memoire le retient et la structure n'est plus necessaire. */
  function navInferClaim() {
    var pool = navCandidates().filter(function (el) {
      var text = navText(el);
      if (!text || text.length > 60 || navVetoReason(text)) return false;
      if (navClosest(el, NAV_CHROME_SEL) || !navClosest(el, NAV_MAIN_SEL)) return false;
      if (el.disabled) return false;
      // 148 x 52 : le vrai bouton du bandeau GOG (mesure du 2026-10-02).
      if ((el.offsetWidth || 0) * (el.offsetHeight || 0) < 5000) return false;
      var url = navUrl(el);
      if (url && !url.samePage) return false;
      return true;
    });
    if (pool.length !== 1) return null;
    var el = pool[0];
    var giveawayContext = /giveaway|claim|promo/i.test(location.pathname) || !!navClosest(el, '[class*="giveaway" i], [id*="giveaway" i]');
    if (!giveawayContext) return null;
    var box = el.parentElement;
    for (var d = 0; d < 5 && box; d++, box = box.parentElement) {
      var around = String(box.textContent || '');
      if (around.length < 700 && NAV_TIMER.test(around)) {
        return { el: el, score: NAV_THRESHOLD, text: navText(el), why: ['structure seule : un seul gros controle, giveaway, compte a rebours'] };
      }
    }
    return null;
  }

  /* ----------------------------------------------------------------- etat */

  /* Le jeu est-il deja a vous, ICI ? Un libelle "dans la bibliotheque" ne vaut
     que sur un controle de la zone principale, court, qui n'est ni dans une
     liste, un carrousel ou une vignette, ni un lien vers un autre jeu : la page
     d'un magasin en porte des dizaines qui ne parlent pas de CE jeu. */
  function navOwnedEvidence() {
    var pool = navCandidates();
    for (var i = 0; i < pool.length; i++) {
      var el = pool[i];
      var text = navText(el);
      if (!text || text.length > 40) continue;
      var match = false;
      for (var k = 0; k < NAV_LEXICON.owned.length; k++) {
        if (NAV_LEXICON.owned[k].test(text)) { match = true; break; }
      }
      if (!match) continue;
      if (navClosest(el, NAV_CHROME_SEL) || navClosest(el, NAV_LIST_SEL)) continue;
      var url = navUrl(el);
      // Un lien vers la fiche d'UN AUTRE jeu ne parle pas de celui-ci.
      if (url && !url.samePage && /\/(game|games|product|p)\//i.test(url.path)) continue;
      return el;
    }
    return null;
  }

  function navDialogConfirm(memory) {
    var dialogs;
    try { dialogs = Array.prototype.slice.call(document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')); } catch (e) { dialogs = []; }
    for (var i = 0; i < dialogs.length; i++) {
      var dlg = dialogs[i];
      if (!navVisible(dlg)) continue;
      // Un bandeau de cookies ou de consentement n'est pas notre fenetre.
      if (/cookie|consent|privacy|confidentialit|datenschutz|privacidad/i.test(String(dlg.textContent || '').slice(0, 600))) continue;
      var buttons = Array.prototype.slice.call(dlg.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(navVisible);
      for (var j = 0; j < buttons.length; j++) {
        var t = navText(buttons[j]);
        if (NAV_LEXICON.confirm.test(t) && !navVetoReason(t)) return buttons[j];
      }
    }
    return null;
  }

  function navEnded() {
    var scope = document.querySelector('main') || document.body;
    var t = String((scope && scope.textContent) || '').slice(0, 4000);
    return NAV_LEXICON.ended.test(t);
  }

  /* L'etat de la page : { state, el?, score?, why?, detail? }. */
  function navClassify(memory) {
    if (isLikelyLoggedOut()) return { state: 'login' };
    var challenge = detectSecurityChallenge();
    if (challenge) return { state: 'captcha', detail: challenge.detail };
    var confirm = navDialogConfirm(memory);
    if (confirm) return { state: 'confirm', el: confirm, why: ['fenetre de confirmation'] };
    var claim = navBest('claim', memory);
    if (claim) return { state: 'claim', el: claim.el, score: claim.score, why: claim.why, text: claim.text, runnerUp: claim.runnerUp };
    var owned = navOwnedEvidence();
    if (owned) return { state: 'owned', el: owned };
    var go = navBest('goto', memory);
    if (go) return { state: 'goto', el: go.el, score: go.score, why: go.why, text: go.text, runnerUp: go.runnerUp };
    var inferred = navInferClaim();
    if (inferred) return { state: 'claim', el: inferred.el, score: inferred.score, why: inferred.why, text: inferred.text };
    if (navEnded()) return { state: 'ended' };
    return { state: 'unknown' };
  }

  /* Attend que la page dise ce qu'elle est (le rendu est cote client). */
  function navWaitState(memory, timeoutMs) {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        var st = navClassify(memory);
        if (st.state !== 'unknown' && st.state !== 'ended') { resolve(st); return; }
        if (Date.now() - t0 >= timeoutMs) { resolve(st); return; }
        setTimeout(poll, NAV_POLL_MS);
      }
      poll();
    });
  }

  /* --------------------------------------------------------------- reprise */

  function navOrderSave(order) {
    try { sessionStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
  }

  function navOrderPending() {
    try {
      var raw = sessionStorage.getItem(NAV_ORDER_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.deadline !== 'number' || Date.now() > o.deadline) return null;
      return o;
    } catch (e) { return null; }
  }

  function navOrderClear() {
    try { sessionStorage.removeItem(NAV_ORDER_KEY); } catch (e) {}
  }

  function navTitle() {
    var el = document.querySelector('.giveaway__title') || document.querySelector('h1');
    var t = el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    return (t || document.title || location.href).slice(0, 160);
  }

  /* ----------------------------------------------------------- orchestrateur */

  /* Mene une reclamation de page en page jusqu'a un verdict :
   *   { outcome, title?, trail[] }
   * outcome : claimed | owned | navigating | ended | login | captcha | refused
   *           | stuck | none | stopped. */
  function navRun(platform, options) {
    options = options || {};
    var memory = navMemoryRead(platform);
    var order = navOrderPending();
    if (order && order.platform !== platform) order = null;
    navOrderClear();
    var hops = order ? order.hops : 0;
    var trail = order && order.trail ? order.trail.slice() : [];
    var steps = 0;
    var clickedClaim = false;
    var clickedConfirm = {};
    var seen = {};

    // La page ou l'on est arrive dit si le lien suivi a valu la peine.
    var arrivedFrom = order && order.lastGoto ? order.lastGoto : null;
    var arrivedFp = order && order.lastGotoFp ? order.lastGotoFp : null;
    // Le titre du jeu, lu sur la page d'ou l'on vient : celle d'arrivee n'a souvent que le nom du site.
    var carriedTitle = order && order.title ? order.title : null;

    function done(outcome, extra) {
      navOrderClear();
      var r = { outcome: outcome, trail: trail };
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      return Promise.resolve(r);
    }

    function describe(st) {
      return '"' + (st.text || navText(st.el)) + '"' + (st.score !== undefined ? ' (score ' + st.score + ' : ' + (st.why || []).join(', ') + (st.runnerUp ? ' ; suivant ' + st.runnerUp : '') + ')' : '');
    }

    function step() {
      if (emergencyStopped()) return done('stopped');
      steps++;
      if (steps > NAV_MAX_STEPS) return done('stuck');
      return navWaitState(memory, options.stateTimeoutMs || 12000).then(function (st) {
        if (arrivedFrom && (st.state === 'claim' || st.state === 'owned')) {
          navLearn(platform, 'goto', { sig: navSignature({ textContent: arrivedFrom, getAttribute: function () { return null; } }), fp: arrivedFp }, true);
          arrivedFrom = null;
          arrivedFp = null;
        }
        if (st.state === 'login') return done('login');
        if (st.state === 'captcha') return done('captcha', { detail: st.detail });
        if (st.state === 'owned') {
          return done(clickedClaim ? 'claimed' : 'owned', { title: carriedTitle || navTitle() });
        }
        if (st.state === 'confirm') {
          var csig = navSignature(st.el);
          if (clickedConfirm[csig]) return done('stuck');
          clickedConfirm[csig] = true;
          log(platform, 'info', 'Navigation : fenetre de confirmation, clic sur "' + navText(st.el) + '".');
          trail.push(navText(st.el));
          if (!robustClick(st.el)) return done('refused', { text: navText(st.el) });
          return waitMs(900).then(step);
        }
        if (st.state === 'claim') return actClaim(st);
        if (st.state === 'goto') return actGoto(st);
        if (st.state === 'ended') return done('ended');
        return done('none', { labels: visibleActionLabels(8) });
      });
    }

    function waitMs(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function actClaim(st) {
      var desc = navDescribe(st.el);
      var sig = desc.sig;
      if (seen['claim:' + sig]) {
        // Le meme controle apres un clic : la page n'a pas change comme il faut.
        navLearn(platform, 'claim', desc, false);
        return done('stuck', { text: navText(st.el) });
      }
      seen['claim:' + sig] = true;
      var title = carriedTitle || navTitle();
      // Ou le bouton vivait : si lui disparait, c'est ce coin de page qui dira pourquoi.
      var container = navClosest(st.el, NAV_MAIN_SEL) || st.el.parentElement || null;
      log(platform, 'info', 'Navigation : bouton de recuperation ' + describe(st) + '.');
      trail.push(navText(st.el));
      if (!robustClick(st.el)) return done('refused', { text: navText(st.el) });
      clickedClaim = true;
      return waitMs(1200).then(function () {
        // Le clic a-t-il fait ce qu'il devait ? On relit la page : jeu a vous, fenetre a confirmer, ou autre chose.
        return navWaitState(memory, options.verifyTimeoutMs || 10000);
      }).then(function (after) {
        if (after.state === 'captcha') return done('captcha', { detail: after.detail });
        if (after.state === 'login') return done('login');
        if (after.state === 'owned') {
          navLearn(platform, 'claim', desc, true);
          return done('claimed', { title: title });
        }
        if (after.state === 'confirm' || after.state === 'claim') {
          // Une etape de plus (confirmation) ou le bouton est reste : step() tranche.
          return step();
        }
        // Le bouton lui-meme a pris le libelle "dans la bibliotheque", ou l'endroit ou
        // il vivait le dit maintenant. Un bouton qui DISPARAIT sans rien dire ne suffit
        // pas : une fenetre, un defi peuvent l'avoir recouvert. Dans le doute, ce n'est
        // pas un succes -- le prochain passage verra le jeu "a vous" et le dira.
        if (navOwnedLabel(st.el) || (container && document.body.contains(container) && navOwnedLabel(container))) {
          navLearn(platform, 'claim', desc, true);
          return done('claimed', { title: title });
        }
        navLearn(platform, 'claim', desc, false);
        return step();
      });
    }

    function navOwnedLabel(el) {
      var t = navVisibleText(el).replace(/\s+/g, ' ').trim().slice(0, 500);
      for (var i = 0; i < NAV_LEXICON.owned.length; i++) if (NAV_LEXICON.owned[i].test(t)) return true;
      return false;
    }

    function actGoto(st) {
      if (hops >= NAV_MAX_HOPS) return done('stuck', { text: st.text });
      var url = navUrl(st.el);
      var gotoDesc = navDescribe(st.el);
      var sig = gotoDesc.sig;
      if (seen['goto:' + sig]) return done('stuck', { text: st.text });
      seen['goto:' + sig] = true;
      log(platform, 'info', 'Navigation : lien vers l\'offre ' + describe(st) + (url ? ' -> ' + url.path : '') + '.');
      trail.push(navText(st.el));
      var fromPath = location.pathname + location.search;
      navOrderSave({
        platform: platform, hops: hops + 1, trail: trail.slice(), lastGoto: navText(st.el), lastGotoFp: gotoDesc.fp, title: carriedTitle || navTitle(),
        force: !!options.force, deadline: Date.now() + (options.budgetMs || 5 * 60 * 1000)
      });
      // Un lien vers une autre page se SUIT dans cet onglet (jamais dans un nouveau) ;
      // un bouton se clique, et la page peut changer sans se recharger.
      if (url && url.sameSite && !url.samePage) {
        // Dans la langue du reglage : GOG pointe souvent vers "/#giveaway", qui perd le prefixe de langue.
        try { location.assign(localizeStoreUrl(url.href, true)); } catch (e) { navOrderClear(); return done('refused', { text: st.text }); }
        return waitMs(15000).then(function () { navOrderClear(); return done('navigating'); });
      }
      if (!robustClick(st.el)) { navOrderClear(); return done('refused', { text: navText(st.el) }); }
      return waitMs(1500).then(function () {
        if (location.pathname + location.search !== fromPath) {
          // Navigation par le routeur de la page, sans rechargement : on continue ici.
          navOrderClear();
          hops++;
        } else {
          navOrderClear();
        }
        return step();
      });
    }

    return step();
  }
  /* Les libelles GOG, nommes (2.64.0) : l'essai a blanc les relit sans
     cliquer, et deux copies d'une meme liste finiraient par diverger. */
  var GOG_CLAIM_PATTERNS = [/^claim$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i, /add to library/i, /ajouter [a\u00e0] (la|ma|votre) biblioth[e\u00e8]que/i, /^get it free$/i];
  var GOG_OWNED_PATTERNS = [/in library/i, /dans (la|ma|votre) biblioth[e\u00e8]que/i, /owned/i, /d[e\u00e9]j[a\u00e0] poss[e\u00e9]d[e\u00e9]/i, /^voir dans la biblioth[e\u00e8]que$/i];

  function runGogModule() {
    var PLATFORM = 'GOG';
    log(PLATFORM, 'info', 'Demarrage du module GOG.');
    updateUiState('running', uiText('engGogChecking'));

    if (isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session GOG non detectee.');
      notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogLogin'));
      updateUiState('error', uiText('engGogNotLoggedIn'));
      return Promise.resolve();
    }

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- GOG', uiText('engNotifySecurityCheck'));
      updateUiState('error', uiText('engCaptcha'));
      return Promise.resolve();
    }

    /* Le navigateur adaptatif (2.100.0, voir 17-adaptive-nav.js) : la page dit ce
       qu'elle est -- fiche d'un jeu en giveaway ("Go to giveaway"), page du
       giveaway ("Ajouter a la bibliotheque"), jeu deja a vous, fenetre de
       confirmation -- et le moteur suit le route, de page en page, au lieu de
       chercher UN libelle exact sur la page ou il se trouve. */
    var force = navForceRecheck;
    navForceRecheck = false;
    return navRun(PLATFORM, { force: force }).then(function (r) {
      var route = r.trail && r.trail.length ? r.trail.join(' > ') : '';
      switch (r.outcome) {
        case 'claimed':
          saveHistoryEntry(PLATFORM, r.title, 'claimed', 'CLAIMED', r.title);
          log(PLATFORM, 'info', 'OK Recupere : ' + r.title + (route ? ' (' + route + ')' : ''));
          updateUiState('ok', uiText('engGogClaimed', r.title));
          return;
        case 'owned':
          saveHistoryEntry(PLATFORM, r.title, 'claimed', 'ALREADY_OWNED', r.title);
          log(PLATFORM, 'info', 'Deja dans la bibliotheque : ' + r.title);
          updateUiState('ok', uiText('engAlreadyClaimed'));
          return;
        case 'navigating':
          // La page va changer : la suivante reprend l'ordre (startPiloted).
          updateUiState('running', uiText('engGogChecking'));
          return;
        case 'ended':
          log(PLATFORM, 'info', 'L\'offre semble terminee (rien a recuperer).');
          updateUiState('ok', uiText('engGogNoGiveaway'));
          return;
        case 'login':
          log(PLATFORM, 'warn', 'Session GOG non detectee.');
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogLogin'));
          updateUiState('error', uiText('engGogNotLoggedIn'));
          return;
        case 'captcha':
          log(PLATFORM, 'warn', 'Defi de securite detecte (' + (r.detail || 'captcha') + ').');
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifySecurityCheck'));
          updateUiState('error', uiText('engCaptcha'));
          return;
        default:
          // Rien de net, ou un clic sans effet : le diagnostic nomme ce que la page montrait.
          log(PLATFORM, 'warn', 'Aucune etape de recuperation reconnue (' + r.outcome + '). Chemin : ' + (route || 'aucun')
            + '. Boutons visibles : ' + ((r.labels && r.labels.length) ? r.labels.join(' | ') : 'aucun'));
          updateUiState('error', uiText('engGogFailed', navTitle()));
      }
    }).catch(function (err) {
      log(PLATFORM, 'error', 'ECHEC GOG : ' + ((err && err.message) || err));
      updateUiState('error', uiText('engGogFailed', navTitle()));
    });
  }
  /* ======================================================================
   * APPRENDRE DE VOTRE GESTE (2.101.0), ET LE DEMANDER (2.102.0)
   *
   * Quand un magasin change sa page et que le moteur ne reconnait plus rien, le
   * plus simple est que VOUS recuperiez le jeu a la main, une fois. Ce module
   * regarde, sans rien envoyer nulle part : il retient le libelle ET la forme
   * des controles sur lesquels VOUS avez clique, et -- seulement si la page dit
   * ensuite que le jeu est a vous alors qu'il ne l'etait pas avant votre clic --
   * il les range dans la memoire du navigateur adaptatif (celle de ce magasin,
   * sur cet appareil) : le dernier clic comme "ce qui prend le jeu", celui
   * d'avant, s'il a change de page, comme "ce qui y mene".
   *
   * LE MODE "A APPRENDRE" (2.102.0). Quand le moteur, pilote par la veille, lit
   * la page et ne reconnait aucun bouton, il ne se contente plus d'echouer : il
   * le DIT (verdict needs_teaching), l'onglet est remonte dans votre fenetre, et
   * ce module passe en mode appris pendant dix minutes -- un seul clic suffit,
   * et la preuve (le jeu est a vous) a quatre minutes pour se montrer, parce
   * qu'une commande Epic ou un defi prennent du temps. Une fois appris, le
   * worker est prevenu (fgc-appris), referme l'onglet et reessaie.
   *
   * Ce que cela ne peut PAS faire :
   *   - un clic du moteur (evenement synthetique) n'est jamais une demonstration :
   *     seul un clic de confiance (event.isTrusted) compte ;
   *   - un libelle d'argent, de panier, d'abonnement, d'installation ou de
   *     connexion n'est jamais retenu (memes interdits que le navigateur), ni une
   *     simple confirmation, ni un clic fait sur une page de paiement ;
   *   - la memoire ne fait qu'AJOUTER du sens a un libelle ou a une forme : elle
   *     ne contourne ni les interdits, ni robustClick, ni -- chez Epic -- le
   *     module de paiement, dont les listes sont figees ;
   *   - le moteur ne demande qu'une fois toutes les six heures par magasin ;
   *   - rien ne quitte la page : sessionStorage pour les clics, la memoire
   *     locale du moteur pour ce qui a marche.
   * ====================================================================== */

  var DEMO_KEY = 'FGC_nav_demo';
  var TEACH_KEY = 'FGC_nav_teach';
  var TEACH_ASKED_KEY = 'FGC_teach_asked';
  var DEMO_WINDOW_MS = 90000;
  // Le jeu doit devenir "a vous" peu apres le DERNIER clic : une commande payee a la main, des
  // minutes et des pages plus tard, ne dit rien du bouton qui prend un jeu gratuit.
  var DEMO_EFFECT_MS = 45000;
  var TEACH_WINDOW_MS = 10 * 60000;
  var TEACH_EFFECT_MS = 4 * 60000;
  var TEACH_EVERY_MS = 6 * 3600000;
  var DEMO_MAX = 4;
  var DEMO_POLL_MS = 2500;
  var demoTimer = 0;

  function demoPlatform() {
    var name = platformNameForHost(location.hostname);
    return name === 'GOG' || name === 'Epic Games' || name === 'Amazon Luna' ? name : null;
  }

  /* La page dit-elle, MAINTENANT, que le jeu est a vous ? */
  function demoOwnedNow(platform) {
    try {
      if (platform === 'GOG') return !!navOwnedEvidence();
      if (platform === 'Epic Games') return !!epicOwnedHere();
      if (platform === 'Amazon Luna') {
        var box = document.querySelector('[data-a-target="buy-box"]');
        return !!box && lunaClaimedText(spacedText(box));
      }
    } catch (e) {}
    return false;
  }

  /* ---------------------------------------------------- le mode "a apprendre" */

  function teachState() {
    try {
      var s = JSON.parse(sessionStorage.getItem(TEACH_KEY) || 'null');
      if (!s || typeof s.until !== 'number' || Date.now() > s.until) return null;
      return s;
    } catch (e) { return null; }
  }

  function teachEnd() {
    try { sessionStorage.removeItem(TEACH_KEY); } catch (e) {}
  }

  /* A-t-on le droit de demander, pour ce magasin ? Une fois toutes les six heures. */
  function teachMayAsk(platform) {
    try {
      var all = JSON.parse(localStorage.getItem(TEACH_ASKED_KEY) || '{}');
      var last = all && typeof all[platform] === 'number' ? all[platform] : 0;
      return Date.now() - last >= TEACH_EVERY_MS;
    } catch (e) { return true; }
  }

  /* Demande a l'utilisateur de montrer le bouton : passe en mode appris. Rend
     false si on a deja demande il y a moins de six heures -- sauf "bypass"
     (l'appli, quand l'utilisateur est devant : il vient de toucher "Recuperer"). */
  function teachBegin(platform, bypass) {
    if (!bypass && !teachMayAsk(platform)) return false;
    try {
      var all = JSON.parse(localStorage.getItem(TEACH_ASKED_KEY) || '{}');
      all[platform] = Date.now();
      localStorage.setItem(TEACH_ASKED_KEY, JSON.stringify(all));
    } catch (e) {}
    try { sessionStorage.setItem(TEACH_KEY, JSON.stringify({ platform: platform, until: Date.now() + TEACH_WINDOW_MS })); } catch (e2) {}
    startDemoLearning();
    log(platform, 'info', 'Bouton non reconnu : en attente de votre clic (dix minutes), le moteur retiendra ce que vous cliquez.');
    return true;
  }

  function teachLearned(platform, label) {
    teachEnd();
    log(platform, 'info', 'Appris : "' + label + '". La recuperation va etre retentee.');
    notifyUser('Free Games Claimer -- ' + platform, uiText('engNotifyLearned', label, platform));
    sendToPilot({ type: 'fgc-appris', plateforme: platform, libelle: String(label).slice(0, 60) });
  }

  /* ---------------------------------------------------------- la demonstration */

  function demoRead() {
    try {
      var list = JSON.parse(sessionStorage.getItem(DEMO_KEY) || '[]');
      if (Object.prototype.toString.call(list) !== '[object Array]') return [];
      var now = Date.now();
      var window_ = teachState() ? TEACH_WINDOW_MS : DEMO_WINDOW_MS;
      return list.filter(function (e) { return e && typeof e.ts === 'number' && now - e.ts <= window_ && typeof e.sig === 'string'; });
    } catch (e) { return []; }
  }

  function demoWrite(list) {
    try {
      if (list.length) sessionStorage.setItem(DEMO_KEY, JSON.stringify(list.slice(-DEMO_MAX)));
      else sessionStorage.removeItem(DEMO_KEY);
    } catch (e) {}
  }

  /* Un clic de l'utilisateur sur un controle : on retient de quoi il s'agit. */
  function demoOnClick(ev) {
    if (!ev || ev.isTrusted !== true) return;
    var platform = demoPlatform();
    if (!platform) return;
    // Une page de paiement n'apprend rien : ce qu'on y clique n'est pas ce qui prend un jeu GRATUIT.
    if (/checkout|\/cart|panier|payment|paiement|\/order/i.test(location.pathname)) return;
    var target = ev.target;
    var el = target && typeof target.closest === 'function'
      ? target.closest('button, a[href], [role="button"], input[type="button"], input[type="submit"]')
      : null;
    if (!el) return;
    var text = navText(el);
    if (!text || text.length > 60 || navVetoReason(text)) return;
    // "Continuer", "Accepter", "OK" : des confirmations, deja connues du navigateur comme telles -- pas ce qui prend un jeu.
    if (NAV_LEXICON.confirm.test(text)) return;
    var desc = navDescribe(el);
    if (!desc.sig) return;
    var list = demoRead();
    list.push({ sig: desc.sig, fp: desc.fp, ts: Date.now(), path: location.pathname, ownedBefore: demoOwnedNow(platform) });
    demoWrite(list);
    demoArm();
  }

  /* Le jeu est-il maintenant a vous ? Alors ces clics ont pris le jeu. */
  function demoCheck() {
    var platform = demoPlatform();
    var list = demoRead();
    if (!platform || !list.length) { demoStop(); return; }
    if (!demoOwnedNow(platform)) return;
    var last = list[list.length - 1];
    if (Date.now() - last.ts > (teachState() ? TEACH_EFFECT_MS : DEMO_EFFECT_MS)) { demoWrite([]); demoStop(); return; }
    // Deja a vous avant le clic : rien n'a ete appris, et il ne faut pas le faire croire.
    if (last.ownedBefore) { demoWrite([]); demoStop(); return; }
    navLearn(platform, 'claim', { sig: last.sig, fp: last.fp || null }, true);
    var learned = '"' + last.sig + '"';
    var before = list.length > 1 ? list[list.length - 2] : null;
    if (before && before.path !== last.path && last.ts - before.ts <= 30000) {
      navLearn(platform, 'goto', { sig: before.sig, fp: before.fp || null }, true);
      learned = '"' + before.sig + '" puis ' + learned;
    }
    log(platform, 'info', 'Appris de votre geste : ' + learned + ' a pris ce jeu. Le moteur le reconnaitra la prochaine fois.');
    if (teachState()) teachLearned(platform, last.sig);
    demoWrite([]);
    demoStop();
  }

  function demoStop() {
    if (demoTimer) { clearInterval(demoTimer); demoTimer = 0; }
  }

  function demoArm() {
    if (demoTimer) return;
    demoTimer = setInterval(demoCheck, DEMO_POLL_MS);
  }

  var demoListening = false;

  function startDemoLearning() {
    if (!demoPlatform()) return;
    if (!demoListening) {
      try { document.addEventListener('click', demoOnClick, true); demoListening = true; } catch (e) {}
    }
    // Des clics en attente venus de la page precedente : on reprend la surveillance ici.
    if (demoRead().length) demoArm();
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
  /* Variantes NON ancrees : le textContent d'un bouton concatene tous ses
     descendants, et un span de lecteur d'ecran suffit a faire echouer un
     motif en ^...$. Meme lecon qu'Epic, trois fois payee. */
  var LUNA_CLAIM_LOOSE_PATTERNS = [/r[e\u00e9]cup[e\u00e9]rer/i, /\bobtenir\b/i, /\bclaim\b/i, /get (the )?game/i];

  /* CE QUE LE MODULE LUNA A LE DROIT DE CLIQUER.
   *
   * Le pendant de epicPaymentConfirmPatterns : une autorisation, pas une
   * recherche. Un bouton trouve par son attribut doit encore dire, par son
   * libelle, qu'il reclame quelque chose de gratuit. */
  /* LES LIBELLES APPRIS PAR L'UTILISATEUR.
   *
   * Quand un magasin refait sa page, le moteur ne reconnait plus son bouton et
   * il n'y a rien a faire jusqu'a la version suivante. Ces listes-ci sont
   * ecrites par l'interface, apres que l'utilisateur a designe le bon bouton
   * parmi ceux que le moteur a vus et refuses.
   *
   * Elles s'AJOUTENT aux motifs livres, elles ne les remplacent pas, et elles
   * ne passent jamais avant looksPaid : c'est l'ordre des lignes ci-dessous
   * qui le garantit, et il ne doit pas changer. Voir watch/teaching.js, qui
   * refuse deja d'ECRIRE un libelle parlant d'argent. Deux gardes qui disent
   * la meme chose sont deux gardes.
   *
   * Lecture synchrone, comme l'arret d'urgence : une lecture asynchrone
   * arriverait apres le clic qu'elle devait autoriser.
   */
  function taughtLabels(surface) {
    var all;
    try { all = JSON.parse(GM_getValue('FGC_taught_labels', '{}')); } catch (e) { all = null; }
    if (!all || typeof all !== 'object') return [];
    var list = all[surface];
    return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
  }

  /* Le texte du bouton contient-il un libelle appris ?
     Une inclusion, pas une egalite : le textContent d'un bouton concatene tous
     ses descendants, et un span de lecteur d'ecran suffirait a faire echouer
     une comparaison exacte. Meme lecon que les motifs non ancres au-dessus. */
  function matchesTaught(text, surface) {
    var list = taughtLabels(surface);
    var flat = String(text || '').replace(/\s+/g, ' ').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === 'string' && list[i] && flat.indexOf(list[i]) !== -1) return true;
    }
    return false;
  }

  /* LA TRACE : ce que le moteur a vu et refuse.
   *
   * Un libelle refuse est aujourd'hui une ligne de journal, donc quelque
   * chose qu'on lit apres coup et qu'on ne peut pas utiliser. Retenu ici, il
   * devient la liste que l'interface propose : "voici les boutons que j'ai
   * vus, lequel fallait-il cliquer ?"
   *
   * C'est ce qui transforme l'apprentissage en un clic au lieu d'une saisie :
   * personne ne recopie a la main le libelle exact d'un bouton.
   *
   * Borne a huit par surface, les plus recents d'abord. Une liste qui grossit
   * indefiniment finirait par contenir tous les boutons de tous les magasins,
   * et ne designerait plus rien.
   */
  function noteSeenLabel(surface, text) {
    var propre = String(text || '').replace(/\s+/g, ' ').trim();
    if (!propre || propre.length > 80) return;

    var all;
    try { all = JSON.parse(GM_getValue('FGC_seen_labels', '{}')); } catch (e) { all = null; }
    if (!all || typeof all !== 'object') all = {};

    var list = Object.prototype.toString.call(all[surface]) === '[object Array]' ? all[surface] : [];
    /* Le nom evite "reste", que la table de renommage historique transforme en
       "leftChip" : un nom present dans cette table casse le controle
       verify:rename, qui compare src/core a la base d'origine une fois la
       table appliquee. */
    var autresVus = [];
    for (var i = 0; i < list.length; i++) if (list[i] !== propre) autresVus.push(list[i]);

    all[surface] = [propre].concat(autresVus).slice(0, 8);
    GM_setValue('FGC_seen_labels', JSON.stringify(all));
  }

  function lunaClaimLabelAllowed(el) {
    if (!el) return false;
    var text = actionText(el);
    if (!text) return false;
    if (looksPaid(text)) return false;
    // Les interdits du navigateur adaptatif valent aussi pour les libelles livres : "Obtenir Luna+
    // gratuitement" contient "obtenir", et ne prend aucun jeu (abonnement, essai, paiement).
    if (navVetoReason(text)) return false;
    var ok = LUNA_CLAIM_PATTERNS.some(function (p) { return p.test(text); })
          || LUNA_CLAIM_LOOSE_PATTERNS.some(function (p) { return p.test(text); })
          || matchesTaught(text, 'luna')
          // Le SENS, quand Amazon change le mot (2.101.0) : meme vocabulaire a poids
          // et memes interdits que le navigateur adaptatif. looksPaid est passe plus haut.
          || navClaimsLabel(el, 'Amazon Luna');
    return ok;
  }

  var LUNA_COMPLETE_PATTERNS = [/^complete claim$/i, /^terminer( la r[e\u00e9]clamation)?$/i, /^finaliser/i, /^continuer$/i, /^continue$/i, /^confirm(er)?$/i];
  var LUNA_LINK_ACCOUNT_PATTERNS = [/associer (un|votre|mon|le) compte/i, /link (game |your |a )?account/i, /lier (un|votre|mon|le) compte/i];
  var LUNA_CLAIMED_TEXT = /\bclaimed\b|\bcollected\b|r[e\u00e9]cup[e\u00e9]r[e\u00e9]e?(?![a-z\u00e0-\u00ff])|successfully|\bsuccess\b|succ[e\u00e8]s(?![a-z\u00e0-\u00ff])|in your library|dans votre biblioth[e\u00e8]que|ajout[e\u00e9]e? [a\u00e0] votre|d[e\u00e9]j[a\u00e0] (r[e\u00e9]cup[e\u00e9]r[e\u00e9]|obtenu|r[e\u00e9]clam[e\u00e9])/i;

  /* "Deja a vous" : les mots livres, puis le sens (navigateur adaptatif) pour les
     langues et les tournures qu'ils ne connaissent pas. */
  function lunaClaimedText(text) {
    return LUNA_CLAIMED_TEXT.test(text) || navOwnedAnywhere(text);
  }

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

  function recordLunaFailure(offerId, reason, title) {
    var history = getHistory('Amazon Luna');
    var previous = history[lunaHistoryKey(offerId)];
    var attempts = (previous && previous.status === 'failed' ? (previous.attempts || 0) : 0) + 1;
    var entry = { status: 'failed', reason: reason || '', ts: Date.now(), attempts: attempts };
    var name = historyTitle(title) || (previous && previous.title) || null;
    if (name) entry.title = name;
    history[lunaHistoryKey(offerId)] = entry;
    GM_setValue('FGC_history_Amazon Luna', JSON.stringify(history));
    return attempts;
  }

  // Identite d'une carte sans lien de fiche : son TITRE, pas son texte. Le
  // texte porte aussi le libelle du bouton, qui change une fois le jeu pris
  // ("Recuperer le jeu" puis "Recupere") : la meme offre changeait de cle, et
  // "card:Wall World 2 Recuperer le jeu" finissait affiche a la place du nom.
  function lunaCardKey(title, text) {
    var base = String(title || text || '').slice(0, 80).toLowerCase();
    try { base = base.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    base = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return 'card:' + (base || 'sans-titre');
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
    return scopes.some(function (s) { return lunaClaimedText(spacedText(s)); });
  }

  // Observe la page apres le clic sur "Obtenir le jeu" jusqu'a un resultat
  // identifiable : code affiche, succes, liaison de compte requise, etape
  // intermediaire "Complete Claim" (cliquee une fois), reconnexion, captcha.
  // Magasins ou un "succes" n'a de valeur qu'accompagne d'un code a echanger.
  var LUNA_CODE_STORES = { gog: true, microsoft: true, legacy: true, unknown: true };

  function watchLunaClaimOutcome(buyBox, timeout, store, linkBefore) {
    var started = Date.now();
    var completeClicked = false;
    var completeBlocked = false;
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

          if (!completeClicked && !completeBlocked) {
            var root = lunaModalRoot() || buyBox || document;
            var completeBtn = findActionElement(root, LUNA_COMPLETE_PATTERNS, { mustBeEnabled: true });
            if (completeBtn) {
              log('Amazon Luna', 'info', 'Etape intermediaire "' + actionText(completeBtn) + '" detectee, clic.');
              /* Le drapeau ne se pose QUE si le clic a eu lieu : un clic
                 refuse ne doit pas faire croire que l'etape a ete franchie.
                 Et on ne reessaie pas a chaque battement -- l'anti-rafale
                 refuserait sans rien apporter, en remplissant le journal. */
              if (robustClick(completeBtn)) {
                completeClicked = true;
                setTimeout(tick, 1200);
                return;
              }
              completeBlocked = true;
              log('Amazon Luna', 'warn', 'Etape intermediaire non cliquee (clic refuse) : l\'observation continue sans elle.');
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
      var title = cardTitle(card);
      var key = id || lunaCardKey(title, text);
      if (seen[key]) return;
      seen[key] = true;
      offers.push({
        id: key,
        url: href ? href.split('?')[0] : null,
        title: title || text.slice(0, 60),
        // Le titre lu dans la carte, et lui seul, entre dans l'historique : le
        // repli sur le texte embarque le libelle du bouton.
        knownTitle: title,
        store: href ? detectLunaStore(href, '') : 'amazon',
        button: button,
        card: card,
        hasCta: hasCta,
        collected: !hasCta && lunaClaimedText(text)
      });
    });
    return offers;
  }

  function finishLunaBatch(PLATFORM) {
    var batch = getLunaBatch();
    var summary = 'Luna : ' + batch.claimed + ' reclame(s), ' + batch.codes + ' code(s), ' + batch.skipped + ' ignore(s), ' + batch.failed + ' echec(s)';
    var summaryText = uiText('engLunaSummary', batch.claimed, batch.codes, batch.skipped, batch.failed);
    updateUiState(batch.failed > 0 && batch.claimed + batch.codes === 0 ? 'error' : 'ok', summaryText);
    log(PLATFORM, 'info', 'Serie Luna terminee. ' + summary + '.');
    if (batch.total > 0) notifyUser('Free Games Claimer -- Amazon Luna', summaryText);
    setAutoCooldown('luna', batch.failed > 0 ? CONFIG.autoFailureCooldownMs : CONFIG.autoIdleCooldownMs);

    var gogCodes = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (gogCodes.length && !batch.gogHandoffDone) {
      batch.gogHandoffDone = true;
      saveLunaBatch(batch);
      log(PLATFORM, 'info', gogCodes.length + ' code(s) GOG en attente : ouverture de ' + CONFIG.gogRedeemUrl + ' pour l\'echange automatique.');
      notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogCodesOpen', gogCodes.length));
      openInTab(gogRedeemUrl(), true);
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
      updateUiState('running', uiText('engLunaRemaining', queue.length));
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
      saveHistoryEntry(PLATFORM, key, 'claimed', label, title);
      bumpLunaBatch('claimed');
      log(PLATFORM, 'info', 'OK Reclame : "' + title + '" (' + label + ').');
      updateUiState('ok', uiText('engLunaClaimed', title));
      return;
    }

    if (outcome.type === 'code') {
      var code = outcome.code;
      var deadline = findLunaCodeDeadline();
      var copied = copyToClipboard(code);
      bumpLunaBatch('codes');
      if (store === 'gog') {
        addPendingRedeemCode({ store: 'gog', code: code, title: title, offerId: offerId, ts: Date.now(), attempts: 0, deadline: deadline });
        // Le FAIT, pas le secret : le code vit dans FGC_pending_codes, qui
        // sait le retirer une fois echange. L'historique, lui, n'est jamais
        // purge et part dans l'export -- un porteur y dormait pour toujours,
        // en double, sans que rien ne le relise.
        saveHistoryEntry(PLATFORM, key, 'code_pending_gog', 'code en attente d\'echange', title);
        log(PLATFORM, 'info', 'Code GOG pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers)' : '') + '. Echange automatique sur gog.com/redeem a la fin de la serie.');
        updateUiState('ok', uiText('engLunaGogCode', title));
        return;
      }
      addPendingRedeemCode({ store: store, code: code, title: title, offerId: offerId, ts: Date.now(), attempts: CONFIG.gogRedeemMaxAttempts, deadline: deadline });
      saveHistoryEntry(PLATFORM, key, 'code_copied', label + (deadline ? ' (avant le ' + deadline + ')' : ''), title);
      var redeemUrl = redeemUrlFor(store);
      var msg = 'Code ' + label + ' pour "' + title + '" : ' + code + (copied ? ' (copie dans le presse-papiers).' : '.') + (deadline ? ' A utiliser avant le ' + deadline + '.' : '') + (redeemUrl ? ' Collez-le sur ' + redeemUrl : ' Collez-le sur le site de ' + label + '.');
      log(PLATFORM, 'info', msg);
      updateUiState('ok', uiText('engLunaCodeCopied', label, title));
      /* La notification en morceaux : chacun se traduit. Plus de "cliquez
         pour ouvrir" -- dans l'extension, un clic sur la notification n'a
         jamais rien ouvert. */
      var notice = [uiText('engNotifyLunaCode', label, title, code)];
      if (copied) notice.push(uiText('engNotifyCopied'));
      if (deadline) notice.push(uiText('engNotifyDeadline', deadline));
      notice.push(redeemUrl ? uiText('engNotifyPasteAt', redeemUrl) : uiText('engNotifyPasteOnSite', label));
      notifyUser('Free Games Claimer -- Amazon Luna', notice, 20000);
      return;
    }

    if (outcome.type === 'needs_link') {
      saveHistoryEntry(PLATFORM, key, 'needs_link', label, title);
      bumpLunaBatch('skipped');
      log(PLATFORM, 'warn', '"' + title + '" : liaison du compte ' + label + ' requise (parametres Luna > Associer un compte). Offre passee.');
      notifyUser('Free Games Claimer -- Amazon Luna', uiText('engNotifyLunaLink', title, label));
      updateUiState('error', uiText('engLunaLinkNeeded', label, title));
      return;
    }

    var attempts = recordLunaFailure(offerId, 'Aucun resultat identifiable apres le clic (' + outcome.type + ')', title);
    bumpLunaBatch('failed');
    log(PLATFORM, 'error', 'ECHEC pour "' + title + '" (' + label + ') : aucun resultat identifiable apres le clic (essai ' + attempts + '/' + CONFIG.lunaMaxAttemptsPerOffer + ').');
    updateUiState('error', uiText('engLunaFailed', title));
  }

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
        notifyUser('Free Games Claimer -- Amazon Luna', uiText('engNotifyAmazonRelogin'));
        updateUiState('error', uiText('engLunaRelogin'));
        return;
      }
      throw err;
    });
  }

  function runAmazonLunaModuleInner() {
    var PLATFORM = 'Amazon Luna';
    log(PLATFORM, 'info', 'Demarrage du module Amazon Luna.');
    updateUiState('running', uiText('engLunaChecking'));

    if (location.hostname.indexOf('gaming.amazon.com') !== -1) {
      log(PLATFORM, 'warn', 'gaming.amazon.com est l\'ancien domaine Prime Gaming, retire depuis le passage a Amazon Luna.');
      notifyUser('Free Games Claimer -- Amazon Luna', uiText('engNotifyLunaOldDomain', CONFIG.lunaClaimsPath));
      updateUiState('error', uiText('engLunaOldDomain'));
      return Promise.resolve();
    }

    if (document.querySelector('[data-a-target="sign-in-button"]') || isLikelyLoggedOut()) {
      log(PLATFORM, 'warn', 'Session Amazon/Luna non detectee (bouton "Se connecter" visible).');
      notifyUser('Free Games Claimer -- Amazon Luna', uiText('engNotifyAmazonLogin'));
      updateUiState('error', uiText('engAmazonNotLoggedIn'));
      return Promise.resolve();
    }

    if (isLunaReauthVisible()) return Promise.reject(new Error('MANUAL_LOGIN_REQUIRED'));
    rememberLunaHost();

    var challenge = detectSecurityChallenge();
    if (challenge) {
      log(PLATFORM, 'warn', 'Defi de securite detecte (' + challenge.type + ').', challenge.detail);
      notifyUser('Free Games Claimer -- Amazon Luna', uiText('engNotifyAmazonCaptcha'));
      updateUiState('error', uiText('engCaptcha'));
      return Promise.resolve();
    }

    if (isLunaOfferDetailPage(location.pathname)) return runLunaDetailPage(PLATFORM);
    if (isLunaClaimsListPage(location.pathname)) return runLunaListPage(PLATFORM);

    log(PLATFORM, 'info', 'Page actuelle (' + location.pathname + ') hors du parcours de reclamation. Rendez-vous sur ' + CONFIG.lunaClaimsPath + '.');
    updateUiState('ok', uiText('engGoTo', CONFIG.lunaClaimsPath));
    return Promise.resolve();
  }

  function scheduleLunaAutoWatcher() {
    if (location.hostname.indexOf('luna.amazon.') === -1) return;
    // Une session ouverte sur CE domaine : c'est lui que la localisation des adresses doit garder.
    setTimeout(function () {
      if (!document.querySelector('[data-a-target="sign-in-button"]') && !isLikelyLoggedOut() && !isLunaReauthVisible()) rememberLunaHost();
    }, 5000);
    var queue = getLunaQueue();
    var finishPending = false;
    try { finishPending = sessionStorage.getItem('FGC_luna_finish_pending') === '1'; } catch (e) {}
    if (!queue.length && !finishPending && getLunaAutoModeEnabled() && autoRunBlocked('Amazon Luna', 'luna')) return;
    if (queue.length || finishPending || getLunaAutoModeEnabled()) {
      if (!queue.length && !finishPending) setAutoCooldown('luna', CONFIG.autoCooldownMs);
      log('Amazon Luna', 'info', queue.length ? 'File Luna en cours (' + queue.length + ' fiche(s)) : reprise automatique.' : 'Mode auto Luna actif : verification des offres.');
      setTimeout(function () {
        updateUiState('running', uiText('engLunaAutoChecking'));
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

  /* CE QUE L'ECHANGE GOG A LE DROIT DE CLIQUER.
   *
   * Le pendant de lunaClaimLabelAllowed : [type="submit"] designe un
   * EMPLACEMENT dans un formulaire, pas une action. C'est le libelle qui dit
   * ce que le bouton fait, et lui seul qui autorise le clic.
   *
   * Un bouton muet (icone seule, aucun texte) reste accepte : il a ete
   * designe par le formulaire de #codeInput, et il n'annonce rien de payant.
   * On refuse ce qui est ECRIT et suspect, pas ce qui se tait. */
  var GOG_SUBMIT_PATTERNS = [/^continuer$/i, /^continue$/i, /^valider$/i, /^validate$/i, /^suivant$/i, /^next$/i, /^envoyer$/i, /^submit$/i, /^ok$/i, /^activer$/i, /^activate$/i];

  function gogSubmitLabelAllowed(el) {
    if (!el) return false;
    var text = actionText(el) || String(el.value || '').replace(/\s+/g, ' ').trim();
    if (looksPaid(text)) return false;
    if (!text) return true;
    return GOG_SUBMIT_PATTERNS.some(function (p) { return p.test(text); })
      || GOG_REDEEM_CONFIRM_PATTERNS.some(function (p) { return p.test(text); })
      // Apres looksPaid, jamais avant. Voir taughtLabels dans 18-luna-patterns.
      || matchesTaught(text, 'gog');
  }

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
        updateUiState('error', uiText('engGogManualCodes', exhausted.length));
      } else {
        log(PLATFORM, 'info', 'Aucun code GOG en attente d\'echange.');
        updateUiState('ok', uiText('engGogNoPendingCode'));
      }
      return Promise.resolve();
    }

    var entry = pending[0];
    log(PLATFORM, 'info', 'Echange du code GOG pour "' + entry.title + '" (' + pending.length + ' en attente, essai ' + ((entry.attempts || 0) + 1) + '/' + CONFIG.gogRedeemMaxAttempts + ').');
    updateUiState('running', uiText('engGogRedeeming', entry.title));

    var form = null;
    var submit = null;

    return waitForElement('#codeInput', { timeout: 15000 }).catch(function () {
      throw new Error('Champ #codeInput introuvable sur ' + location.href + ' (page changee ou connexion requise).');
    }).then(function (input) {
      if (isLikelyLoggedOut()) {
        log(PLATFORM, 'warn', 'Session GOG non detectee : connectez-vous sur GOG puis revenez sur ' + CONFIG.gogRedeemUrl + '.');
        notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogReopen', pending.length));
        updateUiState('error', uiText('engGogLoginNeeded'));
        return Promise.reject('STOP');
      }
      form = input.closest('form') || document;
      submit = form.querySelector('[type="submit"]') || findActionElement(form, [/^continuer$/i, /^continue$/i, /^valider$/i, /^suivant$/i, /^next$/i], { mustBeEnabled: false });
      if (!submit) throw new Error('Bouton "Continuer" introuvable a cote de #codeInput.');
      setInputValue(input, entry.code);
      updatePendingRedeemCode(entry.code, { attempts: (entry.attempts || 0) + 1, lastTry: Date.now() });
      return sleep(600);
    }).then(function () {
      var submitLabel = (actionText(submit) || String(submit.value || '').trim() || 'Continuer');
      /* Un refus AVANT le clic ne brule pas d'essai : le code n'a pas ete
         soumis. L'essai compte plus haut est donc rendu. */
      function giveAttemptBack(detail, uiMsg) {
        updatePendingRedeemCode(entry.code, { attempts: entry.attempts || 0 });
        log(PLATFORM, 'error', detail);
        updateUiState('error', uiMsg);
        return Promise.reject('STOP');
      }
      if (!gogSubmitLabelAllowed(submit)) {
        return giveAttemptBack('Bouton d\'envoi non reconnu sur ' + location.href + ' : "' + submitLabel
          + '". Rien n\'est clique, le code reste en attente.', uiText('engGogSubmitUnknown'));
      }
      log(PLATFORM, 'info', 'Code saisi, clic sur "' + submitLabel + '".');
      if (!robustClick(submit)) {
        return giveAttemptBack('Clic refuse sur le bouton d\'envoi GOG (arret d\'urgence, libelle payant ou reclic).',
          uiText('engGogClickRefused'));
      }
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, false);
    }).then(function (outcome) {
      if (outcome.type !== 'confirm') return outcome;
      var confirmLabel = actionText(outcome.button) || 'confirmation';
      if (!gogSubmitLabelAllowed(outcome.button)) {
        log(PLATFORM, 'error', 'Bouton de confirmation GOG non reconnu : "' + confirmLabel + '". Rien n\'est clique.');
        return { type: 'timeout', detail: 'confirmation non reconnue : ' + confirmLabel };
      }
      log(PLATFORM, 'info', 'Jeu reconnu par GOG, clic sur "' + confirmLabel + '" pour l\'ajouter a la bibliotheque.');
      /* allowRepeat : GOG peut RELABELLISER le bouton d'envoi au lieu d'en
         monter un second -- le repli de watchGogRedeemOutcome, qui ecarte
         explicitement originalSubmit, dit que le cas a deja ete rencontre. La
         confirmation arrive environ 1,5 s apres l'envoi, donc sous les 4 s de
         repos de l'anti-rafale : sans cette exception nommee, le clic serait
         refuse, l'echange finirait en timeout et UN CODE SERAIT BRULE pour
         rien. L'arret d'urgence et le refus des libelles payants, eux,
         s'appliquent toujours. */
      if (!robustClick(outcome.button, { allowRepeat: true })) {
        log(PLATFORM, 'error', 'Clic de confirmation refuse (arret d\'urgence ou libelle payant).');
        return { type: 'timeout', detail: 'clic de confirmation refuse' };
      }
      return watchGogRedeemOutcome(form, submit, CONFIG.gogRedeemOutcomeTimeout, true);
    }).then(function (outcome) {
      var remaining;
      if (outcome.type === 'success') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'OK "' + entry.title + '" ajoute a votre bibliotheque GOG. ' + remaining.length + ' code(s) restant(s).');
        notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogAdded', entry.title));
        updateUiState('ok', uiText('engGogAdded', entry.title));
      } else if (outcome.type === 'used') {
        removePendingRedeemCode(entry.code);
        saveHistoryEntry(PLATFORM, 'code:' + entry.code, 'already_redeemed', entry.title);
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
        log(PLATFORM, 'info', 'Le code de "' + entry.title + '" avait deja ete utilise (' + outcome.detail + '). Retire de la file.');
        updateUiState('ok', uiText('engGogCodeUsed', entry.title));
      } else if (outcome.type === 'captcha') {
        // Un captcha n'est pas un echec du code : on ne compte pas l'essai.
        updatePendingRedeemCode(entry.code, { attempts: entry.attempts || 0 });
        log(PLATFORM, 'warn', 'Captcha GOG visible : validez-le manuellement puis relancez via le menu Tampermonkey ("Echanger les codes GOG en attente").');
        notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogCaptcha'));
        updateUiState('error', uiText('engGogCaptcha'));
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
          notifyUser('Free Games Claimer -- GOG', uiText('engNotifyGogManual', entry.title, entry.code), 20000);
          copyToClipboard(entry.code);
        }
        updateUiState('error', uiText('engGogUnconfirmed', entry.title));
        remaining = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts && c.code !== entry.code; });
        if (outcome.type === 'timeout') return;
      }
      if (remaining && remaining.length) {
        log(PLATFORM, 'info', 'Rechargement de ' + CONFIG.gogRedeemUrl + ' pour le code suivant.');
        setTimeout(function () { location.assign(gogRedeemUrl()); }, 2500);
      }
    }).catch(function (err) {
      if (err === 'STOP') return;
      log(PLATFORM, 'error', 'Erreur pendant l\'echange du code GOG : ' + (err && err.message));
      updateUiState('error', uiText('engGogError', err && err.message));
    });
  }

  function scheduleGogRedeemWatcher() {
    if (location.hostname.indexOf('gog.com') === -1 || !isGogRedeemPage(location.pathname)) return;
    var pending = getPendingRedeemCodes('gog').filter(function (c) { return (c.attempts || 0) < CONFIG.gogRedeemMaxAttempts; });
    if (!pending.length) return;
    log('GOG', 'info', pending.length + ' code(s) GOG en attente : echange automatique dans 2s.');
    setTimeout(function () {
      updateUiState('running', uiText('engGogAutoRedeem'));
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
        updateUiState('error', uiText('engUnsupportedDomain'));
        return;
      }
      // Rendue pour le mode pilote, qui doit savoir quand le module a fini.
      return Promise.resolve(result).catch(function (err) {
        // 'STOP' est un arret volontaire deja journalise par le module.
        if (err === 'STOP') return;
        log('CORE', 'error', 'Erreur non interceptee dans un module.', err);
        updateUiState('error', uiText('engError', err && err.message));
      });
    } catch (err) {
      log('CORE', 'error', 'Erreur non interceptee dans le dispatcher principal.', err);
      updateUiState('error', uiText('engError', err.message));
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
      epicForceRecheck = true;
      navForceRecheck = true;
      dispatch();
    });
    GM_registerMenuCommand('Relancer maintenant (ignorer le delai)', function () {
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      notifyUser('Free Games Claimer', 'Delai de repos remis a zero : la prochaine verification repart immediatement.');
      epicForceRecheck = true;
      navForceRecheck = true;
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
        else location.assign(gogRedeemUrl());
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

  var PILOT_SETTLE_MS = 3000;
  var PILOT_DONE_STATUSES = { claimed: true, redeemed: true, code_copied: true, code_pending_gog: true, skipped: true };

  // L'entree d'historique de la fiche ouverte, quand elle est deja traitee.
  //
  // Le verdict pilote est une entree NOUVELLE. Un jeu que le moteur sait deja
  // pris n'en produit aucune -- il n'y a rien a faire -- et l'orchestrateur
  // attendait alors tout son budget pour conclure "failed, delai depasse" :
  // un echec affiche pour un jeu qui est bel et bien au compte.
  function standingEntry(platform, href) {
    var key = null;
    if (platform === 'Epic Games') {
      var slug = extractEpicSlug(href);
      key = slug ? epicHistoryKeyForSlug(slug) : null;
    } else if (platform === 'Amazon Luna') {
      var offerId = extractLunaOfferId(href);
      key = offerId ? lunaHistoryKey(offerId) : null;
    }
    if (!key) return null;
    var e = getHistory(platform)[key];
    if (!e || !PILOT_DONE_STATUSES[e.status]) return null;
    return {
      key: key,
      statusLine: e.status,
      reasonText: e.status === 'claimed' ? 'ALREADY_CLAIMED' : (e.reason || null)
    };
  }

  // Le module a-t-il fini pour de bon ? Rendu depuis PILOT_SETTLE_MS, et
  // aucune execution Epic ou Luna encore en cours : un module deja lance rend
  // tout de resumedOrder une promesse resolue pendant que l'autre travaille encore,
  // et conclure a ce moment-la annoncerait un echec avant la reclamation.
  function pilotSettled(moduleDoneAt, now) {
    return !!moduleDoneAt && now - moduleDoneAt >= PILOT_SETTLE_MS && !epicModuleRunSince && !lunaModuleRunSince;
  }

  // Le motif d'un module fini sans rien noter. Volontairement pas dans les
  // motifs "de notre fait" du canari (watch/canary.js) : un bouton introuvable
  // finit exactement ainsi, et c'est le magasin qui a bouge.
  var PILOT_EMPTY_REASON = 'le module a termine sans rien noter';

  /* UN ECHEC QUE L'UTILISATEUR PEUT REPARER (2.102.0).
   *
   * Le moteur a lu la page, la session est bonne, aucun defi -- et pourtant il ne
   * reconnait aucun bouton (ou rien que le moteur sache cliquer). C'est le cas
   * ou le magasin a change sa page : plutot qu'un echec silencieux, on le dit
   * (needs_teaching), l'onglet remonte, et UN clic de l'utilisateur apprend au
   * moteur le bon bouton (17-nav-demo.js). Une fois toutes les six heures par
   * magasin au plus. */
  var TEACHABLE_REASON = /introuvable|inattendu|non reconnu|aucune etape|bouton/i;

  /* "mode" : false = ne jamais demander (personne devant l'ecran : la recuperation
     de fond de l'appli) ; 'now' = demander sans attendre les six heures
     (l'utilisateur est la) ; autre chose = la regle habituelle. */
  function teachRequest(platform, reasonText, mode) {
    if (mode === false) return null;
    if (!demoPlatform() || isEpicNotFoundPage(location.pathname)) return null;
    var labels = visibleActionLabels(8);
    if (!labels.length) return null;
    if (!teachBegin(platform, mode === 'now')) return null;
    return {
      type: 'fgc-verdict',
      verdict: 'needs_teaching',
      reasonText: (reasonText || PILOT_EMPTY_REASON) + ' | boutons : ' + labels.join(' / ').slice(0, 160),
      plateforme: platform
    };
  }

  function runClaimOrder(budgetMs, force, teachMode) {
    var platform = platformNameForHost(location.hostname);
    if (force) navForceRecheck = true;
    /* Une recuperation FORCEE (le geste de l'utilisateur) ne se fie pas a la
       memoire du moteur (2.99.7) : voir epicForceRecheck. */
    if (force && platform === 'Epic Games') {
      epicForceRecheck = true;
      var slugForce = extractEpicSlug(location.href);
      if (slugForce) removeHistoryEntry(platform, epicHistoryKeyForSlug(slugForce));
    }
    var before = historyFingerprint(platform);
    var debut = Date.now();
    var moduleDoneAt = 0;

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

    var markDone = function () { moduleDoneAt = Date.now(); };
    Promise.resolve(dispatch()).then(markDone, markDone);

    var timer = setInterval(function () {
      // Une entree nouvelle d'abord ; a defaut, et seulement une fois le
      // module termine, l'entree deja la. Le delai laisse passer une ecriture
      // tardive, qui dirait mieux ce qui vient de se passer.
      var settled = pilotSettled(moduleDoneAt, Date.now());
      var found = freshEntry(platform, before);
      /* Un defi a l'ecran passe AVANT une entree d'historique deja la (2.99.7) :
         "deja recupere" dit sur une page qui demande un humain, c'est exactement
         ce qui cachait le captcha. Une entree NOUVELLE, elle, est un fait. */
      if (!found && settled && !detectSecurityChallenge()) found = standingEntry(platform, location.href);
      if (found) {
        clearInterval(timer);
        // Un echec de bouton que l'utilisateur peut reparer d'un clic : on le demande.
        var ask = found.statusLine === 'failed' && TEACHABLE_REASON.test(String(found.reasonText || ''))
          ? teachRequest(platform, found.reasonText, teachMode) : null;
        sendToPilot(ask || {
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
      // Fini, rien de nouveau, rien de deja traite, pas de defi : c'est un
      // echec, et l'attendre jusqu'au bout du budget -- cinq minutes -- ne
      // changerait que le moment ou on le dit. Meme verdict qu'a l'expiration,
      // pour que le recul et le canari le lisent comme avant.
      if (settled) {
        clearInterval(timer);
        sendToPilot(teachRequest(platform, PILOT_EMPTY_REASON, teachMode)
          || { type: 'fgc-verdict', verdict: 'failed', reasonText: PILOT_EMPTY_REASON, plateforme: platform });
        return;
      }
      if (Date.now() - debut > budgetMs) {
        clearInterval(timer);
        sendToPilot({ type: 'fgc-verdict', verdict: 'failed', reasonText: 'delai depasse', plateforme: platform });
      }
    }, PILOT_POLL_MS);
  }

  // ---------------------------------------------------------------------------
  // Essai a blanc (2.64.0) : lire la page comme pour reclamer, sans cliquer
  // ---------------------------------------------------------------------------
  //
  // Ordonne par le bouton "Tester la recuperation" du popup. Le moteur fait
  // ce qu'il fait avant son premier clic -- session, defi de securite, bouton
  // reconnu -- et s'arrete la. Il rend ce qu'il a vu : le libelle du bouton
  // qu'il aurait clique, ou, faute de mieux, ceux qu'il a vus a la place.
  //
  // C'est la reponse a la question que le canari ne pose qu'apres coup. Le
  // canari compte les echecs de vraies reclamations ; ici, l'utilisateur
  // demande AVANT qu'un jeu soit rate. Le bogue GOG de la 2.62.0 -- chaque
  // jeu pris pour un DLC -- n'aurait pas ete vu ainsi, mais un libelle qui
  // change, la panne la plus frequente du changelog, l'aurait ete.
  //
  // AUCUN CLIC. Ce bloc n'appelle que des lectures : findActionElement,
  // findShortestActionElement, collectLunaOffers, visibleActionLabels,
  // isLikelyLoggedOut, detectSecurityChallenge. Un test verifie que
  // robustClick n'y apparait pas.

  var INSPECT_WAIT_MS = 15000;

  // Ce qu'il faut chercher sur cette page : le signe "deja possede" et le
  // bouton qu'on aurait clique. null quand la page n'est pas une page de
  // reclamation que le moteur connait.
  function inspectionTargets() {
    var host = location.hostname;
    var enabled = function (el) { return !!el && !el.disabled && el.getAttribute('aria-disabled') !== 'true'; };
    if (host.indexOf('epicgames.com') !== -1) {
      if (isEpicNotFoundPage(location.pathname)) return null;
      return {
        owned: function () { return epicOwnedHere(); },
        claim: function () {
          return findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: true })
            || findActionElement(document, EPIC_MAIN_CTA_PATTERNS)
            || findShortestActionElement(document, EPIC_LIBRARY_LOOSE_PATTERNS)
            // Lecture seule : le bouton que le SENS designerait (libelle inconnu).
            || epicAdaptiveClaimButton('Epic Games');
        }
      };
    }
    if (host.indexOf('gog.com') !== -1) {
      if (isGogRedeemPage(location.pathname)) return null;
      return {
        owned: function () { return navOwnedEvidence(); },
        claim: function () {
          // Lecture seule : le bouton knownButton, sinon celui que le sens designe, sinon le lien qui y mene.
          var knownButton = findActionElement(document, GOG_CLAIM_PATTERNS);
          if (knownButton) return knownButton;
          var memoire = navMemoryRead('GOG');
          var best = navBest('claim', memoire) || navBest('goto', memoire);
          return best ? best.el : null;
        }
      };
    }
    if (host.indexOf('luna.amazon.') !== -1) {
      if (isLunaOfferDetailPage(location.pathname)) {
        var lunaCta = function () {
          var box = document.querySelector('[data-a-target="buy-box"]');
          if (!box) return null;
          return { box: box, cta: box.querySelector('[data-a-target="buy-box_call-to-action"]') || findActionElement(box, LUNA_CLAIM_PATTERNS, { mustBeEnabled: true }) };
        };
        return {
          owned: function () {
            var r = lunaCta();
            return r && !enabled(r.cta) && lunaClaimedText(spacedText(r.box)) ? r.box : null;
          },
          claim: function () {
            var r = lunaCta();
            return r && enabled(r.cta) ? r.cta : null;
          },
          allowed: lunaClaimLabelAllowed
        };
      }
      if (isLunaClaimsListPage(location.pathname)) {
        return {
          owned: function () {
            var offers = collectLunaOffers();
            return offers.length && offers.every(function (o) { return o.collected; }) ? offers[0].card : null;
          },
          claim: function () {
            var offers = collectLunaOffers().filter(function (o) { return !o.collected && o.hasCta; });
            if (!offers.length) return null;
            return offers[0].button || offers[0].card.querySelector('[data-a-target="FGWPOffer"]') || offers[0].card;
          },
          allowed: lunaClaimLabelAllowed
        };
      }
    }
    return null;
  }

  function inspectPage(then) {
    var platform = platformNameForHost(location.hostname);
    function done(verdict, el, extra) {
      var r = { type: 'fgc-inspection', verdict: verdict, plateforme: platform, url: String(location.href).split(/[?#]/)[0] };
      if (el) r.label = actionText(el).slice(0, 80);
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      then(r);
    }

    // Les deux arrets nets de la reclamation, dans le meme ordre.
    if (isLikelyLoggedOut()) { done('needs_login'); return; }
    if (document.querySelector('[data-a-target="sign-in-button"]')
      || (location.hostname.indexOf('luna.amazon.') !== -1 && isLunaReauthVisible())) { done('needs_login'); return; }
    if (detectSecurityChallenge()) { done('challenge'); return; }
    if (location.hostname.indexOf('luna.amazon.') !== -1) rememberLunaHost();

    var targets = inspectionTargets();
    if (!targets) { done('wrong_page', null, { visible: visibleActionLabels(8) }); return; }

    var owned = false;
    waitForElement(function () {
      var o = targets.owned();
      if (o) { owned = true; return o; }
      return targets.claim();
    }, { timeout: INSPECT_WAIT_MS, interval: 500 }).then(function (el) {
      if (owned) { done('owned', el); return; }
      // Les memes garde-fous qu'au clic : un libelle qui parle d'argent, ou
      // que la liste Luna n'autorise pas, aurait ete refuse.
      var text = actionText(el);
      if (looksPaid(text) || (targets.allowed && !targets.allowed(el))) {
        done('refused', el, { visible: visibleActionLabels(8) });
        return;
      }
      done('ready', el);
    }, function () {
      if (detectSecurityChallenge()) { done('challenge'); return; }
      if (isLikelyLoggedOut()) { done('needs_login'); return; }
      done('no_button', null, { visible: visibleActionLabels(8) });
    });
  }

  function listenForOrders() {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg) return;
        if (msg.type === 'fgc-inspecte') {
          sendResponse({ recu: true });
          inspectPage(sendToPilot);
          return true;
        }
        if (msg.type !== 'fgc-reclame') return;
        sendResponse({ recu: true });
        runClaimOrder(msg.budgetMs || 5 * 60 * 1000, msg.force === true, msg.teach);
        return true;
      });
    } catch (e) {}
  }

  function startPiloted() {
    log('CORE', 'info', 'Onglet pilote par la veille : le moteur attend un ordre.');
    listenForOrders();
    sendToPilot({ type: 'fgc-pret', url: location.href });
    /* Une reclamation qui a change de page (2.100.0) : l'ordre a ete ecrit avant
       de partir, et personne ne le renverra a CETTE page -- l'onglet est le meme,
       le verdict attendu aussi. On le reprend ici, avec ce qui reste du budget. */
    // Une demande "montrez-moi le bouton" en cours : la page suivante continue d'ecouter vos clics.
    if (teachState()) startDemoLearning();
    var resumedOrder = navOrderPending();
    if (resumedOrder && resumedOrder.platform === platformNameForHost(location.hostname)) {
      log('CORE', 'info', 'Reprise de la reclamation apres changement de page (etape ' + resumedOrder.hops + ').');
      runClaimOrder(Math.max(30000, resumedOrder.deadline - Date.now()), resumedOrder.force === true);
    }
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
      updateUiState('idle', uiText('engReady'));
      scheduleEpicAutoWatcher();
      startEpicPostPurchaseModalWatcher();
      var pauseEpic = autoCooldownRemaining('epic');
      var pauseLuna = autoCooldownRemaining('luna');
      if (pauseEpic || pauseLuna) log('CORE', 'info', 'Delai de repos en cours -- Epic : ' + (pauseEpic ? formatDelay(pauseEpic) : 'pret') + ', Luna : ' + (pauseLuna ? formatDelay(pauseLuna) : 'pret') + '.');
      scheduleLunaAutoWatcher();
      scheduleGogRedeemWatcher();
      startDemoLearning();
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
      localizeStoreUrl: localizeStoreUrl,
      readLunaHost: readLunaHost,
      rememberLunaHost: rememberLunaHost,
      gogRedeemUrl: gogRedeemUrl,
      getEpicCountry: getEpicCountry,
      getEpicLang: getEpicLang,
      getEpicPageLang: getEpicPageLang,
      getEpicApiUrls: getEpicApiUrls,
      buildEpicUrl: buildEpicUrl,
      isEpicNotFoundPage: isEpicNotFoundPage,
      platformNameForHost: platformNameForHost,
      isLunaClaimsListPage: isLunaClaimsListPage,
      isLunaOfferDetailPage: isLunaOfferDetailPage,
      extractLunaOfferSlug: extractLunaOfferSlug,
      extractLunaOfferId: extractLunaOfferId,
      detectLunaStore: detectLunaStore,
      lunaStoreLabel: lunaStoreLabel,
      redeemUrlFor: redeemUrlFor,
      matchesTaught: matchesTaught,
      noteSeenLabel: noteSeenLabel,
      taughtLabels: taughtLabels,
      redeemCodePattern: function () { return REDEEM_CODE_PATTERN; },
      isLunaStoreSkipped: isLunaStoreSkipped,
      getHistory: getHistory,
      saveHistoryEntry: saveHistoryEntry,
      rememberHistoryTitles: rememberHistoryTitles,
      recordLunaFailure: recordLunaFailure,
      lunaCardKey: lunaCardKey,
      standingEntry: standingEntry,
      pilotSettled: pilotSettled,
      inspectPage: inspectPage,
      runEpicGamesModule: runEpicGamesModule,
      PILOT_SETTLE_MS: PILOT_SETTLE_MS,
      PILOT_EMPTY_REASON: PILOT_EMPTY_REASON,
      claimEpicGame: claimEpicGame,
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
      looksPaid: looksPaid,
      lunaClaimLabelAllowed: lunaClaimLabelAllowed,
      gogSubmitLabelAllowed: gogSubmitLabelAllowed,
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
      LUNA_CLAIM_LOOSE_PATTERNS: LUNA_CLAIM_LOOSE_PATTERNS,
      LUNA_COMPLETE_PATTERNS: LUNA_COMPLETE_PATTERNS,
      GOG_SUBMIT_PATTERNS: GOG_SUBMIT_PATTERNS,
      LUNA_CLAIMED_TEXT: LUNA_CLAIMED_TEXT,
      GOG_REDEEM_SUCCESS_TEXT: GOG_REDEEM_SUCCESS_TEXT,
      GOG_REDEEM_CONFIRM_PATTERNS: GOG_REDEEM_CONFIRM_PATTERNS,
      EPIC_MAIN_CTA_PATTERNS: EPIC_MAIN_CTA_PATTERNS,
      EPIC_OWNERSHIP_PATTERNS: EPIC_OWNERSHIP_PATTERNS,
      epicOwnedHere: epicOwnedHere,
      navScore: navScore,
      navBest: navBest,
      navClassify: navClassify,
      navRun: navRun,
      navVetoReason: navVetoReason,
      navLearn: navLearn,
      navMemoryRead: navMemoryRead,
      navOrderPending: navOrderPending,
      navOwnedEvidence: navOwnedEvidence,
      navClaimsLabel: navClaimsLabel,
      demoOnClick: demoOnClick,
      teachBegin: teachBegin,
      teachState: teachState,
      teachRequest: teachRequest,
      navDescribe: navDescribe,
      navFingerprint: navFingerprint,
      navFpMatch: navFpMatch,
      demoCheck: demoCheck,
      demoRead: demoRead,
      startDemoLearning: startDemoLearning,
      navOwnedText: navOwnedText,
      navOwnedAnywhere: navOwnedAnywhere,
      lunaClaimedText: lunaClaimedText,
      epicAdaptiveClaimButton: epicAdaptiveClaimButton,
      runGogModule: runGogModule,
      epicCtaState: epicCtaState,
      isEpicGameUnownedOnCurrentPage: isEpicGameUnownedOnCurrentPage,
      EPIC_LIBRARY_PATTERNS: EPIC_LIBRARY_PATTERNS,
      EPIC_LIBRARY_LOOSE_PATTERNS: EPIC_LIBRARY_LOOSE_PATTERNS,
      EPIC_AGREE_PATTERNS: EPIC_AGREE_PATTERNS,
      EPIC_AGREE_LOOSE_PATTERNS: EPIC_AGREE_LOOSE_PATTERNS,
      EPIC_FREE_ORDER_PATTERNS: EPIC_FREE_ORDER_PATTERNS,
      EPIC_FREE_ORDER_LOOSE_PATTERNS: EPIC_FREE_ORDER_LOOSE_PATTERNS
    };
  }
})();