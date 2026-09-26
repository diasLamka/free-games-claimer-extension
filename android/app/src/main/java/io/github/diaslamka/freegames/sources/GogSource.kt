package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import kotlinx.serialization.json.JsonElement

/** Le catalogue GOG filtre par prix, en JSON -- portage de watch/sources/gog.js. */
object GogSource {
    const val NAME = "gog"
    const val ORIGIN = "https://www.gog.com"
    const val FILTERED_URL = "$ORIGIN/games/ajax/filtered?mediaType=game&price=free&sort=popularity"

    fun category(raw: JsonElement?): String? = when (raw["type"].num?.toInt()) {
        3 -> "DLC"
        1, 2 -> "Game"
        else -> null
    }

    private fun absolute(url: String?): String? {
        val v = url?.trim().orEmpty()
        if (v.isEmpty()) return null
        return when {
            v.startsWith("//") -> "https:$v"
            v.startsWith("/") -> ORIGIN + v
            else -> v
        }
    }

    /**
     * L'image GOG arrive sans extension (`//images-3.gog-statics.com/<empreinte>`),
     * et cette adresse nue repond 404 : il faut `.jpg` (mesure du 2026-09-26).
     */
    fun image(raw: String?): String? {
        val u = absolute(raw) ?: return null
        return if (Regex("\\.(jpe?g|png|webp)(\\?.*)?$", RegexOption.IGNORE_CASE).containsMatchIn(u)) u else "$u.jpg"
    }

    /** (valeur, a garder ?) : un prix de base a zero n'a rien a garder. */
    fun readPrice(price: JsonElement?): Pair<String?, Boolean?> {
        val base = price["baseAmount"].text?.toDoubleOrNull() ?: return null to null
        val final = (price["finalAmount"] ?: price["amount"]).text?.toDoubleOrNull() ?: return null to null
        if (base <= 0) return null to false
        val currency = price["currency"].str?.trim().orEmpty()
        val shown = price["baseAmount"].text.orEmpty()
        return (if (currency.isNotEmpty()) "$shown $currency" else shown) to (final == 0.0)
    }

    fun mapProduct(raw: JsonElement?, now: Long): Offer? {
        val title = raw["title"].str?.trim().orEmpty()
        if (title.isEmpty()) return null
        if (raw["isMovie"].bool == true || raw["isGame"].bool == false) return null
        if (raw["isComingSoon"].bool == true) return null
        if (raw["availability"]["isAvailable"].bool == false) return null
        val url = absolute(raw["url"].str) ?: return null
        val (worth, keepable) = readPrice(raw["price"])
        val to = raw["salesVisibility"]["to"].num
        val end = if (to != null && to > 0) (to * 1000).toLong() else null
        val slug = raw["slug"].str
        return Offer(
            key = Offer.keyFor(Stores.GOG, slug, title),
            source = NAME,
            store = Stores.GOG,
            storeId = slug,
            sourceId = raw["id"].text,
            title = title,
            url = url,
            image = image(raw["boxImage"].str ?: raw["image"].str),
            end = end,
            worth = worth,
            keepable = keepable,
            category = category(raw),
            firstSeen = now,
            lastSeen = now,
        )
    }

    fun parse(body: String, now: Long): SourceResult? {
        val products = parseJson(body)["products"].arr ?: return null
        val seen = HashSet<String>()
        val offers = products.mapNotNull { mapProduct(it, now) }
            .filter { o -> o.keepable != false && seen.add(o.sourceId ?: o.storeId ?: o.normalisedTitle) }
        return SourceResult(NAME, offers = offers)
    }

    suspend fun discover(fetcher: Fetcher, now: Long): SourceResult = try {
        val r = fetcher.get(FILTERED_URL)
        if (!r.ok) SourceResult(NAME, errors = listOf("HTTP ${r.code}"), ok = false)
        else parse(r.body, now) ?: SourceResult(NAME, errors = listOf("reponse sans « products »"), ok = false)
    } catch (e: Exception) {
        SourceResult(NAME, errors = listOf(e.message ?: e.toString()), ok = false)
    }
}
