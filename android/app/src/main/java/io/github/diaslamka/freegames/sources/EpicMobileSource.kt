package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URLEncoder

/**
 * Les jeux mobiles offerts par Epic -- portage de watch/sources/epic-mobile.js.
 * Sur un telephone, ils se prennent dans l'appli Epic Games Store.
 */
object EpicMobileSource {
    const val NAME = "epic-mobile"
    val PLATFORMS = listOf("android", "ios")
    const val PAGE_URL = "https://store.epicgames.com/free-games"
    private val FREE_TOPIC = Regex("^mobile-(android|ios)-free-game$")

    fun discoverUrl(country: String?, platform: String): String {
        val c = Countries.of(country)
        fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        return "https://egs-platform-service.store.epicgames.com/api/v2/public/discover/home" +
            "?count=10&country=${enc(c.code)}&locale=${enc(c.lang)}&platform=${enc(platform)}&start=0&store=EGS"
    }

    fun productUrl(slug: String?): String? {
        val s = slug?.trim()?.lowercase().orEmpty()
        if (!Regex("^[a-z0-9-]{1,120}-android-[0-9a-f]{4,}$").matches(s)) return null
        return EpicSource.storeUrl("/p/$s")
    }

    fun baseSlug(slug: String?): String? {
        val s = slug?.trim()?.lowercase().orEmpty()
        if (!Regex("^[a-z0-9-]{1,120}$").matches(s)) return null
        return s.replace(Regex("-(android|ios)-[0-9a-f]{4,}$"), "").ifEmpty { null }
    }

    fun readPrice(purchase: JsonElement?): String? {
        for (o in purchase.arr.orEmpty()) {
            if (o["purchaseType"].str?.lowercase() != "purchase") continue
            val n = o["price"]["decimalPrice"].num
            val code = o["price"]["currencyCode"].str.orEmpty()
            if (n != null && n > 0 && Regex("^[A-Z]{3}$").matches(code)) return String.format(java.util.Locale.ROOT, "%.2f %s", n, code)
        }
        return null
    }

    fun freeTopicOffers(json: JsonElement?): List<JsonElement>? {
        val rubriques = json["data"].arr ?: return null
        val libres = rubriques.filter { FREE_TOPIC.matches(it["topicId"].str.orEmpty()) }
        if (libres.isEmpty()) return null
        return libres.flatMap { it["offers"].arr.orEmpty() }
    }

    private fun mots(k: String) = k.replace(Regex("([a-z])([A-Z])"), "$1 $2").replace(Regex("[_-]+"), " ").lowercase()

    private val URL_HTTPS = Regex("^https://[^\\s\"'<>]{1,2000}$")
    private val EXT_IMAGE = Regex("\\.(?:jpe?g|png|webp|avif)(?:[?#][^\\s\"']*)?$", RegexOption.IGNORE_CASE)
    private val EXT_AUTRE = Regex("\\.(?:mp4|webm|m3u8|mov|gif|svg|json|js|html?)(?:[?#]|$)", RegexOption.IGNORE_CASE)
    private val CDN_EPIC = Regex("^https://cdn\\d*\\.(?:epicgames\\.com|unrealengine\\.com)/", RegexOption.IGNORE_CASE)
    private val INDICE_BON = Regex("wide|16 ?x ?9|landscape|hero|banner|featured|card|thumb|key ?art|cover")
    private val INDICE_MAUVAIS = Regex("logo|icon|rating|avatar|badge|screenshot|video|trailer|tall|portrait|3 ?x ?4|9 ?x ?16|vertical")

    /** La meilleure image paysage trouvee dans `media`, par indices de nom. */
    fun readImage(media: JsonElement?): String? {
        var best: Pair<String, Int>? = null
        fun walk(v: JsonElement?, indice: String, depth: Int) {
            if (depth > 7 || v == null) return
            when (v) {
                is JsonPrimitive -> {
                    if (!v.isString) return
                    val s = v.content.trim()
                    if (!URL_HTTPS.matches(s) || EXT_AUTRE.containsMatchIn(s)) return
                    if (!EXT_IMAGE.containsMatchIn(s) && !CDN_EPIC.containsMatchIn(s)) return
                    val note = (if (INDICE_BON.containsMatchIn(indice)) 2 else 0) - (if (INDICE_MAUVAIS.containsMatchIn(indice)) 3 else 0)
                    if (best == null || note > best!!.second) best = s to note
                }
                is JsonArray -> v.forEach { walk(it, indice, depth + 1) }
                is JsonObject -> {
                    val genre = listOf("type", "name", "imageType", "kind", "role").joinToString(" ") { k -> v[k].str?.let { mots(it) }.orEmpty() }
                    for ((k, x) in v) walk(x, "$indice ${mots(k)} $genre", depth + 1)
                }
            }
        }
        walk(media, "", 0)
        return best?.first
    }

