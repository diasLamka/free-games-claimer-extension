# Historique du moteur

Extrait du bandeau de commentaires de la v2.7.0, sorti du code le 2026-08-27
lors du decoupage en modules. Le fichier `free-games-claimer.js` est desormais
genere : voir `build/build.mjs`.

## 2.39.0 -- 2026-09-22

**340 jeux recuperes, 12 lances**

Toutes les autres phrases de ce produit disent d'en prendre plus. Celle-ci dit
de jouer a ce qu'on a, et c'est la seule qui retourne sa proposition.

Aucun lanceur ne peut la dire, parce qu'aucun ne couvre les quatre magasins.

### Ce qu'il faut dire tout de suite

**Seul Steam publie un temps de jeu lisible.** GOG et Epic n'en exposent aucun.
Le miroir ne couvre donc qu'un magasin sur quatre.

Il le dit plutot que de laisser croire au contraire, et le code le fait deux
fois :

- une acquisition GOG ou Epic n'est PAS comptee « jamais lancee », elle est
  HORS PORTEE. Les confondre accuserait quelqu'un de ne pas jouer a des jeux
  qu'on ne sait tout simplement pas mesurer ;
- le ratio porte sur ce qui est COUVERT, jamais sur le total. Le calculer sur
  le total ferait passer trois magasins sans temps de jeu pour trois magasins
  de jeux ignores.

### Le geste, et l'hote qui n'est pas dans le manifeste

`steamcommunity.com` n'y figure pas, et n'y figurera pas. Il est demande en
permission OPTIONNELLE, au moment du clic, et retirable ensuite -- exactement
l'infrastructure posee en 2.34.0 pour la veille de fond, qui ressert ici pour
la premiere fois.

L'adresse passe par `/my/`, que Steam resout cote serveur vers le profil
connecte : aucun identifiant de profil n'est demande, aucun n'est stocke.

C'est la meme posture que l'import de collection, et la meme phrase de
`SECURITY.md` qu'elle respecte : l'extension ne lit jamais un compte de sa
propre initiative.

### Deux details du format qui coutent cher si on les rate

**Steam OMET `hoursOnRecord` pour un jeu jamais lance.** Le lire comme zero
confondrait deux etats differents : zero peut vouloir dire « lance deux
minutes ». Le champ absent vaut donc `null`, et les deux se distinguent.

**Steam ecrit les milliers avec une virgule : « 1,204.2 ».** Un `parseFloat`
naif s'arrete a 1 et transforme mille deux cents heures de jeu en une seule --
donc un joueur assidu en quelqu'un qui n'a jamais lance le jeu.

### La forme d'une reponse connectee n'a jamais ete mesuree ici

Et c'est assume, avec le meme precedent que l'import de collection : le premier
utilisateur a cliquer sera celui qui la mesure.

La commande rend donc un rapport meme en cas d'echec. Un echec muet ferait
croire a une panne de compte ; un motif -- « profil prive », « forme
inattendue », un code HTTP -- donne de quoi corriger le lecteur du premier
coup. Et rien n'est efface sur un echec.

### Detail

La lecture se fait par expression reguliere et non par analyse de document : un
service worker MV3 n'a pas de DOMParser, le format est plat, et une expression
se teste sans monter un navigateur.

Six cles de libelle par langue (382 par locale). Le moteur est identique a celui
de la 2.38.0.

| | 2.38.0 | 2.39.0 |
|---|---|---|
| tests | 941 | 956 |
| permissions optionnelles | 1 | 2 |

## 2.38.0 -- 2026-09-22

**Le seul signal de l'extension qui puisse vous faire ne PAS acheter**

Tout le reste dit quoi prendre, et quand. Celui-ci dit quoi ATTENDRE.

Un jeu deja offert deux fois est un jeu qu'on peut attendre plutot que payer
vingt euros. La surcouche le dit sur la fiche, et la page Historique en donne
la liste complete.

### La mesure a change la source, et c'est le coeur de cette version

L'idee reposait sur une archive publique des giveaways passes. Elle n'existe
pas.

Mesure du 2026-09-22 sur l'API de l'agregateur : le SEUL statut present dans
sa reponse est « Active », et aucun champ ne designe une offre passee. Il n'y a
donc rien a interroger.

L'histoire vient donc de ce que l'extension a ELLE-MEME observe : les issues
figees depuis la 2.27.0, et le registre d'acquisitions, qui n'est jamais purge
et porte seul les passages anterieurs.

C'est plus pauvre au debut, puisque cela part de rien et grandit. C'est plus
honnete ensuite : chaque ligne est verifiable dans l'historique de celui qui la
lit, et une histoire inventee aurait valu moins que rien.

### Deux sources fusionnees, jamais choisies

Le registre sait ce qui a ete PRIS et survit a toutes les purges. Les issues
savent aussi ce qui a ete RATE, mais s'arretent aux mille dernieres. Ni l'un ni
l'autre ne suffit.

**Le dedoublonnage est le vrai sujet.** Une offre reclamee figure dans les deux
sources : la compter deux fois ferait croire a une recurrence qui n'existe pas.
Et ce chiffre est precisement celui sur lequel quelqu'un va s'appuyer pour ne
pas acheter.

Le recoupement se fait sur le magasin ET le jour. Assez serre pour fondre un
doublon, assez lache pour laisser passer ce qui compte : le meme jeu, sur le
meme magasin, a deux annees d'ecart, reste bien deux passages. C'est meme
exactement le cas qui interesse, et un dedoublonnage trop large aurait detruit
le signal entier.

### Deux passages, pas trois

Un jeu vu deux fois est deja un jeu qu'on peut attendre. Exiger trois passages
rendrait le signal inutilisable pendant des annees, vu la profondeur reelle des
donnees.

### Detail

Le fait est calcule en dernier et ajoute a la fin des autres : savoir qu'un jeu
revient n'annule pas le fait qu'il soit offert aujourd'hui.

Quatre cles de libelle par langue (376 par locale). Le moteur est identique a
celui de la 2.37.0.

| | 2.37.0 | 2.38.0 |
|---|---|---|
| tests | 929 | 941 |
| signaux qui portent sur l'avenir | 0 | 1 |

## 2.37.0 -- 2026-09-22

**Toute la connaissance de l'extension vivait dans son popup**

Sur la fiche d'un jeu, chez Epic, GOG ou Steam, elle ne disait rien. C'est
pourtant la qu'on se demande si on l'a deja, et si on ferait mieux d'attendre.

Un bandeau discret y repond desormais, en bas a droite, et il dit quatre
choses au plus : vous le possedez deja, et ou ; il est offert en ce moment, y
compris sur un autre magasin ; vous l'avez recupere a telle date ; il a deja
ete offert une fois et vous l'avez manque.

Augmented Steam connait Steam. Les extensions GOG connaissent GOG. Aucune ne
connait vos quatre magasins PLUS ce que vous avez reclame, parce qu'aucune ne
les lit toutes.

### Quatre choses que ce bandeau ne fait jamais

**Aucun `innerHTML`.** Le depot n'en compte pas un seul, et ses deux audits le
disent. Ici la regle vaut double : le titre affiche vient du catalogue, donc
d'une API tierce.

**Rien quand il n'y a rien a dire.** L'immense majorite des fiches sont
inconnues de l'extension. Un bandeau vide sur chaque page de magasin serait une
nuisance permanente, et la premiere raison de desinstaller.

**Aucune ecriture, aucun clic.** Le script LIT et affiche. C'est pour cela
qu'il a le droit de venir d'un script de contenu, contrairement aux commandes
du worker, qui sont reservees aux pages de l'extension.

**Aucune feuille de style injectee.** Le style est pose propriete par
propriete : une feuille inseree dans une page tierce peut en modifier le rendu,
et ce script n'a le droit de rien casser.

### Il est SEPARE du moteur, et c'est delibere

Le moteur agit sur trois hotes. La surcouche informe sur quatre. Les melanger
dans la meme entree de manifeste injecterait le moteur sur le magasin Steam, ou
il n'a rien a faire.

Deux entrees, deux jeux de droits. Celui qui agit et celui qui informe ne se
confondent pas.

### « Deja offert » : d'ou vient l'histoire

La mesure a ete prise avant d'ecrire, et elle a change le plan.

**L'agregateur public n'expose que les offres ACTIVES.** Verifie le 2026-09-22 :
le seul statut present dans sa reponse est « Active », et aucun champ ne
designe une offre passee. Il n'existe donc aucune archive a interroger.

La source du fait « deja offert » est donc ce que l'extension a ELLE-MEME
observe : les issues figees depuis la 2.27.0. C'est plus pauvre au debut,
puisque cela part de rien et grandit. C'est plus honnete ensuite, parce que
chaque ligne est verifiable dans votre propre historique, et qu'une histoire
inventee aurait valu moins que rien.

### Un defaut trouve avant la premiere page ouverte

Le module lisait la collection sous une forme qu'il avait imaginee : des lignes
regroupees par titre, avec leurs magasins. Le stockage, lui, garde une carte
PLATE d'articles portant chacun son magasin.

Le bandeau n'aurait jamais dit « vous le possedez deja ». Il n'aurait rien dit
du tout, sans erreur ni message, ce qui est exactement le genre de panne qu'on
met une soiree a comprendre.

Lire la forme d'affichage aurait par ailleurs oblige a rejouer ici le
regroupement de la page Ma collection, donc a le maintenir en double.

### Mesure

| | 2.36.0 | 2.37.0 |
|---|---|---|
| tests | 916 | 929 |
| fichiers empaquetes | 72 | 74 |
| endroits ou l'extension parle | le popup et ses pages | plus les fiches de quatre magasins |

Le moteur est identique a celui de la 2.36.0.

## 2.36.0 -- 2026-09-22

**L'extension se fait montrer le bouton**

Quand un magasin refait sa page, le moteur ne reconnait plus son bouton. Le
canari compte les echecs, une alerte part, et ensuite plus rien : il faut
attendre une version. Un claimer dans un conteneur attend, lui, une nouvelle
image.

Cette version supprime cette attente. Un clic suffit.

### Pourquoi c'est faisable ici, et nulle part ailleurs

Une decision prise bien avant rend la chose possible : **le moteur ne reconnait
pas les boutons par leur forme dans le document, mais par leur TEXTE.**
`lunaClaimLabelAllowed` et `gogSubmitLabelAllowed` sont deja des listes
blanches de libelles, ecrites ainsi parce que les formes changent a chaque
refonte et pas les mots.

Apprendre, c'est donc ajouter un mot a une liste. Pas capturer un chemin CSS
qui casserait au rendu suivant, pas enregistrer une position a l'ecran, pas
piloter un navigateur. Une ligne de texte, dans le stockage local.

### La trace, sans laquelle personne n'apprendrait rien

Un libelle refuse etait une ligne de journal : quelque chose qu'on lit apres
coup et qu'on ne peut pas utiliser. Le moteur retient desormais les huit
derniers boutons qu'il a vus et refuses, par parcours.

L'interface peut alors poser la seule question qui vaille : « lequel de ces
boutons fallait-il cliquer ? » Un clic, pas une saisie. Personne ne recopie a
la main le libelle exact d'un bouton qu'il ne voit plus.

### Tout le danger est la, et il occupe la moitie du code

Un libelle appris trop large ferait cliquer un bouton PAYANT, sur un vrai
compte, sans que personne ne l'ait demande.

**Deux gardes, et il faut que les deux cedent.**

Le premier refuse d'ECRIRE. `watch/teaching.js` rejette tout libelle parlant
d'argent, dans les deux langues, montants et devises compris. Il rejette aussi
ce qui est trop court, donc sans pouvoir discriminant, et ce qui est
demesure, donc colle depuis une page entiere.

Le second refuse de CLIQUER. `looksPaid` passe AVANT la liste apprise, et
l'ordre des lignes le garantit. Un test verifie cela precisement : on ecrit
« acheter maintenant » dans le stockage en contournant volontairement le
module, le lecteur le voit bien, et le clic est refuse quand meme.

Deux gardes qui disent la meme chose ne sont pas une redondance : l'un empeche
d'ecrire, l'autre empeche de cliquer.

### Trois autres refus, plus discrets

**Une surface inconnue est refusee.** Ecrire sous un nom que le moteur ne lit
pas produirait un apprentissage qui ne repare rien, sans le dire.

**La liste est bornee a douze par parcours.** Cent libelles autorises
reviendraient a n'en autoriser aucun : la liste blanche cesserait d'en etre
une.

**Ce qui s'apprend se desapprend.** Sans cela, un libelle appris par erreur
resterait pour toujours, et la seule issue serait de tout effacer -- donc de
perdre aussi ce qui marchait. Ce qui a ete appris s'affiche : un apprentissage
invisible serait une regle secrete appliquee a chaque clic.

### Ce que le developpement a rencontre

Trois gardes du depot ont arrete une erreur avant qu'elle ne sorte, et les
trois valaient leur cout.

Le controle ASCII a refuse deux guillemets francais, puis six accents graves
dans un commentaire. Le controle de renommage a refuse une variable nommee
`reste`, que la table historique transforme en `leftChip` : un nom present dans
cette table casse la comparaison avec la base d'origine.

Et le piege du harnais, documente dans le README, a coute deux tests : le
moteur tourne dans un autre realm, ses tableaux n'ont pas les memes prototypes
que ceux du test, et `deepEqual` les rejette. La reponse etait ecrite depuis
longtemps : passer par `Array.from`.

### Mesure

| | 2.35.1 | 2.36.0 |
|---|---|---|
| tests | 894 | 916 |
| delai de reparation apres une refonte de magasin | une version | un clic |
| gardes entre un libelle appris et un achat | 1 | 2 |

Nouveau temoin fige et base de renommage rebasee. Quatre cles de libelle par
langue (372 par locale).

## 2.35.1 -- 2026-09-22

**Trois tests verts sur une seule machine au monde**

La 2.35.0 est partie avec 894 tests au vert en local et une integration continue
rouge. Les trois tests de permissions lisaient les manifestes par un chemin
Windows ecrit en dur.

C'est le pire symptome qu'un test puisse avoir : vert la ou on l'ecrit, rouge
partout ailleurs. Il ne signale rien tant qu'on reste sur la meme machine, et
il ment sur exactement ce qu'il est cense garantir.

Le chemin se RESOUT desormais depuis le fichier de test lui-meme.
`import.meta.url` connait sa propre position, et c'est la seule reference qui
voyage.

### Le correctif seul n'aurait servi qu'une fois

Rien n'empechait de recommencer. Un garde-fou de plus au build refuse tout
chemin absolu dans `test/` et `build/` -- lettre de lecteur Windows, ou racine
Unix dans une chaine de caracteres.

Il a ete verifie de la seule facon qui vaille : en remettant la faute, en
constatant que le build la refuse, puis en la retirant.

**Pourquoi au build plutot qu'en test.** L'integration continue l'avait bien
attrape, et c'est deja tard : elle tourne apres le commit, apres la poussee, et
apres avoir cru le travail fini. Un garde au build refuse avant.

C'est le meme raisonnement que les trois contraintes du moteur -- ASCII pur,
aucun litteral de gabarit, fins de ligne CRLF -- qui sont toutes la parce
qu'elles ont casse quelque chose en production une fois.

### Detail

Aucun fichier d'execution ne change : le moteur, l'interface et la veille sont
identiques a la 2.35.0. Seuls un test et le build bougent.

## 2.35.0 -- 2026-09-22

**« Bientot » annoncait des jeux sans jamais y mener**

La section publie les ouvertures a venir qu'Epic annonce lui-meme : un titre,
une vignette, une heure. Trois informations, et aucun moyen d'aller voir le
jeu -- alors que c'est exactement ce qu'on veut faire en lisant la ligne.

La cause n'etait pas dans l'interface. `upcomingWindows` ne gardait ni le slug
ni l'adresse de la fiche : le popup n'avait rien a rendre cliquable, et aucun
arrangement d'affichage n'aurait pu l'inventer.

L'adresse est desormais construite par les MEMES fonctions que celle d'une
offre en cours : meme base de chemin, meme slug, meme parametre de langue. Deux
facons de construire l'URL d'une meme page seraient deux facons de se tromper.

**Une ligne sans adresse reste un simple element de liste.** Un lien mort est
pire qu'une absence de lien : il fait cliquer pour rien, et donne l'impression
que l'extension s'est trompee de jeu. Et une ligne qui mene quelque part le
MONTRE -- survol, curseur, contour au clavier : on n'essaie pas de cliquer ce
qui n'a pas l'air cliquable.

### Cinq boutons sur la ligne qui portait deja trois informations

Les quatre versions precedentes ont ajoute a la carte de jeu le souhait, la
priorite, la reclamation a l'unite et le report. Avec le refus deja present,
cela faisait cinq boutons dans la MEME ligne que le magasin, la valeur et le
compte a rebours.

A 328 pixels de large, plus rien ne s'y lisait.

**Deux rangees, deux natures.** Ce que l'offre EST -- magasin, valeur, temps
restant -- et ce qu'on peut en FAIRE. La rangee d'actions garde sa hauteur meme
vide : sans cela, survoler une carte la ferait grandir, et toute la liste
sauterait sous le curseur.

**Trois actions se distinguent.** Celles qui expriment un choix deja fait --
l'etoile posee, le coeur pose -- restent visibles ; les autres s'effacent tant
que la carte n'est pas survolee, parce qu'une liste de vingt offres avec cent
boutons allumes ne se lit plus. La reclamation est verte : c'est la seule qui
AGISSE sur un compte, les quatre autres ne font que trier. Le refus vire au
rouge au survol : c'est le seul geste irreversible de la rangee.

### La jaquette passe en paysage

Les trois magasins servent des visuels larges : vignettes Epic, en-tetes Steam,
jaquettes GOG. Les recadrer dans un carre de 40 pixels coupait le titre du jeu
peint dessus, et il ne restait qu'une texture.

Le format 8:5 montre l'illustration telle qu'elle a ete dessinee, pour
vingt-quatre pixels de largeur en plus. L'anneau de compte a rebours reste : il
epouse le nouveau rectangle sans rien changer a son calcul.

### Ce qui n'a pas ete verifie, et il faut le dire

Cette version touche a la mise en page, et la mise en page se REGARDE. Un banc
d'essai a ete monte pour cela -- la feuille de style reelle du popup, des
cartes ecrites dans la forme exacte que le code produit, a la largeur reelle --
mais l'extension de navigateur n'etait pas connectee au moment de le lancer.

Ce qui est verifie : la feuille de style est equilibree, les 894 tests passent,
et le controle de references du build ne trouve aucun nom inconnu. Ce qui ne
l'est pas : l'allure. Les proportions annoncees ci-dessus sont raisonnees, pas
constatees.

### Detail

Le moteur est identique a celui de la 2.34.0. Une cle de libelle par langue
(368 par locale).

| | 2.34.0 | 2.35.0 |
|---|---|---|
| tests | 888 | 894 |
| lignes « Bientot » cliquables | 0 | toutes celles qui ont une adresse |
| rangees sur une carte de jeu | 2 | 3 |

## 2.34.0 -- 2026-09-22

**La veille s'arretait avec la derniere fenetre, et rien ne proposait autre chose**

Le depot n'avait aucune infrastructure de permission optionnelle : pas de clef
`optional_permissions` dans les deux manifestes, pas un seul appel a
`permissions.request`, et la note du popup annoncait « seulement tant que
Chrome est ouvert » en dur -- un constat, jamais une offre.

Qui ferme sa derniere fenetre le soir ratait donc la rotation du jeudi et le
rappel de fin. La veille tenait tant qu'une fenetre etait ouverte, pas tant que
l'ordinateur etait allume.

### Une nuance honnete, parce qu'elle a failli etre oubliee

La PREDICTION, elle, ne se degrade pas pendant l'absence : au-dela de
vingt-quatre heures elle compte l'observation sans la situer. Le manque etait
la couverture, pas l'apprentissage -- et ecrire l'inverse aurait fait chercher
un bug la ou le code est deja juste.

### Trois etats, et le troisieme est celui qu'on refuse de maquiller

| Etat | Ce qui s'affiche |
|---|---|
| accordee | une case cochee, et la phrase qui dit que la veille continue |
| pas encore | une case a cocher, et la phrase qui l'explique |
| plateforme muette | **aucune case**, et une phrase qui dit pourquoi |

Firefox n'implemente pas cette permission. Son manifeste ne la declare donc
pas -- meme raisonnement que pour `offscreen`, deja absent la-bas.

Une case a cocher sans effet serait pire qu'une case absente : elle ferait
croire que la veille tourne pendant que le navigateur est ferme. C'est
exactement le genre de silence qui coute trois versions a diagnostiquer.

### Le manifeste est LU, pas suppose

Demander une permission qui n'y figure pas echoue -- silencieusement dans
certaines versions de Chrome, ce qui est le pire cas : la case se coche, et
rien ne change. Le popup lit donc `optional_permissions` avant de proposer quoi
que ce soit.

### Une permission optionnelle n'est pas une permission du manifeste

Celle-ci reste HORS du bloc `permissions`. Une permission du manifeste
s'accepte en bloc a l'installation, ou l'on renonce a l'extension. Celle-ci est
un choix pose apres coup, et retirable du meme geste.

Le decochage appelle `permissions.remove` : ce qui s'accorde se retire, sans
quoi la case serait un aller simple.

### Ce que Chrome refuse, et comment on s'y prend

`permissions.request` n'est accepte que depuis un geste utilisateur. Un refus
n'est pas une erreur, c'est un SILENCE -- donc un interrupteur qui ne bouge
pas, sans rien dire. L'etat reel est relu juste apres l'appel, dans les deux
sens : ce qui s'affiche est ce que le navigateur dit, jamais ce que le code a
demande.

### Detail

Le build scanne desormais `watch/permissions.js`, dont les phrases vivent en
table et non en appel de traduction. `watchNote` a ete retiree des deux
locales : la note est devenue dynamique, et une cle que plus rien ne cite coute
une traduction, une relecture et un entretien pour rien -- l'avertissement du
build est fait pour ca.

Quatre cles par langue, une retiree (367 par locale). Le moteur est identique a
celui de la 2.33.0.

| | 2.33.0 | 2.34.0 |
|---|---|---|
| tests | 881 | 888 |
| permissions optionnelles | 0 | 1 |
| la veille tient tant que | une fenetre est ouverte | l'ordinateur est allume |

## 2.33.0 -- 2026-09-22

**Sept magasins sur neuf recevaient l'adresse de Microsoft**

La destination d'un code se decidait par un ternaire binaire : GOG d'un cote,
l'URL de Microsoft pour TOUT le reste. Ecrit en double, dans le moteur et dans
le popup.

Amazon Luna distribue des cles pour neuf plateformes. Une cle Ubisoft, EA ou
Battle.net menait donc a un formulaire qui la refuse -- et le message qui
l'accompagnait affirmait le contraire.

### Une table, et ce qu'elle refuse de contenir

`REDEEM_URLS` vit desormais a un seul endroit logique, en deux exemplaires
techniques : un module ES pour le popup, et son jumeau ES5 dans le moteur, qui
tourne aussi en userscript sans modules. La duplication ne peut pas
disparaitre ; un test de parite verifie qu'elle ne derive pas, exactement comme
celui qui garde le pays de la boutique depuis la 2.20.0.

**Deux entrees renseignees, sept a `null`.** Ce sont les deux seules adresses
que ce depot ait jamais utilisees, donc les deux seules dont il puisse
repondre. Les autres attendent une mesure -- ouvrir la page, constater qu'elle
demande bien un code.

`null` n'est pas un trou : c'est le mot juste. Le bouton d'echange disparait, et
le message dit « collez-le sur le site de X » sans promettre d'adresse.
Inventer une URL plausible aurait coute un onglet ouvert sur une erreur, et la
confiance dans toutes les autres.

L'URL de la page Epic a bien ete interrogee pour cette version : le serveur
repond 403 a toute requete qui ne vient pas d'un navigateur. Ce n'est ni une
confirmation ni un dementi, donc l'entree reste vide.

### Les cles recues ailleurs ont enfin un endroit ou entrer

Humble Choice, IndieGala, Fanatical : rien de tout cela ne passe par Luna, et
l'onglet Codes ne savait donc rien en faire.

Le champ accepte un COLLAGE entier -- titres, puces, lignes vides. Une
expression reguliere sait ignorer ce bruit, et demander a l'utilisateur de
nettoyer serait lui faire faire le travail de la machine. Un code colle en
minuscules est accepte : le motif ne reconnait que les capitales, et le refuser
sans explication serait incomprehensible.

Le motif est recopie a l'identique depuis le moteur, et le test de parite le
verifie aussi. Deux motifs qui divergent feraient accepter dans le popup un
code que le moteur refuse, sans que personne puisse savoir lequel a raison.

### « Echange » et « invalide » cessaient de se ressembler

Un code ne portait que son nombre d'essais, sa derniere tentative et sa
derniere erreur : de quoi savoir qu'on avait essaye, jamais ce qui s'etait
passe. Quatre etats les separent desormais, et l'un veut dire « c'est fait »
quand l'autre veut dire « celui-la ne servira plus jamais ».

