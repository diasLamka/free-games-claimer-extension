package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState

/**
 * L'autonomie (1.38.0) : le telephone recupere seul depuis la 1.2.0 (l'option « ecran eteint »), mais rien ne disait s'il le POUVAIT
 * vraiment, ni ce qui le freinait. Ce calcul pur lit ce que l'appli sait deja -- les reglages, les sessions, les verifications
 * humaines vues, ce qu'Android a fait de la veille -- et compte ce qui a ete pris sans toi sur quatorze jours. Rien n'est mesure
 * ici : tout vient de ce qui a ete note.
 */
object Autonomy {
    const val WINDOW_DAYS = 14
    private const val WINDOW_MS = WINDOW_DAYS * 24 * 3_600_000L

    enum class Level {
        /** Rien ne le freine : il recupere seul. */
        ON,

        /** Il recupere seul, mais quelque chose le freine. */
        PARTIAL,

        /** L'option « ecran eteint » est coupee : il ne recupere pas seul. */
        OFF,
    }

    sealed interface Block {
        /** L'option est coupee. */
        data object Off : Block

        /** La session de ces magasins est perdue : le fond s'y arrete. */
        data class Sessions(val stores: List<String>) : Block

        /** Ces magasins ont demande une verification humaine, sur un jeu pas encore pris : l'appli n'en resout jamais. */
        data class Challenges(val stores: List<String>) : Block

        /** Android retarde ou arrete la veille. */
        data class Android(val findings: List<Restrictions.Finding>) : Block
    }

    data class Report(
        val level: Level,
        val blocks: List<Block>,
        /** Pris sans toi (fond) et pris avec toi (ecran), sur les quatorze derniers jours -- ce qui date d'avant la mesure n'y est pas. */
        val alone: Int,
        val withYou: Int,
        /** Des choix, pas des freins : la veille attend le Wi-Fi ou la charge. */
        val wifiOnly: Boolean,
        val chargingOnly: Boolean,
    )

    fun report(s: AppState, android: Restrictions.Snapshot?, now: Long): Report {
        val st = s.settings
        val blocks = buildList {
            if (!st.claimInBackground) {
                add(Block.Off)
                return@buildList
            }
            val lost = Accounts.STORES.filter { Rules.storeEnabled(it, st) && s.accounts[it]?.status == Accounts.LOGGED_OUT }
            if (lost.isNotEmpty()) add(Block.Sessions(lost))
            val asked = s.attempts.mapNotNull { (key, a) ->
                if (a.verdict != Verdicts.CHALLENGE || now - a.lastAt > WINDOW_MS) return@mapNotNull null
                val offer = s.offers[key] ?: return@mapNotNull null
                if (!Rules.storeEnabled(offer.store, st) || Rules.claimedEntry(offer, s.library) != null) return@mapNotNull null
                offer.store
            }.distinct()
            if (asked.isNotEmpty()) add(Block.Challenges(asked))
            val findings = android?.let { Restrictions.findings(it, now) }.orEmpty()
            if (findings.isNotEmpty()) add(Block.Android(findings))
        }
        val recent = s.library.values.filter { e -> e.ts != null && now - e.ts <= WINDOW_MS && e.alone != null }
        return Report(
            level = when {
                !st.claimInBackground -> Level.OFF
                blocks.isEmpty() -> Level.ON
                else -> Level.PARTIAL
            },
            blocks = blocks,
            alone = recent.count { it.alone == true },
            withYou = recent.count { it.alone == false },
            wifiOnly = st.claimInBackground && st.wifiOnly,
            chargingOnly = st.claimInBackground && st.chargingOnly,
        )
    }
}
