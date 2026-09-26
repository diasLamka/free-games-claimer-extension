package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Titles
import kotlinx.serialization.json.JsonElement

/**
 * L'agregateur gamerpower.com -- portage de watch/sources/gamerpower.js. Il
 * voit tous les magasins, mais ne donne jamais l'adresse du magasin : son
 * lien de redirection ne s'ouvre que dans une vraie page, ce que fait la
 * recuperation.
 */
object GamerPowerSource {
    const val NAME = "gamerpower"
    const val API_URL = "https://www.gamerpower.com/api/giveaways?type=game"

    /** Ses dates n'ont pas de fuseau : c'est l'heure de New York. */
    const val DATE_ZONE = "America/New_York"

    fun mapEntry(raw: JsonElement?, now: Long): Offer? {
        val title = raw["title"].str?.trim().orEmpty()
        if (title.isEmpty()) return null
        val status = raw["status"].str
        if (status != null && !status.equals("active", ignoreCase = true)) return null
        val resolveUrl = raw["open_giveaway_url"].str ?: raw["open_giveaway"].str ?: raw["gamerpower_url"].str ?: return null
        val platforms = raw["platforms"].str
        val store = Titles.detectStore(title, platforms, null)
        val worth = raw["worth"].str?.takeIf { it != "N/A" && it.isNotBlank() }
        return Offer(
            key = "$NAME:${raw["id"].text ?: Titles.normalise(title)}",
            source = NAME,
            store = store,
            sourceId = raw["id"].text,
            title = title,
            resolveUrl = Titles.webUrl(resolveUrl),
            image = raw["thumbnail"].str ?: raw["image"].str,
            start = Dates.inZone(raw["published_date"].str, DATE_ZONE),
            end = Dates.inZone(raw["end_date"].str, DATE_ZONE),
            worth = worth,
            category = raw["type"].str,
            platforms = platforms,
            keepable = if (worth != null) true else null,
            firstSeen = now,
            lastSeen = now,
        )
    }

    fun parse(body: String, now: Long): SourceResult? {
        val list = parseJson(body).arr ?: return null
        val seen = HashSet<String>()
        return SourceResult(NAME, offers = list.mapNotNull { mapEntry(it, now) }.filter { seen.add(it.key) })
    }

    suspend fun discover(fetcher: Fetcher, now: Long): SourceResult = try {
        val r = fetcher.get(API_URL)
        if (!r.ok) SourceResult(NAME, errors = listOf("HTTP ${r.code}"), ok = false)
        else parse(r.body, now) ?: SourceResult(NAME, errors = listOf("la reponse n'est pas un tableau"), ok = false)
    } catch (e: Exception) {
        SourceResult(NAME, errors = listOf(e.message ?: e.toString()), ok = false)
    }
}
