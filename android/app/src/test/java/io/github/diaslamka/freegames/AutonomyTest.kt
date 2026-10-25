package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Autonomy
import io.github.diaslamka.freegames.data.Autonomy.Block
import io.github.diaslamka.freegames.data.Autonomy.Level
import io.github.diaslamka.freegames.data.Restrictions
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L'autonomie (1.38.0) : le telephone recupere seul depuis la 1.2.0 (option « ecran eteint »), mais rien ne disait s'il le pouvait
 * VRAIMENT ni ce qui le freinait. Le calcul est pur : il lit ce que l'appli sait deja -- les reglages, les sessions, les defis vus,
 * ce qu'Android a fait de la veille -- et compte ce qui a ete pris sans toi.
 */
class AutonomyTest {
    private val now = 1_790_000_000_000L
    private val day = 24 * 3_600_000L

    private fun offer(id: String, store: String = Stores.EPIC) =
        Offer(key = "$store:$id", source = "epic-api", store = store, storeId = id, title = "Jeu $id", url = "https://example.test/$id", end = now + 2 * day)

    private fun on(vararg offers: Offer, accounts: Map<String, AccountState> = emptyMap(), attempts: Map<String, Attempt> = emptyMap(), library: Map<String, LibraryEntry> = emptyMap(), settings: Settings = Settings(claimInBackground = true)) =
        AppState(offers = offers.associateBy { it.key }, accounts = accounts, attempts = attempts, library = library, settings = settings)

    @Test
    fun backgroundClaimingOffMeansItDoesNotClaimAlone() {
        val r = Autonomy.report(on(settings = Settings(claimInBackground = false)), null, now)
        assertEquals(Level.OFF, r.level)
        assertTrue(r.blocks.contains(Block.Off))
    }

    @Test
    fun onWithNothingInTheWayClaimsAlone() {
        val r = Autonomy.report(on(offer("a")), null, now)
        assertEquals(Level.ON, r.level)
        assertTrue(r.blocks.isEmpty())
    }

    @Test
    fun aLostSessionIsABrakeForThatStore() {
        val r = Autonomy.report(on(offer("a"), accounts = mapOf(Stores.EPIC to AccountState(Accounts.LOGGED_OUT, now - 1))), null, now)
        assertEquals(Level.PARTIAL, r.level)
        assertTrue(r.blocks.contains(Block.Sessions(listOf(Stores.EPIC))))
    }

    @Test
    fun aLostSessionOnAStoreYouTurnedOffIsNotABrake() {
        val r = Autonomy.report(
            on(accounts = mapOf(Stores.STEAM to AccountState(Accounts.LOGGED_OUT, now - 1)), settings = Settings(claimInBackground = true, claimSteam = false)),
            null, now,
        )
        assertEquals(Level.ON, r.level)
    }

    @Test
    fun aHumanCheckSeenRecentlyOnAnUnclaimedGameIsABrake() {
        val o = offer("a")
        val r = Autonomy.report(on(o, attempts = mapOf(o.key to Attempt(count = 0, lastAt = now - day, verdict = Verdicts.CHALLENGE))), null, now)
        assertEquals(Level.PARTIAL, r.level)
        assertTrue(r.blocks.contains(Block.Challenges(listOf(Stores.EPIC))))
    }

    @Test
    fun anOldCheckOrAClaimedGameIsNoBrake() {
        val o = offer("a")
        val old = Autonomy.report(on(o, attempts = mapOf(o.key to Attempt(lastAt = now - 20 * day, verdict = Verdicts.CHALLENGE))), null, now)
        assertEquals(Level.ON, old.level)
        val entry = LibraryEntry(store = Stores.EPIC, id = "a", title = "Jeu a", ts = now - 1_000)
        val claimed = Autonomy.report(
            on(o, attempts = mapOf(o.key to Attempt(lastAt = now - day, verdict = Verdicts.CHALLENGE)), library = mapOf("epic:a" to entry)),
            null, now,
        )
        assertEquals(Level.ON, claimed.level)
    }

    @Test
    fun androidThrottlingIsABrakeAndNoReadingIsNone() {
        val limited = Restrictions.Snapshot(bucket = Restrictions.BUCKET_RESTRICTED)
        val r = Autonomy.report(on(offer("a")), limited, now)
        assertEquals(Level.PARTIAL, r.level)
        assertTrue(r.blocks.any { it is Block.Android })
        assertEquals(Level.ON, Autonomy.report(on(offer("a")), null, now).level)
        assertEquals(Level.ON, Autonomy.report(on(offer("a")), Restrictions.Snapshot(), now).level)
    }

    @Test
    fun wifiAndChargingChoicesAreDelaysNotBrakes() {
        val r = Autonomy.report(on(offer("a"), settings = Settings(claimInBackground = true, wifiOnly = true, chargingOnly = true)), null, now)
        assertEquals(Level.ON, r.level)
        assertTrue(r.wifiOnly)
        assertTrue(r.chargingOnly)
    }

    @Test
    fun itCountsWhatWasTakenAloneAndWhatWasTakenWithYouOverFourteenDays() {
        fun entry(id: String, ts: Long, alone: Boolean?) = LibraryEntry(store = Stores.EPIC, id = id, title = id, ts = ts, alone = alone)
        val lib = listOf(
            entry("a", now - day, true), entry("b", now - 2 * day, true), entry("c", now - 3 * day, false),
            entry("d", now - 20 * day, true), // trop ancien
            entry("e", now - day, null), // d'avant la mesure : on ne dit rien
        ).associateBy { "epic:" + it.id }
        val r = Autonomy.report(on(library = lib), null, now)
        assertEquals(2, r.alone)
        assertEquals(1, r.withYou)
        assertEquals(14, Autonomy.WINDOW_DAYS)
    }

    @Test
    fun noReadingMeansNoAndroidBlock() {
        assertNull(Autonomy.report(on(), null, now).blocks.firstOrNull { it is Block.Android })
    }
}
