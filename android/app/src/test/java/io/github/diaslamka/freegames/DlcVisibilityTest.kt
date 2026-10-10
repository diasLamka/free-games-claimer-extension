package io.github.diaslamka.freegames

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Tiles
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Les DLC et ce qui demande un jeu de base qu'on n'a pas : on choisit de les voir ou non (1.33.0). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "w400dp-h3000dp")
class DlcVisibilityTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private fun offer(id: String, title: String, category: String? = null, parent: String? = null) = Offer(
        key = "steam:$id", source = "steam", store = Stores.STEAM, storeId = id, title = title, url = "https://example.test/$id",
        category = category, parentAppid = parent, end = now + 86_400_000,
    )

    private val game = offer("1", "Alpha Quest", category = "Game")
    private val dlc = offer("2", "Bravo Skins", category = "DLC")
    private val dlcOfGame = offer("3", "Charlie Pack", category = "DLC", parent = "999")

    private fun state(settings: Settings, owned: List<String> = emptyList()) = AppState(
        offers = listOf(game, dlc, dlcOfGame).associateBy { it.key }, settings = settings.copy(tiles = Tiles.LIST), steamOwned = owned,
    )

    private fun show(s: AppState) = compose.setContent {
        FreeGamesTheme(dark = false) {
            GamesScreen(s, now, refreshing = false, claiming = false, onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {})
        }
    }

    private fun shown(title: String) = runCatching { compose.onNodeWithText(title, ignoreCase = true).assertExists() }.isSuccess

    @Test
    fun everythingIsShownByDefault() {
        show(state(Settings()))
        assertTrue(shown("Alpha Quest") && shown("Bravo Skins") && shown("Charlie Pack"))
    }

    @Test
    fun turningDlcOffHidesBothDlcButNotTheGame() {
        show(state(Settings(showDlc = false)))
        assertTrue(shown("Alpha Quest"))
        assertFalse(shown("Bravo Skins"))
        assertFalse(shown("Charlie Pack"))
    }

    @Test
    fun turningNeedsBaseOffHidesOnlyWhatLacksItsBaseGame() {
        show(state(Settings(showNeedsBase = false)))
        assertTrue(shown("Alpha Quest") && shown("Bravo Skins"))
        assertFalse(shown("Charlie Pack"))
    }

    @Test
    fun aDlcWhoseBaseGameYouOwnIsNotHiddenByTheNeedsBaseSwitch() {
        show(state(Settings(showNeedsBase = false), owned = listOf("999")))
        assertTrue(shown("Charlie Pack"))
    }

    @Test
    fun theRuleSeesTheBaseGameFromTheLibraryOrTheLastVerdict() {
        val s = AppState(steamOwned = listOf("999"))
        assertFalse(Rules.needsBase(dlcOfGame, s))
        assertTrue(Rules.needsBase(dlcOfGame, AppState()))
        assertFalse(Rules.needsBase(dlc, AppState()))
        val refused = AppState(attempts = mapOf(dlc.key to Attempt(count = 1, lastAt = now, verdict = Verdicts.NEEDS_BASE)))
        assertTrue(Rules.needsBase(dlc, refused))
    }
}
