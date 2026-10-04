package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
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
    fun theLatestPassesAreListedWithTheirOutcome() {
        val log = listOf(
            PassRecord(at = now - 600_000, ms = 4_200, reason = "fond", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true, claimed = 2),
            PassRecord(at = now - 7_200_000, ms = 1_000, reason = "test", outcome = PassLog.FAILED, errors = listOf("reseau coupe")),
        )
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(watchLog = log), now) } }
        // La ligne du passage de fond : la raison, ce qu'il a trouve, sa duree.
        compose.onNodeWithText(str(R.string.pass_reason_fond), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText("14", substring = true).assertIsDisplayed()
        compose.onNodeWithText("4 s", substring = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.pass_screen_off), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.pass_claimed, 2), substring = true, ignoreCase = true).assertIsDisplayed()
        // Le passage en echec dit pourquoi.
        compose.onNodeWithText(str(R.string.pass_outcome_failed), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText("reseau coupe", substring = true).assertIsDisplayed()
    }
}
