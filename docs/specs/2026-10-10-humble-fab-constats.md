# Humble Store et Fab — Constats de mesure

- **Date** : 2026-10-10
- **Mesure** : navigateur intégré (Chrome réel, réseau de l'utilisateur) et
  `curl`, SANS compte : aucune session, aucun cookie, lecture seule.
- **But** : savoir si les idées « Humble Store » et « Fab » sont prêtes à être
  écrites (règle du design, §13 : une hypothèse se mesure avant de s'écrire).

---

## Humble Store — **PAS PRÊT : rien à réclamer, rien à mesurer**

### Ce qui a été mesuré

```
GET /store/api/search?sort=bestselling&filter=onsale&price=free&request=1&page=0
  navigateur : 200 JSON, num_results 1216, 61 pages   (le filtre price=free est IGNORÉ)
  curl       : 403 Cloudflare « Attention Required »
GET ...&sort=discount (4 pages, 80 offres)
  remise 90-96 % : 79 offres ; 100 % : 1 seule
  la seule : « Stellar End Demo Version », 0,00 € au lieu de 0,01 €, sale_end = 32503708740 (an 3000)
Sorts acceptés : bestselling, discount, newest, alphabetical (price, price_asc, price_low : 400)
Forme d'un résultat : human_name, human_url, machine_name, current_price{currency,amount},
  full_price{...}, sale_end, sale_type, cta_badge, delivery_methods (ex. ["steam"]), platforms
```

### Ce qu'on en conclut

- Il n'y a **aucun jeu gratuit à réclamer** chez Humble au moment de la mesure.
  Le parcours de réclamation (compte Humble, clé ou lien Steam) n'a donc pas pu
  être observé : même situation que la bannière GOG (ROADMAP §1).
- Un détecteur naïf (« prix courant = 0 ») **se tromperait** : la seule offre à
  0 € est une démo à 0,01 € avec une « fin d'offre » en l'an 3000. Il faudrait
  exiger un vrai prix de départ et une vraie date de fin.
- L'API n'est lisible que depuis un navigateur (Cloudflare refuse `curl`) : une
  lecture depuis l'extension ou le WebView passerait, un `OkHttp` nu non.

**Décision** : ne rien écrire. Reprendre quand Humble annonce un cadeau, et
mesurer alors la page de l'offre, la présence d'un bouton de réclamation et
le besoin d'un compte.

---

## Fab (assets Epic) — **PRÊT POUR LA DÉTECTION, PAS POUR LA RÉCLAMATION**

### Ce qui a été mesuré

```
GET https://www.fab.com/limited-time-free   (curl, sans JS, sans compte)
  HTTP 200, ~510 Ko, titre « Fab »
  3 fiches dans le HTML brut : lien /listings/<uuid>, titre, auteur, « -100 % », prix barré
    95ff3c25-… Ready Map Vol 2 - Bridge Environment / Nature   (Six Sides Studios, 96,38 EUR)
    e57ff036-… AdaptivePathfindingSystem: AI Navigation Plugin v2.06 (NordVader, 53,53 EUR)
    d8b51a6c-… Stylized Harvest Farm Environment               (Emberlight Creations, 21,40 EUR)
  fin de l'offre : « 2026-10-20T13:59:00Z » dans le HTML brut (affichée « 20/10 16h59 CEST »)
  un offerId Epic (32 hex) + sandboxId=fn dans la page
Dans le navigateur, la même page appelle /i/listings/prices-infos?offer_ids=… (200)
/i/listings/search?is_free=1… : 403 en curl ; 200 mais "results": [] depuis la page
  (avec les paramètres essayés : non concluant, la page elle-même ne l'appelle pas)
window.__staticRouterHydrationData.loaderData.LimitedFree : null (la liste n'y est pas)
```

### Ce qu'on en conclut

- La **détection** marche sans compte, par un simple GET de la page : identifiant
  de fiche, titre, auteur, prix de référence, date de fin ISO. C'est de la
  lecture HTML, comme le fait déjà `watch/offscreen.js`.
- La **réclamation** exige la session Epic de l'utilisateur et n'a **jamais été
  observée** : ni le bouton d'ajout à la bibliothèque, ni son libellé connecté,
  ni le comportement des fiches déjà possédées. Elle ne peut pas être mesurée
  sans un compte ; le premier clic sera celui de l'utilisateur (comme Steam,
  2.22.0) : option coupée par défaut, échec avec son motif.
- Les motifs de la fiche (`/listings/<uuid>`) et la classe `fabkit-*` sont des
  noms générés : ne PAS s'appuyer sur les classes, seulement sur le lien, le
  `aria-label` et l'horodatage ISO.

**Décision** : la détection de Fab est prête à être écrite (extension et appli),
fixture à l'appui. La réclamation attend une première mesure connectée, par
l'utilisateur.

### Ce que la source en a fait (2026-10-10, emulateur Android 14, vrai reseau)

```
Client reseau de l'appli (OkHttp, en-tetes de navigateur de bureau) :
  GET https://www.fab.com/limited-time-free -> HTTP 200, 521 316 octets, pas de redirection
  FabSource.discover : ok, 3 offres, fin 1792504740000 (2026-10-20T13:59:00Z), valeurs 80.32 / 89.24 / 17.84 EUR,
  vignette media.fab.com (640 px) pour chacune
Appli installee, apres avoir coche « Montrer les assets gratuits Fab » :
  etat : 3 offres Fab, 3 annoncees ; trois notifications « ... -- free on Fab (Epic) »
  ecran : section « FREE FAB ASSETS 03 », jaquettes, valeur, « 10 d », « add it on fab.com »
  un appui sur une ligne lance Chrome sur la fiche https://www.fab.com/listings/<uuid>
```

Pas de defi Cloudflare cote appli ce jour-la. Le garde-fou reste : une page sans le bloc devient une erreur de source, pas « aucune offre ».
Non mesure : la lecture par le service worker de l'extension dans Chrome, et la forme de la page une semaine sans offre.
