package io.github.diaslamka.freegames

import android.app.Application
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.tile.ClaimTile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** La tuile des reglages rapides (1.46.0) : ce qu'elle compte, et le seul geste qu'elle fait. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR-xxhdpi")
class ClaimTileTest {
    private val now = 1_790_540_000_000L
    private val h = 3_600_000L

    private fun offer(store: String, id: String, title: String, end: Long?, url: String? = "https://exemple.test/$id") =
        Offer(
            key = "$store:$id", source = "test", store = store, storeId = id, title = title, url = url,
            end = end, firstSeen = now - h, lastSeen = now,
        )

    private fun state(vararg o: Offer) = AppState(offers = o.associateBy { it.key })

    @Test
    fun withNothingFreeTheTileCountsNothing() {
        val f = ClaimTile.face(state(), now)
        assertEquals(0, f.free)
        assertEquals(0, f.claimable)
    }

    @Test
    fun everyOpenOfferIsCountedAndClaimable() {
        val f = ClaimTile.face(state(offer(Stores.EPIC, "hades", "Hades", now + 30 * h), offer(Stores.GOG, "celeste", "Celeste", now + 5 * h)), now)
        assertEquals(2, f.free)
        assertEquals(2, f.claimable)
    }

    @Test
    fun aFreeGameTheAppCannotTakeIsCountedButNotClaimable() {
        val sansLien = offer(Stores.GOG, "sans", "Sans lien", now + 5 * h, url = null)
        val f = ClaimTile.face(state(offer(Stores.EPIC, "hades", "Hades", now + 30 * h), sansLien), now)
        assertEquals(2, f.free)
        assertEquals(1, f.claimable)
    }

    @Test
    fun anOfferThatIsOverIsNotCounted() {
        val f = ClaimTile.face(state(offer(Stores.EPIC, "fini", "Fini", now - h), offer(Stores.EPIC, "hades", "Hades", now + 30 * h)), now)
        assertEquals(1, f.free)
    }

    @Test
    fun theTileCountsWhatTheWidgetShows() {
        val s = state(offer(Stores.EPIC, "hades", "Hades", now + 30 * h), offer(Stores.GOG, "celeste", "Celeste", now + 5 * h))
        assertEquals(io.github.diaslamka.freegames.widget.FreeNowWidget.items(s, now).size, ClaimTile.face(s, now).free)
    }

    @Test
    fun aTapWithSomethingToTakeOpensTheGamesTabAndAsksToClaimAll() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val i = ClaimTile.launch(context, claim = true)
        assertEquals(0, i.getIntExtra(MainActivity.EXTRA_TAB, -1))
        assertEquals("*", i.getStringExtra(MainActivity.EXTRA_CLAIM))
        assertEquals("claim:*", i.action)
        assertTrue(i.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun aTapWithNothingToTakeOnlyOpensTheApp() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val i = ClaimTile.launch(context, claim = false)
        assertEquals(0, i.getIntExtra(MainActivity.EXTRA_TAB, -1))
        assertNull("rien a reclamer : aucune demande de recuperation", i.getStringExtra(MainActivity.EXTRA_CLAIM))
        assertNull(i.action)
    }
}
