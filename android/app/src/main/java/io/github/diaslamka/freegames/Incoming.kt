package io.github.diaslamka.freegames

import android.content.Intent

/**
 * Ce qu'un intent recu demande (1.27.1). MainActivity est exportee : l'intent peut venir de n'importe quelle appli et son contenu
 * n'est pas fiable -- un paquet d'extras illisible fait lever la lecture d'un extra, un onglet peut etre hors de ceux qui existent.
 * Il est lu ici, d'un bloc et sans jamais lever : une demande illisible ou invalide ne demande rien.
 */
sealed interface Incoming {
    data object Nothing : Incoming
    data class AppLink(val data: String?) : Incoming
    data class Share(val subject: String?, val text: String?) : Incoming
    data class Shortcut(val destination: Raccourcis.Destination) : Incoming
    data class Claim(val key: String?) : Incoming

    /** Telecharger la mise a jour annoncee par la notification (1.29.0) : la version, jamais une adresse. */
    data class Update(val version: String) : Incoming
    data class OpenTab(val tab: Int) : Incoming

    companion object {
        /** `tabs` : le nombre d'onglets de l'ecran ; un onglet demande hors de 0 until tabs ne demande rien. */
        fun read(i: Intent, tabs: Int): Incoming = try {
            when {
                i.action == Intent.ACTION_VIEW && i.data?.scheme == "fgclaimer" -> AppLink(i.dataString)
                i.action == Intent.ACTION_SEND -> Share(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT))
                Raccourcis.destination(i.action) != null -> Shortcut(Raccourcis.destination(i.action)!!)
                // Avant l'onglet : la notification porte aussi le sien.
                i.hasExtra(MainActivity.EXTRA_UPDATE) -> i.getStringExtra(MainActivity.EXTRA_UPDATE)
                    ?.takeIf { it.length <= 20 && io.github.diaslamka.freegames.data.AppUpdate.parseVersion(it) != null }
                    ?.let(::Update) ?: Nothing
                i.hasExtra(MainActivity.EXTRA_CLAIM) -> Claim(i.getStringExtra(MainActivity.EXTRA_CLAIM))
                i.hasExtra(MainActivity.EXTRA_TAB) -> i.getIntExtra(MainActivity.EXTRA_TAB, 0).takeIf { it in 0 until tabs }?.let(::OpenTab) ?: Nothing
                else -> Nothing
            }
        } catch (_: Exception) {
            Nothing
        }
    }
}
