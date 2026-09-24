# Justification des permissions

A recopier dans la console du Chrome Web Store, onglet « Confidentialite ».
Chaque champ y est demande separement. Le contenu ci-dessous est derive de
`SECURITY.md`, qui fait foi : si les deux divergent, c'est `SECURITY.md` qui
a raison et ce fichier qui est perime.

## Objectif unique

Reperer les jeux offerts temporairement sur Epic Games Store, GOG, Amazon Luna
et Steam, et les ajouter au compte de l'utilisateur sur les magasins ou
celui-ci l'a autorise.

## Permissions

| Permission | Justification a recopier |
|---|---|
| `storage` | Conserver le catalogue des offres reperees, les reglages, l'historique des recuperations et les codes de rachat en attente. Tout reste sur la machine de l'utilisateur. |
| `alarms` | Reveiller l'extension periodiquement pour interroger les sources d'offres. Un service worker MV3 est arrete par le navigateur entre deux evenements ; sans alarme, aucune veille de fond n'est possible. |
| `notifications` | Annoncer une offre nouvelle, la fin proche d'une offre, et rendre la main a l'utilisateur quand un magasin presente un defi de securite. |
| `clipboardWrite` | Copier un code de rachat Amazon Luna dans le presse-papiers, pour que l'utilisateur le colle sur la page d'echange du magasin. |
| `scripting` | Executer l'etape de recuperation dans la page du magasin concerne, et rien d'autre. Bornee aux hotes declares ci-dessous. |
| `offscreen` | Lire une page HTML distante afin d'y reperer une offre. Un service worker MV3 n'a pas de `DOMParser` ; le document hors ecran est le seul moyen d'analyser du HTML. Le document est inerte, les scripts de la page lue ne s'executent jamais. |

## Permissions d'hote

| Hote | Justification a recopier |
|---|---|
| `https://*.epicgames.com/*` | Lire l'API publique des jeux offerts, ouvrir la fiche d'un jeu offert et y jouer l'etape de recuperation. Le joker couvre `store.`, `www.` et `accounts.`, ce dernier etant requis par l'import de bibliotheque a la demande de l'utilisateur ; et `egs-platform-service.store.`, l'API publique ou Epic publie ses jeux MOBILES offerts, lue sans cookie et seulement si l'utilisateur suit ce magasin. |
| `https://www.gog.com/*`, `https://gog.com/*` | Lire le catalogue filtre par prix pour reperer les jeux a 0, jouer l'etape de recuperation, et echanger un code de rachat. |
| `https://luna.amazon.*/claims/*` (15 domaines) | Lire les codes de rachat offerts par Amazon Luna sur la page de reclamation, pour chacun des pays ou le service existe. Chemin borne a `/claims/`. |
| `https://gaming.amazon.com/*` | Meme service Amazon, servi sous un second nom de domaine. |
| `https://store-site-backend-static*.ak.epicgames.com/*` | Les deux adresses de l'API publique Epic qui publie la liste des jeux offerts. Lues sans cookie. |
| `https://www.gamerpower.com/*` | Agregateur public d'offres, utilise comme source de decouverte de second recours. Lu sans cookie. |
| `https://store.steampowered.com/*` | Reperer les promotions a -100 %, afficher sur les pages du magasin le bouton de l'extension (ce qu'elle sait du jeu, et ce qui est gratuit en ce moment), et, si et seulement si l'utilisateur a active l'option apres avertissement, jouer l'etape de recuperation. |
| `https://api.steampowered.com/*` | Confirmer qu'un jeu Steam repere est bien gratuit, et retrouver le nom des jeux lors d'un import de bibliotheque demande par l'utilisateur. Lu sans cookie. |
| `https://api.frankfurter.dev/*` | Convertir en devise de l'utilisateur la valeur affichee des jeux recuperes. Une requete par 24 h, aucune donnee personnelle transmise. Seul hote qui ne soit pas un magasin de jeux. |

## Permissions optionnelles

Aucune n'est accordee a l'installation. Chacune est demandee sur un geste de
l'utilisateur, et se retire du meme geste.

| Permission | Justification a recopier |
|---|---|
| `background` | Garder la veille active apres la fermeture de la derniere fenetre, si l'utilisateur le demande. |
| `nativeMessaging` | Deposer un instantane de la ludotheque aupres d'un programme local que l'utilisateur a installe lui-meme ; et, pour une installation depuis un dossier, demander au relais de mise a jour (`tools/maj-auto.ps1`) de faire le `git pull`. |
| `https://steamcommunity.com/*` | Lire le temps de jeu Steam de l'utilisateur, sur un clic, pour comparer les jeux recuperes aux jeux lances. |
| `https://*/*` | Envoyer les alertes au telephone de l'utilisateur par ntfy, service de notification libre et auto-hebergeable. Le serveur est celui que l'utilisateur choisit (`ntfy.sh` par defaut) : l'extension demande CET hote seul, au moment ou l'alerte est activee. Le joker n'existe que parce que l'hote n'est pas connu a l'avance ; il ne donne aucun acces tant que l'utilisateur n'a pas accorde un hote precis. |

## Ce que l'extension ne demande pas

A mentionner si un relecteur s'interroge sur l'etendue des acces.

Aucune permission `tabs`, `cookies`, `webRequest`, `downloads`, `identity`,
`history`, ni `<all_urls>` en permission obligatoire. L'extension ne peut pas
lire l'URL des onglets de l'utilisateur, ni lire un cookie, ni intercepter une
requete.

## Code distant

Aucun. La politique de securite du contenu MV3 par defaut est intacte
(`script-src 'self'`) : pas d'`eval`, pas de `new Function`, aucun script en
ligne, aucun script charge depuis le reseau, aucune police ni feuille de style
tierce dans les pages de l'extension.
