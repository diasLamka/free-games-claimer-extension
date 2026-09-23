# Veille et réclamation autonome des jeux gratuits — design

- **Date** : 2026-08-27
- **Projet** : `D:\free-games-claimer-extension` (extension MV3) et `D:\free-games-claimer.user.js` (userscript Tampermonkey)
- **Point de départ** : moteur v2.7.0
- **Statut** : validé en séance, à découper en plan d'implémentation

---

## 1. Contexte

L'extension et le userscript partagent un moteur unique de 2750 lignes, recopié
à l'identique dans les deux artefacts. Il réclame les jeux gratuits sur Epic
Games Store, GOG (giveaway et échange de codes) et Amazon Luna.

Le moteur ne s'exécute que dans un content script. Rien ne tourne quand aucun
onglet Epic, GOG ou Luna n'est ouvert. Le service worker actuel se limite à
trois relais : `fetch`, notification, ouverture d'onglet. Il n'existe ni alarme,
ni scan périodique, ni source de découverte hors des trois magasins déjà pris en
charge.

Conséquence directe : les offres qui durent quelques heures passent inaperçues,
sauf coup de chance.

Deux limites connues du code actuel pèsent sur ce design :

- Le fichier unique de 2750 lignes n'est pas testable et interdit toute
  divergence entre les deux artefacts.
- `gaming.amazon.com` figure dans les `@match` et dans `host_permissions`, mais
  le module refuse de s'exécuter dessus (ligne 2254). Prime Gaming n'est donc
  pas couvert.

## 2. Objectifs

1. Détecter les offres gratuites éphémères sur un large éventail de magasins,
   sans dépendre d'un onglet ouvert.
2. Vérifier au bon moment plutôt qu'à intervalle fixe, en s'appuyant sur les
   horaires connus et sur les horaires observés.
3. Réclamer seule, y compris la nuit, en s'arrêtant net dès qu'une intervention
   humaine devient nécessaire.
4. Rendre la veille inspectable : ce qu'elle a prévu, ce qu'elle a vu, ce qu'elle
   a fait.

## 3. Non-objectifs

- Prédire *quel* jeu sera offert. La seule question posée est « quand regarder ».
- Mettre en commun des données entre utilisateurs, ou dépendre d'un serveur
  propre.
- Contourner un captcha, une authentification ou une limitation de débit.
- Maintenir la parité fonctionnelle du userscript. Il perd la veille et conserve
  la réclamation sur page ouverte.

## 4. Décisions

| Décision | Retenu | Raison |
|---|---|---|
| Support | Extension MV3 en tête, userscript généré | Un userscript n'a pas d'exécution de fond |
| Découverte | Agrégateur tiers en tête, adaptateurs propres en appui | Une source à maintenir au lieu de douze |
| Réclamation | Onglet de fond piloté par le service worker | Réutilise le moteur existant sans le réécrire |
| Repli | Onglet dédié de l'extension | Contexte persistant que le service worker n'a pas |
| Prédiction | Calendriers déclarés et éditables, puis histogramme 168 cases | Ce que le volume de données peut honnêtement soutenir |

L'onglet-sentinelle permanent a été écarté comme architecture principale : un
onglet lourd en permanence, un trafic qui ressemble à un robot sur des comptes
personnels, et aucun passage à l'échelle au-delà de trois ou quatre boutiques. Il
subsiste uniquement comme mode dégradé.

## 5. Architecture

Sept unités, chacune avec un rôle unique.

**`core/`** — le moteur de réclamation actuel, éclaté par magasin (`epic.js`,
`luna.js`, `gog.js`, `gog-redeem.js`) au-dessus d'un socle partagé (`dom.js`,
`storage.js`, `log.js`, `patterns.js`). Extraction à comportement constant :
aucune logique nouvelle à cette étape.

**`discovery/`** — les sources de découverte. Chacune expose la même fonction,
`list() → Offre[]`, et ignore tout de la réclamation. Deux implémentations au
départ : l'agrégateur et l'API `freeGamesPromotions` d'Epic.

**`scheduler/`** — décide quand interroger quoi. Une seule alarme, relue depuis
le stockage à chaque réveil.

