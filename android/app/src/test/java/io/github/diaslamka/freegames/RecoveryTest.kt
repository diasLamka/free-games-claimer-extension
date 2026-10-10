package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Recovery
import io.github.diaslamka.freegames.data.Recovery.Why
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
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
 * Le centre de recuperation (1.31.0) : ce que l'appli prendrait MAINTENANT, ce qui l'attend, ce qui demande l'utilisateur, et pourquoi
 * le reste n'est pas pris. Le meme calcul que `Rules.pending` -- la liste « a prendre » doit etre exactement celle du bouton.
 */
class RecoveryTest {
    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L

    private fun offer(
        id: String, store: String = Stores.EPIC, title: String = "Jeu $id", url: String? = "https://example.test/$id",
        keepable: Boolean? = null, source: String = "epic-api", end: Long? = now + 48 * hour,
    ) = Offer(key = "$store:$id", source = source, store = store, storeId = id, title = title, url = url, keepable = keepable, end = end)

    private fun state(vararg offers: Offer, attempts: Map<String, Attempt> = emptyMap(), settings: Settings = Settings(), library: Map<String, LibraryEntry> = emptyMap(), deja: Map<String, Long> = emptyMap()) =
        AppState(offers = offers.associateBy { it.key }, attempts = attempts, settings = settings, library = library, deja = deja)

    private fun keys(items: List<Recovery.Item>) = items.map { it.offer.key }

    @Test
    fun aFreshClaimableOfferIsReady() {
        val p = Recovery.plan(state(offer("a")), now)
        assertEquals(listOf("epic:a"), keys(p.ready))
        assertTrue(p.needsYou.isEmpty() && p.waiting.isEmpty() && p.skipped.isEmpty())
    }

    @Test
    fun theReadyListIsExactlyWhatTheClaimButtonWouldTake() {
        val s = state(
            offer("a"), offer("b", store = Stores.GOG), offer("c", keepable = false), offer("d", store = Stores.FAB),
            offer("e"), offer("f", store = Stores.STEAM),
            attempts = mapOf("epic:e" to Attempt(count = 1, lastAt = now - hour, verdict = Verdicts.FAILURE, nextAt = now + hour)),
        )
        val p = Recovery.plan(s, now)
        assertEquals(Rules.pending(s, now).map { it.key }.toSet(), (p.ready + p.needsYou.filter { it.pending }).map { it.offer.key }.toSet())
    }

    @Test
    fun aFailedOfferInItsBackoffWaitsAndSaysWhenItRetries() {
        val retry = now + 2 * hour
        val p = Recovery.plan(state(offer("a"), attempts = mapOf("epic:a" to Attempt(count = 2, lastAt = now - hour, verdict = Verdicts.FAILURE, nextAt = retry))), now)
        assertTrue(p.ready.isEmpty())
        assertEquals(listOf("epic:a"), keys(p.waiting))
        assertEquals(retry, p.waiting[0].retryAt)
        assertEquals(2, p.waiting[0].attempt?.count)
    }

    @Test
    fun anOfferThatReachedTheLimitIsGivenUpNotWaitingForever() {
        val p = Recovery.plan(state(offer("a"), attempts = mapOf("epic:a" to Attempt(count = Verdicts.MAX_ATTEMPTS, lastAt = now - hour, verdict = Verdicts.FAILURE, nextAt = null))), now)
        assertTrue(p.waiting.isEmpty() && p.ready.isEmpty())
        assertEquals(listOf(Why.GAVE_UP), p.skipped.map { it.why })
    }

    @Test
    fun aSignInOrACheckNeedsTheUser() {
        val s = state(
            offer("a"), offer("b"), offer("c"),
            attempts = mapOf(
                "epic:a" to Attempt(count = 0, lastAt = now, verdict = Verdicts.LOGIN),
                "epic:b" to Attempt(count = 0, lastAt = now, verdict = Verdicts.CHALLENGE),
                "epic:c" to Attempt(count = 1, lastAt = now, verdict = Verdicts.TEACH, nextAt = now + 24 * hour),
            ),
        )
        val p = Recovery.plan(s, now)
        assertEquals(setOf("epic:a", "epic:b", "epic:c"), keys(p.needsYou).toSet())
        assertTrue(p.ready.isEmpty())
    }

