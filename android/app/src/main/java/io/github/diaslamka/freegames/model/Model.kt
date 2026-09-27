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
    val normalisedTitle: String get() = Titles.normalise(title)
    val shownTitle: String get() = Titles.display(title)

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
)

/** Un souhait importe d'une liste Steam ou GOG. */
@Serializable
data class ImportedWish(val title: String, val store: String, val id: String? = null)

/** Les essais de recuperation d'une offre. */
@Serializable
data class Attempt(
    val count: Int = 0,
    val lastAt: Long = 0,
    val verdict: String? = null,
    val details: String? = null,
    val nextAt: Long? = null,
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
data class AccountState(val status: String = "unknown", val checkedAt: Long = 0, val name: String? = null)

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
    val onboarded: Boolean = false,
)

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
    val ratings: Map<String, Rating> = emptyMap(),
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
    /** « Attends, il sera offert » (1.7.0) : les passages vus, par titre normalise. */
    val passes: Map<String, List<Seen>> = emptyMap(),
    /** Les editeurs qui offrent, par nom normalise. */
    val givers: Map<String, Giver> = emptyMap(),
    /** La fiche Steam de chaque souhait, par « app:<id> » ou « t:<titre> ». */
    val odds: Map<String, OddsInfo> = emptyMap(),
    val oddsAt: Long? = null,
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
