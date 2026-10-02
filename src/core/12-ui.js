  function getEpicAutoModeEnabled() { return GM_getValue('FGC_epic_auto_mode', true); }
  function setEpicAutoModeEnabled(val) { GM_setValue('FGC_epic_auto_mode', !!val); }

  /* L'interface sur la page appartient au lanceur (content/launcher.js,
     2.51.0) : un seul bouton, dans une racine d'ombre fermee. Le moteur n'y
     pose plus rien lui-meme -- ni element, ni feuille de style. Il declare ce
     qu'il sait faire et dit ou il en est ; sans lanceur, il se tait. */
  function pageUi() {
    var ui = window.FGC_PAGE_UI;
    return ui && typeof ui.engine === 'function' && typeof ui.status === 'function' ? ui : null;
  }

  function autoModeSwitch() {
    if (location.hostname.indexOf('epicgames.com') !== -1 && !IS_EPIC_PAYMENT_FRAME) {
      return {
        kind: 'epic',
        get: getEpicAutoModeEnabled,
        set: function (val) {
          setEpicAutoModeEnabled(val);
          log('Epic Games', 'info', 'Mode auto hebdo ' + (getEpicAutoModeEnabled() ? 'active' : 'desactive') + '.');
        }
      };
    }
    if (location.hostname.indexOf('luna.amazon.') !== -1) {
      return {
        kind: 'luna',
        get: getLunaAutoModeEnabled,
        set: function (val) {
          setLunaAutoModeEnabled(val);
          log('Amazon Luna', 'info', 'Mode auto Luna ' + (getLunaAutoModeEnabled() ? 'active' : 'desactive') + '.');
        }
      };
    }
    return null;
  }

  function injectFloatingButton() {
    var ui = pageUi();
    if (!ui) return;
    ui.engine({
      claim: function () {
        // Action manuelle : on ignore et on remet a zero le delai de repos.
        clearAutoCooldown('epic');
        clearAutoCooldown('luna');
        epicForceRecheck = true;
        navForceRecheck = true;
        updateUiState('running', uiText('engSearching'));
        dispatch();
      },
      auto: autoModeSwitch()
    });
    ui.status(UI_STATE.status, UI_STATE.message);
  }

  function updateUiState(status, message) {
    UI_STATE.status = status;
    UI_STATE.message = message;
    var ui = pageUi();
    if (ui) ui.status(status, message);
  }

