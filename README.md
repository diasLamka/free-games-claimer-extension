# Free Games Auto-Claimer -- extension Chrome / Firefox

Recuperation automatique des jeux gratuits sur Epic Games Store, GOG et Amazon
Luna. L'extension et le userscript Tampermonkey partagent le meme moteur.

## Le moteur est genere

`free-games-claimer.js` et `../free-games-claimer.user.js` **ne s'editent pas a
la main**. Ils sont produits a partir de `src/core/*.js` :

```
npm run build     # regenere les artefacts
npm run verify    # controle de non-regression (voir plus bas)
npm test          # build + tests unitaires
npm run check     # verify + test, a lancer avant de livrer
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
  schedule/  clock.js  prediction.js  scheduler.js
  sources/   index.js  epic.js  gamerpower.js  steam.js
build/
  build.mjs                 build et controles
  reference.json            designe le temoin fige du moteur (build/reference-v*.js)
test/
  harness.mjs               chargement du moteur ES5 en vm
  fake-chrome.mjs           faux chrome.* : storage, alarms, notifications
  fixtures/                 captures reelles des deux API
  *.test.mjs                tests unitaires (node --test)
docs/superpowers/specs/     design de la veille et constats V0
gm-shim.js                  passerelle GM_* -> API d'extension
background.js               service worker (module ES) : relais + veille
popup.html / popup.js       popup
diagnostics.html / .js      mesures V0-2 et V0-3
manifest.json               Chrome / Edge
manifest.firefox.json       Firefox
CHANGELOG.md                historique du moteur
```

## Installation

**Chrome / Edge** -- `chrome://extensions` -> Mode developpeur -> *Charger
l'extension non empaquetee* -> choisir ce dossier.

**Firefox** -- remplacer `manifest.json` par `manifest.firefox.json`, puis
`about:debugging#/runtime/this-firefox` -> *Charger un module temporaire*. Un
chargement permanent demande une extension signee (compte AMO).

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
