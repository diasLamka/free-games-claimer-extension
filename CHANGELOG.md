# Historique du moteur

Extrait du bandeau de commentaires de la v2.7.0, sorti du code le 2026-08-27
lors du decoupage en modules. Le fichier `free-games-claimer.js` est desormais
genere : voir `build/build.mjs`.

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