**`claimer/`** — prend une Offre, ouvre l'onglet de fond, dialogue avec le
content script, encaisse le verdict, ferme l'onglet.

**`store/`** — le schéma de données, sur `chrome.storage.local`.

**`ui/`** — le popup pour l'état immédiat, l'onglet dédié pour le reste.

**`build/`** — reconcatène le cœur en un userscript ES5 et ASCII. Le userscript
redevient un artefact généré.

### Flux

```
alarme → découverte (agrégateur + API Epic) → normalisation en Offre
       → déduplication contre l'historique → confirmation sur le magasin
       → file → onglet de fond → verdict → historique + statistiques
       → notification
```

### Contraintes MV3 qui façonnent l'ensemble

- Le service worker s'arrête dès qu'il est inactif. Aucun état vivant ne réside
  en mémoire : tout transite par le stockage, et chaque réveil repart du plan
  écrit.
- La période minimale d'une alarme est d'une minute.
- Un service worker MV3 ne dispose pas de `DOMParser`. Toute découverte qui exige
  de lire du HTML passe par un document offscreen (voir §10).
- Chrome bride les timers dans un onglet caché. **Mesuré** (V0-2, Chrome 151) :
  environ 1,5 à 2 s pour 1 s demandée, sans effondrement à un réveil par minute,
  y compris au-delà de cinq minutes de masquage. Le gel et l'éviction d'onglet
  sous pression mémoire restent possibles.

## 6. L'ordonnanceur prédictif

### Trois régimes

**Plancher** — chaque source est interrogée au minimum N fois par jour, quoi
qu'il arrive. N est réglable de 1 à 24, avec une valeur globale par défaut et une
surcharge par magasin. Valeur initiale : 3.

**Créneaux chauds** — autour des heures où la source lâche habituellement, une
vérification toutes les 5 à 10 minutes sur une fenêtre de ±30 minutes.

**Poursuite** — dès qu'une offre est repérée sans être réclamée, ou dès qu'une
offre connue approche de sa date de fin, la source passe en rythme serré jusqu'à
résolution.

Le plafond de requêtes quotidien est dérivé du plancher réglé, jamais saisi
séparément. Deux réglages qui peuvent se contredire finissent toujours par se
contredire.

### Couche A — les calendriers connus

Une table de règles, stockée en données et éditable depuis l'onglet dédié. Elle
apporte l'essentiel de la valeur sans aucune statistique.

Chaque règle porte un fuseau explicite. Epic lâche à 11:00 heure de New York :
c'est ainsi qu'il faut l'écrire, et non « 17:00 à Paris ». Les États-Unis et
l'Europe ne changent pas d'heure les mêmes week-ends ; il existe chaque année
deux fenêtres de quelques semaines où les deux horaires divergent d'une heure.
Une règle mal ancrée fait rater le drop deux fois par an.

Règles initiales, toutes à confirmer et toutes modifiables :

- Epic : hebdomadaire, plus une offre par jour pendant l'événement de décembre.
- Prime Gaming et Luna : lots en début de mois, ajouts en cours de mois.
- GOG : giveaways d'environ 48 à 72 heures, en heures ouvrées polonaises.
- Indiegala : une offre quotidienne.
- Steam : aucun calendrier public. C'est le cas que la couche B doit couvrir.

### Couche B — l'apprentissage

Par source, un histogramme de 168 cases (jour de la semaine × heure). Chaque
offre nouvellement constatée incrémente sa case, avec un poids décroissant :
demi-vie de 90 jours, pour qu'un changement d'horaire du magasin finisse par
l'emporter sur l'historique ancien.

Une case devient chaude sous deux conditions simultanées, réglables :

- au moins **3 observations** créditées dans la case ;
- un poids d'au moins **3 fois la moyenne uniforme** de la source, soit trois
  fois `total / 168`.

Rien de plus fin. Avec quelques dizaines d'événements par source, tout modèle plus
riche surapprend sur trois points.

### Le biais d'observation

On n'observe pas l'heure du drop, mais l'heure à laquelle on a regardé. En sondant
toutes les huit heures, tous les drops semblent tomber pile aux heures de sondage :
l'histogramme apprend son propre rythme et se renforce lui-même. Ce mode d'échec
ne lève aucune erreur et donne l'apparence du bon fonctionnement. C'est le
principal risque du sous-système.

