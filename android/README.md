# Free Games Claimer -- l'appli Android

La meme chose que l'extension, sur le telephone, en **vraie appli** : ecrans
natifs (Kotlin, Jetpack Compose), veille de fond, notifications. Pas une page
web emballee.

## Ce qu'elle fait

| | |
|---|---|
| **Jeux gratuits** | Epic, GOG, Steam, Amazon et les autres magasins (GamerPower), les jeux mobiles d'Epic, ce qu'Epic annonce pour la suite. Jaquette, valeur, temps restant, note Steam. |
| **Veille de fond** | Toutes les 1, 3, 6 ou 12 heures, ecran eteint, et a l'heure exacte de la prochaine ouverture annoncee par Epic. |
| **Notifications** | Un jeu par notification, avec sa jaquette et un bouton **Recuperer** ; le souhait qui passe gratuit passe devant ; un rappel le dernier jour. |
| **Recuperation** | Epic, GOG, Amazon Luna : **le moteur de l'extension**, au caractere pres, joue dans une vraie page du magasin. Steam en option, comme dans l'extension. |
| **Ecran eteint** (1.2.0) | En option : pendant la veille de fond, la page du magasin s'ouvre sans s'afficher et le jeu est pris, sans ouvrir l'appli. Un captcha n'est jamais resolu : une notification t'appelle. |
| **Relais avec le PC** (1.2.0) | Associe a l'extension par un QR code : celui qui est allume recupere, l'autre ne retente pas. Chiffre de bout en bout, par ntfy. |
| **Tes gouts** (1.14.0) | **Pour toi** sur les offres qui ressemblent aux jeux que tu aimes, une ligne dans la notification (« Proche de tes gouts : Roguelike, 2D. »), et « Ce soir je joue a... » les met devant. Le profil vient de l'extension (sa sauvegarde le porte : elle sait combien tu as joue) ou de tes etats sur le telephone. Seuls des numeros de jeux partent vers Steam, sans cookie. |
| **Nouveau logo** (1.14.1) | Le ticket jaune, la manette, FREE et la fleche de recuperation remplacent l'ancien coupon ambre : icone adaptative, icone thematique (Android 13+) et petite icone des notifications. |
| **Un seul resume par jour** (1.13.0) | Reglages : a l'heure choisie (8 h, 12 h, 18 h, 20 h), UNE notification rassemble les nouveaux jeux du jour. Les jeux souhaites et les deuxiemes chances sonnent tout de suite, comme le dernier jour, la derniere chance et « Plus tard ». Un jeu pris ou fini entre-temps n'y figure pas. |
| **Plus tard** (1.12.0) | Sur chaque notification de jeu : un bouton qui la fait revenir dans trois heures, au plus tard une heure avant la fin de l'offre (pas de bouton s'il reste moins de deux heures). Un jeu pris entre-temps ne sonne pas. |
| **Deuxieme chance** (1.12.0) | Un jeu deja offert que tu n'avais pas pris et qui revient est etiquete **2e chance**, passe devant le tout-venant et sa notification dit quand et ou tu l'avais rate. |
| **Ce soir a plusieurs** (1.12.0) | Une case dans « Ce soir je joue a... » : que des jeux qui se jouent a deux ou plus, d'apres les categories Steam. |
| **Raccourcis sur l'icone** (1.12.0) | Appui long sur l'icone : Recuperer maintenant, Ce soir je joue a..., Ajouter un souhait. |
| **Toute la famille** (1.9.0) | Reglages : ajoute tes proches, connecte leurs magasins (Epic, GOG, Amazon) a leur nom, et le telephone recupere pour chacun -- a l'ecran ou ecran eteint. Chaque personne a son profil WebView : ses cookies ne croisent jamais les tiens. Steam et le relais avec le PC restent a ton compte. Il faut une « Android System WebView » recente. |
| **Ce soir je joue a...** (1.8.0) | Onglet Recuperes, et un **widget** pour l'ecran d'accueil : UN jeu de ta pile pour le temps que tu as (une heure, une soiree, un week-end), avec la note Steam, le format que lui donnent les joueurs, le Steam Deck. « Un autre », « J'y joue », « Pas pour moi ». Ta collection vient de la sauvegarde de l'extension. |
| **Attends, il sera offert** (1.7.0) | Onglet Souhaits : pour chaque jeu attendu, ses chances de passer gratuit (fortes, moyennes, faibles) et pourquoi -- deja offert, un editeur qui offre, l'age du jeu, son prix. Les meilleures chances en tete. Une estimation, jamais un pourcentage. |
| **Mon annee en image** (1.6.0) | Onglet Recuperes : l'annee en une image (valeur, jeux, magasins, les plus chers, le mois record), a partager d'un geste. La meme que celle de l'extension. |
| **Derniere chance** (1.5.0) | En option : un jeu de tes souhaits finit dans moins de 3 h sans etre a toi, le telephone sonne comme un reveil, meme en silencieux, jusqu'a ce que tu le touches. |
| **Le PC a besoin de toi** (1.4.0) | Un captcha arrete le PC pendant que tu es dehors : le telephone sonne, tu touches « Finir ici », tu fais la verification sur le telephone et le jeu est pris, avec la session du telephone. Dans l'autre sens, un captcha ecran eteint fait retenter le jeu au PC. |
| **Comptes** | Connexion une fois dans l'appli ; les sessions restent sur le telephone. Google et Facebook refusent les connexions dans une appli : l'appli s'arrete avant et guide (mot de passe Epic). |
| **Souhaits** | A la main, ou en **partageant** une fiche de jeu depuis n'importe quelle appli (Reddit, Discord, navigateur) : l'appli dit aussitot si le jeu est gratuit, deja attendu, ou deja a toi -- et sur quel magasin, y compris ce que le PC a pris. |
| **Avec l'extension** | Import de sa sauvegarde (historique, souhaits, listes Steam/GOG) ; export d'un fichier que « Restaurer » de l'extension fusionne. |
| **Langues** | Francais, anglais, allemand, espagnol -- celle du telephone. |
| **Tous les ecrans** (1.3.0) | Petit telephone, grande police, paysage, pliable, tablette : la mise en page suit la fenetre (voir plus bas). |

