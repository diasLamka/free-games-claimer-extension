package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.runCatchingSuspend
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Une coroutine annulee ne doit pas continuer comme si son appel avait echoue. `runCatching` et `catch (Exception)`
 * attrapent l'annulation : la veille annulee ecrivait quand meme un « introuvable » ou gardait un « non » non confirme.
 */
class CancellationTest {
    /** Un reseau qui ne repond jamais : on annule pendant qu'on l'attend. */
    private val never = object : Fetcher {
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult = awaitCancellation()
    }

    @Test
    fun plainRunCatchingLetsACancelledCoroutineCarryOnAndOursDoesNot() = runBlocking {
        var plain = false
        var ours = false
        val a = launch(start = CoroutineStart.UNDISPATCHED) { runCatching { delay(60_000) }; plain = true }
        val b = launch(start = CoroutineStart.UNDISPATCHED) { runCatchingSuspend { delay(60_000) }; ours = true }
        a.cancelAndJoin()
        b.cancelAndJoin()
        assertTrue("le piege : runCatching avale l'annulation", plain)
        assertFalse(ours)
    }

    @Test
    fun theHelperStillCatchesEveryOtherFailure() {
        assertEquals(3, runCatchingSuspend { 3 }.getOrNull())
        assertTrue(runCatchingSuspend { throw IOException("coupe") }.exceptionOrNull() is IOException)
        assertTrue(runCatchingSuspend { error("autre") }.isFailure)
    }

    @Test
    fun aCancelledAccountCheckGivesNoAnswer() = runBlocking {
        // Sinon la veille annulee gardait « inconnu » et l'ecrivait dans l'etat comme si c'etait la reponse du magasin.
        for (store in listOf(Stores.GOG, Stores.STEAM)) {
            var answer: Any? = null
            val job = launch(start = CoroutineStart.UNDISPATCHED) { answer = Accounts.check(store, "FR", 0L, http = never) }
            job.cancelAndJoin()
            assertNull("$store a repondu apres l'annulation : $answer", answer)
        }
    }
}
