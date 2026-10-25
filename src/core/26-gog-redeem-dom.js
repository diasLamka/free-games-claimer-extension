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

  var GOG_REDEEM_SUCCESS_TEXT = /a \u00e9t\u00e9 ajout|ont \u00e9t\u00e9 ajout|vient d'\u00eatre ajout|has been added|have been added|was added to your|f[e\u00e9]licitations|congratulations|successfully redeemed|redeemed successfully|successfully added|added \d+ items? to your|code (utilis|[e\u00e9]chang)[e\u00e9] avec succ|est maintenant dans votre biblioth|is now in your library/i;
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

  /* LA BIBLIOTHEQUE DIT LA VERITE QUAND LA PAGE SE TAIT (2.110.0).
   *
   * Les phrases de GOG changent sans prevenir : le 2026-10-11, "Code redeemed successfully" n'etait pas reconnu et un jeu
   * ajoute au compte etait declare "non confirme". Quand l'attente finit sans phrase ni refus, on demande donc a la
   * bibliotheque du compte -- meme origine que la page, donc meme session -- si le titre y est. Il y est : succes. Il n'y est
   * pas (GOG previent qu'il peut mettre un moment a apparaitre) : l'echange reste "non confirme", rien n'est invente. */
  var GOG_LIBRARY_EDITION = /\b(standard|deluxe|ultimate|definitive|complete|goty|game of the year|gold|premium|enhanced|remastered|anniversary|special|collector s|digital) edition\b/g;

  function gogTitleCore(title) {
    var s = String(title == null ? '' : title).toLowerCase();
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.replace(/\s*[-\u2013\u2014(]\s*amazon luna\s*\)?\s*$/, ' ');
    return s.replace(/[^a-z0-9]+/g, ' ').replace(GOG_LIBRARY_EDITION, ' ').replace(/\s+/g, ' ').trim();
  }

  function gogLibrarySearchUrl(title) {
    var q = String(title == null ? '' : title).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\b(key\s+)?giveaway\b/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    return 'https://www.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=1&search=' + encodeURIComponent(q);
  }

  function gogLibraryHasTitle(body, title) {
    var want = gogTitleCore(title);
    if (!want || !body || !Array.isArray(body.products)) return false;
    return body.products.some(function (p) { return p && gogTitleCore(p.title) === want; });
  }

  /* Vrai seulement si la bibliotheque s'est lue ET contient le titre. Tout le reste -- reseau, 403, JSON illisible -- vaut non. */
  function gogOwnedInLibrary(title, fetcher) {
    var get = fetcher || function (url, opts) { return fetch(url, opts); };
    return Promise.resolve().then(function () {
      return get(gogLibrarySearchUrl(title), { credentials: 'include', headers: { Accept: 'application/json' } });
    }).then(function (res) {
      if (!res || !res.ok) return false;
      return res.json().then(function (body) { return gogLibraryHasTitle(body, title); });
    }).catch(function () { return false; });
  }

  /* Le verdict de l'attente, corrige par la bibliotheque : seul "timeout" (ni phrase ni refus) est rejuge ; tout autre
     verdict -- refus, captcha, succes lu -- reste tel quel. */
  function gogSettleOutcome(outcome, title, fetcher) {
    if (!outcome || outcome.type !== 'timeout') return Promise.resolve(outcome);
    return gogOwnedInLibrary(title, fetcher).then(function (owned) {
      return owned ? { type: 'success', detail: 'bibliotheque' } : outcome;
    });
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
