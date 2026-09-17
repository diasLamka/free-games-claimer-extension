  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function randomDelay(min, max) {
    return sleep(min + Math.random() * (max - min));
  }

  function waitForElement(selectorOrFn, options) {
    options = options || {};
    var root = options.root || document;
    var timeout = typeof options.timeout === 'undefined' ? CONFIG.waitForElementTimeout : options.timeout;
    var interval = options.interval || 300;

    return new Promise(function (resolve, reject) {
      function resolveIfFound() {
        try {
          return typeof selectorOrFn === 'function' ? selectorOrFn() : root.querySelector(selectorOrFn);
        } catch (e) {
          return null;
        }
      }

      var existing = resolveIfFound();
      if (existing) { resolve(existing); return; }

      var settled = false;
      function cleanup() {
        observe.disconnect();
        clearInterval(pollId);
        clearTimeout(timeoutId);
      }

      var observe = new MutationObserver(function () {
        if (settled) return;
        var el = resolveIfFound();
        if (el) { settled = true; cleanup(); resolve(el); }
      });
      observe.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });

      var pollId = setInterval(function () {
        if (settled) return;
        var el = resolveIfFound();
        if (el) { settled = true; cleanup(); resolve(el); }
      }, interval);

      var timeoutId = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('waitForElement: timeout apres ' + timeout + 'ms'));
      }, timeout);
    });
  }

  function withRetry(fn, options) {
    options = options || {};
    var retries = options.retries || CONFIG.maxRetries;
    var baseDelay = options.baseDelay || CONFIG.retryDelayBase;
    var label = options.label || 'operation';

    var attempt = 0;
    function tryOnce() {
      attempt++;
      return Promise.resolve()
        .then(function () { return fn(attempt); })
        .catch(function (err) {
          if (attempt >= retries) throw err;
          var delay = baseDelay * attempt + Math.random() * 400;
          log('CORE', 'warn', label + ' a echoue (tentative ' + attempt + '/' + retries + ') : ' + err.message + '. Nouvel essai dans ' + Math.round(delay) + 'ms.');
          return sleep(delay).then(tryOnce);
        });
    }
    return tryOnce();
  }

  function gmFetchJson(url, timeout) {
    timeout = timeout || 10000;
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest non disponible (permission @grant manquante ?).'));
        return;
      }
      GM_xmlhttpRequest({
        method: 'GET',
        url: url,
        timeout: timeout,
        headers: { Accept: 'application/json' },
        onload: function (res) {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error('HTTP ' + res.status + ' sur ' + url));
              return;
            }
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error('Reponse JSON invalide depuis ' + url + ' : ' + e.message));
          }
        },
        onerror: function () { reject(new Error('Echec reseau sur ' + url)); },
        ontimeout: function () { reject(new Error('Timeout reseau sur ' + url)); }
      });
    });
  }

