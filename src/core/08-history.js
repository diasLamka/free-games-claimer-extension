  function getHistory(platform) {
    try {
      var raw = GM_getValue('FGC_history_' + platform, '{}');
      return JSON.parse(raw);
    } catch (e) {
      log(platform, 'error', 'Historique corrompu, reinitialisation.', e);
      return {};
    }
  }

  function saveHistoryEntry(platform, gameKey, status, reason) {
    var history = getHistory(platform);
    history[gameKey] = { status: status, reason: reason || '', ts: Date.now() };
    GM_setValue('FGC_history_' + platform, JSON.stringify(history));
  }

  function removeHistoryEntry(platform, gameKey) {
    var history = getHistory(platform);
    if (history[gameKey]) {
      delete history[gameKey];
      GM_setValue('FGC_history_' + platform, JSON.stringify(history));
    }
  }

  function alreadyHandled(platform, gameKey) {
    var history = getHistory(platform);
    return !!(history[gameKey] && history[gameKey].status === 'claimed');
  }

