package io.github.diaslamka.freegames

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.imageDecoderEnabled
import coil3.request.allowHardware
import com.github.takahirom.roborazzi.captureRoboImage
import io.github.diaslamka.freegames.data.Http
import io.github.diaslamka.freegames.data.Ratings
import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.EpicSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.sources.GogSource
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.ui.ClaimedScreen
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.SettingsScreen
import io.github.diaslamka.freegames.ui.WishlistScreen
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.ui.BrutTabs
import io.github.diaslamka.freegames.ui.ClaimPanelContent
import io.github.diaslamka.freegames.ui.Cover
import io.github.diaslamka.freegames.ui.theme.Accent
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import kotlinx.coroutines.runBlocking
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
 * Les ecrans, rendus hors telephone, sur les VRAIES offres du moment -- pour
 * les regarder, pas pour les comparer. Sur demande seulement (reseau) :
 *
 *   ./gradlew testDebugUnitTest -Pscreens=true --tests '*ScreenshotTest*'
 *
 * Les images arrivent dans app/build/screenshots/.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "fr-rFR-w400dp-h880dp-night-xxhdpi", application = android.app.Application::class)
class ScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val dir = System.getProperty("screenshots") ?: "build/screenshots"
    private val now = System.currentTimeMillis()

    @OptIn(coil3.annotation.DelicateCoilApi::class)
    @Before
    fun only() {
        assumeTrue(System.getProperty("fgc.screens") == "true")
        Locale.setDefault(Locale.FRANCE)
        // Robolectric ne sait pas faire de bitmap materielle : Coil y renoncerait en silence.
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
            val ratings = offers.values.filter { Ratings.eligible(it) }.take(6).mapNotNull { o ->
                runCatching { Ratings.key(o) to Ratings.fetch(http, o, "FR", now) }.getOrNull()
            }.toMap()
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
                wishlist = listOf("Hollow Knight: Silksong", "Hades II"),
                ratings = ratings,
                sources = results.associate { it.name to SourceStatus(now - 600_000, it.ok, it.offers.size) },
                lastCheck = now - 600_000,
                accounts = mapOf(
                    Stores.EPIC to AccountState("present", now), Stores.GOG to AccountState("ok", now, "diasLamka"),
                    Stores.AMAZON to AccountState("logged_out", now),
                ),
            )
        }
    }

    /** Coil charge sur le reseau : on laisse le temps aux jaquettes d'arriver. */
    private fun settle(ms: Long = 6000) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            Thread.sleep(150)
            ShadowLooper.idleMainLooper()
            compose.mainClock.advanceTimeBy(100)
        }
    }

    private fun shoot(name: String, accent: Accent = Accent.JAUNE, dark: Boolean = true, tabs: Int? = null, scrollTo: String? = null, content: @Composable () -> Unit) {
        compose.setContent {
            FreeGamesTheme(accent = accent, dark = dark) {
                Column(Modifier.fillMaxSize().background(LocalBrut.current.base)) {
                    Box(Modifier.weight(1f)) { content() }
                    if (tabs != null) BrutTabs(tabs) {}
                }
            }
        }
        settle()
        if (scrollTo != null) {
            compose.onNode(androidx.compose.ui.test.hasScrollAction())
                .performScrollToNode(androidx.compose.ui.test.hasText(scrollTo, substring = true, ignoreCase = true))
            settle(1500)
        }
        compose.onRoot().captureRoboImage("$dir/$name.png")
    }

    private val games: @Composable () -> Unit = {
        GamesScreen(live, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
    }

    @Test
    fun jeuxJauneNuit() = shoot("A-jeux-sombre", Accent.JAUNE, dark = true, tabs = 0, content = games)

    @Test
    fun jeuxJaunePapier() = shoot("B-jeux-clair", Accent.JAUNE, dark = false, tabs = 0, content = games)

    @Test
    fun reglagesJaunePapier() = shoot("B-reglages-clair", Accent.JAUNE, dark = false, tabs = 3) {
        SettingsScreen(live, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }




    @Test
    @Config(qualifiers = "+h2600dp")
    fun jeuxLong() = shoot("A-jeux-long", Accent.JAUNE, dark = true, content = games)

    @Test
    fun claimed() = shoot("A-recuperes", Accent.JAUNE, dark = true, tabs = 1) { ClaimedScreen(live, onOpen = {}) }

    @Test
    fun wishlist() = shoot("A-souhaits", Accent.JAUNE, dark = true, tabs = 2) { WishlistScreen(live, now, onAdd = {}, onRemove = {}) }

    @Test
    @Config(qualifiers = "+h1500dp")
    fun settings() = shoot("A-reglages", Accent.JAUNE, dark = true, tabs = 3) {
        SettingsScreen(live, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    /* 1.2.0 : la recuperation ecran eteint, le relais avec le PC, la confidentialite. */
    private val paired: AppState by lazy {
        live.copy(
            settings = live.settings.copy(claimInBackground = true),
            relay = io.github.diaslamka.freegames.model.RelayState(dev = "c0ffee01", pairedAt = now - 86_400_000, peerRole = "pc", peerAt = now - 1_800_000),
        )
    }

    @Test
    fun reglagesEcranEteint() = shoot("C-reglages-ecran-eteint", Accent.JAUNE, dark = true, tabs = 3, scrollTo = "Steam") {
        SettingsScreen(paired, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    @Test
    fun reglagesRelais() = shoot("C-reglages-relais", Accent.JAUNE, dark = false, tabs = 3, scrollTo = "Dissocier") {
        SettingsScreen(paired, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    @Test
    fun reglagesRelaisLibre() = shoot("C-reglages-relais-libre", Accent.JAUNE, dark = true, tabs = 3, scrollTo = "Scanner") {
        SettingsScreen(live, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    @Test
    fun reglagesConfidentialite() = shoot("C-reglages-confidentialite", Accent.JAUNE, dark = true, tabs = 3, scrollTo = "désinstaller") {
        SettingsScreen(paired, now, onLogin = {}, onSettings = {}, onImport = {}, onExport = {}, onClearSessions = {}, onCheckNow = {})
    }

    @Test
    fun claimPanel() = shoot("A-recuperation", Accent.JAUNE, dark = true) {
        val first = live.offers.values.first { it.store == Stores.EPIC }
        Column {
            ClaimPanelContent(
                ClaimSession.Ui(
                    running = true, title = first.shownTitle, store = Stores.EPIC, index = 2, total = 3, step = ClaimSession.STEP_CLAIM, visible = true,
                    outcomes = listOf(ClaimSession.Outcome("x", "Hades", Stores.EPIC, "claimed", null)),
                ),
                onToggle = null, onStop = {}, onDismiss = {}, onUser = {},
            ) { m -> Cover(first.image, first.shownTitle, first.store, m) }
            ClaimPanelContent(
                ClaimSession.Ui(running = true, title = "Tyrian 2000", store = Stores.GOG, index = 3, total = 3, needsUser = true, visible = true),
                onToggle = null, onStop = {}, onDismiss = {}, onUser = {},
            ) { m -> Box(m.background(androidx.compose.ui.graphics.Color(0xFFEDEDED))) }
        }
    }

}
