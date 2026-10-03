package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Health
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OracleNote
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** La page « Sante » (1.26.0) : ce qu'elle raconte, et ce qu'elle refuse de raconter. */
class HealthTest {
    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L
    private val day = 24 * hour

    private fun offer(store: String, id: String, title: String) =
        Offer(key = Offer.keyFor(store, id, title), source = "x", store = store, storeId = id, title = title,
            url = "https://example.test/$id", end = now + 5 * day, keepable = true)

    private fun state(offers: List<Offer>, attempts: Map<String, Attempt> = emptyMap(), library: Map<String, LibraryEntry> = emptyMap()) =
        AppState(offers = offers.associateBy { it.key }, attempts = attempts, library = library)

    private fun line(s: AppState, store: String) = Health.overview(s, now).lines.single { it.store == store }

    @Test
    fun everyStoreHasALineEvenOnAnEmptyApp() {
        val o = Health.overview(AppState(), now)
        assertEquals(Accounts.STORES, o.lines.map { it.store })
        assertEquals(0, o.problems)
        assertNull(o.lastCheck)
        assertTrue(o.lines.all { it.lastClaim == null && it.lastFailure == null && it.waiting == 0 && it.account == Accounts.UNKNOWN })
    }

    @Test
    fun theLastClaimIsTheNewestOneOfThatStore() {
        val old = LibraryEntry(Stores.EPIC, "a", "Vieux", ts = now - 9 * day)
        val recent = LibraryEntry(Stores.EPIC, "b", "Recent", ts = now - day)
        val gog = LibraryEntry(Stores.GOG, "g", "Autre magasin", ts = now - hour)
        val undated = LibraryEntry(Stores.EPIC, "c", "Sans date", ts = null)
        val s = AppState(library = listOf(old, recent, gog, undated).associateBy { Rules.libraryKey(it.store, it.id) })
        assertEquals("Recent", line(s, Stores.EPIC).lastClaim!!.title)
        assertEquals("Autre magasin", line(s, Stores.GOG).lastClaim!!.title)
        assertNull(line(s, Stores.AMAZON).lastClaim)
    }

    @Test
    fun aFailureShowsOnlyIfItIsRecentUnresolvedAndNewerThanTheLastSuccess() {
        val hades = offer(Stores.EPIC, "hades", "Hades")
        val failed = Attempt(count = 2, lastAt = now - 2 * hour, verdict = Verdicts.FAILURE, details = "bouton introuvable", nextAt = now + hour)
        val s = state(listOf(hades), mapOf(hades.key to failed))
        val f = line(s, Stores.EPIC).lastFailure
        assertNotNull(f)
        assertEquals("Hades", f!!.title)
        assertEquals(Verdicts.FAILURE, f.verdict)
        assertEquals("bouton introuvable", f.details)
        assertEquals(1, Health.overview(s, now).problems)
        assertTrue(line(s, Stores.EPIC).problem)
        assertFalse("un autre magasin n'est pas touche", line(s, Stores.GOG).problem)

        // Une reussite plus recente efface la pertinence de l'echec.
        val after = s.copy(library = mapOf(Rules.libraryKey(Stores.EPIC, "autre") to LibraryEntry(Stores.EPIC, "autre", "Autre", ts = now - hour)))
        assertNull(line(after, Stores.EPIC).lastFailure)
        // Une reussite plus ANCIENNE ne l'efface pas.
        val before = s.copy(library = mapOf(Rules.libraryKey(Stores.EPIC, "autre") to LibraryEntry(Stores.EPIC, "autre", "Autre", ts = now - 5 * hour)))
        assertNotNull(line(before, Stores.EPIC).lastFailure)
        // Trop ancien : plus rien a apprendre.
        val stale = state(listOf(hades), mapOf(hades.key to failed.copy(lastAt = now - 15 * day)))
        assertNull(line(stale, Stores.EPIC).lastFailure)
        // Le jeu a fini par etre obtenu : ce n'est plus un echec.
        val got = s.copy(library = mapOf(Rules.libraryKeyOf(hades) to LibraryEntry(Stores.EPIC, "hades", "Hades", ts = now - 10 * day)))
        assertNull(line(got, Stores.EPIC).lastFailure)
    }

