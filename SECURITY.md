# Vos donnees

Ce fichier repond a une question posee le 2026-09-19 : « tout est chiffre, ou
sauvegarde de mon cote ? » La reponse courte tient en deux phrases.

**Rien n'est chiffre par l'extension. Tout vit chez vous.**

Ce qui suit dit exactement quoi, ou, et ce qui sort de la machine. Chaque
affirmation renvoie au code qui la porte, pour qu'elle reste verifiable quand
ce fichier aura vieilli.

## Ce qui est stocke, et ou

Tout est dans `chrome.storage.local` -- une base LevelDB **en clair** dans le
repertoire de profil du navigateur. Qui peut lire ce repertoire peut tout
lire.

| Espace | Cles | Contenu |
|---|---|---|
| Veille | `veille:*` (43 cles, `watch/storage.js`) | Catalogue d'offres, sante des sources, histogrammes de prediction, reglages, filtres, journal de 500 entrees, bibliotheque reclamee, collection importee, taux de change, issues des offres terminees (1000 au plus), incidents ouverts, liste de souhaits saisie, listes de souhaits Steam et GOG importees (identifiants et noms, 2000 au plus chacune), backlog, alerte telephone (adresse du sujet, jeton eventuel, dernier envoi), position du bouton sur les pages de magasin, dernier essai a blanc (ce que chaque page a montre), date du dernier recap du jeudi, codes deja rappeles avant leur date limite (le code et le niveau du rappel, rien d'autre), week-ends gratuits Steam en cours (titre, dates, prix public), fichiers de la sauvegarde automatique (nom, numero de telechargement, date, taille), notes Steam des jeux vus (appid, echelle, nombre d'avis positifs et total, 400 au plus), jaquettes de « Deja recupere » (titre normalise, adresse de l'image Steam, appid, 600 au plus), le dernier depart en vacances deja resume (sa date de fin), les DLC gratuits de vos jeux Steam (depuis la 2.92.0 : pour chaque jeu lu, la liste de ses DLC sans prix ; pour chaque DLC verifie, son nom, son jeu, gratuit et sorti ou non ; les appids que vous possedez sur Steam, relus au plus toutes les six heures), les chances de vos souhaits (depuis la 2.94.0 : pour chaque souhait, sa fiche Steam -- appid, date de sortie, prix de catalogue, editeurs -- gardee trente jours) et les editeurs qui offrent des jeux (le nom du vendeur de chaque offre Epic vue, et les titres qu'il a offerts, 1500 editeurs au plus), et pour « Ce soir je joue a... » (depuis la 2.95.0) : pour chaque jeu de la pile, son format, sa note, sa categorie Steam Deck et sa vignette, gardes soixante jours, et l'appid trouve pour les titres hors Steam |
| Moteur | `FGC_*` (`content/gm-shim.js`, `src/core/`) | **Codes de rachat en attente**, historiques par plateforme, arret d'urgence, bascules, pays et langue, libelles de boutons appris et refuses |

Trois cles vivent dans `chrome.storage.session` et disparaissent a la
fermeture du navigateur : le verrou de cycle, les liens de notification, et la
liste des onglets pilotes.

## Ce qui peut quitter la machine

**Quatre choses, chacune coupee par defaut et par son propre interrupteur.**

Le reglage `syncCodes` (Reglages -> Sauvegarde, `watch/storage.js`) recopie
les codes en attente dans `chrome.storage.sync`, qui transite par votre compte
navigateur. Le chiffrement applique est alors celui de Chrome Sync ou de
Firefox Sync -- **pas le notre**, puisque nous n'en avons aucun.

Le reglage `syncLibrary` (meme section, depuis la 2.43.0) y recopie le
registre des jeux recuperes, reduit a quatre champs : magasin, identifiant,
titre, date (`watch/library-sync.js`). Aucun code, aucune valeur, aucun lien.
Il sert a ce qu'un autre ordinateur du meme compte ne rouvre pas ce qui est deja
pris. Le couper retire la copie du compte.

L'**alerte telephone** (Reglages -> Notifications, depuis la 2.47.0,
`watch/phone.js`) envoie a un serveur ntfy -- `ntfy.sh` par defaut, ou le
votre -- un titre et quelques lignes : une panne de l'extension, un defi de
securite en attente, le nom d'un jeu de votre liste de souhaits et le lien de
sa fiche, et depuis la 2.65.0 le recap du jeudi -- des titres de jeux et une
valeur, rien d'autre. **Jamais un code de rachat, jamais un cookie** (`credentials:
'omit'`). Sur `ntfy.sh`, qui connait le nom du sujet lit ces messages : le
bouton « Nouveau sujet » en tire un au hasard (cent bits). L'adresse et le
jeton vivent sous leur propre cle, `veille:telephone`, et non dans les
reglages -- que l'option de synchronisation des reglages recopierait dans le
compte du navigateur. Couper l'alerte retire aussi la permission de l'hote.

Depuis la 2.71.0, les memes alertes peuvent partir vers **un salon Discord**
(par l'adresse d'un webhook, `discord.com`) ou **Telegram** (par un bot a vous,
`api.telegram.org`) au lieu de ntfy. Meme contenu, memes moments, et le meme
sort pour le secret : l'adresse du webhook et le jeton du bot -- qui suffisent
a ecrire dans le salon ou au nom du bot -- vivent sous `veille:telephone`, ne
vont jamais au journal ni dans l'etat que lit le popup, et l'hote n'est
demande qu'une fois la configuration complete. Le texte part en JSON, sans
mention possible cote Discord (`allowed_mentions` vide) et sans mise en forme
interpretee cote Telegram : un titre de jeu ne peut ni appeler tout un salon
ni casser un balisage.

Le **rappel des codes** (2.73.0) previent sept jours avant la date limite
d'un code en attente, puis le dernier jour -- a l'ecran, et au telephone si
l'alerte est active. Il nomme le jeu, le magasin et la date ; **jamais le
code**, qui reste dans l'onglet Codes. Un test le verifie sur ce qui part
vraiment.

Le **relais avec le telephone** (2.87.0, `watch/relay.js`) fait se parler
l'extension et l'appli Android, par ntfy -- `ntfy.sh` par defaut. Il part :
un verrou avant chaque reclamation, « obtenu » apres chaque succes, un signe
de vie par heure avec les quinze derniers jeux obtenus -- magasin,
identifiant, titre, date, valeur, lien de la fiche. **Tout est chiffre de bout
en bout** (AES-256-GCM, cle et sujet tires d'un secret de 32 octets partage
par QR code, sujet en donnee associee) : ntfy voit un nom de sujet tire au
hasard, l'heure et la taille des messages, les adresses IP, jamais leur
contenu. **Jamais un cookie, un code de rachat ni un identifiant de compte.**
Le secret vit sous `veille:relais`, jamais synchronise, **jamais dans une
sauvegarde** (un test le verifie) ; sur le telephone, il est chiffre par une
cle du Keystore Android. Les messages recus sont relus champ par champ ; un
message de plus de sept jours, ou venant de soi-meme, est ignore ; un verrou ne
dure pas plus de dix minutes. Le protocole est ecrit dans
`docs/specs/2026-09-26-relais-design.md`.

Rien d'autre ne part tout seul.

**L'agenda (2.46.0) est un fichier que vous telechargez**, pas un envoi : le
bouton « Agenda (.ics) » ecrit sur votre disque les fins d'offres, les offres
annoncees et le dernier jour des codes a echanger. Importe dans un agenda
synchronise, ce qu'il contient part avec -- titres, magasins, dates, liens.
**Jamais un code de rachat** : ni dans le texte, ni dans l'identifiant de
l'evenement, qui n'en porte qu'une empreinte de 32 bits (`watch/calendar.js`).

## Ce qui part sur le reseau, et vers qui

### Sans vos cookies (`credentials: 'omit'`)

| Destination | Ce qu'elle apprend de vous |
|---|---|
| API publique Epic (`store-site-backend-static.ak.epicgames.com`) | Votre pays et votre langue, choisis dans le popup |
| API de decouverte mobile d'Epic (`egs-platform-service.store.epicgames.com`) | **Seulement si vous suivez « Epic Games (mobile) »** (2.57.0). Votre pays et votre langue, et la plateforme demandee (Android, iOS) -- pas la votre : l'extension demande les deux. Au plus une fois toutes les trois heures |
| `www.gog.com` (catalogue filtre) | Rien. Anonyme **deliberement** : connecte, GOG masque ce que le compte possede deja, et la veille croirait l'offre terminee |
| `www.gamerpower.com` | Rien |
| `store.steampowered.com` (recherche, et depuis la 2.75.0 la page d'accueil, au plus toutes les six heures, pour les week-ends gratuits ; depuis la 2.78.0 la note des jeux offerts : le TITRE du jeu pour le trouver, puis son identifiant pour lire ses evaluations -- huit jeux au plus par passage, chacun une fois par semaine, coupable dans Reglages -> Magasins -- et, depuis la 2.82.0, le titre de la fiche Epic ou GOG que vous ouvrez, pour en montrer la note dans le panneau ; depuis la 2.81.0 la jaquette des jeux de « Deja recupere » que ni le catalogue ni le registre ne connaissent : le TITRE de chaque jeu affiche, une fois pour toutes ; depuis la 2.92.0 les DLC gratuits de vos jeux : `api/dlcforapp` pour huit de vos jeux Steam par passage, chacun une fois par mois, puis `api/appdetails` pour huit DLC au plus -- coupable dans Reglages -> Magasins ; depuis la 2.94.0 les chances de vos souhaits : le TITRE de huit souhaits au plus par heure pour trouver leur fiche, puis leur `api/appdetails`, chacun une fois par mois ; depuis la 2.95.0, pour « Ce soir je joue a... », le TITRE de huit jeux hors Steam de votre pile par heure au plus, pour trouver leur fiche), `api.steampowered.com` (confirmation ; depuis la 2.95.0 aussi les etiquettes, la note et la categorie Steam Deck des jeux de votre pile, cent identifiants par heure au plus, chacun tous les deux mois -- coupable dans Reglages -> Magasins) | Les identifiants des jeux candidats, votre pays, votre langue. Sans cookie. La liste de ce que vous possedez (`dynamicstore/userdata`), elle, part avec votre session Steam, comme pour l'import de Ma collection, au plus toutes les six heures. **Depuis la 2.27.0, pour tout le monde** : la detection Steam ne depend plus de l'option de reclamation. Voir la note ci-dessous |
| `api.frankfurter.dev` | Votre devise, une fois par 24 h. Le seul hote qui ne soit pas une boutique de jeux |
| Votre serveur ntfy (`ntfy.sh` par defaut), ou `discord.com`, ou `api.telegram.org` | **Seulement si vous activez l'alerte, vers le service choisi.** Le texte de l'alerte, votre adresse IP, et le jeton ou l'adresse secrete du service. Rien d'autre |

**Regarder Steam et y cliquer sont deux choses, depuis la 2.27.0.** La source
Steam etait jusque-la liee a l'option de reclamation : qui refusait le clic --
le cas par defaut, volontairement -- ne voyait de Steam que ce que l'agregateur
en dit. Elle est desormais interrogee pour tout le monde, mais uniquement par
sa **recherche publique, sans cookie**. Lire ce que le compte possede en
demande, et cela reste conditionne a l'option de reclamation, qui en a besoin
pour ne pas reclamer deux fois. Le reglage qui commande cette lecture est
transmis a chaque cycle (`withOwned`, `watch/cycle.js`) et se compare a `true`,
jamais a la veracite.

Une exception a connaitre : pendant un **import de collection Steam**, les
identifiants de **tous** vos jeux -- et, depuis la 2.46.0, ceux de votre liste
de souhaits -- partent par lots de 50 vers `api.steampowered.com` pour en
recuperer les noms. Sans cookie, et seulement sur un clic de votre part. La
liste de souhaits elle-meme n'ajoute aucune requete avec cookie : elle voyage
dans la reponse de `dynamicstore/userdata` que l'import lisait deja. Celle de
GOG (2.66.0) en ajoute une, au meme moment et au meme hote que la
bibliotheque GOG : `www.gog.com/account/wishlist/search`, avec vos cookies,
page apres page. Elle ne part qu'avec l'import GOG.

### Avec vos cookies (`credentials: 'include'`)

Uniquement vers **le magasin concerne lui-meme**, jamais vers un tiers :
`store.steampowered.com` (ce que vous possedez), `www.gog.com` et
`accounts.epicgames.com` (import de collection, sur clic). Toutes sont des
`GET`, sans corps, avec `Accept: application/json` pour seul en-tete.

La **sonde de session** (2.25.0, bouton « Verifier les sessions ») emprunte
les memes adresses, en demandant le moins possible : une seule page, jamais
la pagination. Elle part **sur un geste**, comme l'import -- l'extension ne
lit jamais un compte de sa propre initiative. C'est pour tenir cette phrase
qu'une fonction de sonde automatique, ecrite puis relue, a ete retiree avant
d'etre livree (voir le commentaire en fin de `watch/session.js`).

**Tester la recuperation** (2.64.0) ouvre, sur un geste lui aussi, la page
d'un jeu offert dans chaque magasin reclame, avec votre session -- comme vous
le feriez en la visitant. Le moteur recoit l'ordre `fgc-inspecte`, jamais
`fgc-reclame`, et ce bloc du moteur ne contient aucun clic, ce qu'un test
verifie ; Steam rejoue son etape en `dryRun`. L'arret d'urgence l'empeche de
partir. La fenetre reduite est refermee apres chaque magasin.

### Fuite passive a connaitre

Le popup affiche les vignettes des offres depuis les CDN d'Epic, GOG, Steam et
GamerPower. A chaque ouverture, ces CDN recoivent votre adresse IP et savent
quels jeux vous sont presentes. Ce n'est pas une requete de l'extension, c'est
un `<img>` -- mais l'effet est le meme, et il vaut d'etre dit.

Depuis la 2.63.0, une notification d'offre montre la jaquette du jeu : le
service worker la telecharge au moment d'annoncer l'offre (Chrome n'accepte
pas d'image distante dans une notification). C'est la meme image, sur le meme
CDN, que le popup affiche : sans cookies, sans referent, en https seulement,
4 Mo au plus, abandonnee apres 5 secondes. Le CDN apprend donc aussi quand
une offre vous a ete annoncee.

### Ce que la page d'un magasin peut voir

Sur une page de magasin, le bouton de l'extension (`content/launcher.js`)
affiche ce qu'elle sait du jeu -- dont ce que vous possedez sur les AUTRES
magasins -- et ou en est le moteur. Jusqu'a la 2.47.0 le bandeau des fiches
vivait dans le DOM ordinaire de la page : les scripts du magasin, et les
outils d'enregistrement de session qu'il embarque, pouvaient le lire. Depuis
la 2.48.0 il vit dans une racine d'ombre **fermee** : la page voit qu'un
element existe, pas ce qu'il dit. Depuis la 2.51.0 l'etat du moteur et ses
boutons y vivent aussi ; avant, ils s'ecrivaient dans la page avec une
feuille de style injectee. Le moteur ne laisse plus rien dans le DOM de la
page.

Depuis la 2.62.0, le panneau montre aussi ce qui est gratuit en ce moment,
avec les vignettes des offres. Ces images sont chargees PAR LA PAGE du
magasin : son texte reste illisible pour elle, mais elle peut voir, dans ses
propres mesures de chargement, quelles images ont ete demandees -- donc quels
jeux gratuits la liste affiche. Ce sont les offres publiques du moment, les
memes pour tout le monde, pas votre bibliotheque. Les images partent sans
referent (`no-referrer`) : le CDN d'un magasin n'apprend pas quelle page vous
lisiez. Et une adresse qui n'est pas https n'est ni affichee, ni suivie.

Depuis la 2.67.0, le bouton est la sur TOUTES les pages des magasins couverts
-- Steam, Epic, GOG, Luna --, meme quand il n'a rien a dire de la page ;
jusque-la, il n'apparaissait que la ou le moteur tournait ou sur une fiche
connue de l'extension. Consequence a connaitre : chacun de ces magasins peut
constater, sur n'importe laquelle de ses pages, qu'un element etranger est
pose dans son document, donc qu'une extension de ce genre est installee. Il
n'en lit toujours pas le contenu, et aucune permission n'a ete ajoutee :
`store.steampowered.com` etait deja un hote autorise.

## Ce que l'extension ne fait pas

- **Aucune telemetrie.** Pas d'identifiant d'installation, pas de rapport
  d'erreur distant, pas de ping de demarrage. Les erreurs vont dans le journal
  local (`pages/journal.html`) et nulle part ailleurs.
- **Aucun serveur.** C'est un non-objectif ecrit du design : « mettre en commun
  des donnees entre utilisateurs, ou dependre d'un serveur propre ».
- **Aucun mot de passe, aucun jeton d'authentification, aucun cookie stocke.**
  L'extension n'a meme pas la permission `cookies` : elle ne peut pas en lire
  un. Les sessions sont utilisees de facon ambiante par le navigateur.
- **Aucune ressource distante dans ses pages.** Pas de police, pas de script,
  pas de feuille de style tierce.
- **Aucune mise a jour venue d'ailleurs que de votre dossier.** Installee depuis
  un dossier, l'extension se recharge quand une version plus recente y arrive
  (2.53.0) : elle relit son propre `manifest.json` sur le disque, rien d'autre,
  et ne telecharge rien. C'est `tools/maj-auto.ps1`, s'il est installe, qui
  fait le `git pull` -- avec votre git, depuis le depot que vous avez clone, et
  jamais en ecrasant un fichier modifie a la main.
- **Les declencheurs de mise a jour ne transportent aucune commande** (2.54.0).
  Le bouton du popup envoie `{ cmd: 'maj' }` au relais local, qui refuse tout
  autre message et n'accepte que l'identifiant de cette extension ; la
  sonnette ntfy ne transporte que le numero du commit, que l'ecouteur ne lit
  meme pas. Qui connaitrait le sujet ntfy pourrait tout au plus provoquer un
  `git pull` de plus -- une fois par minute au maximum -- depuis VOTRE depot.
  Le sujet est un nom au hasard de 20 caracteres, garde dans
  `%LOCALAPPDATA%\FreeGamesAutoClaimer\sujet.txt` et dans le secret GitHub
  `MAJ_NTFY`. Tout est pose sous `HKCU` : aucun droit d'administrateur.

## Votre donnee la plus sensible : les codes de rachat

Un code de rachat est un **porteur** : qui l'a, l'utilise. Ils vivent dans
`FGC_pending_codes`, en clair, et ils sont aussi :

- copies dans le **presse-papiers systeme** a la capture, donc lisibles par
  toute application du poste ;
- inclus **en clair dans l'export JSON**, qui atterrit dans votre dossier de
  telechargements.

Depuis la 2.74.0, ce meme fichier est une **sauvegarde complete** : registre
des jeux recuperes, historiques du moteur, issues, listes de souhaits,
collection importee, libelles appris, preferences, et depuis la 2.95.0 l'etat
de chaque jeu de Ma collection (a essayer, en cours, fini, abandonne, pas pour
moi) et sa note. Il se garde donc comme un
carnet de codes. Il n'emporte PAS l'alerte du telephone -- adresse ntfy,
webhook Discord, jeton Telegram --, qui suffit a ecrire a votre place. A la
restauration, le fichier est traite comme une entree non fiable : le service
worker relit chaque cle avec sa forme, fusionne sans rien ecraser, refait
passer chaque libelle appris par la garde des montants, et ne rallume jamais
la recuperation Steam.

La **sauvegarde automatique** (2.77.0, coupee par defaut) depose ce meme bloc
chaque semaine dans `Telechargements/free-games-claimer/` et garde les quatre
derniers fichiers : quatre carnets de codes au lieu d'un, sur le disque, en
clair. C'est le prix d'une sauvegarde qu'on n'oublie pas de faire ; le
telephone n'y est pas non plus.

Depuis la 2.24.0 ils ne sont plus recopies dans `FGC_history_*`, un historique
que rien ne purge et que l'export emporte : l'historique garde le fait, plus
le secret.

**Ils ne sont volontairement pas chiffres.** Le raisonnement : qui a acces a
votre profil navigateur a deja vos cookies de session Steam, GOG et Epic --
donc deja vos comptes. Chiffrer les codes seuls deplacerait la serrure sans
changer la porte, au prix d'une phrase secrete a saisir. **Le vrai levier est
le chiffrement de disque de votre systeme** (BitLocker, FileVault, LUKS).

**Ils ne sont pas non plus purges automatiquement.** Un code supprime a tort
est un jeu perdu, et l'onglet Codes affiche deja les jours restants : c'est
vous qui decidez.

## Les permissions, et pourquoi

| Permission | Pourquoi |
|---|---|
| `storage` | Tout ce qui precede |
| `notifications` | Annoncer une offre, un defi de securite |
| `clipboardWrite` | Copier un code. **C'est aussi par la qu'un code arrive dans le presse-papiers systeme** |
| `scripting` | Le clic Steam, les sondes de diagnostic. Bornee aux hotes ci-dessous |
| `activeTab` | Le scanner de page (2.91.0) : « Cette page » dans le popup lit l'onglet ouvert -- ses liens, ses titres, son texte -- UNE fois, sur ce clic, pour dire quels jeux il cite et ce que vous en avez. Aucun acces permanent a aucun site, aucune installation de script ; Chrome ne l'annonce pas. Rien de ce qui est lu ne quitte la machine ni n'est garde |
| `offscreen` | Lire du HTML : un service worker MV3 n'a pas de `DOMParser`. Absente sur Firefox |
| `alarms` | Se reveiller pour verifier |
| `contextMenus` | Le clic droit « Me prevenir quand ce jeu sera gratuit » (2.79.0), sur les seules fiches Steam, Epic et GOG et les liens qui y menent. N'ouvre l'acces a rien -- Chrome ne l'annonce meme pas. Sur une fiche, le titre est lu par `scripting` sur un hote deja autorise ; sur un lien, rien n'est lu dans la page qui le porte : le nom vient de l'adresse |
| `steamcommunity.com` (hote) | **Optionnel** (`optional_host_permissions`). Lire VOTRE temps de jeu Steam, sur un clic, par l adresse /my/ qui se resout cote serveur -- aucun identifiant de profil n est demande ni stocke. Demande au moment du geste, retirable ensuite. De la 2.39.0 a la 2.46.0 il n etait declare nulle part, et Chrome refusait la demande : le temps de jeu ne s est jamais lu |
| `https://*/*` (hote) | **Optionnel, jamais accorde a l installation.** Seulement pour l alerte telephone : l extension demande l hote du service choisi, et lui seul -- VOTRE serveur ntfy (`https://ntfy.sh/*` par defaut), `https://discord.com/*` ou `https://api.telegram.org/*` --, au moment ou vous activez l alerte. Le joker existe parce que le serveur est le votre ; il ne donne rien que vous n ayez accorde hote par hote |
| `nativeMessaging` | **Optionnelle, coupee par defaut, Chrome seulement.** Ouvrir un canal vers un programme LOCAL que vous avez installe vous-meme, pour lui deposer un instantane de votre ludotheque ; et, depuis la 2.54.0, pour demander au relais de mise a jour (`tools/maj-auto.ps1`) de faire le `git pull` du dossier. Rien n ecoute sur un port, rien ne quitte la machine, et **les codes de rachat n y sont pas**. Voir host/README.md |
| `downloads` | **Optionnelle, coupee par defaut, Chrome seulement** (2.77.0). Deposer la sauvegarde de la semaine dans Telechargements et effacer la plus ancienne des cinq. Chrome l annonce comme « Gerer vos telechargements » : elle permettrait aussi de LIRE la liste de vos telechargements. L extension n y cherche que ses propres fichiers, par le numero que Chrome lui a rendu en les creant (`watch/auto-backup.js`), et n efface que ceux-la. Demandee sur un geste, retiree du meme geste -- et c est elle, pas un reglage, qui allume la sauvegarde automatique |
| `background` | **Optionnelle, coupee par defaut, Chrome seulement.** Garder la veille active apres la fermeture de la derniere fenetre. Demandee sur un geste, retirable du meme geste. Absente du manifeste Firefox, qui ne l implemente pas |

