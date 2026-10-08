package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.SECTION_DATA
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Reglages > Donnees : la sauvegarde complete et chiffree s'exporte et se restaure (1.28.0). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h3000dp")
class VaultButtonsTest {
    @get:Rule
    val compose = createComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int) = context.getString(id)

    @Test
    fun theEncryptedBackupCanBeExportedAndRestored() {
        var exported = 0
        var restored = 0
        compose.setContent {
            FreeGamesTheme(dark = false) {
                SettingsScreen(
                    AppState(), 1_790_000_000_000L, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {},
                    onVaultExport = { exported++ }, onVaultRestore = { restored++ }, open = listOf(SECTION_DATA),
                )
            }
        }
        compose.onNodeWithText(str(R.string.backup_vault_hint), substring = true, ignoreCase = true).assertExists()
        compose.onNodeWithText(str(R.string.backup_vault_export), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.backup_vault_restore), ignoreCase = true).performClick()
        assertEquals(1, exported)
        assertEquals(1, restored)
    }
}
