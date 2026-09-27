package io.github.diaslamka.freegames

import android.app.Application
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.data.Year
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.YearCard
import io.github.diaslamka.freegames.ui.yearTexts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.util.Calendar
import java.util.TimeZone

/** Mon annee en jeux gratuits (1.6.0) : le meme bilan que watch/year.js. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "fr-rFR")
class YearTest {
    private fun t(y: Int, m: Int, d: Int = 10) = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { clear(); set(y, m - 1, d, 12, 0) }.timeInMillis
    private fun e(store: String, id: String, title: String, ts: Long, worth: String?, status: String = "claimed", via: String = "app") =
        "$store:$id" to LibraryEntry(store, id, title, null, worth, null, ts, status = status, via = via)

    private val state = AppState(
        library = mapOf(
            e(Stores.EPIC, "hades", "Hades", t(2026, 3), "24,99 €"),
            e(Stores.GOG, "gris", "Gris", t(2026, 3, 20), "16,79 €"),
            e(Stores.EPIC, "celeste", "Celeste", t(2026, 7), "19,99 €", via = "pc"),
            e(Stores.EPIC, "tunic", "Tunic", t(2026, 7, 2), "29,99 €"),
            e(Stores.STEAM, "400", "Portal", t(2026, 7, 15), null),
            e(Stores.EPIC, "vieux", "Vieux", t(2025, 6), "59,99 €"),
            e(Stores.EPIC, "rate", "Rate", t(2026, 5), "9,99 €", status = "failed"),
        ),
        ratings = mapOf(
            "app:400" to Rating(0, percent = 90, total = 1000),
            "t:hades" to Rating(0, percent = 97, total = 100),
            "t:gris" to Rating(0, percent = 100, total = 20),
        ),
    )

    @Test
    fun aYearIsWhatWasTakenThatYear() {
        assertEquals(listOf(2026, 2025), Year.years(state))
        val r = Year.recap(state, 2026, "EUR")
        assertEquals(5, r.count)
        assertEquals(91.76, r.value!!, 0.001)
        assertEquals("EUR", r.currency)
        assertEquals(listOf(Stores.EPIC to 3, Stores.GOG to 1, Stores.STEAM to 1), r.stores)
        assertEquals("2026-07" to 3, r.bestMonth)
        assertEquals(listOf("Tunic", "Hades", "Celeste"), r.top.map { it.title })
        assertEquals(Year.Rated("Hades", 97), r.bestRated)
        assertEquals(1, r.byPc)
        assertNull(Year.recap(AppState(), 2026, "EUR").bestRated)
    }

    @Test
    fun theCardIsDrawnAtTheRightSizeInTheCharterColours() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val bmp = YearCard.draw(app, yearTexts(app, Year.recap(state, 2026, "EUR")))
        assertEquals(YearCard.W, bmp.width)
        assertEquals(YearCard.H, bmp.height)
        assertEquals(0xFF000000.toInt(), bmp.getPixel(10, 10))
        assertEquals(0xFFE8FF00.toInt(), bmp.getPixel(900, 380))
        val dir = File(System.getProperty("screenshots") ?: "build/screenshots").apply { mkdirs() }
        File(dir, "E-1-annee.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
