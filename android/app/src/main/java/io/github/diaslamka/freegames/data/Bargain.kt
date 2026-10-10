package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.PriceCheck
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import java.util.Locale

/**
 * « Piege ou bonne affaire ? » (1.22.0) -- portage de watch/bargain.js.
 *
 * Une note de A a D avec ses RAISONS, ou « non evaluee » quand les donnees
 * manquent. Elle ne devine pas : la table d'or `bargain-golden.tsv`, regeneree
 * depuis le module JS (test/bargain.test.mjs), est relue par `BargainTest`.
 *
 *  - la valeur annoncee par un agregateur (en dollars, sans garantie) n'est
 *    « verifiee » que recoupee avec le prix Steam (lu en dollars aussi) ;
 *  - ce qui est gratuit de toute facon, une demo, une musique : D ;
 *  - A exige une bonne note Steam ET une valeur confirmee.
 */
object Bargain {
    private const val DAY_MS = 24 * 3_600_000L
    const val FRESH_MS = 30 * DAY_MS
    const val NONE_MS = 7 * DAY_MS
    const val PER_RUN = 8
    const val MAX_ENTRIES = 400
    const val COMPARE_CURRENCY = "USD"

    private const val INFLATED_RATIO = 1.5
    private const val VERY_INFLATED_RATIO = 3.0
    private const val INFLATED_MIN_GAP = 5.0
    private const val WORTH_THRESHOLD = 10.0
    private const val MIN_REVIEWS = 50

    /** Les sources qui lisent le catalogue du magasin lui-meme : leur prix est celui du magasin. */
    private val FIRST_PARTY = setOf("epic-api", "gog", "steam", "epic-mobile", "fab")
    private val STORE_OWN = mapOf("steam" to "steam", "epic-api" to "epic", "gog" to "gog")
    private val TRIAL = Regex("\\b(demo|playtest|benchmark)\\b", RegexOption.IGNORE_CASE)
    private val DLC_WORD = Regex("^(dlc|add-?on)$", RegexOption.IGNORE_CASE)

    data class Reason(val key: String, val args: List<String>, val tone: String)
    data class Verdict(val grade: String?, val reasons: List<Reason>, val appid: String? = null)

    private fun reason(key: String, tone: String, vararg args: String) = Reason(key, args.toList(), tone)

    /** « store » | « aggregator » | null : qui a donne la valeur de cette offre. */
    fun worthSource(o: Offer): String? {
        if (o.worth.isNullOrBlank()) return null
        return if (o.source in FIRST_PARTY) "store" else "aggregator"
    }

    /** 19.99 -> « 19.99 », 20 -> « 20 » : le meme texte que le module JS. */
    fun amountText(n: Double): String =
        if (Math.abs(n - Math.round(n)) < 0.005) Math.round(n).toString() else String.format(Locale.ROOT, "%.2f", n)

    /** Etat de la confrontation valeur annoncee / prix Steam : ok, inflated, very, unverifiable. */
    data class Compared(val state: String, val declared: Double? = null, val real: Double? = null)

    fun compareWorth(declared: Double?, check: PriceCheck?): Compared {
        if (declared == null || declared <= 0) return Compared("unverifiable")
        if (check == null || check.none || check.currency != COMPARE_CURRENCY || check.price == null || check.price <= 0) {
            return Compared("unverifiable", declared)
        }
        val real = check.price
        if (declared - real < INFLATED_MIN_GAP || declared / real < INFLATED_RATIO) return Compared("ok", declared, real)
        return Compared(if (declared / real >= VERY_INFLATED_RATIO) "very" else "inflated", declared, real)
    }

    private fun isKeepable(o: Offer): Boolean? = o.keepable ?: Money.parse(o.worth)?.let { it.value > 0 }

    private fun isStoreDlc(o: Offer): Boolean {
        val own = STORE_OWN[o.source] ?: return false
        return o.store == own && DLC_WORD.matches(o.category.orEmpty())
    }

