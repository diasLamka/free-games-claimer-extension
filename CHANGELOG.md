# Historique du moteur

Extrait du bandeau de commentaires de la v2.7.0, sorti du code le 2026-08-27
lors du decoupage en modules. Le fichier `free-games-claimer.js` est desormais
genere : voir `build/build.mjs`.

## Extension 2.111.1 / Appli 1.37.1 -- 2026-10-11

**Le rapport d'echec ne laisse plus passer un code d'echange**

Une revue de securite du commit 2.111.0 a signale une fuite possible de donnees sensibles dans `watch/failure-report.js`. Releve ligne a ligne, le point reel : le nettoyage ne touchait ni le CHEMIN de l'adresse (`/redeem/<code>`, `/orders/<numero>`) ni les codes a tirets du type `ABCDE-FGHIJ-KLMNO` -- le format d'un code GOG ou Luna. Un code d'echange est un bien ; il pouvait partir dans le texte copie. Tests ecrits d'abord (l'extension : 2 cas rouges avant ; l'appli : `FailureReportCodesTest`).

- Un code a tirets (trois groupes de quatre signes ou plus, majuscules et chiffres) devient `[code]`, dans le texte, le titre et l'adresse.
- Chaque segment du chemin de l'adresse passe par le meme nettoyage (adresse electronique, code, nombre long, jeton) ; un nom de jeu en minuscules (`out-of-sight-b96ca8`) reste lisible, comme `COUNTER-STRIKE 2` ou `FREE-TO-PLAY`.
- Limite connue : un nom d'utilisateur ou un prenom affiche sur une page de compte n'est pas reconnaissable par motif et reste dans les 300 caracteres du texte. Le rapport est copie par toi, relis-le avant de le coller.

## Extension 2.111.0 / Appli 1.37.0 -- 2026-10-11

**Le rapport d'echec : ce que la page montrait quand une recuperation a echoue**

Le 2026-10-11, la phrase de succes de GOG avait change et il a fallu la deviner d'apres une capture envoyee a la main : l'extension savait que la recuperation avait echoue, pas ce que la page disait. Tests ecrits d'abord (extension : `test/failure-report.test.mjs`, `test/failure-page.test.mjs`, et deux cas dans `test/claim.test.mjs` et `test/cycle.test.mjs` ; appli : `FailureReportTest`, deux cas dans `RecoveryScreenTest`).

- **Le moteur joint la page au verdict d'echec** (`src/core/31-bootstrap.js`, `sendToPilot`) : pour `failed`, `challenge`, `needs_login` et `needs_teaching` seulement, l'adresse sans parametres, le titre et les 600 premiers caracteres du texte principal. Le moteur est le meme dans l'extension et dans l'appli.
- **Nettoye avant d'etre garde** : l'adresse perd ses parametres (ils portent des jetons), le texte perd les adresses electroniques, les suites de 8 chiffres ou plus et les mots de 24 signes ou plus ; 300 caracteres au plus. Ce n'est jamais nettoye apres coup, au moment de le montrer.
- **Extension** (`watch/failure-report.js`, `watch/cycle.js`) : l'offre garde son `failure` (date, verdict, motif, page) ; un verdict sans echec l'efface. Dans « Vous attendent », un bouton **Rapport** copie un texte a coller dans un message (version, date, jeu, verdict, motif, page, texte). Le catalogue n'est pas dans la sauvegarde : le rapport n'en part pas.
- **Appli** (`data/FailureReport.kt`, `claim/ClaimSession.kt`) : l'essai garde son `failure` ; la capture d'ecran de la page est prise tant qu'elle est a l'ecran (dossier prive `echecs`, dix au plus -- elles ne chassent jamais une preuve de recuperation ; coupees par Reglages > Donnees > « Garder une preuve », effacees par « Effacer les preuves »). Dans l'onglet Recuperation, un bouton **Rapport** sous chaque jeu bloque ou en attente ouvre la capture et le texte, avec **Copier**. Rien de tout cela n'entre dans la sauvegarde chiffree (liste blanche : les essais n'y sont pas).
- Verifie sur emulateur Android 14 avec une vraie page : une recuperation Epic sans session s'arrete sur le controle anti-robot ; le rapport montre l'adresse de la fiche, le titre « Just a moment... » et la capture. Le popup de l'extension a ete verifie sur ses donnees de demonstration (le bouton, la copie du texte).
- Non verifie : le rapport sur une vraie page GOG ou Steam apres un vrai echec ; la copie dans le presse-papiers de Chrome (le navigateur d'essai la refuse : la fonction a ete verifiee avec un presse-papiers simule). Une recuperation de fond de l'appli ne prend pas de capture (aucune page a l'ecran) mais garde le texte.
- Une page protegee par un defi (Cloudflare) rend un texte vide : le rapport dit alors seulement l'adresse et le titre.

## Extension 2.110.0 / Appli 1.36.0 -- 2026-10-11

**Un echange GOG se juge sur la bibliotheque du compte quand la page ne dit rien de lisible**

La 2.109.0 a rattrape UNE phrase que GOG avait changee. Les phrases changeront encore ; la bibliotheque, elle, dit la verite. Tests ecrits d'abord (`test/gog-redeem-library.test.mjs`, 8 tests ; le test du verdict a ete verifie par mutation : sans la bibliotheque, il echoue).

- Quand l'attente de la page finit sans phrase de succes reconnue ni refus (le verdict `timeout`), le moteur interroge la bibliotheque du compte -- `/account/getFilteredProducts?search=<titre>`, depuis la page GOG elle-meme, donc avec ta session, sans permission ni cookie de plus. Le titre y est (a la casse, aux accents, aux mentions « Edition » et « Amazon Luna » pres, et jamais un titre voisin comme « Warbreeds 2 ») : l'echange est un succes, le code quitte la file, le jeu est inscrit comme echange. Il n'y est pas : l'echange reste « non confirme » comme avant -- GOG previent qu'un jeu peut mettre un moment a apparaitre, rien n'est invente.
- Reseau en panne, 403, reponse illisible : « on ne sait pas », jamais un succes.
- Seul `timeout` est rejuge. Un refus (« code deja utilise », « invalide »), un captcha ou une erreur gardent leur verdict, sans interroger la bibliotheque.
- A l'expiration, le journal garde maintenant les 200 premiers caracteres du texte de la page : la prochaine phrase inconnue se lira, au lieu de se deviner d'apres une capture.
- Meme moteur dans l'extension et dans l'appli : la correction vaut pour les deux.
- Limite connue : si le jeu est deja a toi par ailleurs et que l'echange a en fait echoue sans message, le titre present dans la bibliotheque le fait passer pour reussi. Le code serait de toute facon sans usage pour ce jeu.
- Non verifie : la lecture reelle de la bibliotheque GOG apres un echange (les tests tiennent la logique, pas le reseau ni la session).

## Extension 2.109.0 / Appli 1.35.0 -- 2026-10-11

**Un echange GOG reussi n'est plus declare « non confirme »**

Constate : le code Amazon Luna de WarBreeds a ete echange, GOG affichait « Code redeemed successfully! » et « You've successfully added 1 item to your GOG account », et pourtant le popup disait « GOG : echange non confirme (WarBreeds) ». Cause : le moteur reconnait la reussite a des phrases (`GOG_REDEEM_SUCCESS_TEXT`, `src/core/26-gog-redeem-dom.js`), et celles de GOG avaient change -- « successfully redeemed » etait connu, pas « redeemed successfully », ni « successfully added ». Faute de phrase, le moteur attendait jusqu'au delai, concluait « non confirme » et comptait un essai de plus contre le code. Le jeu, lui, etait bien au compte (GOG previent meme qu'il peut mettre un moment a apparaitre dans « Owned Games »).

- Le moteur reconnait maintenant « redeemed successfully », « successfully added », « added N item(s) to your » et « code echange avec succes ». Un refus (« already been redeemed », « could not be redeemed ») ne ressemble toujours pas a un succes ; le test le tient.
- Le moteur est le meme dans l'extension et dans l'appli : la correction vaut pour les deux (l'appli le recopie a chaque build).
- Un code deja echange a la main reste sans suite : au prochain passage, GOG repond « code deja utilise », le moteur le retire de la file et l'inscrit comme deja echange.
- Non verifie : la phrase des pages allemande et espagnole de GOG (je n'ai que l'anglaise sous les yeux) ; le francais est un calque a confirmer.

## Appli 1.34.0 -- 2026-10-11 (extension inchangee, 2.108.0)

**Simuler une recuperation, et garder une preuve de chacune**

Mise a jour depuis la 1.33.3 : dans l'appli, comme d'habitude. Tests ecrits d'abord.

- **La simulation** (`data/Recovery.kt`, onglet Recuperation, bouton « Simuler »). Elle liste, dans l'ordre, ce que « Tout recuperer » ferait MAINTENANT -- la liste de `Rules.pending`, celle du bouton --, et juge chaque jeu : sera ouvert et recupere, s'arrete ici faute de connexion au magasin (la session perdue, connue de la page Comptes), ou a besoin de toi (une verification). Un resume dit combien seront probablement pris et combien sont bloques. Elle n'ouvre ni ne clique rien. Sur l'emulateur, avec les vraies donnees, elle a montre que les deux jeux Epic s'arreteraient a la connexion.
- **Le carnet de preuves** (`data/Proofs.kt`, `claim/ClaimSession.kt`). Quand un jeu est recupere, l'appli garde une capture de la page de confirmation, avant de passer a l'offre suivante : 540 px de large, JPEG, dans un dossier prive de l'appli, les quarante dernieres. **Elle reste sur ce telephone** : la sauvegarde chiffree n'en emporte pas le nom, l'export et le diagnostic non plus. Un bouton « Preuve » dans « Recuperes recemment » l'ouvre avec sa date, son magasin et l'adresse de la page ; « Effacer les preuves » les supprime toutes ; Reglages > Donnees > « Garder une preuve de chaque recuperation » la coupe. Les noms de fichier sont relus avec une liste blanche (un nom venu d'une restauration ne peut pas sortir du dossier).
- Tests : 476 -> 489 (la simulation, le dossier de preuves -- nom, taille, un fichier par jeu, quarante au plus, nom hors dossier refuse, effacement --, la sauvegarde sans preuve, l'ecran).
- Verifie sur emulateur Android 14 : le bouton « Simuler » et sa fenetre, avec les vraies donnees.
- Non verifie : la CAPTURE elle-meme. Elle demande une vraie recuperation, donc une session de magasin ; les tests tiennent le fichier, pas la page. Une recuperation de fond (sans fenetre) ne prend pas de capture : la vue n'est pas a l'ecran, et mieux vaut pas de preuve qu'une image vide. A confirmer au premier jeu recupere avec l'appli ouverte.

## Appli 1.33.3 -- 2026-10-10 (extension inchangee, 2.108.0)

**Les « figures bizarres » du logo Epic : un defaut de lecture d'Android, corrige**

Ce n'etait pas le logo : les icones SVG ecrivent leurs arcs avec des drapeaux colles (« 0 00.02.433 »), et le lecteur de dessins vectoriels d'Android les lit de travers, ce qui deformait les lettres et le chevron. Les trace des dix logos sont reecrits avec des separateurs explicites (« 0 0 .02 .433 »). Verifie sur emulateur : l'ecusson affiche proprement « EPIC » et « GAMES ».

## Appli 1.33.2 -- 2026-10-10 (extension inchangee, 2.108.0)

**Le vrai logo d'Epic Games, en plus grand**

L'ecusson redessine de la 1.33.1 est retire : c'est le logo officiel (ecusson, « EPIC », « GAMES ») de Simple Icons qui revient, affiche plus grand que les autres logos (34 dp sur les jaquettes, 42 dp dans les filtres) pour qu'on lise « EPIC ». Le mot « GAMES », tout en bas, reste minuscule : c'est le logo qui est ainsi dessine.

## Appli 1.33.1 -- 2026-10-10 (extension inchangee, 2.108.0)

**Le logo Epic redessine, et Amazon prend le triangle de Luna**

- **Epic** : le logo de Simple Icons porte l'ecusson, « EPIC » et « GAMES » ; a 16 dp, c'etait une tache. Il est remplace par un ecusson et son E, dessines pour rester lisibles en petit.
- **Amazon** : le triangle d'Amazon Luna, extrait du fichier « Amazon Luna logo.svg » de Wikimedia Commons (telecharge le 2026-10-10 avec ton accord ; Simple Icons n'a pas Amazon). Il sert pour tout Amazon (Luna et Prime Gaming). La marque reste a son proprietaire.
- Verifie sur emulateur Android 14 : les filtres de l'accueil montrent l'ecusson Epic, GOG, Steam et le triangle Luna.

## Appli 1.33.0 -- 2026-10-10 (extension inchangee, 2.108.0)

**Les logos des magasins, et le choix d'afficher ou non les DLC et ce qui demande un jeu de base**

Mise a jour depuis la 1.32.0 : dans l'appli, comme d'habitude.

- **Les logos** (`res/drawable/logo_*.xml`, `ui/Components.kt`). Neuf icones de Simple Icons (CC0, telechargees le 2026-10-10 avec ton accord) -- Epic (aussi pour Epic mobile), GOG, Steam, Humble, itch.io, Ubisoft, EA, Battle.net, Legacy Games -- converties en images vectorielles. Elles remplacent le nom sur les jaquettes, dans les listes et dans les filtres de l'accueil ; le nom reste lu par TalkBack. Simple Icons n'a pas Amazon, Microsoft, IndieGala, Fanatical ni Fab : ceux-la gardent leur nom. Les marques appartiennent a leurs proprietaires.
- **Deux reglages** (Reglages > Affichage). « Montrer les DLC et contenus en plus » et « Montrer ce qui demande le jeu de base » (un DLC dont le jeu de base n'est pas dans ta bibliotheque Steam, ou une offre que le dernier essai a refusee faute de jeu de base). Tous deux actifs par defaut : rien ne change tant qu'on ne les coupe pas. `Rules.needsBase`.
- Tests : 471 -> 476 (le filtrage des DLC et du jeu de base, sur l'ecran des jeux).
- Verifie sur emulateur Android 14 : le logo Steam s'affiche sur la jaquette.
- Non verifie : les autres logos sur un ecran reel (seul Steam apparaissait dans les offres de l'emulateur), et les deux reglages sur l'emulateur (testes en simulation seulement).

## Appli 1.32.0 -- 2026-10-10 (extension inchangee, 2.108.0)

**Les Reglages en menu, des textes courts, un accueil moins encombre -- dans la charte de l'appli**

Mise a jour depuis la 1.31.1 : dans l'appli, comme d'habitude. La charte (jaune, bordures noires) ne change pas.

- **Les Reglages sont un menu** (`ui/SettingsScreen.kt`). Dix rubriques -- Sante, Comptes, Recuperation, Veille, Notifications, Affichage, Relais PC, Famille, Donnees, A propos --, chacune une ligne avec son icone, ce qui y est regle en quelques mots (« 0 sur 4 connectes », « Epic, GOG, Amazon », « 3 h · Wi-Fi », « Associe »...) et un point d'alerte quand quelque chose demande un regard. Un appui ouvre la page de la rubrique, avec une fleche de retour (le geste retour d'Android aussi). La rubrique « Veille » de avant est coupee en trois : Veille (frequence, Wi-Fi, charge, pays, chien de garde), Notifications, Affichage. Plus de defilement pour trouver un interrupteur.
- **Des textes courts** (`tools/strings.py`). Vingt-neuf textes d'aide, de confidentialite et de sante passent d'un paragraphe a une phrase, dans les quatre langues. Les fenetres de confirmation, les guides par fabricant et les messages d'erreur ne changent pas.
- **Un accueil moins encombre.** Le grand chiffre (« 0,00 EUR, 0 jeu ») n'apparait qu'une fois un jeu recupere ; un bandeau garde son bouton sur la meme ligne quand il tient.
- Tests : 467 -> 471. Verifie sur emulateur Android 14 : le menu s'affiche, et chaque rubrique s'ouvre.
- Non fait : les logos des magasins a la place de leur nom. Il faut des images (voir la reponse), et je n'en telecharge pas sans accord. Les grandes cartes restent le choix par defaut pour les installations existantes (un appui sur la liste ou la grille, en haut de l'accueil, les remplace).

## Appli 1.31.1 -- 2026-10-10 (extension inchangee, 2.108.0)

**La charte de l'appli est gardee ; seul le centre de recuperation reste de la 1.31.0**

La 1.31.0 avait remplace toute la charte (jaune, bordures noires, ombres dures, majuscules) par Material 3. Ce n'etait pas demande : l'appli garde sa charte, et seuls les changements necessaires sont faits. Les ecrans, le theme, les composants et les tests de la 1.30.0 sont restaures tels quels.

- **Reste de la 1.31.0** : l'onglet « Recuperation » (`data/Recovery.kt`, `ui/RecoveryScreen.kt`), maintenant dessine dans la charte (blocs cernes, ombre dure, accent jaune, boutons de la charte), et la cinquieme case de la barre du bas. Le contenu est celui decrit en 1.31.0 : ce que l'appli prendrait maintenant (la liste de `Rules.pending`, celle du bouton), ce qui attend et quand elle reessaie, ce qui demande ton aide, ce qu'elle ne prend pas et pourquoi, les derniers jeux recuperes.
- Tests : 475 -> 467 (les tests du theme Material ne sont plus la), dont le calcul du plan de recuperation et l'ecran.
- Verifie sur emulateur Android 14 avec les vraies donnees : l'onglet s'affiche dans la charte.
- Si la 1.31.0 est deja installee, la 1.31.1 la remplace par la mise a jour habituelle.

## Appli 1.31.0 -- 2026-10-10 (extension inchangee, 2.108.0)

**Une appli Material standard, et un centre de recuperation**

Mise a jour depuis la 1.30.0 : dans l'appli, comme d'habitude. Un changement visible partout : l'ancienne charte « brute » (aplats criards, bordures noires, ombres decalees, majuscules, police monospace) est remplacee par Material 3.

- **Le theme** (`ui/theme/Theme.kt`). Couleurs dynamiques sur Android 12 et plus (celles du fond d'ecran), palette violette de repli en dessous, clair et sombre, typographie du systeme, angles arrondis. Les composants maison (`ui/Components.kt`) gardent leurs noms mais sont des composants Material : `Button`, `Card`, `Switch`, `OutlinedTextField`, `FilterChip`, `LinearProgressIndicator`, `ListItem`.
- **La navigation** : une barre Material a cinq destinations (Jeux, Recuperation, Recuperes, Souhaits, Reglages), un rail sur grand ecran. Les numeros d'onglets que lisent les intents, raccourcis et notifications ne changent pas.
- **L'accueil** : cartes arrondies avec jaquette, puces de filtre standard, section repliable avec chevron, pastilles d'etat avec icone (a la place des « tampons »), ondes au toucher.
- **Le centre de recuperation** (`data/Recovery.kt`, `ui/RecoveryScreen.kt`, nouvel onglet). En haut l'etat (« 2 jeux a recuperer ») et le geste « Tout recuperer » ; dessous, ce que l'appli prendrait maintenant (la liste est exactement celle de `Rules.pending`, donc celle du bouton), ce qui attend un nouvel essai (avec le delai et le numero d'essai), ce qui demande ton aide (connexion, verification), **ce qu'elle ne prend pas, et pourquoi** (coupe dans les reglages, pas de module pour ce magasin, rien a garder, deja recupere, deja a toi, abandonne apres cinq essais), et un carnet des derniers jeux recuperes (date, magasin, appli ou extension, valeur). Chaque ligne a son geste : recuperer, reessayer, se connecter, ouvrir.
- Tests : 451 -> 475 (unitaires), dont le calcul du plan de recuperation et l'ecran. Cinq tests de l'ancien look ont ete adaptes (interrupteur, filtres, majuscules).
- Verifie sur emulateur Android 14 avec les vraies donnees : l'accueil, le centre de recuperation, les Reglages et les Souhaits s'affichent dans le nouveau style.
- Non fait, a suivre : les Reglages restent une liste de sections repliables (a refaire en menu a sous-ecrans), le panneau de recuperation, les cartes de la page Sante, du « Ce soir » et de la carte de l'annee n'ont recu que la peinture du theme, pas une refonte ; les captures d'ecran de test (ScreenshotTest) ne sont pas regenerees ; l'emulateur de test n'a pas verifie le mode sombre ni les grandes polices.

## Appli 1.30.0 -- 2026-10-10 (extension inchangee, 2.108.0)

**La mise a jour se lance depuis la notification, et on en voit la progression**

Mise a jour depuis la 1.29.0 : dans l'appli, comme d'habitude. Chaque point a ses tests, ecrits d'abord ; les deux verifications principales aussi par mutation.

- **Un appui sur « Mise a jour disponible » telecharge** (`notify/Notifier.kt`, `Incoming.kt`, `data/UpdateRunner.kt`). Il ouvrait les Reglages ; il ouvre maintenant l'accueil et
  lance la recherche puis le telechargement de la version annoncee (`UpdateRunner.fromNotification`). L'intent ne porte qu'un numero de version bien forme, jamais une adresse :
  l'APK vient toujours des publications du depot et passe les memes verifications (taille, SHA-256, signature). Si Android n'a pas encore autorise l'appli a installer,
  l'ecran de cette autorisation s'ouvre (le geste unique).
- **Une notification de progression** : une barre, non balayable pendant le telechargement, qui part quand Android prend le relais (fenetre d'installation) ou en cas d'echec.
  La notification « Mise a jour disponible » s'efface des que le telechargement commence. Elle sert aussi pour le bouton du bandeau et celui des Reglages.
- **Une vraie barre de progression sur l'accueil** (`ui/UpdateBanner.kt`, `BrutProgress`) sous le pourcentage, lisible par TalkBack comme un controle de progression.
- Le texte de la notification dit ce que l'appui fait (« Appuie pour la telecharger et l'installer »).
- Rien de nouveau a regler : la notification existait deja (Reglages > Notifications > mise a jour), elle n'arrive que si la mise a jour automatique ne s'est pas faite toute seule
  (reglage « Mise a jour automatique », actif par defaut et seulement quand Android a deja autorise l'appli), et la veille ne cherche qu'une fois par jour.
- Tests : 442 -> 451 (unitaires).
- Non verifie sur un vrai systeme : le depot est prive, la recherche exige le jeton de lecture de l'utilisateur, que ni les tests ni l'emulateur n'ont ; le parcours
  complet (appui, telechargement, barre, fenetre d'installation) n'a donc ete exerce qu'avec un faux reseau, dans la simulation d'Android (Robolectric).

## 2.108.0 / appli 1.29.0 -- 2026-10-10

**Fab : les assets gratuits d'Epic (modeles 3D, plugins, assets Unreal et Unity) sont detectes et annonces**

Mise a jour : l'extension se recharge comme d'habitude, l'appli par la mise a jour integree (meme cle de signature). **Aucune permission obligatoire de plus** :
l'acces a `fab.com` n'est demande que si on suit Fab. Chaque point a ses tests, ecrits d'abord et vus echouer (les verifications les plus importantes aussi par
mutation : en cassant la lecture du prix, des dates ou du reglage, des tests echouent).

- **La mesure d'abord** (`docs/specs/2026-10-10-humble-fab-constats.md`, comme l'exige la feuille de route). La page « Limited-Time Free » de Fab repond 200
  a un GET anonyme, et son HTML brut porte un bloc de donnees (`/i/blades/free_content_blade`) avec les fiches, leurs licences, leur prix et la fin de la
  remise. Les endpoints `/i/...` repondent 403 a un client qui n'est pas un navigateur : on lit la page, pas eux. On lit le bloc, pas le balisage (les noms
  de classe sont generes et changent a chaque deploiement).
- **La source** (`watch/sources/fab.js` pour l'extension, `sources/FabSource.kt` pour l'appli, memes captures, memes attentes). Une fiche est une offre si une de
  ses licences est gratuite MAINTENANT : un vrai prix d'origine remis a zero, une remise commencee et pas finie. Sa fin est la plus proche des licences
  gratuites ; sa valeur, le prix de la licence Personnelle dans la devise de la page. Une page qui n'a plus la forme mesuree (defi Cloudflare, bloc renomme)
  est une **erreur qui le dit**, jamais « aucune offre » -- seule une page lue, dont le bloc est vide, vaut « aucune offre cette semaine ».
- **Suivi sur demande.** Extension : la case « Fab (Epic) » dans les magasins suivis ; cocher demande l'acces a `fab.com` (permission optionnelle, dans le geste
  de la case) et decocher le retire. Appli : Reglages > Veille > « Montrer les assets gratuits Fab », **coupe par defaut** -- ce n'est pas le meme public que les
  jeux. La page (un demi-megaoctet) n'est lue que pour qui suit Fab, une fois par heure au plus dans l'extension.
- **Detecte et annonce, jamais reclame.** L'extension le range parmi les magasins « detectes seulement » (la carte dit « a ouvrir vous-meme ») ; l'appli lui
  donne une section a part, repliee, avec la jaquette, la valeur, le temps restant, et un appui ouvre la fiche. Pas de verdict « piege ou bonne affaire » ni de
  note Steam pour un asset. Une notification arrive a l'ouverture, un rappel au dernier jour, comme pour un jeu.
- Tests : extension 1821 -> 1848 ; appli 413 -> 442 (unitaires), dont les memes captures que l'extension et un test d'ecran (la section n'existe que si on suit Fab).
- Verifie sur emulateur Android 14, vrai reseau : le client reseau de l'appli recoit la page (HTTP 200, 521 Ko) et la source lit les trois offres de la semaine,
  avec fin, valeur et jaquette ; dans l'appli installee, la case, la lecture, la section, la notification et l'appui qui ouvre la fiche dans le navigateur.
- Non verifie : la lecture par l'extension dans Chrome (la page repond 200 a `curl` et au client de l'appli, l'extension envoie les en-tetes d'un navigateur,
  mais le service worker n'a pas ete exerce sur un vrai Chrome) ; la forme de la page une semaine SANS offre (aucune n'a ete observee) ; ce que Fab montre
  a un compte connecte.
- Non fait : **la reclamation**. Elle exige la session Epic, et le bouton d'ajout a la bibliotheque n'a jamais ete observe connecte : ROADMAP, entree 6, avec la
  mesure qu'il faut. **Humble Store** : aucun jeu gratuit a reclamer lors de la mesure (le filtre « gratuit » du site est ignore, la seule offre a 0 € est une
  demo a 0,01 € qui finit en l'an 3000) ; rien n'est ecrit, ROADMAP, entree 7.

## Appli 1.28.0 -- 2026-10-09 (extension inchangee, 2.107.0)

**La veille se regle, la page Sante dit ce qu'Android lui fait, et une sauvegarde chiffree -- a la main ou automatique -- permet de changer de telephone**

Mise a jour depuis la 1.27.1 : dans l'appli, comme d'habitude. Chaque point a ses tests, ecrits d'abord et vus echouer, et la plupart ont ete
essayes sur un emulateur Android (11 et 14), pas seulement sur la simulation des tests unitaires.

- **Veille : seulement en Wi-Fi, seulement en charge** (Reglages > Veille, `work/WatchWorker.kt`). La veille periodique, la reprise d'un quart d'heure, le
  resume du jour et l'ouverture annoncee par Epic attendent un reseau sans limite de donnees et/ou le telephone branche. Un test lance a la main part
  toujours maintenant. Verifie sur emulateur : les contraintes arrivent jusqu'au planificateur d'Android (`dumpsys jobscheduler`). Un reglage change pendant
  qu'un passage tourne est pris en compte au passage suivant (comportement de WorkManager).
- **Ce que la veille coute** (page Sante et diagnostic). Le nombre de passages et le temps de travail des dernieres 24 h, tires du journal ; « au moins » quand
  le journal (30 passages) est plein. Pas d'estimation de batterie : rien ne la mesure.
- **Ce qu'Android fait de la veille, et un guide pour l'en empecher** (`data/Restrictions.kt`, page Sante et diagnostic). Les arrets recents du processus
  (arret force ou appli retiree des recentes : plus de travail ni d'alarme jusqu'a la prochaine ouverture ; tuee pendant qu'elle travaillait), la classe de
  veille (rare ou restreinte retarde les passages) et la batterie restreinte. Un processus en cache qui meurt n'est pas compte (vie normale d'Android), ni
  les processus du moteur de pages : l'historique d'Android les melange, et un essai sur emulateur a montre que leur mort « plus necessaire » faisait crier
  au loup. Un guide par fabricant (OnePlus / OPPO / realme, Xiaomi, Samsung, Huawei / Honor, Pixel, autres) donne les etapes et ouvre les reglages de batterie
  et de l'appli.
- **Une sauvegarde complete et chiffree** (`data/BackupVault.kt`). Reglages, bibliotheque, souhaits, etats des jeux, ce que le moteur a appris, proches :
  un fichier `.fgcbak` que seule la phrase de passe ouvre (AES-256-GCM, cle PBKDF2-HMAC-SHA256 a 210 000 iterations, en-tete authentifie). Jamais de session de
  magasin, de secret du relais ni de jeton : apres une restauration, on se reconnecte et on re-associe le PC. La restauration fusionne (les reglages sont
  remplaces, tout le reste est fusionne, ce qui est deja la l'emporte). **La liste blanche s'applique aussi a la restauration** : un fichier venu d'ailleurs
  pouvait apporter une cle du moteur, des comptes ou le relais d'un autre (signale par la revue de securite automatique des commits).
- **Une sauvegarde automatique** (`data/AutoBackup.kt`, `work/BackupWorker.kt`). Une fois par jour, dans un dossier choisi avec le selecteur du systeme (sans
  permission de stockage), les sept dernieres gardees ; rien n'est supprime avant qu'une ecriture ait reussi. La phrase de passe est chiffree par le
  Keystore. La page Sante previent quand elle ne reussit plus depuis trois jours.
- **Textes a plusieurs paragraphes** (`tools/strings.py`). Un vrai saut de ligne dans le XML devient une espace a la compilation : les paragraphes de
  `background_text` etaient perdus depuis toujours. Le generateur ecrit maintenant `\n` ; ces textes retrouvent leurs paragraphes.
- **Des tests sur un vrai Android** (`src/androidTest`, `android/tools/emulator.ps1`, `.github/workflows/android-emulator.yml`). 21 tests sur emulateur Android 14
  et 11 : le manifeste, les raccourcis, les widgets, les notifications, les intents, le renommage de fichiers, le Keystore, le planificateur, le chiffrement
  a son cout reel. Ils ont montre en chemin qu'un extra illisible fait planter l'appli sur Android 12 et avant et pas sur 13 et apres, et que le premier test
  d'une suite passait a cote de la boite de permission. Le workflow ne bloque pas la release.
- La CI : un quota d'artefacts atteint ne bloque plus la release (l'envoi est une commodite, sept jours de conservation) ; l'emulateur libere de la place
  sur le runner.
- Tests : 346 -> 413 (unitaires), plus les 21 sur emulateur.
- Non verifie : les etapes du guide sur les telephones des fabricants (elles suivent leur documentation, les noms de menus changent d'une version a
  l'autre) ; la sauvegarde automatique avec un fournisseur de cloud (Drive...) ; la duree du chiffrement sur un vrai telephone (environ une seconde sur
  emulateur) ; la restauration sur un telephone neuf ; le declenchement reel de la sentinelle.
- Non fait : les jeux gratuits de Humble Store et de Fab (a mesurer d'abord, comme l'exige la feuille de route : ils demandent une session de magasin que
  les tests ne peuvent pas ouvrir).

## Appli 1.27.1 -- 2026-10-04 (extension inchangee, 2.107.0)

**Trois points laisses de cote par l'audit de la 1.26.1 : un etat illisible repart de sa copie, un intent illisible ne plante plus l'appli, l'etat de la mise a jour n'est plus modifiable de l'exterieur**

Mise a jour depuis la 1.27.0 : dans l'appli, comme d'habitude. Chaque point a ses tests, ecrits d'abord et vus echouer ; pour l'intent, les deux
cas « ne demande rien » ont aussi ete verifies par mutation (sans le `catch` ou sans le controle de l'onglet, ils echouent).

- **Un etat illisible repart de la copie precedente, plus de zero** (`data/StateStore.kt`, `data/Diagnostic.kt`). Un `etat.json` illisible faisait
  repartir l'appli de zero (comptes, souhaits, historique) alors qu'on n'en gardait qu'une trace a cote. Chaque ecriture range maintenant la
  generation precedente en `etat.json.bak` ; au demarrage, un fichier illisible, ou perdu entre les deux renommages d'une ecriture, est remplace par
  la copie lisible la plus recente (le fichier temporaire s'il est complet, sinon la generation precedente). L'ancien fichier reste en
  `etat.json.illisible`. `StateStore.origin` dit d'ou vient l'etat, et le diagnostic partageable le dit quand ce n'est pas le fichier. Le domaine des
  fichiers est deja exclu des sauvegardes et des transferts : la copie l'est aussi. Rien n'est affiche a l'ecran quand l'etat repart de zero faute de
  copie lisible : seul le diagnostic le dit.
- **Un intent illisible ou invalide ne fait plus planter l'appli** (`Incoming.kt`, `ui/AppRoot.kt`). `MainActivity` est exportee : n'importe quelle appli
  peut lui envoyer un intent. L'ecran lisait ses extras sans protection. Sur Android 12 et avant, un paquet d'extras illisible (classe inconnue)
  fait lever BadParcelableException a la lecture de n'importe quel extra, meme d'une cle absente, dans la coroutine de l'ecran : l'appli plantait
  (verifie sur un emulateur Android 11 : sans la protection, le processus meurt). Android 13 et apres neutralise ce cas lui-meme (verifie sur
  Android 14 : rien ne leve), la protection y est sans effet. Un onglet hors des quatre qui existent etait aussi pris tel quel (les Reglages,
  sans onglet choisi). `Incoming.read` lit ce qu'un intent demande d'un bloc et sans jamais lever (lien, partage, raccourci, recuperation, onglet) : une demande
  illisible ou un onglet inexistant ne demandent rien. Les demandes valides se comportent comme avant.
- **L'etat de la mise a jour n'est plus modifiable de l'exterieur** (`data/AppUpdate.kt`). `AppUpdate.status` etait un `MutableStateFlow` public :
  n'importe quel ecran pouvait ecrire un etat que le code de mise a jour n'avait pas produit. C'est maintenant une vue en lecture seule ;
  les ecritures passent par `AppUpdate.publish` (`Install`, `UpdateRunner`).
- Tests : 326 -> 346 (copie de l'etat et ses coupures, diagnostic, lecture des intents, etat de la mise a jour en lecture seule).
- Non fait : une autre appli peut toujours declencher la recuperation en envoyant l'action de raccourci ou l'extra `recuperer` a l'activite exportee.
  C'est l'action normale de l'appli (Android interdit deja a une appli en arriere-plan d'en lancer une), et la fermer demanderait de faire passer le
  raccourci, le widget et les notifications par un alias non exporte, ce qui ne se valide que sur un telephone reel, entree par entree.
- Verifie sur un telephone reel (OnePlus, Android 14) : l'APK publie s'installe par-dessus la 1.27.0 en gardant les donnees ; l'appli survit a des
  intents envoyes par `adb` (onglet hors plage, extra du mauvais type, raccourcis « Ce soir » et « Souhait », partage) ; la sentinelle se repose apres
  la mise a jour, a 7,5 h du dernier passage (2,5 x 3 h).
- Verifie sur emulateur (Android 11 et 14, le vrai systeme) : un paquet d'extras illisible envoye a l'activite exportee, et la copie `.bak` de l'etat
  sur le vrai systeme de fichiers d'Android.
- Non verifie : l'appui long sur l'icone, le widget et une notification touchee a la main sur un telephone (leurs intents passent par `Incoming`,
  couverts par des tests).

## Appli 1.27.0 -- 2026-10-04 (extension inchangee, 2.107.0)

**La veille se laisse surveiller : son journal, une sentinelle qui previent quand elle s'arrete, un diagnostic a partager et un test a la demande**

Mise a jour depuis la 1.26.2 ou la 1.26.1 : dans l'appli, comme d'habitude (meme cle de signature). Quand Android bridait l'appli en
arriere-plan, plus rien ne le disait : la veille etait justement ce qui devait prevenir. Quatre ajouts, tous dans Reglages > Sante, chacun avec ses
tests ecrits d'abord et vus echouer.

- **Le journal des passages** (`data/PassLog.kt`, `data/Watcher.kt`). Chaque passage de la veille laisse une ligne : quand, pourquoi (fond, ecran,
  test), combien d'offres lues et combien de nouvelles, en combien de temps, ecran eteint ou non, ce que la recuperation de fond a pris, et comment il
  a fini (ok, avec erreurs, en echec, annule). Les trente derniers sont gardes dans l'etat, les huit derniers affiches dans la page Sante, et la meme
  ligne part dans `adb logcat -s FGC`. Un passage annule est note avant que l'annulation ne se propage.
- **Une sentinelle qui previent quand la veille ne tourne plus** (`notify/Watchdog.kt`, reglage *Sentinelle*, sur par defaut). Une alarme que chaque
  passage repousse : elle ne sonne que si plus aucun passage n'a eu lieu depuis deux fois et demie l'intervalle (trois heures au moins). La
  notification dit depuis quand et ouvre les reglages de l'appli ; elle ne se repete qu'au bout d'une journee. Alarme inexacte qui traverse le Doze :
  pas d'autorisation de plus. La page Sante dit aussi qu'une veille est arretee et propose d'aller aux reglages d'Android, et compte les
  notifications refusees parmi ce qu'il faut regarder.
- **Un diagnostic a partager** (`data/Diagnostic.kt`). Un bouton l'envoie par le menu « Partager » d'Android : versions, reglages, derniers
  passages, etat de chaque magasin, heures en UTC. Rien de personnel : ni cookies, ni memoire du moteur, ni noms de compte ou de famille, ni titres de
  souhaits ou de bibliotheque, ni identifiant ou erreurs du relais. Un test verrouille cette liste d'exclusions.
- **Un test de la veille a la demande** (`work/WatchWorker.kt`, `notify/Notifier.kt`). Un bouton lance un passage comme le vrai, dans le travail de
  fond de WorkManager (pas un appel depuis l'ecran) ; on verrouille le telephone et le resultat arrive en notification : ce qui a ete trouve, la
  duree, si l'ecran etait eteint, ce que la recuperation de fond a pris. Un test qui echoue le dit une fois au lieu d'etre rejoue.
- Tests : 292 -> 326 (journal, sentinelle, diagnostic et sa confidentialite, partage, test a la demande, notification de test). Le test de la page
  Sante cible desormais la ligne complete d'un passage : le mot « background » est aussi dans le bouton de test.
- Verifie sur un telephone reel (OnePlus, Android 14) : l'APK signe par la CI (ancienne et nouvelle cle) s'installe par-dessus la 1.26.1 en
  gardant les donnees ; le bouton de test donne sa notification, ecran eteint ; la page Sante montre le passage de test ; le diagnostic part
  par le menu « Partager ».
- Non verifie : la sentinelle jusqu'a son declenchement reel (alarme inexacte en Doze).

## Appli 1.26.2 -- 2026-10-04 (extension inchangee, 2.107.0)

**Treize defauts de l'audit corriges : l'annulation, l'etat sur disque, le budget du fond, le jumelage du relais, les jaquettes lentes, l'accessibilite, les calculs repetes, les notifications refusees et l'import**

Mise a jour depuis la 1.26.1 : dans l'appli, comme d'habitude (meme cle de signature). Les points sont ceux du rapport d'audit
de la 1.26.1 qui n'avaient pas encore ete traites ; chacun a son test, ecrit d'abord et vu echouer.

- **Une coroutine annulee ne continue plus comme si son appel avait echoue** (`data/Safe.kt`). `runCatching` et `catch (Exception)`
  attrapent aussi l'annulation : la veille annulee gardait « inconnu » comme reponse d'un magasin, ecrivait « introuvable » pour une
  fiche qu'elle n'avait pas fini de lire (`Odds`), ou croyait un « non » de session que `SessionProbe` devait justement confirmer.
  `runCatchingSuspend` rend l'annulation ; les `catch` autour d'appels suspendus font de meme (ClaimSession, Watcher, Accounts,
  Tonight, Taste, Odds, AppRoot).
- **L'etat est ecrit meme si l'appelant est annule, et un disque en echec ne plante plus** (`data/StateStore.kt`). `update` publiait
  puis ecrivait dans un `withContext` : annule d'emblee, le fichier gardait l'ancien etat pendant que l'ecran voyait le nouveau ; et
  une `IOException` (disque plein) remontait jusqu'aux `scope.launch` de l'interface. Calcul, publication et ecriture se font maintenant
  d'un bloc, hors du fil de l'appelant (le parse JSON d'une sauvegarde importee n'est plus sur l'ecran), sans annulation possible ; un
  echec d'ecriture est retenu (`lastSaveError`).
- **Les dix minutes du fond courent depuis le debut du passage** (`claim/BackgroundClaim.kt`, `work/WatchWorker.kt`). La recuperation
  ancrait ses trois minutes sur sa propre entree, apres la lecture des magasins (jusqu'a plusieurs minutes) : un jeu entame tard depassait
  la limite de WorkManager et le travail etait coupe en plein jeu.
- **Associer le telephone au PC ne plante plus quand le Keystore echoue** (`data/RelayLink.kt`). `pair` rend `PAIRED`, `BAD_CODE` ou
  `NOT_STORED` ; l'ecran dit pourquoi au lieu de planter, ou de dire a tort « ce n'est pas un code » (une chaine de plus, en quatre langues).
- **Une jaquette lente ne retarde plus les notifications d'alarme** (`notify/CoverBudget.kt`, `data/Http.kt`). « Derniere chance » et « Plus
  tard » telechargent la jaquette dans les dix secondes de `goAsync`, avec des delais d'appli de 15, 25 et 40 s. `Http.bytes` accepte un
  delai qui borne l'appel entier ; la notification dispose d'un plafond par image (5 s) et d'une fenetre de 6 s partagee par toutes celles du
  recepteur, puis sonne sans image. Elle n'est jamais annulee.
- **Interface : cibles de 48 dp, noms accessibles, interrupteur lisible, marges systeme et clavier** (`ui/Modifiers.kt`, `Components.kt`,
  `LoginScreen.kt`, `AppRoot.kt`). `clickableNoRipple` donne une cible d'au moins 48 dp (le clic avant la taille, pour que toute la cible
  reagisse) ; le « ✕ » du panneau et des souhaits, `[+]`, `■` et « Se deconnecter » ont un nom (6 chaines) ; le filtre de magasin et le choix
  de l'interrupteur disent s'ils sont actifs ; l'interrupteur lit ses libelles dans les ressources (il etait en dur en francais) et son option
  inactive passe de `#8A8A8A` (3,45:1) a `#595959` (7:1) ; la pastille d'un proche dit s'il est connecte. Le titre d'une tuile gardait **une seule
  ligne** (`height(40.dp)` + `Ellipsis` retire en silence les lignes qui ne tiennent pas) : `heightIn`. La page de connexion se garde des barres du
  systeme, la mise en page etroite du clavier, comme la large.
- **Le titre normalise n'est plus recalcule a chaque acces** (`model/Model.kt`, `data/Rules.kt`). Decomposition Unicode et quatre regex tournaient
  pour chaque offre, chaque entree de la bibliotheque et chaque souhait, a chaque recomposition. Une fois par objet maintenant (l'etat est
  immuable), hors de la sauvegarde ; l'ecran des jeux ne recalcule ses listes que si l'etat, l'heure, le filtre ou la recherche changent.
- **La page Sante dit quand les notifications sont refusees** (`ui/HealthGroup.kt`). Les alertes « derniere chance », l'aide du PC, les defis et
  les connexions disparaissaient sans un mot ; un avis et un bouton vers les reglages de notification de l'appli, relus au retour des reglages
  d'Android, et le chiffre de la section compte l'avis (trois chaines).
- **Importer une sauvegarde ne charge plus un fichier sans limite** (`data/BackupIO.kt`). Le fichier etait lu en entier avant que sa taille soit
  controlee ; la lecture s'arrete maintenant a 8 Mo.
- **Outil** : `tools/strings.py` ecrit en LF meme sous Windows (il reecrivait les quatre `strings.xml` en CRLF : 1 770 lignes changees pour une chaine).
- Tests : 260 -> 292 (annulation, budget du fond, etat, jumelage, jaquette lente, accessibilite, marges et clavier, cache des titres, notifications,
  import). Toute la suite se lance sur un poste de developpement.
- Non fait : l'intent exporte de `MainActivity` (une autre appli peut lancer la recuperation : l'action normale de l'appli, jugee mineure) ; le
  `StateStore.load` qui repart de zero si le fichier est illisible (une copie `.illisible` est gardee) ; `AppUpdate.status` reste un `StateFlow` modifiable.
- Non verifie : une jaquette lente dans un recepteur reel en Doze, un moteur de rendu qui meurt pendant une recuperation, et le clavier en portrait
  sur un telephone reel (les marges et le clavier sont testes avec des incrustations simulees).

## Appli 1.26.1 -- 2026-10-04 (extension inchangee, 2.107.0)

**Cinq defauts de l'audit corriges (la cle de signature, les moteurs de rendu tues, la veille qui s'annulait, la mise a jour bloquee, les intents rejoues), et une nouvelle cle de signature**

**A LIRE AVANT DE METTRE A JOUR : sur Android 13 et plus, la 1.26.0 refusera cette version, il faut l'installer UNE
fois a la main.** La 1.26.1 est signee avec une nouvelle cle (voir plus bas), adoptee par Android 13 et plus. Android
l'accepte par-dessus la 1.26.0 sans rien perdre, mais le controle de la 1.26.0 compare les certificats a
l'identique et dira « le fichier n'est pas la bonne appli » dans le bandeau de l'accueil. Telecharger l'APK de la
release `app-v1.26.1` sur le telephone et l'ouvrir : sessions, historique et reglages restent. A partir de la
1.26.1 les mises a jour se refont dans l'appli (elle sait lire une rotation de cle). Sur Android 9 a 12 l'APK porte
encore l'ancienne cle : la mise a jour dans l'appli marche comme avant.

- **La cle de signature sort du depot** (`.github/workflows/android.yml`, `test/android-keystore.test.mjs`).
  `android/keystore/` etait suivi par git, mots de passe compris : qui lisait le depot pouvait signer une
  « mise a jour » que l'appli installe. Les cles sont des secrets du workflow, ecrits sur le disque du runner le
  temps du build ; le dossier est ignore, et un test echoue si un fichier de cle revient. Le workflow verifie avec
  `apksigner` que l'APK porte nos empreintes (et la nouvelle) avant de rien deposer.
- **Une nouvelle cle, par rotation** (`android/signing/lineage.bin`, `data/Install.kt`). L'ancienne restait dans
  l'historique git. La chaine ancienne -> nouvelle (APK Signature Scheme v3, `apksigner rotate`, publique : des
  certificats) est dans le depot ; le workflow signe avec l'ancienne puis resigne avec la chaine. **Android 13 et plus
  adoptent la nouvelle cle**, et l'ancienne n'a pas la capacite de retour en arriere : elle ne pourra plus signer de
  mise a jour pour un telephone passe a la nouvelle. **Android 9 a 12 gardent l'ancienne** (reglage prudent
  d'apksigner : la rotation y a eu des bugs) : l'ancienne cle reste donc dans les secrets. `Install.sameApp` accepte
  maintenant un APK dont la chaine contient le certificat installe (`signersAccepted`) ; toute autre cle reste refusee.
- **Un moteur de rendu de WebView tue ne tue plus l'appli** (`claim/RenderSafeClient.kt`). Aucune des trois WebView
  (recuperation, controle de session, connexion) n'avait `onRenderProcessGone` : Android arretait tout le processus,
  et la recuperation « ecran eteint » sur un telephone a court de memoire emportait l'appli. La page morte est
  jetee et refaite, l'offre en cours finit en echec avec la raison (au lieu d'attendre jusqu'a cinq minutes), les
  suivantes repartent d'une page saine ; la connexion se refait deux fois puis rend l'ecran.
- **La veille ne s'annule plus elle-meme** (`work/WatchWorker.kt`). En fin de passage elle programme l'ouverture
  suivante d'Epic sous le nom unique de l'ouverture, avec `REPLACE` ; quand c'etait cette ouverture qui l'avait
  reveillee, le passage en cours etait annule et supprime avant la recuperation de fond qui devait le suivre.
  `KEEP` depuis la veille (comme le resume du jour), `REPLACE` seulement depuis l'ecran.
- **La mise a jour ne reste plus bloquee sur « Telechargement »** (`data/UpdateRunner.kt`). Le bandeau est un
  element d'une liste : defiler annulait sa coroutine et le telechargement, et l'etat ne revenait jamais. Il tourne
  maintenant dans la portee du processus (un seul a la fois), et annule en route il redevient « Disponible ».
- **Une recreation de l'activite ne rejoue plus l'intent qui l'a lancee** (`MainActivity.kt`). Processus tue puis
  retour par les Recents, ou taille de police changee : une recuperation demandee par une notification, un widget
  ou un raccourci repartait seule, en passant outre le recul. La taille de police est maintenant suivie par
  l'activite (`fontScale`) : la changer ne detruit plus la recuperation en cours.
- **La CI** : cache Gradle (8 min -> 5 min 45), et la suite complete se lance maintenant sur un poste de
  developpement (JDK 17 + SDK 36 ; depuis un chemin sans espace, Robolectric encodant l'espace en `%20`).
- Tests : 256 -> 260 (garde de la cle, rotation, moteur de rendu, planificateur, mise a jour, intents).
- Non fait : l'intent exporte de `MainActivity` (une autre appli peut lancer la recuperation : l'action normale de
  l'appli, jugee mineure) ; `AppUpdate.status` reste un `StateFlow` modifiable de partout.
- Non verifie : l'installation reelle de la rotation sur un telephone (a faire avec l'APK de la branche avant la
  release), et le comportement d'une page dont le moteur de rendu meurt, sur un telephone reel.

## 2.107.0 / appli 1.26.0 -- 2026-10-03

**La mise a jour sans confirmation (une permission manquait), plus aucun bouton de recuperation sur l'accueil, le compte Epic interroge avant l'onglet, et une page « Sante » par magasin**

Signale : « j'ai toujours la confirmation avant la maj ».

- **Pourquoi la confirmation revenait** (`AndroidManifest.xml`, `data/Install.kt`). Depuis Android 12,
  l'installateur d'origine d'une appli peut la mettre a jour sans rien demander, a condition de
  declarer `UPDATE_PACKAGES_WITHOUT_USER_ACTION` (une permission *normale*, accordee a l'installation, sans
  fenetre) -- la documentation de `setRequireUserAction` la liste parmi les conditions. L'appli ne la
  declarait pas : meme installee par elle-meme, Android demandait toujours. La 1.25.0 annoncait le
  contraire (« le systeme installe sans rien demander ») ; c'etait faux faute de cette ligne. Declaree
  maintenant, et un test lit le manifeste pour qu'elle ne disparaisse pas.
- **Ce qu'Android fera de la prochaine mise a jour, dit dans les Reglages** (`Install.silence`). Quatre
  cas, lus et non promis : avant Android 12 (il demande toujours) ; l'autorisation « Installer des
  applis inconnues » manque ; l'appli a ete installee par autre chose (navigateur, gestionnaire de
  fichiers, Telegram) -- UNE confirmation, car l'installateur d'origine devient cette appli des
  qu'elle a installe elle-meme une mise a jour ; ou l'appli est son propre installateur d'origine --
  aucune confirmation attendue. **Donc : la mise a jour 1.25.0 -> 1.26.0 demandera encore** (c'est la 1.25.0,
  sans la permission, qui installe). Faite PAR L'APPLI (bandeau « Mettre a jour »), la 1.26.0 devient son propre
  installateur d'origine : la suivante peut se faire seule. Faite en ouvrant l'APK a la main, Android garde le
  navigateur ou le gestionnaire de fichiers comme installateur et demandera encore une fois. Les Reglages
  disent lequel des quatre cas est le bon.
- **« Tout recuperer » quitte l'accueil.** Il restait UN bouton ; l'appli recupere deja a l'ouverture
  et en fond. Le geste vit maintenant dans Reglages > Recuperation (« Recuperer maintenant (N) »),
  dans la notification et sur l'icone de l'appli.
- **Epic : le compte est interroge avant l'onglet** (`watch/owned-check.js`, `OwnedCheck.kt`). L'historique des
  commandes du compte (la page « Transactions », ce que lit deja « Tout importer ») : au plus trois pages, lues
  UNE fois par cycle quel que soit le nombre d'offres Epic. Un jeu offert deja reclame y figure comme une
  commande a zero ; on le reconnait a l'identifiant de l'offre, ou a un titre IDENTIQUE (editions et casse
  pres). Commande remboursee ou annulee : ecartee. Epic repond autre chose que du JSON (verification,
  mur anti-robot, session absente) : on ne sait pas, rien n'est bloque, une ligne du journal le dit.
  Meme verdict `owned` que GOG : definitif, ni onglet ni jeton du plafond horaire.
- **Steam et Amazon : rien de neuf, et c'est dit.** Steam n'en a pas besoin : sa liste de jeux possedes
  (`dynamicstore/userdata`, par identifiant) est lue a chaque veille et ecarte l'offre avant qu'elle soit
  candidate. Amazon (Prime Gaming) n'a pas d'adresse que l'on sache lire d'ici -- sa page ne se laisse
  interroger que par un jeton de page et un schema non mesure : on n'invente pas d'adresse, la page
  tranche comme avant, avec la regle « une question, puis plus rien ».
- **La page « Sante »** (`data/Health.kt`, `ui/HealthGroup.kt`, Reglages, en premiere section). Par magasin :
  la session, la derniere recuperation, le dernier echec DEPUIS cette reussite (un verdict de probleme, une
  offre jamais obtenue ensuite, au plus quatorze jours), ce qui attend, et si le controle du compte se laisse
  lire (« lisible », « ne s'est pas laisse lire, la page tranche », « tes N jeux sont lus a chaque
  verification » pour Steam, « aucun » pour Amazon). En tete : la derniere verification et les sources en
  erreur. Le chiffre de la section : les magasins a regarder. Tout vient de ce que l'appli a deja note
  (`AppState.oracle` en plus) ; la page ne mesure rien.
- Tests : 9 Kotlin (`HealthTest`), 7 Kotlin Epic + lecture notee (`OwnedCheckTest`), 2 sur la mise a jour (cas
  d'`Install.silence`, manifeste), 8 worker Epic (lecture des pages, identifiant, titre, remboursement,
  illisible, trois pages au plus, une seule lecture par cycle, cycle de bout en bout) -- mutations verifiees.
- Non verifie : la forme REELLE de l'historique des commandes Epic avec une session (jamais mesuree d'ici ;
  Epic le garde derriere une verification), la reponse d'Epic a OkHttp depuis l'appli (Cloudflare : sans
  doute « illisible », ce que la page Sante dira), l'installation silencieuse sur un vrai telephone.

## Appli 1.25.0 -- 2026-10-03 (extension inchangee, 2.106.0)

**L'accueil plus clair : plus de bouton « Recuperer » sur chaque jeu, la mise a jour a la une et automatique, et le choix de la facon de poser les jeux**

- **Plus de « Recuperer » sur les jeux.** L'appli recupere deja toute seule ; un bouton par jeu
  doublait l'ecran de trois boutons. Les jeux n'ont plus que leur etat (tampon, motif de l'echec) et un
  toucher ouvre la page du magasin. Il reste UN geste : « Tout recuperer (4) », sur une ligne, quand
  quelque chose attend. (Seul le toucher sur un jeu precis permettait de lui redemander « montre-moi le
  bouton » : ce cas passe par « Tout recuperer ».)
- **Trois facons de poser les jeux** (`ui/OfferTiles.kt`, `Settings.tiles`). Trois pastilles a gauche des
  magasins -- et dans Reglages > Veille -- : **grandes tuiles** (la jaquette en 16/9, une colonne au
  telephone, deux puis trois sur grand ecran), **liste** (une ligne par jeu : petite jaquette, titre,
  valeur, temps qui reste -- le plus compact) et **grille** (deux colonnes au telephone, jusqu'a quatre,
  le titre sur deux lignes). Le choix est retenu ; une sauvegarde d'avant la 1.25.0 retombe sur les
  grandes tuiles.
- **La mise a jour sur l'accueil** (`ui/UpdateBanner.kt`). Quand une version plus recente existe : un
  bandeau « Version X disponible » et UN bouton « Mettre a jour » (telechargement, progression, puis
  l'installation d'Android). La recherche se fait une fois a l'ouverture de l'appli. Rien du tout quand
  tout va bien ou quand la recherche n'a pas pu se faire (depot prive sans jeton, pas de reseau) : cela
  reste lisible dans Reglages > A propos. Un echec d'installation, lui, est dit sur l'accueil, avec
  « Reessayer ». Meme chemin que les Reglages (`data/UpdateRunner.kt`).
- **La mise a jour automatique** (reglage *Mise a jour automatique*, sur par defaut). La veille de fond --
  une recherche par jour, APRES les recuperations pour ne couper aucune page en route -- telecharge la
  nouvelle version, la verifie (taille, SHA-256 publie, nom de paquet, version, certificat identique a
  l'appli installee) et la passe a Android. Condition : qu'Android ait autorise, UNE fois, l'appli a
  installer des applis (le meme geste que pour la mise a jour a la main). Sans cela -- ou si le reglage
  est coupe -- rien ne s'installe : la notification (une par version) et le bandeau, comme avant. Sur
  Android 12 et plus, apres une premiere mise a jour faite par l'appli, le systeme installe sans rien
  demander ; sinon il veut un geste, et une notification « Mise a jour prete » porte sa fenetre (Android
  interdit d'en ouvrir une d'office depuis le fond).
- Tests : choix d'affichage et colonnes, anciennes sauvegardes, recherche de fond (une fois par jour,
  une notification par version) ; les trois affichages et le bandeau rendus en images.
- Non verifie : l'installation silencieuse d'une vraie mise a jour sur un telephone (Android la decide :
  version du systeme, installateur d'origine), et la fenetre d'autorisation sur un telephone reel.

## 2.106.0 / appli 1.24.0 -- 2026-10-02

**Un jeu qu'on possede ne se recupere qu'UNE fois : le magasin est interroge avant d'ouvrir un onglet, et la question « montrez-moi le bouton » n'est posee qu'une fois**

Signale : « pour GOG, et peut-etre les autres, il faut le recuperer une seule fois alors
que la c'est a l'infini ; il faut verifier pour chaque magasin si c'est deja recupere, et
ne plus le demander ».

- **La cause, mesuree en vrai Chromium.** Une page GOG qui disait « offre terminee », ou qui
  ne montrait plus que « Jouer » parce que le jeu etait deja au compte, sortait du moteur
  en `needs_teaching` (« montrez-moi le bouton ») -- et ce verdict etait « jamais
  abandonne » depuis la 2.102.0. A chaque tentative : un onglet remonte dans la fenetre
  de l'utilisateur, la meme question, pour un jeu qu'il avait deja. La question n'avait
  d'ailleurs aucune reponse : sur une page ou tout est interdit (jouer, acheter, installer),
  aucun clic ne peut etre appris.
- **Le moteur ne demande plus dans le vide** (`src/core/17-adaptive-nav.js`,
  `31-bootstrap.js`). Il ne demande « montrez-moi le bouton » que s'il y a un controle
  que l'utilisateur POURRAIT montrer (`navTeachableLabels`) : visible, hors entete et
  pied, hors liste, ni interdit, ni « dans la bibliotheque », ni une simple confirmation,
  ni inactif. Sinon -- une vraie page de magasin (trois controles au moins) qui n'offre
  plus rien, ou « offre terminee » lu par le navigateur -- il rend un verdict a part,
  **`gone`** (« rien a prendre ici »). Une page blanche ou en erreur reste un echec, qui
  sera retente.
- **Une seule question par offre** (`watch/claim.js`, `watch/cycle.js`). « Montrez-moi le
  bouton » sort de la liste « jamais abandonne ». Apres la question, l'offre attend la
  journee (`ASK_WAIT_MS`), puis suit le recul ordinaire et l'abandon au cinquieme essai ;
  le moteur recoit `teach: false` et ne redemande pas. Seul un clic « Recuperer » de
  l'utilisateur peut la reposer. Une offre d'avant la 2.106.0 qui attendait le bouton
  compte comme deja demandee.
- **« Rien a prendre » se confirme deux fois.** Une page mal rendue ressemble a une page
  vide : un premier `gone` se reverifie trois heures plus tard, le second -- deux heures
  d'ecart au moins -- clot l'offre (`RESOLVED`, qui ne revient pas). « Reessayer » la
  rouvre. Pour le canari, ni `gone` ni `owned` n'accusent le magasin.
- **Le magasin dit si le jeu est a vous, AVANT tout onglet** (`watch/owned-check.js`).
  Sur GOG, la liste de la bibliotheque accepte une recherche : avec VOTRE session, une
  page, une lecture. Le titre doit etre IDENTIQUE (editions et casse pres : « Civilization »
  n'est pas « Civilization VI ») -- un faux « deja a vous » ferait rater un jeu offert. Reponse
  illisible, session absente, recherche que GOG ignorerait : on ne sait pas, et rien n'est
  bloque (la page tranche, comme avant). Ma collection importee repond d'abord, sans
  requete. Verdict `owned` (definitif) : ni onglet, ni jeton du plafond horaire. Les
  autres magasins n'ont pas d'adresse equivalente : ils passent par le registre, la
  collection (identifiants exacts), l'historique du moteur -- et la regle « une question,
  puis plus rien ».
- **Le bandeau a deux reponses de plus.** « C'est deja a moi » et « Plus offert » : un clic
  de CONFIANCE (un clic fabrique par la page est ignore) regle l'offre -- le worker ne la
  redemande plus, referme l'onglet, et note le jeu dans `veille:deja`.
- **`veille:deja`** (`watch/deja.js`) : « magasin|titre normalise » -> quand et d'ou (compte,
  collection, votre reponse). Cinq cents au plus, quatorze mois, dans la sauvegarde
  complete (union). Ce n'est PAS le registre : ni bilan, ni recap de l'annee, ni carnet. Le
  meme jeu qui revient sous une autre cle (un autre site, un giveaway rejoue) ne rouvre rien.
  Un clic de l'utilisateur l'ignore (il peut s'etre trompe), pas le compte du magasin.
- **Appli** (1.24.0). Les memes regles en Kotlin (`Rules.kt`, `data/OwnedCheck.kt`,
  `ClaimSession.kt`) : `TEACH` ne s'abandonne plus mais attend la journee, `GONE` se
  confirme deux fois, la recherche GOG avec la session des pages de connexion de l'appli,
  la memoire « deja a toi » (separee pour chaque membre de la famille), et les deux
  boutons sur le panneau. Le fond ne demande jamais le bouton (personne pour cliquer).
- **Verifie en vrai Chromium** (voie du cycle, pas le clic force) : jeu deja a vous et GOG
  qui le dit -> 0 page ouverte, 3 passages ; « offre terminee » ou « Jouer » seul -> 2
  visites, aucune question, offre close, plus rien ensuite ; un controle inconnu -> UNE
  question, un seul onglet laisse ouvert, abandon au cinquieme essai ; clic sur « C'est
  deja a moi » / « Plus offert » -> offre close, onglet referme, jeu memorise ; un vrai
  giveaway et une page « dans la bibliotheque » -> une visite, puis plus rien.
- Non verifie : la forme REELLE de `getFilteredProducts` avec une session (jamais mesuree
  d'ici : la recherche `search=` est celle des outils de bibliotheque GOG ; si GOG
  l'ignorait, on retombe sur « on ne sait pas »), le libelle reel d'un jeu GOG deja a
  vous, Epic et Luna reels (Cloudflare, pas de compte), la WebView Android.

## Appli 1.23.0 -- 2026-10-02 (extension inchangee, 2.105.0)

**« Ta soiree choisit le jeu » : l'agenda du telephone dit combien de temps tu as, les avis Steam disent combien de temps le jeu prend**

- **Agenda** (`data/Evening.kt`, `data/CalendarReader.kt`). Dans « Ce soir je joue
  a... », une cinquieme puce **Agenda**. La permission `READ_CALENDAR` n'est demandee
  qu'a ce toucher-la, jamais avant ; refusee, rien ne change. Seuls les debuts et
  fins des evenements sont lus (jamais un titre, un lieu ou un participant), les
  evenements « toute la journee », « disponible » ou refuses sont ignores, et seul
  le resultat -- « libre de 20 h a 23 h 30 » -- est enregistre. Rien ne quitte le
  telephone. Le creneau est le plus long trou libre entre 18 h et 23 h 30 (22 h 30 si
  un evenement commence avant 9 h demain) ; passe 22 h, c'est la soiree de demain.
  Un trou de moins de trente minutes n'est pas une partie. Moins d'une heure et demie :
  « 1 heure » ; sinon « une soiree ».
- **Le temps que le jeu prend.** Pour les jeux de la pile (quatre par passage au
  plus, une fois tous les deux mois), l'appli lit cent avis Steam recents -- sans
  cookie -- et prend la **mediane** du temps de jeu de leurs auteurs. Moins de trente
  avis avec un temps de jeu : pas de mediane, pas de jugement.
- **Le jeu qui tient.** Entre 35 et 90 % du creneau : le meilleur choix (« ca tient
  dans ta soiree ») ; bien plus court : une petite partie ; bien plus long : « une
  premiere partie, pas la fin » ; plus de quatre heures pour moins d'une heure et
  demie : on ecarte. Le « ~ » est voulu : c'est une ESTIMATION, les auteurs d'avis
  jouent plus que la moyenne, et seul Steam la donne -- un jeu hors Steam n'a pas de
  temps, donc pas d'ajustement.
- Non verifie : la lecture d'un vrai agenda Android (Robolectric n'a pas de
  fournisseur de calendrier) ; la partie pure -- creneau, trous, matin d'apres, mediane,
  ajustement, choix -- est testee, et la carte a ete rendue en image.

## 2.105.0 -- 2026-10-02

**Le carnet qu'on ne retouche pas sans que ca se voie, et le gardien qui dit quand un jeu pris disparait de votre bibliotheque**

- **Le carnet** (`watch/ledger.js`). Chaque jeu pris ajoute une ligne, et chaque
  ligne porte l'empreinte SHA-256 de la precedente : modifier un titre, une date ou
  une valeur, retirer une ligne du milieu, en inserer une ou en echanger deux casse
  la chaine, et la verification dit A QUELLE LIGNE. Les constats « deja a vous » sont
  des lignes a part. Un code, une adresse ou un compte n'y entrent jamais ; un jeu
  n'est note qu'une fois. Reglages -> Carnet : verifier la chaine, exporter le
  carnet (un fichier relisible tel quel), verifier un fichier exporte -- et voir si
  son empreinte figure dans le carnet actuel, c'est-a-dire que rien n'a ete reecrit
  depuis. Cinq mille lignes au plus : au-dela, les plus anciennes sortent et `base`
  garde l'empreinte de la derniere sortie, la chaine restante se verifie toujours.
  Il suit la sauvegarde complete (le plus long l'emporte).
- **Ce que le carnet n'est pas.** C'est MON journal, pas un recu signe par un
  magasin : il ne prouve rien a un tiers, et quelqu'un qui tient votre disque peut
  refaire toute la chaine d'un coup. Il sert a VOUS, a condition de noter son
  **empreinte de tete** ailleurs : sans elle, ni une reecriture complete ni le
  retrait des dernieres lignes ne se voient. L'ecran le dit en toutes lettres.
- **Le gardien de bibliotheque** (`watch/library-watch.js`), coupe par defaut.
  Une fois par mois, il relit la collection de Steam, GOG et Epic que vous avez
  DEJA importee (avec votre session, comme « Tout importer ») et dit quel jeu pris
  n'y est plus : retrait du magasin, remboursement, compte sanctionne -- ou simple
  titre different, il ne sait pas lequel et le dit. Prudent : import de moins de
  trois jours et de dix jeux au moins, jeu pris depuis plus de quarante-huit heures,
  titre apparie sans l'edition, et surtout **deux relectures a plus de vingt heures
  d'ecart** avant toute alerte (la deuxieme vient le lendemain), une seule alerte par
  jeu. Notification, et telephone si l'alerte y est branchee. Une importation a la
  demande rafraichit aussi le gardien quand il est actif.

Essai de bout en bout dans un vrai Chromium : l'historique du moteur ecrit le
carnet (l'echec n'y entre pas, le constat est une ligne a part), la verification
passe, une valeur retouchee a la main est designee a la ligne 1, et le gardien note
un jeu absent d'une collection fraiche sans alerter la premiere fois. Non verifie :
la relecture reelle d'un compte Steam, GOG ou Epic (pas de session ici) ; l'appariement
des titres sur de vraies collections -- c'est la qu'une fausse alerte se jouerait, d'ou
les deux relectures.

## 2.104.0 -- 2026-10-02

**Le bot Telegram qui repond : ecrivez-lui « etat », « jeux », « prends tout », « pause 3 », « pourquoi Hades », « ce soir », « stop »**

Jusqu'ici le bot ne faisait qu'ecrire. Il lit maintenant UN message de vous et
repond (`watch/bot.js`). Coupe par defaut : Reglages -> Telephone -> Telegram ->
« Le bot repond a mes messages ».

- **Les commandes**, en francais ou en anglais, avec ou sans accent, avec ou sans
  `/` : *etat* (combien de jeux, dont combien pris seul, derniere verification,
  arret d'urgence, vacances, incidents), *jeux* (la liste, la fin la plus proche
  d'abord, liens https seulement), *prends tout* (le meme geste que « Tout
  recuperer », meme plafond horaire, puis un second message avec le resultat),
  *pause N* (le mode vacances, de 1 a 60 jours : le bot se tait, la recuperation
  continue), *reprise* (fin des vacances et de l'arret d'urgence), *pourquoi X*
  (pourquoi ce jeu n'est pas pris : filtre, deja a vous, dernier essai, prochain
  essai), *ce soir* (un jeu de votre pile), *stop* (l'arret d'urgence a distance,
  onglets pilotes refermes), *aide*.
- **Une seule personne parle.** La discussion PRIVEE dont le numero est celui des
  reglages, expediteur compris. Un groupe, un canal, un `@nom` : refuses des les
  reglages (« mettez votre propre numero »), parce que n'importe quel membre
  piloterait votre recuperateur. Tout autre message est ignore SANS reponse : le
  bot n'est pas un echo pour des inconnus.
- **Jamais un secret.** Une reponse se compose de titres, de noms de magasin, de
  durees et de liens de fiches. Les codes de rachat, les jetons, les adresses de
  webhook et les cookies ne sont meme pas lus par ce module ; le journal et l'etat
  n'ecrivent jamais l'adresse de Telegram (elle porte le jeton).
- **Ce que ca coute, dit honnetement.** Une alarme lit `getUpdates` toutes les
  minutes : l'ordinateur doit etre allume et le navigateur ouvert, la reponse
  arrive avec une minute au plus de retard, et il n'y a aucun serveur chez nous.
  Un message ecrit ordinateur eteint (plus de quinze minutes) n'est PAS execute au
  retour : le bot le dit, une fois, et demande de le renvoyer.
- **Au plus une fois.** Le decalage de lecture est ecrit AVANT d'agir : un worker
  tue en route perd une commande, il ne la rejoue pas. Cinq commandes par lecture
  au plus (les suivantes restent chez Telegram, lues a la minute d'apres), trente
  par heure. A l'activation, les anciens messages de la discussion ne partent pas.
- Un webhook ou un autre programme qui lit deja les messages du meme bot donne un
  HTTP 409 : le popup le dit au lieu de rester muet.

Essai de bout en bout dans un vrai Chromium, contre un faux serveur Telegram :
amorcage sans executer le vieux « prends tout », « etat », « pause 2 », « pourquoi
... », une phrase incomprise et « reprise » repondus en francais, vacances posees
puis levees, aucun cookie envoye. Non verifie : le vrai serveur de Telegram (pas de
bot ici) ; la reclamation groupee lancee depuis le bot (testee a part, son effet
est le meme appel que le bouton).

## 2.103.0 -- 2026-10-02

**« Piege ou bonne affaire ? » : une note de A a D sur chaque jeu offert, avec ses raisons, et un total qui dit ce qu'il prouve**

« Gratuit » ne dit pas « interessant ». Un jeu offert peut etre gratuit de toute
facon, une demo, un DLC qui ne sert a rien sans un jeu qu'on n'a pas, ou un titre
dont le prix « barre » a ete gonfle par le site qui l'annonce.

- **La note** (`watch/bargain.js`). Une lettre dans un carre, a cote de la note
  Steam sur chaque carte ; l'infobulle donne TOUTES les raisons, les mauvaises
  d'abord. **D** sans appel : gratuit en permanence (le magasin le dit, ou Steam :
  free-to-play), demo ou test, musique / video / publicite. Ensuite : une bonne
  note Steam (au moins 50 avis) et une valeur confirmee montent, des avis partages
  ou une valeur gonflee descendent, un DLC dont vous n'avez pas le jeu de base
  tombe en D. **A exige les deux** -- bonne note ET valeur confirmee --, jamais
  l'un sans l'autre. Sans AUCUNE donnee qui compte, la note est « ? » (non
  evaluee) : elle ne devine pas. Une offre deja a vous n'est pas jugee.
- **Une valeur n'est « confirmee » que de deux facons.** Le magasin l'a donnee
  lui-meme (Epic, GOG, Steam : leur propre prix), ou un site tiers l'a annoncee
  en dollars et la fiche Steam (prix de catalogue en dollars aussi : aucune
  conversion inventee) la confirme. Annoncee plus de 1,5 fois le prix Steam et au
  moins 5 $ au-dessus, elle est « gonflee ». Sinon : « annoncee, non confirmee ».
- **La fiche de prix** (`veille:prix-steam`). Pour chaque offre dont on connait
  l'appid -- le sien, ou celui que sa note Steam a trouve --, `api/appdetails`
  (type, gratuit ou non, prix de catalogue, jeu de base d'un DLC), huit par
  passage, une fois par mois, sans cookie, sur un hote deja autorise. Meme reglage
  que les notes Steam : qui le coupe coupe les deux.
- **Le jeu de base d'un DLC** se lit dans votre collection Steam importee. Pas
  importee : « impossible de verifier », prudence, jamais un « vous ne l'avez pas »
  invente.
- **Le grand chiffre dit ce qu'il prouve.** Sous « Economise depuis le debut » :
  *Verifie* (prix du magasin, ou recoupe avec Steam), *a confirmer* (annonce par un
  site tiers, sans preuve), *ecarte* (ce qu'une valeur gonflee depasse le prix
  Steam), et le nombre de jeux gratuits de toute facon, non comptes. Le chiffre
  principal ne change pas ; c'est le « vrai » qui s'affiche dessous. La provenance
  de la valeur est figee dans le registre a l'instant de la reclamation
  (`wsrc`) : les reclamations anterieures, sans provenance, restent « a confirmer ».
- **La notification** d'un jeu annonce seul porte une derniere ligne : « Verdict B :
  Bonne affaire. Bien note sur Steam (88 % sur 4 200 avis). ».
- **L'appli** (1.22.0) fait pareil, avec le meme calcul : une table d'or
  (`bargain-golden.tsv`), regeneree depuis le module JS, est relue par le test
  Kotlin. Un appui sur la note ouvre les raisons.

Non verifie : la lecture reelle de la fiche Steam sur un compte (le test de bout en
bout, en vrai Chromium, a tourne sur des donnees posees dans le stockage) ; la
couverture : un jeu absent de Steam n'a ni note ni prix de catalogue, donc « ? ».
Ce que la note n'est pas : un avis sur le plaisir de jeu -- elle ne lit que des
faits (prix, type, avis Steam, jeu de base).

## 2.102.0 -- 2026-10-02

**Le claimer qui se repare seul : le moteur reconnait un bouton par sa forme, et demande UN clic quand il ne le reconnait plus**

Quand un magasin change sa page, tous les claimers cassent -- et aucun n'apprend
de la panne. Ici, trois niveaux, du plus automatique au plus humain :

- **La forme, pas seulement le mot.** Un controle qui a pris un jeu est retenu avec
  sa structure : marque de test (`data-testid`), cible (`data-a-target`), classes
  lisibles, forme de l'adresse. Quand le magasin change le MOT (« Add to library »
  devient « Prends-le »), un controle de meme forme est reconnu apres une seule
  reussite -- deux quand la forme ne tient qu'a des classes. Les classes generees
  par une feuille de style (`css-1x2y3z`) ne comptent pas. Un controle qui dit
  deja « dans la bibliotheque » ne prend plus rien, meme reconnu par sa forme.
- **Aucun interdit ne tombe.** La forme n'ajoute que du sens, comme la memoire de
  libelle : le libelle doit rester lisible, et argent, panier, abonnement, essai
  gratuit, connexion -- et, nouveau, **installer, lancer, telecharger, mettre a
  jour** (un controle d'Epic devenu « Installer » une fois le jeu pris) -- restent
  interdits quel que soit le score.
- **« Montrez-moi le bouton ».** Si le moteur, pilote par la veille, lit la page
  (session bonne, aucun defi) sans reconnaitre de bouton, il ne se contente plus
  d'echouer : verdict `needs_teaching`, l'onglet remonte dans votre fenetre avec
  un bandeau, une notification vous demande UN clic. Votre clic, prouve par « le
  jeu est a vous » (quatre minutes pour se montrer : une commande Epic prend du
  temps), apprend le bouton ; le worker referme l'onglet et reessaie l'offre tout
  de suite. Une fois toutes les six heures par magasin au plus ; jamais sur une
  page de paiement, jamais pour un libelle d'argent ou une simple confirmation.
  Le canari le compte comme un selecteur casse (le magasin a bouge), l'offre n'est
  jamais abandonnee.
- **L'appli** (1.21.0) fait pareil : devant l'ecran, la page reste ouverte dans le
  panneau et un toucher apprend le bouton ; en fond, une notification le demande.

Deux defauts trouves par l'essai de bout en bout dans un vrai Chromium, et corriges :

- **La memoire du navigateur adaptatif ne se relisait jamais** d'une page a l'autre
  (2.100.0 et 2.101.0) : `FGC_nav_<magasin>` s'ecrivait, mais n'etait pas dans la
  liste des cles prechargees du shim -- la lecture synchrone rendait toujours le
  defaut. Aucun test unitaire ne pouvait le voir (le harnais lit une `Map`) ; un
  test compare maintenant, cle par cle, ce que le moteur lit a ce que le shim
  precharge (`test/engine-keys.test.mjs`).
- **L'onglet remonte etait referme aussitot.** Le navigateur referme de lui-meme la
  fenetre reduite quand son dernier onglet part ; le repli du nettoyage fermait
  alors l'onglet qu'on venait de montrer -- valable aussi pour un defi de
  securite. `surfaceTab` ne choisit plus la fenetre reduite elle-meme, et le
  nettoyage ne touche plus jamais a l'onglet.

Mesure dans un vrai Chromium avec l'extension, contre une page GOG a la structure
reelle mais au libelle inconnu : verdict `needs_teaching` en 15,7 s, onglet remonte
avec son bandeau, un VRAI clic sur « Prends-le », « Appris de votre geste », onglet
referme, offre retentee, `OK Recupere : Bounty Train (Prends-le)` -- score 15 :
appris + forme.

Non verifie : Epic et Luna reels (Cloudflare, pas de compte), le WebView Android.

## 2.101.0 -- 2026-10-02

**Epic et Amazon lisent la page aussi, les adresses suivent votre pays, et le moteur apprend de votre geste**

Demande : « fais pareil pour Epic et Amazon », des adresses « en fonction de la
langue, France = FR, pas anglais », et un moteur « totalement autonome qui
s'adapte ».

- **Les adresses suivent votre pays.** Un nouveau module (`watch/localize.js`,
  copie ES5 dans le moteur, copie Kotlin dans l'appli, les trois gardees par une
  table d'or) met chaque adresse de magasin dans la langue du reglage : Epic
  (`/en-US/` devient `/fr/`, ou `?lang=fr` quand l'adresse n'a pas de segment),
  GOG (`/en/` devient `/fr/`, le prefixe est pose s'il manque) et Luna (le
  domaine du pays : `luna.amazon.fr`). Cela vaut pour la fenetre de
  reclamation, le clic sur une notification et tous les liens des pages de
  l'extension (reecrits au clic, y compris clic du milieu). Steam n'est pas
  touche : sa reclamation lit des libelles mesures en anglais.
- **Une session Luna ouverte ailleurs l'emporte.** Le moteur retient le domaine
  Luna ou il voit une session ouverte (`FGC_luna_host`) : on ne vous deconnecte
  pas pour traduire une page. Un domaine inconnu n'est jamais suivi.
- **Pour reclamer, la langue reste lisible.** Les motifs de clic d'Epic ne
  connaissent que le francais et l'anglais : une page a reclamer s'ouvre dans
  l'une des deux (l'allemand devient l'anglais), pas en allemand ou le moteur ne
  lirait aucun bouton (la lecon de la 2.20.0). Les liens affiches, eux, gardent
  toute la langue du pays.
- **Epic : le sens prend le relais.** Quand aucun libelle livre ne convient
  (Epic ecrit « Recuperer », « Claim now »...), la fiche attend six secondes puis
  laisse le vocabulaire a poids de GOG choisir -- sur le bouton d'achat principal
  qu'Epic marque, ou a defaut un controle de la zone principale hors liste. Le
  « deja a vous » se lit aussi en allemand, espagnol, italien, portugais, sur
  CE bouton. L'argent reste garde exactement comme avant : le clic passe par
  `robustClick`, et le module de l'iframe de paiement, dont les listes de
  confirmation sont figees, ne lit pas ce vocabulaire.
- **Luna : le sens autorise le bouton.** La liste des libelles autorises accepte
  aussi un libelle dont le sens est « recuperer » ; le bouton est cherche dans la
  boite d'achat si ni l'attribut ni un libelle connu ne le designent ; « deja a
  vous » se lit en plusieurs langues. Et les interdits du navigateur valent
  desormais AUSSI pour les libelles livres : « Obtenir Luna+ gratuitement »
  contenait « obtenir » et passait -- il ne passe plus (abonnement, essai, caisse,
  `Luna+` ajoutes aux interdits).
- **Le moteur apprend de votre geste.** Quand un magasin change sa page, recuperez
  le jeu a la main une fois : le moteur retient le libelle de ce sur quoi vous
  avez clique si, et seulement si, la page dit ensuite que le jeu est a vous
  alors qu'il ne l'etait pas avant (le clic d'avant, s'il a change de page, est
  retenu comme « ce qui mene »). Seuls les clics de confiance comptent (jamais
  ceux du moteur), jamais un libelle d'argent, de panier ou de connexion ni une
  simple confirmation (« Continuer », « OK »), le jeu doit devenir a vous dans
  les 45 secondes du dernier clic (une commande payee a la main, des minutes
  plus tard, ne prouve rien), et la memoire ne fait qu'ajouter du sens : elle
  ne passe devant aucun interdit.

Non verifie : un compte connecte reel sur Epic (pages derriere Cloudflare depuis
le bac a sable) et sur Luna ; le WebView Android.

## 2.100.0 -- 2026-10-02

**Le navigateur adaptatif : la recuperation lit la page au lieu de chercher un libelle**

Signale : sur GOG, la fiche d'un jeu en giveaway porte « Go to giveaway », qui
mene a une seconde page ou il faut cliquer « Ajouter a la bibliotheque ». Le
moteur ne cherchait qu'un libelle exact sur la page courante : sur la premiere,
il ne trouvait rien -- et il aurait recommence a chaque changement de parcours.

- **Lire la page, pas un texte.** Un nouveau module (`17-adaptive-nav.js`)
  classe la page -- connexion demandee, defi de securite, jeu deja a vous,
  bouton qui PREND le jeu, lien qui MENE au bouton, fenetre de confirmation,
  offre terminee -- et choisit le controle dont le SENS colle : un vocabulaire
  a poids dans six langues (francais, anglais, allemand, espagnol, italien,
  portugais, polonais pour le plus courant), la structure (zone principale,
  taille, compte a rebours a cote, hors entete et pied de page).
- **De page en page.** Un lien vers une autre page se SUIT dans cet onglet (jamais
  dans un nouvel onglet) ; l'ordre en cours est ecrit avant de partir et la page
  suivante le reprend, avec ce qui reste du budget. Deux pages, trois au plus :
  pas de ping-pong.
- **Le texte VISIBLE decide.** Le bouton reel de la fiche GOG (mesure sur
  gog.com) porte trois etats dans un meme noeud -- « Check out now », « Go to
  giveaway », « Buy as a gift » -- dont un seul est affiche. `textContent` les
  concatene et le controle entier tombait sous le veto ; `innerText` ne rend que
  ce qu'on voit.
- **Rien qui coute de l'argent, jamais.** Panier, achat, paiement, liste de
  souhaits, partage, connexion, cookies, annulation, « redeem code », et tout
  prix non nul dans un libelle : interdits quel que soit le score. Un lien qui
  sort du site n'est pas suivi. `robustClick` refuse encore en dernier recours.
- **Une reussite se prouve.** Le jeu doit apparaitre « dans la bibliotheque »
  sur LE controle qu'on a clique, ou dans le coin de page ou il vivait, ou sur
  le controle principal de la zone du giveaway -- jamais sur une vignette, un
  carrousel ou un lien vers un autre jeu (la lecon d'Epic en 2.99.7). Un bouton
  qui disparait sans rien dire n'est PAS un succes.
- **Il apprend.** Un libelle qui a pris le jeu (ou mene a lui) est retenu par
  magasin et reconnu ensuite partout, meme s'il n'est dans aucun vocabulaire ;
  un echec pese moins. Et quand aucun libelle ne dit « prends » mais que la page
  est nettement un giveaway (chemin ou zone « giveaway », compte a rebours, un
  seul gros controle permis), la structure seule suffit -- puis la memoire
  prend le relais.
- **GOG l'utilise des 2.100.0** ; l'essai a blanc le lit sans cliquer.

Mesure, sur la VRAIE page gog.com (invite, lecture seule) : la fiche donne
« Go to giveaway » (score 20), l'accueil donne « Add to library » (score 14).
Dans un vrai Chromium avec l'extension chargee, contre deux pages qui reprennent
cette structure (serveur local mappe sur www.gog.com) : fiche, lien suivi,
accueil, clic, `claimed` en 1,7 s ; meme chose en allemand (« Zum Giveaway »,
« Zur Bibliothek hinzufuegen ») ; et avec un libelle inconnu (« Hol dir das
Spiel »), trouve par la structure puis appris. 20 tests (1613 en tout).

Ce qui n'a pas pu etre verifie : le parcours AVEC un compte connecte (la page
invite renvoie a la connexion), et l'appli Android en vrai WebView -- elle
embarque le meme moteur, ses tests passent. Epic et Amazon n'utilisent pas
encore ce navigateur : leurs pages de paiement meritent d'abord d'etre observees.

## 2.99.7 -- 2026-10-02

**Epic : « deja recupere » dit a tort, et l'anti-bot qu'on ne voyait pas**

Signale : des jeux Epic non recuperes la veille ; en forcant, un anti-bot
s'affiche avant « Ajouter a la bibliotheque » et l'extension repond « deja
recupere ».

- **La cause.** « Dans la bibliotheque » se cherchait **n'importe ou dans la
  page** : tout bouton, tout lien visible dont le texte contenait ces mots. Or
  une page Epic en porte plusieurs sans que CE jeu soit pris -- la carte du
  second jeu gratuit de la semaine quand le premier est au compte, une
  extension ou une autre edition possedee, une vignette de carrousel. Le moteur
  concluait « possede », l'ecrivait `claimed` dans son historique, et tout ce
  qui suivait s'y fiait : le module (« tous les jeux de la semaine sont deja
  recuperes »), l'ordre pilote (« deja recupere »), le registre -- qui fait
  sauter le jeu aux cycles suivants. Un jeu qu'on n'avait pas ne se reclamait
  plus jamais, sans un mot.
- **La possession se lit sur le bouton d'achat de CETTE fiche** :
  `data-testid="purchase-cta-button"`, tel qu'Epic le marque, fait foi ; un
  « In Library » ailleurs ne le contredit pas. Sans ce marqueur, le repli par
  le texte reste, mais court (un bouton, pas une vignette) et jamais dans un
  lien vers un autre jeu. Une liste n'est la fiche d'aucun jeu.
- **L'anti-bot est enfin vu.** Un captcha niche dans la fenetre d'achat est
  dans une frame d'une autre origine : le cadre du dessus ne le voyait pas,
  attendait cent cinquante secondes une confirmation impossible, puis concluait
  mal. La frame d'achat previent maintenant le cadre du dessus (un message sans
  donnee, accepte seulement d'un hote epicgames.com) : verdict « defi », onglet
  remonte, notification -- au lieu d'un silence.
- **Un defi a l'ecran passe avant « deja recupere »** dans l'ordre pilote.
- **Forcer, c'est repartir de la page.** « Tout recuperer », « Recuperer » sur
  une offre, le bouton et le menu de la page n'ecoutent plus ni l'historique du
  moteur ni le registre : chaque jeu gratuit est revu sur sa fiche. Les
  magasins, eux, restent crus sur ce qu'ils disent posseder.
- **Le soin, une fois.** Au prochain demarrage, les entrees Epic
  `claimed / ALREADY_*` des trente derniers jours sont effacees de l'historique
  ET du registre ; la revue de la fiche les reecrit si elles etaient justes.
  Une vraie reclamation (`CLAIMED`) n'est jamais touchee, et ces entrees-la ne
  comptent dans aucun total.
- **Appli 1.17.1** : le meme moteur, et l'ordre porte `force` quand la
  recuperation est demandee a l'ecran.

Ce qui n'a pas pu etre verifie : la page d'Epic est derriere un mur anti-robot
depuis ce poste, donc le marqueur `purchase-cta-button` repose sur ce que les
outils de bibliotheque Epic en disent, pas sur une capture. Il est tenu par 12
tests (1593 en tout) ; le repli par le texte couvre sa disparition.

## 2.99.6 -- 2026-09-30

**Connecte pour de bon : la page confirme, et la verification part toute seule**

Signale : Steam ou Epic « deconnecte » alors que le compte l'est, et un clic
sur « Verifier les sessions » a refaire a chaque fois.

- **Cause probable.** Steam et Epic gardent la session dans des jetons qui
  expirent en quelques heures, et c'est leur **page** qui les renouvelle en se
  chargeant. La sonde, elle, lisait les cookies ou l'API sans charger de page :
  passees quelques heures elle voyait un jeton expire et concluait
  « deconnecte » (ou « inconnu ») -- jusqu'au jour ou l'on ouvrait le magasin a
  la main, ce qui renouvelait tout. Le compte de l'utilisateur n'a pas pu etre
  observe d'ici : c'est la lecture des faits connus qui mene la, et le motif
  de chaque verdict s'affiche desormais sous le magasin.
- **Un « non » n'est cru qu'apres la page** (Steam, Epic). Quand la lecture
  rapide ne dit pas « connecte », la page du compte se charge un instant dans
  une fenetre reduite ; on lit ou elle a atterri et son titre. Sur la
  connexion : « deconnecte ». Sur le compte : « connecte ». Un defi
  anti-robot ou une page inattendue : « inconnu » -- **jamais**
  « deconnecte ». GOG garde sa sonde JSON, sans ambiguite.
- **Toute seule.** Une mesure « connecte » se renouvelle toutes les quatre
  heures, une autre toutes les demi-heures, apres chaque cycle. Reglage
  « Verifier les connexions automatiquement » (actif ; coupe pendant les
  vacances et par l'arret d'urgence). Un compte dont une page a montre la
  perte n'ouvre pas de fenetre avant six heures.
- **Le motif est visible** : « la page du compte renvoie vers la connexion »,
  « la page n'a rien montre de net (Un instant…) »… au lieu d'un « inconnu »
  muet.
- **Ce qui change dans les promesses ecrites.** `SECURITY.md` et la fiche
  disaient que la sonde ne part jamais toute seule ; ce n'est plus vrai, et
  les textes le disent. L'importation de collection, qui lit la
  bibliotheque, reste sur un geste.

Mesure, dans un vrai Chromium avec l'extension chargee et sans compte : Steam
renvoie bien vers `/login/?redir=account%2F` (« deconnecte », page a l'appui),
Epic repond par un defi anti-robot (« inconnu », pas « deconnecte »), GOG dit
« Full authentication is required ». Le cas « connecte » n'a pas pu etre rejoue
sans compte : il est tenu par les tests (1581).

## 2.99.5 -- 2026-09-29

**Silence intelligent : seul ce qui vous ressemble sonne**

- **Un interrupteur, coupe par defaut** (Reglages -> Magasins, sous « Vos
  gouts ») : un nouveau jeu qui ne ressemble **pas** a votre profil n'a plus sa
  notification ; il attend un **resume**, envoye quand le plus ancien attend
  depuis douze heures ou quand l'un d'eux va finir dans six -- un jeu mis de
  cote n'est jamais un jeu perdu. Jamais en heures calmes.
- **Ce qui sonne quand meme, tout de suite** : vos souhaits, les deuxiemes
  chances, ce qui ressemble a vos gouts -- et **au moindre doute** : sans
  profil, sans identifiant Steam, sans etiquettes lues, ou pour un jeu que
  Steam ne connait pas. Se tromper dans ce sens coute une notification de
  trop ; dans l'autre, un jeu manque.
- Sans notifications (mode « jamais »), rien n'est mis de cote ; si le tri
  tombe en panne, tout sonne comme avant.
- **Dans l'appli Android 1.15.0**, le meme reglage. Le resume est celui de la
  1.13.0 : a l'heure que vous avez choisie, ou a 20 h si seul le silence
  intelligent en a besoin. Avec un resume choisi, tout y attend comme avant,
  sauf ce qui vous ressemble -- qui sonne maintenant tout de suite.

## 2.99.4 -- 2026-09-29

**Passe anti-fausses-alertes : reseau coupe, reveil, maintenance**

Les deux fausses alertes de la veille (« Steam a change sa page », « la veille
ne tourne plus ») avaient la meme cause, un ordinateur qui se reveille sans
reseau. Chaque detecteur a ete rejoue dans ce cas, et trois autres failles du
meme genre sont fermees :

- **Plusieurs sources qui echouent ensemble sur le reseau** (« Failed to
  fetch », un delai depasse) : c'est une coupure, pas elles. Au reveil d'un
  portable `navigator.onLine` est deja vrai alors que le wifi ne l'est pas ;
  la garde « hors ligne » n'y voyait rien, et trois cycles de ce genre
  ouvraient « la source X echoue depuis un moment ». Ces echecs ne sont plus
  comptes -- et la source retente au cycle suivant, sans attendre son recul.
  Un echec isole, ou mele a une reponse HTTP, reste compte comme avant.
- **Une session « deconnectee » ne s'annonce plus sur une seule mesure.** Un
  magasin en maintenance, un portail captif au reveil rendent la meme reponse
  qu'une vraie deconnexion : la sonde doit le redire une demi-heure plus tard.
  Une mesure « inconnue » entre deux interrompt la serie.
- **Deux motifs d'echec qui ne sont pas ceux du magasin** ne comptent plus
  comme un selecteur mort : « paquet Steam inconnu » (la source ne l'a pas
  donne) et « controle d'age » (seul un humain le passe).
- Rappel des deux corrections de la 2.99.1, maintenant couvertes par des
  tests de bout en bout : une injection de script qui echoue, et le premier
  tour d'inspection apres un long silence.

## 2.99.3 -- 2026-09-29

**Discord en cartes, comme Telegram**

- Une alerte Discord est maintenant une **carte** : un liseré de couleur selon
  le genre (jaune pour un jeu attendu, orange pour la derniere chance, rouge
  pour une panne, violet pour le recap...), un titre qui est le lien, la
  **jaquette du jeu en grand**, les memes logos de magasin (🛡️ 🟣 ♨️ 🌙...) et
  les memes lignes que sur Telegram, et un pied « 🕹️ Free Games Claimer ».
  Un webhook ne peut pas porter de boutons : le lien est le titre, et une ligne
  « 🎁 Voir le jeu » ferme la carte.
- **Rien ne mentionne personne** : `allowed_mentions` est vide, l'arobase est
  casse, et le Markdown d'un titre venu d'un magasin (`* _ ~ | > # [ ] ( )`)
  est neutralise -- un jeu appele « [gratuit](http://...) » ne fabrique pas de
  lien. Si Discord refuse la carte (image illisible), elle repart sans image.
- **Une seule lecture des alertes** : `watch/alert-model.js` lit les lignes (une
  carte de jeu, une panne, un jeu mobile, une etiquette) et les deux services
  ne font plus que les habiller (HTML pour Telegram, Markdown pour Discord).
  Un test verifie qu'ils disent la meme chose des memes alertes.
- Pour la photo du webhook, envoyez `docs/logo/telegram-bot-logo.png` dans
  Parametres du salon, Integrations, Webhooks : Discord ne la lit pas dans
  l'alerte.

## 2.99.2 -- 2026-09-29

**Un seul logo, partout**

- **Le ticket jaune remplace l'ancien coupon ambre**, dans l'extension (barre
  d'outils, notifications, popup, page des extensions), sur le bouton flottant
  des pages de magasin, dans l'**appli Android 1.14.1** (icone adaptative,
  icone thematique d'Android 13+, petite icone des notifications) et sur le
  **bot Telegram** : un ticket a encoches et pointille, une manette, « FREE » en
  blocs et une fleche vers un bac -- recuperer --, sur fond noir avec l'ombre
  blanche decalee des cartes de l'interface.
- **Trois niveaux de detail**, parce que 16 pixels ne portent pas ce que 128
  portent : complet (128, 48), sans etiquette ni fleche (32), ticket et
  manette droits (16).
- **Une seule source** : `tools/icons.mjs` ecrit le SVG, les PNG, les vecteurs
  Android et l'avatar du bot ; un test garde la copie du bouton flottant
  alignee sur elle et verifie que l'ancien logo n'est plus nulle part.

## 2.99.1 -- 2026-09-29

**Telegram en couleurs, et deux fausses alertes en moins**

- **Des messages Telegram mis en page.** Fini le texte brut. Chaque alerte a
  l'icone de son genre (🎮 jeu attendu, ⏰ derniere chance, 🚨 panne, 🗓️
  recap, 🔑 code a echanger, 🏝️ retour de vacances), un titre en gras, et une
  carte par jeu avec le **logo du magasin** en emoji (🛡️ Epic, 🟣 GOG, ♨️
  Steam, 🌙 Luna, 🪟 Microsoft...), le delai restant sous un ⏳ et les prix
  sous une 💶. Un jeu mobile montre ses plateformes (🤖 Android · 🍎 iOS).
  Une panne met son motif technique en monospace, le recap une icone par
  ligne (✅ ❌ 🖐️ 🔜).
- **La jaquette du jeu en photo** au-dessus du message (jeux attendus, jeux
  mobiles, derniere chance), et le lien devient un **vrai bouton** sous le
  message (« 🎁 Voir le jeu », « 🔑 Echanger le code »), dans la langue de
  l'extension. Si Telegram refuse l'image, le message part quand meme, sans
  elle.
- Rien ne part de plus qu'avant : aucun code de rachat, aucun identifiant ;
  une jaquette est l'adresse publique que le magasin sert a tout le monde.
  Tout texte venu d'un magasin est echappe avant d'entrer dans le HTML de
  Telegram, et l'arobase est casse : un jeu appele « @quelquun » ne mentionne
  personne dans un groupe. Discord et ntfy ne changent pas.
- **Fausse alerte « Steam a change sa page ».** Un onglet qui affichait la page
  d'erreur de Chrome (le reseau n'etait pas revenu au reveil) faisait echouer
  l'injection du script (« Frame with ID 0 is showing error page »), et le
  canari y voyait un selecteur mort. Une injection qui echoue ne dit rien du
  magasin : elle ne compte plus.
- **Fausse alerte « La veille ne tourne plus ».** Au reveil d'un ordinateur
  endormi la nuit, le tour d'inspection passait AVANT le rattrapage du cycle
  en retard et disait « dernier cycle il y a 10 h » -- puis la veille repartait
  toute seule. Ce premier tour apres un long silence ne juge plus ; le suivant,
  une demi-heure plus tard, juge sur pieces.

## 2.99.0 -- 2026-09-28

**Vos gouts : ce qui vous ressemble, en tete**

- **Un profil de vos gouts**, tire de ce que vous faites deja : les jeux que
  vous avez beaucoup joues (le miroir Steam), finis ou commences, et ceux que
  vous avez abandonnes ou ecartes (« Pas pour moi »). Il retient les
  etiquettes des joueurs Steam qui reviennent (Roguelike, Metroidvania,
  Simulation...), les plus larges (« Jeu solo », « Independant ») comptant
  moins. Sous trois jeux aimes, pas de profil : trois jeux ne sont pas des
  gouts.
- **« Pour vous »** sur les offres qui lui ressemblent ; la bulle dit de quoi :
  « Proche de vos gouts : 2D, Roguelike, Metroidvania. » Mesure sur de vrais
  jeux : un profil de Hades, Celeste, Hollow Knight et Slay the Spire reconnait
  Dead Cells et laisse de cote Planet Zoo.
- **La notification** d'un jeu annonce seul ajoute la meme ligne.
- **« Ce soir je joue a... »** met devant un jeu de votre pile qui vous
  ressemble, avec la raison : « Dans vos gouts : Roguelike, 2D ».
- **Sans cookie, sans titre** : seulement des numeros de jeux vers Steam (cent
  au plus par passage, toutes les six heures ; dix minutes quand une offre
  vient d'arriver), puis le nom des etiquettes, au plus tous les deux mois.
  Un interrupteur dans Reglages -> Magasins ; coupe, rien n'est lu.
- Le profil suit la sauvegarde complete (des numeros et des poids, sans le
  cache des jeux) : l'appli Android 1.14.0 le lit et fait la meme chose.
- **Appli Android 1.14.0 : tes gouts.** Le meme calcul, verifie contre
  l'extension sur les memes fiches Steam (a trois decimales pres). Le
  telephone prend le profil de l'extension quand sa sauvegarde le porte -- elle
  sait combien tu as joue --, sinon il en tire un de tes etats (fini,
  commence, abandonne, pas pour moi ; il faut trois jeux aimes). **Pour toi**
  sur la jaquette, une ligne dans la notification, et « Ce soir je joue a... »
  met devant ce qui te ressemble. Un interrupteur dans Reglages ; coupe, rien
  n'est lu. Les notes Steam sont maintenant lues avant d'annoncer, pour que la
  notification puisse dire de quoi le jeu se rapproche.

## 2.98.0 -- 2026-09-28

**Une deuxieme chance, un jeu a plusieurs, et de quoi remettre a plus tard**

- **Deuxieme chance.** Un jeu qui vous avait echappe et qui revient (sur
  n'importe quel magasin) porte l'etiquette **2e chance** dans la liste ; la
  bulle dit quand et ou vous l'aviez rate. Il passe devant le tout-venant --
  derriere les jeux que vous attendiez -- et sa notification a son propre
  titre et une ligne de plus : « Vous ne l'aviez pas recupere en mars 2026
  (Epic Games Store). » Jamais pour un jeu deja pris, jamais pour une offre
  qui se retrouve elle-meme apres une coupure de sa source. Meme en mode
  resume, elle est annoncee a part.
- **Ce soir a plusieurs.** Une case « A plusieurs » dans « Ce soir je joue a... » :
  ne garde que les jeux qui se jouent a deux ou plus (cooperatif en ligne ou
  sur le canape, ecran partage, multijoueur) d'apres les categories Steam.
  Un jeu dont on ne sait rien n'est pas propose, comme pour le Steam Deck.
  La raison s'affiche : « Se joue a plusieurs ».
- **Dans l'appli Android 1.12.0** : les memes trois choses, plus
  - **Plus tard** sur chaque notification : le jeu revient dans trois
    heures, au plus tard une heure avant la fin de l'offre ; pas de bouton
    quand il reste moins de deux heures, et un jeu pris entre-temps ne sonne
    pas ;
  - **raccourcis sur l'icone** (appui long) : Recuperer maintenant, Ce soir je
    joue a..., Ajouter un souhait.
- **Correctif.** Un libelle ecrit `$1$2` faisait refuser toute l'extension par
  Chrome (« Variable $1$ used but not defined ») : le service worker ne
  demarrait plus. Un test lit maintenant les quatre langues et refuse toute
  variable non declaree.
- La ligne d'informations des cartes passe a la ligne au lieu de deborder :
  avec l'etiquette en plus, le compte a rebours sortait de la carte a 328 px.
- **Appli Android 1.13.0 : un seul resume par jour.** Un reglage (8 h, 12 h,
  18 h ou 20 h) rassemble les nouveaux jeux du jour dans UNE notification, a
  l'heure choisie -- comme le mode resume de l'extension. Les jeux souhaites
  et les deuxiemes chances sonnent tout de suite, comme le rappel du dernier
  jour, la derniere chance et « Plus tard » : attendre les ferait rater. Un
  jeu pris ou fini entre-temps ne figure pas au resume, et couper le reglage
  ne perd rien : ce qui etait retenu part au passage suivant.

## 2.97.0 -- 2026-09-27

**La page Historique tamponnee aussi**

- Chaque issue y porte son tampon, comme dans le popup : **RECUPERE**
  (double trait), **RATE** (inverse), **INCERTAIN** (pointilles). Au survol,
  l'issue et le verdict brut, comme avant.
- Un tampon prend l'encre de son support : celle de la page dans le popup,
  le noir sur les cartes blanches de l'Historique -- lisible en theme sombre.
- Plus aucune page n'utilisait les icones dessinees au DOM :
  `lib/status-icons.js` s'en va.
- **Dans l'appli Android 1.11.0**, les memes tampons : sur les cartes des
  jeux (recupere, deja a toi, echec, en attente, ignore -- l'issue du
  dernier essai), sur les jaquettes de l'onglet Recuperes, et dans le
  panneau de recuperation a la place de « OK » et « !! ».
- **CI GitHub** : les actions passent a leurs versions Node 24
  (checkout v5, setup-node v5, setup-java v5, upload-artifact v6). GitHub
  retire Node 20 de ses runners ; chaque run l'affichait en avertissement.

## 2.96.0 -- 2026-09-27

**Des tampons partout, et un vrai « Ce soir »**

- **« Deja recupere » : un tampon pour chaque etat.** Recupere, deja a vous
  (jaune, plein), ignore (pointilles), echec (inverse), en attente -- chacun
  de travers, comme un coup de tampon. Les petites icones du popup s'en
  vont ; les mots exacts restent dans l'infobulle. La page Historique garde
  ses icones.
- **« Ce soir je joue a... » : l'image et la description du jeu.** L'image
  vient de la fiche Steam, sinon de l'en-tete que l'appid suffit a trouver,
  sinon de la jaquette gardee par le registre. La description courte est
  celle de la fiche Steam, dans la langue de l'extension quand Steam l'a
  (sinon en anglais). Elle remplace « Recupere gratuitement en... ».
- Un jeu montre sans fiche : le popup demande au worker de la lire tout de
  suite, au plus toutes les deux minutes. Les fiches lues avant cette
  version sont relues pour prendre leur description.
- **Dans l'appli Android 1.10.0** : la meme image, la meme description.

## 2.95.0 -- 2026-09-27

**« Ce soir je joue a... »**

- **Une section du popup** (et du tableau de bord) : UN jeu de votre pile
  jamais lancee, pour le temps que vous avez -- une heure, une soiree, un
  week-end, peu importe --, et, si vous le demandez, jouable sur Steam Deck.
  Avec ses raisons : jamais lance d'apres Steam, mis « a essayer », court ou
  par parties courtes, la note Steam, recupere gratuitement tel mois.
  « Lancer dans Steam », « J'y joue », « Un autre », « Pas pour moi ». Le
  choix tient la soiree : rouvrir le popup ne le change pas.
- **La pile** : Ma collection et ce que l'extension a recupere, moins ce que
  le miroir Steam dit lance (plus d'une demi-heure), moins ce que vous avez
  dit en cours, fini, abandonne ou pas pour vous.
- **Mesure du 2026-09-27** : personne ne publie la duree d'un jeu sans cle
  (HowLongToBeat refuse, SteamSpy rend zero heure). Les etiquettes des
  joueurs Steam, elles, disent le format -- « Short », les rogue-likes et
  l'arcade, les mondes ouverts et les RPG -- et arrivent avec la note et le
  Steam Deck dans une seule requete GetItems, sans cookie, pour cinquante
  jeux. Verifie sur douze jeux connus ; aucune duree n'est inventee.
- **Ma collection** : la colonne Backlog montre enfin l'etat de chaque jeu, a
  changer ligne a ligne. La page ne relisait jamais les etats enregistres :
  le filtre par etat et le tirage « a essayer » ne trouvaient rien. Un etat
  de plus, « Pas pour moi ».
- **La sauvegarde complete emporte ces etats** (et leurs notes) : c'est la
  seule donnee ecrite a la main, et elle ne suivait pas d'un ordinateur a
  l'autre. A la restauration, un etat pose ici gagne.
- **Dans l'appli Android 1.8.0** : la meme carte en tete de l'onglet
  Recuperes, et un **widget** pour l'ecran d'accueil -- le jeu du soir, ses
  raisons, « Un autre ». Ma collection et les etats des jeux arrivent par la
  sauvegarde de l'extension, et les etats y retournent.
- **Appli Android 1.9.0 : toute la famille.** Un seul telephone recupere
  pour plusieurs comptes (Epic, GOG, Amazon) : chaque personne a son profil
  WebView, ses cookies, ses jeux, ses essais. Steam et le relais restent au
  compte principal. Sur le PC, la meme chose se fait avec un profil Chrome
  par personne, chacun avec l'extension.

## 2.94.0 -- 2026-09-27

**« Attendez, il sera offert » : les chances de vos souhaits**

- **« Vos souhaits »**, une section du popup (tout dans le tableau de bord) :
  chaque jeu attendu -- saisi, ou importe de Steam ou de GOG -- avec ses
  chances de passer gratuit, fortes, moyennes ou faibles, et POURQUOI :
  deja offert (et quand, et ou), un editeur qui offre des jeux, l'age du
  jeu, son prix de catalogue. Les meilleures chances d'abord. Une
  estimation, dite comme telle -- jamais un pourcentage invente.
- **Les indices.** Ce que l'extension a vu passer (les offres terminees,
  prises ou ratees) ; les editeurs des offres Epic, retenus a chaque cycle
  (Epic nomme le vendeur) ; la fiche Steam du souhait, lue sans cookie,
  huit par heure, gardee trente jours.
- **Mesure du 2026-09-27** : Steam range parfois sa reponse `appdetails`
  sous une autre cle que celle demandee (Hades sous celle d'un de ses DLC).
  Les DLC gratuits (2.92.0) et les chances la lisent desormais par
  `steam_appid`.
- **Dans l'appli Android 1.7.0**, onglet Souhaits : les memes chances, les
  memes raisons, et « Tes meilleures chances » en tete. Les editeurs sont
  appris des offres Epic vues par la veille de fond du telephone.

## 2.93.0 -- 2026-09-27

**Votre annee en jeux gratuits, en image**

- **« Mon annee en image »** (Resume, dans le popup et le tableau de bord ;
  l'onglet Recuperes de l'appli Android 1.6.0) : une image de 1080 x 1350,
  le format que les reseaux prennent tel quel, aux couleurs de l'extension --
  la valeur recuperee dans l'annee, le nombre de jeux en tampon, les
  magasins, les trois plus chers sur un billet poinconne, le mois record, le
  mieux note sur Steam (cinquante avis au moins), ce que le telephone ou le
  PC a pris.
- **Telecharger, copier, partager.** Dans l'extension : un fichier PNG, ou
  l'image dans le presse-papiers, a coller dans Discord. Dans l'appli : le
  partage d'Android, depuis le cache de l'appli seulement (FileProvider).
  Rien ne part tant qu'on ne l'a pas envoye soi-meme.
- La source est le registre, jamais purge : ce qui a ete PRIS cette annee-la,
  pas ce qu'on avait deja.

## 2.92.0 -- 2026-09-27

**Les DLC gratuits de vos jeux Steam**

- **Trouves tout seuls.** A partir des jeux Steam de Ma collection,
  l'extension cherche leurs DLC gratuits -- camions, bandes-son, packs --
  que vous n'avez pas encore : huit jeux par passage, chacun relu une fois
  par mois, chaque candidat verifie (gratuit ET deja sorti : un DLC sans
  prix n'est pas forcement gratuit). Une notification quand il en arrive,
  une section « DLC gratuits de vos jeux Steam » dans le popup, avec le jeu,
  « Ouvrir » et une croix pour masquer.
- **Ajoutes par Steam lui-meme.** Un DLC gratuit n'a pas de paquet que le
  web puisse ajouter : sa fiche propose « Telecharger », qui passe par
  l'application Steam. L'extension ne se fait pas passer pour le client
  Steam ; elle trouve, vous ajoutez d'un clic sur la fiche.
- Mesure sur Steam le 2026-09-27 : Euro Truck Simulator 2 a sept DLC
  gratuits (des camions), trouves en un passage. Coupable dans Reglages ->
  Magasins.

## 2.91.0 -- 2026-09-27

**Le scanner de page**

- **« Cette page »**, en haut du popup : sur un article, un fil Reddit, la
  description d'une video, l'extension dit quels jeux la page cite, et pour
  chacun ce que vous en avez -- gratuit maintenant (avec « Recuperer »), dans
  vos souhaits, deja a vous (et depuis quand), ou pas a vous (avec
  « Souhaiter »). Du plus utile au moins utile.
- **Deux lectures.** Les liens vers une fiche Steam, Epic, GOG, Humble,
  Fanatical, Green Man Gaming, IndieGala ou itch.io -- meme caches derriere
  une redirection YouTube, Reddit ou Google -- et, dans le texte, les titres
  que l'extension connait deja (registre, catalogue, collection, souhaits).
  Un titre d'un seul mot (« Control ») ne compte que dans un titre de
  section, un passage en gras ou un lien.
- **Permission `activeTab`** : la page ouverte est lue une fois, sur ce clic,
  et rien de ce qui est lu ne quitte la machine ni n'est garde. Aucun acces
  permanent a aucun site ; Chrome ne l'annonce pas a l'installation.

## 2.90.0 -- 2026-09-27

**L'alarme de derniere chance**

- **Appli Android 1.5.0, en option** (Reglages -> Veille -> Alarme de
  derniere chance) : un jeu de ta liste de souhaits est gratuit, finit dans
  moins de trois heures, et n'est toujours pas a toi -- un captcha, une
  session perdue, un magasin que l'appli ne sait pas prendre. Le telephone
  sonne comme un reveil, sur le flux des alarmes, meme en mode silencieux, en
  boucle jusqu'a ce que tu la touches ; ouvrir l'appli la fait taire. Une fois
  par jeu.
- **Sans alarme exacte** : la permission est reservee aux reveils. L'appli
  pose une alarme ordinaire qui traverse la veille profonde, servie au plus une
  heure en retard par Android 12+ : elle sonne entre trois et deux heures avant
  la fin. Chaque passage de la veille fait sonner ce qui est deja dans la
  fenetre.
- **Cote extension**, pour qui n'a que l'appli ntfy : avec l'alerte
  « jeux attendus », la derniere chance part en priorite urgente (longues
  vibrations, et l'appli ntfy peut la laisser passer « Ne pas deranger »).
  Une fois par offre, jamais en heures calmes.

## 2.89.0 -- 2026-09-27

**Le PC a besoin de toi : une verification finie sur le telephone**

- **Un captcha arrete le PC pendant que tu es dehors ?** Le telephone sonne.
  L'alerte ntfy du defi (avec le relais associe) s'ouvre directement dans
  l'appli Android 1.4.0 sur ce jeu : « Finir ici », tu fais la verification
  sur le telephone, et le jeu est pris avec la session du telephone. Rien
  n'est resolu a distance, rien n'est resolu par l'appli.
- **Le relais apprend « a l'aide »** (`help`) : le PC l'envoie quand un defi
  l'arrete ; l'appli le lit a chaque passage, notifie une fois, et affiche un
  bandeau « Le PC a besoin de toi » en tete des jeux. Dans l'autre sens, un
  defi rencontre ecran eteint par le telephone fait retenter ce jeu au PC des
  son cycle suivant (le recul est efface, pas une mise de cote).
- **Le lien de l'appli** `fgclaimer://finir?s=&i=&t=` ne fait que designer
  un jeu : l'appli le cherche dans ses propres offres, ne suit aucune adresse
  venue du lien, et ne recupere rien sans un appui. Vecteur commun extension
  / appli dans `test/fixtures/relais.json`.

## 2.88.0 -- 2026-09-27

**La signature, des survols lisibles, et l'appli sur tous les ecrans**

- **La signature.** Trois gestes qui n'appartiennent qu'a ce projet, dans
  l'extension comme dans l'appli : chaque jeu offert est un **billet**,
  poinconne sur les deux bords et perfore sous la jaquette ; un **tampon**
  « RECUPERE », de travers, sur ce qui a ete pris ; une bande **timecode** qui
  egrene la prochaine fin d'offre, en chiffres jaunes sur noir. Le bandeau de
  l'anti-doublon prend son titre en tampon.
- **Survols lisibles.** Le texte blanc ou jaune qui disparaissait sur le vert
  clair au passage de la souris : boutons, filtres, onglets et liens gardent
  un texte noir (ou un aplat noir) au survol, partout.
- **Sections repliees dans le popup.** Elles s'ouvrent a la demande et le
  popup se souvient de chacune ; le tableau de bord garde les siennes
  ouvertes, avec sa propre memoire.
- **Appli Android 1.3.0.** La meme signature ; et tous les ecrans : rail de
  navigation sur le cote des 600 dp (paysage, pliable ouvert, tablette), jeux
  en 2 ou 3 colonnes, reglages dans une colonne lisible ; en grande police,
  les titres retrecissent au lieu de couper un mot et les boutons passent a
  la ligne ; cibles tactiles de 48 dp, roles TalkBack, encoches respectees.
  L'APK est publie sur les releases GitHub du depot (tag `app-v1.3.0`) et
  s'installe par-dessus la 1.2.0.

## 2.87.0 -- 2026-09-26

**Le relais avec le telephone, et l'anti-doublon au moment de payer**

- **Relais PC <-> telephone.** L'extension et l'appli Android (1.2.0) se
  disent ce qu'elles recuperent : celui qui est allume prend le jeu, l'autre
  l'inscrit au registre et ne le retente pas ; un jeu en cours sur l'un est
  laisse de cote par l'autre. Association par QR code (Reglages -> Relais avec
  le telephone), dessine en SVG par le generateur de Nayuki (MIT), embarque.
  Transport ntfy, **chiffre de bout en bout** (AES-256-GCM) ; le secret n'est
  ni synchronise ni sauvegarde. Le popup confirme l'association des que le
  telephone parle. Protocole : `docs/specs/2026-09-26-relais-design.md` ;
  vecteur commun `test/fixtures/relais.json`, rejoue par l'extension, par
  l'appli (Kotlin) et par OpenSSL.
- **Anti-doublon au moment de payer.** Sur la fiche d'un jeu payant, un
  bandeau jaune dit qu'il est deja a vous AILLEURS : recupere sur Epic le 12
  mars 2024, pris par le telephone, ou dans votre bibliotheque GOG. Sur Epic,
  GOG et Steam d'office ; sur Humble Bundle, Fanatical, Green Man Gaming,
  Gamesplanet et IndieGala a la demande (Reglages -> Sur les pages que
  j'ouvre), chacun avec sa permission facultative. Jamais sur la boutique ou
  vous l'avez deja, jamais quand il y est gratuit.
- L'alerte telephone coupee ne retire plus la permission de ntfy.sh si le
  relais s'en sert.

**L'appli Android 1.2.0** (dans `android/`) : connexion Epic guidee quand
Google ou Facebook refusent (mot de passe Epic), recuperation ecran eteint en
option, relais avec le PC, anti-doublon au partage d'une fiche, section
Confidentialite, et `android/CONFORMITE.md` -- les regles d'Android et de
Google Play, point par point.

1442 tests pour l'extension ; 29 pour l'appli.

## 2.86.0 -- 2026-09-26

**L'interface brute, jaune cyber**

- **Les pages de l'extension prennent le style de l'appli Android 1.1.0** :
  fond noir ou blanc, un seul accent jaune cyber (#E8FF00), traits noirs de
  3 px, ombres portees dures et decalees, angles droits, titres en Archivo
  Black et texte en Space Mono. Le popup, le tableau de bord, l'historique,
  le journal, la collection, le diagnostic et la veille en repli.
- **Clair et sombre** : le theme suit le systeme, ou le choix fait dans
  Apparence. En sombre, les ombres sont jaunes ; en clair, noires.
- **Une seule feuille**, `pages/brut.css`, chargee APRES le style de chaque
  page : elle redefinit les couleurs partagees (`--ink`, `--paper`,
  `--amber`...) et habille boutons, puces, cartes, sections et champs. Le
  code des pages ne change pas ; retirer la ligne `<link>` rend l'ancien
  style.
- **Les polices voyagent avec l'extension** (`pages/fonts/`, woff2, sous-
  ensemble latin, 52 Ko en tout), avec leur licence OFL. Aucune police
  n'est chargee depuis le web.
- `build/package.mjs` suit desormais les `url(...)` des feuilles CSS, et
  joint la licence OFL de chaque police qu'il embarque.
- Details : les cartes de jeux sont decalees une sur deux ; le grand
  chiffre des economies devient un bloc jaune ; les lignes cliquables de
  « Bientot » passent au jaune au survol ; une case a cocher passe a la
  ligne au lieu de couper sa phrase ; le tri « Fin la plus proche » n'est
  plus coupe dans le popup.

Le panneau affiche sur les pages des magasins garde son style : il vit dans
la page du magasin, ou les polices de l'extension demanderaient une
ouverture (`web_accessible_resources`) qu'il ne vaut pas la peine de faire.

1418 tests.

## 2.85.1 -- 2026-09-26

**L'appli Android, et les jaquettes GOG**

- **Une vraie appli Android** (`android/`, version 1.0.0) : ecrans natifs en
  Kotlin et Jetpack Compose, pas une page web emballee. Jeux gratuits du
  moment (Epic, GOG, Steam, Amazon, autres magasins, jeux mobiles d'Epic, ce
  qu'Epic annonce), jaquettes, valeur, temps restant, note Steam ; veille de
  fond toutes les 1 a 12 heures et a l'heure exacte de la prochaine
  ouverture d'Epic ; une notification par jeu, avec sa jaquette et un bouton
  **Recuperer** ; rappel le dernier jour ; souhaits, y compris en
  **partageant** une fiche de jeu depuis n'importe quelle appli ; ecran des
  jeux recuperes ; francais, anglais, allemand, espagnol.
- **Le moteur de l'appli est celui de l'extension**, recopie a chaque build :
  il joue dans une vraie page du magasin, dans toutes ses frames, et parle a
  l'appli avec le protocole de `watch/claim.js` (pilote, pret, ordre,
  verdict). Epic, GOG et Amazon Luna ; Steam en option, avec `steamPageStep`
  et le meme rythme lent. Verifie dans Chromium sur une fausse fiche Epic :
  le moteur, habille par la passerelle de l'appli, va jusqu'au verdict
  « claimed » et ecrit son historique.
- **Aller-retour avec l'extension** par fichier : l'appli importe la
  sauvegarde de l'extension (historique, souhaits, listes Steam et GOG) et
  ecrit un fichier que « Restaurer » fusionne. Jamais un cookie, jamais un
  code.
- **Les jaquettes GOG s'affichent enfin.** GOG publie ses images sans
  extension, et cette adresse nue repond 404 (mesure du jour) : les cartes et
  les notifications GOG restaient sur leur initiale. `gogImage` ajoute `.jpg`.
- `build/package.mjs` range `android/` parmi les dossiers d'atelier : l'appli
  embarque le moteur, elle ne fait pas partie de l'archive de l'extension.

1418 tests pour l'extension ; 17 pour l'appli, dont 8 sur les memes captures
que l'extension.

## 2.85.0 -- 2026-09-26

**« fg » dans la barre d'adresse**

« Est-ce que je l'ai deja ? Est-il gratuit quelque part ? » -- la question
vient en lisant un article, un message, un forum, et la reponse etait a trois
clics.

- **Tapez `fg`, un espace, puis un titre** dans la barre d'adresse de Chrome.
  Chaque jeu qui correspond donne UNE suggestion, qui dit le plus utile, dans
  cet ordre : gratuit en ce moment (« Hades -- gratuit sur Epic Games Store
  jusqu'au 29 sept. », suivi de « deja a vous » le cas echeant), bientot
  gratuit (annonce d'Epic), deja recupere par l'extension (et quand), deja
  dans une bibliotheque importee, ou dans vos souhaits. Le titre exact passe
  devant ; deux lettres au moins.
- **Choisir une suggestion ouvre la fiche** du jeu quand on la connait ;
  **Entree sur le texte seul** ouvre le tableau de bord avec la recherche
  remplie (`?q=`). Jamais une adresse qui n'est pas https.
- **Rien ne sort de la machine** : tout est lu dans le stockage de
  l'extension, garde en memoire tant qu'il ne change pas. La cle `omnibox`
  du manifeste n'est pas une permission.

Verifie dans l'extension chargee dans Chromium : le mot-cle est pris,
l'API presente, et `?q=mecha` filtre le tableau de bord. La saisie dans la
barre d'adresse elle-meme, native, ne se pilote pas d'un script : les
suggestions sont verifiees par les tests.

1417 tests.

## 2.84.0 -- 2026-09-26

**Le mode vacances**

Partir une semaine sans ordinateur, c'etait revenir a une pile de
notifications -- une par jeu, une par rappel, une alerte de session -- et a un
telephone qui avait sonne tous les jours pour rien. Or la recuperation, elle,
n'a besoin de personne.

- **Reglages -> Notifications -> Mode vacances** : 3, 7, 14, 21 ou 30 jours,
  a partir de maintenant ; « Prolonger » tant qu'il dure.
- **Des heures calmes qui durent des jours.** `effectiveQuiet` ajoute les
  vacances aux heures calmes des reglages, et tout ce qui previent les lit :
  annonces d'offres, rappels avant la fin, alertes (session perdue, canari),
  rappels de codes, recap du jeudi, telephone -- et les notifications du
  moteur pendant une recuperation de fond. Comme la nuit, ce qui arrive est
  RETENU : une offre encore ouverte au retour s'annonce au premier cycle, un
  code qui expire se rappelle. La sauvegarde automatique, qui n'est pas une
  notification, ne se tait pas.
- **La recuperation continue**, en silence.
- **Une bande ambre en haut du popup** tant qu'il dure : « En vacances
  jusqu'au mercredi 30 septembre : la recuperation continue, en silence »,
  avec « Je suis de retour ».
- **Au retour -- a la date prevue ou au clic --, un seul message** : « Bon
  retour : 2 jeux recuperes pendant votre absence », puis les lignes du recap
  du jeudi comptees depuis le depart (recupere, a prendre soi-meme, rate,
  annonce), ou « Rien de manque ». Une fois par depart, dans la semaine qui
  suit ; la nuit, il attend le matin. Il remplace le recap de la semaine, qui
  ne part pas en plus, et va sur le telephone si le recap y va.

Verifie dans l'extension chargee dans Chromium : depart de 14 jours, bande
et bouton « Prolonger » ; un depart commence trois jours plus tot, deux jeux
recuperes entre-temps, « Je suis de retour » -> la notification de retour,
le journal et la bande qui disparait.

1411 tests.

## 2.83.0 -- 2026-09-26

**La page Historique refaite**

La page Historique etait un tableau en police a chasse fixe : date, titre,
magasin, valeur, issue en toutes lettres, deux listes deroulantes pour
filtrer, et un second tableau « Mois par mois » plus bas.

- **Chaque offre terminee en carte**, comme « Deja recupere » dans le popup :
  la jaquette, le titre (lien vers la fiche quand il a survecu), le magasin
  en couleur, la valeur, la date, et l'issue en icone -- cercle coche vert
  (pris), point d'exclamation orange (rate), point d'interrogation rouge
  (incertain). Les mots et le verdict brut restent au survol. Deux colonnes
  sur une page large.
- **Groupee par mois**, et l'en-tete de chaque mois porte ses comptes
  (« pris 3 · rates 1 ») : le tableau « Mois par mois » disait la meme chose
  plus bas, il est parti.
- **Des puces pour filtrer**, par issue et par magasin, chacune avec son
  nombre sur tout l'historique. La recherche et l'export CSV restent.
- **Les jaquettes** : celle figee avec l'issue, sinon celle de la recherche
  Steam (2.81.0), demandee par lots de seize, chacune une fois, la page se
  redessinant a mesure qu'elles arrivent ; sinon l'initiale. Pour une image
  seulement, une edition connue compte : Steam ne connait plus « The Witcher
  3: Wild Hunt » que sous « ... - Complete Edition ». La note Steam, elle,
  garde le titre exact.
- **« Ce qui revient »** vide le dit en une phrase, au lieu d'en-tetes de
  tableau sans ligne.
- Les icones de statut vivent desormais dans `lib/status-icons.js`, partagees
  par le popup et la page. Corrige au passage : « rates » et « Rafraichir »
  sans leurs accents.

Verifie dans l'extension chargee dans Chromium, sur le vrai Steam, themes
clair et sombre : dix offres sur trois mois, neuf jaquettes trouvees, les
filtres « Rates » et « GOG ».

1402 tests.

## 2.82.0 -- 2026-09-26

**La note Steam sur les fiches Epic et GOG**

La 2.78.0 a mis la note Steam dans le popup. Mais c'est sur la fiche du jeu,
en se demandant s'il vaut la peine, qu'on la cherche -- et Epic ni GOG ne la
montrent.

- **Le panneau de la page l'affiche** en tete de « Sur cette page » : une
  etoile verte, orange ou rouge selon l'echelle de Steam, et « Steam : Tres
  positives (92 %) ». Le titre est celui que le panneau lit deja sur la fiche.
- **Elle ne compte pas parmi les faits** : ni dans la pastille du bouton, ni
  pour la bulle qui se montre la premiere fois qu'une fiche « a quelque chose
  a dire » -- presque chaque fiche a une note, et le bouton aurait parle
  partout.
- **Cherchee si besoin**, au titre exact, trois secondes et demie au plus,
  puis gardee une semaine comme les autres notes. Rien sur la fiche Steam, qui
  montre deja la sienne ; ni jeu mobile ni DLC ; « Notes Steam » dans
  Reglages -> Magasins la coupe ici aussi.

Verifie dans l'extension chargee dans Chromium, sur une fiche Epic factice
et le vrai Steam : « Steam : Tres positives (92 %) » pour Astrea.

1396 tests.

## 2.81.1 -- 2026-09-26

**Toutes les sections se replient**

Demande du meme jour, apres « Deja recupere » : « repliable aussi le reste ».

- **Vous attendent, Gratuit maintenant, A essayer ce week-end, Bientot** et,
  dans l'onglet Codes, **Codes a echanger** sont des plis, comme ceux des
  Reglages. Ouverts par defaut ; « Deja recupere » reste ferme.
- **Le compte reste dans le titre**, en orange, pour chacune -- y compris
  « Gratuit maintenant » (les jeux affiches) et « Bientot », qui n'en avaient
  pas, et « Deja recupere », dont le compte gris a droite rejoint les autres.
  Replie, rien n'est cache.
- **Un seul souvenir** pour tous (`folds` dans les preferences d'affichage),
  relu une fois a l'ouverture : un rendu suivant ne rouvre pas sous les
  doigts ce qu'on vient de fermer. Le reglage de la 2.81.0 est repris.

Verifie dans l'extension chargee dans Chromium : cinq plis fermes, le popup
recharge, ils le restent ; le tableau de bord a trois colonnes aussi.

1394 tests.

## 2.81.0 -- 2026-09-26

**« Deja recupere » : des jaquettes, des icones, et un pli**

Demande du 2026-09-26, capture a l'appui : deux jaquettes sur huit lignes,
des statuts en toutes lettres (« recupere », « deja possede », « deja
recupere », « ignore ») qui faisaient une colonne de texte, et une section
toujours depliee sous la liste des jeux.

- **Un pli**, ferme par defaut, comme ceux des Reglages : le titre garde le
  nombre de jeux (« Deja recupere 9 »), et le popup se souvient si on l'a
  laisse ouvert.
- **Une jaquette par ligne.** Celle du catalogue ou du registre d'abord ;
  sinon le service worker la cherche une fois pour toutes sur la recherche
  du magasin Steam, au titre normalise IDENTIQUE (ni la bande-son, ni la
  demo) ; sinon l'initiale du jeu, dans une tuile de meme taille. Mesure sur
  la liste signalee : les huit jeux trouves -- The Da Vinci Cryptex, High on
  Life, Hue, Mechabellum, Astrea, RiMS Racing, DOOM Eternal, Botany Manor.
  Seuls les titres affiches sont demandes, seize au plus ; un introuvable se
  redemande apres une semaine ; seules les images du CDN de Steam, en https,
  s'affichent.
- **Le statut en icone**, au bout de la ligne : cercle coche vert
  (recupere), double coche (deja a vous : possede ou recupere avant),
  cercle barre ambre (ignore), croix rouge (echec), horloge (en attente). Les
  mots restent en infobulle et pour les lecteurs d'ecran. Dessinees au DOM,
  jamais en innerHTML.
- **Le magasin sous le titre**, comme dans « Bientot » : EPIC, GOG, LUNA.

Verifie dans l'extension chargee dans Chromium, sur le vrai Steam, themes
clair et sombre : les huit jaquettes, les icones, rien ne deborde a 328 px ;
le pli ferme, puis rouvert apres rechargement.

1392 tests.

## 2.80.1 -- 2026-09-26

**Steam : un DLC gratuit demande son jeu de base -- et on le dit**

Signale le 2026-09-26 : « formulaire envoye, mais la page propose toujours
« Add to Account » -- arrive sur : Erreur du site -
https://store.steampowered.com/freelicense/addfreelicense/ », et le canari
concluait « ce magasin a probablement change sa page ».

La page n'avait pas change. L'offre Steam du jour etait un DLC, « Explosive
Odds - Supporter Pack » (-100 %), et Steam n'ajoute un DLC gratuit qu'a un
compte qui possede deja le jeu de base -- ici Explosive Odds, 1,99 EUR. Le
script de Steam le dit dans sa variante AJAX (`purchaseresultdetail == 24` :
« you must own the base product ») ; l'envoi du formulaire, lui, n'affiche que
« Erreur du site ». Mesure du meme jour : le formulaire, le bouton et
`addToCart()` sont inchanges, et c'est bien un envoi de formulaire classique
que Steam fait lui-meme.

- **La source Steam retient le jeu de base** de chaque DLC
  (`related_items.parent_appid` de GetItems).
- **Avant d'ouvrir quoi que ce soit**, la bibliotheque est lue : si le jeu de
  base n'y est pas, RIEN n'est envoye -- chaque refus comptait dans le quota
  d'activations de Steam, et le recul le retentait. Nouveau verdict « jeu de
  base requis », dans « Vous attendent », avec au survol ce qu'il faudrait
  acheter : « Explosive Odds (1,99 EUR) ».
- **Relu toutes les douze heures, jamais abandonne** : si vous achetez le jeu
  de base pendant l'offre, la verification suivante le voit (ou « Reessayer »
  tout de suite). Cette lecture ne coute ni le rythme de Steam (20 min entre
  deux recuperations), ni le plafond horaire, et l'offre Steam suivante garde
  son tour dans le meme cycle.
- **Le canari ne s'en mele plus** : « jeu de base requis » ne dit rien de la
  page du magasin.
- **Si un envoi echoue quand meme**, le journal cite ce que Steam ecrit sous
  « Erreur du site », au lieu du seul titre. Et si la bibliotheque, muette
  avant l'envoi, repond apres sans le jeu de base, le refus lui est impute.

1383 tests.

## 2.80.0 -- 2026-09-26

**Copier la liste, pour les copains**

La premiere chose qu'on fait d'un jeu gratuit, apres l'avoir pris, c'est le
dire aux autres. Il fallait recopier titre par titre, lien par lien.

- **« Copier la liste »**, sous « Gratuit maintenant », met dans le
  presse-papiers un texte pret a coller : « Jeux gratuits a recuperer --
  samedi 26 septembre », puis un jeu par ligne -- titre, magasin (et « DLC »),
  valeur, jusqu'a quand -- avec son lien dessous.
- **Ce qui est affiche** : la recherche et la puce de magasin comptent. Avec
  la puce « Epic », seuls les jeux Epic partent.
- **Puis, s'il y en a** : ce qu'Epic annonce (« Bientot ») et les week-ends
  gratuits de Steam. Quinze jeux au plus ; les suivants sont comptes.
- **Du texte simple** : Discord et WhatsApp le lisent pareil, et y font des
  liens des apercus avec la jaquette. Les titres de GamerPower perdent leur
  suffixe. Rien de personnel n'y entre -- ni ce que vous possedez, ni vos
  souhaits, ni vos codes -- et un lien qui n'est pas en https est ecarte.

Verifie dans l'extension chargee dans Chromium : le bouton dit « Copie »,
et le texte colle porte les trois jeux, « Bientot » et le week-end Steam.

1374 tests.

## 2.79.0 -- 2026-09-26

**Clic droit : « Me prevenir quand ce jeu sera gratuit »**

La liste de souhaits existe depuis la 2.31.0, mais s'y ajouter voulait dire
ouvrir le popup et taper le nom. C'est pourtant sur la fiche du jeu, en le
regardant, qu'on se dit « celui-la, s'il passe gratuit... ».

- **Sur une fiche Steam, Epic ou GOG**, le clic droit propose « Me prevenir
  quand ce jeu sera gratuit ». Le titre est lu comme le panneau de la page le
  lit deja (un selecteur par magasin), puis le titre du document, puis
  l'adresse.
- **Sur un lien vers une fiche**, depuis n'importe quelle page (Reddit, un
  forum, un mail) : la page qui porte le lien n'est pas lue ; le nom vient de
  l'adresse (`/app/1286880/Ship_Graveyard_Simulator/` -> « Ship Graveyard
  Simulator »).
- **Une notification confirme** : « Ajoute a vos souhaits : Squad ». Deja
  attendu -- a la main, ou par la liste Steam ou GOG importee, reconnue par
  l'appid meme sous un autre titre -- elle le dit sans rien ecrire deux fois.
  Gratuit EN CE MOMENT sur un magasin suivi : elle dit lequel, et un clic y
  mene.
- **Le rapprochement se fait sur le titre normalise** : « Astrea: Six-Sided
  Oracles » lu sur Steam reconnait « Astrea: Six Sided Oracles » offert sur
  Epic.
- **Mesure du 2026-09-26** : Squad et Ship Graveyard Simulator sur Steam, The
  Witcher 3 sur GOG (son titre de document porte « 50% de reduction » en
  promotion : retire). Epic, depuis un serveur, sert la page d'attente de
  Cloudflare (« One more step ») : elle est refusee comme titre, et
  l'adresse prend le relais.
- Permission `contextMenus` : n'ouvre l'acces a rien, et Chrome ne l'annonce
  pas. Le menu suit la langue choisie.

Verifie dans l'extension chargee dans Chromium : les deux entrees se creent
sans erreur, et le titre se lit sur les vraies fiches Steam et GOG.

1368 tests.

## 2.78.2 -- 2026-09-26

**L'identifiant d'un bot, reconnu dans ses deux formulations**

Telegram ne dit pas toujours « bot can't send messages to bots » : il dit
aussi « the bot can't send messages to the bot » (mesure du 2026-09-26, un
identifiant de discussion egal au numero du bot). La 2.78.1 ne reconnaissait
que la premiere et citait la seconde telle quelle. Les deux menent desormais
a la consigne : il faut VOTRE identifiant, que @userinfobot donne, pas le
numero au debut du jeton.

1357 tests.

## 2.78.1 -- 2026-09-26

**Telegram dit pourquoi il refuse**

« HTTP 403 : le bot n'a pas acces a cette discussion » couvrait cinq pannes
qui ne se corrigent pas pareil. Telegram donne la raison dans sa reponse
(`description`) ; l'alerte ne la lisait pas. Elle la lit desormais, et le popup
comme le journal disent quoi faire :

- **bot jamais demarre** : l'ouvrir dans Telegram et appuyer sur Demarrer --
  un bot ne peut pas ecrire le premier ;
- **bot bloque** : le debloquer, puis Demarrer ;
- **identifiant d'un bot** au lieu du votre -- le numero au debut du jeton est
  celui du bot, le votre vient de @userinfobot ;
- **groupe ou canal** qui n'a pas le bot, ou pas comme administrateur ;
- **discussion supprimee**.

Une raison inconnue est citee telle quelle, entre parentheses ; sans corps
lisible, la phrase d'avant. Rien de plus ne quitte la machine : c'est la
reponse de Telegram qu'on lit, pas une requete de plus.

1357 tests.

## 2.78.0 -- 2026-09-26

**La note Steam des jeux offerts**

« Gratuit » ne dit pas « bon ». Merite-t-il les 20 Go de l'installer ? La
reponse que tout le monde va chercher, ce sont les evaluations Steam.

- **« 84 % positif » au bout de chaque jeu gratuit**, dans la rangee des
  gestes (la ligne du dessus n'a plus de place a 328 px) : vert de « Plutot
  positives » a « Extremement positives », orange pour « Moyennes », rouge
  en dessous. En entier quand la page est large (« Tres positives · 84 % »),
  et au survol : l'echelle, le pourcentage et le nombre d'avis.
- **Les week-ends gratuits** la portent aussi, sur la ligne du prix : essayer,
  puis garder, les deux questions vont ensemble.
- **La notification d'un jeu annonce seul** a une seconde ligne : « Steam :
  Tres positives (84 %) ». Le worker va la chercher juste avant, six
  secondes au plus ; sans reponse, la notification part sans.
- **Mesure du 2026-09-26** sur Astrea et Mechabellum, gratuits sur Epic ce
  jour-la : `api/storesearch` trouve l'application, et on ne garde que le
  resultat au titre normalise IDENTIQUE -- ni la bande-son, ni la demo, ni un
  pack de skins. `appreviews/<appid>` rend l'echelle de Steam (1 a 9, traduite
  par son chiffre) et les nombres d'avis. Les titres de GamerPower sont
  cherches sans leur suffixe (« Dwarven Realms », pas « ... (Steam) Key
  Giveaway »).
- **Toutes langues**, et c'est dit dans l'infobulle : la fiche Steam montre le
  score de la langue du visiteur quand il y en a assez (Squad : 84 % sur les
  avis anglais, 82,5 % toutes langues).
- **Poli envers Steam** : huit jeux au plus apres chaque cycle, chacun relu
  une fois par semaine ; un jeu que Steam ne connait pas, tous les trois
  jours. Ni les jeux mobiles, ni les DLC. Sans cookie, et sans permission
  nouvelle. Reglages -> Magasins -> « Notes Steam » la coupe.

Verifie dans l'extension chargee dans Chromium, sur le vrai Steam : Astrea
92 %, Mechabellum 84 %, Dwarven Realms 81 %, Squad (week-end) 83 %, un titre
invente reste sans note ; rien ne deborde a 328 px, themes clair et sombre.

1356 tests.

## 2.77.0 -- 2026-09-26

**La sauvegarde se fait toute seule**

La 2.74.0 a donne une sauvegarde qui ramene tout -- encore fallait-il penser a
la faire. Une extension chargee depuis un dossier perd tout son stockage le
jour ou on la retire de chrome://extensions, et personne n'exporte « au cas
ou ».

- **Une fois par semaine**, le fichier se depose dans
  `Telechargements/free-games-claimer/`. Les quatre derniers restent, le plus
  ancien est efface -- du disque et de la liste des telechargements. Si rien
  n'a change depuis le dernier, aucun nouveau fichier.
- **Le fichier est celui de la restauration** : le bloc `backup` de la 2.74.0
  et le bilan, sans le catalogue ni l'etat des sources, qui se reconstruisent
  en un cycle. Toujours sans l'alerte du telephone.
- **La permission `downloads` est l'interrupteur** (Reglages -> Sauvegarde) :
  optionnelle, demandee au clic, rendue au clic. Le premier fichier part tout
  de suite ; la ligne dessous dit quand est partie la derniere et combien sont
  gardees, et « Montrer le fichier » ouvre son dossier. Absente du manifeste
  Firefox. SECURITY.md dit ce qu'elle permettrait en plus -- lire la liste des
  telechargements -- et que l'extension n'y cherche que ses propres fichiers.
- Elle attend la fin des heures calmes, et un echec retente six heures plus
  tard sans oublier les fichiers deja deposes.
- **L'export a la main et la sauvegarde de la semaine sortent de la meme
  fonction** (`exportFromStorage`) : un seul format, ou qu'il soit produit.
- Corrige : le texte « La sauvegarde garde tout... » s'affichait deux fois
  dans le volet depuis la 2.74.0.

Verifie dans l'extension chargee dans Chromium : fichier depose depuis le
service worker en 0,2 s, relu et restaurable, sans le secret du telephone ;
3,3 Mo (12 000 jeux de collection) en moins d'une seconde ; l'export a la
main inchange.

1343 tests.

## 2.76.0 -- 2026-09-26

**Le grand chiffre du tableau de bord**

Le Bilan disait deja « 24 jeux recuperes, dont 24 a prix connu : 364,76 EUR »,
une ligne parmi d'autres au fond des Reglages. C'est pourtant LA raison
d'avoir l'extension.

- **En tete du tableau de bord**, sous l'en-tete et avant les volets : « Economise
  depuis le debut », la somme en grand (52 px), puis le nombre de jeux et
  « +24,98 EUR ce mois-ci ». La somme est celle du Bilan, convertie de la meme
  facon ; le mois est compte en UTC, comme le graphique et « meilleur mois ».
- **Ce qui etait deja a vous ne compte pas** : un jeu trouve dans la
  bibliotheque n'a rien rapporte. Si certains jeux n'ont pas de prix connu,
  la ligne le dit (« 24 jeux recuperes, dont 20 a prix connu »).
- **Pas dans le petit popup**, ou la place va aux jeux ; et rien tant
  qu'aucun jeu n'a de valeur connue.

Verifie dans l'extension chargee dans Chromium, themes clair et sombre, avec
un historique de 24 jeux : le chiffre au tableau de bord, rien au popup.

1330 tests.

## 2.75.0 -- 2026-09-26

**Les week-ends gratuits de Steam**

Steam ouvre regulierement un jeu payant a tous, quelques jours : « Free
Weekend », « Play for free until Sep 28 ». Rien a garder, donc rien que
l'extension doive reclamer -- et c'est pour cela que la source Steam les
ignorait. C'est pourtant ce qu'on aime savoir le vendredi soir.

- **Une section « A essayer ce week-end »** dans l'onglet Jeux (et en grille
  dans le tableau de bord) : la jaquette, le titre, le temps qui reste
  (« 2 j 7 h », la date exacte au survol), et le prix si on veut le garder --
  souvent en promotion ce week-end-la (« -93 % · 1,03 EUR »). Un clic ouvre la
  fiche Steam. Rien n'est jamais reclame.
- **Mesure du 2026-09-26**, avec deux week-ends en cours, Squad et Ship
  Graveyard Simulator : la page d'accueil du magasin declare ses jeux dans
  `GStoreItemData.AddStoreItemDataSet` et y marque ces deux-la
  `free_weekend: true` ; la recherche ne les marque pas, et
  `api/featuredcategories` ne montre que celui mis en avant.
  `IStoreBrowseService/GetItems`, deja lu par l'extension, rend pour eux
  `free_weekend: { start_time, end_time }` -- et rien pour un free-to-play.
  La page d'accueil designe donc les candidats, GetItems confirme et date.
- **Lu au plus toutes les six heures**, sans cookie, et seulement si Steam est
  suivi : la page d'accueil pese pres d'1 Mo. Un echec garde la liste connue
  et retente dans une heure.
- Reglages -> Magasins -> « Week-ends gratuits Steam », actif par defaut, les
  coupe.

Verifie dans l'extension chargee dans Chromium, sur le vrai Steam : apres un
cycle, Squad (-50 %) et Ship Graveyard Simulator (-93 %), jusqu'au 28
septembre 17:00 UTC, dans la section, sans debordement a 328 px.

1325 tests.

## 2.74.0 -- 2026-09-26

**Une sauvegarde qui ramene tout**

« Exporter en JSON » ne restaurait que les codes, les filtres et les
reglages. Or une extension chargee depuis un dossier perd tout son stockage
des que Chrome la voit sous un autre identifiant -- un autre dossier, un autre
ordinateur, une reinstallation. Les jeux recuperes, leur historique, le
graphique du Bilan, les listes de souhaits s'en allaient avec.

- **Le fichier emporte tout ce qui ne se reconstruit pas seul** : le registre
  des jeux recuperes, les historiques du moteur, les issues des offres (page
  Historique, graphique), les codes, les listes de souhaits (saisie, Steam,
  GOG), la collection importee, les libelles appris, les reglages, le pays,
  les interrupteurs du moteur et les preferences d'affichage. Le catalogue et
  l'etat des sources restent pour le diagnostic : ils se refont en un cycle.
- **« Importer » fusionne, il n'ecrase pas.** Ce qui est deja la reste ; le
  fichier complete. Le registre garde la premiere date d'un jeu, un
  historique n'est jamais remplace par une entree plus ancienne du fichier, et
  les listes importees ou la collection ne reviennent que si rien ne les
  remplace encore. Restaurer deux fois n'ajoute rien.
- **C'est le service worker qui restaure**, lui seul ecrit ces donnees. Le
  fichier est une entree non fiable : chaque cle est relue avec sa forme, un
  libelle appris repasse par la garde qui refuse ce qui parle d'argent, et la
  recuperation Steam ne se rallume jamais depuis un fichier.
- **Pas de secret dedans** : l'alerte du telephone (adresse ntfy, webhook
  Discord, jeton Telegram) n'est pas sauvegardee.
- Une sauvegarde d'avant la 2.74.0 se restaure toujours (codes, filtres,
  reglages).
- L'aide des touches du popup (1, 2, 3, /, Echap) quitte le pli Sauvegarde,
  ou elle etait perdue, pour rejoindre « Raccourcis clavier » -- et son
  ancien titre, que la 2.69.0 avait ecrase, ne fait plus doublon.

Verifie dans Chromium sur deux profils : un export depuis le premier, un
import dans le second, vierge -- codes, historique, registre, souhaits, theme
et reglages reviennent, l'adresse du telephone ni ne part ni ne revient, et le
message dit « 2 jeux, 1 code, 1 souhait ajoutes ».

1320 tests.

## 2.73.0 -- 2026-09-26

**Un code ne se perd plus au fond de l'onglet Codes**

Luna donne certains jeux sous forme de code a echanger chez GOG ou Microsoft,
avec une date limite. L'onglet Codes l'affichait en rouge a sept jours --
encore fallait-il l'ouvrir. Un code oublie, c'est un jeu perdu sans bruit.

- **Une notification a sept jours de la date limite, puis le dernier jour**
  (la veille ou le jour meme) : « Un code GOG.com a utiliser d'ici demain --
  Right and Down : a echanger sur GOG.com avant le 27 septembre 2026 ». Un
  clic ouvre la page d'echange du magasin quand on la connait. Plusieurs codes
  dans la meme fenetre font une seule notification.
- **Chaque rappel ne part qu'une fois**, et le registre est ecrit avant de
  prevenir. Un code echange, refuse ou retire en sort.
- **Jamais le code lui-meme** -- ni a l'ecran, qu'un voisin peut lire, ni au
  telephone. Le jeu, le magasin, la date ; le code reste dans l'onglet Codes.
- Il suit le canal des **alertes**, pas celui des offres : couper les annonces
  de jeux ne coupe pas ce rappel. Les heures calmes le retiennent jusqu'au
  matin, et il part aussi sur le telephone, Discord ou Telegram si l'alerte
  est active.

Verifie dans l'extension chargee dans Chromium : deux codes, l'un pour le
lendemain, l'autre dans cinq jours, font une notification a deux lignes sans
aucun code ; un second cycle n'en refait pas.

1311 tests.

## 2.72.0 -- 2026-09-24

**Le graphique du Bilan, mois par mois**

Le Bilan disait « 24 jeux recuperes » et « meilleur mois : aout 2026 avec
5 ». Le rythme -- une annee qui s'accelere, un magasin qui se tait -- ne se lit
que dessine.

- **Douze mois en colonnes**, dans Reglages -> Bilan, et plus grand dans le
  tableau de bord. Une seule serie, les jeux que l'extension a pris : ce qui
  etait deja a vous n'y compte pas, comme dans le bilan. Les mois sont ceux de
  « meilleur mois », pour que les deux designent le meme.
- **Deux chiffres seulement sur les batons** : le mois le plus haut et le mois
  en cours. Le survol -- ou la touche Tab -- donne le nombre et la valeur de
  chaque mois ; « Voir en tableau » les donne tous, sans pointeur.
- **La valeur n'a pas de second axe** : autre grandeur, et parfois deux
  devises qui ne s'additionnent pas. Elle est dans l'infobulle et le tableau,
  convertie comme ailleurs dans le popup.
- **Une couleur validee** contre le fond, en sombre et en clair : un ambre
  plus sourd que celui des boutons, qui sortait de la bande de clarte
  lisible pour des colonnes.
- Pas de graphique tant qu'un seul mois a quelque chose : un baton seul ne
  montre aucun rythme.
- Le CHANGELOG de la 2.71.0 retrouve son nombre de tests, perdu a la fusion
  avec la 2.70.1.

Verifie dans l'extension chargee dans Chromium, sur un an de reclamations :
popup en sombre et en clair, tableau de bord, infobulle a la souris et au
clavier, aucun debordement a 328 px.

1305 tests.

## 2.71.0 -- 2026-09-24

**Les alertes sur Discord ou Telegram**

Les alertes du telephone -- pannes, captchas, jeux attendus, jeux mobiles
d'Epic, recap du jeudi -- ne partaient que par ntfy, donc vers une appli de
plus a installer.

- **Un choix de service** dans Reglages -> Notifications -> Alertes : ntfy,
  Discord ou Telegram. Les memes alertes, aux memes moments ; seul le
  transport change.
- **Discord** : l'adresse d'un webhook de salon (Parametres du salon ->
  Integrations -> Webhooks). Une adresse `discordapp.com` ou `ptb.` est
  ramenee a `discord.com`. Le message part sans mention possible : un titre
  de jeu qui contiendrait « @everyone » n'appelle personne.
- **Telegram** : le jeton d'un bot cree avec @BotFather, et l'identifiant de
  la discussion (un numero, ou @canal). Texte brut, sans mise en forme
  interpretee.
- **Le secret reste secret** : l'adresse du webhook et le jeton du bot
  suffisent a ecrire a votre place ; ils vivent sous `veille:telephone`, ne
  vont ni au journal ni dans l'etat du dernier envoi -- un test le verifie.
  La permission n'est demandee que pour l'hote du service choisi, et un echec
  dit quoi corriger (« webhook Discord supprime », « discussion introuvable --
  ecrivez d'abord au bot »).
- Les champs de texte du popup prennent enfin le style des autres.

Verifie dans l'extension chargee dans Chromium, contre de faux serveurs
Discord et Telegram en local : l'essai arrive a chacun, en JSON, au bon
chemin. La boite de permission du navigateur, elle, a ete court-circuitee
pour l'essai ; avec la permission accordee pour de vrai, l'extension n'est
pas soumise au CORS de ces services.

1299 tests.

## 2.70.1 -- 2026-09-24

**Le bouton suit la navigation d'Epic**

Epic change de page sans recharger. La fiche d'un jeu offert, ouverte depuis
l'accueil de la boutique, gardait le bouton de l'accueil : ni pastille, ni
bulle « Gratuit · encore 1 j 5 h », jusqu'au prochain rechargement. La meme
fiche chargee directement les avait. Le bouton lisait la page au chargement,
2,5 s apres, et a l'ouverture du panneau -- jamais apres un changement de
page. Depuis la 2.67.0 il reste sur toutes les pages : on le regardait.

- **Le bouton relit la page quand son CHEMIN change** : aussitot sur un
  retour arriere, sinon au rythme ou le moteur surveille deja la navigation
  (1,5 s). Epic et Amazon reecrivent la query en permanence (suivi,
  `?lang=`) : comme le moteur, le bouton l'ignore.
- **Jamais la fiche d'avant sur celle d'apres.** Le titre arrive apres
  l'adresse : on attend qu'il change -- 400 ms entre deux lectures, douze
  au plus -- puis une relecture differee, comme au chargement. Ce qu'on
  savait de la page quittee s'efface aussitot, et une reponse partie pour
  elle est ignoree.
- La bulle d'une fiche se dit une fois par page, et non plus une fois par
  onglet.

Verifie dans l'extension chargee dans Chromium, sur une boutique Epic
factice servie a sa vraie adresse, qui change de page par `pushState` et
rend son titre 600 ms apres : avant, la fiche de Shogun Showdown n'avait ni
pastille ni bulle ; apres, « 1 » et « Free on Epic Games Store · 1 d 5 h
left », et le retour a l'accueil les efface. Cinq des six nouveaux tests
echouent sur la version d'avant.

1293 tests.

## 2.70.0 -- 2026-09-24

**Le panneau des pages de magasin en clair**

Le bouton et le panneau poses sur Steam, Epic, GOG et Luna etaient toujours
sombres, meme quand le popup etait en clair.

- **Ils suivent le theme choisi dans Reglages -> Apparence** : clair, sombre,
  ou « systeme », qui suit celui de l'ordinateur -- et changent avec lui.
  Un changement se voit tout de suite, panneau ouvert compris.
- **Une palette claire a part entiere**, reprise du popup, et reglee pour se
  lire : chaque couleur de texte -- magasins compris -- depasse un contraste
  de 4,5 sur le fond, ce qu'un test verifie. L'ambre et les bleus de Steam et
  d'Amazon y sont un peu plus fonces que dans le popup pour y arriver.
- La pastille du nombre s'inverse en clair (sinon elle disparaissait sur le
  fond), le bouton « Recuperer » et l'icone gardent leur ambre : c'est la
  marque.

Verifie dans l'extension chargee dans Chromium, sur une fausse fiche Steam :
le panneau ouvert en clair, puis passe en sombre sans se fermer quand le
reglage change.

1287 tests.

## 2.69.0 -- 2026-09-24

**Des raccourcis clavier**

- **Alt+Maj+G** ouvre l'extension, **Alt+Maj+D** le tableau de bord (l'onglet
  deja ouvert s'il existe), **Alt+Maj+V** lance une verification, par le meme
  chemin que le bouton du popup -- depuis n'importe quelle page du
  navigateur. Aucune permission : un raccourci n'est qu'un geste de plus.
- **Reglages -> Raccourcis clavier** montre les touches que le navigateur a
  VRAIMENT attribuees, lues dans `commands.getAll` : celles du manifeste ne
  sont que suggerees, Chrome n'en donne pas une qui entre en conflit, et on
  peut les changer. « Changer les raccourcis » ouvre
  chrome://extensions/shortcuts ; sous Firefox, ou une extension ne peut pas
  ouvrir about:addons, le bouton n'apparait pas.

Verifie dans l'extension chargee dans Chromium : les trois touches sont
attribuees telles que suggerees, et le pli les affiche.

1284 tests.

## 2.68.0 -- 2026-09-24

**Le prix et la fiche des jeux mobiles d'Epic**

- **Le prix normal sur la carte** : « 5,39 EUR » pour Mindcop, lu dans
  l'option `Purchase` de la reponse -- le nombre et la devise, que le reste
  de l'extension sait deja afficher et convertir. Un jeu offert pour toujours
  n'a pas d'option payante : pas de valeur inventee.
- **Un clic ouvre la fiche du jeu** sur le site d'Epic, et plus la page des
  jeux gratuits : la carte, la notification et l'alerte du telephone. Mesure
  du 2026-09-24 dans Chromium : `store.epicgames.com/fr/p/mindcop-android-
  0f4bac` repond 200 et se range en `/p/mindcop-android-0f4bac?lang=fr`, la
  vraie fiche de Mindcop. La fiche d'un slug iOS n'a pas pu etre ouverte
  (Cloudflare a arrete les essais suivants) : un jeu offert seulement sur iOS
  garde la page des jeux gratuits.
- Les offres deja au catalogue prennent le prix et la fiche au prochain
  passage de la source.

1281 tests.

## 2.67.0 -- 2026-09-24

**Le bouton est la sur toutes les pages des magasins**

On cherchait le bouton de l'extension sur Steam, et il n'y etait pas. Ce
n'etait pas une panne, c'etait la regle : il n'apparaissait que la ou le
moteur tournait, ou sur une fiche dont l'extension savait quelque chose (un
jeu offert, deja a vous, deja rate). Sur Steam, le moteur ne tourne pas ; le
bouton n'y etait donc que sur la fiche d'un jeu connu, et jamais sur
l'accueil, la recherche ou les autres pages -- le script n'y etait meme pas
injecte.

- **Sur toute page de Steam, d'Epic Games Store, de GOG et de Luna**, le
  bouton est la, meme sans rien a dire de la page. Son panneau montre ce qui
  est gratuit en ce moment -- ce qui vaut sur n'importe quelle page -- et
  ouvre le tableau de bord. La pastille et la bulle restent reservees a ce
  que l'extension sait de la fiche : un jeu inconnu n'affiche aucun compte et
  n'annonce rien.
- **Un panneau sans rien a montrer le dit** : « Aucun jeu gratuit en ce
  moment. », au lieu de s'ouvrir sur un en-tete seul.
- **Le bouton n'attend plus le service worker.** Il arrive des que sa place
  est relue, avec les libelles du navigateur, et la reponse du worker les
  remplace : un worker endormi ne le fait plus disparaitre.
- Ailleurs sous `*.epicgames.com` (compte, portail des developpeurs), la
  regle d'avant : rien sans moteur ni fait a dire.
- **Aucune permission de plus** : `store.steampowered.com` etait deja un
  hote autorise ; seul le script du bouton y est injecte sur toutes les pages
  au lieu des seules fiches `/app/`. SECURITY.md dit ce que cela laisse voir :
  le magasin peut constater, sur chacune de ses pages, qu'un element etranger
  y est pose.

Verifie dans l'extension chargee dans Chromium, sur l'accueil Steam et la
fiche de Counter-Strike 2 recopiees telles quelles et servies en local : le
bouton est present sur les deux ; ouvert sur l'accueil, il dit « No free
games right now. » sans offre au catalogue, puis liste Shogun Showdown, Dwarven
Realms et Astrea avec leur magasin et le temps qui reste. Le vrai site n'a pas
pu etre ouvert depuis le navigateur de cet environnement.

1279 tests.

## 2.66.1 -- 2026-09-24

**« Tester la recuperation » parle la langue du popup**

- **Un essai qui n'aboutit pas dit pourquoi dans la langue choisie.** La
  2.64.0 recopiait la phrase technique du journal, en francais et sans
  accents, quelle que soit la langue : un popup anglais affichait « The test
  did not finish: la page n'a pas fini de charger ». Chaque cause porte
  desormais un code -- page trop lente, moteur absent ou muet, page Steam sans
  reponse, controle d'age Steam -- que le popup traduit ; le journal garde sa
  phrase. Seule une exception du navigateur s'affiche telle quelle : son
  message est tout ce qu'on en sait. Un essai enregistre avant cette version
  s'affiche comme avant.
- **La feuille de route a jour.** Les entrees 3 (2.42.0) et 5 (2.59.1)
  rejoignent « Livre depuis » ; l'entree 4 dit comment le premier « Tout
  importer » connecte mesurera la liste de souhaits GOG ; les issues d'offres
  ne sont plus « lues par personne » -- l'Historique les lit depuis la
  2.32.0. L'entree 1 attend toujours son giveaway : la page d'accueil de GOG,
  relue le 2026-09-24, n'en porte aucun -- des regles de style
  `giveaway-*`, mais aucun element ni aucune donnee.

Verifie dans le vrai popup (`npm run preview`), en anglais et en francais :
« The test did not finish: the page did not finish loading. », « Le test n'a
pas abouti : l'extension ne s'est pas lancee sur la page. », et l'exception
recopiee telle quelle.

1275 tests.

## 2.66.0 -- 2026-09-24

**La liste de souhaits GOG**

La liste de souhaits Steam s'importait depuis la 2.46.0 : un jeu qu'on y
attend, offert n'importe ou, passe devant les autres, a sa notification a lui
et part sur le telephone. Celle de GOG restait a recopier a la main.

- **Importee avec la bibliotheque GOG**, par « Tout importer » dans Ma
  collection : une lecture de plus, au meme hote et avec la meme session. Un
  jeu de la liste GOG offert sur GOG est reconnu par son numero de produit,
  meme sous un autre titre ; offert sur Epic ou Steam, par son titre.
- **Son coeur est plein et ne se retire pas d'ici** : il reviendrait a
  l'importation suivante. L'infobulle dit de le retirer sur GOG, comme pour
  Steam. La saisie passe devant Steam, et Steam devant GOG.
- **Une liste illisible garde la precedente** et ne fait jamais echouer
  l'import de la bibliotheque : refus, forme inattendue, page en panne au
  milieu. Le rapport de l'import dit laquelle, sans recopier un titre.

Mesure du 2026-09-24, sans session : `www.gog.com/account/wishlist/search`
repond 403 « Full authentication is required », le meme refus que la
bibliotheque, alors qu'une adresse inventee au meme endroit repond 404. Sa
forme avec session n'a pas pu etre vue d'ici : le premier « Tout importer »
connecte la decrira dans le rapport.

1274 tests.

## 2.65.0 -- 2026-09-24

**Le recap du jeudi soir**

Epic change ses jeux le jeudi a 17 h. C'est le rendez-vous de la semaine, et
le bon moment pour dire en une notification ce que l'extension a fait pendant
qu'on ne regardait pas.

- **Une notification par semaine, le jeudi a 18 h** (heure de l'ordinateur),
  une heure apres la rotation -- le temps qu'un cycle voie les nouveaux jeux
  et les prenne : « Votre semaine : 3 jeux recuperes », puis
  « Recuperes : ... (valeur 24,98 EUR) », « A prendre vous-meme : Dwarven
  Realms (Steam), Mindcop (Epic Games (mobile)) », « Rates : ... »,
  « Bientot : Astrea Six Sided Oracles, Mechabellum ». Un clic ouvre le
  tableau de bord.
- **Ce qu'il compte** : les reclamations du moteur depuis le recap precedent,
  sans ce qu'il a seulement trouve deja a vous, plus Steam ; les offres en
  cours que l'extension ne prendra pas (Steam sans l'option, jeux mobiles,
  reclamation arretee sur une connexion ou un defi) ; les offres finies sans
  que le jeu arrive ; les ouvertures qu'Epic annonce dans les huit jours. La
  valeur n'est donnee que dans une seule devise -- dollars et euros ne
  s'additionnent pas.
- **Un seul par semaine.** Un ordinateur eteint le jeudi soir le recoit au
  reveil, jusqu'au dimanche soir ; lundi, il ne part plus. La date est ecrite
  avant la notification : mieux vaut en perdre un que l'envoyer deux fois.
  Une semaine sans rien a dire n'envoie rien. Les heures calmes le retiennent
  jusqu'au matin.
- **Reglages -> Notifications -> « Recap du jeudi soir »**, actif par defaut ;
  il suit « Me prevenir » (coupe, il ne part pas sur l'ordinateur). Sur le
  telephone, une case a part, « Aussi le recap du jeudi soir ».
- Les titres de l'agregateur y sont nettoyes comme dans le popup, et la
  liste « Bientot » du popup et celle du recap sont desormais la meme
  fonction.

Verifie dans l'extension chargee dans Chromium, reglee sur le fuseau de Tokyo
pour y etre jeudi 18 h 04 : apres un cycle sur les vrais magasins, la
notification est partie une fois, avec les vraies offres du jour ; relancee
une heure plus tard, rien. Les tests le verifient aussi a Paris et a Los
Angeles.

1268 tests.

## 2.64.0 -- 2026-09-24

**Tester la recuperation, sans rien recuperer**

La panne la plus frequente de ce projet est un magasin qui change sa page. Le
canari la voit, mais apres deux echecs de vraies reclamations -- quand un jeu
a deja failli etre rate. Desormais on peut demander avant.

- **Un bouton « Tester la recuperation »**, dans Reglages -> Magasins, sous
  les sessions. Pour chaque magasin que l'extension reclame (Epic, GOG,
  Amazon ; Steam si sa recuperation est activee), elle ouvre la page d'un jeu
  offert en ce moment dans une fenetre reduite, comme pour une reclamation,
  et le moteur la lit comme juste avant son premier clic : session, defi de
  securite, bouton reconnu. Puis la fenetre se referme.
- **Une ligne par magasin** : « bouton trouve -- « Obtenir » serait clique
  sur Shogun Showdown », « page reconnue » pour un jeu deja pris, « connexion
  requise », « verification anti-robot », « aucun bouton » avec **les boutons
  vus a la place** -- ce sont eux qui disent quel libelle a change --, ou
  « rien a tester » quand le magasin n'offre rien.
- **Rien n'est clique.** Le moteur recoit `fgc-inspecte`, jamais
  `fgc-reclame`, et le bloc qui lui repond n'appelle que des lectures ; un
  test y cherche tout clic, envoi de formulaire ou navigation. Steam rejoue
  son etape en `dryRun`. Un bouton reconnu mais payant est dit « refuse »,
  comme il le serait au clic. L'arret d'urgence empeche l'essai de partir.
- « il y a 0 min » devient « a l'instant », partout dans le popup.

Verifie dans l'extension chargee dans Chromium, contre de fausses pages
servies en local : Epic « Obtenir » trouve, GOG « aucun bouton » avec
« Acheter maintenant · Liste de souhaits », Steam « Add to Account » trouve,
Amazon « rien a tester » -- et le serveur n'a recu aucun clic ni aucun
formulaire. Sur les vraies pages, non connecte : GOG et Steam disent
« connexion requise », Epic « verification anti-robot » (Cloudflare).

1257 tests.

## 2.63.0 -- 2026-09-24

**Les notifications montrent le jeu**

C'est par une notification qu'on apprend qu'un jeu est offert, et elle ne
montrait que l'icone de l'extension et « Gratuit sur Epic Games Store ».

- **La jaquette du jeu, en grand**, sous le texte, pour l'annonce d'une offre
  et pour le rappel avant la fin. Chrome n'accepte pas d'image distante dans
  une notification : le worker la telecharge, la recadre en 2:1 sans la
  deformer, la reduit a 720 x 360 et la passe en `data:` -- une vignette Epic
  de pres d'1 Mo devient une trentaine de Ko. Mesure du 2026-09-24 : les CDN
  de Steam, Epic et GOG le permettent (`access-control-allow-origin: *`).
  Sans cookies, sans referent, 4 Mo et 5 secondes au plus ; le moindre
  echec, et la notification part avec l'icone, comme avant. Un resume de
  plusieurs jeux n'en porte pas.
- **Le temps qui reste** : « Gratuit sur Epic Games Store · encore 6 h 29 ».
  Le rappel suit le meme format -- « 3 h 20 », « 7 j 2 h » -- dans la langue
  choisie ; il ecrivait « 3 h » en dur, et aurait dit « 168 h » pour une
  semaine.
- **Des replis dans l'ordre** : image et boutons, image seule, boutons seuls,
  notification simple. Une plateforme qui refuse l'un ou l'autre (Firefox)
  ne fait jamais taire l'annonce.
- **Trente-cinq textes francais retrouvent leurs accents et leurs
  apostrophes**, restes de l'epoque ou tout s'ecrivait en ASCII :
  « Recuperer » sur le bouton des notifications, « Ajouter des cles a la
  main », « tant que l ordinateur est allume », « Rien n a ete lu »...

Verifie dans l'extension chargee dans Chromium, sur les vrais magasins : une
offre Epic reapparue est annoncee avec sa jaquette (type image, 25 Ko) et
« encore 6 h 29 », le rappel du DLC Dying Light avec la sienne ; aucune
erreur au journal. Le rendu sous Windows, lui, n'a pas pu etre vu d'ici.

1242 tests.

## 2.62.0 -- 2026-09-24

**Le panneau de la page redessine, et les DLC recuperes**

*Le panneau sur la page d'un magasin* -- le bouton de l'extension -- ne
montrait qu'un titre et des phrases. Il suit maintenant une grammaire de
cartes, sur le modele des panneaux d'extension de bons plans :

- **un en-tete** : l'icone, « Free Games », un bouton qui ouvre le tableau de
  bord, et la fermeture ;
- **« Sur cette page »** : le jeu de la fiche en carte -- sa vignette, son
  magasin, « DLC » s'il en est un, et « Gratuit · encore 5 h 37 » colore
  selon l'urgence --, puis ce que la carte ne dit pas deja (« a vous sur
  GOG », « aussi gratuit sur Epic », « deja rate une fois ») avec un signe
  par genre ;
- **le moteur**, sur les pages ou il tourne : son etat, « Tout recuperer »,
  la bascule automatique ;
- **« Gratuit en ce moment »** : les memes offres que le popup, la fin la plus
  proche d'abord, avec vignette, magasin et temps qui reste ; chaque ligne
  ouvre la fiche dans un nouvel onglet, et « Tout voir » ouvre le tableau de
  bord.

La bulle devient une petite carte : la vignette du jeu, son titre, et
« Gratuit sur Steam · encore 5 h 39 ». Ouvrir le panneau relit l'extension :
les comptes a rebours ne vieillissent pas. Une image qui ne charge pas -- une
page qui les interdit -- laisse sa premiere lettre.

*Les DLC.* Le pack d'armes de Dying Light, offert sur Steam, n'etait ni
recupere ni reconnaissable :

- **un DLC offert par le magasin lui-meme se recupere comme un jeu.** Le
  reglage « contenu en jeu » le bloquait avec le butin des agregateurs
  (skins, monnaie, objets lies a un autre jeu). Il ne garde la main que sur
  ce butin, et s'appelle desormais « Inclure le butin en jeu ». Sur Steam, la
  recuperation automatique reste une option a activer -- le contrat de Steam
  interdit l'automatisation, et ce choix reste le votre. La page du DLC a ete
  verifiee a blanc : meme bloc d'achat que celle d'un jeu, licence gratuite,
  « Add to Account » ; le module Steam la sait prendre ;
- **une etiquette « DLC »** sur les cartes du popup et du panneau.

*Un bug trouve en chemin, et plus grave* : **aucun jeu GOG offert n'etait
recupere par la veille**, tant que l'option des DLC restait coupee. La source
GOG recopiait le GENRE du jeu (« Simulation ») dans le champ que les filtres
lisent comme « jeu ou contenu additionnel ». Mesure du 2026-09-24 sur le
catalogue reel : c'est `type` qui le dit -- 1 un jeu, 3 un DLC. La source
Epic, elle, ne disait rien, et un jeu dont le titre contient « Pack »
passait pour un DLC ; elle lit desormais `offerType`.

Verifie dans Chromium sur les vrais magasins : la carte du DLC Dying Light,
la liste, « Tout voir », la bulle, sur la vraie page Steam ; le panneau du
moteur sur une page Epic ; l'etiquette « DLC » dans le popup.

1235 tests.

## 2.61.0 -- 2026-09-24

**Filtrer les jeux par magasin, et les vignettes Steam**

- **Des puces au-dessus des jeux** : « Tous 5 · Epic 2 · Steam 2 · Epic
  mobile 1 ». Un clic ne garde que les offres d'un magasin, un second clic
  revient a tout. Une puce par magasin qui a des offres, la plus fournie
  d'abord ; rien s'il n'y a qu'une boutique. Dans le popup comme dans le
  tableau de bord, et avec la recherche.
- **Le choix n'est pas memorise** d'une ouverture a l'autre, comme la
  recherche : un filtre « Steam » oublie cacherait, a la prochaine
  ouverture, le jeu Epic arrive entre-temps. Un magasin choisi qui n'a plus
  d'offre fait revenir a « Tous ».
- **Les offres Steam ont leur vignette.** La requete a Steam ne demandait pas
  les images (`include_assets`) : aucune offre Steam n'en avait, et la carte
  montrait une lettre. Mesure du 2026-09-24 : Steam rend un NOM DE FICHIER
  (`header`) et un modele d'adresse (`asset_url_format`) ; l'image est sous
  `shared.akamai.steamstatic.com/store_item_assets/`. Rien d'illisible ne
  devient une adresse.
- Le menu de tri ne coupe plus « Fin la plus proche ».

Verifie sur les vrais magasins, dans l'extension chargee dans Chromium : les
cinq sources repondent sans erreur (Epic, Epic mobile, GamerPower, GOG,
Steam) ; les puces « Tous 5 · Epic 2 · Steam 2 · Epic mobile 1 » ; le clic
sur Steam ne laisse que ses deux offres ; le pack Dying Light affiche sa
vraie vignette. Et le popup a 328 px, sans debordement.

1221 tests.

## 2.60.1 -- 2026-09-24

- « Repartir de zero » est centre sous la liste « Deja recupere ».

## 2.60.0 -- 2026-09-24

**Des boutons, pas des textes soulignes -- et une heure fausse en moins**

- **« Deja recupere » n'affiche plus d'heure.** L'heure notee etait celle ou
  le moteur avait CONSTATE l'etat sur la page du magasin, pas celle ou le jeu
  avait ete pris : Shogun Showdown et Mindcop, vus « deja possedes » a la
  meme visite, affichaient tous deux « 23 sept. 19:01 ». Une date fausse est
  pire que pas de date ; l'ordre reste le plus recent d'abord.
- **« Tout voir » est parti.** C'etait une copie pauvre de la page
  Historique, qui montre tout, filtre et exporte. La liste garde les 8
  dernieres (16 dans le tableau de bord).
- **Les gestes sont des boutons.** « Repartir de zero », « Reessayer »,
  « Retirer », « J'ai vu », « Se connecter », « Verifier les sessions »,
  « oublier », les libelles a apprendre, « Veille en repli » : des liens gris
  soulignes, qui se lisaient comme des adresses et se perdaient dans le
  texte. Ce sont maintenant des pilules a bordure, ambre au survol -- rouges
  pour ce qui efface (« Repartir de zero », « Retirer »).
- **Le pied de page** : « Ma collection », « Historique » et « Journal » en
  boutons, et le diagnostic en simple icone -- il ne sert qu'aux mesures.
- Dans Ma collection, « Se connecter » a l'allure des boutons voisins.

Verifie dans Chromium : le popup a 328 px (liste, pied de page, magasins,
code a echanger, alerte de magasin) et le tableau de bord a 1440 px.

1215 tests.

## 2.59.1 -- 2026-09-24

**Jeux mobiles Epic : la date de fin et la vignette sont mesurees**

L'API de decouverte d'Epic a pu etre lue directement, Android et iOS, le
2026-09-23 au soir (FR / fr). C'est la mesure qui manquait depuis la 2.57.0 :

- `purchase` est la LISTE des options d'achat. La premiere, `Claim`, a prix
  nul, porte la fin de la gratuite dans `discount.discountEndDate`
  (2026-09-24T15:00Z pour Mindcop) ; la seconde, `Purchase`, est le prix
  normal, qui prend effet a cette fin.
- `media` porte quatre images, chacune avec son `imageType` : l'icone
  (`appIcon`), la large (`card16x9`, OfferImageWide), la haute (`card3x4`)
  et la couverture (`coverImage`).

Les lecteurs de la 2.59.0 prennent deja les bons champs : la date dans
`purchase[0].discount.discountEndDate`, la vignette dans
`media.card16x9.imageSrc` -- ni l'icone, ni l'image haute. Cette version ne
change donc pas le code : elle fige la vraie reponse en capture de test
(`test/fixtures/epic-mobile-discover-android.json` et `-ios.json`, reduites a
trois rubriques, donnees publiques), et les tests s'y tiennent.

Verifie de bout en bout, dans l'extension chargee dans Chromium, sur le vrai
reseau : le magasin « Epic Games (mobile) » suivi, « Verifier maintenant »,
et la carte Mindcop -- Android, iOS -- s'affiche avec sa vignette et le
compte a rebours jusqu'au 24 a 15:00 UTC.

1212 tests.

## 2.59.0 -- 2026-09-23

**Jeux mobiles Epic : la date de fin et la vignette, reprises**

La 2.57.0 lisait la date de fin et la vignette d'un jeu mobile « avec
prudence », faute de connaitre la forme de `purchase` et de `media` -- et la
carte disait souvent « fin inconnue », avec une lettre a la place de l'image.
L'API d'Epic reste injoignable depuis l'endroit ou ce code est ecrit : la
forme exacte viendra du prochain rapport V8. Cette version fait en sorte que
ce rapport suffise, et lit mieux d'ici la.

- **Un defaut de la mesure, corrige.** La V8 recopiait la premiere offre
  ENTIERE, coupee a 6000 caracteres. Or `ageRating` et `media` passent avant
  `purchase` dans l'objet : la coupe pouvait tomber avant le champ cherche.
  `purchase` et `media` ont maintenant chacun leur ligne -- leur forme
  complete, puis leurs valeurs --, prises sur le premier jeu que la lecture
  manque (c'est lui qui dira quoi corriger), sinon sur le premier.
- **Le rapport dit ce que l'extension comprend.** Pour chaque jeu de la
  rubrique : la date de fin et la vignette retenues, et le chemin ou elles
  ont ete prises (`purchase[0].discount.discountEndDate`,
  `media.card16x9.imageSrc`...). La page l'affiche aussi (« date de fin lue
  pour 3, vignette pour 4 »), et le verdict dit si tout est lu.
- **La vignette est choisie, plus prise au hasard.** Chaque image recoit une
  note d'apres les cles qui y menent et le genre que son objet declare :
  large, 16x9, carte ou vignette gagnent ; logo, icone, portrait ou capture
  perdent. Les images sans extension du CDN d'Epic sont acceptees, les
  videos toujours refusees.
- **La date de fin se lit sous plus de noms** -- `end_date`, `validUntil`,
  `endsAt` -- et en secondes ou en millisecondes, toujours a condition d'etre
  a venir. Un debut n'est jamais pris pour une fin, et une chaine sans annee
  n'est pas une date.

Verifie : les lecteurs sur des formes plausibles, dont une offre de plus de
6000 caracteres ; dans Chromium, la mesure V8 sur des reponses simulees, un
jeu lu en entier et un jeu sans date.

1209 tests.

## 2.58.0 -- 2026-09-23

**Le tableau de bord : le popup, en grand**

Le design prevoyait un onglet dedie (§9) ; le popup portait tout dans
328 px. Il s'ouvre desormais EN GRAND, dans un onglet : c'etait la derniere
entree de la feuille de route qui n'attendait pas une mesure.

- **Deux portes** : le bouton en fleches de l'en-tete du popup, ou clic
  droit sur l'icone -> Options (la page d'options du manifeste). Un second
  clic ramene l'onglet deja ouvert au lieu d'en empiler un autre.
- **Cote a cote** au-dela de 760 px : les jeux en grille, avec des
  jaquettes plus grandes ; les codes, et sous eux la veille, ouverte avec sa
  bande de 24 heures ; les reglages au bout. Trois colonnes a partir de
  1240 px, deux en dessous. Le pied de page -- collection, historique,
  journal, diagnostics -- reste en bas de l'ecran. Plus etroit, l'onglet
  garde les trois onglets du popup, a pleine largeur ; 1, 2, 3 font defiler
  jusqu'au volet.
- **Une seule page** : c'est popup.html, dispose autrement. Un reglage ajoute
  au popup est aussitot dans le tableau de bord -- deux pages auraient
  diverge au premier.
- **Il vit** : un popup dure quelques secondes, le tableau de bord des
  heures. Il se relit chaque minute tant qu'on le regarde, et en revenant
  sur l'onglet (ce qui efface le badge, comme ouvrir le popup) ; il suit la
  langue et le theme changes depuis le popup ; ouvrir une fiche ou le
  journal ne le ferme plus.
- **Le vrai popup ne bouge pas** : la mise en page d'onglet n'y entre que
  par un marqueur pose quand la page se sait dans un onglet
  (`lib/dashboard.js` : la requete `?vue=onglet`, ou la liste des vues de
  type onglet, ou le popup ne figure jamais). Un doute vaut « popup ».
- `npm run preview` donne aussi l'adresse du tableau de bord.

Aucune permission nouvelle : une page d'options n'en demande pas.

Verifie dans Chromium : le tableau de bord a 1440, 1000 et 700 px, en clair
et en sombre, sans debordement ; le retour aux colonnes apres un passage
etroit ; le vrai popup, ouvert par `action.openPopup`, reste a 328 px avec
ses onglets ; son bouton ramene l'onglet existant et se referme ; un lien du
tableau de bord ouvre sa page sans le fermer.

1205 tests.

## 2.57.0 -- 2026-09-23

**Les jeux mobiles offerts par Epic**

La mesure V8 a tranche (rapport du 2026-09-23) : Epic ne met PAS ses jeux
mobiles dans `freeGamesPromotions` -- 13 offres, aucune mobile, et le filtre
`&platform=android|ios` ne change rien. Il les publie dans l'API de
decouverte de son application, `egs-platform-service`, sous la rubrique
`mobile-android-free-game` (`mobile-ios-free-game` sur iOS). La page des
jeux gratuits, elle, ne fait que renvoyer vers l'appli.

- **Une source**, `watch/sources/epic-mobile.js`, ecrite sur la forme
  mesuree : la rubrique, puis pour chaque offre `content.title`,
  `mapping.slug` et `systemSpecs.platform`. Le meme jeu a un slug par
  plateforme (« calico-android-83faf9 », « calico-ios-868e00 ») : il n'en
  fait qu'une offre, « Android, iOS ». La rubrique des free-to-play
  (`mobile-*-genre-free`), elle, est ignoree.
- **Un magasin a part, « Epic Games (mobile) »**, a cocher dans Magasins ->
  Plus de magasins. Ces jeux se recuperent DANS L'APPLICATION EPIC du
  telephone : l'extension les detecte, les annonce -- « dans l'appli Epic »
  sur leur carte -- et ne tente jamais de les reclamer. La source Epic (PC)
  ne les balaie pas : chacune fait autorite sur son magasin.
- **Au telephone** : ils se recuperent la, c'est donc la qu'ils arrivent,
  si l'alerte telephone est active (nouvelle option « Aussi les jeux mobiles
  offerts par Epic », cochee par defaut). Une fois par jeu, jamais en double
  avec un jeu attendu.
- **Sobre** : la reponse pese pres de 800 Ko pour les deux plateformes. La
  source ne tourne que si le magasin est suivi -- meme « Verifier
  maintenant » ne la paie pas sinon -- et pas plus d'une fois toutes les
  trois heures. Sans cookies.
- **Prudente** : une plateforme en panne rend la liste incomplete, et rien
  n'est declare termine ; une rubrique disparue est une erreur qui le dit,
  pas « aucun jeu cette semaine ».

**Pas encore mesure** : la forme de `purchase` (la date de fin) et de
`media` (la vignette). Elles sont lues avec prudence -- une cle qui dit
« fin » et une date a venir, une image https -- et sinon rien : la carte dit
« fin inconnue », et l'offre vit tant que la rubrique la porte. La mesure V8
recopie desormais la premiere offre de la rubrique en entier : un rapport de
plus, et ces deux champs seront lus exactement.

Verifie : la source sur des reponses de la forme mesuree (deux plateformes,
panne d'une plateforme, rubrique disparue) ; dans un vrai cycle, l'annonce
et l'envoi au telephone une seule fois, et aucune requete quand le magasin
n'est pas suivi ; dans Chromium, la carte « EPIC MOBILE » et la case du
magasin.

1197 tests.

## 2.56.0 -- 2026-09-23

**Une mesure pour les jeux mobiles d'Epic (V8)**

Epic offre aussi, chaque semaine, des jeux pour Android et iOS ; l'extension
ne les voit pas, et on ne sait pas ou Epic les expose. Regle du depot : une
hypothese se mesure avant de s'ecrire. La page Diagnostics gagne donc une
mesure, V8, qui pose la question a quatre endroits, avec le pays et la
langue choisis :

1. `freeGamesPromotions`, l'API deja lue : une categorie, une etiquette ou
   un attribut distingue-t-il une offre mobile ?
2. la meme, avec `&platform=android` puis `&platform=ios` : la reponse
   change-t-elle ?
3. l'API de decouverte de l'application mobile, `egs-platform-service` --
   sur un hote que le manifeste couvre deja (`*.epicgames.com`) ;
4. la page des jeux gratuits : parle-t-elle de mobile, et dans quel bloc ?

Tout est lu sans cookies : des offres publiques, rien du compte. Le verdict
nomme l'endroit, le rapport nomme le champ (chemin et valeur) -- de quoi
ecrire la source du premier coup. Une lecture qui echoue ne conclut rien : le
verdict dit alors « a relancer », pas « Epic ne les expose pas ».

L'analyse vit dans `watch/epic-mobile.js`, testee a part : sur la vraie
capture du 2026-08-27, aucune des 12 offres ne parle de mobile ; les mots
« automobile » ou « Studios » ne passent pas pour des indices.

Verifie dans Chromium sur la vraie page : avec des reponses simulees (un jeu
Android que seul le filtre fait apparaitre), le verdict le trouve ; sans
reseau, il dit « Rien n'a pu etre lu ».

1184 tests.

## 2.55.0 -- 2026-09-23

**Le moteur parle la langue du lecteur, avec ses accents**

Le moteur est ecrit en ASCII -- le build le refuse autrement -- et ne sait
pas quelle langue lit l'utilisateur. Ses 67 etats (le bouton de page, la
bulle, le panneau) et ses 30 notifications etaient donc en francais sans
accents pour tout le monde : « Tous les jeux gratuits de la semaine sont deja
recuperes », meme dans une interface en allemand.

Il ne compose plus de phrase. `uiText('engX', valeurs...)` rend une piece,
`{ key, args }` ; 98 cles `eng...` vivent dans `_locales`, en anglais,
francais, allemand et espagnol, accents compris (`watch/engine-text.js`) :

- **l'etat du moteur** est compose par le lanceur, avec les modeles que le
  worker lui envoie dans la langue choisie ; a defaut, avec ceux du
  navigateur ;
- **les notifications** sont composees par le worker, qui verifie chaque
  piece comme une donnee venue d'une page : une cle `eng...` seulement, six
  valeurs au plus, bornees. Le titre prend un vrai tiret : « Free Games
  Claimer — GOG ».

Au passage, des phrases qui mentaient :

- « cliquez sur Claim » renvoyait a un bouton qui n'existe plus depuis la
  2.51.0 : elles nomment « Tout recuperer », dans le bouton de l'extension ;
- « relancez l'echange (menu Tampermonkey) » : il n'y a plus de menu ; il
  faut rouvrir gog.com/redeem ;
- le code Luna promettait « cliquez pour ouvrir la page d'echange » : dans
  l'extension, un clic sur la notification n'a jamais rien ouvert ;
- « codes a saisir manuellement (voir console) » : ils sont dans l'onglet
  Codes du popup.

Le build refuse une cle `uiText` absente des traductions ; un test verifie
que chaque appel passe autant de valeurs que la phrase en attend, dans les
quatre langues. Nouveau temoin fige (`reference-v2.55.0.js`). Les commandes
de console du moteur (`FGC.menu()`), reservees au developpeur, restent en
francais.

Verifie dans Chromium, extension chargee : la bulle en francais accentue,
puis en allemand avec la langue forcee ; une notification de code Luna
composee en francais, allemand et espagnol ; « Aucun jeu gratuit ici » apres
un vrai clic sur « Tout recuperer ».

1172 tests.

## 2.54.0 -- 2026-09-23

**Trois declencheurs de plus pour la mise a jour**

L'heure ne suffisait pas : une version publiee attendait jusqu'a soixante
minutes. `tools/maj-auto.ps1 -Installer` pose maintenant trois declencheurs,
tous a votre nom, sans droits d'administrateur (tout est sous `HKCU`) :

- **Le bouton « Mettre a jour maintenant »** (popup -> Reglages -> Mise a
  jour, affiche seulement pour une installation depuis un dossier).
  L'extension appelle un relais local par la messagerie native de Chrome
  (`com.free_games_claimer.maj`, declare a Chrome, Edge et Chromium) ; le
  relais fait le `git pull`, l'extension relit le disque et se recharge dans
  la foulee. Le popup dit chaque issue en clair : deja a jour, redemarrage,
  apres la reclamation en cours, fichiers modifies a la main, autre branche,
  historique divergent, GitHub injoignable, git absent, relais absent (avec
  la commande a lancer), relais qui ne connait pas l'extension (avec son
  identifiant).
- **A l'ouverture de session** : un ecouteur demarre avec Windows (cle `Run`
  de l'utilisateur) et fait une mise a jour.
- **Des qu'une version est publiee** : le meme ecouteur attend une sonnette
  sur un sujet ntfy au hasard. `.github/workflows/check.yml` la fait
  retentir apres chaque check reussi sur `main`, si le secret `MAJ_NTFY`
  existe ; sans lui, rien ne sonne. Deux sonnettes dans la minute font une
  seule mise a jour.

L'identifiant de l'extension, que le relais doit connaitre, se calcule a
partir du chemin du dossier (SHA-256, comme Chrome le fait -- verifie sur
Chromium) et se lit aussi dans les profils ; `-IdExtension` le force.

**Rien ne transporte de commande.** Le relais n'accepte que `{ cmd: 'maj' }`
et refuse tout autre message ; la sonnette ne porte que le numero du commit, que
l'ecouteur ne lit pas. Un verrou empeche deux mises a jour simultanees.

Verifie : le relais sous PowerShell (sortie standard propre au bit pres,
message inconnu refuse, arguments de Chrome ignores) ; l'ecouteur contre un
faux serveur ntfy (mise a jour a l'ouverture, puis a la sonnette) ; et le
parcours complet dans Chromium -- clic sur le bouton, relais reel, `git pull`
d'un vrai clone, extension rechargee de 2.54.0 en 2.54.1. Ce qui ne peut
etre essaye que sous Windows (tache planifiee, cle `Run`, registre, lanceurs
sans fenetre) ne l'a pas ete.

1162 tests.

## 2.53.0 -- 2026-09-23

**Une installation depuis les sources se met a jour toute seule**

Chargee depuis un dossier, l'extension ne se mettait jamais a jour : il
fallait un `git pull`, puis le bouton « Recharger » de `chrome://extensions`.
Les deux se font seuls.

- **`tools/maj-auto.ps1`** fait le `git pull`, a la main ou toutes les heures
  (`-Installer` : tache planifiee a votre nom, sans droits d'administrateur,
  sans fenetre ; `-Desinstaller` la retire). Il n'ecrase jamais rien : fichier
  modifie a la main, autre branche que `main`, historique qui differe de
  GitHub -- il l'ecrit dans son journal et s'arrete. Il avance seulement
  (`merge --ff-only`) et n'appelle ni `reset`, ni `checkout`, ni `clean`.
  Essaye sous PowerShell sur cinq cas : a jour, version nouvelle (un fichier
  non suivi ne gene pas), fichier modifie, historique reecrit, autre branche.
- **L'extension se recharge d'elle-meme** (`watch/self-update.js`). Chargee
  depuis un dossier, Chrome lui sert ses fichiers depuis le disque : toutes
  les cinq minutes, elle relit la version de son `manifest.json` et, plus
  recente que celle qui tourne, se recharge. Jamais en pleine reclamation --
  ni pendant un cycle, ni quand un onglet dit que son moteur travaille (le
  lanceur repond a `fgc-occupe`) ; elle attend. Jamais vers une version plus
  ancienne. Jamais pour une version du Web Store. La raison est ecrite au
  journal AVANT le rechargement, et une notification dit la nouvelle version
  apres. Aucune permission de plus : `management.getSelf` n'en demande pas,
  et les onglets interroges sont ceux ou l'extension a deja acces.
  Verifie dans Chromium : version changee sur le disque, extension rechargee
  seule en 2.53.1, active, alarme rearmee, les deux lignes au journal.

### La langue choisie n'atteignait pas le service worker

Reglages -> Apparence -> Langue n'etait applique que par les pages. Le worker
parlait la langue du navigateur : ses notifications, les phrases des fiches
et les libelles du bouton de page ignoraient le choix -- contrairement a ce
qu'annoncait la 2.51.0. Il la lit maintenant a chaque reveil et la suit quand
elle change. Verifie : allemand choisi, navigateur en francais, panneau du
bouton en allemand.

1152 tests.

## 2.52.0 -- 2026-09-23

**Le bouton se pose ou l'on veut, et laisse la place aux autres**

- **Deplacable partout.** Il ne glissait que le long du bord droit ; il se
  pose maintenant n'importe ou dans la fenetre. La place est retenue en
  fractions de la fenetre (`veille:lanceur` porte `x` et `y`) : agrandie ou
  reduite, il reste au meme endroit relatif, et jamais dehors. L'ancienne
  place (hauteur seule) est relue, au bord droit.
- **Il s'ecarte des boutons des autres extensions.** Dealabs, un comparateur
  de prix, une bulle d'aide : si leur bouton occupe la place, le lanceur prend
  la place libre la plus proche -- au-dessus ou au-dessous d'abord, puis de
  cote -- avec 6 px d'air, et y revient de lui-meme quand le voisin s'en va.
  Lache sur un voisin, il se pousse a cote, et c'est cette place-la qui est
  retenue. Il ne bouge jamais sous la main : ni pendant un glisser, ni panneau
  ouvert.
- **Il arrive en glissant** depuis le bord le plus proche, depasse un peu sa
  place et s'y pose ; la pastille eclot juste apres, et la bulle attend qu'il
  soit arrive. Le panneau s'ouvre en fondu, la bulle glisse, le point eclot a
  chaque fin. Quand le systeme demande moins de mouvement, tout devient un
  simple fondu.
- Panneau et bulle s'ouvrent du cote ou il y a de la place : a droite du
  bouton quand il est a gauche de l'ecran.

### Comment il voit les voisins

Les autres extensions vivent, comme lui, dans des racines d'ombre fermees : on
n'en voit pas l'interieur. Le lanceur demande au navigateur ce qui se trouve
au premier plan en 16 points autour de sa place (`elementsFromPoint`). Un
point est pris quand ce qui s'y trouve FLOTTE : fixe et de taille modeste (un
bouton, pas un en-tete pleine largeur), ou pose a la racine du document et
dessinant hors de sa propre boite -- la signature d'une extension. Le texte de
la page ne compte pas : le bouton reste la ou vous l'avez mis. Il ne regarde
qu'a son arrivee, quand un element s'ajoute a la racine du document (jamais
la page entiere), quand la fenetre change, et deux fois dans les cinq
premieres secondes.

### Corrige

- Le bouton se posait sous la barre de defilement : la largeur de la fenetre
  comptait la barre. Elle ne la compte plus.

1134 tests, dont 26 sur le lanceur. Verifie dans Chromium avec l'extension
chargee et deux fausses extensions voisines : 12 px d'ecart avec la
premiere, ecart et retour automatiques quand la seconde arrive puis s'en va,
arrivee ralentie image par image.

## 2.51.0 -- 2026-09-23

**Un seul bouton sur la page du magasin**

Deux boites se partageaient le coin bas droit des pages de magasin : celle du
moteur (son etat, « Claim », « Auto hebdo ») et le bandeau des fiches
(« Offert en ce moment sur Epic Games Store... »). Sur une fiche Epic, la
premiere recouvrait la seconde -- et toutes deux masquaient ce que la page
affichait dessous.

Il n'en reste qu'une, `content/launcher.js` : l'icone de l'extension au bord
droit de la fenetre, a la maniere du bouton de Dealabs.

- **Un clic** ouvre un panneau : ce que le moteur est en train de faire, ce
  que l'extension sait du jeu, « Tout recuperer », et la bascule automatique
  (Epic ou Luna). Echap, la croix ou un clic ailleurs le referme.
- **Un glisser** le deplace le long du bord, et la position est retenue d'une
  page a l'autre (`veille:lanceur`, la seule cle que ce script ecrit).
- **Au repos, il se tait.** Une pastille compte ce que la fiche a a dire, un
  point dit ou en est le moteur (orange qui pulse, vert, rouge). Une bulle
  breve annonce une fin -- « Tous les jeux gratuits de la semaine sont deja
  recuperes » -- ou le premier fait d'une fiche, puis s'efface d'elle-meme
  apres six secondes.
- **Rien quand il n'y a rien a dire** : une fiche Steam inconnue de
  l'extension ne recoit aucun bouton, comme avant.

### Plus rien du moteur dans la page

Le moteur posait ses boutons et son etat dans le DOM ordinaire de la page,
avec une feuille de style injectee : les scripts du magasin pouvaient lire
« Epic : Tyranny recupere ». Il ne pose plus rien. Il declare ses deux
commandes au lanceur (`window.FGC_PAGE_UI`, visible des seuls scripts de
l'extension) et lui dit ou il en est ; tout s'affiche dans la racine d'ombre
fermee qu'utilisait deja le bandeau des fiches. Nouveau temoin fige
(`reference-v2.51.0.js`) : seul `src/core/12-ui.js` change.

Les libelles du bouton suivent la langue choisie dans les reglages : le
worker les envoie avec les faits de la fiche (`launcherLabels`,
watch/lookup.js). L'etat du moteur, lui, reste en francais -- comme avant.

### Aussi

- Les huit phrases des fiches passaient pour orphelines a chaque build :
  `watch/lookup.js`, ou elles vivent, est maintenant dans le balayage i18n.

1125 tests, dont 17 qui font tourner le lanceur sur un faux document. Verifie
aussi dans Chromium avec l'extension chargee, sur des fiches Epic et Steam
factices : un seul element ajoute a la page, aucune racine ni aucun texte
lisibles par elle, position retenue, aucun bouton sur une fiche inconnue.

## 2.50.0 -- 2026-09-23

**L'extension parle allemand et espagnol**

`_locales/de` et `_locales/es`, complets : les 447 textes de l'interface --
popup, Ma collection, historique, journal, repli, notifications, alertes
telephone, agenda. Le navigateur choisit la langue tout seul ; Reglages ->
Apparence -> Langue la force. Les dates suivent le lecteur (`de-DE`,
`es-ES`), et chaque traduction garde exactement les variables de l'original
(`$1`, `$2`...) -- verifie par script avant d'ecrire le moindre fichier.

### La surcouche des fiches parlait francais a tout le monde

Elle composait ses phrases elle-meme, en dur et en francais -- et ecrivait le
magasin sous son identifiant : « Vous le possedez deja sur gog. ». Le service
worker les compose maintenant dans la langue du lecteur, avec le vrai nom du
magasin et la date a son format (`factLines`, watch/lookup.js), et les envoie
avec les faits. La surcouche reste minuscule et sans table de traduction ; ses
phrases francaises ne servent plus qu'en secours.

### Aussi

- Deux tests prenaient l'allemand et l'espagnol comme exemples de langues NON
  livrees ; ils prennent maintenant l'italien et le neerlandais.
- Le selecteur de langue ecrit « Français » avec sa cedille.

Les fiches des magasins d'extensions (`store/`) restent en francais et en
anglais.

1108 tests.

## 2.49.0 -- 2026-09-23

**Ce jeu tourne-t-il sur le Steam Deck ?**

Steam le dit lui-meme, jeu par jeu -- verifie, jouable, non pris en charge --
et il le dit dans la reponse que l'extension lisait deja :
`IStoreBrowseService/GetItems`, a qui l'on demande maintenant
`include_platforms`. Aucune requete de plus, aucun hote de plus
(`watch/deck.js`).

- **Le popup** : une offre Steam verifiee ou jouable porte « Deck ✓ » ou
  « Deck ~ » a cote du magasin. « Non pris en charge » ne s'y affiche pas : a
  328 px, une mauvaise nouvelle n'a pas la place d'un fait utile.
- **Ma collection** : la meme pastille sur vos jeux Steam, un filtre « Jouable
  sur Deck » / « Verifie Deck », et le tirage au sort qui le respecte -- qui
  joue sur la console ne veut pas qu'on lui tire un jeu qui n'y tourne pas.
- **La fusion du catalogue** garde la categorie : l'agregateur, qui ne la
  connait pas, ne l'efface pas (meme regle que le numero de paquet).

Seuls les jeux Steam la portent : un jeu Epic ou GOG n'a pas d'appid, et le
rapprocher d'un jeu Steam par son titre serait affirmer une compatibilite
qu'on n'a pas lue.

**Non mesure ici** -- le banc de test n'a pas acces a Steam. Le champ lu est
`platforms.steam_deck_compat_category` (1, 2, 3, ou le nom de l'enumeration).
Une forme inconnue vaut « on ne sait pas », qui ne s'affiche pas et ne passe
aucun filtre. Le rapport d'import Steam montrera la vraie forme (ROADMAP,
entree 4).

1105 tests, dont 9 nouveaux (`test/deck.test.mjs`).

## 2.48.1 -- 2026-09-23

**Le userscript Tampermonkey n'est plus produit**

L'extension fait tout ce qu'il faisait -- et davantage, puisque Tampermonkey
n'a pas d'execution de fond. Garder les deux actifs sur la meme page les
faisait reclamer chacun de leur cote.

Le build n'ecrit donc plus rien hors du depot : il deposait
`../free-games-claimer.user.js` et `../test.txt` dans le dossier PARENT a
chaque passage. `src/meta/userscript-header.txt` est retire. Le moteur, lui,
ne change pas d'un octet : il parle toujours l'API `GM_*`, que
`content/gm-shim.js` lui fournit dans l'extension, et le controle au bit pres
contre sa copie figee tient.

## 2.48.0 -- 2026-09-23

**Une passe de securite, et un depot ou l'on se retrouve**

### Ce que la page d'un magasin pouvait lire

La surcouche des fiches Epic, GOG et Steam affichait ce que vous possedez
AILLEURS -- « deja a vous sur GOG depuis mars », « deja offert, et manque » --
dans le DOM ordinaire de la page. Les scripts du magasin, et les outils
d'enregistrement de session qu'il embarque, pouvaient le lire. Le bandeau vit
maintenant dans une racine d'ombre FERMEE, sans identifiant a chercher : la
page voit un element vide. Verifie dans Chromium : `innerText`, `innerHTML` et
`shadowRoot` ne rendent rien du contenu.

### La passerelle locale n'a jamais ecrit son fichier

Chrome passe TOUJOURS l'origine de l'appelant (`chrome-extension://ID/`) en
premier argument a un programme de messagerie native, et `--parent-window=`
sous Windows. `host/fgc-host.mjs` prenait ce premier argument pour son chemin
de sortie : avec le lanceur `.bat ... %*` de host/README.md, l'ecriture
echouait a chaque envoi. L'hote ne retient plus que ce qui ressemble a un
chemin. Le test qui le prouve echoue sur l'ancien hote.

### Un fichier de reglages ne saute plus l'avertissement Steam

Importer une sauvegarde pouvait activer la recuperation Steam sans passer par
l'avertissement qui cite le contrat Steam. Le reglage en place est garde ;
seul l'avertissement l'active.

### Le controle en integration continue ne peut plus ecrire

`check.yml` declare `permissions: contents: read`. Selon les reglages du
depot, le jeton par defaut pouvait etre en ecriture ; un controle n'a aucune
raison de pouvoir pousser.

### Le depot range

La racine portait quarante entrees. Elle n'a plus que ce que les navigateurs
exigent d'y trouver, et les documents :

| Dossier | Contenu |
|---|---|
| `pages/` | les huit pages de l'extension, une paire .html / .js chacune |
| `content/` | ce qui s'injecte dans les magasins : le moteur genere, `gm-shim.js`, `overlay.js` |
| `lib/` | partage par les pages, le worker et la veille : traduction, montants |
| `icons/` | `icon.svg` et ses quatre PNG |
| `build/references/` | les temoins figes du moteur, a part des outils |

Deplacements par `git mv` : l'historique de chaque fichier suit. Verifie de
trois facons : les garde-fous du build (chaque chemin cite par un manifeste,
une page ou un import existe), les deux archives decompressees -- 81 fichiers,
aucun chemin casse, `getURL` compris --, et les six pages ouvertes dans
Chromium depuis `pages/`, sans erreur ni image cassee.

### Aussi

- La cle de traduction `mirrorLine`, que plus rien ne citait, est retiree : le
  build ne l'annonce plus a chaque passage.
- `store/permissions.md` citait `api.frankfurter.app` ; le manifeste declare
  `api.frankfurter.dev` depuis la 2.40.1. C'est ce texte qu'on recopie dans la
  console du Chrome Web Store.

1096 tests.

## 2.47.0 -- 2026-09-23

**Ce qui demande un humain arrive sur le telephone**

### L'alerte telephone, par ntfy

Le chien de garde savait qu'une session avait expire ; il le disait sur
l'ordinateur, le seul endroit ou personne ne regarde a trois heures du matin.
Reglages -> Notifications -> « Alerte sur le telephone (ntfy) » envoie a un
sujet ntfy -- `ntfy.sh`, ou votre serveur -- ce qui demande un geste :

- les incidents du chien de garde : session expiree, magasin qui a change sa
  page, source en panne, veille arretee ;
- **l'ordinateur qui bloque nos notifications** : le seul canal qui puisse
  dire que l'autre est coupe. Chaque incident a son propre marqueur,
  `phonedAt`, parce que les deux canaux ne tombent pas en panne ensemble ;
- un defi de securite en attente ;
- les jeux de votre liste de souhaits -- une case, cochee par defaut --,
  meme si les notifications de l'ordinateur sont coupees.

Les heures calmes valent pour le telephone ; un reglage d'alertes coupe aussi.
Un envoi rate repart au tour suivant, pas avant une heure : une adresse mal
tapee n'ecrit pas au journal quarante-huit fois par jour.

Ce qui part : un titre, quelques lignes, parfois le nom d'un jeu et le lien de
sa fiche. **Jamais un code, jamais un cookie.** Les parametres passent dans
l'adresse et pas dans des en-tetes : un en-tete n'accepte que le latin-1, et
« Récupéré » y ferait jeter `fetch`.

Sur `ntfy.sh`, qui connait le nom du sujet lit les messages. « Nouveau sujet »
en tire un au hasard, et l'adresse vit sous sa propre cle,
`veille:telephone` -- pas dans les reglages, que l'option de synchronisation
recopierait dans le compte du navigateur. HTTPS seulement. Un bouton
« Envoyer un essai » passe par le meme chemin que les vraies alertes.

### La permission, hote par hote

`optional_host_permissions` apparait dans les deux manifestes, avec
`https://*/*` : le serveur ntfy est le votre, donc inconnu a l'avance.
Optionnel veut dire qu'il n'est jamais accorde a l'installation -- l'extension
demande l'hote de VOTRE serveur, et lui seul, quand vous activez l'alerte, et
le retire quand vous la coupez.

### Le temps de jeu Steam ne s'est jamais lu

Ma collection demandait `https://steamcommunity.com/*` depuis la 2.39.0, et
aucun manifeste ne le declarait. Chrome refuse de demander un hote que le
manifeste ne permet pas : la page affichait « acces refuse », et SECURITY.md
decrivait l'hote « hors manifeste » comme un choix. Il est declare, et un test
verifie maintenant que chaque hote demande par le code figure dans les deux
manifestes (`declaresOptionalOrigin`).

1095 tests, dont 31 nouveaux (`test/phone.test.mjs`, et des ajouts a
`health`, `cycle` et `permissions`).

## 2.46.0 -- 2026-09-23

**Ce que vous attendez vient de Steam, et ce qui finit va dans votre agenda**

### La liste de souhaits Steam

Le coeur ne connaissait que ce qu'on tapait a la main. L'import Steam de Ma
collection lit desormais aussi `rgWishlist`, dans la reponse de
`dynamicstore/userdata` qu'il lisait deja : aucune requete de plus avec vos
cookies, aucune permission. Les noms viennent des memes lots GetItems que ceux
de la bibliotheque.

- La liste vit a part, sous `veille:souhaits-steam`. C'est une photographie :
  une importation la remplace entiere, et un jeu retire de la liste Steam
  cesse d'etre attendu. La liste saisie n'est jamais touchee.
- Le rapprochement se fait sur l'appid exact pour une offre Steam, et sur le
  titre normalise pour le reste -- le cas qui compte est le jeu de la liste
  Steam offert sur Epic ou GOG. Un titre qui se ressemble a tort coute une
  annonce prioritaire de trop, jamais un jeu rate.
- La liste gardee est bornee a 2000 jeux, AVANT de demander leurs noms : pas
  de lot pour un souhait qu'on ne garderait pas.
- Une reponse sans `rgWishlist`, ou d'une forme inconnue, garde la liste
  precedente. Sa forme CONNECTEE n'a jamais ete mesuree ici : le rapport de la
  carte Steam le dira (ROADMAP, entree 4).
- Dans le popup, le coeur est plein et son infobulle dit d'ou vient le
  souhait. Il ne se retire pas d'ici : il reviendrait a l'importation suivante.

### Le cycle ne lisait pas la liste de souhaits

`readContext` ne demandait pas la cle `veille:souhaits`. Depuis la 2.31.0, le
cycle voyait donc une liste vide : un jeu attendu n'a jamais echappe au resume
quotidien, ni pris la tete de l'annonce. Le popup, qui lit la cle lui-meme,
affichait pourtant son coeur. Les tests de la 2.31.0 passaient la liste
directement a `markWished` ; trois tests de bout en bout la placent maintenant
dans le stockage, et les deux qui portent un souhait echouent sans la
correction.

### L'agenda (.ics)

L'extension ne recupere rien quand le navigateur est ferme, et le chien de
garde ne peut le dire que sur cet ordinateur. Reglages -> Sauvegarde ->
« Agenda (.ics) » ecrit un fichier pour l'agenda du telephone :

- la fin de chaque offre en cours que vous ne possedez pas, sur sa derniere
  heure, avec un rappel la veille ;
- le debut des offres annoncees (« Bientot »), jeux mysteres compris ;
- le dernier jour des codes a echanger, en journee entiere -- la page
  d'echange ne donne qu'un jour.

Les UID sont stables : exporter de nouveau met les evenements a jour, sans les
doubler. Les heures sont en UTC, les lignes pliees a 75 octets sans jamais
couper un accent, le texte echappe comme la RFC 5545 le demande. **Jamais le
code** : ni dans le texte, ni dans l'UID, qui n'en porte qu'une empreinte de
32 bits. Un fichier et pas un abonnement : il faudrait un serveur.

### Juillet n'etait pas juin

Les jours restants d'un code se lisaient sur les trois premieres lettres du
mois, et « jui » designait juin : un code valable jusqu'au 15 juillet
s'affichait expire un mois trop tot. La lecture vit maintenant dans
`watch/codes.js` (`deadlineDay`), partagee par le popup et l'agenda. Elle
essaie le nom entier, puis une abreviation qui ne designe qu'un seul mois, et
renonce sur une abreviation ambigue : mieux vaut ne pas dater un code que le
dater faux.

### Aussi

- `npm run preview` refuse l'antislash sur tous les systemes. Le test qui le
  verifiait echouait sous Linux, donc en integration continue.
- Les notes de conception sont rangees sous `docs/specs/`.

1064 tests, dont 35 nouveaux (`test/calendar.test.mjs`, et des ajouts a
`wishlist`, `collection`, `cycle` et `codes`).

## 2.45.0 -- 2026-09-23

**Un echec se dit quand il est certain, pas cinq minutes plus tard**

En mode pilote, le verdict est l'entree d'historique que le module ecrit. Un
module qui finit sans rien ecrire -- bouton introuvable, reclamation non
confirmee, page qui ne se charge pas -- laissait l'orchestrateur attendre tout
son budget, cinq minutes d'onglet ouvert, pour conclure « failed, delai
depasse ».

Il conclut maintenant trois secondes apres la fin du module : une entree
nouvelle d'abord, puis l'entree deja la (2.41.0), puis un defi de securite, et
seulement ensuite l'echec. Deux gardes :

- aucune execution Epic ou Luna ne doit etre en cours -- un second appel du
  module rend tout de suite une promesse resolue pendant que le premier
  travaille encore ;
- le verdict reste `failed`, pas « indetermine ». Le recul est le meme, et le
  canari continue de le compter : « indetermine » est pour lui une panne de
  notre fait, et un bouton introuvable finit exactement ainsi quand c'est le
  magasin qui a bouge.

## 2.44.1 -- 2026-09-23

**Le dernier recours de la resolution de slug ne servait plus**

L'API Epic nomme son champ `urlSlug`. La traduction du code en anglais a pris
ce nom pour un identifiant francais et l'a renomme `slugUrl` -- partout, y
compris dans `el.urlSlug`. Le moteur comme la veille lisaient donc un champ qui
n'existe jamais, et le dernier recours de `resolveSlug` etait mort : une offre
sans `offerMappings`, sans `catalogNs` et sans `productSlug` exploitable
n'avait pas d'adresse, et la ligne « Bientot » correspondante pas de lien.

Les tests, ecrits apres le renommage, fabriquaient des objets avec `slugUrl` :
ils verifiaient l'erreur. Et `verify-rename`, qui applique la table de
renommage a sa base, la figeait -- remettre `urlSlug` dans le code le faisait
echouer. L'entree est retiree de `build/rename-map.mjs` (et donc de
`watch/field-renames.js`, genere), le moteur et la veille lisent `urlSlug`, et
les tests aussi. Un test prend le cas reel : un jeu qui n'a que son `urlSlug`.

## 2.44.0 -- 2026-09-22

**Un bilan honnete, un popup vivant, et le popup visible sans l'extension**

### Le bilan ne compte plus ce que l'extension n'a pas fait

Un jeu trouve deja a vous -- deja dans la bibliotheque Epic, deja pris sur la
liste Luna -- est ecrit sous le statut `claimed`, puisqu'il est bien au
compte. Le bilan l'additionnait aux reclamations : « 13 recuperes » pour deux
jeux reellement pris. Il les compte maintenant a part (`alreadyYours`, une
seule regle partagee avec « Deja recupere ») : « 2 jeux recuperes, dont 1 a
prix connu : 14,99 EUR · 11 deja a vous ». La valeur, les magasins et le
meilleur mois ne portent que sur ce que l'extension a pris. L'export CSV gagne
une colonne `already`, en derniere position pour ne deplacer aucune reference.

Au passage : « surtout ... » affichait `[object Object]` des que deux magasins
figuraient au bilan -- `mainStore` rend un objet, indexe tel quel dans
`STORE_LABELS`. Le compteur « pret, N recuperes » des magasins suit la meme
regle que le bilan.

### Le popup se redessine quand le stockage change

Une reclamation terminee, un cycle, un registre restaure : le popup restait sur
l'image de son ouverture. Il ecoute desormais `storage.onChanged` sur les cles
qu'il lit, avec une seule relecture par rafale (400 ms). Jamais sous les
doigts : tant que le curseur de valeur, un selecteur ou un champ numerique a le
focus, le rendu attend -- il remettrait sa valeur stockee. La recherche n'y
est pas : le rendu ne touche pas a sa valeur.

### `npm run preview`

Le vrai popup.html et le vrai popup.js, dans un navigateur ordinaire, sur un
faux `chrome.*` (build/preview.mjs). Donnees de demonstration par defaut ;
`--data F.json` pour un export du popup ; `--chrome` pour une copie EN LECTURE
de vos donnees, lue directement dans la base LevelDB du profil
(build/leveldb.mjs : journal et tables, Snappy, la plus haute sequence gagne).
La 2.36.0 aurait ete vue en une commande : son popup etait vide.

Trois regles : rien n'est ecrit (les ecritures restent dans la page), le
serveur n'ecoute que 127.0.0.1, et aucun chemin ne sort du depot -- teste avec
un fichier place a cote du dossier servi, sous cinq encodages de « .. ».

## 2.43.0 -- 2026-09-22

**Le registre vous suit d'un ordinateur a l'autre -- si vous le demandez**

Ma collection rattrape Epic, GOG et Steam sur un nouvel ordinateur, a
condition d'etre importee. Pas Luna, dont la bibliotheque ne s'importe pas. Un
second interrupteur, dans Reglages -> Sauvegarde, recopie le registre des jeux
recuperes dans `chrome.storage.sync` : un autre ordinateur du meme compte le
fusionne au sien, et ne rouvre pas ce qui est deja pris.

### Ce qui part

Quatre champs par jeu : magasin, identifiant, titre, date -- ce que le filtre
« deja dans la bibliotheque » lit, rien de plus. Ni valeur, ni vignette, ni
lien, et jamais un code : les codes gardent leur propre sauvegarde, avec leur
propre interrupteur. Coupe par defaut, pour la meme raison qu'eux : la zone
sync traverse le compte du navigateur. Couper l'option retire la copie.

### Ce qui ne peut pas se perdre

- **Le quota.** Un element de la zone sync fait 8 Ko et un depassement est
  REJETE, pas tronque. Le registre est coupe en tranches, huit au plus, les
  plus recentes d'abord : ce sont les offres en cours qu'il faut ne pas
  rouvrir. Ce qui reste dehors est journalise.
- **Deux ordinateurs qui ecrivent.** Le miroir recoit l'UNION de ce qu'il
  contient et du registre local, jamais le registre seul. Sans cela, un
  ordinateur qui n'a pas encore fusionne effacerait, en ecrivant, ce que
  l'autre avait sauvegarde.
- **La restauration.** Au demarrage, a l'installation et a l'activation, elle
  FUSIONNE (premiere date gardee, aucun champ vide), apres le rattrapage de
  l'historique : deux ecritures croisees du registre perdraient l'une des deux.

SECURITY.md et store/privacy.md disent desormais « deux choses » peuvent
quitter la machine, chacune derriere son interrupteur.

## 2.42.0 -- 2026-09-22

**Un nouvel ordinateur ne rouvre plus ce que vous possedez deja**

### Le registre n'avait jamais rien recu

Le moteur ecrit son historique par GM_setValue, donc en TEXTE JSON, et
storage.onChanged le rend tel quel. `addedEntries` le parcourait comme un
objet -- caractere par caractere -- n'y trouvait aucune entree datee, et le
registre est reste vide depuis sa creation. Les tests lui passaient des objets,
ils ne pouvaient pas le voir. Constate sur une vraie installation : treize
reclamations dans l'historique, aucun registre.

`readHistory` lit les deux formes. Et comme tout ce qui a ete note avant est
perdu pour le registre, l'historique entier est rejoue au demarrage et a
l'installation -- sans effet sur ce qui est deja connu, puisque `mergeEntry`
garde la premiere date et ne vide aucun champ.

C'est ce registre que lit le filtre « deja dans la bibliotheque » : il sert
enfin.

### Ma collection ecarte ce que le magasin dit que vous possedez

La collection savait ce que vous possedez sur Epic, GOG et Steam, et rien ne
la lisait. Le filtre de reclamation la consulte maintenant, sur la regle que
le ROADMAP posait : un IDENTIFIANT exact, jamais un titre.

- Epic : `el.id` de l'offre, le `offerId` de l'historique des commandes ;
- GOG : l'identifiant de produit ;
- Steam : l'appid.

Une offre de l'agregateur, qui ne porte pas l'identifiant du magasin, n'est
jamais ecartee par ce chemin. Un jeu du meme nom sous un autre identifiant non
plus : un faux « deja possede » ferait rater un jeu offert. Seul compte un
magasin dont une importation a reussi ; une importation ratee plus tard ne
retire rien.

Sur un nouvel ordinateur : importer la collection (Ma collection, « Tout
importer ») suffit pour que la veille n'ouvre plus d'onglet sur vos jeux.

### Le popup juge comme la veille

La puce « deja dans la bibliotheque » et le bouton « celle-ci » appelaient
`judge()` sans le registre : ils pouvaient promettre une reclamation que la
veille ecartait. Ils recoivent maintenant le registre et la collection, comme
le cycle.

## 2.41.0 -- 2026-09-22

**« Deja recupere » disait « recupere » pour des jeux que l'extension n'avait pas pris**

Constate sur une vraie installation : onze lignes « Amazon Luna -- recupere »,
et une « Card:Wall World 2 Recuperer L... ». Trois defauts, un seul symptome :
la liste ne pouvait pas dire la verite, ni sur cet ordinateur, ni sur un autre.

### Le nom du jeu est note avec son sort

L'historique du moteur ne gardait qu'une cle -- `offer:amzn1.pg.item...` pour
Luna -- et le popup allait chercher le titre dans le catalogue ou le registre,
qui ne connaissent presque jamais ces identifiants opaques. Chaque entree porte
desormais le titre lu sur la page, et une ecriture qui l'ignore ne fait pas
oublier celui deja note.

Les anciennes entrees se nomment toutes seules : a la prochaine visite de la
liste Luna, chaque offre deja connue recoit son titre, sans que sa date ni son
statut bougent -- c'est une correction d'etiquette, pas un nouvel evenement.

Le registre (`watch/library.js`) prend ce titre quand le catalogue n'en a pas.
Sans lui, une acquisition Luna restait sans nom, et le filtre qui evite de
rouvrir un onglet sur un jeu possede ne pouvait pas la reconnaitre.

### « Deja recupere » n'est plus « recupere »

Une offre que la liste Luna montre deja prise, ou dont la fiche dit deja
reclame, etait ecrite comme une reclamation. Elle porte maintenant le motif
`ALREADY_CLAIMED`, et le popup l'affiche « deja recupere ». Les entrees ecrites
avant cette version sont lues de la meme facon.

Une carte sans lien de fiche etait rangee sous son TEXTE, libelle du bouton
compris : la cle changeait quand « Recuperer le jeu » devenait « Recupere », et
c'est elle qui s'affichait. Elle est rangee sous son titre (`card:wall-world-2`).

### Un jeu deja pris ne finit plus en echec

C'est le cas d'un autre ordinateur, ou d'un historique vide :

- sur Epic, « Dans la bibliotheque » n'etait cherche qu'une fois, souvent avant
  que la fiche ait rendu ses boutons. Le moteur attendait douze secondes un
  bouton d'achat qui n'existe pas. Il guette maintenant la possession pendant
  toute l'attente -- sur la fiche de CE jeu seulement : pendant une navigation,
  la page encore affichee est celle d'ou l'on vient ;
- en mode pilote, une fiche que le moteur sait deja traitee n'ecrivait rien, et
  l'orchestrateur concluait « failed, delai depasse » apres cinq minutes. Une
  fois le module termine, l'entree existante de la fiche fait verdict.

### Repartir de zero

Un lien sous « Deja recupere » vide la liste et les pauses de verification. Elle
se reconstruit a la prochaine visite de chaque magasin, avec les titres. Ni les
codes, ni le registre, ni la collection ne sont touches. Annulable douze
secondes.

### « Bientot » redevient cliquable apres la mise a jour

Les fenetres annoncees ecrites avant la 2.35.0 n'avaient pas d'adresse, et la
source Epic ne serait reinterrogee que des jours plus tard. A la mise a jour,
une source dont les fenetres n'ont pas d'adresse est interrogee tout de suite,
une fois (`windowsLackLinks`).

## 2.40.1 -- 2026-09-22

**Le popup etait vide depuis la 2.36.0**

La 2.36.0 a ajoute `KEY_SEEN` a la liste des cles lues par le popup, mais l'a
declaree seize lignes plus bas. Une `const` lue avant sa declaration arrete le
module au chargement : aucune ligne de popup.js ne s'executait, et tout ce qui
a ete livre depuis dans le popup -- dont les liens de « Bientot » -- n'a jamais
ete visible. Les tests ne chargent pas popup.js ; rien ne l'a signale.

Le build le refuse desormais : `build/tdz.mjs` cherche, dans chaque script de
l'extension, une liaison de haut niveau lue avant sa ligne. Il retrouve le
defaut sur la 2.40.0 et ne signale rien d'autre.

### Les dollars redeviennent des euros

Le taux de change ne parvenait plus a l'extension : `api.frankfurter.app`
repond maintenant par une redirection vers `api.frankfurter.dev`, un hote que
le manifeste n'autorisait pas. Sans taux, chaque montant de l'agregateur
restait en dollars. L'extension appelle directement la nouvelle adresse.

L'Historique affichait les montants bruts de la source et additionnait dollars
et euros dans sa « valeur ratee ». Il convertit desormais comme le popup, par
un module commun (`money.js`).

### Un premier onglet plus lisible

- les titres de l'agregateur perdent leur suffixe : « Deadshot (Steam)
  Giveaway » devient « Deadshot ». La donnee stockee ne change pas
  (`displayTitle`, teste) ;
- « a ouvrir vous-meme » passe dans la rangee des actions, a droite, au lieu
  d'ajouter une ligne a chaque carte Steam ;
- « Bientot » montre la jaquette en paysage, le magasin et une fleche quand la
  ligne ouvre la fiche du jeu ;
- « Deja recupere » montre la jaquette quand le catalogue ou le registre la
  connait.

## 2.40.0 -- 2026-09-22

**L'extension cesse d'etre un utilitaire et devient une source de verite**

Elle sait ce que vous possedez sur quatre magasins, ce que vous avez recupere,
ce qui est passe et ce que vous avez lance. Cette connaissance ne sortait de
nulle part : ni Playnite, ni Heroic, ni un script maison ne pouvaient la lire.

Elle la depose desormais dans un fichier, sur votre machine, quand vous le
demandez.

### Trois choses que cette passerelle n'est pas

**Pas un serveur.** Rien n'ecoute sur un port, rien n'est joignable depuis le
reseau. Le navigateur demarre un programme local, lui parle sur l'entree
standard, et le tue quand la connexion se ferme.

**Pas une mise en commun.** Le non-objectif du design tient : aucune donnee ne
quitte la machine, et aucun utilisateur ne voit celle d'un autre.

**Pas automatique.** Trois obstacles, et les trois sont voulus : l'envoi part
d'un geste, la permission est optionnelle, et le programme doit avoir ete
installe a la main. Un canal vers un programme local est la chose la plus
puissante qu'une extension puisse demander.

### Ce que l'instantane ne contient pas

**Les codes de rachat.** Ils n'y sont pas et n'y seront pas. Un code est un
PORTEUR -- qui l'a, l'utilise -- et il n'a aucune raison de traverser une
frontiere de processus pour peupler une ludotheque.

Un test le verifie en cherchant le mot dans le JSON entier, pas seulement dans
la liste des champs : c'est le genre de fuite qui arrive par un champ ajoute
sans y penser.

### Le piege du protocole, et pourquoi l'hote est teste pour de vrai

Le format de Chrome est quatre octets de longueur suivis du JSON. Deux details
decident si cela marche, et aucun des deux ne leve d'erreur quand on le rate.

**Le boutisme est NATIF, pas petit.** Sur toutes les machines qui comptent
aujourd'hui il est petit, mais l'ecrire en dur ferait un hote qui marche
partout sauf la ou il ne marche pas.

**L'entree standard arrive par morceaux qui ne respectent aucune frontiere de
message.** Un lecteur qui supposerait un message par morceau perdrait la moitie
de ce qu'on lui envoie, en silence. Un instantane de quatre cents jeux n'arrive
jamais d'un seul bloc.

L'hote est donc lance dans les tests comme le navigateur le lance : un
programme, un flux sur l'entree standard, un fichier a la sortie. Une
comparaison de code source n'aurait rien prouve.

### Un fichier seul, et une copie verifiee

`host/fgc-host.mjs` n'importe rien du depot, parce qu'on le copie hors du
depot : un import relatif le casserait au premier deplacement. Son cadrage est
donc recopie depuis `watch/bridge.js`, et le test verifie que les deux copies
s'accordent -- meme promesse que celle qui garde le pays de la boutique, la
table d'echange et les libelles appris.

### L'instantane porte sa version

`protocol: 1` accompagne chaque envoi, et pas seulement la documentation. Un
outil tiers doit pouvoir REFUSER un format qu'il ne connait pas, plutot que
d'en deviner les champs.

### Ce qui reste a votre charge

L'installation. Elle demande Node, un chemin absolu, l'identifiant de
l'extension, et un depot de fichier a un emplacement qui depend du systeme.
`host/README.md` la decrit, et se termine par les quatre causes reelles d'un
silence -- dans l'ordre ou elles se produisent, la barre oblique finale
manquante en tete.

### Detail

Sept cles de libelle par langue (387 par locale). Le moteur est identique a
celui de la 2.39.0. Le dossier `host/` est exclu de l'archive : il tourne hors
du navigateur.

| | 2.39.0 | 2.40.0 |
|---|---|---|
| tests | 956 | 968 |
| permissions optionnelles | 2 | 3 |
| outils qui peuvent lire votre ludotheque | 0 | tous ceux qui lisent un fichier |

## 2.39.0 -- 2026-09-22

**340 jeux recuperes, 12 lances**

Toutes les autres phrases de ce produit disent d'en prendre plus. Celle-ci dit
de jouer a ce qu'on a, et c'est la seule qui retourne sa proposition.

Aucun lanceur ne peut la dire, parce qu'aucun ne couvre les quatre magasins.

### Ce qu'il faut dire tout de suite

**Seul Steam publie un temps de jeu lisible.** GOG et Epic n'en exposent aucun.
Le miroir ne couvre donc qu'un magasin sur quatre.

Il le dit plutot que de laisser croire au contraire, et le code le fait deux
fois :

- une acquisition GOG ou Epic n'est PAS comptee « jamais lancee », elle est
  HORS PORTEE. Les confondre accuserait quelqu'un de ne pas jouer a des jeux
  qu'on ne sait tout simplement pas mesurer ;
- le ratio porte sur ce qui est COUVERT, jamais sur le total. Le calculer sur
  le total ferait passer trois magasins sans temps de jeu pour trois magasins
  de jeux ignores.

### Le geste, et l'hote qui n'est pas dans le manifeste

`steamcommunity.com` n'y figure pas, et n'y figurera pas. Il est demande en
permission OPTIONNELLE, au moment du clic, et retirable ensuite -- exactement
l'infrastructure posee en 2.34.0 pour la veille de fond, qui ressert ici pour
la premiere fois.

L'adresse passe par `/my/`, que Steam resout cote serveur vers le profil
connecte : aucun identifiant de profil n'est demande, aucun n'est stocke.

C'est la meme posture que l'import de collection, et la meme phrase de
`SECURITY.md` qu'elle respecte : l'extension ne lit jamais un compte de sa
propre initiative.

### Deux details du format qui coutent cher si on les rate

**Steam OMET `hoursOnRecord` pour un jeu jamais lance.** Le lire comme zero
confondrait deux etats differents : zero peut vouloir dire « lance deux
minutes ». Le champ absent vaut donc `null`, et les deux se distinguent.

**Steam ecrit les milliers avec une virgule : « 1,204.2 ».** Un `parseFloat`
naif s'arrete a 1 et transforme mille deux cents heures de jeu en une seule --
donc un joueur assidu en quelqu'un qui n'a jamais lance le jeu.

### La forme d'une reponse connectee n'a jamais ete mesuree ici

Et c'est assume, avec le meme precedent que l'import de collection : le premier
utilisateur a cliquer sera celui qui la mesure.

La commande rend donc un rapport meme en cas d'echec. Un echec muet ferait
croire a une panne de compte ; un motif -- « profil prive », « forme
inattendue », un code HTTP -- donne de quoi corriger le lecteur du premier
coup. Et rien n'est efface sur un echec.

### Detail

La lecture se fait par expression reguliere et non par analyse de document : un
service worker MV3 n'a pas de DOMParser, le format est plat, et une expression
se teste sans monter un navigateur.

Six cles de libelle par langue (382 par locale). Le moteur est identique a celui
de la 2.38.0.

| | 2.38.0 | 2.39.0 |
|---|---|---|
| tests | 941 | 956 |
| permissions optionnelles | 1 | 2 |

## 2.38.0 -- 2026-09-22

**Le seul signal de l'extension qui puisse vous faire ne PAS acheter**

Tout le reste dit quoi prendre, et quand. Celui-ci dit quoi ATTENDRE.

Un jeu deja offert deux fois est un jeu qu'on peut attendre plutot que payer
vingt euros. La surcouche le dit sur la fiche, et la page Historique en donne
la liste complete.

### La mesure a change la source, et c'est le coeur de cette version

L'idee reposait sur une archive publique des giveaways passes. Elle n'existe
pas.

Mesure du 2026-09-22 sur l'API de l'agregateur : le SEUL statut present dans
sa reponse est « Active », et aucun champ ne designe une offre passee. Il n'y a
donc rien a interroger.

L'histoire vient donc de ce que l'extension a ELLE-MEME observe : les issues
figees depuis la 2.27.0, et le registre d'acquisitions, qui n'est jamais purge
et porte seul les passages anterieurs.

C'est plus pauvre au debut, puisque cela part de rien et grandit. C'est plus
honnete ensuite : chaque ligne est verifiable dans l'historique de celui qui la
lit, et une histoire inventee aurait valu moins que rien.

### Deux sources fusionnees, jamais choisies

Le registre sait ce qui a ete PRIS et survit a toutes les purges. Les issues
savent aussi ce qui a ete RATE, mais s'arretent aux mille dernieres. Ni l'un ni
l'autre ne suffit.

**Le dedoublonnage est le vrai sujet.** Une offre reclamee figure dans les deux
sources : la compter deux fois ferait croire a une recurrence qui n'existe pas.
Et ce chiffre est precisement celui sur lequel quelqu'un va s'appuyer pour ne
pas acheter.

Le recoupement se fait sur le magasin ET le jour. Assez serre pour fondre un
doublon, assez lache pour laisser passer ce qui compte : le meme jeu, sur le
meme magasin, a deux annees d'ecart, reste bien deux passages. C'est meme
exactement le cas qui interesse, et un dedoublonnage trop large aurait detruit
le signal entier.

### Deux passages, pas trois

Un jeu vu deux fois est deja un jeu qu'on peut attendre. Exiger trois passages
rendrait le signal inutilisable pendant des annees, vu la profondeur reelle des
donnees.

### Detail

Le fait est calcule en dernier et ajoute a la fin des autres : savoir qu'un jeu
revient n'annule pas le fait qu'il soit offert aujourd'hui.

Quatre cles de libelle par langue (376 par locale). Le moteur est identique a
celui de la 2.37.0.

| | 2.37.0 | 2.38.0 |
|---|---|---|
| tests | 929 | 941 |
| signaux qui portent sur l'avenir | 0 | 1 |

## 2.37.0 -- 2026-09-22

**Toute la connaissance de l'extension vivait dans son popup**

Sur la fiche d'un jeu, chez Epic, GOG ou Steam, elle ne disait rien. C'est
pourtant la qu'on se demande si on l'a deja, et si on ferait mieux d'attendre.

Un bandeau discret y repond desormais, en bas a droite, et il dit quatre
choses au plus : vous le possedez deja, et ou ; il est offert en ce moment, y
compris sur un autre magasin ; vous l'avez recupere a telle date ; il a deja
ete offert une fois et vous l'avez manque.

Augmented Steam connait Steam. Les extensions GOG connaissent GOG. Aucune ne
connait vos quatre magasins PLUS ce que vous avez reclame, parce qu'aucune ne
les lit toutes.

### Quatre choses que ce bandeau ne fait jamais

**Aucun `innerHTML`.** Le depot n'en compte pas un seul, et ses deux audits le
disent. Ici la regle vaut double : le titre affiche vient du catalogue, donc
d'une API tierce.

**Rien quand il n'y a rien a dire.** L'immense majorite des fiches sont
inconnues de l'extension. Un bandeau vide sur chaque page de magasin serait une
nuisance permanente, et la premiere raison de desinstaller.

**Aucune ecriture, aucun clic.** Le script LIT et affiche. C'est pour cela
qu'il a le droit de venir d'un script de contenu, contrairement aux commandes
du worker, qui sont reservees aux pages de l'extension.

**Aucune feuille de style injectee.** Le style est pose propriete par
propriete : une feuille inseree dans une page tierce peut en modifier le rendu,
et ce script n'a le droit de rien casser.

### Il est SEPARE du moteur, et c'est delibere

Le moteur agit sur trois hotes. La surcouche informe sur quatre. Les melanger
dans la meme entree de manifeste injecterait le moteur sur le magasin Steam, ou
il n'a rien a faire.

Deux entrees, deux jeux de droits. Celui qui agit et celui qui informe ne se
confondent pas.

### « Deja offert » : d'ou vient l'histoire

La mesure a ete prise avant d'ecrire, et elle a change le plan.

**L'agregateur public n'expose que les offres ACTIVES.** Verifie le 2026-09-22 :
le seul statut present dans sa reponse est « Active », et aucun champ ne
designe une offre passee. Il n'existe donc aucune archive a interroger.

La source du fait « deja offert » est donc ce que l'extension a ELLE-MEME
observe : les issues figees depuis la 2.27.0. C'est plus pauvre au debut,
puisque cela part de rien et grandit. C'est plus honnete ensuite, parce que
chaque ligne est verifiable dans votre propre historique, et qu'une histoire
inventee aurait valu moins que rien.

### Un defaut trouve avant la premiere page ouverte

Le module lisait la collection sous une forme qu'il avait imaginee : des lignes
regroupees par titre, avec leurs magasins. Le stockage, lui, garde une carte
PLATE d'articles portant chacun son magasin.

Le bandeau n'aurait jamais dit « vous le possedez deja ». Il n'aurait rien dit
du tout, sans erreur ni message, ce qui est exactement le genre de panne qu'on
met une soiree a comprendre.

Lire la forme d'affichage aurait par ailleurs oblige a rejouer ici le
regroupement de la page Ma collection, donc a le maintenir en double.

### Mesure

| | 2.36.0 | 2.37.0 |
|---|---|---|
| tests | 916 | 929 |
| fichiers empaquetes | 72 | 74 |
| endroits ou l'extension parle | le popup et ses pages | plus les fiches de quatre magasins |

Le moteur est identique a celui de la 2.36.0.

## 2.36.0 -- 2026-09-22

**L'extension se fait montrer le bouton**

Quand un magasin refait sa page, le moteur ne reconnait plus son bouton. Le
canari compte les echecs, une alerte part, et ensuite plus rien : il faut
attendre une version. Un claimer dans un conteneur attend, lui, une nouvelle
image.

Cette version supprime cette attente. Un clic suffit.

### Pourquoi c'est faisable ici, et nulle part ailleurs

Une decision prise bien avant rend la chose possible : **le moteur ne reconnait
pas les boutons par leur forme dans le document, mais par leur TEXTE.**
`lunaClaimLabelAllowed` et `gogSubmitLabelAllowed` sont deja des listes
blanches de libelles, ecrites ainsi parce que les formes changent a chaque
refonte et pas les mots.

Apprendre, c'est donc ajouter un mot a une liste. Pas capturer un chemin CSS
qui casserait au rendu suivant, pas enregistrer une position a l'ecran, pas
piloter un navigateur. Une ligne de texte, dans le stockage local.

### La trace, sans laquelle personne n'apprendrait rien

Un libelle refuse etait une ligne de journal : quelque chose qu'on lit apres
coup et qu'on ne peut pas utiliser. Le moteur retient desormais les huit
derniers boutons qu'il a vus et refuses, par parcours.

L'interface peut alors poser la seule question qui vaille : « lequel de ces
boutons fallait-il cliquer ? » Un clic, pas une saisie. Personne ne recopie a
la main le libelle exact d'un bouton qu'il ne voit plus.

### Tout le danger est la, et il occupe la moitie du code

Un libelle appris trop large ferait cliquer un bouton PAYANT, sur un vrai
compte, sans que personne ne l'ait demande.

**Deux gardes, et il faut que les deux cedent.**

Le premier refuse d'ECRIRE. `watch/teaching.js` rejette tout libelle parlant
d'argent, dans les deux langues, montants et devises compris. Il rejette aussi
ce qui est trop court, donc sans pouvoir discriminant, et ce qui est
demesure, donc colle depuis une page entiere.

Le second refuse de CLIQUER. `looksPaid` passe AVANT la liste apprise, et
l'ordre des lignes le garantit. Un test verifie cela precisement : on ecrit
« acheter maintenant » dans le stockage en contournant volontairement le
module, le lecteur le voit bien, et le clic est refuse quand meme.

Deux gardes qui disent la meme chose ne sont pas une redondance : l'un empeche
d'ecrire, l'autre empeche de cliquer.

### Trois autres refus, plus discrets

**Une surface inconnue est refusee.** Ecrire sous un nom que le moteur ne lit
pas produirait un apprentissage qui ne repare rien, sans le dire.

**La liste est bornee a douze par parcours.** Cent libelles autorises
reviendraient a n'en autoriser aucun : la liste blanche cesserait d'en etre
une.

**Ce qui s'apprend se desapprend.** Sans cela, un libelle appris par erreur
resterait pour toujours, et la seule issue serait de tout effacer -- donc de
perdre aussi ce qui marchait. Ce qui a ete appris s'affiche : un apprentissage
invisible serait une regle secrete appliquee a chaque clic.

### Ce que le developpement a rencontre

Trois gardes du depot ont arrete une erreur avant qu'elle ne sorte, et les
trois valaient leur cout.

Le controle ASCII a refuse deux guillemets francais, puis six accents graves
dans un commentaire. Le controle de renommage a refuse une variable nommee
`reste`, que la table historique transforme en `leftChip` : un nom present dans
cette table casse la comparaison avec la base d'origine.

Et le piege du harnais, documente dans le README, a coute deux tests : le
moteur tourne dans un autre realm, ses tableaux n'ont pas les memes prototypes
que ceux du test, et `deepEqual` les rejette. La reponse etait ecrite depuis
longtemps : passer par `Array.from`.

### Mesure

| | 2.35.1 | 2.36.0 |
|---|---|---|
| tests | 894 | 916 |
| delai de reparation apres une refonte de magasin | une version | un clic |
| gardes entre un libelle appris et un achat | 1 | 2 |

Nouveau temoin fige et base de renommage rebasee. Quatre cles de libelle par
langue (372 par locale).

## 2.35.1 -- 2026-09-22

**Trois tests verts sur une seule machine au monde**

La 2.35.0 est partie avec 894 tests au vert en local et une integration continue
rouge. Les trois tests de permissions lisaient les manifestes par un chemin
Windows ecrit en dur.

C'est le pire symptome qu'un test puisse avoir : vert la ou on l'ecrit, rouge
partout ailleurs. Il ne signale rien tant qu'on reste sur la meme machine, et
il ment sur exactement ce qu'il est cense garantir.

Le chemin se RESOUT desormais depuis le fichier de test lui-meme.
`import.meta.url` connait sa propre position, et c'est la seule reference qui
voyage.

### Le correctif seul n'aurait servi qu'une fois

Rien n'empechait de recommencer. Un garde-fou de plus au build refuse tout
chemin absolu dans `test/` et `build/` -- lettre de lecteur Windows, ou racine
Unix dans une chaine de caracteres.

Il a ete verifie de la seule facon qui vaille : en remettant la faute, en
constatant que le build la refuse, puis en la retirant.

**Pourquoi au build plutot qu'en test.** L'integration continue l'avait bien
attrape, et c'est deja tard : elle tourne apres le commit, apres la poussee, et
apres avoir cru le travail fini. Un garde au build refuse avant.

C'est le meme raisonnement que les trois contraintes du moteur -- ASCII pur,
aucun litteral de gabarit, fins de ligne CRLF -- qui sont toutes la parce
qu'elles ont casse quelque chose en production une fois.

### Detail

Aucun fichier d'execution ne change : le moteur, l'interface et la veille sont
identiques a la 2.35.0. Seuls un test et le build bougent.

## 2.35.0 -- 2026-09-22

**« Bientot » annoncait des jeux sans jamais y mener**

La section publie les ouvertures a venir qu'Epic annonce lui-meme : un titre,
une vignette, une heure. Trois informations, et aucun moyen d'aller voir le
jeu -- alors que c'est exactement ce qu'on veut faire en lisant la ligne.

La cause n'etait pas dans l'interface. `upcomingWindows` ne gardait ni le slug
ni l'adresse de la fiche : le popup n'avait rien a rendre cliquable, et aucun
arrangement d'affichage n'aurait pu l'inventer.

L'adresse est desormais construite par les MEMES fonctions que celle d'une
offre en cours : meme base de chemin, meme slug, meme parametre de langue. Deux
facons de construire l'URL d'une meme page seraient deux facons de se tromper.

**Une ligne sans adresse reste un simple element de liste.** Un lien mort est
pire qu'une absence de lien : il fait cliquer pour rien, et donne l'impression
que l'extension s'est trompee de jeu. Et une ligne qui mene quelque part le
MONTRE -- survol, curseur, contour au clavier : on n'essaie pas de cliquer ce
qui n'a pas l'air cliquable.

### Cinq boutons sur la ligne qui portait deja trois informations

Les quatre versions precedentes ont ajoute a la carte de jeu le souhait, la
priorite, la reclamation a l'unite et le report. Avec le refus deja present,
cela faisait cinq boutons dans la MEME ligne que le magasin, la valeur et le
compte a rebours.

A 328 pixels de large, plus rien ne s'y lisait.

**Deux rangees, deux natures.** Ce que l'offre EST -- magasin, valeur, temps
restant -- et ce qu'on peut en FAIRE. La rangee d'actions garde sa hauteur meme
vide : sans cela, survoler une carte la ferait grandir, et toute la liste
sauterait sous le curseur.

**Trois actions se distinguent.** Celles qui expriment un choix deja fait --
l'etoile posee, le coeur pose -- restent visibles ; les autres s'effacent tant
que la carte n'est pas survolee, parce qu'une liste de vingt offres avec cent
boutons allumes ne se lit plus. La reclamation est verte : c'est la seule qui
AGISSE sur un compte, les quatre autres ne font que trier. Le refus vire au
rouge au survol : c'est le seul geste irreversible de la rangee.

### La jaquette passe en paysage

Les trois magasins servent des visuels larges : vignettes Epic, en-tetes Steam,
jaquettes GOG. Les recadrer dans un carre de 40 pixels coupait le titre du jeu
peint dessus, et il ne restait qu'une texture.

Le format 8:5 montre l'illustration telle qu'elle a ete dessinee, pour
vingt-quatre pixels de largeur en plus. L'anneau de compte a rebours reste : il
epouse le nouveau rectangle sans rien changer a son calcul.

### Ce qui n'a pas ete verifie, et il faut le dire

Cette version touche a la mise en page, et la mise en page se REGARDE. Un banc
d'essai a ete monte pour cela -- la feuille de style reelle du popup, des
cartes ecrites dans la forme exacte que le code produit, a la largeur reelle --
mais l'extension de navigateur n'etait pas connectee au moment de le lancer.

Ce qui est verifie : la feuille de style est equilibree, les 894 tests passent,
et le controle de references du build ne trouve aucun nom inconnu. Ce qui ne
l'est pas : l'allure. Les proportions annoncees ci-dessus sont raisonnees, pas
constatees.

### Detail

Le moteur est identique a celui de la 2.34.0. Une cle de libelle par langue
(368 par locale).

| | 2.34.0 | 2.35.0 |
|---|---|---|
| tests | 888 | 894 |
| lignes « Bientot » cliquables | 0 | toutes celles qui ont une adresse |
| rangees sur une carte de jeu | 2 | 3 |

## 2.34.0 -- 2026-09-22

**La veille s'arretait avec la derniere fenetre, et rien ne proposait autre chose**

Le depot n'avait aucune infrastructure de permission optionnelle : pas de clef
`optional_permissions` dans les deux manifestes, pas un seul appel a
`permissions.request`, et la note du popup annoncait « seulement tant que
Chrome est ouvert » en dur -- un constat, jamais une offre.

Qui ferme sa derniere fenetre le soir ratait donc la rotation du jeudi et le
rappel de fin. La veille tenait tant qu'une fenetre etait ouverte, pas tant que
l'ordinateur etait allume.

### Une nuance honnete, parce qu'elle a failli etre oubliee

La PREDICTION, elle, ne se degrade pas pendant l'absence : au-dela de
vingt-quatre heures elle compte l'observation sans la situer. Le manque etait
la couverture, pas l'apprentissage -- et ecrire l'inverse aurait fait chercher
un bug la ou le code est deja juste.

### Trois etats, et le troisieme est celui qu'on refuse de maquiller

| Etat | Ce qui s'affiche |
|---|---|
| accordee | une case cochee, et la phrase qui dit que la veille continue |
| pas encore | une case a cocher, et la phrase qui l'explique |
| plateforme muette | **aucune case**, et une phrase qui dit pourquoi |

Firefox n'implemente pas cette permission. Son manifeste ne la declare donc
pas -- meme raisonnement que pour `offscreen`, deja absent la-bas.

Une case a cocher sans effet serait pire qu'une case absente : elle ferait
croire que la veille tourne pendant que le navigateur est ferme. C'est
exactement le genre de silence qui coute trois versions a diagnostiquer.

### Le manifeste est LU, pas suppose

Demander une permission qui n'y figure pas echoue -- silencieusement dans
certaines versions de Chrome, ce qui est le pire cas : la case se coche, et
rien ne change. Le popup lit donc `optional_permissions` avant de proposer quoi
que ce soit.

### Une permission optionnelle n'est pas une permission du manifeste

Celle-ci reste HORS du bloc `permissions`. Une permission du manifeste
s'accepte en bloc a l'installation, ou l'on renonce a l'extension. Celle-ci est
un choix pose apres coup, et retirable du meme geste.

Le decochage appelle `permissions.remove` : ce qui s'accorde se retire, sans
quoi la case serait un aller simple.

### Ce que Chrome refuse, et comment on s'y prend

`permissions.request` n'est accepte que depuis un geste utilisateur. Un refus
n'est pas une erreur, c'est un SILENCE -- donc un interrupteur qui ne bouge
pas, sans rien dire. L'etat reel est relu juste apres l'appel, dans les deux
sens : ce qui s'affiche est ce que le navigateur dit, jamais ce que le code a
demande.

### Detail

Le build scanne desormais `watch/permissions.js`, dont les phrases vivent en
table et non en appel de traduction. `watchNote` a ete retiree des deux
locales : la note est devenue dynamique, et une cle que plus rien ne cite coute
une traduction, une relecture et un entretien pour rien -- l'avertissement du
build est fait pour ca.

Quatre cles par langue, une retiree (367 par locale). Le moteur est identique a
celui de la 2.33.0.

| | 2.33.0 | 2.34.0 |
|---|---|---|
| tests | 881 | 888 |
| permissions optionnelles | 0 | 1 |
| la veille tient tant que | une fenetre est ouverte | l'ordinateur est allume |

## 2.33.0 -- 2026-09-22

**Sept magasins sur neuf recevaient l'adresse de Microsoft**

La destination d'un code se decidait par un ternaire binaire : GOG d'un cote,
l'URL de Microsoft pour TOUT le reste. Ecrit en double, dans le moteur et dans
le popup.

Amazon Luna distribue des cles pour neuf plateformes. Une cle Ubisoft, EA ou
Battle.net menait donc a un formulaire qui la refuse -- et le message qui
l'accompagnait affirmait le contraire.

### Une table, et ce qu'elle refuse de contenir

`REDEEM_URLS` vit desormais a un seul endroit logique, en deux exemplaires
techniques : un module ES pour le popup, et son jumeau ES5 dans le moteur, qui
tourne aussi en userscript sans modules. La duplication ne peut pas
disparaitre ; un test de parite verifie qu'elle ne derive pas, exactement comme
celui qui garde le pays de la boutique depuis la 2.20.0.

**Deux entrees renseignees, sept a `null`.** Ce sont les deux seules adresses
que ce depot ait jamais utilisees, donc les deux seules dont il puisse
repondre. Les autres attendent une mesure -- ouvrir la page, constater qu'elle
demande bien un code.

`null` n'est pas un trou : c'est le mot juste. Le bouton d'echange disparait, et
le message dit « collez-le sur le site de X » sans promettre d'adresse.
Inventer une URL plausible aurait coute un onglet ouvert sur une erreur, et la
confiance dans toutes les autres.

L'URL de la page Epic a bien ete interrogee pour cette version : le serveur
repond 403 a toute requete qui ne vient pas d'un navigateur. Ce n'est ni une
confirmation ni un dementi, donc l'entree reste vide.

### Les cles recues ailleurs ont enfin un endroit ou entrer

Humble Choice, IndieGala, Fanatical : rien de tout cela ne passe par Luna, et
l'onglet Codes ne savait donc rien en faire.

Le champ accepte un COLLAGE entier -- titres, puces, lignes vides. Une
expression reguliere sait ignorer ce bruit, et demander a l'utilisateur de
nettoyer serait lui faire faire le travail de la machine. Un code colle en
minuscules est accepte : le motif ne reconnait que les capitales, et le refuser
sans explication serait incomprehensible.

Le motif est recopie a l'identique depuis le moteur, et le test de parite le
verifie aussi. Deux motifs qui divergent feraient accepter dans le popup un
code que le moteur refuse, sans que personne puisse savoir lequel a raison.

### « Echange » et « invalide » cessaient de se ressembler

Un code ne portait que son nombre d'essais, sa derniere tentative et sa
derniere erreur : de quoi savoir qu'on avait essaye, jamais ce qui s'etait
passe. Quatre etats les separent desormais, et l'un veut dire « c'est fait »
quand l'autre veut dire « celui-la ne servira plus jamais ».

### Ce que cette version NE fait pas, et pourquoi c'est ecrit

Elle n'ajoute aucun second moteur d'echange. GOG en a un, mesure : libelles
autorises, detection de page payante, captcha rendu a l'humain, classification
des reponses. Rien d'equivalent n'existe ailleurs, et un parcours qui clique
sur un vrai compte ne s'ecrit pas avant d'avoir mesure la page visee.

C'est la regle du projet, et c'est la seule qui protege un compte.

### Detail

Le moteur change, donc un nouveau temoin de non-regression est fige, avec son
motif, et la base du renommage est rebasee. Le controle du build a attrape deux
violations dans l'ajout avant qu'elles ne sortent : deux accents graves dans un
commentaire -- interdits parce qu'ils cassent le linter de Tampermonkey -- et
des fins de ligne LF dans un depot en CRLF.

Neuf cles de libelle par langue (364 par locale).

| | 2.32.0 | 2.33.0 |
|---|---|---|
| tests | 866 | 881 |
| magasins avec une destination juste | 2 sur 9 | 2 mesures, 7 honnetes |
| endroits ou la destination est ecrite | 2 ternaires | 1 table, 2 copies verifiees |

## 2.32.0 -- 2026-09-22

**Le bilan etait un tableau de chasse. Voici la colonne d'a cote**

Ce qui a ete pris se comptait depuis longtemps. Ce qui a ete rate ne laissait
aucune trace -- et c'est pourtant la seule colonne qui apprenne quelque chose :
un taux de capture qui s'effondre est soit un reglage trop strict, soit une
panne, et les deux se corrigent a condition de les voir.

La page arrive cinq versions apres la collecte, et ce n'etait pas un retard.
Les issues sont figees depuis la 2.27.0 : ouvrir cette page le meme jour
l'aurait montree vide, ce qui n'apprend rien a personne.

### Deux chiffres, et ce qu'ils refusent de dire

**Les issues INCERTAINES sortent du taux.** Une reclamation arretee par un
defi de securite ne dit pas si le jeu est au compte. La compter comme ratee
accuserait l'extension a tort ; la compter comme prise la flatterait. Leur
nombre reste affiche a cote, pour qu'on sache ce qu'on ne sait pas.

**Un historique vide ne rend pas zero pour cent.** Zero sur rien du tout ferait
croire a une panne le premier jour. L'absence de taux se dit, elle ne
s'invente pas.

**Une valeur illisible vaut zero, jamais NaN.** Un « gratuit » dans le champ
valeur suffirait a contaminer la somme entiere et a rendre la page illisible --
pas fausse, illisible, ce qui est pire parce qu'on ne sait plus quoi corriger.

### Les compteurs ne suivent pas le filtre

Ils decrivent tout l'historique, pas la vue. Ils repondent a « comment ca se
passe », pas a « qu'est-ce que je regarde » -- et les faire suivre le filtre
rendrait le taux de capture absurde des l'instant ou l'on ne regarde que les
offres ratees.

### Trois details qui ne se voient qu'a l'usage

**Le titre mene a la fiche quand l'URL a survecu au figement, et reste du texte
sinon.** Un lien mort est pire qu'une absence de lien.

**Le verdict brut est en infobulle.** « needs_login » n'a rien a faire dans une
colonne, et tout a faire a portee de souris le jour ou on cherche pourquoi une
offre est passee a cote.

**La liste des magasins du filtre vient des donnees.** Un magasin qui n'a
jamais rien laisse passer n'encombre pas le menu.

**Les mois se trient sur une cle « AAAA-MM » en UTC**, pas sur un libelle
localise. Un tri sur des dates reconstruites depuis un nom de mois se casse la
premiere fois qu'on change de langue.

### La page reprend la feuille de style du journal, entiere

Les jetons de couleur, la barre de defilement en ticket, les etats de tableau
y sont deja. Une seconde copie divergerait au premier ajustement, et deux
pages de la meme extension finiraient par ne plus se ressembler.

### L'export

En CSV, champs entoures de guillemets et guillemets internes doubles : un titre
de jeu contient des virgules bien plus souvent qu'on ne le croit, et une seule
ligne mal echappee decale toutes les colonnes du fichier.

### Detail

La page est declaree a quatre endroits du build et dans la liste blanche
d'empaquetage. Sans ce dernier point elle aurait marche en mode developpeur --
ou le dossier entier est charge -- et seulement la : exactement le garde pose
en 2.26.0.

Vingt-trois cles de libelle par langue (355 par locale). Le moteur est
identique a celui de la 2.31.0.

| | 2.31.0 | 2.32.0 |
|---|---|---|
| tests | 854 | 866 |
| fichiers empaquetes | 66 | 69 |
| pages | 6 | 7 |

## 2.31.0 -- 2026-09-22

**L'utilisateur ne pouvait exprimer qu'un refus**

Trente versions, et pas une seule ou il dise ce qu'il VEUT. Le seul geste
disponible etait la croix, qui exclut un titre pour toujours : l'extension
savait tout de ce qu'il ne voulait pas, et rien de ce qu'il attendait.

Deux donnees nouvelles, et ce sont les deux premieres du depot a ne venir ni
d'un magasin ni du moteur.

### La liste de souhaits

**Un souhait porte sur un TITRE, jamais sur une offre.** C'est precisement son
interet : le jeu attendu depuis des mois n'est dans aucun catalogue. Un
souhait accroche a une offre disparaitrait avec elle ; accroche a un titre, il
survit a son absence et se reconnait le jour ou il parait, sur n'importe quel
magasin -- y compris celui auquel personne ne pensait.

Ce qu'il change, une fois pose :

- **L'ordre.** Ce qui etait attendu passe devant, apres seulement ce que
  l'utilisateur a explicitement priorise. Le calcul d'urgence garde le reste.
- **L'annonce.** Un jeu attendu ECHAPPE au resume quotidien. C'est toute la
  difference entre savoir qu'il y a des offres et savoir que CELLE-LA est
  arrivee -- et le resume, bon comportement pour le tout-venant, devient le
  mauvais a l'instant ou la liste porte quelque chose qu'on guettait.

**Le drapeau est derive, jamais persiste.** La liste change ; une offre marquee
une fois pour toutes resterait prioritaire longtemps apres le retrait du
souhait, sans que rien ne l'explique.

### La normalisation par defaut a ete supprimee, pas amelioree

Le module acceptait au depart une normalisation optionnelle, avec un repli
faible : minuscules et espaces, sans la ponctuation. Le premier test l'a prise
en flagrant delit -- « Hollow Knight: Silksong » et « hollow knight silksong »
devenaient deux souhaits.

L'erreur ne levait rien. Elle aurait produit deux annonces prioritaires pour un
seul jeu, ou pire, un souhait qui ne reconnait jamais l'offre qu'il attend.

Le repli a donc ete retire plutot que corrige : la fonction est desormais
OBLIGATOIRE, ce qui force chaque appelant a passer celle du modele d'offre --
la seule avec laquelle le rapprochement veut dire quelque chose.

### Le backlog

La page Ma collection savait filtrer, trier, et poser un lien de lancement.
Aucune donnee produite par l'utilisateur ne s'y accrochait : elle etait un
inventaire, pas un outil.

Cinq etats -- non renseigne, a essayer, en cours, fini, abandonne -- un filtre,
et un tirage au sort parmi ce qui est marque « a essayer ». C'est le premier
maillon « jouer » apres « retrouver ».

Trois decisions que le code porte, chacune pour une raison :

**Un etat inconnu est refuse, pas ecrit.** Il ne casserait rien a l'ecriture,
et casserait tous les comptes et tous les filtres a la lecture, sans jamais
lever d'erreur.

**Une entree qui ne dit plus rien est effacee.** Revenir a « non renseigne »
apres avoir efface la note ne laisse pas une coquille dans le stockage.

**Le tirage recoit son hasard.** Un `Math.random` en dur rendrait la fonction
impossible a verifier, et une fonction de tirage non testee finit toujours par
rendre le premier element. Il ne tire que parmi les jeux marques « a essayer » :
tirer dans la collection entiere ressortirait un jeu deja fini.

### Ce que ces deux donnees n'atteignent jamais

**Les annotations ne touchent pas a la reclamation.** Un jeu marque
« abandonne » sur Epic n'empeche pas de prendre le meme offert sur GOG : c'est
un jugement sur une partie jouee, pas une consigne d'acquisition. Le seul
endroit qui refuse une offre reste le filtre, et il ne lit pas d'ici.

### Deux cles, deux ecrivains differents, et ce n'est pas une incoherence

La liste de souhaits passe par le service worker ; les annotations sont
ecrites directement par la page.

La regle est la meme dans les deux cas : **on route par le worker exactement
quand le worker ecrit aussi.** La liste de souhaits est lue a chaque cycle,
donc deux ecrivains sans transaction y perdraient silencieusement un choix que
l'utilisateur vient d'exprimer. Les annotations, le worker n'y touche jamais.

### Mesure

| | 2.30.0 | 2.31.0 |
|---|---|---|
| tests | 830 | 854 |
| cles de veille | 22 | 24 |
| donnees venant de l'utilisateur | 0 | 2 |

Quatorze cles de libelle par langue (332 par locale). Le moteur est identique a
celui de la 2.30.0.

## 2.30.0 -- 2026-09-22

**Le canal qui joint le plus souvent ne servait qu'a informer**

Le service worker ne construisait que des notifications de type « basic »,
sans boutons, et aucun `onButtonClicked` n'etait enregistre. Une offre
annoncee demandait donc d'ouvrir le popup pour en faire quoi que ce soit --
alors que la notification etait deja sous les yeux.

Cette version attendait la 2.29.0, et pas par prudence : ses boutons utiles
demandent une commande a l'unite et un report, qui n'existaient pas avant
elle. Livres plus tot, ils auraient ete decoratifs -- c'est-a-dire pires que
pas de boutons.

### Ce qui manquait n'etait pas les boutons, c'etait la memoire

La table retenue ne gardait qu'un couple identifiant vers URL. Rien ne savait
donc sur QUELLE offre agir.

Et « plus tard » est le cas normal : le service worker meurt trente secondes
apres le dernier evenement, et le clic arrive quand l'utilisateur revient. Un
bouton « Recuperer » sans cette memoire aurait su qu'on a clique, sans savoir
sur quoi.

La table porte desormais l'URL, la cle de catalogue et le genre de
notification. **Les entrees ecrites avant cette version restent lisibles** :
les ignorer ferait que le premier clic apres la mise a jour retombe sur le
popup au lieu de l'offre. Un bug minuscule, une seule fois, et parfaitement
evitable.

### Un numero n'est pas une intention

`onButtonClicked` ne rend qu'un INDEX. Sans une table qui dise, pour chaque
genre de notification, ce que cette position signifie, le second bouton d'un
rappel declencherait l'action du second bouton d'une annonce : une mise en
pause au lieu d'une reclamation, sur la notification meme qui dit que l'offre
se termine.

Cette table est un module pur, donc testable sans navigateur -- ce qui est
exactement ce qu'il fallait, puisque le bug qu'elle evite ne se verrait jamais
a la lecture.

**Un index hors de la liste ne declenche rien.** Retomber sur la premiere
action serait agir dans le doute sur un vrai compte, ce que l'extension evite
partout ailleurs.

### Les boutons, et celui qui est absent

| Notification | Boutons |
|---|---|
| offre reperee | Recuperer, Plus tard |
| fin proche | Recuperer |
| incident | Ouvrir le journal |

**Deux au maximum**, parce que Chrome n'en affiche jamais plus et qu'un
troisieme serait ignore en silence -- donc une action que le code croit offrir
et que personne ne voit.

**Le rappel n'a pas de « Plus tard », et c'est le sujet.** Reporter une offre
qui se termine dans quelques heures, c'est la refuser en croyant gagner du
temps. Un bouton absent est un bouton qui ne peut pas couter un jeu.

**L'incident ne mene qu'a ce qui l'explique.** Le chien de garde aboie, il ne
repare pas : un bouton « reparer » sur une panne dont la cause est inconnue
serait un mensonge.

### Firefox

Son implementation ignore les boutons et REJETTE la creation qui en porte.
Detecter le navigateur serait fragile et se perimerait ; on essaie, et on
recommence sans. Une extension qui n'afficherait plus aucune notification sur
Firefox serait un prix absurde pour deux boutons sur Chrome.

### Detail

Le build scanne desormais `watch/notify-actions.js`, dont les libelles vivent
en TABLE et non en appel de traduction. Le balayage laxiste les reconnait, le
strict les ignore : c'est exactement le cas que la distinction entre les deux
prevoyait.

Trois cles de libelle par langue (319 par locale). Le moteur est identique a
celui de la 2.29.0.

| | 2.29.0 | 2.30.0 |
|---|---|---|
| tests | 819 | 830 |
| ce qu'une notification retient | une URL | URL, offre, genre |
| actions possibles sans ouvrir le popup | 1 | 4 |

## 2.29.0 -- 2026-09-22

**Entre « ne rien faire » et « tout prendre », il n'y avait rien**

« Tout recuperer » existait avec exactement les bonnes garanties : memes
filtres, meme canari, meme registre, meme plafond horaire. Mais il ne
s'affichait qu'a partir de deux offres, et il prenait TOUT. Aucun geste entre
les deux.

Trois manques, tous verifies dans le code avant d'etre combles.

### L'etoile ne faisait rien

C'est le plus genant des trois, parce qu'il avait l'air de marcher.

L'epinglage vivait dans `veille:ui`, dont l'en-tete dit ce qu'il est : des
preferences d'affichage que le service worker ne lit jamais. L'etoile
ordonnait donc la liste dans le popup, et ne changeait RIEN a ce qui etait
reclame en premier -- `claimCandidates` triait sur la seule urgence.

Une etoile qui ne fait rien est pire qu'une etoile absente : elle donne
l'impression d'avoir agi.

La priorite s'ecrit desormais sur le CATALOGUE, via le service worker qui en
est seul ecrivain, et le popup trie sur le meme champ que lui. Un choix
explicite bat le calcul d'urgence, et c'est normal : l'utilisateur sait sur ce
jeu des choses que l'urgence ne dira jamais.

**Les etoiles deja posees ne sont pas jetees.** Elles sont traduites une fois,
au premier affichage, puis la liste d'origine est videe -- c'est elle qui sert
de marqueur, plutot qu'une cle de version de plus.

### « Plus tard » n'existait pas

Le seul geste de mise a l'ecart etait la croix, qui exclut le TITRE pour
toujours, sur tous les magasins et pour toutes les fois ou il repassera. Un
bannissement la ou on voulait un report.

La pause pose une ECHEANCE, jamais un drapeau. Un booleen demanderait a
quelqu'un de penser a le retirer ; une echeance se perime toute seule, et
c'est la seule forme de report qui ne s'oublie pas.

**Elle est bornee par la fin de l'offre.** Reporter au-dela reviendrait a
refuser en croyant remettre a plus tard -- et le refus a deja son geste.

**Un clic explicite passe outre.** Le report est une consigne pour la
reclamation automatique ; obeir a une pause contre celui qui vient de cliquer
serait absurde.

### « Celle-ci, maintenant »

`fgc-claim-one` est inscrite dans la table des commandes, qui refuse tout type
absent : une branche ajoutee sans y etre inscrite echoue bruyamment en test
plutot que de passer en silence en production.

Le bouton emprunte le MEME chemin que « Tout recuperer ». Un second chemin de
reclamation qui contournerait le canari, le registre ou le plafond horaire
serait exactement le genre de raccourci qui finit par ouvrir un onglet sur un
magasin decoche.

Deux precautions qui tiennent en une ligne chacune.

**Le catalogue est reduit a cette seule offre en ENTREE**, pas filtre en
sortie : aucune autre offre ne peut etre tentee par ce chemin, quelles que
soient les evolutions futures de la fonction de reclamation.

**Le resultat est reinjecte dans le catalogue complet.** La fonction n'a vu
qu'une entree ; ecrire son resultat tel quel aurait efface toutes les autres.

**L'arret d'urgence prime.** Le bouton est neuf, l'arret d'urgence est la
promesse la plus forte de l'extension : un chemin nouveau qui l'ignorerait la
viderait de son sens.

Le bouton n'apparait que si l'offre est reellement reclamable, d'apres la meme
fonction de jugement que la veille. Un bouton qui ne ferait rien apprendrait a
s'en mefier.

### Ce que le test a fait changer dans le code de production

Le geste de reclamation est devenu injectable, comme le `fetch` juste
au-dessus de lui. Sans cela, tester qui est candidat, dans quel ordre et sous
quel plafond aurait demande de monter un faux navigateur complet a chaque
fois -- et un test trop cher est un test qu'on n'ecrit pas.

### Detail

Le build scanne desormais `watch/health.js` pour les cles de libelle : les deux
titres de notification du chien de garde y avaient demenage en 2.28.0, et
passaient depuis pour orphelines -- une faute de frappe y serait restee
invisible.

Trois cles de libelle par langue (316 par locale). Le moteur est identique a
celui de la 2.28.0.

| | 2.28.0 | 2.29.0 |
|---|---|---|
| tests | 806 | 819 |
| commandes du worker | 12 | 15 |
| gestes par offre | 2 | 4 |

## 2.28.0 -- 2026-09-22

**L'extension savait deja qu'elle etait cassee. Elle ne savait pas le dire**

Trois detecteurs existaient, complets et testes : le canari de selecteurs, la
source en repli, la session perdue. Leurs constats allaient au journal -- une
page qu'on ouvre quand on soupconne deja quelque chose -- ou a un bandeau du
popup, qu'on voit en l'ouvrant. Ni l'un ni l'autre ne PREVIENT.

Quatre constats de code disaient ce qui manquait. Les quatre appels a
`notify()` parlaient tous d'offres. Le badge ne savait rendre qu'un nombre.
Aucune cle ne se souvenait d'une panne. Et personne ne comparait la date du
dernier cycle a l'intervalle prevu, alors que les deux valeurs etaient ecrites
a chaque reveil.

### Une panne cesse d'etre un compteur

C'est le changement de fond, et tout le reste en decoule. Une panne etait un
compteur qui monte ; elle devient un INCIDENT, avec une ouverture, une
derniere observation, et une cloture.

De la viennent les trois choses qui manquaient : dire depuis quand, ne le dire
qu'une fois, et savoir que c'est fini.

**La cloture est implicite.** Un incident que le tour d'inspection ne
reconstate pas disparait. Demander a chaque detecteur de fermer ce qu'il a
ouvert aurait fini par un oubli, et un incident fantome fait chercher une
panne qui n'existe plus -- ce qui use la confiance plus vite qu'un silence.

**Et rien n'annonce le retour a la normale.** Un probleme resolu n'interrompt
personne.

### La panne qui n'avait aucun detecteur

Deux genres d'incident sont nouveaux. Le premier est la raison d'etre de cette
version : la veille qui cesse de tourner. C'est la seule panne qui dise
« l'extension est morte », et elle n'avait aucune voix.

Le seuil laisse passer un cycle manque -- un portable ferme une nuit ne doit
rien declencher -- avec un plancher de six heures, qui est le pas nominal d'un
reglage par defaut.

**Et voici ce qui a commande toute la conception.** Un detecteur qui vivrait
dans le cycle ne se declencherait JAMAIS pour cette panne : quand la veille est
morte, le cycle ne tourne pas, donc le detecteur non plus. Un chien de garde
qui dort avec le chien qu'il garde ne garde rien.

Le tour d'inspection vit donc dans le gestionnaire d'alarme, que l'alarme filet
periodique reveille. Cette alarme existait deja, et sa propriete de survivre a
la mort du service worker etait deja payee : c'est exactement celle dont ce
detecteur avait besoin.

Le second genre nouveau lit une permission que le depot n'interrogeait nulle
part : `getPermissionLevel`. Si le systeme refuse nos notifications, tout ce
qui precede est inaudible, et personne ne le savait.

### Ce que le test a trouve, et qui aurait coute l'alerte entiere

Une alerte partait quand meme vers un canal bloque. Le cout n'etait pas l'appel
inutile : elle etait marquee DITE alors qu'elle n'etait arrivee nulle part, et
elle aurait ete perdue pour toujours -- y compris apres le retour de la
permission, moment ou elle serait enfin utile.

Un canal coupe se traite donc comme les heures calmes : silence, et rien de
marque. Ce qui attend part des que la permission revient.

### Le reglage qui ne devait trahir personne

Un incident n'est pas une offre. Quelqu'un qui ne veut plus etre prevenu des
jeux gratuits veut probablement savoir que son extension est cassee. Mais lui
envoyer des notifications apres qu'il les a coupees serait exactement la
trahison que ce depot nomme deja : « une preference perdue en silence est une
trahison silencieuse ».

`alertMode` est donc un reglage separe, actif par defaut, avec une traduction
UNIQUE : un `notifyMode: 'off'` deja choisi eteint aussi ce canal-la, une seule
fois, exactement comme `notifications: false` devenait `notifyMode: 'off'`
depuis la 2.10. Ensuite les deux sont independants -- et couper les offres en
gardant les alertes est precisement la combinaison la plus utile.

**Heures calmes et silence ne sont pas la meme chose**, et la difference est
codee. Les heures calmes DIFFERENT : rien n'est marque, l'alerte repart au
matin. Le mode coupe SUPPRIME : ce qui attendait est marque dit sans etre dit,
sinon tout partirait d'un coup le jour ou l'utilisateur rallume.

### Le badge, et pourquoi il ignore son propre reglage

Un incident ouvert remplace le compte d'offres par une marque. Une panne prime
sur un decompte, que le popup affiche de toute facon.

Il ignore `badgeMode`, et c'est delibere : ce reglage dit « ne me compte pas
les offres », pas « ne me dis jamais rien ». Les confondre enterrerait la
derniere voix disponible quand le systeme bloque les notifications.

Le badge est aussi peint par le tour d'inspection, et pas seulement en fin de
cycle -- sans quoi il serait muet dans le cas ou il sert le plus.

### Dans le popup, deux incidents et pas cinq

Trois des cinq genres ont deja leur bandeau, avec leur geste propre : le
selecteur mort s'acquitte, la source en repli ouvre la sentinelle, la session
perdue mene a la page de connexion. Les repeter ferait deux alertes pour une
panne, et la seconde userait la premiere.

Le bandeau nouveau ne porte donc que les deux qui parlent de l'extension
elle-meme. Il mene au journal, pas a un bouton de reparation : le chien de
garde aboie, il ne repare pas.

### Ce que la conception a change dans le plan

Cette version devait aussi porter les notifications actionnables. La
conception a montre que non : leurs seuls boutons utiles -- « Recuperer »,
« Me rappeler » -- demandent une commande et un champ qui n'existent pas
encore et qui appartiennent a la file de reclamation pilotable. Livrer avant
elle aurait donne des boutons decoratifs, c'est-a-dire pire que pas de
boutons.

La file passe devant. Rien n'est abandonne.

### Mesure

| | 2.27.0 | 2.28.0 |
|---|---|---|
| tests | 762 | 806 |
| cles de veille | 21 | 22 |
| genres d'incident detectes | 0 | 5 |
| pannes qui previennent l'utilisateur | 0 | 4 |

Le cinquieme genre ne previent pas : c'est celui qui dit que le canal est
coupe.

### Detail

`watch/health.js` est sorti de `background.js` pour une raison qui n'est pas de
style : ce qu'il observe est l'ABSENCE de cycle, donc il ne peut pas etre teste
a travers un cycle. Il lui fallait un point d'entree a lui, jouable sans rien
demarrer. Le service worker n'en garde que le branchement.

Deux cles de libelle ajoutees par langue, plus deux pour le bandeau du popup
(313 par locale). Le moteur est identique a celui de la 2.27.0.

## 2.27.0 -- 2026-09-22

**Deux choses ecrites depuis des mois, et que personne n'avait branchees**

Aucune ligne de moteur ne change. Les deux sujets de cette version etaient
deja dans le depot : l'un attendait un interrupteur separe, l'autre attendait
qu'on decide d'ecrire ce qu'on savait deja.

### Regarder Steam et cliquer sur Steam etaient le meme interrupteur

La source Steam est ecrite en entier depuis la 2.22.0. Elle est la seule a
rendre trois choses que l'agregateur ne connait pas : la date de fin EXACTE de
l'offre, le type DLC, et le numero de paquet.

Elle ne s'activait qu'avec `steamAutoClaim` -- l'option qui fait CLIQUER,
coupee par defaut et confirmee derriere un avertissement qui cite le contrat
Steam. Or ce contrat interdit le clic scripte, pas la lecture d'une page de
recherche publique. Les deux etaient lies pour une raison technique : c'est la
source Steam qui donne le paquet, sans lequel aucune reclamation n'est
possible. La consequence n'etait pas technique du tout.

Qui refusait le clic automatique -- le cas par defaut, volontairement -- ne
voyait de Steam que ce que GamerPower en dit : des cles offertes sur des sites
tiers, sans paquet, que le filtre rejette. Le magasin figurait dans la liste
des magasins suivis et n'y apportait rien.

Les deux questions sont desormais separees :

| | Avant | Maintenant |
|---|---|---|
| Lire la recherche Steam | seulement avec l'option | **pour tout le monde** |
| Lire ce que le compte possede | a chaque cycle, avec l'option | inchange : seulement avec l'option |
| Cliquer | seulement avec l'option | inchange : seulement avec l'option |

### La ligne de SECURITY.md qui commandait la forme de ce changement

« L'extension ne lit jamais un compte de sa propre initiative. »

Lire les possessions Steam demande les cookies de la session. Activer la
detection pour tout le monde SANS separer cette lecture aurait donc ouvert une
requete porteuse de cookies chez chaque utilisateur, par defaut, pour une
fonction qui n'en a pas besoin -- et aurait fait mentir cette phrase.

Le parametre qui l'evite existait deja dans la source, et personne ne le
passait jamais : `withOwned` valait `true` par defaut et aucun appelant ne
disait le contraire. Le cycle le transmet desormais, et il se compare a `true`
et non a la veracite -- meme severite que `claimableStoresFor`, parce que ce
qui declenche une requete porteuse de cookies la merite.

Le mode sans compte se tait aussi sur ce qu'il ignore : `alreadyOwned` vaut
INCONNU, jamais « non ». La nuance coute un jeu si on la rate -- un « non »
affirme sur un jeu deja acquis ferait afficher « pas encore recupere » a
quelqu'un qui l'a depuis des annees.

### Ce qui est passe, pris ou rate

Le bilan compte ce qui a ete PRIS. Rien ne gardait ce qui a ete RATE, et c'est
pourtant la seule colonne qui apprenne quelque chose : une offre expiree sans
avoir ete reclamee est soit un reglage trop strict, soit une panne, soit un
choix delibere. Les trois se ressemblaient, faute de trace.

Le catalogue ne pouvait pas tenir cette memoire, pour deux raisons : il est
purge a quatre-vingt-dix jours, et le motif d'ecart n'est calcule qu'a
l'affichage, donc jamais ecrit. Passe ce delai, l'information n'existait plus
nulle part.

`watch/outcomes.js` fige donc l'issue A L'INSTANT OU L'OFFRE SE TERMINE, seule
fenetre pendant laquelle tout est encore connu. Meme raisonnement que le
registre de bibliotheque pour les acquisitions, avec une difference qui
commande le reste : une acquisition est rare et precieuse, donc le registre
n'a pas de plafond ; une issue arrive pour CHAQUE offre qui passe, donc
celui-ci en a un -- mille, les plus vieilles partant d'abord.

**On balaie le catalogue, pas les trois listes.** Une offre devient terminale
par trois chemins : sa date passe, elle disparait de sa source, une
reclamation la resout. Suivre les trois separement demanderait trois cablages,
donc trois occasions d'en oublier un -- et un oubli ici ne se verrait pas : la
page serait simplement moins complete, sans la moindre erreur. Le balayage est
sur parce que la premiere issue gagne, propriete qui vient du cycle lui-meme,
rejouable par conception.

**Trois issues, et la troisieme est celle qu'on refuse de deviner.** Prise,
ratee, ou inconnue. Un echec, un defi de securite, un compte a associer :
l'offre est finie et personne ne sait si le jeu y est. Le dire est utile ;
trancher ne l'est pas. Le verdict brut reste fige a cote, pour qui veut la
nuance.

### La page viendra plus tard, et c'est voulu

Rien dans l'interface ne lit encore ces issues. La collecte part maintenant
parce qu'une page branchee sur un magasin vide n'apprend rien : il faut que la
collecte ait tourne avant. C'est la meme raison qui fait que cette entree
arrive en 2.27.0 et non en meme temps que la page.

### Ce qui a change dans les tests, et pourquoi

Deux tests anciens ont ete reecrits plutot que corriges, parce qu'ils
affirmaient la promesse d'avant.

Le premier exigeait que la source Steam soit inactive par defaut. C'etait lier
regarder et cliquer dans une assertion. Il affirme desormais l'inverse pour la
source, et la meme chose qu'avant pour la reclamation.

Le second exigeait que la source ne soit meme pas interrogee sans l'option. Il
verifie maintenant trois choses au lieu d'une : la source est interrogee,
aucun onglet ne s'ouvre, et le compte n'est pas lu.

### Mesure

| | 2.26.0 | 2.27.0 |
|---|---|---|
| tests | 734 | 762 |
| cles de veille | 20 | 21 |
| requetes porteuses de cookies, reglages par defaut | 0 | 0 |

`SECURITY.md` annoncait 16 cles ; le compte reel etait de 20 avant cette
version. Corrige au passage.

### Detail

Le moteur est identique a celui de la 2.26.0, au numero de version pres : rien
de cette version ne touche a `src/core`.

## 2.26.0 -- 2026-09-22

**L'extension savait tout faire, sauf arriver chez quelqu'un**

Vingt-cinq versions, 734 tests, deux audits de securite -- et un seul mode
d'installation documente : « Mode developpeur, charger l'extension non
empaquetee ». Autrement dit personne, sauf un developpeur devant ce depot.

La consequence n'est pas theorique. La 2.24.0 a ferme quatre faiblesses de
defense en profondeur. Elle n'a atteint aucune installation, parce qu'aucune
installation n'a de moyen d'apprendre qu'elle existe. Un correctif qui ne
part pas est un correctif qui n'a pas ete ecrit.

Cette version ne change rien a ce que fait l'extension. Elle lui donne une
porte de sortie.

### Deux archives, et une liste blanche plutot qu'un dossier

`npm run package` ecrit `dist/free-games-claimer-chrome-vX.Y.Z.zip` et sa
jumelle Firefox. Ce qui part est une liste **calculee**, jamais le contenu du
dossier : le depot porte le moteur en deux exemplaires -- les 34 modules de
`src/core` et l'artefact genere -- plus le build, les tests, les vingt-deux
temoins figes et la documentation.

La liste part de points d'entree et suit les references. Les points d'entree
sont de deux natures, et oublier la seconde etait le piege.

**Ce que le manifeste designe** : le worker, les scripts de contenu, le popup,
les icones. C'est la partie facile, et le build savait deja la lire.

**Ce qui s'ouvre a l'execution**, par `chrome.tabs.create` ou
`chrome.offscreen.createDocument`, depuis une chaine litterale qu'aucun
manifeste ne mentionne. Six pages sont dans ce cas : le journal, Ma
collection, la sentinelle, le diagnostic, et les deux documents hors ecran.
Une fermeture calculee depuis le seul manifeste les aurait oubliees toutes
les six -- et le symptome aurait ete celui d'`ERR_FILE_NOT_FOUND`, revenu
trois fois ici : Chrome charge l'extension sans broncher, puis la page
s'ouvre vide.

### Le garde qui compte pour demain

La liste des six pages est tenue a la main, et c'est assume. Ce qui ne l'est
pas, c'est qu'une septieme puisse etre ajoutee sans que personne le remarque.

L'empaquetage refuse donc de produire une archive tant qu'un `.js` ou un
`.html` du depot -- hors atelier -- n'est joint par personne. Le controle
tourne dans `npm run check`, a chaque commit.

C'est le seul garde qui valait vraiment d'etre ecrit, parce que le bug qu'il
attrape est invisible la ou on travaille : en mode developpeur le dossier
entier est charge, donc la page oubliee marche. Elle ne casse que chez
l'utilisateur. Vert en developpement, casse en production, sans aucun message.

### Ce que les tests ont trouve avant la premiere publication

Le test de la variante Firefox a echoue du premier coup, et pour une bonne
raison : Chrome declare son fond par `service_worker`, Firefox par une liste
`scripts`. La lecture du manifeste ne connaissait que la premiere forme.

L'archive Firefox serait donc partie **sans `background.js`** -- et sans rien
de ce que ce fichier importe, c'est-a-dire toute la veille. Une extension qui
s'installe proprement, qui affiche son popup, et qui ne surveille rien. Le
genre de panne qu'on met une soiree a comprendre parce que tout a l'air
normal.

### Une archive reproductible

L'horodatage interne est fige a 1980-01-01, plancher du format. Deux
personnes qui empaquettent le meme commit obtiennent le meme octet et la meme
empreinte, ce qui permet de verifier qu'un zip publie correspond bien au code
du depot.

Ce n'est pas une coquetterie dans un depot qui compare deja le moteur au bit
pres a chaque build : c'est la meme promesse, etendue jusqu'au fichier que
l'utilisateur telecharge.

### La release, et ou elle s'arrete volontairement

Un tag `vX.Y.Z` declenche `.github/workflows/release.yml` : controle que le
tag et `package.json` disent la meme version, `npm run check` en entier,
empaquetage, depot des deux archives sur une release GitHub.

Le premier controle merite son existence. Sans lui, un tag `v2.27.0` pose sur
un depot encore en 2.26.0 publierait une archive dont le manifeste annonce
2.26.0 -- et le navigateur refuserait la mise a jour suivante, puisqu'il
compare les numeros du manifeste et non ceux du depot.

La chaine s'arrete avant la soumission aux magasins, et c'est un choix.
Envoyer sans relire ce qui part fait publier une erreur plus vite, pas mieux.

### Ce qu'il reste a faire a la main

`store/` porte ce qu'un magasin demande et que le code ne contient pas : la
fiche en deux langues, une justification par permission derivee de
`SECURITY.md`, une politique de confidentialite. Trois choses y attendent
encore une main humaine : les captures d'ecran, l'adresse de contact, et la
soumission elle-meme.

Un point propre a Firefox y est note pour ne pas etre decouvert pendant la
relecture : `free-games-claimer.js` est un fichier **genere**, et AMO exige la
source et les instructions de construction de tout code genere.

### Mesure

| | Chrome | Firefox |
|---|---|---|
| fichiers dans l'archive | 60 | 60 |
| taille | 316 683 octets | 316 723 octets |
| fichiers du depot laisses de cote | 0 | 0 |

Archives extraites par un decompresseur tiers, hors du code qui les ecrit :
60 fichiers, moteur et icones identiques a l'octet pres aux fichiers du
depot.

### Detail

Vingt et un tests nouveaux, dont un lecteur de ZIP ecrit dans le test plutot
qu'en production -- relire avec notre propre ecrivain n'aurait prouve que sa
coherence avec lui-meme. `dist/` est ignore par git : reproductible depuis un
commit, donc inutile a versionner.

Aucun fichier d'execution n'a change. Le moteur est identique a celui de la
2.25.2, au numero de version pres.

## 2.25.2 -- 2026-09-20

**Les huit sections se replient, et un pli qui a une alerte s'ouvre tout seul**

La 2.25.1 en avait replie quatre et laisse cinq depliees. Demande : replier
les autres. Fait -- mais replier Magasins et Veille de fond n'etait pas une
simple continuation, parce que ce sont les deux seuls endroits ou l'extension
CRIE.

### Ce que replier aurait coute, si on s'etait arrete la

Trois alertes vivent dans ces deux sections : le canari qui signale un
selecteur mort, la source mise en repli apres trois echecs, la session
perdue. Un chevron par-dessus, et aucune des trois n'existe plus. On aurait
gagne des pixels en enterrant le seul mecanisme qui previent quand la
reclamation cesse de marcher -- exactement le silence qui a coute trois
versions en septembre.

D'ou deux regles, ajoutees avec les plis plutot qu'apres.

**Un pli ferme garde sa ligne de verdict.** A droite du titre, sans rien
ouvrir : « 4 recuperes », « autonome », « 4 suivis », « 3 sources ». Replier
n'est pas cacher.

**Un pli qui a une alerte s'ouvre de lui-meme**, et seulement lui. Magasins
s'ouvre sur un canari ou une session `logged_out` ; Veille de fond sur une
source en repli. Une session `inconnu` n'ouvre rien : elle n'appelle aucun
geste, et l'ouvrir ferait passer une ignorance pour une alerte -- la lecon de
la 2.22.2, tenue jusque dans un chevron.

**Une fois par ouverture du popup.** `render()` retourne apres chaque clic ;
sans ce souvenir, un pli que l'utilisateur vient de refermer se rouvrirait
sous ses doigts. Il a ferme : c'est une reponse, pas un accident.

### L'arret d'urgence reste deplie

Seule section sur neuf. Une section qu'on ouvre en panique ne se cherche pas
derriere un chevron, et son bouton ne vaut que s'il est deja la.

### Mesure

Meme donnee semee, meme fenetre de 560 px, popup.js reellement execute dans
Chromium.

| Onglet Reglages a l'ouverture | 2.25.1 | 2.25.2 |
|---|---|---|
| rien a signaler | 1391 px (2,5 ecrans) | **467 px -- aucun defilement** |
| rien a signaler, densite compacte | -- | **395 px** |
| canari + repli + session perdue | 1391 px | 1212 px, les deux bons plis ouverts |
| tout deplie a la main | -- | 2185 px |

Les trois declencheurs ont ete pris un a un : canari seul ouvre Magasins,
repli seul ouvre Veille de fond, session perdue seule ouvre Magasins, et rien
n'ouvre rien quand tout va bien.

### Detail

Cinq cles de libelle ajoutees (309 par locale). Les quatre plis de la 2.25.1
fermaient a dix espaces d'indentation ; ils ferment desormais sous leur
ouverture.

## 2.25.1 -- 2026-09-20

**Trois fissures dans une interface qui, par ailleurs, n'a pas besoin d'etre refaite**

Question posee : faut-il redessiner l'interface ? Apres l'avoir mesuree et
regardee : non. Un seul jeu de jetons pour cinq pages, aucun controle natif
non style, et des choix d'interaction qui tiennent -- l'annulation a 12 s sur
un rejet, l'anneau de decompte, les onglets collants. Une refonte aurait
detruit ca pour rien.

Trois defauts precis, en revanche.

### Le reglage de densite n'existait pas

`popup.js` enregistrait `density: 'cosy'`. `popup.html` definissait
`body[data-density="compact"] { --pad: 10px; --gap: 5px; }`. Et **rien ne
posait jamais `data-density`**, aucun controle ne permettait d'en changer.
Une preference que personne ne pouvait modifier, une regle qui ne
s'appliquait jamais, et les deux qui s'attendaient depuis des mois.

Le lien est fait, et le choix ajoute a la section Apparence.

### La page de diagnostic ignorait le theme

Les quatre autres pages ont trois blocs de theme : la base sombre, la media
query `prefers-color-scheme`, et la surcharge `[data-theme]`. Diagnostics
n'en avait qu'un. Elle restait en sombre meme quand l'utilisateur avait
choisi Clair. Elle a desormais les trois, et lit la preference comme le
journal, la collection et la sentinelle.

### L'onglet Reglages faisait trois ecrans

**1592 px mesures, dans une fenetre qui en montre 560** : neuf sections,
31 controles, 3,1 ecrans de defilement. C'est ce que `ROADMAP.md` avait
nomme -- « le popup porte a l'etroit dans 328 px ce que le design reserve a
un onglet dedie ».

Les quatre sections qu'on regle une fois puis qu'on oublie -- notifications,
reclamation sur page ouverte, apparence, sauvegarde -- se replient. Les
quatre qui portent le travail quotidien restent ouvertes, et l'arret
d'urgence aussi : une section qu'on ouvre en panique ne se cache pas.

| | avant | apres |
|---|---|---|
| Confortable | 1592 px (3,1 ecrans) | **864 px (1,7)** |
| Compacte | -- | **792 px (1,5)** |

Le `<h2>` reste DANS le `<summary>` au lieu d'etre remplace par lui : le
titre garde son allure de section, et un lecteur d'ecran garde son niveau de
titre. Un `<summary>` nu aurait coute les deux.

### Mesure

Les trois hauteurs sont mesurees dans Chromium sur la vraie page, pas
estimees. Le theme de diagnostics est verifie sur la couleur calculee du
`body` : `#14101F` en sombre, `#FBFAFE` en clair. 713 tests.

### Deux faux defauts, signales pour memoire

Pour voir la page, tous les attributs `hidden` avaient ete retires. Ca a fait
apparaitre un champ de fichier non style et une section sans titre -- les
deux etaient des artefacts de la mesure : `import-file` est `hidden` par
conception, et la premiere section a bien son titre. Rien n'a ete « corrige ».

## 2.25.0 -- 2026-09-20

**« Suis-je connecte ? » -- la question que l'extension ne savait pas poser**

Trois versions de suite ont ete depensees a chercher pourquoi Steam ne
reclamait rien. La reponse tenait a une question que l'extension ne posait
nulle part. Elle la devinait depuis le service worker -- une lecture de
`dynamicstore/userdata` qui rend des listes vides aussi bien pour « pas de
session » que pour « le worker n'a pas vu la session » -- et elle se taisait.
L'utilisateur voyait « aucune action », et rien d'autre.

### Ce qui s'affiche

Sous chaque magasin sondable, une ligne : **connecte** (en vert, avec la date
de la mesure), **deconnecte** (en rouge, avec un lien pour aller se
reconnecter), ou **inconnu**. Un bouton « Verifier les sessions » mesure les
trois d'un coup, et le resume passe en ambre des que la plus ancienne mesure
a plus de six heures -- c'est elle qui dit depuis quand le tableau peut
mentir.

### La nuance qui compte

**Ne pas savoir n'est pas etre deconnecte.** Une reponse illisible, une
adresse qui a change, une page HTML au lieu du JSON : tout cela rend
« inconnu », jamais « deconnecte ». Et « inconnu » n'affiche aucun lien de
reconnexion -- envoyer se reconnecter quelqu'un qui l'est deja, c'est
exactement l'erreur de la 2.22.2, et elle est tenue par un test.

Amazon dit « non sondable » plutot qu'« inconnu » : sa bibliotheque vit
derriere une API GraphQL dont rien n'a ete mesure. Les deux se ressemblent et
ne veulent pas dire la meme chose -- l'un attend une mesure, l'autre du code.

### Ce qui n'a PAS ete ecrit, et pourquoi

La sonde ne part **jamais toute seule**. Sonder, c'est lire un compte avec
votre session ; l'importation de collection s'en tient a cette regle depuis
la 2.21.0, et `SECURITY.md` la promet. Une fonction `dueForProbe`, qui aurait
resonde a chaque cycle, a ete ecrite puis **retiree avant livraison** : la
livrer inutilisee aurait laisse dans le depot du code contredisant cette
promesse. Le commentaire qui la remplace dit comment la refaire le jour ou
elle se justifiera.

### Ce qui a ete reutilise plutot que reecrit

La sonde ne contient presque rien : elle appelle le `judge` de
`watch/collection-import.js`, qui sait depuis la 2.21.0 les trois facons
mesurees de dire « pas connecte » -- un 401, une redirection vers une page de
connexion, un refus d'authentification dans le corps -- et qui refuse
d'y compter le 403, parce que c'est aussi ce que rend un mur anti-robot.
Steam est le seul cas a part, et c'est mesure : sans session il repond 200
avec des listes vides, que `judge` trouverait normales. C'est `readOwnership`
qui sait lire ce cas.

### Mesure

`test/session.test.mjs` : 9 tests. Une forme inattendue ne devient jamais
« deconnecte » ; une valeur abimee au stockage ne devient pas « connecte » ;
la sonde GOG demande `page=1` et rien de plus ; Steam sans session rend bien
« deconnecte », et une erreur HTTP rend « inconnu ». 713 tests.

## 2.24.0 -- 2026-09-19

**Deux audits de securite : rien d'exploitable, quatre portes fermees quand meme**

Question posee : « tout est chiffre, ou sauvegarde de mon cote ? » Deux
inspections completes ont tourne sur le depot -- stockage et reseau d'un cote,
surface d'injection de l'autre.

### La reponse

**Rien n'est chiffre. Tout vit chez vous**, en clair, dans le profil du
navigateur. Une seule cle peut quitter la machine -- les codes, vers votre
compte navigateur -- et elle est coupee par defaut. Aucun mot de passe, aucun
jeton, aucun cookie n'est stocke ; l'extension n'a meme pas la permission
`cookies`. Aucune telemetrie. Le detail complet est desormais dans
**`SECURITY.md`**, qui vieillira avec le code.

### Ce que les audits ont trouve : rien d'exploitable

Zero `innerHTML` dans les 200 Ko de moteur genere, les 34 modules de
`src/core`, les modules `watch/` et les cinq pages. CSP MV3 par defaut
intacte. Pas d'`externally_connectable` : aucune page web ne peut parler a
l'extension. `DOMParser` inerte pour le HTML distant. Liste blanche de
schemas d'URL plutot que liste noire.

### Les quatre portes fermees quand meme

Aucune n'etait joignable depuis le web -- il aurait fallu deja controler le
script de contenu. Ce sont des defenses en profondeur, et elles tenaient
toutes la meme promesse implicite : « personne d'autre que nous n'appellera
ceci ». Une promesse implicite n'est pas une garde.

- **Le relais reseau etait un proxy ouvert.** `fgc-fetch` acceptait n'importe
  quelle URL, n'importe quelle methode, n'importe quels en-tetes, et rendait
  le corps entier -- de quoi sonder `http://localhost` depuis le service
  worker. Il est borne a un GET HTTPS vers un hote **du manifeste**, avec
  `Accept` pour tout bagage. La liste ne peut pas deriver : c'est celle des
  `host_permissions`.
- **L'ouverture d'onglet ne verifiait aucun schema.** Chrome bloque
  « javascript: » et « data: » en navigation de premier niveau, mais pas
  `chrome-extension://` ni `file:///`. Elle passe desormais par `webUrl`, la
  meme fonction qui filtre les URL des offres.
- **Les seize commandes du worker ne regardaient pas qui les demandait.**
  Une page de magasin pouvait declencher un import de bibliotheque -- qui lit
  Steam, GOG et Epic AVEC vos cookies -- ou effacer le journal. Les commandes
  d'interface n'acceptent plus qu'une page de l'extension, les messages du
  moteur qu'un script de contenu, et un type inconnu est refuse.
- **Les URL de collection echappaient au filtre.** `makeItem` posait une `url`
  d'origine distante -- la fiche GOG vient d'une reponse lue avec la session
  -- et elle atterrissait dans un `href`. Seul un hasard heureux la sauvait.
  Symetrie retablie avec `makeOffer`.

### Hygiene des codes

Un code de rachat est un porteur. Il etait recopie **en clair dans
`FGC_history_*`**, un historique que rien ne purge et que l'export emporte --
en double, sans que rien ne le relise. L'historique garde desormais le fait,
plus le secret.

En revanche les codes **ne sont pas purges automatiquement**, contrairement a
ce qui avait ete envisage : un code supprime a tort est un jeu perdu, et
l'onglet Codes affiche deja les jours restants. C'est a l'utilisateur de
decider, pas a une minuterie.

### Mesure

`test/messaging.test.mjs` : 11 tests. Le relais refuse `localhost`, une
methode autre que GET, un en-tete `Cookie`, une valeur d'`Accept` qui tente
une injection de retour chariot -- et laisse passer l'appel reel du moteur.
Une page de l'extension **dans un onglet** (journal, collection) n'est pas
prise pour un script de contenu. Les deux listes de commandes ne se
chevauchent pas. 703 tests.

Le temoin de build a ete refige (`--freeze`) : c'est la premiere modification
de `src/core` depuis la 2.20.1, et elle est volontaire.

## 2.23.0 -- 2026-09-19

**Le pouce de la barre de defilement est un ticket**

L'identite du produit s'arretait aux icones. `icon.svg` est un ticket a coins
arrondis, degrade ambre `#FFC06B -> #FF8A3D`, evide en violet nuit, traverse
d'une perforation en pointilles -- et les cinq pages laissaient le navigateur
poser ses barres grises par-dessus. Sur le journal, 500 lignes, la rupture
etait permanente.

### Le dessin

Le pouce EST le ticket : le degrade ambre, des coins pleinement arrondis, et
la ligne de perforation qui le traverse dans sa longueur. La piste est le
creux ou il coulisse -- `--rail`, deja le jeton de tous les creux du produit
(anneau de decompte, rails d'interrupteurs, jauges). Couche, le ticket tourne
sa perforation avec lui.

La couleur de la perforation est `color-mix(in srgb, var(--ink) 62%,
transparent)`. Comme `--ink` bascule avec le theme, la perforation bascule
avec lui, dans le bon sens et sans une ligne de plus : sombre sur ambre vif,
claire sur ambre brule.

Geometrie : dash 5px / gap 4px, ratio 1,25 contre 1,36 dans l'icone
(`stroke-dasharray="7.2 5.3"`). Transposer le ratio exact a cette echelle
donnerait un trait de 0,5px, invisible. On garde la lecture, pas la mesure.

### Le piege desamorce

`popup.html` portait `scrollbar-width: thin` et `scrollbar-color` sur son
`body`. **Depuis Chrome 121, poser l'une de ces deux proprietes sur un
element fait IGNORER a Chromium tous ses `::-webkit-scrollbar-*`.** Ces deux
lignes auraient suffi a annuler tout le travail sur la surface la plus vue.
Elles sont retirees, et remplacees par un bloc reserve a Firefox -- qui n'a
pas les pseudo-elements et recoit la version plate :

```css
@supports not selector(::-webkit-scrollbar) { ... }
```

Chrome comprend `selector(::-webkit-scrollbar)`, donc le bloc ne s'y applique
pas. `manifest.firefox.json` existe : Firefox n'est pas hypothetique.

### Deux jetons qui avaient derive

Les cinq pages recopient leur `:root` en se promettant « memes jetons que
popup.html ». La copie avait deja derive : `--rail` n'existait que dans
popup, `--amber-d` que dans popup et diagnostics. Les deux sont ajoutes
partout, dans les trois blocs de chaque page (sombre, `prefers-color-scheme`,
`[data-theme="light"]`).

Au passage, `color-scheme` est declare sur chaque page : les controles natifs
-- le `textarea` de diagnostics, les `select` -- cessent d'arriver en blanc
sur fond violet.

### Mesure

CSSOM verifie dans Chromium : les huit regles sont parsees et acceptees. Le
rendu n'a PAS pu etre photographie -- ce Chromium headless ne dessine aucune
barre de defilement classique, meme sur un cas minimal sans notre CSS. Le
premier rendu reel sera celui de l'utilisateur. 692 tests.

### Dette assumee

Le bloc est recopie cinq fois, comme les jetons -- et c'est cette duplication
qui les avait fait deriver. Un `theme.css` partage supprimerait les deux
problemes d'un coup ; il n'a pas ete fait ici.

## 2.22.4 -- 2026-09-19

**Le journal accusait l'API d'avoir change de format. C'etait notre minuteur.**

```
gamerpower : echec
{"errors":["JSON illisible : signal is aborted without reason"],"failures":3}
```

L'API n'avait rien change. « signal is aborted without reason » est le motif
que Chrome donne a un abandon : c'est NOTRE delai qui avait coupe la requete.

### Pourquoi le mauvais message gagnait

Les en-tetes arrivent, donc `response.ok` est vrai, donc on entre dans
`response.json()` -- et c'est pendant la lecture du corps que l'abandon
remonte. Chaque source avait deux endroits ou attraper une erreur : le catch
exterieur traduisait correctement l'abandon en « delai depasse », et le catch
interieur, pose autour du seul `json()`, le renommait en probleme de format.
Le plus proche gagnait, et il avait tort.

Le meme piege dormait dans la source GOG, mot pour mot.

### Le correctif

- **`watch/net.js`, une seule fonction pour les deux endroits.** Elle consulte
  d'abord NOTRE signal : si le minuteur a tire, la cause est notre delai,
  quelle que soit la forme prise par l'erreur en remontant. Toutes les
  plateformes ne rejettent pas un abandon avec un `AbortError` -- certaines
  rendent un « Failed to fetch » ordinaire -- et se fier au seul nom de
  l'erreur, c'etait une loterie.
- **« JSON illisible » est conserve pour les vraies erreurs de format.** Deux
  tests ont refuse la premiere version du correctif, qui supprimait le
  libelle partout : elle remplacait un mauvais diagnostic par une absence de
  diagnostic. Ils avaient raison.
- **Vingt secondes au lieu de quinze** pour l'agregateur, comme la source
  Steam. Trois expirations d'affilee ont endormi la source alors qu'une
  relance sept secondes plus tard rendait bien ses vingt offres : le CDN est
  parfois lent, pas casse.
- Les sources Steam et l'import de collection passent par la meme fonction.
  Deux copies d'un meme idiome, c'est ainsi que la premiere avait diverge.

### Mesure

`test/gamerpower.test.mjs` et `test/gog.test.mjs` : l'abandon pendant la
lecture du corps rend « delai depasse », ne mentionne plus le format, et un
abandon dont le nom ne dit rien reste un delai. Une reponse vraiment mal
formee garde son « JSON illisible ». 692 tests.

### Reste ouvert

La source Epic n'a AUCUN delai : pas d'`AbortController`, donc une requete
suspendue le reste jusqu'a la mort du service worker. Elle ne pose pas
probleme aujourd'hui ; c'est la meme famille de defaut, et c'est signale.

## 2.22.3 -- 2026-09-19

**Steam : le clic partait dans le vide -- c'est le formulaire qu'il faut envoyer**

Le journal de l'utilisateur a tranche ce que deux versions n'avaient pas su
voir :

```
10:47:02  steam : clic sur « Add to Account » pour le paquet 1830927
10:47:35  Deadshot (Steam) Giveaway -> failed
          clic fait, mais le paquet n'est pas apparu dans la bibliotheque
```

Le clic partait. Les trois verifications etaient passees : bloc du paquet,
formulaire de licence gratuite, libelle exact. Et rien.

### La cause

Le bouton reel est une ancre dont le href est `javascript:addToCart( 1830927 );`.
Chrome REFUSE une navigation vers une URL « javascript: » demandee depuis un
monde isole -- celui ou `chrome.scripting` execute nos injections par defaut.
`element.click()` ne jette pas, ne previent pas : il ne fait rien.

Le code tenait donc « clic fait » pour un fait accompli, et attribuait
l'echec a Steam. Trois fois d'affilee, jusqu'a reveiller le canari.

### Le correctif

- **Un href « javascript: » : on envoie SON formulaire.** Le meme, deja
  verifie trois fois -- il vise `/freelicense/addfreelicense/` et porte notre
  paquet. Une soumission ne peut donc rien faire d'autre que ce que le bouton
  faisait. `requestSubmit()` plutot que `submit()`, pour que les gestionnaires
  de la page s'executent comme lors d'un vrai envoi.
- **Et seulement a coup sur.** Le href doit etre exactement
  `addToCart(<notre paquet>)`. `addToCart(999)`, `checkout()`, `void(0)` :
  refus, sans rien tenter. On ne devine pas ce qu'un script inconnu allait
  faire.
- **Un bouton a gestionnaire reste clique.** Un clic, lui, traverse les
  mondes. Une voie ou l'autre, jamais les deux : Steam tient un quota
  d'activations ou meme un « deja possede » compte comme un echec.
- **Le jeton de session est verifie et remonte.** S'il manque du formulaire,
  le POST serait refuse en silence ; le journal le dit avant, pas apres.

### Deux echecs qui ne diront plus rien de faux

- **La page tranche avant tout verdict d'echec.** `dynamicstore/userdata` est
  cache cote Steam et peut rester en retard sur une activation qui a bien eu
  lieu. On retourne desormais sur la fiche AVANT de conclure : « You already
  have this item » vaut succes, meme si la bibliotheque n'a rien vu. La
  fenetre de confirmation passe de 5 a 8 relectures.
- **L'echec dit ou la demande a atterri.** Titre et URL de la page d'arrivee :
  quand Steam refuse une licence gratuite, c'est la que le motif est ecrit.

### Mesure

`test/steam-claim.test.mjs` : 28 tests. Nouveaux -- le href mesure et son
formulaire envoye une seule fois, le bouton a gestionnaire toujours clique,
trois « javascript: » inconnus refuses sans rien tenter, le formulaire sans
jeton signale, et la bibliotheque en retard rattrapee par la page. 689 tests.

## 2.22.2 -- 2026-09-19

**Steam : c'est la page qui dit si le compte est connecte, plus le worker**

Retour d'usage : « mon compte Steam est connecte, aucune action ». Le compte
l'etait bel et bien. L'extension, elle, ne l'a jamais verifie la ou c'etait
verifiable.

### La cause

Avant d'ouvrir quoi que ce soit, la recuperation lisait
`store.steampowered.com/dynamicstore/userdata/` depuis le service worker, et
en tirait trois conclusions definitives : listes vides -> « connexion
requise » ; reponse illisible -> echec ; paquet present -> deja acquis.

Les deux premieres etaient des devinettes. Cette lecture depuis un service
worker peut rendre des listes vides ou une reponse inexploitable alors que la
session existe parfaitement dans le navigateur. Et comme elle se faisait
AVANT tout onglet, le resultat etait litteralement rien : pas de page, pas de
clic, pas de trace visible -- a chaque cycle, indefiniment. L'extension
refusait d'aller voir la seule chose capable de repondre.

### Le correctif

- **La lecture de bibliotheque ne bloque plus.** Elle garde son seul pouvoir
  utile : ne rien tenter sur un jeu deja acquis, parce que le quota
  d'activations de Steam compte « deja possede » comme un echec. Vide ou
  illisible, elle note la raison au journal et laisse la suite se faire.
- **La session se lit sur la page.** L'etape injectee cherche d'abord le menu
  de compte ; a defaut, un lien de connexion DANS le menu global -- jamais
  dans la page entiere, ou « /login/ » apparait aussi sur un compte connecte.
  Signe franc de connexion : on continue. Lien de connexion : « connexion
  requise », et aucun clic. Ni l'un ni l'autre : on continue, les trois
  verifications qui suivent (bloc du paquet, formulaire de licence gratuite,
  libelle exact) protegent deja de tout ce qui pourrait couter quelque chose.
- **Une seconde preuve apres le clic.** Si la bibliotheque reste muette
  jusqu'au bout, on revient sur la fiche et on la relit A BLANC : « deja
  possede » vaut succes, un bouton toujours la vaut echec. Si aucune des deux
  ne repond, le verdict est `undetermined` -- ni victoire supposee, ni echec
  declare -- et l'offre repasse apres le recul.

Ce que ce correctif ne tranche toujours pas : si le clic lui-meme aboutit. Il
n'a jamais ete joue depuis ce depot. Mais l'echec, desormais, dit ce qu'il a
vu.

### Mesure

`test/steam-claim.test.mjs` : 25 tests. Nouveaux -- la session lue sur la page
dans ses trois etats (connectee, deconnectee, indeterminee), un lien
« /login/ » hors du menu global qui ne conclut rien, une bibliotheque muette
qui n'empeche plus la recuperation, et les trois issues de la seconde lecture.
685 tests.

## 2.22.1 -- 2026-09-19

**Steam : l'option agit tout de suite, et une fausse offre ne bloque plus les vraies**

Retour d'usage, le jour meme : « pour l'instant rien de reclame ». Deux causes
dans le code, trouvees en relisant le chemin de bout en bout.

- **Activer l'option ne declenchait rien.** Le prochain cycle venait a son
  heure : plusieurs heures sur une journee calme (trois verifications par jour
  au minimum, plus les creneaux de sortie). « Activer quand meme » lance
  desormais la meme verification que « Verifier maintenant ». L'arret
  d'urgence l'emporte toujours : il annule ce cycle comme les autres.
- **Une entree Steam sans paquet prenait le creneau des vraies.** L'agregateur
  voit aussi des cles Steam offertes sur des sites tiers : magasin « steam »,
  mais aucun paquet. Plus urgentes, elles passaient devant, echouaient
  (« paquet Steam inconnu ») et bloquaient la recuperation Steam vingt minutes,
  a chaque nouvel essai, jusqu'a cinq. Le filtre les ecarte maintenant comme un
  magasin sans module : detectees, affichees, a un clic.

Ce que ce correctif ne tranche pas : si l'extension lit bien la session Steam,
et si le clic reussit. Le journal de la veille le dit, offre par offre
(« -> needs_login », « -> failed (page Steam : ...) », « steam : attend son
tour »).

### Mesure

`test/steam-claim.test.mjs` : 22 tests, dont l'entree sans paquet, plus urgente
que la vraie offre, qui ne passe plus devant. Dans un Chrome headless :
« Activer quand meme » puis la verification, sans erreur. 682 tests.

## 2.22.0 -- 2026-09-19

**Steam : recuperer aussi, en option, a vos risques**

Jusqu'ici Steam etait detecte, affiche, mis a un clic -- jamais clique, parce
que son contrat l'interdit. C'est desormais le choix de l'utilisateur : une
option, coupee par defaut, qui ne s'active qu'apres avoir lu ce que dit le
contrat.

### Ce que dit le contrat, verifie le 2026-09-19

- Section 4.C : « You may not use any form of scripts, bots, macros, or other
  non-human-controlled systems ("Automation") to interact with Content and
  Services on Steam in any manner », avec parmi les exemples « Earning rewards
  or progress without genuine user input ».
- Section 4.D : Valve peut restreindre ou fermer le compte pour de
  l'Automation, **sans preavis**.

Le popup le dit avant d'activer quoi que ce soit : cocher « Steam aussi »
ouvre l'avertissement, et la case reste decochee. Seul « Activer quand meme »
ecrit le reglage ; le couper est immediat. Tant que l'option est active, la
ligne Steam des magasins affiche « automatique, a vos risques ».

### Ce qui a ete mesure, et ce qui ne l'a pas ete

Sur la page publique d'une vraie offre en cours (Space Menace, forcee en
anglais par `?l=english`) :

- le bloc d'achat porte le numero du PAQUET
  (`game_area_purchase_section_add_to_cart_1827145`), le meme que
  `best_purchase_option.packageid` dans GetItems ;
- son formulaire vise `/freelicense/addfreelicense/` : une licence gratuite,
  pas une caisse -- ce formulaire ne peut rien faire payer ;
- le bouton dit exactement « Add to Account ».

L'etape injectee a ete jouee A BLANC sur cette page reelle, dans un monde
isole comme le sera celui de l'extension : les trois verifications
concordent, un mauvais paquet est refuse, la page n'a pas bouge.

**Le clic lui-meme n'a jamais ete joue.** Meme sans compte, cliquer sur un vrai
Steam est une action sur un service reel ; elle ne s'est pas faite depuis ce
depot. Le premier vrai clic sera celui de l'extension, chez l'utilisateur, une
fois l'option active. S'il ne donne rien, l'offre passe en echec avec son
motif, et le canari le signale.

### Le parcours -- l'ordre est la securite

1. L'option est RELUE au moment d'agir, pas seulement par l'appelant.
2. La bibliotheque est lue AVANT tout onglet (`dynamicstore/userdata`). Sans
   session : « connexion requise », rien d'ouvert. Paquet ou application deja
   possedes : l'offre est acquise sans rien tenter -- le quota d'activations
   de Steam compte « deja possede » comme un echec.
3. La fiche s'ouvre dans la fenetre reduite habituelle ; l'etape injectee
   verifie le paquet, le formulaire et le libelle, puis clique une fois.
4. La preuve est le paquet dans `rgOwnedPackages`, relue plusieurs fois --
   jamais un texte a l'ecran.

Aucun moteur n'est injecte sur Steam : seule cette fonction touche une page
Steam. La garantie de la 2.9.1, « rien n'est injecte sur une page Steam »,
devient : rien, sauf par la recuperation Steam, et seulement si vous l'avez
activee.

### Le rythme

En plus du plafond horaire commun : une offre Steam par cycle, vingt minutes
d'ecart au moins, six par jour au plus. « Tout recuperer » suit la meme
regle. Les offres gratuites de Steam durent des jours : rien ne presse.

### La source Steam s'active avec l'option

Elle n'etait pas active par defaut, et c'est elle, seule, qui donne le numero
de paquet. L'option l'active a la lecture des reglages : rien n'est recopie
ailleurs.

### Un bug trouve en mesurant

GetItems donne le type **4** au DLC (« Dying Light: The Beast - Discharge
Weapon Pack », offert le jour de la mesure). La source Steam lisait 1 depuis la
2.9 : les vrais DLC passaient pour des jeux, et le filtre « contenu en jeu »
ne les voyait jamais. Corrige, ainsi que dans la collection (2.21.0), qui
avait repris la meme erreur.

### Et au passage

Le pied du popup : depuis le lien « Ma collection » (2.21.0), la phrase d'aide
s'ecrasait sur cinq lignes. Elle a maintenant la sienne.

### Mesure

`test/steam-claim.test.mjs` : 21 tests. Ceux qui comptent : un formulaire qui
ne vise pas la licence gratuite n'est jamais clique ; sans l'option, meme un
appel direct ne fait rien et le cycle n'interroge pas la source Steam ; sans
session, aucun onglet ; un clic sans paquet dans la bibliotheque est un
echec, pas une victoire supposee ; une seule offre Steam par cycle.

Dans un Chrome headless au profil jetable, arret d'urgence tire : l'interrupteur,
l'avertissement, « Annuler », « Activer quand meme », la ligne Steam et la
coupure immediate -- sans aucune erreur dans la console. 681 tests au total.

## 2.21.0 -- 2026-09-19

**Ma collection : ce que vous possedez sur chaque magasin, au meme endroit**

Le registre (2.12.0) fige ce que l'extension RECLAME. Apres des mois de jeux
hebdomadaires, une collection est eparpillee entre quatre launchers, et rien ne
disait ce qu'on possedait deja ailleurs -- ni avant l'extension. Une page
dediee, `collection.html`, ouverte depuis le pied du popup, rassemble les deux.

### Ce que la page fait

- **Elle lit ce que chaque magasin dit que vous possedez**, avec votre
  session, en lecture seule, et seulement quand vous cliquez « Importer » :
  Steam (`dynamicstore/userdata` pour la possession, `GetItems` pour les noms,
  deux adresses que la source Steam lisait deja), GOG
  (`account/getFilteredProducts`), Epic (l'historique de commandes du compte,
  jeux gratuits compris).
- **Elle y ajoute ce que l'extension a reclame** : le registre, Amazon
  compris. La bibliotheque Amazon elle-meme n'est pas lue, et la carte le dit.
- **Une ligne par titre, tous magasins confondus** : recherche, filtre par
  magasin, « seulement en double », genre (jeux par defaut, DLC, tout), tri par
  titre, par date ou par nombre de magasins. Chaque pastille ouvre la fiche du
  jeu ; celle de Steam le lance (`steam://run/`, documente par Valve -- les
  schemas des autres launchers n'ont pas ete verifies, donc pas de bouton).

### Les regles

- **Une importation reussie est une photographie** : elle remplace tout ce
  que le magasin avait, et un jeu rembourse disparait.
- **Une importation ratee n'efface rien.** Session expiree, forme inattendue,
  page 3 ratee sur 5 : la liste precedente reste, et la carte dit de quand elle
  date. Une pagination incomplete ne s'applique jamais.
- **Une forme inattendue est un statut, pas une liste vide**, et chaque
  importation rend un **rapport** : la forme des reponses, jamais leurs valeurs
  -- ni titre, ni prix, ni jeton de pagination. « Copier le rapport » le met
  dans le presse-papiers.
- **Rien ne decide sur la collection.** Deux magasins sont rapproches par le
  titre normalise : un indice pour l'affichage, pas une preuve. Aucune
  reclamation ne la lit ; la brancher sur le filtre (ROADMAP, « possede AVANT
  l'extension ») attend que les importations aient ete mesurees sur de vrais
  comptes.
- **Aucune permission nouvelle** : les hotes lus etaient deja autorises.

### Mesure

**Ce qui est mesure** (2026-09-19, sans session, depuis un vrai Chrome 153) :

- Steam : 200 et des listes vides -- lu comme « non connecte », pas comme une
  bibliotheque vide qui effacerait la precedente.
- GOG : **403**, avec `{"message":"Full authentication is required to access
  this resource."}`. C'est le corps qui tranche : une deconnexion, pas un mur
  anti-robot.
- Epic : l'adresse historique sur `www.epicgames.com` redirige vers
  **`accounts.epicgames.com`**, puis vers la connexion. L'importation vise
  directement ce second hote.
- Un piege du banc d'essai, garde pour la suite : un agent « HeadlessChrome »
  recoit d'Epic un 403 HTML, sans redirection. Le titre de la page part
  desormais dans la note d'erreur.

**Ce qui ne l'est pas : la forme d'une reponse CONNECTEE de GOG et d'Epic.**
Aucun compte n'a ete lu depuis ce depot. La premiere importation le dira ; si
la forme n'est pas celle attendue, la carte affiche « reponse inattendue » et
le rapport dit ce qui a change.

**Verification dans le navigateur.** L'extension chargee dans un Chrome
headless au profil jetable, la page ouverte avec des donnees de test, en
francais et en anglais, en sombre et en clair, a 1280 et a 420 px ; puis
« Tout importer » contre les vrais serveurs, sans session : trois « non
connecte », aucun jeu efface, aucune erreur dans la console. Trois defauts vus
sur les captures, et corriges : une classe CSS partagee avec une cellule du
tableau empilait les pastilles ; « 1 jeux » (les nombres vivent desormais
seuls, sans nom a accorder) ; une option trop longue renvoyait « Tout
importer » a la ligne.

`test/collection.test.mjs` : 26 tests, dont la vraie reponse 403 de GOG. 660
tests au total.

## 2.20.1 -- 2026-09-18

**Une fiche Epic s'ouvre dans une langue que le moteur sait lire**

La 2.20.0 a fait du pays de la boutique un reglage, et la langue du pays est
allee jusque dans l'URL des fiches. Regle sur l'Allemagne, le moteur ouvrait
`/p/<jeu>?lang=de` : une page en allemand, ou aucun de ses motifs ne reconnait
un bouton. Aucun clic, donc aucun danger -- mais plus aucune reclamation non
plus, pour six des quatorze pays proposes (DE, ES, IT, PT, NL, PL).

### La langue de la page n'est plus celle de l'API

- **L'API garde la langue du pays** : titres et descriptions restent dans la
  langue choisie. Le moteur retrouve ses cartes par le slug, jamais par le
  titre -- une API et une page dans deux langues ne se genent donc pas.
- **La page prend la langue du reglage si le moteur la lit, l'anglais sinon**
  (`getEpicPageLang`). Les langues lisibles sont ecrites a un seul endroit,
  `CONFIG.epicReadableLangs` (`fr`, `en`) : ce sont celles que portent les
  motifs de `03-patterns-epic.js`, a chaque etape du parcours.
- Rien ne change pour la France, la Belgique, le Luxembourg et la Suisse
  (`fr`), ni pour les quatre pays anglophones (`en`) : leur URL est exactement
  celle de la 2.20.0.
- **Une langue vide reste vide** : c'est le « laisser Epic choisir » que
  documente `CONFIG`. Sans cette garde, la chaine vide -- absente des langues
  lisibles -- serait devenue `en` en silence.

### Ce qui etait touche, et ce qui ne l'etait pas

- **Touchees : les navigations du moteur lui-meme.** Le retour sur
  `/free-games` (deux endroits de `13-epic-check.js`) et la fiche ouverte quand
  la carte d'un jeu manque (`16-epic-run.js`).
- **Pas touchee : la reclamation autonome.** La veille construit ses propres
  URL de fiche, et elles portent toujours `lang=fr` (`watch/sources/epic.js`),
  une langue que le moteur lit. Ce correctif ne la change pas.

### Ce que ce correctif ne prouve pas

**L'anglais n'a aucune capture dans ce depot.** Les libelles francais viennent
des pages reelles (2026-08-27, 2026-09-17) ; les motifs anglais sont presents a
chaque etape (« Get », « Place Order », « I Agree », « In Library »), mais aucun
n'a ete releve ici sur une vraie fiche. Le repli vers l'anglais repose sur eux.
Si une fiche anglaise fait echouer une reclamation, le canari le signalera,
motif technique compris.

### Mesure

`test/locale.test.mjs` : le test qui promettait `lang=de` dans l'URL d'une
fiche -- le bug, ecrit comme une promesse -- est remplace par quatre :

- regle sur l'Allemagne, la fiche s'ouvre en anglais et l'API reste en
  `de-DE` ;
- pays par pays, aucune fiche ne s'ouvre dans une langue que le moteur ne lit
  pas ;
- une langue vide reste vide ;
- **une langue n'est declaree lisible qu'avec ses libelles, a chaque etape**
  (bouton principal, commande, accord, possession). Ajouter `de` a la liste
  sans ses libelles fait echouer ce test : c'est le garde-fou qui empeche de
  rouvrir le bug.

Chacun a ete verifie contre le defaut qu'il doit attraper. Quatre mutants --
l'URL reprend la langue du pays, `de` declare lisible, garde de la langue vide
retiree, repli sur une langue illisible -- font tous echouer au moins un test.

## 2.20.0 -- 2026-09-18

**Le pays de la boutique devient un reglage, ecrit a un seul endroit**

`locale=fr-FR&country=FR&allowCountries=FR` etait recopie dans
`watch/sources/epic.js` ET dans `src/core/01-config.js`, et le reglage de langue
de l'interface ne touchait ni l'un ni l'autre. Un utilisateur belge, suisse ou
canadien lisait des prix francais.

### Ce que ce reglage fait -- et ce qu'il ne fait pas

- **Il ne concerne qu'Epic**, et c'est une mesure, pas une limite de mise en
  oeuvre : **GOG et GamerPower n'acceptent aucun parametre de pays**. Leurs
  reponses ne changent pas d'un pays a l'autre, et un test le verifie plutot
  que de le promettre. Steam est detecte, jamais reclame.
- Un selecteur de pays dans les reglages, rempli DEPUIS la table des pays --
  une liste recopiee dans le HTML finirait par proposer un pays que la veille
  refuse.
- **Un seul reglage, trois lecteurs, aucune recopie** : le popup l'ecrit sous
  les cles du moteur (`FGC_epic_country`, `FGC_epic_lang`), la veille les relit
  dans le meme espace de stockage, le moteur par `GM_getValue`. Ces deux cles
  rejoignent `ENGINE_KEYS` : la lecture doit etre SYNCHRONE, elle sert a
  construire une URL au moment de l'appel.
- **Un defaut cable des deux cotes** (`FR`/`fr`) : en userscript il n'y a pas de
  popup pour ecrire ces cles, et le moteur doit savoir quoi faire sans
  stockage. Sans reglage, l'URL construite est exactement celle d'avant.
- **La table des pays est close**, et c'est deliberement conservateur :
  accepter un code quelconque obligerait a deviner sa devise, et un montant
  converti dans une devise devinee serait un chiffre invente. Le moteur, lui,
  ne porte pas la table -- il verifie la FORME (deux lettres) et retombe sur le
  defaut, parce que c'est le popup qui borne le choix.

### La devise suit le pays

Un pays reglable ne rend PAS la conversion de la 2.17.0 inutile : Epic sert
bien la devise du compte, mais l'agregateur ne publie que des dollars -- c'est
structurel chez lui, sa structure ne porte meme pas de code de devise.

- La devise visee cesse d'etre l'euro en dur : elle suit le pays choisi
  (`CHF` en Suisse, `CAD` au Canada...), et la table de taux est demandee dans
  cette base.
- **Un changement de pays fait redemander le taux avant l'heure** : une table
  dans l'ancienne base ne sait plus convertir vers la bonne, meme fraiche.
- L'affichage vise la base de la TABLE, pas celle du reglage : afficher une
  devise qu'on n'a pas su calculer serait un chiffre invente. Le decalage dure
  au plus un cycle.

### Mesure

`test/locale.test.mjs` (15 tests), dont une **parite moteur / veille** sur les
quatorze pays proposes -- la meme promesse que `test/epic-parite.test.mjs` pour
les slugs : deux implementations, une seule verite. La duplication ne peut pas
disparaitre (le moteur est en ES5 concatene et tourne aussi en userscript), donc
elle est tenue par un test.

## 2.19.1 -- 2026-09-18

**La prediction ne derive plus d'une heure deux fois par an**

L'histogramme qui apprend « quand regarder » rangeait ses cases en UTC. Un
magasin publie a une heure LOCALE : a chaque changement d'heure, toutes ses
cases glissaient d'une heure.

### Le chiffre qui a decide de la forme du correctif

Le commentaire du module pariait que la decroissance par demi-vie absorberait
ce glissement en quelques semaines. Deux mesures disent le contraire :

- **la demi-fenetre chaude de l'ordonnanceur vaut 30 MINUTES**
  (`hotHalfWindowMs`). Une case qui a glisse d'une heure place l'instant attendu
  a 60 minutes du drop reel : le creneau chaud ne s'ouvre meme pas. La derive
  n'est pas amortie, elle fait manquer la fenetre entierement ;
- **reapprendre demande trois observations** dans la nouvelle case
  (`MIN_OBSERVATIONS`), soit TROIS SEMAINES pour une source hebdomadaire comme
  Epic -- deux fois par an, et la prochaine echeance est le 25 octobre.

### Ce qui change

- **Les cases sont ancrees sur un fuseau NOMME** quand on connait celui de la
  source, en UTC sinon. Le fuseau est porte par l'histogramme lui-meme
  (`stat.zone`) et non par l'appelant : une case rangee dans un fuseau et relue
  dans un autre serait pire que le bug corrige.
- **Deux sources en declarent un, et seulement parce que c'est mesure** : Epic
  (11:00 a New York, la meme mesure que la regle de rotation de la 2.17.0) et
  l'agregateur (`DATE_ZONE`, deja mesure dans sa propre source). GOG et Steam
  n'en declarent pas : leur heure de publication n'a jamais ete mesuree, et
  supposer un fuseau serait ecrire une hypothese non mesuree.
- **Les cases deja apprises sont TRANSPOSEES, pas jetees.** Une transposition
  exacte est impossible -- une case ne garde ni les dates ni les decalages de
  ses observations, seulement un poids et un compteur. La transposition applique
  donc le decalage en vigueur a cet instant : les observations recentes, les
  seules qui pesent encore, atterrissent dans la bonne case ; les plus
  anciennes, faites sous l'autre decalage, se retrouvent a une heure pres --
  elles l'etaient deja, et la demi-vie les efface. C'est strictement mieux que
  rester en UTC (derive permanente) ou repartir de zero (trois semaines).

### Et un second defaut, trouve en mesurant le premier

- **La seconde moitie de toute case apprise n'etait jamais couverte.** Une case
  couvre une heure pleine, mais l'ordonnanceur ne recevait que son DEBUT :
  avec une fenetre de +/- 30 minutes, « jeudi 15 h » ne couvrait que
  14:30-15:30. Chaque case chaude annonce desormais DEUX instants, a l'heure
  pleine et a la demie : la couverture va de 14:30 a 16:00 -- la case entiere,
  plus une avance qui rattrape un drop legerement anticipe.
- Les occurrences passent par `nextOccurrence`, qui itere sur le calendrier
  local : aucune arithmetique en millisecondes ne survit a un jour de 23 heures.

### Mesure

`test/prediction-zone.test.mjs` (12 tests), autour des changements d'heure de
2026. Dont celui qui resume le probleme : le jeudi 29 octobre, entre le
changement europeen (25 octobre) et l'americain (1er novembre), la rotation
d'Epic tombe a **16 h a Paris**, pas 17 h. Une regle ecrite
« 17:00 Europe/Paris » se tromperait ce jour-la ; une case ancree sur New York,
non.

## 2.19.0 -- 2026-09-18

**Une offre GOG peut enfin mourir -- quand GOG l'affirme**

Le bug corrige la veille sur Epic restait ouvert sur GOG. Le balayage par
MAGASIN, livre en 2.17.0, ne s'exerce que pour une source qui fait autorite sur
ce magasin ; GOG etait declaree `completeList: false`, faute d'avoir mesure la
pagination du catalogue. Une offre GOG sans date de fin n'etait donc retiree ni
par expiration (pas de date), ni par disparition (aucune autorite).

### On ne devine pas la pagination : on croit la reponse

- **`completeList` cesse d'etre une promesse STATIQUE de la source pour devenir
  un fait PAR REPONSE.** GOG publie `page` et `totalPages` a la racine de sa
  reponse : il dit lui-meme si elle tient sur une page. Plutot que de deviner
  le nom du parametre de pagination pour aller chercher la suite, la source
  publie `complete`, vrai seulement si `page === 1 && totalPages <= 1`.
- **Le cycle prefere ce fait a la promesse** quand la source en publie un, et
  retombe sur `completeList` sinon. Aucune autre source ne change de
  comportement.
- **Le jour ou GOG annonce plusieurs pages, la veille cesse d'elle-meme d'en
  conclure des disparitions**, ce cycle-la seulement, et le journal l'ecrit.
  C'est cette ligne qui fournira la mesure de pagination que ROADMAP.md
  attendait -- prise en marche, au lieu d'etre attendue.
- Prudent par construction : une reponse qui ne porte pas ces champs, qui n'est
  pas a la page 1, ou qui vient d'une source en panne, n'est PAS declaree
  complete. `totalPages: 0` en revanche l'est : zero page vaut bien une liste
  complete, elle est vide -- c'est la reponse reellement observee le
  2026-09-17. A noter, parce que cela mord : `totalResults` arrive en CHAINE la
  ou `totalGamesFound` est un nombre.

### Et une grace plus fine, qui resserre la 2.17.0

Donner l'autorite a GOG faisait apparaitre un faux positif que
`completeList: false` masquait, et il valait pour Epic aussi :

- **Une entree decouverte par l'agregateur et marquee `store: 'gog'` n'a pas de
  `storeId`** : elle n'est rapprochee que par titre normalise. Si son titre
  differe d'une virgule de celui du catalogue, elle reste une entree DISTINCTE
  -- et un magasin autoritaire la tuerait au deuxieme cycle alors que l'offre
  court toujours. Meme chose pour un giveaway annonce par la seule banniere
  d'accueil, que le catalogue filtre ne porte pas.
- **Le `storeId` decide donc de la grace** : courte (deux constats) quand
  l'entree en porte un -- le magasin l'a publiee sous cette identite, son
  silence veut dire quelque chose ; longue (24 h) quand elle n'est connue que
  par son titre. C'est le cas de l'entree qui a cause le bug de la veille :
  decouverte par l'agregateur, puis fusionnee avec l'entree native d'Epic dont
  elle a herite le `storeId`.

### Mesure

`test/gog-complete.test.mjs` (9 tests) : une reponse annoncant `totalPages: 2`
ne fait mourir personne et le journal le dit ; `totalPages: 1` fait mourir une
offre GOG sans date de fin au deuxieme constat ; une entree connue par titre
seulement y survit. `test/rotation.test.mjs` gagne la contrepartie cote Epic.

## 2.18.0 -- 2026-09-18

**Ce qui est ECRIT sur le bouton decide, pas le selecteur qui l'a trouve**

Tout ce que la 2.15.3 -> 2.16.2 a construit pour Epic -- arret d'urgence,
refus des libelles payants, anti-rafale, un clic = un clic -- vit dans
`robustClick`. Or Luna et l'echange GOG appelaient `el.click()` en direct :
sur ces parcours, le bouton d'arret d'urgence ne bloquait rien.

### Le vrai manque n'etait pas robustClick

- **Le moteur cliquait un bouton Luna sans jamais lire ce qui est ecrit
  dessus.** La fiche d'une offre clique `[data-a-target="buy-box_call-to-action"]`,
  un selecteur d'ATTRIBUT : « buy-box_call-to-action » est le nom d'un
  emplacement, pas d'une action. La liste de motifs n'etait qu'un repli du
  `||`, jamais consultee quand l'attribut avait deja trouve quelque chose. Le
  jour ou Amazon y rend « S'abonner a Luna+ » ou « Acheter 19,99 EUR », rien ne
  l'arretait -- et surtout pas le garde-caisse, qui s'efface sur `amazon.*`
  comme sur `epicgames.com` et `gog.com` (PROVEN_HOSTS, a raison : le parcours
  gratuit de ces trois magasins passe legitimement par un panier a zero).
- **Un libelle payant est desormais refuse partout, quel que soit l'hote.**
  `looksPaid()` refuse en tete de `robustClick` ce qui annonce une depense :
  « Acheter », « Buy », « S'abonner », « Precommander », ou simplement un
  montant suivi d'un symbole monetaire. C'est la derniere ligne, celle qui
  tient meme si un appelant oublie sa liste d'autorisation.
- **Deux listes d'autorisation par libelle**, sur le modele de celle d'Epic :
  `lunaClaimLabelAllowed()` pour les cartes et les fiches Luna,
  `gogSubmitLabelAllowed()` pour `gog.com/redeem`. Un bouton trouve par son
  attribut doit encore DIRE qu'il reclame quelque chose de gratuit.
- **Les variantes non ancrees, pour la troisieme fois.** Le `textContent` d'un
  bouton concatene tous ses descendants : un span de lecteur d'ecran suffit a
  faire echouer un motif en `^...$`. Luna a maintenant ses motifs larges,
  comme Epic depuis la 2.16.1.

### L'arret d'urgence coupe enfin la serie

- Les cinq clics directs passent par `robustClick` -- et **lisent son retour**.
  Brancher sans lire aurait rejoue le bug de la 2.16.0 : un clic refuse
  consommant une etape en silence. Un clic refuse ne fait plus avancer aucun
  compteur, et il se journalise.
- **Le bouton d'arret d'urgence arrete la serie, pas seulement le clic.** Sans
  cela, chaque fiche Luna aurait vu son clic refuse puis aurait navigue vers la
  suivante : une serie qui continue en echouant n'est pas un arret. La file est
  conservee, pour pouvoir reprendre.
- L'etape intermediaire « Complete Claim » ne se declare plus franchie quand
  son clic a ete refuse -- et elle ne se represente pas a chaque battement,
  pour ne pas remplir le journal de refus previsibles.

### Un code GOG ne se brule pas

- **La confirmation `/redeem` est le seul site ou un refus coute quelque
  chose** : un code echange est un code perdu. GOG peut RELABELLISER le bouton
  d'envoi au lieu d'en monter un second -- le repli de `watchGogRedeemOutcome`,
  qui ecarte explicitement `originalSubmit`, dit que le cas a deja ete
  rencontre. La confirmation arrive environ 1,5 s apres l'envoi, donc sous les
  4 s de repos de l'anti-rafale : le clic aurait ete refuse, l'echange aurait
  fini en `timeout`, et le code aurait ete brule pour rien. D'ou
  `{ allowRepeat: true }`, une exception NOMMEE qui ne leve que l'anti-rafale :
  l'arret d'urgence et le refus des libelles payants s'appliquent toujours.
- **Un refus AVANT l'envoi ne brule pas d'essai** : le code n'a pas ete soumis,
  l'essai compte plus haut lui est rendu.

### Mesure

`test/label-guard.test.mjs` (11 tests). Celui qui compte : **un CTA Luna
intitule « Acheter 19,99 EUR » n'est jamais clique** -- il echoue sur le moteur
d'avant. Avec lui : dix offres donnent bien dix clics (l'anti-rafale memorise
par noeud), `allowRepeat` ne leve ni l'arret d'urgence ni le refus des libelles
payants, et un `<input type="submit">` est lu par son `value`.

Ces tests portent sur les points de DECISION (les deux listes d'autorisation et
`robustClick`), pas sur le parcours de page : aucune capture DOM de Luna ni de
`gog.com/redeem` n'existe, et en fabriquer une prouverait surtout que la
fabrication est fidele a elle-meme.

## 2.17.0 -- 2026-09-18

**Les jeux de la semaine derniere s'en vont, et tout s'affiche en euros**

Deux defauts d'interface, signales au lendemain d'une rotation : les jeux
termines la veille a 17 h etaient encore listes dans le popup et encore
annonces, et les montants s'affichaient en dollars sur un compte francais.

### Une offre finie s'en va

- **Une offre SANS date de fin n'avait aucun moyen de mourir.** Le balayage des
  disparitions ne regardait que le champ `source` de l'entree -- or `merge` le
  fige a la premiere source qui l'a vue : un jeu Epic decouvert par
  l'agregateur gardait `source: gamerpower` pour toujours et echappait au
  balayage d'Epic. Il est desormais balaye par MAGASIN quand la source fait
  autorite dessus. L'agregateur, qui couvre plusieurs magasins, ne fait
  autorite sur aucun : son silence ne termine rien.
- **Et la grace passe de 24 h a deux constats** dans ce cas precis. Les 24 h
  couvrent le doute sur une liste tronquee ; quand la source du magasin publie
  une liste complete et jugee credible, ce doute est deja ecarte. Attendre un
  jour de plus, c'etait afficher le vendredi les jeux de jeudi.
- **Les notifications et le badge consultent enfin l'horloge.** L'etat
  « expiree » n'est pose qu'au passage d'un cycle : entre la rotation et le
  cycle suivant, une offre finie pouvait etre ANNONCEE. Le popup, lui,
  filtrait deja sur la date -- d'ou l'ecart entre les deux.
- **Une fin inconnue n'est toujours pas une fin passee** : l'agregateur laisse
  huit offres sur vingt sans date, et les taire serait pire que de les
  montrer. C'est le balayage par magasin qui s'en charge.

### La rotation du jeudi est enfin connue

`watch/schedule/clock.js` avait ete ecrit pour exprimer « tous les jeudis a
telle heure, dans tel fuseau » sans se tromper aux changements d'heure -- et
personne ne l'appelait jamais avec une regle : la cle des calendriers restait
vide. La veille ne connaissait la rotation que si Epic l'annoncait, sinon elle
s'en remettait au plancher de trois interrogations par jour.

- Une regle par defaut est posee pour Epic : **jeudi 11:00 `America/New_York`**.
  C'est le fuseau ou la regle est VRAIE. A Paris cela tombe a 17 h la plus
  grande partie de l'annee -- mais **a 16 h** entre le passage a l'heure d'ete
  americain et l'europeen (mi-mars) et entre les retours a l'heure d'hiver
  (fin octobre). Ecrire « 17:00 Paris » aurait rate l'ouverture d'une heure,
  deux fois par an ; un test tient les quatre dates.
- C'est une heure de REVEIL, pas une verite sur les donnees : elle fait
  regarder a l'heure dite, elle ne fabrique aucune date. Les fenetres
  annoncees par Epic restent prioritaires, et une liste vide posee par
  l'utilisateur reste un choix respecte.

### Un jeu remis en promotion redevient visible

`markExpired` saute les etats terminaux et `merge` conservait l'etat : un jeu
repropose sur le meme identifiant restait invisible pour toujours. Il revient
desormais, sauf s'il a deja ete reclame -- celui-la reste terminal, le
reproposer ferait rouvrir un onglet sur un compte reel.

Au passage, un defaut que ce cas a revele : **une source ne pouvait pas
corriger sa propre date de fin.** A egalite de fiabilite, l'ancienne valeur
gagnait toujours. Cette stabilite existe pour rendre la fusion commutative
entre sources DIFFERENTES ; deux lectures de la meme source ne posent pas
cette question -- la seconde est plus recente. Un jeu remis en promotion
gardait sinon la date de la promotion precedente.

### Tout s'affiche en euros

Mesure d'abord : **Epic nous rend deja des euros** et nous lisons le bon champ
-- la fixture reelle porte `currencyCode: EUR` et `23,99 €`. Le dollar venait
d'ailleurs.

- **Le prix du magasin bat celui de l'agregateur.** `worth` n'etait arbitre par
  aucune table de fiabilite : pour un jeu Epic vu par les deux sources, le
  montant affiche dependait de l'ordre de passage. Le meme jeu valait
  « 23,99 € » ou « $19.99 » selon le jour. Cette seule correction supprime la
  plupart des dollars.
- **Ce qui reste est converti a l'AFFICHAGE**, avec le taux de reference de la
  Banque centrale europeenne, rafraichi une fois par jour. La donnee stockee
  ne bouge pas : le jour ou le taux change, il n'y a rien a reecrire, et la
  verite de la source reste lisible.
- **Un montant converti le dit** : il porte le signe « environ » et, en
  infobulle, son montant d'origine avec la date du taux.
- **Sans taux utilisable, le montant d'origine est rendu intact.** Pas de taux,
  taux trop vieux, devise que la BCE ne publie pas : on affiche des dollars
  plutot que des euros faux. Une panne de taux ne fait jamais echouer un cycle.
- **Le curseur de seuil parle euros.** Il parlait la devise majoritaire des
  offres : vingt offres de l'agregateur contre une ou deux d'Epic, et une
  interface francaise affichait « Ne recuperer qu'au-dessus de $15.00 ».
  A savoir et assume : la comparaison, elle, se fait toujours dans la devise de
  chaque offre. Pour une valeur indicative l'ordre de grandeur suffit ;
  convertir dans le filtre ferait entrer un taux dans un module pur.

29 tests de plus (`test/rotation.test.mjs`, `test/rates.test.mjs`).

## 2.16.2 -- 2026-09-17

**La reclamation passe ; le journal arrete de crier**

La 2.16.1 fait aboutir la reclamation. Restait ce que Chrome affichait dans
`chrome://extensions` : des « erreurs » qui n'en sont pas. Chrome compte tout
`console.warn` d'un script de contenu comme une erreur, et deux lignes du
moteur sont ecrites en fonctionnement NORMAL.

- **« Clic ignore : ... a deja ete clique N fois » passe en info.** Un reclic
  refuse est l'anti-rafale qui fait son travail, pas une anomalie.
- **« findActionElement(...) : aucun element visible ne correspond » passe en
  info.** Ce message est emis PENDANT une attente, tant que le bouton n'est
  pas apparu : c'est un temoin de recherche. L'echec, lui, reste journalise
  quand l'attente expire, avec les libelles reellement visibles.
- **Et surtout, la tentative inutile disparait.** Le garde-fou de la
  sentinelle ne couvrait que « meme libelle ET meme ecran ». Or l'ecran bouge
  souvent juste apres un clic -- une modale s'ouvre : la sonde repassait a la
  seconde suivante, retrouvait le meme bouton et se faisait refuser. La
  sentinelle respecte desormais en amont le meme delai de repos que
  `robustClick`, donc elle ne propose plus un clic dont elle sait qu'il sera
  refuse. Le filet de securite, lui, reste consulte : ne pas cliquer n'est pas
  une raison de ne pas voir un ecran bloque.

Les avertissements qui restent en signalent de vrais : plafond d'actions
atteint, modale empilee, ecran fige, defi de securite, confirmation absente.

Deux tests de plus : cinq passes apres un clic ne produisent aucune tentative
supplementaire, et le frein reste bien un DELAI -- passe le repos, un second
essai reste possible, parce qu'un premier clic peut n'avoir pas pris.

## 2.16.1 -- 2026-09-17

**Ce qu'un humain ne peut pas cliquer, le moteur ne le clique pas**

La 2.16.0 a rendu la sentinelle durable, et son journal a livre le defaut
suivant du premier coup. Capture du 2026-09-17T22:29, frame d'achat :

```
Action 4/6 : clic sur "Ajouter a la bibliotheque".
Ecran avant : Ajouter a la bibliotheque | Annuler | J'accepte #3
Apres "Ajouter a la bibliotheque" : ecran change -> ... #4
Action 5/6 : clic sur "Ajouter a la bibliotheque".  Ecran avant : ... #4
Action 6/6 : ...   Plafond de 6 actions atteint. Dernier ecran : ... #6
```

« J'accepte » etait a l'ecran -- il est dans la ligne -- et la sentinelle
cliquait le bouton de la page DERRIERE la modale.

- **Le bouton se cherche desormais dans la modale du dessus**, jamais
  derriere. `findActionElement` rend le premier candidat dans l'ordre du DOM :
  le bouton de la page vient avant celui de la modale, donc l'ordre du
  document gagnait, et l'ordre des motifs ne servait a rien. Une modale
  ouverte capture l'interaction : ce qui est dessous est hors de portee d'un
  humain, donc hors de portee du moteur.
- **Pas de repli vers le document quand une modale est ouverte.** Si la modale
  ne porte aucun bouton autorise, on attend. C'est ce repli qui a empile six
  modales : chaque clic sur le bouton du dessous en rouvrait une.
- **La signature d'ecran ne compte plus les dialogues.** Elle portait le
  nombre de modales ouvertes : chaque empilement faisait passer un ecran
  identique pour un ecran NEUF, le frein « deja clique, ecran inchange » ne se
  declenchait jamais, et les six actions y passaient. Elle porte maintenant
  sur la modale du dessus -- ses libelles et la taille de son texte -- donc
  deux modales identiques empilees rendent la meme signature.
- **Un empilement se dit.** Quand le nombre de modales visibles augmente apres
  un clic, une ligne unique le signale : c'est le symptome d'un bouton atteint
  hors de la modale du dessus.

Rien d'autre ne bouge : la liste des boutons autorises, le comptage des
actions reelles, le plafond, le filet et l'aiguillage des frames sont
inchanges. C'est un correctif de CIBLAGE, pas de politique.

Cinq tests de plus, dont quatre echouent sur la 2.16.0 : le bouton du dessous
ne recoit rien meme apres vingt passes, une modale sans bouton autorise ne
fait rien cliquer, et deux modales empilees rendent la meme signature. Le
cinquieme verifie que le parcours sans modale, lui, n'a pas bouge.

## 2.16.0 -- 2026-09-17

**Ce qui surveille un achat vit aussi longtemps que l'achat**

Quatrieme retour sur le meme ecran : la modale « Informations sur le droit de
retractation » reste affichee, son bouton « J'accepte » n'est jamais clique.
Les trois versions precedentes ont elargi des motifs de libelles. Cette fois la
console a tranche, et le probleme etait ailleurs. Capture du 2026-09-17 dans
l'iframe `store.epicgames.com/purchase`, jeu « MindCop » :

```
27.068  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
28.574  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
30.083  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
30.084  Clic ignore : "Ajouter a la bibliotheque" a deja ete clique 1 fois.
```

Trois defauts en quatre lignes, et la modale arrive apres.

- **La boucle comptait des PASSES, pas des actions.** Elle rappelait l'etape
  suivante sans regarder ce que `robustClick` avait rendu : les deux clics
  REFUSES par l'anti-rafale ont quand meme consomme deux etapes sur trois.
- **Elle ne regardait jamais si l'ecran avait change.** Meme recherche, meme
  noeud, meme clic -- le bouton « Ajouter a la bibliotheque » etait encore la,
  elle le reprenait pour un nouvel ecran.
- **Elle etait mortelle.** A la troisieme etape le module rendait la main pour
  de bon, environ trente secondes apres le chargement de l'iframe. La modale de
  retractation s'affiche apres. Dans une sous-iframe, rien d'autre ne tourne :
  le guetteur de modales s'y interdisait lui-meme, et le cadre du dessus ne
  voit pas le contenu d'une iframe. Personne n'a jamais clique « J'accepte ».

Ce qui remplace tout ca :

- **Une sentinelle, pas une boucle.** La frame d'achat est surveillee par une
  fonction de passe idempotente, appelee par le guetteur qui existait deja --
  pas un second minuteur. Elle vit tant que la frame montre ou change quelque
  chose, avec le meme plafond dur de dix minutes.
- **Une signature d'ecran** (les libelles visibles et le nombre de dialogues)
  repond a la question que le module ne se posait pas : est-ce que quelque
  chose a change depuis mon clic ? Tant que non, on attend -- une seule
  seconde chance apres douze secondes, parce qu'un premier clic peut n'avoir
  pas pris.
- **Seules les actions REELLES comptent.** Un clic refuse par l'anti-rafale ne
  consomme plus rien. Plafond : six actions par frame, la ou le parcours du
  prestataire en demande quatre.
- **La liste des boutons autorises n'a pas bouge d'un caractere.** C'est elle,
  et non l'adresse de l'iframe, qui borne le risque (regle de la 2.15.1) :
  dans une sous-iframe autre que celle du prestataire, « Valider la commande »
  reste interdite. Deux tests le figent, dont un qui verifie que la MEME page
  est bien commandee dans la frame du prestataire -- sinon le premier ne
  prouverait rien.
- **Le cadre du dessus attend la sentinelle** au lieu d'echouer sur un budget
  fixe de trente secondes, tant que sa fenetre d'achat est a l'ecran (plafond
  150 s, l'onglet pilote en a 300 en tout).
- **Il ne detruit plus une commande en cours.** `processNext` cherchait la
  carte du jeu suivant 1,5 s puis naviguait : sur une fiche avec la fenetre
  d'achat ouverte, cela emportait la modale et la commande avec la page. Le
  passage au jeu suivant attend desormais la fermeture de la fenetre.
- **Une modale qui attend se VOIT** : au bout de trente secondes sans
  changement d'ecran, une notification nomme le bouton a cliquer. Rien n'est
  jamais enregistre comme « recupere » dans ce cas.
- **L'arret d'urgence protege enfin la frame d'achat.** `gm-shim.js` ne
  prechargeait le stockage que dans l'iframe du prestataire :
  `FGC_kill_switch` y rendait toujours sa valeur par defaut, donc le bouton
  d'arret ne pouvait pas bloquer un clic dans la frame ou le moteur clique le
  plus. Aligne sur `02-frames.js`.
- **Les hotes Epic sont elargis** a `*.epicgames.com` dans les deux manifestes
  et dans l'en-tete userscript. Aujourd'hui l'iframe d'achat est sur
  `store.epicgames.com` ; le jour ou Epic la sert d'ailleurs, le moteur n'y
  existerait pas et aucune ligne ne le dirait.
- **Deux silences supprimes** : le repli « niveau document » sur le bouton
  d'accord ne se declenchait que quand une modale avait deja ete reconnue,
  c'est-a-dire quand on n'en avait pas besoin ; et le temoin qui signale une
  modale sans bouton reconnu, global et jamais remis a zero, taisait tous les
  incidents apres le premier de la page.
- La garde contre deux executions concurrentes passe de 2 a 5 minutes : une
  reclamation peut desormais durer plus de deux minutes, et la garde se serait
  perimee au milieu -- le correctif aurait fabrique le bug qu'il corrige.

Note : une fenetre restee ouverte est desormais journalisee comme un echec de
parcours, donc comptee par le canari de selecteurs. C'est voulu -- une modale
que le moteur ne sait plus franchir EST une panne de parcours.

Quatorze tests (`test/epic-payment-frame.test.mjs`), dont celui qui reproduit
exactement le 2026-09-17 : un premier ecran, vingt passes sans effet, puis la
modale qui arrive tard -- et « J'accepte » qui est clique. Il echoue sur le
moteur de la 2.15.3.

## 2.15.3 -- 2026-09-17

**Un clic, c'est un clic**

La 2.15.2 a rendu les boutons trouvables ; celle-ci corrige ce qu'on en
faisait. Symptome rapporte le meme jour : la fenetre d'achat s'ouvre puis
reste figee, et l'utilisateur voit passer plusieurs clics la ou un seul est
demande -- un pour ouvrir la fenetre, un pour confirmer.

- **Chaque appel de clic en envoyait deux.** `robustClick` dispatchait un
  evenement `click` PUIS appelait `el.click()`, qui en dispatche un second :
  deux activations pour un seul appel, sur un bouton qui n'en attend qu'une.
  Le premier ouvre la fenetre d'achat, le second retombe dedans pendant son
  ouverture. `el.click()` n'est plus qu'un repli, quand le dispatch echoue.
  Les evenements de pointeur portent desormais `pointerId`, `isPrimary` et
  `button`, que certains gestionnaires exigent pour ne pas les ignorer.
- **Plus de rafale sur le meme bouton.** Le guetteur des modales repasse
  toutes les secondes et l'attente de confirmation toutes les 500 ms : tant
  que la modale restait affichee, le meme « J'accepte » recevait un clic par
  passage. La 2.15.2 avait borne le MESSAGE ecrit dans la console, pas le
  clic. Un bouton deja clique est desormais laisse tranquille (4 s de repos,
  3 clics au plus), et les modales ne sont recliquees qu'au bout de 5 s.
- **Une nouvelle tentative ne reclique plus par-dessus la fenetre ouverte.**
  Apres un echec, `withRetry` relance la reclamation depuis le debut ; si la
  fenetre d'achat est deja la, le moteur attend sa confirmation au lieu de
  recliquer « Obtenir » dessous. Meme regle dans le parcours panier, ou deux
  clics partaient dans le meme tour de boucle -- vu de la page, un double-clic.
- **La veille des modales ne s'arrete plus au milieu d'un achat.** Bornee a
  trois minutes depuis le debut de la reclamation, elle expirait parfois juste
  avant la popup a fermer. Elle se prolonge tant que la fenetre d'achat est
  ouverte, avec un plafond dur de dix minutes.
- **Les libelles sont normalises avant comparaison.** Epic ecrit ses libelles
  francais avec des espaces insecables et repartit le texte sur plusieurs
  descendants : un motif ancre echouait sur un blanc que `trim()` ne voit pas.
- L'etape « Passer commande » exige un bouton ACTIF : cliquer un bouton grise
  ne faisait que consommer le clic unique auquel la page a droit.

## 2.15.2 -- 2026-09-17

**L'accord de retractation : le meme piege, au troisieme endroit**

Le clic « Ajouter a la bibliotheque » passe depuis la 2.15.1. C'est la modale
suivante -- « Informations sur le droit de retractation » -- qui arrete le
parcours.

- Le guetteur de modales du cadre principal cherchait le bouton d'accord avec
  des motifs ANCRES en `^...$`, exactement comme l'iframe de paiement avant la
  2.14.1 et la fiche produit avant la 2.13.2. Le textContent d'un bouton Epic
  concatene tous ses descendants : un span suffit a faire echouer le motif.
  Troisieme endroit, meme cause, meme correctif -- avec en plus un repli au
  niveau du document, le conteneur deduit du titre ne contenant pas forcement
  les boutons selon la facon dont Epic imbrique sa modale.
- **Une modale vue sans bouton reconnu se disait enfin.** Le code ne faisait
  rien du tout dans ce cas : le parcours s'arretait, et aucune ligne n'en
  donnait la raison. Il ecrit desormais les libelles reellement visibles -- une
  fois, pas a chaque seconde de la veille de trois minutes.
- Le module d'iframe fait de meme quand il ne trouve pas son bouton : « aucun
  bouton trouve » n'apprend pas quels boutons ETAIENT la, et c'est exactement
  ce qui manque quand Epic change sa modale.

## 2.15.1 -- 2026-09-17

**La commande gratuite Epic ne passe pas par le prestataire de paiement**

Le correctif de la 2.15.0 ne pouvait pas marcher, et voici pourquoi : le module
qu'il corrigeait ne demarrait jamais.

- `02-frames.js` n'autorisait le moteur que dans la sous-iframe
  `payment-website-pci`. Or **un total a zero n'a pas d'etape carte bancaire** :
  la commande gratuite se termine ailleurs. Le module de paiement ne tournait
  donc pas, la fiche attendait trente secondes une confirmation que personne
  n'allait produire, et le bouton « Ajouter a la bibliotheque » restait a
  l'ecran -- exactement ce que montre la capture.
- Le moteur accepte desormais **toutes les sous-iframes d'Epic**. On ne devine
  pas l'adresse de la bonne : elle n'a pas ete mesuree, et deux versions ont
  deja ete perdues a supposer.
- **C'est ce qu'il a le droit d'y CLIQUER qui borne le risque**, pas l'adresse.
  Dans une sous-iframe autre que celle du prestataire, la liste se reduit a
  « Ajouter a la bibliotheque » puis « J'accepte ». « Valider la commande » en
  est exclue : le premier ne peut pas depenser d'argent, le second si, et ces
  iframes-la n'ont pas ete mesurees une par une -- un panier payant en ouvre
  aussi. Un test le fige.
- Et l'echec porte enfin son diagnostic : **l'inventaire des iframes** de la
  fiche est ecrit au journal quand la confirmation n'arrive pas. Une ligne
  comme celle-ci aurait dementi la supposition du premier coup, au lieu de deux
  versions plus tard.

## 2.15.0 -- 2026-09-17

**GOG a enfin sa propre source**

Jusqu'ici, GOG n'etait vu que par l'agregateur tiers. Sa disparition est le
premier risque du design, et elle aurait rendu la veille aveugle sur un des
trois magasins que l'extension sait reclamer.

- La source lit le catalogue filtre par prix, en JSON :
  `/games/ajax/filtered?mediaType=game&price=free`. Mesure du 2026-09-17 : 200,
  `application/json`, cles `products` / `page` / `totalPages` / `totalResults`.
- **Le controle qui a evite un piege.** La requete filtree rend une liste VIDE.
  Deux lectures opposees : aucun jeu gratuit en ce moment, ou endpoint
  desaffecte qui rendra vide pour toujours. La meme requete SANS le filtre rend
  7 591 octets de vrais produits -- l'endpoint est vivant, et le vide dit vrai.
  La seconde lecture aurait ete le piege parfait : une source qui repond
  « rien » eternellement SANS JAMAIS ECHOUER, donc sans declencher ni le
  canari, ni le recul, ni la sentinelle.
- Le JSON plutot que la page : un schema change quand le service change, une
  classe CSS change quand un designer passe. Et la page d'accueil pese 953 Ko
  contre quelques-uns ici.
- La distinction d'Epic, transposee : `baseAmount > 0` et `finalAmount === 0`,
  c'est un jeu payant offert un temps ; `baseAmount === 0`, c'est gratuit de
  toute facon et il n'y a rien a reclamer. La valeur porte sa devise, jamais un
  nombre nu.
- La fin de promotion est lue en SECONDES (`salesVisibility.to`). Lue en
  millisecondes, une offre qui se termine dans trois jours paraitrait expiree
  depuis 1970.
- La lecture est ANONYME. Connecte, GOG masque ce que le compte possede deja :
  la veille verrait une offre disparaitre parce qu'elle a ete reclamee.
- La liste est declaree INCOMPLETE : la source ne lit que la premiere page, et
  le parametre de pagination n'a pas ete mesure. Une offre qui s'attarde coute
  moins cher qu'une offre enterree a tort.
- La source s'active chez ceux qui ont deja des reglages enregistres, faute de
  quoi elle ne tournerait que sur les nouvelles installations. Defendable tant
  que la liste des sources n'est editable nulle part -- le jour ou elle le
  devient, ce rattrapage doit disparaitre.

**Ce qu'elle ne voit pas, et c'est dit**

Un giveaway GOG s'annonce aussi par une banniere sur la page d'accueil. Aucun
giveaway ne tournait au moment de la mesure -- ni element de classe
`giveaway`, ni structure de donnees du meme nom -- donc son balisage n'a PAS pu
etre observe. Ecrire des selecteurs sans les avoir vus est precisement ce que
la feuille de route interdit. Si un giveaway apparait sans passer par ce
catalogue, l'agregateur le verra, et le journal dira lequel des deux a parle.

## 2.14.1 -- 2026-09-17

**L'acquisition Epic s'arretait sur la derniere etape**

Constate sur « Mindcop » : l'iframe de paiement s'ouvrait, affichait « Ajouter
a la bibliotheque », et plus rien ne se passait jusqu'a l'expiration des trente
secondes. Le jeu n'etait pas recupere.

- **Le repli non ancre manquait dans l'iframe.** Le textContent d'un bouton
  Epic concatene tous ses descendants : un span de lecteur d'ecran suffit a
  faire echouer un motif en `^...$`. C'est exactement le piege corrige en
  2.13.2 sur la fiche produit -- et le correctif n'avait jamais ete applique au
  module de paiement, qui n'essayait que les motifs ancres. Il essaie desormais
  les deux, et prefere le libelle le plus court : le vrai bouton, pas un
  conteneur qui l'embarque.
- **Le module abandonnait avant la fin.** Apres un clic, il ne continuait que
  si le bouton clique etait un « J'accepte » -- il supposait donc que l'accord
  precedait la commande. La capture montre l'inverse : « Ajouter a la
  bibliotheque » d'abord, puis la modale « droit de retractation ». Le module
  s'arretait juste avant la derniere etape. Il enchaine maintenant, borne a
  trois tours, et s'arrete de lui-meme quand aucun bouton connu n'apparait
  plus.
- **Douze secondes etaient un pari.** L'iframe abandonnait la recherche a 12 s
  alors que la fiche, au-dessus, patientait encore dix-huit secondes pour rien.
  La premiere etape dispose desormais du meme budget que la confirmation
  qu'elle doit produire ; les suivantes restent breves, une modale qui suit un
  clic apparaissant tout de suite ou pas du tout.
- **La console ne deborde plus.** L'avertissement « aucun element visible ne
  correspond » etait emis depuis l'interieur d'une attente qui sonde toutes les
  300 ms : un echec de douze secondes ecrivait quarante lignes identiques, et
  la ligne utile -- celle qui NOMME les boutons vus -- se perdait au milieu.
  Une fois par libelle et par tranche de cinq secondes.
- Le message d'echec de la fiche ne promet plus de chercher « Ajouter a la
  bibliotheque » dans une liste qui ne le contient pas : il nomme ce qu'il
  cherche vraiment.

Deux tests figent la cause : le motif ancre DOIT echouer sur le libelle avec
span, et le repli DOIT le rattraper -- sans attraper « Ne pas accepter ».

## 2.14.0 -- 2026-09-17

Deux choses etaient affichees a cote de la verite sur un compte francais. Le
reste de cette version rend visible ce que la veille faisait sans le dire.

**Les montants gardent leur devise**

- `money()` collait un « $ » sur tous les montants, au motif -- ecrit dans le
  code -- que les sources publient des dollars. C'est faux pour celle qui
  compte : Epic publie le prix DU COMPTE, « 23,99 EUR » avec son currencyCode a
  cote. Le bilan lisait donc vingt-quatre dollars la ou il y a vingt-quatre
  euros, et rien sur le chiffre seul ne permettait de s'en apercevoir.
- La devise se lit desormais dans le montant lui-meme, et les totaux sont tenus
  PAR DEVISE, jamais additionnes entre eux : une somme d'euros et de dollars ne
  designe rien, et convertir demanderait un taux que personne ici ne peut
  verifier. Une devise illisible s'affiche sans symbole plutot qu'avec le
  mauvais.
- Steam composait « $ » + les centimes ; il prend maintenant la forme deja
  formatee par le magasin. Epic reconstruit son repli avec le currencyCode, au
  lieu d'un nombre nu que quelqu'un devrait plus tard supposer en dollars.
- Le tri par valeur faisait un `parseFloat` apres avoir retire tout sauf les
  chiffres et les points : « 23,99 EUR » devenait 2399, et la moins chere des
  offres francaises se rangeait avant la plus chere.
- Le bilan et l'export lisent enfin le registre, ecrit pour ca : passe la purge
  du catalogue -- trente jours -- les vieilles reclamations sortaient sans titre
  et sans prix, c'est-a-dire au moment ou l'un et l'autre servent le plus.
  L'export CSV gagne une colonne devise.

**Le jour s'ecrit en francais**

- `readableDelay` ecrivait « 2 d 4 h » en dur, dans une interface francaise
  partout ailleurs. Les trois unites passent par les tables : « 2 j 4 h ».
- Quand l'interface du navigateur n'est ni anglaise ni francaise, les langues
  declarees par le lecteur sont consultees avant de retomber sur l'anglais. Une
  interface livree reste prioritaire : c'est le signal le plus delibere.

**Le journal de la veille survit a la nuit**

- `record()` ecrivait dans la console du service worker, et un service worker
  s'arrete apres trente secondes d'inactivite en emportant sa console. Le seul
  endroit ou l'on pouvait lire ce qui s'etait passe a 4 h du matin etait efface
  avant le reveil. C'est ce qui a rendu la 2.13.4 si difficile a trouver.
- 500 entrees persistees, un seul ecrivain -- le service worker -- et une borne
  imposee a l'ecriture : un journal sans fin remplirait le quota, et c'est
  alors le CATALOGUE qui ne pourrait plus s'ecrire. Les Error sont reduites en
  texte avant d'etre stockees : passees telles quelles, elles arrivent sous la
  forme `{}`, sans que rien ne le signale.
- `journal.html` le lit, le filtre -- « alertes » montre aussi les erreurs,
  sinon la lecture de la nuit est fausse -- et le telecharge dans l'ordre ou
  les choses se sont produites, a joindre a un rapport de bug.

**Le canari : un magasin qui a bouge le dit**

- Quatre des six dernieres versions corrigeaient un libelle ou un selecteur qui
  avait change sous nos pieds. A chaque fois la reclamation echouait, le recul
  espacait poliment les tentatives, et personne n'apprenait rien avant de
  constater qu'un jeu manquait.
- Deux echecs de selecteur d'affilee sur un magasin qui a deja reussi levent
  une alerte, visible en tete des magasins, avec le motif technique recopie tel
  quel -- c'est lui qui nomme le bouton manquant. Trois echecs pour un magasin
  qui n'a jamais rien reclame : il peut simplement n'avoir jamais ete essaye.
- Le classement se fait par elimination : un echec dont le motif n'est pas l'un
  des NOTRES parle du magasin. Reconnaitre la forme d'un echec de selecteur
  aurait rate les trois derniers, chacun pour une raison differente.
- Le canari ne clique nulle part et n'ouvre aucun onglet. Un succes eteint
  l'alerte tout seul.

**Ne plus ouvrir d'onglet pour un jeu deja acquis**

- Le registre savait ce qui avait ete reclame ; le filtre ne le lui demandait
  pas. Une offre qui revient sous une autre cle faisait rouvrir un onglet et
  consommait un jeton du plafond horaire -- la ressource qui protege le compte
  -- pour un jeu deja possede.
- Le magasin fait partie de la cle : posseder un titre sur Epic ne le donne pas
  sur GOG, et la copie GOG vaut d'etre prise.

**Les codes en attente survivent a une desinstallation**

- Reglage, coupe par defaut : la zone de synchronisation traverse le compte du
  navigateur, et y poser les codes de quelqu'un sans le lui demander serait
  prendre une decision a sa place.
- Les codes seuls y vont. Au-dela de 8 Ko par element, `set()` ne tronque pas :
  il rejette, et rien ne serait sauvegarde. Le lot est donc coupe ici, par les
  plus ANCIENS -- la queue de la liste est ce qui vient d'arriver et n'a pas
  encore ete echange.
- La restauration fusionne, jamais ne remplace : ecraser la liste locale
  effacerait les codes recoltes depuis la derniere synchronisation.

**Lire du HTML sans DOM**

- `watch/offscreen.js` ouvre enfin la voie mesuree en aout et jamais branchee :
  un document invisible lit une page et rend des extraits bruts, laissant a
  chaque source le soin d'en faire des offres dans une fonction pure. Un seul
  document a la fois, ferme systematiquement, absent sur Firefox et declare
  comme tel.
- La page de diagnostic gagne la mesure qui debloque les deux dernieres entrees
  de la feuille de route : ce que la page d'accueil GOG expose reellement, et
  si `gaming.amazon.com` sert encore quelque chose. On mesure les selecteurs au
  lieu de les deviner.

**Ailleurs**

- `ROADMAP.md` : ce qui n'est pas encore fait, pourquoi, et ce qu'il faut
  mesurer avant d'ecrire.
- Integration continue : `npm run check` tourne a chaque push. La
  reconstruction du moteur comparee au bit pres est exactement le controle
  qu'une relecture de diff ne peut pas faire.
- 486 tests. Le moteur n'a pas bouge : la reference figee de la 2.13.4 est
  toujours reconstruite a l'identique.

## 2.13.4 -- 2026-09-16

**La veille de fond tourne enfin, et plus d'erreurs dans chrome://extensions**

- **La veille ne tournait jamais.** `alarms.create` recevait une propriete
  `persistAcrossSessions` qui n'existe pas dans l'API : Chrome rejette l'appel
  entier. Aucune alarme n'etait posee, la planification echouait a chaque
  demarrage du service worker, et meme « Verifier maintenant » plantait avant
  de lancer le cycle. Les tests ne pouvaient pas le voir : le faux `chrome`
  accepte n'importe quelle propriete. Constate en chargeant l'extension dans
  Chromium ; apres correction, les deux alarmes sont bien posees.
- **Firefox : le moteur ne demarrait jamais.** Il attendait l'evenement `load`
  sans verifier qu'il etait deja passe, or Firefox injecte les scripts
  `document_idle` une fois la page chargee : l'ecouteur arrivait trop tard.
  Ni bouton, ni reponse a la veille. Mesure sous Firefox avec l'extension
  temporaire : 0 demarrage sur 3 avant, 3 sur 3 apres. Chromium injecte en
  pratique avant `load` (16 sur 16 dans les deux versions), mais ne le
  garantit pas : la correction vaut aussi pour lui.
- **Defi de securite Cloudflare reconnu.** Sa page 403 « Un instant... » cache
  l'iframe Turnstile dans un shadow root ferme : `querySelectorAll('iframe')`
  ne la voyait pas, et le moteur epuisait cinq tentatives avant de finir en
  « page non chargee ». Le script d'orchestration de la page de defi suffit a
  la reconnaitre ; ni le script de detection que Cloudflare pose sur les pages
  saines, ni le widget Turnstile du formulaire GOG /redeem ne declenchent. Le
  moteur s'arrete aussitot, et la veille rend l'onglet a l'utilisateur.
- **Un defi de securite n'empile plus les onglets.** Comme une reconnexion, il
  echappait au recul : chaque cycle rouvrait un onglet pour la meme offre et
  le laissait dans la fenetre de l'utilisateur (deux a une minute d'intervalle
  pendant les essais). Il recule desormais -- 15 min, 1 h, 4 h, puis 12 h --
  sans jamais etre abandonne ; « Reessayer maintenant » efface le recul. Les
  reconnexions (`needs_login`, `needs_link`) gardent leur regle.
- Service worker : les promesses lancees par les ecouteurs (planification,
  cycle, notification, ouverture d'onglet) ont toutes leur `catch`. Un echec
  ne devient plus une « Uncaught (in promise) », et le popup recoit toujours
  une reponse au lieu d'attendre indefiniment.
- Passerelle GM : les callbacks (`GM_xmlhttpRequest`, prechargement du
  stockage) lisaient la reponse sans consommer `runtime.lastError` ; un
  service worker muet laissait « Unchecked runtime.lastError » dans la console
  des pages de magasin (reproduit avec un temoin).
- Les URL publiees par les sources (page, redirection, vignette) doivent etre
  en http(s) : un `javascript:` venu d'une API tierce n'atteint plus
  `tabs.create`.
- Popup : Entree sur un bouton n'ouvre plus en plus le premier jeu ; la copie
  d'un code refusee par le navigateur n'affiche plus « copie » ; l'import
  ignore des reglages qui ne sont pas des objets ; les prochaines sorties
  n'affichent plus d'ouvertures deja passees ; l'invite de sauvegarde suit la
  langue choisie.

## 2.13.3 -- 2026-08-27

**Les fenetres de reclamation ne restent plus ouvertes**

- La fermeture ne visait que NOTRE onglet. Des qu'une page ouvrait quelque
  chose dans la fenetre reduite -- echange GOG, lien _blank -- la fenetre
  survivait dans la barre des taches, et c'etait a l'utilisateur de faire le
  menage. C'est la FENETRE entiere qui est fermee desormais, avec repli sur
  l'onglet si elle resiste.
- Un onglet demande par le moteur pendant une reclamation invisible (l'echange
  GOG declenche depuis Luna) nait maintenant dans la meme fenetre reduite,
  jamais dans celle de l'utilisateur -- et part donc avec elle.
- Le balayage des orphelins ferme aussi les fenetres : un service worker mort
  en pleine reclamation laissait une fenetre entiere, pas seulement un onglet.
- Cas du defi de securite : l'onglet est d'abord ramene dans la fenetre de
  l'utilisateur, puis la fenetre reduite -- qui ne contient plus que
  d'eventuels restes -- est fermee.

## 2.13.2 -- 2026-08-27

**L'echec Epic porte desormais son diagnostic**

- Le message d'erreur du bouton d'acquisition liste les libelles des controles
  reellement visibles sur la page : "bouton introuvable" n'apprend rien,
  "boutons vus : Acheter | Liste de souhaits" dit exactement quel motif
  manque. Une capture d'ecran de l'erreur suffit desormais a corriger.
- Repli non ancre pour le bouton "Ajouter a la bibliotheque" : le textContent
  d'un bouton Epic concatene tous ses descendants, et un span invisible
  (lecteur d'ecran, spinner) suffit a faire echouer un motif ^...$. Le repli
  prefere le candidat au libelle le plus court -- le vrai bouton, pas un
  conteneur qui l'embarque.

## 2.13.1 -- 2026-08-27

**Correctif : les deux popups Epic restaient a l'ecran**

- Apres « Ajouter a la bibliotheque », Epic ouvre la modale « Informations sur
  le droit de retractation » (J'accepte), puis la modale « Lanceur Epic Games »
  (a fermer). Le guetteur savait cliquer les deux -- mais il ne cherchait leurs
  titres que dans h1, h2 et h3, et Epic a change son balisage : il ne les
  voyait plus, et les laissait a l'utilisateur.
- La detection balaie desormais h1 a h6 et role="heading", puis, en repli, le
  texte entier des conteneurs de dialogue (role="dialog", aria-modal) : un
  titre rendu dans un span stylise n'echappe plus au balayage.
- Le parcours direct concluait CLAIMED des qu'aucune iframe de paiement
  n'existait -- c'est-a-dire au moment precis ou la modale de retractation
  venait d'apparaitre. Il attend desormais une CONFIRMATION (bouton « Dans la
  bibliotheque », message de commande confirmee, ou modale du lanceur), jamais
  une absence.
- Avant de declarer l'echec sur delai, la possession est verifiee : Epic change
  ses modales, mais le bouton « Dans la bibliotheque » qui remplace le bouton
  d'achat dit la verite. Ce filet vaut pour les deux parcours, panier compris.

## 2.13.0 -- 2026-08-27

**La recuperation de fond devient invisible**

- Elle s'ouvrait dans un onglet `active: false` : sans voler le focus, mais
  VISIBLE dans la barre d'onglets -- le voir surgir puis disparaitre toutes les
  quelques heures ressemble a un navigateur hante. Chrome n'a pas d'onglet
  cache ; ce qu'il a, c'est la fenetre REDUITE : la reclamation vit desormais
  dans une fenetre minimisee, hors de la vue, sans toucher au focus ni a la
  barre d'onglets.
- L'invisibilite s'inverse au moment precis ou elle deviendrait nuisible : un
  defi de securite qui attend un humain fait remonter l'onglet dans la fenetre
  de l'utilisateur. Un onglet enterre dans une fenetre reduite ne serait jamais
  trouve.
- Repli sur l'onglet inactif quand la creation de fenetre echoue, et fermeture
  de toute fenetre creee sans onglet lisible -- le registre des onglets pilotes
  ne connait que des identifiants d'onglet, une fenetre orpheline ne serait
  jamais balayee.
- Deux couts assumes : les minuteries d'une page reduite peuvent etre alignees
  a la seconde (le moteur sonde a 500 ms sur un budget de cinq minutes, sans
  incidence a cette echelle), et la mise en page reste calculee, donc les
  controles de visibilite du moteur disent toujours la verite.

## 2.12.1 -- 2026-08-27

**Correctif : Epic ne recuperait rien**

- « waitForElement: timeout apres 10000ms », vu en production sur « Rival Stars
  Horse Racing ». Epic affiche parfois « Ajouter a la bibliotheque » directement
  sur la fiche, sans etape panier ; le flux n'attendait que le bouton panier
  (« Obtenir / Ajouter au panier ») et expirait sans rien faire.
- Le flux accepte desormais les deux parcours des l'entree, et branche selon le
  bouton qui apparait : panier -> commande -> paiement, ou bibliotheque directe
  -> accord de licence -> confirmation. Le correctif vaut pour la page ouverte a
  la main ET pour la recuperation de fond -- c'est le meme moteur.

## 2.12.0 -- 2026-08-27

Ne reclamer que ce qu'il y a a garder, et arreter d'ouvrir des onglets sur des
comptes que vous avez decoches. Quatre bugs de cette famille sont corriges, et
chacun agissait sur un vrai compte sans que rien ne le montre.

**Le jeu offert de la semaine, et rien d'autre**

- La difference se lit dans le prix d'origine, et nulle part ailleurs :
  `originalPrice > 0` avec `discountPrice === 0`, c'est un jeu payant offert un
  temps ; `originalPrice === 0`, c'est gratuit de toute facon.
- Mesure sur la capture reelle du 2026-08-27 : le flux freeGamesPromotions rend
  DEUX offres actives, et l'extension les prenait toutes les deux. La seconde
  etait un « Pack de Mage Epique » a 0 EUR -- un cosmetique permanent, offerType
  ADD_ON. Chaque cycle ouvrait un onglet et posait une requete sur un vrai
  compte pour un objet que tout le monde possede deja.
- Corrige des deux cotes : la veille ET le moteur. Un test de parite verifie
  qu'ils s'accordent sur chaque element de la capture -- sans lui, l'un
  reclamerait ce que l'autre ecarte.
- Nouveau champ `keepable` (vrai / faux / inconnu) et reglage « seulement ce
  qu'il y a a garder », actif par defaut. Inconnu laisse passer : traiter
  l'ignorance comme un refus ferait rater de vrais jeux offerts.
- Le prix d'origine d'Epic est enfin recupere. Le bilan comptait les jeux Epic
  sans jamais pouvoir dire ce qu'ils valaient.

**Quatre trous qui coutaient un compte**

- MAGASIN DECOCHE. `watchedStores` etait applique aux annonces et a
  l'affichage, jamais a la reclamation. Decocher Amazon faisait disparaitre les
  offres Luna de la liste et des notifications, et l'extension continuait
  d'ouvrir des onglets sur le compte Amazon la nuit -- invisible par
  construction, puisque l'offre n'apparaissait plus nulle part. « Tout
  recuperer » recoit le meme filtre, sinon il rouvrait la porte que le cycle
  venait de fermer.
- BOUCLE INFINIE. `failed` n'etant pas un verdict definitif, l'offre repassait
  en file et etait retentee a chaque cycle : cinq minutes d'onglet et un jeton
  du plafond horaire, indefiniment, pour un selecteur qui ne reviendrait pas.
  Recul a 15 min, 1 h, 4 h, 12 h, puis abandon au cinquieme essai. `attempts`
  etait incremente depuis toujours et personne ne le relisait.
- ONGLET FERME. Fermer l'onglet de fond laissait l'attente courir jusqu'a son
  budget, cinq minutes. Les reclamations s'enchainent en serie et le catalogue
  n'est ecrit qu'apres la boucle : un seul onglet ferme immobilisait le cycle
  assez longtemps pour que le service worker soit tue avant l'ecriture.
  onRemoved et onReplaced resolvent maintenant toutes les attentes de l'onglet,
  chargement compris.
- RECLAMATION INTERROMPUE. Le worker meurt a cinq minutes par evenement, soit
  exactement le budget d'UNE reclamation. L'offre est desormais marquee avant
  l'action, et un rattrapage au debut du cycle suivant la reclasse en
  « incertain » -- ni un succes qu'on n'a pas constate, ni un echec qui ferait
  recommencer tout de suite.

**Arret d'urgence**

- Un interrupteur, et un seul point de controle : `robustClick`, le goulot par
  lequel passe tout ce que le moteur fait d'irreversible. Un interrupteur pose
  plus haut laisserait passer le module qu'on aurait oublie de brancher.
- Il coupe aussi le cycle avant toute ecriture, bloque « Tout recuperer », et
  referme les onglets deja ouverts.
- Sa cle vit dans l'espace FGC_*, seule exception de la veille : le moteur doit
  la lire de facon SYNCHRONE avant un clic, et une lecture asynchrone rendrait
  sa reponse apres.

**Ce que l'interface montre enfin**

- VOUS ATTENDENT : les offres dont la derniere tentative s'est arretee sur
  quelque chose qu'une personne seule peut resoudre -- connexion, association de
  compte, defi de securite. Elles etaient indiscernables des offres que
  personne n'avait encore touchees.
- HORIZONS : la liste est coupee par echeance, avec un compte. « Fin inconnue »
  est en PREMIER et non en dernier : huit offres sur vingt de l'agregateur n'ont
  pas de date, et l'ordonnanceur les traite en tete parce qu'une date qu'on
  ignore n'est pas une echeance lointaine. Les separateurs n'apparaissent que
  sous le tri par echeance -- ailleurs ils decriraient un ordre que la liste ne
  suit pas.
- POURQUOI CETTE OFFRE NE SERA PAS PRISE : une puce par carte, rendue par la
  meme fonction que la veille utilise. Elle ne peut donc pas dire quelque chose
  que le moteur contredirait. Sans elle, une offre filtree ressemblait
  exactement a une offre sur le point d'etre reclamee.
- CE QUI A CHANGE : « 2 nouvelles depuis votre dernier passage », et une marque
  sur les cartes. L'instantane est fige UNE fois par ouverture du popup, parce
  qu'afficher l'onglet Jeux marque tout comme vu a l'instant meme ou la
  nouveaute devient visible.
- DEJA A VOUS : rapprochement avec la bibliotheque, pas seulement avec les
  offres du jour. « a vous sur Epic Games Store depuis juil. 2025 ».
- « Tout recuperer » est un bouton comme les autres, sous la liste, au lieu
  d'un lien souligne dans un titre de section.

**La bibliotheque**

- Un registre permanent, ecrit a l'instant de la reclamation. C'est la SEULE
  fenetre pendant laquelle l'information existe : le titre, la valeur et la
  vignette vivent dans le catalogue, purge a trente puis quatre-vingt-dix jours.
  Passe ce delai, l'historique du moteur ne porte plus qu'un slug -- et le
  journal affichait « Amazon Luna » a la place d'un nom de jeu, le bilan
  comptait sans valoriser, l'export sortait des lignes vides.
- La premiere date gagne : un second passage sur la meme page rend « deja
  possede » et ne doit pas redater une acquisition de deux ans vers aujourd'hui.
- Un champ renseigne ne se fait jamais ecraser par un champ vide, ce qui permet
  d'enrichir plus tard une entree figee sans titre.
- Alimente par storage.onChanged plutot que par nos propres ecritures : le
  moteur ecrit aussi quand vous reclamez a la main, sur une page que la veille
  n'a jamais vue.

**Deploiement automatique**

- `npm run build` copie desormais l'extension prete a charger dans
  `D:\free-games-claimer-extension-copie`. Ce dossier etait reste en 2.7.1
  pendant que le depot avancait jusqu'en 2.11.0 : tout ce qui etait teste ici ne
  changeait rien la-bas.
- Seuls les fichiers du paquet sont copies -- pas les sources du moteur, ni les
  tests, ni le build. Le nettoyage est limite aux chemins CONNUS : un dossier a
  la racine d'un disque peut contenir autre chose, et un effacement recursif sur
  une cible mal configuree est le genre d'erreur qu'on ne fait qu'une fois.

**Outillage**

- `verify-rename --rebase "motif"` rebase la preuve du moteur apres une
  modification volontaire, en ecrivant a cote ce qu'elle couvrait. Sans cette
  trace, rebaser deviendrait le geste qu'on fait pour faire taire un controle
  plutot que pour enregistrer une decision.

**Correctif : le popup se vidait**

- « ReferenceError: sinceText is not defined ». Le renommage en anglais avait
  transforme `sinceText` en `since` ; du code ecrit apres appelait encore
  l'ancien nom. L'exception etait levee AU MILIEU du rendu de la liste des
  jeux, donc plus aucun jeu et plus aucune vignette -- une seule faute
  expliquait les deux symptomes.
- Le build refuse desormais toute reference vers un nom qui n'existe pas.
  `node --check` valide la syntaxe, pas les references ; et les tests ne
  chargent pas popup.js, qui a besoin d'un DOM. Le controle a ete valide en
  reintroduisant la faute : il la designe, a la bonne ligne. Un garde-fou qui
  ne se declenche jamais ne prouve rien. Il a d'ailleurs attrape sa premiere
  vraie faute dans la minute qui a suivi -- une fonction supprimee par l'elagage
  et encore appelee par l'export CSV.

**Elagage**

- Retires : synchronisation des reglages (aucune resolution de conflit, sans
  effet sur une seule machine), export calendrier (personne ne met une echeance
  de jeu gratuit dans son agenda, et le popup montre deja le compte a rebours),
  densite (deux densites pour une liste qui a maintenant ses propres
  separateurs), jauge de stockage et purge manuelle (16 % de 10 Mo, pour un
  menage que le cycle fait deja), modes de badge (trois choix pour un chiffre),
  carte de premier lancement (elle disait d'aller cliquer ailleurs).
  Vingt-deux cles de traduction sont parties avec, designees par le detecteur
  d'orphelines.
- Le deploiement vers un second dossier est supprime, et le dossier lui-meme
  aussi : l'extension se charge depuis le depot.

**Ajoutes, parce que la plomberie existait sans surface**

- « Pas interesse » sur chaque carte : masque l'offre ET exclut le titre, d'un
  seul geste, annulable. `dismissed` et `excludedTitles` etaient dans le modele
  depuis le debut et rien ne savait les ecrire. Les separer en deux boutons
  aurait oblige a comprendre la difference avant de pouvoir agir.
- « Reessayer » sur une offre bloquee : efface le recul et le compteur d'essais.
  Se reconnecter est exactement ce qu'on vient de faire avant d'appuyer la, et
  attendre douze heures pour le verifier n'aurait aucun sens. Le garde-fou tient
  quand meme : chaque clic ne rouvre que cinq tentatives espacees, et il faut un
  humain pour le refaire.
- Le journal nomme enfin les vieilles reclamations : il lit la bibliotheque
  quand le catalogue a oublie. Une entree de quatre cents jours affichait un
  slug embelli, elle affiche son titre.
- Meilleur mois et magasin dominant au bilan. `byMonth` et `mainStore()`
  etaient calcules depuis la V2 et affiches nulle part -- c'est pourtant la
  seule forme sous laquelle des annees d'accumulation deviennent visibles.

**Tests**

- 389, dont 52 nouveaux. Le fichier `test/claim-safety.test.mjs` porte un test
  par comportement qui, avant cette version, ouvrait un onglet sur un compte
  reel sans que personne puisse le voir.
- Un decalage d'un cran dans le recul -- une heure d'attente des le premier
  echec au lieu de quinze minutes -- a ete trouve par son propre test, pas par
  la relecture.

## 2.11.0 -- 2026-08-27

Interface epuree, conventions anglaises, internationalisation. Deux garde-fous
nouveaux valent le detour : l'un rend ERR_FILE_NOT_FOUND impossible, l'autre
prouve qu'un renommage de 570 identifiants n'a change aucun comportement.

**Interface : moins large, moins de texte, un indicateur qui parle**

- Le popup passe de 372 a 328 px, et `overflow-x` est coupe. Une barre de
  defilement horizontale dans un popup est toujours un bug de mise en page, et
  elle volait sa largeur a chaque ligne.
- La barre de duree pleine largeur disparait. A sa place, un ANNEAU qui se vide
  autour de la vignette : une ligne de moins par carte, et l'oeil tombe sur le
  jeu plutot que sur une jauge. Fin inconnue : anneau hachure ambre, jamais
  vide -- l'ordonnanceur place ces offres en tete de file, et l'oeil doit lire
  la meme urgence.
- Le temps restant devient une pastille dont la couleur EST le message : terne
  au-dela de trois jours, ambre en dessous, rose sous vingt-quatre heures, et
  elle respire sous une heure. Des chiffres, jamais des mots : « 3 h 40 » se
  verifie, « bientot » non.
- La section « Ecartees par les filtres » est retiree. L'apercu des reglages
  dit deja combien d'offres sont recuperables et combien restent a la main, et
  les cases par magasin rendent le choix explicite.
- Magasins : Epic, GOG, Luna et Steam en clair, avec leur etat. Les huit autres
  passent dans un volet replie, en cases a cocher. Le libelle dit ce qu'une
  case fait vraiment -- surveiller et notifier, jamais reclamer -- parce
  qu'aucun module de reclamation n'existe pour eux.
- Les reglages secondaires passent en `<details>` replies. Sept sections
  visibles d'un coup, c'etait un mur.
- Textes coupes partout : le conseil de bas de page, les sous-titres
  decoratifs, les infobulles bavardes.

**Nouvelles features**

- Recherche instantanee et tri (fin la plus proche, plus recentes, valeur,
  magasin).
- Epinglage d'une offre en tete de liste.
- « Tout recuperer » : une commande qui reclame tout ce qui peut l'etre, sous le
  plafond horaire -- c'est lui qui protege le compte, pas la modestie du cycle.
- Masquer les jeux deja possedes.
- Doublon inter-magasins signale sur la carte : « aussi sur GOG ».
- Notifications : mode (chaque offre / un resume par jour / jamais), heures
  calmes, seuil de rappel reglable, et trois modes de badge.
- Les heures calmes DIFFERENT l'annonce, elles ne la suppriment pas : `notifiedAt`
  n'est pas pose, donc le premier cycle apres la plage la reprend. Une offre qui
  se termine a 7 h ne se perd pas parce qu'on a demande le silence la nuit.
- Theme systeme / sombre / clair, densite confortable / compacte.
- Export CSV et fichier calendrier (.ics) en plus du JSON. Une echeance est un
  instant, pas une plage : l'evenement est de duree nulle.
- Annulation du retrait d'un code, douze secondes. Un code perdu est un jeu
  perdu.
- Jauge de stockage et purge des offres expirees.
- Synchronisation des REGLAGES entre navigateurs, sur demande. Jamais les codes
  ni l'historique : storage.sync passe par le compte Google, et un code
  d'echange est un jeton au porteur.
- Carte de premier lancement, raccourcis clavier (1 2 3, /, Entree, Echap).

**Internationalisation**

- `_locales/en` et `_locales/fr`, `default_locale: en`. Tout texte passe par
  `t('cle')` ; plus un seul litteral dans popup.js.
- Choix explicite de langue dans les reglages. chrome.i18n ne sait rendre que
  la langue du navigateur, d'ou les tables embarquees -- GENEREES depuis
  `_locales` a chaque build, pour qu'elles ne puissent pas diverger.
- Le build refuse une cle absente d'une des deux locales, et une cle citee par
  l'interface qui n'existe nulle part. Une cle manquante ne casse rien : elle
  s'affiche telle quelle, et « emptyGames » en plein milieu de la liste est un
  bug qu'aucun test unitaire ne verrait.

**Conventions anglaises**

- 570 identifiants renommes, `veille/` devient `watch/`, dix fichiers de test
  renommes. Applique par `build/rename.mjs`, table dans `build/rename-map.mjs`.
- Le renommage passe par un TOKENISEUR, pas par un sed. Un remplacement par
  expression reguliere touche trois choses qu'il ne doit pas toucher : les
  commentaires, qui deviendraient un charabia mi-francais mi-anglais ; les
  chaines, dont les cles de storage.local ; et l'interieur des regex.
- Quatre garde-fous, chacun paye par une erreur reelle du script : table
  injective ; aller-retour du tokeniseur identique au bit pres ; aucune cible
  deja presente comme identifiant libre dans le meme fichier ; syntaxe valide
  apres coup. Le second a rattrape une apostrophe dans un gabarit qui faisait
  prendre le reste du fichier pour une chaine.
- Les cles de storage.local et les noms de messages vers le MOTEUR ne changent
  pas. Une cle est une donnee ; et un content script deja injecte continue de
  parler l'ancien protocole apres une mise a jour.
- `build/verify-rename.mjs` remplace le temoin byte-identique par une garantie
  plus forte : `src/core == table(build/pre-rename/core)`, sans exception. Le
  moteur actuel est exactement l'ancien avec la table appliquee, donc aucun
  changement de comportement n'a pu se glisser dans le lot.

**Migration du stockage, schema 1 -> 2**

- Les champs persistes passent en anglais, avec migration. Sans elle, rien ne
  casse : le code relit un champ qui n'existe plus, trouve `undefined`, et
  applique son defaut. Le seuil de l'utilisateur revient a zero, son plancher a
  trois, son autonomie a la valeur d'usine -- sans une seule erreur en console.
- La table de champs est GENEREE en composant les trois passes de renommage. Le
  build refuse si elle n'est pas injective : deux champs qui visent le meme nom
  se recouvrent, et le second gagne selon l'ordre des cles.
- Correctif et numero de version dans le MEME `set()`. En deux appels, une mort
  du worker entre les deux laisserait des donnees migrees marquees version 1.
- `notifications: false`, la forme d'avant, est traduite en `notifyMode: 'off'`.
  Sans cela un utilisateur qui les avait coupees les verrait revenir.

**Correctifs**

- ERR_FILE_NOT_FOUND, revenu trois fois, ne peut plus revenir : le build refuse
  toute reference vers un fichier absent -- manifeste, imports statiques, `src`
  et `href` des pages. Le symptome etait toujours muet : Chrome charge
  l'extension sans broncher, puis le popup s'ouvre vide.
- L'attribut `hidden` etait ecrase par `display: flex` : la barre « Annuler »
  restait visible en permanence, pour une action que personne n'avait faite.
- L'anneau partait a 9 h et non a midi : un `from -90deg` ajoute par habitude du
  canvas, alors qu'un conic-gradient CSS demarre deja au sommet.
- Premiere version de l'anneau : la reserve mesuree sur un horizon fixe de deux
  semaines. Rendue a l'ecran, elle etait inutilisable -- une offre a 39 minutes
  et une a neuf heures tombaient toutes deux sur le plancher de 3 %, donc
  l'anneau disait la meme chose des deux cartes qui differaient le plus.
  Remplacee par la part de fenetre restante.
- `elements` renomme en `nodes` cassait la lecture de la reponse GraphQL d'Epic :
  c'est un champ de l'API, pas un nom a nous. Neuf tests l'ont dit.
- `statut` -> `statusLine` et `valeur` -> `worth` etaient faux hors du popup :
  deux passes correctives, `build/rename-pass2.mjs`.

**Tests**

- 337, dont 49 nouveaux : migration (19), politique de notification (21),
  commandes (9).
- La politique de notification passe toutes ses heures locales par un fuseau
  EXPLICITE. Sans lui la suite serait verte ici et rouge ailleurs, sans qu'une
  ligne de code ait change.

## 2.10.0 -- 2026-08-27

Les features de la V3 deviennent visibles et reglables.

**Ecrans**

- Filtres : interrupteur d'autonomie, seuil de valeur, inclusion des DLC, et un
  apercu vivant -- « sur 8 offres en cours : 4 recuperables sans vous, 4 a voir
  vous-meme ». Voir l'effet d'un reglage AVANT de bouger le curseur vaut mieux
  que de decouvrir apres coup ce qu'on a supprime.
- Ecartees par les filtres, avec leur motif. Sans cette vue, un filtre est une
  trappe.
- Bilan : nombre de jeux, valeur, ventilation par magasin.
- Bande de prediction : 24 h a venir par source, reperes toutes les six heures.
  Une bande terne est exacte mais ressemble a un bug : elle dit desormais
  « rien attendu d'ici demain », ou « pic vers 17 h ».
- Export et IMPORT. L'export sans import etait une porte a sens unique.
  L'import ne restaure que ce qui ne se reconstruit pas : les codes et les
  reglages.

**Correctifs**

- Le clic sur une notification ouvrait la page de diagnostic. Le service worker
  perd la memoire entre l'envoi et le clic, qui peut arriver des heures plus
  tard : le lien est desormais retenu AVANT l'affichage.
- Le badge comptait les offres « non vues » alors que rien ne les marquait
  jamais : il affichait toutes les offres actives, a vie.

**Feature**

- Rappel avant expiration : une offre qui se termine dans moins de six heures et
  qui n'a pas ete traitee declenche un second signal. La premiere notification a
  pu tomber pendant la nuit.

## 2.9.1 -- 2026-08-27

Vague V3 : la reclamation autonome, plus quatre features. Tout est desormais
BRANCHE : le service worker execute reellement la chaine decouverte -> filtres
-> reclamation -> verdict.

**Reclamation autonome**

- Le service worker ouvre un onglet en arriere-plan, le moteur reclame, un
  verdict remonte, l'onglet se ferme. Trois reclamations par cycle au plus,
  dix par heure, jamais deux onglets en parallele.
- Mode pilote dans le moteur : ouvert par l'orchestrateur, il ne demarre plus
  seul, il s'annonce et attend un ordre. Sans cela deux logiques se disputaient
  le meme bouton.
- Le verdict n'a demande aucune plomberie nouvelle : les modules ecrivaient
  deja une entree d'historique avec le bon vocabulaire. Le mode pilote la
  guette.
- Les offres de l'agregateur sont resolues par l'atterrissage de l'onglet, sa
  redirection repondant 403 hors navigateur. APRES resolution, l'URL est la
  seule verite : une offre intitulee "... (Epic Games) Giveaway" qui atterrit
  sur un site tiers est refusee, quel que soit son titre.
- Balayage des onglets abandonnes a chaque reveil du service worker.

**Garde-caisse**

Un clic qui ressemble a un paiement est refuse, une fois pour toutes, juste
avant robustClick. Elle ne s'applique PAS a Epic, GOG et Luna : leur parcours
gratuit passe legitimement par un panier et une commande a zero, et une garde
fondee sur ces mots aurait casse la reclamation en production. Elle ne bloque
que sur des preuves de paiement -- champ de montant, bouton Stripe ou PayPal,
panier appele par attribut.

**Filtres**

Seuil de valeur, exclusion du contenu additionnel, magasins autorises, liste
noire de titres. Aucun ecart n'est silencieux : chaque refus porte un motif. Les
valeurs par defaut ne suppriment rien, sauf le contenu additionnel -- la requete
loot de l'agregateur rend 82 DLC contre 20 jeux.

**Prediction apprenante**

Histogramme de 168 cases par source, demi-vie de 90 jours, creneaux chauds
injectes dans l'ordonnanceur a cote des fenetres qu'Epic annonce. Seules les
offres NOUVELLES nourrissent l'histogramme : une offre revue a chaque cycle
gonflerait la case de nos propres heures de sondage, ce qui est exactement le
biais que la conception combat.

**Bilan et export**

Nombre de jeux, valeur, ventilation par magasin et par mois. Le bilan compte
separement ce qu'il a pu valoriser. L'export met les codes en attente en
premier : ce sont les seules donnees irremplacables du lot.

**Steam : detection seule**

Steam est detecte, affiche, mis a un clic -- jamais clique. Son contrat
d'abonnement interdit explicitement les scripts pour interagir avec ses
services, avec resiliation sans preavis, et son quota d'activations compte
"deja possede" comme un echec.

La garantie est structurelle, pas declarative : store.steampowered.com figure
dans host_permissions pour la LECTURE, et pas du tout dans content_scripts. Rien
n'est injecte sur une page Steam, donc rien ne peut y cliquer.

Detection en deux temps, tous deux verifies par de vraies requetes : la
recherche des promotions a -100 % donne les candidats, l'API publique
IStoreBrowseService tranche. `is_free` ne discrimine RIEN -- il vaut true
aussi bien pour un free-to-play permanent ; seul `is_free_to_keep` fait foi.
Les possessions viennent de la session connectee, et valent null -- pas un
ensemble vide -- quand on ne sait pas.

**itch.io : hors perimetre**

Le formulaire qui porte le lien de reclamation gratuite porte AUSSI le champ de
prix et les boutons Stripe et PayPal. C'est le seul magasin ou un selecteur un
peu large demarre un paiement dans un onglet invisible. S'y ajoutent trois a
quatre navigations par reclamation, une URL signee qui expire en 200 secondes,
Cloudflare, et un seuil de limitation inconnu. Ecarte.

**Temoin de non-regression**

`npm run verify -- --freeze "motif"` fige une nouvelle reference quand une
modification volontaire du moteur fait diverger l'ancienne, au lieu de
desactiver le controle. La fiche build/reference.json garde le motif.

288 tests.

## 2.8.2 -- 2026-08-27

Indicateur de chargement dans le popup.

- Une barre en tete de popup, sous le bandeau d'etat, visible depuis n'importe
  quel onglet. Ce n'est pas un rouage qui tourne : c'est la meme meche que sur
  les cartes de jeu, mais qui court. L'indicateur parle la langue du reste.
- Elle s'affiche pendant une verification manuelle -- un cycle interroge le
  reseau et peut prendre plusieurs secondes, parfois le temps de reveiller le
  service worker. Le bouton passe a « Verification... » et le bandeau d'etat
  annonce « Verification en cours... ».
- Le popup attend maintenant la fin du cycle avant de se rafraichir, au lieu de
  rendre la main tout de suite avec des donnees inchangees.

**Revelation differee**

La barre n'apparait qu'au bout de 180 ms. Une lecture de stockage de 50 ms ne
merite pas un clignotement -- il n'informe pas, il agace. Une action que
l'utilisateur vient de declencher, elle, s'affiche immediatement : il attend
une reaction. Un compteur de travaux en cours evite qu'un traitement termine
eteigne l'indicateur d'un autre encore en cours.

Verifie a l'ecran : chargement rapide -> barre jamais montree ; chargement lent
-> barre montree ; fin du cycle -> compteur revenu a zero.

**Changement d'onglet**

Le contenu entre par un leger deplacement vers le haut, pour que le changement
ait une direction. La classe d'animation est retiree puis reposee avec un
recalcul force entre les deux, sans quoi elle ne rejouerait qu'une fois.

**Mouvement reduit**

Sous `prefers-reduced-motion`, l'indicateur reste visible mais cesse de courir :
une barre a moitie remplie dit « ca travaille » sans mouvement. L'animation
d'onglet est supprimee.

## 2.8.1 -- 2026-08-27

Refonte du popup autour de la question qu'on se pose reellement en l'ouvrant :
qu'est-ce qui est gratuit, et est-ce que je dois agir.

**Navigation**

- Trois onglets internes -- Jeux, Codes, Reglages -- au lieu d'une colonne de
  six sections qu'il fallait parcourir. Navigation au clavier par les fleches.
- Un bandeau d'etat permanent sous l'en-tete : derniere verification, prochaine,
  et l'erreur s'il y en a une. Visible depuis n'importe quel onglet.

**L'onglet Jeux**

- Ce qui est gratuit maintenant, avec la vignette du jeu, le magasin, et le
  temps restant. Un clic ouvre l'offre.
- `Bientot` : les prochaines ouvertures annoncees par Epic lui-meme, avec date
  et heure exactes. Dedupliquees par jeu -- l'API annonce plusieurs fenetres
  pour le meme titre.
- `Deja recupere` : l'historique, avec les vrais titres.

**La meche**

Chaque jeu porte une jauge de ce qui reste de sa fenetre, calculee sur les
bornes reelles de l'offre. Une offre dont la date de fin est inconnue -- 8 sur
20 chez l'agregateur -- est hachuree en ambre, pas grisee : l'ordonnanceur la
place en TETE de file, pas en queue, et l'oeil doit lire la meme urgence.

**Textes**

- `ALREADY_OWNED` s'affichait a la place du nom du jeu. Les motifs techniques
  du moteur sont traduits et rendus comme des statuts ; le titre vient du
  catalogue de la veille, ou du slug rendu lisible.
- Un identifiant opaque (`amzn1.pg.item...`) ne se maquille plus en titre : il
  devient `Offre Amazon Luna`.
- Le curseur du plancher annonce desormais sa vraie portee : `Tant que Chrome
  est ouvert. Une alarme ne reveille pas l'ordinateur.`
- Un seul bouton ambre par ecran. La veille garde l'accent ; ouvrir un magasin
  devient une action secondaire.

**Donnees**

- Le modele d'Offre porte une vignette, prise chez la source la plus fiable
  (`keyImages` cote Epic, `thumbnail` cote agregateur). Les images sont
  chargees en differe, sans referent, avec une tuile de repli si le CDN ne
  repond pas.
- Les fenetres annoncees sont stockees entieres (titre, vignette, dates) et
  plus reduites a des instants. L'ordonnanceur n'en lit toujours que l'instant.
- `popup.js` ne fait plus `storage.local.get(null)` : il enumere ses cles.
  Sans cela, chaque ouverture du popup deserialisait le catalogue entier et les
  statistiques horaires pour afficher trois interrupteurs.

## 2.8.0 -- 2026-08-27

Vague V2 : la veille de fond. L'extension detecte desormais les jeux gratuits
sans qu'aucun onglet de magasin soit ouvert. Elle s'arrete a la notification :
la reclamation autonome vient en V3.

**Nouveau : la veille**

- Service worker reveille par `chrome.alarms`, avec deux alarmes : une
  principale rearmee sur le prochain instant prevu, et une periodique de 30 min
  qui verifie que la principale existe encore.
- Ordonnanceur a trois regimes -- plancher reglable (1 a 24 verifications par
  jour, 3 par defaut), creneaux chauds autour des heures de drop, poursuite
  quand une offre attend. Plus deux freins : recul exponentiel apres echec, et
  plafond journalier derive du plancher.
- Deux sources : l'API officielle `freeGamesPromotions` d'Epic et l'API
  publique gamerpower.com, qui couvre a elle seule une vingtaine de boutiques.
- Catalogue avec rapprochement multi-sources : deux sources qui annoncent le
  meme jeu donnent une seule entree, quel que soit l'ordre de decouverte.
- Notifications, badge sur l'icone, et etat consultable (dernier cycle,
  prochain cycle, derniere erreur par source).

**Ce que la veille lit au lieu de le deviner**

L'API Epic publie `upcomingPromotionalOffers` : les dates exactes de ses
prochaines ouvertures. L'ordonnanceur les LIT et arme son reveil dessus. La
regle "Epic lache a 11:00 heure de New York" s'est revelee fausse en general --
la capture du 2026-08-27 contient des ouvertures a 15:00Z (11:00 EDT, la regle
attendue) mais aussi a 17:00Z et 01:00Z. Un calendrier ecrit a la main aurait
rate ces deux-la.

**Corrections de conception, trouvees avant la mise en service**

- Les horodatages de gamerpower sont en heure de New York, pas en UTC. Etabli
  en recoupant nos deux captures reelles : l'API Epic ouvre Cardpocalypse a
  2026-08-20T15:00:00Z, l'agregateur le publie a "2026-08-20 11:02:34" -- lu en
  UTC, cela placerait la publication quatre heures AVANT l'ouverture de
  l'offre. Le decalage allait dans le sens qui fait expirer les offres trop
  tot. `lireDate` refuse desormais une date naive sans fuseau explicite,
  plutot que de supposer.
- La fusion multi-sources figeait la premiere valeur vue. Une table de
  fiabilite par champ donne la priorite a l'API Epic sur les dates et les URL,
  et rend la fusion commutative.
- Le bail d'exclusion mutuelle se donnait un identifiant derive de l'instant :
  deux reveils simultanes ecrivaient le meme identifiant et passaient tous les
  deux. Le verrou ne verrouillait rien.
- Une reponse de source effondree (panne, page de challenge) faisait basculer
  en "disparue" toute offre sans date de fin. Une liste n'est traitee comme
  complete que si sa taille reste au-dessus de la moitie de la derniere connue.
- Le premier cycle n'envoie aucune notification : il remplit le catalogue et
  marque tout comme deja annonce. Sans cela, l'installation declenchait une
  vingtaine de notifications, dont des offres publiees il y a des annees.
- La notification repose sur un champ persiste (`notifieLe`), pas sur le
  resultat du cycle : une mort du service worker ne produit plus de doublon.
- Une coupure reseau ne compte pas comme un echec de source. Sinon une nuit
  sans wifi gelait la veille six heures, au moment ou l'utilisateur rouvre son
  portable.

**Structure**

- Nouveau dossier `veille/` en ES modules : `offre`, `catalogue`,
  `stockage`, `cycle`, `planning/horaires`, `planning/ordonnanceur`,
  `sources/`. Le moteur de reclamation, lui, reste en ES5 concatene.
- `background.js` devient un module ES. Les manifestes gagnent la permission
  `alarms` et `"type": "module"` ; sans elles le service worker ne chargeait
  pas du tout, ce qui aurait aussi casse le relais du moteur V1.
- Le build refuse un `import()` dynamique ou un import statique place apres du
  code dans `background.js` : dans un service worker, cela decale
  l'enregistrement des listeners et les evenements sont perdus en silence.
- Espaces de noms disjoints : la veille ecrit sous `veille:`, jamais sous
  `FGC_*`. Une version de schema garde la porte en cas de retour arriere.
- `test/faux-chrome.mjs` : un faux `chrome.*` fidele -- `storage` atomique
  par `set()` mais sujet aux ecritures perdues, alarmes a horloge injectee,
  alarme ponctuelle supprimee au declenchement.
- 186 tests, dont deux captures reelles d'API en fixtures.

**Horaires**

`planning/horaires.js` ancre les regles sur un fuseau nomme via
`Intl.DateTimeFormat`, sans arithmetique sur les heures. Il traite les deux
cas pathologiques du changement d'heure de facon deterministe : heure murale
inexistante -> premier instant apres le trou ; heure ambigue -> premiere
occurrence. Verifie sur les deux fenetres annuelles ou l'Europe et les
Etats-Unis sont desynchronises.

## 2.7.1 -- 2026-08-27

Aucun changement de comportement du moteur : le code genere est identique au
bit pres a celui de la v2.7.0 (`npm run verify`).

**Structure**

- Le moteur monolithique de 2750 lignes est decoupe en 34 modules dans
  `src/core/`, concatenes dans l'ordre de leur nom par `build/build.mjs`.
  `free-games-claimer.js`, `free-games-claimer.user.js` et `test.txt` sont
  desormais generes et ne s'editent plus a la main.
- `npm run verify` reconstruit `build/reference-v2.7.0.js` a partir des modules
  et compare les SHA256 : le controle de non-regression du decoupage.
- Le build refuse le non-ASCII, les backticks et les fins de ligne LF. Les
  trois contraintes qui ont casse le script en v2.1.0, v2.3.0, v2.5.0 et
  v2.7.0 sont automatisees.
- 32 tests unitaires sur la logique pure (`npm test`), sans dependance :
  slugs Epic, fenetres de promotion, routage des magasins Luna, codes
  d'echange, reponses GOG, delais de repos.
- La version n'est plus ecrite que dans `package.json`. Le build l'injecte
  dans les deux manifestes, le bandeau et l'en-tete userscript.

**Corrections**

- `gm-shim.js` prechargeait tout `chrome.storage.local` (`get(null)`) a chaque
  injection et dans chaque iframe. Il ne charge plus que les neuf cles du
  moteur, et saute le prechargement hors du cadre principal.
- Un interrupteur bascule dans le popup ne prenait effet qu'au rechargement de
  la page : le shim ecoute maintenant `storage.onChanged`.
- `manifest.json` listait deux fois `https://www.gog.com/*`.

**Diagnostic**

- Nouvelle page `diagnostics.html` (lien en pied du popup) qui mesure le
  bridage des minuteurs dans un onglet de fond et la capacite d'un document
  offscreen a analyser du HTML. Nouvelles permissions : `scripting`,
  `offscreen`, et l'hote de l'agregateur.

// ==/UserScript==

/*

FREE GAMES AUTO-CLAIMER -- v2.7.0

NOUVEAUTES v2.7.0 :
 - Modules GOG (giveaway) : les motifs etaient restes sans accents, donc
   "Recuperer", "Dans la bibliotheque", "deja possede" ne matchaient jamais
   l'interface francaise. Corrige (meme classe de bug que v2.5.0).
 - Module Steam retire : il n'avait aucun @match (code jamais execute) et
   Steam ne propose pas de jeux a reclamer au sens Epic/Luna.
 - La veille des modales de fin d'achat Epic ne tourne plus indefiniment :
   elle demarre a la reclamation et s'arrete d'elle-meme au bout de 3 min.
 - Le script sort immediatement des iframes tierces (seule l'iframe de
   paiement Epic est traitee) : plus d'executions paralleles inutiles.
 - Verification apres reclamation Epic : si le bouton "Obtenir" est encore
   visible 2,5 s apres, rien n'est enregistre comme "reclame" (le jeu sera
   retente) au lieu d'etre perdu pour la semaine.
 - Les codes a echanger memorisent leur date limite (affichee par Amazon) ;
   elle apparait dans les notifications et dans "Voir les codes en attente".
 - Amazon Luna : les offres de contenu en jeu (offer-list-IN_GAME_LOOT) sont
   traitees comme les jeux (CONFIG.lunaClaimDlc pour desactiver).
 - Menu "Voir l'historique de cette plateforme".

CORRECTIF v2.6.0 (relances systematiques) :
 - Le mode auto repartait a chaque retour sur l'onglet (visibilitychange),
   a chaque chargement de page et a chaque changement d'URL interne. Un
   delai de repos persistant (stockage Tampermonkey, partage entre onglets)
   encadre desormais les verifications automatiques :
     * 30 min apres une verification (CONFIG.autoCooldownMs),
     * 6 h quand il n'y a plus rien a reclamer (CONFIG.autoIdleCooldownMs),
     * 15 min apres un echec, pour ne pas marteler (autoFailureCooldownMs).
   Les actions manuelles (bouton Claim, commandes de menu) ignorent ce delai
   et le remettent a zero.
 - Le surveillant de navigation interne ne reagit plus qu'a un changement de
   CHEMIN : Epic et Amazon reecrivent en permanence la query (suivi, ?lang=),
   ce qui relancait un cycle complet toutes les 1,5 s.
 - Menu "Relancer maintenant (ignorer le delai)" et etat du delai visible
   dans la console au demarrage.

CORRECTIF v2.5.0 (etapes finales : "captcha" a tort, boutons non cliques) :
 - detectSecurityChallenge ne retenait que le src des iframes : Epic charge
   en permanence une iframe hCaptcha/Arkose INVISIBLE, donc chaque clic
   finissait en "Defi de securite detecte" alors qu'il suffisait de cliquer.
   Seuls un cadre de defi VISIBLE (> 50 px, non masque) ou un champ de code
   a usage unique VISIBLE comptent desormais comme defi.
 - Les libelles reels du store sont accentues : "Ajouter a la bibliotheque",
   "droit de retractation", "Le lanceur Epic Games est-il installe ?",
   "Recuperer" (modale Code promo GOG). Les motifs ASCII de v2.4.0 ne
   matchaient aucun de ces boutons : l'enchainement s'arretait juste avant
   la fin. Tous les motifs tolerent maintenant accents et apostrophe typo.
 - Modale GOG "Code promo" : le bouton "Recuperer" est reconnu comme
   confirmation finale, "Annuler" reste ignore.

NOUVEAUTES v2.4.0 (Amazon Luna automatique + echange des codes GOG) :
 - Le module Luna demarre tout seul au chargement d'une page
   luna.amazon.<tld>/claims/... (toggle "Auto Luna : ON/OFF" dans le widget et
   dans le menu Tampermonkey). Sans session Amazon : simple notification.
 - Les libelles francais accentues ("Recuperer le jeu", "Obtenir le jeu",
   "Recupere", "bibliotheque") sont reconnus ; les motifs sans accent de
   v2.2.0 ne trouvaient aucun bouton sur l'interface francaise.
 - Les attributs stables de la page (data-a-target : offer-list-FGWP_FULL,
   item-card, FGWPOffer, buy-box, buy-box_call-to-action,
   DescriptionItemDetails, LinkAccountButton, ClaimStateClaimCodeContent,
   sign-in-button) sont utilises en priorite, le texte en repli.
 - La plateforme de destination est deduite du suffixe du slug de l'offre
   (/claims/<slug>-<epic|gog|aga|legacy|...>/dp/amzn1.pg.item...) et du
   texte "X pour PC sur <magasin>." de la fiche :
     * Legacy Games : ignore (jamais reclame) ;
     * Epic / Amazon Games / comptes relies : reclamation directe ;
     * GOG : le code affiche par Amazon est copie dans le presse-papiers,
       mis en attente (stockage Tampermonkey), puis echange automatiquement
       sur gog.com/redeem (voir ci-dessous) ;
     * Microsoft Store / Xbox : code copie dans le presse-papiers +
       notification (clic = ouverture de account.microsoft.com/billing/
       redeem) : a coller manuellement.
 - Parcours par offre : la page liste construit une file (sessionStorage)
   et le script visite chaque fiche l'une apres l'autre (une offre par
   chargement de page), clique "Obtenir le jeu", gere l'etape "Complete
   Claim", detecte "Associer un compte" (offre passee + notification), puis
   revient a la liste avec un resume. Reconnexion Amazon demandee : arret,
   la file reprend au prochain chargement de /claims apres connexion.
 - Nouveau module GOG "redeem" : sur gog.com/redeem, chaque code en attente
   est saisi dans #codeInput, "Continuer" puis "Utiliser le code" sont
   cliques, le resultat est lu (ajoute a la bibliotheque / code deja
   utilise / code invalide). Le reCAPTCHA invisible de la page ne bloque
   pas ; un captcha VISIBLE arrete le script (validation manuelle, puis
   reprise). A la fin de la serie Luna, gog.com/redeem s'ouvre dans un
   nouvel onglet si des codes GOG sont en attente.
 - Nouveaux @grant : GM_setClipboard (copie des codes), GM_openInTab
   (ouverture de la page d'echange). Menu : voir les codes en attente,
   oublier tous les codes en attente (irreversible), echanger les codes GOG
   maintenant, vider la file Luna en cours, basculer le mode auto Luna.
 - Revue : lot Luna remis a zero en fin de serie et fiche visitee hors
   serie traitee sans toucher a la file ; "Associer un compte" n'est
   retenu que s'il apparait APRES le clic (la fiche l'affiche deja avant) ;
   pour GOG/Microsoft un succes attend 6 s l'affichage du code ; textes
   compares noeud par noeud (textContent concatene sans espace) ; sur
   gog.com/redeem la route interne /redeem/<code> ne relance pas le module,
   "Code non trouve." est reconnu, un code refuse n'est pas reessaye et un
   captcha ne compte pas comme essai.

CORRECTIF v2.3.0 (erreur 404 Epic en mode automatique) :
 - L'API freeGamesPromotions renvoie parfois un productSlug herite du type
   "cardpocalypse/home". Le script construisait alors
   store.epicgames.com/p/cardpocalypse/home, qu'Epic redirige vers
   www.epicgames.com/site/p/... -> 404. Le slug est desormais resolu en
   priorite depuis offerMappings / catalogNs.mappings, puis productSlug
   nettoye (suffixe "/home" retire), et urlSlug en dernier recours ; les
   hash d'offre (32 hex, ex. jeux mystere) sont ignores car ils menent a
   la page /not-found.
 - Epic a supprime le prefixe de langue dans le chemin (/fr/free-games
   repond 301 vers /free-games?lang=fr). Toutes les URL sont construites
   sur ce nouveau schema (CONFIG.epicStoreOrigin + ?lang=CONFIG.epicLang).
 - Les bundles sont ouverts via /bundles/<slug>, les jeux/add-ons via
   /p/<slug>. extractEpicSlug reconnait les deux formes et tolere
   ?lang=xx, l'ancien prefixe /fr/ et le suffixe /home.
 - Seules les promos actives maintenant (fenetre de dates + prix remise a
   0) sont retenues : les jeux "Bientot disponible" ne sont plus comptes
   comme reclamables.
 - Sur /free-games le script attend le rendu des cartes (page rendue cote
   client) avant de conclure qu'une carte est absente et de rediriger.
 - Atterrissage sur store.epicgames.com/not-found apres une redirection du
   script : le slug fautif est marque "bad_url" (7 jours), plus aucune
   redirection vers lui, retour automatique sur /free-games.
 - Sur une fiche produit d'un jeu gratuit non reclame, le mode auto lance
   la reclamation sur place au lieu de renvoyer vers /free-games (evite le
   ping-pong entre les deux pages).
 - Repli DOM realigne sur le libelle actuel des cartes ("Gratuit jusqu'au
   ..." / "Free until ...") en excluant "Bientot disponible" et les
   free-to-play "Jeu de base".
 - Motifs de boutons tolerants aux accents ("Recuperer", "Dans la
   bibliotheque") via des echappements \u00e9 / \u00e8.
 - La commande de menu "Effacer l'historique" utilisait la cle
   FGC_history_<hostname> alors que l'historique est stocke sous
   FGC_history_<nom de plateforme> : elle n'effacait rien. Corrige.
 - Garde anti-reentrance du module Epic (120 s) : le watcher SPA relancait
   le module pendant une reclamation en cours (double clic sur "Obtenir").
 - Marqueur de reprise FGC_epic_pending_slug horodate (5 min), efface des
   que la reclamation se termine dans le meme document, et jamais utilise
   pour degrader une entree deja "claimed" : arrivee sur la fiche visee ->
   reclamation sur place ; arrivee sur /not-found -> slug bloque.
 - Le rejet interne 'STOP' (arret volontaire deja journalise) n'est plus
   affiche comme "Erreur : undefined" dans le widget.

CORRECTIF v2.2.0 : les @match Amazon Luna sont desormais restreints au
chemin /claims/* (ex. luna.amazon.fr/claims/home) au lieu de tout le
domaine. Le script (et donc le widget flottant) ne se charge plus du tout
sur les pages de jeu / bibliotheque / accueil Luna, uniquement sur les
pages de reclamation des jeux gratuits.

CORRECTIF v2.1.0 : plus aucun template literal (backtick) dans tout le
fichier. Toutes les chaines interpolees ont ete reecrites en concatenation
classique ('a' + b + 'c'), pour eliminer definitivement l'erreur de
parsing affichee par le linter integre de certaines versions de
Tampermonkey, qui ne reconnait pas la syntaxe ES6 des template literals.

/
