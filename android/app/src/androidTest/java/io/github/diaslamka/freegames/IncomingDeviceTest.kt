package io.github.diaslamka.freegames

import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.rule.GrantPermissionRule
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Ce que le VRAI systeme fait d'un intent envoye a l'activite exportee : l'onglet demande, un onglet qui n'existe pas, un
 * intent livre a une activite deja ouverte (singleTask). (Le paquet d'extras illisible a sa propre classe, sans banc Compose.)
 */
@RunWith(AndroidJUnit4::class)
class IncomingDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()
    // Sur une installation neuve, l'appli demande la permission de notifications a l'ouverture : la boite du systeme
    // recouvrirait l'ecran et les tests ne verraient rien.
    @get:Rule val permission: GrantPermissionRule = EmulatorOnly.grantNotifications()
    @get:Rule val compose = createEmptyComposeRule()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int) = context.getString(id)
    private fun main(configure: Intent.() -> Unit = {}) = Intent(context, MainActivity::class.java).apply(configure)

    // Avant que l'appli ait compose son premier ecran, Compose n'a pas de hierarchie : « pas encore », pas une erreur.
    private fun shows(text: Int, substring: Boolean) = runCatching {
        compose.onAllNodesWithText(str(text), substring = substring, ignoreCase = true).fetchSemanticsNodes().isNotEmpty()
    }.getOrDefault(false)

    private fun showsWishlist() = shows(R.string.wish_hint, substring = true)
    private fun showsGames() = shows(R.string.tab_games, substring = false)

    @Test
    fun aTabThatExistsIsOpenedByAnIntent() {
        ActivityScenario.launch<MainActivity>(main { putExtra(MainActivity.EXTRA_TAB, 2) }).use {
            compose.waitUntil(20_000) { showsWishlist() }
        }
    }

    @Test
    fun aTabThatDoesNotExistLeavesTheGamesScreen() {
        ActivityScenario.launch<MainActivity>(main { putExtra(MainActivity.EXTRA_TAB, 99) }).use {
            compose.waitUntil(20_000) { showsGames() }
            assertFalse(showsWishlist())
        }
    }

    @Test
    fun theWishShortcutOpensTheWishlist() {
        ActivityScenario.launch<MainActivity>(Intent(Raccourcis.SOUHAIT).setClass(context, MainActivity::class.java)).use {
            compose.waitUntil(20_000) { showsWishlist() }
        }
    }

    @Test
    fun anIntentDeliveredToAnOpenActivityIsHandled() {
        ActivityScenario.launch<MainActivity>(main()).use {
            compose.waitUntil(20_000) { showsGames() }
            // L'activite est singleTask : le second intent arrive par onNewIntent.
            context.startActivity(main { putExtra(MainActivity.EXTRA_TAB, 2); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) })
            compose.waitUntil(20_000) { showsWishlist() }
        }
    }
}
