package io.github.diaslamka.freegames

import android.Manifest
import android.app.AlarmManager
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.notify.LastChance
import io.github.diaslamka.freegames.notify.Notifier
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** L'alarme de derniere chance (1.5.0). */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class LastChanceTest {
    private val now = 1_790_000_000_000L
    private val hour = 3_600_000L

    private fun offer(id: String, title: String, endIn: Long) =
        Offer(key = "epic:$id", source = "epic", store = Stores.EPIC, storeId = id, title = title,
            url = "https://store.epicgames.com/p/$id", end = now + endIn, keepable = true)

    private val hades = offer("hades", "Hades", 2 * hour)
    private val gris = offer("gris", "Gris", 20 * hour)
    private val celeste = offer("celeste", "Celeste", 2 * hour)
    private val tard = offer("tard", "Trop Tard", 5 * 60_000L)

    private fun state(vararg extra: Offer, settings: Settings = Settings(lastChance = true)) = AppState(
        offers = listOf(hades, gris, celeste, tard, *extra).associateBy { it.key },
        wishlist = listOf("Hades", "Gris", "Trop Tard"),
        settings = settings,
    )

    @Test
    fun onlyWishedUnclaimedGamesInTheirLastThreeHours() {
        val s = state()
        // Celeste n'est pas souhaite ; Trop Tard finit dans cinq minutes.
        assertEquals(setOf("Hades", "Gris"), LastChance.eligible(s, now).map { it.title }.toSet())
        assertEquals(listOf("Hades"), LastChance.due(s, now).map { it.title })
        assertEquals(gris.end!! - 3 * hour, LastChance.triggerAt(gris))
        // Deja a nous, ou deja sonne : plus rien.
        val pris = s.copy(library = mapOf("epic:hades" to LibraryEntry(Stores.EPIC, "hades", "Hades", null, null, null, now, status = "claimed")))
        assertTrue(LastChance.due(pris, now).isEmpty())
        assertTrue(LastChance.due(s.copy(alarmed = mapOf(hades.key to now - 1)), now).isEmpty())
    }

    @Test
    fun itSchedulesAnInexactAlarmAndRingsOnTheAlarmStreamOnce() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        Graph.store.update { state().copy(offers = mapOf(hades.key to hades.copy(end = System.currentTimeMillis() + 2 * hour), gris.key to gris.copy(end = System.currentTimeMillis() + 20 * hour))) }
        val t = System.currentTimeMillis()

        // Gris : une alarme, trois heures avant sa fin.
        LastChance.schedule(app, Graph.store.value, t)
        val alarms = shadowOf(app.getSystemService(AlarmManager::class.java)).scheduledAlarms
        assertEquals(1, alarms.size)
        assertEquals(Graph.store.value.offers[gris.key]!!.end!! - 3 * hour, alarms[0].triggerAtTime)
        assertTrue("traverse la veille profonde", alarms[0].isAllowWhileIdle)

        // Hades : deja dans la fenetre, il sonne -- en boucle, sur le flux des alarmes.
        LastChance.ring(app, t)
        val nm = app.getSystemService(NotificationManager::class.java)
        val posted = shadowOf(nm).allNotifications
        assertEquals(1, posted.size)
        assertTrue(posted[0].flags and Notification.FLAG_INSISTENT != 0)
        assertEquals(Notifier.CH_LAST_CHANCE, posted[0].channelId)
        assertEquals(AudioAttributes.USAGE_ALARM, nm.getNotificationChannel(Notifier.CH_LAST_CHANCE).audioAttributes.usage)

        // Une fois par offre.
        LastChance.ring(app, t + 60_000)
        assertEquals(1, shadowOf(nm).allNotifications.size)

        // Ouvrir l'appli la fait taire.
        Notifier.silenceLastChance(app)
        assertEquals(0, shadowOf(nm).allNotifications.size)

        // Coupee : rien ne sonne, rien n'est pose.
        Graph.store.update { it.copy(settings = Settings(lastChance = false), alarmed = emptyMap()) }
        LastChance.ring(app, t)
        assertEquals(0, shadowOf(nm).allNotifications.size)
    }
}