    @Test
    fun onlyRealProblemsCountAsFailures() {
        val g = offer(Stores.GOG, "g", "Jeu")
        for (v in listOf(Verdicts.OWNED, Verdicts.GONE, Verdicts.CLAIMED, Verdicts.SKIPPED, Verdicts.OUT_OF_SCOPE, Verdicts.EXPIRED, Verdicts.CODE_PENDING, null)) {
            val s = state(listOf(g), mapOf(g.key to Attempt(count = 1, lastAt = now - hour, verdict = v)))
            assertNull("$v", line(s, Stores.GOG).lastFailure)
        }
        for (v in Health.PROBLEMS) {
            val s = state(listOf(g), mapOf(g.key to Attempt(count = 1, lastAt = now - hour, verdict = v)))
            assertNotNull("$v", line(s, Stores.GOG).lastFailure)
        }
        // Une tentative dont l'offre n'est plus connue n'a pas de titre : elle ne raconte rien.
        val orphan = AppState(attempts = mapOf("gog:?" to Attempt(count = 1, lastAt = now - hour, verdict = Verdicts.FAILURE)))
        assertNull(line(orphan, Stores.GOG).lastFailure)
    }

    @Test
    fun theNewestFailureWins() {
        val a = offer(Stores.GOG, "a", "Ancien")
        val b = offer(Stores.GOG, "b", "Recent")
        val s = state(
            listOf(a, b),
            mapOf(
                a.key to Attempt(count = 1, lastAt = now - 3 * day, verdict = Verdicts.FAILURE),
                b.key to Attempt(count = 1, lastAt = now - hour, verdict = Verdicts.CHALLENGE),
            ),
        )
        assertEquals("Recent", line(s, Stores.GOG).lastFailure!!.title)
    }

    @Test
    fun aLostSessionIsAProblemOnItsOwn() {
        val s = AppState(accounts = mapOf(Stores.GOG to AccountState(Accounts.LOGGED_OUT, now)))
        assertTrue(line(s, Stores.GOG).problem)
        assertEquals(1, Health.overview(s, now).problems)
        assertFalse(line(s.copy(accounts = mapOf(Stores.GOG to AccountState(Accounts.OK, now))), Stores.GOG).problem)
    }

    @Test
    fun waitingCountsWhatIsDueNow() {
        val a = offer(Stores.EPIC, "a", "A")
        val b = offer(Stores.EPIC, "b", "B")
        val c = offer(Stores.GOG, "c", "C")
        val s = state(listOf(a, b, c), mapOf(b.key to Attempt(count = 1, lastAt = now, verdict = Verdicts.FAILURE, nextAt = now + hour)))
        assertEquals(1, line(s, Stores.EPIC).waiting)
        assertEquals(1, line(s, Stores.GOG).waiting)
    }

    @Test
    fun theAccountCheckSaysWhatEachStoreCanDo() {
        val s = AppState(oracle = mapOf(Stores.GOG to OracleNote(now - hour, true), Stores.EPIC to OracleNote(now - 2 * hour, false)))
        assertEquals(Health.Control.READ, line(s, Stores.GOG).control)
        assertEquals(now - hour, line(s, Stores.GOG).controlAt)
        assertEquals(Health.Control.UNREADABLE, line(s, Stores.EPIC).control)
        assertEquals(Health.Control.OWNED_LIST, line(s, Stores.STEAM).control)
        assertEquals(Health.Control.PAGE_DECIDES, line(s, Stores.AMAZON).control)
        assertEquals("jamais demande", Health.Control.NOT_ASKED_YET, line(AppState(), Stores.GOG).control)
        assertEquals(Health.Control.NOT_ASKED_YET, line(AppState(), Stores.EPIC).control)
    }

    @Test
    fun sourcesInErrorAreListedByName() {
        val s = AppState(
            lastCheck = now - hour,
            sources = mapOf("epic-api" to SourceStatus(now, ok = true, count = 2), "gamerpower" to SourceStatus(now, ok = false, error = "HTTP 503"), "gog" to SourceStatus(now, ok = false)),
        )
        val o = Health.overview(s, now)
        assertEquals(listOf("gamerpower", "gog"), o.sourcesDown)
        assertEquals(now - hour, o.lastCheck)
    }
}
