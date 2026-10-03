package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Stores

/**
 * La page « Sante » (1.26.0) : pour chaque magasin, ce qui permet de comprendre pourquoi un jeu n'est pas
 * passe -- la session, la derniere recuperation reussie, le dernier echec depuis, ce qui attend, et si le
 * controle du compte (OwnedCheck) se laisse lire. Rien n'est mesure ici : tout vient de ce que l'appli a deja
 * note ; une page qui ment sur la sante serait pire que pas de page.
 */
object Health {
    /** Ce que le controle « est-ce deja a toi ? » peut dire d'un magasin. */
    enum class Control {
        /** La derniere lecture du compte etait lisible. */
        READ,

        /** La derniere lecture n'etait pas lisible (session, verification, mur anti-robot) : la page tranche. */
        UNREADABLE,

        /** GOG ou Epic, mais aucune offre n'a encore demande. */
        NOT_ASKED_YET,

        /** Steam : la liste des jeux possedes est lue a chaque veille. */
        OWNED_LIST,

        /** Amazon : aucune adresse lisible, la page tranche. */
        PAGE_DECIDES,
    }

    data class Failure(val title: String, val verdict: String, val details: String?, val at: Long)

    data class StoreLine(
        val store: String,
        val account: String,
        val lastClaim: LibraryEntry?,
        val lastFailure: Failure?,
        val waiting: Int,
        val control: Control,
        val controlAt: Long?,
    ) {
        /** Quelque chose a faire : la session est perdue, ou un echec est survenu depuis la derniere reussite. */
        val problem: Boolean get() = account == Accounts.LOGGED_OUT || lastFailure != null
    }

    data class Overview(
        val lastCheck: Long?,
        /** Les sources dont la derniere lecture a echoue, par leur nom interne. */
        val sourcesDown: List<String>,
        val lines: List<StoreLine>,
    ) {
        val problems: Int get() = lines.count { it.problem }
    }

    /** Les verdicts qui disent « ca n'a pas marche » (et non « c'est fait » ou « rien a faire »). */
    val PROBLEMS = setOf(
        Verdicts.FAILURE, Verdicts.CHALLENGE, Verdicts.LOGIN, Verdicts.TEACH, Verdicts.LINK_ACCOUNT,
        Verdicts.NEEDS_BASE, Verdicts.UNDETERMINED, Verdicts.BAD_URL,
    )

    /** Un echec plus ancien n'apprend plus rien. */
    const val FAILURE_WINDOW_MS = 14 * 24 * 3_600_000L

    fun overview(state: AppState, now: Long): Overview {
        val pending = Rules.pending(state, now)
        val lines = Accounts.STORES.map { store ->
            val lastClaim = state.library.values
                .filter { it.store == store && it.ts != null }
                .maxByOrNull { it.ts!! }
            StoreLine(
                store = store,
                account = state.accounts[store]?.status ?: Accounts.UNKNOWN,
                lastClaim = lastClaim,
                lastFailure = lastFailure(state, store, lastClaim?.ts ?: 0L, now),
                waiting = pending.count { it.store == store },
                control = controlOf(state, store),
                controlAt = state.oracle[store]?.at,
            )
        }
        return Overview(
            lastCheck = state.lastCheck,
            sourcesDown = state.sources.filterValues { !it.ok }.keys.sorted(),
            lines = lines,
        )
    }

    /**
     * Le dernier echec de ce magasin DEPUIS sa derniere reussite : une offre dont le dernier essai est un
     * probleme, qu'on n'a pas fini par obtenir, et assez recent pour compter.
     */
    private fun lastFailure(state: AppState, store: String, since: Long, now: Long): Failure? =
        state.attempts.mapNotNull { (key, a) ->
            val verdict = a.verdict ?: return@mapNotNull null
            if (verdict !in PROBLEMS || a.lastAt <= since || now - a.lastAt > FAILURE_WINDOW_MS) return@mapNotNull null
            val offer = state.offers[key] ?: return@mapNotNull null
            if (offer.store != store || Rules.claimedEntry(offer, state.library) != null) return@mapNotNull null
            Failure(offer.shownTitle, verdict, a.details, a.lastAt)
        }.maxByOrNull { it.at }

    fun controlOf(state: AppState, store: String): Control = when (store) {
        in OwnedCheck.ORACLE_STORES -> when (state.oracle[store]?.readable) {
            true -> Control.READ
            false -> Control.UNREADABLE
            null -> Control.NOT_ASKED_YET
        }
        Stores.STEAM -> Control.OWNED_LIST
        else -> Control.PAGE_DECIDES
    }
}
