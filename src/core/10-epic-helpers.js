  // ---------------------------------------------------------------------------
  // Epic : resolution des slugs et construction des URL
  // ---------------------------------------------------------------------------

  // Ramene un slug brut de l'API ou d'une URL a la forme canonique attendue par
  // le store ("cardpocalypse"). Retourne null si la valeur ne peut pas donner
  // une URL valide :
  //  - "cardpocalypse/home"  -> "cardpocalypse" (suffixe herite retire)
  //  - "[]"                  -> null (jeu mystere sans page)
  //  - "3f18c54a6e00424b..." -> null (hash d'offre 32 hex : mene a /not-found)
  function normalizeEpicSlug(raw) {
    if (raw === null || typeof raw === 'undefined') return null;
    var s = String(raw).trim().toLowerCase();
    s = s.split('?')[0].split('#')[0];
    s = s.replace(/^\/+|\/+$/g, '');
    s = s.split('/')[0];
    if (!s || s === '[]') return null;
    if (/^[0-9a-f]{32}$/.test(s)) return null;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(s)) return null;
    return s;
  }

  /* PAYS ET LANGUE DE LA BOUTIQUE.
   *
   * Lus dans le stockage, avec les defauts cables de CONFIG. Le popup les
   * ecrit, la veille les relit dans le meme espace (watch/storage.js), et le
   * moteur ici : un seul reglage, trois lecteurs, aucune recopie.
   *
   * La lecture est SYNCHRONE (GM_getValue) parce qu'elle sert a construire une
   * URL au moment de l'appel -- d'ou le prechargement de ces deux cles dans
   * ENGINE_KEYS (gm-shim.js). En userscript, GM_getValue est natif et rend le
   * defaut cable tant que rien n'a ete ecrit.
   *
   * La forme est verifiee plutot que la valeur : un code a deux lettres passe,
   * le reste retombe sur le defaut. Le moteur n'a pas besoin de la table des
   * pays -- c'est le popup qui borne le choix (watch/locale.js). */
  function getEpicCountry() {
    var raw = String(GM_getValue('FGC_epic_country', CONFIG.epicCountry) || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(raw) ? raw : CONFIG.epicCountry;
  }

  function getEpicLang() {
    var raw = String(GM_getValue('FGC_epic_lang', CONFIG.epicLang) || '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(raw) ? raw : CONFIG.epicLang;
  }

  /* LA LANGUE DE LA PAGE N'EST PAS CELLE DE L'API.
   *
   * Le moteur choisit ses boutons par ce qui est ECRIT dessus (2.18.0), et ses
   * motifs ne lisent que CONFIG.epicReadableLangs. La 2.20.0 envoyait la langue
   * du pays jusque dans l'URL des fiches : regle sur l'Allemagne, le moteur
   * ouvrait des pages en allemand, ou aucun motif ne reconnait rien. Aucun
   * clic, donc aucun danger -- mais plus aucune reclamation non plus.
   *
   * L'API garde la langue du pays (titres, descriptions) ; la page prend celle
   * du reglage si le moteur la lit, l'anglais sinon. Une langue vide reste
   * vide : c'est le "laisser Epic choisir" de CONFIG.epicStoreOrigin. */
  function getEpicPageLang() {
    var lang = getEpicLang();
    if (!lang) return lang;
    return CONFIG.epicReadableLangs.indexOf(lang) !== -1 ? lang : CONFIG.epicFallbackPageLang;
  }

  function getEpicApiUrls() {
    var country = getEpicCountry();
    var locale = getEpicLang() + '-' + country;
    return CONFIG.epicApiHosts.map(function (host) {
      return host + '?locale=' + encodeURIComponent(locale)
        + '&country=' + encodeURIComponent(country)
        + '&allowCountries=' + encodeURIComponent(country);
    });
  }

  function epicStoreUrl(path) {
    var url = CONFIG.epicStoreOrigin + path;
    var lang = getEpicPageLang();
    if (lang) url += (path.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(lang);
    return url;
  }

  function epicPathBaseFor(el) {
    var isBundle = (el && el.offerType === 'BUNDLE') || ((el && el.categories) || []).some(function (c) { return c && c.path === 'bundles'; });
    return isBundle ? '/bundles/' : '/p/';
  }

  function buildEpicUrl(pathBase, slug) {
    return epicStoreUrl(pathBase + slug);
  }

  // Ordre de priorite (aligne sur les projets communautaires de claim Epic) :
  // offerMappings[].pageSlug (page de l'offre : jeu, add-on, bundle), puis
  // catalogNs.mappings[].pageSlug (page produit du namespace), puis productSlug
  // nettoye, puis urlSlug en dernier recours (souvent un identifiant interne).
  function resolveEpicSlug(el) {
    if (!el) return null;
    var candidates = [];
    ((el.offerMappings) || []).forEach(function (m) { if (m) candidates.push(m.pageSlug); });
    ((el.catalogNs && el.catalogNs.mappings) || []).forEach(function (m) { if (m) candidates.push(m.pageSlug); });
    candidates.push(el.productSlug);
    candidates.push(el.urlSlug);
    for (var i = 0; i < candidates.length; i++) {
      var slug = normalizeEpicSlug(candidates[i]);
      if (slug) return slug;
    }
    return null;
  }

  // Une promo est reclamable si l'une de ses fenetres est en cours ET que le
  // prix remise est a 0 (quand l'API fournit le prix).
  function isEpicPromoActiveNow(el, now) {
    now = typeof now === 'number' ? now : Date.now();
    var batches = (el && el.promotions && el.promotions.promotionalOffers) || [];
    var active = batches.some(function (batch) {
      return ((batch && batch.promotionalOffers) || []).some(function (offer) {
        if (!offer) return false;
        var start = offer.startDate ? new Date(offer.startDate).getTime() : -Infinity;
        var end = offer.endDate ? new Date(offer.endDate).getTime() : Infinity;
        if (isNaN(start)) start = -Infinity;
        if (isNaN(end)) end = Infinity;
        return start <= now && now < end;
      });
    });
    if (!active) return false;
    var total = el.price && el.price.totalPrice;
    if (total && typeof total.discountPrice === 'number') return total.discountPrice === 0;
    return true;
  }

  // Est-ce le jeu offert de la semaine, ou quelque chose de gratuit de toute
  // facon ?
  //
  // La difference se lit dans le prix d'origine, et nulle part ailleurs :
  //   originalPrice > 0 et discountPrice === 0  -> jeu payant, offert un temps
  //   originalPrice === 0                       -> gratuit en permanence
  //
  // Sur la capture reelle du 2026-08-27, le flux freeGamesPromotions rend deux
  // offres actives : Cardpocalypse a 23,99 EUR remis a zero, et un "Pack de
  // Mage Epique" a 0 EUR -- un cosmetique permanent, offerType ADD_ON, qu'il
  // n'y a rien a prendre. Sans ce controle le moteur ouvrait sa page a chaque
  // passage sur le magasin.
  //
  // Rend null quand l'API ne donne pas de prix : on ne devine pas.
  function isEpicFreeToKeep(el) {
    var total = el && el.price && el.price.totalPrice;
    if (!total || typeof total.originalPrice !== 'number') return null;
    if (total.originalPrice <= 0) return false;
    return total.discountPrice === 0;
  }

  // Transforme la liste "elements" de freeGamesPromotions en jeux reclamables
  // maintenant, avec un slug et une URL valides.
  function mapEpicApiElements(elements, now) {
    var games = [];
    (elements || []).forEach(function (el) {
      if (!el || !isEpicPromoActiveNow(el, now)) return;
      if (isEpicFreeToKeep(el) === false) {
        log('Epic Games', 'info', 'Ignore "' + el.title + '" : gratuit en permanence, rien a garder.');
        return;
      }
      var slug = resolveEpicSlug(el);
      if (!slug) {
        log('Epic Games', 'warn', 'Offre gratuite sans slug de page exploitable, ignoree : "' + el.title + '" (productSlug=' + el.productSlug + ', urlSlug=' + el.urlSlug + ').');
        return;
      }
      var pathBase = epicPathBaseFor(el);
      games.push({
        title: el.title,
        slug: slug,
        url: buildEpicUrl(pathBase, slug),
        pathBase: pathBase,
        offerType: el.offerType,
        id: el.id
      });
    });
    return games;
  }

  // Extrait le slug d'une URL de fiche Epic, quelle que soit sa forme :
  // /p/<slug>, /bundles/<slug>, /fr/p/<slug>, /p/<slug>/home, ...?lang=fr
  function extractEpicSlug(url) {
    var pathname;
    try {
      pathname = new URL(url, location.origin).pathname;
    } catch (e) {
      pathname = String(url || '').split('?')[0].split('#')[0];
    }
    var m = pathname.match(/\/(?:p|bundles)\/([^/?#]+)/i);
    return m ? normalizeEpicSlug(m[1]) : null;
  }

  /* LA POSSESSION SE LIT SUR LE BOUTON D'ACHAT DE CETTE FICHE (2.99.7).
   *
   * Jusqu'ici "Dans la bibliotheque" se cherchait n'importe ou dans la page :
   * tout bouton, tout lien visible dont le texte contenait ces mots. Or une
   * page Epic en porte plusieurs sans que CE jeu soit pris -- la carte du
   * second jeu gratuit de la semaine quand le premier est deja au compte, une
   * extension ou une autre edition possedee, une vignette "Dans la
   * bibliotheque" dans un carrousel. Le moteur concluait "deja possede",
   * l'ecrivait "claimed" dans son historique, et tout ce qui suivait -- le
   * module ("tous les jeux de la semaine sont deja recuperes"), l'ordre
   * pilote ("deja recupere") -- s'appuyait sur cette ligne fausse. Signale le
   * 2026-10-01 : des jeux Epic non recuperes, un anti-bot a l'ecran, et
   * "deja recupere".
   *
   * Desormais :
   *   - la fiche d'UN jeu seulement : sur une liste, personne n'est "possede ici" ;
   *   - le bouton d'achat PRINCIPAL, tel qu'Epic le marque
   *     (data-testid="purchase-cta-button"), fait foi quand il est la : son
   *     texte, et lui seul. Un "In Library" ailleurs ne le contredit pas ;
   *   - sinon, le repli par le texte -- mais court (un bouton, pas une
   *     vignette de jeu) et jamais dans un lien vers un AUTRE jeu. */
  var EPIC_CTA_SELECTOR = '[data-testid="purchase-cta-button"]';
  var EPIC_OWNERSHIP_MAX_TEXT = 40;

  function epicElementVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || (el.getClientRects && el.getClientRects().length)));
  }

  function epicOwnershipText(text) {
    return EPIC_OWNERSHIP_PATTERNS.some(function (p) { return p.test(text); });
  }

  // Les boutons d'achat principaux visibles de la page, dans l'ordre du DOM.
  function epicPurchaseButtons() {
    var list;
    try { list = Array.prototype.slice.call(document.querySelectorAll(EPIC_CTA_SELECTOR)); } catch (e) { list = []; }
    return list.filter(epicElementVisible);
  }

  // L'element qui dit "ce jeu est dans votre bibliotheque", ou null.
  function epicOwnedHere() {
    var slug = extractEpicSlug(location.href);
    if (!slug) return null;

    var principaux = epicPurchaseButtons();
    if (principaux.length) {
      // Le libelle livre d'abord ; le sens (navigateur adaptatif) ensuite, pour
      // les langues et les tournures que les motifs ne connaissent pas -- sur
      // CE bouton seulement, jamais sur une vignette d'ailleurs.
      var ctaText = actionText(principaux[0]);
      return (epicOwnershipText(ctaText) || navOwnedText(ctaText)) ? principaux[0] : null;
    }

    var candidates = Array.prototype.slice.call(document.querySelectorAll('button, a, div[role="button"], span[role="button"]'));
    return candidates.find(function (el) {
      if (!epicElementVisible(el)) return false;
      var text = actionText(el);
      if (!text || text.length > EPIC_OWNERSHIP_MAX_TEXT || !epicOwnershipText(text)) return false;
      var anchor = el.closest ? el.closest('a[href*="/p/"], a[href*="/bundles/"]') : null;
      if (anchor) {
        var otherSlug = extractEpicSlug(anchor.getAttribute('href') || '');
        if (otherSlug && otherSlug !== slug) return false;
      }
      return true;
    }) || null;
  }

  // 'owned' | 'unowned' | null (la fiche n'a pas fini de s'afficher, ou ne dit rien).
  function epicCtaState(mustBeEnabled) {
    if (!extractEpicSlug(location.href)) return null;
    if (epicOwnedHere()) return 'owned';
    var principaux = epicPurchaseButtons();
    if (principaux.length) {
      var t = actionText(principaux[0]);
      var achetable = EPIC_MAIN_CTA_PATTERNS.some(function (p) { return p.test(t); })
        || EPIC_LIBRARY_PATTERNS.some(function (p) { return p.test(t); })
        || navClaimsLabel(principaux[0], 'Epic Games');
      return achetable ? 'unowned' : null;
    }
    var cta = findActionElement(document, EPIC_MAIN_CTA_PATTERNS, { mustBeEnabled: mustBeEnabled !== false })
      || findActionElement(document, EPIC_LIBRARY_PATTERNS, { mustBeEnabled: mustBeEnabled !== false });
    return cta ? 'unowned' : null;
  }

  // Attend que la fiche dise ce qu'elle est (le rendu est cote client). null au bout du delai.
  function waitForEpicCtaState(timeoutMs) {
    return waitForElement(function () { return epicCtaState(false); }, { timeout: timeoutMs, interval: 500 })
      .catch(function () { return null; });
  }

  function isEpicNotFoundPage(pathname) {
    return /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?not-found\/?$/i.test(pathname || '');
  }

  function findEpicAnchorForSlug(slug) {
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/p/"], a[href*="/bundles/"]'));
    return anchors.find(function (a) { return extractEpicSlug(a.href) === slug; }) || null;
  }

  // La page /free-games est rendue cote client : les cartes de la semaine
  // apparaissent apres le premier rendu. On leur laisse le temps d'arriver.
  function waitForEpicAnchor(slug, timeout) {
    var immediate = findEpicAnchorForSlug(slug);
    if (immediate) return Promise.resolve(immediate);
    return waitForElement(function () { return findEpicAnchorForSlug(slug); }, { timeout: timeout, interval: 400 })
      .catch(function () { return null; });
  }

  function findEpicFreeNowCards() {
    var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/p/"], a[href*="/bundles/"]'));
    return anchors.filter(function (a) {
      var text = ((a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
      if (!text) return false;
      if (EPIC_UPCOMING_CARD_PATTERN.test(text)) return false;
      if (EPIC_BASE_GAME_CARD_PATTERN.test((a.textContent || '').replace(/\s+/g, ' ').trim())) return false;
      return EPIC_FREE_NOW_CARD_PATTERN.test(text) && !!extractEpicSlug(a.href);
    });
  }

  // Slug ayant mene a /not-found recemment : on ne redirige plus vers lui.
  function isEpicSlugBlocked(platform, slug) {
    var entry = getHistory(platform)[epicHistoryKeyForSlug(slug)];
    if (!entry || entry.status !== 'bad_url') return false;
    if (Date.now() - (entry.ts || 0) > CONFIG.epicBadUrlTtlMs) {
      removeHistoryEntry(platform, epicHistoryKeyForSlug(slug));
      return false;
    }
    return true;
  }

  // Marqueur de reprise "slug|timestamp" : il n'est honore qu'au chargement
  // qui suit de pres une navigation lancee par le script, et il est efface des
  // que la reclamation s'est terminee dans le meme document (navigation SPA).
  function setEpicPendingSlug(slug) {
    try { sessionStorage.setItem('FGC_epic_pending_slug', slug ? slug + '|' + Date.now() : ''); } catch (e) {}
  }

  function clearEpicPendingSlug() {
    try { sessionStorage.removeItem('FGC_epic_pending_slug'); } catch (e) {}
  }

  function takeEpicPendingSlug() {
    try {
      var raw = sessionStorage.getItem('FGC_epic_pending_slug') || '';
      sessionStorage.removeItem('FGC_epic_pending_slug');
      var parts = raw.split('|');
      var ts = parseInt(parts[1], 10);
      if (!parts[0] || isNaN(ts) || Date.now() - ts > CONFIG.epicPendingSlugTtlMs) return null;
      return parts[0];
    } catch (e) { return null; }
  }

  function platformNameForHost(host) {
    host = host || '';
    if (host.indexOf('epicgames.com') !== -1) return 'Epic Games';
    if (host.indexOf('gog.com') !== -1) return 'GOG';
    if (host.indexOf('luna.amazon.') !== -1 || host.indexOf('gaming.amazon.com') !== -1) return 'Amazon Luna';
    return host;
  }

  function epicHistoryKeyForSlug(slug) {
    return 'slug:' + slug;
  }

  /* QUELS JEUX UNE RECUPERATION FORCEE REVOIT-ELLE (2.108.1).
   *
   * Forcer, c'est ne pas se fier a la memoire du moteur (voir
   * epicForceRecheck) -- mais pour les jeux que CE passage va rouvrir, pas pour
   * toute la semaine. Avant la 2.108.1 l'entree "claimed" de TOUS les jeux
   * gratuits etait effacee d'entree, y compris ceux que le passage ne regardait
   * pas : sur une fiche, le module s'arrete apres le jeu de la fiche. Le jeu
   * pris le jeudi n'avait alors plus d'entree, le passage automatique suivant
   * le tenait pour "non reclame" et rouvrait sa fiche -- le jour ou un nouveau
   * jeu etait offert.
   *
   *   - sur la fiche d'un jeu gratuit : ce jeu seul ;
   *   - sur la liste : tous, SAUF ceux dont l'entree est une vraie reclamation
   *     (CLAIMED) -- le moteur ne l'ecrit qu'apres avoir vu le jeu passer dans
   *     la bibliotheque, et le soin de la 2.99.7 ne la touche pas non plus.
   *     Seuls les "deja ..." (ALREADY_*), que l'ancienne lecture a pu mal
   *     faire, se revoient. */
  function epicGamesToRecheck(freebies, currentSlug, history) {
    var list = freebies || [];
    var past = history || {};
    var onFiche = !!currentSlug && list.some(function (g) { return g.slug === currentSlug; });
    return list.filter(function (g) {
      var entry = past[epicHistoryKeyForSlug(g.slug)];
      if (!entry || entry.status !== 'claimed') return false;
      if (onFiche) return g.slug === currentSlug;
      return entry.reason !== 'CLAIMED';
    });
  }

  function getRedirectCount(slug) {
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      return counts[slug] || 0;
    } catch (e) { return 0; }
  }

  function incrementRedirectCount(slug) {
    try {
      var raw = sessionStorage.getItem('FGC_epic_redirect_counts') || '{}';
      var counts = JSON.parse(raw);
      counts[slug] = (counts[slug] || 0) + 1;
      sessionStorage.setItem('FGC_epic_redirect_counts', JSON.stringify(counts));
      return counts[slug];
    } catch (e) { return 1; }
  }

