package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles

/**
 * Le plus d'images possible (1.40.0). Une jaquette manquante -- une offre Luna, une entree du PC, un jeu d'une liste
 * sans vignette -- se retrouve d'abord AILLEURS dans ce que l'appli sait : une autre offre du meme jeu, le registre,
 * « Bientot gratuit », la fiche Steam ; a defaut, l'en-tete Steam deduit de l'appid (par l'offre, la note, le registre,
 * la collection ou « Ce soir »). L'initiale n'est que le dernier recours.
 *
 * Tout est rapproche par le titre normalise (`Titles.normalise`), comme le reste de l'appli, et seul https passe.
 */
object Images {
    class Index internal constructor(private val byTitle: Map<String, String>) {
        fun find(title: String?): String? = title?.let { byTitle[Titles.normalise(it)] }
    }

    private fun https(url: String?): String? = url?.takeIf { it.startsWith("https://") }

    private fun numeric(id: String?): String? = id?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

    /** Les images de l'etat, par titre normalise. Une vraie image l'emporte sur un en-tete deduit. */
    fun index(s: AppState): Index {
        val real = LinkedHashMap<String, String>()
        val derived = LinkedHashMap<String, String>()
        fun real(title: String?, url: String?) {
            val t = Titles.normalise(title)
            val u = https(url)
            if (t.isNotEmpty() && u != null && t !in real) real[t] = u
        }
        fun steam(title: String?, appid: String?) {
            val t = Titles.normalise(title)
            val u = https(Tonight.steamHeader(numeric(appid)))
            if (t.isNotEmpty() && u != null && t !in derived) derived[t] = u
        }
        for (o in s.offers.values) {
            real(o.title, o.image)
            steam(o.title, Bargain.appId(o, s.ratings))
        }
        for (e in s.library.values) {
            real(e.title, e.image)
            if (e.store == Stores.STEAM) steam(e.title, e.id)
        }
        for (u in s.upcoming) real(u.title, u.image)
        // Ce que les recherches ont retrouve (1.42.0) : les jaquettes de Covers, et la fiche de chaque souhait.
        for ((k, c) in s.covers) real(k, c.url)
        for (w in s.wishInfo.values) { real(w.name, w.image); steam(w.name, w.appid) }
        for (g in s.owned.values) if (g.store == Stores.STEAM) steam(g.title, g.id)
        for ((title, m) in s.tonightTitles) {
            steam(title, m.appid)
            real(title, m.appid?.let { s.tonightApps[it]?.image })
        }
        return Index(derived + real)
    }

    /** Les adresses a essayer, dans l'ordre : la sienne, puis celle trouvee ailleurs. Une qui echoue laisse la suivante. */
    fun candidates(own: String?, title: String?, index: Index?): List<String> =
        listOfNotNull(https(own), index?.find(title)).distinct()
}
