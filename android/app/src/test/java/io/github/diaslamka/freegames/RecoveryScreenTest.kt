package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.FailureReport
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.RecoveryScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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
        compose.onNodeWithText(str(R.string.rec_claim_all), ignoreCase = true).performClick()
        assertEquals(listOf(emptySet<String>()), asked)
    }

    @Test
    fun aRowCanBeClaimedOnItsOwn() {
        val asked = mutableListOf<Set<String>>()
        show(AppState(offers = mapOf(offer.key to offer)), onClaim = { asked += it })
        compose.onNodeWithText(str(R.string.rec_claim), ignoreCase = true).performClick()
        assertEquals(listOf(setOf("epic:a")), asked)
    }

    @Test
    fun nothingToTakeSaysSoWithoutAButton() {
        show(AppState())
        compose.onNodeWithText(str(R.string.rec_status_quiet)).assertExists()
        compose.onNodeWithText(str(R.string.rec_claim_all), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun whileClaimingTheButtonGivesWayToTheProgress() {
        show(AppState(offers = mapOf(offer.key to offer)), claiming = true)
        compose.onNodeWithText(str(R.string.rec_status_busy)).assertExists()
        compose.onNodeWithText(str(R.string.rec_claim_all), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun theSimulationButtonExplainsWhatWouldHappen() {
        show(AppState(offers = mapOf(offer.key to offer)))
        compose.onNodeWithText(str(R.string.rec_simulate), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.rec_sim_title), ignoreCase = true).assertExists()
        compose.onNodeWithText(str(R.string.rec_sim_claim), substring = true, ignoreCase = true).assertExists()
    }

    @Test
    fun aClaimedGameWithAProofOffersIt() {
        val entry = LibraryEntry(store = Stores.EPIC, id = "a", title = "Hades", ts = now - 3_600_000, proof = "epic-a.jpg")
        show(AppState(library = mapOf("epic:a" to entry)))
        compose.onNodeWithText(str(R.string.rec_proof), ignoreCase = true).assertExists()
    }

    @Test
    fun aClaimedGameWithoutAProofOffersNone() {
        val entry = LibraryEntry(store = Stores.EPIC, id = "a", title = "Hades", ts = now - 3_600_000)
        show(AppState(library = mapOf("epic:a" to entry)))
        compose.onNodeWithText(str(R.string.rec_proof), ignoreCase = true).assertDoesNotExist()
    }

    private fun blocked(withFailure: Boolean): AppState {
        val page = buildJsonObject {
            put("url", "https://www.gog.com/redeem?token=SECRET"); put("title", "GOG"); put("text", "Something changed on this page")
        }
        val failure = if (withFailure) FailureReport.of(Verdicts.CHALLENGE, "defi", page, now - 60_000) else null
        val attempt = Attempt(count = 1, lastAt = now - 60_000, verdict = Verdicts.CHALLENGE, failure = failure)
        return AppState(offers = mapOf(offer.key to offer), attempts = mapOf(offer.key to attempt))
    }

    @Test
    fun aBlockedGameWithAFailureOffersTheReportAndTheReportShowsThePage() {
        show(blocked(withFailure = true))
        compose.onNodeWithText(str(R.string.rec_report), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.rec_report_title), ignoreCase = true).assertExists()
        compose.onNodeWithText("Something changed on this page", substring = true).assertExists()
        compose.onNodeWithText("https://www.gog.com/redeem", substring = true).assertExists()
        compose.onNodeWithText(str(R.string.rec_report_copy), ignoreCase = true).assertExists()
    }

    @Test
    fun aBlockedGameWithoutAFailureOffersNoReport() {
        show(blocked(withFailure = false))
        compose.onNodeWithText("Hades").assertExists()
        compose.onNodeWithText(str(R.string.rec_report), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun theAutonomyCardSaysItDoesNotClaimAloneWhileBackgroundClaimingIsOff() {
        show(AppState(offers = mapOf(offer.key to offer)))
        compose.onNodeWithText(str(R.string.aut_off)).assertExists()
        compose.onNodeWithText(str(R.string.aut_why_off)).assertExists()
        compose.onNodeWithText(str(R.string.aut_settings), ignoreCase = true).assertExists()
    }

    @Test
    fun theAutonomyCardSaysItClaimsAloneWhenNothingIsInTheWayAndCountsWhatItTook() {
        val entry = LibraryEntry(store = Stores.EPIC, id = "b", title = "Autre", ts = now - 3_600_000, alone = true)
        show(AppState(offers = mapOf(offer.key to offer), library = mapOf("epic:b" to entry), settings = Settings(claimInBackground = true)))
        compose.onNodeWithText(str(R.string.aut_on)).assertExists()
        compose.onNodeWithText("14", substring = true).assertExists()
        compose.onNodeWithText(str(R.string.aut_why_off)).assertDoesNotExist()
    }
}
