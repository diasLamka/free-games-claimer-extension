package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Deal
import io.github.diaslamka.freegames.model.PricePoint
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URLEncoder

/**
 * Un passage de lecture avec la cle IsThereAnyDeal de l'utilisateur (1.48.0) : la cle, et ce que le passage a appris d'elle.
 * `refresh` remplit les trois drapeaux ; l'appelant les lit ensuite (une cle refusee se dit dans les reglages).
 */
class ItadPass(val key: String) {
    /** Le service a refuse la cle : le reste du passage se lit par CheapShark. */
    var refused = false

    /** Le service demande de ralentir : le passage s'arrete, rien n'est ecrit de plus. */
    var busy = false

    /** Une reponse de prix a ete lue avec cette cle : elle est bonne. */
    var worked = false
}

/** Ce que donne l'essai de la cle (reglages). */
enum class ItadTest { OK, REFUSED, BUSY, NET, UNEXPECTED }

/**
 * Les souhaits en detail (1.42.0) : une image, le prix d'aujourd'hui, le plus bas jamais vu, les marchands, les prix que
 * l'appli a releves. Tout vient d'API publiques :
 *   - la recherche Steam (`storesearch`) : le titre, l'appid, le prix dans la devise du pays choisi ;
 *   - IsThereAnyDeal (1.48.0), AVEC la cle personnelle de l'utilisateur : le meilleur prix par marchand et le plus bas
 *     historique, dans la devise du pays -- comme l'extension (watch/prices.js). Ses donnees ne sont ni converties ni
 *     retouchees ; son nom et un lien accompagnent ce qu'on montre ;
 *   - CheapShark, sans cle : le meilleur prix chez tous les marchands, le plus bas historique, la liste des marchands -- en
 *     dollars, seule devise qu'il connaisse. Il prend le relais sans cle, ou si la cle est refusee.
 * Ce qui vient d'une API est borne a l'arrivee ; ce qu'on ne sait pas lire reste « inconnu », jamais invente.
 */
object Wish {
    const val PER_RUN = 6
    const val FRESH_MS = 6 * 3_600_000L
    const val NOT_FOUND_MS = 3 * 24 * 3_600_000L
    const val PASS_EVERY_MS = 30 * 60_000L
    private const val MAX_HISTORY = 60
    private const val HISTORY_GAP_MS = 12 * 3_600_000L
    private const val MAX_DEALS = 8
    private const val MAX_SUGGESTIONS = 8

    /** Les deux sources de prix, telles qu'elles sont notees dans `WishInfo.source` et `WishInfo.want`. */
    const val SRC_ITAD = "itad"
    const val SRC_SHARK = "cheapshark"

    private const val ITAD = "https://api.isthereanydeal.com"

    /** « Au plus bas » : le meilleur prix est au plus bas historique (a un demi-cent pres), ou a 10 % de lui. */
    private const val NEAR = 1.10

    /** Les marchands de CheapShark (storeID) les plus courants ; un autre s'affiche « Marchand n ». */
    val STORE_NAMES = mapOf(
        "1" to "Steam", "2" to "GamersGate", "3" to "Green Man Gaming", "7" to "GOG", "8" to "EA app", "11" to "Humble Store",
        "13" to "Ubisoft Connect", "15" to "Fanatical", "21" to "WinGameStore", "23" to "GameBillet", "24" to "Voidu",
        "25" to "Epic Games Store", "27" to "Gamesplanet", "28" to "Gamesload", "29" to "2Game", "30" to "IndieGala",
        "31" to "Blizzard Shop", "33" to "DLGamer", "34" to "Noctre", "35" to "DreamGame",
    )

    /** Un identifiant CheapShark se dit par son nom ; un nom (IsThereAnyDeal donne le nom du marchand) se dit tel quel. */
    fun storeName(id: String?): String = STORE_NAMES[id] ?: when {
        id == null -> "?"
        id.isNotEmpty() && id.all(Char::isDigit) -> "#$id"
        else -> id
    }

    /** Une proposition de la recherche en direct. */
    data class Suggestion(
        val title: String,
        val appid: String? = null,
        val gameId: String? = null,
        val image: String? = null,
        /** La vignette que la recherche rend : celle qui existe toujours. */
        val thumb: String? = null,
        val price: Double? = null,
        val currency: String? = null,
        val discount: Int = 0,
        /** Le meilleur prix chez tous les marchands, en dollars (CheapShark). */
        val best: Double? = null,
    )

