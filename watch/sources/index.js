/* Le registre des sources de decouverte.
 *
 * Chaque source expose la meme forme : un nom, une fonction decouvrir(), et
 * les contraintes qu'elle impose a l'ordonnanceur. Ajouter une source, c'est
 * ajouter une entree ici -- rien d'autre dans la veille ne les connait
 * nommement.
 */
import * as epic from './epic.js';
import * as epicMobile from './epic-mobile.js';
import * as gamerpower from './gamerpower.js';
import * as gog from './gog.js';
import * as steam from './steam.js';
import { STORES } from '../offer.js';

/**
 * Magasins pour lesquels un module de RECLAMATION existe, et dans lesquels
 * l'extension a donc le droit de cliquer toute seule -- sans rien demander.
 *
 * Steam n'y figure pas : son contrat d'abonnement interdit les scripts pour
 * interagir avec ses services (section 4.C), avec fermeture du compte sans
 * preavis (4.D). Par defaut il est detecte, affiche, mis a un clic -- jamais
 * clique. Seule l'option `steamAutoClaim`, coupee par defaut et confirmee dans
 * le popup, l'ajoute a la liste : voir `claimableStoresFor`.
 *
 * itch.io n'y figure pas non plus, et n'est meme pas une source : le formulaire
 * qui porte le lien de reclamation gratuite porte AUSSI le champ de prix et les
 * boutons Stripe et PayPal. C'est le seul magasin ou un selecteur un peu large
 * demarre un paiement dans un onglet invisible. Ecarte du perimetre.
 */
export const CLAIMABLE_STORES = Object.freeze([
  STORES.EPIC,
  STORES.GOG,
  STORES.AMAZON,
]);

/** Magasins detectes et affiches, mais jamais reclames sans option explicite.
    Les jeux mobiles d'Epic, eux, ne se reclament jamais : ils se recuperent
    dans l'application du telephone (2.57.0). */
export const DETECT_ONLY_STORES = Object.freeze([STORES.STEAM, STORES.EPIC_MOBILE]);

/**
 * Les magasins reclamables pour CES reglages.
 *
 * Calcule a la lecture, jamais ecrit : un reglage recopie dans un autre finit
 * par diverger. Steam n'entre que sur `steamAutoClaim === true` -- une valeur
 * absente, abimee ou « truthy » ne suffit pas.
 */
export function claimableStoresFor(settings, base = CLAIMABLE_STORES) {
  return settings && settings.steamAutoClaim === true
    ? [...new Set([...base, STORES.STEAM])]
    : [...base];
}

/**
 * Les sources a interroger pour CES reglages.
 *
 * La source Steam n'est pas active par defaut. Or c'est elle, et elle seule,
 * qui donne le numero de PAQUET sans lequel aucune recuperation Steam n'est
 * possible : l'option l'active donc avec elle, a la lecture.
 */
export function activeSourcesFor(settings) {
  const active = (settings && Array.isArray(settings.activeSources)) ? settings.activeSources : [];
  const out = new Set(active);
  if (settings && settings.steamAutoClaim === true) out.add(steam.NAME);
  /* Les jeux mobiles d'Epic (2.57.0) : la source tourne si, et seulement si,
     le magasin est suivi. Sa reponse pese pres de 500 Ko : la payer pour un
     magasin que personne ne regarde serait du trafic pour rien. */
  const suivis = settings && Array.isArray(settings.watchedStores) ? settings.watchedStores : [];
  if (suivis.includes(STORES.EPIC_MOBILE)) out.add(epicMobile.NAME);
  else out.delete(epicMobile.NAME);
  return [...out];
}

