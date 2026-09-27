package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.TitleMatch
import io.github.diaslamka.freegames.model.TonightInfo
import io.github.diaslamka.freegames.model.TonightPick
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.URLEncoder

/**
 * « Ce soir je joue a... » (1.8.0) : le meme choix que watch/tonight.js.
 *
 * La pile : Ma collection de l'extension (sa sauvegarde l'apporte) et ce qui
 * a ete recupere, moins ce qu'on a dit commence, fini, abandonne ou « pas
 * pour moi ». Le format vient des etiquettes des joueurs Steam, la note et le
 * Steam Deck de la meme requete GetItems, sans cookie. Aucune duree
 * inventee : personne ne la publie sans cle (mesure du 2026-09-27).
 */
object Tonight {
    const val HOUR = "hour"
    const val EVENING = "evening"
    const val WEEKEND = "weekend"
    const val ANY = "any"
    val TIMES = listOf(HOUR, EVENING, WEEKEND, ANY)

    const val SHORT = "short"
    const val SESSIONS = "sessions"
    const val LONG = "long"

    const val TO_TRY = "toTry"
    const val PLAYING = "playing"
    const val NOT_FOR_ME = "notForMe"
    private val HORS_PILE = setOf(PLAYING, "done", "dropped", NOT_FOR_ME)

    /** Les etiquettes Steam qui disent le format (IStoreService/GetTagList, 2026-09-27). */
    const val TAG_SHORT = 4234
    val TAGS_SESSIONS = setOf(1716, 3959, 42804, 454187, 1091588, 1666, 32322, 1773, 5154, 699, 1743, 7178, 7108, 6621, 1665, 22955, 4885, 4255)
    val TAGS_LONG = setOf(1695, 122, 4434, 4474, 4364, 1670, 1100689, 1662, 128, 1754, 3810, 220585, 4328, 87918, 255534, 10235, 7332)
    private const val FORCE = 0.3
    const val MIN_REVIEWS = 50

    const val INFO_FRESH_MS = 60L * 24 * 3600 * 1000
    const val NONE_MS = 7L * 24 * 3600 * 1000
    const val PASS_EVERY_MS = 3600L * 1000
    const val LOT = 50
    const val LOTS_PER_RUN = 2
    const val SEARCHES_PER_RUN = 8
    const val PICK_KEEP_MS = 12L * 3600 * 1000
    const val TOP = 5

    private const val ITEMS_URL = "https://api.steampowered.com/IStoreBrowseService/GetItems/v1/"
    private val ORDRE = listOf("steam", "gog", "epic", "amazon")

    data class Copy(val id: String, val url: String?)

    /** Un jeu de la pile. `key` : la cle d'etat, la meme que Ma collection. */
    data class Candidate(
        val key: String,
        val title: String,
        val stores: Map<String, Copy>,
        val appid: String?,
        val ownedOnSteam: Boolean,
        val toTry: Boolean,
        val claimed: Boolean,
        val since: Long?,
        val deck: String?,
    )

    data class Reason(val key: String, val args: List<Any> = emptyList())

    data class Scored(val c: Candidate, val info: TonightInfo?, val score: Double, val reasons: List<Reason>)

    data class Pick(val pick: Scored?, val count: Int, val wrapped: Boolean)

    /* ---------------------------------------------------------- le format */

    fun formatFromTags(tags: List<Pair<Int, Double>>): String? {
        if (tags.isEmpty()) return null
        if (tags.any { it.first == TAG_SHORT }) return SHORT
        val max = tags.maxOf { it.second }
        val fortes = tags.filter { it.second >= max * FORCE }
        val s = fortes.filter { it.first in TAGS_SESSIONS }.maxOfOrNull { it.second } ?: 0.0
        val l = fortes.filter { it.first in TAGS_LONG }.maxOfOrNull { it.second } ?: 0.0
        if (s == 0.0 && l == 0.0) return null
        return if (s >= l) SESSIONS else LONG
    }

