  function getEpicAutoModeEnabled() { return GM_getValue('FGC_epic_auto_mode', true); }
  function setEpicAutoModeEnabled(val) { GM_setValue('FGC_epic_auto_mode', !!val); }

  function injectFloatingButton() {
    if (document.getElementById('fgc-floating-btn')) return;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(
        '#fgc-widget { position: fixed; bottom: 20px; right: 20px; z-index: 2147483647; display: flex; align-items: center; gap: 8px; font-family: system-ui, sans-serif; font-size: 13px; }\n' +
        '#fgc-floating-btn, #fgc-auto-toggle { background: #2c2f33; color: #fff; border: 1px solid #555; border-radius: 8px; padding: 10px 14px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }\n' +
        '#fgc-floating-btn:hover, #fgc-auto-toggle:hover { background: #3a3d42; }\n' +
        '#fgc-auto-toggle.fgc-auto-on { border-color: #4caf50; }\n' +
        '#fgc-auto-toggle.fgc-auto-off { border-color: #e74c3c; opacity: 0.8; }\n' +
        '#fgc-status-badge { background: rgba(0,0,0,0.75); color: #fff; border-radius: 6px; padding: 6px 10px; max-width: 280px; box-shadow: 0 2px 8px rgba(0,0,0,0.4); }\n' +
        '#fgc-status-badge.fgc-running { border-left: 3px solid #f5a623; }\n' +
        '#fgc-status-badge.fgc-ok { border-left: 3px solid #4caf50; }\n' +
        '#fgc-status-badge.fgc-error { border-left: 3px solid #e74c3c; }'
      );
    }

    var wrapper = document.createElement('div');
    wrapper.id = 'fgc-widget';

    var badge = document.createElement('div');
    badge.id = 'fgc-status-badge';
    badge.textContent = UI_STATE.message;

    var btn = document.createElement('button');
    btn.id = 'fgc-floating-btn';
    btn.type = 'button';
    btn.textContent = '\uD83C\uDFAE Claim';
    btn.title = 'Lancer la recuperation des jeux gratuits sur cette page';
    btn.addEventListener('click', function () {
      // Action manuelle : on ignore et on remet a zero le delai de repos.
      clearAutoCooldown('epic');
      clearAutoCooldown('luna');
      updateUiState('running', 'Recherche en cours...');
      dispatch();
    });

    wrapper.appendChild(badge);
    wrapper.appendChild(btn);

    if (location.hostname.indexOf('epicgames.com') !== -1 && !IS_EPIC_PAYMENT_FRAME) {
      var toggle = document.createElement('button');
      toggle.id = 'fgc-auto-toggle';
      toggle.type = 'button';
      function refreshToggleLabel() {
        var enabled = getEpicAutoModeEnabled();
        toggle.textContent = enabled ? '\u23F1\uFE0F Auto hebdo : ON' : '\u23F1\uFE0F Auto hebdo : OFF';
        toggle.classList.toggle('fgc-auto-on', enabled);
        toggle.classList.toggle('fgc-auto-off', !enabled);
      }
      toggle.addEventListener('click', function () {
        setEpicAutoModeEnabled(!getEpicAutoModeEnabled());
        refreshToggleLabel();
        log('Epic Games', 'info', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      refreshToggleLabel();
      wrapper.appendChild(toggle);
    }

    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      var lunaToggle = document.createElement('button');
      lunaToggle.id = 'fgc-auto-toggle';
      lunaToggle.type = 'button';
      function refreshLunaToggleLabel() {
        var enabled = getLunaAutoModeEnabled();
        lunaToggle.textContent = enabled ? '\u23f1\ufe0f Auto Luna : ON' : '\u23f1\ufe0f Auto Luna : OFF';
        lunaToggle.classList.toggle('fgc-auto-on', enabled);
        lunaToggle.classList.toggle('fgc-auto-off', !enabled);
      }
      lunaToggle.addEventListener('click', function () {
        setLunaAutoModeEnabled(!getLunaAutoModeEnabled());
        refreshLunaToggleLabel();
        log('Amazon Luna', 'info', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
      });
      refreshLunaToggleLabel();
      wrapper.appendChild(lunaToggle);
    }

    (document.body || document.documentElement).appendChild(wrapper);
  }

  function updateUiState(status, message) {
    UI_STATE.status = status;
    UI_STATE.message = message;
    var badge = document.getElementById('fgc-status-badge');
    if (!badge) return;
    badge.classList.remove('fgc-running', 'fgc-ok', 'fgc-error');
    if (status === 'running') badge.classList.add('fgc-running');
    if (status === 'ok') badge.classList.add('fgc-ok');
    if (status === 'error') badge.classList.add('fgc-error');
    badge.textContent = message;
  }

