package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Upcoming
import kotlinx.serialization.json.JsonElement
import java.net.URLEncoder

/**
 * L'API officielle freeGamesPromotions d'Epic -- portage de
 * watch/sources/epic.js, meme resolution de slug, memes fenetres.
 */
object EpicSource {
    const val NAME = "epic-api"
    const val STORE_ORIGIN = "https://store.epicgames.com"

    private val HOSTS = listOf(
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions",
        "https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions",
    )

    fun apiUrls(country: String?): List<String> {
        val c = Countries.of(country)
        val tag = "${c.lang}-${c.code}"
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        return HOSTS.map { "$it?locale=${enc(tag)}&country=${enc(c.code)}&allowCountries=${enc(c.code)}" }
    }

    /** La langue des fiches : celles que les motifs du moteur savent lire. */
    var pageLang: String = "fr"

    fun normaliseSlug(raw: String?): String? {
        if (raw == null) return null
        var s = raw.trim().lowercase()
        s = s.split('?')[0].split('#')[0]
        s = s.trim('/')
        s = s.split('/')[0]
        if (s.isEmpty() || s == "[]") return null
        if (Regex("^[0-9a-f]{32}$").matches(s)) return null
        if (!Regex("^[a-z0-9][a-z0-9._-]*$").matches(s)) return null
        return s
    }

    fun resolveSlug(el: JsonElement?): String? {
        if (el == null) return null
        val candidats = mutableListOf<String?>()
        el["offerMappings"].arr?.forEach { candidats += it["pageSlug"].str }
        el["catalogNs"]["mappings"].arr?.forEach { candidats += it["pageSlug"].str }
        candidats += el["productSlug"].str
        candidats += el["urlSlug"].str
        return candidats.firstNotNullOfOrNull { normaliseSlug(it) }
    }

    fun image(el: JsonElement?): String? {
        val images = el["keyImages"].arr ?: return null
        for (type in listOf("Thumbnail", "OfferImageWide", "DieselStoreFrontWide", "OfferImageTall")) {
            images.firstOrNull { it["type"].str == type && !it["url"].str.isNullOrEmpty() }?.let { return it["url"].str }
        }
        return images.firstOrNull { !it["url"].str.isNullOrEmpty() }?.get("url").str
    }

    fun pathBase(el: JsonElement?): String {
        val bundle = el["offerType"].str == "BUNDLE" || el["categories"].arr.orEmpty().any { it["path"].str == "bundles" }
        return if (bundle) "/bundles/" else "/p/"
    }

    fun storeUrl(path: String): String =
        STORE_ORIGIN + path + (if (path.contains('?')) "&" else "?") + "lang=" + pageLang

    /** La fenetre qui court maintenant : (debut, fin), bornes absentes = infinies. */
    fun activeWindow(el: JsonElement?, now: Long): Pair<Long?, Long?>? {
        for (batch in el["promotions"]["promotionalOffers"].arr.orEmpty()) {
            for (o in batch["promotionalOffers"].arr.orEmpty()) {
                val start = o["startDate"].str?.let { Dates.iso(it) }
                val end = o["endDate"].str?.let { Dates.iso(it) }
                if ((start ?: Long.MIN_VALUE) <= now && now < (end ?: Long.MAX_VALUE)) return start to end
            }
        }
        return null
    }

    fun upcoming(el: JsonElement?, now: Long): List<Upcoming> {
        val slug = resolveSlug(el)
        val url = slug?.let { storeUrl(pathBase(el) + it) }
        val out = mutableListOf<Upcoming>()
        for (batch in el["promotions"]["upcomingPromotionalOffers"].arr.orEmpty()) {
            for (o in batch["promotionalOffers"].arr.orEmpty()) {
                val start = Dates.iso(o["startDate"].str) ?: continue
                if (start <= now) continue
                out += Upcoming(
                    title = el["title"].str ?: continue,
                    image = image(el),
                    url = url,
                    start = start,
                    end = Dates.iso(o["endDate"].str),
                )
            }
        }
        return out
    }

    /** true : payant, offert un temps. false : gratuit de toute facon. null : on ne sait pas. */
    fun isFreeToKeep(el: JsonElement?): Boolean? {
        val total = el["price"]["totalPrice"]
        val original = total["originalPrice"].num ?: return null
        if (original <= 0) return false
        return total["discountPrice"].num == 0.0
    }

    fun promoActiveNow(el: JsonElement?, now: Long): Boolean {
        if (activeWindow(el, now) == null) return false
        val discount = el["price"]["totalPrice"]["discountPrice"].num
        return discount == null || discount == 0.0
    }

    fun originalWorth(el: JsonElement?): String? {
        val total = el["price"]["totalPrice"]
        val raw = total["fmtPrice"]["originalPrice"].str
        if (!raw.isNullOrEmpty() && raw != "0") return raw
        val original = total["originalPrice"].num
        val currency = total["currencyCode"].str
        if (original != null && original > 0 && !currency.isNullOrEmpty()) {
            val decimals = total["currencyInfo"]["decimals"].num?.toInt() ?: 2
            var div = 1.0
            repeat(decimals) { div *= 10 }
            return String.format(java.util.Locale.ROOT, "%.${decimals}f %s", original / div, currency)
        }
        return null
    }

    fun category(el: JsonElement?): String? = when (el["offerType"].str) {
        "ADD_ON" -> "DLC"
        "BASE_GAME", "EDITION", "BUNDLE" -> "Game"
        else -> null
    }

    fun mapElements(elements: List<JsonElement>, now: Long): List<Offer> {
        val out = mutableListOf<Offer>()
        for (el in elements) {
            if (!promoActiveNow(el, now)) continue
            if (isFreeToKeep(el) == false) continue
            val slug = resolveSlug(el) ?: continue
            val title = el["title"].str ?: continue
            val window = activeWindow(el, now)
            out += Offer(
                key = Offer.keyFor(Stores.EPIC, slug, title),
                source = NAME,
                store = Stores.EPIC,
                storeId = slug,
                sourceId = el["id"].str,
                title = title,
                url = storeUrl(pathBase(el) + slug),
                image = image(el),
                start = window?.first,
                end = window?.second,
                worth = originalWorth(el),
                keepable = isFreeToKeep(el),
                category = category(el),
                // Le vendeur (1.7.0) : « Attends, il sera offert » retient qui offre.
                publisher = el["seller"]["name"].str,
                firstSeen = now,
                lastSeen = now,
            )
        }
        return out
    }

    fun parse(body: String, now: Long): SourceResult? {
        val elements = parseJson(body)["data"]["Catalog"]["searchStore"]["elements"].arr ?: return null
        return SourceResult(
            name = NAME,
            offers = mapElements(elements, now),
            upcoming = elements.flatMap { upcoming(it, now) }.sortedBy { it.start },
        )
    }

    suspend fun discover(fetcher: Fetcher, now: Long, country: String?): SourceResult {
        val errors = mutableListOf<String>()
        for (url in apiUrls(country)) {
            try {
                val r = fetcher.get(url)
                if (!r.ok) { errors += "HTTP ${r.code}"; continue }
                val res = parse(r.body, now)
                if (res == null) { errors += "structure inattendue (elements absent)"; continue }
                return res
            } catch (e: Exception) {
                errors += e.message ?: e.toString()
            }
        }
        return SourceResult(NAME, errors = errors, ok = false)
    }
}