    private fun deckOf(v: JsonElement?): String? = when (v.text) {
        "3", "k_ESteamDeckCompatibilityCategory_Verified" -> "verified"
        "2", "k_ESteamDeckCompatibilityCategory_Playable" -> "playable"
        "1", "k_ESteamDeckCompatibilityCategory_Unsupported" -> "unsupported"
        else -> null
    }

    fun readItem(item: JsonElement?, now: Long): TonightInfo? {
        if (item["success"].num?.toInt() != 1) return null
        val tags = item["tags"].arr.orEmpty().mapNotNull { t ->
            val id = t["tagid"].num?.toInt() ?: return@mapNotNull null
            id to (t["weight"].num ?: 0.0)
        }
        val rev = item["reviews"]["summary_filtered"]
        val pct = rev["percent_positive"].num?.toInt()?.takeIf { it in 0..100 }
        return TonightInfo(
            at = now,
            name = item["name"].str?.take(160),
            format = formatFromTags(tags),
            deck = deckOf(item["platforms"]["steam_deck_compat_category"]),
            percent = pct,
            reviews = rev["review_count"].num?.toInt() ?: 0,
            image = SteamSource.image(item["assets"]),
        )
    }

    fun itemsUrl(appids: List<String>, country: String): String {
        val input = buildJsonObject {
            put("ids", buildJsonArray { appids.forEach { add(buildJsonObject { put("appid", it.toLong()) }) } })
            put("context", buildJsonObject {
                put("language", "english")
                put("country_code", if (Regex("^[A-Z]{2}$").matches(country)) country else "FR")
            })
            put("data_request", buildJsonObject {
                put("include_tag_count", 20); put("include_reviews", true); put("include_platforms", true); put("include_assets", true)
            })
        }
        return ITEMS_URL + "?input_json=" + URLEncoder.encode(input.toString(), "UTF-8")
    }

    /* ------------------------------------------------------------ la pile */

    private class Row(val title: String) {
        val stores = linkedMapOf<String, Copy>()
        var claimed = false
        var since: Long? = null
        var deck: String? = null
    }

    fun buildPile(s: AppState): List<Candidate> {
        val rows = linkedMapOf<String, Row>()
        fun add(store: String, id: String, title: String?, url: String?, claimed: Boolean, ts: Long?, deck: String?) {
            val t = title?.trim().orEmpty()
            val n = Titles.normalise(t)
            if (n.isEmpty()) return
            val r = rows.getOrPut(n) { Row(t) }
            if (store !in r.stores) r.stores[store] = Copy(id, url)
            else if (r.stores[store]?.url == null && url != null) r.stores[store] = Copy(r.stores[store]!!.id, url)
            if (claimed) r.claimed = true
            if (ts != null) r.since = minOf(r.since ?: ts, ts)
            if (deck != null) r.deck = deck
        }
        for (g in s.owned.values) add(g.store, g.id, g.title, null, false, null, g.deck)
        for (e in s.library.values) if (e.status == "claimed" || e.status == "redeemed") add(e.store, e.id, e.title, e.url, true, e.ts, null)

        return rows.values.mapNotNull { r ->
            val first = ORDRE.firstOrNull { it in r.stores } ?: r.stores.keys.first()
            val key = "$first:${r.stores[first]!!.id}"
            val etat = s.marks[key]?.status
            if (etat in HORS_PILE) return@mapNotNull null
            val steam = r.stores["steam"]?.id?.takeIf { Regex("^\\d+$").matches(it) }
            Candidate(
                key = key, title = r.title, stores = r.stores.toMap(),
                appid = steam ?: s.tonightTitles[Titles.normalise(r.title)]?.appid,
                ownedOnSteam = steam != null, toTry = etat == TO_TRY, claimed = r.claimed, since = r.since, deck = r.deck,
            )
        }
    }

    /* ----------------------------------------------------------- le choix */

