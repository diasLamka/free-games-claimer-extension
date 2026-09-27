# Le relais PC <-> telephone

L'extension et l'appli Android recuperaient chacune de leur cote. Deux
consequences : un jeu pris sur le telephone etait retente par le PC (au mieux
un onglet pour rien, au pire deux pages pilotees en meme temps sur le meme
compte), et aucun des deux ne savait ce que l'autre avait fait.

Le relais les fait se parler. **Celui qui est allume recupere** ; l'autre le
sait, et ne recommence pas.

## Ce qui ne change pas

- Aucun serveur a nous. Le transport est ntfy, que l'extension utilise deja
  pour les alertes : le serveur public `https://ntfy.sh` ou celui de
  l'utilisateur.
- Chaque appareil garde ses propres sessions de magasin. Aucun cookie, aucun
  code de rachat, aucun identifiant de compte ne passe par le relais.
- Coupe par defaut. Il s'allume en associant les deux appareils.

## L'association

Le PC tire un secret de 32 octets au hasard et l'affiche en QR code, avec sa
forme texte (a copier si le telephone n'a pas de camera utilisable) :

    FGC1-<secret en base64url, 43 caracteres>
    FGC1-<secret>@https://ntfy.example.org     (serveur prive)

Tout le reste se deduit du secret, a l'identique des deux cotes :

    sujet = "fgcr-" + hex(SHA-256("fgc-relais/sujet/" + secret))[0:32]
    cle   = SHA-256("fgc-relais/cle/" + secret)            (AES-256-GCM)

`secret` est ici la forme base64url du texte. Le sujet ne revele pas la cle :
ntfy voit un nom tire au hasard, jamais le secret.

## Les messages

Chaque message est un objet JSON, chiffre de bout en bout :

    corps = "fgc1." + base64url(nonce(12) || chiffre || etiquette(16))
    AES-256-GCM, donnee associee = le sujet (UTF-8)

Un message chiffre pour un autre sujet ne s'ouvre pas ici. Le clair :

    { "v": 1, "dev": "a1b2c3d4", "role": "pc" | "phone",
      "type": "claimed" | "lock" | "alive" | "help", "ts": 1790000000000,
      "games": [ { "s": "epic", "i": "hades", "t": "Hades",
                   "at": 1790000000000, "st": "claimed",
                   "w": "24,99 EUR", "u": "https://...", "until": 1790000600000 } ],
      "stores": { "epic": "ok", "gog": "logged_out" } }

- `claimed` : un ou des jeux viennent d'etre obtenus (`st` = claimed ou
  redeemed). Le recepteur les inscrit dans son registre, marques comme venus
  de l'autre appareil : ils ne seront plus retentes.
- `lock` : l'appareil commence ce jeu. L'autre ne le tente pas avant `until`
  (dix minutes au plus apres `ts` ; au-dela, le verrou est ignore).
- `alive` : un signe de vie, avec les derniers jeux obtenus (quinze au plus)
  et l'etat des sessions. C'est lui qui rattrape un appareil reste eteint :
  ntfy.sh ne garde les messages que douze heures.
- `help` (2.89.0 / appli 1.4.0) : une verification humaine (captcha) arrete
  l'appareil sur ces jeux. Le recepteur garde la demande jusqu'a `until` (un
  jour au plus apres `ts`), ou jusqu'a ce que le jeu soit obtenu, ici ou
  la-bas. Le telephone qui la recoit appelle l'humain (notification, bandeau
  « Le PC a besoin de toi ») ; le jeu se finit SUR LE TELEPHONE, avec sa
  propre session -- rien n'est resolu a distance. Le PC qui la recoit efface
  le recul de ces offres : il les tente a son cycle suivant.

Un type inconnu est ignore : un appareil plus ancien ne casse pas.

## Le lien de l'appli

L'alerte ntfy d'un defi (quand le relais est associe) porte, comme lien a
toucher, celui de l'appli :

    fgclaimer://finir?s=<magasin>&i=<identifiant>&t=<titre>

encode comme `URLSearchParams` (`appLink`, `Relay.appLink` ; vecteur commun
dans `test/fixtures/relais.json`, champ `appLink`). Il DESIGNE un jeu, rien de
plus : l'appli le cherche dans ses propres offres, ne suit jamais une adresse
venue du lien, et demande avant d'agir. N'importe quelle page peut ouvrir ce
lien ; au pire, elle fait poser une question sur un jeu gratuit connu.

Un message de son propre `dev` est ignore. Un message de plus de sept jours
aussi. Le corps chiffre tient sous 4 000 caracteres : `alive` retire ses liens,
puis ses jeux les plus anciens, jusqu'a y tenir.

## Le transport

    publier : POST {serveur}/{sujet}, corps = le message chiffre,
              en-tete X-Firebase: no (rien ne part vers Firebase)
    lire    : GET  {serveur}/{sujet}/json?poll=1&since={dernier id | 12h}

Sans cookies, sans jeton. L'extension demande l'acces a l'origine du serveur
au moment de l'association (permission facultative), comme pour les alertes.

## Qui lit quand

- Extension : au debut de chaque cycle, avant de choisir quoi reclamer ; un
  `lock` avant chaque reclamation ; un `claimed` apres chaque succes ; un
  `alive` au plus une fois par heure.
- Appli : a chaque passage de la veille (fond ou ecran), avant de recuperer ;
  memes messages, memes moments.

## Ce qui reste local

Le secret vit dans le stockage local de l'extension (jamais synchronise,
jamais dans une sauvegarde) et, sur le telephone, dans un fichier chiffre par
une cle du Keystore Android (jamais dans l'export). Dissocier efface le
secret des deux cotes ; l'autre appareil cesse d'etre lu.

## Ce que voit ntfy

Le nom du sujet, l'heure et la taille des messages, l'adresse IP de chaque
appareil. Pas les titres, pas les magasins, pas les dates : tout est chiffre.
