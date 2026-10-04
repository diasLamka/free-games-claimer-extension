package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.TagW
import io.github.diaslamka.freegames.model.TasteGame
import io.github.diaslamka.freegames.model.TasteProfile
import io.github.diaslamka.freegames.model.TasteState
import io.github.diaslamka.freegames.sources.Fetcher
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
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * « Tes gouts » (1.14.0) : le meme calcul que watch/taste.js, pour que
 * l'extension et le telephone disent la meme chose des memes jeux.
 *
 * Un jeu est un vecteur d'etiquettes des joueurs Steam (dix, poids ramenes a
 * la plus forte ; les plus larges -- « Jeu solo », « Independant »... --
 * comptent 0,4 fois). Le profil est la somme de tes jeux, chacun pese par
 * l'affection qu'on lui prete (fini 1, commence 0,8, abandonne -0,6, pas pour
 * moi -1). La ressemblance d'une offre est le cosinus des deux.
 *
 * Le telephone n'a pas le temps de jeu : il tire un profil de tes etats, ou
 * prend celui de l'extension, qui sait combien tu as joue (sa sauvegarde le
 * porte). Sous trois jeux aimes, pas de profil.
 *
 * Seuls des numeros de jeux partent vers Steam, sans cookie.
 */
object Taste {
    /** Les etiquettes posees sur presque tout : elles comptent, mais peu. */
    val GENERIC = setOf(4182, 492, 1756, 4166, 597, 493, 113, 19, 21, 3859, 7481)
    const val GENERIC_FORCE = 0.4
    const val TOP_TAGS = 10
    const val MIN_LIKED = 3
    /** A partir de la, une offre est « pour toi » (calibre sur de vrais jeux, avec l'extension). */
    const val FOR_YOU = 0.45
    const val KEEP_POSITIVE = 30
    const val KEEP_NEGATIVE = 10

    const val PASS_EVERY_MS = 6L * 3600 * 1000
    /** Une offre arrivee depuis le dernier passage n'attend pas six heures. */
    const val MISSING_EVERY_MS = 10L * 60 * 1000
    const val GAME_FRESH_MS = 60L * 24 * 3600 * 1000
    const val NONE_MS = 7L * 24 * 3600 * 1000
    const val NAMES_FRESH_MS = 60L * 24 * 3600 * 1000
    const val MAX_GAMES = 300
    const val LOT = 50
    const val LOTS_PER_RUN = 2

    private val AFFECTION = mapOf("done" to 1.0, "playing" to 0.8, "dropped" to -0.6, "notForMe" to -1.0)

    data class Signal(val appid: String, val s: Double)

    /** La ressemblance (de -1 a 1) et les etiquettes qui la portent, les plus fortes d'abord. */
    data class Match(val score: Double, val top: List<Int>)

    /* --------------------------------------------------------------- les jeux */

    /** Les `top` etiquettes les plus fortes, ramenees a 100 ; vide s'il n'y en a aucune. */
    fun compact(tags: List<Pair<Int, Double>>, top: Int = TOP_TAGS): List<TagW> {
        val list = tags.filter { it.first > 0 && it.second > 0 }
            .sortedWith(compareByDescending<Pair<Int, Double>> { it.second }.thenBy { it.first })
            .take(top)
        if (list.isEmpty()) return emptyList()
        val max = list.first().second
        return list.map { TagW(it.first, maxOf(1, (it.second / max * 100).roundToInt())) }
    }

    /** { etiquette: valeur 0..1 }, les larges attenuees. */
    fun vector(tags: List<TagW>): Map<Int, Double> = tags.filter { it.w > 0 }.associate { it.i to it.w / 100.0 * (if (it.i in GENERIC) GENERIC_FORCE else 1.0) }

    private fun norm(v: Collection<Double>) = sqrt(v.sumOf { it * it })

    /* ------------------------------------------------------------- le profil */

    /** Ce que tes etats disent de l'affection : `[(appid, s)]`. Le hors-Steam n'a pas d'appid, il ne dit rien. */
    fun signals(s: AppState): List<Signal> = s.marks.mapNotNull { (key, m) ->
        val store = key.substringBefore(':')
        val id = key.substringAfter(':')
        val v = AFFECTION[m.status] ?: return@mapNotNull null
        if (store != Stores.STEAM || !Regex("^\\d+$").matches(id)) null else Signal(id, v)
    }

