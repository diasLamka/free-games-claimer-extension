package io.github.diaslamka.freegames.sources

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Les assets « Limited-Time Free » de Fab, la boutique d'Epic pour les modeles 3D, les plugins et les assets Unreal et
 * Unity -- portage de watch/sources/fab.js.
 *
 * Mesure du 2026-10-10 (docs/specs/2026-10-10-humble-fab-constats.md) : la page /limited-time-free repond 200 a un GET
 * anonyme, et son HTML brut porte un bloc de donnees dont l'entree "/i/blades/free_content_blade" liste les fiches, leurs
 * licences, leur prix et la fin de la remise. On lit ce bloc, pas le balisage : un nom de classe genere change a chaque
 * deploiement, un champ `discountEndDate` non.
 *
 * Detectes et annonces, jamais recuperes : la reclamation exige la session Epic et n'a jamais ete observee connectee.
 * Un appui ouvre la fiche, ou l'on ajoute l'asset soi-meme.
 */
object FabSource {
    const val NAME = "fab"
    const val PAGE_URL = "https://www.fab.com/limited-time-free"

    private const val BLADE_KEY = "/i/blades/free_content_blade"
    private const val SCRIPT_ID = "js-json-data-prefetched-data"
    private val UID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val ID_ATTRIBUTE = Regex("""\bid=["']$SCRIPT_ID["']""", RegexOption.IGNORE_CASE)
    private val CURRENCY = Regex("^[A-Z]{3}$")

    /** La largeur de vignette visee : assez nette pour une carte, bien en deca du plein ecran. */
    private const val TARGET_WIDTH = 640

    /** Une fiche ecartee, avec sa raison -- jamais perdue sans un mot. */
    data class Dropped(val uid: String?, val reason: String)
    data class Mapped(val offers: List<Offer>, val dropped: List<Dropped>)

    fun listingUrl(uid: String?): String? {
        val u = uid?.trim()?.lowercase().orEmpty()
        return if (UID.matches(u)) "https://www.fab.com/listings/$u" else null
    }

    /**
     * Le bloc des offres a duree limitee, ou null.
     *
     * null veut dire « la page n'a pas la forme mesuree » (un defi, un JSON abime, un bloc renomme) : ce n'est PAS
     * « aucune offre cette semaine » -- ce cas-la rend un bloc dont `tiles` est vide.
     *
     * Chaque balise <script> est examinee, pas la premiere venue : un commentaire ou un texte qui en cite une ne doit pas
     * masquer la vraie. A la main plutot qu'a la regex : la page pese un demi-megaoctet.
     */
    fun readBlade(html: String?): JsonElement? {
        if (html.isNullOrEmpty()) return null
        var i = html.indexOf("<script", 0, ignoreCase = true)
        while (i >= 0) {
            val tagEnd = html.indexOf('>', i)
            if (tagEnd < 0) return null
            if (ID_ATTRIBUTE.containsMatchIn(html.substring(i, tagEnd))) {
                val close = html.indexOf("</script", tagEnd, ignoreCase = true)
                val blade = bladeOf(html.substring(tagEnd + 1, if (close < 0) html.length else close))
                if (blade != null) return blade
            }
            i = html.indexOf("<script", tagEnd, ignoreCase = true)
        }
        return null
    }

    private fun bladeOf(body: String): JsonElement? {
        val blade = parseJson(body)[BLADE_KEY]
        return blade?.takeIf { it is JsonObject && it["isLimitedFreeContent"].bool == true && it["tiles"].arr != null }
    }

    /** Un nombre JSON, et seulement un nombre : « "5" » n'en est pas un. */
    private fun number(e: JsonElement?): Double? =
        (e as? JsonPrimitive)?.takeUnless { it.isString || it is JsonNull }?.content?.toDoubleOrNull()

    private class Free(val start: Long?, val end: Long?, val price: Double, val currency: String?, val personal: Boolean)

    /**
     * Une licence gratuite MAINTENANT : un prix d'origine reel remis a zero, une remise commencee et pas finie.
     * Un prix d'origine nul n'est pas une offre : gratuit de toute facon, rien a garder.
     */
    private fun free(licence: JsonElement?, now: Long): Pair<Free?, String> {
        val tier = licence["priceTier"] as? JsonObject
        val price = number(tier?.get("price"))
        if (tier == null || price == null || price <= 0 || number(tier["discountedPrice"]) != 0.0) return null to "aucune licence gratuite"
        val start = Dates.iso(tier["discountStartDate"].str)
        val end = Dates.iso(tier["discountEndDate"].str)
        if (end != null && end <= now) return null to "remise terminee"
        if (start != null && start > now) return null to "remise a venir"
        val currency = tier["currencyCode"].str?.takeIf { CURRENCY.matches(it) }
        return Free(start, end, price, currency, licence["slug"].str == "personal") to ""
    }