    fun steamHeader(appid: String?): String? = Tonight.steamHeader(appid)

    private fun numeric(id: String?): String? = id?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }

    private fun enc(s: String) = URLEncoder.encode(s.take(100), "UTF-8")

    private fun cc(country: String) = if (Regex("^[A-Z]{2}$").matches(country)) country else "US"

    fun steamSearchUrl(term: String, country: String) =
        "https://store.steampowered.com/api/storesearch/?term=${enc(term)}&cc=${cc(country)}&l=english"

    fun sharkSearchUrl(term: String) = "https://www.cheapshark.com/api/1.0/games?title=${enc(term)}&limit=8"
    fun sharkLookupUrl(appid: String) = "https://www.cheapshark.com/api/1.0/games?steamAppID=$appid"
    fun sharkGameUrl(gameId: String) = "https://www.cheapshark.com/api/1.0/games?id=$gameId"

    /** La page d'une offre chez un marchand, par CheapShark (qui redirige). */
    fun dealUrl(dealId: String): String = "https://www.cheapshark.com/redirect?dealID=$dealId"

    /* ------------------------------------------------------ IsThereAnyDeal */

    private val KEY_FORM = Regex("^[A-Za-z0-9_-]{8,100}$")
    private val UUID = Regex("^[0-9a-fA-F-]{20,40}$")

    /** Une cle qui a la forme de celles du service, ou null : autre chose n'est jamais envoye. */
    fun itadKeyOf(raw: String?): String? = raw?.trim()?.takeIf { KEY_FORM.matches(it) }

    fun itadLookupUrl(apiKey: String, appid: String?, title: String): String =
        "$ITAD/games/lookup/v1?key=${enc(apiKey)}&" + (if (appid != null) "appid=${enc(appid)}" else "title=${enc(title)}")

    fun itadSearchUrl(apiKey: String, title: String): String = "$ITAD/games/search/v1?key=${enc(apiKey)}&title=${enc(title)}&results=6"

    /** Les prix d'un jeu, dans la devise du pays ; `vouchers` coupe : un code promo n'est pas un prix. */
    fun itadPricesUrl(apiKey: String, country: String): String =
        "$ITAD/games/prices/v3?key=${enc(apiKey)}&country=${cc(country)}&deals=false&vouchers=false&capacity=$MAX_DEALS"

    /** Le corps du POST des prix : la liste des identifiants demandes, ici un seul. */
    fun itadPricesBody(id: String): String = JsonArray(listOf(JsonPrimitive(id))).toString()

    data class ItadGame(val id: String, val slug: String?, val title: String)

    /** Le jeu d'un `lookup` : trouve, avec un identifiant lisible ; sinon null. */
    fun parseItadLookup(body: String?): ItadGame? {
        val root = parseJson(body)
        if (root["found"].bool != true) return null
        val g = root["game"]
        val id = g["id"].str?.takeIf { UUID.matches(it) } ?: return null
        return ItadGame(id, g["slug"].str?.take(120), clean(g["title"].str))
    }

    /** Les jeux d'une `search`. */
    fun parseItadSearch(body: String?): List<ItadGame> = parseJson(body).arr.orEmpty().mapNotNull { g ->
        val id = g["id"].str?.takeIf { UUID.matches(it) } ?: return@mapNotNull null
        ItadGame(id, g["slug"].str?.take(120), clean(g["title"].str))
    }

    private class ItadRow(val deal: Deal, val currency: String?)

    private fun amountOf(p: JsonElement?): Double? = p["amount"].num?.takeIf { it >= 0 }

    /**
     * La reponse de `prices/v3` pour UN jeu, en prix. Les montants sont ceux du service, dans sa devise (celle du pays demande) :
     * aucune conversion, aucune retouche -- ni des montants, ni des adresses (leurs etiquettes d'affiliation font partie de la
     * donnee). Null : rien de lisible. `base` garde ce que Steam a appris (image, prix local).
     */
    fun readItadPrices(body: String?, slug: String?, base: WishInfo, now: Long): WishInfo? {
        val entry = parseJson(body)[0]
        if (entry !is JsonObject) return null
        val rows = entry["deals"].arr.orEmpty().mapNotNull { d ->
            val price = amountOf(d["price"]) ?: return@mapNotNull null
            ItadRow(
                Deal(
                    store = clean(d["shop"]["name"].str).take(60).ifEmpty { "?" },
                    price = price,
                    retail = amountOf(d["regular"]),
                    savings = d["cut"].num?.toInt()?.coerceIn(0, 100) ?: 0,
                    url = d["url"].str?.takeIf { it.startsWith("https://") && it.length <= 1500 },
                ),
                d["price"]["currency"].str,
            )
        }.sortedBy { it.deal.price }.take(MAX_DEALS)
        val best = rows.firstOrNull()
        val lowAll = entry["historyLow"]["all"]
        val histo = amountOf(lowAll)
        if (best == null && histo == null) return null
        // Le plus bas historique ne peut pas etre au-dessus du prix d'aujourd'hui.
        val low = if (histo != null && best != null) minOf(histo, best.deal.price) else histo
        val currency = best?.currency ?: lowAll["currency"].str
        return base.copy(
            at = now, notFound = false, source = SRC_ITAD, currency = currency,
            best = best?.deal?.price, bestStore = best?.deal?.store, retail = best?.deal?.retail,
            lowest = low, lowestAt = null,
            deals = rows.map { it.deal },
            // Une courbe garde UNE devise : changer de source ou de devise la recommence.
            history = recordHistory(if (base.currency == currency && base.source == SRC_ITAD) base.history else emptyList(), best?.deal?.price, now),
            page = slug?.let { "https://isthereanydeal.com/game/${URLEncoder.encode(it, "UTF-8")}/info/" },
        )
    }

    private sealed interface ItadRead {
        class Done(val info: WishInfo) : ItadRead
        object Missing : ItadRead
        object Refused : ItadRead
        object Busy : ItadRead
        object Net : ItadRead
    }

    /**
     * Un souhait chez IsThereAnyDeal : le jeu (par son appid Steam, sinon son titre EXACT, sinon la recherche), puis ses prix.
     * Ne jette jamais ; ni la cle ni l'adresse n'entrent dans ce qui est rendu.
     */
    private suspend fun readItad(fetcher: Fetcher, apiKey: String, title: String, appid: String?, base: WishInfo, now: Long, country: String): ItadRead {
        val shown = Titles.display(title)
        val target = key(title)
        val lookups = buildList<String> {
            if (appid != null) add(itadLookupUrl(apiKey, appid, shown))
            add(itadLookupUrl(apiKey, null, shown))
        }
        var game: ItadGame? = null
        for (u in lookups) {
            val r = runCatchingSuspend { fetcher.get(u) }.getOrNull() ?: return ItadRead.Net
            if (r.code == 401 || r.code == 403) return ItadRead.Refused
            if (r.code == 429) return ItadRead.Busy
            game = if (r.ok) parseItadLookup(r.body) else null
            if (game != null) break
        }
        if (game == null) {
            val r = runCatchingSuspend { fetcher.get(itadSearchUrl(apiKey, shown)) }.getOrNull()
            if (r != null && r.code == 429) return ItadRead.Busy
            game = if (r != null && r.ok) parseItadSearch(r.body).firstOrNull { key(it.title) == target } else null
        }
        val found = game ?: return ItadRead.Missing
        val p = runCatchingSuspend { fetcher.post(itadPricesUrl(apiKey, country), itadPricesBody(found.id)) }.getOrNull() ?: return ItadRead.Net
        if (p.code == 401 || p.code == 403) return ItadRead.Refused
        if (p.code == 429) return ItadRead.Busy
        if (!p.ok) return ItadRead.Net
        val info = readItadPrices(p.body, found.slug, base, now) ?: return ItadRead.Missing
        return ItadRead.Done(info)
    }

    /** L'essai de la cle (reglages) : un jeu connu (Half-Life 2, appid 220) est cherche. */
    suspend fun testItad(fetcher: Fetcher, apiKey: String): ItadTest {
        val r = runCatchingSuspend { fetcher.get(itadLookupUrl(apiKey, "220", "Half-Life 2")) }.getOrNull() ?: return ItadTest.NET
        return when {
            r.code == 401 || r.code == 403 -> ItadTest.REFUSED
            r.code == 429 -> ItadTest.BUSY
            !r.ok -> ItadTest.NET
            parseItadLookup(r.body) != null -> ItadTest.OK
            else -> ItadTest.UNEXPECTED
        }
    }

    /* ------------------------------------------------------ la lecture */

    private fun clean(s: String?): String = s.orEmpty().replace(Regex("\\s+"), " ").trim().take(160)

    private fun cents(v: Double?): Double? = v?.div(100)

    /** La reponse de la recherche Steam : jeux seulement (pas de DLC ni de bande-son), l'en-tete deduit de l'appid. */
    fun parseSteam(body: String?): List<Suggestion> = parseJson(body)["items"].arr.orEmpty().mapNotNull { i ->
        val type = i["type"].str
        val appid = numeric(i["id"].text) ?: return@mapNotNull null
        if (type != null && type != "app") return@mapNotNull null
        val name = clean(i["name"].str).ifEmpty { return@mapNotNull null }
        val final = cents(i["price"]["final"].num)
        val initial = cents(i["price"]["initial"].num)
        val discount = if (final != null && initial != null && initial > 0 && final < initial) Math.round(100 * (initial - final) / initial).toInt() else 0
        Suggestion(title = name, appid = appid, image = steamHeader(appid), thumb = i["tiny_image"].str?.takeIf { it.startsWith("https://") }, price = final, currency = i["price"]["currency"].str, discount = discount)
    }

    /** La reponse de la recherche CheapShark (`games?title=`) : un jeu, son meilleur prix, sa vignette. */
    fun parseShark(body: String?): List<Suggestion> = parseJson(body).arr.orEmpty().mapNotNull { i ->
        val name = clean(i["external"].str).ifEmpty { return@mapNotNull null }
        val appid = numeric(i["steamAppID"].text)
        Suggestion(
            title = name, appid = appid, gameId = numeric(i["gameID"].text),
            image = steamHeader(appid), thumb = i["thumb"].str?.takeIf { it.startsWith("https://") },
            best = i["cheapest"].num,
        )
    }

    /** La recherche en direct : Steam d'abord (le plus riche), CheapShark pour ce que Steam ne vend pas ; sans doublon. */
    suspend fun suggest(fetcher: Fetcher, term: String, country: String): List<Suggestion> {
        val t = term.trim()
        if (t.length < 2) return emptyList()
        val steam = runCatchingSuspend { fetcher.get(steamSearchUrl(t, country)).let { if (it.ok) parseSteam(it.body) else emptyList() } }.getOrDefault(emptyList())
        val shark = if (steam.size >= 5) emptyList()
        else runCatchingSuspend { fetcher.get(sharkSearchUrl(t)).let { if (it.ok) parseShark(it.body) else emptyList() } }.getOrDefault(emptyList())
        return merge(steam, shark)
    }

    fun merge(steam: List<Suggestion>, shark: List<Suggestion>): List<Suggestion> {
        val seen = LinkedHashMap<String, Suggestion>()
        for (s in steam) seen.putIfAbsent(Titles.normalise(s.title), s)
        for (s in shark) {
            val k = Titles.normalise(s.title)
            val known = seen[k]
            // Le meme jeu des deux cotes : Steam garde son prix local, CheapShark apporte son identifiant.
            if (known != null) { if (known.gameId == null && s.gameId != null) seen[k] = known.copy(gameId = s.gameId) } else seen[k] = s
        }
        return seen.values.filter { it.title.isNotBlank() }.take(MAX_SUGGESTIONS)
    }

    /**
     * Ce qu'une proposition apprend deja, avant toute autre lecture : l'image, le prix Steam. `at = 0` : ce n'est PAS une
     * lecture complete -- les marchands et le plus bas historique restent a lire, et le prochain passage s'en charge.
     */
    fun seed(s: Suggestion) = WishInfo(
        at = 0L, appid = s.appid, gameId = s.gameId, name = s.title, image = s.image, thumb = s.thumb,
        localPrice = s.price, localCurrency = s.currency, localDiscount = s.discount, best = s.best,
    )

    /** Le detail d'un jeu CheapShark (`games?id=`) : le plus bas jamais vu, les marchands. */
    fun readGame(body: String?, base: WishInfo, now: Long): WishInfo {
        val root = parseJson(body)
        val deals = root["deals"].arr.orEmpty().mapNotNull { d ->
            val price = d["price"].num ?: return@mapNotNull null
            val store = d["storeID"].text ?: return@mapNotNull null
            Deal(
                store = store, price = price, retail = d["retailPrice"].num,
                savings = d["savings"].num?.let { Math.round(it).toInt() } ?: 0,
                dealId = d["dealID"].str?.takeIf { it.length <= 200 },
            )
        }.sortedBy { it.price }.take(MAX_DEALS)
        val low = root["cheapestPriceEver"]["price"].num
        val lowAt = root["cheapestPriceEver"]["date"].num?.toLong()?.times(1000)
        val best = deals.firstOrNull()
        // Le plus bas historique ne peut pas etre au-dessus du prix d'aujourd'hui : CheapShark le met a jour avec retard.
        val lowest = if (low != null && best != null) minOf(low, best.price) else low
        return base.copy(
            at = now, notFound = false, source = SRC_SHARK, currency = null, page = null,
            name = base.name ?: clean(root["info"]["title"].str).ifEmpty { null },
            image = base.image ?: steamHeader(numeric(root["info"]["steamAppID"].text)) ?: root["info"]["thumb"].str?.takeIf { it.startsWith("https://") },
            best = best?.price, bestStore = best?.store, retail = deals.firstNotNullOfOrNull { it.retail },
            lowest = lowest, lowestAt = if (lowest == low) lowAt else base.lowestAt,
            deals = deals,
            // Une courbe garde UNE devise : venant d'IsThereAnyDeal (une devise), elle recommence en dollars.
            history = recordHistory(if (base.currency == null) base.history else emptyList(), best?.price, now),
        )
    }

    /** Un releve de plus, quand le prix a bouge ou que le dernier date de plus d'une demi-journee ; borne. */
    fun recordHistory(prev: List<PricePoint>, price: Double?, now: Long): List<PricePoint> {
        if (price == null) return prev
        val last = prev.lastOrNull()
        if (last != null && last.price == price && now - last.at < HISTORY_GAP_MS) return prev
        return (prev + PricePoint(now, price)).takeLast(MAX_HISTORY)
    }

    /* ------------------------------------------------------ ce que ca dit */

    fun atLow(i: WishInfo?): Boolean = i?.best != null && i.lowest != null && i.best <= i.lowest + 0.005
    fun nearLow(i: WishInfo?): Boolean = i?.best != null && i.lowest != null && i.best <= i.lowest * NEAR

    /** En promotion : Steam annonce une reduction, ou le meilleur prix est sous le prix de catalogue. */
    fun onSale(i: WishInfo?): Boolean = i != null && (i.localDiscount > 0 || (i.best != null && i.retail != null && i.best < i.retail - 0.005))

    /** La reduction, en pour cent : Steam d'abord, sinon l'ecart entre le meilleur prix et le catalogue. */
    fun discount(i: WishInfo?): Int {
        if (i == null) return 0
        if (i.localDiscount > 0) return i.localDiscount
        val b = i.best
        val r = i.retail
        return if (b != null && r != null && r > 0 && b < r) Math.round(100 * (r - b) / r).toInt() else 0
    }

    /* ------------------------------------------------------ la lecture a jour */

    fun key(title: String) = Titles.normalise(title)

    /** Les souhaits a suivre : les siens, puis ceux importes (avec l'appid quand c'est un souhait Steam). */
    fun targets(s: AppState): List<Pair<String, String?>> =
        (s.wishlist.map { it to null } + s.importedWishes.filter { it.title.isNotBlank() }.map { it.title to if (it.store == Stores.STEAM) numeric(it.id) else null })
            .distinctBy { key(it.first) }

    /** La source visee : IsThereAnyDeal quand une cle est la ; sinon CheapShark, dite par l'absence de valeur. */
    private fun wanted(itad: Boolean): String? = if (itad) SRC_ITAD else null

    /**
     * Faut-il (re)lire ce souhait ? Jamais lu, perime, ou lu avec une autre source que celle visee maintenant (une cle
     * ajoutee ou retiree). Une fiche d'avant la 1.48.0 n'a pas de `want` : elle compte pour CheapShark, rien n'est relu a tort.
     */
    fun needs(i: WishInfo?, now: Long, itad: Boolean = false): Boolean {
        if (i == null) return true
        if (i.want != wanted(itad)) return true
        return now - i.at >= (if (i.notFound) NOT_FOUND_MS else FRESH_MS)
    }

    /**
     * Six souhaits au plus par passage : ceux sans fiche d'abord, puis les plus anciens. Avec `itad`, IsThereAnyDeal est lu
     * d'abord ; une cle refusee ou un service injoignable fait passer a CheapShark, et « trop de requetes » arrete le passage.
     */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String, itad: ItadPass? = null): Map<String, WishInfo> {
        val next = s.wishInfo.toMutableMap()
        val want = wanted(itad != null)
        val todo = targets(s).filter { needs(s.wishInfo[key(it.first)], now, itad != null) }
            .sortedBy { s.wishInfo[key(it.first)]?.at ?: 0L }.take(PER_RUN)
        for ((title, hint) in todo) {
            val k = key(title)
            val got = runCatchingSuspend { read(fetcher, title, hint, next[k], s, now, country, itad) }
            if (itad != null && itad.busy) break
            val info = got.getOrNull()
            next[k] = if (info != null) info.copy(want = want)
            else next[k]?.copy(at = now - FRESH_MS + 30 * 60_000L) ?: WishInfo(at = now, notFound = true, want = want)
        }
        return next
    }

    private suspend fun read(fetcher: Fetcher, title: String, hint: String?, old: WishInfo?, s: AppState, now: Long, country: String, itad: ItadPass?): WishInfo? {
        val target = key(title)
        var base = old ?: WishInfo(at = now)
        var appid = base.appid ?: hint ?: s.odds["t:$target"]?.appid
        // Steam : le prix local, l'image, l'identifiant quand on ne l'a pas.
        val found = runCatchingSuspend {
            val r = fetcher.get(steamSearchUrl(Titles.display(title), country))
            if (r.ok) parseSteam(r.body) else emptyList()
        }.getOrDefault(emptyList())
            .firstOrNull { (appid != null && it.appid == appid) || (appid == null && key(it.title) == target) }
        if (found != null) {
            appid = found.appid
            base = base.copy(appid = appid, name = found.title, image = found.image ?: base.image, thumb = found.thumb ?: base.thumb, localPrice = found.price, localCurrency = found.currency, localDiscount = found.discount)
        } else if (appid != null) base = base.copy(appid = appid)
        // IsThereAnyDeal d'abord, quand l'utilisateur a mis sa cle : les memes prix que l'extension.
        if (itad != null && !itad.refused && !itad.busy) {
            when (val r = readItad(fetcher, itad.key, title, appid, base, now, country)) {
                is ItadRead.Done -> { itad.worked = true; return r.info }
                is ItadRead.Missing -> return if (found != null) base.copy(at = now) else WishInfo(at = now, notFound = true)
                is ItadRead.Refused -> itad.refused = true
                is ItadRead.Busy -> { itad.busy = true; return null }
                is ItadRead.Net -> Unit
            }
        }
        // CheapShark : l'identifiant du jeu, puis son detail.
        var gameId = base.gameId
        if (gameId == null && appid != null) {
            gameId = runCatchingSuspend { fetcher.get(sharkLookupUrl(appid)).let { if (it.ok) parseShark(it.body).firstOrNull()?.gameId else null } }.getOrNull()
        }
        if (gameId == null) {
            val hit = runCatchingSuspend { fetcher.get(sharkSearchUrl(Titles.display(title))).let { if (it.ok) parseShark(it.body) else emptyList() } }
                .getOrDefault(emptyList()).firstOrNull { key(it.title) == target }
            gameId = hit?.gameId
            if (hit != null && base.image == null) base = base.copy(image = hit.image, thumb = hit.thumb ?: base.thumb)
        }
        if (gameId == null) return if (found != null) base.copy(at = now) else WishInfo(at = now, notFound = true)
        base = base.copy(gameId = gameId)
        val g = fetcher.get(sharkGameUrl(gameId))
        if (!g.ok) throw IllegalStateException("CheapShark : HTTP ${g.code}")
        return readGame(g.body, base, now)
    }

    /* ------------------------------------------------------ le tableau de bord */

    data class Dashboard(val count: Int, val onSale: Int, val atLow: Int, val freeNow: Int)

    fun dashboard(s: AppState, now: Long): Dashboard {
        val ts = targets(s)
        val free = s.offers.values.filter { it.isOpen(now) }.map { it.normalisedTitle }.toSet()
        val infos = ts.map { s.wishInfo[key(it.first)] }
        return Dashboard(
            count = ts.size,
            onSale = infos.count { onSale(it) },
            atLow = infos.count { atLow(it) },
            freeNow = ts.count { key(it.first) in free },
        )
    }
}
