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
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Tiles
import io.github.diaslamka.freegames.ui.AdaptiveFrame
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.After
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
 * L'accueil (1.25.0) en images : les trois facons de poser les jeux, sans bouton « Recuperer », et le bandeau
 * de mise a jour.
 *
 *   ./gradlew testDebugUnitTest -Pscreens=true --tests '*TilesScreenshotTest*'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class TilesScreenshotTest {
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

    @After
    fun reset() { AppUpdate.status.value = AppUpdate.Status.Idle }

    private fun offer(id: String, title: String, store: String, worth: String?, hours: Long) = Offer(
        key = "$store:$id", source = if (store == Stores.EPIC) "epic-api" else "gog", store = store, storeId = id, title = title, worth = worth,
        keepable = true, url = "https://example.test/$id", end = now + hours * 3_600_000L, firstSeen = now, lastSeen = now,
    )

    private fun state(tiles: String): AppState {
        val list = listOf(
            offer("hades", "Hades", Stores.EPIC, "24,99 EUR", 70),
            offer("bounty", "Bounty Train", Stores.GOG, "19,99 EUR", 9),
            offer("celeste", "Celeste", Stores.EPIC, "19,99 EUR", 130),
            offer("tunic", "Tunic", Stores.GOG, "29,99 EUR", 40),
            offer("inscryption", "Inscryption", Stores.EPIC, null, 200),
        )
        return AppState(
            offers = list.associateBy { it.key },
            library = mapOf("epic:celeste" to LibraryEntry(Stores.EPIC, "celeste", "Celeste", null, "19,99 EUR", null, now - 3_600_000L, status = Verdicts.CLAIMED)),
            attempts = mapOf("gog:tunic" to Attempt(count = 2, lastAt = now, verdict = Verdicts.FAILURE, details = "bouton introuvable")),
            lastCheck = now,
            settings = Settings(tiles = tiles),
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

    private fun shoot(name: String, dark: Boolean, screen: @Composable () -> Unit) {
        compose.setContent { FreeGamesTheme(dark = dark) { AdaptiveFrame(0, {}) { screen() } } }
        settle()
        compose.onRoot().captureRoboImage("$dir/$name.png")
    }

    private fun games(s: AppState) = @Composable {
        GamesScreen(s, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
    }

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h1500dp-xxhdpi")
    fun grandes() = shoot("T-1-grandes", dark = false, games(state(Tiles.CARDS)))

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h1100dp-xxhdpi")
    fun liste() = shoot("T-2-liste", dark = false, games(state(Tiles.LIST)))

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h1100dp-xxhdpi")
    fun grille() = shoot("T-3-grille", dark = false, games(state(Tiles.GRID)))

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h1100dp-night-xxhdpi")
    fun grilleSombreAvecMiseAJour() {
        AppUpdate.status.value = AppUpdate.Status.Available(
            AppUpdate.Release("1.25.0", "app-v1.25.0", 1, "free-games-claimer-android-1.25.0.apk", 1, null, ""),
        )
        shoot("T-4-grille-sombre-maj", dark = true, games(state(Tiles.GRID)))
    }
}