Deux corrections, dans cet ordre :

1. **Utiliser la date de début quand la source la fournit.** L'API Epic expose
   `startDate`, l'agrégateur une date de publication. Cette valeur prime toujours.
2. **Sinon, créditer un intervalle, pas une case.** Le crédit est réparti
   uniformément sur les cases couvertes entre le dernier sondage négatif et le
   sondage positif. Le résultat est flou mais non biaisé, et le flou se resserre à
   mesure que les créneaux chauds densifient les sondages.

### Le réveil

Une alarme unique, réarmée à chaque fois sur le prochain instant prévu
(`chrome.alarms.create({when})`), plutôt qu'un battement à la minute qui
réveillerait le service worker 1440 fois par jour. À chaque réveil : exécuter ce
qui est dû, recalculer, réarmer.

Deux filets : une alarme de sécurité toutes les 30 minutes, et un réarmement sur
`runtime.onStartup`, car une alarme se perd au redémarrage du navigateur.

## 7. La réclamation en onglet de fond

### Mode piloté

Le content script actuel démarre seul au chargement (`dispatch()`, ligne 2535). Si
l'orchestrateur ouvre une page Epic, deux logiques se disputent le même bouton. Le
moteur reçoit donc un **mode piloté** : ouvert par l'orchestrateur, le module
s'annonce et attend un ordre. Le démarrage automatique reste le comportement par
défaut lors d'une navigation humaine.

Le protocole tient en trois messages : `ready` du content script, `claim(offre)`
du service worker, `verdict` en retour.

### Le chronomètre est côté service worker

Budget de cinq minutes par offre, décompté par le service worker. Une page
throttlée ne peut pas se surveiller elle-même de façon fiable : c'est son propre
timer qui déraille. À l'expiration, on relève le dernier statut connu, on ferme
l'onglet, et l'offre repart en échec réessayable.

> **Confirmé par V0-2.** Une réclamation complète prend **23 s** dans un onglet
> caché, contre 19 s sans bridage : un huitième du budget. Celui-ci n'est donc
> pas une contrainte serrée mais une marge. Il sert à borner un enchaînement
> bloqué, à limiter l'exposition du compte, et à se prémunir du gel d'onglet —
> pas à devancer un effondrement des minuteurs, qui n'a pas été observé.

### Verrou persistant

Une offre à la fois, jamais deux onglets en parallèle. Le verrou est horodaté dans
le stockage, pas en mémoire : le service worker meurt entre deux réveils. Au
démarrage du navigateur et à chaque réveil, tout onglet portant le marqueur FGC
dont le verrou a expiré est fermé, pour éviter l'accumulation d'onglets orphelins
après un crash.

### Confirmation avant ouverture

> **Révisé après V0-1** (voir `2026-08-27-v0-constats.md`). L'agrégateur ne
> publie jamais l'URL du magasin : sa redirection `/open/<slug>` répond 403 hors
> navigateur. La confirmation préalable n'est donc possible que pour les sources
> natives.

**Sources natives (Epic).** L'API officielle donne l'URL directement. Le service
worker confirme que l'offre est active et à zéro *avant* d'ouvrir quoi que ce
soit. Un faux positif ne se traduit jamais par un onglet.

**Sources issues de l'agrégateur.** L'ouverture de l'onglet est elle-même
l'étape de résolution : on ouvre sur `open_giveaway_url`, on laisse la
redirection s'opérer, on lit l'URL finale via `tabs.onUpdated`, et la
confirmation se fait à l'atterrissage. L'URL résolue est mémorisée : une offre
n'est résolue qu'une fois.

Si l'atterrissage vise un magasin hors périmètre, l'onglet se ferme, l'offre
passe en `skipped`, et une notification unique en donne le lien.

### Les deux arrêts nets

Le moteur sait déjà détecter les deux cas : `isLikelyLoggedOut` (ligne 548) et
`detectSecurityChallenge` (ligne 566), ce dernier corrigé en v2.5.0 pour ne plus
confondre l'iframe hCaptcha invisible d'Epic avec un défi réel.

