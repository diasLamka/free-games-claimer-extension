package io.github.diaslamka.freegames

import android.Manifest
import android.app.AlarmManager
import android.app.Application
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.notify.Notifier
import io.github.diaslamka.freegames.notify.Snooze
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** « Plus tard » (1.12.0) : reporter un nouveau jeu sans jamais le rater. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class SnoozeTest {
    private val hour = 3_600_000L

    private fun offer(id: String, endIn: Long?, now: Long) =
        Offer(key = "epic:$id", source = "epic", store = Stores.EPIC, storeId = id, title = id.replaceFirstChar { it.uppercase() },
            url = "https://store.epicgames.com/p/$id", start = now - hour, end = endIn?.let { now + it }, keepable = true)

    @Test
    fun theButtonIsOfferedOnlyWhileThereIsTimeToSpare() {
        val now = 1_790_000_000_000L
        assertTrue(Snooze.allowed(offer("a", 20 * hour, now), now))
        assertTrue(Snooze.allowed(offer("b", null, now), now))
        assertTrue(Snooze.allowed(offer("c", 2 * hour + 1, now), now))
        assertFalse("moins de deux heures : reporter serait refuser", Snooze.allowed(offer("d", 2 * hour, now), now))
        assertFalse(Snooze.allowed(offer("e", 20 * hour, now).copy(keepable = false), now))
    }

    @Test
    fun theReminderComesInThreeHoursButAlwaysAnHourBeforeTheEnd() {
        val now = 1_790_000_000_000L
        assertEquals(now + 3 * hour, Snooze.until(offer("a", 20 * hour, now), now))
        assertEquals(now + 3 * hour, Snooze.until(offer("b", null, now), now))
        val court = offer("c", 3 * hour, now)
        assertEquals(court.end!! - hour, Snooze.until(court, now))
        assertTrue(Snooze.until(offer("d", 2 * hour + 1, now), now) > now)
    }

    @Test
    fun aSnoozedGameLeavesTheShadeAndComesBackOnceWhenNothingChanged() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        val now = System.currentTimeMillis()
        val hades = offer("hades", 20 * hour, now)
        val gris = offer("gris", 20 * hour, now)
        val celeste = offer("celeste", 20 * hour, now)
        Graph.store.update { AppState(offers = listOf(hades, gris, celeste).associateBy { it.key }) }
        val nm = app.getSystemService(NotificationManager::class.java)

        // La notification d'un nouveau jeu porte le bouton « Plus tard ».
        Notifier.newGame(app, hades, Graph.store.value)
        val posted = shadowOf(nm).allNotifications
        assertEquals(1, posted.size)
        assertTrue(posted[0].actions.any { it.title == app.getString(R.string.action_snooze) })

        // Reporter : elle part, l'etat retient l'heure, une alarme inexacte reveille.
        assertTrue(Snooze.start(app, hades.key, now))
        assertEquals(0, shadowOf(nm).allNotifications.size)
        assertEquals(now + 3 * hour, Graph.store.value.snoozed[hades.key])
        val alarmes = shadowOf(app.getSystemService(AlarmManager::class.java)).scheduledAlarms
        assertEquals(1, alarmes.size)
        assertEquals(now + 3 * hour, alarmes[0].triggerAtTime)
        assertTrue("traverse la veille profonde", alarmes[0].isAllowWhileIdle)

        // Trop tot : rien. A l'heure : la notification revient, une fois.
        Snooze.ring(app, now + 2 * hour)
        assertEquals(0, shadowOf(nm).allNotifications.size)
        Snooze.ring(app, now + 3 * hour)
        assertEquals(1, shadowOf(nm).allNotifications.size)
        assertTrue(Graph.store.value.snoozed.isEmpty())
        Snooze.ring(app, now + 4 * hour)
        assertEquals(1, shadowOf(nm).allNotifications.size)

        // Deux reports independants : deux alarmes, l'une n'ecrase pas l'autre.
        assertTrue(Snooze.start(app, gris.key, now))
        assertTrue(Snooze.start(app, celeste.key, now))
        assertEquals(3, shadowOf(app.getSystemService(AlarmManager::class.java)).scheduledAlarms.size)
    }

    @Test
    fun aGameTakenInTheMeantimeOrGoneNeverRings() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        val now = System.currentTimeMillis()
        val pris = offer("pris", 20 * hour, now)
        val fini = offer("fini", 4 * hour, now)
        Graph.store.update {
            AppState(
                offers = listOf(pris, fini).associateBy { it.key },
                snoozed = mapOf(pris.key to now + hour, fini.key to now + hour, "epic:disparu" to now + hour),
                library = mapOf("epic:pris" to LibraryEntry(Stores.EPIC, "pris", "Pris", null, null, null, now, status = "claimed")),
            )
        }
        val nm = app.getSystemService(NotificationManager::class.java)
        // Une heure et demie plus tard : « Pris » est a nous, « Disparu » n'existe plus, « Fini » est expire.
        Snooze.ring(app, now + 5 * hour)
        assertEquals(0, shadowOf(nm).allNotifications.size)
        assertTrue("l'etat se vide meme quand rien ne sonne", Graph.store.value.snoozed.isEmpty())
    }

    @Test
    fun theReceiverIsDeclaredAndNotExported() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val info = app.packageManager.getReceiverInfo(
            android.content.ComponentName(app, io.github.diaslamka.freegames.notify.SnoozeReceiver::class.java), 0,
        )
        assertFalse(info.exported)
    }
}