### Ce que cette version NE fait pas, et pourquoi c'est ecrit

Elle n'ajoute aucun second moteur d'echange. GOG en a un, mesure : libelles
autorises, detection de page payante, captcha rendu a l'humain, classification
des reponses. Rien d'equivalent n'existe ailleurs, et un parcours qui clique
sur un vrai compte ne s'ecrit pas avant d'avoir mesure la page visee.

C'est la regle du projet, et c'est la seule qui protege un compte.

### Detail

Le moteur change, donc un nouveau temoin de non-regression est fige, avec son
motif, et la base du renommage est rebasee. Le controle du build a attrape deux
violations dans l'ajout avant qu'elles ne sortent : deux accents graves dans un
commentaire -- interdits parce qu'ils cassent le linter de Tampermonkey -- et
des fins de ligne LF dans un depot en CRLF.

Neuf cles de libelle par langue (364 par locale).

| | 2.32.0 | 2.33.0 |
|---|---|---|
| tests | 866 | 881 |
| magasins avec une destination juste | 2 sur 9 | 2 mesures, 7 honnetes |
| endroits ou la destination est ecrite | 2 ternaires | 1 table, 2 copies verifiees |

## 2.32.0 -- 2026-09-22

**Le bilan etait un tableau de chasse. Voici la colonne d'a cote**

Ce qui a ete pris se comptait depuis longtemps. Ce qui a ete rate ne laissait
aucune trace -- et c'est pourtant la seule colonne qui apprenne quelque chose :
un taux de capture qui s'effondre est soit un reglage trop strict, soit une
panne, et les deux se corrigent a condition de les voir.

La page arrive cinq versions apres la collecte, et ce n'etait pas un retard.
Les issues sont figees depuis la 2.27.0 : ouvrir cette page le meme jour
l'aurait montree vide, ce qui n'apprend rien a personne.

### Deux chiffres, et ce qu'ils refusent de dire

**Les issues INCERTAINES sortent du taux.** Une reclamation arretee par un
defi de securite ne dit pas si le jeu est au compte. La compter comme ratee
accuserait l'extension a tort ; la compter comme prise la flatterait. Leur
nombre reste affiche a cote, pour qu'on sache ce qu'on ne sait pas.

**Un historique vide ne rend pas zero pour cent.** Zero sur rien du tout ferait
croire a une panne le premier jour. L'absence de taux se dit, elle ne
s'invente pas.

**Une valeur illisible vaut zero, jamais NaN.** Un « gratuit » dans le champ
valeur suffirait a contaminer la somme entiere et a rendre la page illisible --
pas fausse, illisible, ce qui est pire parce qu'on ne sait plus quoi corriger.

### Les compteurs ne suivent pas le filtre

Ils decrivent tout l'historique, pas la vue. Ils repondent a « comment ca se
passe », pas a « qu'est-ce que je regarde » -- et les faire suivre le filtre
rendrait le taux de capture absurde des l'instant ou l'on ne regarde que les
offres ratees.

### Trois details qui ne se voient qu'a l'usage

**Le titre mene a la fiche quand l'URL a survecu au figement, et reste du texte
sinon.** Un lien mort est pire qu'une absence de lien.

**Le verdict brut est en infobulle.** « needs_login » n'a rien a faire dans une
colonne, et tout a faire a portee de souris le jour ou on cherche pourquoi une
offre est passee a cote.

**La liste des magasins du filtre vient des donnees.** Un magasin qui n'a
jamais rien laisse passer n'encombre pas le menu.

**Les mois se trient sur une cle « AAAA-MM » en UTC**, pas sur un libelle
localise. Un tri sur des dates reconstruites depuis un nom de mois se casse la
premiere fois qu'on change de langue.

### La page reprend la feuille de style du journal, entiere

Les jetons de couleur, la barre de defilement en ticket, les etats de tableau
y sont deja. Une seconde copie divergerait au premier ajustement, et deux
pages de la meme extension finiraient par ne plus se ressembler.

### L'export

En CSV, champs entoures de guillemets et guillemets internes doubles : un titre
de jeu contient des virgules bien plus souvent qu'on ne le croit, et une seule
ligne mal echappee decale toutes les colonnes du fichier.

### Detail

La page est declaree a quatre endroits du build et dans la liste blanche
d'empaquetage. Sans ce dernier point elle aurait marche en mode developpeur --
ou le dossier entier est charge -- et seulement la : exactement le garde pose
en 2.26.0.

Vingt-trois cles de libelle par langue (355 par locale). Le moteur est
identique a celui de la 2.31.0.

| | 2.31.0 | 2.32.0 |
|---|---|---|
| tests | 854 | 866 |
| fichiers empaquetes | 66 | 69 |
| pages | 6 | 7 |

## 2.31.0 -- 2026-09-22

**L'utilisateur ne pouvait exprimer qu'un refus**

Trente versions, et pas une seule ou il dise ce qu'il VEUT. Le seul geste
disponible etait la croix, qui exclut un titre pour toujours : l'extension
savait tout de ce qu'il ne voulait pas, et rien de ce qu'il attendait.

Deux donnees nouvelles, et ce sont les deux premieres du depot a ne venir ni
d'un magasin ni du moteur.

### La liste de souhaits

**Un souhait porte sur un TITRE, jamais sur une offre.** C'est precisement son
interet : le jeu attendu depuis des mois n'est dans aucun catalogue. Un
souhait accroche a une offre disparaitrait avec elle ; accroche a un titre, il
survit a son absence et se reconnait le jour ou il parait, sur n'importe quel
magasin -- y compris celui auquel personne ne pensait.

Ce qu'il change, une fois pose :

- **L'ordre.** Ce qui etait attendu passe devant, apres seulement ce que
  l'utilisateur a explicitement priorise. Le calcul d'urgence garde le reste.
- **L'annonce.** Un jeu attendu ECHAPPE au resume quotidien. C'est toute la
  difference entre savoir qu'il y a des offres et savoir que CELLE-LA est
  arrivee -- et le resume, bon comportement pour le tout-venant, devient le
  mauvais a l'instant ou la liste porte quelque chose qu'on guettait.

**Le drapeau est derive, jamais persiste.** La liste change ; une offre marquee
une fois pour toutes resterait prioritaire longtemps apres le retrait du
souhait, sans que rien ne l'explique.

### La normalisation par defaut a ete supprimee, pas amelioree

Le module acceptait au depart une normalisation optionnelle, avec un repli
faible : minuscules et espaces, sans la ponctuation. Le premier test l'a prise
en flagrant delit -- « Hollow Knight: Silksong » et « hollow knight silksong »
devenaient deux souhaits.

L'erreur ne levait rien. Elle aurait produit deux annonces prioritaires pour un
seul jeu, ou pire, un souhait qui ne reconnait jamais l'offre qu'il attend.

Le repli a donc ete retire plutot que corrige : la fonction est desormais
OBLIGATOIRE, ce qui force chaque appelant a passer celle du modele d'offre --
la seule avec laquelle le rapprochement veut dire quelque chose.

### Le backlog

La page Ma collection savait filtrer, trier, et poser un lien de lancement.
Aucune donnee produite par l'utilisateur ne s'y accrochait : elle etait un
inventaire, pas un outil.

Cinq etats -- non renseigne, a essayer, en cours, fini, abandonne -- un filtre,
et un tirage au sort parmi ce qui est marque « a essayer ». C'est le premier
maillon « jouer » apres « retrouver ».

Trois decisions que le code porte, chacune pour une raison :

**Un etat inconnu est refuse, pas ecrit.** Il ne casserait rien a l'ecriture,
et casserait tous les comptes et tous les filtres a la lecture, sans jamais
lever d'erreur.

**Une entree qui ne dit plus rien est effacee.** Revenir a « non renseigne »
apres avoir efface la note ne laisse pas une coquille dans le stockage.

**Le tirage recoit son hasard.** Un `Math.random` en dur rendrait la fonction
impossible a verifier, et une fonction de tirage non testee finit toujours par
rendre le premier element. Il ne tire que parmi les jeux marques « a essayer » :
tirer dans la collection entiere ressortirait un jeu deja fini.

### Ce que ces deux donnees n'atteignent jamais

**Les annotations ne touchent pas a la reclamation.** Un jeu marque
« abandonne » sur Epic n'empeche pas de prendre le meme offert sur GOG : c'est
un jugement sur une partie jouee, pas une consigne d'acquisition. Le seul
endroit qui refuse une offre reste le filtre, et il ne lit pas d'ici.

### Deux cles, deux ecrivains differents, et ce n'est pas une incoherence

La liste de souhaits passe par le service worker ; les annotations sont
ecrites directement par la page.

La regle est la meme dans les deux cas : **on route par le worker exactement
quand le worker ecrit aussi.** La liste de souhaits est lue a chaque cycle,
donc deux ecrivains sans transaction y perdraient silencieusement un choix que
l'utilisateur vient d'exprimer. Les annotations, le worker n'y touche jamais.

### Mesure

| | 2.30.0 | 2.31.0 |
|---|---|---|
| tests | 830 | 854 |
| cles de veille | 22 | 24 |
| donnees venant de l'utilisateur | 0 | 2 |

Quatorze cles de libelle par langue (332 par locale). Le moteur est identique a
celui de la 2.30.0.

## 2.30.0 -- 2026-09-22

**Le canal qui joint le plus souvent ne servait qu'a informer**

Le service worker ne construisait que des notifications de type « basic »,
sans boutons, et aucun `onButtonClicked` n'etait enregistre. Une offre
annoncee demandait donc d'ouvrir le popup pour en faire quoi que ce soit --
alors que la notification etait deja sous les yeux.

Cette version attendait la 2.29.0, et pas par prudence : ses boutons utiles
demandent une commande a l'unite et un report, qui n'existaient pas avant
elle. Livres plus tot, ils auraient ete decoratifs -- c'est-a-dire pires que
pas de boutons.

### Ce qui manquait n'etait pas les boutons, c'etait la memoire

La table retenue ne gardait qu'un couple identifiant vers URL. Rien ne savait
donc sur QUELLE offre agir.

Et « plus tard » est le cas normal : le service worker meurt trente secondes
apres le dernier evenement, et le clic arrive quand l'utilisateur revient. Un
bouton « Recuperer » sans cette memoire aurait su qu'on a clique, sans savoir
sur quoi.

La table porte desormais l'URL, la cle de catalogue et le genre de
notification. **Les entrees ecrites avant cette version restent lisibles** :
les ignorer ferait que le premier clic apres la mise a jour retombe sur le
popup au lieu de l'offre. Un bug minuscule, une seule fois, et parfaitement
evitable.

### Un numero n'est pas une intention

`onButtonClicked` ne rend qu'un INDEX. Sans une table qui dise, pour chaque
genre de notification, ce que cette position signifie, le second bouton d'un
rappel declencherait l'action du second bouton d'une annonce : une mise en
pause au lieu d'une reclamation, sur la notification meme qui dit que l'offre
se termine.

Cette table est un module pur, donc testable sans navigateur -- ce qui est
exactement ce qu'il fallait, puisque le bug qu'elle evite ne se verrait jamais
a la lecture.

**Un index hors de la liste ne declenche rien.** Retomber sur la premiere
action serait agir dans le doute sur un vrai compte, ce que l'extension evite
partout ailleurs.

### Les boutons, et celui qui est absent

| Notification | Boutons |
|---|---|
| offre reperee | Recuperer, Plus tard |
| fin proche | Recuperer |
| incident | Ouvrir le journal |

**Deux au maximum**, parce que Chrome n'en affiche jamais plus et qu'un
troisieme serait ignore en silence -- donc une action que le code croit offrir
et que personne ne voit.

**Le rappel n'a pas de « Plus tard », et c'est le sujet.** Reporter une offre
qui se termine dans quelques heures, c'est la refuser en croyant gagner du
temps. Un bouton absent est un bouton qui ne peut pas couter un jeu.

**L'incident ne mene qu'a ce qui l'explique.** Le chien de garde aboie, il ne
repare pas : un bouton « reparer » sur une panne dont la cause est inconnue
serait un mensonge.

### Firefox

Son implementation ignore les boutons et REJETTE la creation qui en porte.
Detecter le navigateur serait fragile et se perimerait ; on essaie, et on
recommence sans. Une extension qui n'afficherait plus aucune notification sur
Firefox serait un prix absurde pour deux boutons sur Chrome.

### Detail

Le build scanne desormais `watch/notify-actions.js`, dont les libelles vivent
en TABLE et non en appel de traduction. Le balayage laxiste les reconnait, le
strict les ignore : c'est exactement le cas que la distinction entre les deux
prevoyait.

Trois cles de libelle par langue (319 par locale). Le moteur est identique a
celui de la 2.29.0.

| | 2.29.0 | 2.30.0 |
|---|---|---|
| tests | 819 | 830 |
| ce qu'une notification retient | une URL | URL, offre, genre |
| actions possibles sans ouvrir le popup | 1 | 4 |

## 2.29.0 -- 2026-09-22

**Entre « ne rien faire » et « tout prendre », il n'y avait rien**

« Tout recuperer » existait avec exactement les bonnes garanties : memes
filtres, meme canari, meme registre, meme plafond horaire. Mais il ne
s'affichait qu'a partir de deux offres, et il prenait TOUT. Aucun geste entre
les deux.

Trois manques, tous verifies dans le code avant d'etre combles.

### L'etoile ne faisait rien

C'est le plus genant des trois, parce qu'il avait l'air de marcher.

L'epinglage vivait dans `veille:ui`, dont l'en-tete dit ce qu'il est : des
preferences d'affichage que le service worker ne lit jamais. L'etoile
ordonnait donc la liste dans le popup, et ne changeait RIEN a ce qui etait
reclame en premier -- `claimCandidates` triait sur la seule urgence.

Une etoile qui ne fait rien est pire qu'une etoile absente : elle donne
l'impression d'avoir agi.

La priorite s'ecrit desormais sur le CATALOGUE, via le service worker qui en
est seul ecrivain, et le popup trie sur le meme champ que lui. Un choix
explicite bat le calcul d'urgence, et c'est normal : l'utilisateur sait sur ce
jeu des choses que l'urgence ne dira jamais.

**Les etoiles deja posees ne sont pas jetees.** Elles sont traduites une fois,
au premier affichage, puis la liste d'origine est videe -- c'est elle qui sert
de marqueur, plutot qu'une cle de version de plus.

### « Plus tard » n'existait pas

Le seul geste de mise a l'ecart etait la croix, qui exclut le TITRE pour
toujours, sur tous les magasins et pour toutes les fois ou il repassera. Un
bannissement la ou on voulait un report.

La pause pose une ECHEANCE, jamais un drapeau. Un booleen demanderait a
quelqu'un de penser a le retirer ; une echeance se perime toute seule, et
c'est la seule forme de report qui ne s'oublie pas.

**Elle est bornee par la fin de l'offre.** Reporter au-dela reviendrait a
refuser en croyant remettre a plus tard -- et le refus a deja son geste.

**Un clic explicite passe outre.** Le report est une consigne pour la
reclamation automatique ; obeir a une pause contre celui qui vient de cliquer
serait absurde.

### « Celle-ci, maintenant »

`fgc-claim-one` est inscrite dans la table des commandes, qui refuse tout type
absent : une branche ajoutee sans y etre inscrite echoue bruyamment en test
plutot que de passer en silence en production.

Le bouton emprunte le MEME chemin que « Tout recuperer ». Un second chemin de
reclamation qui contournerait le canari, le registre ou le plafond horaire
serait exactement le genre de raccourci qui finit par ouvrir un onglet sur un
magasin decoche.

Deux precautions qui tiennent en une ligne chacune.

**Le catalogue est reduit a cette seule offre en ENTREE**, pas filtre en
sortie : aucune autre offre ne peut etre tentee par ce chemin, quelles que
soient les evolutions futures de la fonction de reclamation.

**Le resultat est reinjecte dans le catalogue complet.** La fonction n'a vu
qu'une entree ; ecrire son resultat tel quel aurait efface toutes les autres.

**L'arret d'urgence prime.** Le bouton est neuf, l'arret d'urgence est la
promesse la plus forte de l'extension : un chemin nouveau qui l'ignorerait la
viderait de son sens.

Le bouton n'apparait que si l'offre est reellement reclamable, d'apres la meme
fonction de jugement que la veille. Un bouton qui ne ferait rien apprendrait a
s'en mefier.

### Ce que le test a fait changer dans le code de production

Le geste de reclamation est devenu injectable, comme le `fetch` juste
au-dessus de lui. Sans cela, tester qui est candidat, dans quel ordre et sous
quel plafond aurait demande de monter un faux navigateur complet a chaque
fois -- et un test trop cher est un test qu'on n'ecrit pas.

### Detail

Le build scanne desormais `watch/health.js` pour les cles de libelle : les deux
titres de notification du chien de garde y avaient demenage en 2.28.0, et
passaient depuis pour orphelines -- une faute de frappe y serait restee
invisible.

Trois cles de libelle par langue (316 par locale). Le moteur est identique a
celui de la 2.28.0.

| | 2.28.0 | 2.29.0 |
|---|---|---|
| tests | 806 | 819 |
| commandes du worker | 12 | 15 |
| gestes par offre | 2 | 4 |

## 2.28.0 -- 2026-09-22

**L'extension savait deja qu'elle etait cassee. Elle ne savait pas le dire**

Trois detecteurs existaient, complets et testes : le canari de selecteurs, la
source en repli, la session perdue. Leurs constats allaient au journal -- une
page qu'on ouvre quand on soupconne deja quelque chose -- ou a un bandeau du
popup, qu'on voit en l'ouvrant. Ni l'un ni l'autre ne PREVIENT.

Quatre constats de code disaient ce qui manquait. Les quatre appels a
`notify()` parlaient tous d'offres. Le badge ne savait rendre qu'un nombre.
Aucune cle ne se souvenait d'une panne. Et personne ne comparait la date du
dernier cycle a l'intervalle prevu, alors que les deux valeurs etaient ecrites
a chaque reveil.

### Une panne cesse d'etre un compteur

C'est le changement de fond, et tout le reste en decoule. Une panne etait un
compteur qui monte ; elle devient un INCIDENT, avec une ouverture, une
derniere observation, et une cloture.

De la viennent les trois choses qui manquaient : dire depuis quand, ne le dire
qu'une fois, et savoir que c'est fini.

**La cloture est implicite.** Un incident que le tour d'inspection ne
reconstate pas disparait. Demander a chaque detecteur de fermer ce qu'il a
ouvert aurait fini par un oubli, et un incident fantome fait chercher une
panne qui n'existe plus -- ce qui use la confiance plus vite qu'un silence.

**Et rien n'annonce le retour a la normale.** Un probleme resolu n'interrompt
personne.

### La panne qui n'avait aucun detecteur

Deux genres d'incident sont nouveaux. Le premier est la raison d'etre de cette
version : la veille qui cesse de tourner. C'est la seule panne qui dise
« l'extension est morte », et elle n'avait aucune voix.

Le seuil laisse passer un cycle manque -- un portable ferme une nuit ne doit
rien declencher -- avec un plancher de six heures, qui est le pas nominal d'un
reglage par defaut.

**Et voici ce qui a commande toute la conception.** Un detecteur qui vivrait
dans le cycle ne se declencherait JAMAIS pour cette panne : quand la veille est
morte, le cycle ne tourne pas, donc le detecteur non plus. Un chien de garde
qui dort avec le chien qu'il garde ne garde rien.

Le tour d'inspection vit donc dans le gestionnaire d'alarme, que l'alarme filet
periodique reveille. Cette alarme existait deja, et sa propriete de survivre a
la mort du service worker etait deja payee : c'est exactement celle dont ce
detecteur avait besoin.

Le second genre nouveau lit une permission que le depot n'interrogeait nulle
part : `getPermissionLevel`. Si le systeme refuse nos notifications, tout ce
qui precede est inaudible, et personne ne le savait.

### Ce que le test a trouve, et qui aurait coute l'alerte entiere

Une alerte partait quand meme vers un canal bloque. Le cout n'etait pas l'appel
inutile : elle etait marquee DITE alors qu'elle n'etait arrivee nulle part, et
elle aurait ete perdue pour toujours -- y compris apres le retour de la
permission, moment ou elle serait enfin utile.

Un canal coupe se traite donc comme les heures calmes : silence, et rien de
marque. Ce qui attend part des que la permission revient.

### Le reglage qui ne devait trahir personne

Un incident n'est pas une offre. Quelqu'un qui ne veut plus etre prevenu des
jeux gratuits veut probablement savoir que son extension est cassee. Mais lui
envoyer des notifications apres qu'il les a coupees serait exactement la
trahison que ce depot nomme deja : « une preference perdue en silence est une
trahison silencieuse ».

`alertMode` est donc un reglage separe, actif par defaut, avec une traduction
UNIQUE : un `notifyMode: 'off'` deja choisi eteint aussi ce canal-la, une seule
fois, exactement comme `notifications: false` devenait `notifyMode: 'off'`
depuis la 2.10. Ensuite les deux sont independants -- et couper les offres en
gardant les alertes est precisement la combinaison la plus utile.

**Heures calmes et silence ne sont pas la meme chose**, et la difference est
codee. Les heures calmes DIFFERENT : rien n'est marque, l'alerte repart au
matin. Le mode coupe SUPPRIME : ce qui attendait est marque dit sans etre dit,
sinon tout partirait d'un coup le jour ou l'utilisateur rallume.

### Le badge, et pourquoi il ignore son propre reglage

Un incident ouvert remplace le compte d'offres par une marque. Une panne prime
sur un decompte, que le popup affiche de toute facon.

Il ignore `badgeMode`, et c'est delibere : ce reglage dit « ne me compte pas
les offres », pas « ne me dis jamais rien ». Les confondre enterrerait la
derniere voix disponible quand le systeme bloque les notifications.

Le badge est aussi peint par le tour d'inspection, et pas seulement en fin de
cycle -- sans quoi il serait muet dans le cas ou il sert le plus.

### Dans le popup, deux incidents et pas cinq

Trois des cinq genres ont deja leur bandeau, avec leur geste propre : le
selecteur mort s'acquitte, la source en repli ouvre la sentinelle, la session
perdue mene a la page de connexion. Les repeter ferait deux alertes pour une
panne, et la seconde userait la premiere.

Le bandeau nouveau ne porte donc que les deux qui parlent de l'extension
elle-meme. Il mene au journal, pas a un bouton de reparation : le chien de
garde aboie, il ne repare pas.

### Ce que la conception a change dans le plan

Cette version devait aussi porter les notifications actionnables. La
conception a montre que non : leurs seuls boutons utiles -- « Recuperer »,
« Me rappeler » -- demandent une commande et un champ qui n'existent pas
encore et qui appartiennent a la file de reclamation pilotable. Livrer avant
elle aurait donne des boutons decoratifs, c'est-a-dire pire que pas de
boutons.

La file passe devant. Rien n'est abandonne.

### Mesure

| | 2.27.0 | 2.28.0 |
|---|---|---|
| tests | 762 | 806 |
| cles de veille | 21 | 22 |
| genres d'incident detectes | 0 | 5 |
| pannes qui previennent l'utilisateur | 0 | 4 |

Le cinquieme genre ne previent pas : c'est celui qui dit que le canal est
coupe.

### Detail

`watch/health.js` est sorti de `background.js` pour une raison qui n'est pas de
style : ce qu'il observe est l'ABSENCE de cycle, donc il ne peut pas etre teste
a travers un cycle. Il lui fallait un point d'entree a lui, jouable sans rien
demarrer. Le service worker n'en garde que le branchement.

Deux cles de libelle ajoutees par langue, plus deux pour le bandeau du popup
(313 par locale). Le moteur est identique a celui de la 2.27.0.

## 2.27.0 -- 2026-09-22

**Deux choses ecrites depuis des mois, et que personne n'avait branchees**

Aucune ligne de moteur ne change. Les deux sujets de cette version etaient
deja dans le depot : l'un attendait un interrupteur separe, l'autre attendait
qu'on decide d'ecrire ce qu'on savait deja.

### Regarder Steam et cliquer sur Steam etaient le meme interrupteur

La source Steam est ecrite en entier depuis la 2.22.0. Elle est la seule a
rendre trois choses que l'agregateur ne connait pas : la date de fin EXACTE de
l'offre, le type DLC, et le numero de paquet.

Elle ne s'activait qu'avec `steamAutoClaim` -- l'option qui fait CLIQUER,
coupee par defaut et confirmee derriere un avertissement qui cite le contrat
Steam. Or ce contrat interdit le clic scripte, pas la lecture d'une page de
recherche publique. Les deux etaient lies pour une raison technique : c'est la
source Steam qui donne le paquet, sans lequel aucune reclamation n'est
possible. La consequence n'etait pas technique du tout.

Qui refusait le clic automatique -- le cas par defaut, volontairement -- ne
voyait de Steam que ce que GamerPower en dit : des cles offertes sur des sites
tiers, sans paquet, que le filtre rejette. Le magasin figurait dans la liste
des magasins suivis et n'y apportait rien.

