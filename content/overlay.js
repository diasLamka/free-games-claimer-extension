/* La surcouche : ce que l'extension sait, dit sur la page du magasin.
 *
 * Toute sa connaissance vivait dans le popup. Sur la fiche d'un jeu, chez
 * Epic, GOG ou Steam, elle ne disait rien -- alors que c'est exactement la
 * qu'on se demande si on l'a deja, et si on ferait mieux d'attendre.
 *
 * TROIS REGLES, et chacune repond a une facon de nuire a une page qu'on ne
 * possede pas.
 *
 *  1. AUCUN innerHTML. Le depot n'en compte pas un seul, et ses deux audits le
 *     disent. Tout se construit par noeuds et textContent. Ici la regle vaut
 *     double : le titre affiche vient du catalogue, donc d'une API tierce.
 *
 *  2. RIEN QUAND IL N'Y A RIEN A DIRE. L'immense majorite des fiches sont
 *     inconnues de l'extension. Un bandeau vide sur chaque page de magasin
 *     serait une nuisance permanente, et la premiere raison de desinstaller.
 *
 *  3. AUCUNE ECRITURE, AUCUN CLIC. Ce script LIT, et affiche. Il ne reclame
 *     rien, ne remplit aucun formulaire, ne touche a rien de la page.
 *
 *  4. RIEN DE LISIBLE PAR LA PAGE (2.48.0). Le bandeau dit ce que vous
 *     possedez AILLEURS -- « deja a vous sur GOG depuis mars » -- et il vivait
 *     dans le DOM ordinaire de la page : les scripts d'Epic, de Steam ou de
 *     GOG, et les outils d'enregistrement de session qu'ils embarquent,
 *     pouvaient le lire. Il vit desormais dans une racine d'ombre FERMEE, que
 *     le monde de la page ne peut pas ouvrir. La page voit qu'un element
 *     existe ; elle ne voit pas ce qu'il dit.
 *
 * Il est volontairement separe du moteur : celui-ci agit, celui-ci informe, et
 * les deux n'ont pas les memes droits.
 */
