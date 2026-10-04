package io.github.diaslamka.freegames

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.notify.WatchdogReceiver
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Ce que le manifeste et les ressources declarent, lu par le systeme lui-meme : raccourcis, widgets, composants exportes. */
@RunWith(AndroidJUnit4::class)
class ManifestDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun theThreeLauncherShortcutsAreDeclaredAndPointAtTheMainActivity() {
        val shortcuts = context.getSystemService(ShortcutManager::class.java).manifestShortcuts.associateBy { it.id }
        assertEquals(setOf("recuperer", "ce_soir", "souhait"), shortcuts.keys)
        val expected = mapOf("recuperer" to Raccourcis.RECUPERER, "ce_soir" to Raccourcis.CE_SOIR, "souhait" to Raccourcis.SOUHAIT)
        for ((id, action) in expected) {
            val intent: Intent = shortcuts.getValue(id).intent!!
            assertEquals(id, action, intent.action)
            assertEquals(id, ComponentName(context, MainActivity::class.java), intent.component)
            // Le systeme sait le resoudre : un raccourci dont l'intent ne mene nulle part ne ferait rien.
            assertNotNull(id, context.packageManager.resolveActivity(intent, 0))
        }
    }

    @Test
    fun theTwoHomeScreenWidgetsAreInstalled() {
        val providers = AppWidgetManager.getInstance(context).getInstalledProvidersForPackage(context.packageName, null)
        assertTrue("widgets : " + providers.map { it.provider.shortClassName }, providers.size >= 2)
    }

    @Test
    fun onlyTheMainActivityIsOpenToOtherApps() {
        val pm = context.packageManager
        assertTrue(pm.getActivityInfo(ComponentName(context, MainActivity::class.java), 0).exported)
        // La sentinelle n'est sonnee que par l'appli elle-meme.
        assertFalse(pm.getReceiverInfo(ComponentName(context, WatchdogReceiver::class.java), 0).exported)
    }
}
