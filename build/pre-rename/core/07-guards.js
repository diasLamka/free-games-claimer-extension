  function isLikelyLoggedOut() {
    var loginPatterns = [/^sign in$/i, /^se connecter$/i, /^log in$/i, /^connexion$/i, /^connectez-vous$/i];
    return !!findActionElement(document, loginPatterns, { mustBeEnabled: false });
  }

  // Un cadre de captcha n'est un DEFI que s'il est reellement affiche : Epic,
  // GOG et Amazon chargent en permanence des iframes hCaptcha / reCAPTCHA /
  // Arkose invisibles. Les prendre pour un defi arretait le script juste avant
  // les derniers clics ("Ajouter a la bibliotheque", "J'accepte", "Recuperer").
  function isElementVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    if (rect.width < 50 || rect.height < 50) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) return false;
    return true;
  }

  /* Un defi niche dans la fenetre d'achat (2.99.7). La frame d'achat, d'une autre
     origine, nous le dit par message ; il ne compte que tant que la fenetre est
     ouverte et moins de dix minutes. Seul le fait est accepte, de la part d'un
     hote epicgames.com : aucune donnee ne transite. */
  var epicPaymentChallengeAt = 0;
  if (!IS_EPIC_PAYMENT_FRAME && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || d.fgcPaymentChallenge !== true) return;
      var host = '';
      try { host = new URL(ev.origin).hostname; } catch (e) { return; }
      if (!/(^|\.)epicgames\.com$/i.test(host)) return;
      epicPaymentChallengeAt = Date.now();
    });
  }

  function detectSecurityChallenge() {
    if (!IS_EPIC_PAYMENT_FRAME && epicPaymentChallengeAt && Date.now() - epicPaymentChallengeAt < 10 * 60000 && epicPurchaseOverlayOpen()) {
      return { type: 'captcha', detail: 'defi dans la fenetre d\'achat Epic' };
    }
    var iframes = Array.prototype.slice.call(document.querySelectorAll('iframe'));
    var iframeHit = iframes.find(function (f) {
      return /captcha|hcaptcha|recaptcha|arkose|funcaptcha|challenge/i.test(f.src || '') && isElementVisible(f);
    });
    if (iframeHit) return { type: 'captcha', detail: iframeHit.src };

    // Defi Cloudflare (page 403 "Un instant...") : l'iframe Turnstile vit dans un
    // shadow root ferme, invisible a querySelectorAll. Seule la page de defi
    // charge le script d'orchestration ; le script jsd des pages saines et le
    // widget Turnstile d'un formulaire (GOG /redeem) ne comptent pas.
    var cfScript = Array.prototype.slice.call(document.querySelectorAll('script[src]')).find(function (s) {
      return /\/cdn-cgi\/challenge-platform\/.*\/orchestrate\//.test(s.src || '');
    });
    if (cfScript) return { type: 'captcha', detail: cfScript.src };

    var otpInput = document.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="totp" i], input[maxlength="6"], input[maxlength="8"]');
    if (otpInput && (otpInput.offsetWidth || otpInput.offsetHeight)) {
      var bodyText = document.body ? document.body.innerText : '';
      if (/verification code|two-factor|authentification a deux facteurs|code de securite|security code|code de verification/i.test(bodyText)) {
        return { type: '2fa', detail: 'Champ de code de verification detecte avec texte contextuel associe.' };
      }
    }
    return null;
  }

  function isUserLikelyBusy() {
    var busySelectors = ['[class*="cart-drawer" i]', '[class*="checkout" i][class*="form" i]', 'iframe[src*="payment" i]', 'iframe[src*="checkout" i]'];
    return busySelectors.some(function (sel) {
      try {
        var el = document.querySelector(sel);
        return !!(el && (el.offsetWidth || el.offsetHeight));
      } catch (e) { return false; }
    });
  }

