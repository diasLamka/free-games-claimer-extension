package io.github.diaslamka.freegames

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.ui.HealthGroup
import io.github.diaslamka.freegames.ui.theme.FreeGamesTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Notifications refusees : les alertes « derniere chance », l'aide du PC, les defis et les connexions disparaissaient en
 * silence (Notifier.allowed les retire), et rien dans l'appli ne le disait. La page Sante le dit, avec un bouton vers les
 * reglages de notification d'Android -- la permission n'est demandee qu'une fois, a la premiere ouverture.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = android.app.Application::class)
class HealthNotificationsTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_790_000_000_000L
    private fun str(id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    @Test
    fun refusedNotificationsAreSaidWithAWayToFixThem() {
        var opened = 0
        compose.setContent {
            FreeGamesTheme(dark = false) { HealthGroup(AppState(), now, notificationsAllowed = false, onNotificationSettings = { opened++ }) }
        }
        compose.onNodeWithText(str(R.string.health_notifications_off), ignoreCase = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_notifications_open), ignoreCase = true).performClick()
        assertEquals(1, opened)
    }

    @Test
    fun allowedNotificationsSayItWithoutAButton() {
        compose.setContent { FreeGamesTheme(dark = false) { HealthGroup(AppState(), now, notificationsAllowed = true, onNotificationSettings = {}) } }
        compose.onNodeWithText(str(R.string.health_notifications_on), substring = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.health_notifications_off), ignoreCase = true).assertDoesNotExist()
        compose.onNodeWithText(str(R.string.health_notifications_open), ignoreCase = true).assertDoesNotExist()
    }
}
