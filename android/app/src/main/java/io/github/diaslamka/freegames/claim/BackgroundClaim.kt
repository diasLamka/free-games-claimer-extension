package io.github.diaslamka.freegames.claim

import android.content.Context
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Family
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Relay
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext

/**
 * La recuperation ecran eteint.
 *
 * Elle tourne dans le passage de la veille de fond (WorkManager), sans
 * activite, sans fenetre par-dessus les autres applis, sans service de
 * premier plan : une page de magasin qui n'est attachee a rien, pilotee par
 * le meme moteur que l'ecran. Tout ce qu'Android autorise a une tache de
 * fond ordinaire, et rien de plus.
 *
 * Les garde-fous sont ceux de l'ecran, plus trois :
 *   - coupee par defaut, et jamais pour un magasin dont une page a montre la
 *     session perdue (un « inconnu » ne bloque plus : la recuperation elle-meme le tranchera) ;
 *   - un defi (captcha) n'est jamais resolu : une notification appelle
 *     l'humain, et le jeu attend quatre heures avant que le fond y revienne ;
 *   - dix minutes en tout : on n'entame plus de jeu apres trois minutes, le
 *     reste passe au tour suivant, planifie un quart d'heure plus tard.
 */
object BackgroundClaim {
    /** Ce que le fond tenterait maintenant : ce qui reste, sur une session qu'on croit ouverte. */
    fun todo(s: AppState, now: Long): List<Offer> {
        if (!s.settings.claimInBackground) return emptyList()
        return Rules.pending(s, now).filter { o ->
            val a = s.accounts[o.store]?.status
            a != Accounts.LOGGED_OUT && !Relay.held(s, o, now)
        }
    }

    /** Toute la famille (1.9.0) : ce que le fond tenterait pour chaque membre. */
    fun familyTodo(s: AppState, now: Long): List<Pair<String, List<Offer>>> {
        if (!s.settings.claimInBackground || !Family.supported()) return emptyList()
        return s.family.map { it.id to Family.todo(s, it, now) }.filter { it.second.isNotEmpty() }
    }

    /**
     * Rend le nombre de jeux obtenus. Ne fait rien si l'ecran recupere deja.
     * Le compte principal d'abord, puis chaque membre de la famille, dans sa
     * propre page et son propre profil -- dans le meme budget de temps.
     */
    suspend fun run(context: Context): Int {
        Graph.init(context)
        val start = System.currentTimeMillis()
        val list = todo(Graph.store.value, start)
        if (list.isEmpty() && familyTodo(Graph.store.value, start).isEmpty()) return 0
        if (!Graph.claimLock.tryLock()) return 0
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        var session: ClaimSession? = null
        var won = 0
        val deadline = start + ClaimSession.HEADLESS_START_WINDOW_MS
        try {
            if (list.isNotEmpty()) {
                session = withContext(Dispatchers.Main) { ClaimSession(context.applicationContext, scope, headless = true) }
                won += session.runAll(list, deadline = deadline).size
            }
            for ((id, todo) in familyTodo(Graph.store.value, System.currentTimeMillis())) {
                if (System.currentTimeMillis() > deadline) break
                withContext(NonCancellable + Dispatchers.Main) { runCatching { session?.release() } }
                session = withContext(Dispatchers.Main) { ClaimSession(context.applicationContext, scope, headless = true, member = id) }
                won += session.runAll(todo, deadline = deadline).size
            }
            return won
        } finally {
            withContext(NonCancellable + Dispatchers.Main) { runCatching { session?.release() } }
            scope.cancel()
            Graph.claimLock.unlock()
        }
    }

    /** Il en reste apres ce passage ? */
    fun more(now: Long): Boolean = todo(Graph.store.value, now).isNotEmpty() || familyTodo(Graph.store.value, now).isNotEmpty()
}
