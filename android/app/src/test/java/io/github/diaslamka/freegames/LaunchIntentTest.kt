package io.github.diaslamka.freegames

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Ce que l'activite fait de l'intent qui l'a lancee. L'intent d'origine revient a chaque recreation
 * (police changee, processus tue puis retour par les Recents) : s'il etait rejoue, une recuperation demandee par
 * une notification ou un raccourci repartirait toute seule.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class LaunchIntentTest {
    private val claim = Intent(Intent.ACTION_MAIN).putExtra(MainActivity.EXTRA_CLAIM, "*")

    @Test
    fun aFreshLaunchIsHandled() {
        assertTrue(MainActivity.shouldHandle(null, claim))
    }

    @Test
    fun aRecreatedActivityDoesNotReplayTheIntentThatStartedIt() {
        assertFalse(MainActivity.shouldHandle(Bundle(), claim))
    }

    @Test
    fun comingBackFromTheRecentsDoesNotReplayItEither() {
        val fromHistory = Intent(claim).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)
        assertFalse(MainActivity.shouldHandle(null, fromHistory))
    }

    @Test
    fun noIntentMeansNothingToHandle() {
        assertFalse(MainActivity.shouldHandle(null, null))
    }

    @Test
    fun aNewIntentOnARunningActivityIsAlwaysHandled() {
        // onNewIntent n'est jamais une recreation : c'est un geste tout neuf (notification, widget, raccourci).
        assertTrue(MainActivity.shouldHandleNew(claim))
    }

    @Test
    fun theActivityFollowsTheFontSizeItself() {
        // Sans cela, changer la taille de la police detruit l'activite, et la recuperation en cours avec elle.
        val context: Context = ApplicationProvider.getApplicationContext()
        val info = context.packageManager.getActivityInfo(
            android.content.ComponentName(context, MainActivity::class.java), android.content.pm.PackageManager.GET_META_DATA,
        )
        assertEquals(android.content.pm.ActivityInfo.CONFIG_FONT_SCALE, info.configChanges and android.content.pm.ActivityInfo.CONFIG_FONT_SCALE)
    }
}
