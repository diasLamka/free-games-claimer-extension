package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.semantics.SemanticsNode
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.ui.SECTION_WATCH
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Reglages > Veille : la veille de fond peut attendre le Wi-Fi, ou la charge (1.28.0). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// Un ecran assez haut pour que toute la section soit a l'ecran : pas de defilement dans le test.
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h3000dp")
class WatchConstraintsToggleTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int) = context.getString(id)

    private fun show(onSettings: ((Settings) -> Settings) -> Unit) = compose.setContent {
        FreeGamesTheme(dark = false) {
            SettingsScreen(AppState(), 1_790_000_000_000L, onLogin = {}, onSettings = onSettings, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {}, open = listOf(SECTION_WATCH))
        }
    }

    /** L'interrupteur n'est pas la ligne : c'est la paire « ON / OFF » a sa droite, a la hauteur du titre et de son explication. */
    private fun turnOn(title: Int, hint: Int) {
        val top = compose.onNodeWithText(str(title), ignoreCase = true).fetchSemanticsNode().boundsInRoot.top
        val bottom = compose.onNodeWithText(str(hint), ignoreCase = true).fetchSemanticsNode().boundsInRoot.bottom
        val inRow = SemanticsMatcher("a la hauteur de la ligne") { node: SemanticsNode -> node.boundsInRoot.center.y in top..bottom }
        compose.onAllNodes(hasText(str(R.string.toggle_on), ignoreCase = true) and inRow).onFirst().performClick()
    }

    @Test
    fun theWatchCanBeLimitedToWifi() {
        var applied: Settings? = null
        show { change -> applied = change(Settings()) }
        turnOn(R.string.set_wifi_only, R.string.set_wifi_only_hint)
        assertTrue(applied!!.wifiOnly)
        assertEquals(false, applied!!.chargingOnly)
    }

    @Test
    fun theWatchCanBeLimitedToCharging() {
        var applied: Settings? = null
        show { change -> applied = change(Settings()) }
        turnOn(R.string.set_charging_only, R.string.set_charging_only_hint)
        assertTrue(applied!!.chargingOnly)
        assertEquals(false, applied!!.wifiOnly)
    }
}
