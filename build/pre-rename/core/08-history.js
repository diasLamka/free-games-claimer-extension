  function getHistory(platform) {
    try {
      var raw = GM_getValue('FGC_history_' + platform, '{}');
      return JSON.parse(raw);
    } catch (e) {
      log(platform, 'error', 'Historique corrompu, reinitialisation.', e);
      return {};
    }
  }

  // Le titre du jeu, tel que la page l'affiche. Sans lui, une cle opaque
  // ("offer:amzn1.pg.item...") ne se lisait nulle part : le popup montrait
  // "Amazon Luna" a la place du nom, et le registre ne pouvait rien rapprocher.
  function historyTitle(title) {
    var t = String(title || '').replace(/\s+/g, ' ').trim();
    return t ? t.slice(0, 200) : null;
  }

  function saveHistoryEntry(platform, gameKey, status, reason, title) {
    var history = getHistory(platform);
    var previous = history[gameKey];
    var entry = { status: status, reason: reason || '', ts: Date.now() };
    // Une ecriture qui ne connait pas le titre ne fait pas oublier celui deja note.
    var name = historyTitle(title) || (previous && previous.title) || null;
    if (name) entry.title = name;
    history[gameKey] = entry;
    GM_setValue('FGC_history_' + platform, JSON.stringify(history));
  }

  // Complete le titre d'entrees existantes, sans toucher a leur statut ni a
  // leur date : c'est une correction d'etiquette, pas un nouvel evenement. Le
  // mode pilote et le registre reperent les nouveautes a leur date, et une
  // date rafraichie ici passerait pour une reclamation qui vient d'avoir lieu.
  // Une seule ecriture pour tout le lot.
  function rememberHistoryTitles(platform, titlesByKey) {
    var history = getHistory(platform);
    var changed = false;
    Object.keys(titlesByKey || {}).forEach(function (k) {
      var entry = history[k];
      var name = historyTitle(titlesByKey[k]);
      if (!entry || entry.title || !name) return;
      entry.title = name;
      changed = true;
    });
    if (changed) GM_setValue('FGC_history_' + platform, JSON.stringify(history));
    return changed;
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

