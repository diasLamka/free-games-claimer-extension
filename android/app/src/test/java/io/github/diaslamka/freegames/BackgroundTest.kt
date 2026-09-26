package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.claim.BackgroundClaim
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundTest {
    private val now = 1_790_000_000_000L
    private fun offer(store: String, id: String, title: String) =
        Offer(key = Offer.keyFor(store, id, title), source = "x", store = store, storeId = id, title = title,
            url = "https://example.test/$id", end = now + 86_400_000, keepable = true)

    private val epic = offer(Stores.EPIC, "hades", "Hades")
    private val gog = offer(Stores.GOG, "gris", "Gris")

    @Test
    fun offByDefaultAndOnlyForSignedInStores() {
        val base = AppState(
            offers = listOf(epic, gog).associateBy { it.key },
            accounts = mapOf(
                Stores.EPIC to AccountState(Accounts.OK, now),
                Stores.GOG to AccountState(Accounts.LOGGED_OUT, now),
            ),
        )
        assertTrue(BackgroundClaim.todo(base, now).isEmpty())
        val on = base.copy(settings = Settings(claimInBackground = true))
        assertEquals(listOf("Hades"), BackgroundClaim.todo(on, now).map { it.title })
    }

    @Test
    fun anUnattendedChallengeWaitsFourHoursButAHumanOneDoesNot() {
        val alone = Rules.afterVerdict(null, Verdicts.CHALLENGE, "captcha", now, unattended = true)
        assertEquals(now + Verdicts.BACKOFF_MS[2], alone.nextAt)
        assertEquals(0, alone.count)
        val watched = Rules.afterVerdict(null, Verdicts.CHALLENGE, "captcha", now)
        assertNull(watched.nextAt)

        val s = AppState(
            offers = mapOf(epic.key to epic),
            attempts = mapOf(epic.key to alone),
            accounts = mapOf(Stores.EPIC to AccountState(Accounts.OK, now)),
            settings = Settings(claimInBackground = true),
        )
        assertTrue(BackgroundClaim.todo(s, now + 60_000).isEmpty())
        // Un appui sur la notification passe outre le recul.
        assertEquals(listOf("Hades"), Rules.pending(s, now + 60_000, force = setOf(epic.key)).map { it.title })
        assertEquals(listOf("Hades"), BackgroundClaim.todo(s, now + Verdicts.BACKOFF_MS[2] + 1).map { it.title })
    }
}
