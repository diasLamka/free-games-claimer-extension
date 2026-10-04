package io.github.diaslamka.freegames.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/** Les magasins, avec les memes identifiants que l'extension (watch/offer.js). */
object Stores {
    const val EPIC = "epic"
    const val EPIC_MOBILE = "epic-mobile"
    const val GOG = "gog"
    const val STEAM = "steam"
    const val AMAZON = "amazon"
    const val MICROSOFT = "microsoft"
    const val UBISOFT = "ubisoft"
    const val EA = "ea"
    const val BLIZZARD = "blizzard"
    const val ITCHIO = "itchio"
    const val INDIEGALA = "indiegala"
    const val FANATICAL = "fanatical"
    const val HUMBLE = "humble"
    const val LEGACY = "legacy"
    const val UNKNOWN = "unknown"

    val LABELS = mapOf(
        EPIC to "Epic Games Store",
        EPIC_MOBILE to "Epic Games (mobile)",
        GOG to "GOG.com",
        STEAM to "Steam",
        AMAZON to "Amazon Games",
        MICROSOFT to "Microsoft Store",
        UBISOFT to "Ubisoft Connect",
        EA to "EA app",
        BLIZZARD to "Battle.net",
        ITCHIO to "itch.io",
        INDIEGALA to "IndieGala",
        FANATICAL to "Fanatical",
        HUMBLE to "Humble Bundle",
        LEGACY to "Legacy Games",
    )

    /** Les magasins dont le moteur de l'extension sait recuperer les jeux. */
    val ENGINE = setOf(EPIC, GOG, AMAZON)

    fun label(store: String?): String = LABELS[store] ?: "?"
}

/** Une offre gratuite, telle que la veille la connait. */
@Serializable
data class Offer(
    val key: String,
    val source: String,
    val store: String,
    val storeId: String? = null,
    val sourceId: String? = null,
    val title: String,
    val url: String? = null,
    val resolveUrl: String? = null,
    val image: String? = null,
    val start: Long? = null,
    val end: Long? = null,
    val worth: String? = null,
    val category: String? = null,
    val keepable: Boolean? = null,
    val packageId: String? = null,
    val parentAppid: String? = null,
    val platforms: String? = null,
    /** L'editeur, quand la source le nomme (Epic, 1.7.0) : voir data/Odds.kt. */
    val publisher: String? = null,
    val firstSeen: Long = 0,
    val lastSeen: Long = 0,
) {
    // Calcules une fois par objet (l'etat est immuable : un changement cree un nouvel objet), pas a chaque acces --
    // la normalisation (NFD et quatre regex) tournait pour chaque offre, a chaque recomposition. Hors de la sauvegarde.
    val normalisedTitle: String by lazy(LazyThreadSafetyMode.PUBLICATION) { Titles.normalise(title) }
    val shownTitle: String by lazy(LazyThreadSafetyMode.PUBLICATION) { Titles.display(title) }

    /** Du contenu additionnel plutot qu'un jeu (watch/filters.js, isExtraContent). */
    val isExtra: Boolean
        get() {
            val c = category.orEmpty()
            if (c.equals("game", ignoreCase = true)) return false
            if (c.isNotEmpty()) return true
            return EXTRA_WORDS.containsMatchIn(title)
        }

    fun isExpired(now: Long): Boolean = end != null && end <= now
    fun isOpen(now: Long): Boolean = !isExpired(now) && (start == null || start <= now)

    companion object {
        private val EXTRA_WORDS = Regex("\\b(dlc|loot|butin|skin|pack|bundle|cosmetic|currency|booster|in-?game)\\b", RegexOption.IGNORE_CASE)

        fun keyFor(store: String, storeId: String?, title: String): String =
            if (!storeId.isNullOrBlank()) "$store:$storeId" else "$store:titre:${Titles.normalise(title)}"
    }
}

/** Une ouverture annoncee par Epic (« Bientot gratuit »). */
@Serializable
data class Upcoming(
    val title: String,
    val image: String? = null,
    val url: String? = null,
    val start: Long,
    val end: Long? = null,
)

/** Un jeu recupere : le registre, comme `veille:bibliotheque` dans l'extension. */
@Serializable
data class LibraryEntry(
    val store: String,
    val id: String,
    val title: String? = null,
    val url: String? = null,
    val worth: String? = null,
    val image: String? = null,
    val ts: Long? = null,
    val status: String = "claimed",
    val via: String = "app",
    /** D'ou vient la valeur (1.22.0) : « store » (le magasin) ou « aggregator » (un site tiers). Figee a la reclamation. */
    val wsrc: String? = null,
) {
    /** Le titre normalise, une fois : Rules le compare a celui de chaque offre. */
    val normalisedTitle: String by lazy(LazyThreadSafetyMode.PUBLICATION) { Titles.normalise(title) }
}

