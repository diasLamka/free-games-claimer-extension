package io.github.diaslamka.freegames

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.imageDecoderEnabled
import coil3.request.allowHardware
import com.github.takahirom.roborazzi.captureRoboImage
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.AdaptiveFrame
import io.github.diaslamka.freegames.ui.ClaimedScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.util.Locale

/**
 * « Ta soiree choisit le jeu » (1.23.0) en images, sans reseau : la carte du soir en mode agenda.
 *
 *   ./gradlew testDebugUnitTest -Pscreens=true --tests '*EveningScreenshotTest*'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class EveningScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val dir = System.getProperty("screenshots") ?: "build/screenshots"
    private val now = System.currentTimeMillis()

    @OptIn(coil3.annotation.DelicateCoilApi::class)
    @Before
    fun only() {
        assumeTrue(System.getProperty("fgc.screens") == "true")
        Locale.setDefault(Locale.FRANCE)
        SingletonImageLoader.setUnsafe { ctx -> ImageLoader.Builder(ctx).allowHardware(false).imageDecoderEnabled(false).build() }
    }

    private val state: AppState by lazy {
        fun info(id: String, n: String) = io.github.diaslamka.freegames.model.TonightInfo(at = now, v = io.github.diaslamka.freegames.data.Tonight.INFO_VERSION, name = n, percent = 94, reviews = 20_000, description = "Un jeu de la pile, pour ta soiree.")
        AppState(
            owned = mapOf(
                "steam:1" to io.github.diaslamka.freegames.model.OwnedGame("steam", "1", "Hades"),
                "steam:2" to io.github.diaslamka.freegames.model.OwnedGame("steam", "2", "The Witcher 3"),
            ),
            tonightApps = mapOf("1" to info("1", "Hades"), "2" to info("2", "The Witcher 3")),
            medians = mapOf(
                "1" to io.github.diaslamka.freegames.model.PlayMedian(at = now, minutes = 150, n = 80),
                "2" to io.github.diaslamka.freegames.model.PlayMedian(at = now, minutes = 3000, n = 80),
            ),
            evening = io.github.diaslamka.freegames.model.EveningState(at = now, minutes = 210, from = now, to = now + 210 * 60_000L, earlyWake = true),
            tonight = io.github.diaslamka.freegames.model.TonightPick(time = io.github.diaslamka.freegames.data.Tonight.CALENDAR),
        )
    }

    private fun settle(ms: Long = 1500) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            Thread.sleep(100)
            ShadowLooper.idleMainLooper()
            compose.mainClock.advanceTimeBy(100)
        }
    }

    private fun shoot(name: String, tab: Int, dark: Boolean, screen: @Composable () -> Unit) {
        compose.setContent { FreeGamesTheme(dark = dark) { AdaptiveFrame(tab, {}) { screen() } } }
        settle()
        compose.onRoot().captureRoboImage("$dir/$name.png")
    }

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h1100dp-night-xxhdpi")
    fun soireeAgenda() = shoot("C-1-soiree-agenda", 1, dark = true) { ClaimedScreen(state, onOpen = {}, now = now) }
}
