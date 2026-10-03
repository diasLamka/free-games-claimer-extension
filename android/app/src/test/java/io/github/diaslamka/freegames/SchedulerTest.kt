package io.github.diaslamka.freegames

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.Configuration
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.Worker
import androidx.work.testing.WorkManagerTestInitHelper
import io.github.diaslamka.freegames.work.Scheduler
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Un passage de veille qui tourne sous le nom unique de l'ouverture d'Epic ne doit pas etre annule par le
 * planificateur : en fin de passage, la veille programme l'ouverture suivante, et `REPLACE` annule le travail
 * en cours du meme nom, donc le passage lui-meme -- avant la recuperation de fond qui devait le suivre.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = android.app.Application::class)
class SchedulerTest {
    /** Un passage qui dure : il attend qu'on le libere. */
    class LongPass(context: Context, params: WorkerParameters) : Worker(context, params) {
        override fun doWork(): Result {
            started.countDown()
            return if (release.await(15, TimeUnit.SECONDS)) Result.success() else Result.failure()
        }

        companion object {
            @Volatile var started = CountDownLatch(1)
            @Volatile var release = CountDownLatch(1)
        }
    }

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private lateinit var manager: WorkManager

    @Before
    fun init() {
        LongPass.started = CountDownLatch(1)
        LongPass.release = CountDownLatch(1)
        // De vrais fils pour les travaux : un passage qui attend ne doit pas bloquer le test.
        val config = Configuration.Builder().setExecutor(Executors.newCachedThreadPool()).build()
        WorkManagerTestInitHelper.initializeTestWorkManager(context, config)
        manager = WorkManager.getInstance(context)
    }

    @After
    fun end() {
        LongPass.release.countDown()
    }

    // null : le travail n'existe plus (REPLACE annule le travail du meme nom, et le supprime).
    private fun state(id: java.util.UUID): WorkInfo.State? = manager.getWorkInfoById(id).get()?.state

    private fun awaitState(id: java.util.UUID, wanted: WorkInfo.State) {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (state(id) != wanted && System.nanoTime() < end) Thread.sleep(20)
        assertEquals(wanted, state(id))
    }

    @Test
    fun schedulingTheNextOpeningDoesNotCancelThePassThatTheOpeningStarted() {
        val pass = OneTimeWorkRequestBuilder<LongPass>().build()
        manager.enqueueUniqueWork(Scheduler.OPENING, ExistingWorkPolicy.REPLACE, pass).result.get()
        assertTrue(LongPass.started.await(10, TimeUnit.SECONDS))
        assertEquals(WorkInfo.State.RUNNING, state(pass.id))

        // C'est ce que fait Watcher a la fin du passage : l'ouverture suivante, dans trois jours.
        Scheduler.checkAt(context, System.currentTimeMillis() + 3 * 24 * 3_600_000L)

        assertEquals(WorkInfo.State.RUNNING, state(pass.id))
        LongPass.release.countDown()
        awaitState(pass.id, WorkInfo.State.SUCCEEDED)
    }

    private fun opening() = manager.getWorkInfosForUniqueWork(Scheduler.OPENING).get()

    @Test
    fun theNextOpeningIsScheduledWhenNothingIsWaiting() {
        Scheduler.checkAt(context, System.currentTimeMillis() + 3 * 24 * 3_600_000L)
        val waiting = opening()
        assertEquals(1, waiting.size)
        assertEquals(WorkInfo.State.ENQUEUED, waiting[0].state)
    }

    @Test
    fun aWaitingOpeningIsKeptByTheWatchButReplacedWhenTheScreenAsks() {
        Scheduler.checkAt(context, System.currentTimeMillis() + 3 * 24 * 3_600_000L)
        val first = opening().single().id

        // La veille repasse avec la meme date, ou une autre : ce qui attend reste.
        Scheduler.checkAt(context, System.currentTimeMillis() + 4 * 24 * 3_600_000L)
        assertEquals(first, opening().single().id)

        // L'utilisateur ouvre l'appli et Epic a deplace la date : elle est reprise tout de suite.
        Scheduler.checkAt(context, System.currentTimeMillis() + 2 * 24 * 3_600_000L, replace = true)
        val after = opening().single()
        assertTrue(after.id != first)
        assertEquals(WorkInfo.State.ENQUEUED, after.state)
    }
}
