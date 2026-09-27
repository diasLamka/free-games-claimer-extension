package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Odds
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Giver
import io.github.diaslamka.freegames.model.ImportedWish
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OddsInfo
import io.github.diaslamka.freegames.model.Seen
import io.github.diaslamka.freegames.model.Stores
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

/** « Attends, il sera offert » (1.7.0) : les memes cas que test/odds.test.mjs. */
class OddsTest {
    private val now = 1_790_500_000_000L
    private val year = (365.25 * 24 * 3_600_000L).toLong()
    private val hades = File(System.getProperty("fixtures"), "steam-appdetails-1145360.json").readText()

    @Test
    fun steamPagesAreReadEvenUnderAnotherKey() {
        val info = Odds.readInfo(hades, "1145360", now)!!
        assertEquals("Hades", info.name)
        assertEquals(24.5, info.basePrice!!, 0.001)
        assertEquals("EUR", info.currency)
        assertEquals(listOf("Supergiant Games"), info.publishers)
        assertEquals(Odds.readSteamDate("17 Sep, 2020"), info.released)
        assertNull(Odds.readInfo("""{"1":{"success":false}}""", "1", now))
        assertEquals(Odds.readSteamDate("1 Jan, 2027"), Odds.readSteamDate("Q1 2027"))
        assertNull(Odds.readSteamDate("To be announced"))
    }

    @Test
    fun publishersAreCountedOncePerGame() {
        assertEquals(Odds.normalisePublisher("Gameplay Group International Inc."), Odds.normalisePublisher("Gameplay Group International"))
        fun o(t: String, p: String?, keep: Boolean? = true) = Offer(key = "epic:$t", source = "epic", store = Stores.EPIC, storeId = t, title = t, publisher = p, keepable = keep)
        var g = Odds.recordGivers(emptyMap(), listOf(o("Breathedge", "Hypetrain Digital"), o("Breathedge", "Hypetrain Digital"), o("Autre", "Hypetrain Digital Ltd"), o("F2P", "X", keep = false)), now)
        assertEquals(setOf("hypetrain digital"), g.keys)
        assertEquals(2, g.getValue("hypetrain digital").games.size)
        g = Odds.recordGivers(g, listOf(o("Breathedge", "Hypetrain Digital")), now + 1)
        assertEquals(2, g.getValue("hypetrain digital").games.size)
        val p = Odds.recordPasses(emptyMap(), listOf(o("Tunic", null).copy(start = now), o("Tunic", null).copy(start = now + 60_000)))
        assertEquals(1, p.getValue("tunic").size)
    }

    @Test
    fun theEstimateHasThreeLevelsAndItsReasons() {
        val givers = mapOf("hypetrain digital" to Giver("Hypetrain Digital", listOf("a", "b")))
        val vieux = OddsInfo(at = now, released = now - 4 * year, basePrice = 19.99, currency = "EUR", publishers = listOf("Hypetrain Digital"))
        assertEquals(Odds.HIGH, Odds.estimate(listOf(Seen(Stores.AMAZON, now - year)), null, emptyMap(), now).level)
        val profil = Odds.estimate(null, vieux, givers, now)
        assertEquals(Odds.HIGH, profil.level)
        assertEquals(listOf("odds_publisher_gave", "odds_old", "odds_cheap"), profil.reasons.map { it.key })
        assertEquals(Odds.MEDIUM, Odds.estimate(null, vieux.copy(publishers = emptyList()), emptyMap(), now).level)
        val recent = Odds.estimate(null, OddsInfo(at = now, released = now - year / 3, basePrice = 59.99, currency = "EUR"), emptyMap(), now)
        assertEquals(Odds.LOW, recent.level)
        assertEquals(listOf("odds_recent", "odds_expensive"), recent.reasons.map { it.key })
        assertEquals(listOf("odds_pending"), Odds.estimate(null, null, emptyMap(), now).reasons.map { it.key })
        assertEquals(listOf("odds_not_on_steam"), Odds.estimate(null, OddsInfo(at = now, notFound = true), emptyMap(), now).reasons.map { it.key })
        assertEquals(Odds.F2P, Odds.estimate(null, OddsInfo(at = now, isFree = true), emptyMap(), now).level)
    }

    @Test
    fun wishesAreRankedBestFirst() {
        val s = AppState(
            wishlist = listOf("Hades", "Inconnu"),
            importedWishes = listOf(ImportedWish("Hades", Stores.STEAM, "1145360"), ImportedWish("Tunic", Stores.STEAM, "553420")),
            passes = mapOf("tunic" to listOf(Seen(Stores.EPIC, now - year))),
            odds = mapOf("t:hades" to Odds.readInfo(hades, "1145360", now)!!),
        )
        assertEquals(listOf("Hades", "Inconnu", "Tunic"), Odds.targets(s).map { it.title })
        assertEquals("app:553420", Odds.targets(s)[2].key)
        assertEquals(listOf("Tunic" to Odds.HIGH, "Hades" to Odds.MEDIUM, "Inconnu" to Odds.UNKNOWN), Odds.rank(s, now).map { it.first.title to it.second.level })
    }
}
