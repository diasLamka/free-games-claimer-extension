package io.github.diaslamka.freegames

import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkInfo
import androidx.work.WorkManager
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.work.Scheduler
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Les contraintes de la veille (Wi-Fi seulement, en charge seulement) jusque chez le planificateur D'ANDROID : WorkManager les
 * traduit en contraintes de JobScheduler, et c'est lui qui decide de lancer, ou non, le travail de fond.
 */
@RunWith(AndroidJUnit4::class)
class WatchConstraintsDeviceTest {
    @get:Rule val emulatorOnly = EmulatorOnly()

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    /**
     * Un UPDATE sur un travail periodique EN COURS ne vaut que pour son passage suivant (WorkManager) : son premier passage part des
     * l'ouverture de l'appli. Un reglage change pendant un passage est donc pris en compte au suivant ; le test attend le repos.
     */
    private fun waitUntilIdle() {
        val end = System.currentTimeMillis() + 150_000
        while (System.currentTimeMillis() < end) {
            val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork("veille").get()
            if (infos.none { it.state == WorkInfo.State.RUNNING }) return
            Thread.sleep(1_000)
        }
    }

    private fun setConstraints(wifiOnly: Boolean, chargingOnly: Boolean) = runBlocking {
        Graph.init(context)
        waitUntilIdle()
        Graph.store.update { it.copy(settings = it.settings.copy(wifiOnly = wifiOnly, chargingOnly = chargingOnly)) }
        Scheduler.periodic(context, 3, replace = true)
    }

    @After
    fun back() = setConstraints(wifiOnly = false, chargingOnly = false)

    private fun shell(command: String): String {
        val pfd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    /** Les blocs « JOB ... » du planificateur qui sont a cette appli. */
    private fun ourJobs(): List<String> {
        val dump = shell("dumpsys jobscheduler")
        return Regex("(?m)^\\s*JOB .*").findAll(dump).map { m ->
            val rest = dump.substring(m.range.first)
            rest.substring(0, rest.indexOf("\n  JOB ", 5).takeIf { it > 0 } ?: minOf(rest.length, 4000))
        }.filter { it.contains(context.packageName) }.toList()
    }

    private fun waitForJob(predicate: (List<String>) -> Boolean): List<String> {
        val end = System.currentTimeMillis() + 15_000
        var jobs = ourJobs()
        while (!predicate(jobs) && System.currentTimeMillis() < end) {
            Thread.sleep(500)
            jobs = ourJobs()
        }
        return jobs
    }

    /** Ce que le systeme exige pour lancer ce travail : la ligne « Required constraints » du bloc, pas celles deja satisfaites. */
    private fun required(job: String): String = Regex("Required constraints:[^\n]*").find(job)?.value.orEmpty()

    @Test
    fun theSystemSchedulerKnowsTheChargingAndTheUnmeteredConstraints() {
        setConstraints(wifiOnly = false, chargingOnly = false)
        val plain = waitForJob { it.isNotEmpty() }
        assertTrue("la veille est planifiee chez le systeme", plain.isNotEmpty())
        assertFalse("sans reglage, pas de contrainte de charge : ${plain.map { required(it) }}", plain.any { required(it).contains("CHARGING") })

        setConstraints(wifiOnly = true, chargingOnly = true)
        val limited = waitForJob { jobs -> jobs.any { required(it).contains("CHARGING") } }
        assertTrue("la charge est une contrainte du systeme : ${limited.map { required(it) }} -- ${limited.firstOrNull()?.take(1500)}", limited.any { required(it).contains("CHARGING") })
        assertTrue("le reseau sans limite aussi", limited.any { it.contains("NOT_METERED") || it.contains("UNMETERED") })
    }
}