    /** Le profil, ou null sous `MIN_LIKED` jeux aimes dont on connait les etiquettes. */
    fun buildProfile(signals: List<Signal>, games: Map<String, TasteGame>): TasteProfile? {
        val sum = mutableMapOf<Int, Double>()
        var liked = 0
        var disliked = 0
        var total = 0.0
        for (sg in signals) {
            val g = games[sg.appid]?.takeUnless { it.none || it.tags.isEmpty() } ?: continue
            if (sg.s == 0.0) continue
            if (sg.s > 0) liked++ else disliked++
            total += abs(sg.s)
            for ((id, v) in vector(g.tags)) sum[id] = (sum[id] ?: 0.0) + sg.s * v
        }
        if (liked < MIN_LIKED || total == 0.0) return null
        val entries = sum.map { it.key to it.value / total }.filter { abs(it.second) >= 0.03 }
        val pos = entries.filter { it.second > 0 }.sortedByDescending { it.second }.take(KEEP_POSITIVE)
        val neg = entries.filter { it.second < 0 }.sortedBy { it.second }.take(KEEP_NEGATIVE)
        val tags = (pos + neg).associate { it.first.toString() to Math.round(it.second * 1000) / 1000.0 }
        return if (tags.isEmpty()) null else TasteProfile(tags, liked, disliked)
    }

    /** La ressemblance d'un jeu avec le profil : le cosinus, et les etiquettes precises qui la portent. */
    fun score(profile: TasteProfile?, tags: List<TagW>): Match? {
        if (profile == null || tags.isEmpty()) return null
        val v = vector(tags)
        val p = profile.tags.mapKeys { it.key.toIntOrNull() ?: -1 }
        val nv = norm(v.values)
        val np = norm(p.values)
        if (nv == 0.0 || np == 0.0) return null
        var dot = 0.0
        val porteuses = mutableListOf<Pair<Int, Double>>()
        for ((id, x) in v) {
            val c = (p[id] ?: 0.0) * x
            dot += c
            if (c > 0) porteuses += id to c
        }
        porteuses.sortByDescending { it.second }
        // « Jeu solo » ne dit rien : on le cite seulement quand rien d'autre ne porte.
        val precises = porteuses.filter { it.first !in GENERIC }
        val dites = precises.ifEmpty { porteuses }
        return Match(Math.round(dot / (nv * np) * 1000) / 1000.0, dites.take(3).map { it.first })
    }

    /** Le profil qui compte : celui de l'extension s'il est la, sinon celui que le telephone a tire seul. Rien quand c'est coupe. */
    fun effective(s: AppState): TasteProfile? = if (!s.settings.taste) null else s.taste.imported ?: s.taste.profile

    /** Les etiquettes d'un jeu : le cache de « Tes gouts », sinon la fiche de « Ce soir ». */
    fun tagsOf(s: AppState, appid: String?): List<TagW> {
        if (appid == null) return emptyList()
        s.taste.games[appid]?.takeUnless { it.none }?.tags?.takeIf { it.isNotEmpty() }?.let { return it }
        return s.tonightApps[appid]?.takeUnless { it.none }?.tags.orEmpty()
    }

    /** Le jeu (son appid) est-il pour toi ? La ressemblance et ses etiquettes, ou null. */
    fun matchFor(s: AppState, appid: String?): Match? = score(effective(s), tagsOf(s, appid))?.takeIf { it.score >= FOR_YOU }

    /** Les noms des etiquettes, dans la langue de l'etat ; celles qui n'en ont pas se taisent. */
    fun names(s: AppState, ids: List<Int>): List<String> = ids.mapNotNull { s.taste.names[it.toString()] }

    /** L'appid Steam d'une offre : le sien, ou celui que la note Steam a trouve. */
    fun appidOf(o: Offer, s: AppState): String? {
        if (o.store == Stores.STEAM && o.storeId != null && Regex("^\\d+$").matches(o.storeId)) return o.storeId
        return s.ratings[Ratings.key(o)]?.appid?.takeIf { Regex("^\\d+$").matches(it) }
    }

    /** Les offres en cours dont on sait l'appid. */
    fun wanted(s: AppState, now: Long): List<String> = s.offers.values.filter { it.isOpen(now) }.mapNotNull { appidOf(it, s) }.distinct()

    /* -------------------------------------------------------------- le reseau */

    private fun aRelire(g: TasteGame?, now: Long) = g == null || now - g.at >= (if (g.none) NONE_MS else GAME_FRESH_MS)

    fun itemsUrl(appids: List<String>, country: String): String {
        val input = buildJsonObject {
            put("ids", buildJsonArray { appids.forEach { add(buildJsonObject { put("appid", it.toLong()) }) } })
            put("context", buildJsonObject {
                put("language", "english")
                put("country_code", if (Regex("^[A-Z]{2}$").matches(country)) country else "FR")
            })
            put("data_request", buildJsonObject { put("include_tag_count", 20) })
        }
        return Tonight.ITEMS_URL + "?input_json=" + URLEncoder.encode(input.toString(), "UTF-8")
    }

