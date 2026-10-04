package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Http
import io.github.diaslamka.freegames.notify.COVER_MAX_MS
import io.github.diaslamka.freegames.notify.coverTimeoutMs
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket

/**
 * Les recepteurs d'alarme (« derniere chance », « plus tard ») telechargent la jaquette avant de sonner, dans une fenetre
 * de dix secondes (goAsync) : un reseau lent ne doit pas empecher la notification, qui sonne alors sans image. Les
 * delais de l'appli (15, 25 et 40 s) ne tiennent pas dans cette fenetre.
 */
class CoverTimeoutTest {
    @Test
    fun aSlowCoverIsGivenUpAfterTheBudgetNotAfterFortySeconds() {
        // Un serveur qui accepte la connexion et ne repond jamais.
        val server = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        val http = Http({ "test" }, { null })
        try {
            val started = System.nanoTime()
            val image = runBlocking { http.bytes("http://127.0.0.1:${server.localPort}/jaquette.png", timeoutMs = 300) }
            val tookMs = (System.nanoTime() - started) / 1_000_000
            assertNull(image)
            // Marge large : le but est de ne pas attendre le delai de 40 s.
            assertTrue("a attendu $tookMs ms", tookMs < 5_000)
        } finally {
            server.close()
        }
    }

    @Test(timeout = 20_000)
    fun theTimeBudgetOfAReceiverIsSharedByItsNotifications() {
        val now = 1_000_000L
        // Hors recepteur (la veille de fond, dix minutes) : le plafond par image.
        assertEquals(COVER_MAX_MS, coverTimeoutMs(null, now))
        // Dans un recepteur : ce qu'il reste de la fenetre, jamais plus que le plafond.
        assertEquals(COVER_MAX_MS, coverTimeoutMs(now + 60_000, now))
        assertEquals(2_000L, coverTimeoutMs(now + 2_000, now))
        // Fenetre epuisee : plus de telechargement, la notification sonne sans image.
        assertEquals(0L, coverTimeoutMs(now, now))
        assertEquals(0L, coverTimeoutMs(now - 500, now))
    }
}