    /** La note d'une offre. `rating` : percent/total de la note Steam ; `baseOwned` : true / false / null (inconnu). */
    fun grade(o: Offer, check: PriceCheck?, rating: Rating?, baseOwned: Boolean?): Verdict {
        val c = check?.takeUnless { it.none }

        if (isKeepable(o) == false || (c != null && c.isFree && c.type != "dlc")) {
            return Verdict("D", listOf(reason("bargainFreeForever", "bad")))
        }
        if ((c != null && c.type == "demo") || TRIAL.containsMatchIn(o.title)) {
            return Verdict("D", listOf(reason("bargainDemo", "bad")))
        }
        if (c != null && (c.type == "music" || c.type == "video" || c.type == "advertising")) {
            return Verdict("D", listOf(reason("bargainNotAGame", "bad")))
        }

        val reasons = ArrayList<Reason>()
        var score = 0
        var evidence = 0

        // Le jeu de base d'un DLC.
        val dlc = o.isExtra || c?.type == "dlc"
        val hasBase = c?.fullgame != null || o.parentAppid != null
        if (dlc && hasBase) {
            val name = c?.fullgameName.orEmpty()
            when (baseOwned) {
                false -> {
                    score -= 3; evidence++
                    reasons += if (name.isNotEmpty()) reason("bargainNeedsBase", "bad", name) else reason("bargainNeedsBaseBare", "bad")
                }
                true -> {
                    score += 1; evidence++
                    reasons += reason("bargainBaseOwned", "good")
                }
                null -> {
                    score -= 1; evidence++
                    reasons += reason("bargainNeedsBaseUnknown", "bad")
                }
            }
        } else if (dlc && !isStoreDlc(o)) {
            score -= 1; evidence++
            reasons += reason("bargainExtra", "bad")
        }

        // La valeur.
        val money = Money.parse(o.worth)
        val declared = money?.value
        val currency = money?.currency
        val source = worthSource(o)
        if (declared != null && declared > 0) {
            if (source == "store") {
                val shown = "${amountText(declared)} ${currency.orEmpty()}".trim()
                if (declared >= WORTH_THRESHOLD) {
                    score += 1; evidence++
                    reasons += reason("bargainValueConfirmed", "good", shown)
                } else {
                    reasons += reason("bargainValueSmall", "neutral", shown)
                }
            } else {
                val cmp = compareWorth(declared, c)
                val shownDeclared = "${amountText(declared)} ${currency ?: COMPARE_CURRENCY}".trim()
                when (cmp.state) {
                    "unverifiable" -> reasons += reason("bargainValueUnconfirmed", "neutral", shownDeclared)
                    "ok" -> {
                        val low = minOf(cmp.declared!!, cmp.real!!)
                        val shown = "${amountText(low)} $COMPARE_CURRENCY"
                        if (low >= WORTH_THRESHOLD) {
                            score += 1; evidence++
                            reasons += reason("bargainValueConfirmed", "good", shown)
                        } else {
                            reasons += reason("bargainValueSmall", "neutral", shown)
                        }
                    }
                    else -> {
                        evidence++
                        score -= if (cmp.state == "very") 3 else 2
                        reasons += reason("bargainInflated", "bad", shownDeclared, "${amountText(cmp.real!!)} $COMPARE_CURRENCY")
                    }
                }
            }
        }

        // Les evaluations Steam.
        val total = rating?.total ?: 0
        val pct = rating?.percent
        if (rating != null && total > 0 && pct != null) {
            if (total >= MIN_REVIEWS) {
                evidence++
                when {
                    pct >= 85 -> { score += 2; reasons += reason("bargainRatedHigh", "good", pct.toString(), total.toString()) }
                    pct >= 70 -> { score += 1; reasons += reason("bargainRatedGood", "good", pct.toString(), total.toString()) }
                    pct >= 50 -> { score -= 1; reasons += reason("bargainRatedMixed", "bad", pct.toString(), total.toString()) }
                    else -> { score -= 3; reasons += reason("bargainRatedLow", "bad", pct.toString(), total.toString()) }
                }
            } else {
                reasons += reason("bargainFewReviews", "neutral", total.toString())
            }
        }

        if (evidence == 0) {
            reasons += reason("bargainNoData", "neutral")
            return Verdict(null, reasons)
        }
        val grade = when {
            score >= 3 -> "A"
            score >= 1 -> "B"
            score >= -1 -> "C"
            else -> "D"
        }
        // Les mauvaises raisons d'abord (tri stable) : c'est ce qui sert a decider.
        return Verdict(grade, reasons.sortedBy { TONE_ORDER[it.tone] ?: 3 })
    }

    private val TONE_ORDER = mapOf("bad" to 0, "good" to 1, "neutral" to 2)

    // ------------------------------------------------------------------ la fiche

    /** L'appid Steam d'une offre : le sien, sinon celui que sa note a trouve. */
    fun appId(o: Offer, ratings: Map<String, Rating>): String? =
        (if (o.store == Stores.STEAM && o.storeId != null && Regex("^\\d+$").matches(o.storeId)) o.storeId else null)
            ?: ratings[Ratings.key(o)]?.appid?.takeIf { Regex("^\\d+$").matches(it) }

    fun checkKey(appid: String) = "app:$appid"

    fun needs(checks: Map<String, PriceCheck>, appid: String, now: Long): Boolean {
        val c = checks[checkKey(appid)] ?: return true
        return now - c.at >= (if (c.none) NONE_MS else FRESH_MS)
    }

    fun url(appid: String) = "https://store.steampowered.com/api/appdetails?appids=$appid&cc=US&l=english"

