package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Giver
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OddsInfo
import io.github.diaslamka.freegames.model.Seen
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * « Attends, il sera offert » (1.7.0) -- le meme calcul que watch/odds.js :
 * deja offert, un editeur qui offre, l'age et le prix de catalogue. Une
 * estimation en trois niveaux, avec ses raisons ; jamais un pourcentage.
 */
object Odds {
    const val HIGH = "high"
    const val MEDIUM = "medium"
    const val LOW = "low"
    const val UNKNOWN = "unknown"
    const val F2P = "f2p"

    const val PER_RUN = 8
    const val FRESH_MS = 30 * 24 * 3_600_000L
    const val NOT_FOUND_MS = 7 * 24 * 3_600_000L
    const val PASS_EVERY_MS = 3_600_000L
    private const val YEAR_MS = 365.25 * 24 * 3_600_000L
    private const val MAX_GIVERS = 1500
    private const val MAX_PASSES = 3000

    data class Reason(val key: String, val args: List<Any?> = emptyList())
    data class Estimate(val level: String, val reasons: List<Reason>)
    data class Target(val title: String, val appid: String?, val origin: String) {
        val key: String get() = if (appid != null) "app:$appid" else "t:${Titles.normalise(title)}"
    }

    private val FORMES = Regex("\\b(inc|ltd|limited|llc|gmbh|s ?a|sas|srl|co|corp|corporation|plc|pty|kk|ab|oy|bv|publishing)\\b")

    fun normalisePublisher(name: String?): String = Titles.normalise(name).replace(FORMES, " ").replace(Regex("\\s+"), " ").trim()

    /** Les editeurs des offres vues : un jeu par editeur une seule fois. */
    fun recordGivers(givers: Map<String, Giver>, offers: Collection<Offer>, now: Long): Map<String, Giver> {
        val next = givers.toMutableMap()
        for (o in offers) {
            val pub = o.publisher ?: continue
            if (o.keepable == false) continue
            val k = normalisePublisher(pub)
            val jeu = o.normalisedTitle
            if (k.isEmpty() || jeu.isEmpty()) continue
            val avant = next[k] ?: Giver(pub.take(120))
            if (jeu in avant.games) continue
            next[k] = avant.copy(games = (avant.games + jeu).takeLast(50), last = maxOf(avant.last, now))
        }
        return if (next.size > MAX_GIVERS) next.entries.sortedByDescending { it.value.last }.take(MAX_GIVERS).associate { it.toPair() } else next
    }

    /** Les passages : un par magasin et par jour, cinq au plus par titre. */
    fun recordPasses(passes: Map<String, List<Seen>>, offers: Collection<Offer>): Map<String, List<Seen>> {
        val next = passes.toMutableMap()
        for (o in offers) {
            if (o.keepable == false || o.normalisedTitle.isEmpty()) continue
            val ts = o.start ?: o.firstSeen
            val vus = next[o.normalisedTitle].orEmpty()
            if (vus.any { it.store == o.store && it.ts / 86_400_000L == ts / 86_400_000L }) continue
            next[o.normalisedTitle] = (listOf(Seen(o.store, ts)) + vus).sortedByDescending { it.ts }.take(5)
        }
        return if (next.size > MAX_PASSES) next.entries.sortedByDescending { e -> e.value.maxOf { it.ts } }.take(MAX_PASSES).associate { it.toPair() } else next
    }

    /** Les souhaits a estimer : la saisie d'abord, puis les listes importees. */
    fun targets(s: AppState): List<Target> {
        val vus = mutableSetOf<String>()
        val out = mutableListOf<Target>()
        fun add(t: Target) { val n = Titles.normalise(t.title); if (n.isNotEmpty() && vus.add(n)) out += t }
        s.wishlist.forEach { add(Target(it, null, "manual")) }
        s.importedWishes.forEach { w -> add(Target(w.title, if (w.store == Stores.STEAM) w.id else null, w.store)) }
        return out
    }

    /* ------------------------------------------------------------ la fiche */

    /** « 17 Sep, 2020 », « Sep 17, 2020 », « Q1 2027 » : une date, ou null. */
    fun readSteamDate(text: String?): Long? {
        val s = text?.trim()?.replace(Regex("(\\d)(st|nd|rd|th)\\b"), "$1").orEmpty()
        if (s.isEmpty()) return null
        for (f in listOf("d MMM, yyyy", "MMM d, yyyy", "d MMM yyyy", "MMM yyyy")) {
            val p = SimpleDateFormat(f, Locale.ENGLISH).apply { timeZone = TimeZone.getTimeZone("UTC"); isLenient = false }
            runCatching { p.parse(s) }.getOrNull()?.let { return it.time }
        }
        val an = Regex("\\b(19|20)\\d{2}\\b").find(s)?.value?.toInt() ?: return null
        return SimpleDateFormat("yyyy", Locale.ENGLISH).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(an.toString())?.time
    }

