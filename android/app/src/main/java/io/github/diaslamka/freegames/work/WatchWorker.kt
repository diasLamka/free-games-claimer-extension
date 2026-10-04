package io.github.diaslamka.freegames.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.diaslamka.freegames.claim.BackgroundClaim
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.data.Watcher
import java.util.concurrent.TimeUnit

/** La veille de fond : un passage, ecran eteint ou non. */
class WatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    companion object {
        const val KEY_TEST = "test"
    }

    override suspend fun doWork(): Result {
        // Un test (1.27.0) : le meme chemin que la veille, note « test » dans le journal, et son resultat dit en notification.
        val test = inputData.getBoolean(KEY_TEST, false)
        // Les dix minutes du systeme courent depuis ici : la recuperation de fond en tient compte.
        val startedAt = System.currentTimeMillis()
        return try {
            Watcher.check(applicationContext, if (test) "test" else "fond")
            // Ecran eteint (reglage coupe par defaut) : ce qui reste a prendre, sur place. Le journal ne garde que les recuperations faites.
            val won = BackgroundClaim.run(applicationContext, startedAt)
            if (won > 0) PassLog.noteClaimed(Graph.store, startedAt, won)
            if (test) announceTest(startedAt)
            if (BackgroundClaim.more(System.currentTimeMillis())) Scheduler.soon(applicationContext)
            // Une mise a jour de l'appli existe-t-elle ? APRES les recuperations : installer relance l'appli, et ne doit couper aucune page en route.
            checkForUpdate()
            Result.success()
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            if (test) {
                // Un test ne se rejoue pas : son echec est dit, une fois.
                runCatching { announceTest(startedAt) }
                Result.failure()
            } else if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private fun announceTest(startedAt: Long) {
        val s = Graph.store.value
        s.watchLog.firstOrNull { it.reason == "test" && it.at >= startedAt }
            ?.let { io.github.diaslamka.freegames.notify.Notifier.testDone(applicationContext, it, s.settings.claimInBackground) }
    }
}

private suspend fun WatchWorker.checkForUpdate() {
    try {
        Graph.init(applicationContext)
        val settings = Graph.store.value.settings
        if (!settings.notifyUpdate && !settings.autoUpdate) return
        val net = io.github.diaslamka.freegames.data.AppUpdate.OkNet(Graph.http.client)
        val release = io.github.diaslamka.freegames.data.AppUpdate.latest(
            applicationContext, net, io.github.diaslamka.freegames.data.UpdateToken.load(applicationContext),
            io.github.diaslamka.freegames.BuildConfig.VERSION_NAME, System.currentTimeMillis(),
        ) ?: return
        // Mise a jour automatique (1.25.0) : seulement si Android a deja autorise l'appli, et apres les memes verifications.
        if (settings.autoUpdate && io.github.diaslamka.freegames.data.Install.allowed(applicationContext)) {
            io.github.diaslamka.freegames.data.UpdateRunner.install(applicationContext, release)
            return
        }
        if (settings.notifyUpdate && io.github.diaslamka.freegames.data.AppUpdate.firstTimeFor(applicationContext, release.version)) {
            io.github.diaslamka.freegames.notify.Notifier.updateAvailable(applicationContext, release.version)
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        // Une recherche ratee ne doit jamais faire echouer la veille.
    }
}

object Scheduler {
    internal const val TEST = "test-veille"

    /** Le passage de test (1.27.0) : le meme travail que la veille, marque comme test, qui dit son resultat en notification. */
    internal fun testRequest(): androidx.work.OneTimeWorkRequest =
        OneTimeWorkRequestBuilder<WatchWorker>().setInputData(androidx.work.workDataOf(WatchWorker.KEY_TEST to true)).setConstraints(network).build()

    /** Lance un passage de test maintenant, dans le travail de fond (WorkManager) : c'est cet environnement qu'on veut voir tourner. Un second appui remplace le premier. */
    fun testNow(context: Context) {
        manager(context)?.enqueueUniqueWork(TEST, ExistingWorkPolicy.REPLACE, testRequest())
    }

    private const val PERIODIC = "veille"
    internal const val OPENING = "ouverture-epic"
    private const val FOLLOW_UP = "suite-recuperation"
    private const val DIGEST = "resume-du-jour"

    /** Sans planificateur (environnement de test), l'appli s'ouvre quand meme : la veille manque, pas l'ecran. */
    private fun manager(context: Context): WorkManager? = try {
        WorkManager.getInstance(context)
    } catch (e: IllegalStateException) {
        android.util.Log.w("FGC", "planificateur indisponible : ${e.message}")
        null
    }

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Toutes les `hours` heures, tant qu'il y a du reseau. */
    fun periodic(context: Context, hours: Int, replace: Boolean = false) {
        val req = PeriodicWorkRequestBuilder<WatchWorker>(hours.coerceIn(1, 24).toLong(), TimeUnit.HOURS)
            .setConstraints(network)
            .build()
        manager(context)?.enqueueUniquePeriodicWork(
            PERIODIC,
            if (replace) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP,
            req,
        )
    }

    /** Il reste des jeux apres un passage de fond : on revient dans un quart d'heure. */
    fun soon(context: Context) {
        val req = OneTimeWorkRequestBuilder<WatchWorker>()
            .setInitialDelay(15, TimeUnit.MINUTES)
            .setConstraints(network)
            .build()
        manager(context)?.enqueueUniqueWork(FOLLOW_UP, ExistingWorkPolicy.KEEP, req)
    }

    /**
     * Le resume du jour (1.13.0) : un passage de veille a l'heure choisie.
     * `KEEP` depuis la veille elle-meme -- `REPLACE` annulerait le travail en
     * cours, donc le passage qui vient justement d'envoyer le resume --, et
     * `REPLACE` quand c'est l'utilisateur qui change l'heure.
     */
    fun digestAt(context: Context, whenMs: Long, replace: Boolean = false) {
        val delay = whenMs - System.currentTimeMillis()
        if (delay <= 0 || delay > 36L * 3_600_000) return
        val req = OneTimeWorkRequestBuilder<WatchWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(network)
            .build()
        manager(context)?.enqueueUniqueWork(DIGEST, if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, req)
    }

    /** Resume coupe : plus rien a reveiller. */
    fun cancelDigest(context: Context) {
        manager(context)?.cancelUniqueWork(DIGEST)
    }

    /**
     * Epic annonce l'heure de sa prochaine ouverture : on la lit, au lieu de
     * sonder a l'aveugle -- comme l'ordonnanceur de l'extension.
     * `KEEP` depuis la veille elle-meme -- quand c'est l'ouverture qui l'a reveillee, le passage en cours
     * tourne sous CE nom, et `REPLACE` l'annulerait, donc la recuperation de fond qui doit le suivre --,
     * `REPLACE` quand la demande vient de l'ecran, ou une date qui a change est reprise tout de suite.
     * Si l'ouverture suivante n'a pas pu etre posee, le prochain passage de la veille la posera.
     */
    fun checkAt(context: Context, whenMs: Long, replace: Boolean = false) {
        val delay = whenMs - System.currentTimeMillis()
        if (delay <= 0 || delay > 8L * 24 * 3_600_000) return
        val req = OneTimeWorkRequestBuilder<WatchWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(network)
            .build()
        manager(context)?.enqueueUniqueWork(OPENING, if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP, req)
    }
}
