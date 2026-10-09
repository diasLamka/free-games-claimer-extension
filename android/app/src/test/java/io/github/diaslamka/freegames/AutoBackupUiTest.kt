package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.ui.HealthGroup
import io.github.diaslamka.freegames.ui.SECTION_DATA
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** La sauvegarde automatique, dans les Reglages et sur la page Sante (1.28.0). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h3000dp")
class AutoBackupUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private val day = 24 * 3_600_000L
    private val folder = "content://com.android.externalstorage.documents/tree/primary%3ADownload%2Ffgc"
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int, vararg a: Any) = context.getString(id, *a)

    private fun settings(state: AppState, onEnable: () -> Unit = {}, onNow: () -> Unit = {}, onOff: () -> Unit = {}) = compose.setContent {
        FreeGamesTheme(dark = false) {
            SettingsScreen(
                state, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {},
                onAutoEnable = onEnable, onAutoNow = onNow, onAutoDisable = onOff, open = listOf(SECTION_DATA),
            )
        }
    }

    @Test
    fun whenItIsOffTheSettingsOfferToTurnItOn() {
        var enabled = 0
        settings(AppState(), onEnable = { enabled++ })
        compose.onNodeWithText(str(R.string.auto_backup_hint), substring = true, ignoreCase = true).assertExists()
        compose.onNodeWithText(str(R.string.auto_backup_enable), ignoreCase = true).performClick()
        assertEquals(1, enabled)
    }

    @Test
    fun whenItIsOnTheSettingsSayWhereAndWhenAndOfferToRunOrStopIt() {
        var ran = 0
        var off = 0
        settings(AppState(settings = Settings(backupFolder = folder, backupAt = now - 2 * 3_600_000L)), onNow = { ran++ }, onOff = { off++ })
        compose.onNodeWithText(str(R.string.auto_backup_on, "Download/fgc"), substring = true, ignoreCase = true).assertExists()
        compose.onNodeWithText(str(R.string.auto_backup_last, Fmt.ago(context, now - 2 * 3_600_000L, now)), ignoreCase = true).assertExists()
        compose.onNodeWithText(str(R.string.auto_backup_now), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.auto_backup_off), ignoreCase = true).performClick()
        assertEquals(1, ran)
        assertEquals(1, off)
    }

    @Test
    fun aBackupNeverDoneSaysSo() {
        settings(AppState(settings = Settings(backupFolder = folder)))
        compose.onNodeWithText(str(R.string.auto_backup_never), ignoreCase = true).assertExists()
    }

    @Test
    fun aFailureIsSaidWithItsReason() {
        settings(AppState(settings = Settings(backupFolder = folder, backupAt = now - day, backupError = "folder")))
        compose.onNodeWithText(str(R.string.auto_backup_error, str(R.string.auto_backup_err_folder)), ignoreCase = true).assertExists()
    }

    @Test
    fun theHealthPageWarnsWhenTheBackupHasBeenFailingForDays() {
        val old = Settings(backupFolder = folder, backupAt = now - 5 * day)
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(settings = old), now) } }
        compose.onNodeWithText(str(R.string.health_auto_backup_overdue, Fmt.ago(context, now - 5 * day, now)), ignoreCase = true).assertExists()
    }

    @Test
    fun theHealthPageSaysNothingOfABackupThatWorksOrIsOff() {
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(settings = Settings(backupFolder = folder, backupAt = now - day)), now) } }
        compose.onNodeWithText(str(R.string.health_auto_backup_overdue, Fmt.ago(context, now - day, now)), ignoreCase = true).assertDoesNotExist()
    }
}