    private val PAR_TEMPS: Map<String, Map<String, Int?>> = mapOf(
        HOUR to mapOf(SESSIONS to 3, SHORT to 1, LONG to null),
        EVENING to mapOf(SHORT to 4, SESSIONS to 2, LONG to -2),
        WEEKEND to mapOf(LONG to 2, SHORT to 1, SESSIONS to 0),
        ANY to emptyMap(),
    )
    private val RAISON = mapOf(SHORT to "tonight_short", SESSIONS to "tonight_sessions", LONG to "tonight_long")

    private fun deckAtLeastPlayable(d: String?) = d == "verified" || d == "playable"

    fun score(c: Candidate, info: TonightInfo?, time: String, deckOnly: Boolean): Scored? {
        val deck = info?.deck ?: c.deck
        if (deckOnly && !deckAtLeastPlayable(deck)) return null
        val format = info?.format
        val table = PAR_TEMPS[time] ?: PAR_TEMPS.getValue(ANY)
        if (format != null && table.containsKey(format) && table[format] == null) return null
        var score = 0.0
        val reasons = mutableListOf<Reason>()
        if (c.toTry) { score += 3; reasons += Reason("tonight_to_try") }
        if (format != null) {
            score += table[format] ?: 0
            reasons += Reason(RAISON.getValue(format))
        }
        val pct = info?.percent
        if (pct != null && info.reviews >= MIN_REVIEWS) {
            score += (pct - 70) / 6.0
            reasons += Reason("tonight_rating", listOf(pct))
        }
        if (deckOnly) {
            if (deck == "verified") score += 1
            reasons += Reason(if (deck == "verified") "tonight_deck_verified" else "tonight_deck_playable")
        }
        if (c.claimed && c.since != null) reasons += Reason("tonight_claimed", listOf(c.since))
        return Scored(c, info, score, reasons)
    }

    /** Parmi les cinq meilleurs pas encore montres, les meilleurs plus souvent. */
    fun pick(pile: List<Candidate>, apps: Map<String, TonightInfo>, time: String, deckOnly: Boolean, exclude: Collection<String> = emptyList(), random: () -> Double = Math::random): Pick {
        val notes = pile.mapNotNull { c ->
            val info = c.appid?.let { apps[it] }?.takeUnless { it.none }
            score(c, info, time, deckOnly)
        }.sortedWith(compareByDescending<Scored> { it.score }.thenBy { it.c.title })
        if (notes.isEmpty()) return Pick(null, 0, false)
        val vus = exclude.toSet()
        var pool = notes.filter { it.c.key !in vus }
        val wrapped = pool.isEmpty()
        if (wrapped) pool = notes
        val top = pool.take(TOP)
        val poids = top.indices.map { top.size - it }
        var r = random().coerceIn(0.0, 0.999999) * poids.sum()
        var i = 0
        while (i < top.size - 1 && r >= poids[i]) { r -= poids[i]; i++ }
        return Pick(top[i], notes.size, wrapped)
    }

    /** La fiche du jeu : celle de Steam s'il y est, sinon celle de son magasin. */
    fun page(c: Candidate): String? {
        c.stores["steam"]?.id?.takeIf { Regex("^\\d+$").matches(it) }?.let { return "https://store.steampowered.com/app/$it/" }
        for (store in ORDRE) c.stores[store]?.url?.takeIf { it.startsWith("https://") }?.let { return it }
        return c.appid?.let { "https://store.steampowered.com/app/$it/" }
    }

    /** Le choix garde : moins de douze heures, et encore dans la pile. */
    fun kept(p: TonightPick, pile: List<Candidate>, now: Long): Candidate? {
        if (p.key == null || now - p.at >= PICK_KEEP_MS) return null
        return pile.firstOrNull { it.key == p.key }
    }

