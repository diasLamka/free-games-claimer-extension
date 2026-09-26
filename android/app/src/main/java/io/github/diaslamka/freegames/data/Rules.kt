package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.GamerPowerSource

/** Les verdicts, avec le vocabulaire du moteur et de watch/claim.js. */
object Verdicts {
    const val CLAIMED = "claimed"
    const val REDEEMED = "redeemed"
    const val ALREADY_REDEEMED = "already_redeemed"
    const val CODE_PENDING = "code_pending_gog"
    const val CODE_COPIED = "code_copied"
    const val LINK_ACCOUNT = "needs_link"
    const val SKIPPED = "skipped"
    const val BAD_URL = "bad_url"
    const val FAILURE = "failed"
    const val LOGIN = "needs_login"
    const val CHALLENGE = "challenge"
    const val OUT_OF_SCOPE = "out_of_scope"
    const val EXPIRED = "expired"
    const val NEEDS_BASE = "needs_base_game"
    const val UNDETERMINED = "undetermined"

    val ACQUIRED = setOf(CLAIMED, REDEEMED, ALREADY_REDEEMED)
    val FINAL = setOf(CLAIMED, REDEEMED, ALREADY_REDEEMED, SKIPPED, OUT_OF_SCOPE, BAD_URL, EXPIRED)
    val HUMAN = setOf(LOGIN, LINK_ACCOUNT, CHALLENGE)

    /** Quinze minutes, une heure, quatre heures, douze heures ; cinq essais au plus. */
    val BACKOFF_MS = listOf(15 * 60_000L, 60 * 60_000L, 4 * 3_600_000L, 12 * 3_600_000L)
    const val MAX_ATTEMPTS = 5
    const val WAITING_RECHECK_MS = 12 * 3_600_000L

    fun nextAttemptAt(attempts: Int, now: Long): Long? {
        if (attempts >= MAX_ATTEMPTS) return null
        val rang = (attempts - 1).coerceIn(0, BACKOFF_MS.size - 1)
        return now + BACKOFF_MS[rang]
    }
}

object Rules {
    fun libraryKey(store: String, id: String) = "$store:${id.removePrefix("slug:").removePrefix("offer:")}"

    fun libraryKeyOf(o: Offer) = libraryKey(o.store, o.storeId ?: o.sourceId ?: o.normalisedTitle)

    /** Deja recupere : par identifiant chez son magasin, ou par titre dans le meme magasin. */
    fun claimedEntry(o: Offer, library: Map<String, LibraryEntry>): LibraryEntry? {
        library[libraryKeyOf(o)]?.let { return it }
        val t = o.normalisedTitle
        if (t.isEmpty()) return null
        return library.values.firstOrNull { it.store == o.store && Titles.normalise(it.title) == t }
    }

    fun ownedOnSteam(o: Offer, s: AppState): Boolean =
        o.store == Stores.STEAM && o.storeId != null && s.steamOwned.contains(o.storeId)

    /** Un magasin que l'appli sait recuperer, et que l'utilisateur a laisse actif. */
    fun storeEnabled(store: String, st: Settings): Boolean = when (store) {
        Stores.EPIC -> st.claimEpic
        Stores.GOG -> st.claimGog
        Stores.AMAZON -> st.claimAmazon
        Stores.STEAM -> st.claimSteam
        else -> false
    }

    /**
     * Une offre que l'appli sait prendre : un magasin connu du moteur (ou
     * Steam, en option, avec son paquet), quelque chose a garder, et pas du
     * butin d'agregateur -- comme la file de l'extension.
     */
    fun claimable(o: Offer, st: Settings): Boolean {
        if (!storeEnabled(o.store, st)) return false
        if (o.keepable == false) return false
        if (o.source == GamerPowerSource.NAME && o.isExtra) return false
        if (o.store == Stores.STEAM) return o.packageId != null
        return o.url != null || o.resolveUrl != null
    }

    /** Ce qu'il reste a prendre, maintenant. `force` ignore le recul (bouton « Recuperer »). */
    fun pending(s: AppState, now: Long, force: Set<String> = emptySet()): List<Offer> =
        s.offers.values
            .filter { it.isOpen(now) && claimable(it, s.settings) }
            .filter { claimedEntry(it, s.library) == null && !ownedOnSteam(it, s) }
            .filter { o ->
                if (o.key in force) return@filter true
                val a = s.attempts[o.key] ?: return@filter true
                if (a.verdict in Verdicts.FINAL) return@filter false
                if (a.count >= Verdicts.MAX_ATTEMPTS) return@filter false
                a.nextAt == null || a.nextAt <= now
            }
            .sortedWith(compareBy<Offer> { it.end ?: Long.MAX_VALUE }.thenBy { it.title })

    /** Ce que devient l'essai d'une offre apres un verdict. */
    fun afterVerdict(prev: Attempt?, verdict: String, details: String?, now: Long, unattended: Boolean = false): Attempt {
        val count = (prev?.count ?: 0) + if (verdict in Verdicts.HUMAN) 0 else 1
        val next = when {
            verdict in Verdicts.FINAL -> null
            // Un defi rencontre sans personne devant : le fond ne revient pas le
            // provoquer a chaque passage. La notification, elle, passe outre.
            verdict == Verdicts.CHALLENGE && unattended -> now + Verdicts.BACKOFF_MS[2]
            verdict in Verdicts.HUMAN -> null
            verdict == Verdicts.NEEDS_BASE -> now + Verdicts.WAITING_RECHECK_MS
            else -> Verdicts.nextAttemptAt(count, now)
        }
        return Attempt(count = count, lastAt = now, verdict = verdict, details = details, nextAt = next)
    }

    /** Souhaite : a la main, ou par une liste importee. */
    fun wished(o: Offer, s: AppState): Boolean {
        val t = o.normalisedTitle
        if (t.isEmpty()) return false
        if (s.wishlist.any { Titles.normalise(it) == t }) return true
        return s.importedWishes.any { w ->
            (w.store == o.store && w.id != null && (w.id == o.storeId || w.id == o.sourceId)) || Titles.normalise(w.title) == t
        }
    }
}
