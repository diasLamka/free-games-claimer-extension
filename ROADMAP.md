# Feuille de route

Ce fichier dit ce qui n'est pas encore fait, pourquoi ca vaut d'etre fait, et a
quoi on reconnaitra que c'est fini. Il ne dit pas quand : rien n'est date, et
l'ordre ci-dessous est un avis, pas un engagement.

Le design de fond est ailleurs --
`docs/specs/2026-08-27-veille-jeux-gratuits-design.md`, qui decoupe
le travail en vagues V0 a V7. Sept vagues sont livrees ; ce qui suit
est ce qu'il en reste, plus ce que les corrections des dernieres versions ont
fait apparaitre.

La premiere entree attend une mesure qu'on ne peut pas provoquer : il faut
qu'un giveaway GOG tourne. Les quatre constats deja pris sont dans
`docs/specs/2026-09-17-v6-v7-constats.md`.

Une regle du design vaut aussi ici, et c'est la plus utile : **une hypothese se
mesure avant de s'ecrire** (§13). Chaque entree dit donc ce qu'il faut
constater d'abord. Une entree sans mesure est une entree qui n'est pas prete.

## Etat des vagues

| Vague | Sujet | Etat |
|---|---|---|
| V0 | Verifications | livree -- `docs/specs/2026-08-27-v0-constats.md` |
| V1 | Decoupage du moteur | livree -- `src/core/`, 34 modules, build reproductible au bit pres |
| V2 | Veille en notification seule | livree -- `watch/`, 2.8.0 |
| V3 | Reclamation autonome | livree -- 2.9.1, invisible depuis 2.13.0 |
| V4 | Onglet dedie, journal persistant | **livree** -- journal en 2.14.0 (`pages/journal.html`), historique filtrable (`pages/historique.html`), et en 2.58.0 le **tableau de bord** : le popup ouvert en grand, veille, offres, codes et reglages cote a cote. Hors design, la **collection** a aussi sa page (2.21.0) |
| V5 | Prediction, couche B | livree -- `watch/schedule/prediction.js`, bande 24 h dans le popup |
| V6 | Sources HTML, mode repli | **livree** -- repli (`pages/sentinel.html`), lecture HTML (`watch/offscreen.js`) et source GOG en propre (2.15.0) |
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
  worker, lisibles et exportables depuis `pages/journal.html`.
- **Les codes qui survivent a la desinstallation.** Reglage coupe par defaut,
  les codes seuls, coupes par les plus anciens quand le lot deborde.
- **Ne pas ouvrir un onglet pour un jeu deja acquis.** Le filtre lit enfin le
  registre, magasin par magasin.

L'integration continue tourne aussi : `npm run check` a chaque push.

## Livre depuis

- **Le mode repli sentinelle** (design §10). Apres trois echecs consecutifs
  d'une source, `pages/sentinel.html` la reessaie sur une horloge fiable, en passant
  outre le recul qui l'endort des heures -- le seul pouvoir du repli, et il ne
  vaut que pendant qu'un humain regarde. Il ne devient jamais le mode par
  defaut : son battement perime en trois minutes, et rien de ce qu'il laisse ne
  suspend la veille ordinaire.
- **Prime Gaming : mesure, et ferme.** Voir la table « hors perimetre ».
- **Une source GOG en propre** (2.15.0). Le catalogue filtre par prix, en JSON,
  sur un hote deja autorise. Le controle sans filtre a evite le piege d'un
  endpoint desaffecte qui aurait repondu « rien » eternellement sans jamais
  echouer.
- **GOG dit lui-meme si sa liste est complete** (2.19.0). La mesure de
  pagination que cette feuille de route attendait n'est plus a prendre : la
  reponse porte `page` et `totalPages`, donc la source publie un `complete` PAR
  REPONSE et GOG fait autorite sur son magasin quand il annonce une page
  unique. Le jour ou il en annonce plusieurs, la veille cesse d'elle-meme d'en
  conclure des disparitions, et le journal l'ecrit.
