# Politique de confidentialite

Les deux magasins exigent une adresse publique qui heberge ce texte. Le plus
simple est de le publier dans le depot et d'en donner le lien direct.

Derive de `SECURITY.md`, qui fait foi.

---

## Free Games Auto-Claimer -- confidentialite

**Derniere mise a jour : 2026-09-22**

### En une phrase

L'extension ne collecte rien, n'envoie rien a ses auteurs, et n'a aucun
serveur.

### Ce qui est stocke, et ou

Tout vit dans le stockage local du navigateur, sur la machine de
l'utilisateur : le catalogue des offres reperees, les reglages, l'historique
des recuperations, la bibliotheque importee et les codes de rachat en attente.

Rien n'est chiffre par l'extension. Qui peut lire le repertoire de profil du
navigateur peut tout lire. Le chiffrement de disque du systeme est la vraie
protection, et elle ne depend pas de nous.

### Ce qui peut quitter la machine

Deux choses, **chacune coupee par defaut** : le reglage « recopier les codes
dans la zone synchronisee » place les codes de rachat en attente dans le
stockage synchronise du navigateur, et le reglage « retrouver mes jeux
recuperes sur mes autres ordinateurs » y place la liste des jeux recuperes
(magasin, identifiant, titre, date -- aucun code). Ce stockage transite par le
compte Google ou Mozilla de l'utilisateur ; le chiffrement applique est celui
de ce service, pas le notre. Couper le second retire la copie. Tant que les
deux reglages restent coupes, rien ne sort.

### Requetes reseau

L'extension interroge les magasins de jeux et deux services publics, jamais un
serveur qui nous appartienne :

- **sans cookie** : l'API publique d'Epic Games, le catalogue de GOG,
  l'agregateur GamerPower, la recherche Steam, et un service public de taux de
  change une fois par 24 heures ;
- **avec les cookies du navigateur, et uniquement vers le magasin
  concerne** : Steam, GOG et Epic, pour lire ce que l'utilisateur possede
  deja. Ces requetes ne partent **que sur un clic explicite** de
  l'utilisateur, jamais de la propre initiative de l'extension.

Aucune donnee n'est transmise a un tiers.

### A savoir : les vignettes

Le popup affiche les images des jeux depuis les serveurs d'images d'Epic, GOG,
Steam et GamerPower. Ces serveurs recoivent donc l'adresse IP de l'utilisateur
et savent quels jeux lui sont presentes. Ce n'est pas une requete de
l'extension, c'est une balise image, mais l'effet est le meme et il vaut
d'etre dit.

### Ce que l'extension ne fait pas

- Aucune telemetrie : pas d'identifiant d'installation, pas de rapport
  d'erreur distant, pas de signal de demarrage.
- Aucune vente, aucun partage, aucun transfert de donnees a qui que ce soit.
- Aucun mot de passe, aucun jeton, aucun cookie conserve. L'extension n'a meme
  pas la permission de lire un cookie.
- Aucun usage des donnees etranger a l'objectif annonce.
- Aucune evaluation de solvabilite, aucun profilage publicitaire.

### Suppression

Desinstaller l'extension efface tout son stockage local. Les reglages
« Sauvegarde » du popup permettent d'exporter les donnees avant, ou de les
effacer sans desinstaller.

### Contact

<A REMPLIR : adresse de contact ou lien vers les issues du depot>
