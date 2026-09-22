# La passerelle locale

L'extension sait ce que vous possedez sur quatre magasins, ce que vous avez
recupere, ce qui est passe et ce que vous avez lance. Cette connaissance ne
sortait de nulle part : ni Playnite, ni Heroic, ni un script maison ne
pouvaient la lire.

Cette passerelle la depose dans un fichier, sur votre machine, quand vous le
demandez.

## Ce qu'elle n'est pas

**Pas un serveur.** Rien n'ecoute sur un port, rien n'est joignable depuis le
reseau. Le navigateur demarre un programme local, lui parle sur l'entree
standard, et le tue quand la connexion se ferme.

**Pas une mise en commun.** Aucune donnee ne quitte la machine. Le non-objectif
du design tient.

**Pas automatique.** Trois obstacles, et les trois sont voulus : l'envoi part
d'un geste, la permission est optionnelle, et le programme doit avoir ete
installe a la main. Un canal vers un programme local est la chose la plus
puissante qu'une extension puisse demander.

**Pas un transport de secrets.** Les codes de rachat n'y sont pas, et n'y
seront pas. Un code est un porteur : qui l'a, l'utilise. Il n'a aucune raison
de traverser une frontiere de processus pour peupler une ludotheque.

## Installer

Il faut Node.js 22 ou superieur, et trois etapes.

### 1. Poser le programme

Copiez `fgc-host.mjs` ou vous voulez. Retenez son chemin absolu.

### 2. Relever l'identifiant de l'extension

Ouvrez `chrome://extensions`, activez le mode developpeur, et lisez l'ID sous
le nom de l'extension. Il ressemble a `abcdefghijklmnopabcdefghijklmnop`.

### 3. Declarer l'hote au navigateur

Prenez `com.free_games_claimer.bridge.json`, remplacez les deux `A_REMPLIR` :

- `path` : le chemin ABSOLU vers `fgc-host.mjs`. Sous Windows, un lanceur `.bat`
  est souvent necessaire, parce que Chrome execute le fichier directement et ne
  sait pas qu'il faut Node pour le lire. Un fichier de deux lignes suffit :

  ```bat
  @echo off
  node "C:\chemin\vers\fgc-host.mjs" %*
  ```

  et c'est alors le `.bat` que `path` doit designer.

- `allowed_origins` : `chrome-extension://VOTRE_ID/`, avec la barre oblique
  finale. Sans elle, la connexion est refusee sans explication.

Puis deposez ce fichier a l'emplacement que votre systeme attend :

| Systeme | Emplacement |
|---|---|
| Windows | une cle de registre : `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.free_games_claimer.bridge`, dont la valeur par defaut est le chemin du JSON |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` |

### 4. Envoyer

Dans la page **Ma collection**, bouton **Envoyer vers la passerelle**. Le
navigateur demande alors la permission, une seule fois. Le fichier atterrit par
defaut dans votre dossier personnel, sous le nom
`free-games-claimer-snapshot.json`.

Pour le poser ailleurs, donnez un chemin en argument dans le `path` de l'hote,
ou dans le `.bat`.

## Ce que le fichier contient

```json
{
  "protocol": 1,
  "at": 1790000000000,
  "owned":    [{ "store": "gog", "id": "1207", "title": "Tyranny", "kind": "game" }],
  "claimed":  [{ "store": "epic", "id": "x", "title": "Cardpocalypse", "at": 1780000000000 }],
  "missed":   [{ "store": "gog", "id": "y", "title": "Un jeu rate", "at": 1770000000000 }],
  "playtime": { "620": 34.6 }
}
```

`protocol` accompagne chaque envoi, et pas seulement cette page : un outil qui
lit ce fichier doit pouvoir REFUSER un format qu'il ne connait pas, plutot que
d'en deviner les champs.

`playtime` est en heures, et seulement pour Steam : c'est le seul magasin a
publier un temps de jeu lisible. Une valeur `null` veut dire « jamais lance »,
ce qui n'est pas la meme chose que zero.

## Si rien ne se passe

Le navigateur est avare en messages sur ce canal. Dans l'ordre des causes
reelles :

1. **`allowed_origins` sans la barre oblique finale.** C'est la premiere, et de
   loin.
2. **Le nom du fichier JSON different du champ `name` qu'il contient.** Les
   deux doivent dire `com.free_games_claimer.bridge`.
3. **Sous Windows, `path` qui designe le `.mjs` au lieu du `.bat`.**
4. **Chrome pas redemarre** apres la creation de la cle de registre.