Les deux questions sont desormais separees :

| | Avant | Maintenant |
|---|---|---|
| Lire la recherche Steam | seulement avec l'option | **pour tout le monde** |
| Lire ce que le compte possede | a chaque cycle, avec l'option | inchange : seulement avec l'option |
| Cliquer | seulement avec l'option | inchange : seulement avec l'option |

### La ligne de SECURITY.md qui commandait la forme de ce changement

« L'extension ne lit jamais un compte de sa propre initiative. »

Lire les possessions Steam demande les cookies de la session. Activer la
detection pour tout le monde SANS separer cette lecture aurait donc ouvert une
requete porteuse de cookies chez chaque utilisateur, par defaut, pour une
fonction qui n'en a pas besoin -- et aurait fait mentir cette phrase.

Le parametre qui l'evite existait deja dans la source, et personne ne le
passait jamais : `withOwned` valait `true` par defaut et aucun appelant ne
disait le contraire. Le cycle le transmet desormais, et il se compare a `true`
et non a la veracite -- meme severite que `claimableStoresFor`, parce que ce
qui declenche une requete porteuse de cookies la merite.

Le mode sans compte se tait aussi sur ce qu'il ignore : `alreadyOwned` vaut
INCONNU, jamais « non ». La nuance coute un jeu si on la rate -- un « non »
affirme sur un jeu deja acquis ferait afficher « pas encore recupere » a
quelqu'un qui l'a depuis des annees.

### Ce qui est passe, pris ou rate

Le bilan compte ce qui a ete PRIS. Rien ne gardait ce qui a ete RATE, et c'est
pourtant la seule colonne qui apprenne quelque chose : une offre expiree sans
avoir ete reclamee est soit un reglage trop strict, soit une panne, soit un
choix delibere. Les trois se ressemblaient, faute de trace.

Le catalogue ne pouvait pas tenir cette memoire, pour deux raisons : il est
purge a quatre-vingt-dix jours, et le motif d'ecart n'est calcule qu'a
l'affichage, donc jamais ecrit. Passe ce delai, l'information n'existait plus
nulle part.

`watch/outcomes.js` fige donc l'issue A L'INSTANT OU L'OFFRE SE TERMINE, seule
fenetre pendant laquelle tout est encore connu. Meme raisonnement que le
registre de bibliotheque pour les acquisitions, avec une difference qui
commande le reste : une acquisition est rare et precieuse, donc le registre
n'a pas de plafond ; une issue arrive pour CHAQUE offre qui passe, donc
celui-ci en a un -- mille, les plus vieilles partant d'abord.

**On balaie le catalogue, pas les trois listes.** Une offre devient terminale
par trois chemins : sa date passe, elle disparait de sa source, une
reclamation la resout. Suivre les trois separement demanderait trois cablages,
donc trois occasions d'en oublier un -- et un oubli ici ne se verrait pas : la
page serait simplement moins complete, sans la moindre erreur. Le balayage est
sur parce que la premiere issue gagne, propriete qui vient du cycle lui-meme,
rejouable par conception.

**Trois issues, et la troisieme est celle qu'on refuse de deviner.** Prise,
ratee, ou inconnue. Un echec, un defi de securite, un compte a associer :
l'offre est finie et personne ne sait si le jeu y est. Le dire est utile ;
trancher ne l'est pas. Le verdict brut reste fige a cote, pour qui veut la
nuance.

### La page viendra plus tard, et c'est voulu

Rien dans l'interface ne lit encore ces issues. La collecte part maintenant
parce qu'une page branchee sur un magasin vide n'apprend rien : il faut que la
collecte ait tourne avant. C'est la meme raison qui fait que cette entree
arrive en 2.27.0 et non en meme temps que la page.

### Ce qui a change dans les tests, et pourquoi

Deux tests anciens ont ete reecrits plutot que corriges, parce qu'ils
affirmaient la promesse d'avant.

Le premier exigeait que la source Steam soit inactive par defaut. C'etait lier
regarder et cliquer dans une assertion. Il affirme desormais l'inverse pour la
source, et la meme chose qu'avant pour la reclamation.

Le second exigeait que la source ne soit meme pas interrogee sans l'option. Il
verifie maintenant trois choses au lieu d'une : la source est interrogee,
aucun onglet ne s'ouvre, et le compte n'est pas lu.

### Mesure

| | 2.26.0 | 2.27.0 |
|---|---|---|
| tests | 734 | 762 |
| cles de veille | 20 | 21 |
| requetes porteuses de cookies, reglages par defaut | 0 | 0 |

`SECURITY.md` annoncait 16 cles ; le compte reel etait de 20 avant cette
version. Corrige au passage.

### Detail

Le moteur est identique a celui de la 2.26.0, au numero de version pres : rien
de cette version ne touche a `src/core`.

## 2.26.0 -- 2026-09-22

**L'extension savait tout faire, sauf arriver chez quelqu'un**

Vingt-cinq versions, 734 tests, deux audits de securite -- et un seul mode
d'installation documente : « Mode developpeur, charger l'extension non
empaquetee ». Autrement dit personne, sauf un developpeur devant ce depot.

La consequence n'est pas theorique. La 2.24.0 a ferme quatre faiblesses de
defense en profondeur. Elle n'a atteint aucune installation, parce qu'aucune
installation n'a de moyen d'apprendre qu'elle existe. Un correctif qui ne
part pas est un correctif qui n'a pas ete ecrit.

Cette version ne change rien a ce que fait l'extension. Elle lui donne une
porte de sortie.

### Deux archives, et une liste blanche plutot qu'un dossier

`npm run package` ecrit `dist/free-games-claimer-chrome-vX.Y.Z.zip` et sa
jumelle Firefox. Ce qui part est une liste **calculee**, jamais le contenu du
dossier : le depot porte le moteur en deux exemplaires -- les 34 modules de
`src/core` et l'artefact genere -- plus le build, les tests, les vingt-deux
temoins figes et la documentation.

La liste part de points d'entree et suit les references. Les points d'entree
sont de deux natures, et oublier la seconde etait le piege.

**Ce que le manifeste designe** : le worker, les scripts de contenu, le popup,
les icones. C'est la partie facile, et le build savait deja la lire.

**Ce qui s'ouvre a l'execution**, par `chrome.tabs.create` ou
`chrome.offscreen.createDocument`, depuis une chaine litterale qu'aucun
manifeste ne mentionne. Six pages sont dans ce cas : le journal, Ma
collection, la sentinelle, le diagnostic, et les deux documents hors ecran.
Une fermeture calculee depuis le seul manifeste les aurait oubliees toutes
les six -- et le symptome aurait ete celui d'`ERR_FILE_NOT_FOUND`, revenu
trois fois ici : Chrome charge l'extension sans broncher, puis la page
s'ouvre vide.

### Le garde qui compte pour demain

La liste des six pages est tenue a la main, et c'est assume. Ce qui ne l'est
pas, c'est qu'une septieme puisse etre ajoutee sans que personne le remarque.

L'empaquetage refuse donc de produire une archive tant qu'un `.js` ou un
`.html` du depot -- hors atelier -- n'est joint par personne. Le controle
tourne dans `npm run check`, a chaque commit.

C'est le seul garde qui valait vraiment d'etre ecrit, parce que le bug qu'il
attrape est invisible la ou on travaille : en mode developpeur le dossier
entier est charge, donc la page oubliee marche. Elle ne casse que chez
l'utilisateur. Vert en developpement, casse en production, sans aucun message.

### Ce que les tests ont trouve avant la premiere publication

Le test de la variante Firefox a echoue du premier coup, et pour une bonne
raison : Chrome declare son fond par `service_worker`, Firefox par une liste
`scripts`. La lecture du manifeste ne connaissait que la premiere forme.

L'archive Firefox serait donc partie **sans `background.js`** -- et sans rien
de ce que ce fichier importe, c'est-a-dire toute la veille. Une extension qui
s'installe proprement, qui affiche son popup, et qui ne surveille rien. Le
genre de panne qu'on met une soiree a comprendre parce que tout a l'air
normal.

### Une archive reproductible

L'horodatage interne est fige a 1980-01-01, plancher du format. Deux
personnes qui empaquettent le meme commit obtiennent le meme octet et la meme
empreinte, ce qui permet de verifier qu'un zip publie correspond bien au code
du depot.

Ce n'est pas une coquetterie dans un depot qui compare deja le moteur au bit
pres a chaque build : c'est la meme promesse, etendue jusqu'au fichier que
l'utilisateur telecharge.

### La release, et ou elle s'arrete volontairement

Un tag `vX.Y.Z` declenche `.github/workflows/release.yml` : controle que le
tag et `package.json` disent la meme version, `npm run check` en entier,
empaquetage, depot des deux archives sur une release GitHub.

Le premier controle merite son existence. Sans lui, un tag `v2.27.0` pose sur
un depot encore en 2.26.0 publierait une archive dont le manifeste annonce
2.26.0 -- et le navigateur refuserait la mise a jour suivante, puisqu'il
compare les numeros du manifeste et non ceux du depot.

La chaine s'arrete avant la soumission aux magasins, et c'est un choix.
Envoyer sans relire ce qui part fait publier une erreur plus vite, pas mieux.

### Ce qu'il reste a faire a la main

`store/` porte ce qu'un magasin demande et que le code ne contient pas : la
fiche en deux langues, une justification par permission derivee de
`SECURITY.md`, une politique de confidentialite. Trois choses y attendent
encore une main humaine : les captures d'ecran, l'adresse de contact, et la
soumission elle-meme.

Un point propre a Firefox y est note pour ne pas etre decouvert pendant la
relecture : `free-games-claimer.js` est un fichier **genere**, et AMO exige la
source et les instructions de construction de tout code genere.

### Mesure

| | Chrome | Firefox |
|---|---|---|
| fichiers dans l'archive | 60 | 60 |
| taille | 316 683 octets | 316 723 octets |
| fichiers du depot laisses de cote | 0 | 0 |

Archives extraites par un decompresseur tiers, hors du code qui les ecrit :
60 fichiers, moteur et icones identiques a l'octet pres aux fichiers du
depot.

### Detail

Vingt et un tests nouveaux, dont un lecteur de ZIP ecrit dans le test plutot
qu'en production -- relire avec notre propre ecrivain n'aurait prouve que sa
coherence avec lui-meme. `dist/` est ignore par git : reproductible depuis un
commit, donc inutile a versionner.

Aucun fichier d'execution n'a change. Le moteur est identique a celui de la
2.25.2, au numero de version pres.

## 2.25.2 -- 2026-09-20

**Les huit sections se replient, et un pli qui a une alerte s'ouvre tout seul**

La 2.25.1 en avait replie quatre et laisse cinq depliees. Demande : replier
les autres. Fait -- mais replier Magasins et Veille de fond n'etait pas une
simple continuation, parce que ce sont les deux seuls endroits ou l'extension
CRIE.

### Ce que replier aurait coute, si on s'etait arrete la

Trois alertes vivent dans ces deux sections : le canari qui signale un
selecteur mort, la source mise en repli apres trois echecs, la session
perdue. Un chevron par-dessus, et aucune des trois n'existe plus. On aurait
gagne des pixels en enterrant le seul mecanisme qui previent quand la
reclamation cesse de marcher -- exactement le silence qui a coute trois
versions en septembre.

D'ou deux regles, ajoutees avec les plis plutot qu'apres.

**Un pli ferme garde sa ligne de verdict.** A droite du titre, sans rien
ouvrir : « 4 recuperes », « autonome », « 4 suivis », « 3 sources ». Replier
n'est pas cacher.

**Un pli qui a une alerte s'ouvre de lui-meme**, et seulement lui. Magasins
s'ouvre sur un canari ou une session `logged_out` ; Veille de fond sur une
source en repli. Une session `inconnu` n'ouvre rien : elle n'appelle aucun
geste, et l'ouvrir ferait passer une ignorance pour une alerte -- la lecon de
la 2.22.2, tenue jusque dans un chevron.

**Une fois par ouverture du popup.** `render()` retourne apres chaque clic ;
sans ce souvenir, un pli que l'utilisateur vient de refermer se rouvrirait
sous ses doigts. Il a ferme : c'est une reponse, pas un accident.

### L'arret d'urgence reste deplie

Seule section sur neuf. Une section qu'on ouvre en panique ne se cherche pas
derriere un chevron, et son bouton ne vaut que s'il est deja la.

### Mesure

Meme donnee semee, meme fenetre de 560 px, popup.js reellement execute dans
Chromium.

| Onglet Reglages a l'ouverture | 2.25.1 | 2.25.2 |
|---|---|---|
| rien a signaler | 1391 px (2,5 ecrans) | **467 px -- aucun defilement** |
| rien a signaler, densite compacte | -- | **395 px** |
| canari + repli + session perdue | 1391 px | 1212 px, les deux bons plis ouverts |
| tout deplie a la main | -- | 2185 px |

Les trois declencheurs ont ete pris un a un : canari seul ouvre Magasins,
repli seul ouvre Veille de fond, session perdue seule ouvre Magasins, et rien
n'ouvre rien quand tout va bien.

### Detail

Cinq cles de libelle ajoutees (309 par locale). Les quatre plis de la 2.25.1
fermaient a dix espaces d'indentation ; ils ferment desormais sous leur
ouverture.

## 2.25.1 -- 2026-09-20

**Trois fissures dans une interface qui, par ailleurs, n'a pas besoin d'etre refaite**

Question posee : faut-il redessiner l'interface ? Apres l'avoir mesuree et
regardee : non. Un seul jeu de jetons pour cinq pages, aucun controle natif
non style, et des choix d'interaction qui tiennent -- l'annulation a 12 s sur
un rejet, l'anneau de decompte, les onglets collants. Une refonte aurait
detruit ca pour rien.

Trois defauts precis, en revanche.

### Le reglage de densite n'existait pas

`popup.js` enregistrait `density: 'cosy'`. `popup.html` definissait
`body[data-density="compact"] { --pad: 10px; --gap: 5px; }`. Et **rien ne
posait jamais `data-density`**, aucun controle ne permettait d'en changer.
Une preference que personne ne pouvait modifier, une regle qui ne
s'appliquait jamais, et les deux qui s'attendaient depuis des mois.

Le lien est fait, et le choix ajoute a la section Apparence.

### La page de diagnostic ignorait le theme

Les quatre autres pages ont trois blocs de theme : la base sombre, la media
query `prefers-color-scheme`, et la surcharge `[data-theme]`. Diagnostics
n'en avait qu'un. Elle restait en sombre meme quand l'utilisateur avait
choisi Clair. Elle a desormais les trois, et lit la preference comme le
journal, la collection et la sentinelle.

### L'onglet Reglages faisait trois ecrans

**1592 px mesures, dans une fenetre qui en montre 560** : neuf sections,
31 controles, 3,1 ecrans de defilement. C'est ce que `ROADMAP.md` avait
nomme -- « le popup porte a l'etroit dans 328 px ce que le design reserve a
un onglet dedie ».

Les quatre sections qu'on regle une fois puis qu'on oublie -- notifications,
reclamation sur page ouverte, apparence, sauvegarde -- se replient. Les
quatre qui portent le travail quotidien restent ouvertes, et l'arret
d'urgence aussi : une section qu'on ouvre en panique ne se cache pas.

| | avant | apres |
|---|---|---|
| Confortable | 1592 px (3,1 ecrans) | **864 px (1,7)** |
| Compacte | -- | **792 px (1,5)** |

Le `<h2>` reste DANS le `<summary>` au lieu d'etre remplace par lui : le
titre garde son allure de section, et un lecteur d'ecran garde son niveau de
titre. Un `<summary>` nu aurait coute les deux.

### Mesure

Les trois hauteurs sont mesurees dans Chromium sur la vraie page, pas
estimees. Le theme de diagnostics est verifie sur la couleur calculee du
`body` : `#14101F` en sombre, `#FBFAFE` en clair. 713 tests.

### Deux faux defauts, signales pour memoire

Pour voir la page, tous les attributs `hidden` avaient ete retires. Ca a fait
apparaitre un champ de fichier non style et une section sans titre -- les
deux etaient des artefacts de la mesure : `import-file` est `hidden` par
conception, et la premiere section a bien son titre. Rien n'a ete « corrige ».

## 2.25.0 -- 2026-09-20

**« Suis-je connecte ? » -- la question que l'extension ne savait pas poser**

Trois versions de suite ont ete depensees a chercher pourquoi Steam ne
reclamait rien. La reponse tenait a une question que l'extension ne posait
nulle part. Elle la devinait depuis le service worker -- une lecture de
`dynamicstore/userdata` qui rend des listes vides aussi bien pour « pas de
session » que pour « le worker n'a pas vu la session » -- et elle se taisait.
L'utilisateur voyait « aucune action », et rien d'autre.

### Ce qui s'affiche

Sous chaque magasin sondable, une ligne : **connecte** (en vert, avec la date
de la mesure), **deconnecte** (en rouge, avec un lien pour aller se
reconnecter), ou **inconnu**. Un bouton « Verifier les sessions » mesure les
trois d'un coup, et le resume passe en ambre des que la plus ancienne mesure
a plus de six heures -- c'est elle qui dit depuis quand le tableau peut
mentir.

### La nuance qui compte

**Ne pas savoir n'est pas etre deconnecte.** Une reponse illisible, une
adresse qui a change, une page HTML au lieu du JSON : tout cela rend
« inconnu », jamais « deconnecte ». Et « inconnu » n'affiche aucun lien de
reconnexion -- envoyer se reconnecter quelqu'un qui l'est deja, c'est
exactement l'erreur de la 2.22.2, et elle est tenue par un test.

Amazon dit « non sondable » plutot qu'« inconnu » : sa bibliotheque vit
derriere une API GraphQL dont rien n'a ete mesure. Les deux se ressemblent et
ne veulent pas dire la meme chose -- l'un attend une mesure, l'autre du code.

### Ce qui n'a PAS ete ecrit, et pourquoi

La sonde ne part **jamais toute seule**. Sonder, c'est lire un compte avec
votre session ; l'importation de collection s'en tient a cette regle depuis
la 2.21.0, et `SECURITY.md` la promet. Une fonction `dueForProbe`, qui aurait
resonde a chaque cycle, a ete ecrite puis **retiree avant livraison** : la
livrer inutilisee aurait laisse dans le depot du code contredisant cette
promesse. Le commentaire qui la remplace dit comment la refaire le jour ou
elle se justifiera.

### Ce qui a ete reutilise plutot que reecrit

La sonde ne contient presque rien : elle appelle le `judge` de
`watch/collection-import.js`, qui sait depuis la 2.21.0 les trois facons
mesurees de dire « pas connecte » -- un 401, une redirection vers une page de
connexion, un refus d'authentification dans le corps -- et qui refuse
d'y compter le 403, parce que c'est aussi ce que rend un mur anti-robot.
Steam est le seul cas a part, et c'est mesure : sans session il repond 200
avec des listes vides, que `judge` trouverait normales. C'est `readOwnership`
qui sait lire ce cas.

### Mesure

`test/session.test.mjs` : 9 tests. Une forme inattendue ne devient jamais
« deconnecte » ; une valeur abimee au stockage ne devient pas « connecte » ;
la sonde GOG demande `page=1` et rien de plus ; Steam sans session rend bien
« deconnecte », et une erreur HTTP rend « inconnu ». 713 tests.

## 2.24.0 -- 2026-09-19

**Deux audits de securite : rien d'exploitable, quatre portes fermees quand meme**

Question posee : « tout est chiffre, ou sauvegarde de mon cote ? » Deux
inspections completes ont tourne sur le depot -- stockage et reseau d'un cote,
surface d'injection de l'autre.

### La reponse

**Rien n'est chiffre. Tout vit chez vous**, en clair, dans le profil du
navigateur. Une seule cle peut quitter la machine -- les codes, vers votre
compte navigateur -- et elle est coupee par defaut. Aucun mot de passe, aucun
jeton, aucun cookie n'est stocke ; l'extension n'a meme pas la permission
`cookies`. Aucune telemetrie. Le detail complet est desormais dans
**`SECURITY.md`**, qui vieillira avec le code.

### Ce que les audits ont trouve : rien d'exploitable

Zero `innerHTML` dans les 200 Ko de moteur genere, les 34 modules de
`src/core`, les modules `watch/` et les cinq pages. CSP MV3 par defaut
intacte. Pas d'`externally_connectable` : aucune page web ne peut parler a
l'extension. `DOMParser` inerte pour le HTML distant. Liste blanche de
schemas d'URL plutot que liste noire.

### Les quatre portes fermees quand meme

Aucune n'etait joignable depuis le web -- il aurait fallu deja controler le
script de contenu. Ce sont des defenses en profondeur, et elles tenaient
toutes la meme promesse implicite : « personne d'autre que nous n'appellera
ceci ». Une promesse implicite n'est pas une garde.

- **Le relais reseau etait un proxy ouvert.** `fgc-fetch` acceptait n'importe
  quelle URL, n'importe quelle methode, n'importe quels en-tetes, et rendait
  le corps entier -- de quoi sonder `http://localhost` depuis le service
  worker. Il est borne a un GET HTTPS vers un hote **du manifeste**, avec
  `Accept` pour tout bagage. La liste ne peut pas deriver : c'est celle des
  `host_permissions`.
- **L'ouverture d'onglet ne verifiait aucun schema.** Chrome bloque
  « javascript: » et « data: » en navigation de premier niveau, mais pas
  `chrome-extension://` ni `file:///`. Elle passe desormais par `webUrl`, la
  meme fonction qui filtre les URL des offres.
- **Les seize commandes du worker ne regardaient pas qui les demandait.**
  Une page de magasin pouvait declencher un import de bibliotheque -- qui lit
  Steam, GOG et Epic AVEC vos cookies -- ou effacer le journal. Les commandes
  d'interface n'acceptent plus qu'une page de l'extension, les messages du
  moteur qu'un script de contenu, et un type inconnu est refuse.
- **Les URL de collection echappaient au filtre.** `makeItem` posait une `url`
  d'origine distante -- la fiche GOG vient d'une reponse lue avec la session
  -- et elle atterrissait dans un `href`. Seul un hasard heureux la sauvait.
  Symetrie retablie avec `makeOffer`.

### Hygiene des codes

Un code de rachat est un porteur. Il etait recopie **en clair dans
`FGC_history_*`**, un historique que rien ne purge et que l'export emporte --
en double, sans que rien ne le relise. L'historique garde desormais le fait,
plus le secret.

En revanche les codes **ne sont pas purges automatiquement**, contrairement a
ce qui avait ete envisage : un code supprime a tort est un jeu perdu, et
l'onglet Codes affiche deja les jours restants. C'est a l'utilisateur de
decider, pas a une minuterie.

### Mesure

`test/messaging.test.mjs` : 11 tests. Le relais refuse `localhost`, une
methode autre que GET, un en-tete `Cookie`, une valeur d'`Accept` qui tente
une injection de retour chariot -- et laisse passer l'appel reel du moteur.
Une page de l'extension **dans un onglet** (journal, collection) n'est pas
prise pour un script de contenu. Les deux listes de commandes ne se
chevauchent pas. 703 tests.

Le temoin de build a ete refige (`--freeze`) : c'est la premiere modification
de `src/core` depuis la 2.20.1, et elle est volontaire.

## 2.23.0 -- 2026-09-19

**Le pouce de la barre de defilement est un ticket**

L'identite du produit s'arretait aux icones. `icon.svg` est un ticket a coins
arrondis, degrade ambre `#FFC06B -> #FF8A3D`, evide en violet nuit, traverse
d'une perforation en pointilles -- et les cinq pages laissaient le navigateur
poser ses barres grises par-dessus. Sur le journal, 500 lignes, la rupture
etait permanente.

### Le dessin

