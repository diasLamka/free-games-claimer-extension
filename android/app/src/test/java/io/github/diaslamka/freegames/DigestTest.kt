package io.github.diaslamka.freegames

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Seen
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.notify.Digest
import io.github.diaslamka.freegames.notify.Notifier
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.ZoneId
import java.time.ZonedDateTime

/** « Resume du jour » (1.13.0) : une notification par jour, sans jamais faire attendre ce qui presse. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class DigestTest {
    private val hour = 3_600_000L
    private val day = 24 * hour
    private val paris = ZoneId.of("Europe/Paris")

    private fun at(y: Int, m: Int, d: Int, h: Int, min: Int = 0) = ZonedDateTime.of(y, m, d, h, min, 0, 0, paris).toInstant().toEpochMilli()

    private fun offer(title: String, now: Long, endIn: Long? = 20 * hour) =
        Offer(key = "epic:${title.lowercase()}", source = "epic", store = Stores.EPIC, storeId = title.lowercase(), title = title,
            url = "https://store.epicgames.com/p/${title.lowercase()}", start = now - hour, end = endIn?.let { now + it }, keepable = true)

    private fun state(now: Long, hourSetting: Int, vararg o: Offer, extra: (AppState) -> AppState = { it }) =
        extra(AppState(offers = o.associateBy { it.key }, settings = Settings(digestHour = hourSetting)))

    @Test
    fun theHourIsTheLastAndTheNextSlot() {
        val now = at(2026, 9, 28, 10)
        assertEquals(at(2026, 9, 28, 8), Digest.lastSlot(8, now, paris))
        assertEquals(at(2026, 9, 29, 8), Digest.nextSlot(8, now, paris))
        assertEquals(at(2026, 9, 27, 12), Digest.lastSlot(12, now, paris))
        assertEquals(at(2026, 9, 28, 12), Digest.nextSlot(12, now, paris))
        // Pile a l'heure : le creneau est echu, le suivant est demain.
        val pile = at(2026, 9, 28, 8)
        assertEquals(pile, Digest.lastSlot(8, pile, paris))
        assertEquals(at(2026, 9, 29, 8), Digest.nextSlot(8, pile, paris))
        // Le changement d'heure d'automne : 8 h reste 8 h au mur.
        assertEquals(at(2026, 10, 25, 8), Digest.nextSlot(8, at(2026, 10, 24, 10), paris))
        assertEquals(at(2026, 3, 29, 8), Digest.nextSlot(8, at(2026, 3, 28, 10), paris))
    }

    @Test
    fun theSettingHasAnOffValueAndOldStatesReadAsOff() {
        assertFalse(Digest.enabled(Digest.OFF))
        assertTrue(Digest.enabled(0))
        assertTrue(Digest.enabled(23))
        assertFalse(Digest.enabled(24))
        assertEquals(Digest.OFF, Settings().digestHour)
        // Un etat ecrit par la 1.12.0 n'a ni reglage ni jeux retenus.
        val ancien = Json { ignoreUnknownKeys = true }.decodeFromString<AppState>("""{"settings":{"country":"FR"}}""")
        assertEquals(Digest.OFF, ancien.settings.digestHour)
        assertTrue(ancien.digestHeld.isEmpty())
    }

    @Test
    fun wishedGamesAndSecondChancesNeverWait() {
        val now = at(2026, 9, 28, 10)
        val hades = offer("Hades", now)
        val gris = offer("Gris", now)
        val celeste = offer("Celeste", now)
        val s = state(now, 20, hades, gris, celeste) {
            it.copy(wishlist = listOf("Hades"), passes = mapOf(gris.normalisedTitle to listOf(Seen(Stores.EPIC, now - 30 * day))))
        }
        val plan = Digest.split(listOf(hades, gris, celeste), s, now, firstRun = false)
        assertEquals(listOf("Hades", "Gris"), plan.now.map { it.title })
        assertEquals(listOf("Celeste"), plan.held.map { it.title })
    }

    @Test
    fun withoutADigestOrOnTheVeryFirstRunEverythingGoesAtOnce() {
        val now = at(2026, 9, 28, 10)
        val a = offer("Celeste", now)
        val b = offer("Tunic", now)
        val coupe = Digest.split(listOf(a, b), state(now, Digest.OFF, a, b), now, firstRun = false)
        assertEquals(2, coupe.now.size)
        assertTrue(coupe.held.isEmpty())
        val premier = Digest.split(listOf(a, b), state(now, 20, a, b), now, firstRun = true)
        assertEquals(2, premier.now.size)
        assertTrue(premier.held.isEmpty())
    }

    @Test
    fun aGameHeldAfterTheSlotWaitsForTomorrowsSummary() {
        val a = offer("Celeste", at(2026, 9, 28, 7))
        val b = offer("Tunic", at(2026, 9, 28, 8, 30))
        val s = state(0, 8, a, b) { it.copy(digestHeld = mapOf(a.key to at(2026, 9, 28, 7, 30), b.key to at(2026, 9, 28, 8, 30))) }
        assertEquals("avant 8 h : rien n'est du", emptySet<String>(), Digest.releasable(s, at(2026, 9, 28, 7, 45), paris))
        val vers9h = Digest.releasable(s, at(2026, 9, 28, 9), paris)
        assertEquals(setOf(a.key), vers9h)
        assertEquals(setOf(a.key, b.key), Digest.releasable(s, at(2026, 9, 29, 8, 5), paris))
    }

    @Test
    fun aDigestThatIsSwitchedOffReleasesWhatItHeld() {
        val a = offer("Celeste", 0)
        val s = state(0, Digest.OFF, a) { it.copy(digestHeld = mapOf(a.key to 5L)) }
        assertEquals(setOf(a.key), Digest.releasable(s, at(2026, 9, 28, 10), paris))
    }

    @Test
    fun pendingKeepsOnlyWhatIsStillWorthSaying() {
        val now = at(2026, 9, 28, 21)
        val ouvert = offer("Celeste", now, endIn = 30 * hour)
        val presse = offer("Tunic", now, endIn = 3 * hour)
        val fini = offer("Fini", now, endIn = -hour)
        val pris = offer("Pris", now)
        val s = state(now, 20, ouvert, presse, fini, pris) {
            it.copy(library = mapOf("epic:pris" to LibraryEntry(Stores.EPIC, "pris", "Pris", null, null, null, now, status = "claimed")))
        }
        val keys = setOf(ouvert.key, presse.key, fini.key, pris.key, "epic:disparu")
        assertEquals("le plus pressant d'abord ; ni le fini, ni le pris, ni l'absent", listOf("Tunic", "Celeste"), Digest.pending(s, keys, now).map { it.title })
    }

    @Test
    fun theSummaryGoesOutOnceAndEmptiesTheDrawer() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        val nm = app.getSystemService(NotificationManager::class.java)
        val soir = at(2026, 9, 28, 20, 1)
        val a = offer("Celeste", soir - 10 * hour)
        val b = offer("Tunic", soir - 9 * hour)
        Graph.store.update {
            state(soir, 20, a, b) { s -> s.copy(digestHeld = mapOf(a.key to soir - 10 * hour, b.key to soir - 9 * hour)) }
        }
        // Avant 20 h : rien ne part.
        Digest.ring(app, at(2026, 9, 28, 19, 30), paris)
        assertEquals(0, shadowOf(nm).allNotifications.size)
        assertEquals(2, Graph.store.value.digestHeld.size)
        // A 20 h : une seule notification, qui dit deux jeux.
        Digest.ring(app, soir, paris)
        val posted = shadowOf(nm).allNotifications
        assertEquals(1, posted.size)
        assertEquals(app.resources.getQuantityString(R.plurals.notif_digest_title, 2, 2), posted[0].extras.getString(android.app.Notification.EXTRA_TITLE))
        assertTrue(Graph.store.value.digestHeld.isEmpty())
        // Un deuxieme passage ne renvoie rien.
        Digest.ring(app, soir + hour, paris)
        assertEquals(1, shadowOf(nm).allNotifications.size)
    }

    @Test
    fun nothingRingsWhenNewGamesAreSilencedOrAllTaken() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        val nm = app.getSystemService(NotificationManager::class.java)
        val soir = at(2026, 9, 28, 20, 1)
        val a = offer("Celeste", soir - 10 * hour)
        Graph.store.update {
            state(soir, 20, a) { s -> s.copy(settings = s.settings.copy(notifyNew = false), digestHeld = mapOf(a.key to soir - 10 * hour)) }
        }
        Digest.ring(app, soir, paris)
        assertEquals(0, shadowOf(nm).allNotifications.size)
        assertTrue("le tiroir se vide quand meme", Graph.store.value.digestHeld.isEmpty())
    }
}
