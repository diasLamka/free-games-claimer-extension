# Free Games Auto-Claimer -- extension Chrome / Firefox

Recuperation automatique des jeux gratuits sur Epic Games Store, GOG et Amazon
Luna, et reperage sur Steam. Extension Chrome / Edge / Firefox (Manifest V3),
en francais, anglais, allemand et espagnol.
Le userscript Tampermonkey d'origine n'est plus produit depuis la 2.48.1 : son
moteur tourne desormais dans l'extension, par `content/gm-shim.js`.

Ce qui n'est pas encore fait, et pourquoi, est dans `ROADMAP.md`.

## Le moteur est genere

`content/free-games-claimer.js` **ne s'edite pas a la main**. Il est produit a
partir de `src/core/*.js` :

```
npm run build     # regenere les artefacts
npm run verify    # controle de non-regression (voir plus bas)
npm test          # build + tests unitaires
npm run check     # verify + test, a lancer avant de livrer
npm run package   # les deux archives publiables, dans dist/
npm run preview   # le vrai popup dans un navigateur, sur des donnees de demo
                  #   -- --chrome : une copie EN LECTURE de vos donnees Chrome
```

Les modules de `src/core` sont concatenes dans l'ordre de leur nom et vivent
tous dans **une seule portee** : l'IIFE est ouverte par `00-prologue.js` et
fermee par `99-epilogue.js`. Un module pris isolement n'est donc pas un script
valide, et le prefixe numerique est significatif.

Ce choix a une raison : il permet de decouper un fichier de 2750 lignes sans
reecrire un seul appel de fonction, donc sans risque de regression.

### Le controle de non-regression

`build/references/reference.json` designe une copie figee du moteur (`build/references/reference-v*.js`).
`npm run verify` reconstruit ce fichier a partir des modules et compare les
SHA256. Tant que les modules ne sont pas modifies, la reconstruction doit etre
**identique au bit pres**.

Une copie figee ne se modifie jamais. Quand une modification volontaire du moteur
fait diverger la reference, on en fige une nouvelle, avec son motif :

```
node build/build.mjs --freeze "motif"
node build/verify-rename.mjs --rebase "motif"
```

### Trois contraintes verifiees a chaque build

Le build echoue si le code les enfreint, parce que les trois ont deja casse le
script en production :

| Contrainte | Pourquoi |
|---|---|
| ASCII pur | Les libelles accentues passent par `\uXXXX`. v2.3.0, v2.5.0 et v2.7.0 ont chacune corrige un motif non accentue qui ne matchait plus rien sur l'interface francaise. |
| Aucun template literal | Heritee du userscript : le linter de Tampermonkey ne lisait pas les backticks (v2.1.0). Gardee, parce que le moteur est verifie au bit pres contre sa copie figee. |
| Fins de ligne CRLF | Convention du projet. |

## Tests

```
npm test
```

`test/harness.mjs` charge le moteur genere dans un contexte `vm` muni du strict
minimum de navigateur, et rend les fonctions pures exposees par
`__FGC_EXPOSE_FOR_TESTS__` (`src/core/32-test-hook.js`). Aucune dependance :
`node --test` suffit.

`test/pure.test.mjs` couvre la logique ou vivent les vrais bugs : resolution des
slugs Epic, fenetres de promotion, routage des magasins Luna, lecture des codes
d'echange, classification des reponses GOG, delais de repos.

**Piege du harnais** : le moteur tourne dans un autre realm, ses tableaux et
objets n'ont pas les memes prototypes que ceux du test. `assert.deepEqual` de
`node:assert/strict` les rejette. Passer par `Array.from(...)` ou comparer champ
par champ.

## La veille de fond

Depuis la 2.8.0, l'extension detecte les jeux gratuits **sans qu'aucun onglet de
magasin soit ouvert**, et les reclame elle-meme dans une fenetre reduite
(reglage *reclamation autonome*, active par defaut).

Le code de veille vit dans `watch/`, en **ES modules**, et n'a rien a voir avec
le moteur de reclamation : celui-ci reste en ES5 concatene. Le service worker
est declare `"type": "module"`.