Le pouce EST le ticket : le degrade ambre, des coins pleinement arrondis, et
la ligne de perforation qui le traverse dans sa longueur. La piste est le
creux ou il coulisse -- `--rail`, deja le jeton de tous les creux du produit
(anneau de decompte, rails d'interrupteurs, jauges). Couche, le ticket tourne
sa perforation avec lui.

La couleur de la perforation est `color-mix(in srgb, var(--ink) 62%,
transparent)`. Comme `--ink` bascule avec le theme, la perforation bascule
avec lui, dans le bon sens et sans une ligne de plus : sombre sur ambre vif,
claire sur ambre brule.

Geometrie : dash 5px / gap 4px, ratio 1,25 contre 1,36 dans l'icone
(`stroke-dasharray="7.2 5.3"`). Transposer le ratio exact a cette echelle
donnerait un trait de 0,5px, invisible. On garde la lecture, pas la mesure.

### Le piege desamorce

`popup.html` portait `scrollbar-width: thin` et `scrollbar-color` sur son
`body`. **Depuis Chrome 121, poser l'une de ces deux proprietes sur un
element fait IGNORER a Chromium tous ses `::-webkit-scrollbar-*`.** Ces deux
lignes auraient suffi a annuler tout le travail sur la surface la plus vue.
Elles sont retirees, et remplacees par un bloc reserve a Firefox -- qui n'a
pas les pseudo-elements et recoit la version plate :

```css
@supports not selector(::-webkit-scrollbar) { ... }
```

Chrome comprend `selector(::-webkit-scrollbar)`, donc le bloc ne s'y applique
pas. `manifest.firefox.json` existe : Firefox n'est pas hypothetique.

### Deux jetons qui avaient derive

Les cinq pages recopient leur `:root` en se promettant « memes jetons que
popup.html ». La copie avait deja derive : `--rail` n'existait que dans
popup, `--amber-d` que dans popup et diagnostics. Les deux sont ajoutes
partout, dans les trois blocs de chaque page (sombre, `prefers-color-scheme`,
`[data-theme="light"]`).

Au passage, `color-scheme` est declare sur chaque page : les controles natifs
-- le `textarea` de diagnostics, les `select` -- cessent d'arriver en blanc
sur fond violet.

### Mesure

CSSOM verifie dans Chromium : les huit regles sont parsees et acceptees. Le
rendu n'a PAS pu etre photographie -- ce Chromium headless ne dessine aucune
barre de defilement classique, meme sur un cas minimal sans notre CSS. Le
premier rendu reel sera celui de l'utilisateur. 692 tests.

### Dette assumee

Le bloc est recopie cinq fois, comme les jetons -- et c'est cette duplication
qui les avait fait deriver. Un `theme.css` partage supprimerait les deux
problemes d'un coup ; il n'a pas ete fait ici.

## 2.22.4 -- 2026-09-19

**Le journal accusait l'API d'avoir change de format. C'etait notre minuteur.**

```
gamerpower : echec
{"errors":["JSON illisible : signal is aborted without reason"],"failures":3}
```

L'API n'avait rien change. « signal is aborted without reason » est le motif
que Chrome donne a un abandon : c'est NOTRE delai qui avait coupe la requete.

### Pourquoi le mauvais message gagnait

Les en-tetes arrivent, donc `response.ok` est vrai, donc on entre dans
`response.json()` -- et c'est pendant la lecture du corps que l'abandon
remonte. Chaque source avait deux endroits ou attraper une erreur : le catch
exterieur traduisait correctement l'abandon en « delai depasse », et le catch
interieur, pose autour du seul `json()`, le renommait en probleme de format.
Le plus proche gagnait, et il avait tort.

Le meme piege dormait dans la source GOG, mot pour mot.

### Le correctif

- **`watch/net.js`, une seule fonction pour les deux endroits.** Elle consulte
  d'abord NOTRE signal : si le minuteur a tire, la cause est notre delai,
  quelle que soit la forme prise par l'erreur en remontant. Toutes les
  plateformes ne rejettent pas un abandon avec un `AbortError` -- certaines
  rendent un « Failed to fetch » ordinaire -- et se fier au seul nom de
  l'erreur, c'etait une loterie.
- **« JSON illisible » est conserve pour les vraies erreurs de format.** Deux
  tests ont refuse la premiere version du correctif, qui supprimait le
  libelle partout : elle remplacait un mauvais diagnostic par une absence de
  diagnostic. Ils avaient raison.
- **Vingt secondes au lieu de quinze** pour l'agregateur, comme la source
  Steam. Trois expirations d'affilee ont endormi la source alors qu'une
  relance sept secondes plus tard rendait bien ses vingt offres : le CDN est
  parfois lent, pas casse.
- Les sources Steam et l'import de collection passent par la meme fonction.
  Deux copies d'un meme idiome, c'est ainsi que la premiere avait diverge.

### Mesure

`test/gamerpower.test.mjs` et `test/gog.test.mjs` : l'abandon pendant la
lecture du corps rend « delai depasse », ne mentionne plus le format, et un
abandon dont le nom ne dit rien reste un delai. Une reponse vraiment mal
formee garde son « JSON illisible ». 692 tests.

### Reste ouvert

La source Epic n'a AUCUN delai : pas d'`AbortController`, donc une requete
suspendue le reste jusqu'a la mort du service worker. Elle ne pose pas
probleme aujourd'hui ; c'est la meme famille de defaut, et c'est signale.

## 2.22.3 -- 2026-09-19

**Steam : le clic partait dans le vide -- c'est le formulaire qu'il faut envoyer**

Le journal de l'utilisateur a tranche ce que deux versions n'avaient pas su
voir :

```
10:47:02  steam : clic sur « Add to Account » pour le paquet 1830927
10:47:35  Deadshot (Steam) Giveaway -> failed
          clic fait, mais le paquet n'est pas apparu dans la bibliotheque
```

Le clic partait. Les trois verifications etaient passees : bloc du paquet,
formulaire de licence gratuite, libelle exact. Et rien.

### La cause

Le bouton reel est une ancre dont le href est `javascript:addToCart( 1830927 );`.
Chrome REFUSE une navigation vers une URL « javascript: » demandee depuis un
monde isole -- celui ou `chrome.scripting` execute nos injections par defaut.
`element.click()` ne jette pas, ne previent pas : il ne fait rien.

Le code tenait donc « clic fait » pour un fait accompli, et attribuait
l'echec a Steam. Trois fois d'affilee, jusqu'a reveiller le canari.

### Le correctif

- **Un href « javascript: » : on envoie SON formulaire.** Le meme, deja
  verifie trois fois -- il vise `/freelicense/addfreelicense/` et porte notre
  paquet. Une soumission ne peut donc rien faire d'autre que ce que le bouton
  faisait. `requestSubmit()` plutot que `submit()`, pour que les gestionnaires
  de la page s'executent comme lors d'un vrai envoi.
- **Et seulement a coup sur.** Le href doit etre exactement
  `addToCart(<notre paquet>)`. `addToCart(999)`, `checkout()`, `void(0)` :
  refus, sans rien tenter. On ne devine pas ce qu'un script inconnu allait
  faire.
- **Un bouton a gestionnaire reste clique.** Un clic, lui, traverse les
  mondes. Une voie ou l'autre, jamais les deux : Steam tient un quota
  d'activations ou meme un « deja possede » compte comme un echec.
- **Le jeton de session est verifie et remonte.** S'il manque du formulaire,
  le POST serait refuse en silence ; le journal le dit avant, pas apres.

### Deux echecs qui ne diront plus rien de faux

- **La page tranche avant tout verdict d'echec.** `dynamicstore/userdata` est
  cache cote Steam et peut rester en retard sur une activation qui a bien eu
  lieu. On retourne desormais sur la fiche AVANT de conclure : « You already
  have this item » vaut succes, meme si la bibliotheque n'a rien vu. La
  fenetre de confirmation passe de 5 a 8 relectures.
- **L'echec dit ou la demande a atterri.** Titre et URL de la page d'arrivee :
  quand Steam refuse une licence gratuite, c'est la que le motif est ecrit.

### Mesure

`test/steam-claim.test.mjs` : 28 tests. Nouveaux -- le href mesure et son
formulaire envoye une seule fois, le bouton a gestionnaire toujours clique,
trois « javascript: » inconnus refuses sans rien tenter, le formulaire sans
jeton signale, et la bibliotheque en retard rattrapee par la page. 689 tests.

## 2.22.2 -- 2026-09-19

**Steam : c'est la page qui dit si le compte est connecte, plus le worker**

Retour d'usage : « mon compte Steam est connecte, aucune action ». Le compte
l'etait bel et bien. L'extension, elle, ne l'a jamais verifie la ou c'etait
verifiable.

### La cause

Avant d'ouvrir quoi que ce soit, la recuperation lisait
`store.steampowered.com/dynamicstore/userdata/` depuis le service worker, et
en tirait trois conclusions definitives : listes vides -> « connexion
requise » ; reponse illisible -> echec ; paquet present -> deja acquis.

Les deux premieres etaient des devinettes. Cette lecture depuis un service
worker peut rendre des listes vides ou une reponse inexploitable alors que la
session existe parfaitement dans le navigateur. Et comme elle se faisait
AVANT tout onglet, le resultat etait litteralement rien : pas de page, pas de
clic, pas de trace visible -- a chaque cycle, indefiniment. L'extension
refusait d'aller voir la seule chose capable de repondre.

### Le correctif

- **La lecture de bibliotheque ne bloque plus.** Elle garde son seul pouvoir
  utile : ne rien tenter sur un jeu deja acquis, parce que le quota
  d'activations de Steam compte « deja possede » comme un echec. Vide ou
  illisible, elle note la raison au journal et laisse la suite se faire.
- **La session se lit sur la page.** L'etape injectee cherche d'abord le menu
  de compte ; a defaut, un lien de connexion DANS le menu global -- jamais
  dans la page entiere, ou « /login/ » apparait aussi sur un compte connecte.
  Signe franc de connexion : on continue. Lien de connexion : « connexion
  requise », et aucun clic. Ni l'un ni l'autre : on continue, les trois
  verifications qui suivent (bloc du paquet, formulaire de licence gratuite,
  libelle exact) protegent deja de tout ce qui pourrait couter quelque chose.
- **Une seconde preuve apres le clic.** Si la bibliotheque reste muette
  jusqu'au bout, on revient sur la fiche et on la relit A BLANC : « deja
  possede » vaut succes, un bouton toujours la vaut echec. Si aucune des deux
  ne repond, le verdict est `undetermined` -- ni victoire supposee, ni echec
  declare -- et l'offre repasse apres le recul.

Ce que ce correctif ne tranche toujours pas : si le clic lui-meme aboutit. Il
n'a jamais ete joue depuis ce depot. Mais l'echec, desormais, dit ce qu'il a
vu.

### Mesure

`test/steam-claim.test.mjs` : 25 tests. Nouveaux -- la session lue sur la page
dans ses trois etats (connectee, deconnectee, indeterminee), un lien
« /login/ » hors du menu global qui ne conclut rien, une bibliotheque muette
qui n'empeche plus la recuperation, et les trois issues de la seconde lecture.
685 tests.

## 2.22.1 -- 2026-09-19

**Steam : l'option agit tout de suite, et une fausse offre ne bloque plus les vraies**

Retour d'usage, le jour meme : « pour l'instant rien de reclame ». Deux causes
dans le code, trouvees en relisant le chemin de bout en bout.

- **Activer l'option ne declenchait rien.** Le prochain cycle venait a son
  heure : plusieurs heures sur une journee calme (trois verifications par jour
  au minimum, plus les creneaux de sortie). « Activer quand meme » lance
  desormais la meme verification que « Verifier maintenant ». L'arret
  d'urgence l'emporte toujours : il annule ce cycle comme les autres.
- **Une entree Steam sans paquet prenait le creneau des vraies.** L'agregateur
  voit aussi des cles Steam offertes sur des sites tiers : magasin « steam »,
  mais aucun paquet. Plus urgentes, elles passaient devant, echouaient
  (« paquet Steam inconnu ») et bloquaient la recuperation Steam vingt minutes,
  a chaque nouvel essai, jusqu'a cinq. Le filtre les ecarte maintenant comme un
  magasin sans module : detectees, affichees, a un clic.

Ce que ce correctif ne tranche pas : si l'extension lit bien la session Steam,
et si le clic reussit. Le journal de la veille le dit, offre par offre
(« -> needs_login », « -> failed (page Steam : ...) », « steam : attend son
tour »).

### Mesure

`test/steam-claim.test.mjs` : 22 tests, dont l'entree sans paquet, plus urgente
que la vraie offre, qui ne passe plus devant. Dans un Chrome headless :
« Activer quand meme » puis la verification, sans erreur. 682 tests.

## 2.22.0 -- 2026-09-19

**Steam : recuperer aussi, en option, a vos risques**

Jusqu'ici Steam etait detecte, affiche, mis a un clic -- jamais clique, parce
que son contrat l'interdit. C'est desormais le choix de l'utilisateur : une
option, coupee par defaut, qui ne s'active qu'apres avoir lu ce que dit le
contrat.

### Ce que dit le contrat, verifie le 2026-09-19

- Section 4.C : « You may not use any form of scripts, bots, macros, or other
  non-human-controlled systems ("Automation") to interact with Content and
  Services on Steam in any manner », avec parmi les exemples « Earning rewards
  or progress without genuine user input ».
- Section 4.D : Valve peut restreindre ou fermer le compte pour de
  l'Automation, **sans preavis**.

Le popup le dit avant d'activer quoi que ce soit : cocher « Steam aussi »
ouvre l'avertissement, et la case reste decochee. Seul « Activer quand meme »
ecrit le reglage ; le couper est immediat. Tant que l'option est active, la
ligne Steam des magasins affiche « automatique, a vos risques ».

### Ce qui a ete mesure, et ce qui ne l'a pas ete

Sur la page publique d'une vraie offre en cours (Space Menace, forcee en
anglais par `?l=english`) :

- le bloc d'achat porte le numero du PAQUET
  (`game_area_purchase_section_add_to_cart_1827145`), le meme que
  `best_purchase_option.packageid` dans GetItems ;
- son formulaire vise `/freelicense/addfreelicense/` : une licence gratuite,
  pas une caisse -- ce formulaire ne peut rien faire payer ;
- le bouton dit exactement « Add to Account ».

L'etape injectee a ete jouee A BLANC sur cette page reelle, dans un monde
isole comme le sera celui de l'extension : les trois verifications
concordent, un mauvais paquet est refuse, la page n'a pas bouge.

**Le clic lui-meme n'a jamais ete joue.** Meme sans compte, cliquer sur un vrai
Steam est une action sur un service reel ; elle ne s'est pas faite depuis ce
depot. Le premier vrai clic sera celui de l'extension, chez l'utilisateur, une
fois l'option active. S'il ne donne rien, l'offre passe en echec avec son
motif, et le canari le signale.

### Le parcours -- l'ordre est la securite

1. L'option est RELUE au moment d'agir, pas seulement par l'appelant.
2. La bibliotheque est lue AVANT tout onglet (`dynamicstore/userdata`). Sans
   session : « connexion requise », rien d'ouvert. Paquet ou application deja
   possedes : l'offre est acquise sans rien tenter -- le quota d'activations
   de Steam compte « deja possede » comme un echec.
3. La fiche s'ouvre dans la fenetre reduite habituelle ; l'etape injectee
   verifie le paquet, le formulaire et le libelle, puis clique une fois.
4. La preuve est le paquet dans `rgOwnedPackages`, relue plusieurs fois --
   jamais un texte a l'ecran.

Aucun moteur n'est injecte sur Steam : seule cette fonction touche une page
Steam. La garantie de la 2.9.1, « rien n'est injecte sur une page Steam »,
devient : rien, sauf par la recuperation Steam, et seulement si vous l'avez
activee.

### Le rythme

En plus du plafond horaire commun : une offre Steam par cycle, vingt minutes
d'ecart au moins, six par jour au plus. « Tout recuperer » suit la meme
regle. Les offres gratuites de Steam durent des jours : rien ne presse.

### La source Steam s'active avec l'option

Elle n'etait pas active par defaut, et c'est elle, seule, qui donne le numero
de paquet. L'option l'active a la lecture des reglages : rien n'est recopie
ailleurs.

### Un bug trouve en mesurant

GetItems donne le type **4** au DLC (« Dying Light: The Beast - Discharge
Weapon Pack », offert le jour de la mesure). La source Steam lisait 1 depuis la
2.9 : les vrais DLC passaient pour des jeux, et le filtre « contenu en jeu »
ne les voyait jamais. Corrige, ainsi que dans la collection (2.21.0), qui
avait repris la meme erreur.

### Et au passage

Le pied du popup : depuis le lien « Ma collection » (2.21.0), la phrase d'aide
s'ecrasait sur cinq lignes. Elle a maintenant la sienne.

### Mesure

`test/steam-claim.test.mjs` : 21 tests. Ceux qui comptent : un formulaire qui
ne vise pas la licence gratuite n'est jamais clique ; sans l'option, meme un
appel direct ne fait rien et le cycle n'interroge pas la source Steam ; sans
session, aucun onglet ; un clic sans paquet dans la bibliotheque est un
echec, pas une victoire supposee ; une seule offre Steam par cycle.

Dans un Chrome headless au profil jetable, arret d'urgence tire : l'interrupteur,
l'avertissement, « Annuler », « Activer quand meme », la ligne Steam et la
coupure immediate -- sans aucune erreur dans la console. 681 tests au total.

## 2.21.0 -- 2026-09-19

**Ma collection : ce que vous possedez sur chaque magasin, au meme endroit**

Le registre (2.12.0) fige ce que l'extension RECLAME. Apres des mois de jeux
hebdomadaires, une collection est eparpillee entre quatre launchers, et rien ne
disait ce qu'on possedait deja ailleurs -- ni avant l'extension. Une page
dediee, `collection.html`, ouverte depuis le pied du popup, rassemble les deux.

### Ce que la page fait

- **Elle lit ce que chaque magasin dit que vous possedez**, avec votre
  session, en lecture seule, et seulement quand vous cliquez « Importer » :
  Steam (`dynamicstore/userdata` pour la possession, `GetItems` pour les noms,
  deux adresses que la source Steam lisait deja), GOG
  (`account/getFilteredProducts`), Epic (l'historique de commandes du compte,
  jeux gratuits compris).
- **Elle y ajoute ce que l'extension a reclame** : le registre, Amazon
  compris. La bibliotheque Amazon elle-meme n'est pas lue, et la carte le dit.
