package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Deal
import io.github.diaslamka.freegames.model.PricePoint
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import java.net.URLEncoder

/**
 * Les souhaits en detail (1.42.0) : une image, le prix d'aujourd'hui, le plus bas jamais vu, les marchands, les prix que
 * l'appli a releves. Tout vient de deux API publiques, sans cle :
 *   - la recherche Steam (`storesearch`) : le titre, l'appid, le prix dans la devise du pays choisi ;
 *   - CheapShark : le meilleur prix chez tous les marchands, le plus bas historique, la liste des marchands -- en dollars,
 *     seule devise commune a tous.
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

    /** « Au plus bas » : le meilleur prix est au plus bas historique (a un demi-cent pres), ou a 10 % de lui. */
    private const val NEAR = 1.10

    /** Les marchands de CheapShark (storeID) les plus courants ; un autre s'affiche « Marchand n ». */
    val STORE_NAMES = mapOf(
        "1" to "Steam", "2" to "GamersGate", "3" to "Green Man Gaming", "7" to "GOG", "8" to "EA app", "11" to "Humble Store",
        "13" to "Ubisoft Connect", "15" to "Fanatical", "21" to "WinGameStore", "23" to "GameBillet", "24" to "Voidu",
        "25" to "Epic Games Store", "27" to "Gamesplanet", "28" to "Gamesload", "29" to "2Game", "30" to "IndieGala",
        "31" to "Blizzard Shop", "33" to "DLGamer", "34" to "Noctre", "35" to "DreamGame",
    )

    fun storeName(id: String?): String = STORE_NAMES[id] ?: "#$id"

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
            at = now, notFound = false,
            name = base.name ?: clean(root["info"]["title"].str).ifEmpty { null },
            image = base.image ?: steamHeader(numeric(root["info"]["steamAppID"].text)) ?: root["info"]["thumb"].str?.takeIf { it.startsWith("https://") },
            best = best?.price, bestStore = best?.store, retail = deals.firstNotNullOfOrNull { it.retail },
            lowest = lowest, lowestAt = if (lowest == low) lowAt else base.lowestAt,
            deals = deals,
            history = recordHistory(base.history, best?.price, now),
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

    fun needs(i: WishInfo?, now: Long): Boolean = i == null || now - i.at >= (if (i.notFound) NOT_FOUND_MS else FRESH_MS)

    /** Six souhaits au plus par passage : ceux sans fiche d'abord, puis les plus anciens. */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String): Map<String, WishInfo> {
        val next = s.wishInfo.toMutableMap()
        val todo = targets(s).filter { needs(s.wishInfo[key(it.first)], now) }
            .sortedBy { s.wishInfo[key(it.first)]?.at ?: 0L }.take(PER_RUN)
        for ((title, hint) in todo) {
            val k = key(title)
            next[k] = runCatchingSuspend { read(fetcher, title, hint, next[k], s, now, country) }.getOrNull()
                ?: next[k]?.copy(at = now - FRESH_MS + 30 * 60_000L)
                ?: WishInfo(at = now, notFound = true)
        }
        return next
    }

    private suspend fun read(fetcher: Fetcher, title: String, hint: String?, old: WishInfo?, s: AppState, now: Long, country: String): WishInfo {
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