**Session absente** → verdict `needs_login`. Une notification par jour au maximum,
et le magasin bascule en notification seule tant qu'une session valide n'a pas été
revue.

**Défi visible** → verdict `challenge`. L'onglet reste ouvert en arrière-plan, une
notification annonce qu'une offre attend une validation, l'icône porte un badge.
Cliquer la notification active l'onglet. On ne vole pas le focus, on ne perd pas
l'offre.

### Garde-fous

Les protections existantes sont conservées telles quelles : délais aléatoires
entre les clics, plafond d'essais par offre, repos de 15 minutes après échec, de
30 minutes après une vérification, de 6 heures quand il n'y a plus rien. Une seule
protection nouvelle : un plafond de **10 réclamations par heure**, toutes sources
confondues, réglable. Au-delà, les offres restantes attendent l'heure suivante
sans être perdues.

### Verdicts

Les neuf statuts déjà affichés par le popup restent inchangés : `claimed`,
`redeemed`, `already_redeemed`, `code_pending_gog`, `code_copied`, `needs_link`,
`skipped`, `bad_url`, `failed`. Deux s'y ajoutent : `needs_login` et `challenge`.
L'historique, le popup et l'onglet dédié parlent la même langue.

### Placement de l'onglet

Onglet inactif dans la fenêtre courante. Une fenêtre séparée minimisée serait
pire : Chrome la traite comme cachée, donc même throttling, plus un clignotement à
l'ouverture. Un réglage permet de différer une offre tant que le navigateur est en
plein écran.

## 8. Modèle de données

Six collections sur `chrome.storage.local`, en plus des clés `FGC_*` conservées.

| Collection | Contenu | Écrivain unique |
|---|---|---|
| `offers` | catalogue des offres et leur cycle de vie | service worker |
| `sources` | dernier appel, échecs consécutifs, budget du jour, prochaine vérification | service worker |
| `stats` | 168 cases par source, observations, fenêtre de récence | service worker |
| `schedules` | calendriers de la couche A | interface |
| `settings` | plancher, surcharges, bascules | interface |
| `history` | historique actuel, inchangé | content script et service worker |

La règle de l'écrivain unique n'est pas cosmétique : `chrome.storage` n'offre
aucune transaction, et deux contextes qui écrivent la même clé produisent une
écriture perdue en silence. Le popup et l'onglet dédié lisent tout, n'écrivent que
les réglages, et se rafraîchissent sur `storage.onChanged`.

### Identité des offres

Deux sources annonceront le même jeu. Sans identité stable, on ouvre deux onglets
ou on réclame deux fois. La clé est `magasin:identifiant du magasin` lorsqu'il
existe (slug Epic, `offerId` Luna, appid Steam), avec un repli sur un titre
normalisé — minuscules, accents et ponctuation retirés. En cas de collision de
titres, l'entrée portant un identifiant de magasin l'emporte.

Cycle de vie : `discovered` → `resolving` → `confirmed` → `queued` → `claiming`
→ verdict, ou `expired`. L'étape `resolving` ne concerne que les offres issues
de l'agrégateur, dont l'URL de magasin doit être obtenue par redirection.

Une offre dont l'`end_date` est inconnue passe **en tête de file**, pas en fin :
une expiration qu'on ignore n'est pas une expiration lointaine.

Le catalogue est purgé au-delà de 90 jours. Sans rétention, il grossit sans fin et
finit par saturer le quota de 10 Mo.

### Correction du préchargement

`gm-shim.js` appelle aujourd'hui `storage.local.get(null)` : il charge tout le
stockage en mémoire, à chaque injection, et dans chaque iframe
(`all_frames: true`). Avec un catalogue d'offres et 168 cases par source, la charge
devient absurde. Le shim ne préchargera plus que les clés `FGC_*` nécessaires au
moteur ; les données de veille restent chez le service worker et l'onglet dédié,
qui les lisent en asynchrone.

## 9. Interfaces

### Popup

Inchangé dans son rôle : l'état en un coup d'œil, les codes en attente, les
bascules. Il gagne l'accès à l'onglet dédié.

### Onglet dédié — cinq vues

