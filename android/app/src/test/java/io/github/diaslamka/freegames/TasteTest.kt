package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.Taste
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Mark
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.TagW
import io.github.diaslamka.freegames.model.TasteGame
import io.github.diaslamka.freegames.model.TasteProfile
import io.github.diaslamka.freegames.model.TasteState
import io.github.diaslamka.freegames.model.TonightInfo
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import io.github.diaslamka.freegames.sources.text
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.URLDecoder

/**
 * « Tes gouts » (1.14.0) : les memes jeux, le meme calcul que test/taste.test.mjs.
 * Les scores de parite viennent de l'extension, sur les memes fiches Steam
 * (mesurees le 2026-09-28) : si un cote change, l'autre le dit.
 */
class TasteTest {
    private val now = 1_790_540_000_000L
    private val items = parseJson(File(System.getProperty("fixtures"), "steam-getitems-taste.json").readText())["response"]["store_items"].arr!!
    private val noms = parseJson(File(System.getProperty("fixtures"), "steam-taglist-fr.json").readText())["response"]["tags"].arr!!
        .associate { it["tagid"].num!!.toInt().toString() to it["name"].str!! }

    private fun tagsOf(item: kotlinx.serialization.json.JsonElement) = Taste.compact(item["tags"].arr!!.map { it["tagid"].num!!.toInt() to it["weight"].num!! })
    private val jeux = items.associate { it["appid"].text!! to TasteGame(now, tags = tagsOf(it)) }
    private fun id(nom: String) = items.first { it["name"].str!!.startsWith(nom) }["appid"].text!!

    private val aimes = listOf("Hades", "Celeste", "Hollow Knight", "Slay the Spire").map { Taste.Signal(id(it), 1.0) }
    private fun score(p: TasteProfile?, nom: String) = Taste.score(p, jeux.getValue(id(nom)).tags)

    @Test
    fun compactKeepsTheTenStrongestScaledToOneHundred() {
        val c = tagsOf(items.first { it["name"].str == "Hades" })
        assertEquals(Taste.TOP_TAGS, c.size)
        assertEquals(100, c.first().w)
        assertEquals(c.map { it.w }.sortedDescending(), c.map { it.w })
        assertTrue(Taste.compact(emptyList()).isEmpty())
        assertTrue(Taste.compact(listOf(5 to 0.0, -1 to 3.0)).isEmpty())
    }

    @Test
    fun broadTagsWeighLess() {
        val v = Taste.vector(listOf(TagW(4182, 100), TagW(1234, 100)))
        assertEquals(1.0, v.getValue(1234), 0.0)
        assertEquals(Taste.GENERIC_FORCE, v.getValue(4182), 0.0)
    }

    @Test
    fun signalsComeFromYourStatesOnSteamGamesOnly() {
        val s = AppState(marks = mapOf(
            "steam:600" to Mark("done"), "steam:700" to Mark("notForMe"), "steam:800" to Mark("dropped"), "steam:900" to Mark("playing"),
            "steam:1000" to Mark("toTry"), "gog:9" to Mark("done"), "steam:abc" to Mark("done"),
        ))
        val sg = Taste.signals(s).associate { it.appid to it.s }
        assertEquals(mapOf("600" to 1.0, "700" to -1.0, "800" to -0.6, "900" to 0.8), sg)
    }

    @Test
    fun aProfileNeedsThreeLikedGamesWhoseTagsAreKnown() {
        assertNull(Taste.buildProfile(aimes.take(Taste.MIN_LIKED - 1), jeux))
        assertNull(Taste.buildProfile(aimes, emptyMap()))
        assertNull(Taste.buildProfile(aimes.take(2) + Taste.Signal("999", 1.0), jeux))
        val p = Taste.buildProfile(aimes, jeux)!!
        assertEquals(4, p.liked)
        assertTrue(p.tags.size > 10)
        assertTrue(p.tags.values.all { it in -1.0..1.0 })
        assertTrue("Roguelike" in p.tags.entries.sortedByDescending { it.value }.take(8).map { noms[it.key] })
    }