La cle `omnibox` du manifeste (2.85.0) n'est pas une permission : elle
reserve le mot-cle « fg » dans la barre d'adresse. L'extension ne voit ce qui
y est tape qu'APRES « fg » et un espace, et n'en fait rien d'autre que
chercher dans son propre stockage.

**Ce qui est absent, et c'est le point** : pas de `tabs`, pas de `cookies`,
pas de `webRequest`, pas de `identity`, pas de `history`, pas de
`<all_urls>`. L'extension ne peut pas lire l'URL de vos onglets. `downloads`
n'est plus dans cette liste depuis la 2.77.0, mais seulement en optionnelle :
tant que vous n'activez pas la sauvegarde automatique, l'extension ne voit
pas vos telechargements.

Les 26 `host_permissions` couvrent Epic, GOG, les 15 domaines Luna, GamerPower,
Steam et l'API de taux de change. Deux sont plus larges que le strict besoin,
et c'est assume : `https://*.epicgames.com/*` (le joker couvre `store.`, `www.`
et `accounts.`, requis par l'import de commandes) et
`https://gaming.amazon.com/*` (sans restriction de chemin, contrairement aux
entrees Luna bornees a `/claims/*`).

## Ce qui protege le code lui-meme

Deux audits complets, le 2026-09-19. Ils n'ont trouve **aucun chemin
exploitable**, et les raisons valent d'etre ecrites pour qu'on ne les casse
pas :

