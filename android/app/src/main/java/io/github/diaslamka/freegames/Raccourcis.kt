package io.github.diaslamka.freegames

/**
 * Les raccourcis d'icone (1.12.0) : res/xml/shortcuts.xml declare trois
 * actions, cette table dit ou chacune mene. Une action inconnue ne mene nulle
 * part -- l'appli s'ouvre comme d'habitude, sans rien faire d'autre.
 */
object Raccourcis {
    const val RECUPERER = "io.github.diaslamka.freegames.RECUPERER_MAINTENANT"
    const val CE_SOIR = "io.github.diaslamka.freegames.CE_SOIR"
    const val SOUHAIT = "io.github.diaslamka.freegames.AJOUTER_UN_SOUHAIT"

    enum class Destination(val tab: Int, val claim: Boolean = false) {
        /** Jeux, et la recuperation de tout ce qui reste. */
        CLAIM_NOW(0, claim = true),
        /** Recuperes : la carte « Ce soir je joue a... ». */
        TONIGHT(1),
        /** Souhaits : le champ pour en ajouter un. */
        ADD_WISH(2),
    }

    fun destination(action: String?): Destination? = when (action) {
        RECUPERER -> Destination.CLAIM_NOW
        CE_SOIR -> Destination.TONIGHT
        SOUHAIT -> Destination.ADD_WISH
        else -> null
    }
}