- **La prediction ancree sur un fuseau nomme** (2.19.1). Les cases de
  l'histogramme glissaient d'une heure a chaque changement d'heure ; la
  demi-fenetre chaude vaut 30 minutes, donc la derive faisait manquer le
  creneau entierement. Les cases existantes sont transposees, pas jetees.
- **Le pays de la boutique est un reglage** (2.20.0), ecrit a un seul endroit et
  lu par les trois couches. Mesure au passage : GOG et GamerPower n'acceptent
  aucun parametre de pays -- le reglage ne concerne qu'Epic, et la devise
  affichee.
- **Une fiche Epic s'ouvre dans une langue que le moteur lit** (2.20.1). La
  2.20.0 envoyait la langue du pays jusque dans l'URL des fiches : six pays sur
  quatorze ouvraient des pages ou aucun motif ne reconnait un bouton. L'API
  garde la langue du pays ; la page, elle, est bornee aux langues que les
  motifs lisent (`fr`, `en`). L'anglais n'a pas encore de capture dans ce
  depot : c'est la prochaine mesure a prendre si une fiche anglaise echoue.
- **Une porte de sortie** (2.26.0). `npm run package` produit deux archives a
  partir d'une liste blanche calculee, et un tag declenche la release.
  Vingt-cinq versions n'avaient atteint personne : le seul mode d'installation
  documente excluait quiconque n'ouvre pas le mode developpeur. La soumission
  aux magasins reste manuelle, et `store/README.md` dit ce qui y attend une
  main humaine.
- **Le chien de garde** (2.28.0). Une panne cesse d'etre un compteur : elle
  a une ouverture, un dernier constat et une cloture implicite. Cinq genres
  detectes, dont deux qui n'avaient aucune voix -- la veille arretee et le
  systeme qui bloque nos notifications. Le tour d'inspection vit HORS du
  cycle : un detecteur de veille morte qui tournerait dans le cycle ne se
  declencherait jamais. Un reglage separe, actif par defaut, qui reste muet
  pour qui avait deja coupe les notifications.
- **Regarder Steam n'est plus cliquer sur Steam** (2.27.0). La source Steam
  s'activait avec l'option de RECLAMATION ; elle est desormais lue pour tout
  le monde, par sa seule recherche publique. La lecture du compte, elle, reste
  conditionnee a l'option -- elle demande les cookies de la session, et
  SECURITY.md promet qu'aucun compte n'est lu sans geste.
- **Les issues d'offres sont figees** (2.27.0). Ce qui se termine laisse une
  trace durable : prise, ratee, ou inconnue, avec le titre et la valeur que la
  purge du catalogue emportait a quatre-vingt-dix jours. Rien ne la lit encore
  -- c'est la collecte qui devait partir en premier, sans quoi la page de
  l'entree 5 s'ouvrirait sur un magasin vide.
- **Steam, en option** (2.22.0). Recuperer aussi sur Steam, coupe par defaut et
  active seulement apres l'avertissement. La page d'une vraie offre a ete
  mesuree a blanc ; le clic lui-meme ne l'a jamais ete -- le premier sera
  celui de l'utilisateur qui active l'option, et un echec y a son motif.
- **Le tableau de bord** (2.58.0), l'entree 2 de cette liste. Ce n'est pas
  une page de plus : c'est le popup, ouvert en grand dans un onglet -- par le
  bouton de son en-tete, ou clic droit sur l'icone -> Options. Au-dela de
  760 px, les volets se posent cote a cote : les jeux en grille, les codes et
  la veille avec sa bande de 24 heures, les reglages. Deux pages auraient
  diverge au premier reglage ajoute ; une seule ne le peut pas. Le vrai popup
  ne change pas de largeur : la mise en page d'onglet n'y entre que par un
  marqueur qu'il ne porte jamais (`lib/dashboard.js`).
