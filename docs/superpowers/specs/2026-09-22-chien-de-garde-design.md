# Le chien de garde : quand c'est l'extension qui casse

Conception du lot 3. Ecrit le 2026-09-22, apres la 2.27.0.

Ce document dit ce qu'on construit, ce qu'on refuse de construire, et pourquoi
chaque decision est prise plutot qu'une autre. Il ne dit pas comment coder :
cela se lira dans le code et dans ses tests.

## 1. Le probleme, et il est mesure

L'extension sait deja detecter ses propres pannes. Elle ne sait pas le dire.

Trois detecteurs existent, complets, testes, et aucun n'a de voix :

| Detecteur | Ou | Ce qu'il sait | Ou va son constat |
|---|---|---|---|
| Canari de selecteurs | `watch/canary.js` | deux echecs de selecteur d'affilee sur un magasin, avec le motif technique | `record()`, donc le journal |
| Source en repli | `watch/sentinel.js` | trois echecs consecutifs d'une source | le journal, et un bandeau dans le popup |
| Session perdue | `watch/session.js` | un magasin repond « deconnecte » | un bandeau dans le popup |

Le journal est une page qu'on ouvre quand on soupconne deja quelque chose. Le
popup se regarde quand on l'ouvre. Ni l'un ni l'autre ne PREVIENT.

Ce qui manque vraiment tient en quatre constats de code :

1. **Les quatre appels a `notify()` parlent tous d'offres** (`watch/cycle.js`,
   lignes 486, 522, 584, 589). Aucun ne parle de fonctionnement.
2. **`badgeCount` ne sait rendre qu'un nombre d'offres**
   (`watch/notify-policy.js`). Une panne ne change rien a l'icone.
3. **Aucune cle ne se souvient d'une panne.** Le canari garde des compteurs,
   pas une histoire : rien ne dit « ceci dure depuis mardi ».
4. **Personne ne compare `now - lastCycle` a l'intervalle prevu**, alors que
   les deux valeurs sont ecrites a chaque cycle (`DEFAULT_STATE`,
   `watch/storage.js`). C'est la panne la plus grave et la seule qui n'ait
   aucun detecteur : la veille s'arrete, et rien ne le dit.

Deux promesses ecrites ailleurs dans le depot ne sont donc pas tenues : « une
notification par jour au maximum quand la session manque », et « alerte canari
au journal ET au badge ».

## 2. Ce qu'on ne construit pas

- **Pas de sonde qui ouvre une page pour verifier qu'un bouton existe.** Le
  canari observe les echecs reels ; provoquer un echec pour le mesurer
  couterait un onglet et un jeton du plafond horaire, et ferait cliquer chez un
  magasin sans qu'aucune offre ne le justifie.
- **Pas de rapport d'erreur distant.** Non-objectif du design, et
  `SECURITY.md` promet l'absence de telemetrie.
- **Pas de notification quand tout redevient normal.** Un probleme resolu
  n'interrompt personne. Le popup montrera qu'il a disparu, cela suffit.
- **Pas de reparation automatique.** Le chien de garde aboie ; il ne repare
  pas. Une source en repli a deja sa sentinelle, et c'est un geste humain.

## 3. Une decouverte qui change l'ordre des lots

Le lot 3 devait porter DEUX sujets : le chien de garde et les notifications
actionnables. La conception a montre que le second ne tient pas ici.

Une notification actionnable n'a d'interet que si ses boutons font quelque
chose. Les trois boutons qui valent la peine sont « Recuperer », « Pas
interesse » et « Me rappeler ». Or :

- « Recuperer » demande une commande `fgc-claim-one` qui n'existe pas. La
  table `UI_COMMANDS` de `watch/messaging.js` est fermee, et le seul chemin
  actuel reclame TOUT ;
- « Me rappeler » demande un champ `snoozedUntil` qui n'existe pas non plus.

Les deux appartiennent au lot de la file de reclamation pilotable. Livrer les
notifications avant lui donnerait des boutons decoratifs, c'est-a-dire pire que
pas de boutons.

**L'ordre devient donc :** chien de garde (ce lot), puis file pilotable, puis
notifications actionnables, puis le reste inchange. Aucun lot n'est abandonne,
deux changent de rang.

