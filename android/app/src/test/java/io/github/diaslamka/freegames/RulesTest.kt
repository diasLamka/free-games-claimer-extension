package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.SourceResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RulesTest {
    private val now = 1_790_000_000_000L
    private fun offer(store: String, id: String, title: String, source: String = "x", end: Long? = now + 86_400_000, pkg: String? = null) =
        Offer(key = Offer.keyFor(store, id, title), source = source, store = store, storeId = id, title = title,
            url = "https://example.test/$id", end = end, packageId = pkg, keepable = true)

    @Test
    fun pendingSkipsClaimedDisabledAndBackedOff() {
        val epic = offer(Stores.EPIC, "hades", "Hades")
        val gog = offer(Stores.GOG, "x", "Gog Game")
        val steam = offer(Stores.STEAM, "1", "Steam Game", pkg = "9")
        val done = offer(Stores.EPIC, "done", "Done Game")
        val later = offer(Stores.EPIC, "later", "Later")
        val s = AppState(
            offers = listOf(epic, gog, steam, done, later).associateBy { it.key },
            library = mapOf(Rules.libraryKeyOf(done) to LibraryEntry(Stores.EPIC, "done", "Done Game", ts = now)),
            attempts = mapOf(later.key to Attempt(count = 1, lastAt = now, verdict = Verdicts.FAILURE, nextAt = now + 900_000)),
            settings = Settings(claimGog = false),
        )
        assertEquals(listOf("Hades"), Rules.pending(s, now).map { it.title })
        assertEquals(setOf("Hades", "Later"), Rules.pending(s, now, force = setOf(later.key)).map { it.title }.toSet())
        assertTrue(Rules.pending(s.copy(settings = Settings(claimSteam = true, claimGog = false)), now).any { it.store == Stores.STEAM })
    }

    @Test
    fun backoffMirrorsTheExtension() {
        val a1 = Rules.afterVerdict(null, Verdicts.FAILURE, "x", now)
        assertEquals(1, a1.count)
        assertEquals(now + 15 * 60_000, a1.nextAt)
        val login = Rules.afterVerdict(a1, Verdicts.LOGIN, null, now)
        assertEquals(1, login.count)
        assertNull(login.nextAt)
        assertNull(Rules.afterVerdict(a1, Verdicts.CLAIMED, null, now).nextAt)
        assertEquals(now + 12 * 3_600_000L, Rules.afterVerdict(null, Verdicts.NEEDS_BASE, "1", now).nextAt)
    }

    @Test
    fun mergeKeepsFailedSourcesAndDropsAggregatorDuplicates() {
        val old = offer(Stores.GOG, "a", "Old Gog", source = "gog")
        val epic = offer(Stores.EPIC, "hades", "Hades", source = "epic-api")
        val gpDup = Offer(key = "gamerpower:1", source = "gamerpower", store = Stores.EPIC, title = "Hades (Epic Games) Giveaway", resolveUrl = "https://www.gamerpower.com/open/hades")
        val gpOther = Offer(key = "gamerpower:2", source = "gamerpower", store = Stores.ITCHIO, title = "Indie (itch.io) Giveaway", resolveUrl = "https://www.gamerpower.com/open/indie")
        val merged = Watcher.merge(
            mapOf(old.key to old),
            listOf(
                SourceResult("gog", errors = listOf("HTTP 500"), ok = false),
                SourceResult("epic-api", offers = listOf(epic)),
                SourceResult("gamerpower", offers = listOf(gpDup, gpOther)),
            ),
            now,
        )
        assertTrue(old.key in merged)
        assertTrue(epic.key in merged)
        assertTrue("gamerpower:2" in merged)
        assertTrue("gamerpower:1" !in merged)
    }

    @Test
    fun moneyReadsStoreFormats() {
        assertEquals(23.99, Money.parse("23,99 €")!!.value, 0.001)
        assertEquals("EUR", Money.parse("23,99 €")!!.currency)
        assertEquals(19.99, Money.parse("$19.99")!!.value, 0.001)
        assertEquals("USD", Money.parse("$19.99")!!.currency)
        assertEquals(9.99, Money.parse("9.99 EUR")!!.value, 0.001)
        assertEquals(1299.0, Money.parse("1.299,00 €")!!.value, 0.001)
        assertNull(Money.parse("N/A"))
        val t = Money.total(listOf("23,99 €", "9.99 EUR", "$5.00", null), "EUR")!!
        assertEquals("EUR", t.second)
        assertEquals(33.98, t.first, 0.001)
    }

    @Test
    fun backupRoundTripWithTheExtensionFormat() {
        val ext = """{"exportFormat":2,"backup":{
            "veille:bibliotheque":{"epic:hades":{"store":"epic","id":"hades","title":"Hades","ts":1700000000000,"status":"claimed","worth":"24,99 €"}},
            "veille:souhaits":[{"title":"Hollow Knight: Silksong","key":"hollow knight silksong"}],
            "veille:souhaits-steam":{"wishes":[{"id":"367520","title":"Hollow Knight"}]},
            "FGC_history_Epic Games":"{\"slug:hades\":{\"status\":\"claimed\",\"ts\":1700000000000}}",
            "FGC_pending_codes":"[{\"code\":\"SECRET\"}]",
            "FGC_epic_country":"DE"}}"""
        val (s, r) = BackupIO.import(AppState(), ext, now)!!
        assertEquals(1, r.library)
        assertEquals(listOf("Hollow Knight: Silksong"), s.wishlist)
        assertEquals("367520", s.importedWishes.single().id)
        assertEquals("DE", s.settings.country)
        assertNotNull(s.engine["FGC_history_Epic Games"])
        assertTrue("les codes ne sont jamais importes", s.engine.keys.none { it.contains("codes") })
        val out = BackupIO.export(s, now)
        assertTrue(out.contains("\"veille:bibliotheque\""))
        assertTrue(out.contains("\"exportFormat\":2"))
        assertTrue(!out.contains("SECRET"))
        assertNull(BackupIO.import(AppState(), "{\"hello\":1}", now))
    }
}
