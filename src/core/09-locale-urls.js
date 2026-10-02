  /* Les adresses des magasins dans la langue et le pays du reglage.
   *
   * COPIE ES5 de watch/localize.js (le moteur tourne aussi en userscript, sans
   * modules). test/localize.test.mjs compare les deux sur une table d'adresses :
   * une divergence fait echouer le test, pas l'utilisateur.
   *
   * Epic : segment de langue du chemin, ou ?lang= a defaut. GOG : prefixe de
   * langue du chemin (six langues seulement). Luna : domaine du pays, sauf si
   * une session a ete vue ailleurs (FGC_luna_host) -- on ne deconnecte personne
   * pour traduire une page. Steam n'est pas touche : sa reclamation lit des
   * libelles mesures en anglais. */
  var LOCALE_EPIC_SEGMENTS = { fr: 'fr', en: 'en-US', de: 'de', es: 'es-ES', it: 'it', pt: 'pt-BR', pl: 'pl' };
  var LOCALE_EPIC_KNOWN = ['ar', 'de', 'en-us', 'es-es', 'es-mx', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-br', 'ru', 'th', 'tr', 'zh-cn', 'zh-hant'];
  var LOCALE_GOG_LANGS = ['en', 'de', 'fr', 'pl', 'ru', 'zh'];
  var LOCALE_GOG_HEADS = ['game', 'games', 'redeem'];
  var LOCALE_LUNA_BY_COUNTRY = {
    FR: 'luna.amazon.fr', BE: 'luna.amazon.fr', LU: 'luna.amazon.fr', CH: 'luna.amazon.fr',
    DE: 'luna.amazon.de', GB: 'luna.amazon.co.uk', IE: 'luna.amazon.co.uk',
    IT: 'luna.amazon.it', ES: 'luna.amazon.es', CA: 'luna.amazon.ca',
    NL: 'luna.amazon.nl', PL: 'luna.amazon.pl'
  };
  var LOCALE_LUNA_FORM = /^luna\.amazon\.(com|fr|de|co\.uk|it|es|ca|com\.au|co\.jp|in|com\.mx|com\.br|nl|se|pl|com\.tr)$/;

  function readLunaHost() {
    var host = String(GM_getValue('FGC_luna_host', '') || '').trim().toLowerCase();
    return LOCALE_LUNA_FORM.test(host) ? host : '';
  }

  /* Retient le domaine Luna ou une session est ouverte. Appele seulement
     apres avoir vu la page SANS bouton de connexion. */
  function rememberLunaHost() {
    var host = String(location.hostname || '').toLowerCase();
    if (!LOCALE_LUNA_FORM.test(host) || readLunaHost() === host) return;
    try { GM_setValue('FGC_luna_host', host); } catch (e) { /* stockage indisponible */ }
  }

  function localizeStoreUrl(raw, forClaim) {
    if (typeof raw !== 'string' || !raw) return raw;
    var u;
    try { u = new URL(raw); } catch (e) { return raw; }
    if (u.protocol !== 'https:') return raw;
    var country = getEpicCountry();
    var lang = getEpicLang();
    var host = u.hostname.toLowerCase();
    var first;

    if (host === 'store.epicgames.com') {
      var page = lang;
      if (forClaim) page = CONFIG.epicReadableLangs.indexOf(lang) !== -1 ? lang : 'en';
      else if (!Object.prototype.hasOwnProperty.call(LOCALE_EPIC_SEGMENTS, lang)) page = 'en';
      first = /^\/([A-Za-z]{2}(?:-[A-Za-z]{2,4})?)(?=\/|$)/.exec(u.pathname);
      if (first && LOCALE_EPIC_KNOWN.indexOf(first[1].toLowerCase()) !== -1) {
        var segment = LOCALE_EPIC_SEGMENTS[page];
        if (segment && first[1] !== segment) u.pathname = '/' + segment + u.pathname.slice(first[0].length);
      } else if (u.searchParams.get('lang') !== page) {
        u.searchParams.set('lang', page);
      }
    } else if (host === 'www.gog.com' || host === 'gog.com') {
      if (LOCALE_GOG_LANGS.indexOf(lang) === -1) return raw;
      first = /^\/(en|de|fr|pl|ru|zh)(?=\/|$)/.exec(u.pathname);
      if (first) {
        if (first[1] !== lang) u.pathname = '/' + lang + u.pathname.slice(first[0].length);
      } else {
        var head = u.pathname.split('/')[1] || '';
        if (head === '' || LOCALE_GOG_HEADS.indexOf(head) !== -1) {
          u.pathname = '/' + lang + (u.pathname === '/' ? '/' : u.pathname);
        }
      }
    } else if (/^luna\.amazon\./.test(host)) {
      if (!/^\/claims(\/|$)/.test(u.pathname)) return raw;
      var target = readLunaHost() || LOCALE_LUNA_BY_COUNTRY[country] || 'luna.amazon.com';
      if (u.hostname !== target) u.hostname = target;
    } else {
      return raw;
    }

    var out = u.toString();
    return out === raw || out === raw + '/' ? raw : out;
  }

  function gogRedeemUrl() {
    return localizeStoreUrl(CONFIG.gogRedeemUrl, false);
  }