## 4. Un incident est un objet qui a une histoire

Le coeur de ce lot est un changement de nature. Aujourd'hui une panne est un
COMPTEUR qui monte. Demain c'est un INCIDENT, avec une ouverture, une derniere
observation, et une cloture.

C'est ce qui permet les trois choses qui manquent : dire depuis quand, ne le
dire qu'une fois, et savoir que c'est fini.

```
veille:incidents = {
  "<genre>:<cle>": {
    kind,        genre d'incident (voir §5)
    key,         ce sur quoi il porte : un magasin, une source, ou rien
    openedAt,    premier constat
    lastSeenAt,  dernier constat -- un incident non reconstate se clot
    notifiedAt,  quand on l'a dit, ou null
    detail,      le motif technique, recopie tel quel
  }
}
```

**Un seul ecrivain : le service worker.** Le popup lit, n'ecrit jamais. Le
precedent est assume dans le depot : `veille:ui` n'est ecrite que par le popup
et seulement lue ailleurs. Deux ecrivains sur une meme cle sans transaction,
c'est la perte silencieuse d'un des deux.

**Ecrit dans la meme transition que le catalogue**, comme le canari et la
cadence, pour la raison deja ecrite dans `watch/storage.js` : un worker mort
entre deux ecritures laisserait un etat incoherent.

**La cloture est implicite.** Un incident que le tour d'inspection ne
reconstate pas est clos. Rien n'a besoin d'annoncer sa disparition, et un
detecteur qui devrait penser a fermer ce qu'il a ouvert finirait par oublier.

## 5. Les cinq genres d'incident

Trois reprennent des detecteurs existants. Deux sont nouveaux, et le premier
des deux est la raison d'etre de ce lot.

| Genre | Declencheur | Source | Nouveau |
|---|---|---|---|
| `selector` | alerte du canari sur un magasin | `watch/canary.js`, seuils inchanges | non |
| `source` | source en repli apres trois echecs | `watch/sentinel.js`, `failingSources` | non |
| `session` | un magasin repond « deconnecte » | `watch/session.js` | non |
| `stalled` | la veille n'a pas tourne depuis trop longtemps | nouveau | **oui** |
| `muted` | le systeme refuse nos notifications | nouveau | **oui** |

**`session` ne se declenche que sur `logged_out`, jamais sur `inconnu`.** C'est
la lecon de la 2.22.2, recopiee ici parce qu'elle vaut a chaque etage : une
ignorance affichee comme une alerte fait passer « je ne sais pas » pour « c'est
casse », et appelle un geste inutile.

### 5.1 `stalled` : la panne qui n'avait aucun detecteur

C'est la seule qui dise « l'extension est morte ». Elle se declenche quand

```
now - lastCycle  >  max(6 heures, 2 x (nextCycle - lastCycle))
```

Le plancher de six heures vient du reglage `floorPerDay`, dont le defaut est
trois cycles par jour, soit huit heures nominales entre deux reveils. Le
facteur deux laisse passer un cycle manque sans crier : un portable ferme une
nuit ne doit rien declencher.

**Et voici le piege, qui commande tout le reste de la conception.**

Si ce detecteur vit DANS le cycle, il ne se declenche jamais : quand la veille
est morte, le cycle ne tourne pas, donc le detecteur non plus. Un chien de
garde qui dort avec le chien qu'il garde ne garde rien.

Il vit donc dans le gestionnaire d'alarme de `background.js`, et s'evalue
AVANT de decider de lancer un cycle. L'alarme filet periodique existe deja et
survit a la mort du service worker -- c'est precisement la raison pour
laquelle elle a ete posee. Le popup l'evalue aussi a l'ouverture, en lecture
seule.

### 5.2 `muted` : quand le canal lui-meme est coupe

`chrome.notifications.getPermissionLevel()` n'est appele nulle part dans le
depot. Si le systeme refuse nos notifications, tout ce qui precede est
inaudible et personne ne le sait.

Cet incident ne se notifie pas -- il ne le pourrait pas. Il existe pour deux
raisons : le badge prend le relais, et le popup peut enfin expliquer pourquoi
rien n'arrive.

