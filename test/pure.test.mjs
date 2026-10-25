/* Tests de la logique pure du moteur.
 *
 *   node --test test/
 *
 * Rien ici ne touche au DOM : ce sont les fonctions ou vivent les vrais bugs
 * (resolution de slug Epic, routage des magasins Luna, lecture des codes) et
 * qui ont motive les correctifs v2.3.0 a v2.7.0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine } from './harness.mjs';

const { fgc } = loadEngine();

/* --------------------------------------------------------------------------
 * Epic : slugs et URL  (correctif v2.3.0, erreurs 404)
 * ------------------------------------------------------------------------ */

test('normalizeEpicSlug retire le suffixe /home herite', () => {
  assert.equal(fgc.normalizeEpicSlug('cardpocalypse/home'), 'cardpocalypse');
});

test('normalizeEpicSlug normalise casse, slashes et query', () => {
  assert.equal(fgc.normalizeEpicSlug('/Cardpocalypse/'), 'cardpocalypse');
  assert.equal(fgc.normalizeEpicSlug('cardpocalypse?lang=fr'), 'cardpocalypse');
  assert.equal(fgc.normalizeEpicSlug('  cardpocalypse  '), 'cardpocalypse');
});

test('normalizeEpicSlug rejette ce qui mene a /not-found', () => {
  // Hash d'offre 32 hex des jeux mystere : la page n'existe pas.
  assert.equal(fgc.normalizeEpicSlug('3f18c54a6e00424b8c0f2b3d4e5f6a7b'), null);
  assert.equal(fgc.normalizeEpicSlug('[]'), null);
  assert.equal(fgc.normalizeEpicSlug(''), null);
  assert.equal(fgc.normalizeEpicSlug(null), null);
  assert.equal(fgc.normalizeEpicSlug(undefined), null);
  assert.equal(fgc.normalizeEpicSlug('Un Titre !'), null);
});

test('resolveEpicSlug respecte la priorite offerMappings > catalogNs > productSlug > urlSlug', () => {
  assert.equal(fgc.resolveEpicSlug({
    offerMappings: [{ pageSlug: 'depuis-offer-mappings' }],
    catalogNs: { mappings: [{ pageSlug: 'depuis-catalog-ns' }] },
    productSlug: 'depuis-product-slug',
    urlSlug: 'depuis-url-slug',
  }), 'depuis-offer-mappings');

  assert.equal(fgc.resolveEpicSlug({
    offerMappings: [],
    catalogNs: { mappings: [{ pageSlug: 'depuis-catalog-ns' }] },
    productSlug: 'depuis-product-slug',
  }), 'depuis-catalog-ns');

  assert.equal(fgc.resolveEpicSlug({ productSlug: 'cardpocalypse/home' }), 'cardpocalypse');
  assert.equal(fgc.resolveEpicSlug({ urlSlug: 'dernier-recours' }), 'dernier-recours');
});

test('resolveEpicSlug saute les candidats inexploitables au lieu de s\'arreter', () => {
  assert.equal(fgc.resolveEpicSlug({
    offerMappings: [{ pageSlug: '[]' }],
    productSlug: '3f18c54a6e00424b8c0f2b3d4e5f6a7b',
    urlSlug: 'le-bon-slug',
  }), 'le-bon-slug');

  assert.equal(fgc.resolveEpicSlug({ productSlug: '[]', urlSlug: '[]' }), null);
  assert.equal(fgc.resolveEpicSlug(null), null);
});

test('extractEpicSlug reconnait toutes les formes d\'URL de fiche', () => {
  assert.equal(fgc.extractEpicSlug('https://store.epicgames.com/p/cardpocalypse'), 'cardpocalypse');
  assert.equal(fgc.extractEpicSlug('/fr/p/cardpocalypse'), 'cardpocalypse');
  assert.equal(fgc.extractEpicSlug('/p/cardpocalypse/home'), 'cardpocalypse');
  assert.equal(fgc.extractEpicSlug('/p/cardpocalypse?lang=fr'), 'cardpocalypse');
  assert.equal(fgc.extractEpicSlug('/bundles/un-bundle'), 'un-bundle');
  assert.equal(fgc.extractEpicSlug('https://store.epicgames.com/free-games'), null);
  assert.equal(fgc.extractEpicSlug(''), null);
});

