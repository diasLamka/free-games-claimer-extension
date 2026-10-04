package io.github.diaslamka.freegames

import android.app.ActivityOptions
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.work.Scheduler
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Les notifications et le travail de fond sur le VRAI systeme : une notification postee se retrouve chez le systeme, son
 * toucher ouvre l'appli, et un test de la veille lance par WorkManager finit en notification.
 */
@RunWith(AndroidJUnit4::class)
class NotificationDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()
    @get:Rule val permission: GrantPermissionRule = EmulatorOnly.grantNotifications()

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val manager: NotificationManager get() = context.getSystemService(NotificationManager::class.java)

    @Before
    fun clear() = manager.cancelAll()

    private fun posted(id: Int) = manager.activeNotifications.firstOrNull { it.id == id }?.notification

    private fun title(n: Notification) = n.extras.getCharSequence(Notification.EXTRA_TITLE).toString()

    private fun waitFor(id: Int, timeoutMs: Long): Notification? {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            posted(id)?.let { return it }
            Thread.sleep(500)
        }
        return null
    }

    @SdkSuppress(minSdkVersion = 34)
    @Test
    fun aFinishedTestIsPostedAndTouchingItOpensTheApp() {
        val r = PassRecord(at = 1, ms = 4_200, reason = "test", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true, claimed = 2)
        Notifier.testDone(context, r, claimOn = true)
        val n = waitFor(7310, 10_000)
        assertNotNull("la notification est chez le systeme", n)
        assertEquals(context.getString(R.string.notif_test_ok), title(n!!))

        val monitor = InstrumentationRegistry.getInstrumentation().addMonitor(MainActivity::class.java.name, null, false)
        // L'interface du systeme, qui recoit le vrai toucher, a le droit de lancer une activite depuis l'arriere-plan ; ce
        // test, un processus sans fenetre, doit le dire (Android 14) : c'est ce que ferait SystemUI.
        val allowed = ActivityOptions.makeBasic()
            .setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle()
        n.contentIntent.send(context, 0, null, null, null, null, allowed)
        val activity = monitor.waitForActivityWithTimeout(20_000)
        assertNotNull("toucher la notification ouvre l'appli", activity)
        activity.finish()
    }

    @Test
    fun theWatchdogAlertIsPosted() {
        Notifier.watchdog(context, 8 * 3_600_000L)
        val n = waitFor(7301, 10_000)
        assertNotNull(n)
        assertEquals(context.getString(R.string.notif_watchdog_title), title(n!!))
    }

    @Test
    fun aTestRunByWorkManagerEndsInANotification() {
        // Le vrai travail de fond, le vrai reseau : le resultat peut etre « ok » ou « en echec » (reseau coupe), jamais rien.
        Scheduler.testNow(context)
        val n = waitFor(7310, 170_000)
        assertNotNull("le test de la veille a fini en notification", n)
        val t = title(n!!)
        assertTrue(t, t == context.getString(R.string.notif_test_ok) || t == context.getString(R.string.notif_test_failed))
    }
}