    /** Le jeu retenu (« J'y joue »), tant que la soiree dure. */
    fun playing(p: TonightPick, now: Long): Boolean = p.playing != null && now - p.playingAt < PICK_KEEP_MS

    /**
     * Le jeu du soir tel qu'il faut le montrer : le choix garde, sinon un
     * nouveau tirage -- rendu avec l'etat suivant a enregistrer.
     */
    fun current(s: AppState, now: Long, random: () -> Double = Math::random): Pair<Scored?, TonightPick> {
        val p = s.tonight
        val pile = buildPile(s)
        kept(p, pile, now)?.let { c ->
            val info = c.appid?.let { s.tonightApps[it] }?.takeUnless { it.none }
            score(c, info, p.time, p.deckOnly)?.let { return it to p }
        }
        val r = pick(pile, s.tonightApps, p.time, p.deckOnly, p.shown, random)
        return r.pick to p.copy(key = r.pick?.c?.key, at = now)
    }

    /** « Un autre » : le choix actuel rejoint ceux deja montres. */
    fun reroll(s: AppState, now: Long, random: () -> Double = Math::random): AppState {
        val p = s.tonight
        val exclude = (p.shown + listOfNotNull(p.key)).distinct()
        val r = pick(buildPile(s), s.tonightApps, p.time, p.deckOnly, exclude, random)
        return s.copy(tonight = p.copy(
            key = r.pick?.c?.key, at = now, shown = if (r.wrapped) emptyList() else exclude.takeLast(200),
            // « Choisir un autre jeu » apres « J'y joue » : la soiree repart.
            playing = null, playingTitle = null, playingPage = null, playingAt = 0,
        ))
    }

    /** Pose l'etat d'un jeu, comme Ma collection. */
    fun mark(s: AppState, key: String, status: String): AppState =
        s.copy(marks = s.marks + (key to (s.marks[key]?.copy(status = status) ?: io.github.diaslamka.freegames.model.Mark(status))))

    /* ------------------------------------------------ la lecture Steam */

    private fun aRelire(at: Long?, none: Boolean, now: Long) = at == null || now - at >= (if (none) NONE_MS else INFO_FRESH_MS)

    fun due(s: AppState, now: Long): Boolean = s.settings.tonight && (s.tonightAt == null || now - s.tonightAt >= PASS_EVERY_MS)

    /**
     * Un passage : huit titres hors Steam cherches (titre EXACT), puis deux
     * lots de cinquante fiches GetItems. Sans cookie. Ne jette jamais.
     */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String): Pair<Map<String, TonightInfo>, Map<String, TitleMatch>> {
        val titles = s.tonightTitles.toMutableMap()
        val apps = s.tonightApps.toMutableMap()
        val pile = buildPile(s)
        for (c in pile.filter { !it.ownedOnSteam }.filter { t -> titles[Titles.normalise(t.title)].let { aRelire(it?.at, it?.appid == null, now) } }.take(SEARCHES_PER_RUN)) {
            val r = runCatching { fetcher.get(Ratings.searchUrl(c.title, country)) }.getOrNull() ?: continue
            if (!r.ok) continue
            titles[Titles.normalise(c.title)] = TitleMatch(now, Ratings.matchSearch(r.body, c.title))
        }
        val ids = pile.mapNotNull { it.appid ?: titles[Titles.normalise(it.title)]?.appid }.distinct()
            .filter { id -> apps[id].let { aRelire(it?.at, it?.none == true, now) } }
        for (lot in ids.take(LOT * LOTS_PER_RUN).chunked(LOT)) {
            val r = runCatching { fetcher.get(itemsUrl(lot, country)) }.getOrNull() ?: continue
            if (!r.ok) continue
            val items = parseJson(r.body)["response"]["store_items"].arr ?: continue
            val lus = items.associateBy { (it["appid"] ?: it["id"]).text }
            for (id in lot) apps[id] = readItem(lus[id], now) ?: TonightInfo(at = now, none = true)
        }
        return apps to titles
    }
}
