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
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.PriceCheck
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.AdaptiveFrame
import io.github.diaslamka.freegames.ui.ClaimedScreen
import io.github.diaslamka.freegames.ui.GamesScreen
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
 * « Piege ou bonne affaire ? » (1.22.0) en images, sans reseau : trois offres
 * jugees (A, C gonflee, D gratuite de toute facon) et le chiffre verifie.
 *
 *   ./gradlew testDebugUnitTest -Pscreens=true --tests '*BargainScreenshotTest*'
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class BargainScreenshotTest {
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

    private fun offer(id: String, title: String, source: String, worth: String?, store: String = Stores.EPIC, keepable: Boolean? = true) = Offer(
        key = "$store:$id", source = source, store = store, storeId = id, title = title, worth = worth, keepable = keepable,
        end = now + 3 * 86_400_000L, firstSeen = now, lastSeen = now,
    )

    private val state: AppState by lazy {
        val hades = offer("hades", "Hades", "epic-api", "24,99 EUR")
        val gonfle = offer("111", "Gonfle Quest", "gamerpower", "$60.00", Stores.STEAM)
        val libre = offer("libre", "Libre Toujours", "epic-api", null, keepable = false)
        AppState(
            offers = listOf(hades, gonfle, libre).associateBy { it.key },
            ratings = mapOf(
                "t:${hades.normalisedTitle}" to Rating(at = now, percent = 92, total = 100_000, score = 9, appid = "1145360"),
                "app:111" to Rating(at = now, percent = 90, total = 1000, score = 8, appid = "111"),
            ),
            checks = mapOf("app:111" to PriceCheck(at = now, type = "game", price = 19.99, currency = "USD")),
            library = mapOf(
                "epic:old" to LibraryEntry(Stores.EPIC, "old", "Ancien", null, "24,99 EUR", null, now - 86_400_000L, wsrc = "store"),
                "steam:111b" to LibraryEntry(Stores.AMAZON, "luna", "Luna X", null, "$14.99", null, now - 2 * 86_400_000L, wsrc = "aggregator"),
            ),
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
    @Config(qualifiers = "fr-rFR-w411dp-h1500dp-xxhdpi")
    fun cartesJugees() = shoot("B-1-cartes", 0, dark = false) {
        GamesScreen(state, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
    }

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-night-xxhdpi")
    fun chiffreVerifie() = shoot("B-2-verifie", 1, dark = true) { ClaimedScreen(state, onOpen = {}) }
}