    /** L'entree d'une reponse appdetails pour CET appid -- par la cle, puis par steam_appid (mesure du 2026-09-27). */
    fun appDetailsEntry(body: String, appid: String): JsonObject? {
        val root = parseJson(body) as? JsonObject ?: return null
        root[appid]?.obj?.let { return it }
        return root.values.mapNotNull { it.obj }.firstOrNull { it["data"]["steam_appid"].text == appid }
    }

    fun readInfo(body: String, appid: String, now: Long): OddsInfo? {
        val e = appDetailsEntry(body, appid) ?: return null
        if ((e["success"] as? JsonPrimitive)?.booleanOrNull != true) return null
        val d = e["data"]
        val soon = (d["release_date"]["coming_soon"] as? JsonPrimitive)?.booleanOrNull == true
        val prix = d["price_overview"]
        return OddsInfo(
            at = now,
            appid = appid,
            name = d["name"].str?.take(160),
            isFree = (d["is_free"] as? JsonPrimitive)?.booleanOrNull == true,
            comingSoon = soon,
            released = if (soon) null else readSteamDate(d["release_date"]["date"].str),
            basePrice = prix["initial"].num?.toDouble()?.div(100),
            currency = prix["currency"].str,
            publishers = d["publishers"].arr?.mapNotNull { it.str }?.take(5).orEmpty(),
        )
    }

    fun needsInfo(s: AppState, t: Target, now: Long): Boolean {
        val e = s.odds[t.key] ?: return true
        return now - e.at >= (if (e.notFound) NOT_FOUND_MS else FRESH_MS)
    }

    /** Lit huit fiches au plus : par appid (liste Steam), sinon par le titre exact. */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String): Map<String, OddsInfo> {
        val next = s.odds.toMutableMap()
        for (t in targets(s).filter { needsInfo(s, it, now) }.take(PER_RUN)) {
            val appid = t.appid ?: runCatchingSuspend {
                val r = fetcher.get(Ratings.searchUrl(t.title, country))
                if (r.ok) Ratings.matchSearch(r.body, t.title) else null
            }.getOrNull()
            if (appid == null) { next[t.key] = OddsInfo(at = now, notFound = true); continue }
            val info = runCatchingSuspend {
                val r = fetcher.get("https://store.steampowered.com/api/appdetails?appids=$appid&cc=$country&l=english")
                if (r.ok) readInfo(r.body, appid, now) else null
            }.getOrNull()
            next[t.key] = info ?: OddsInfo(at = now, notFound = true)
        }
        return next
    }

    /* ------------------------------------------------------ l'estimation */

    fun estimate(seen: List<Seen>?, info: OddsInfo?, givers: Map<String, Giver>, now: Long): Estimate {
        if (info?.isFree == true) return Estimate(F2P, listOf(Reason("odds_free_to_play")))
        val reasons = mutableListOf<Reason>()
        var score = 0
        var su = false
        if (!seen.isNullOrEmpty()) {
            su = true
            score += if (seen.size >= 2) 4 else 3
            reasons += Reason("odds_given_before", listOf(seen.size, seen.first().ts, seen.first().store))
        }
        if (info != null && !info.notFound) {
            su = true
            val g = info.publishers.mapNotNull { givers[normalisePublisher(it)] }.firstOrNull { it.games.isNotEmpty() }
            if (g != null) { score += 2; reasons += Reason("odds_publisher_gave", listOf(g.name, g.games.size)) }
            if (info.comingSoon) { score -= 3; reasons += Reason("odds_unreleased") }
            else if (info.released != null) {
                val ans = (now - info.released) / YEAR_MS
                if (ans < 1) { score -= 2; reasons += Reason("odds_recent") }
                else if (ans >= 2) { score += 1; reasons += Reason("odds_old", listOf(ans.toInt())) }
            }
            val p = info.basePrice
            if (p != null) {
                if (p >= 40) { score -= 1; reasons += Reason("odds_expensive", listOf(p, info.currency)) }
                else if (p > 0 && p <= 25) { score += 1; reasons += Reason("odds_cheap", listOf(p, info.currency)) }
            }
        }
        if (!su) return Estimate(UNKNOWN, listOf(Reason(if (info?.notFound == true) "odds_not_on_steam" else "odds_pending")))
        return Estimate(if (score >= 3) HIGH else if (score >= 1) MEDIUM else LOW, reasons)
    }

    private val ORDER = listOf(HIGH, MEDIUM, LOW, UNKNOWN, F2P)

    /** Chaque souhait avec son estimation, les meilleures chances d'abord. */
    fun rank(s: AppState, now: Long): List<Pair<Target, Estimate>> = targets(s).map { t ->
        t to estimate(s.passes[Titles.normalise(t.title)], s.odds[t.key], s.givers, now)
    }.sortedWith(compareBy<Pair<Target, Estimate>> { ORDER.indexOf(it.second.level) }.thenBy { it.first.title })
}