/** Un souhait importe d'une liste Steam ou GOG. */
@Serializable
data class ImportedWish(val title: String, val store: String, val id: String? = null)

/**
 * Un passage de la veille (1.27.0) : quand, combien de temps, pour quelle raison (« fond », « ecran », « test »), comment
 * il a fini, ce qu'il a trouve. Une passe de fond ne laissait aucune trace : impossible de dire apres coup si elle avait tourne.
 */
@Serializable
data class PassRecord(
    val at: Long,
    val ms: Long,
    val reason: String,
    val outcome: String,
    val offers: Int = 0,
    val fresh: Int = 0,
    /** Les jeux obtenus par la recuperation de fond de ce passage, quand elle a eu lieu. */
    val claimed: Int? = null,
    /** L'ecran etait eteint pendant ce passage : c'est le cas qu'on n'avait jamais vu sur un telephone. */
    val screenOff: Boolean = false,
    /** Trois au plus, de 160 caracteres au plus. */
    val errors: List<String> = emptyList(),
)

/** Ce que la derniere lecture du compte d'un magasin a donne (1.26.0) : a quelle heure, et si la reponse etait lisible. */
@Serializable
data class OracleNote(val at: Long, val readable: Boolean)

/** Les essais de recuperation d'une offre. */
@Serializable
data class Attempt(
    val count: Int = 0,
    val lastAt: Long = 0,
    val verdict: String? = null,
    val details: String? = null,
    val nextAt: Long? = null,
    /** Combien de fois on a demande « montre-moi le bouton » pour cette offre (1.24.0) : une seule. */
    val asks: Int = 0,
    /** Quand on a lu « rien a prendre » pour la premiere fois (1.24.0) : deux constats espaces closent l'offre. */
    val goneAt: Long? = null,
)

/**
 * Ce que la fiche Steam dit d'un titre, en dollars (1.22.0) : de quoi juger
 * « piege ou bonne affaire ? » -- voir data/Bargain.kt. `none` : Steam repond
 * mais ne vend pas ce titre.
 */
@Serializable
data class PriceCheck(
    val at: Long,
    val none: Boolean = false,
    val type: String? = null,
    val isFree: Boolean = false,
    val price: Double? = null,
    val currency: String? = null,
    val fullgame: String? = null,
    val fullgameName: String? = null,
)

/** La note Steam d'un titre. */
@Serializable
data class Rating(
    val at: Long,
    val percent: Int? = null,
    val total: Int? = null,
    val score: Int? = null,
    val appid: String? = null,
)

/** Ce que la derniere lecture d'une source a donne. */
@Serializable
data class SourceStatus(val at: Long, val ok: Boolean, val count: Int = 0, val error: String? = null)

/** Ce qu'on sait de la session d'un magasin. */
@Serializable
data class AccountState(
    val status: String = "unknown",
    val checkedAt: Long = 0,
    val name: String? = null,
    /** D'ou vient le verdict : `page` quand une vraie page de magasin l'a montre (1.17.0), rien quand ce sont les cookies. */
    val via: String? = null,
)

