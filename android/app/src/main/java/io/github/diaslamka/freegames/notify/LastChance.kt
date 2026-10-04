package io.github.diaslamka.freegames.notify

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * L'alarme de derniere chance (1.5.0) : un jeu de la liste de souhaits finit
 * dans moins de trois heures, et il n'est toujours pas a nous -- un captcha,
 * une session perdue, un magasin que l'appli ne sait pas prendre. Le
 * telephone sonne comme un reveil, sur le canal des alarmes : il sonne meme
 * en mode silencieux.
 *
 * AUCUNE ALARME EXACTE. La permission qu'elle demande est reservee par Google
 * Play aux reveils et aux agendas, et l'appli n'en est pas un. On prend
 * `setAndAllowWhileIdle` : elle traverse la veille profonde, et Android 12+
 * la sert au plus une heure apres l'heure demandee. D'ou trois heures : elle
 * sonne entre trois et deux heures avant la fin. Chaque passage de la veille
 * fait aussi sonner ce qui est deja dans la fenetre.
 */
object LastChance {
    /** On sonne dans les trois dernieres heures d'une offre. */
    const val WINDOW_MS = 3 * 3_600_000L
    /** A moins de dix minutes de la fin, il est trop tard pour faire quoi que ce soit. */
    const val MIN_LEFT_MS = 10 * 60_000L
    const val EXTRA_KEY = "offre"
    private const val DAY_MS = 24 * 3_600_000L

    /** Les offres qui meritent l'alarme, sans regarder l'heure de la fenetre. Pure. */
    fun eligible(s: AppState, now: Long): List<Offer> = s.offers.values.filter { o ->
        val end = o.end
        end != null && o.isOpen(now) && o.keepable != false && end - now > MIN_LEFT_MS &&
            o.key !in s.alarmed && Rules.wished(o, s) &&
            Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, s)
    }

    /** Celles a faire sonner maintenant : deja dans les trois dernieres heures. Pure. */
    fun due(s: AppState, now: Long): List<Offer> = eligible(s, now).filter { it.end!! - now <= WINDOW_MS }

    /** L'heure demandee pour l'alarme d'une offre. */
    fun triggerAt(o: Offer): Long = o.end!! - WINDOW_MS

    private fun pending(context: Context, key: String): PendingIntent =
        PendingIntent.getBroadcast(
            context, ("derniere:" + key).hashCode(),
            Intent(context, LastChanceReceiver::class.java).putExtra(EXTRA_KEY, key),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    /** Pose une alarme par offre dont la fenetre n'est pas encore ouverte. */
    fun schedule(context: Context, s: AppState, now: Long) {
        if (!s.settings.lastChance) return
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        eligible(s, now).filter { triggerAt(it) > now }.forEach { o ->
            runCatching { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt(o), pending(context, o.key)) }
        }
    }

    /** Fait sonner ce qui est dans la fenetre, une fois par offre. */
    suspend fun ring(context: Context, now: Long) {
        val s = Graph.store.value
        if (!s.settings.lastChance) return
        val todo = due(s, now)
        if (todo.isEmpty()) return
        Graph.store.update { st ->
            st.copy(alarmed = (st.alarmed + todo.associate { it.key to now }).filterValues { now - it < 30 * DAY_MS })
        }
        todo.forEach { Notifier.lastChance(context, it, s) }
    }
}

/**
 * L'alarme posee par LastChance.schedule. Elle relit l'etat avant de sonner :
 * le jeu a pu etre pris, retire des souhaits, ou l'option coupee entre-temps.
 */
class LastChanceReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val done = goAsync()
        // goAsync : dix secondes en avant-plan. Six pour les jaquettes, le reste pour l'etat et la notification.
        CoroutineScope(SupervisorJob() + Dispatchers.IO + CoverBudget(System.currentTimeMillis() + RECEIVER_COVER_MS)).launch {
            try {
                Graph.init(context.applicationContext)
                LastChance.ring(context.applicationContext, System.currentTimeMillis())
            } finally {
                done.finish()
            }
        }
    }
}