## L'interface

Une charte brute, depuis la 1.1.0 : fond blanc ou noir selon le telephone,
une seule couleur d'accent -- **jaune cyber** `#E8FF00` --, bordures noires
de 3 dp, ombres pleines et decalees (noires sur fond blanc, jaunes sur fond
noir), angles droits, aucun degrade. Titres en Archivo Black, tout le reste
en Space Mono, embarquees dans l'APK (licence OFL, `assets/licences/`). La
mise en page est asymetrique a dessein : une carte sur deux decalee, le
compte des jeux en etiquette de travers, la note Steam en autocollant.

**La signature** (1.3.0), la meme que dans l'extension : chaque jeu offert
est un **billet**, poinconne sur les deux bords et perfore sous la jaquette ;
un **tampon** « RECUPERE », de travers, sur ce qui a ete pris ; une bande
**timecode** qui egrene la prochaine fin d'offre. C'est dans `ui/Signature.kt`.

Les composants de la charte sont dans `ui/Components.kt` (`brut`, `Tag`,
`BrutButton`, `BrutToggle`, `BrutField`, `SectionHeader`) et la palette dans
`ui/theme/Theme.kt`. Les ecrans se regardent sans telephone :

```
./gradlew testDebugUnitTest -Pscreens=true --tests '*ScreenshotTest*'
```

rend chaque ecran, clair et sombre, sur les offres du moment, dans
`app/build/screenshots/` -- dont huit formats d'ecran (captures `D-*`).

### Tous les ecrans

La mise en page suit la **largeur de la fenetre**, pas le type d'appareil --
une appli en ecran partage est une fenetre etroite sur une tablette :

| Fenetre | Navigation | Jeux |
|---|---|---|
| moins de 600 dp (telephone en portrait) | onglets en bas | une colonne |
| 600 a 1000 dp (paysage, pliable ouvert) | **rail** sur le cote | deux colonnes |
| 1000 dp et plus (tablette) | rail | trois colonnes |

Les reglages et les souhaits tiennent dans une colonne de 760 dp au plus,
centree : une ligne de texte reste lisible. L'appli n'impose aucune
orientation et suit la rotation, le pliage et l'ecran partage sans perdre ce
qui est a l'ecran.