test('isEpicNotFoundPage distingue la page 404 d\'un jeu qui s\'appelle not-found', () => {
  assert.equal(fgc.isEpicNotFoundPage('/not-found'), true);
  assert.equal(fgc.isEpicNotFoundPage('/not-found/'), true);
  assert.equal(fgc.isEpicNotFoundPage('/fr/not-found'), true);
  assert.equal(fgc.isEpicNotFoundPage('/en-US/not-found'), true);
  assert.equal(fgc.isEpicNotFoundPage('/p/not-found-game'), false);
  assert.equal(fgc.isEpicNotFoundPage(''), false);
});

test('buildEpicUrl produit le schema d\'URL actuel (langue en query, pas en chemin)', () => {
  assert.equal(fgc.buildEpicUrl('/p/', 'cardpocalypse'),
    'https://store.epicgames.com/p/cardpocalypse?lang=fr');
  assert.equal(fgc.buildEpicUrl('/bundles/', 'un-bundle'),
    'https://store.epicgames.com/bundles/un-bundle?lang=fr');
});

test('epicStoreUrl ajoute la langue sans casser une query existante', () => {
  assert.equal(fgc.epicStoreUrl('/free-games'),
    'https://store.epicgames.com/free-games?lang=fr');
  assert.equal(fgc.epicStoreUrl('/browse?sortBy=title'),
    'https://store.epicgames.com/browse?sortBy=title&lang=fr');
});

/* --------------------------------------------------------------------------
 * Epic : fenetre de promotion  (v2.3.0, "Bientot disponible" compte a tort)
 * ------------------------------------------------------------------------ */

const T = Date.UTC(2026, 7, 27, 12, 0, 0); // 2026-08-27 12:00 UTC

function promo(startIso, endIso, discountPrice) {
  const el = {
    title: 'Jeu de test',
    productSlug: 'jeu-de-test',
    promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: startIso, endDate: endIso }] }] },
  };
  if (typeof discountPrice === 'number') el.price = { totalPrice: { discountPrice } };
  return el;
}

test('isEpicPromoActiveNow n\'accepte que la fenetre en cours', () => {
  assert.equal(fgc.isEpicPromoActiveNow(promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 0), T), true);
  // Bientot disponible : la fenetre commence apres maintenant.
  assert.equal(fgc.isEpicPromoActiveNow(promo('2026-09-03T15:00:00.000Z', '2026-09-10T15:00:00.000Z', 0), T), false);
  // Terminee.
  assert.equal(fgc.isEpicPromoActiveNow(promo('2026-08-06T15:00:00.000Z', '2026-08-13T15:00:00.000Z', 0), T), false);
});

test('isEpicPromoActiveNow exige un prix remise a zero quand l\'API le fournit', () => {
  assert.equal(fgc.isEpicPromoActiveNow(promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 1999), T), false);
  // Sans information de prix, on fait confiance a la fenetre.
  assert.equal(fgc.isEpicPromoActiveNow(promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z'), T), true);
});

test('isEpicPromoActiveNow ne retient rien sans promotion', () => {
  assert.equal(fgc.isEpicPromoActiveNow({ title: 'Free to play' }, T), false);
  assert.equal(fgc.isEpicPromoActiveNow(null, T), false);
});

test('mapEpicApiElements ne garde que le reclamable et construit l\'URL', () => {
  const actif = promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 0);
  const aVenir = promo('2026-09-03T15:00:00.000Z', '2026-09-10T15:00:00.000Z', 0);
  aVenir.productSlug = 'bientot-disponible';

  const bundle = promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 0);
  bundle.productSlug = 'un-bundle';
  bundle.offerType = 'BUNDLE';

  const sansSlug = promo('2026-08-20T15:00:00.000Z', '2026-09-03T15:00:00.000Z', 0);
  sansSlug.productSlug = '[]';
  sansSlug.urlSlug = '[]';

  const jeux = fgc.mapEpicApiElements([actif, aVenir, bundle, sansSlug], T);

  assert.equal(jeux.length, 2);
  // Array.from : le moteur tourne dans un realm vm, ses tableaux n'ont pas le
  // meme prototype que ceux du test et deepStrictEqual les rejetterait.
  assert.deepEqual(Array.from(jeux, (j) => j.slug), ['jeu-de-test', 'un-bundle']);
  assert.equal(jeux[0].url, 'https://store.epicgames.com/p/jeu-de-test?lang=fr');
  assert.equal(jeux[1].url, 'https://store.epicgames.com/bundles/un-bundle?lang=fr');
  assert.equal(jeux[1].pathBase, '/bundles/');
});

