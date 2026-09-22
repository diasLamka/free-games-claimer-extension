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
