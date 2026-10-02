package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Evening
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.EveningState
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.PlayMedian
import io.github.diaslamka.freegames.model.TonightInfo
import io.github.diaslamka.freegames.model.TonightPick
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

/** « Ta soiree choisit le jeu » (1.23.0) : le creneau libre de l'agenda, et le jeu qui y tient. */
class EveningTest {
    private val zone = ZoneId.of("Europe/Paris")
    private fun at(h: Int, m: Int = 0, day: Int = 2): Long = LocalDate.of(2026, 10, day).atTime(h, m).atZone(zone).toInstant().toEpochMilli()
    private fun busy(h1: Int, m1: Int, h2: Int, m2: Int, day: Int = 2) = Evening.Busy(at(h1, m1, day), at(h2, m2, day))

    @Test
    fun theEveningRunsFromSixToElevenThirtyAndMovesToTomorrowAfterTen() {
        val w = Evening.window(at(15), zone)
        assertEquals(at(18), w.from)
        assertEquals(at(23, 30), w.to)
        assertEquals(at(22, 30), w.earlyTo)
        assertEquals(false, w.tomorrow)
        val tard = Evening.window(at(22, 15), zone)
        assertEquals(true, tard.tomorrow)
        assertEquals(at(18, day = 3), tard.from)
        assertEquals(at(0, day = 4), tard.morningFrom)
    }

    @Test
    fun theLongestFreeGapIsWhatCounts() {
        // 18 h 30 : libre jusqu'a 20 h (90 min), un diner 20 h-21 h, puis libre jusqu'a 23 h 30 (150 min).
        val e = Evening.free(at(18, 30), zone, listOf(busy(20, 0, 21, 0)), emptyList())
        assertEquals(150, e.minutes)
        assertEquals(at(21), e.from)
        assertEquals(at(23, 30), e.to)
        assertEquals(false, e.earlyWake)
        assertEquals(false, e.tomorrow)
    }

    @Test
    fun overlappingEventsMergeAndTinyGapsAreNotAGame() {
        // Deux evenements qui se chevauchent, puis un trou de 20 minutes : seul le reste compte.
        val e = Evening.free(at(18), zone, listOf(busy(18, 0, 19, 30), busy(19, 0, 20, 0), busy(20, 20, 21, 0)), emptyList())
        assertEquals("21 h -> 23 h 30", 150, e.minutes)
        assertEquals(at(21), e.from)
        // Une soiree entierement prise : 0 minute, et on le dit.
        val pris = Evening.free(at(18), zone, listOf(busy(17, 0, 23, 59)), emptyList())
        assertEquals(0, pris.minutes)
        // Un trou de 29 minutes n'est pas un creneau, un de 30 si.
        assertEquals(0, Evening.free(at(18), zone, listOf(busy(18, 29, 23, 30)), emptyList()).minutes)
        assertEquals(30, Evening.free(at(18), zone, listOf(busy(18, 30, 23, 30)), emptyList()).minutes)
    }

    @Test
    fun anEventBeforeNineTomorrowCutsTheEveningShort() {
        val tot = Evening.free(at(18), zone, emptyList(), listOf(busy(8, 0, 9, 0, day = 3)))
        assertEquals(true, tot.earlyWake)
        assertEquals(at(22, 30), tot.to)
        assertEquals(270, tot.minutes)
        val tard = Evening.free(at(18), zone, emptyList(), listOf(busy(9, 30, 10, 0, day = 3)))
        assertEquals(false, tard.earlyWake)
        assertEquals(at(23, 30), tard.to)
    }

    @Test
    fun theTimeAlreadyPassedIsNotFree() {
        val e = Evening.free(at(21), zone, emptyList(), emptyList())
        assertEquals(at(21), e.from)
        assertEquals(150, e.minutes)
        val minuit = Evening.free(at(23, 40), zone, emptyList(), emptyList())
        assertEquals("passe 22 h : on prepare la soiree de demain", true, minuit.tomorrow)
    }

    @Test
    fun theTimeIsAnHourOrAnEvening() {
        assertEquals(Tonight.HOUR, Evening.timeFor(45))
        assertEquals(Tonight.HOUR, Evening.timeFor(89))
        assertEquals(Tonight.EVENING, Evening.timeFor(90))
        assertEquals("3 h 30", Evening.durationText(210))
        assertEquals("2 h", Evening.durationText(120))
        assertEquals("45 min", Evening.durationText(45))
        assertEquals("1 h 05", Evening.durationText(65))
    }

    @Test
    fun aReadingStaysValidForThreeHours() {
        val e = EveningState(at = 1000, minutes = 120, from = 0, to = 0)
        assertNotNull(Evening.fresh(e, 1000 + Evening.FRESH_MS - 1))
        assertNull(Evening.fresh(e, 1000 + Evening.FRESH_MS))
        assertNull(Evening.fresh(null, 5))
        assertNull("une horloge qui recule ne rend rien de frais", Evening.fresh(e, 500))
    }

