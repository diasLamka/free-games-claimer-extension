package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/** Les jeux et DLC offerts definitivement sur Steam -- portage de watch/sources/steam.js. */
object SteamSource {
    const val NAME = "steam"
    const val SEARCH_URL = "https://store.steampowered.com/search/?maxprice=free&specials=1&ndl=1"
    const val ITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
    const val OWNED_URL = "https://store.steampowered.com/dynamicstore/userdata/"
    const val ASSETS_BASE = "https://shared.akamai.steamstatic.com/store_item_assets/"

    fun extractAppIds(html: String): List<String> =
        Regex("data-ds-appid=\"(\\d+)\"").findAll(html).map { it.groupValues[1] }.distinct().toList()

    fun itemsUrl(appids: List<String>, country: String = "FR"): String {
        val input = buildJsonObject {
            put("ids", buildJsonArray { appids.forEach { add(buildJsonObject { put("appid", it.toLong()) }) } })
            put("context", buildJsonObject { put("language", "french"); put("country_code", country) })
            put("data_request", buildJsonObject {
                put("include_basic_info", true); put("include_platforms", true); put("include_assets", true)
            })
        }
        return ITEMS_URL + "?input_json=" + URLEncoder.encode(input.toString(), "UTF-8")
    }

    fun image(assets: JsonElement?): String? {
        val fichier = listOf(assets["header"].str, assets["main_capsule"].str, assets["small_capsule"].str)
            .firstOrNull { !it.isNullOrBlank() } ?: return null
        if (fichier.startsWith("https://", ignoreCase = true)) return fichier
        val format = assets["asset_url_format"].str.orEmpty()
        if (!format.contains("\${FILENAME}") || !Regex("^[\\w./-]+$").matches(fichier)) return null
        val chemin = format.replace("\${FILENAME}", fichier)
        if (chemin.contains("..") || !Regex("^[\\w./?=&-]+$").matches(chemin)) return null
        return ASSETS_BASE + chemin
    }

    fun mapItem(item: JsonElement?, now: Long): Offer? {
        val purchase = item["best_purchase_option"]
        if (purchase["is_free_to_keep"].bool != true) return null
        val appid = (item["appid"] ?: item["id"]).text ?: return null
        val path = item["store_url_path"].str?.let { "https://store.steampowered.com/$it" }
            ?: "https://store.steampowered.com/app/$appid/"
        val ends = purchase["free_to_keep_ends"].num
        val cents = purchase["original_price_in_cents"].text?.toLongOrNull()
        val formatted = purchase["formatted_original_price"].str?.trim().orEmpty()
        val dlc = item["type"].num?.toInt() == 4
        val parent = item["related_items"]["parent_appid"].text?.takeIf { dlc && Regex("^\\d+$").matches(it) }
        val title = item["name"].str ?: "Application $appid"
        return Offer(
            key = Offer.keyFor(Stores.STEAM, appid, title),
            source = NAME,
            store = Stores.STEAM,
            storeId = appid,
            sourceId = appid,
            title = title,
            url = path,
            image = image(item["assets"]),
            end = if (ends != null && ends > 0) (ends * 1000).toLong() else null,
            worth = formatted.ifEmpty { if (cents != null && cents > 0) String.format(java.util.Locale.ROOT, "%.2f", cents / 100.0) else null },
            category = if (dlc) "DLC" else "Game",
            packageId = purchase["packageid"].text?.takeIf { it.isNotEmpty() && it != "0" },
            parentAppid = parent,
            keepable = true,
            firstSeen = now,
            lastSeen = now,
        )
    }

    fun parseItems(body: String, now: Long): List<Offer>? =
        parseJson(body)["response"]["store_items"].arr?.mapNotNull { mapItem(it, now) }

    /** Ce que la session possede : null quand on ne sait pas, vide si deconnecte. */
    fun parseOwned(body: String): Pair<Set<String>, Set<String>>? {
        val json = parseJson(body)
        val apps = json["rgOwnedApps"].arr ?: return null
        val packages = json["rgOwnedPackages"].arr ?: return null
        return apps.mapNotNull { it.text }.toSet() to packages.mapNotNull { it.text }.toSet()
    }

    suspend fun discover(fetcher: Fetcher, now: Long, country: String): SourceResult = try {
        val search = fetcher.get(SEARCH_URL, accept = "text/html")
        if (!search.ok) SourceResult(NAME, errors = listOf("recherche : HTTP ${search.code}"), ok = false)
        else {
            val ids = extractAppIds(search.body)
            if (ids.isEmpty()) SourceResult(NAME)
            else {
                val items = fetcher.get(itemsUrl(ids, Countries.of(country).code))
                if (!items.ok) SourceResult(NAME, errors = listOf("items : HTTP ${items.code}"), ok = false)
                else SourceResult(NAME, offers = parseItems(items.body, now).orEmpty())
            }
        }
    } catch (e: Exception) {
        SourceResult(NAME, errors = listOf(e.message ?: e.toString()), ok = false)
    }
}
