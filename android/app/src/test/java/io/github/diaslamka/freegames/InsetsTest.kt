package io.github.diaslamka.freegames

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.AdaptiveFrame
import io.github.diaslamka.freegames.ui.LoginScreen
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * L'appli est bord a bord (enableEdgeToEdge, cible 36) : ce que les barres du systeme et le clavier recouvrent, c'est a
 * l'ecran de le laisser libre. La page de connexion passait sous la barre d'etat, et le clavier couvrait les champs
 * des Reglages en portrait.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class InsetsTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun str(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    /** Comme enableEdgeToEdge de MainActivity : la fenetre ne se retire pas les barres, c'est a l'ecran de s'en garder. */
    private fun edgeToEdge() = compose.runOnUiThread { WindowCompat.setDecorFitsSystemWindows(compose.activity.window, false) }

    private fun dispatch(statusBar: Int = 0, ime: Int = 0) {
        compose.runOnUiThread {
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, statusBar, 0, 0))
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, ime))
                .setVisible(WindowInsetsCompat.Type.ime(), ime > 0)
                .build()
            ViewCompat.dispatchApplyWindowInsets(compose.activity.window.decorView, insets)
        }
        compose.waitForIdle()
    }

    @Test
    fun theLoginPageStaysBelowTheStatusBar() {
        edgeToEdge()
        compose.setContent { FreeGamesTheme(dark = false) { LoginScreen(Stores.GOG, "FR", onClose = {}) } }
        dispatch(statusBar = 80)
        // Le bouton « Fermer » est en haut de la page : il ne doit pas passer sous la barre d'etat.
        val top = compose.onNodeWithContentDescription(str(R.string.close)).getUnclippedBoundsInRoot().top
        assertTrue("le bouton Fermer est a $top, sous la barre d'etat de 80 dp", top >= 80.dp)
    }

    @Test
    fun theKeyboardDoesNotCoverTheContentInPortrait() {
        edgeToEdge()
        compose.setContent { FreeGamesTheme(dark = false) { AdaptiveFrame(tab = 3, onTab = {}) { Box(Modifier.fillMaxSize().testTag("contenu")) } } }
        dispatch(ime = 300)
        val rootHeight = compose.onNodeWithTag("contenu").getUnclippedBoundsInRoot().let { it.bottom }
        val screen = compose.activity.resources.displayMetrics.let { it.heightPixels / it.density }.dp
        // Le contenu s'arrete au-dessus du clavier (300 dp), pas dessous.
        assertTrue("le contenu va jusqu'a $rootHeight sur un ecran de $screen, clavier compris", rootHeight <= screen - 300.dp + 1.dp)
    }
}
