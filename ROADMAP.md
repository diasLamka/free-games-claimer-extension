# Feuille de route

Ce fichier dit ce qui n'est pas encore fait, pourquoi ca vaut d'etre fait, et a
quoi on reconnaitra que c'est fini. Il ne dit pas quand : rien n'est date, et
l'ordre ci-dessous est un avis, pas un engagement.

Le design de fond est ailleurs --
`docs/superpowers/specs/2026-08-27-veille-jeux-gratuits-design.md`, qui decoupe
le travail en vagues V0 a V7. Six vagues et demie sont livrees ; ce qui suit
est ce qu'il en reste, plus ce que les corrections des dernieres versions ont
fait apparaitre.

La premiere entree attend une derniere MESURE, pas du code, et
`diagnostics.html` sait la prendre : section V6-V7, avec le reseau de la
machine ou l'extension tourne. Les constats deja pris sont dans
`docs/superpowers/specs/2026-09-17-v6-v7-constats.md`.

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
| V4 | Onglet dedie, journal persistant | **journal livre** en 2.14.0 (`journal.html`) ; les quatre autres vues vivent dans le popup |
| V5 | Prediction, couche B | livree -- `watch/schedule/prediction.js`, bande 24 h dans le popup |
| V6 | Sources HTML, mode repli | **repli livre** (`sentinel.html`), **lecture HTML livree** (`watch/offscreen.js`) ; il manque une source qui s'en serve |
| V7 | Elargissement | **Prime Gaming mesure et ferme** le 2026-09-17 ; trois magasins reclamables, un quatrieme seulement detecte |

---

## Livre en 2.14.0

Quatre entrees de cette liste sont parties dans la 2.14.0, et le detail est
dans `CHANGELOG.md` :

- **Le canari de selecteurs.** Deux echecs de selecteur d'affilee sur un
  magasin levent une alerte, avec le motif technique recopie tel quel. Le
  classement se fait par elimination -- reconnaitre la forme d'un echec de
  selecteur aurait rate les trois derniers.
- **Le journal persistant.** 500 entrees qui survivent a la mort du service
  worker, lisibles et exportables depuis `journal.html`.
- **Les codes qui survivent a la desinstallation.** Reglage coupe par defaut,
  les codes seuls, coupes par les plus anciens quand le lot deborde.
- **Ne pas ouvrir un onglet pour un jeu deja acquis.** Le filtre lit enfin le
  registre, magasin par magasin.

L'integration continue tourne aussi : `npm run check` a chaque push.

## Livre depuis

- **Le mode repli sentinelle** (design §10). Apres trois echecs consecutifs
  d'une source, `sentinel.html` la reessaie sur une horloge fiable, en passant
  outre le recul qui l'endort des heures -- le seul pouvoir du repli, et il ne
  vaut que pendant qu'un humain regarde. Il ne devient jamais le mode par
  defaut : son battement perime en trois minutes, et rien de ce qu'il laisse ne
  suspend la veille ordinaire.
- **Prime Gaming : mesure, et ferme.** Voir la table « hors perimetre ».

---

## 1. Une source GOG en propre

**Le mecanisme est la ; il manque un dernier constat.**

*Pourquoi maintenant.* Trois sources de decouverte, et gamerpower porte a lui
seul GOG et tout ce qui n'est ni Epic ni Steam. Sa disparition est le premier
risque du design (§15).

*Ce que la mesure du 2026-09-17 a montre* (voir
`docs/superpowers/specs/2026-09-17-v6-v7-constats.md`) : la page d'accueil GOG
est **rendue cote serveur** -- 953 Ko, vingt-quatre liens produit des le HTML
brut -- contrairement a Epic, mesure entierement cote client en V0-3. Elle est
donc lisible par une source HTML, et le document offscreen sait deja la lire.

*Ce qu'il reste a trancher.* Aucun element ne porte de classe `giveaway`, ce
qui peut vouloir dire deux choses tres differentes : le selecteur a change, ou
aucun giveaway ne tournait ce jour-la -- et c'est l'explication la plus
economique. Trois blocs de donnees embarquees existent ; la mesure suivante dit
lequel porte le giveaway, ce qui permet d'ecrire une source qui le trouvera le
jour ou il y en aura un, au lieu d'attendre qu'il y en ait un pour l'ecrire.

*Fini quand.* Couper gamerpower (hors ligne simule) laisse la veille voir les
offres GOG, et le popup dit pourquoi elle est passee en repli.

## 2. Les quatre autres vues de l'onglet dedie

*Pourquoi.* Le popup porte a l'etroit dans 328 px ce que le design reserve a un
onglet dedie (§9) : veille par source, offres, historique filtrable, reglages
complets. Le journal en est sorti en 2.14.0 et a sa page ; les autres suivront
si le popup devient trop dense.

*Cout.* L'entree la plus chere en interface, et la moins risquee en moteur :
elle ne touche a aucun magasin. C'est aussi la moins urgente -- le popup fait
le travail aujourd'hui.

## 3. Ne pas ouvrir un onglet pour un jeu possede AVANT l'extension

*Pourquoi.* La 2.14.0 ecarte ce que l'extension a elle-meme reclame. Elle ne
sait rien de ce que l'utilisateur possedait avant elle : ces ouvertures-la
coutent encore un jeton du plafond horaire.

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
| Prime Gaming (`gaming.amazon.com`) | **Mesure le 2026-09-17** : le domaine repond, mais sert l'application Luna -- titre « Amazon Luna Cloud Gaming », aucune mention de Prime Gaming, aucun bloc de donnees embarquees. Le commentaire du moteur disait vrai, et les reclamations Prime vivent deja sous `luna.amazon.*/claims`, que l'extension couvre. |
| Predire QUEL jeu sera offert | La seule question posee par l'ordonnanceur est « quand regarder » (design §2). |