(function () {
  'use strict';

  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : chrome;

  /* L'element pose dans la page, et rien d'autre : pas d'identifiant qu'un
     script de la page puisse chercher. Garde ici pour pouvoir le retirer. */
  var hote = null;

  /* ------------------------------------------------------------ le titre */

  /**
   * Le titre du jeu, lu sur la page.
   *
   * Un selecteur par magasin, et un repli sur le titre du document. Les
   * selecteurs cassent ; le repli, lui, ne casse jamais completement, et un
   * rapprochement approximatif vaut mieux qu'un silence -- ici le pire qui
   * puisse arriver est de ne rien afficher.
   */
  function pageTitle() {
    var hote = location.hostname;
    var sel = null;

    if (/epicgames\.com$/.test(hote)) sel = 'h1[data-testid="pdp-title"], h1';
    else if (/(^|\.)gog\.com$/.test(hote)) sel = 'h1.productcard-basics__title, h1';
    else if (/store\.steampowered\.com$/.test(hote)) sel = '#appHubAppName, .apphub_AppName, h1';

    if (sel) {
      var el = document.querySelector(sel);
      var texte = el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      if (texte) return texte;
    }

    /* Le titre du document porte presque toujours le nom du jeu suivi du nom
       du magasin. On coupe au premier separateur usuel. */
    return String(document.title || '').split(/\s+[|–—-]\s+/)[0].trim();
  }

  function storeOfHost() {
    var hote = location.hostname;
    if (/epicgames\.com$/.test(hote)) return 'epic';
    if (/(^|\.)gog\.com$/.test(hote)) return 'gog';
    if (/store\.steampowered\.com$/.test(hote)) return 'steam';
    return null;
  }

  /* ------------------------------------------------------------ le rendu */

  function el(tag, classe, texte) {
    var n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texte !== undefined && texte !== null) n.textContent = texte;
    return n;
  }

  /**
   * Une phrase par fait.
   *
   * Les libelles sont en dur et en francais, sans passer par la table de
   * traduction : ce script est injecte dans une page tierce et doit rester
   * minuscule. Un module de traduction importe ici alourdirait chaque
   * chargement de fiche pour quatre phrases.
   */
  function phrase(fait) {
    if (fait.kind === 'owned') {
      return 'Vous le possedez deja sur ' + fait.stores.join(', ') + '.';
    }
    if (fait.kind === 'freeNow') {
      return 'Offert en ce moment sur ' + fait.store
        + (fait.end ? ', jusqu\'au ' + new Date(fait.end).toLocaleDateString('fr-FR') : '') + '.';
    }
    if (fait.kind === 'claimed') {
      return 'Recupere par l\'extension'
        + (fait.ts ? ' le ' + new Date(fait.ts).toLocaleDateString('fr-FR') : '') + '.';
    }
    if (fait.kind === 'recurring') {
      return 'Deja offert ' + fait.count + ' fois depuis que vous le suivez. '
        + 'Celui-la, vous pouvez l\'attendre.';
    }
    if (fait.kind === 'missed') {
      return 'Deja offert une fois'
        + (fait.ts ? ' (' + new Date(fait.ts).toLocaleDateString('fr-FR') + ')' : '')
        + ', et manque. Il peut revenir.';
    }
    return '';
  }

  function render(faits) {
    if (hote) { hote.remove(); hote = null; }

    // Regle 2 : rien quand il n'y a rien a dire.
    if (!faits || !faits.length) return;

    /* Regle 4 : le texte vit dans une racine FERMEE. Sans `attachShadow`
       (navigateur trop ancien), on se tait plutot que d'exposer. */
    if (typeof document.body.attachShadow !== 'function') return;
    hote = document.createElement('div');
    hote.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000';
    var racine = hote.attachShadow({ mode: 'closed' });

    var boite = el('div');
    boite.setAttribute('role', 'note');

    /* Le style est pose par propriete, pas par feuille : injecter une feuille
       dans une page tierce peut en modifier le rendu, et ce script n'a le
       droit de rien casser. */
    boite.style.cssText = [
      'max-width:320px', 'padding:10px 12px', 'border-radius:10px',
      'background:#14101F', 'color:#EDE9F5', 'border:1px solid #2E2745',
      'font:13px/1.45 system-ui,sans-serif', 'box-shadow:0 6px 24px rgba(0,0,0,.35)',
    ].join(';');

    var tete = el('div', null, 'Free Games Auto-Claimer');
    tete.style.cssText = 'font-weight:600;font-size:11px;color:#FFB454;margin-bottom:4px';
    boite.append(tete);

    for (var i = 0; i < faits.length; i++) {
      var ligne = el('div', null, phrase(faits[i]));
      ligne.style.marginTop = i ? '3px' : '0';
      boite.append(ligne);
    }

    /* Un bandeau qu'on ne peut pas faire taire est une nuisance. Il se ferme,
       et il ne revient pas avant le prochain chargement. */
    var fermer = el('button', null, 'Fermer');
    fermer.style.cssText = 'margin-top:8px;background:none;border:0;color:#9A90B8;cursor:pointer;padding:0;font:inherit';
    fermer.addEventListener('click', function () { if (hote) { hote.remove(); hote = null; } });
    boite.append(fermer);

    racine.append(boite);
    document.body.append(hote);
  }

  /* ------------------------------------------------------------ la demande */

  function ask() {
    var titre = pageTitle();
    if (!titre) return;

    try {
      api.runtime.sendMessage(
        { type: 'fgc-lookup', title: titre, store: storeOfHost() },
        function (reponse) {
          // Le worker peut dormir : une absence de reponse n'est pas une erreur.
          void api.runtime.lastError;
          if (reponse && reponse.facts) render(reponse.facts);
        },
      );
    } catch (e) { /* contexte invalide apres une mise a jour : on se tait */ }
  }

  /* Les trois magasins rendent leur fiche cote client : le titre n'existe pas
     encore au moment ou ce script s'execute. Une seule relecture differee
     suffit, et elle evite d'installer un observateur permanent sur une page
     qu'on ne possede pas. */
  if (document.readyState === 'complete') ask();
  else window.addEventListener('load', ask, { once: true });
  setTimeout(ask, 2500);
}());