    @Test
    fun whyANotTakenOfferIsNotTaken() {
        val s = state(
            offer("gog", store = Stores.GOG),
            offer("fab", store = Stores.FAB),
            offer("free", keepable = false),
            offer("extra", store = Stores.UBISOFT, source = "gamerpower", title = "Skin pack"),
            offer("nourl", url = null),
            offer("steam", store = Stores.STEAM),
            settings = Settings(claimGog = false),
        )
        val why = Recovery.plan(s, now).skipped.associate { it.offer.storeId to it.why }
        assertEquals(Why.STORE_OFF, why["gog"])
        assertEquals(Why.NO_ENGINE, why["fab"])
        assertEquals(Why.NOTHING_TO_KEEP, why["free"])
        assertEquals(Why.NO_ENGINE, why["extra"])
        assertEquals(Why.NO_ENGINE, why["nourl"])
        assertEquals(Why.STORE_OFF, why["steam"])
    }

    @Test
    fun anAlreadyClaimedOrOwnedOfferIsNotTakenAgain() {
        val claimed = LibraryEntry(store = Stores.EPIC, id = "a", title = "Jeu a", ts = now - 5 * hour)
        val s = state(
            offer("a"), offer("b"), offer("c"),
            library = mapOf(Rules.libraryKey(Stores.EPIC, "a") to claimed),
            attempts = mapOf("epic:c" to Attempt(count = 1, lastAt = now, verdict = Verdicts.OWNED)),
            deja = mapOf(Rules.dejaKey(Stores.EPIC, "Jeu b")!! to now),
        )
        val why = Recovery.plan(s, now).skipped.associate { it.offer.storeId to it.why }
        assertEquals(Why.ALREADY_CLAIMED, why["a"])
        assertEquals(Why.MARKED_OWNED, why["b"])
        assertEquals(Why.FINISHED, why["c"])
    }

    @Test
    fun anExpiredOfferIsNotListedAtAll() {
        val p = Recovery.plan(state(offer("a", end = now - 1)), now)
        assertTrue(p.ready.isEmpty() && p.skipped.isEmpty() && p.waiting.isEmpty() && p.needsYou.isEmpty())
    }

    @Test
    fun theRecentClaimsAreTheLatestTenNewestFirst() {
        val lib = (1..12).associate { i -> Rules.libraryKey(Stores.EPIC, "g$i") to LibraryEntry(store = Stores.EPIC, id = "g$i", title = "G$i", ts = now - i * hour) }
        val p = Recovery.plan(state(library = lib), now)
        assertEquals(10, p.recent.size)
        assertEquals("g1", p.recent.first().id)
        assertEquals("g10", p.recent.last().id)
    }

    @Test
    fun entriesThatAreNotAcquisitionsAreNotProofs() {
        val lib = mapOf(
            "epic:a" to LibraryEntry(store = Stores.EPIC, id = "a", title = "A", ts = now - hour, status = "claimed"),
            "epic:b" to LibraryEntry(store = Stores.EPIC, id = "b", title = "B", ts = now - 2 * hour, status = "skipped"),
        )
        assertEquals(listOf("a"), Recovery.plan(state(library = lib), now).recent.map { it.id })
    }

    @Test
    fun aCleanStateHasAnEmptyPlan() {
        val p = Recovery.plan(AppState(), now)
        assertTrue(p.ready.isEmpty() && p.needsYou.isEmpty() && p.waiting.isEmpty() && p.skipped.isEmpty() && p.recent.isEmpty())
        assertNull(p.nextRetry)
    }

    @Test
    fun theNextRetryIsTheEarliestWaitingOne() {
        val s = state(
            offer("a"), offer("b"),
            attempts = mapOf(
                "epic:a" to Attempt(count = 1, lastAt = now, verdict = Verdicts.FAILURE, nextAt = now + 5 * hour),
                "epic:b" to Attempt(count = 1, lastAt = now, verdict = Verdicts.FAILURE, nextAt = now + 2 * hour),
            ),
        )
        assertEquals(now + 2 * hour, Recovery.plan(s, now).nextRetry)
    }
}
