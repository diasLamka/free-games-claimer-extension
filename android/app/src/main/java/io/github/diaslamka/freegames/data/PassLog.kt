package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.PassRecord
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * Le journal des passes de la veille (1.27.0) : les trente dernieres, la plus recente d'abord, dans l'etat de l'appli.
 * Une passe de fond ne laissait aucune trace -- impossible de dire apres coup si elle avait tourne, combien de temps, ni
 * pourquoi elle avait echoue. Ce que la page Sante et le diagnostic partageable lisent.
 */
object PassLog {
    const val MAX = 30
    const val OK = "ok"
    const val ERRORS = "errors"
    const val FAILED = "failed"
    const val CANCELLED = "cancelled"

    private const val MAX_ERRORS = 3
    private const val MAX_ERROR_CHARS = 160

    /** Le plus recent d'abord, trente au plus. */
    fun add(log: List<PassRecord>, r: PassRecord): List<PassRecord> = (listOf(r) + log).take(MAX)

    private suspend fun note(store: StateStore, r: PassRecord) {
        store.update { it.copy(watchLog = add(it.watchLog, r)) }
    }

    /**
     * Joue un passage et le note, quelle que soit sa fin : termine (avec ou sans erreurs de sources), en echec, ou
     * interrompu. L'exception et l'annulation remontent telles quelles ; seule une trace en reste.
     */
    suspend fun track(
        store: StateStore,
        reason: String,
        screenOff: Boolean = false,
        clock: () -> Long = System::currentTimeMillis,
        /** Appele avec chaque passage note : Watcher y met une ligne dans le journal Android (tag FGC). */
        onRecord: (PassRecord) -> Unit = {},
        block: suspend () -> Watcher.Summary,
    ): Watcher.Summary {
        val start = clock()
        fun record(outcome: String, summary: Watcher.Summary? = null, errors: List<String> = emptyList()) = PassRecord(
            at = start, ms = clock() - start, reason = reason, outcome = outcome,
            offers = summary?.offers ?: 0, fresh = summary?.fresh ?: 0, screenOff = screenOff,
            errors = errors.take(MAX_ERRORS).map { it.take(MAX_ERROR_CHARS) },
        )
        suspend fun write(r: PassRecord) {
            note(store, r)
            onRecord(r)
        }
        try {
            val summary = block()
            write(record(if (summary.errors.isEmpty()) OK else ERRORS, summary, summary.errors))
            return summary
        } catch (e: CancellationException) {
            withContext(NonCancellable) { write(record(CANCELLED)) }
            throw e
        } catch (e: Exception) {
            withContext(NonCancellable) { write(record(FAILED, errors = listOf(e.message ?: e.javaClass.simpleName))) }
            throw e
        }
    }

    /** Les jeux obtenus par la recuperation de fond d'un passage : rattaches au passage le plus recent depuis `startedAt`. */
    suspend fun noteClaimed(store: StateStore, startedAt: Long, claimed: Int) {
        store.update { s ->
            val i = s.watchLog.indexOfFirst { (it.reason == "fond" || it.reason == "test") && it.at >= startedAt }
            if (i < 0) s else s.copy(watchLog = s.watchLog.toMutableList().also { it[i] = it[i].copy(claimed = claimed) })
        }
    }

    /** La duree d'un passage, lisible : « <1 s », « 4 s », « 1 min 12 s ». */
    fun duration(ms: Long): String = when {
        ms < 1_000 -> "<1 s"
        ms < 60_000 -> "${ms / 1_000} s"
        else -> {
            val seconds = ms / 1_000
            val rest = seconds % 60
            if (rest == 0L) "${seconds / 60} min" else "${seconds / 60} min $rest s"
        }
    }

    /** Une ligne du journal Android : « passe fond ok : 14 offres, 1 nouveau(x), 0 erreur(s), 4200 ms ». */
    fun line(r: PassRecord): String =
        "passe ${r.reason} ${r.outcome} : ${r.offers} offres, ${r.fresh} nouveau(x), ${r.errors.size} erreur(s), ${r.ms} ms" +
            (if (r.screenOff) ", ecran eteint" else "")
}