@Serializable
data class Settings(
    val country: String = "FR",
    val checkHours: Int = 3,
    val notifyNew: Boolean = true,
    val notifyEnding: Boolean = true,
    val claimOnOpen: Boolean = true,
    val claimEpic: Boolean = true,
    val claimGog: Boolean = true,
    val claimAmazon: Boolean = true,
    val claimSteam: Boolean = false,
    /** Recuperer aussi ecran eteint, sans ouvrir l'appli (1.2.0). Coupe par defaut. */
    val claimInBackground: Boolean = false,
    /**
     * L'alarme de derniere chance (1.5.0) : un jeu souhaite finit dans moins de
     * trois heures sans etre a nous, le telephone sonne comme un reveil.
     * Coupee par defaut.
     */
    val lastChance: Boolean = false,
    val showMobile: Boolean = true,
    val showOthers: Boolean = true,
    val steamRatings: Boolean = true,
    /** « Ce soir je joue a... » (1.8.0) : les fiches Steam des jeux de la pile, lues sans cookie. */
    val tonight: Boolean = true,
    /**
     * « Resume du jour » (1.13.0) : l'heure (0 a 23) a laquelle arrive UNE
     * notification qui rassemble les nouveaux jeux du jour, ou -1 pour les
     * recevoir au fil de l'eau. Les souhaits et les deuxiemes chances, eux,
     * passent tout de suite.
     */
    val digestHour: Int = -1,
    /** « Tes gouts » (1.14.0) : les etiquettes Steam des jeux que tu aimes et des offres en cours, lues sans cookie. */
    val taste: Boolean = true,
    /**
     * « Silence intelligent » (1.15.0) : ce qui ne ressemble pas a tes gouts
     * attend le resume au lieu de sonner ; tes souhaits, les deuxiemes chances et
     * ce qui te ressemble sonnent tout de suite. Coupe par defaut.
     */
    val tasteQuiet: Boolean = false,
    /** Prevenir (une fois par version) quand une mise a jour de l'appli existe (1.20.0). */
    val notifyUpdate: Boolean = true,
    /**
     * Mise a jour automatique (1.25.0) : la veille de fond telecharge la version plus recente, la verifie
     * (taille, SHA-256, signature) et la passe au systeme. Android demande, UNE fois, d'autoriser l'appli a
     * installer des applis ; tant que c'est fait, rien d'autre. Sans cette autorisation : la notification
     * et le bandeau de l'accueil, comme avant.
     */
    val autoUpdate: Boolean = true,
    /** Prevenir quand la veille ne tourne plus (1.27.0) : une alarme que chaque passage repousse. */
    val watchdog: Boolean = true,
    /** Comment les jeux sont poses sur l'accueil (1.25.0) : « cards » (grandes), « list » (liste), « grid » (grille). */
    val tiles: String = Tiles.CARDS,
    val onboarded: Boolean = false,
)

/** Les trois facons de poser les jeux sur l'accueil (1.25.0). */
object Tiles {
    const val CARDS = "cards"
    const val LIST = "list"
    const val GRID = "grid"
    val ALL = listOf(CARDS, LIST, GRID)

    /** Une valeur lue d'une sauvegarde ou d'un reglage ancien : toujours l'une des trois. */
    fun of(raw: String?): String = if (raw in ALL) raw!! else CARDS
}

/**
 * Ce que le relais sait, SANS le secret (1.2.0). Le secret vit a part, chiffre
 * par le Keystore (data/RelaySecret.kt) : cet etat-ci peut etre lu, ecrit,
 * affiche sans rien exposer.
 */
@Serializable
data class RelayState(
    val dev: String,
    val pairedAt: Long,
    val since: String? = null,
    val lastSync: Long? = null,
    val lastAlive: Long? = null,
    val lastError: String? = null,
    /** L'autre appareil : son role (« pc »), quand on l'a entendu, ses sessions. */
    val peerRole: String? = null,
    val peerAt: Long? = null,
    /** « magasin|titre normalise » -> fin du verrou pose par l'autre. */
    val locks: Map<String, Long> = emptyMap(),
    /** Les demandes d'aide de l'autre appareil (1.4.0), par « magasin|titre normalise ». */
    val help: Map<String, HelpRequest> = emptyMap(),
)

/**
 * Une demande d'aide de l'autre appareil (1.4.0) : une verification humaine
 * l'arrete sur ce jeu. L'humain le finit ici, avec la session du telephone.
 */
@Serializable
data class HelpRequest(
    val store: String,
    val id: String,
    val title: String,
    val url: String? = null,
    val until: Long,
    val at: Long,
    val notified: Boolean = false,
)

