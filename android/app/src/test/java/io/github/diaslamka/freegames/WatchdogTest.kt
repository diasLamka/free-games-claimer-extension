package io.github.diaslamka.freegames

import android.Manifest
import android.app.AlarmManager
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.notify.Watchdog
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * La sentinelle de la veille (1.27.0). Si Android bride l'appli en arriere-plan, plus aucun passage n'a lieu -- et plus rien
 * ne le dit, puisque c'est la veille qui devait prevenir. Une alarme que chaque passage repousse, et qui ne sonne donc que
 * si la veille ne tourne plus : un interrupteur d'homme mort.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class WatchdogTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val hour = 3_600_000L
    private val now = 1_790_000_000_000L

    private fun state(lastCheck: Long?, hours: Int = 3, watchdog: Boolean = true, notifiedAt: Long? = null) =
        AppState(lastCheck = lastCheck, settings = Settings(checkHours = hours, watchdog = watchdog), watchdogAt = notifiedAt)

    @Before
    fun ready() = runBlocking<Unit> {
        Graph.init(context)
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        context.getSystemService(NotificationManager::class.java).cancelAll()
        Graph.store.update { AppState() }
    }

    /* ----------------------------------------------------------------- les durees */

    @Test
    fun theThresholdIsTwoAndAHalfIntervalsAndNeverUnderThreeHours() {
        assertEquals(3 * hour, Watchdog.thresholdMs(1))
        assertEquals((7.5 * hour).toLong(), Watchdog.thresholdMs(3))
        assertEquals(30 * hour, Watchdog.thresholdMs(12))
    }

    @Test
    fun theSilenceIsOnlyDeclaredPastTheThreshold() {
        assertNull(Watchdog.silentFor(state(now - 7 * hour), now))
        assertEquals(8 * hour, Watchdog.silentFor(state(now - 8 * hour), now))
        // Rien a surveiller : la veille n'a jamais tourne (premiere ouverture), ou la sentinelle est coupee.
        assertNull(Watchdog.silentFor(state(null), now))
        assertNull(Watchdog.silentFor(state(now - 30 * hour, watchdog = false), now))
    }

    @Test
    fun theAlarmIsDueAtTheThresholdAndNeverInThePast() {
        assertEquals(now - hour + (7.5 * hour).toLong(), Watchdog.nextAt(state(now - hour), now))
        // Deja en retard et jamais prevenu : bientot.
        assertEquals(now + Watchdog.MIN_DELAY_MS, Watchdog.nextAt(state(now - 20 * hour), now))
        assertNull(Watchdog.nextAt(state(null), now))
        assertNull(Watchdog.nextAt(state(now, watchdog = false), now))
    }

    @Test
    fun onceWarnedItRemindsOnlyTheNextDayAndAgainAfterANewPass() {
        // Prevenu il y a une heure, pour un silence qui dure : demain.
        val warned = state(now - 20 * hour, notifiedAt = now - hour)
        assertEquals(now - hour + Watchdog.REMIND_MS, Watchdog.nextAt(warned, now))
        // Un passage a eu lieu depuis : le prochain silence sera annonce a son echeance, sans attendre le delai.
        val later = state(now - 2 * hour, notifiedAt = now - 5 * hour)
        assertEquals(now - 2 * hour + (7.5 * hour).toLong(), Watchdog.nextAt(later, now))
    }

    @Test
    fun hoursReadInHours() {
        assertEquals("8 h", Watchdog.hoursText(8 * hour + 20 * 60_000))
        assertEquals("30 h", Watchdog.hoursText(30 * hour))
        assertEquals("45 min", Watchdog.hoursText(45 * 60_000))
    }

    /* ----------------------------------------------------------------- l'alarme */

    @Test
    fun armingSchedulesOneWakeupAlarmAtTheDueTime() {
        val am = context.getSystemService(AlarmManager::class.java)
        val t = System.currentTimeMillis()
        Watchdog.arm(context, state(t - hour), t)
        val alarm = shadowOf(am).nextScheduledAlarm
        assertNotNull(alarm)
        assertEquals(AlarmManager.RTC_WAKEUP, alarm!!.type)
        // 7,5 h moins l'heure deja ecoulee.
        assertEquals(t - hour + (7.5 * hour).toLong(), alarm.triggerAtMs)
    }

    @Test
    fun switchingTheWatchdogOffCancelsTheAlarm() {
        val am = context.getSystemService(AlarmManager::class.java)
        val t = System.currentTimeMillis()
        Watchdog.arm(context, state(t - hour), t)
        assertNotNull(shadowOf(am).nextScheduledAlarm)
        Watchdog.arm(context, state(t - hour, watchdog = false), t)
        assertNull(shadowOf(am).nextScheduledAlarm)
    }

    /* ----------------------------------------------------------------- quand elle sonne */

    private fun posted() = shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications

    @Test
    fun whenItRingsAndTheWatchIsSilentItWarnsOnce() = runBlocking {
        val t = System.currentTimeMillis()
        Graph.store.update { state(t - 9 * hour) }
        Watchdog.fire(context, t)
        assertEquals(1, posted().size)
        assertEquals(t, Graph.store.value.watchdogAt)
        // Elle sonne a nouveau (le systeme l'a reportee) : pas deux fois dans la journee.
        Watchdog.fire(context, t + hour)
        assertEquals(1, posted().size)
    }

    @Test
    fun whenItRingsAndAPassRanRecentlyItStaysQuiet() = runBlocking {
        val t = System.currentTimeMillis()
        Graph.store.update { state(t - hour) }
        Watchdog.fire(context, t)
        assertTrue(posted().isEmpty())
        assertNull(Graph.store.value.watchdogAt)
    }
}
