# Conformite -- les regles d'Android et de Google Play

L'appli n'est pas sur Google Play : elle s'installe par APK. Elle suit
pourtant les regles que Google Play et Android imposent, point par point, pour
deux raisons : ce sont de bonnes regles pour une appli qui touche a des comptes,
et Play Protect juge un APK installe a la main sur les memes signaux.

Etat au 2026-09-27, appli 1.5.0.

## Ce que l'appli demande

| Permission | Pourquoi |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Lire les offres, ouvrir les pages des magasins, le relais. |
| `POST_NOTIFICATIONS` | Demandee a la premiere ouverture (Android 13+). Refusee, l'appli marche, sans prevenir. |
| `READ_CALENDAR` | **Optionnelle (1.23.0)**, demandee seulement quand tu touches la puce « Agenda » de « Ce soir je joue a... ». Refusee, rien ne change. Lit uniquement le debut, la fin, « toute la journee », la disponibilite et ta reponse des evenements de la soiree -- jamais un titre, un lieu ou un participant --, ne garde que le creneau libre calcule, n'envoie rien. |
| `WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED` | Ajoutees par WorkManager : la veille de fond, et sa reprise apres un redemarrage. |

Et rien d'autre. En particulier, **jamais** : camera (le QR code du relais est
lu par le lecteur de Google Play, dans son propre processus -- « tout le
traitement de l'image a lieu sur l'appareil et Google ne conserve ni les
resultats ni l'image »), localisation, contacts, SMS, stockage, service
d'accessibilite, affichage par-dessus les autres applis, service de premier
plan (`FOREGROUND_SERVICE` est retiree du manifeste fusionne), alarme exacte,
exemption d'optimisation de la batterie, installation d'autres applis.

## L'arriere-plan

- Uniquement **WorkManager**, avec reseau requis : toutes les 1 a 12 heures,
  et a l'heure d'ouverture annoncee par Epic.
- La **mise a jour depuis l'appli** (1.20.0) demande `REQUEST_INSTALL_PACKAGES`
  (le reglage Android « Installer des applis inconnues », que l'utilisateur
  accorde une fois) : c'est ce qui permet de passer l'APK de la release au
  programme d'installation du systeme. Elle est reservee a une appli
  distribuee HORS de Google Play, comme celle-ci -- Google Play restreint cette
  permission --, ne s'execute que sur un geste depuis les reglages, verifie la
  signature avant de proposer quoi que ce soit, et n'installe jamais rien en
  arriere-plan. La veille ne fait que prevenir.
- La **recuperation ecran eteint** (coupee par defaut, activee avec une
  explication) est une tache WorkManager ordinaire : dix minutes au plus, un
  jeu a la fois, aucune activite lancee depuis l'arriere-plan, aucune fenetre
  par-dessus les autres applis. Une notification discrete est visible pendant
  qu'elle travaille.
- **L'alarme de derniere chance** (1.5.0, coupee par defaut, activee avec
  une explication) n'est PAS une alarme exacte : la permission qu'elle
  demanderait (`SCHEDULE_EXACT_ALARM`) est reservee aux reveils et aux
  agendas. C'est `setAndAllowWhileIdle`, sans permission, que le systeme sert
  au plus une heure apres l'heure demandee ; d'ou une alarme trois heures
  avant la fin, qui sonne entre trois et deux heures avant. Aucune fenetre
  plein ecran (`USE_FULL_SCREEN_INTENT` n'est pas demandee) : une
  notification sur un canal dont le son passe par le flux des alarmes, que
  l'utilisateur regle ou coupe dans les reglages du canal.
- Un **captcha** ou toute verification humaine n'est **jamais** resolu par
  l'appli : il part en notification, et l'humain le fait a l'ecran. Au fond,
  le jeu attend ensuite quatre heures avant d'etre retente. Quand c'est le PC
  qui bloque (1.4.0), le telephone appelle l'humain, et c'est encore
  l'humain qui fait la verification, dans la page du telephone.

## Comptes et identifiants

- La connexion se fait sur la **page officielle du magasin**. L'appli ne lit
  ni ne garde aucun mot de passe : la session (cookies) reste dans le stockage
  prive de l'appli.
- **Google et Facebook interdisent leur connexion dans une page integree a une
  appli.** L'appli respecte cette regle : la page de connexion s'arrete AVANT
  de charger leurs pages, et explique quoi faire (pour Epic : poser un mot de
  passe sur le compte, ce qu'Epic prevoit par e-mail, la connexion Google
  restant active). Rien n'est envoye a Google ni a Facebook.
- Les pages de magasin recoivent l'en-tete de navigateur de Chrome de bureau :
  c'est la page que le moteur de l'extension connait. Les pages de Google et de
  Facebook ne sont jamais chargees, avec ou sans cet en-tete.
- L'appli n'utilise **aucun identifiant d'une autre application** (par exemple
  les clients OAuth internes d'Epic que certains robots empruntent) : ce serait
  se faire passer pour une appli d'Epic.

## Les donnees

- Tout est **local**. Aucun serveur a nous, aucune publicite, aucune mesure
  d'audience, aucun SDK de suivi.
- **Sauvegarde Android coupee** (`allowBackup=false`) : les sessions ne partent
  jamais dans une sauvegarde du telephone.
- **L'export** (pour l'extension) ne contient ni cookie, ni code de rachat, ni
  le secret du relais.
