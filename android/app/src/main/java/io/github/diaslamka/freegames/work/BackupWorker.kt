package io.github.diaslamka.freegames.work

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import io.github.diaslamka.freegames.data.AutoBackup
import io.github.diaslamka.freegames.data.BackupSecret
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.SafSink
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * La sauvegarde automatique (1.28.0) : une copie chiffree dans le dossier choisi, une fois par jour. Un echec n'est pas rejoue a vif :
 * il est inscrit dans les reglages (ce que l'utilisateur voit) et le lendemain recommence.
 */
class BackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        Graph.init(applicationContext)
        val folder = Graph.store.value.settings.backupFolder ?: return Result.success()
        val now = System.currentTimeMillis()
        val outcome = withContext(Dispatchers.Default) {
            val phrase = BackupSecret.load(applicationContext)
            when {
                phrase == null -> AutoBackup.Outcome.Failed(AutoBackup.ERR_PASSPHRASE)
                else -> AutoBackup.run(Graph.store.value, phrase, now, SafSink(applicationContext, Uri.parse(folder)))
            }
        }
        Graph.store.update { s ->
            s.copy(settings = s.settings.copy(
                backupAt = if (outcome is AutoBackup.Outcome.Done) now else s.settings.backupAt,
                backupError = (outcome as? AutoBackup.Outcome.Failed)?.reason,
            ))
        }
        Log.i("FGC", "sauvegarde automatique : " + when (outcome) {
            is AutoBackup.Outcome.Done -> "ok, ${outcome.name}, ${outcome.deleted.size} ancienne(s) supprimee(s)"
            is AutoBackup.Outcome.Failed -> "echec (${outcome.reason})"
        })
        return Result.success()
    }
}
