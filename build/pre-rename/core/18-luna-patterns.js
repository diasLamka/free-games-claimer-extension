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
  function lunaClaimLabelAllowed(el) {
    if (!el) return false;
    var text = actionText(el);
    if (!text) return false;
    if (looksPaid(text)) return false;
    var ok = LUNA_CLAIM_PATTERNS.some(function (p) { return p.test(text); })
          || LUNA_CLAIM_LOOSE_PATTERNS.some(function (p) { return p.test(text); });
    return ok;
  }

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