test('mapEpicApiElements tolere une liste vide ou absente', () => {
  assert.equal(fgc.mapEpicApiElements([], T).length, 0);
  assert.equal(fgc.mapEpicApiElements(null, T).length, 0);
  assert.equal(fgc.mapEpicApiElements(undefined, T).length, 0);
});

/* --------------------------------------------------------------------------
 * Plateformes
 * ------------------------------------------------------------------------ */

test('platformNameForHost donne la cle d\'historique, pas le hostname', () => {
  assert.equal(fgc.platformNameForHost('store.epicgames.com'), 'Epic Games');
  assert.equal(fgc.platformNameForHost('www.gog.com'), 'GOG');
  assert.equal(fgc.platformNameForHost('luna.amazon.fr'), 'Amazon Luna');
  assert.equal(fgc.platformNameForHost('gaming.amazon.com'), 'Amazon Luna');
  assert.equal(fgc.platformNameForHost('exemple.test'), 'exemple.test');
  assert.equal(fgc.platformNameForHost(''), '');
});

/* --------------------------------------------------------------------------
 * Amazon Luna : pages, offres, magasin de destination
 * ------------------------------------------------------------------------ */

test('isLunaClaimsListPage ne reconnait que la liste', () => {
  assert.equal(fgc.isLunaClaimsListPage('/claims'), true);
  assert.equal(fgc.isLunaClaimsListPage('/claims/'), true);
  assert.equal(fgc.isLunaClaimsListPage('/claims/home'), true);
  assert.equal(fgc.isLunaClaimsListPage('/claims/home/'), true);
  assert.equal(fgc.isLunaClaimsListPage('/claims/un-jeu-gog/dp/amzn1.pg.item.abc'), false);
  assert.equal(fgc.isLunaClaimsListPage('/'), false);
});

test('isLunaOfferDetailPage ne reconnait que la fiche', () => {
  assert.equal(fgc.isLunaOfferDetailPage('/claims/un-jeu-gog/dp/amzn1.pg.item.abc'), true);
  assert.equal(fgc.isLunaOfferDetailPage('/claims/home'), false);
  assert.equal(fgc.isLunaOfferDetailPage(''), false);
});

test('extractLunaOfferSlug et extractLunaOfferId normalisent en minuscules', () => {
  const url = 'https://luna.amazon.fr/claims/Right-And-Down-GOG/dp/amzn1.pg.item.ABC-123?ref=x';
  assert.equal(fgc.extractLunaOfferSlug(url), 'right-and-down-gog');
  assert.equal(fgc.extractLunaOfferId(url), 'amzn1.pg.item.abc-123');
  assert.equal(fgc.extractLunaOfferSlug('/claims/home'), null);
  assert.equal(fgc.extractLunaOfferId('/claims/home'), null);
});

test('detectLunaStore lit le texte de la fiche en priorite', () => {
  const url = 'https://luna.amazon.fr/claims/right-and-down-gog/dp/amzn1.pg.item.abc';
  // Libelle reel releve le 26/08/2026.
  assert.equal(fgc.detectLunaStore(url, 'Right and Down pour PC sur GOG.com.'), 'gog');
  // Le texte l'emporte sur le suffixe du slug quand les deux divergent.
  assert.equal(fgc.detectLunaStore(url, 'Un jeu pour PC sur Epic Games Store.'), 'epic');
});