    @Test
    fun scoresAgreeWithTheExtension() {
        val p = Taste.buildProfile(aimes, jeux)!!
        // Valeurs de watch/taste.js sur les memes fiches.
        assertEquals(28, p.tags.size)
        assertEquals(0.584, score(p, "Dead Cells")!!.score, 0.001)
        assertEquals(0.513, score(p, "The Binding of Isaac")!!.score, 0.001)
        assertEquals(0.435, score(p, "Vampire Survivors")!!.score, 0.001)
        assertEquals(0.016, score(p, "Planet Zoo")!!.score, 0.001)
        assertEquals(0.099, score(p, "Stardew Valley")!!.score, 0.001)
        assertEquals(listOf(1716, 3871, 3959), score(p, "Dead Cells")!!.top)
        assertTrue(score(p, "Dead Cells")!!.score >= Taste.FOR_YOU)
        assertFalse(score(p, "Planet Zoo")!!.score >= Taste.FOR_YOU)
        assertNull(Taste.score(null, jeux.getValue(id("Hades")).tags))
        assertNull(Taste.score(p, emptyList()))
    }

    @Test
    fun aDislikedGameDragsTheProfileDown() {
        val sans = Taste.buildProfile(aimes, jeux)
        val avec = Taste.buildProfile(aimes + Taste.Signal(id("Planet Zoo"), -1.0) + Taste.Signal(id("Euro Truck"), -1.0), jeux)!!
        assertEquals(2, avec.disliked)
        assertTrue(score(avec, "Planet Zoo")!!.score < score(sans, "Planet Zoo")!!.score)
        assertTrue(avec.tags.values.any { it < 0 })
    }

    private fun etat(imported: TasteProfile? = null, profile: TasteProfile? = null, taste: Boolean = true) = AppState(
        settings = Settings(taste = taste),
        taste = TasteState(at = now, profile = profile, imported = imported, games = jeux, names = noms),
    )

    @Test
    fun theExtensionsProfileWinsAndTheSwitchTurnsItOff() {
        val p = Taste.buildProfile(aimes, jeux)!!
        val local = TasteProfile(mapOf("1" to 1.0), liked = 3)
        assertEquals(p, Taste.effective(etat(imported = p, profile = local)))
        assertEquals(local, Taste.effective(etat(profile = local)))
        assertNull(Taste.effective(etat(imported = p, taste = false)))
        val s = etat(imported = p)
        assertNotNull(Taste.matchFor(s, id("Dead Cells")))
        assertNull(Taste.matchFor(s, id("Planet Zoo")))
        assertNull(Taste.matchFor(s, "424242"))
        assertNull(Taste.matchFor(s, null))
        assertNull(Taste.matchFor(etat(imported = p, taste = false), id("Dead Cells")))
        assertTrue("Roguelike" in Taste.names(s, Taste.matchFor(s, id("Dead Cells"))!!.top))
        assertTrue(Taste.names(s, listOf(999999)).isEmpty())
    }

    @Test
    fun anOfferFindsItsAppIdOnSteamOrThroughItsRating() {
        val steam = Offer(key = "steam:1", source = "steam", store = Stores.STEAM, storeId = "588650", title = "Dead Cells")
        val epic = Offer(key = "epic:zoo", source = "epic", store = Stores.EPIC, storeId = "zoo", title = "Planet Zoo")
        val s = AppState(ratings = mapOf("t:${epic.normalisedTitle}" to Rating(now, percent = 88, appid = "703080")))
        assertEquals("588650", Taste.appidOf(steam, s))
        assertEquals("703080", Taste.appidOf(epic, s))
        assertNull(Taste.appidOf(epic, AppState()))
    }

    @Test
    fun tonightUsesTheTagsOfItsOwnSheetAndScoresTheBonus() {
        val p = Taste.buildProfile(aimes, jeux)!!
        val c = Tonight.Candidate("steam:588650", "Dead Cells", mapOf("steam" to Tonight.Copy("588650", null)), "588650", true, false, false, null, null)
        val info = TonightInfo(at = now, v = Tonight.INFO_VERSION, tags = jeux.getValue(id("Dead Cells")).tags)
        val sans = Tonight.score(c, info, Tonight.ANY, false)!!
        val avec = Tonight.score(c, info, Tonight.ANY, false, taste = Tonight.TasteView(p, noms))!!
        assertEquals(1.5, avec.score - sans.score, 1e-9)
        assertTrue(avec.reasons.first { it.key == "tonight_taste" }.args.first().toString().contains("Roguelike"))
        assertTrue(Tonight.score(c, info, Tonight.ANY, false, taste = Tonight.TasteView(p, emptyMap()))!!.reasons.any { it.key == "tonight_taste_bare" })
        val zoo = info.copy(tags = jeux.getValue(id("Planet Zoo")).tags)
        assertEquals(Tonight.score(c, zoo, Tonight.ANY, false)!!.score, Tonight.score(c, zoo, Tonight.ANY, false, taste = Tonight.TasteView(p, noms))!!.score, 0.0)
        assertEquals(4, Tonight.INFO_VERSION)
        // Une fiche lue par « Ce soir » sert aussi a « Tes gouts », sans requete de plus.
        val s = etat(imported = p).copy(taste = etat(imported = p).taste.copy(games = emptyMap()), tonightApps = mapOf("588650" to info))
        assertNotNull(Taste.matchFor(s, "588650"))
    }