## 6. Le canal, et la preference qu'il ne doit pas trahir

Un incident de fonctionnement n'est pas une offre. Quelqu'un qui ne veut plus
etre prevenu des jeux gratuits veut probablement savoir que son extension est
cassee. Mais lui envoyer des notifications apres qu'il les a coupees serait
exactement la trahison que le depot nomme deja : « une preference perdue en
silence est une trahison silencieuse ».

**Decision : un reglage separe, `alertMode`, dont le defaut est actif -- et une
traduction unique pour ceux qui avaient deja choisi le silence.**

`normaliseSettings` traduit `notifyMode: 'off'` en `alertMode: 'off'`, une
seule fois, exactement comme elle traduit deja `notifications: false` en
`notifyMode: 'off'` depuis la 2.10. Ensuite les deux reglages sont
independants.

Resultat : personne ne recoit une notification qu'il n'a pas voulue, une
nouvelle installation est prevenue quand ca casse, et les deux se reglent
separement.

**Les heures calmes s'appliquent.** Un incident y est DIFFERE, jamais
supprime -- meme regle que les offres. Un selecteur mort a trois heures du
matin n'appelle aucun geste avant le lever.

**Une fois par incident, pas une fois par cycle.** Le champ `notifiedAt` le
garantit, et il est persiste : c'est la meme construction que `notifiedAt` sur
une offre, dont le commentaire dit pourquoi le calcul ne suffit pas.

## 7. Le badge

`badgeCount` rend un nombre et reste tel quel. Un `badgeState` nouveau
l'enveloppe et rend de quoi peindre l'icone :

```
badgeState({ mode, unseen, offers, now, incidents }) -> { text, color }
```

Quand un incident est ouvert, le texte devient `!` et la couleur passe a
l'avertissement. Le compte d'offres cede la place, et c'est voulu : une panne
prime sur un decompte, que le popup affiche de toute facon.

C'est aussi le seul canal qui reste quand l'incident est `muted`.

## 8. Ce qui reste a mesurer

Deux choses sont volontairement hors de ce lot faute de mesure, en suivant la
regle du design : une hypothese se mesure avant de s'ecrire.

**La saturation du stockage.** `usedSize` existe dans `watch/storage.js` et
n'a aucun appelant. Un quota atteint est une panne silencieuse credible, mais
personne ici n'a jamais mesure l'occupation reelle d'une installation agee. A
brancher quand un chiffre existera, pas avant.

**Le bon seuil de `stalled`.** Six heures et un facteur deux sont un pari
raisonne, pas une mesure. Le journal permettra de le corriger : chaque
ouverture d'incident y laisse l'ecart constate.

## 9. Ce qu'on saura quand ce sera fini

- Une alarme qui ne se rearme plus produit un incident `stalled` et une
  notification, sans qu'aucun cycle n'ait tourne.
- Deux echecs de selecteur d'affilee produisent un incident `selector` portant
  le motif technique, et une seule notification meme si dix cycles passent.
- Un incident qui cesse d'etre reconstate disparait, en silence.
- Un utilisateur qui avait coupe les notifications n'en recoit aucune.
- Une nouvelle installation en recoit.
- Notifications refusees par le systeme : rien n'est envoye, le badge porte la
  marque, le popup dit pourquoi.

## 10. Plan de test

Tout ce qui precede est pur sauf deux points, et les deux se jouent avec le
faux chrome deja ecrit (`test/fake-chrome.mjs`).

| Ce qui est teste | Comment |
|---|---|
| ouverture, reconstat, cloture d'un incident | module pur, entrees construites |
| une seule notification par incident, meme sur dix cycles | faux chrome, cycles rejoues |
| heures calmes : differe, jamais supprime | module pur, instants choisis |
| `stalled` detecte hors du cycle | alarme jouee sans cycle |
| `notifyMode: 'off'` deja choisi -> silence | `normaliseSettings`, comme la traduction de la 2.10 |
| defaut d'une installation neuve -> alerte | `DEFAULT_SETTINGS` |
| badge : incident prime sur le compte | module pur |
| `muted` : aucune notification tentee | faux chrome, permission refusee |
