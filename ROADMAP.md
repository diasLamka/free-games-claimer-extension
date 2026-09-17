# Feuille de route

Ce fichier dit ce qui n'est pas encore fait, pourquoi ca vaut d'etre fait, et a
quoi on reconnaitra que c'est fini. Il ne dit pas quand : rien n'est date, et
l'ordre ci-dessous est un avis, pas un engagement.

Le design de fond est ailleurs --
`docs/superpowers/specs/2026-08-27-veille-jeux-gratuits-design.md`, qui decoupe
le travail en vagues V0 a V7. Cinq vagues et demie sont livrees ; ce qui suit
est ce qu'il en reste, plus ce que les corrections des dernieres versions ont
fait apparaitre.

Une regle du design vaut aussi ici, et c'est la plus utile : **une hypothese se
mesure avant de s'ecrire** (§13). Chaque entree dit donc ce qu'il faut
constater d'abord. Une entree sans mesure est une entree qui n'est pas prete.

## Etat des vagues

| Vague | Sujet | Etat |
|---|---|---|
| V0 | Verifications | livree -- `docs/superpowers/specs/2026-08-27-v0-constats.md` |
| V1 | Decoupage du moteur | livree -- `src/core/`, 34 modules, build reproductible au bit pres |
| V2 | Veille en notification seule | livree -- `watch/`, 2.8.0 |
| V3 | Reclamation autonome | livree -- 2.9.1, invisible depuis 2.13.0 |
| V4 | Onglet dedie, journal persistant | **partielle** -- le popup a absorbe quatre vues sur cinq, le journal n'existe pas |
| V5 | Prediction, couche B | livree -- `watch/schedule/prediction.js`, bande 24 h dans le popup |
| V6 | Sources HTML, mode repli | **rien** -- la permission `offscreen` est declaree et inutilisee |
| V7 | Elargissement | **rien** -- trois magasins reclamables, un quatrieme seulement detecte |

---

## 1. Le canari de selecteurs

**Savoir qu'un magasin a bouge avant que l'offre soit ratee.**

*Pourquoi maintenant.* Quatre des six dernieres versions du moteur corrigent un
libelle ou un selecteur qui a change sous nos pieds : 2.12.1 (Epic saute
l'etape panier), 2.13.1 (les titres de modales quittent `h1`-`h3`), 2.13.2 (un
span invisible casse un motif ancre), 2.13.4 (l'iframe Turnstile passe dans un
shadow root ferme). Et avant elles, 2.3.0, 2.5.0 et 2.7.0 sur les libelles
accentues. Le scenario est toujours le meme : le magasin change, l'extension
echoue en silence, et c'est l'utilisateur qui l'apprend -- souvent apres avoir
rate quelque chose. Le design l'avait prevu (§15 : « un magasin change ses
libelles -> echec silencieux -> canari sur les selecteurs structurels »).

C'est la seule entree de cette liste qui rende les autres moins cheres : chaque
magasin ajoute augmente la surface a surveiller.

*Ce que ca change.* Une sonde qui passe sur une page deja ouverte, ou pendant
une reclamation, et qui verifie la presence des ancres structurelles -- bouton
d'acquisition Epic, ligne de code GOG, carte d'offre Luna -- **sans cliquer**.
Un manque ne casse rien : il ecrit au journal, leve un badge, et le popup dit
« Epic : le bouton d'acquisition n'a pas ete vu depuis trois passages ».

*A mesurer d'abord.* Le taux de fausses alertes sur une page lente, derriere une
banniere de cookies, ou en cours d'hydratation. Un canari qui crie pour rien
sera coupe au bout d'une semaine, et alors il ne sert plus a rien.

*Fini quand.* Retirer a la main un motif du moteur leve l'alerte au passage
suivant, et l'alerte nomme le motif manquant.

## 2. Prime Gaming

**Le trou le moins cher a combler -- si le domaine vit encore.**

*Pourquoi maintenant.* `gaming.amazon.com` figure dans `host_permissions` et
dans les `matches` du content script, et le moteur refuse de s'y executer
(`src/core/25-luna-entry.js:28`), au motif que ce serait l'ancien domaine
retire lors du passage a Luna. Le design releve le meme trou (§1). L'interet :
les offres Prime arrivent souvent sous forme de CODE a echanger chez GOG, et le
module d'echange existe deja (`src/core/26-gog-redeem-dom.js`,
`src/core/27-gog-redeem-run.js`), file d'attente comprise.

*A mesurer d'abord, et c'est bloquant.* Le commentaire du moteur affirme que le
domaine est mort ; personne ne l'a reverifie depuis. Ouvrir `gaming.amazon.com`
sur un compte connecte, noter ce qui s'y trouve (jeux, contenu en jeu, codes),
d'ou part le bouton de reclamation, et si une API JSON porte la liste. Si les
offres vivent en realite sous `luna.amazon.*/claims`, cette entree tombe et le
commentaire avait raison -- ce qui est aussi un resultat.

*Ce que ca change.* Une source de decouverte de plus, un magasin reclamable de
plus, et le chainage code -> echange deja ecrit et teste.

*Fini quand.* Une offre Prime apparait dans le popup sans qu'aucun onglet soit
ouvert, est reclamee seule, et le code qui en sort part dans la file d'echange.

## 3. Le journal persistant, puis l'onglet dedie

**Aujourd'hui, ce que la veille fait la nuit n'est lisible nulle part le matin.**

