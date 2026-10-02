// Passerelle GM_* -> API d'extension. Chargee AVANT le script principal ;
// les scripts de contenu d'une meme extension partagent le meme contexte.
(function () {
  'use strict';
  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;
  var cache = {};
  var menu = [];

  // Le stockage de l'extension est asynchrone alors que GM_getValue est
  // synchrone : on precharge des l'injection. Le script principal n'interroge
  // le stockage qu'apres l'evenement load (+1,5 s), largement apres la fin du
  // prechargement.
  //
  // storage.local n'offre aucune requete par prefixe : get(null) ramene TOUT,
  // y compris le catalogue d'offres et les statistiques de veille, qui n'ont
  // rien a faire dans un script de contenu. Les cles du moteur sont donc
  // enumerees. En ajouter une ici quand le moteur en cree une.
  var ENGINE_KEYS = [
    // Arret d'urgence. Precharge comme les autres : il doit etre lisible de
    // facon SYNCHRONE avant un clic, et une lecture asynchrone arriverait
    // apres.
    'FGC_kill_switch',
    'FGC_auto_state',
    'FGC_epic_auto_mode',
    'FGC_luna_auto_mode',
    'FGC_luna_claim_dlc',
    // Pays et langue de la boutique : lus de facon SYNCHRONE pour construire
    // l'URL de l'API Epic, donc prechargees comme l'arret d'urgence.
    'FGC_epic_country',
    'FGC_epic_lang',
    // Le domaine Luna ou une session est ouverte : lu de facon SYNCHRONE pour
    // choisir l'adresse a ouvrir (localisation des adresses, watch/localize.js).
    'FGC_luna_host',
    'FGC_pending_codes',
    // Les libelles appris par l'utilisateur : lus de facon SYNCHRONE avant
    // chaque clic, comme l'arret d'urgence. Une lecture asynchrone arriverait
    // apres le clic qu'elle devait autoriser.
    'FGC_taught_labels',
    'FGC_seen_labels',
    'FGC_schema_version',
    // platformNameForHost() : ces trois noms couvrent tous les hotes injectes.
    'FGC_history_Epic Games',
    'FGC_history_GOG',
    'FGC_history_Amazon Luna',
    // La memoire du navigateur adaptatif, par magasin (libelles et formes qui ont
    // pris un jeu). Lue de facon SYNCHRONE au debut de chaque passage : sans le
    // prechargement, elle s'ecrivait mais ne se relisait JAMAIS d'une page a
    // l'autre -- ce que l'essai de bout en bout de 2.102.0 a revele.
    'FGC_nav_GOG',
    'FGC_nav_Epic Games',
    'FGC_nav_Amazon Luna'
  ];

  // Le script est injecte dans toutes les iframes (all_frames), mais le moteur
  // ne tourne que dans le cadre principal et dans l'iframe de paiement Epic.
  // Les fonctions GM_* restent definies partout -- une iframe qui en appelle
  // une ne doit pas planter -- mais le prechargement, lui, est saute.
  var IS_TOP_FRAME = (function () {
    try { return window.top === window.self; } catch (e) { return false; }
  })();
  // Aligne sur src/core/02-frames.js, et pas seulement sur l'iframe du
  // prestataire : depuis la 2.15.1 le moteur clique dans TOUTE sous-iframe
  // Epic, et la commande gratuite se termine sur store.epicgames.com/purchase.
  // Sans le prechargement ici, GM_getValue('FGC_kill_switch') y rendait
  // toujours le defaut -- autrement dit l'arret d'urgence ne protegeait pas la
  // frame ou le moteur clique le plus.
  var IS_EPIC_SUBFRAME = !IS_TOP_FRAME && /(^|\.)epicgames\.com$/i.test(location.hostname);
  var NEEDS_STORAGE = IS_TOP_FRAME || IS_EPIC_SUBFRAME;

  if (NEEDS_STORAGE) {
    try {
      api.storage.local.get(ENGINE_KEYS, function (items) {
        consumeLastError();
        if (items) for (var k in items) cache[k] = items[k];
      });
    } catch (e) { console.error('[FGC][shim] stockage indisponible', e); }

    // Le popup ecrit les memes cles (bascules auto, DLC). Sans cette ecoute, un
    // interrupteur bascule dans le popup laissait le cache de l'onglet ouvert
    // sur l'ancienne valeur jusqu'au rechargement de la page.
    try {
      api.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        for (var k in changes) {
          if (!Object.prototype.hasOwnProperty.call(changes, k)) continue;
          if (ENGINE_KEYS.indexOf(k) === -1) continue;
          if ('newValue' in changes[k]) cache[k] = changes[k].newValue;
          else delete cache[k];
        }
      });
    } catch (e) {}
  }

  window.GM_getValue = function (key, def) { return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : def; };
  window.GM_setValue = function (key, value) {
    cache[key] = value;
    var o = {}; o[key] = value;
    try { api.storage.local.set(o); } catch (e) {}
  };
  window.GM_deleteValue = function (key) { delete cache[key]; try { api.storage.local.remove(key); } catch (e) {} };

  window.GM_addStyle = function (css) {
    var el = document.createElement('style');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
    return el;
  };

  window.GM_setClipboard = function (text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); return; }
    } catch (e) {}
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  };

  // Le callback consomme runtime.lastError. Sans lui, un service worker qui ne
  // repond pas -- ces messages n'attendent aucune reponse -- laissait une
  // promesse rejetee ou un « Unchecked runtime.lastError » dans la console.
  function consumeLastError() { try { void api.runtime.lastError; } catch (e) {} }

  window.GM_notification = function (opts) {
    opts = opts || {};
    try { api.runtime.sendMessage({ type: 'fgc-notify', title: opts.title || 'Free Games Claimer', text: opts.text || '' }, consumeLastError); } catch (e) {}
  };

  window.GM_openInTab = function (url, opts) {
    try { api.runtime.sendMessage({ type: 'fgc-open-tab', url: url, active: !!(opts && opts.active) }, consumeLastError); } catch (e) { window.open(url, '_blank'); }
  };

  // Pas de menu Tampermonkey : les commandes sont exposees dans la console
  // via window.FGC.menu() / window.FGC.run(index).
  window.GM_registerMenuCommand = function (label, fn) { menu.push({ label: label, fn: fn }); return menu.length - 1; };
  window.FGC = {
    menu: function () { menu.forEach(function (m, i) { console.log('[FGC] ' + i + ' : ' + m.label); }); return menu.length; },
    run: function (i) { if (menu[i]) menu[i].fn(); else console.warn('[FGC] commande inconnue'); }
  };

  window.GM_xmlhttpRequest = function (details) {
    details = details || {};
    try {
      api.runtime.sendMessage({ type: 'fgc-fetch', url: details.url, method: details.method || 'GET', headers: details.headers || {} }, function (res) {
        consumeLastError();
        if (!res) { if (details.onerror) details.onerror({}); return; }
        if (res.error) { if (details.onerror) details.onerror(res); return; }
        if (details.onload) details.onload({ status: res.status, responseText: res.body, finalUrl: details.url });
      });
    } catch (e) { if (details.onerror) details.onerror({ error: e.message }); }
  };
})();