/** Tout l'etat de l'appli, dans un seul fichier. */
@Serializable
data class AppState(
    val offers: Map<String, Offer> = emptyMap(),
    val upcoming: List<Upcoming> = emptyList(),
    val library: Map<String, LibraryEntry> = emptyMap(),
    val wishlist: List<String> = emptyList(),
    val importedWishes: List<ImportedWish> = emptyList(),
    val announced: Map<String, Long> = emptyMap(),
    val reminded: Map<String, Long> = emptyMap(),
    val attempts: Map<String, Attempt> = emptyMap(),
    /**
     * « Deja a toi » (1.24.0) : les jeux dont le compte du magasin, ou toi sur le panneau, a dit qu'ils
     * sont a toi -- « magasin|titre normalise » -> quand. Comme veille:deja de l'extension : pas dans
     * le registre, donc ni dans le bilan ni dans l'annee.
     */
    val deja: Map<String, Long> = emptyMap(),
    /** Le controle du compte, par magasin (1.26.0) : la derniere lecture s'est-elle faite ? La page « Sante » le dit. */
    val oracle: Map<String, OracleNote> = emptyMap(),
    val ratings: Map<String, Rating> = emptyMap(),
    /** « Piege ou bonne affaire ? » (1.22.0) : la fiche de prix Steam, par « app:<id> ». */
    val checks: Map<String, PriceCheck> = emptyMap(),
    val sources: Map<String, SourceStatus> = emptyMap(),
    val steamOwned: List<String> = emptyList(),
    val lastCheck: Long? = null,
    val settings: Settings = Settings(),
    val engine: Map<String, JsonElement> = emptyMap(),
    val accounts: Map<String, AccountState> = emptyMap(),
    val importedAt: Long? = null,
    val relay: RelayState? = null,
    /** Les offres pour lesquelles l'alarme de derniere chance a sonne (1.5.0). */
    val alarmed: Map<String, Long> = emptyMap(),
    /** « Plus tard » (1.12.0) : offre -> heure du rappel. L'etat, pas l'alarme : Android efface les alarmes au redemarrage. */
    val snoozed: Map<String, Long> = emptyMap(),
    /** « Resume du jour » (1.13.0) : offre -> quand on l'a mise de cote pour le resume. */
    val digestHeld: Map<String, Long> = emptyMap(),
    /** « Tes gouts » (1.14.0). */
    val taste: TasteState = TasteState(),
    /** « Attends, il sera offert » (1.7.0) : les passages vus, par titre normalise. */
    val passes: Map<String, List<Seen>> = emptyMap(),
    /** Les editeurs qui offrent, par nom normalise. */
    val givers: Map<String, Giver> = emptyMap(),
    /** La fiche Steam de chaque souhait, par « app:<id> » ou « t:<titre> ». */
    val odds: Map<String, OddsInfo> = emptyMap(),
    /** « Ta soiree choisit le jeu » (1.23.0) : le temps de jeu typique, par appid. */
    val medians: Map<String, PlayMedian> = emptyMap(),
    val evening: EveningState? = null,
    val oddsAt: Long? = null,
    /**
     * « Ce soir je joue a... » (1.8.0). Ce que l'on possede, d'apres Ma
     * collection de l'extension (sa sauvegarde l'apporte), par « magasin:id ».
     */
    val owned: Map<String, OwnedGame> = emptyMap(),
    /** L'etat de chaque jeu (a essayer, en cours, fini...), le meme que dans Ma collection. */
    val marks: Map<String, Mark> = emptyMap(),
    /** La fiche Steam des jeux de la pile, par appid ; l'appid trouve pour les titres hors Steam. */
    val tonightApps: Map<String, TonightInfo> = emptyMap(),
    val tonightTitles: Map<String, TitleMatch> = emptyMap(),
    val tonightAt: Long? = null,
    /** Le choix du soir, et ses reglages. */
    val tonight: TonightPick = TonightPick(),
    /**
     * Toute la famille (1.9.0) : d'autres comptes, recuperes par ce meme
     * telephone. Le compte principal reste dans les champs ci-dessus.
     */
    val family: List<Member> = emptyList(),
    /** Le journal de la veille (1.27.0) : les trente derniers passages, le plus recent d'abord. */
    val watchLog: List<PassRecord> = emptyList(),
    /** Quand la sentinelle a prevenu pour la derniere fois (1.27.0) : une fois par jour au plus. */
    val watchdogAt: Long? = null,
) {
    /** Les titres souhaites (a la main ou importes), normalises une fois : Rules.wished s'y reporte pour chaque offre. */
    val wishedTitles: Set<String> by lazy(LazyThreadSafetyMode.PUBLICATION) {
        (wishlist + importedWishes.map { it.title }).map { Titles.normalise(it) }.toSet()
    }
}

/**
 * Un membre de la famille (1.9.0). Ses sessions vivent dans un profil
 * WebView a lui (« famille-<id> ») : ses cookies ne croisent jamais ceux du
 * compte principal. Ici, seulement ce qu'il faut pour recuperer a sa place :
 * ses comptes, ses jeux, ses essais, la memoire du moteur.
 */
@Serializable
data class Member(
    val id: String,
    val name: String,
    val createdAt: Long = 0,
    val accounts: Map<String, AccountState> = emptyMap(),
    val library: Map<String, LibraryEntry> = emptyMap(),
    val attempts: Map<String, Attempt> = emptyMap(),
    val engine: Map<String, JsonElement> = emptyMap(),
)

/** Un jeu de Ma collection (1.8.0). */
@Serializable
data class OwnedGame(val store: String, val id: String, val title: String, val deck: String? = null)

/** L'etat d'un jeu, comme watch/annotations.js : toTry, playing, done, dropped, notForMe. */
@Serializable
data class Mark(val status: String, val note: String = "")

