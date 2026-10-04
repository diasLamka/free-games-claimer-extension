package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.HealthGroup
import io.github.diaslamka.freegames.ui.shareText
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Le diagnostic part par le menu « Partager » d'Android, depuis la page Sante : un geste, sans cable ni adb. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class)
class HealthSharingTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int) = context.getString(id)

    @Test
    fun theHealthPageOffersToShareTheDiagnostic() {
        var shared = 0
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(), 1_790_000_000_000L, onShareDiagnostic = { shared++ }) } }
        compose.onNodeWithText(str(R.string.health_diag_hint), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_diag_share), ignoreCase = true).performClick()
        assertEquals(1, shared)
    }

    @Test
    fun theHealthPageOffersToTestTheBackgroundWatch() {
        var run = 0
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(), 1_790_000_000_000L, onRunTest = { run++ }) } }
        compose.onNodeWithText(str(R.string.health_test_hint), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_test_run), ignoreCase = true).performClick()
        assertEquals(1, run)
    }

    @Test
    fun theTextGoesToTheShareSheetWithItsSubject() {
        shareText(context, "contenu du diagnostic", "Sujet")
        val chooser = shadowOf(context as Application).nextStartedActivity
        assertNotNull(chooser)
        assertEquals(Intent.ACTION_CHOOSER, chooser.action)
        @Suppress("DEPRECATION")
        val send = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
        assertEquals(Intent.ACTION_SEND, send.action)
        assertEquals("text/plain", send.type)
        assertEquals("contenu du diagnostic", send.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals("Sujet", send.getStringExtra(Intent.EXTRA_SUBJECT))
    }
}
