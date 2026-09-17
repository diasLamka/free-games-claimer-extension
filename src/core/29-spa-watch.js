  if (!IS_EPIC_PAYMENT_FRAME) {
    (function watchSpaNavigation() {
      var lastHref = location.href;
      var lastPath = location.pathname;

      function rerun() {
        // Seul un changement de chemin compte : Epic et Amazon reecrivent en
        // permanence la query (suivi, ?lang=), ce qui relancait tout un cycle.
        if (location.pathname !== lastPath || (location.href !== lastHref && !isGogRedeemPage(location.pathname))) {
          var prevHref = lastHref;
          lastHref = location.href;
          if (location.pathname === lastPath) { return; }
          lastPath = location.pathname;
          // gog.com/redeem pousse /redeem/<code> apres "Continuer" : le module
          // d'echange est deja en cours, ne pas le relancer.
          if (location.hostname.indexOf('gog.com') !== -1 && isGogRedeemPage(location.pathname) && /\/redeem(\/|$|\?)/i.test(prevHref)) {
            log('CORE', 'info', 'Route interne GOG /redeem : pas de relance du module.');
            return;
          }
          log('CORE', 'info', 'Navigation SPA detectee -> ' + location.href);
          setTimeout(dispatch, 1000);
        }
      }

      var origPushState = history.pushState;
      history.pushState = function () {
        origPushState.apply(this, arguments);
        rerun();
      };

      var origReplaceState = history.replaceState;
      history.replaceState = function () {
        origReplaceState.apply(this, arguments);
        rerun();
      };

      window.addEventListener('popstate', rerun);
      setInterval(rerun, CONFIG.pollInterval);
    })();
  }

