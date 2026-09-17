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

