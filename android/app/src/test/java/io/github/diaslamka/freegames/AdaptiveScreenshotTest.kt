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
import io.github.diaslamka.freegames.data.Http
import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.text
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.EpicSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.sources.GogSource
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.ui.AdaptiveFrame
import io.github.diaslamka.freegames.ui.ClaimedScreen
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import java.util.Locale

/**
 * L'appli sur toutes les tailles d'ecran (1.3.0) : petit telephone, grande
 * police, paysage, pliable ouvert, tablette. Sur demande seulement (reseau),
 * comme ScreenshotTest :
 *
 *   ./gradlew testDebugUnitTest -Pscreens=true --tests '*AdaptiveScreenshotTest*'
 *
 * Les images arrivent dans app/build/screenshots/ (prefixe D-).
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class AdaptiveScreenshotTest {
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

    private val live: AppState by lazy {
        val http = Http({ "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" }, { null })
        runBlocking {
            val results = listOf(
                EpicSource.discover(http, now, "FR"), GogSource.discover(http, now), SteamSource.discover(http, now, "FR"),
                GamerPowerSource.discover(http, now), EpicMobileSource.discover(http, now, "FR"),
            )
            val offers = Watcher.merge(emptyMap(), results, now)
            val first = offers.values.firstOrNull { it.store == Stores.EPIC }
            AppState(
                offers = offers,
                upcoming = results[0].upcoming,
                library = listOfNotNull(
                    first?.let { "epic:${it.storeId}" to LibraryEntry(Stores.EPIC, it.storeId!!, it.shownTitle, it.url, it.worth, it.image, now - 3_600_000) },
                    "epic:hades" to LibraryEntry(Stores.EPIC, "hades", "Hades", null, "24,99 €", null, now - 40L * 86_400_000),
                    "gog:x" to LibraryEntry(Stores.GOG, "x", "Tyrian 2000", null, "5,99 €", null, now - 75L * 86_400_000, via = "extension"),
                    "amazon:y" to LibraryEntry(Stores.AMAZON, "y", "Fallout 76", null, "39,99 €", null, now - 80L * 86_400_000, via = "extension"),
                ).toMap(),
                sources = results.associate { it.name to SourceStatus(now - 600_000, it.ok, it.offers.size) },
                lastCheck = now - 600_000,
                accounts = mapOf(Stores.EPIC to AccountState("present", now), Stores.GOG to AccountState("ok", now, "diasLamka")),
            )
        }
    }

    private fun settle(ms: Long = 6000) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            Thread.sleep(150)
            ShadowLooper.idleMainLooper()
            compose.mainClock.advanceTimeBy(100)
        }
    }

    private fun shoot(name: String, tab: Int, dark: Boolean = true, screen: @Composable () -> Unit) {
        compose.setContent {
            FreeGamesTheme(dark = dark) { AdaptiveFrame(tab, {}) { screen() } }
        }
        settle()
        compose.onRoot().captureRoboImage("$dir/$name.png")
    }

    private val games: @Composable () -> Unit = {
        GamesScreen(live, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
    }
    private val settings: @Composable () -> Unit = {
        SettingsScreen(live, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    @Test
    @Config(qualifiers = "fr-rFR-w360dp-h640dp-night-xhdpi")
    fun petitTelephone() = shoot("D-1-petit-telephone", 0, screen = games)

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-night-xxhdpi")
    fun grandePolice() {
        RuntimeEnvironment.setFontScale(2.0f)
        shoot("D-2-grande-police", 0, screen = games)
    }

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-xxhdpi")
    fun grandePoliceReglages() {
        RuntimeEnvironment.setFontScale(2.0f)
        shoot("D-3-grande-police-reglages", 3, dark = false, screen = settings)
    }

    @Test
    @Config(qualifiers = "fr-rFR-w891dp-h411dp-land-night-xxhdpi")
    fun paysage() = shoot("D-4-paysage", 0, screen = games)

    @Test
    @Config(qualifiers = "fr-rFR-w673dp-h841dp-night-xxhdpi")
    fun pliable() = shoot("D-5-pliable", 0, screen = games)

    @Test
    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-night-xhdpi")
    fun tablette() = shoot("D-6-tablette", 0, screen = games)

    @Test
    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-xhdpi")
    fun tabletteRecuperes() = shoot("D-7-tablette-recuperes", 1, dark = false) { ClaimedScreen(live, onOpen = {}) }

    @Test
    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-night-xhdpi")
    fun tabletteReglages() = shoot("D-8-tablette-reglages", 3, screen = settings)

    /** Le PC a besoin de toi (1.4.0) : la demande d'aide en tete des jeux. */
    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-xxhdpi")
    fun aideDuPc() {
        val o = live.offers.values.first { it.store == Stores.EPIC && live.library.values.none { e -> e.id == it.storeId } }
        val s = live.copy(relay = io.github.diaslamka.freegames.model.RelayState(
            dev = "c0ffee01", pairedAt = now - 86_400_000L,
            help = mapOf("epic|x" to io.github.diaslamka.freegames.model.HelpRequest(Stores.EPIC, o.storeId ?: "", o.title, o.url, now + 3_600_000L, now - 60_000L)),
        ))
        shoot("D-9-aide-du-pc", 0, dark = false) {
            GamesScreen(s, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
        }
    }

    /** Attends, il sera offert (1.7.0) : les chances des souhaits. */
    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-night-xxhdpi")
    fun souhaitsChances() {
        val y = (365.25 * 24 * 3_600_000L).toLong()
        val s = live.copy(
            wishlist = listOf("Hades", "Tunic", "Marvel 1943 Rise of Hydra"),
            importedWishes = listOf(io.github.diaslamka.freegames.model.ImportedWish("Hollow Knight", Stores.STEAM, "367520")),
            passes = mapOf("tunic" to listOf(io.github.diaslamka.freegames.model.Seen(Stores.EPIC, now - y / 2))),
            odds = mapOf(
                "t:hades" to io.github.diaslamka.freegames.model.OddsInfo(at = now, appid = "1145360", released = now - 6 * y, basePrice = 24.5, currency = "EUR", publishers = listOf("Supergiant Games")),
                "t:tunic" to io.github.diaslamka.freegames.model.OddsInfo(at = now, appid = "553420", released = now - 4 * y, basePrice = 28.99, currency = "EUR", publishers = listOf("Finji")),
                "app:367520" to io.github.diaslamka.freegames.model.OddsInfo(at = now, appid = "367520", released = now - 9 * y, basePrice = 14.79, currency = "EUR", publishers = listOf("Team Cherry")),
                "t:marvel 1943 rise of hydra" to io.github.diaslamka.freegames.model.OddsInfo(at = now, notFound = true),
            ),
        )
        shoot("D-10-souhaits-chances", 2, dark = true) { io.github.diaslamka.freegames.ui.WishlistScreen(s, now, onAdd = {}, onRemove = {}) }
    }

    /** Ce soir je joue a... (1.8.0) : la carte de l'onglet Recuperes. */
    private val soir: AppState by lazy {
        val items = io.github.diaslamka.freegames.sources.parseJson(
            java.io.File(System.getProperty("fixtures"), "steam-getitems-tonight.json").readText(),
        )["response"]["store_items"].arr!!
        val apps = items.associate { it["appid"].text!! to io.github.diaslamka.freegames.data.Tonight.readItem(it, now)!! }
        val owned = listOf("1145360" to "Hades", "292030" to "The Witcher 3: Wild Hunt", "400" to "Portal", "501300" to "What Remains of Edith Finch", "646570" to "Slay the Spire")
            .associate { (id, t) -> "steam:$id" to io.github.diaslamka.freegames.model.OwnedGame(Stores.STEAM, id, t, "verified") }
        live.copy(
            owned = owned, tonightApps = apps,
            marks = mapOf("steam:501300" to io.github.diaslamka.freegames.model.Mark("toTry")),
            tonight = io.github.diaslamka.freegames.model.TonightPick(time = "evening", key = "steam:501300", at = now),
        )
    }

    @Test
    @Config(qualifiers = "fr-rFR-w411dp-h891dp-night-xxhdpi")
    fun ceSoir() = shoot("D-11-ce-soir", 1, dark = true) { ClaimedScreen(soir, onOpen = {}, now = now) }

    @Test
    @Config(qualifiers = "fr-rFR-w1280dp-h800dp-land-xhdpi")
    fun ceSoirTablette() = shoot("D-12-ce-soir-tablette", 1, dark = false) { ClaimedScreen(soir, onOpen = {}, now = now) }
}
