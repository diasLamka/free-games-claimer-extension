package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.CoverNote
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher

/**
 * Les jaquettes qui manquent encore apres `Images` (1.42.0) : un jeu du registre venu du PC, une offre Luna... sans image
 * nulle part dans l'appli. Une recherche Steam par le titre exact en trouve l'en-tete. Huit au plus par passage ; un jeu
 * introuvable n'est pas recherche avant une semaine, un jeu trouve, jamais deux fois.
 */
object Covers {
    const val PER_RUN = 8
    const val MISS_MS = 7 * 24 * 3_600_000L

    /** Les titres sans image connue, a chercher : le registre d'abord (c'est ce qu'on regarde), puis les offres en cours. */
    fun missing(s: AppState, now: Long): List<String> {
        val index = Images.index(s)
        val titles = s.library.values.sortedByDescending { it.ts ?: 0 }.mapNotNull { it.title } +
            s.offers.values.filter { it.isOpen(now) }.map { it.title }
        return titles.filter { t ->
            val k = Titles.normalise(t)
            k.isNotEmpty() && index.find(t) == null && s.covers[k].let { it == null || (it.url == null && now - it.at >= MISS_MS) }
        }.distinctBy { Titles.normalise(it) }
    }

    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String): Map<String, CoverNote> {
        val next = s.covers.toMutableMap()
        for (title in missing(s, now).take(PER_RUN)) {
            val k = Titles.normalise(title)
            val hit = runCatchingSuspend {
                val r = fetcher.get(Wish.steamSearchUrl(Titles.display(title), country))
                if (r.ok) Wish.parseSteam(r.body).firstOrNull { Titles.normalise(it.title) == k } else null
            }.getOrNull()
            next[k] = CoverNote(now, hit?.image)
        }
        return next
    }
}
