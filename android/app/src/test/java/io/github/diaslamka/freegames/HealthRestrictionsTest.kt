package io.github.diaslamka.freegames

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Restrictions
import io.github.diaslamka.freegames.data.Restrictions.Exit
import io.github.diaslamka.freegames.data.Restrictions.Maker
import io.github.diaslamka.freegames.data.Restrictions.Snapshot
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.HealthGroup
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** La page Sante dit ce qu'Android fait de la veille, et guide pour l'en empecher (1.28.0). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w400dp-h3000dp")
class HealthRestrictionsTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int, vararg a: Any) = context.getString(id, *a)

    private fun show(snapshot: Snapshot?, maker: Maker = Maker.OTHER, manufacturer: String = "", onApp: () -> Unit = {}, onBattery: () -> Unit = {}) =
        compose.setContent {
            FreeGamesTheme(dark = false) {
                HealthGroup(AppState(), now, restrictions = snapshot, maker = maker, manufacturer = manufacturer, onAppSettings = onApp, onBatterySettings = onBattery)
            }
        }

    @Test
    fun whatAndroidDidToTheWatchIsSaid() {
        val s = Snapshot(
            bucket = 40, backgroundRestricted = true,
            exits = listOf(
                Exit(now - 2 * hour, Restrictions.REASON_FREEZER, 300),
                Exit(now - 3 * hour, Restrictions.REASON_USER_REQUESTED, 400),
            ),
        )
        show(s)
        compose.onNodeWithText(str(R.string.health_bucket_limited, str(R.string.bucket_rare)), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_background_restricted), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_killed, 1, "2 h"), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_stopped_by_user, 1, "3 h"), ignoreCase = true).assertIsDisplayed()
    }

    @Test
    fun aHealthyAppSaysNothingOfTheKind() {
        show(Snapshot(bucket = 10, backgroundRestricted = false))
        compose.onNodeWithText(str(R.string.health_background_restricted), ignoreCase = true).assertDoesNotExist()
        compose.onNodeWithText(str(R.string.health_bucket_limited, str(R.string.bucket_rare)), ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun theGuideOpensWithTheStepsOfThePhoneMaker() {
        var app = 0
        var battery = 0
        show(Snapshot(), Maker.OPLUS, "OnePlus", onApp = { app++ }, onBattery = { battery++ })
        compose.onNodeWithText(str(R.string.health_guide_open), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.health_guide_title), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.guide_oplus), substring = true, ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_battery_open), ignoreCase = true).performClick()
        assertEquals(1, battery)
        compose.onNodeWithText(str(R.string.health_app_settings_open), ignoreCase = true).performClick()
        assertEquals(1, app)
    }

    @Test
    fun aMakerWithoutItsOwnStepsGetsTheGenericOnesAndItsName() {
        show(Snapshot(), Maker.OTHER, "Fairphone")
        compose.onNodeWithText(str(R.string.health_guide_open), ignoreCase = true).performClick()
        compose.onNodeWithText(str(R.string.health_guide_intro, "Fairphone"), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.guide_other), substring = true, ignoreCase = true).assertIsDisplayed()
    }
}
