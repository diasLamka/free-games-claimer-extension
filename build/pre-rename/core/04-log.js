  function log(platform, level, var_args) {
    var prefix = '[FGC][' + platform + '][' + level.toUpperCase() + ']';
    var fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
    var extraArgs = Array.prototype.slice.call(arguments, 2);
    var callArgs = [prefix, new Date().toISOString()].concat(extraArgs);
    fn.apply(console, callArgs);
  }

  /* Un texte pour l'utilisateur (2.55.0) : une cle de _locales et ses
     valeurs, jamais une phrase. Le moteur est en ASCII et ne sait pas quelle
     langue lit l'utilisateur ; le lanceur (etat du moteur) et le worker
     (notifications) composent la phrase, accentuee, dans la langue choisie.
     Plusieurs morceaux se passent en tableau, mis bout a bout. */
  function uiText(key) {
    var args = [];
    for (var i = 1; i < arguments.length; i++) args.push(String(arguments[i]));
    return { key: key, args: args };
  }

  function notifyUser(title, text, timeout) {
    timeout = typeof timeout === 'undefined' ? 8000 : timeout;
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({ title: title, text: text, timeout: timeout, silent: false });
      } else {
        console.log('[FGC][NOTIFY] ' + title + ': ' + text);
      }
    } catch (e) {
      console.error('[FGC] Echec de la notification', e);
    }
  }

