package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles

/**
 * Le plus d'images possible (1.40.0). Une jaquette manquante -- une offre Luna, une entree du PC, un jeu d'une liste sans
 * vignette -- se retrouve d'abord AILLEURS dans ce que l'appli sait : une autre offre du meme jeu, le registre,
 * « Bientot gratuit », la fiche Steam ; a defaut, l'en-tete Steam deduit de l'appid (par l'offre, la note, le registre,
 * la collection ou « Ce soir »). L'initiale n'est que le dernier recours.
 *
 * Plusieurs adresses par jeu, dans l'ordre (1.43.0) : une vraie image, sa vignette (les jeux recents de Steam n'ont plus
 * d'en-tete a l'ancienne adresse, seulement la vignette que la recherche rend), puis l'en-tete deduit de l'appid. Une
 * adresse qui ne charge pas laisse la suivante.
 *
 * Tout est rapproche par le titre normalise (`Titles.normalise`), comme le reste de l'appli, et seul https passe.
 */
object Images {
    class Index internal constructor(private val real: Map<String, List<String>>, private val all: Map<String, List<String>>) {
        fun find(title: String?): String? = all(title).firstOrNull()

        /** Toutes les adresses connues pour ce jeu, la meilleure d'abord. */
        fun all(title: String?): List<String> = title?.let { all[Titles.normalise(it)] }.orEmpty()

        /** Une vraie image (pas un en-tete deduit) est-elle connue ? Sinon, une recherche peut en trouver une. */
        fun hasReal(title: String?): Boolean = title?.let { real[Titles.normalise(it)] }?.isNotEmpty() == true
    }

    private fun https(url: String?): String? = url?.takeIf { it.startsWith("https://") }

    private fun numeric(id: String?): String? = id?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

    /** Les images de l'etat, par titre normalise. Une vraie image l'emporte sur sa vignette, puis sur un en-tete deduit. */
    fun index(s: AppState): Index {
        val real = LinkedHashMap<String, MutableList<String>>()
        val thumbs = LinkedHashMap<String, MutableList<String>>()
        val derived = LinkedHashMap<String, MutableList<String>>()
        fun add(into: MutableMap<String, MutableList<String>>, title: String?, url: String?) {
            val t = Titles.normalise(title)
            val u = https(url)
            if (t.isNotEmpty() && u != null) into.getOrPut(t) { mutableListOf() }.let { if (u !in it) it += u }
        }
        fun real(title: String?, url: String?) = add(real, title, url)
        fun thumb(title: String?, url: String?) = add(thumbs, title, url)
        fun steam(title: String?, appid: String?) = add(derived, title, Tonight.steamHeader(numeric(appid)))
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
        for ((k, c) in s.covers) { real(k, c.url); thumb(k, c.thumb) }
        for (w in s.wishInfo.values) { real(w.name, w.image); thumb(w.name, w.thumb); steam(w.name, w.appid) }
        for (g in s.owned.values) if (g.store == Stores.STEAM) steam(g.title, g.id)
        for ((title, m) in s.tonightTitles) {
            steam(title, m.appid)
            real(title, m.appid?.let { s.tonightApps[it]?.image })
        }
        val keys = LinkedHashSet<String>().apply { addAll(real.keys); addAll(thumbs.keys); addAll(derived.keys) }
        val all = keys.associateWith { k -> (real[k].orEmpty() + thumbs[k].orEmpty() + derived[k].orEmpty()).distinct() }
        return Index(real.mapValues { it.value.toList() }, all)
    }

    /** Les adresses a essayer, dans l'ordre : la sienne, puis celles trouvees ailleurs. Une qui echoue laisse la suivante. */
    fun candidates(own: String?, title: String?, index: Index?): List<String> =
        (listOfNotNull(https(own)) + index?.all(title).orEmpty()).distinct()
}