    fun tagListUrl(lang: String) = "https://api.steampowered.com/IStoreService/GetTagList/v1/?language=" + URLEncoder.encode(lang, "UTF-8")

    /** Les etiquettes d'un lot de jeux, ou null si Steam ne repond pas. */
    suspend fun fetchGames(fetcher: Fetcher, appids: List<String>, now: Long, country: String): Map<String, TasteGame>? {
        val ids = appids.filter { Regex("^\\d+$").matches(it) }.distinct().take(LOT)
        if (ids.isEmpty()) return emptyMap()
        val r = runCatchingSuspend { fetcher.get(itemsUrl(ids, country)) }.getOrNull()?.takeIf { it.ok } ?: return null
        val items = parseJson(r.body)["response"]["store_items"].arr ?: return null
        val lus = items.associateBy { (it["appid"] ?: it["id"]).text }
        return ids.associateWith { id ->
            val item: JsonElement? = lus[id]
            val tags = if (item["success"].num?.toInt() == 1) compact(item["tags"].arr.orEmpty().mapNotNull { t ->
                val i = t["tagid"].num?.toInt() ?: return@mapNotNull null
                i to (t["weight"].num ?: 0.0)
            }) else emptyList()
            if (tags.isEmpty()) TasteGame(at = now, none = true) else TasteGame(at = now, tags = tags)
        }
    }

    /**
     * Y a-t-il de quoi faire ? Le reglage ouvert ; un profil possible (celui
     * de l'extension, ou trois jeux aimes) ; et six heures ecoulees -- ou dix
     * minutes quand une offre en cours n'a pas encore ses etiquettes.
     */
    fun due(s: AppState, now: Long): Boolean {
        if (!s.settings.taste) return false
        if (s.taste.imported == null && signals(s).count { it.s > 0 } < MIN_LIKED && s.taste.profile == null) return false
        val at = s.taste.at ?: return true
        if (now - at >= PASS_EVERY_MS) return true
        return now - at >= MISSING_EVERY_MS && wanted(s, now).any { aRelire(s.taste.games[it], now) }
    }

    /**
     * Un passage : les etiquettes des jeux qui manquent (ceux qui font le
     * profil quand l'extension n'en donne pas, puis les offres ; deux lots de
     * cinquante au plus), le profil, et -- au plus tous les deux mois -- le nom
     * des etiquettes qu'il retient. Sans cookie. Ne jette jamais.
     */
    suspend fun refresh(fetcher: Fetcher, s: AppState, now: Long, country: String, lang: String = Tonight.steamLanguage()): TasteState {
        val st = s.taste
        val games = st.games.toMutableMap()
        val signals = if (st.imported != null) emptyList() else signals(s)
        val ids = (signals.map { it.appid } + wanted(s, now)).distinct().filter { aRelire(games[it], now) }
        for (lot in ids.take(LOT * LOTS_PER_RUN).chunked(LOT)) fetchGames(fetcher, lot, now, country)?.let { games.putAll(it) }

        // Le cache reste petit : les plus anciens sortent, sauf ceux qui font le profil.
        if (games.size > MAX_GAMES) {
            val gardes = signals.map { it.appid }.toSet()
            val sortants = games.keys.filter { it !in gardes }.sortedBy { games.getValue(it).at }.take(games.size - MAX_GAMES)
            sortants.forEach { games.remove(it) }
        }

        val profile = if (st.imported != null) null else buildProfile(signals, games)
        var names = st.names
        var namesAt = st.namesAt
        var namesLang = st.namesLang
        val retenues = (st.imported ?: profile)?.tags?.keys.orEmpty()
        val manque = retenues.any { it !in names }
        if (retenues.isNotEmpty() && (manque || namesLang != lang || namesAt == null || now - namesAt >= NAMES_FRESH_MS)) {
            val r = runCatchingSuspend { fetcher.get(tagListUrl(lang)) }.getOrNull()?.takeIf { it.ok }
            val list = r?.let { parseJson(it.body)["response"]["tags"].arr }
            if (list != null) {
                names = list.mapNotNull { t ->
                    val id = t["tagid"].num?.toInt()?.toString() ?: return@mapNotNull null
                    if (id in retenues) t["name"].str?.take(60)?.let { id to it } else null
                }.toMap()
                namesAt = now
                namesLang = lang
            }
        }
        return st.copy(at = now, profile = profile, games = games, names = names, namesAt = namesAt, namesLang = namesLang)
    }
}
