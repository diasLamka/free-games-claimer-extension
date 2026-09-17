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