**Veille** — par source : une bande de 24 heures montrant les créneaux appris, la
prochaine vérification, le budget consommé, un bouton « vérifier maintenant ».
C'est la vue qui rend la prédiction inspectable, donc corrigeable.

**Offres** — ce qui est en cours, et surtout ce qui attend une action humaine :
codes à échanger, comptes à associer, défis à valider. Une action par ligne.

**Historique** — filtrable, exportable en JSON. L'export sert à vérifier après coup
si la prédiction tient, et à ne pas tout perdre le jour d'une désinstallation.

**Réglages** — curseur du plancher, surcharges par magasin, calendriers de la
couche A, activation des sources.

**Journal** — un anneau des 500 dernières entrées, persistant. Sans lui, le mode
de fond est indébogable : aujourd'hui tout part dans la console d'un onglet qui se
ferme avant d'avoir été lu.

## 10. Sources HTML et mode repli

Le service worker n'a pas de `DOMParser`. La découverte en JSON — agrégateur, API
Epic, API Steam — lui convient. Dès qu'il faut lire du HTML (Indiegala, itch.io,
une page produit Steam), il en est incapable sans bibliothèque tierce, et le faire
à coups d'expressions régulières produit du code qui casse tous les deux mois.

**Document offscreen** — une page invisible de l'extension, créée le temps d'un
parse puis détruite. Voie automatique et propre pour les sources HTML.

**Onglet dédié en sentinelle** — déclenché après trois échecs consécutifs d'une
source, ou à la main. Tant qu'il est ouvert, il tient un contexte persistant et
exécute les cycles de découverte avec un chronomètre fiable. Il affiche en clair
que le mode repli est actif, et pourquoi. Dès que la source redevient saine, la
veille repasse au service worker. Ce mode ne devient jamais le mode par défaut.

## 11. Fiabilité et tests

### Le mode d'échec dominant

Ce n'est pas un plantage, c'est un motif de texte qui cesse de correspondre. Trois
des sept correctifs de l'historique du script sont exactement cela — v2.3.0,
v2.5.0 et v2.7.0 — où des libellés écrits sans accents ne trouvaient plus rien sur
l'interface française. Aucune exception n'est levée : le script conclut « rien à
réclamer » et le jeu de la semaine est perdu.

Deux réponses :

- **Un canari.** Au chargement d'une page de magasin, si aucun sélecteur structurel
  connu n'est trouvé (`data-a-target` chez Amazon, les cartes chez Epic), on n'en
  conclut pas que la page est vide : on lève « la page a changé » dans le journal
  et sur le badge. Le silence devient bruyant.
- **Un inventaire lisible.** Tous les motifs vivent dans `patterns.js`, chacun
  accompagné en commentaire d'un exemple réel du libellé attendu.

### Tests

Il n'en existe aucun aujourd'hui, et le fichier n'est pas testable : 2750 lignes
dans une IIFE, sans export. Le découpage lève cet obstacle.

**Logique pure, en tests unitaires** — normalisation des slugs Epic, extraction des
identifiants Luna, détection du magasin de destination, analyse des dates limites,
identité et déduplication des offres, ordonnanceur (état + heure → tâches dues),
crédit par intervalle de l'histogramme, conversion de fuseau de la couche A. C'est
là que vivent les vrais bugs, et rien de tout cela n'exige un navigateur.

**Modules DOM, sur HTML figé** — captures réelles d'Epic `/free-games`, d'une fiche
Luna et de `gog.com/redeem`, rejouées contre les modules. Cela n'anticipe pas les
changements futurs des sites, mais garantit qu'un refactoring ne casse pas
l'existant — le risque propre au découpage.

**Bout en bout, à la main** — la chaîne « alarme → onglet de fond → verdict » se
vérifie par un déclenchement forcé depuis l'onglet dédié, avec le journal comme
preuve. L'automatiser contre les vrais magasins reviendrait à se faire bannir pour
valider un test.

## 12. Migrations

Les clés `FGC_*` sont lues telles quelles et jamais renommées à chaud. Une clé
`FGC_schema_version` porte la version ; chaque montée écrit les nouvelles
collections sans toucher aux anciennes. L'historique et les codes en attente
survivent à la mise à jour : un code GOG perdu est un jeu perdu.

