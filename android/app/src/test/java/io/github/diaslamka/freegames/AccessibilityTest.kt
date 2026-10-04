package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Member
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.BrutToggle
import io.github.diaslamka.freegames.ui.ClaimPanelContent
import io.github.diaslamka.freegames.ui.FamilyActions
import io.github.diaslamka.freegames.ui.FamilyGroup
import io.github.diaslamka.freegames.ui.GamesScreen
import io.github.diaslamka.freegames.ui.MutedInk
import io.github.diaslamka.freegames.ui.OfferTile
import io.github.diaslamka.freegames.ui.WishlistScreen
import io.github.diaslamka.freegames.ui.clickableNoRipple
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Ce que TalkBack et un doigt voient des controles de la charte : une cible d'au moins 48 dp, un nom pour les boutons
 * qui n'ont qu'un glyphe, l'etat d'un choix, un texte lisible, et rien de rogne par une taille fixe.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class AccessibilityTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private fun str(id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<Context>().getString(id, *args)
    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) = compose.setContent { FreeGamesTheme(dark = false) { content() } }

    /* ------------------------------------------------------------ cibles tactiles */

    @Test
    fun aSmallTapTargetIsRaisedToFortyEightDp() {
        show { Box(Modifier.testTag("cible").clickableNoRipple { }.size(20.dp)) }
        compose.onNodeWithTag("cible").assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
    }

    @Test
    fun theClosedPanelOffersANamedCloseButton() {
        val ui = ClaimSession.Ui(running = false, visible = true, store = Stores.EPIC)
        show { ClaimPanelContent(ui, onToggle = null, onStop = {}, onDismiss = {}, onUser = {}) { Box(it) } }
        // « ✕ » seul n'est pas un nom : TalkBack lisait le symbole.
        compose.onNodeWithContentDescription(str(R.string.close)).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun theRunningPanelOffersNamedEnlargeAndStopButtons() {
        val ui = ClaimSession.Ui(running = true, visible = true, title = "Hades", store = Stores.EPIC, total = 1, index = 1)
        show { ClaimPanelContent(ui, onToggle = null, onStop = {}, onDismiss = {}, onUser = {}) { Box(it) } }
        compose.onNodeWithContentDescription(str(R.string.panel_expand)).assertHeightIsAtLeast(48.dp)
        compose.onNodeWithContentDescription(str(R.string.stop)).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun aWishCanBeRemovedByANamedButtonOfTheRightSize() {
        show { WishlistScreen(AppState(wishlist = listOf("Hades")), now, onAdd = {}, onRemove = {}) }
        compose.onNodeWithContentDescription(str(R.string.wish_remove)).assertHeightIsAtLeast(48.dp)
    }

    @Test
    fun theStoreFilterSaysWhichOneIsOn() {
        show {
            GamesScreen(
                state = AppState(), now = now, refreshing = false, claiming = false,
                onRefresh = {}, onClaim = {}, onOpen = {}, onShare = {}, onAccounts = {},
            )
        }
        compose.onNodeWithText(str(R.string.filter_all).uppercase()).assertIsSelected()
        compose.onNodeWithText("EPIC").assertIsNotSelected()
    }

    @Test
    fun aFamilyStorePillSaysWhetherTheMemberIsSignedIn() {
        val state = AppState(family = listOf(Member(id = "m1", name = "Lea")))
        show { FamilyGroup(state, supported = true, actions = FamilyActions()) }
        // Le nom accessible remplace le texte « EPIC — » : l'etat doit y etre, sinon il n'est dit nulle part.
        val said = "${Stores.label(Stores.EPIC)} : Lea, ${str(R.string.family_not_connected)}"
        compose.onNodeWithContentDescription(said).assertHeightIsAtLeast(48.dp)
    }

    /* ------------------------------------------------------------ l'interrupteur */

    @Test
    fun theToggleSpeaksTheAppLanguageAndSaysWhichSideIsOn() {
        var value by mutableStateOf(false)
        show { BrutToggle(value) { value = it } }
        // « OUI » / « NON » etaient en dur : l'appli est livree en quatre langues.
        compose.onNodeWithText(str(R.string.toggle_off)).assertIsSelected()
        compose.onNodeWithText(str(R.string.toggle_on)).assertIsNotSelected()
        compose.onNodeWithText(str(R.string.toggle_on)).performClick()
        assertTrue(value)
        compose.onNodeWithText(str(R.string.toggle_on)).assertIsSelected()
    }

    @Test
    fun theMutedInkReadsOnWhiteAtFourPointFiveToOne() {
        // WCAG AA pour du texte normal. Le gris d'avant (#8A8A8A) donnait environ 3,45.
        val ratio = 1.05 / (MutedInk.luminance() + 0.05)
        assertTrue("contraste $ratio", ratio >= 4.5)
    }

    /* ------------------------------------------------------ tailles fixes autour du texte */

    @Test
    fun aTwoLineTileTitleIsNotCroppedByItsBox() {
        // Deux lignes certaines, quelle que soit la largeur : un saut de ligne.
        val offer = Offer(
            key = Offer.keyFor(Stores.EPIC, "x", "Hades"), source = "x", store = Stores.EPIC, storeId = "x",
            title = "Hades\nHades", url = "https://example.test/x", end = now + 86_400_000,
        )
        // Grande police (le reglage Android d'accessibilite) : les lignes grandissent, la boite de 40 dp non.
        show {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale = 1.5f)) {
                OfferTile(offer, AppState(), now, onOpen = {})
            }
        }
        val results = mutableListOf<TextLayoutResult>()
        // Dans l'arbre non fusionne : la tuile est cliquable, elle fusionne ses textes (la lettre de la jaquette comprise).
        val node = compose.onNode(hasText("HADES\nHADES"), useUnmergedTree = true).fetchSemanticsNode()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(results)
        assertEquals(1, results.size)
        // Avec height(40.dp) et Ellipsis, Compose retire les lignes qui ne tiennent pas dans la boite : la seconde ligne du
        // titre disparaissait en silence (didOverflowHeight reste faux). Les deux lignes doivent etre la.
        assertEquals("lignes affichees", 2, results[0].lineCount)
    }
}
