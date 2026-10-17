package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Covers
import io.github.diaslamka.freegames.data.Wish
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.CoverNote
import io.github.diaslamka.freegames.model.ImportedWish
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.PricePoint
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L'onglet Souhaits (1.42.0). Les reponses sont celles, reelles, de la recherche Steam et de CheapShark (mesurees le
 * 2026-10-17), reduites a ce qu'on lit.
 */
class WishTest {
    private val now = 1_790_000_000_000L
    private val h = 3_600_000L

    private val steamSearch = """{"total":3,"items":[
        {"type":"app","name":"Vampire Survivors","id":1794680,"price":{"currency":"EUR","initial":499,"final":374}},
        {"type":"app","name":"Vampire Crawlers: The Turbo Wildcard","id":3265700,"price":{"currency":"EUR","initial":999,"final":999}},
        {"type":"sub","name":"Un lot","id":5}]}"""
    private val sharkSearch = """[{"gameID":"238605","steamAppID":"1794680","cheapest":"3.74","external":"Vampire Survivors","thumb":"https://shared.fastly.steamstatic.com/x.jpg"},
        {"gameID":"9","steamAppID":null,"cheapest":"12.00","external":"Epic Only Game","thumb":"https://img.test/epic.jpg"}]"""
    private val sharkGame = """{"info":{"title":"Vampire Survivors","steamAppID":"1794680","thumb":"https://x/t.jpg"},
        "cheapestPriceEver":{"price":"2.69","date":1639753236},
        "deals":[{"storeID":"25","dealID":"b%3D","price":"4.99","retailPrice":"4.99","savings":"0.000000"},
                 {"storeID":"1","dealID":"a%3D","price":"3.74","retailPrice":"4.99","savings":"25.050100"}]}"""

    @Test
    fun steamSearchGivesGamesWithHeaderAndLocalPrice() {
        val r = Wish.parseSteam(steamSearch)
        assertEquals(listOf("Vampire Survivors", "Vampire Crawlers: The Turbo Wildcard"), r.map { it.title })
        val a = r.first()
        assertEquals("1794680", a.appid)
        assertEquals(3.74, a.price!!, 0.001)
        assertEquals("EUR", a.currency)
        assertEquals(25, a.discount)
        assertTrue(a.image!!.endsWith("/apps/1794680/header.jpg"))
        assertEquals(0, r[1].discount)
        assertTrue(Wish.parseSteam("pas du json").isEmpty())
    }

    @Test
    fun sharkSearchGivesTheCheapestAndAThumb() {
        val r = Wish.parseShark(sharkSearch)
        assertEquals(2, r.size)
        assertEquals("238605", r[0].gameId)
        assertEquals(3.74, r[0].best!!, 0.001)
        assertNull(r[0].price)
        assertTrue("Steam: l'en-tete", r[0].image!!.contains("/apps/1794680/header.jpg"))
        assertEquals("https://img.test/epic.jpg", r[1].image)
    }

    @Test
    fun liveSuggestionsMergeSteamFirstWithoutDuplicates() {
        val steam = Wish.parseSteam(steamSearch)
        val shark = Wish.parseShark(sharkSearch)
        val m = Wish.merge(steam, shark)
        assertEquals(listOf("Vampire Survivors", "Vampire Crawlers: The Turbo Wildcard", "Epic Only Game"), m.map { it.title })
        assertEquals("le jeu Steam garde son prix local et prend l'identifiant CheapShark", "238605", m[0].gameId)
        assertEquals(3.74, m[0].price!!, 0.001)
    }

    @Test
    fun theDetailGivesTheLowestEverTheStoresAndAFirstReading() {
        val i = Wish.readGame(sharkGame, WishInfo(at = 1, appid = "1794680"), now)
        assertEquals(3.74, i.best!!, 0.001)
        assertEquals("1", i.bestStore)
        assertEquals(4.99, i.retail!!, 0.001)
        assertEquals(2.69, i.lowest!!, 0.001)
        assertEquals(1639753236000L, i.lowestAt)
        assertEquals(listOf("1", "25"), i.deals.map { it.store })
        assertEquals(listOf(PricePoint(now, 3.74)), i.history)
        assertEquals("Steam", Wish.storeName("1"))
        assertEquals("#99", Wish.storeName("99"))
        assertFalse(Wish.atLow(i))
        assertFalse(Wish.nearLow(i))
        assertTrue(Wish.onSale(i))
        assertEquals(25, Wish.discount(i))
    }