test('detectLunaStore retombe sur le suffixe du slug', () => {
  const base = 'https://luna.amazon.fr/claims/';
  const tail = '/dp/amzn1.pg.item.abc';
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-epic' + tail, ''), 'epic');
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-gog' + tail, ''), 'gog');
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-aga' + tail, ''), 'amazon');
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-legacy' + tail, ''), 'legacy');
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-xbox' + tail, ''), 'microsoft');
  assert.equal(fgc.detectLunaStore(base + 'un-jeu-sans-suffixe-connu' + tail, ''), 'unknown');
  assert.equal(fgc.detectLunaStore('', ''), 'unknown');
});

test('lunaStoreLabel et isLunaStoreSkipped', () => {
  assert.equal(fgc.lunaStoreLabel('gog'), 'GOG.com');
  assert.equal(fgc.lunaStoreLabel('microsoft'), 'Microsoft Store');
  assert.equal(fgc.lunaStoreLabel('inexistant'), 'plateforme inconnue');
  // Legacy Games n'est jamais reclame.
  assert.equal(fgc.isLunaStoreSkipped('legacy'), true);
  assert.equal(fgc.isLunaStoreSkipped('gog'), false);
});

/* --------------------------------------------------------------------------
 * Codes d'echange
 * ------------------------------------------------------------------------ */

test('parseRedeemCode reconnait les formes reelles et ignore le reste', () => {
  assert.equal(fgc.parseRedeemCode('Votre code : ABCDE-12345-FGHIJ'), 'ABCDE-12345-FGHIJ');
  assert.equal(fgc.parseRedeemCode('your code: abcde-12345-fghij'), 'ABCDE-12345-FGHIJ');
  assert.equal(fgc.parseRedeemCode('AB12CD34EF56GH'), 'AB12CD34EF56GH');
  // Un mot sans chiffre n'est pas un code.
  assert.equal(fgc.parseRedeemCode('Recuperer'), null);
  assert.equal(fgc.parseRedeemCode(''), null);
  assert.equal(fgc.parseRedeemCode(null), null);
});

test('parseRedeemDeadline lit les deux langues', () => {
  assert.equal(fgc.parseRedeemDeadline('Code a utiliser avant le 5 octobre 2026.'), '5 octobre 2026');
  assert.equal(fgc.parseRedeemDeadline('Redeem before October 5, 2026'), 'October 5, 2026');
  assert.equal(fgc.parseRedeemDeadline('Valable jusqu\'au 16 oct. 2026'), '16 oct. 2026');
  assert.equal(fgc.parseRedeemDeadline('Aucune date ici'), null);
  assert.equal(fgc.parseRedeemDeadline(''), null);
});

test('la file des codes en attente : ajout, mise a jour, filtre, retrait', () => {
  const { fgc: f } = loadEngine({ hostname: 'luna.amazon.fr', pathname: '/claims/home' });

  f.addPendingRedeemCode({ code: 'AAAAA-11111', store: 'gog', title: 'Jeu A' });
  f.addPendingRedeemCode({ code: 'BBBBB-22222', store: 'microsoft', title: 'Jeu B' });
  // Un code deja en file n'est pas duplique.
  f.addPendingRedeemCode({ code: 'AAAAA-11111', store: 'gog', title: 'Doublon' });

  assert.equal(f.getPendingRedeemCodes().length, 2);
  assert.equal(f.getPendingRedeemCodes('gog').length, 1);
  assert.equal(f.getPendingRedeemCodes('gog')[0].title, 'Jeu A');

  f.updatePendingRedeemCode('AAAAA-11111', { attempts: 2, deadline: '5 octobre 2026' });
  const maj = f.getPendingRedeemCodes('gog')[0];
  assert.equal(maj.attempts, 2);
  assert.equal(maj.deadline, '5 octobre 2026');

  f.removePendingRedeemCode('AAAAA-11111');
  assert.equal(f.getPendingRedeemCodes().length, 1);
  assert.equal(f.getPendingRedeemCodes('gog').length, 0);
});

