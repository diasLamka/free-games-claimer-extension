package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores

/**
 * Le centre de recuperation (1.31.0) : tout ce que l'appli sait de « prendre les jeux », sur un seul ecran --
 * ce qu'elle prendrait MAINTENANT, ce qui l'attend, ce qui demande l'utilisateur, ce qu'elle ne prend pas (et pourquoi),
 * et ce qu'elle a pris. Pur : aucune horloge implicite, rien d'ecrit.
 *
 * La liste « a prendre » est exactement celle du bouton « Tout recuperer » : [Rules.pending].
 */
object Recovery {
    /** Pourquoi une offre en cours n'est PAS prise. */
    enum class Why {
        /** Un magasin que l'appli sait prendre, mais que tu as coupe dans les reglages. */
        STORE_OFF,

        /** Aucun module de recuperation (Fab, les autres magasins), ou rien a ouvrir : on la montre, on ne la prend pas. */
        NO_ENGINE,
        NOTHING_TO_KEEP,
        ALREADY_CLAIMED,
        OWNED_STEAM,
        MARKED_OWNED,

        /** Un verdict definitif (a toi, ignore, hors du perimetre, terminee...). */
        FINISHED,

        /** Cinq essais sans succes : l'appli n'insiste plus tant qu'on ne la relance pas a la main. */
        GAVE_UP,
    }

    data class Item(
        val offer: Offer,
        val attempt: Attempt?,
        val why: Why? = null,
        /** Quand le prochain essai automatique aura lieu (une offre qui attend). */
        val retryAt: Long? = null,
        /** `Rules.pending` la retient : « Tout recuperer » la prendrait. */
        val pending: Boolean = false,
    )

    data class Plan(
        val ready: List<Item>,
        val needsYou: List<Item>,
        val waiting: List<Item>,
        val skipped: List<Item>,
        val recent: List<LibraryEntry>,
    ) {
        /** Le prochain essai automatique, parmi ceux qui attendent. */
        val nextRetry: Long? get() = waiting.mapNotNull { it.retryAt }.minOrNull()

        /** Rien a faire, rien qui attende, rien qui demande quelqu'un. */
        val quiet: Boolean get() = ready.isEmpty() && needsYou.isEmpty() && waiting.isEmpty()
    }

    private const val RECENT = 10

    /** Pourquoi cette offre n'est pas prise, ou null si l'appli la prendrait (sous reserve de son attente). */
    fun why(o: Offer, s: AppState): Why? {
        if (Rules.claimedEntry(o, s.library) != null) return Why.ALREADY_CLAIMED
        if (!Rules.storeEnabled(o.store, s.settings)) {
            return if (o.store in setOf(Stores.EPIC, Stores.GOG, Stores.AMAZON, Stores.STEAM)) Why.STORE_OFF else Why.NO_ENGINE
        }
        if (o.keepable == false) return Why.NOTHING_TO_KEEP
        if (!Rules.claimable(o, s.settings)) return Why.NO_ENGINE
        if (Rules.ownedOnSteam(o, s)) return Why.OWNED_STEAM
        if (Rules.inDeja(o, s)) return Why.MARKED_OWNED
        val a = s.attempts[o.key]
        if (a?.verdict in Verdicts.FINAL) return Why.FINISHED
        if (a != null && a.count >= Verdicts.MAX_ATTEMPTS) return Why.GAVE_UP
        return null
    }

    fun plan(s: AppState, now: Long): Plan {
        val pending = Rules.pending(s, now).map { it.key }.toSet()
        val ready = ArrayList<Item>()
        val needsYou = ArrayList<Item>()
        val waiting = ArrayList<Item>()
        val skipped = ArrayList<Item>()
        val open = s.offers.values.filter { it.isOpen(now) }
            .sortedWith(compareBy<Offer> { it.end ?: Long.MAX_VALUE }.thenBy { it.title })
        for (o in open) {
            val a = s.attempts[o.key]
            val why = why(o, s)
            val human = a?.verdict in Verdicts.HUMAN || a?.verdict == Verdicts.TEACH
            when {
                why != null -> skipped += Item(o, a, why)
                human -> needsYou += Item(o, a, pending = o.key in pending)
                a?.nextAt != null && a.nextAt > now -> waiting += Item(o, a, retryAt = a.nextAt)
                else -> ready += Item(o, a, pending = o.key in pending)
            }
        }
        val recent = s.library.values.filter { it.status in Verdicts.ACQUIRED }.sortedByDescending { it.ts ?: 0L }.take(RECENT)
        return Plan(ready, needsYou, waiting, skipped, recent)
    }
}
