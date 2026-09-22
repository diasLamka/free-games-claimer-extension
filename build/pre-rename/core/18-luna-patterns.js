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
    var ok = LUNA_CLAIM_PATTERNS.some(function (p) { return p.test(text); })
          || LUNA_CLAIM_LOOSE_PATTERNS.some(function (p) { return p.test(text); })
          || matchesTaught(text, 'luna');
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