    /**
     * Ce qu'une reponse appdetails dit d'un titre. null : illisible, on retentera.
     * `PriceCheck(none = true)` : Steam repond, mais ne vend plus (ou ne connait pas) ce titre.
     */
    fun readCheck(body: String, appid: String, now: Long): PriceCheck? {
        val root = parseJson(body).obj ?: return null
        val e = root[appid]?.obj ?: root.values.mapNotNull { it.obj }.firstOrNull { it["data"]["steam_appid"].text == appid } ?: return null
        if (e["success"].bool != true) return PriceCheck(at = now, none = true)
        val d = e["data"] ?: return PriceCheck(at = now, none = true)
        val p = d["price_overview"]
        val full = d["fullgame"]["appid"].text?.takeIf { Regex("^\\d+$").matches(it) }
        return PriceCheck(
            at = now,
            type = d["type"].str.orEmpty().lowercase().take(24),
            isFree = d["is_free"].bool == true,
            price = p["initial"].num?.div(100),
            currency = p["currency"].str,
            fullgame = full,
            fullgameName = if (full != null) d["fullgame"]["name"].str?.take(120) else null,
        )
    }

    /** Lit les fiches qui manquent, `PER_RUN` au plus, une apres l'autre. Ne jette jamais. */
    suspend fun refresh(fetcher: Fetcher, appids: List<String>, checks: Map<String, PriceCheck>, now: Long): Map<String, PriceCheck> {
        val found = LinkedHashMap<String, PriceCheck>()
        var first = true
        for (id in appids.distinct().filter { needs(checks, it, now) }.take(PER_RUN)) {
            if (!first) kotlinx.coroutines.delay(1_200)
            first = false
            val r = try { fetcher.get(url(id)) } catch (_: Exception) { continue }
            if (!r.ok) continue
            val c = readCheck(r.body, id, now) ?: continue
            found[checkKey(id)] = c
        }
        return found
    }

    /** Garde les `MAX_ENTRIES` plus recentes. */
    fun trimmed(all: Map<String, PriceCheck>): Map<String, PriceCheck> =
        if (all.size <= MAX_ENTRIES) all else all.entries.sortedByDescending { it.value.at }.take(MAX_ENTRIES).associate { it.toPair() }

    // ---------------------------------------------------------------- l'assemblage

    /** Le jeu de base est-il a toi ? null tant que la collection Steam n'est pas connue. */
    fun baseOwned(check: PriceCheck?, o: Offer, s: AppState): Boolean? {
        val id = check?.takeUnless { it.none }?.fullgame ?: o.parentAppid ?: return null
        val known = s.owned.keys.any { it.startsWith("steam:") }
        if (!known) return null
        return s.owned.containsKey("steam:$id")
    }

    /** La note d'une offre depuis l'etat de l'appli. */
    fun verdictFor(o: Offer, s: AppState): Verdict {
        val appid = appId(o, s.ratings)
        val check = appid?.let { s.checks[checkKey(it)] }
        val rating = s.ratings[Ratings.key(o)]
        return grade(o, check, rating, baseOwned(check, o, s)).copy(appid = appid)
    }

    // ------------------------------------------------------------------ le total

    data class Certified(
        val verified: Map<String?, Double>,
        val unverified: Map<String?, Double>,
        val trimmed: Map<String?, Double>,
        val excluded: Int,
    )

    /** Le total « verifie » des jeux PRIS : voir `certify` du module JS. */
    fun certify(entries: Collection<LibraryEntry>, s: AppState): Certified {
        val verified = LinkedHashMap<String?, Double>()
        val unverified = LinkedHashMap<String?, Double>()
        val trimmed = LinkedHashMap<String?, Double>()
        var excluded = 0
        fun add(bag: MutableMap<String?, Double>, cur: String?, n: Double) { bag[cur] = (bag[cur] ?: 0.0) + n }
        for (e in entries) {
            val m = Money.parse(e.worth) ?: continue
            val appid = if (e.store == Stores.STEAM && Regex("^\\d+$").matches(e.id)) e.id
            else s.ratings["t:${Titles.normalise(e.title)}"]?.appid
            val c = appid?.let { s.checks[checkKey(it)] }?.takeUnless { it.none }
            if (c != null && c.isFree && c.type != "dlc") { excluded++; continue }
            if (e.wsrc == "store") { add(verified, m.currency, m.value); continue }
            val cmp = if (m.currency == null || m.currency == COMPARE_CURRENCY) compareWorth(m.value, c) else Compared("unverifiable")
            when (cmp.state) {
                "ok" -> add(verified, m.currency, m.value)
                "inflated", "very" -> { add(verified, m.currency, cmp.real!!); add(trimmed, m.currency, m.value - cmp.real) }
                else -> add(unverified, m.currency, m.value)
            }
        }
        fun round(bag: Map<String?, Double>) = bag.mapValues { Math.round(it.value * 100) / 100.0 }
        return Certified(round(verified), round(unverified), round(trimmed), excluded)
    }
}
