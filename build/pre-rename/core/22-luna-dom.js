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