- **Zero `innerHTML`** dans les ~200 Ko de script de contenu genere, les 34
  modules de `src/core`, les modules `watch/` et les cinq pages. Une seule
  ecriture dans tout le depot, et c'est `= ''`. Tout le DOM se construit par
  noeuds et `textContent`.
- **CSP MV3 par defaut intacte** (`script-src 'self'`) : aucun `eval`, aucun
  `new Function`, aucun script en ligne, aucun script distant.
- **Pas d'`externally_connectable`, pas de `web_accessible_resources`** :
  aucune page web ne peut parler a l'extension, ni detecter sa presence.
- **Script de contenu en monde isole** : les passerelles `GM_*` sont hors de
  portee du JavaScript des pages.
- **`DOMParser` inerte** pour tout le HTML distant, sans cookies : les scripts
  d'une page lue ne s'executent jamais.
- **Liste blanche de schemas** (`webUrl`, `watch/offer.js`) plutot que liste
  noire : une URL d'origine distante n'atteint un onglet ou un `href` que si
  elle est en `http(s)`.
- **Aucune police chargee depuis le web** : Space Mono et Archivo Black
  (licence OFL) sont dans le paquet, sous `pages/fonts/`. Ouvrir le popup ne
  previent aucun serveur de polices.

La 2.24.0 a ferme quatre faiblesses de defense en profondeur -- aucune
joignable depuis le web, toutes reelles : le relais reseau du service worker
etait un proxy ouvert, l'ouverture d'onglet ne verifiait aucun schema, les
seize commandes du worker ne regardaient pas qui les demandait, et les URL de
collection echappaient au filtre. Voir `watch/messaging.js` et
`test/messaging.test.mjs`.

