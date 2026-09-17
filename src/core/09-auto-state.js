  // ---------------------------------------------------------------------------
  // Delai de repos des verifications automatiques
  // ---------------------------------------------------------------------------
  // Partage entre onglets (stockage Tampermonkey) : sans lui, chaque onglet,
  // chaque rechargement et chaque retour sur l'onglet relancait un cycle.
  function getAutoState() {
    try { return JSON.parse(GM_getValue('FGC_auto_state', '{}')) || {}; } catch (e) { return {}; }
  }

  function autoCooldownRemaining(key) {
    var until = getAutoState()[key] || 0;
    return Math.max(0, until - Date.now());
  }

  function setAutoCooldown(key, ms) {
    var st = getAutoState();
    st[key] = Date.now() + (ms || 0);
    GM_setValue('FGC_auto_state', JSON.stringify(st));
  }

  function clearAutoCooldown(key) {
    var st = getAutoState();
    delete st[key];
    GM_setValue('FGC_auto_state', JSON.stringify(st));
  }

  function formatDelay(ms) {
    var min = Math.round(ms / 60000);
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }

  // Renvoie true si la verification automatique doit etre sautee.
  function autoRunBlocked(platform, key) {
    var left = autoCooldownRemaining(key);
    if (!left) return false;
    log(platform, 'info', 'Verification automatique en pause encore ' + formatDelay(left) + ' (cliquez sur Claim ou utilisez le menu pour forcer).');
    return true;
  }