- **Ma collection** (2.21.0). Une page qui rassemble ce que Steam, GOG et Epic
  disent que vous possedez, plus ce que l'extension a reclame. Lecture seule, a
  la demande, et jamais d'effacement sur un echec. Le comportement SANS session
  des trois magasins est mesure ; la forme d'une reponse connectee de GOG et
  d'Epic ne l'est pas encore -- c'est l'entree 4.

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
tourne : `pages/diagnostics.html`, section V6-V7. Les echantillons de structure
diront alors ou il vit, et la source l'ajoutera en second signal. D'ici la,
l'agregateur le voit, et le journal dit lequel des deux a parle.

## 2. Les quatre autres vues de l'onglet dedie

**Livre en 2.58.0** -- voir « Livre depuis ». Le popup s'ouvre en grand et
devient l'onglet dedie du design (§9) : veille, offres, codes et reglages sur
un ecran, a cote du journal et de l'historique qui avaient deja leur page.

## 3. Ne pas ouvrir un onglet pour un jeu possede AVANT l'extension

*Pourquoi.* La 2.14.0 ecarte ce que l'extension a elle-meme reclame. Elle ne
sait rien de ce que l'utilisateur possedait avant elle : ces ouvertures-la
coutent encore un jeton du plafond horaire.

*A mesurer d'abord.* Combien d'ouvertures sont reellement inutiles sur un mois.
Si la reponse est « une », l'entree ne vaut pas son code, et elle sort de la
liste.

*Ce qui a change.* La collection (2.21.0) sait desormais ce que vous possediez
avant l'extension, sur Steam, GOG et Epic : la donnee existe, et la mesure
ci-dessus se lit dans la page. Si l'entree se confirme, le filtre ne devra
decider que sur un IDENTIFIANT exact, jamais sur un titre -- un faux « deja
possede » ferait rater un jeu offert, ce qui coute plus cher qu'un onglet de
trop.

*Fait en 2.42.0, sur cette regle.* Une offre Epic (`el.id`), GOG (produit) ou
Steam (appid) dont l'identifiant figure dans la collection n'ouvre plus
d'onglet ; un titre seul n'ecarte rien. Seul compte un magasin dont une
importation a reussi. C'est aussi ce qui evite, sur un nouvel ordinateur, de
tout retenter -- a condition d'y avoir importe la collection.

## 4. Mesurer Ma collection sur un vrai compte

*Pourquoi.* Les importations GOG et Epic reposent sur la forme de reponses que
ce depot n'a jamais lues CONNECTE. Leur comportement sans session est mesure
(2026-09-19) ; le reste est une hypothese, verifiee a chaque lecture mais pas
encore confirmee.

*Ce qu'il faut.* Une seule chose : cliquer « Tout importer » en etant connecte
aux trois magasins. Si une carte dit « reponse inattendue », son bouton
« Copier le rapport » donne la forme exacte de la reponse, sans aucune valeur,
et c'est de quoi corriger le parseur du premier coup.

*A quoi on reconnaitra que c'est fini.* Les trois cartes disent « Importe
le... » avec un nombre plausible -- ou le parseur a ete corrige d'apres le
rapport, et elles le disent ensuite.

*Depuis la 2.46.0, la meme importation mesure aussi la liste de souhaits
Steam.* `rgWishlist` n'a jamais ete lu CONNECTE dans ce depot. Si la carte
Steam dit « N applications · M souhait(s) », c'est confirme ; si son rapport
dit « rgWishlist absent » ou « forme inattendue », la liste importee avant
reste en place et la ligne `forme :` du rapport dit ou chercher.

*Depuis la 2.49.0, elle mesure aussi la categorie Steam Deck.* La ligne
« forme d'un element GetItems » du rapport doit montrer
`platforms: { ... steam_deck_compat_category ... }`. Si `platforms` y manque,
les pastilles Deck restent simplement absentes -- rien ne s'affiche a tort.

## 5. Les jeux mobiles gratuits d'Epic