| Module | Role |
|---|---|
| `offer.js` | le modele : identite, normalisation, rapprochement, urgence |
| `catalog.js` | ce que la veille sait dans le temps : fusion, disparitions, retention |
| `schedule/clock.js` | horaires ancres sur un fuseau nomme, sans arithmetique sur les heures |
| `schedule/scheduler.js` | quand interroger quoi : plancher, creneaux chauds, poursuite, freins |
| `sources/` | une source de decouverte par fichier, meme interface |
| `storage.js` | cles `veille:`, version de schema, verrou |
| `cycle.js` | l'enchainement complet d'un reveil |
| `claim.js` | reclamation pilotee : fenetre reduite, verdict, menage |
| `journal.js` | 500 entrees qui survivent a la mort du service worker |
| `canary.js` | compte les echecs de selecteur : un magasin qui a bouge le dit |
| `dry-run.js` | « Tester la recuperation » : la page d'un jeu offert, lue comme avant un clic -- sans clic |
| `backup.js` | les codes en attente, recopies dans la zone synchronisee |
| `library-sync.js` | le registre des jeux recuperes, d'un ordinateur a l'autre (en option) |
| `offscreen.js` | lire une page HTML depuis un contexte qui n'a pas de DOM |
| `sentinel.js` | quand proposer le repli, et comment il rend la main tout seul |
| `collection.js` | Ma collection : regrouper ce que chaque magasin dit que vous possedez |
| `collection-import.js` | lire les bibliotheques Steam, GOG et Epic, en lecture seule et a la demande |
| `steam-claim.js` | Steam en option : l'etape jouee dans la page, le rythme lent, et le jeu de base d'un DLC verifie avant tout envoi |
| `outcomes.js` | ce qui est passe, pris ou rate : l'issue figee a la fin de l'offre |
| `incidents.js` | une panne cesse d'etre un compteur : ouverture, reconstat, cloture |
| `health.js` | le tour d'inspection, hors du cycle -- il voit une veille arretee |
| `notify-actions.js` | quels boutons sur une notification, et ce qu'un index veut dire |
| `steam-weekends.js` | les week-ends gratuits de Steam : la page d'accueil designe, GetItems confirme et date -- montres, jamais reclames |
| `full-backup.js` | la sauvegarde complete et sa restauration : ce qui ne se reconstruit pas, fusionne sans rien ecraser -- jamais le telephone |
| `steam-ratings.js` | la note Steam des jeux offerts : le titre exact trouve par la recherche du magasin, puis le resume de ses evaluations, toutes langues -- relu une fois par semaine |
| `share-list.js` | « Copier la liste » : les jeux affiches, leur magasin, leur valeur, jusqu'a quand et leur lien, en texte simple a coller sur Discord ou WhatsApp |
| `context-wish.js` | le clic droit « Me prevenir quand ce jeu sera gratuit » : le titre lu sur la fiche Steam, Epic ou GOG (ou tire d'un lien), ajoute a la liste de souhaits |
| `auto-backup.js` | la sauvegarde de la semaine, deposee dans Telechargements/free-games-claimer, les quatre dernieres gardees ; le fichier de l'export a la main se construit ici aussi |
| `code-reminders.js` | un code bientot perime le dit : a sept jours, puis le dernier jour -- jamais le code lui-meme |
| `recap.js` | le recap du jeudi soir : recupere, a prendre soi-meme, rate, annonce -- une fois par semaine, jamais vide |
| `notify-image.js` | la jaquette du jeu dans la notification : telechargee sans cookies, recadree en 2:1, passee en `data:` -- ou rien |
| `wishlist.js` | ce que l'utilisateur attend, par TITRE : il survit a l'absence d'offre -- saisi, ou importe de ses listes Steam et GOG |
| `calendar.js` | l'agenda (.ics) : fins d'offres, offres annoncees, dernier jour des codes -- jamais le code |
| `phone.js` | l'alerte telephone par ntfy, Discord ou Telegram : pannes, defis, jeux attendus, recap -- jamais un code, jamais un cookie |
| `sources/epic-mobile.js` | les jeux mobiles offerts par Epic : l'API de decouverte de l'appli, rubrique « mobile-*-free-game » -- detectes, jamais reclames ; leur prix normal et leur fiche sur le site d'Epic |
| `deck.js` | Steam Deck : verifie, jouable ou non, lu dans la reponse GetItems deja demandee |
| `epic-mobile.js` | la mesure V8 : ou Epic expose ses jeux mobiles gratuits -- elle resume, elle ne decide rien |
| `engine-text.js` | les phrases du moteur : il envoie une cle et ses valeurs, le lanceur et le worker composent dans la langue du lecteur |
| `self-update.js` | installee depuis un dossier : se recharge quand une version plus recente y arrive, jamais en pleine reclamation |
| `annotations.js` | le backlog : etat, note, tirage au sort parmi ce qu'on veut essayer |
| `history.js` | lire, filtrer et compter les issues : taux de capture, valeur ratee |
| `codes.js` | ou echanger un code, par magasin, et ou il en est |
| `permissions.js` | ce qui se demande apres l'installation, et ce qui s'affiche alors |
| `teaching.js` | apprendre un libelle de bouton, sans jamais apprendre a payer |
| `lookup.js` | ce que l'extension sait d'un titre, repondu a une page de magasin |
| `recurrence.js` | ce qui revient : les titres deja offerts plus d'une fois |
| `playtime.js` | le miroir : recupere contre lance, pour ce que Steam sait mesurer |
| `bridge.js` | la passerelle locale : l'instantane, et le cadrage de son protocole |

Trois regles de ce sous-systeme, chacune payee par un bug :

**Le fuseau d'une date se declare, il ne se devine pas.** `readDate` refuse une
date sans fuseau explicite. Les horodatages de gamerpower sont en heure de New
York : lus comme de l'UTC, ils decalaient tout de quatre heures, dans le sens
qui fait expirer les offres trop tot, sans lever la moindre erreur.

**Le verrou ne garantit rien, l'idempotence si.** Un bail bati sur `storage`
n'est pas un verrou correct : deux appelants qui relisent chacun avant que
l'autre n'ecrive passent tous les deux. La sureté vient de ce que le cycle est
rejouable -- la notification est conditionnee par un champ persiste, pas par le
resultat du cycle.

**On rearme avant de travailler.** Une alarme ponctuelle est detruite par le
navigateur au moment ou elle se declenche. Si le service worker meurt entre ce
moment et le `create()` suivant, plus rien ne relancerait jamais la veille.
D'ou l'alarme filet periodique, et le rearmement en tete de cycle.

## Arborescence

```
manifest.json               Chrome / Edge
manifest.firefox.json       Firefox
background.js               service worker (module ES) : relais + veille
_locales/                   textes de l'interface : fr, en, de, es (emplacement impose)

pages/                      les pages de l'extension, une paire .html / .js chacune
  popup                       le popup -- et, ouvert en grand, le tableau de bord (page d'options)
  collection                  Ma collection : vos jeux des quatre magasins, en une page
  historique                  ce qui est passe, pris ou rate, et ce que cela valait
  journal                     le journal de la veille, 500 entrees persistees
  sentinel                    le mode repli : reessayer une source en panne, sous surveillance
  diagnostics                 mesures V0-2, V0-3, V6-V7 et V8 (jeux mobiles Epic)
  offscreen-html              lecture de HTML pour le service worker, qui n'a pas de DOM
  probe-offscreen             la sonde hors ecran des diagnostics
content/                    ce qui s'injecte dans les pages de magasin
  free-games-claimer.js       le moteur -- GENERE depuis src/core, ne s'edite pas
  gm-shim.js                  passerelle GM_* -> API d'extension
  launcher.js                 le bouton sur la page : etat du moteur, faits de la fiche, commandes,
                              gratuit en ce moment ; sur toute page de Steam, Epic, GOG et Luna ;
                              deplacable, il s'ecarte des boutons des autres extensions
lib/                        partage par les pages, le worker et la veille
  dashboard.js                le popup se sait-il ouvert dans un onglet ? (tableau de bord)
  store-chips.js              les puces de magasin au-dessus des jeux
  month-chart.js              le graphique du Bilan : les jeux recuperes, mois par mois
  i18n.js                     traduction
  i18n-tables.js              tables de traduction -- GENEREES depuis _locales
  money.js                    montants et devises
icons/                      icon.svg (la source) et ses PNG 16/32/48/128

watch/                      la veille de fond, en ES modules (voir plus haut)
  schedule/                   quand regarder : horloge, prediction, ordonnanceur
  sources/                    une source de decouverte par fichier
src/                        les sources du moteur
  core/                       34 modules ES5, concatenes dans l'ordre des noms
  meta/                       bandeau du fichier genere, tete v2.7.0 pour --verify

build/                      outils : build, controles, archives, apercu
  references/                 les temoins figes du moteur ; reference.json designe le courant
  pre-rename/                 le temoin du renommage francais -> anglais
test/                       tests unitaires (node --test), harnais et captures reelles
host/                       le programme de la passerelle locale, installe a la main
tools/                      maj-auto.ps1 : git pull du dossier, a la main ou toutes les heures (Windows)
store/                      fiches, permissions et confidentialite pour les magasins
docs/specs/                 design de la veille, constats V0 et V6-V7
.github/workflows/          check.yml a chaque push, release.yml sur un tag
dist/                       les archives produites, ignore par git

README.md  CHANGELOG.md  ROADMAP.md  SECURITY.md
```

## Installation

**Depuis une archive** -- `npm run package` ecrit dans `dist/` une archive par
navigateur. Un tag `vX.Y.Z` pousse sur le depot produit les memes archives sur
une release GitHub.

**Chrome / Edge, depuis les sources** -- `chrome://extensions` -> Mode
developpeur -> *Charger l'extension non empaquetee* -> choisir ce dossier.

### Mise a jour automatique d'une installation depuis les sources

Chargee depuis un dossier, l'extension ne se met pas a jour seule. Deux pieces
s'en chargent (2.53.0) :

1. **Le dossier suit GitHub.** Une fois, dans PowerShell, depuis ce dossier :

   ```
   powershell -ExecutionPolicy Bypass -File tools\maj-auto.ps1 -Installer
   ```

   Trois declencheurs, a votre nom, sans droits d'administrateur (2.54.0) :

   - **toutes les heures**, une tache planifiee ;
   - **a l'ouverture de session**, puis **des qu'une version est publiee** :
     un petit ecouteur demarre avec Windows, fait une mise a jour, puis
     attend une sonnette ntfy que GitHub fait retentir apres chaque check
     reussi sur `main`. Pour l'activer, ajoutez sur GitHub le secret
     `MAJ_NTFY` (Settings -> Secrets and variables -> Actions) avec l'adresse
     que `-Installer` affiche. Sans le secret, rien ne sonne et l'heure suffit ;
   - **le bouton « Mettre a jour maintenant »** du popup (Reglages -> Mise a
     jour) : l'extension appelle le relais que `-Installer` a declare a
     Chrome, Edge et Chromium, puis se recharge dans la foulee.

   Aucun ne touche a rien quand un fichier a ete modifie a la main, quand le
   dossier n'est pas sur `main`, ou quand l'historique local differe de celui
   de GitHub : ils l'ecrivent dans
   `%LOCALAPPDATA%\FreeGamesAutoClaimer\maj-auto.log` et s'arretent. Le
   message du popup et celui de la sonnette ne portent aucune commande : ils
   declenchent la meme mise a jour, et rien d'autre. Sans `-Installer`, une
   seule mise a jour, tout de suite ; `-Desinstaller` retire tout.

2. **L'extension se recharge d'elle-meme.** Toutes les cinq minutes, elle
   relit la version ecrite dans son `manifest.json` sur le disque. Plus
   recente que celle qui tourne : elle se recharge -- le bouton ⟳ de
   `chrome://extensions`, sans vous -- sauf si une reclamation est en cours ;
   elle attend alors la fin. Une notification dit la nouvelle version. Cela ne
   concerne que l'installation depuis un dossier : une version du Web Store se
   met a jour par le Store.

Un dossier clone avant la reecriture de l'historique (septembre 2026) ne peut
pas avancer : `git fetch` puis `git reset --hard origin/main`, une fois, si
rien n'y est a garder. Le script le dit dans son journal plutot que de le
faire a votre place.

**Firefox, depuis les sources** -- remplacer `manifest.json` par
`manifest.firefox.json`, puis `about:debugging#/runtime/this-firefox` ->
*Charger un module temporaire*. Un chargement permanent demande une extension
signee (compte AMO).

## Publication

`npm run package` produit deux archives a partir d'une **liste blanche
calculee**, jamais du contenu du dossier : le depot porte le moteur en deux
exemplaires, plus le build, les tests, les temoins figes et la documentation.

La liste part de deux sortes de points d'entree, et la seconde est celle qui
piege :

- ce qu'un manifeste designe (worker, scripts de contenu, popup, icones) ;
- ce qui s'ouvre **a l'execution** par `chrome.tabs.create` ou
  `chrome.offscreen.createDocument`, depuis une chaine litterale qu'aucun
  manifeste ne mentionne. Six pages sont dans ce cas.

Un garde refuse l'empaquetage tant qu'un `.js` ou un `.html` du depot n'est
joint par personne, et il tourne dans `npm run check`. Sans lui, une page
ajoutee demain marcherait en mode developpeur -- ou le dossier entier est
charge -- et **seulement la**.

Les archives sont reproductibles : l'horodatage interne est fige, donc deux
personnes qui empaquettent le meme commit obtiennent la meme empreinte
SHA256. C'est la promesse du controle de non-regression du moteur, etendue
jusqu'au fichier que l'utilisateur telecharge.

Ce qu'un magasin demande et que le code ne contient pas vit dans `store/` :
fiches en deux langues, justification par permission, politique de
confidentialite. La soumission elle-meme reste manuelle, et `store/README.md`
dit ce qui y attend encore une main humaine.

## Le popup

| Zone | Ce que vous y faites |
|---|---|
| Codes a echanger | copier un code, ouvrir la page d'echange, voir les jours restants |
| Magasins | etat (pret / en pause / auto desactive) et ouverture en un clic ; « Tester la recuperation » |
| Reglages | auto Epic, auto Luna, contenu en jeu (DLC), relance immediate |
| Dernieres recuperations | les 8 dernieres, toutes plateformes confondues |

**Copier la liste** (2.80.0), sous « Gratuit maintenant » : un texte pret a
coller sur Discord, WhatsApp ou un forum -- les jeux affiches (la recherche et
la puce de magasin comptent), leur magasin, leur valeur, jusqu'a quand, et
le lien ; puis ce qu'Epic annonce et les week-ends gratuits de Steam, s'il y
en a. Rien de personnel : ni ce que vous possedez, ni vos souhaits, ni vos
codes.

**Le clic droit « Me prevenir quand ce jeu sera gratuit »** (2.79.0), sur une
fiche Steam, Epic ou GOG -- ou sur un lien vers l'une d'elles, depuis
n'importe quelle page : le jeu rejoint la liste de souhaits, et une
notification le confirme. Deja attendu (a la main, ou par la liste Steam ou
GOG importee) ? Elle le dit. Gratuit en ce moment ? Elle dit ou, et un clic y
mene. Le jeu est reconnu par son titre normalise : ajoute depuis Steam, il
sera annonce en priorite le jour ou Epic l'offre.

**La note Steam** (2.78.0) : « 84 % positif » au bout de chaque jeu gratuit,
vert, orange ou rouge selon l'echelle de Steam -- « Tres positives · 84 % » en
entier quand la page est large, et le detail au survol. Aussi pour les
week-ends gratuits, et sur une seconde ligne de la notification d'un jeu
annonce seul. Toutes langues confondues : la fiche Steam montre parfois le
score de votre langue, a un ou deux points pres. Ni les jeux mobiles ni les
DLC ne sont cherches. Reglages -> Magasins -> « Notes Steam » la coupe.

**La sauvegarde automatique** (2.77.0, Reglages -> Sauvegarde) : une fois par
semaine, le fichier de la sauvegarde complete se depose tout seul dans
Telechargements/free-games-claimer -- les quatre derniers restent, le plus
ancien s'efface. Rien de neuf depuis la derniere ? Pas de nouveau fichier.
L'interrupteur demande a Chrome l'acces aux telechargements (et le rend quand
on le coupe) ; le premier fichier part tout de suite, et « Montrer le fichier »
ouvre son dossier. Elle attend la fin des heures calmes.

**Le grand chiffre du tableau de bord** (2.76.0) : en tete, ce que les jeux
recuperes par l'extension auraient coute -- la meme somme que le Bilan,
convertie de la meme facon --, le nombre de jeux, et ce que le mois en cours
y a ajoute. Seulement dans le tableau de bord : le popup garde sa place pour
les jeux.

**Les week-ends gratuits de Steam** (2.75.0) : une section « A essayer ce
week-end » dans l'onglet Jeux -- des jeux payants ouverts a tous quelques
jours, le temps qui reste, et le prix s'il est en promotion pour qui veut le
garder. Rien a recuperer : l'extension les montre, un clic ouvre la fiche.
Reglages -> Magasins -> « Week-ends gratuits Steam » les coupe.

**La sauvegarde complete** (2.74.0, Reglages -> Sauvegarde -> Exporter en
JSON) : le fichier emporte tout ce qui ne se reconstruit pas seul -- jeux
recuperes et leur historique, codes, listes de souhaits, collection, libelles
appris, reglages et preferences. « Importer » le relit et FUSIONNE : sur un
autre dossier, un autre PC ou apres une reinstallation (Chrome repart alors
d'un stockage vide), tout revient ; sur l'installation en cours, rien de ce qui
est deja la n'est perdu. L'alerte du telephone n'y est pas : son adresse est
un secret.

**Le rappel des codes** (2.73.0) : un code GOG ou Microsoft en attente, dont
la date limite approche, fait une notification a sept jours puis le dernier
jour -- une fois chacune, et sans jamais afficher le code. Il suit le canal des
alertes (Reglages -> Notifications) et les heures calmes.

**Le graphique du Bilan** (2.72.0) : les jeux recuperes sur douze mois, en
colonnes -- le plus haut mois et le mois en cours portent leur nombre ;
survol ou clavier donnent le nombre et la valeur de chaque mois, et « Voir en
tableau » les donne tous. Plus grand dans le tableau de bord.

**Le panneau des pages de magasin suit le theme** (2.70.0) choisi dans
Reglages -> Apparence : clair, sombre, ou celui du systeme -- et il change en
direct, meme ouvert.

**Les raccourcis clavier** (2.69.0), depuis n'importe quelle page du
navigateur : Alt+Maj+G ouvre l'extension, Alt+Maj+D le tableau de bord,
Alt+Maj+V lance une verification. Ce ne sont que des suggestions : Reglages ->
Raccourcis clavier montre ceux que le navigateur a vraiment attribues, et
mene a chrome://extensions/shortcuts pour les changer.

**Le recap du jeudi soir** (2.65.0, Reglages -> Notifications) : une
notification par semaine, a 18 h le jeudi -- une heure apres la rotation
d'Epic -- qui dit ce que la veille a recupere depuis le jeudi d'avant (et pour
quelle valeur), ce qui reste a prendre soi-meme (Steam sans l'option, jeux
mobiles, reclamation arretee sur une connexion), ce qui a ete rate et ce
qu'Epic annonce. Un ordinateur eteint le jeudi soir le recoit au reveil,
jusqu'au dimanche soir ; une semaine sans rien a dire n'envoie rien. Il suit
les heures calmes, et part aussi sur le telephone si l'alerte est active.

**Les alertes sur Discord ou Telegram** (2.71.0), au choix de ntfy dans
Reglages -> Notifications -> Alertes -> Service : l'adresse d'un webhook de
salon Discord, ou le jeton d'un bot Telegram et votre identifiant. Les memes
alertes, aux memes moments.

**Tester la recuperation** (2.64.0), sous les sessions : pour chaque magasin
que l'extension reclame, la page d'un jeu offert en ce moment s'ouvre dans une
fenetre reduite, le moteur la lit comme juste avant son premier clic, et la
ligne dit ce qu'il a vu -- « Obtenir » trouve, deja dans la bibliotheque,
connexion requise, ou aucun bouton reconnu, avec les boutons vus a la place.
Rien n'est clique. C'est le moyen de savoir qu'un magasin a change sa page
avant qu'un jeu soit rate.

**Le tableau de bord** (2.58.0) est ce meme popup ouvert en grand : le bouton
en fleches de son en-tete, ou clic droit sur l'icone -> Options. Au-dela de
760 px de large, les volets se posent cote a cote -- les jeux en grille, les
codes et la veille (avec sa bande de 24 heures), les reglages -- et la page
se relit chaque minute. En dessous, il garde les onglets du popup. Une seule
page pour les deux : un reglage ajoute au popup est aussitot dans le tableau
de bord.

Les interrupteurs ecrivent les memes cles que le moteur (`FGC_epic_auto_mode`,
`FGC_luna_auto_mode`, `FGC_luna_claim_dlc`), et `content/gm-shim.js` ecoute
`storage.onChanged` : un interrupteur bascule dans le popup est pris en compte
immediatement par les onglets deja ouverts.

## Le moteur dans l'extension

Le moteur a ete ecrit pour Tampermonkey et parle encore l'API `GM_*` :
`content/gm-shim.js` la lui fournit sur les API de l'extension.

| Point | Dans l'extension |
|---|---|
| Commandes | le popup, ou la console de la page : `FGC.menu()` puis `FGC.run(3)` |
| Stockage | `chrome.storage.local` (cles du moteur prechargees a l'injection) |
| Notifications | `chrome.notifications` |
| Mises a jour | par archive ou par le magasin d'extensions |

## Icone

`icons/icon.svg` est la source (coupon a echanger, ambre sur encre violette) ; les PNG
16/32/48/128 en sont generes. Aucun logo tiers.
