package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import java.net.URLEncoder

/**
 * La note Steam des jeux offerts -- portage de watch/steam-ratings.js : le
 * titre exact trouve par la recherche du magasin, puis le resume de ses
 * evaluations, toutes langues. Relue une fois par semaine.
 */
object Ratings {
    private const val DAY_MS = 24 * 3_600_000L
    const val FRESH_MS = 7 * DAY_MS
    const val NONE_MS = 3 * DAY_MS
    const val PER_RUN = 8

    fun key(o: Offer): String = if (o.store == Stores.STEAM && o.storeId != null) "app:${o.storeId}" else "t:${o.normalisedTitle}"

    /** Un jeu PC, pas un DLC : c'est ce que la note de Steam decrit. */
    fun eligible(o: Offer): Boolean = o.store != Stores.EPIC_MOBILE && !o.isExtra && o.normalisedTitle.isNotEmpty()

    fun needs(r: Rating?, now: Long): Boolean = r == null || now - r.at >= (if (r.percent == null) NONE_MS else FRESH_MS)

    fun tone(r: Rating?): String? {
        val s = r?.score ?: return null
        return when {
            s >= 6 -> "good"
            s == 5 -> "mixed"
            s > 0 -> "bad"
            else -> null
        }
    }

    fun searchUrl(title: String, country: String): String =
        "https://store.steampowered.com/api/storesearch/?term=" + URLEncoder.encode(Titles.display(title).take(100), "UTF-8") +
            "&cc=" + (if (Regex("^[A-Z]{2}$").matches(country)) country else "US") + "&l=english"

    fun matchSearch(body: String, title: String): String? {
        val cible = Titles.normalise(title)
        if (cible.isEmpty()) return null
        return parseJson(body)["items"].arr.orEmpty().firstOrNull { i ->
            val type = i["type"].str
            (type == null || type == "app") && Regex("^\\d+$").matches(i["id"].text.orEmpty()) && Titles.normalise(i["name"].str) == cible
        }?.get("id").text
    }

    suspend fun fetch(fetcher: Fetcher, o: Offer, country: String, now: Long): Rating {
        val appid = if (o.store == Stores.STEAM && o.storeId != null) o.storeId
        else {
            val r = fetcher.get(searchUrl(o.title, country))
            if (!r.ok) throw IllegalStateException("recherche Steam : HTTP ${r.code}")
            matchSearch(r.body, o.title)
        } ?: return Rating(at = now)
        val r = fetcher.get("https://store.steampowered.com/appreviews/$appid?json=1&language=all&num_per_page=0&purchase_type=all")
        if (!r.ok) throw IllegalStateException("evaluations Steam : HTTP ${r.code}")
        val q = parseJson(r.body)["query_summary"]
        val total = q["total_reviews"].num?.toInt() ?: 0
        val positive = q["total_positive"].num?.toInt() ?: 0
        if (total <= 0) return Rating(at = now, appid = appid)
        return Rating(
            at = now,
            percent = Math.round(100.0 * positive / total).toInt(),
            total = total,
            score = q["review_score"].num?.toInt(),
            appid = appid,
        )
    }
}