**Mesure le 2026-09-23 (V8), livre en 2.57.0.** Ils ne sont pas dans
`freeGamesPromotions`, filtre de plateforme ou non ; ils sont dans l'API de
decouverte de l'application, rubrique `mobile-android-free-game` /
`mobile-ios-free-game`. Reste a mesurer : la forme de `purchase` (la date de
fin) et de `media` (la vignette). Le rapport de la 2.57.0 aurait pu couper
`purchase` ; depuis la 2.59.0, la mesure V8 dit pour chaque jeu la date et
la vignette que l'extension retient, et d'ou elle les tient ; elle recopie
`purchase` et `media` a part -- leur forme complete et leurs valeurs, pris
sur le premier jeu qu'elle lit mal. Un
rapport de plus suffira : ou il confirme la lecture, ou il dit quoi corriger.

*Pourquoi.* Epic offre aussi, chaque semaine, des jeux pour Android et iOS.
L'extension ne les voit pas, et on ne sait pas ou Epic les expose. La
capture de `freeGamesPromotions` du 2026-08-27 (12 offres) n'en contient
aucune qui parle de mobile -- ce qui ne prouve rien, puisqu'elle a ete prise
sans savoir qu'on chercherait ca.

*Ce qu'il faut.* Diagnostics -> V8 « Jeux mobiles Epic » -> Lancer la mesure,
un jour ou un jeu mobile est offert, puis Copier le rapport. Elle interroge
quatre endroits, sans cookies et sans permission de plus : l'API deja lue, la
meme filtree par `platform=android|ios`, l'API de decouverte de l'application
mobile (`egs-platform-service`), et la page des jeux gratuits.

*A quoi on reconnaitra que c'est fini.* Le verdict nomme l'endroit, le rapport
nomme le champ -- et la source Epic apprend a les lire. Si Epic ne les expose
nulle part hors de l'application, l'entree passe dans « Hors perimetre », avec
le rapport pour preuve.

---

## Hors perimetre, et pourquoi

Ces entrees ne sont pas « plus tard » : elles sont refusees, et il vaut mieux
que ce soit ecrit une fois pour toutes.

| Ecarte | Raison |
|---|---|
| Reclamer sur Steam SANS le demander | Son contrat d'abonnement interdit les scripts pour interagir avec ses services (4.C), fermeture du compte sans preavis (4.D). Par defaut : detecte, affiche, mis a un clic -- jamais clique. Depuis la 2.22.0, l'utilisateur peut prendre ce risque lui-meme : une option coupee par defaut, activee seulement apres un avertissement qui cite le contrat (`watch/steam-claim.js`). |
| itch.io | Le formulaire qui porte le lien de reclamation gratuite porte AUSSI le champ de prix et les boutons Stripe et PayPal. Le seul magasin ou un selecteur un peu large demarre un paiement dans une fenetre invisible. |
| Le userscript Tampermonkey | Plus produit depuis la 2.48.1. L'extension fait tout ce qu'il faisait, et Tampermonkey n'a pas d'execution de fond (design §3). Les deux actifs sur la meme page reclameraient deux fois. |
| Un service commun entre utilisateurs | Non-objectif du design : aucune mise en commun de donnees, aucune dependance a un serveur propre. |
| Contourner un captcha ou une limite de debit | Non-objectif. Un defi de securite rend la main a l'humain et remonte l'onglet dans sa fenetre (2.13.4). |
| Prime Gaming (`gaming.amazon.com`) | **Mesure le 2026-09-17** : le domaine repond, mais sert l'application Luna -- titre « Amazon Luna Cloud Gaming », aucune mention de Prime Gaming, aucun bloc de donnees embarquees. Le commentaire du moteur disait vrai, et les reclamations Prime vivent deja sous `luna.amazon.*/claims`, que l'extension couvre. |
| Predire QUEL jeu sera offert | La seule question posee par l'ordonnanceur est « quand regarder » (design §2). |
