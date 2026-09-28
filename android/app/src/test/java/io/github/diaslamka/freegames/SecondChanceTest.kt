package io.github.diaslamka.freegames

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.Seen
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.notify.Notifier
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** « Deuxieme chance » (1.12.0) : les memes cas que test/second-chance.test.mjs. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR")
class SecondChanceTest {
    private val day = 86_400_000L
    private val now = 1_790_500_000_000L
    private val mars = 1_773_339_600_000L

    private fun offer(title: String, store: String = Stores.GOG, start: Long? = now - 2 * day) =
        Offer(key = "$store:${title.lowercase()}", source = store, store = store, storeId = title.lowercase(), title = title,
            url = "https://example.com/${title.lowercase()}", start = start, end = now + 3 * day, keepable = true, firstSeen = now - day)

    private fun state(vararg passes: Pair<String, Seen>, library: Map<String, LibraryEntry> = emptyMap(), owned: Map<String, OwnedGame> = emptyMap()) =
        AppState(passes = passes.groupBy({ it.first }, { it.second }), library = library, owned = owned)

    @Test
    fun seenInMarchAndOfferedAgainIsASecondChance() {
        val s = state("hades" to Seen(Stores.EPIC, mars))
        val c = Rules.secondChance(offer("Hades"), s, now)
        assertNotNull(c)
        assertEquals(Stores.EPIC, c!!.store)
        assertEquals(mars, c.ts)
        // Une casse differente est le meme jeu ; le magasin n'y change rien.
        assertNotNull(Rules.secondChance(offer("HADES", Stores.EPIC), s, now))
    }

    @Test
    fun neverForAGameAlreadyOursOnAnyStore() {
        val s = state("tunic" to Seen(Stores.EPIC, mars))
        val pris = s.copy(library = mapOf("gog:tunic" to LibraryEntry(Stores.GOG, "tunic", "Tunic", null, null, null, mars + day, status = "claimed")))
        assertNull(Rules.secondChance(offer("Tunic"), pris, now))
        val collection = s.copy(owned = mapOf("steam:1" to OwnedGame(Stores.STEAM, "1", "Tunic")))
        assertNull(Rules.secondChance(offer("Tunic"), collection, now))
        // Un essai rate n'est pas une prise.
        val rate = s.copy(library = mapOf("epic:tunic" to LibraryEntry(Stores.EPIC, "tunic", "Tunic", null, null, null, mars, status = "failed")))
        assertNotNull(Rules.secondChance(offer("Tunic"), rate, now))
    }

    @Test
    fun neverAnUnknownGameNorAnOfferMeetingItself() {
        assertNull(Rules.secondChance(offer("Inconnu"), state("hades" to Seen(Stores.EPIC, mars)), now))
        // Le passage de cette offre elle-meme (meme debut) : pas une deuxieme chance.
        val elleMeme = state("hades" to Seen(Stores.GOG, now - 2 * day))
        assertNull(Rules.secondChance(offer("Hades"), elleMeme, now))
        // Un jour de marge avant le debut : une autre fois.
        assertNotNull(Rules.secondChance(offer("Hades"), state("hades" to Seen(Stores.EPIC, now - 4 * day)), now))
        // Sans debut connu (ni firstSeen), trois jours de recul.
        val sans = offer("Hades", start = null).copy(firstSeen = 0)
        assertNull(Rules.secondChance(sans, state("hades" to Seen(Stores.EPIC, now - day)), now))
        assertNotNull(Rules.secondChance(sans, state("hades" to Seen(Stores.EPIC, now - 4 * day)), now))
    }

    @Test
    fun theMostRecentEarlierPassIsTheOneSaid() {
        val s = state("hades" to Seen(Stores.EPIC, mars), "hades" to Seen(Stores.AMAZON, mars + 90 * day))
        assertEquals(Stores.AMAZON, Rules.secondChance(offer("Hades"), s, now)!!.store)
    }

    @Test
    fun theNotificationSaysItInTheTitleAndTheLineBefore() = runBlocking {
        val app = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        Graph.init(app)
        Notifier.createChannels(app)
        val t = System.currentTimeMillis()
        val hades = offer("Hades").copy(start = t - 2 * day, end = t + 3 * day, firstSeen = t - day)
        val s = AppState(offers = mapOf(hades.key to hades), passes = mapOf("hades" to listOf(Seen(Stores.EPIC, mars))))
        Notifier.newGame(app, hades, s)
        val nm = app.getSystemService(NotificationManager::class.java)
        val n = shadowOf(nm).allNotifications.single()
        assertEquals(app.getString(R.string.notif_second_chance_title, "Hades"), n.extras.getString(Notification.EXTRA_TITLE))
        val texte = n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString()
        assertTrue(texte, texte.contains("2026") && texte.contains("Epic"))
        // Sans passage precedent, la notification reste ordinaire.
        shadowOf(nm).allNotifications.forEach { nm.cancelAll() }
        Notifier.newGame(app, hades, s.copy(passes = emptyMap()))
        val simple = shadowOf(nm).allNotifications.single()
        assertEquals(app.getString(R.string.notif_new_title, "Hades", Stores.label(Stores.GOG)), simple.extras.getString(Notification.EXTRA_TITLE))
    }
}