## L'appli Android (`android/`)

L'appli suit les memes regles, avec une difference de taille : sur le
telephone, c'est **l'appli** qui garde les sessions des magasins.

- **Les sessions** (cookies d'Epic, GOG, Amazon, Steam) vivent dans le
  stockage de la WebView de l'appli, sur le telephone, apres une connexion
  faite A LA MAIN dans une page de l'appli. Elles ne servent qu'a recuperer, et
  a deux lectures de compte : `dynamicstore/userdata` chez Steam (ce qui est
  possede) et `userData.json` chez GOG (connecte ou non). Aucune source de
  decouverte ne les envoie. « Se deconnecter de tous les magasins » les efface.
- **Aucune sauvegarde du telephone ne les emporte** : `allowBackup` est a
  false et les regles d'extraction excluent tout (`AndroidManifest.xml`,
  `res/xml/data_extraction_rules.xml`).
- **Le moteur n'est injecte que sur les magasins** qu'il connait -- les memes
  origines que les scripts de contenu du manifeste --, et seulement dans la
  page de recuperation, jamais dans les pages de connexion. Il ne peut
  demander au reseau que des API publiques de magasins (`fetchFor`,
  `claim/ClaimSession.kt`).
- **L'export pour l'extension** contient le registre des jeux recuperes, les
  souhaits, le pays et l'historique du moteur. Jamais un cookie, jamais un
  code de rachat : les codes restent dans l'extension.
