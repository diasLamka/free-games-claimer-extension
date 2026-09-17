  function log(platform, level, var_args) {
    var prefix = '[FGC][' + platform + '][' + level.toUpperCase() + ']';
    var fn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
    var extraArgs = Array.prototype.slice.call(arguments, 2);
    var callArgs = [prefix, new Date().toISOString()].concat(extraArgs);
    fn.apply(console, callArgs);
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