    /** La plus petite image d'au moins 640 px de large, sinon la plus large ; a defaut, l'adresse de base. */
    private fun thumbnail(listing: JsonObject): String? {
        val first = listing["thumbnails"].arr?.firstOrNull() as? JsonObject ?: return null
        val images = first["images"].arr.orEmpty().mapNotNull { i ->
            val url = i["url"].str
            val width = number(i["width"])
            if (url != null && width != null) width to url else null
        }
        if (images.isNotEmpty()) {
            return (images.filter { it.first >= TARGET_WIDTH }.minByOrNull { it.first } ?: images.maxByOrNull { it.first }!!).second
        }
        return first["mediaUrl"].str
    }

    /** « Unreal Engine, Unity » : les formats de l'asset, sans doublon. */
    private fun formats(listing: JsonObject): String? =
        listing["assetFormats"].arr.orEmpty()
            .mapNotNull { it["assetFormatType"]["name"].str?.trim()?.takeIf { n -> n.isNotEmpty() } }
            .distinct().joinToString(", ").ifEmpty { null }

    /**
     * Les offres d'un bloc, a l'instant `now`. Une fiche devient une offre si une de ses licences est gratuite MAINTENANT.
     * Sa fin est la plus proche des licences gratuites ; sa valeur, le prix de la licence Personnelle, a defaut celui de la
     * moins chere des gratuites, dans la devise de la page.
     */
    fun mapOffers(blade: JsonElement?, now: Long): Mapped {
        val offers = mutableListOf<Offer>()
        val dropped = mutableListOf<Dropped>()
        val seen = HashSet<String>()
        for (tile in blade["tiles"].arr.orEmpty()) {
            val listing = tile["listing"] as? JsonObject
            if (listing == null) { dropped += Dropped(null, "fiche illisible"); continue }
            val uid = listing["uid"].str?.trim()?.lowercase().orEmpty()
            val title = listing["title"].str?.trim().orEmpty()
            val page = listingUrl(uid)
            if (page == null || title.isEmpty()) { dropped += Dropped(uid.ifEmpty { null }, "identifiant ou titre illisible"); continue }
            if (!seen.add(uid)) continue

            val read = listing["licenses"].arr.orEmpty().map { free(it, now) }
            val licences = read.mapNotNull { it.first }
            if (licences.isEmpty()) {
                dropped += Dropped(uid, read.map { it.second }.firstOrNull { it != "aucune licence gratuite" } ?: "aucune licence gratuite")
                continue
            }
            val worthOf = licences.firstOrNull { it.personal } ?: licences.minByOrNull { it.price }!!
            offers += Offer(
                key = Offer.keyFor(Stores.FAB, uid, title),
                source = NAME,
                store = Stores.FAB,
                storeId = uid,
                sourceId = "$NAME:$uid",
                title = title,
                url = page,
                image = Titles.webUrl(thumbnail(listing)),
                start = licences.mapNotNull { it.start }.minOrNull(),
                end = licences.mapNotNull { it.end }.minOrNull(),
                worth = worthOf.currency?.let { String.format(java.util.Locale.ROOT, "%.2f %s", worthOf.price, it) },
                publisher = listing["user"]["sellerName"].str?.take(120),
                platforms = formats(listing),
                category = "asset",
                // Ajoute a la bibliotheque, pour toujours : ce n'est pas un essai.
                keepable = true,
                firstSeen = now,
                lastSeen = now,
            )
        }
        return Mapped(offers, dropped)
    }

    suspend fun discover(fetcher: Fetcher, now: Long): SourceResult = try {
        val r = fetcher.get(PAGE_URL, accept = "text/html,application/xhtml+xml")
        if (!r.ok) {
            SourceResult(NAME, errors = listOf("HTTP ${r.code}"))
        } else {
            val blade = readBlade(r.body)
            if (blade == null) {
                SourceResult(NAME, errors = listOf("bloc des offres absent (la page a change de forme, ou un defi l'a remplacee)"))
            } else {
                // Le bloc EST la liste entiere : une fiche qui n'y est plus est terminee.
                SourceResult(NAME, offers = mapOffers(blade, now).offers)
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        SourceResult(NAME, errors = listOf(e.message ?: e.toString()))
    }
}
