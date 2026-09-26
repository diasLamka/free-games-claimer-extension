// Passerelle de l'appli Android : ce que content/gm-shim.js fait avec les API
// d'extension, fait ici avec le canal `fgcNative` de la WebView.
//
// Ce fichier est colle, avec le moteur, DANS une meme fonction : `chrome` et
// les GM_* sont des variables locales de cette fonction, que le moteur trouve
// par la portee. Rien n'est ajoute a `window`, donc rien n'est visible des
// scripts de la page.
//
// Le moteur est celui de l'extension, au caractere pres. Il pose ses
// questions au « service worker » (suis-je pilote ?), annonce qu'il est pret,
// recoit l'ordre de reclamer et rend son verdict : ici, c'est l'appli qui
// repond.
var fgcBridge = (function () {
  var seq = 0;
  var pending = {};
  var listeners = [];
  var wired = false;

  function port() {
    return (typeof fgcNative !== 'undefined' && fgcNative) ? fgcNative : null;
  }

  function wire() {
    var p = port();
    if (!p || wired) return p;
    wired = true;
    p.onmessage = function (ev) {
      var data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      if (!data) return;
      if (data.replyTo && pending[data.replyTo]) {
        var cb = pending[data.replyTo];
        delete pending[data.replyTo];
        try { cb(data.payload); } catch (e) {}
        return;
      }
      if (data.push) {
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](data.push, {}, function () {}); } catch (e) {}
        }
      }
    };
    return p;
  }

  return {
    send: function (msg, cb) {
      var p = wire();
      var id = ++seq;
      if (typeof cb === 'function') pending[id] = cb;
      if (!p) {
        if (typeof cb === 'function') { delete pending[id]; setTimeout(function () { cb(undefined); }, 0); }
        return;
      }
      try { p.postMessage(JSON.stringify({ id: id, msg: msg })); } catch (e) {
        if (typeof cb === 'function') { delete pending[id]; setTimeout(function () { cb(undefined); }, 0); }
      }
    },
    listen: function (fn) { wire(); listeners.push(fn); }
  };
})();

var chrome = {
  runtime: {
    lastError: undefined,
    sendMessage: function (msg, cb) { fgcBridge.send(msg, cb); },
    onMessage: { addListener: function (fn) { fgcBridge.listen(fn); } }
  },
  storage: {
    local: {
      get: function (keys, cb) {
        fgcBridge.send({ type: 'fgc-storage-get', keys: keys }, function (items) { if (cb) cb(items || {}); });
      },
      set: function (items, cb) {
        fgcBridge.send({ type: 'fgc-storage-set', items: items });
        if (cb) setTimeout(cb, 0);
      },
      remove: function (keys, cb) {
        fgcBridge.send({ type: 'fgc-storage-remove', keys: [].concat(keys) });
        if (cb) setTimeout(cb, 0);
      }
    },
    onChanged: { addListener: function () {} }
  }
};
var browser = undefined;

var fgcCache = {};
var fgcMenu = [];

(function precharger() {
  var top = false;
  try { top = window.top === window.self; } catch (e) { top = false; }
  var epicSub = !top && /(^|\.)epicgames\.com$/i.test(location.hostname);
  if (!top && !epicSub) return;
  chrome.storage.local.get(null, function (items) {
    for (var k in items) if (Object.prototype.hasOwnProperty.call(items, k)) fgcCache[k] = items[k];
  });
})();

var GM_getValue = function (key, def) {
  return Object.prototype.hasOwnProperty.call(fgcCache, key) ? fgcCache[key] : def;
};
var GM_setValue = function (key, value) {
  fgcCache[key] = value;
  var o = {}; o[key] = value;
  chrome.storage.local.set(o);
};
var GM_deleteValue = function (key) { delete fgcCache[key]; chrome.storage.local.remove(key); };
var GM_addStyle = function (css) {
  var el = document.createElement('style');
  el.textContent = css;
  (document.head || document.documentElement).appendChild(el);
  return el;
};
var GM_setClipboard = function (text) {
  chrome.runtime.sendMessage({ type: 'fgc-clipboard', text: String(text || '') });
};
var GM_notification = function (opts) {
  opts = opts || {};
  chrome.runtime.sendMessage({ type: 'fgc-notify', title: opts.title || '', text: opts.text || '' });
};
var GM_openInTab = function (url) {
  chrome.runtime.sendMessage({ type: 'fgc-open-tab', url: String(url || '') });
};
var GM_registerMenuCommand = function (label, fn) { fgcMenu.push({ label: label, fn: fn }); return fgcMenu.length - 1; };
var GM_xmlhttpRequest = function (details) {
  details = details || {};
  chrome.runtime.sendMessage({ type: 'fgc-fetch', url: details.url, method: details.method || 'GET' }, function (res) {
    if (!res) { if (details.onerror) details.onerror({}); return; }
    if (res.error) { if (details.onerror) details.onerror(res); return; }
    if (details.onload) details.onload({ status: res.status, responseText: res.body, finalUrl: details.url });
  });
};