    @Test
    fun theLowestEverIsNeverAboveTodaysPrice() {
        // CheapShark met son plus bas a jour avec retard : un prix d'aujourd'hui plus bas devient le plus bas.
        val body = sharkGame.replace("\"price\":\"2.69\"", "\"price\":\"3.99\"")
        val i = Wish.readGame(body, WishInfo(at = 1), now)
        assertEquals(3.74, i.lowest!!, 0.001)
        assertTrue(Wish.atLow(i))
    }

    @Test
    fun theWordsForALowPriceAreHonest() {
        val base = WishInfo(at = 1, best = 3.0, lowest = 2.8)
        assertFalse(Wish.atLow(base))
        assertTrue("a 10 % du plus bas", Wish.nearLow(base))
        assertFalse(Wish.nearLow(base.copy(best = 4.0)))
        assertTrue(Wish.atLow(base.copy(best = 2.8)))
        assertFalse(Wish.atLow(WishInfo(at = 1)))
        assertFalse("pas de prix, pas de promotion", Wish.onSale(WishInfo(at = 1)))
        assertTrue(Wish.onSale(WishInfo(at = 1, localDiscount = 10)))
        assertEquals(0, Wish.discount(null))
    }

    @Test
    fun historyKeepsChangesAndSpacesRepeats() {
        var hist = Wish.recordHistory(emptyList(), 5.0, now)
        assertEquals(1, hist.size)
        // Le meme prix une heure plus tard : rien de plus ; douze heures plus tard : un point.
        assertEquals(1, Wish.recordHistory(hist, 5.0, now + h).size)
        assertEquals(2, Wish.recordHistory(hist, 5.0, now + 13 * h).size)
        // Un prix qui bouge se note tout de suite.
        assertEquals(2, Wish.recordHistory(hist, 4.0, now + h).size)
        assertEquals(hist, Wish.recordHistory(hist, null, now + h))
        repeat(100) { i -> hist = Wish.recordHistory(hist, 1.0 + i, now + (i + 1) * h) }
        assertEquals(60, hist.size)
        assertEquals(100.0, hist.last().price, 0.001)
    }

    @Test
    fun targetsAreMineThenImportedWithTheSteamId() {
        val s = AppState(
            wishlist = listOf("Hades", "Gris"),
            importedWishes = listOf(ImportedWish("Hades", Stores.STEAM, "1145360"), ImportedWish("Celeste", Stores.STEAM, "504230"), ImportedWish("Un GOG", "gog", "77")),
        )
        assertEquals(listOf("Hades" to null, "Gris" to null, "Celeste" to "504230", "Un GOG" to null), Wish.targets(s))
    }

    @Test
    fun theDashboardCountsWhatMatters() {
        val free = Offer(key = "epic:a", source = "x", store = Stores.EPIC, storeId = "a", title = "Agent A", url = "https://x", end = now + 24 * h)
        val s = AppState(
            wishlist = listOf("Vampire Survivors", "Agent A", "Gris", "Hades"),
            offers = mapOf(free.key to free),
            wishInfo = mapOf(
                "vampire survivors" to WishInfo(at = now, best = 2.69, lowest = 2.69, retail = 4.99),
                "gris" to WishInfo(at = now, best = 9.0, lowest = 4.0, retail = 9.0, localDiscount = 0),
                "hades" to WishInfo(at = now, localDiscount = 40),
            ),
        )
        val d = Wish.dashboard(s, now)
        assertEquals(4, d.count)
        assertEquals("promo : Vampire Survivors (sous le catalogue) et Hades (Steam)", 2, d.onSale)
        assertEquals(1, d.atLow)
        assertEquals(1, d.freeNow)
    }

