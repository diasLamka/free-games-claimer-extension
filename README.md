# Free Games Auto-Claimer -- extension Chrome / Firefox

Recuperation automatique des jeux gratuits sur Epic Games Store, GOG et Amazon
Luna. L'extension et le userscript Tampermonkey partagent le meme moteur.

Ce qui n'est pas encore fait, et pourquoi, est dans `ROADMAP.md`.

## Le moteur est genere

`free-games-claimer.js` et `../free-games-claimer.user.js` **ne s'editent pas a
la main**. Ils sont produits a partir de `src/core/*.js` :

```
npm run build     # regenere les artefacts
npm run verify    # controle de non-regression (voir plus bas)
npm test          # build + tests unitaires
npm run check     # verify + test, a lancer avant de livrer
npm run package   # les deux archives publiables, dans dist/
```

Les modules de `src/core` sont concatenes dans l'ordre de leur nom et vivent
tous dans **une seule portee** : l'IIFE est ouverte par `00-prologue.js` et
fermee par `99-epilogue.js`. Un module pris isolement n'est donc pas un script
valide, et le prefixe numerique est significatif.

Ce choix a une raison : il permet de decouper un fichier de 2750 lignes sans
reecrire un seul appel de fonction, donc sans risque de regression.

### Le controle de non-regression

`build/reference.json` designe une copie figee du moteur (`build/reference-v*.js`).
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
| Aucun template literal | Le linter integre de Tampermonkey ne lit pas les backticks (v2.1.0). |
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
| `backup.js` | les codes en attente, recopies dans la zone synchronisee |
| `offscreen.js` | lire une page HTML depuis un contexte qui n'a pas de DOM |
| `sentinel.js` | quand proposer le repli, et comment il rend la main tout seul |
| `collection.js` | Ma collection : regrouper ce que chaque magasin dit que vous possedez |
| `collection-import.js` | lire les bibliotheques Steam, GOG et Epic, en lecture seule et a la demande |
| `steam-claim.js` | Steam en option : l'etape jouee dans la page, et le rythme lent |
| `outcomes.js` | ce qui est passe, pris ou rate : l'issue figee a la fin de l'offre |
| `incidents.js` | une panne cesse d'etre un compteur : ouverture, reconstat, cloture |
| `health.js` | le tour d'inspection, hors du cycle -- il voit une veille arretee |
| `notify-actions.js` | quels boutons sur une notification, et ce qu'un index veut dire |
| `wishlist.js` | ce que l'utilisateur attend, par TITRE : il survit a l'absence d'offre |
| `annotations.js` | le backlog : etat, note, tirage au sort parmi ce qu'on veut essayer |
| `history.js` | lire, filtrer et compter les issues : taux de capture, valeur ratee |
| `codes.js` | ou echanger un code, par magasin, et ou il en est |
| `permissions.js` | ce qui se demande apres l'installation, et ce qui s'affiche alors |
| `teaching.js` | apprendre un libelle de bouton, sans jamais apprendre a payer |
| `lookup.js` | ce que l'extension sait d'un titre, repondu a une page de magasin |
| `recurrence.js` | ce qui revient : les titres deja offerts plus d'une fois |

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
src/
  core/            34 modules ES5, concatenes dans l'ordre des noms
  meta/
    banner.txt              bandeau des fichiers generes
    userscript-header.txt   bloc ==UserScript==
    legacy-header.txt       tete v2.7.0, temoin pour --verify
watch/             la veille de fond, en ES modules
  offer.js  catalog.js  storage.js  cycle.js  claim.js  ...
  journal.js canary.js backup.js offscreen.js  library.js  filters.js
  outcomes.js incidents.js health.js notify-actions.js
  wishlist.js annotations.js history.js codes.js permissions.js teaching.js
  lookup.js recurrence.js
  schedule/  clock.js  prediction.js  scheduler.js
  sources/   index.js  epic.js  gamerpower.js  gog.js  steam.js
build/
  build.mjs                 build et controles
  package.mjs               les archives publiables : liste blanche, zip, garde anti-oubli
  reference.json            designe le temoin fige du moteur (build/reference-v*.js)
test/
  harness.mjs               chargement du moteur ES5 en vm
  fake-chrome.mjs           faux chrome.* : storage, alarms, notifications
  fixtures/                 captures reelles des deux API
  *.test.mjs                tests unitaires (node --test)
docs/superpowers/specs/     design de la veille, constats V0 et V6-V7
.github/workflows/          check.yml a chaque push, release.yml sur un tag
store/                      fiches, permissions et confidentialite pour les magasins
dist/                       les archives produites, ignore par git
overlay.js                  la surcouche des pages de magasin : elle lit, elle n'agit jamais
gm-shim.js                  passerelle GM_* -> API d'extension
background.js               service worker (module ES) : relais + veille
popup.html / popup.js       popup
journal.html / journal.js   le journal de la veille, 500 entrees persistees
historique.html / .js       ce qui est passe, pris ou rate, et ce que cela valait
sentinel.html / sentinel.js le mode repli : reessayer une source en panne, sous surveillance
collection.html / .js       Ma collection : vos jeux des quatre magasins, en une page
offscreen-html.html / .js   lecture de HTML pour le service worker, qui n'a pas de DOM
diagnostics.html / .js      mesures V0-2, V0-3 et V6-V7
manifest.json               Chrome / Edge
manifest.firefox.json       Firefox
CHANGELOG.md                historique du moteur
ROADMAP.md                  ce qui n'est pas encore fait, et pourquoi
```

## Installation

**Depuis une archive** -- `npm run package` ecrit dans `dist/` une archive par
navigateur. Un tag `vX.Y.Z` pousse sur le depot produit les memes archives sur
une release GitHub.

**Chrome / Edge, depuis les sources** -- `chrome://extensions` -> Mode
developpeur -> *Charger l'extension non empaquetee* -> choisir ce dossier.

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
| Magasins | etat (pret / en pause / auto desactive) et ouverture en un clic |
| Reglages | auto Epic, auto Luna, contenu en jeu (DLC), relance immediate |
| Dernieres recuperations | les 8 dernieres, toutes plateformes confondues |

Les interrupteurs ecrivent les memes cles que le moteur (`FGC_epic_auto_mode`,
`FGC_luna_auto_mode`, `FGC_luna_claim_dlc`), et `gm-shim.js` ecoute
`storage.onChanged` : un interrupteur bascule dans le popup est pris en compte
immediatement par les onglets deja ouverts.

## Differences avec Tampermonkey

| Point | Tampermonkey | Extension |
|---|---|---|
| Commandes | menu de l'icone TM | popup, ou console : `FGC.menu()` puis `FGC.run(3)` |
| Stockage | `GM_setValue` | `chrome.storage.local` (cles du moteur prechargees a l'injection) |
| Notifications | natives TM | `chrome.notifications` (le clic n'est pas transmis) |
| Mises a jour | `@updateURL` | manuelles, ou via le Web Store |

## Icone

`icon.svg` est la source (coupon a echanger, ambre sur encre violette) ; les PNG
16/32/48/128 en sont generes. Aucun logo tiers.
