package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Les reglages sont un menu (1.32.0) : une liste de rubriques avec leur resume, et une page par rubrique. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h3000dp")
class SettingsHubTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int) = context.getString(id)

    private fun show() = compose.setContent {
        FreeGamesTheme(dark = false) {
            SettingsScreen(AppState(), 1_790_000_000_000L, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
        }
    }

    @Test
    fun theSettingsOpenOnAMenuNotOnALongList() {
        show()
        for (title in listOf(R.string.section_health, R.string.accounts, R.string.section_claiming, R.string.section_watch, R.string.section_notifications, R.string.section_display, R.string.section_relay, R.string.section_family, R.string.section_data, R.string.section_about)) {
            compose.onNodeWithText(str(title)).assertExists()
        }
        // Aucun interrupteur du menu n'est affiche : ils vivent dans les pages.
        compose.onNodeWithText(str(R.string.set_wifi_only), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun aRowOpensItsPageAndBackReturnsToTheMenu() {
        show()
        compose.onNodeWithText(str(R.string.section_watch)).performClick()
        compose.onNodeWithText(str(R.string.set_wifi_only), ignoreCase = true).assertExists()
        compose.onNodeWithContentDescription(str(R.string.back)).performClick()
        compose.onNodeWithText(str(R.string.set_wifi_only), ignoreCase = true).assertDoesNotExist()
        compose.onNodeWithText(str(R.string.section_watch)).assertExists()
    }

    @Test
    fun eachRowSaysInOneLineWhatIsSet() {
        show()
        compose.onNodeWithText(context.getString(R.string.hub_accounts, 0, 4)).assertExists()
        compose.onNodeWithText(context.getString(R.string.hub_not_paired)).assertExists()
    }

}