- **La cle qui signe l'APK** est dans `android/keystore/`, parce que le depot
  est prive et qu'une mise a jour doit porter la meme signature que la version
  installee. Si le depot devenait public, elle en sortirait (secret du
  workflow) : qui la detient peut signer une « mise a jour » de l'appli.

- **Google et Facebook** interdisent leur connexion dans une page integree a
  une appli : la page de connexion s'arrete avant de les charger
  (`Accounts.refusedProvider`). Aucun identifiant d'une autre application
  (les clients OAuth internes d'Epic, par exemple) n'est emprunte.
- **La recuperation ecran eteint** (1.2.0, coupee par defaut) est une tache
  de fond ordinaire, sans fenetre par-dessus les autres applis ni service de
  premier plan ; un captcha n'y est jamais resolu, il part en notification.
- Le detail des regles d'Android et de Google Play suivies :
  `android/CONFORMITE.md`.

## L'anti-doublon sur les fiches (2.87.0)

`content/owned-guard.js` lit le titre de la fiche d'un jeu (Epic, GOG, Steam,
et -- seulement si vous les cochez, chacune avec sa permission facultative --
Humble Bundle, Fanatical, Green Man Gaming, Gamesplanet, IndieGala) et
demande au worker si vous le possedez ailleurs. Il n'ecrit rien, ne clique
rien, n'envoie rien au reseau ; son bandeau vit dans une racine fantome
fermee, que la page ne peut ni lire ni restyler. Le message `fgc-owned-guard`
n'est accepte que d'un script de contenu (`watch/messaging.js`), et le worker
lit l'adresse de la page dans `sender.tab`, pas dans le message.

## Signaler un probleme

Ouvrez une issue sur le depot. Si le sujet est sensible, dites-le sans detail
public : on conviendra d'un canal.
