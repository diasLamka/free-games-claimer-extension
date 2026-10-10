package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.sources.FabSource
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Instant

/** Les assets de Fab dans l'ecran des jeux : une section a part, repliee, et seulement si on suit Fab. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class FabSectionTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-10-10T12:00:00Z").toEpochMilli()
    private fun str(id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *args)

    private val offers = FabSource.mapOffers(
        FabSource.readBlade(File(System.getProperty("fixtures"), "fab-limited-free.html").readText()),
        now,
    ).offers

    private fun show(settings: Settings, opened: MutableList<String> = mutableListOf()) {
        val state = AppState(offers = offers.associateBy { it.key }, settings = settings)
        compose.setContent {
            FreeGamesTheme(dark = false) {
                GamesScreen(
                    state = state, now = now, refreshing = false, claiming = false,
                    onRefresh = {}, onClaim = {}, onOpen = { opened += it }, onShare = {}, onAccounts = {},
                )
            }
        }
    }

    @Test
    fun theSectionIsThereWithItsCountWhenFabIsFollowed() {
        show(Settings(showFab = true))
        compose.onNodeWithText(str(R.string.section_fab), substring = true, ignoreCase = true).assertExists()
    }

    @Test
    fun theSectionIsAbsentWhenFabIsNotFollowed() {
        show(Settings(showFab = false))
        compose.onNodeWithText(str(R.string.section_fab), substring = true, ignoreCase = true).assertDoesNotExist()
    }

    @Test
    fun openingTheSectionShowsTheAssetsAndTappingOneOpensItsListing() {
        val opened = mutableListOf<String>()
        show(Settings(showFab = true), opened)
        compose.onNodeWithText(str(R.string.section_fab), substring = true, ignoreCase = true).performClick()
        // L'ecran de test est petit et la liste paresseuse : on va chercher la ligne, comme le doigt le ferait.
        val ligne = hasText("Stylized Harvest Farm Environment", substring = true, ignoreCase = true)
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(ligne)
        compose.onNode(ligne).assertExists().performClick()
        compose.waitForIdle()
        assertEquals(listOf("https://www.fab.com/listings/d8b51a6c-a5b2-41cf-8f49-14e936a27de3"), opened)
    }
}
