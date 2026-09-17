  function getLunaQueue() {
    try {
      var q = JSON.parse(sessionStorage.getItem('FGC_luna_queue') || '[]');
      return Array.isArray(q) ? q : [];
    } catch (e) { return []; }
  }

  function saveLunaQueue(queue) {
    try { sessionStorage.setItem('FGC_luna_queue', JSON.stringify(queue || [])); } catch (e) {}
  }

  function getLunaBatch() {
    try {
      return JSON.parse(sessionStorage.getItem('FGC_luna_batch') || 'null') || { total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false };
    } catch (e) { return { total: 0, claimed: 0, codes: 0, skipped: 0, failed: 0, gogHandoffDone: false }; }
  }

  function saveLunaBatch(batch) {
    try { sessionStorage.setItem('FGC_luna_batch', JSON.stringify(batch)); } catch (e) {}
  }

  function bumpLunaBatch(field) {
    var batch = getLunaBatch();
    batch[field] = (batch[field] || 0) + 1;
    saveLunaBatch(batch);
    return batch;
  }

  function lunaHistoryKey(offerId) { return 'offer:' + offerId; }

  var LUNA_DONE_STATUSES = { claimed: true, redeemed: true, code_copied: true, code_pending_gog: true, skipped: true };
  var LUNA_NEEDS_LINK_RETRY_MS = 24 * 60 * 60 * 1000;

  function lunaOfferDone(offerId) {
    var entry = getHistory('Amazon Luna')[lunaHistoryKey(offerId)];
    if (!entry) return false;
    if (LUNA_DONE_STATUSES[entry.status]) return true;
    if (entry.status === 'needs_link') return Date.now() - (entry.ts || 0) < LUNA_NEEDS_LINK_RETRY_MS;
    if (entry.status === 'failed' && (entry.attempts || 0) >= CONFIG.lunaMaxAttemptsPerOffer) return true;
    return false;
  }

  function recordLunaFailure(offerId, reason) {
    var history = getHistory('Amazon Luna');
    var previous = history[lunaHistoryKey(offerId)];
    var attempts = (previous && previous.status === 'failed' ? (previous.attempts || 0) : 0) + 1;
    history[lunaHistoryKey(offerId)] = { status: 'failed', reason: reason || '', ts: Date.now(), attempts: attempts };
    GM_setValue('FGC_history_Amazon Luna', JSON.stringify(history));
    return attempts;
  }

  // Amazon peut redemander une confirmation de connexion avant de finaliser
  // une reclamation -- avec OU sans champ mot de passe visible. On ne clique
  // JAMAIS a travers cette etape, meme quand aucun mot de passe n'est
  // demande : c'est une verification de securite posee intentionnellement
  // par Amazon, pas un simple ecran de chargement a court-circuiter. Le
  // module s'arrete et vous notifie plutot que de la franchir a votre place.
  function isLunaReauthVisible() {
    var passwordField = document.querySelector('input[type="password"]');
    if (passwordField && (passwordField.offsetWidth || passwordField.offsetHeight)) return true;
    var nodes = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,h4,p'));
    return nodes.some(function (n) {
      return /sign in to your amazon account|connectez-vous [a\u00e0] votre compte amazon|confirm(er)? your identity|confirmer votre identit[e\u00e9]/i.test(n.textContent || '');
    });
  }

  function checkLunaReauthPopup() {
    if (isLunaReauthVisible()) throw new Error('MANUAL_LOGIN_REQUIRED');
  }

  // textContent concatene les noeuds texte sans separateur ("Right and DownRecupere") :
  // on joint chaque noeud texte par un espace avant de tester les motifs.