- **Le relais** (facultatif) passe par ntfy, **chiffre de bout en bout**
  (AES-256-GCM) ; son secret est chiffre par une cle du **Keystore Android** et
  ne quitte pas le telephone. ntfy voit l'heure et la taille des messages,
  jamais leur contenu.
- « Se deconnecter de tous les magasins » efface les cookies et le stockage
  des pages ; desinstaller efface le reste.
- L'ecran **Reglages -> Confidentialite** dit tout cela dans l'appli.

## La page de magasin (WebView)

- Le moteur n'est injecte **que** dans les origines des magasins (Epic, GOG,
  Amazon Luna) ; le canal avec l'appli (`addWebMessageListener`) est borne aux
  memes origines. Pas d'`addJavascriptInterface`.
- Pas d'acces aux fichiers ni aux fournisseurs de contenu ; navigation
  securisee (Safe Browsing) active ; trafic en clair interdit.
- Le partage de l'image de l'annee (1.6.0) passe par un `FileProvider` borne
  au dossier `partage/` du cache de l'appli, non exporte, avec une
  permission de lecture accordee au seul destinataire choisi.
- Les liens ouverts au-dehors sont limites a `http(s)` : une adresse venue
  d'une source ne lance jamais une autre appli.
- `PendingIntent` immuables ; seule l'activite principale est exportee
  (lanceur, « Partager » du texte, et le lien `fgclaimer://finir`).
- Ce lien (1.4.0) vient de l'alerte du PC ou de la notification du relais,
  mais n'importe quelle page pourrait l'ouvrir : il ne fait que DESIGNER un
  jeu. L'appli le cherche dans ses propres offres, ne suit aucune adresse
  venue du lien, et ne recupere rien sans un appui sur « Finir ici ».

## La plateforme

- Cible Android 16 (API 36), minimum Android 8 (API 26).
- Bord a bord, geste retour predictif ; les barres systeme et les encoches
  (`WindowInsets.safeDrawing`) ne cachent jamais un bouton.
- **Tous les ecrans** (qualite des applis pour grand ecran) : aucune
  orientation imposee, fenetre redimensionnable (ecran partage, fenetres de
  bureau) ; rotation, pliage et changement de taille sans perdre l'etat.
  La navigation passe des onglets du bas a un **rail** des 600 dp de large,
  les listes en 2 ou 3 colonnes, le texte long dans une colonne de 760 dp.
- **Accessibilite** : cibles tactiles de 48 dp ; roles TalkBack (onglets,
  choix, en-tetes), boutons-icones decrits ; police du telephone suivie
  jusqu'a 200 %, sans mot coupe ni bouton ecrase (verifie par captures).
- Une seule bibliotheque native, celle de Compose (`androidx.graphics.path`),
  alignee sur 16 Ko (verifie par `zipalign -c -P 16`) : compatible avec les
  pages memoire de 16 Ko.
- APK signe (schema v2), toujours avec la meme cle.

## Si l'appli allait un jour sur Google Play

Ce qui serait a faire : la fiche « Securite des donnees » (tout est local,
rien n'est partage, chiffrement du relais), l'adresse d'une politique de
confidentialite (le texte de Reglages -> Confidentialite suffit a l'ecrire).

Et le point qui ne depend pas de l'appli : **les conditions d'utilisation de
certains magasins interdisent l'automatisation**. L'appli agit sur le compte
de l'utilisateur, a sa demande, a un rythme humain, et s'arrete a toute
verification humaine ; le risque sur le compte reste celui de l'utilisateur,
comme avec l'extension. C'est aussi la raison la plus probable d'un refus sur
Google Play.

## L'avertissement a l'installation

Un APK installe a la main, d'un developpeur que Google ne connait pas, declenche
un avertissement de **Play Protect** (« application inconnue », proposition
d'analyse) ; Chrome previent aussi au telechargement de tout APK. Ce n'est pas
une detection : c'est l'absence d'historique. Deux choses le reduisent :

1. **Analyser l'appli** quand Play Protect le propose : Google l'examine, et
   ne la redemande plus pour cette version.
2. **Enregistrer l'appli** aupres de Google (verification des developpeurs
   Android). En France, ce n'est pas encore obligatoire ; ca le deviendra en
   2027 pour installer sur un telephone certifie sans le « parcours avance »
   (24 heures d'attente). Le compte **distribution limitee** est gratuit, sans
   piece d'identite, pour 20 appareils au plus :
   - creer le compte dans l'Android Developer Console (compte Google avec
     validation en deux etapes) ;
   - enregistrer le nom de paquet `io.github.diaslamka.freegames` et
     l'empreinte SHA-256 de la cle de signature :
     `72:1A:F7:EA:41:FE:5C:AF:96:A8:A7:6B:7D:70:42:74:2C:A5:37:E4:04:A4:A5:7F:23:27:17:BA:47:55:45:C5`
   - la console fournit un petit fichier a mettre dans `app/src/main/assets/`
     pour prouver la possession de la cle : l'y deposer, reconstruire, envoyer
     l'APK signe.
