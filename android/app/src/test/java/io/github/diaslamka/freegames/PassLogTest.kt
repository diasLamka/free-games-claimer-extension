package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.data.StateStore
import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.PassRecord
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

/**
 * Le journal des passes de la veille (1.27.0). Une passe de fond ne laissait aucune trace : impossible de dire apres coup
 * si elle avait tourne, combien de temps, ni pourquoi elle avait echoue.
 */
class PassLogTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun store() = StateStore(File(tmp.root, "etat.json"))
    private fun rec(at: Long) = PassRecord(at = at, ms = 1, reason = "fond", outcome = PassLog.OK)

    @Test
    fun theNewestPassComesFirstAndOnlyThirtyAreKept() {
        var log = emptyList<PassRecord>()
        for (i in 1..45) log = PassLog.add(log, rec(i.toLong()))
        assertEquals(PassLog.MAX, log.size)
        assertEquals(45L, log.first().at)
        assertEquals(16L, log.last().at)
    }

    @Test
    fun aPassThatEndsIsRecordedWithWhatItFoundAndHowLongItTook() = runBlocking {
        val s = store()
        var t = 1_000L
        val summary = PassLog.track(s, "fond", screenOff = true, clock = { t.also { t += 4_200 } }) { Watcher.Summary(offers = 14, fresh = 1, errors = emptyList()) }
        assertEquals(14, summary.offers)
        val r = s.value.watchLog.single()
        assertEquals(PassRecord(at = 1_000, ms = 4_200, reason = "fond", outcome = PassLog.OK, offers = 14, fresh = 1, screenOff = true), r)
    }

    @Test
    fun aPassWithSourceErrorsIsRecordedAsSuch() = runBlocking {
        val s = store()
        PassLog.track(s, "ecran") { Watcher.Summary(offers = 3, fresh = 0, errors = listOf("gog : HTTP 502", "x".repeat(400), "c", "d")) }
        val r = s.value.watchLog.single()
        assertEquals(PassLog.ERRORS, r.outcome)
        // Trois erreurs au plus, de 160 caracteres au plus : le journal ne grossit pas.
        assertEquals(3, r.errors.size)
        assertTrue(r.errors.all { it.length <= 160 })
    }

    @Test
    fun aPassThatThrowsIsRecordedAsFailedAndStillThrows() = runBlocking {
        val s = store()
        try {
            PassLog.track(s, "fond") { throw IOException("reseau coupe") }
            fail("l'exception doit remonter")
        } catch (e: IOException) {
            assertEquals("reseau coupe", e.message)
        }
        val r = s.value.watchLog.single()
        assertEquals(PassLog.FAILED, r.outcome)
        assertEquals(listOf("reseau coupe"), r.errors)
    }

    @Test
    fun aPassCutShortIsRecordedAsCancelledAndTheCancellationIsNotSwallowed() = runBlocking {
        val s = store()
        var carriedOn = false
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            PassLog.track(s, "fond") { awaitCancellation() }
            carriedOn = true
        }
        job.cancelAndJoin()
        assertFalse(carriedOn)
        assertEquals(PassLog.CANCELLED, s.value.watchLog.single().outcome)
    }

    @Test
    fun everyPassIsAlsoHandedToTheLogcatHook() = runBlocking {
        val s = store()
        val seen = mutableListOf<PassRecord>()
        PassLog.track(s, "fond", onRecord = { seen += it }) { Watcher.Summary(2, 1, emptyList()) }
        runCatching { PassLog.track(s, "test", onRecord = { seen += it }) { throw IOException("x") } }
        assertEquals(listOf(PassLog.OK, PassLog.FAILED), seen.map { it.outcome })
        // Une ligne lisible dans `adb logcat -s FGC` : le journal Android est ce qu'on a sous la main sans l'appli.
        assertEquals("passe fond ok : 2 offres, 1 nouveau(x), 0 erreur(s), 1 ms", PassLog.line(seen[0].copy(ms = 1)))
        assertTrue(PassLog.line(PassRecord(0, 12, "test", PassLog.OK, screenOff = true)).endsWith("ecran eteint"))
    }

    @Test
    fun aDurationReadsInSecondsThenMinutes() {
        assertEquals("<1 s", PassLog.duration(400))
        assertEquals("4 s", PassLog.duration(4_200))
        assertEquals("59 s", PassLog.duration(59_400))
        assertEquals("1 min 12 s", PassLog.duration(72_000))
        assertEquals("10 min", PassLog.duration(600_000))
    }

    @Test
    fun theBackgroundClaimCountIsAttachedToThePassThatMadeIt() = runBlocking {
        val s = store()
        PassLog.track(s, "fond", clock = { 1_000L }) { Watcher.Summary(1, 0, emptyList()) }
        PassLog.track(s, "ecran", clock = { 9_000L }) { Watcher.Summary(1, 0, emptyList()) }
        PassLog.noteClaimed(s, startedAt = 500L, claimed = 2)
        val log = s.value.watchLog
        // Le plus recent d'abord : le passage « ecran » n'a pas fait de recuperation de fond, il n'est pas touche.
        assertEquals(null, log[0].claimed)
        assertEquals(2, log[1].claimed)
        // Un passage anterieur au debut du travail n'est jamais choisi.
        PassLog.noteClaimed(s, startedAt = 20_000L, claimed = 7)
        assertEquals(listOf(null, 2), s.value.watchLog.map { it.claimed })
    }

    private val hour = 3_600_000L
    private fun passAt(at: Long, ms: Long) = PassRecord(at = at, ms = ms, reason = "fond", outcome = PassLog.OK)

    @Test
    fun theLastDayOfWorkIsCountedFromTheLog() {
        val now = 1_790_000_000_000L
        // Deux passages dans le jour (4 s et 2 s), un d'hier soir : hors fenetre.
        val log = listOf(passAt(now - hour, 4_000), passAt(now - 5 * hour, 2_000), passAt(now - 30 * hour, 9_000))
        assertEquals(PassLog.Cost(passes = 2, ms = 6_000, atLeast = false), PassLog.cost(log, now))
    }

    @Test
    fun anEmptyLogCostsNothing() {
        assertEquals(PassLog.Cost(0, 0, false), PassLog.cost(emptyList(), 1_790_000_000_000L))
    }

    @Test
    fun aFullLogWhoseOldestPassIsStillInsideTheDayOnlyGivesALowerBound() {
        val now = 1_790_000_000_000L
        val log = (0 until PassLog.MAX).map { passAt(now - it * 30 * 60_000L, 1_000) }
        val cost = PassLog.cost(log, now)
        assertEquals(PassLog.MAX, cost.passes)
        assertTrue(cost.atLeast)
        // Un journal plein dont le plus ancien passage est deja hors du jour n'a rien perdu.
        assertEquals(false, PassLog.cost((0 until PassLog.MAX).map { passAt(now - it * hour, 1_000) }, now).atLeast)
    }

    @Test
    fun theLogIsSavedWithTheState() = runBlocking {
        val file = File(tmp.root, "etat.json")
        PassLog.track(StateStore(file), "test") { Watcher.Summary(1, 0, emptyList()) }
        assertEquals("test", StateStore(file).value.watchLog.single().reason)
    }
}