## 13. Hypothèses à vérifier avant d'écrire du code

> **Les trois sont levées.** Voir `2026-08-27-v0-constats.md` pour le détail et
> `2026-08-27-v0-rapport-brut.txt` pour les mesures. Aucune ne bloque, deux ont
> corrigé le design.

1. **L'agrégateur** — confirmée avec réserve. L'API publique existe et couvre 20
   offres actives sur toutes les boutiques visées, mais ne publie **jamais**
   l'URL du magasin : sa redirection répond 403 hors navigateur. D'où l'étape
   `resolving` ajoutée au cycle de vie.
2. **L'onglet de fond** — confirmée, largement. Une réclamation prend 23 s dans
   un onglet caché, contre 19 s sans bridage. L'effondrement des minuteurs à un
   réveil par minute, annoncé plus haut dans une version antérieure de ce
   document, n'a pas été observé. L'objectif 3 tient.
3. **Le document offscreen** — confirmée. `DOMParser` disponible, API en 84 ms,
   page de magasin de 1,4 Mo récupérée et analysée en 574 ms.

## 14. Livraison par vagues

Chaque vague est utilisable seule et se termine sur un constat observable.

**V0 — Vérifications.** Les trois hypothèses du §13.
*Fini quand* : trois constats écrits, et la décision de poursuivre ou de replier
l'objectif 3.

**V1 — Découpage du cœur.** Éclatement en modules à comportement constant, script
de build du userscript, tests unitaires de la logique pure, correction du
préchargement de `gm-shim.js`.
*Fini quand* : le userscript généré et l'extension se comportent comme la v2.7.0
sur les trois magasins, et les tests unitaires passent.

**V2 — Veille en notification seule.** Service worker, ordonnanceur (plancher et
couche A), découverte par agrégateur et API Epic, déduplication, notifications.
*Fini quand* : une offre apparue sans onglet ouvert déclenche une notification avec
un lien direct.

**V3 — Réclamation autonome.** Mode piloté, orchestrateur d'onglets, verrou
persistant, verdicts, garde-fous, confirmation avant ouverture.
*Fini quand* : une offre détectée est réclamée sans intervention, et un défi de
sécurité s'arrête proprement sur un badge.

**V4 — Onglet dédié.** Les cinq vues, le journal persistant, l'export, les réglages
complets.
*Fini quand* : la prochaine vérification, le budget et le journal sont lisibles
sans ouvrir la console.

**V5 — Prédiction, couche B.** Histogramme, crédit par intervalle, créneaux chauds,
budget dérivé, visualisation en bande de 24 heures.
*Fini quand* : au moins une source affiche un créneau chaud appris, et l'export
d'historique permet de le confronter aux drops réels.

**V6 — Sources HTML.** Document offscreen, mode repli sentinelle.
*Fini quand* : une source HTML est découverte automatiquement, et couper
l'agrégateur bascule proprement en repli.

**V7 — Élargissement.** Prime Gaming d'abord, le moins cher puisqu'il réutilise le
module Luna et comble un trou existant. Puis Steam free-to-keep, les boutiques à
rythme quotidien, les lanceurs d'éditeurs.
*Fini quand* : chaque source ajoutée apparaît dans la vue Veille avec son propre
créneau et son propre budget.

## 15. Risques

| Risque | Conséquence | Réponse |
|---|---|---|
| Le biais d'observation s'auto-renforce | La prédiction paraît juste et ne l'est pas | Date de début en priorité, crédit par intervalle sinon |
| L'agrégateur disparaît ou se ferme | Veille aveugle sur les sources non couvertes en propre | Adaptateurs propres pour Epic, GOG, Luna ; mode repli |
| Throttling ou gel de l'onglet de fond | Réclamations inachevées | Budget de 5 minutes, chronomètre côté service worker, échec réessayable |
| Un magasin change ses libellés | Échec silencieux | Canari sur les sélecteurs structurels, alerte au journal et au badge |
| Trafic jugé automatique | Compte limité ou bloqué | Plafond horaire, un onglet à la fois, arrêt net sur session absente |
| Le découpage casse un comportement | Régression sur les trois magasins acquis | V1 à comportement constant, rejeu sur HTML figé |
