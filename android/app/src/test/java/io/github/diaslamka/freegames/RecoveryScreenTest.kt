package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.RecoveryScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Le centre de recuperation (1.31.0) : l'etat, le geste, et la liste de ce qui serait pris. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "w400dp-h2000dp")
class RecoveryScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private fun str(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)
    private val offer = Offer(key = "epic:a", source = "epic-api", store = Stores.EPIC, storeId = "a", title = "Hades", url = "https://example.test/a", end = now + 86_400_000)

    private fun show(state: AppState, claiming: Boolean = false, onClaim: (Set<String>) -> Unit = {}) = compose.setContent {
        FreeGamesTheme(dark = false) { RecoveryScreen(state, now, claiming, onClaim, onOpen = {}, onAccounts = {}) }
    }

    @Test
    fun aGameToTakeShowsTheClaimAllButtonThatClaimsEverything() {
        val asked = mutableListOf<Set<String>>()
        show(AppState(offers = mapOf(offer.key to offer)), onClaim = { asked += it })
        compose.onNodeWithText("Hades").assertExists()
        compose.onNodeWithText(str(R.string.rec_claim_all)).performClick()
        assertEquals(listOf(emptySet<String>()), asked)
    }

    @Test
    fun aRowCanBeClaimedOnItsOwn() {
        val asked = mutableListOf<Set<String>>()
        show(AppState(offers = mapOf(offer.key to offer)), onClaim = { asked += it })
        compose.onNodeWithText(str(R.string.rec_claim)).performClick()
        assertEquals(listOf(setOf("epic:a")), asked)
    }

    @Test
    fun nothingToTakeSaysSoWithoutAButton() {
        show(AppState())
        compose.onNodeWithText(str(R.string.rec_status_quiet)).assertExists()
        compose.onNodeWithText(str(R.string.rec_claim_all)).assertDoesNotExist()
    }

    @Test
    fun whileClaimingTheButtonGivesWayToTheProgress() {
        show(AppState(offers = mapOf(offer.key to offer)), claiming = true)
        compose.onNodeWithText(str(R.string.rec_status_busy)).assertExists()
        compose.onNodeWithText(str(R.string.rec_claim_all)).assertDoesNotExist()
    }
}
