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
import org.junit.Assert.assertFalse
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
    fun aButtonToShowIsAskedOnceThenFollowsTheOrdinaryBackoff() {
        // 1.24.0 : « montre-moi le bouton » ne s'abandonnait jamais, et un jeu deja a toi le redemandait a l'infini.
        assertFalse(Verdicts.TEACH in Verdicts.HUMAN)
        assertFalse(Verdicts.TEACH in Verdicts.FINAL)
        val asked = Rules.afterVerdict(null, Verdicts.TEACH, "x", now)
        assertEquals(1, asked.count)
        assertEquals(1, asked.asks)
        assertEquals("la journee entiere pour repondre", now + Verdicts.ASK_WAIT_MS, asked.nextAt)
        assertEquals("sans personne devant, pareil", now + Verdicts.ASK_WAIT_MS, Rules.afterVerdict(null, Verdicts.TEACH, "x", now, unattended = true).nextAt)
        assertTrue(Rules.alreadyAsked(asked))
        assertTrue("une offre d'avant la 1.24.0 qui l'attendait compte comme posee", Rules.alreadyAsked(Attempt(verdict = Verdicts.TEACH)))
        assertFalse(Rules.alreadyAsked(Attempt(verdict = Verdicts.FAILURE)))
        assertFalse(Rules.alreadyAsked(null))

        // Ensuite : le recul ordinaire, puis l'abandon au cinquieme essai.
        var a: Attempt? = asked
        var t = now
        repeat(4) {
            t = a!!.nextAt ?: t
            a = Rules.afterVerdict(a, Verdicts.FAILURE, "x", t)
        }
        assertEquals(Verdicts.MAX_ATTEMPTS, a!!.count)
        assertNull("abandonnee", a!!.nextAt)
        assertEquals("et sans nouvelle question", 1, a!!.asks)
    }

    @Test
    fun anAskedOfferWaitsADayAndIsGivenUpAfterFiveTries() {
        val o = offer(Stores.GOG, "hades", "Hades", end = now + 500 * 24 * 3_600_000L)
        val asked = Rules.afterVerdict(null, Verdicts.TEACH, "x", now)
        val s = AppState(offers = mapOf(o.key to o), attempts = mapOf(o.key to asked))
        assertTrue("pas avant la fin de la journee", Rules.pending(s, now + 3_600_000L).isEmpty())
        assertEquals(1, Rules.pending(s, now + Verdicts.ASK_WAIT_MS).size)
        assertEquals("un clic sur la carte passe outre", 1, Rules.pending(s, now + 3_600_000L, force = setOf(o.key)).size)
        val gaveUp = s.copy(attempts = mapOf(o.key to asked.copy(count = Verdicts.MAX_ATTEMPTS, nextAt = null)))
        assertTrue(Rules.pending(gaveUp, now + 400 * 24 * 3_600_000L).isEmpty())
    }

    @Test
    fun nothingToTakeNeedsTwoReadingsFarEnoughApart() {
        val first = Rules.afterVerdict(null, Verdicts.GONE, "rien a prendre", now)
        assertEquals(now, first.goneAt)
        assertEquals("on reverifie", now + Verdicts.GONE_RECHECK_MS, first.nextAt)
        assertFalse(Verdicts.GONE in Verdicts.FINAL)

        // Trop tot : une page mal rendue ressemble a une page vide.
        val tooSoon = Rules.afterVerdict(first, Verdicts.GONE, "x", now + 30 * 60_000L)
        assertEquals(now, tooSoon.goneAt)
        assertNotNull(tooSoon.nextAt)

        // Le second constat, assez tard : c'est clos.
        val second = Rules.afterVerdict(first, Verdicts.GONE, "x", now + Verdicts.GONE_RECHECK_MS)
        assertNull(second.nextAt)
        assertEquals(Verdicts.MAX_ATTEMPTS, second.count)
        val o = offer(Stores.GOG, "hades", "Hades", end = now + 500 * 24 * 3_600_000L)
        val s = AppState(offers = mapOf(o.key to o), attempts = mapOf(o.key to second))
        assertTrue(Rules.pending(s, now + 10 * 24 * 3_600_000L).isEmpty())
        assertEquals("« Recuperer » la rouvre", 1, Rules.pending(s, now + 10 * 24 * 3_600_000L, force = setOf(o.key)).size)

        // Une page qui reparle efface le premier constat.
        assertNull(Rules.afterVerdict(first, Verdicts.FAILURE, "x", now + 1000).goneAt)

        // Ton mot suffit : « plus offert » sur le panneau clot tout de suite.
        val said = Rules.afterVerdict(null, Verdicts.GONE, "tu as dit", now, confirmed = true)
        assertNull(said.nextAt)
        assertEquals(Verdicts.MAX_ATTEMPTS, said.count)
    }

    @Test
    fun anOwnedGameIsFinalAndRememberedByStoreAndTitle() {
        assertTrue(Verdicts.OWNED in Verdicts.FINAL)
        assertFalse(Verdicts.OWNED in Verdicts.ACQUIRED)
        assertNull(Rules.afterVerdict(null, Verdicts.OWNED, "x", now).nextAt)

        val hades = offer(Stores.GOG, "hades", "Hades")
        val back = Offer(key = "gamerpower:7", source = "gamerpower", store = Stores.GOG, title = "Hades (GOG) Giveaway", resolveUrl = "https://www.gamerpower.com/open/hades")
        val epicHades = offer(Stores.EPIC, "hades", "Hades")
        val deja = Rules.remember(emptyMap(), hades, now)
        assertEquals(setOf("gog|hades"), deja.keys)
        assertEquals("deja note : rien a changer", deja, Rules.remember(deja, back, now + 5))
        val s = AppState(offers = listOf(back, epicHades).associateBy { it.key }, deja = deja)
        assertEquals("le meme jeu sous une autre cle ne revient pas ; un autre magasin si", listOf("Hades"), Rules.pending(s, now).map { it.title })
        assertEquals(Stores.EPIC, Rules.pending(s, now).single().store)

        // Borne : les plus anciens sortent.
        var m = emptyMap<String, Long>()
        for (i in 0 until Verdicts.MAX_DEJA + 20) m = Rules.remember(m, offer(Stores.GOG, "g$i", "Jeu $i"), now + i)
        assertEquals(Verdicts.MAX_DEJA, m.size)
        assertFalse("gog|jeu 0" in m)
        assertTrue("gog|jeu ${Verdicts.MAX_DEJA + 19}" in m)
    }

    @Test
    fun aFamilyMemberDoesNotInheritTheMainAccountsOwnedGames() {
        val hades = offer(Stores.GOG, "hades", "Hades")
        val s = AppState(offers = mapOf(hades.key to hades), deja = Rules.remember(emptyMap(), hades, now))
        assertTrue(Rules.pending(s, now).isEmpty())
        val member = io.github.diaslamka.freegames.model.Member(id = "m", name = "Léo", createdAt = now)
        assertEquals(1, Rules.pending(io.github.diaslamka.freegames.data.Family.view(s, member), now).size)
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