    private fun fetcher(vararg routes: Pair<String, String>) = object : Fetcher {
        val calls = mutableListOf<String>()
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
            calls += url
            val hit = routes.firstOrNull { url.contains(it.first) } ?: return HttpResult(404, "")
            return HttpResult(200, hit.second)
        }
    }

    @Test
    fun refreshFillsAWishFromSteamThenCheapShark() = runBlocking {
        val f = fetcher("storesearch" to steamSearch, "steamAppID=1794680" to sharkSearch, "games?id=238605" to sharkGame)
        val s = AppState(wishlist = listOf("Vampire Survivors"))
        val next = Wish.refresh(f, s, now, "FR")
        val i = next.getValue("vampire survivors")
        assertEquals("1794680", i.appid)
        assertEquals("238605", i.gameId)
        assertEquals(3.74, i.localPrice!!, 0.001)
        assertEquals(2.69, i.lowest!!, 0.001)
        assertNotNull(i.image)
        assertEquals(1, i.history.size)
        // Frais : un second passage tout de suite ne rappelle rien.
        val again = fetcher()
        Wish.refresh(again, s.copy(wishInfo = next), now + h, "FR")
        assertTrue(again.calls.isEmpty())
        // Treize heures plus tard, meme prix : relu, et un point de plus (le dernier date de plus d une demi-journee).
        val later = Wish.refresh(f, s.copy(wishInfo = next), now + 13 * h, "FR").getValue("vampire survivors")
        assertEquals(2, later.history.size)
    }

    @Test
    fun aGameSteamDoesNotKnowIsFoundOnCheapSharkByItsExactTitle() = runBlocking {
        val shark = """[{"gameID":"9","steamAppID":null,"cheapest":"12.00","external":"Epic Only Game","thumb":"https://img.test/epic.jpg"}]"""
        val game = """{"info":{"title":"Epic Only Game"},"cheapestPriceEver":{"price":"9.00","date":1600000000},"deals":[{"storeID":"25","dealID":"z","price":"12.00","retailPrice":"20.00","savings":"40"}]}"""
        val f = fetcher("storesearch" to """{"items":[]}""", "games?title" to shark, "games?id=9" to game)
        val i = Wish.refresh(f, AppState(wishlist = listOf("Epic Only Game")), now, "FR").getValue("epic only game")
        assertNull(i.appid)
        assertEquals("9", i.gameId)
        assertEquals("https://img.test/epic.jpg", i.image)
        assertEquals(12.0, i.best!!, 0.001)
        assertEquals(40, Wish.discount(i))
    }

    @Test
    fun anUnknownGameIsNotInventedAndTheNetworkDownDoesNotLoseWhatWeKnew() = runBlocking {
        val none = fetcher("storesearch" to """{"items":[]}""", "games?title" to "[]")
        val lost = Wish.refresh(none, AppState(wishlist = listOf("Introuvable")), now, "FR").getValue("introuvable")
        assertTrue(lost.notFound)
        val known = WishInfo(at = now - 10 * h, appid = "1", gameId = "2", best = 5.0, lowest = 3.0)
        val down = fetcher()
        val kept = Wish.refresh(down, AppState(wishlist = listOf("Un jeu"), wishInfo = mapOf("un jeu" to known)), now, "FR").getValue("un jeu")
        assertEquals(3.0, kept.lowest!!, 0.001)
        assertEquals("1", kept.appid)
    }

    @Test
    fun coversAreSoughtOnlyForGamesWithoutAnyImage() = runBlocking {
        val withImage = LibraryEntry(store = Stores.EPIC, id = "a", title = "Gris", image = "https://img.test/gris.jpg", ts = now)
        val without = LibraryEntry(store = "luna", id = "b", title = "Vampire Survivors", ts = now - h)
        val s = AppState(library = mapOf("epic:a" to withImage, "luna:b" to without))
        assertEquals(listOf("Vampire Survivors"), Covers.missing(s, now))
        val next = Covers.refresh(fetcher("storesearch" to steamSearch), s, now, "FR")
        assertTrue(next.getValue("vampire survivors").url!!.endsWith("/apps/1794680/header.jpg"))
        // Trouvee, elle n'est plus a chercher ; ratee, pas avant une semaine.
        val found = s.copy(covers = next)
        assertTrue(Covers.missing(found, now + 30 * 24 * h).isEmpty())
        val missed = s.copy(covers = mapOf("vampire survivors" to CoverNote(now, null)))
        assertTrue(Covers.missing(missed, now + h).isEmpty())
        assertEquals(listOf("Vampire Survivors"), Covers.missing(missed, now + 8 * 24 * h))
    }
}
