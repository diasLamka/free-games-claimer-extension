# Feuille de route

Ce fichier dit ce qui n'est pas encore fait, pourquoi ca vaut d'etre fait, et a
quoi on reconnaitra que c'est fini. Il ne dit pas quand : rien n'est date, et
l'ordre ci-dessous est un avis, pas un engagement.

Le design de fond est ailleurs --
`docs/superpowers/specs/2026-08-27-veille-jeux-gratuits-design.md`, qui decoupe
le travail en vagues V0 a V7. Six vagues et demie sont livrees ; ce qui suit
est ce qu'il en reste, plus ce que les corrections des dernieres versions ont
fait apparaitre.

La premiere entree attend une mesure qu'on ne peut pas provoquer : il faut
qu'un giveaway GOG tourne. Les quatre constats deja pris sont dans
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
| V6 | Sources HTML, mode repli | **livree** -- repli (`sentinel.html`), lecture HTML (`watch/offscreen.js`) et source GOG en propre (2.15.0) |
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
- **Une source GOG en propre** (2.15.0). Le catalogue filtre par prix, en JSON,
  sur un hote deja autorise. Le controle sans filtre a evite le piege d'un
  endpoint desaffecte qui aurait repondu « rien » eternellement sans jamais
  echouer.

---

## 1. La banniere de giveaway GOG

**Le seul morceau de GOG que la source ne voit pas.**

*Ou on en est.* La 2.15.0 livre une source GOG en propre, qui lit le catalogue
filtre par prix en JSON. Elle voit donc tout ce qui passe par ce catalogue.

*Ce qui manque.* Un giveaway GOG s'annonce aussi par une banniere sur la page
d'accueil, et rien ne garantit que le catalogue le porte. Aucun giveaway ne
tournait lors des quatre mesures du 2026-09-17 -- ni element de classe
`giveaway`, ni structure de donnees du meme nom -- donc son balisage n'a pas pu
etre observe.

*Ce qu'il faut pour le fermer.* Une seule mesure, prise pendant qu'un giveaway
tourne : `diagnostics.html`, section V6-V7. Les echantillons de structure
diront alors ou il vit, et la source l'ajoutera en second signal. D'ici la,
l'agregateur le voit, et le journal dit lequel des deux a parle.

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