**Grande police** (jusqu'a 200 %) : les titres retrecissent plutot que de
couper un mot, le bouton d'un compte passe sous son nom, les libelles
d'onglet tiennent sur une ligne. **Accessibilite** : cibles tactiles de
48 dp, onglets et choix annonces comme tels par TalkBack, titres d'ecran
marques comme en-tetes, boutons-icones decrits. Bord a bord : les barres
systeme et les encoches ne cachent rien.

## Le moteur est celui de l'extension

`content/free-games-claimer.js` et `watch/steam-claim.js` sont **recopies a
chaque build** dans l'APK (`copyEngine`, dans `app/build.gradle.kts`) : on ne
les edite jamais ici. L'appli les injecte dans la page du magasin, dans toutes
ses frames -- iframe de paiement d'Epic comprise --, comme le script de contenu
de l'extension (`WebViewCompat.addDocumentStartJavaScript`).

Le moteur parle a l'appli par un canal (`fgcNative`, `WebViewCompat.addWebMessageListener`)
que `app/src/main/assets/engine/android-shim.js` habille en `chrome.runtime` et
`GM_*` : le protocole est celui de `watch/claim.js` -- suis-je pilote, pret,
ordre de reclamer, verdict. Une correction de selecteur dans l'extension
profite donc a l'appli au build suivant, sans une ligne de Kotlin.

Les sources de decouverte (`sources/`) sont un portage Kotlin de
`watch/sources/*.js`. Leurs tests (`app/src/test`) lisent **les memes
captures** que ceux de l'extension (`test/fixtures`) et verifient les memes
attentes.

## Ce qu'elle ne fait pas encore

- **Se connecter avec Google ou Facebook dans l'appli.** C'est interdit par
  Google et Facebook (connexion dans une page integree a une appli). Pour Epic :
  poser un mot de passe sur le compte (bouton « Creer mon mot de passe Epic »),
  la connexion Google restant active partout ailleurs.
- **Echanger les codes GOG / Amazon.** Un code arrive dans le verdict, mais
  l'echange reste a faire dans l'extension.
- **La recuperation ecran eteint n'a pas encore ete vue sur un vrai
  telephone** : elle est construite et testee hors appareil ; la premiere nuit
  dira si Epic se comporte dans une page non affichee comme dans un onglet
  d'arriere-plan de Chrome.

## Construire

```
cd android
./gradlew testDebugUnitTest   # les tests, sur les captures de l'extension
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

Il faut un JDK 17+ et le SDK Android (plateforme 36). Le workflow
`.github/workflows/android.yml` fait la meme chose a chaque push qui touche
l'appli ou le moteur. **Publier une version** : changer `versionName` (et
`versionCode`, +1) dans `app/build.gradle.kts` et pousser sur `main` : le
workflow cree la release `app-vX.Y.Z`, tag compris, avec l'APK signe.

Les textes des quatre langues sont generes depuis une seule table :
`python3 tools/strings.py app/src/main/res`.

### La cle de signature

`keystore/` contient la cle qui signe l'APK. Elle doit rester la meme d'une
version a l'autre : c'est ce qui permet d'installer une mise a jour par-dessus
l'ancienne sans rien perdre. Le depot est prive ; s'il devenait public, il
faudrait sortir la cle du depot (secret du workflow) -- quiconque la detient
peut signer une « mise a jour » de l'appli.

## Installer

1. Telecharger l'APK sur le telephone : **github.com/diasLamka/free-games-claimer-extension/releases**,
   la derniere release `app-v...`, section *Assets*, le fichier `.apk`. Le
   depot est prive : il faut etre connecte a GitHub dans le navigateur du
   telephone. Chrome previent qu'un APK « peut etre dangereux » : c'est vrai
   de tout APK, il suffit de le conserver.
2. L'ouvrir sur le telephone ; Android demande d'autoriser l'installation
   depuis cette source, la premiere fois. **Play Protect** peut dire qu'il ne
   connait pas l'appli et proposer de l'analyser : accepter l'analyse, puis
   installer. Ce n'est pas une detection, c'est l'absence d'historique -- voir
   `CONFORMITE.md` pour le faire disparaitre (enregistrement gratuit aupres de
   Google).
3. Ouvrir l'appli, autoriser les notifications, puis **Reglages → Comptes des
   magasins** : se connecter a Epic, GOG, Amazon (et Steam si l'option est
   activee).
4. Facultatif : **Reglages → Importer** la sauvegarde de l'extension, pour que
   le telephone connaisse ce que le PC a deja pris.
5. Facultatif : **Reglages → Relais avec le PC → Scanner le QR code** que le
   popup de l'extension affiche (Reglages → Relais avec le telephone).

### Mettre a jour

Meme chemin : la nouvelle release, son APK, l'installer. Il est signe de la
meme cle, il s'installe donc **par-dessus** l'ancien, sans rien perdre
(sessions, historique, reglages).

## Les regles

L'appli suit les regles d'Android et de Google Play meme hors de Google Play :
permissions au strict minimum, aucune fenetre par-dessus les autres applis,
aucun service de premier plan, aucun captcha resolu, aucune connexion Google
dans une page integree, aucun identifiant emprunte a une autre appli. Le detail,
point par point : `CONFORMITE.md`.