/** Ce que GetItems dit d'un jeu : son format, sa note, son Steam Deck, sa vignette. */
@Serializable
data class TonightInfo(
    val at: Long,
    val none: Boolean = false,
    /** La forme de la fiche : 2 depuis la 1.10.0 (la description). Une plus ancienne est relue. */
    val v: Int = 0,
    val name: String? = null,
    /** La description courte de la fiche Steam, dans la langue du telephone quand Steam l'a. */
    val description: String? = null,
    val format: String? = null,
    val deck: String? = null,
    val percent: Int? = null,
    val reviews: Int = 0,
    val image: String? = null,
    /** Le jeu se joue-t-il a plusieurs ? null : on ne sait pas (fiche d'avant la 1.12.0, ou sans etiquettes). */
    val coop: Boolean? = null,
    /** Les dix etiquettes les plus fortes (1.14.0) : « Tes gouts » les compare au profil. */
    val tags: List<TagW> = emptyList(),
)

/**
 * Le temps de jeu typique d'un titre (1.23.0) : la mediane du temps passe par les
 * joueurs qui ont laisse un avis Steam recent. `minutes` null : trop peu d'avis
 * avec un temps de jeu pour en tirer quoi que ce soit.
 */
@Serializable
data class PlayMedian(val at: Long, val minutes: Int? = null, val n: Int = 0)

/**
 * La soiree d'apres l'agenda (1.23.0) : le plus long creneau libre entre 18 h et 23 h 30
 * (22 h 30 si tu te leves tot demain). Lu sur le telephone, jamais envoye nulle part ;
 * seuls les debuts et fins des evenements sont lus, jamais leurs titres.
 */
@Serializable
data class EveningState(
    val at: Long,
    val minutes: Int,
    val from: Long,
    val to: Long,
    val earlyWake: Boolean = false,
    /** La soiree visee est celle de demain (il est deja tard). */
    val tomorrow: Boolean = false,
)

/** Une etiquette Steam et son poids, de 1 a 100 (celui du jeu, ramene a sa plus forte). */
@Serializable
data class TagW(val i: Int, val w: Int)

/** Les etiquettes d'un jeu lu pour « Tes gouts » (1.14.0). */
@Serializable
data class TasteGame(val at: Long, val none: Boolean = false, val tags: List<TagW> = emptyList())

/** Ce que tu aimes : des etiquettes et leur poids, de -1 a 1. Jamais un titre. */
@Serializable
data class TasteProfile(val tags: Map<String, Double> = emptyMap(), val liked: Int = 0, val disliked: Int = 0)

/**
 * « Tes gouts » (1.14.0). `imported` est le profil de l'extension (sa
 * sauvegarde le porte : elle sait combien de temps tu as joue) ; `profile`,
 * celui que le telephone tire seul de tes etats (fini, abandonne, pas pour
 * moi). L'importe l'emporte quand il est la.
 */
@Serializable
data class TasteState(
    val at: Long? = null,
    val profile: TasteProfile? = null,
    val imported: TasteProfile? = null,
    val games: Map<String, TasteGame> = emptyMap(),
    val names: Map<String, String> = emptyMap(),
    val namesAt: Long? = null,
    val namesLang: String? = null,
)

/** L'appid Steam d'un titre hors Steam, trouve par la recherche (ou non). */
@Serializable
data class TitleMatch(val at: Long, val appid: String? = null)

/**
 * Le choix du soir : le jeu tire, quand, pour quels reglages, ceux deja
 * montres ; et, une fois « J'y joue » touche, le jeu retenu.
 */
@Serializable
data class TonightPick(
    val time: String = "evening",
    val deckOnly: Boolean = false,
    /** « A plusieurs » (1.12.0) : ne proposer que les jeux etiquetes coop ou multijoueur. */
    val coop: Boolean = false,
    val key: String? = null,
    val at: Long = 0,
    val shown: List<String> = emptyList(),
    val playing: String? = null,
    val playingTitle: String? = null,
    val playingPage: String? = null,
    val playingAt: Long = 0,
)

/** Un jeu vu offert : ou, et quand (1.7.0). */
@Serializable
data class Seen(val store: String, val ts: Long)

/** Un editeur qui a offert des jeux, et lesquels (titres normalises). */
@Serializable
data class Giver(val name: String, val games: List<String> = emptyList(), val last: Long = 0)

/** Ce que la fiche Steam d'un souhait dit de lui. */
@Serializable
data class OddsInfo(
    val at: Long,
    val notFound: Boolean = false,
    val appid: String? = null,
    val name: String? = null,
    val isFree: Boolean = false,
    val comingSoon: Boolean = false,
    val released: Long? = null,
    val basePrice: Double? = null,
    val currency: String? = null,
    val publishers: List<String> = emptyList(),
)
