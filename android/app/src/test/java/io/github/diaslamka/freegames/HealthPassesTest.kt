package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.ui.HealthGroup
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals

/** La page Sante montre les derniers passages de la veille : c'est la preuve qu'une passe de fond a tourne. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class HealthPassesTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private fun str(id: Int, vararg a: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *a)

    @Test
    fun anEmptyLogSaysSo() {
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(), now) } }
        compose.onNodeWithText(str(R.string.health_passes_none)).assertIsDisplayed()
    }

    @Test
    fun aStalledWatchIsSaidWithAWayToTheAppSettings() {
        var opened = 0
        // Dernier passage il y a neuf heures, pour une veille attendue toutes les trois : plus de deux fois et demie.
        val state = AppState(lastCheck = now - 9 * 3_600_000L)
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(state, now, onAppSettings = { opened++ }) } }
        compose.onNodeWithText(str(R.string.health_watch_stalled, "9 h", 3), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_app_settings_open), ignoreCase = true).performClick()
        assertEquals(1, opened)
    }

    @Test
    fun aWatchThatRunsSaysNothingOfTheKind() {
        val state = AppState(lastCheck = now - 3_600_000L)
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(state, now) } }
        compose.onNodeWithText(str(R.string.health_app_settings_open), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun theLatestPassesAreListedWithTheirOutcome() {
        val log = listOf(
            PassRecord(at = now - 600_000, ms = 4_200, reason = "fond", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true, claimed = 2),
            PassRecord(at = now - 7_200_000, ms = 1_000, reason = "test", outcome = PassLog.FAILED, errors = listOf("reseau coupe")),
        )
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(watchLog = log), now) } }
        // La ligne du passage de fond, en entier : quand, la raison, ce qu'il a trouve, sa duree. (Le mot de la raison seul est ambigu : « background » est aussi dans le bouton de test.)
        val ago = Fmt.ago(ApplicationProvider.getApplicationContext<Context>(), now - 600_000, now)
        compose.onNodeWithText(str(R.string.health_pass_line, ago, str(R.string.pass_reason_fond), 14, 1, "4 s")).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.pass_screen_off), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.pass_claimed, 2), substring = true, ignoreCase = true).assertIsDisplayed()
        // Le passage en echec dit pourquoi.
        compose.onNodeWithText(str(R.string.pass_outcome_failed), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText("reseau coupe", substring = true).assertIsDisplayed()
    }
}