/* --------------------------------------------------------------------------
 * GOG : page d'echange et lecture du resultat
 * ------------------------------------------------------------------------ */

test('isGogRedeemPage couvre la route interne /redeem/<code>', () => {
  assert.equal(fgc.isGogRedeemPage('/redeem'), true);
  assert.equal(fgc.isGogRedeemPage('/redeem/'), true);
  assert.equal(fgc.isGogRedeemPage('/fr/redeem'), true);
  assert.equal(fgc.isGogRedeemPage('/redeem/ABCDE-12345'), true);
  assert.equal(fgc.isGogRedeemPage('/game/un-jeu'), false);
  assert.equal(fgc.isGogRedeemPage(''), false);
});

test('classifyGogWarning distingue les quatre issues', () => {
  assert.equal(fgc.classifyGogWarning('Ce code a deja ete utilise.'), 'used');
  assert.equal(fgc.classifyGogWarning('This code has already been redeemed'), 'used');
  assert.equal(fgc.classifyGogWarning('Code non trouve.'), 'invalid');
  assert.equal(fgc.classifyGogWarning('Code invalide'), 'invalid');
  assert.equal(fgc.classifyGogWarning('Merci de valider le captcha'), 'captcha');
  assert.equal(fgc.classifyGogWarning('Une erreur est survenue'), 'error');
  assert.equal(fgc.classifyGogWarning('   '), null);
  assert.equal(fgc.classifyGogWarning(''), null);
});

test('les motifs de succes GOG reconnaissent les libelles accentues (v2.5.0)', () => {
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test('Le jeu a été ajouté a votre compte'));
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test('has been added to your account'));
  assert.ok(!fgc.GOG_REDEEM_SUCCESS_TEXT.test('Code invalide'));
});

// Constate le 2026-10-11 : GOG a bien ajoute WarBreeds, mais la page dit « Code redeemed successfully » et « successfully added 1 item
// to your GOG account » -- ni l'un ni l'autre n'etait reconnu, l'echange restait « non confirme » alors que le jeu etait au compte.
test('la page de succes GOG de 2026 est reconnue (code redeemed successfully)', () => {
  const page = "Code redeemed successfully! Great news! You've successfully added 1 item to your GOG account. Due to high demand, your game might take a little longer to appear in your Owned Games section, but don't worry — it'll be there shortly! Warbreeds - Amazon Luna Go to my account";
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test(page));
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test('Code redeemed successfully!'));
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test("You've successfully added 2 items to your GOG account."));
  assert.ok(fgc.GOG_REDEEM_SUCCESS_TEXT.test('Code échangé avec succès'));
  // un refus ne ressemble pas a un succes
  assert.ok(!fgc.GOG_REDEEM_SUCCESS_TEXT.test('This code has already been redeemed'));
  assert.ok(!fgc.GOG_REDEEM_SUCCESS_TEXT.test('Code could not be redeemed. Please try again.'));
});

test('le bouton de confirmation GOG accentue est reconnu (v2.7.0)', () => {
  const match = (label) => fgc.GOG_REDEEM_CONFIRM_PATTERNS.some((p) => p.test(label));
  assert.ok(match('Récupérer'));
  assert.ok(match('Recuperer'));
  assert.ok(match('Utiliser le code'));
  assert.ok(match('Redeem'));
  assert.ok(!match('Annuler'));
});

/* --------------------------------------------------------------------------
 * Luna : motifs de reclamation accentues  (v2.4.0 / v2.5.0)
 * ------------------------------------------------------------------------ */

test('les libelles francais accentues de Luna sont reconnus', () => {
  const match = (label) => fgc.LUNA_CLAIM_PATTERNS.some((p) => p.test(label));
  assert.ok(match('Récupérer le jeu'));
  assert.ok(match('Recuperer le jeu'));
  assert.ok(match('Obtenir le jeu'));
  assert.ok(match('Claim'));
  assert.ok(!match('Voir les details'));

  assert.ok(fgc.LUNA_CLAIMED_TEXT.test('dans votre bibliothèque'));
  assert.ok(fgc.LUNA_CLAIMED_TEXT.test('Déjà récupéré'));
  assert.ok(!fgc.LUNA_CLAIMED_TEXT.test('Obtenir le jeu'));
});

