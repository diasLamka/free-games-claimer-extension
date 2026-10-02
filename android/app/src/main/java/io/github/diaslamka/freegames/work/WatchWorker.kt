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
import io.github.diaslamka.freegames.data.Watcher
import java.util.concurrent.TimeUnit

/** La veille de fond : un passage, ecran eteint ou non. */
class WatchWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = try {
        Watcher.check(applicationContext, "fond")
        // Une mise a jour de l'appli existe-t-elle ? Au plus une recherche par jour ; on previent, on n'installe rien.
        checkForUpdate()
        // Ecran eteint (reglage coupe par defaut) : ce qui reste a prendre, sur place.
        BackgroundClaim.run(applicationContext)
        if (BackgroundClaim.more(System.currentTimeMillis())) Scheduler.soon(applicationContext)
        Result.success()
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        if (runAttemptCount < 3) Result.retry() else Result.failure()
    }
}

private suspend fun WatchWorker.checkForUpdate() {
    try {
        Graph.init(applicationContext)
        if (!Graph.store.value.settings.notifyUpdate) return
        val net = io.github.diaslamka.freegames.data.AppUpdate.OkNet(Graph.http.client)
        val release = io.github.diaslamka.freegames.data.AppUpdate.backgroundCheck(
            applicationContext, net, io.github.diaslamka.freegames.data.UpdateToken.load(applicationContext),
            io.github.diaslamka.freegames.BuildConfig.VERSION_NAME, System.currentTimeMillis(),
        )
        if (release != null) io.github.diaslamka.freegames.notify.Notifier.updateAvailable(applicationContext, release.version)
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        // Une recherche ratee ne doit jamais faire echouer la veille.
    }
}

object Scheduler {
    private const val PERIODIC = "veille"
    private const val OPENING = "ouverture-epic"
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
     */
    fun checkAt(context: Context, whenMs: Long) {
        val delay = whenMs - System.currentTimeMillis()
        if (delay <= 0 || delay > 8L * 24 * 3_600_000) return
        val req = OneTimeWorkRequestBuilder<WatchWorker>()
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(network)
            .build()
        manager(context)?.enqueueUniqueWork(OPENING, ExistingWorkPolicy.REPLACE, req)
    }
}