    /** Un faux Steam : rend les fiches du fixture et la liste des etiquettes, et note ce qu'on lui demande. */
    private class FauxSteam(private val items: List<kotlinx.serialization.json.JsonElement>, private val noms: Map<String, String>, private val panne: Boolean = false) : Fetcher {
        val appels = mutableListOf<Pair<String, Boolean>>()
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
            appels += url to withCookies
            if (panne) return HttpResult(500, "")
            if ("GetTagList" in url) {
                val tags = noms.entries.joinToString(",") { """{"tagid":${it.key},"name":"${it.value}"}""" }
                return HttpResult(200, """{"response":{"tags":[$tags]}}""")
            }
            val input = parseJson(URLDecoder.decode(url.substringAfter("input_json="), "UTF-8"))
            val ids = input["ids"].arr!!.map { it["appid"].text!! }
            val lus = ids.joinToString(",") { id -> items.firstOrNull { it["appid"].text == id }?.toString() ?: """{"appid":$id,"success":15}""" }
            return HttpResult(200, """{"response":{"store_items":[$lus]}}""")
        }
    }

    @Test
    fun aPassReadsMissingTagsBuildsTheProfileAndNamesTheTagsWithoutCookies() = runBlocking {
        val steam = FauxSteam(items, noms)
        val marks = aimes.associate { "steam:${it.appid}" to Mark("done") }
        val epic = Offer(key = "epic:dc", source = "epic", store = Stores.EPIC, storeId = "dc", title = "Dead Cells", start = now - 3_600_000, end = now + 86_400_000)
        val s = AppState(
            marks = marks, offers = mapOf(epic.key to epic),
            ratings = mapOf("t:${epic.normalisedTitle}" to Rating(now, percent = 96, appid = id("Dead Cells"))),
        )
        assertTrue(Taste.due(s, now))
        val next = Taste.refresh(steam, s, now, "FR", "french")
        assertTrue(steam.appels.none { it.second })
        assertEquals(4, next.profile!!.liked)
        assertNotNull(next.games[id("Dead Cells")]!!.tags.firstOrNull())
        assertEquals("french", next.namesLang)
        assertTrue("Roguelike" in next.names.values)
        assertTrue(next.names.size <= next.profile!!.tags.size)
        val apres = s.copy(taste = next)
        assertNotNull(Taste.matchFor(apres, id("Dead Cells")))
        // Rien de plus a lire : un second passage ne demande rien.
        steam.appels.clear()
        assertFalse(Taste.due(apres, now + 3_600_000L))
        Taste.refresh(steam, apres, now + Taste.PASS_EVERY_MS, "FR", "french")
        assertTrue(steam.appels.isEmpty())
    }

    @Test
    fun withTheExtensionsProfileThePhoneOnlyReadsTheOffers() = runBlocking {
        val steam = FauxSteam(items, noms)
        val p = Taste.buildProfile(aimes, jeux)!!
        val offer = Offer(key = "steam:1", source = "steam", store = Stores.STEAM, storeId = id("Dead Cells"), title = "Dead Cells", start = now - 1000, end = now + 86_400_000)
        val s = AppState(offers = mapOf(offer.key to offer), taste = TasteState(imported = p))
        val next = Taste.refresh(steam, s, now, "FR", "french")
        // Un seul lot, pour l'offre : les jeux du profil n'ont pas a etre relus.
        assertEquals(1, steam.appels.count { "GetItems" in it.first })
        assertNull("le profil de l'extension n'est pas recalcule", next.profile)
        assertNotNull(Taste.matchFor(s.copy(taste = next), id("Dead Cells")))
    }

    @Test
    fun aDueCheckNeedsSomethingToCompareAndTheSwitchOn() {
        assertFalse("sans profil possible ni import, rien a lire", Taste.due(AppState(), now))
        assertTrue(Taste.due(AppState(taste = TasteState(imported = TasteProfile(mapOf("1" to 1.0)))), now))
        assertFalse(Taste.due(AppState(settings = Settings(taste = false), taste = TasteState(imported = TasteProfile(mapOf("1" to 1.0)))), now))
        // Dix minutes suffisent quand une offre vient d'arriver sans ses etiquettes.
        val offer = Offer(key = "steam:1", source = "steam", store = Stores.STEAM, storeId = "555", title = "Nouveau", end = now + 86_400_000)
        val base = AppState(offers = mapOf(offer.key to offer), taste = TasteState(at = now - Taste.MISSING_EVERY_MS - 1, imported = TasteProfile(mapOf("1" to 1.0))))
        assertTrue(Taste.due(base, now))
        assertFalse(Taste.due(base.copy(offers = emptyMap()), now))
    }

    @Test
    fun steamDownKeepsWhatWasKnownAndNeverThrows() = runBlocking {
        val marks = aimes.associate { "steam:${it.appid}" to Mark("done") }
        val s = AppState(marks = marks)
        val next = Taste.refresh(FauxSteam(items, noms, panne = true), s, now, "FR", "french")
        assertNull(next.profile)
        assertTrue(next.games.isEmpty())
        assertNull(Taste.fetchGames(FauxSteam(items, noms, panne = true), listOf("1"), now, "FR"))
        assertTrue(Taste.fetchGames(FauxSteam(items, noms), emptyList(), now, "FR")!!.isEmpty())
        val un = Taste.fetchGames(FauxSteam(items, noms), listOf(id("Dead Cells"), "pas-un-numero", "424242"), now, "FR")!!
        assertEquals(setOf(id("Dead Cells"), "424242"), un.keys)
        assertTrue(un.getValue("424242").none)
    }

    @Test
    fun theRequestCarriesOnlyGameNumbersAndTheTagsRequest() {
        val u = Taste.itemsUrl(listOf("1145360", "504230"), "FR")
        val input = parseJson(URLDecoder.decode(u.substringAfter("input_json="), "UTF-8"))
        assertEquals(listOf("1145360", "504230"), input["ids"].arr!!.map { it["appid"].text })
        assertEquals("""{"include_tag_count":20}""", input["data_request"].toString())
        assertTrue(u.startsWith("https://api.steampowered.com/"))
        assertTrue(Taste.tagListUrl("french").endsWith("IStoreService/GetTagList/v1/?language=french"))
    }

    @Test
    fun theExtensionsBackupCarriesItsProfileIn() {
        val p = Taste.buildProfile(aimes, jeux)!!
        val tags = p.tags.entries.joinToString(",") { "\"${it.key}\":${it.value}" }
        val fichier = """{"exportFormat":2,"backup":{"veille:gouts":{"at":$now,"profile":{"tags":{$tags},"liked":4,"disliked":0},"names":{"1716":"Roguelike"}}}}"""
        val (apres, _) = BackupIO.import(AppState(), fichier, now)!!
        assertEquals(p.tags.size, apres.taste.imported!!.tags.size)
        assertEquals(p.tags.entries.first().value, apres.taste.imported!!.tags.getValue(p.tags.entries.first().key), 1e-9)
        assertEquals(4, apres.taste.imported!!.liked)
        // Un profil abime, ou absent, ne remplace rien.
        val garde = AppState(taste = TasteState(imported = p))
        assertEquals(p, BackupIO.import(garde, """{"exportFormat":2,"backup":{"veille:gouts":{"profile":{"tags":{"x":"y"}}}}}""", now)!!.first.taste.imported)
        assertEquals(p, BackupIO.import(garde, """{"exportFormat":2,"backup":{}}""", now)!!.first.taste.imported)
        // L'export du telephone ne porte pas le profil : il n'a rien a rendre a l'extension.
        assertFalse(BackupIO.export(apres, now).contains("veille:gouts"))
    }

    @Test
    fun anOldStateReadsWithNoTaste() {
        val ancien = Json { ignoreUnknownKeys = true }.decodeFromString<AppState>("""{"settings":{"country":"FR"}}""")
        assertTrue(ancien.settings.taste)
        assertNull(ancien.taste.imported)
        assertTrue(ancien.taste.games.isEmpty())
    }

    /* ------------------------------------------------ silence intelligent (1.15.0) */

    private fun offreSteam(nom: String, appid: String) =
        Offer(key = "steam:$appid", source = "steam", store = Stores.STEAM, storeId = appid, title = nom, start = now - 3_600_000, end = now + 86_400_000)

    private val morts = offreSteam("Dead Cells", id("Dead Cells"))
    private val zoo = offreSteam("Planet Zoo", id("Planet Zoo"))
    private val inconnu = offreSteam("Jeu Inconnu", "424242")

    private fun avecGouts(quiet: Boolean, heure: Int = io.github.diaslamka.freegames.notify.Digest.OFF, profil: Boolean = true) = AppState(
        settings = Settings(tasteQuiet = quiet, digestHour = heure),
        offers = listOf(morts, zoo, inconnu).associateBy { it.key },
        taste = TasteState(imported = if (profil) Taste.buildProfile(aimes, jeux) else null, games = jeux, names = noms),
    )

    @Test
    fun smartQuietHoldsOnlyWhatSurelyDoesNotMatch() {
        val D = io.github.diaslamka.freegames.notify.Digest
        val s = avecGouts(quiet = true)
        assertTrue(D.notForYou(zoo, s))
        assertFalse("ce qui te ressemble sonne", D.notForYou(morts, s))
        assertFalse("douter, c'est sonner : aucune etiquette lue", D.notForYou(inconnu, s))
        // Le resume n'est pas choisi : le silence intelligent en demande un, a 20 h.
        assertEquals(D.QUIET_HOUR, D.effectiveHour(s))
        val plan = D.split(listOf(morts, zoo, inconnu), s, now, firstRun = false)
        assertEquals(listOf("Dead Cells", "Jeu Inconnu"), plan.now.map { it.title })
        assertEquals(listOf("Planet Zoo"), plan.held.map { it.title })
    }

    @Test
    fun withAChosenDigestOnlyWhatMatchesEscapesIt() {
        val D = io.github.diaslamka.freegames.notify.Digest
        val s = avecGouts(quiet = true, heure = 8)
        assertEquals(8, D.effectiveHour(s))
        val plan = D.split(listOf(morts, zoo, inconnu), s, now, firstRun = false)
        assertEquals(listOf("Dead Cells"), plan.now.map { it.title })
        assertEquals(listOf("Planet Zoo", "Jeu Inconnu"), plan.held.map { it.title })
        // Sans le silence intelligent, le resume garde tout, comme avant la 1.15.0.
        val sans = D.split(listOf(morts, zoo, inconnu), avecGouts(quiet = false, heure = 8), now, firstRun = false)
        assertTrue(sans.now.isEmpty())
        assertEquals(3, sans.held.size)
    }

    @Test
    fun withoutAProfileOrWithoutTheSwitchNothingIsHeld() {
        val D = io.github.diaslamka.freegames.notify.Digest
        val offres = listOf(morts, zoo, inconnu)
        val sansProfil = avecGouts(quiet = true, profil = false)
        assertFalse(D.quietOn(sansProfil))
        assertEquals(D.OFF, D.effectiveHour(sansProfil))
        assertEquals(3, D.split(offres, sansProfil, now, firstRun = false).now.size)
        val coupe = avecGouts(quiet = false)
        assertEquals(3, D.split(offres, coupe, now, firstRun = false).now.size)
        // Le tout premier passage annonce tout, comme le resume.
        assertEquals(3, D.split(offres, avecGouts(quiet = true), now, firstRun = true).now.size)
        // Le reglage de gouts coupe le silence intelligent avec lui.
        val sansGouts = avecGouts(quiet = true).let { it.copy(settings = it.settings.copy(taste = false)) }
        assertFalse(D.quietOn(sansGouts))
    }

    @Test
    fun aWishOrASecondChanceIsNeverHeldByTheQuiet() {
        val D = io.github.diaslamka.freegames.notify.Digest
        val s = avecGouts(quiet = true).copy(
            wishlist = listOf("Planet Zoo"),
            passes = mapOf(Titles.normalise("Jeu Inconnu") to listOf(io.github.diaslamka.freegames.model.Seen(Stores.STEAM, now - 40L * 86_400_000))),
        )
        val plan = D.split(listOf(morts, zoo, inconnu), s, now, firstRun = false)
        assertTrue(plan.held.isEmpty())
    }

    @Test
    fun theHeldGamesLeaveAtTheQuietHour() {
        val D = io.github.diaslamka.freegames.notify.Digest
        val paris = java.time.ZoneId.of("Europe/Paris")
        fun at(h: Int, m: Int = 0) = java.time.ZonedDateTime.of(2026, 9, 28, h, m, 0, 0, paris).toInstant().toEpochMilli()
        val s = avecGouts(quiet = true).copy(digestHeld = mapOf(zoo.key to at(9)))
        assertTrue(D.releasable(s, at(19, 30), paris).isEmpty())
        assertEquals(setOf(zoo.key), D.releasable(s, at(20, 5), paris))
    }
}