export const SOURCES = Object.freeze({
  [epic.NAME]: Object.freeze({
    name: epic.NAME,
    libelle: 'API Epic Games',
    discover: epic.discover,
    /**
     * L'API rend la totalite des promotions en cours : une offre absente de la
     * reponse a reellement disparu.
     */
    completeList: true,
    /**
     * Cette source fait AUTORITE sur son magasin.
     *
     * Ce que ce champ change : une entree qui dit `store: 'epic'` et que cette
     * liste ne contient plus est une promotion terminee, meme si c'est
     * l'agregateur qui l'avait decouverte. Sans lui, le balayage ne regardait
     * que le champ `source` de l'entree -- or `merge` le fige a la premiere
     * source, donc un jeu Epic decouvert par l'agregateur gardait
     * `source: 'gamerpower'` pour toujours et echappait au balayage d'Epic.
     * C'est ce qui laissait a l'ecran, le vendredi, les jeux de la veille.
     */
    authoritativeFor: STORES.EPIC,
    /**
     * Le fuseau ou l'heure de publication d'Epic veut dire quelque chose :
     * 11:00 a New York, tous les jeudis. C'est la meme mesure que la regle de
     * rotation (`watch/schedule/rules.js`), et la couche apprenante y range
     * desormais ses cases -- sans quoi elles glissent d'une heure deux fois
     * par an, et la fenetre chaude de 30 minutes les rate entierement.
     */
    zone: 'America/New_York',
    /** Rien ne met cette API en cache : on peut la lire a l'instant du drop. */
    minIntervalMs: 60 * 1000,
  }),

  [gamerpower.NAME]: Object.freeze({
    name: gamerpower.NAME,
    libelle: 'GamerPower',
    discover: gamerpower.discover,
    completeList: true,
    /**
     * Mesure : l'agregateur date ses offres en heure de New York, sans fuseau
     * dans la chaine (`DATE_ZONE` dans watch/sources/gamerpower.js). C'est donc
     * la aussi que ses heures de publication veulent dire quelque chose.
     */
    zone: gamerpower.DATE_ZONE,
    /**
     * Le CDN sert la reponse avec Cache-Control: max-age=600. Interroger plus
     * souvent relit le meme cache : cout reel, gain nul, et impossible a
     * distinguer d'un vrai fonctionnement en observant le trafic.
     */
    minIntervalMs: 10 * 60 * 1000,
  }),

  [gog.NAME]: Object.freeze({
    name: gog.NAME,
    libelle: 'GOG',
    discover: gog.discover,
    /**
     * FAUX en tant que promesse STATIQUE, et ce n'est plus la question.
     *
     * Cette valeur ne sert plus que de repli : `discover` publie desormais un
     * `complete` PAR REPONSE, vrai seulement quand GOG annonce lui-meme une
     * page unique (`page === 1 && totalPages <= 1`). Une promesse statique ne
     * pouvait etre que fausse -- le catalogue est pagine et cette source ne
     * lit que la premiere page -- mais le fait, lui, se mesure a chaque
     * reponse. Le laisser a `false` garde la prudence si un jour la reponse
     * cesse de porter ces champs.
     */
    completeList: false,
    /**
     * Le magasin sur lequel cette source fait autorite -- et ce pouvoir
     * n'agit QUE lorsque la reponse s'est declaree complete. Sans lui, une
     * offre GOG sans date de fin n'avait aucun moyen de mourir : ni par
     * expiration (pas de date), ni par disparition (aucune autorite).
     */
    authoritativeFor: STORES.GOG,
    /** Une requete JSON de quelques kilo-octets sur un site marchand : on reste poli. */
    minIntervalMs: 15 * 60 * 1000,
  }),

  [epicMobile.NAME]: Object.freeze({
    name: epicMobile.NAME,
    libelle: 'Epic Games (mobile)',
    discover: epicMobile.discover,
    /**
     * La rubrique des jeux offerts rend la liste entiere : une offre qui en
     * disparait est terminee. La reponse le dit elle-meme (`complete`) : faux
     * si l'une des deux plateformes n'a pas pu etre lue.
     */
    completeList: true,
    authoritativeFor: STORES.EPIC_MOBILE,
    /** Epic publie ses jeux mobiles au meme rythme que les autres. */
    zone: 'America/New_York',
    /** Pres de 800 Ko pour les deux plateformes : pas plus d'une fois toutes les trois heures. */
    minIntervalMs: 3 * 60 * 60 * 1000,
    /** Jamais interrogee pour un magasin qu'on ne suit pas, meme par « Verifier maintenant ». */
    onlyWhenActive: true,
    autoClaim: false,
  }),

  [steam.NAME]: Object.freeze({
    name: steam.NAME,
    libelle: 'Steam',
    discover: steam.discover,
    /**
     * La recherche rend la totalite des promotions a -100 % : une offre absente
     * a reellement disparu. Mais elles sont rares -- une seule au 2026-08-27 --
     * donc une liste vide est un resultat normal, pas un effondrement.
     */
    completeList: true,
    /** Liste complete et propre a un seul magasin : elle fait autorite dessus. */
    authoritativeFor: STORES.STEAM,
    /** Deux requetes par cycle, sur des endpoints publics : on reste poli. */
    minIntervalMs: 30 * 60 * 1000,
    /** Detection seule par defaut : voir CLAIMABLE_STORES et claimableStoresFor. */
    autoClaim: false,
  }),
});

export const NAMES = Object.freeze(Object.keys(SOURCES));

export { epic, epicMobile, gamerpower, steam };