/* --------------------------------------------------------------------------
 * Delais de repos  (v2.6.0, relances systematiques)
 * ------------------------------------------------------------------------ */

test('formatDelay reste lisible au-dela de l\'heure', () => {
  assert.equal(fgc.formatDelay(0), '0 min');
  assert.equal(fgc.formatDelay(90 * 1000), '2 min');
  assert.equal(fgc.formatDelay(30 * 60 * 1000), '30 min');
  assert.equal(fgc.formatDelay(60 * 60 * 1000), '1 h 0 min');
  assert.equal(fgc.formatDelay(90 * 60 * 1000), '1 h 30 min');
  assert.equal(fgc.formatDelay(6 * 60 * 60 * 1000), '6 h 0 min');
});

test('le delai de repos se pose, se lit et s\'annule', () => {
  const { fgc: f } = loadEngine();

  assert.equal(f.autoCooldownRemaining('epic'), 0);

  f.setAutoCooldown('epic', 30 * 60 * 1000);
  const left = f.autoCooldownRemaining('epic');
  assert.ok(left > 29 * 60 * 1000 && left <= 30 * 60 * 1000, `reste=${left}`);

  // Les plateformes ne se marchent pas dessus.
  assert.equal(f.autoCooldownRemaining('luna'), 0);

  f.clearAutoCooldown('epic');
  assert.equal(f.autoCooldownRemaining('epic'), 0);
});

test('un delai de repos expire ne bloque plus', () => {
  const { fgc: f } = loadEngine();
  f.setAutoCooldown('luna', -1000);
  assert.equal(f.autoCooldownRemaining('luna'), 0);
});

/* --------------------------------------------------------------------------
 * Demarrage  (correctif v2.13.4, Firefox)
 * ------------------------------------------------------------------------ */

test('le moteur demarre aussi quand load est deja passe (document_idle sous Firefox)', () => {
  // Le demarrage normal se reconnait a son minuteur de 1,5 s.
  const delaisPoses = (readyState) => {
    const delais = [];
    loadEngine({ hostname: 'www.gog.com', readyState, setTimeout: (fn, ms) => { delais.push(ms); return 0; } });
    return delais;
  };
  // Temoin : page encore en chargement, le demarrage attend l'evenement load.
  assert.ok(!delaisPoses('interactive').includes(1500));
  // Page deja chargee : aucun load ne viendra, le demarrage doit partir seul.
  assert.ok(delaisPoses('complete').includes(1500));
});

/* --------------------------------------------------------------------------
 * Defi Cloudflare  (correctif v2.13.4)
 * ------------------------------------------------------------------------ */

test('la page de defi Cloudflare est reconnue, pas les scripts Cloudflare des pages saines', () => {
  const { fgc: moteur, sandbox } = loadEngine();
  const avecScripts = (srcs) => {
    sandbox.document.querySelectorAll = (sel) => (sel === 'script[src]' ? srcs.map((src) => ({ src })) : []);
    return moteur.detectSecurityChallenge();
  };
  // Releves du 2026-09-16 : page 403 « Un instant... » d'Epic.
  assert.equal(avecScripts([
    'https://store.epicgames.com/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=a3c2e40e5b6a468e',
    'https://challenges.cloudflare.com/turnstile/v0/g/330e41bb475c/api.js?onload=khCN8&render=explicit',
  ]).type, 'captcha');
  // GOG /redeem charge Turnstile pour son formulaire : page saine.
  assert.equal(avecScripts(['https://challenges.cloudflare.com/turnstile/v0/api.js?onload=handleCaptchaLoad&render=explicit']), null);
  // Script de detection pose par Cloudflare sur les pages ordinaires.
  assert.equal(avecScripts(['https://store.epicgames.com/cdn-cgi/challenge-platform/scripts/jsd/main.js']), null);
});

