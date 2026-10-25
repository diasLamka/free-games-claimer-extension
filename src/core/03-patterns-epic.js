  // Les libelles reels du store sont accentues ("Recuperer", "Dans la
  // bibliotheque") : on tolere les deux graphies via des echappements unicode
  // pour garder le fichier en ASCII pur.
  var EPIC_MAIN_CTA_PATTERNS = [/^add to cart$/i, /^ajouter au panier$/i, /^get$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^obtenir$/i];
  /* Les SEULS libelles d'un bouton principal qui valent "gratuit" sur une fiche
   * que le flux freeGamesPromotions ne liste pas (2.115.0). Les mots de panier en
   * sont absents a dessein : sur une fiche payante, "Ajouter au panier" est le
   * second bouton, et le principal dit "Acheter". */
  var EPIC_OFF_FEED_FREE_CTA_PATTERNS = [/^get$/i, /^obtenir$/i, /^r[e\u00e9]cup[e\u00e9]rer$/i, /^ajouter [a\u00e0] la biblioth[e\u00e8]que$/i, /^add to library$/i];
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

