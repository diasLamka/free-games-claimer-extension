package io.github.diaslamka.freegames

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.notify.Notifier
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Le test de la veille : ecran eteint, la notification est la seule facon d'en lire le resultat. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class TestNotificationTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun str(id: Int, vararg a: Any) = context.getString(id, *a)

    @Before
    fun ready() {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        context.getSystemService(NotificationManager::class.java).cancelAll()
    }

    private fun posted() = shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications

    private fun title(n: android.app.Notification) = n.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString()
    private fun text(n: android.app.Notification) = (n.extras.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(android.app.Notification.EXTRA_TEXT)).toString()

    @Test
    fun aFinishedTestSaysWhatItFoundHowLongItTookAndWhetherTheScreenWasOff() {
        val r = PassRecord(at = 1, ms = 4_200, reason = "test", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true, claimed = 2)
        Notifier.testDone(context, r, claimOn = true)
        val n = posted().single()
        assertEquals(str(R.string.notif_test_ok), title(n))
        val t = text(n)
        assertTrue(t, t.contains(str(R.string.notif_test_text, 14, 1, "4 s", str(R.string.screen_state_off))))
        assertTrue(t, t.contains(str(R.string.notif_test_claimed, 2)))
    }

    @Test
    fun aTestThatClaimedNothingSaysZeroWhenBackgroundClaimingIsOn() {
        // Le journal ne garde pas « 0 recupere » (bruit) : c'est la notification de test qui le dit.
        val r = PassRecord(at = 1, ms = 900, reason = "test", outcome = PassLog.OK, offers = 3, screenOff = true, claimed = null)
        Notifier.testDone(context, r, claimOn = true)
        val t = text(posted().single())
        assertTrue(t, t.contains(str(R.string.notif_test_claimed, 0)))
    }

    @Test
    fun aTestWithoutBackgroundClaimingSaysThatSetting() {
        val r = PassRecord(at = 1, ms = 900, reason = "test", outcome = PassLog.OK, offers = 3, screenOff = false)
        Notifier.testDone(context, r, claimOn = false)
        val t = text(posted().single())
        assertTrue(t, t.contains(str(R.string.screen_state_on)))
        assertTrue(t, t.contains(str(R.string.notif_test_claim_off)))
    }

    @Test
    fun aFailedTestSaysSoWithItsReason() {
        val r = PassRecord(at = 1, ms = 700, reason = "test", outcome = PassLog.FAILED, errors = listOf("reseau coupe"))
        Notifier.testDone(context, r, claimOn = true)
        val n = posted().single()
        assertEquals(str(R.string.notif_test_failed), title(n))
        assertTrue(text(n).contains("reseau coupe"))
    }
}
