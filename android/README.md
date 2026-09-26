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
| **Comptes** | Connexion une fois dans l'appli ; les sessions restent sur le telephone. |
| **Souhaits** | A la main, ou en **partageant** une fiche de jeu depuis n'importe quelle appli (Reddit, Discord, navigateur) : l'appli dit aussitot si le jeu est gratuit, deja recupere ou deja attendu. |
| **Avec l'extension** | Import de sa sauvegarde (historique, souhaits, listes Steam/GOG) ; export d'un fichier que « Restaurer » de l'extension fusionne. |
| **Langues** | Francais, anglais, allemand, espagnol -- celle du telephone. |

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

- **Recuperer ecran eteint.** La veille de fond detecte et previent ; la
  recuperation a besoin d'une page affichee, donc de l'appli ouverte. Elle
  demarre seule a l'ouverture (reglage « Recuperer a l'ouverture ») ou d'un
  toucher sur la notification, et prend moins d'une minute par jeu.
- **Se connecter avec Google chez Epic.** Google refuse les connexions dans les
  applis : e-mail et mot de passe Epic.
- **Echanger les codes GOG / Amazon.** Un code arrive dans le verdict, mais
  l'echange reste a faire dans l'extension.

## Construire

```
cd android
./gradlew testDebugUnitTest   # les tests, sur les captures de l'extension
./gradlew assembleRelease     # app/build/outputs/apk/release/app-release.apk
```

Il faut un JDK 17+ et le SDK Android (plateforme 36). Le workflow
`.github/workflows/android.yml` fait la meme chose a chaque push qui touche
l'appli ou le moteur, et publie l'APK sur une release pour un tag `app-vX.Y.Z`.

Les textes des quatre langues sont generes depuis une seule table :
`python3 tools/strings.py app/src/main/res`.

### La cle de signature

`keystore/` contient la cle qui signe l'APK. Elle doit rester la meme d'une
version a l'autre : c'est ce qui permet d'installer une mise a jour par-dessus
l'ancienne sans rien perdre. Le depot est prive ; s'il devenait public, il
faudrait sortir la cle du depot (secret du workflow) -- quiconque la detient
peut signer une « mise a jour » de l'appli.

## Installer

1. Telecharger l'APK (release `app-v...` du depot, ou l'artefact du workflow).
2. L'ouvrir sur le telephone ; Android demande d'autoriser l'installation
   depuis cette source, la premiere fois.
3. Ouvrir l'appli, autoriser les notifications, puis **Reglages → Comptes des
   magasins** : se connecter a Epic, GOG, Amazon (et Steam si l'option est
   activee).
4. Facultatif : **Reglages → Importer** la sauvegarde de l'extension, pour que
   le telephone connaisse ce que le PC a deja pris.
