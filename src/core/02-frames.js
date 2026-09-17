  var IS_EPIC_PAYMENT_FRAME = /payment-website-pci/i.test(location.hostname) && location.hostname.endsWith('epicgames.com');

  // Le script est injecte dans toutes les iframes de la page (publicites,
  // lecteurs video, widgets) : seule l'iframe de paiement Epic nous interesse.
  var IS_TOP_FRAME = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();
  if (!IS_TOP_FRAME && !IS_EPIC_PAYMENT_FRAME) return;