    @Test
    fun aGameThatFitsBeatsOneThatDoesNot() {
        assertEquals("tonight_fit_tight", Evening.fit(240, 150).key)
        assertEquals(2.5, Evening.fit(240, 150).bonus, 0.0)
        assertEquals("tonight_fit_short", Evening.fit(240, 60).key)
        assertEquals("plus de 90 % : a peu pres la soiree", "tonight_fit_close", Evening.fit(240, 230).key)
        assertEquals("tonight_fit_over", Evening.fit(120, 600).key)
        assertEquals("trop long pour une heure", "tonight_fit_long", Evening.fit(60, 300).key)
        assertTrue(Evening.fit(60, 300).bonus < 0)
        assertEquals(listOf("2 h 30"), Evening.fit(240, 150).args)
    }

    private fun reviews(playtimes: List<Int>) =
        """{"success":1,"reviews":[${playtimes.joinToString(",") { """{"author":{"playtime_forever":$it}}""" }}]}"""

    @Test
    fun theMedianIsReadFromRecentReviewers() {
        val impair = Evening.parseMedian(reviews((1..41).map { it * 60 }), 7)!!
        assertEquals(21 * 60, impair.minutes)
        assertEquals(41, impair.n)
        val pair = Evening.parseMedian(reviews((1..40).map { it * 60 }), 7)!!
        assertEquals(((20 + 21) * 60) / 2, pair.minutes)
        // Trop peu d'avis avec un temps de jeu : pas de mediane. Les zeros ne comptent pas.
        val peu = Evening.parseMedian(reviews((1..29).map { it * 60 }), 7)!!
        assertNull(peu.minutes)
        assertEquals(29, peu.n)
        assertNull("des auteurs sans temps de jeu ne disent rien", Evening.parseMedian(reviews(List(60) { 0 }), 7)!!.minutes)
        assertNull(Evening.parseMedian("pas du json", 7))
        assertNull(Evening.parseMedian("""{"success":0}""", 7))
    }

    @Test
    fun refreshReadsFourAtMostWithoutCookies() = runBlocking {
        val asked = ArrayList<String>()
        val fetcher = object : Fetcher {
            override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
                asked += url
                assertTrue("aucun cookie", !withCookies)
                return if ("appreviews/9" in url) HttpResult(500, "") else HttpResult(200, reviews((1..35).map { it * 60 }))
            }
        }
        val got = Evening.refresh(fetcher, listOf("1", "2", "3", "4", "5", "6"), 7)
        assertEquals(Evening.PER_RUN, asked.size)
        assertEquals(setOf("1", "2", "3", "4"), got.keys)
        assertTrue(asked.all { "filter=recent" in it && "language=all" in it })
        val ko = Evening.refresh(fetcher, listOf("9"), 7)
        assertTrue("une reponse en erreur ne note rien", ko.isEmpty())
        assertTrue(Evening.needs(null, 7))
        assertTrue(!Evening.needs(PlayMedian(at = 7, minutes = 90, n = 40), 7 + Evening.MEDIAN_FRESH_MS - 1))
        assertTrue(Evening.needs(PlayMedian(at = 7, minutes = null, n = 3), 7 + Evening.MEDIAN_NONE_MS))
    }

    @Test
    fun theEveningPicksTheGameThatFitsYourFreeTime() {
        val now = at(19)
        fun info(id: String) = TonightInfo(at = now, v = Tonight.INFO_VERSION, name = id, percent = 90, reviews = 500)
        val state = AppState(
            owned = mapOf(
                "steam:1" to OwnedGame("steam", "1", "Court"),
                "steam:2" to OwnedGame("steam", "2", "Interminable"),
            ),
            tonightApps = mapOf("1" to info("1"), "2" to info("2")),
            medians = mapOf(
                "1" to PlayMedian(at = now, minutes = 150, n = 80),
                "2" to PlayMedian(at = now, minutes = 3000, n = 80),
            ),
            evening = EveningState(at = now, minutes = 240, from = at(19), to = at(23)),
            tonight = TonightPick(time = Tonight.CALENDAR),
        )
        val (jeu, _) = Tonight.current(state, now, random = { 0.0 })
        assertEquals("Court", jeu!!.c.title)
        assertTrue(jeu.reasons.any { it.key == "tonight_fit_tight" })
        // Le mode agenda sans creneau frais se comporte comme « peu importe » : aucune raison inventee.
        val sans = Tonight.current(state.copy(evening = null), now, random = { 0.0 }).first!!
        assertTrue(sans.reasons.none { it.key.startsWith("tonight_fit") })
        assertEquals(Tonight.ANY, Tonight.effectiveTime(state.copy(evening = null), now))
        assertEquals(Tonight.EVENING, Tonight.effectiveTime(state, now))
        assertEquals(Tonight.HOUR, Tonight.effectiveTime(state.copy(evening = state.evening!!.copy(minutes = 45)), now))
        // Un autre temps choisi a la main ignore l'agenda.
        assertEquals(Tonight.WEEKEND, Tonight.effectiveTime(state.copy(tonight = TonightPick(time = Tonight.WEEKEND)), now))
    }
}