*Pourquoi maintenant.* `background.js:57` : `record()` ecrit dans la console du
service worker. Ce worker meurt apres trente secondes d'inactivite, et sa
console avec lui. Le seul endroit ou l'on pourrait lire ce qui s'est passe est
efface avant qu'on le regarde. C'est exactement ce qui a rendu 2.13.4 difficile
a trouver : `alarms.create` jetait, plus aucune alarme n'etait posee, la veille
ne tournait jamais -- et rien, nulle part, n'en portait la trace. Il a fallu
charger l'extension dans un Chromium et regarder vivre.

*Ce que ca change.* Un anneau de 500 entrees dans le stockage (§9), puis une
vraie page d'extension -- pas un popup -- qui les affiche, avec les vues que le
popup porte aujourd'hui a l'etroit dans 328 px : veille par source, offres,
historique filtrable, reglages complets.

*Cout.* L'entree la plus chere en interface, et la moins risquee en moteur :
elle ne touche a aucun magasin. Le journal seul vaut deja d'etre livre, avant
la page.

*Fini quand.* Un echec de cycle survenu a 4 h du matin se lit a 9 h sans ouvrir
la console, et l'export du journal peut accompagner un rapport de bug.

## 4. Les sources HTML, par document offscreen

**La parade au risque numero un est ecrite, mesuree, et jamais branchee.**

*Pourquoi maintenant.* Trois sources de decouverte (`watch/sources/`), et
gamerpower porte a lui seul GOG et tout ce qui n'est ni Epic ni Steam. Sa
disparition est le premier risque du design (§15). Or V0-3 a deja confirme
qu'un document offscreen parse du HTML correctement (`diagnostics.js:251`,
`probe-offscreen.js`), la permission `offscreen` est dans le manifeste, et
aucune source ne s'en sert.

*Ce que ca change.* Une source qui lit du HTML devient possible : une source
**propre pour GOG**, qui n'a aujourd'hui que le tiers, et les boutiques que le
JSON n'expose pas. Puis le mode repli du §10 : apres trois echecs d'une source,
un onglet dedie reprend la decouverte avec un contexte persistant, en affichant
en clair que le repli est actif et pourquoi.

*Fini quand.* Couper gamerpower (hors ligne simule) laisse la veille voir les
offres GOG, et le popup dit pourquoi elle est passee en repli.

## 5. Les codes ne meurent plus avec l'extension

**Un code GOG perdu est un jeu perdu.**

*Pourquoi maintenant.* `watch/tally.js` le dit deja : « rien ne les sauvegarde
aujourd'hui -- ni git, ni synchronisation. Une desinstallation les emporte. »
Depuis, seuls les REGLAGES partent dans `storage.sync` (`popup.js:1223`).
L'export manuel existe : il suppose qu'on y pense, c'est-a-dire qu'on y pense
avant et non apres.

*Ce que ca change.* Les codes en attente, et le registre des acquisitions,
rejoignent la synchronisation. Plus un rappel quand un code dort depuis trop
longtemps -- un code non echange a une date de peremption, le popup l'affiche
deja.

*A trancher, pas a coder d'abord.* `storage.sync` plafonne a 8 Ko par element et
100 Ko au total : cela tient pour des codes, pas pour l'historique complet. Et
il traverse le compte Google, ce qui doit rester un choix de l'utilisateur, pas
un defaut.

*Fini quand.* Desinstaller puis reinstaller sur un profil synchronise rend les
codes en attente.

## 6. Ne pas ouvrir un onglet pour un jeu deja acquis

*Pourquoi maintenant.* Le filtre `keepable` de 2.12.0 a supprime le cas le plus
couteux -- le cosmetique a 0 EUR reclame chaque semaine. Reste l'autre : un jeu
deja dans la bibliotheque fait quand meme ouvrir une page, et ne se decouvre
qu'une fois celle-ci chargee. Chaque ouverture inutile consomme un jeton du
plafond horaire (`watch/claim.js`), c'est-a-dire precisement la ressource qui
protege le compte.

*Ce que ca change.* `watch/library.js` sait ce que l'extension a reclame ; il ne
sait rien de ce que l'utilisateur possedait avant elle. Une lecture de la
bibliotheque en amont -- la ou le magasin l'expose sans authentification
fragile -- eviterait l'ouverture.

*A mesurer d'abord.* Combien d'ouvertures sont reellement inutiles sur un mois.
Si la reponse est « une », l'entree ne vaut pas son code, et elle sort de la
liste.

---

## Hors perimetre, et pourquoi

Ces entrees ne sont pas « plus tard » : elles sont refusees, et il vaut mieux
que ce soit ecrit une fois pour toutes.

| Ecarte | Raison |
|---|---|
| Reclamer sur Steam | Son contrat d'abonnement interdit explicitement les scripts pour interagir avec ses services, resiliation sans preavis. Detecte, affiche, mis a un clic -- jamais clique (`watch/sources/index.js`). |
| itch.io | Le formulaire qui porte le lien de reclamation gratuite porte AUSSI le champ de prix et les boutons Stripe et PayPal. Le seul magasin ou un selecteur un peu large demarre un paiement dans une fenetre invisible. |
| La veille dans le userscript | Tampermonkey n'a pas d'execution de fond. Le userscript garde la reclamation sur page ouverte, et rien de plus (design §3). |
| Un service commun entre utilisateurs | Non-objectif du design : aucune mise en commun de donnees, aucune dependance a un serveur propre. |
| Contourner un captcha ou une limite de debit | Non-objectif. Un defi de securite rend la main a l'humain et remonte l'onglet dans sa fenetre (2.13.4). |
| Predire QUEL jeu sera offert | La seule question posee par l'ordonnanceur est « quand regarder » (design §2). |