- **Une ligne par titre, tous magasins confondus** : recherche, filtre par
  magasin, « seulement en double », genre (jeux par defaut, DLC, tout), tri par
  titre, par date ou par nombre de magasins. Chaque pastille ouvre la fiche du
  jeu ; celle de Steam le lance (`steam://run/`, documente par Valve -- les
  schemas des autres launchers n'ont pas ete verifies, donc pas de bouton).

### Les regles

- **Une importation reussie est une photographie** : elle remplace tout ce
  que le magasin avait, et un jeu rembourse disparait.
- **Une importation ratee n'efface rien.** Session expiree, forme inattendue,
  page 3 ratee sur 5 : la liste precedente reste, et la carte dit de quand elle
  date. Une pagination incomplete ne s'applique jamais.
- **Une forme inattendue est un statut, pas une liste vide**, et chaque
  importation rend un **rapport** : la forme des reponses, jamais leurs valeurs
  -- ni titre, ni prix, ni jeton de pagination. « Copier le rapport » le met
  dans le presse-papiers.
- **Rien ne decide sur la collection.** Deux magasins sont rapproches par le
  titre normalise : un indice pour l'affichage, pas une preuve. Aucune
  reclamation ne la lit ; la brancher sur le filtre (ROADMAP, « possede AVANT
  l'extension ») attend que les importations aient ete mesurees sur de vrais
  comptes.
- **Aucune permission nouvelle** : les hotes lus etaient deja autorises.

### Mesure

**Ce qui est mesure** (2026-09-19, sans session, depuis un vrai Chrome 153) :

- Steam : 200 et des listes vides -- lu comme « non connecte », pas comme une
  bibliotheque vide qui effacerait la precedente.
- GOG : **403**, avec `{"message":"Full authentication is required to access
  this resource."}`. C'est le corps qui tranche : une deconnexion, pas un mur
  anti-robot.
- Epic : l'adresse historique sur `www.epicgames.com` redirige vers
  **`accounts.epicgames.com`**, puis vers la connexion. L'importation vise
  directement ce second hote.
- Un piege du banc d'essai, garde pour la suite : un agent « HeadlessChrome »
  recoit d'Epic un 403 HTML, sans redirection. Le titre de la page part
  desormais dans la note d'erreur.

**Ce qui ne l'est pas : la forme d'une reponse CONNECTEE de GOG et d'Epic.**
Aucun compte n'a ete lu depuis ce depot. La premiere importation le dira ; si
la forme n'est pas celle attendue, la carte affiche « reponse inattendue » et
le rapport dit ce qui a change.

**Verification dans le navigateur.** L'extension chargee dans un Chrome
headless au profil jetable, la page ouverte avec des donnees de test, en
francais et en anglais, en sombre et en clair, a 1280 et a 420 px ; puis
« Tout importer » contre les vrais serveurs, sans session : trois « non
connecte », aucun jeu efface, aucune erreur dans la console. Trois defauts vus
sur les captures, et corriges : une classe CSS partagee avec une cellule du
tableau empilait les pastilles ; « 1 jeux » (les nombres vivent desormais
seuls, sans nom a accorder) ; une option trop longue renvoyait « Tout
importer » a la ligne.

`test/collection.test.mjs` : 26 tests, dont la vraie reponse 403 de GOG. 660
tests au total.

## 2.20.1 -- 2026-09-18

**Une fiche Epic s'ouvre dans une langue que le moteur sait lire**

La 2.20.0 a fait du pays de la boutique un reglage, et la langue du pays est
allee jusque dans l'URL des fiches. Regle sur l'Allemagne, le moteur ouvrait
`/p/<jeu>?lang=de` : une page en allemand, ou aucun de ses motifs ne reconnait
un bouton. Aucun clic, donc aucun danger -- mais plus aucune reclamation non
plus, pour six des quatorze pays proposes (DE, ES, IT, PT, NL, PL).

### La langue de la page n'est plus celle de l'API

- **L'API garde la langue du pays** : titres et descriptions restent dans la
  langue choisie. Le moteur retrouve ses cartes par le slug, jamais par le
  titre -- une API et une page dans deux langues ne se genent donc pas.
- **La page prend la langue du reglage si le moteur la lit, l'anglais sinon**
  (`getEpicPageLang`). Les langues lisibles sont ecrites a un seul endroit,
  `CONFIG.epicReadableLangs` (`fr`, `en`) : ce sont celles que portent les
  motifs de `03-patterns-epic.js`, a chaque etape du parcours.
- Rien ne change pour la France, la Belgique, le Luxembourg et la Suisse
  (`fr`), ni pour les quatre pays anglophones (`en`) : leur URL est exactement
  celle de la 2.20.0.
- **Une langue vide reste vide** : c'est le « laisser Epic choisir » que
  documente `CONFIG`. Sans cette garde, la chaine vide -- absente des langues
  lisibles -- serait devenue `en` en silence.

### Ce qui etait touche, et ce qui ne l'etait pas

- **Touchees : les navigations du moteur lui-meme.** Le retour sur
  `/free-games` (deux endroits de `13-epic-check.js`) et la fiche ouverte quand
  la carte d'un jeu manque (`16-epic-run.js`).
- **Pas touchee : la reclamation autonome.** La veille construit ses propres
  URL de fiche, et elles portent toujours `lang=fr` (`watch/sources/epic.js`),
  une langue que le moteur lit. Ce correctif ne la change pas.

### Ce que ce correctif ne prouve pas

**L'anglais n'a aucune capture dans ce depot.** Les libelles francais viennent
des pages reelles (2026-08-27, 2026-09-17) ; les motifs anglais sont presents a
chaque etape (« Get », « Place Order », « I Agree », « In Library »), mais aucun
n'a ete releve ici sur une vraie fiche. Le repli vers l'anglais repose sur eux.
Si une fiche anglaise fait echouer une reclamation, le canari le signalera,
motif technique compris.

### Mesure

`test/locale.test.mjs` : le test qui promettait `lang=de` dans l'URL d'une
fiche -- le bug, ecrit comme une promesse -- est remplace par quatre :

- regle sur l'Allemagne, la fiche s'ouvre en anglais et l'API reste en
  `de-DE` ;
- pays par pays, aucune fiche ne s'ouvre dans une langue que le moteur ne lit
  pas ;
- une langue vide reste vide ;
- **une langue n'est declaree lisible qu'avec ses libelles, a chaque etape**
  (bouton principal, commande, accord, possession). Ajouter `de` a la liste
  sans ses libelles fait echouer ce test : c'est le garde-fou qui empeche de
  rouvrir le bug.

Chacun a ete verifie contre le defaut qu'il doit attraper. Quatre mutants --
l'URL reprend la langue du pays, `de` declare lisible, garde de la langue vide
retiree, repli sur une langue illisible -- font tous echouer au moins un test.

## 2.20.0 -- 2026-09-18

**Le pays de la boutique devient un reglage, ecrit a un seul endroit**

`locale=fr-FR&country=FR&allowCountries=FR` etait recopie dans
`watch/sources/epic.js` ET dans `src/core/01-config.js`, et le reglage de langue
de l'interface ne touchait ni l'un ni l'autre. Un utilisateur belge, suisse ou
canadien lisait des prix francais.

### Ce que ce reglage fait -- et ce qu'il ne fait pas

- **Il ne concerne qu'Epic**, et c'est une mesure, pas une limite de mise en
  oeuvre : **GOG et GamerPower n'acceptent aucun parametre de pays**. Leurs
  reponses ne changent pas d'un pays a l'autre, et un test le verifie plutot
  que de le promettre. Steam est detecte, jamais reclame.
- Un selecteur de pays dans les reglages, rempli DEPUIS la table des pays --
  une liste recopiee dans le HTML finirait par proposer un pays que la veille
  refuse.
- **Un seul reglage, trois lecteurs, aucune recopie** : le popup l'ecrit sous
  les cles du moteur (`FGC_epic_country`, `FGC_epic_lang`), la veille les relit
  dans le meme espace de stockage, le moteur par `GM_getValue`. Ces deux cles
  rejoignent `ENGINE_KEYS` : la lecture doit etre SYNCHRONE, elle sert a
  construire une URL au moment de l'appel.
- **Un defaut cable des deux cotes** (`FR`/`fr`) : en userscript il n'y a pas de
  popup pour ecrire ces cles, et le moteur doit savoir quoi faire sans
  stockage. Sans reglage, l'URL construite est exactement celle d'avant.
- **La table des pays est close**, et c'est deliberement conservateur :
  accepter un code quelconque obligerait a deviner sa devise, et un montant
  converti dans une devise devinee serait un chiffre invente. Le moteur, lui,
  ne porte pas la table -- il verifie la FORME (deux lettres) et retombe sur le
  defaut, parce que c'est le popup qui borne le choix.

### La devise suit le pays

Un pays reglable ne rend PAS la conversion de la 2.17.0 inutile : Epic sert
bien la devise du compte, mais l'agregateur ne publie que des dollars -- c'est
structurel chez lui, sa structure ne porte meme pas de code de devise.

- La devise visee cesse d'etre l'euro en dur : elle suit le pays choisi
  (`CHF` en Suisse, `CAD` au Canada...), et la table de taux est demandee dans
  cette base.
- **Un changement de pays fait redemander le taux avant l'heure** : une table
  dans l'ancienne base ne sait plus convertir vers la bonne, meme fraiche.
- L'affichage vise la base de la TABLE, pas celle du reglage : afficher une
  devise qu'on n'a pas su calculer serait un chiffre invente. Le decalage dure
  au plus un cycle.

### Mesure

`test/locale.test.mjs` (15 tests), dont une **parite moteur / veille** sur les
quatorze pays proposes -- la meme promesse que `test/epic-parite.test.mjs` pour
les slugs : deux implementations, une seule verite. La duplication ne peut pas
disparaitre (le moteur est en ES5 concatene et tourne aussi en userscript), donc
elle est tenue par un test.

## 2.19.1 -- 2026-09-18

**La prediction ne derive plus d'une heure deux fois par an**

L'histogramme qui apprend « quand regarder » rangeait ses cases en UTC. Un
magasin publie a une heure LOCALE : a chaque changement d'heure, toutes ses
cases glissaient d'une heure.

### Le chiffre qui a decide de la forme du correctif

Le commentaire du module pariait que la decroissance par demi-vie absorberait
ce glissement en quelques semaines. Deux mesures disent le contraire :

- **la demi-fenetre chaude de l'ordonnanceur vaut 30 MINUTES**
  (`hotHalfWindowMs`). Une case qui a glisse d'une heure place l'instant attendu
  a 60 minutes du drop reel : le creneau chaud ne s'ouvre meme pas. La derive
  n'est pas amortie, elle fait manquer la fenetre entierement ;
- **reapprendre demande trois observations** dans la nouvelle case
  (`MIN_OBSERVATIONS`), soit TROIS SEMAINES pour une source hebdomadaire comme
  Epic -- deux fois par an, et la prochaine echeance est le 25 octobre.

### Ce qui change

- **Les cases sont ancrees sur un fuseau NOMME** quand on connait celui de la
  source, en UTC sinon. Le fuseau est porte par l'histogramme lui-meme
  (`stat.zone`) et non par l'appelant : une case rangee dans un fuseau et relue
  dans un autre serait pire que le bug corrige.
- **Deux sources en declarent un, et seulement parce que c'est mesure** : Epic
  (11:00 a New York, la meme mesure que la regle de rotation de la 2.17.0) et
  l'agregateur (`DATE_ZONE`, deja mesure dans sa propre source). GOG et Steam
  n'en declarent pas : leur heure de publication n'a jamais ete mesuree, et
  supposer un fuseau serait ecrire une hypothese non mesuree.
- **Les cases deja apprises sont TRANSPOSEES, pas jetees.** Une transposition
  exacte est impossible -- une case ne garde ni les dates ni les decalages de
  ses observations, seulement un poids et un compteur. La transposition applique
  donc le decalage en vigueur a cet instant : les observations recentes, les
  seules qui pesent encore, atterrissent dans la bonne case ; les plus
  anciennes, faites sous l'autre decalage, se retrouvent a une heure pres --
  elles l'etaient deja, et la demi-vie les efface. C'est strictement mieux que
  rester en UTC (derive permanente) ou repartir de zero (trois semaines).

### Et un second defaut, trouve en mesurant le premier

- **La seconde moitie de toute case apprise n'etait jamais couverte.** Une case
  couvre une heure pleine, mais l'ordonnanceur ne recevait que son DEBUT :
  avec une fenetre de +/- 30 minutes, « jeudi 15 h » ne couvrait que
  14:30-15:30. Chaque case chaude annonce desormais DEUX instants, a l'heure
  pleine et a la demie : la couverture va de 14:30 a 16:00 -- la case entiere,
  plus une avance qui rattrape un drop legerement anticipe.
- Les occurrences passent par `nextOccurrence`, qui itere sur le calendrier
  local : aucune arithmetique en millisecondes ne survit a un jour de 23 heures.

### Mesure

`test/prediction-zone.test.mjs` (12 tests), autour des changements d'heure de
2026. Dont celui qui resume le probleme : le jeudi 29 octobre, entre le
changement europeen (25 octobre) et l'americain (1er novembre), la rotation
d'Epic tombe a **16 h a Paris**, pas 17 h. Une regle ecrite
« 17:00 Europe/Paris » se tromperait ce jour-la ; une case ancree sur New York,
non.

## 2.19.0 -- 2026-09-18

**Une offre GOG peut enfin mourir -- quand GOG l'affirme**

Le bug corrige la veille sur Epic restait ouvert sur GOG. Le balayage par
MAGASIN, livre en 2.17.0, ne s'exerce que pour une source qui fait autorite sur
ce magasin ; GOG etait declaree `completeList: false`, faute d'avoir mesure la
pagination du catalogue. Une offre GOG sans date de fin n'etait donc retiree ni
par expiration (pas de date), ni par disparition (aucune autorite).

### On ne devine pas la pagination : on croit la reponse

- **`completeList` cesse d'etre une promesse STATIQUE de la source pour devenir
  un fait PAR REPONSE.** GOG publie `page` et `totalPages` a la racine de sa
  reponse : il dit lui-meme si elle tient sur une page. Plutot que de deviner
  le nom du parametre de pagination pour aller chercher la suite, la source
  publie `complete`, vrai seulement si `page === 1 && totalPages <= 1`.
- **Le cycle prefere ce fait a la promesse** quand la source en publie un, et
  retombe sur `completeList` sinon. Aucune autre source ne change de
  comportement.
- **Le jour ou GOG annonce plusieurs pages, la veille cesse d'elle-meme d'en
  conclure des disparitions**, ce cycle-la seulement, et le journal l'ecrit.
  C'est cette ligne qui fournira la mesure de pagination que ROADMAP.md
  attendait -- prise en marche, au lieu d'etre attendue.
- Prudent par construction : une reponse qui ne porte pas ces champs, qui n'est
  pas a la page 1, ou qui vient d'une source en panne, n'est PAS declaree
  complete. `totalPages: 0` en revanche l'est : zero page vaut bien une liste
  complete, elle est vide -- c'est la reponse reellement observee le
  2026-09-17. A noter, parce que cela mord : `totalResults` arrive en CHAINE la
  ou `totalGamesFound` est un nombre.

### Et une grace plus fine, qui resserre la 2.17.0

Donner l'autorite a GOG faisait apparaitre un faux positif que
`completeList: false` masquait, et il valait pour Epic aussi :

- **Une entree decouverte par l'agregateur et marquee `store: 'gog'` n'a pas de
  `storeId`** : elle n'est rapprochee que par titre normalise. Si son titre
  differe d'une virgule de celui du catalogue, elle reste une entree DISTINCTE
  -- et un magasin autoritaire la tuerait au deuxieme cycle alors que l'offre
  court toujours. Meme chose pour un giveaway annonce par la seule banniere
  d'accueil, que le catalogue filtre ne porte pas.
- **Le `storeId` decide donc de la grace** : courte (deux constats) quand
  l'entree en porte un -- le magasin l'a publiee sous cette identite, son
  silence veut dire quelque chose ; longue (24 h) quand elle n'est connue que
  par son titre. C'est le cas de l'entree qui a cause le bug de la veille :
  decouverte par l'agregateur, puis fusionnee avec l'entree native d'Epic dont
  elle a herite le `storeId`.

### Mesure

`test/gog-complete.test.mjs` (9 tests) : une reponse annoncant `totalPages: 2`
ne fait mourir personne et le journal le dit ; `totalPages: 1` fait mourir une
offre GOG sans date de fin au deuxieme constat ; une entree connue par titre
seulement y survit. `test/rotation.test.mjs` gagne la contrepartie cote Epic.

## 2.18.0 -- 2026-09-18

**Ce qui est ECRIT sur le bouton decide, pas le selecteur qui l'a trouve**

Tout ce que la 2.15.3 -> 2.16.2 a construit pour Epic -- arret d'urgence,
refus des libelles payants, anti-rafale, un clic = un clic -- vit dans
`robustClick`. Or Luna et l'echange GOG appelaient `el.click()` en direct :
sur ces parcours, le bouton d'arret d'urgence ne bloquait rien.

### Le vrai manque n'etait pas robustClick

- **Le moteur cliquait un bouton Luna sans jamais lire ce qui est ecrit
  dessus.** La fiche d'une offre clique `[data-a-target="buy-box_call-to-action"]`,
  un selecteur d'ATTRIBUT : « buy-box_call-to-action » est le nom d'un
  emplacement, pas d'une action. La liste de motifs n'etait qu'un repli du
  `||`, jamais consultee quand l'attribut avait deja trouve quelque chose. Le
  jour ou Amazon y rend « S'abonner a Luna+ » ou « Acheter 19,99 EUR », rien ne
  l'arretait -- et surtout pas le garde-caisse, qui s'efface sur `amazon.*`
  comme sur `epicgames.com` et `gog.com` (PROVEN_HOSTS, a raison : le parcours
  gratuit de ces trois magasins passe legitimement par un panier a zero).
- **Un libelle payant est desormais refuse partout, quel que soit l'hote.**
  `looksPaid()` refuse en tete de `robustClick` ce qui annonce une depense :
  « Acheter », « Buy », « S'abonner », « Precommander », ou simplement un
  montant suivi d'un symbole monetaire. C'est la derniere ligne, celle qui
  tient meme si un appelant oublie sa liste d'autorisation.
- **Deux listes d'autorisation par libelle**, sur le modele de celle d'Epic :
  `lunaClaimLabelAllowed()` pour les cartes et les fiches Luna,
  `gogSubmitLabelAllowed()` pour `gog.com/redeem`. Un bouton trouve par son
  attribut doit encore DIRE qu'il reclame quelque chose de gratuit.
- **Les variantes non ancrees, pour la troisieme fois.** Le `textContent` d'un
  bouton concatene tous ses descendants : un span de lecteur d'ecran suffit a
  faire echouer un motif en `^...$`. Luna a maintenant ses motifs larges,
  comme Epic depuis la 2.16.1.

### L'arret d'urgence coupe enfin la serie

- Les cinq clics directs passent par `robustClick` -- et **lisent son retour**.
  Brancher sans lire aurait rejoue le bug de la 2.16.0 : un clic refuse
  consommant une etape en silence. Un clic refuse ne fait plus avancer aucun
  compteur, et il se journalise.
- **Le bouton d'arret d'urgence arrete la serie, pas seulement le clic.** Sans
  cela, chaque fiche Luna aurait vu son clic refuse puis aurait navigue vers la
  suivante : une serie qui continue en echouant n'est pas un arret. La file est
  conservee, pour pouvoir reprendre.
- L'etape intermediaire « Complete Claim » ne se declare plus franchie quand
  son clic a ete refuse -- et elle ne se represente pas a chaque battement,
  pour ne pas remplir le journal de refus previsibles.

### Un code GOG ne se brule pas

- **La confirmation `/redeem` est le seul site ou un refus coute quelque
  chose** : un code echange est un code perdu. GOG peut RELABELLISER le bouton
  d'envoi au lieu d'en monter un second -- le repli de `watchGogRedeemOutcome`,
  qui ecarte explicitement `originalSubmit`, dit que le cas a deja ete
  rencontre. La confirmation arrive environ 1,5 s apres l'envoi, donc sous les
  4 s de repos de l'anti-rafale : le clic aurait ete refuse, l'echange aurait
  fini en `timeout`, et le code aurait ete brule pour rien. D'ou
  `{ allowRepeat: true }`, une exception NOMMEE qui ne leve que l'anti-rafale :
  l'arret d'urgence et le refus des libelles payants s'appliquent toujours.
- **Un refus AVANT l'envoi ne brule pas d'essai** : le code n'a pas ete soumis,
  l'essai compte plus haut lui est rendu.

### Mesure

`test/label-guard.test.mjs` (11 tests). Celui qui compte : **un CTA Luna
intitule « Acheter 19,99 EUR » n'est jamais clique** -- il echoue sur le moteur
d'avant. Avec lui : dix offres donnent bien dix clics (l'anti-rafale memorise
par noeud), `allowRepeat` ne leve ni l'arret d'urgence ni le refus des libelles
payants, et un `<input type="submit">` est lu par son `value`.

Ces tests portent sur les points de DECISION (les deux listes d'autorisation et
`robustClick`), pas sur le parcours de page : aucune capture DOM de Luna ni de
`gog.com/redeem` n'existe, et en fabriquer une prouverait surtout que la
fabrication est fidele a elle-meme.

## 2.17.0 -- 2026-09-18

**Les jeux de la semaine derniere s'en vont, et tout s'affiche en euros**

Deux defauts d'interface, signales au lendemain d'une rotation : les jeux
termines la veille a 17 h etaient encore listes dans le popup et encore
annonces, et les montants s'affichaient en dollars sur un compte francais.

### Une offre finie s'en va

- **Une offre SANS date de fin n'avait aucun moyen de mourir.** Le balayage des
  disparitions ne regardait que le champ `source` de l'entree -- or `merge` le
  fige a la premiere source qui l'a vue : un jeu Epic decouvert par
  l'agregateur gardait `source: gamerpower` pour toujours et echappait au
  balayage d'Epic. Il est desormais balaye par MAGASIN quand la source fait
  autorite dessus. L'agregateur, qui couvre plusieurs magasins, ne fait
  autorite sur aucun : son silence ne termine rien.
- **Et la grace passe de 24 h a deux constats** dans ce cas precis. Les 24 h
  couvrent le doute sur une liste tronquee ; quand la source du magasin publie
  une liste complete et jugee credible, ce doute est deja ecarte. Attendre un
  jour de plus, c'etait afficher le vendredi les jeux de jeudi.
- **Les notifications et le badge consultent enfin l'horloge.** L'etat
  « expiree » n'est pose qu'au passage d'un cycle : entre la rotation et le
  cycle suivant, une offre finie pouvait etre ANNONCEE. Le popup, lui,
  filtrait deja sur la date -- d'ou l'ecart entre les deux.
- **Une fin inconnue n'est toujours pas une fin passee** : l'agregateur laisse
  huit offres sur vingt sans date, et les taire serait pire que de les
  montrer. C'est le balayage par magasin qui s'en charge.

### La rotation du jeudi est enfin connue

`watch/schedule/clock.js` avait ete ecrit pour exprimer « tous les jeudis a
telle heure, dans tel fuseau » sans se tromper aux changements d'heure -- et
personne ne l'appelait jamais avec une regle : la cle des calendriers restait
vide. La veille ne connaissait la rotation que si Epic l'annoncait, sinon elle
s'en remettait au plancher de trois interrogations par jour.

- Une regle par defaut est posee pour Epic : **jeudi 11:00 `America/New_York`**.
  C'est le fuseau ou la regle est VRAIE. A Paris cela tombe a 17 h la plus
  grande partie de l'annee -- mais **a 16 h** entre le passage a l'heure d'ete
  americain et l'europeen (mi-mars) et entre les retours a l'heure d'hiver
  (fin octobre). Ecrire « 17:00 Paris » aurait rate l'ouverture d'une heure,
  deux fois par an ; un test tient les quatre dates.
- C'est une heure de REVEIL, pas une verite sur les donnees : elle fait
  regarder a l'heure dite, elle ne fabrique aucune date. Les fenetres
  annoncees par Epic restent prioritaires, et une liste vide posee par
  l'utilisateur reste un choix respecte.

### Un jeu remis en promotion redevient visible

`markExpired` saute les etats terminaux et `merge` conservait l'etat : un jeu
repropose sur le meme identifiant restait invisible pour toujours. Il revient
desormais, sauf s'il a deja ete reclame -- celui-la reste terminal, le
reproposer ferait rouvrir un onglet sur un compte reel.

Au passage, un defaut que ce cas a revele : **une source ne pouvait pas
corriger sa propre date de fin.** A egalite de fiabilite, l'ancienne valeur
gagnait toujours. Cette stabilite existe pour rendre la fusion commutative
entre sources DIFFERENTES ; deux lectures de la meme source ne posent pas
cette question -- la seconde est plus recente. Un jeu remis en promotion
gardait sinon la date de la promotion precedente.

### Tout s'affiche en euros

Mesure d'abord : **Epic nous rend deja des euros** et nous lisons le bon champ
-- la fixture reelle porte `currencyCode: EUR` et `23,99 €`. Le dollar venait
d'ailleurs.

- **Le prix du magasin bat celui de l'agregateur.** `worth` n'etait arbitre par
  aucune table de fiabilite : pour un jeu Epic vu par les deux sources, le
  montant affiche dependait de l'ordre de passage. Le meme jeu valait
  « 23,99 € » ou « $19.99 » selon le jour. Cette seule correction supprime la
  plupart des dollars.
- **Ce qui reste est converti a l'AFFICHAGE**, avec le taux de reference de la
  Banque centrale europeenne, rafraichi une fois par jour. La donnee stockee
  ne bouge pas : le jour ou le taux change, il n'y a rien a reecrire, et la
  verite de la source reste lisible.
- **Un montant converti le dit** : il porte le signe « environ » et, en
  infobulle, son montant d'origine avec la date du taux.
- **Sans taux utilisable, le montant d'origine est rendu intact.** Pas de taux,
  taux trop vieux, devise que la BCE ne publie pas : on affiche des dollars
  plutot que des euros faux. Une panne de taux ne fait jamais echouer un cycle.
- **Le curseur de seuil parle euros.** Il parlait la devise majoritaire des
  offres : vingt offres de l'agregateur contre une ou deux d'Epic, et une
  interface francaise affichait « Ne recuperer qu'au-dessus de $15.00 ».
  A savoir et assume : la comparaison, elle, se fait toujours dans la devise de
  chaque offre. Pour une valeur indicative l'ordre de grandeur suffit ;
  convertir dans le filtre ferait entrer un taux dans un module pur.

29 tests de plus (`test/rotation.test.mjs`, `test/rates.test.mjs`).

## 2.16.2 -- 2026-09-17

**La reclamation passe ; le journal arrete de crier**

La 2.16.1 fait aboutir la reclamation. Restait ce que Chrome affichait dans
`chrome://extensions` : des « erreurs » qui n'en sont pas. Chrome compte tout
`console.warn` d'un script de contenu comme une erreur, et deux lignes du
moteur sont ecrites en fonctionnement NORMAL.

- **« Clic ignore : ... a deja ete clique N fois » passe en info.** Un reclic
  refuse est l'anti-rafale qui fait son travail, pas une anomalie.
- **« findActionElement(...) : aucun element visible ne correspond » passe en
  info.** Ce message est emis PENDANT une attente, tant que le bouton n'est
  pas apparu : c'est un temoin de recherche. L'echec, lui, reste journalise
  quand l'attente expire, avec les libelles reellement visibles.
- **Et surtout, la tentative inutile disparait.** Le garde-fou de la
  sentinelle ne couvrait que « meme libelle ET meme ecran ». Or l'ecran bouge
  souvent juste apres un clic -- une modale s'ouvre : la sonde repassait a la
  seconde suivante, retrouvait le meme bouton et se faisait refuser. La
  sentinelle respecte desormais en amont le meme delai de repos que
  `robustClick`, donc elle ne propose plus un clic dont elle sait qu'il sera
  refuse. Le filet de securite, lui, reste consulte : ne pas cliquer n'est pas
  une raison de ne pas voir un ecran bloque.

Les avertissements qui restent en signalent de vrais : plafond d'actions
atteint, modale empilee, ecran fige, defi de securite, confirmation absente.

Deux tests de plus : cinq passes apres un clic ne produisent aucune tentative
supplementaire, et le frein reste bien un DELAI -- passe le repos, un second
essai reste possible, parce qu'un premier clic peut n'avoir pas pris.

## 2.16.1 -- 2026-09-17

**Ce qu'un humain ne peut pas cliquer, le moteur ne le clique pas**

La 2.16.0 a rendu la sentinelle durable, et son journal a livre le defaut
suivant du premier coup. Capture du 2026-09-17T22:29, frame d'achat :

```
Action 4/6 : clic sur "Ajouter a la bibliotheque".
Ecran avant : Ajouter a la bibliotheque | Annuler | J'accepte #3
Apres "Ajouter a la bibliotheque" : ecran change -> ... #4
Action 5/6 : clic sur "Ajouter a la bibliotheque".  Ecran avant : ... #4
Action 6/6 : ...   Plafond de 6 actions atteint. Dernier ecran : ... #6
```

« J'accepte » etait a l'ecran -- il est dans la ligne -- et la sentinelle
cliquait le bouton de la page DERRIERE la modale.

- **Le bouton se cherche desormais dans la modale du dessus**, jamais
  derriere. `findActionElement` rend le premier candidat dans l'ordre du DOM :
  le bouton de la page vient avant celui de la modale, donc l'ordre du
  document gagnait, et l'ordre des motifs ne servait a rien. Une modale
  ouverte capture l'interaction : ce qui est dessous est hors de portee d'un
  humain, donc hors de portee du moteur.
- **Pas de repli vers le document quand une modale est ouverte.** Si la modale
  ne porte aucun bouton autorise, on attend. C'est ce repli qui a empile six
  modales : chaque clic sur le bouton du dessous en rouvrait une.
- **La signature d'ecran ne compte plus les dialogues.** Elle portait le
  nombre de modales ouvertes : chaque empilement faisait passer un ecran
  identique pour un ecran NEUF, le frein « deja clique, ecran inchange » ne se
  declenchait jamais, et les six actions y passaient. Elle porte maintenant
  sur la modale du dessus -- ses libelles et la taille de son texte -- donc
  deux modales identiques empilees rendent la meme signature.
- **Un empilement se dit.** Quand le nombre de modales visibles augmente apres
  un clic, une ligne unique le signale : c'est le symptome d'un bouton atteint
  hors de la modale du dessus.

Rien d'autre ne bouge : la liste des boutons autorises, le comptage des
actions reelles, le plafond, le filet et l'aiguillage des frames sont
inchanges. C'est un correctif de CIBLAGE, pas de politique.

Cinq tests de plus, dont quatre echouent sur la 2.16.0 : le bouton du dessous
ne recoit rien meme apres vingt passes, une modale sans bouton autorise ne
fait rien cliquer, et deux modales empilees rendent la meme signature. Le
cinquieme verifie que le parcours sans modale, lui, n'a pas bouge.

## 2.16.0 -- 2026-09-17

**Ce qui surveille un achat vit aussi longtemps que l'achat**

Quatrieme retour sur le meme ecran : la modale « Informations sur le droit de
retractation » reste affichee, son bouton « J'accepte » n'est jamais clique.
Les trois versions precedentes ont elargi des motifs de libelles. Cette fois la
console a tranche, et le probleme etait ailleurs. Capture du 2026-09-17 dans
l'iframe `store.epicgames.com/purchase`, jeu « MindCop » :

```
27.068  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
28.574  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
30.083  Clic sur le bouton de confirmation : "Ajouter a la bibliotheque"
30.084  Clic ignore : "Ajouter a la bibliotheque" a deja ete clique 1 fois.
```

Trois defauts en quatre lignes, et la modale arrive apres.

- **La boucle comptait des PASSES, pas des actions.** Elle rappelait l'etape
  suivante sans regarder ce que `robustClick` avait rendu : les deux clics
  REFUSES par l'anti-rafale ont quand meme consomme deux etapes sur trois.
- **Elle ne regardait jamais si l'ecran avait change.** Meme recherche, meme
  noeud, meme clic -- le bouton « Ajouter a la bibliotheque » etait encore la,
  elle le reprenait pour un nouvel ecran.
- **Elle etait mortelle.** A la troisieme etape le module rendait la main pour
  de bon, environ trente secondes apres le chargement de l'iframe. La modale de
  retractation s'affiche apres. Dans une sous-iframe, rien d'autre ne tourne :
  le guetteur de modales s'y interdisait lui-meme, et le cadre du dessus ne
  voit pas le contenu d'une iframe. Personne n'a jamais clique « J'accepte ».

Ce qui remplace tout ca :

- **Une sentinelle, pas une boucle.** La frame d'achat est surveillee par une
  fonction de passe idempotente, appelee par le guetteur qui existait deja --
  pas un second minuteur. Elle vit tant que la frame montre ou change quelque
  chose, avec le meme plafond dur de dix minutes.
- **Une signature d'ecran** (les libelles visibles et le nombre de dialogues)
  repond a la question que le module ne se posait pas : est-ce que quelque
  chose a change depuis mon clic ? Tant que non, on attend -- une seule
  seconde chance apres douze secondes, parce qu'un premier clic peut n'avoir
  pas pris.
- **Seules les actions REELLES comptent.** Un clic refuse par l'anti-rafale ne
  consomme plus rien. Plafond : six actions par frame, la ou le parcours du
  prestataire en demande quatre.
- **La liste des boutons autorises n'a pas bouge d'un caractere.** C'est elle,
  et non l'adresse de l'iframe, qui borne le risque (regle de la 2.15.1) :
  dans une sous-iframe autre que celle du prestataire, « Valider la commande »
  reste interdite. Deux tests le figent, dont un qui verifie que la MEME page
  est bien commandee dans la frame du prestataire -- sinon le premier ne
  prouverait rien.
- **Le cadre du dessus attend la sentinelle** au lieu d'echouer sur un budget
  fixe de trente secondes, tant que sa fenetre d'achat est a l'ecran (plafond
  150 s, l'onglet pilote en a 300 en tout).
- **Il ne detruit plus une commande en cours.** `processNext` cherchait la
  carte du jeu suivant 1,5 s puis naviguait : sur une fiche avec la fenetre
  d'achat ouverte, cela emportait la modale et la commande avec la page. Le
  passage au jeu suivant attend desormais la fermeture de la fenetre.
- **Une modale qui attend se VOIT** : au bout de trente secondes sans
  changement d'ecran, une notification nomme le bouton a cliquer. Rien n'est
  jamais enregistre comme « recupere » dans ce cas.
- **L'arret d'urgence protege enfin la frame d'achat.** `gm-shim.js` ne
  prechargeait le stockage que dans l'iframe du prestataire :
  `FGC_kill_switch` y rendait toujours sa valeur par defaut, donc le bouton
  d'arret ne pouvait pas bloquer un clic dans la frame ou le moteur clique le
  plus. Aligne sur `02-frames.js`.
- **Les hotes Epic sont elargis** a `*.epicgames.com` dans les deux manifestes
  et dans l'en-tete userscript. Aujourd'hui l'iframe d'achat est sur
  `store.epicgames.com` ; le jour ou Epic la sert d'ailleurs, le moteur n'y
  existerait pas et aucune ligne ne le dirait.
- **Deux silences supprimes** : le repli « niveau document » sur le bouton
  d'accord ne se declenchait que quand une modale avait deja ete reconnue,
  c'est-a-dire quand on n'en avait pas besoin ; et le temoin qui signale une
  modale sans bouton reconnu, global et jamais remis a zero, taisait tous les
  incidents apres le premier de la page.
- La garde contre deux executions concurrentes passe de 2 a 5 minutes : une
  reclamation peut desormais durer plus de deux minutes, et la garde se serait
  perimee au milieu -- le correctif aurait fabrique le bug qu'il corrige.

Note : une fenetre restee ouverte est desormais journalisee comme un echec de
parcours, donc comptee par le canari de selecteurs. C'est voulu -- une modale
que le moteur ne sait plus franchir EST une panne de parcours.

Quatorze tests (`test/epic-payment-frame.test.mjs`), dont celui qui reproduit
exactement le 2026-09-17 : un premier ecran, vingt passes sans effet, puis la
modale qui arrive tard -- et « J'accepte » qui est clique. Il echoue sur le
moteur de la 2.15.3.

## 2.15.3 -- 2026-09-17

**Un clic, c'est un clic**

La 2.15.2 a rendu les boutons trouvables ; celle-ci corrige ce qu'on en
faisait. Symptome rapporte le meme jour : la fenetre d'achat s'ouvre puis
reste figee, et l'utilisateur voit passer plusieurs clics la ou un seul est
demande -- un pour ouvrir la fenetre, un pour confirmer.

- **Chaque appel de clic en envoyait deux.** `robustClick` dispatchait un
  evenement `click` PUIS appelait `el.click()`, qui en dispatche un second :
  deux activations pour un seul appel, sur un bouton qui n'en attend qu'une.
  Le premier ouvre la fenetre d'achat, le second retombe dedans pendant son
  ouverture. `el.click()` n'est plus qu'un repli, quand le dispatch echoue.
  Les evenements de pointeur portent desormais `pointerId`, `isPrimary` et
  `button`, que certains gestionnaires exigent pour ne pas les ignorer.
- **Plus de rafale sur le meme bouton.** Le guetteur des modales repasse
  toutes les secondes et l'attente de confirmation toutes les 500 ms : tant
  que la modale restait affichee, le meme « J'accepte » recevait un clic par
  passage. La 2.15.2 avait borne le MESSAGE ecrit dans la console, pas le
  clic. Un bouton deja clique est desormais laisse tranquille (4 s de repos,
  3 clics au plus), et les modales ne sont recliquees qu'au bout de 5 s.
- **Une nouvelle tentative ne reclique plus par-dessus la fenetre ouverte.**
  Apres un echec, `withRetry` relance la reclamation depuis le debut ; si la
  fenetre d'achat est deja la, le moteur attend sa confirmation au lieu de
  recliquer « Obtenir » dessous. Meme regle dans le parcours panier, ou deux
  clics partaient dans le meme tour de boucle -- vu de la page, un double-clic.
- **La veille des modales ne s'arrete plus au milieu d'un achat.** Bornee a
  trois minutes depuis le debut de la reclamation, elle expirait parfois juste
  avant la popup a fermer. Elle se prolonge tant que la fenetre d'achat est
  ouverte, avec un plafond dur de dix minutes.
- **Les libelles sont normalises avant comparaison.** Epic ecrit ses libelles
  francais avec des espaces insecables et repartit le texte sur plusieurs
  descendants : un motif ancre echouait sur un blanc que `trim()` ne voit pas.
- L'etape « Passer commande » exige un bouton ACTIF : cliquer un bouton grise
  ne faisait que consommer le clic unique auquel la page a droit.

## 2.15.2 -- 2026-09-17

**L'accord de retractation : le meme piege, au troisieme endroit**

Le clic « Ajouter a la bibliotheque » passe depuis la 2.15.1. C'est la modale
suivante -- « Informations sur le droit de retractation » -- qui arrete le
parcours.

- Le guetteur de modales du cadre principal cherchait le bouton d'accord avec
  des motifs ANCRES en `^...$`, exactement comme l'iframe de paiement avant la
  2.14.1 et la fiche produit avant la 2.13.2. Le textContent d'un bouton Epic
  concatene tous ses descendants : un span suffit a faire echouer le motif.
  Troisieme endroit, meme cause, meme correctif -- avec en plus un repli au
  niveau du document, le conteneur deduit du titre ne contenant pas forcement
  les boutons selon la facon dont Epic imbrique sa modale.
- **Une modale vue sans bouton reconnu se disait enfin.** Le code ne faisait
  rien du tout dans ce cas : le parcours s'arretait, et aucune ligne n'en
  donnait la raison. Il ecrit desormais les libelles reellement visibles -- une
  fois, pas a chaque seconde de la veille de trois minutes.
- Le module d'iframe fait de meme quand il ne trouve pas son bouton : « aucun
  bouton trouve » n'apprend pas quels boutons ETAIENT la, et c'est exactement
  ce qui manque quand Epic change sa modale.

## 2.15.1 -- 2026-09-17

**La commande gratuite Epic ne passe pas par le prestataire de paiement**

Le correctif de la 2.15.0 ne pouvait pas marcher, et voici pourquoi : le module
qu'il corrigeait ne demarrait jamais.

- `02-frames.js` n'autorisait le moteur que dans la sous-iframe
  `payment-website-pci`. Or **un total a zero n'a pas d'etape carte bancaire** :
  la commande gratuite se termine ailleurs. Le module de paiement ne tournait
  donc pas, la fiche attendait trente secondes une confirmation que personne
  n'allait produire, et le bouton « Ajouter a la bibliotheque » restait a
  l'ecran -- exactement ce que montre la capture.
- Le moteur accepte desormais **toutes les sous-iframes d'Epic**. On ne devine
  pas l'adresse de la bonne : elle n'a pas ete mesuree, et deux versions ont
  deja ete perdues a supposer.
- **C'est ce qu'il a le droit d'y CLIQUER qui borne le risque**, pas l'adresse.
  Dans une sous-iframe autre que celle du prestataire, la liste se reduit a
  « Ajouter a la bibliotheque » puis « J'accepte ». « Valider la commande » en
  est exclue : le premier ne peut pas depenser d'argent, le second si, et ces
  iframes-la n'ont pas ete mesurees une par une -- un panier payant en ouvre
  aussi. Un test le fige.
- Et l'echec porte enfin son diagnostic : **l'inventaire des iframes** de la
  fiche est ecrit au journal quand la confirmation n'arrive pas. Une ligne
  comme celle-ci aurait dementi la supposition du premier coup, au lieu de deux
  versions plus tard.

## 2.15.0 -- 2026-09-17

**GOG a enfin sa propre source**

Jusqu'ici, GOG n'etait vu que par l'agregateur tiers. Sa disparition est le
premier risque du design, et elle aurait rendu la veille aveugle sur un des
trois magasins que l'extension sait reclamer.

- La source lit le catalogue filtre par prix, en JSON :
  `/games/ajax/filtered?mediaType=game&price=free`. Mesure du 2026-09-17 : 200,
  `application/json`, cles `products` / `page` / `totalPages` / `totalResults`.
- **Le controle qui a evite un piege.** La requete filtree rend une liste VIDE.
  Deux lectures opposees : aucun jeu gratuit en ce moment, ou endpoint
  desaffecte qui rendra vide pour toujours. La meme requete SANS le filtre rend
  7 591 octets de vrais produits -- l'endpoint est vivant, et le vide dit vrai.
  La seconde lecture aurait ete le piege parfait : une source qui repond
  « rien » eternellement SANS JAMAIS ECHOUER, donc sans declencher ni le
  canari, ni le recul, ni la sentinelle.
- Le JSON plutot que la page : un schema change quand le service change, une
  classe CSS change quand un designer passe. Et la page d'accueil pese 953 Ko
  contre quelques-uns ici.
- La distinction d'Epic, transposee : `baseAmount > 0` et `finalAmount === 0`,
  c'est un jeu payant offert un temps ; `baseAmount === 0`, c'est gratuit de
  toute facon et il n'y a rien a reclamer. La valeur porte sa devise, jamais un
  nombre nu.
- La fin de promotion est lue en SECONDES (`salesVisibility.to`). Lue en
  millisecondes, une offre qui se termine dans trois jours paraitrait expiree
  depuis 1970.
- La lecture est ANONYME. Connecte, GOG masque ce que le compte possede deja :
  la veille verrait une offre disparaitre parce qu'elle a ete reclamee.
- La liste est declaree INCOMPLETE : la source ne lit que la premiere page, et
  le parametre de pagination n'a pas ete mesure. Une offre qui s'attarde coute
  moins cher qu'une offre enterree a tort.
- La source s'active chez ceux qui ont deja des reglages enregistres, faute de
  quoi elle ne tournerait que sur les nouvelles installations. Defendable tant
  que la liste des sources n'est editable nulle part -- le jour ou elle le
  devient, ce rattrapage doit disparaitre.

**Ce qu'elle ne voit pas, et c'est dit**

Un giveaway GOG s'annonce aussi par une banniere sur la page d'accueil. Aucun
giveaway ne tournait au moment de la mesure -- ni element de classe
`giveaway`, ni structure de donnees du meme nom -- donc son balisage n'a PAS pu
etre observe. Ecrire des selecteurs sans les avoir vus est precisement ce que
la feuille de route interdit. Si un giveaway apparait sans passer par ce
catalogue, l'agregateur le verra, et le journal dira lequel des deux a parle.

## 2.14.1 -- 2026-09-17

**L'acquisition Epic s'arretait sur la derniere etape**

Constate sur « Mindcop » : l'iframe de paiement s'ouvrait, affichait « Ajouter
a la bibliotheque », et plus rien ne se passait jusqu'a l'expiration des trente
secondes. Le jeu n'etait pas recupere.

- **Le repli non ancre manquait dans l'iframe.** Le textContent d'un bouton
  Epic concatene tous ses descendants : un span de lecteur d'ecran suffit a
  faire echouer un motif en `^...$`. C'est exactement le piege corrige en
  2.13.2 sur la fiche produit -- et le correctif n'avait jamais ete applique au
  module de paiement, qui n'essayait que les motifs ancres. Il essaie desormais
  les deux, et prefere le libelle le plus court : le vrai bouton, pas un
  conteneur qui l'embarque.
- **Le module abandonnait avant la fin.** Apres un clic, il ne continuait que
  si le bouton clique etait un « J'accepte » -- il supposait donc que l'accord
  precedait la commande. La capture montre l'inverse : « Ajouter a la
  bibliotheque » d'abord, puis la modale « droit de retractation ». Le module
  s'arretait juste avant la derniere etape. Il enchaine maintenant, borne a
  trois tours, et s'arrete de lui-meme quand aucun bouton connu n'apparait
  plus.
- **Douze secondes etaient un pari.** L'iframe abandonnait la recherche a 12 s
  alors que la fiche, au-dessus, patientait encore dix-huit secondes pour rien.
  La premiere etape dispose desormais du meme budget que la confirmation
  qu'elle doit produire ; les suivantes restent breves, une modale qui suit un
  clic apparaissant tout de suite ou pas du tout.
- **La console ne deborde plus.** L'avertissement « aucun element visible ne
  correspond » etait emis depuis l'interieur d'une attente qui sonde toutes les
  300 ms : un echec de douze secondes ecrivait quarante lignes identiques, et
  la ligne utile -- celle qui NOMME les boutons vus -- se perdait au milieu.
  Une fois par libelle et par tranche de cinq secondes.
- Le message d'echec de la fiche ne promet plus de chercher « Ajouter a la
  bibliotheque » dans une liste qui ne le contient pas : il nomme ce qu'il
  cherche vraiment.

Deux tests figent la cause : le motif ancre DOIT echouer sur le libelle avec
span, et le repli DOIT le rattraper -- sans attraper « Ne pas accepter ».

## 2.14.0 -- 2026-09-17

Deux choses etaient affichees a cote de la verite sur un compte francais. Le
reste de cette version rend visible ce que la veille faisait sans le dire.

**Les montants gardent leur devise**

- `money()` collait un « $ » sur tous les montants, au motif -- ecrit dans le
  code -- que les sources publient des dollars. C'est faux pour celle qui
  compte : Epic publie le prix DU COMPTE, « 23,99 EUR » avec son currencyCode a
  cote. Le bilan lisait donc vingt-quatre dollars la ou il y a vingt-quatre
  euros, et rien sur le chiffre seul ne permettait de s'en apercevoir.
- La devise se lit desormais dans le montant lui-meme, et les totaux sont tenus
  PAR DEVISE, jamais additionnes entre eux : une somme d'euros et de dollars ne
  designe rien, et convertir demanderait un taux que personne ici ne peut
  verifier. Une devise illisible s'affiche sans symbole plutot qu'avec le
  mauvais.
- Steam composait « $ » + les centimes ; il prend maintenant la forme deja
  formatee par le magasin. Epic reconstruit son repli avec le currencyCode, au
  lieu d'un nombre nu que quelqu'un devrait plus tard supposer en dollars.
- Le tri par valeur faisait un `parseFloat` apres avoir retire tout sauf les
  chiffres et les points : « 23,99 EUR » devenait 2399, et la moins chere des
  offres francaises se rangeait avant la plus chere.
- Le bilan et l'export lisent enfin le registre, ecrit pour ca : passe la purge
  du catalogue -- trente jours -- les vieilles reclamations sortaient sans titre
  et sans prix, c'est-a-dire au moment ou l'un et l'autre servent le plus.
  L'export CSV gagne une colonne devise.

**Le jour s'ecrit en francais**

- `readableDelay` ecrivait « 2 d 4 h » en dur, dans une interface francaise
  partout ailleurs. Les trois unites passent par les tables : « 2 j 4 h ».
- Quand l'interface du navigateur n'est ni anglaise ni francaise, les langues
  declarees par le lecteur sont consultees avant de retomber sur l'anglais. Une
  interface livree reste prioritaire : c'est le signal le plus delibere.

**Le journal de la veille survit a la nuit**

- `record()` ecrivait dans la console du service worker, et un service worker
  s'arrete apres trente secondes d'inactivite en emportant sa console. Le seul
  endroit ou l'on pouvait lire ce qui s'etait passe a 4 h du matin etait efface
  avant le reveil. C'est ce qui a rendu la 2.13.4 si difficile a trouver.
- 500 entrees persistees, un seul ecrivain -- le service worker -- et une borne
  imposee a l'ecriture : un journal sans fin remplirait le quota, et c'est
  alors le CATALOGUE qui ne pourrait plus s'ecrire. Les Error sont reduites en
  texte avant d'etre stockees : passees telles quelles, elles arrivent sous la
  forme `{}`, sans que rien ne le signale.
- `journal.html` le lit, le filtre -- « alertes » montre aussi les erreurs,
  sinon la lecture de la nuit est fausse -- et le telecharge dans l'ordre ou
  les choses se sont produites, a joindre a un rapport de bug.

**Le canari : un magasin qui a bouge le dit**

- Quatre des six dernieres versions corrigeaient un libelle ou un selecteur qui
  avait change sous nos pieds. A chaque fois la reclamation echouait, le recul
  espacait poliment les tentatives, et personne n'apprenait rien avant de
  constater qu'un jeu manquait.
- Deux echecs de selecteur d'affilee sur un magasin qui a deja reussi levent
  une alerte, visible en tete des magasins, avec le motif technique recopie tel
  quel -- c'est lui qui nomme le bouton manquant. Trois echecs pour un magasin
  qui n'a jamais rien reclame : il peut simplement n'avoir jamais ete essaye.
- Le classement se fait par elimination : un echec dont le motif n'est pas l'un
  des NOTRES parle du magasin. Reconnaitre la forme d'un echec de selecteur
  aurait rate les trois derniers, chacun pour une raison differente.
- Le canari ne clique nulle part et n'ouvre aucun onglet. Un succes eteint
  l'alerte tout seul.

**Ne plus ouvrir d'onglet pour un jeu deja acquis**

- Le registre savait ce qui avait ete reclame ; le filtre ne le lui demandait
  pas. Une offre qui revient sous une autre cle faisait rouvrir un onglet et
  consommait un jeton du plafond horaire -- la ressource qui protege le compte
  -- pour un jeu deja possede.
- Le magasin fait partie de la cle : posseder un titre sur Epic ne le donne pas
  sur GOG, et la copie GOG vaut d'etre prise.

**Les codes en attente survivent a une desinstallation**

- Reglage, coupe par defaut : la zone de synchronisation traverse le compte du
  navigateur, et y poser les codes de quelqu'un sans le lui demander serait
  prendre une decision a sa place.
- Les codes seuls y vont. Au-dela de 8 Ko par element, `set()` ne tronque pas :
  il rejette, et rien ne serait sauvegarde. Le lot est donc coupe ici, par les
  plus ANCIENS -- la queue de la liste est ce qui vient d'arriver et n'a pas
  encore ete echange.
- La restauration fusionne, jamais ne remplace : ecraser la liste locale
  effacerait les codes recoltes depuis la derniere synchronisation.

**Lire du HTML sans DOM**

- `watch/offscreen.js` ouvre enfin la voie mesuree en aout et jamais branchee :
  un document invisible lit une page et rend des extraits bruts, laissant a
  chaque source le soin d'en faire des offres dans une fonction pure. Un seul
  document a la fois, ferme systematiquement, absent sur Firefox et declare
  comme tel.
- La page de diagnostic gagne la mesure qui debloque les deux dernieres entrees
  de la feuille de route : ce que la page d'accueil GOG expose reellement, et
  si `gaming.amazon.com` sert encore quelque chose. On mesure les selecteurs au
  lieu de les deviner.

**Ailleurs**

- `ROADMAP.md` : ce qui n'est pas encore fait, pourquoi, et ce qu'il faut
  mesurer avant d'ecrire.
- Integration continue : `npm run check` tourne a chaque push. La
  reconstruction du moteur comparee au bit pres est exactement le controle
  qu'une relecture de diff ne peut pas faire.
- 486 tests. Le moteur n'a pas bouge : la reference figee de la 2.13.4 est
  toujours reconstruite a l'identique.

## 2.13.4 -- 2026-09-16

**La veille de fond tourne enfin, et plus d'erreurs dans chrome://extensions**

- **La veille ne tournait jamais.** `alarms.create` recevait une propriete
  `persistAcrossSessions` qui n'existe pas dans l'API : Chrome rejette l'appel
  entier. Aucune alarme n'etait posee, la planification echouait a chaque
  demarrage du service worker, et meme « Verifier maintenant » plantait avant
  de lancer le cycle. Les tests ne pouvaient pas le voir : le faux `chrome`
  accepte n'importe quelle propriete. Constate en chargeant l'extension dans
  Chromium ; apres correction, les deux alarmes sont bien posees.
- **Firefox : le moteur ne demarrait jamais.** Il attendait l'evenement `load`
  sans verifier qu'il etait deja passe, or Firefox injecte les scripts
  `document_idle` une fois la page chargee : l'ecouteur arrivait trop tard.
  Ni bouton, ni reponse a la veille. Mesure sous Firefox avec l'extension
  temporaire : 0 demarrage sur 3 avant, 3 sur 3 apres. Chromium injecte en
  pratique avant `load` (16 sur 16 dans les deux versions), mais ne le
  garantit pas : la correction vaut aussi pour lui.
- **Defi de securite Cloudflare reconnu.** Sa page 403 « Un instant... » cache
  l'iframe Turnstile dans un shadow root ferme : `querySelectorAll('iframe')`
  ne la voyait pas, et le moteur epuisait cinq tentatives avant de finir en
  « page non chargee ». Le script d'orchestration de la page de defi suffit a
  la reconnaitre ; ni le script de detection que Cloudflare pose sur les pages
  saines, ni le widget Turnstile du formulaire GOG /redeem ne declenchent. Le
  moteur s'arrete aussitot, et la veille rend l'onglet a l'utilisateur.
- **Un defi de securite n'empile plus les onglets.** Comme une reconnexion, il
  echappait au recul : chaque cycle rouvrait un onglet pour la meme offre et
  le laissait dans la fenetre de l'utilisateur (deux a une minute d'intervalle
  pendant les essais). Il recule desormais -- 15 min, 1 h, 4 h, puis 12 h --
  sans jamais etre abandonne ; « Reessayer maintenant » efface le recul. Les
  reconnexions (`needs_login`, `needs_link`) gardent leur regle.
- Service worker : les promesses lancees par les ecouteurs (planification,
  cycle, notification, ouverture d'onglet) ont toutes leur `catch`. Un echec
  ne devient plus une « Uncaught (in promise) », et le popup recoit toujours
  une reponse au lieu d'attendre indefiniment.
- Passerelle GM : les callbacks (`GM_xmlhttpRequest`, prechargement du
  stockage) lisaient la reponse sans consommer `runtime.lastError` ; un
  service worker muet laissait « Unchecked runtime.lastError » dans la console
  des pages de magasin (reproduit avec un temoin).
- Les URL publiees par les sources (page, redirection, vignette) doivent etre
  en http(s) : un `javascript:` venu d'une API tierce n'atteint plus
  `tabs.create`.
- Popup : Entree sur un bouton n'ouvre plus en plus le premier jeu ; la copie
  d'un code refusee par le navigateur n'affiche plus « copie » ; l'import
  ignore des reglages qui ne sont pas des objets ; les prochaines sorties
  n'affichent plus d'ouvertures deja passees ; l'invite de sauvegarde suit la
  langue choisie.

## 2.13.3 -- 2026-08-27

**Les fenetres de reclamation ne restent plus ouvertes**

- La fermeture ne visait que NOTRE onglet. Des qu'une page ouvrait quelque
  chose dans la fenetre reduite -- echange GOG, lien _blank -- la fenetre
  survivait dans la barre des taches, et c'etait a l'utilisateur de faire le
  menage. C'est la FENETRE entiere qui est fermee desormais, avec repli sur
  l'onglet si elle resiste.
- Un onglet demande par le moteur pendant une reclamation invisible (l'echange
  GOG declenche depuis Luna) nait maintenant dans la meme fenetre reduite,
  jamais dans celle de l'utilisateur -- et part donc avec elle.
- Le balayage des orphelins ferme aussi les fenetres : un service worker mort
  en pleine reclamation laissait une fenetre entiere, pas seulement un onglet.
- Cas du defi de securite : l'onglet est d'abord ramene dans la fenetre de
  l'utilisateur, puis la fenetre reduite -- qui ne contient plus que
  d'eventuels restes -- est fermee.

## 2.13.2 -- 2026-08-27

**L'echec Epic porte desormais son diagnostic**

- Le message d'erreur du bouton d'acquisition liste les libelles des controles
  reellement visibles sur la page : "bouton introuvable" n'apprend rien,
  "boutons vus : Acheter | Liste de souhaits" dit exactement quel motif
  manque. Une capture d'ecran de l'erreur suffit desormais a corriger.
- Repli non ancre pour le bouton "Ajouter a la bibliotheque" : le textContent
  d'un bouton Epic concatene tous ses descendants, et un span invisible
  (lecteur d'ecran, spinner) suffit a faire echouer un motif ^...$. Le repli
  prefere le candidat au libelle le plus court -- le vrai bouton, pas un
  conteneur qui l'embarque.

## 2.13.1 -- 2026-08-27

**Correctif : les deux popups Epic restaient a l'ecran**

- Apres « Ajouter a la bibliotheque », Epic ouvre la modale « Informations sur
  le droit de retractation » (J'accepte), puis la modale « Lanceur Epic Games »
  (a fermer). Le guetteur savait cliquer les deux -- mais il ne cherchait leurs
  titres que dans h1, h2 et h3, et Epic a change son balisage : il ne les
  voyait plus, et les laissait a l'utilisateur.
- La detection balaie desormais h1 a h6 et role="heading", puis, en repli, le
  texte entier des conteneurs de dialogue (role="dialog", aria-modal) : un
  titre rendu dans un span stylise n'echappe plus au balayage.
- Le parcours direct concluait CLAIMED des qu'aucune iframe de paiement
  n'existait -- c'est-a-dire au moment precis ou la modale de retractation
  venait d'apparaitre. Il attend desormais une CONFIRMATION (bouton « Dans la
  bibliotheque », message de commande confirmee, ou modale du lanceur), jamais
  une absence.
- Avant de declarer l'echec sur delai, la possession est verifiee : Epic change
  ses modales, mais le bouton « Dans la bibliotheque » qui remplace le bouton
  d'achat dit la verite. Ce filet vaut pour les deux parcours, panier compris.

## 2.13.0 -- 2026-08-27

**La recuperation de fond devient invisible**

- Elle s'ouvrait dans un onglet `active: false` : sans voler le focus, mais
  VISIBLE dans la barre d'onglets -- le voir surgir puis disparaitre toutes les
  quelques heures ressemble a un navigateur hante. Chrome n'a pas d'onglet
  cache ; ce qu'il a, c'est la fenetre REDUITE : la reclamation vit desormais
  dans une fenetre minimisee, hors de la vue, sans toucher au focus ni a la
  barre d'onglets.
- L'invisibilite s'inverse au moment precis ou elle deviendrait nuisible : un
  defi de securite qui attend un humain fait remonter l'onglet dans la fenetre
  de l'utilisateur. Un onglet enterre dans une fenetre reduite ne serait jamais
  trouve.
- Repli sur l'onglet inactif quand la creation de fenetre echoue, et fermeture
  de toute fenetre creee sans onglet lisible -- le registre des onglets pilotes
  ne connait que des identifiants d'onglet, une fenetre orpheline ne serait
  jamais balayee.
- Deux couts assumes : les minuteries d'une page reduite peuvent etre alignees
  a la seconde (le moteur sonde a 500 ms sur un budget de cinq minutes, sans
  incidence a cette echelle), et la mise en page reste calculee, donc les
  controles de visibilite du moteur disent toujours la verite.

## 2.12.1 -- 2026-08-27

**Correctif : Epic ne recuperait rien**

- « waitForElement: timeout apres 10000ms », vu en production sur « Rival Stars
  Horse Racing ». Epic affiche parfois « Ajouter a la bibliotheque » directement
  sur la fiche, sans etape panier ; le flux n'attendait que le bouton panier
  (« Obtenir / Ajouter au panier ») et expirait sans rien faire.
- Le flux accepte desormais les deux parcours des l'entree, et branche selon le
  bouton qui apparait : panier -> commande -> paiement, ou bibliotheque directe
  -> accord de licence -> confirmation. Le correctif vaut pour la page ouverte a
  la main ET pour la recuperation de fond -- c'est le meme moteur.

## 2.12.0 -- 2026-08-27

Ne reclamer que ce qu'il y a a garder, et arreter d'ouvrir des onglets sur des
comptes que vous avez decoches. Quatre bugs de cette famille sont corriges, et
chacun agissait sur un vrai compte sans que rien ne le montre.

**Le jeu offert de la semaine, et rien d'autre**

- La difference se lit dans le prix d'origine, et nulle part ailleurs :
  `originalPrice > 0` avec `discountPrice === 0`, c'est un jeu payant offert un
  temps ; `originalPrice === 0`, c'est gratuit de toute facon.
- Mesure sur la capture reelle du 2026-08-27 : le flux freeGamesPromotions rend
  DEUX offres actives, et l'extension les prenait toutes les deux. La seconde
  etait un « Pack de Mage Epique » a 0 EUR -- un cosmetique permanent, offerType
  ADD_ON. Chaque cycle ouvrait un onglet et posait une requete sur un vrai
  compte pour un objet que tout le monde possede deja.
- Corrige des deux cotes : la veille ET le moteur. Un test de parite verifie
  qu'ils s'accordent sur chaque element de la capture -- sans lui, l'un
  reclamerait ce que l'autre ecarte.
- Nouveau champ `keepable` (vrai / faux / inconnu) et reglage « seulement ce
  qu'il y a a garder », actif par defaut. Inconnu laisse passer : traiter
  l'ignorance comme un refus ferait rater de vrais jeux offerts.
- Le prix d'origine d'Epic est enfin recupere. Le bilan comptait les jeux Epic
  sans jamais pouvoir dire ce qu'ils valaient.

**Quatre trous qui coutaient un compte**

- MAGASIN DECOCHE. `watchedStores` etait applique aux annonces et a
  l'affichage, jamais a la reclamation. Decocher Amazon faisait disparaitre les
  offres Luna de la liste et des notifications, et l'extension continuait
  d'ouvrir des onglets sur le compte Amazon la nuit -- invisible par
  construction, puisque l'offre n'apparaissait plus nulle part. « Tout
  recuperer » recoit le meme filtre, sinon il rouvrait la porte que le cycle
  venait de fermer.
- BOUCLE INFINIE. `failed` n'etant pas un verdict definitif, l'offre repassait
  en file et etait retentee a chaque cycle : cinq minutes d'onglet et un jeton
  du plafond horaire, indefiniment, pour un selecteur qui ne reviendrait pas.
  Recul a 15 min, 1 h, 4 h, 12 h, puis abandon au cinquieme essai. `attempts`
  etait incremente depuis toujours et personne ne le relisait.
- ONGLET FERME. Fermer l'onglet de fond laissait l'attente courir jusqu'a son
  budget, cinq minutes. Les reclamations s'enchainent en serie et le catalogue
  n'est ecrit qu'apres la boucle : un seul onglet ferme immobilisait le cycle
  assez longtemps pour que le service worker soit tue avant l'ecriture.
  onRemoved et onReplaced resolvent maintenant toutes les attentes de l'onglet,
  chargement compris.
- RECLAMATION INTERROMPUE. Le worker meurt a cinq minutes par evenement, soit
  exactement le budget d'UNE reclamation. L'offre est desormais marquee avant
  l'action, et un rattrapage au debut du cycle suivant la reclasse en
  « incertain » -- ni un succes qu'on n'a pas constate, ni un echec qui ferait
  recommencer tout de suite.

**Arret d'urgence**

- Un interrupteur, et un seul point de controle : `robustClick`, le goulot par
  lequel passe tout ce que le moteur fait d'irreversible. Un interrupteur pose
  plus haut laisserait passer le module qu'on aurait oublie de brancher.
- Il coupe aussi le cycle avant toute ecriture, bloque « Tout recuperer », et
  referme les onglets deja ouverts.
- Sa cle vit dans l'espace FGC_*, seule exception de la veille : le moteur doit
  la lire de facon SYNCHRONE avant un clic, et une lecture asynchrone rendrait
  sa reponse apres.

**Ce que l'interface montre enfin**

- VOUS ATTENDENT : les offres dont la derniere tentative s'est arretee sur
  quelque chose qu'une personne seule peut resoudre -- connexion, association de
  compte, defi de securite. Elles etaient indiscernables des offres que
  personne n'avait encore touchees.
- HORIZONS : la liste est coupee par echeance, avec un compte. « Fin inconnue »
  est en PREMIER et non en dernier : huit offres sur vingt de l'agregateur n'ont
  pas de date, et l'ordonnanceur les traite en tete parce qu'une date qu'on
  ignore n'est pas une echeance lointaine. Les separateurs n'apparaissent que
  sous le tri par echeance -- ailleurs ils decriraient un ordre que la liste ne
  suit pas.
- POURQUOI CETTE OFFRE NE SERA PAS PRISE : une puce par carte, rendue par la
  meme fonction que la veille utilise. Elle ne peut donc pas dire quelque chose
  que le moteur contredirait. Sans elle, une offre filtree ressemblait
  exactement a une offre sur le point d'etre reclamee.
- CE QUI A CHANGE : « 2 nouvelles depuis votre dernier passage », et une marque
  sur les cartes. L'instantane est fige UNE fois par ouverture du popup, parce
  qu'afficher l'onglet Jeux marque tout comme vu a l'instant meme ou la
  nouveaute devient visible.
- DEJA A VOUS : rapprochement avec la bibliotheque, pas seulement avec les
  offres du jour. « a vous sur Epic Games Store depuis juil. 2025 ».
- « Tout recuperer » est un bouton comme les autres, sous la liste, au lieu
  d'un lien souligne dans un titre de section.

**La bibliotheque**

- Un registre permanent, ecrit a l'instant de la reclamation. C'est la SEULE
  fenetre pendant laquelle l'information existe : le titre, la valeur et la
  vignette vivent dans le catalogue, purge a trente puis quatre-vingt-dix jours.
  Passe ce delai, l'historique du moteur ne porte plus qu'un slug -- et le
  journal affichait « Amazon Luna » a la place d'un nom de jeu, le bilan
  comptait sans valoriser, l'export sortait des lignes vides.
- La premiere date gagne : un second passage sur la meme page rend « deja
  possede » et ne doit pas redater une acquisition de deux ans vers aujourd'hui.
- Un champ renseigne ne se fait jamais ecraser par un champ vide, ce qui permet
  d'enrichir plus tard une entree figee sans titre.
- Alimente par storage.onChanged plutot que par nos propres ecritures : le
  moteur ecrit aussi quand vous reclamez a la main, sur une page que la veille
  n'a jamais vue.

**Deploiement automatique**

- `npm run build` copie desormais l'extension prete a charger dans
  `D:\free-games-claimer-extension-copie`. Ce dossier etait reste en 2.7.1
  pendant que le depot avancait jusqu'en 2.11.0 : tout ce qui etait teste ici ne
  changeait rien la-bas.
- Seuls les fichiers du paquet sont copies -- pas les sources du moteur, ni les
  tests, ni le build. Le nettoyage est limite aux chemins CONNUS : un dossier a
  la racine d'un disque peut contenir autre chose, et un effacement recursif sur
  une cible mal configuree est le genre d'erreur qu'on ne fait qu'une fois.

**Outillage**

- `verify-rename --rebase "motif"` rebase la preuve du moteur apres une
  modification volontaire, en ecrivant a cote ce qu'elle couvrait. Sans cette
  trace, rebaser deviendrait le geste qu'on fait pour faire taire un controle
  plutot que pour enregistrer une decision.

**Correctif : le popup se vidait**

- « ReferenceError: sinceText is not defined ». Le renommage en anglais avait
  transforme `sinceText` en `since` ; du code ecrit apres appelait encore
  l'ancien nom. L'exception etait levee AU MILIEU du rendu de la liste des
  jeux, donc plus aucun jeu et plus aucune vignette -- une seule faute
  expliquait les deux symptomes.
- Le build refuse desormais toute reference vers un nom qui n'existe pas.
  `node --check` valide la syntaxe, pas les references ; et les tests ne
  chargent pas popup.js, qui a besoin d'un DOM. Le controle a ete valide en
  reintroduisant la faute : il la designe, a la bonne ligne. Un garde-fou qui
  ne se declenche jamais ne prouve rien. Il a d'ailleurs attrape sa premiere
  vraie faute dans la minute qui a suivi -- une fonction supprimee par l'elagage
  et encore appelee par l'export CSV.

**Elagage**

- Retires : synchronisation des reglages (aucune resolution de conflit, sans
  effet sur une seule machine), export calendrier (personne ne met une echeance
  de jeu gratuit dans son agenda, et le popup montre deja le compte a rebours),
  densite (deux densites pour une liste qui a maintenant ses propres
  separateurs), jauge de stockage et purge manuelle (16 % de 10 Mo, pour un
  menage que le cycle fait deja), modes de badge (trois choix pour un chiffre),
  carte de premier lancement (elle disait d'aller cliquer ailleurs).
  Vingt-deux cles de traduction sont parties avec, designees par le detecteur
  d'orphelines.
- Le deploiement vers un second dossier est supprime, et le dossier lui-meme
  aussi : l'extension se charge depuis le depot.

**Ajoutes, parce que la plomberie existait sans surface**

- « Pas interesse » sur chaque carte : masque l'offre ET exclut le titre, d'un
  seul geste, annulable. `dismissed` et `excludedTitles` etaient dans le modele
  depuis le debut et rien ne savait les ecrire. Les separer en deux boutons
  aurait oblige a comprendre la difference avant de pouvoir agir.
- « Reessayer » sur une offre bloquee : efface le recul et le compteur d'essais.
  Se reconnecter est exactement ce qu'on vient de faire avant d'appuyer la, et
  attendre douze heures pour le verifier n'aurait aucun sens. Le garde-fou tient
  quand meme : chaque clic ne rouvre que cinq tentatives espacees, et il faut un
  humain pour le refaire.
- Le journal nomme enfin les vieilles reclamations : il lit la bibliotheque
  quand le catalogue a oublie. Une entree de quatre cents jours affichait un
  slug embelli, elle affiche son titre.
- Meilleur mois et magasin dominant au bilan. `byMonth` et `mainStore()`
  etaient calcules depuis la V2 et affiches nulle part -- c'est pourtant la
  seule forme sous laquelle des annees d'accumulation deviennent visibles.

**Tests**

- 389, dont 52 nouveaux. Le fichier `test/claim-safety.test.mjs` porte un test
  par comportement qui, avant cette version, ouvrait un onglet sur un compte
  reel sans que personne puisse le voir.
- Un decalage d'un cran dans le recul -- une heure d'attente des le premier
  echec au lieu de quinze minutes -- a ete trouve par son propre test, pas par
  la relecture.

## 2.11.0 -- 2026-08-27

Interface epuree, conventions anglaises, internationalisation. Deux garde-fous
nouveaux valent le detour : l'un rend ERR_FILE_NOT_FOUND impossible, l'autre
prouve qu'un renommage de 570 identifiants n'a change aucun comportement.

**Interface : moins large, moins de texte, un indicateur qui parle**

- Le popup passe de 372 a 328 px, et `overflow-x` est coupe. Une barre de
  defilement horizontale dans un popup est toujours un bug de mise en page, et
  elle volait sa largeur a chaque ligne.
- La barre de duree pleine largeur disparait. A sa place, un ANNEAU qui se vide
  autour de la vignette : une ligne de moins par carte, et l'oeil tombe sur le
  jeu plutot que sur une jauge. Fin inconnue : anneau hachure ambre, jamais
  vide -- l'ordonnanceur place ces offres en tete de file, et l'oeil doit lire
  la meme urgence.
- Le temps restant devient une pastille dont la couleur EST le message : terne
  au-dela de trois jours, ambre en dessous, rose sous vingt-quatre heures, et
  elle respire sous une heure. Des chiffres, jamais des mots : « 3 h 40 » se
  verifie, « bientot » non.
- La section « Ecartees par les filtres » est retiree. L'apercu des reglages
  dit deja combien d'offres sont recuperables et combien restent a la main, et
  les cases par magasin rendent le choix explicite.
- Magasins : Epic, GOG, Luna et Steam en clair, avec leur etat. Les huit autres
  passent dans un volet replie, en cases a cocher. Le libelle dit ce qu'une
  case fait vraiment -- surveiller et notifier, jamais reclamer -- parce
  qu'aucun module de reclamation n'existe pour eux.
- Les reglages secondaires passent en `<details>` replies. Sept sections
  visibles d'un coup, c'etait un mur.
- Textes coupes partout : le conseil de bas de page, les sous-titres
  decoratifs, les infobulles bavardes.

**Nouvelles features**

- Recherche instantanee et tri (fin la plus proche, plus recentes, valeur,
  magasin).
- Epinglage d'une offre en tete de liste.
- « Tout recuperer » : une commande qui reclame tout ce qui peut l'etre, sous le
  plafond horaire -- c'est lui qui protege le compte, pas la modestie du cycle.
- Masquer les jeux deja possedes.
- Doublon inter-magasins signale sur la carte : « aussi sur GOG ».
- Notifications : mode (chaque offre / un resume par jour / jamais), heures
  calmes, seuil de rappel reglable, et trois modes de badge.
- Les heures calmes DIFFERENT l'annonce, elles ne la suppriment pas : `notifiedAt`
  n'est pas pose, donc le premier cycle apres la plage la reprend. Une offre qui
  se termine a 7 h ne se perd pas parce qu'on a demande le silence la nuit.
- Theme systeme / sombre / clair, densite confortable / compacte.
- Export CSV et fichier calendrier (.ics) en plus du JSON. Une echeance est un
  instant, pas une plage : l'evenement est de duree nulle.
- Annulation du retrait d'un code, douze secondes. Un code perdu est un jeu
  perdu.
- Jauge de stockage et purge des offres expirees.
- Synchronisation des REGLAGES entre navigateurs, sur demande. Jamais les codes
  ni l'historique : storage.sync passe par le compte Google, et un code
  d'echange est un jeton au porteur.
- Carte de premier lancement, raccourcis clavier (1 2 3, /, Entree, Echap).

**Internationalisation**

- `_locales/en` et `_locales/fr`, `default_locale: en`. Tout texte passe par
  `t('cle')` ; plus un seul litteral dans popup.js.
- Choix explicite de langue dans les reglages. chrome.i18n ne sait rendre que
  la langue du navigateur, d'ou les tables embarquees -- GENEREES depuis
  `_locales` a chaque build, pour qu'elles ne puissent pas diverger.
- Le build refuse une cle absente d'une des deux locales, et une cle citee par
  l'interface qui n'existe nulle part. Une cle manquante ne casse rien : elle
  s'affiche telle quelle, et « emptyGames » en plein milieu de la liste est un
  bug qu'aucun test unitaire ne verrait.

**Conventions anglaises**

- 570 identifiants renommes, `veille/` devient `watch/`, dix fichiers de test
  renommes. Applique par `build/rename.mjs`, table dans `build/rename-map.mjs`.
- Le renommage passe par un TOKENISEUR, pas par un sed. Un remplacement par
  expression reguliere touche trois choses qu'il ne doit pas toucher : les
  commentaires, qui deviendraient un charabia mi-francais mi-anglais ; les
  chaines, dont les cles de storage.local ; et l'interieur des regex.
- Quatre garde-fous, chacun paye par une erreur reelle du script : table
  injective ; aller-retour du tokeniseur identique au bit pres ; aucune cible
  deja presente comme identifiant libre dans le meme fichier ; syntaxe valide
  apres coup. Le second a rattrape une apostrophe dans un gabarit qui faisait
  prendre le reste du fichier pour une chaine.
- Les cles de storage.local et les noms de messages vers le MOTEUR ne changent
  pas. Une cle est une donnee ; et un content script deja injecte continue de
  parler l'ancien protocole apres une mise a jour.
- `build/verify-rename.mjs` remplace le temoin byte-identique par une garantie
  plus forte : `src/core == table(build/pre-rename/core)`, sans exception. Le
  moteur actuel est exactement l'ancien avec la table appliquee, donc aucun
  changement de comportement n'a pu se glisser dans le lot.

**Migration du stockage, schema 1 -> 2**

- Les champs persistes passent en anglais, avec migration. Sans elle, rien ne
  casse : le code relit un champ qui n'existe plus, trouve `undefined`, et
  applique son defaut. Le seuil de l'utilisateur revient a zero, son plancher a
  trois, son autonomie a la valeur d'usine -- sans une seule erreur en console.
- La table de champs est GENEREE en composant les trois passes de renommage. Le
  build refuse si elle n'est pas injective : deux champs qui visent le meme nom
  se recouvrent, et le second gagne selon l'ordre des cles.
- Correctif et numero de version dans le MEME `set()`. En deux appels, une mort
  du worker entre les deux laisserait des donnees migrees marquees version 1.
- `notifications: false`, la forme d'avant, est traduite en `notifyMode: 'off'`.
  Sans cela un utilisateur qui les avait coupees les verrait revenir.

**Correctifs**

- ERR_FILE_NOT_FOUND, revenu trois fois, ne peut plus revenir : le build refuse
  toute reference vers un fichier absent -- manifeste, imports statiques, `src`
  et `href` des pages. Le symptome etait toujours muet : Chrome charge
  l'extension sans broncher, puis le popup s'ouvre vide.
- L'attribut `hidden` etait ecrase par `display: flex` : la barre « Annuler »
  restait visible en permanence, pour une action que personne n'avait faite.
- L'anneau partait a 9 h et non a midi : un `from -90deg` ajoute par habitude du
  canvas, alors qu'un conic-gradient CSS demarre deja au sommet.
- Premiere version de l'anneau : la reserve mesuree sur un horizon fixe de deux
  semaines. Rendue a l'ecran, elle etait inutilisable -- une offre a 39 minutes
  et une a neuf heures tombaient toutes deux sur le plancher de 3 %, donc
  l'anneau disait la meme chose des deux cartes qui differaient le plus.
  Remplacee par la part de fenetre restante.
- `elements` renomme en `nodes` cassait la lecture de la reponse GraphQL d'Epic :
  c'est un champ de l'API, pas un nom a nous. Neuf tests l'ont dit.
- `statut` -> `statusLine` et `valeur` -> `worth` etaient faux hors du popup :
  deux passes correctives, `build/rename-pass2.mjs`.

**Tests**

- 337, dont 49 nouveaux : migration (19), politique de notification (21),
  commandes (9).
- La politique de notification passe toutes ses heures locales par un fuseau
  EXPLICITE. Sans lui la suite serait verte ici et rouge ailleurs, sans qu'une
  ligne de code ait change.

## 2.10.0 -- 2026-08-27

Les features de la V3 deviennent visibles et reglables.

**Ecrans**

- Filtres : interrupteur d'autonomie, seuil de valeur, inclusion des DLC, et un
  apercu vivant -- « sur 8 offres en cours : 4 recuperables sans vous, 4 a voir
  vous-meme ». Voir l'effet d'un reglage AVANT de bouger le curseur vaut mieux
  que de decouvrir apres coup ce qu'on a supprime.
- Ecartees par les filtres, avec leur motif. Sans cette vue, un filtre est une
  trappe.
- Bilan : nombre de jeux, valeur, ventilation par magasin.
- Bande de prediction : 24 h a venir par source, reperes toutes les six heures.
  Une bande terne est exacte mais ressemble a un bug : elle dit desormais
  « rien attendu d'ici demain », ou « pic vers 17 h ».
- Export et IMPORT. L'export sans import etait une porte a sens unique.
  L'import ne restaure que ce qui ne se reconstruit pas : les codes et les
  reglages.

**Correctifs**

- Le clic sur une notification ouvrait la page de diagnostic. Le service worker
  perd la memoire entre l'envoi et le clic, qui peut arriver des heures plus
  tard : le lien est desormais retenu AVANT l'affichage.
- Le badge comptait les offres « non vues » alors que rien ne les marquait
  jamais : il affichait toutes les offres actives, a vie.

**Feature**

- Rappel avant expiration : une offre qui se termine dans moins de six heures et
  qui n'a pas ete traitee declenche un second signal. La premiere notification a
  pu tomber pendant la nuit.

## 2.9.1 -- 2026-08-27

Vague V3 : la reclamation autonome, plus quatre features. Tout est desormais
BRANCHE : le service worker execute reellement la chaine decouverte -> filtres
-> reclamation -> verdict.

**Reclamation autonome**

- Le service worker ouvre un onglet en arriere-plan, le moteur reclame, un
  verdict remonte, l'onglet se ferme. Trois reclamations par cycle au plus,
  dix par heure, jamais deux onglets en parallele.
- Mode pilote dans le moteur : ouvert par l'orchestrateur, il ne demarre plus
  seul, il s'annonce et attend un ordre. Sans cela deux logiques se disputaient
  le meme bouton.
- Le verdict n'a demande aucune plomberie nouvelle : les modules ecrivaient
  deja une entree d'historique avec le bon vocabulaire. Le mode pilote la
  guette.
- Les offres de l'agregateur sont resolues par l'atterrissage de l'onglet, sa
  redirection repondant 403 hors navigateur. APRES resolution, l'URL est la
  seule verite : une offre intitulee "... (Epic Games) Giveaway" qui atterrit
  sur un site tiers est refusee, quel que soit son titre.
- Balayage des onglets abandonnes a chaque reveil du service worker.

**Garde-caisse**

Un clic qui ressemble a un paiement est refuse, une fois pour toutes, juste
avant robustClick. Elle ne s'applique PAS a Epic, GOG et Luna : leur parcours
gratuit passe legitimement par un panier et une commande a zero, et une garde
fondee sur ces mots aurait casse la reclamation en production. Elle ne bloque
que sur des preuves de paiement -- champ de montant, bouton Stripe ou PayPal,
panier appele par attribut.

**Filtres**

Seuil de valeur, exclusion du contenu additionnel, magasins autorises, liste
noire de titres. Aucun ecart n'est silencieux : chaque refus porte un motif. Les
valeurs par defaut ne suppriment rien, sauf le contenu additionnel -- la requete
loot de l'agregateur rend 82 DLC contre 20 jeux.

**Prediction apprenante**

Histogramme de 168 cases par source, demi-vie de 90 jours, creneaux chauds
injectes dans l'ordonnanceur a cote des fenetres qu'Epic annonce. Seules les
offres NOUVELLES nourrissent l'histogramme : une offre revue a chaque cycle
gonflerait la case de nos propres heures de sondage, ce qui est exactement le
biais que la conception combat.

**Bilan et export**

Nombre de jeux, valeur, ventilation par magasin et par mois. Le bilan compte
separement ce qu'il a pu valoriser. L'export met les codes en attente en
premier : ce sont les seules donnees irremplacables du lot.

**Steam : detection seule**

Steam est detecte, affiche, mis a un clic -- jamais clique. Son contrat
d'abonnement interdit explicitement les scripts pour interagir avec ses
services, avec resiliation sans preavis, et son quota d'activations compte
"deja possede" comme un echec.

La garantie est structurelle, pas declarative : store.steampowered.com figure
dans host_permissions pour la LECTURE, et pas du tout dans content_scripts. Rien
n'est injecte sur une page Steam, donc rien ne peut y cliquer.

Detection en deux temps, tous deux verifies par de vraies requetes : la
recherche des promotions a -100 % donne les candidats, l'API publique
IStoreBrowseService tranche. `is_free` ne discrimine RIEN -- il vaut true
aussi bien pour un free-to-play permanent ; seul `is_free_to_keep` fait foi.
Les possessions viennent de la session connectee, et valent null -- pas un
ensemble vide -- quand on ne sait pas.

**itch.io : hors perimetre**

Le formulaire qui porte le lien de reclamation gratuite porte AUSSI le champ de
prix et les boutons Stripe et PayPal. C'est le seul magasin ou un selecteur un
peu large demarre un paiement dans un onglet invisible. S'y ajoutent trois a
quatre navigations par reclamation, une URL signee qui expire en 200 secondes,
Cloudflare, et un seuil de limitation inconnu. Ecarte.

**Temoin de non-regression**

`npm run verify -- --freeze "motif"` fige une nouvelle reference quand une
modification volontaire du moteur fait diverger l'ancienne, au lieu de
desactiver le controle. La fiche build/reference.json garde le motif.

288 tests.


## 2.8.2 -- 2026-08-27

Indicateur de chargement dans le popup.

- Une barre en tete de popup, sous le bandeau d'etat, visible depuis n'importe
  quel onglet. Ce n'est pas un rouage qui tourne : c'est la meme meche que sur
  les cartes de jeu, mais qui court. L'indicateur parle la langue du reste.
- Elle s'affiche pendant une verification manuelle -- un cycle interroge le
  reseau et peut prendre plusieurs secondes, parfois le temps de reveiller le
  service worker. Le bouton passe a « Verification... » et le bandeau d'etat
  annonce « Verification en cours... ».
- Le popup attend maintenant la fin du cycle avant de se rafraichir, au lieu de
  rendre la main tout de suite avec des donnees inchangees.

**Revelation differee**

La barre n'apparait qu'au bout de 180 ms. Une lecture de stockage de 50 ms ne
merite pas un clignotement -- il n'informe pas, il agace. Une action que
l'utilisateur vient de declencher, elle, s'affiche immediatement : il attend
une reaction. Un compteur de travaux en cours evite qu'un traitement termine
eteigne l'indicateur d'un autre encore en cours.

Verifie a l'ecran : chargement rapide -> barre jamais montree ; chargement lent
-> barre montree ; fin du cycle -> compteur revenu a zero.

**Changement d'onglet**

Le contenu entre par un leger deplacement vers le haut, pour que le changement
ait une direction. La classe d'animation est retiree puis reposee avec un
recalcul force entre les deux, sans quoi elle ne rejouerait qu'une fois.

**Mouvement reduit**

Sous `prefers-reduced-motion`, l'indicateur reste visible mais cesse de courir :
une barre a moitie remplie dit « ca travaille » sans mouvement. L'animation
d'onglet est supprimee.


## 2.8.1 -- 2026-08-27

Refonte du popup autour de la question qu'on se pose reellement en l'ouvrant :
qu'est-ce qui est gratuit, et est-ce que je dois agir.

**Navigation**

- Trois onglets internes -- Jeux, Codes, Reglages -- au lieu d'une colonne de
  six sections qu'il fallait parcourir. Navigation au clavier par les fleches.
- Un bandeau d'etat permanent sous l'en-tete : derniere verification, prochaine,
  et l'erreur s'il y en a une. Visible depuis n'importe quel onglet.

**L'onglet Jeux**

- Ce qui est gratuit maintenant, avec la vignette du jeu, le magasin, et le
  temps restant. Un clic ouvre l'offre.
- `Bientot` : les prochaines ouvertures annoncees par Epic lui-meme, avec date
  et heure exactes. Dedupliquees par jeu -- l'API annonce plusieurs fenetres
  pour le meme titre.
- `Deja recupere` : l'historique, avec les vrais titres.

**La meche**

Chaque jeu porte une jauge de ce qui reste de sa fenetre, calculee sur les
bornes reelles de l'offre. Une offre dont la date de fin est inconnue -- 8 sur
20 chez l'agregateur -- est hachuree en ambre, pas grisee : l'ordonnanceur la
place en TETE de file, pas en queue, et l'oeil doit lire la meme urgence.

**Textes**

- `ALREADY_OWNED` s'affichait a la place du nom du jeu. Les motifs techniques
  du moteur sont traduits et rendus comme des statuts ; le titre vient du
  catalogue de la veille, ou du slug rendu lisible.
- Un identifiant opaque (`amzn1.pg.item...`) ne se maquille plus en titre : il
  devient `Offre Amazon Luna`.
- Le curseur du plancher annonce desormais sa vraie portee : `Tant que Chrome
  est ouvert. Une alarme ne reveille pas l'ordinateur.`
- Un seul bouton ambre par ecran. La veille garde l'accent ; ouvrir un magasin
  devient une action secondaire.

**Donnees**

- Le modele d'Offre porte une vignette, prise chez la source la plus fiable
  (`keyImages` cote Epic, `thumbnail` cote agregateur). Les images sont
  chargees en differe, sans referent, avec une tuile de repli si le CDN ne
  repond pas.
- Les fenetres annoncees sont stockees entieres (titre, vignette, dates) et
  plus reduites a des instants. L'ordonnanceur n'en lit toujours que l'instant.
- `popup.js` ne fait plus `storage.local.get(null)` : il enumere ses cles.
  Sans cela, chaque ouverture du popup deserialisait le catalogue entier et les
  statistiques horaires pour afficher trois interrupteurs.


## 2.8.0 -- 2026-08-27

Vague V2 : la veille de fond. L'extension detecte desormais les jeux gratuits
sans qu'aucun onglet de magasin soit ouvert. Elle s'arrete a la notification :
la reclamation autonome vient en V3.

**Nouveau : la veille**

- Service worker reveille par `chrome.alarms`, avec deux alarmes : une
  principale rearmee sur le prochain instant prevu, et une periodique de 30 min
  qui verifie que la principale existe encore.
- Ordonnanceur a trois regimes -- plancher reglable (1 a 24 verifications par
  jour, 3 par defaut), creneaux chauds autour des heures de drop, poursuite
  quand une offre attend. Plus deux freins : recul exponentiel apres echec, et
  plafond journalier derive du plancher.
- Deux sources : l'API officielle `freeGamesPromotions` d'Epic et l'API
  publique gamerpower.com, qui couvre a elle seule une vingtaine de boutiques.
- Catalogue avec rapprochement multi-sources : deux sources qui annoncent le
  meme jeu donnent une seule entree, quel que soit l'ordre de decouverte.
- Notifications, badge sur l'icone, et etat consultable (dernier cycle,
  prochain cycle, derniere erreur par source).

**Ce que la veille lit au lieu de le deviner**

L'API Epic publie `upcomingPromotionalOffers` : les dates exactes de ses
prochaines ouvertures. L'ordonnanceur les LIT et arme son reveil dessus. La
regle "Epic lache a 11:00 heure de New York" s'est revelee fausse en general --
la capture du 2026-08-27 contient des ouvertures a 15:00Z (11:00 EDT, la regle
attendue) mais aussi a 17:00Z et 01:00Z. Un calendrier ecrit a la main aurait
rate ces deux-la.

**Corrections de conception, trouvees avant la mise en service**

- Les horodatages de gamerpower sont en heure de New York, pas en UTC. Etabli
  en recoupant nos deux captures reelles : l'API Epic ouvre Cardpocalypse a
  2026-08-20T15:00:00Z, l'agregateur le publie a "2026-08-20 11:02:34" -- lu en
  UTC, cela placerait la publication quatre heures AVANT l'ouverture de
  l'offre. Le decalage allait dans le sens qui fait expirer les offres trop
  tot. `lireDate` refuse desormais une date naive sans fuseau explicite,
  plutot que de supposer.
- La fusion multi-sources figeait la premiere valeur vue. Une table de
  fiabilite par champ donne la priorite a l'API Epic sur les dates et les URL,
  et rend la fusion commutative.
- Le bail d'exclusion mutuelle se donnait un identifiant derive de l'instant :
  deux reveils simultanes ecrivaient le meme identifiant et passaient tous les
  deux. Le verrou ne verrouillait rien.
- Une reponse de source effondree (panne, page de challenge) faisait basculer
  en "disparue" toute offre sans date de fin. Une liste n'est traitee comme
  complete que si sa taille reste au-dessus de la moitie de la derniere connue.
- Le premier cycle n'envoie aucune notification : il remplit le catalogue et
  marque tout comme deja annonce. Sans cela, l'installation declenchait une
  vingtaine de notifications, dont des offres publiees il y a des annees.
- La notification repose sur un champ persiste (`notifieLe`), pas sur le
  resultat du cycle : une mort du service worker ne produit plus de doublon.
- Une coupure reseau ne compte pas comme un echec de source. Sinon une nuit
  sans wifi gelait la veille six heures, au moment ou l'utilisateur rouvre son
  portable.

**Structure**

- Nouveau dossier `veille/` en ES modules : `offre`, `catalogue`,
  `stockage`, `cycle`, `planning/horaires`, `planning/ordonnanceur`,
  `sources/`. Le moteur de reclamation, lui, reste en ES5 concatene.
- `background.js` devient un module ES. Les manifestes gagnent la permission
  `alarms` et `"type": "module"` ; sans elles le service worker ne chargeait
  pas du tout, ce qui aurait aussi casse le relais du moteur V1.
- Le build refuse un `import()` dynamique ou un import statique place apres du
  code dans `background.js` : dans un service worker, cela decale
  l'enregistrement des listeners et les evenements sont perdus en silence.
- Espaces de noms disjoints : la veille ecrit sous `veille:`, jamais sous
  `FGC_*`. Une version de schema garde la porte en cas de retour arriere.
- `test/faux-chrome.mjs` : un faux `chrome.*` fidele -- `storage` atomique
  par `set()` mais sujet aux ecritures perdues, alarmes a horloge injectee,
  alarme ponctuelle supprimee au declenchement.
- 186 tests, dont deux captures reelles d'API en fixtures.

**Horaires**

`planning/horaires.js` ancre les regles sur un fuseau nomme via
`Intl.DateTimeFormat`, sans arithmetique sur les heures. Il traite les deux
cas pathologiques du changement d'heure de facon deterministe : heure murale
inexistante -> premier instant apres le trou ; heure ambigue -> premiere
occurrence. Verifie sur les deux fenetres annuelles ou l'Europe et les
Etats-Unis sont desynchronises.


## 2.7.1 -- 2026-08-27

Aucun changement de comportement du moteur : le code genere est identique au
bit pres a celui de la v2.7.0 (`npm run verify`).

**Structure**

- Le moteur monolithique de 2750 lignes est decoupe en 34 modules dans
  `src/core/`, concatenes dans l'ordre de leur nom par `build/build.mjs`.
  `free-games-claimer.js`, `free-games-claimer.user.js` et `test.txt` sont
  desormais generes et ne s'editent plus a la main.
- `npm run verify` reconstruit `build/reference-v2.7.0.js` a partir des modules
  et compare les SHA256 : le controle de non-regression du decoupage.
- Le build refuse le non-ASCII, les backticks et les fins de ligne LF. Les
  trois contraintes qui ont casse le script en v2.1.0, v2.3.0, v2.5.0 et
  v2.7.0 sont automatisees.
- 32 tests unitaires sur la logique pure (`npm test`), sans dependance :
  slugs Epic, fenetres de promotion, routage des magasins Luna, codes
  d'echange, reponses GOG, delais de repos.
- La version n'est plus ecrite que dans `package.json`. Le build l'injecte
  dans les deux manifestes, le bandeau et l'en-tete userscript.

**Corrections**

- `gm-shim.js` prechargeait tout `chrome.storage.local` (`get(null)`) a chaque
  injection et dans chaque iframe. Il ne charge plus que les neuf cles du
  moteur, et saute le prechargement hors du cadre principal.
- Un interrupteur bascule dans le popup ne prenait effet qu'au rechargement de
  la page : le shim ecoute maintenant `storage.onChanged`.
- `manifest.json` listait deux fois `https://www.gog.com/*`.

**Diagnostic**

- Nouvelle page `diagnostics.html` (lien en pied du popup) qui mesure le
  bridage des minuteurs dans un onglet de fond et la capacite d'un document
  offscreen a analyser du HTML. Nouvelles permissions : `scripting`,
  `offscreen`, et l'hote de l'agregateur.


// ==/UserScript==

/*

FREE GAMES AUTO-CLAIMER -- v2.7.0

NOUVEAUTES v2.7.0 :
 - Modules GOG (giveaway) : les motifs etaient restes sans accents, donc
   "Recuperer", "Dans la bibliotheque", "deja possede" ne matchaient jamais
   l'interface francaise. Corrige (meme classe de bug que v2.5.0).
 - Module Steam retire : il n'avait aucun @match (code jamais execute) et
   Steam ne propose pas de jeux a reclamer au sens Epic/Luna.
 - La veille des modales de fin d'achat Epic ne tourne plus indefiniment :
   elle demarre a la reclamation et s'arrete d'elle-meme au bout de 3 min.
 - Le script sort immediatement des iframes tierces (seule l'iframe de
   paiement Epic est traitee) : plus d'executions paralleles inutiles.
 - Verification apres reclamation Epic : si le bouton "Obtenir" est encore
   visible 2,5 s apres, rien n'est enregistre comme "reclame" (le jeu sera
   retente) au lieu d'etre perdu pour la semaine.
 - Les codes a echanger memorisent leur date limite (affichee par Amazon) ;
   elle apparait dans les notifications et dans "Voir les codes en attente".
 - Amazon Luna : les offres de contenu en jeu (offer-list-IN_GAME_LOOT) sont
   traitees comme les jeux (CONFIG.lunaClaimDlc pour desactiver).
 - Menu "Voir l'historique de cette plateforme".

CORRECTIF v2.6.0 (relances systematiques) :
 - Le mode auto repartait a chaque retour sur l'onglet (visibilitychange),
   a chaque chargement de page et a chaque changement d'URL interne. Un
   delai de repos persistant (stockage Tampermonkey, partage entre onglets)
   encadre desormais les verifications automatiques :
     * 30 min apres une verification (CONFIG.autoCooldownMs),
     * 6 h quand il n'y a plus rien a reclamer (CONFIG.autoIdleCooldownMs),
     * 15 min apres un echec, pour ne pas marteler (autoFailureCooldownMs).
   Les actions manuelles (bouton Claim, commandes de menu) ignorent ce delai
   et le remettent a zero.
 - Le surveillant de navigation interne ne reagit plus qu'a un changement de
   CHEMIN : Epic et Amazon reecrivent en permanence la query (suivi, ?lang=),
   ce qui relancait un cycle complet toutes les 1,5 s.
 - Menu "Relancer maintenant (ignorer le delai)" et etat du delai visible
   dans la console au demarrage.

CORRECTIF v2.5.0 (etapes finales : "captcha" a tort, boutons non cliques) :
 - detectSecurityChallenge ne retenait que le src des iframes : Epic charge
   en permanence une iframe hCaptcha/Arkose INVISIBLE, donc chaque clic
   finissait en "Defi de securite detecte" alors qu'il suffisait de cliquer.
   Seuls un cadre de defi VISIBLE (> 50 px, non masque) ou un champ de code
   a usage unique VISIBLE comptent desormais comme defi.
 - Les libelles reels du store sont accentues : "Ajouter a la bibliotheque",
   "droit de retractation", "Le lanceur Epic Games est-il installe ?",
   "Recuperer" (modale Code promo GOG). Les motifs ASCII de v2.4.0 ne
   matchaient aucun de ces boutons : l'enchainement s'arretait juste avant
   la fin. Tous les motifs tolerent maintenant accents et apostrophe typo.
 - Modale GOG "Code promo" : le bouton "Recuperer" est reconnu comme
   confirmation finale, "Annuler" reste ignore.

NOUVEAUTES v2.4.0 (Amazon Luna automatique + echange des codes GOG) :
 - Le module Luna demarre tout seul au chargement d'une page
   luna.amazon.<tld>/claims/... (toggle "Auto Luna : ON/OFF" dans le widget et
   dans le menu Tampermonkey). Sans session Amazon : simple notification.
 - Les libelles francais accentues ("Recuperer le jeu", "Obtenir le jeu",
   "Recupere", "bibliotheque") sont reconnus ; les motifs sans accent de
   v2.2.0 ne trouvaient aucun bouton sur l'interface francaise.
 - Les attributs stables de la page (data-a-target : offer-list-FGWP_FULL,
   item-card, FGWPOffer, buy-box, buy-box_call-to-action,
   DescriptionItemDetails, LinkAccountButton, ClaimStateClaimCodeContent,
   sign-in-button) sont utilises en priorite, le texte en repli.
 - La plateforme de destination est deduite du suffixe du slug de l'offre
   (/claims/<slug>-<epic|gog|aga|legacy|...>/dp/amzn1.pg.item...) et du
   texte "X pour PC sur <magasin>." de la fiche :
     * Legacy Games : ignore (jamais reclame) ;
     * Epic / Amazon Games / comptes relies : reclamation directe ;
     * GOG : le code affiche par Amazon est copie dans le presse-papiers,
       mis en attente (stockage Tampermonkey), puis echange automatiquement
       sur gog.com/redeem (voir ci-dessous) ;
     * Microsoft Store / Xbox : code copie dans le presse-papiers +
       notification (clic = ouverture de account.microsoft.com/billing/
       redeem) : a coller manuellement.
 - Parcours par offre : la page liste construit une file (sessionStorage)
   et le script visite chaque fiche l'une apres l'autre (une offre par
   chargement de page), clique "Obtenir le jeu", gere l'etape "Complete
   Claim", detecte "Associer un compte" (offre passee + notification), puis
   revient a la liste avec un resume. Reconnexion Amazon demandee : arret,
   la file reprend au prochain chargement de /claims apres connexion.
 - Nouveau module GOG "redeem" : sur gog.com/redeem, chaque code en attente
   est saisi dans #codeInput, "Continuer" puis "Utiliser le code" sont
   cliques, le resultat est lu (ajoute a la bibliotheque / code deja
   utilise / code invalide). Le reCAPTCHA invisible de la page ne bloque
   pas ; un captcha VISIBLE arrete le script (validation manuelle, puis
   reprise). A la fin de la serie Luna, gog.com/redeem s'ouvre dans un
   nouvel onglet si des codes GOG sont en attente.
 - Nouveaux @grant : GM_setClipboard (copie des codes), GM_openInTab
   (ouverture de la page d'echange). Menu : voir les codes en attente,
   oublier tous les codes en attente (irreversible), echanger les codes GOG
   maintenant, vider la file Luna en cours, basculer le mode auto Luna.
 - Revue : lot Luna remis a zero en fin de serie et fiche visitee hors
   serie traitee sans toucher a la file ; "Associer un compte" n'est
   retenu que s'il apparait APRES le clic (la fiche l'affiche deja avant) ;
   pour GOG/Microsoft un succes attend 6 s l'affichage du code ; textes
   compares noeud par noeud (textContent concatene sans espace) ; sur
   gog.com/redeem la route interne /redeem/<code> ne relance pas le module,
   "Code non trouve." est reconnu, un code refuse n'est pas reessaye et un
   captcha ne compte pas comme essai.

CORRECTIF v2.3.0 (erreur 404 Epic en mode automatique) :
 - L'API freeGamesPromotions renvoie parfois un productSlug herite du type
   "cardpocalypse/home". Le script construisait alors
   store.epicgames.com/p/cardpocalypse/home, qu'Epic redirige vers
   www.epicgames.com/site/p/... -> 404. Le slug est desormais resolu en
   priorite depuis offerMappings / catalogNs.mappings, puis productSlug
   nettoye (suffixe "/home" retire), et urlSlug en dernier recours ; les
   hash d'offre (32 hex, ex. jeux mystere) sont ignores car ils menent a
   la page /not-found.
 - Epic a supprime le prefixe de langue dans le chemin (/fr/free-games
   repond 301 vers /free-games?lang=fr). Toutes les URL sont construites
   sur ce nouveau schema (CONFIG.epicStoreOrigin + ?lang=CONFIG.epicLang).
 - Les bundles sont ouverts via /bundles/<slug>, les jeux/add-ons via
   /p/<slug>. extractEpicSlug reconnait les deux formes et tolere
   ?lang=xx, l'ancien prefixe /fr/ et le suffixe /home.
 - Seules les promos actives maintenant (fenetre de dates + prix remise a
   0) sont retenues : les jeux "Bientot disponible" ne sont plus comptes
   comme reclamables.
 - Sur /free-games le script attend le rendu des cartes (page rendue cote
   client) avant de conclure qu'une carte est absente et de rediriger.
 - Atterrissage sur store.epicgames.com/not-found apres une redirection du
   script : le slug fautif est marque "bad_url" (7 jours), plus aucune
   redirection vers lui, retour automatique sur /free-games.
 - Sur une fiche produit d'un jeu gratuit non reclame, le mode auto lance
   la reclamation sur place au lieu de renvoyer vers /free-games (evite le
   ping-pong entre les deux pages).
 - Repli DOM realigne sur le libelle actuel des cartes ("Gratuit jusqu'au
   ..." / "Free until ...") en excluant "Bientot disponible" et les
   free-to-play "Jeu de base".
 - Motifs de boutons tolerants aux accents ("Recuperer", "Dans la
   bibliotheque") via des echappements \u00e9 / \u00e8.
 - La commande de menu "Effacer l'historique" utilisait la cle
   FGC_history_<hostname> alors que l'historique est stocke sous
   FGC_history_<nom de plateforme> : elle n'effacait rien. Corrige.
 - Garde anti-reentrance du module Epic (120 s) : le watcher SPA relancait
   le module pendant une reclamation en cours (double clic sur "Obtenir").
 - Marqueur de reprise FGC_epic_pending_slug horodate (5 min), efface des
   que la reclamation se termine dans le meme document, et jamais utilise
   pour degrader une entree deja "claimed" : arrivee sur la fiche visee ->
   reclamation sur place ; arrivee sur /not-found -> slug bloque.
 - Le rejet interne 'STOP' (arret volontaire deja journalise) n'est plus
   affiche comme "Erreur : undefined" dans le widget.

CORRECTIF v2.2.0 : les @match Amazon Luna sont desormais restreints au
chemin /claims/* (ex. luna.amazon.fr/claims/home) au lieu de tout le
domaine. Le script (et donc le widget flottant) ne se charge plus du tout
sur les pages de jeu / bibliotheque / accueil Luna, uniquement sur les
pages de reclamation des jeux gratuits.

CORRECTIF v2.1.0 : plus aucun template literal (backtick) dans tout le
fichier. Toutes les chaines interpolees ont ete reecrites en concatenation
classique ('a' + b + 'c'), pour eliminer definitivement l'erreur de
parsing affichee par le linter integre de certaines versions de
Tampermonkey, qui ne reconnait pas la syntaxe ES6 des template literals.

/
