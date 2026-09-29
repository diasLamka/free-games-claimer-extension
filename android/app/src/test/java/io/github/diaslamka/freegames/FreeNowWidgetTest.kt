package io.github.diaslamka.freegames

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.widget.FreeNowWidget
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** « Gratuit maintenant » (1.16.0) : ce que le widget montre, dans quel ordre, et ce qu'il tait. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR-xxhdpi")
class FreeNowWidgetTest {
    private val now = 1_790_540_000_000L
    private val h = 3_600_000L

    private fun offer(store: String, id: String, title: String, end: Long?, source: String = "test", keepable: Boolean? = null, category: String? = null, start: Long? = null) =
        Offer(
            key = "$store:$id", source = source, store = store, storeId = id, title = title, url = "https://exemple.test/$id",
            start = start, end = end, keepable = keepable, category = category, firstSeen = now - h, lastSeen = now,
        )

    private val hades = offer(Stores.EPIC, "hades", "Hades", now + 30 * h)
    private val celeste = offer(Stores.GOG, "celeste", "Celeste", now + 5 * h)
    private val portal = offer(Stores.EPIC, "portal", "Portal", now + 80 * h)
    private val sans = offer(Stores.GOG, "sans", "Sans date", null)

    private fun state(vararg o: Offer) = AppState(offers = o.associateBy { it.key })

    @Test
    fun theOneEndingFirstComesFirstAndUnknownEndsGoLast() {
        val liste = FreeNowWidget.items(state(hades, sans, portal, celeste), now).map { it.shownTitle }
        assertEquals(listOf("Celeste", "Hades", "Portal", "Sans date"), liste)
    }

    @Test
    fun whatYouAlreadyHaveWhatIsOverAndWhatCannotBeKeptStayOut() {
        val fini = offer(Stores.EPIC, "fini", "Fini", now - h)
        val bientot = offer(Stores.EPIC, "bientot", "Bientot", now + 50 * h, start = now + 10 * h)
        val essai = offer(Stores.EPIC, "essai", "Essai", now + 50 * h, keepable = false)
        val butin = offer(Stores.GOG, "butin", "Pack de butin", now + 50 * h, source = "gamerpower", category = "loot")
        val steamPris = offer(Stores.STEAM, "400", "Steam pris", now + 50 * h)
        val s = state(hades, celeste, fini, bientot, essai, butin, steamPris).copy(
            library = mapOf("epic:hades" to LibraryEntry(Stores.EPIC, "hades", "Hades", null, null, null, now - h)),
            steamOwned = listOf("400"),
        )
        assertEquals(listOf("Celeste"), FreeNowWidget.items(s, now).map { it.shownTitle })
    }

    @Test
    fun theCountdownTicksOnItsOwnFromThePhoneClock() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val elapsed = 5_000_000L
        val v = FreeNowWidget.views(app, state(hades, celeste, portal, sans), now, elapsed).apply(app, FrameLayout(app))
        assertEquals("Celeste", v.findViewById<TextView>(R.id.free_title).text.toString())
        assertEquals(View.VISIBLE, v.findViewById<View>(R.id.free_clock).visibility)
        val clock = v.findViewById<Chronometer>(R.id.free_clock)
        assertEquals(elapsed + 5 * h, clock.base)
        assertTrue(clock.isCountDown)
        assertEquals(View.VISIBLE, v.findViewById<View>(R.id.free_claim).visibility)
        assertEquals("Gratuit maintenant · 4", v.findViewById<TextView>(R.id.free_kicker).text.toString())
    }

    @Test
    fun theFollowingGamesAreNamedWithTheirTimeAndTheRestIsCounted() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val texte = FreeNowWidget.more(app, FreeNowWidget.items(state(hades, celeste, portal, sans), now), now)
        assertEquals(3, texte.lines().size)
        assertTrue(texte.lines()[0].startsWith("Epic · Hades · "))
        assertEquals("GOG", FreeNowWidget.court(Stores.GOG))
        assertTrue(texte.lines()[1].contains("Portal"))
        assertEquals("+1", texte.lines()[2])
        val deux = FreeNowWidget.more(app, FreeNowWidget.items(state(hades, celeste), now), now)
        assertFalse(deux.contains("+"))
        assertEquals(1, deux.lines().size)
    }

    @Test
    fun nothingFreeShowsAnEmptyCardWithoutClockNorButton() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val v = FreeNowWidget.views(app, AppState(), now).apply(app, FrameLayout(app))
        assertEquals("Rien à prendre", v.findViewById<TextView>(R.id.free_title).text.toString())
        assertEquals(View.GONE, v.findViewById<View>(R.id.free_clock).visibility)
        assertEquals(View.GONE, v.findViewById<View>(R.id.free_claim).visibility)
    }

    @Test
    fun aGameWithoutEndDateShowsNoClock() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val v = FreeNowWidget.views(app, state(sans), now).apply(app, FrameLayout(app))
        assertEquals("Sans date", v.findViewById<TextView>(R.id.free_title).text.toString())
        assertEquals(View.GONE, v.findViewById<View>(R.id.free_clock).visibility)
    }

    /* Rendu a la taille d'un widget 4 x 2 (350 x 190 dp en xxhdpi), pour le regarder. */
    @Test
    fun theWidgetIsDrawn() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val dir = File(System.getProperty("screenshots") ?: "build/screenshots").apply { mkdirs() }
        dessine(FreeNowWidget.views(app, state(hades, celeste, portal, sans), now).apply(app, FrameLayout(app)), 1050, 570, File(dir, "G-1-gratuit-maintenant.png"))
        dessine(FreeNowWidget.views(app, AppState(), now).apply(app, FrameLayout(app)), 1050, 570, File(dir, "G-2-gratuit-maintenant-vide.png"))
    }

    private fun dessine(v: View, w: Int, h: Int, f: File) {
        v.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w + 40, h + 40, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.drawColor(0xFF2E3B4E.toInt())
        c.translate(20f, 20f)
        v.draw(c)
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
