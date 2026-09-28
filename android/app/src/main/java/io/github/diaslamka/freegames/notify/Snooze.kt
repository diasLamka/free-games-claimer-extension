package io.github.diaslamka.freegames.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * « Plus tard » (1.12.0) : le bouton d'une notification de nouveau jeu la
 * retire et la repropose dans trois heures -- comme celui de l'extension,
 * qui reporte de six.
 *
 * Trois regles, et elles vont dans le meme sens : jamais rater le jeu.
 *   - pas de bouton quand l'offre finit dans moins de deux heures : la
 *     reporter serait la refuser en croyant gagner du temps ;
 *   - le rappel tombe au plus tard une heure avant la fin ;
 *   - un jeu pris entre-temps, ou une offre disparue, ne sonne pas.
 *
 * L'ETAT est la source de verite (`snoozed`), pas l'alarme : Android efface
 * les alarmes au redemarrage. L'alarme, inexacte (`setAndAllowWhileIdle`, la
 * permission des alarmes exactes est reservee par Google Play aux reveils),
 * ne fait que reveiller ; chaque passage de la veille sonne aussi ce qui est
 * du.
 */
object Snooze {
    const val SNOOZE_MS = 3 * 3_600_000L
    /** Sous ce reste, pas de bouton. */
    const val MIN_LEFT_MS = 2 * 3_600_000L
    /** Le rappel tombe au plus tard cette duree avant la fin. */
    const val MARGIN_MS = 3_600_000L
    const val ACTION_SNOOZE = "io.github.diaslamka.freegames.PLUS_TARD"
    const val ACTION_RING = "io.github.diaslamka.freegames.PLUS_TARD_RAPPEL"
    const val EXTRA_KEY = "offre"

    /** Le bouton est-il propose pour cette offre ? Pure. */
    fun allowed(o: Offer, now: Long): Boolean = o.keepable != false && (o.end == null || o.end - now > MIN_LEFT_MS)

    /** L'heure du rappel. Pure. */
    fun until(o: Offer, now: Long): Long {
        val plain = now + SNOOZE_MS
        return o.end?.let { minOf(plain, it - MARGIN_MS) } ?: plain
    }

    /** Les offres dont le rappel est du et qui valent encore d'etre annoncees. Pure. */
    fun due(s: AppState, now: Long): List<Offer> = s.snoozed.filterValues { it <= now }.keys.mapNotNull { s.offers[it] }.filter { o ->
        o.isOpen(now) && Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, s)
    }

    private fun pending(context: Context, key: String, action: String): PendingIntent =
        PendingIntent.getBroadcast(
            context, (action + key).hashCode(),
            Intent(context, SnoozeReceiver::class.java).setAction(action).putExtra(EXTRA_KEY, key),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Le bouton « Plus tard » d'une notification, pour cette offre. */
    fun button(context: Context, key: String): PendingIntent = pending(context, key, ACTION_SNOOZE)

    /** Reporte l'offre : la notification part, l'etat retient l'heure, une alarme reveille. */
    suspend fun start(context: Context, key: String, now: Long): Boolean {
        val o = Graph.store.value.offers[key] ?: return false
        if (!allowed(o, now)) return false
        val at = until(o, now)
        Graph.store.update { it.copy(snoozed = it.snoozed + (key to at)) }
        runCatching { NotificationManagerCompat.from(context).cancel(key.hashCode()) }
        context.getSystemService(AlarmManager::class.java)?.let { am ->
            runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(context, key, ACTION_RING)) }
        }
        return true
    }

    /** Repropose ce dont l'heure est venue, une fois. */
    suspend fun ring(context: Context, now: Long) {
        val s = Graph.store.value
        val venus = s.snoozed.filterValues { it <= now }.keys
        if (venus.isEmpty()) return
        val todo = due(s, now)
        Graph.store.update { st -> st.copy(snoozed = st.snoozed - venus) }
        todo.forEach { Notifier.newGame(context, it, s) }
    }
}

/** Le bouton et l'alarme de « Plus tard » : l'un reporte, l'autre repropose. */
class SnoozeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val done = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val app = context.applicationContext
                Graph.init(app)
                val now = System.currentTimeMillis()
                when (intent.action) {
                    Snooze.ACTION_SNOOZE -> intent.getStringExtra(Snooze.EXTRA_KEY)?.let { Snooze.start(app, it, now) }
                    Snooze.ACTION_RING -> Snooze.ring(app, now)
                }
            } finally {
                done.finish()
            }
        }
    }
}
