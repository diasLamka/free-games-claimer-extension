package io.github.diaslamka.freegames.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AppState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * La sentinelle de la veille (1.27.0). Si Android bride l'appli en arriere-plan, plus aucun passage n'a lieu -- et plus rien
 * ne le dit, puisque c'est la veille qui devait prevenir. Une alarme que chaque passage repousse (Watcher, a la fin de chaque
 * passage) et qui ne sonne donc que si la veille ne tourne plus : un interrupteur d'homme mort.
 *
 * Elle sonne deux fois et demie l'intervalle apres le dernier passage (trois heures au moins), previent, puis ne reprevient
 * que le lendemain -- ou apres un nouveau passage suivi d'un nouveau silence. Une alarme inexacte qui traverse le Doze
 * (comme « derniere chance ») : pas d'autorisation de plus.
 */
object Watchdog {
    const val FACTOR = 2.5
    const val MIN_MS = 3 * 3_600_000L
    const val REMIND_MS = 24 * 3_600_000L
    const val MIN_DELAY_MS = 60_000L
    private const val CODE = 7301

    /** Le retard a partir duquel la veille est dite arretee. */
    fun thresholdMs(checkHours: Int): Long = maxOf(MIN_MS, (checkHours * 3_600_000L * FACTOR).toLong())

    /**
     * Depuis combien de temps (ms) la veille ne tourne plus, ou null : elle tourne, elle n'a jamais tourne (premiere
     * ouverture : rien a surveiller), ou la sentinelle est coupee. Pure.
     */
    fun silentFor(s: AppState, now: Long): Long? {
        if (!s.settings.watchdog) return null
        val last = s.lastCheck ?: return null
        return (now - last).takeIf { it > thresholdMs(s.settings.checkHours) }
    }

    /** Quand l'alarme doit sonner, jamais dans le passe ; null : coupee, ou rien a surveiller. Pure. */
    fun nextAt(s: AppState, now: Long): Long? {
        if (!s.settings.watchdog) return null
        val last = s.lastCheck ?: return null
        val due = last + thresholdMs(s.settings.checkHours)
        // Deja prevenu pour CE silence (apres le dernier passage) : pas avant le lendemain.
        val warned = s.watchdogAt?.takeIf { it > last }
        val at = if (warned != null) maxOf(due, warned + REMIND_MS) else due
        return maxOf(at, now + MIN_DELAY_MS)
    }

    /** « 8 h », « 45 min » : de quoi dire depuis quand. */
    fun hoursText(ms: Long): String = if (ms >= 3_600_000L) "${ms / 3_600_000L} h" else "${ms / 60_000L} min"

    private fun pending(context: Context): PendingIntent =
        PendingIntent.getBroadcast(
            context, CODE, Intent(context, WatchdogReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Repousse l'alarme (chaque passage), ou la retire (sentinelle coupee, rien a surveiller). */
    fun arm(context: Context, s: AppState, now: Long) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val at = nextAt(s, now)
        if (at == null) {
            am.cancel(pending(context))
            return
        }
        runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context)) }
    }

    /** L'alarme a sonne : la veille ne tourne plus ? On previent une fois, puis on repose l'alarme. */
    suspend fun fire(context: Context, now: Long) {
        val s = Graph.store.value
        val silent = silentFor(s, now)
        val last = s.lastCheck
        val already = last != null && s.watchdogAt != null && s.watchdogAt > last && now - s.watchdogAt < REMIND_MS
        if (silent != null && !already) {
            Notifier.watchdog(context, silent)
            Graph.store.update { it.copy(watchdogAt = now) }
        }
        arm(context, Graph.store.value, now)
    }
}

/** L'alarme de la sentinelle, posee par l'appli elle-meme : jamais appelee du dehors. */
class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val app = context.applicationContext
                Graph.init(app)
                Watchdog.fire(app, System.currentTimeMillis())
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (_: Exception) {
                // Une sentinelle qui plante ne doit pas faire planter l'appli : la prochaine passe la reposera.
            } finally {
                done.finish()
            }
        }
    }
}