    private val CLE_FIN = Regex("\\bends? ?(date|time|at|on)?$|\\bexpir|\\buntil$|\\bvalid (to|thru|through)$")

    private fun instant(v: JsonElement?): Long? {
        val p = v as? JsonPrimitive ?: return null
        if (p.isString) return if (Regex("\\b20\\d\\d\\b").containsMatchIn(p.content)) Dates.iso(p.content) else null
        val n = p.content.toDoubleOrNull() ?: return null
        return when {
            n > 1e12 && n < 1e14 -> n.toLong()
            n > 1e9 && n < 1e11 -> (n * 1000).toLong()
            else -> null
        }
    }

    /** La fin la plus proche, cherchee sous les cles qui la nomment. */
    fun readEnd(purchase: JsonElement?, now: Long): Long? {
        var fin: Long? = null
        fun walk(v: JsonElement?, depth: Int) {
            if (depth > 6 || v == null || v is JsonPrimitive) return
            val entrees: List<Pair<String?, JsonElement>> = when (v) {
                is JsonArray -> v.map { null to it }
                is JsonObject -> v.entries.map { it.key to it.value }
                else -> emptyList()
            }
            for ((k, x) in entrees) {
                if (k != null && CLE_FIN.containsMatchIn(mots(k))) {
                    val t = instant(x)
                    if (t != null) {
                        if (t > now && (fin == null || t < fin!!)) fin = t
                        continue
                    }
                }
                walk(x, depth + 1)
            }
        }
        walk(purchase, 0)
        return fin
    }

    fun mapOffers(byPlatform: Map<String, List<JsonElement>>, now: Long): List<Offer> {
        data class Jeu(val titre: String, val base: String, val plateformes: MutableSet<String> = sortedSetOf(),
                       var image: String? = null, var fin: Long? = null, var page: String? = null, var prix: String? = null)
        val jeux = LinkedHashMap<String, Jeu>()
        for ((plateforme, offres) in byPlatform) {
            for (o in offres) {
                val c = o["content"]
                val titre = c["title"].str?.trim().orEmpty()
                val base = baseSlug(c["mapping"]["slug"].str)
                if (titre.isEmpty() || base == null) continue
                val jeu = jeux.getOrPut(base) { Jeu(titre, base) }
                jeu.plateformes += if (plateforme == "ios") "iOS" else "Android"
                jeu.image = jeu.image ?: readImage(c["media"])
                jeu.page = jeu.page ?: productUrl(c["mapping"]["slug"].str)
                jeu.prix = jeu.prix ?: readPrice(c["purchase"])
                val fin = readEnd(c["purchase"], now)
                if (fin != null && (jeu.fin == null || fin < jeu.fin!!)) jeu.fin = fin
            }
        }
        return jeux.values.map { j ->
            Offer(
                key = Offer.keyFor(Stores.EPIC_MOBILE, j.base, j.titre),
                source = NAME,
                store = Stores.EPIC_MOBILE,
                storeId = j.base,
                sourceId = "$NAME:${j.base}",
                title = j.titre,
                url = j.page ?: PAGE_URL,
                image = j.image,
                worth = j.prix,
                end = j.fin,
                platforms = j.plateformes.joinToString(", "),
                category = "game",
                keepable = true,
                firstSeen = now,
                lastSeen = now,
            )
        }
    }

    suspend fun discover(fetcher: Fetcher, now: Long, country: String?): SourceResult {
        val errors = mutableListOf<String>()
        val byPlatform = LinkedHashMap<String, List<JsonElement>>()
        for (p in PLATFORMS) {
            try {
                val r = fetcher.get(discoverUrl(country, p))
                if (!r.ok) { errors += "$p : HTTP ${r.code}"; continue }
                val offres = freeTopicOffers(parseJson(r.body))
                if (offres == null) { errors += "$p : rubrique des jeux offerts absente"; continue }
                byPlatform[p] = offres
            } catch (e: Exception) {
                errors += "$p : ${e.message ?: e}"
            }
        }
        return SourceResult(NAME, offers = mapOffers(byPlatform, now), errors = errors, ok = byPlatform.isNotEmpty())
    }
}
