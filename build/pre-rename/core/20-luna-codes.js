  function getPendingRedeemCodes(store) {
    var all;
    try { all = JSON.parse(GM_getValue('FGC_pending_codes', '[]')); } catch (e) { all = []; }
    if (!Array.isArray(all)) all = [];
    return store ? all.filter(function (c) { return c && c.store === store; }) : all;
  }

  function savePendingRedeemCodes(list) {
    GM_setValue('FGC_pending_codes', JSON.stringify(list || []));
  }

  function addPendingRedeemCode(entry) {
    var all = getPendingRedeemCodes();
    if (all.some(function (c) { return c.code === entry.code; })) return all;
    all.push(entry);
    savePendingRedeemCodes(all);
    return all;
  }

  function updatePendingRedeemCode(code, patch) {
    var all = getPendingRedeemCodes();
    all.forEach(function (c) {
      if (c.code !== code) return;
      Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
    });
    savePendingRedeemCodes(all);
    return all;
  }

  function removePendingRedeemCode(code) {
    var all = getPendingRedeemCodes().filter(function (c) { return c.code !== code; });
    savePendingRedeemCodes(all);
    return all;
  }

  function describePendingCodes() {
    var all = getPendingRedeemCodes();
    if (!all.length) return 'Aucun code en attente.';
    return all.map(function (c) {
      return lunaStoreLabel(c.store) + ' : ' + c.code + ' (' + c.title + ', ' + (c.attempts || 0) + ' essai(s)' + (c.deadline ? ', a utiliser avant le ' + c.deadline : '') + ')';
    }).join('\n');
  }

  // File des fiches Luna a visiter (sessionStorage : propre a l'onglet).
