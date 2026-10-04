package io.github.diaslamka.freegames

import android.content.Context
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.claim.BackgroundClaim
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Les dix minutes du fond courent depuis le DEBUT du passage de la veille (WorkManager), pas depuis l'entree de la
 * recuperation : la lecture des magasins qui la precede peut durer plusieurs minutes, et un jeu entame a trois minutes
 * avec quatre de budget depasse la limite du systeme -- le travail est coupe en plein jeu.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class BackgroundBudgetTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun aGameWaitsInTheBackground() = runBlocking<Unit> {
        Graph.init(context)
        val now = System.currentTimeMillis()
        val luna = Offer(
            key = Offer.keyFor(Stores.AMAZON, "gris", "Gris"), source = "x", store = Stores.AMAZON, storeId = "gris", title = "Gris",
            url = "https://example.test/gris", end = now + 86_400_000, keepable = true,
        )
        Graph.store.update {
            AppState(
                offers = mapOf(luna.key to luna),
                accounts = mapOf(Stores.AMAZON to AccountState(Accounts.OK, now)),
                settings = Settings(claimInBackground = true),
            )
        }
    }

    /** La recuperation attend le fil principal pour creer sa page : on le laisse tourner pendant qu'on l'attend. */
    private fun await(job: Deferred<Int>): Int {
        val end = System.nanoTime() + 30_000_000_000L
        while (!job.isCompleted && System.nanoTime() < end) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        return runBlocking { job.await() }
    }

    private fun run(startedAt: Long): Int {
        val scope = CoroutineScope(Dispatchers.Default + Job())
        return await(scope.async { BackgroundClaim.run(context, startedAt) })
    }

    @Test
    fun noGameStartsOnceThePassHasAlreadySpentItsThreeMinutes() {
        // Le passage a commence il y a cinq minutes (la lecture des magasins a ete longue).
        assertEquals(0, run(startedAt = System.currentTimeMillis() - 5 * 60_000L))
        assertTrue("un jeu a ete entame hors du delai", Graph.store.value.attempts.isEmpty())
    }

    @Test
    fun aGameStartsWhileThePassStillHasTime() {
        run(startedAt = System.currentTimeMillis())
        // Sans vrai navigateur (Robolectric) l'essai echoue, mais il a eu lieu.
        assertTrue("aucun essai alors qu'il restait du temps", Graph.store.value.attempts.isNotEmpty())
    }
}
