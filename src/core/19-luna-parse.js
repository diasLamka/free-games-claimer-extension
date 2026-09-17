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
