# Feuille de route

Ce fichier dit ce qui n'est pas encore fait, pourquoi ca vaut d'etre fait, et a
quoi on reconnaitra que c'est fini. Il ne dit pas quand : rien n'est date, et
l'ordre ci-dessous est un avis, pas un engagement.

Le design de fond est ailleurs --
`docs/superpowers/specs/2026-08-27-veille-jeux-gratuits-design.md`, qui decoupe
le travail en vagues V0 a V7. Six vagues et demie sont livrees ; ce qui suit
est ce qu'il en reste, plus ce que les corrections des dernieres versions ont
fait apparaitre.

Les deux premieres entrees attendent une MESURE, pas du code, et
`diagnostics.html` sait maintenant la prendre : section V6-V7, avec le reseau
de la machine ou l'extension tourne.

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
| V6 | Sources HTML, mode repli | **mecanisme livre** en 2.14.0 (`watch/offscreen.js`) ; aucune source ne s'en sert encore |
| V7 | Elargissement | **rien** -- trois magasins reclamables, un quatrieme seulement detecte |

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

---

## 1. Prime Gaming

**Le trou le moins cher a combler -- si le domaine vit encore.**

*Pourquoi maintenant.* `gaming.amazon.com` figure dans `host_permissions` et
dans les `matches` du content script, et le moteur refuse de s'y executer
(`src/core/25-luna-entry.js:28`), au motif que ce serait l'ancien domaine
retire lors du passage a Luna. Le design releve le meme trou (§1). L'interet :
les offres Prime arrivent souvent sous forme de CODE a echanger chez GOG, et le
module d'echange existe deja (`src/core/26-gog-redeem-dom.js`,
`src/core/27-gog-redeem-run.js`), file d'attente comprise.

*La mesure existe maintenant, il faut la lancer.* `diagnostics.html`, section
V6-V7, lit `gaming.amazon.com` avec votre reseau et rend son rapport. Le
commentaire du moteur affirme que le domaine est mort ; personne ne l'a
reverifie. S'il est vrai, cette entree tombe -- ce qui est aussi un resultat.
S'il est faux, le module Luna se rebranche dessus.

*Fini quand.* Une offre Prime apparait dans le popup sans qu'aucun onglet soit
ouvert, est reclamee seule, et le code qui en sort part dans la file d'echange.

## 2. Une source GOG en propre

**Le mecanisme est la ; il lui manque des selecteurs mesures.**

*Pourquoi maintenant.* Trois sources de decouverte, et gamerpower porte a lui
seul GOG et tout ce qui n'est ni Epic ni Steam. Sa disparition est le premier
risque du design (§15). Depuis la 2.14.0, `watch/offscreen.js` sait lire une
page HTML depuis le service worker et rendre des extraits bruts qu'une fonction
pure transforme en offres.

*Ce qu'il reste.* Savoir ce que la page d'accueil GOG expose reellement. La
section V6-V7 de `diagnostics.html` cherche les ancres que le moteur connait
deja -- `.giveaway__title` en tete, qui n'est pas une supposition -- et
rapporte lesquelles repondent. Ecrire des selecteurs sans les avoir vus est
precisement ce que ce fichier interdit.

*Fini quand.* Couper gamerpower (hors ligne simule) laisse la veille voir les
offres GOG, et le popup dit pourquoi elle est passee en repli.

## 3. Le mode repli sentinelle

*Pourquoi.* Le §10 du design : apres trois echecs consecutifs d'une source, un
onglet dedie reprend la decouverte avec un contexte persistant, en affichant en
clair que le repli est actif et pourquoi. Le document offscreen couvre le cas
ou la source repond mal ; la sentinelle couvre celui ou le service worker
lui-meme ne suffit plus.

*Fini quand.* Couper une source trois fois de suite bascule la veille en repli,
et la remettre en ligne la fait revenir seule.

## 4. Les quatre autres vues de l'onglet dedie

*Pourquoi.* Le popup porte a l'etroit dans 328 px ce que le design reserve a un
onglet dedie (§9) : veille par source, offres, historique filtrable, reglages
complets. Le journal en est sorti en 2.14.0 et a sa page ; les autres suivront
si le popup devient trop dense.

*Cout.* L'entree la plus chere en interface, et la moins risquee en moteur :
elle ne touche a aucun magasin. C'est aussi la moins urgente -- le popup fait
le travail aujourd'hui.

## 5. Ne pas ouvrir un onglet pour un jeu possede AVANT l'extension

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
| Predire QUEL jeu sera offert | La seule question posee par l'ordonnanceur est « quand regarder » (design §2). |