/* ------------------------------------------- Epic : l'iframe de paiement */

test('le bouton de la derniere etape est reconnu meme avec un span invisible', () => {
  // Constate le 2026-09-17 sur « Mindcop » : l'iframe de paiement affichait
  // « Ajouter a la bibliotheque », le module ne le trouvait pas, et la
  // commande restait a l'ecran jusqu'a l'expiration des trente secondes.
  //
  // La cause est celle deja payee en 2.13.2 sur la fiche produit : le
  // textContent d'un bouton Epic concatene tous ses descendants, et un span de
  // lecteur d'ecran suffit a faire echouer un motif ancre en ^...$. Le repli
  // non ancre avait ete ajoute a la fiche, jamais a l'iframe.
  const { EPIC_LIBRARY_PATTERNS, EPIC_LIBRARY_LOOSE_PATTERNS } = fgc;

  const propre = 'Ajouter a la bibliotheque';
  const avecSpan = 'Ajouter a la bibliotheque Chargement en cours';

  assert.ok(EPIC_LIBRARY_PATTERNS.some((p) => p.test(propre)), 'le libelle nu doit matcher');
  assert.ok(!EPIC_LIBRARY_PATTERNS.some((p) => p.test(avecSpan)), 'c\'est bien le motif ancre qui echoue');
  assert.ok(EPIC_LIBRARY_LOOSE_PATTERNS.some((p) => p.test(avecSpan)), 'le repli non ancre doit rattraper');
});

test('l\'accord de retractation a le meme repli, sans attraper son contraire', () => {
  const { EPIC_AGREE_PATTERNS, EPIC_AGREE_LOOSE_PATTERNS } = fgc;

  assert.ok(EPIC_AGREE_PATTERNS.some((p) => p.test('J\'accepte')));
  assert.ok(EPIC_AGREE_LOOSE_PATTERNS.some((p) => p.test('J\'accepte et je continue')));
  assert.ok(EPIC_AGREE_LOOSE_PATTERNS.some((p) => p.test('J’accepte')), 'l\'apostrophe typographique compte');

  // La liste ancree porte « accepter » ; la liste large ne le porte pas, et
  // c'est delibere : non ancre, il matcherait « Ne pas accepter ».
  assert.ok(!EPIC_AGREE_LOOSE_PATTERNS.some((p) => p.test('Ne pas accepter')));
});

test('une sous-iframe Epic ne peut pas cliquer ce qui depense de l\'argent', () => {
  // La garde qui rend sur le correctif du 2026-09-17 : on accepte TOUTES les
  // iframes d'Epic, parce que l'adresse de celle qui termine une commande
  // gratuite n'a pas ete mesuree. C'est donc la liste des boutons cliquables,
  // et non l'adresse, qui borne le risque.
  const { EPIC_FREE_ORDER_PATTERNS, EPIC_FREE_ORDER_LOOSE_PATTERNS, EPIC_LIBRARY_PATTERNS } = fgc;

  const paye = ['Valider la commande', 'Place order'];
  for (const libelle of paye) {
    assert.ok(EPIC_LIBRARY_PATTERNS.some((p) => p.test(libelle)),
      'la liste eprouvee, elle, porte bien la commande');
    assert.ok(!EPIC_FREE_ORDER_PATTERNS.some((p) => p.test(libelle)),
      `une sous-iframe ne doit jamais pouvoir cliquer "${libelle}"`);
    assert.ok(!EPIC_FREE_ORDER_LOOSE_PATTERNS.some((p) => p.test(libelle)));
  }

  // Et elle reconnait ce qui ne peut rien couter, span parasite compris.
  assert.ok(EPIC_FREE_ORDER_PATTERNS.some((p) => p.test('Ajouter a la bibliotheque')));
  assert.ok(EPIC_FREE_ORDER_LOOSE_PATTERNS.some((p) => p.test('Ajouter a la bibliotheque Chargement')));
  assert.ok(EPIC_FREE_ORDER_PATTERNS.some((p) => p.test('Add to library')));
});
