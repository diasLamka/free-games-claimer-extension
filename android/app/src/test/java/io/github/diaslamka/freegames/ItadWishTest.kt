package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.ItadKey
import io.github.diaslamka.freegames.data.ItadPass
import io.github.diaslamka.freegames.data.ItadTest
import io.github.diaslamka.freegames.data.Wish
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.PricePoint
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import io.github.diaslamka.freegames.sources.JSON
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Les prix des souhaits par IsThereAnyDeal (1.48.0), avec la cle de l'utilisateur : la meme chose que l'extension
 * (test/prices.test.mjs). Les reponses sont ecrites d'apres la specification publique du service (docs.isthereanydeal.com),
 * reduites a ce qu'on lit -- AUCUNE vraie cle n'a ete essayee.
 */
class ItadWishTest {
    private val now = 1_790_000_000_000L
    private val h = 3_600_000L
    private val key = "abcd1234EFGH5678ijkl9012mnop3456qrst7890"
    private val gameId = "018d937f-1b4b-7213-9c3c-c8c9ff0e8f1b"

    private val steamSearch = """{"total":1,"items":[
        {"type":"app","name":"Vampire Survivors","id":1794680,"price":{"currency":"EUR","initial":499,"final":374}}]}"""
    private val lookupOk = """{"found":true,"game":{"id":"$gameId","slug":"vampire-survivors","title":"Vampire Survivors","type":"game"}}"""
    private val lookupMissing = """{"found":false}"""
    private val pricesOk = """[{"id":"$gameId",
        "historyLow":{"all":{"amount":2.69,"amountInt":269,"currency":"EUR"},"y1":null,"m3":null},
        "deals":[
          {"shop":{"id":16,"name":"Epic Games Store"},"price":{"amount":4.99,"amountInt":499,"currency":"EUR"},
           "regular":{"amount":4.99,"amountInt":499,"currency":"EUR"},"cut":0,"url":"http://insecure.test/x"},
          {"shop":{"id":61,"name":"Steam"},"price":{"amount":3.74,"amountInt":374,"currency":"EUR"},
           "regular":{"amount":4.99,"amountInt":499,"currency":"EUR"},"cut":25,"url":"https://isthereanydeal.com/click/?x=1&u=y"}]}]"""
    private val sharkSearch = """[{"gameID":"238605","steamAppID":"1794680","cheapest":"3.74","external":"Vampire Survivors","thumb":"https://shared.fastly.steamstatic.com/x.jpg"}]"""
    private val sharkGame = """{"info":{"title":"Vampire Survivors","steamAppID":"1794680","thumb":"https://x/t.jpg"},
        "cheapestPriceEver":{"price":"2.69","date":1639753236},
        "deals":[{"storeID":"1","dealID":"a%3D","price":"3.99","retailPrice":"4.99","savings":"20.000000"}]}"""

    private fun ok(body: String) = HttpResult(200, body)

    /** Un faux reseau : les GET et les POST, rejoues par fragment d'adresse, et tout ce qui a ete demande. */
    private class Net(private val routes: List<Pair<String, HttpResult>>) : Fetcher {
        val calls = mutableListOf<String>()
        val posts = mutableListOf<Pair<String, String>>()
        private fun answer(url: String) = routes.firstOrNull { url.contains(it.first) }?.second ?: HttpResult(404, "")
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
            calls += url
            return answer(url)
        }
        override suspend fun post(url: String, json: String, accept: String): HttpResult {
            posts += url to json
            return answer(url)
        }
    }

    private fun net(vararg routes: Pair<String, HttpResult>) = Net(routes.toList())

    /* ------------------------------------------------------------ la cle */

    @Test
    fun onlyAValueShapedLikeAKeyIsKept() {
        assertEquals("abcd1234", Wish.itadKeyOf("  abcd1234 "))
        assertEquals(key, Wish.itadKeyOf(key))
        assertNull(Wish.itadKeyOf("court"))
        assertNull(Wish.itadKeyOf("pas une cle !"))
        assertNull(Wish.itadKeyOf(null))
        assertEquals(key, ItadKey.plausible(key))
        assertNull(ItadKey.plausible("x y z 1234567"))
        // Elle part en parametre d'adresse, sans troncature : la forme la borne a 100 signes.
        assertEquals("k".repeat(100), Wish.itadKeyOf("k".repeat(100)))
        assertNull(Wish.itadKeyOf("k".repeat(101)))
    }

    @Test
    fun theKeyNeverEntersAWishInfo() {
        val i = Wish.readItadPrices(pricesOk, "vampire-survivors", WishInfo(at = now), now)!!
        assertFalse(JSON.encodeToString(WishInfo.serializer(), i).contains(key))
        assertFalse(JSON.encodeToString(AppState.serializer(), AppState(wishInfo = mapOf("a" to i))).contains(key))
    }

    @Test
    fun anOldWishInfoStillReads() {
        val i = JSON.decodeFromString(WishInfo.serializer(), """{"at":1,"best":3.0,"deals":[{"store":"1","price":3.0}]}""")
        assertNull(i.currency)
        assertNull(i.source)
        assertNull(i.want)
        assertNull(i.deals.single().url)
    }

    /* ------------------------------------------------------------ les adresses */

    @Test
    fun theRequestsCarryTheKeyAsAParameterAndAskForOneGame() {
        assertTrue(Wish.itadLookupUrl(key, "1794680", "x").endsWith("games/lookup/v1?key=$key&appid=1794680"))
        assertTrue(Wish.itadLookupUrl(key, null, "Vampire Survivors").contains("&title=Vampire+Survivors"))
        val prices = Wish.itadPricesUrl(key, "FR")
        assertTrue(prices.contains("games/prices/v3?key=$key"))
        assertTrue(prices.contains("&country=FR"))
        assertTrue("pas de code promo", prices.contains("vouchers=false"))
        assertEquals("[\"$gameId\"]", Wish.itadPricesBody(gameId))
    }

    /* ------------------------------------------------------------ la lecture */

    @Test
    fun aLookupNeedsAFoundGameWithAReadableId() {
        assertEquals(gameId, Wish.parseItadLookup(lookupOk)!!.id)
        assertEquals("vampire-survivors", Wish.parseItadLookup(lookupOk)!!.slug)
        assertNull(Wish.parseItadLookup(lookupMissing))
        assertNull(Wish.parseItadLookup("""{"found":true,"game":{"id":"x"}}"""))
        assertNull(Wish.parseItadLookup("pas du json"))
        assertEquals(listOf(gameId), Wish.parseItadSearch("""[{"id":"$gameId","slug":"s","title":"T"},{"id":"zz"}]""").map { it.id })
    }

    @Test
    fun pricesAreKeptAsGivenSortedAndBounded() {
        val i = Wish.readItadPrices(pricesOk, "vampire-survivors", WishInfo(at = 1, name = "Vampire Survivors"), now)!!
        assertEquals(Wish.SRC_ITAD, i.source)
        assertEquals("la devise du pays, sans conversion", "EUR", i.currency)
        assertEquals(3.74, i.best!!, 0.0001)
        assertEquals("Steam", i.bestStore)
        assertEquals(4.99, i.retail!!, 0.0001)
        assertEquals(2.69, i.lowest!!, 0.0001)
        assertNull("le service ne dit pas quand", i.lowestAt)
        assertEquals(listOf("Steam", "Epic Games Store"), i.deals.map { it.store })
        assertEquals("l'adresse est gardee telle quelle", "https://isthereanydeal.com/click/?x=1&u=y", i.deals[0].url)
        assertNull("une adresse qui n'est pas https est ecartee", i.deals[1].url)
        assertEquals(25, i.deals[0].savings)
        assertEquals("https://isthereanydeal.com/game/vampire-survivors/info/", i.page)
        assertEquals("ce que Steam a appris est garde", "Vampire Survivors", i.name)
    }

    @Test
    fun theLowestEverNeverExceedsToday() {
        val body = """[{"id":"$gameId","historyLow":{"all":{"amount":9.0,"currency":"EUR"}},
            "deals":[{"shop":{"name":"Steam"},"price":{"amount":3.74,"currency":"EUR"},"cut":0}]}]"""
        assertEquals(3.74, Wish.readItadPrices(body, null, WishInfo(at = 1), now)!!.lowest!!, 0.0001)
    }

    @Test
    fun nothingReadableIsNotAPrice() {
        assertNull(Wish.readItadPrices("[]", null, WishInfo(at = 1), now))
        assertNull(Wish.readItadPrices("""[{"id":"x","historyLow":{"all":null},"deals":[]}]""", null, WishInfo(at = 1), now))
        assertNull(Wish.readItadPrices("pas du json", null, WishInfo(at = 1), now))
    }

    @Test
    fun aCurveKeepsOneCurrency() {
        // Venue de CheapShark (dollars) : la courbe recommence en euros.
        val fromShark = WishInfo(at = 1, history = listOf(PricePoint(now - h, 3.0)))
        assertEquals(1, Wish.readItadPrices(pricesOk, null, fromShark, now)!!.history.size)
        // Deja en euros d'IsThereAnyDeal, le prix a bouge : un point de plus.
        val first = Wish.readItadPrices(pricesOk, null, WishInfo(at = 1), now)!!
        val cheaper = pricesOk.replace("3.74", "3.50")
        assertEquals(2, Wish.readItadPrices(cheaper, null, first, now + h)!!.history.size)
        // Et revenue a CheapShark : la courbe d'euros n'est pas melee aux dollars.
        val back = Wish.readGame(sharkGame, first.copy(gameId = "238605"), now + 2 * h)
        assertEquals(1, back.history.size)
        assertNull(back.currency)
        assertEquals(Wish.SRC_SHARK, back.source)
    }

    @Test
    fun aMerchantIsSaidByNameOrByNumber() {
        assertEquals("Steam", Wish.storeName("1"))
        assertEquals("#99", Wish.storeName("99"))
        assertEquals("Epic Games Store", Wish.storeName("Epic Games Store"))
        assertEquals("?", Wish.storeName(null))
    }

    /* ------------------------------------------------------------ le passage */

    @Test
    fun withAKeyTheWishIsReadFromIsThereAnyDealAndNotFromCheapShark() = runBlocking {
        val f = net("storesearch" to ok(steamSearch), "games/lookup/v1" to ok(lookupOk), "games/prices/v3" to ok(pricesOk))
        val pass = ItadPass(key)
        val i = Wish.refresh(f, AppState(wishlist = listOf("Vampire Survivors")), now, "FR", pass).getValue("vampire survivors")
        assertEquals(Wish.SRC_ITAD, i.source)
        assertEquals(Wish.SRC_ITAD, i.want)
        assertEquals("EUR", i.currency)
        assertEquals(3.74, i.best!!, 0.0001)
        assertEquals("1794680", i.appid)
        assertEquals("le prix Steam local est garde", 3.74, i.localPrice!!, 0.0001)
        assertTrue(pass.worked)
        assertFalse(pass.refused)
        assertTrue("CheapShark n'est pas appele", f.calls.none { it.contains("cheapshark") })
        assertEquals("un seul POST, un seul identifiant", listOf("[\"$gameId\"]"), f.posts.map { it.second })
        assertTrue(f.posts.single().first.contains("country=FR"))
        // Par l'appid d'abord.
        assertTrue(f.calls.any { it.contains("lookup/v1") && it.contains("appid=1794680") })
    }

    @Test
    fun aRefusedKeyFallsBackToCheapSharkAndStopsAskingForThePass() = runBlocking {
        val f = net(
            "storesearch" to ok(steamSearch), "games/lookup/v1" to HttpResult(403, ""),
            "steamAppID=1794680" to ok(sharkSearch), "games?id=238605" to ok(sharkGame),
        )
        val pass = ItadPass(key)
        val s = AppState(wishlist = listOf("Vampire Survivors", "Un autre jeu"))
        val next = Wish.refresh(f, s, now, "FR", pass)
        val i = next.getValue("vampire survivors")
        assertTrue(pass.refused)
        assertFalse(pass.worked)
        assertEquals(Wish.SRC_SHARK, i.source)
        assertNull("les dollars de CheapShark", i.currency)
        assertEquals(3.99, i.best!!, 0.0001)
        assertEquals("la source visee est notee : pas relu a chaque passage", Wish.SRC_ITAD, i.want)
        assertEquals("IsThereAnyDeal n'est plus interroge dans ce passage", 1, f.calls.count { it.contains("lookup/v1") })
        assertTrue(f.posts.isEmpty())
    }

    @Test
    fun tooManyRequestsStopTheWholePassAndWriteNothingForThatWish() = runBlocking {
        val f = net("storesearch" to ok(steamSearch), "games/lookup/v1" to HttpResult(429, ""))
        val pass = ItadPass(key)
        val next = Wish.refresh(f, AppState(wishlist = listOf("Vampire Survivors", "Un autre jeu")), now, "FR", pass)
        assertTrue(pass.busy)
        assertTrue("rien d'ecrit : un souhait n'est pas declare introuvable pour une limite", next.isEmpty())
        assertEquals(1, f.calls.count { it.contains("lookup/v1") })
    }

    @Test
    fun aGameIsThereAnyDealDoesNotKnowIsNotLookedUpElsewhere() = runBlocking {
        val f = net("storesearch" to ok(steamSearch), "games/lookup/v1" to ok(lookupMissing), "games/search/v1" to ok("[]"))
        val pass = ItadPass(key)
        val i = Wish.refresh(f, AppState(wishlist = listOf("Vampire Survivors")), now, "FR", pass).getValue("vampire survivors")
        assertNull(i.best)
        assertEquals("ce que Steam a appris reste", 3.74, i.localPrice!!, 0.0001)
        assertEquals(Wish.SRC_ITAD, i.want)
        assertTrue(f.calls.none { it.contains("cheapshark") })
        assertTrue(f.posts.isEmpty())
        assertFalse(pass.refused)
    }

    @Test
    fun theExactTitleThenTheSearchFindTheGame() = runBlocking {
        val f = net(
            "storesearch" to ok("""{"total":0,"items":[]}"""), "games/lookup/v1" to ok(lookupMissing),
            "games/search/v1" to ok("""[{"id":"018d0000-0000-7000-8000-000000000001","slug":"vampire","title":"Vampire"},{"id":"$gameId","slug":"vampire-survivors","title":"Vampire Survivors"}]"""),
            "games/prices/v3" to ok(pricesOk),
        )
        val i = Wish.refresh(f, AppState(wishlist = listOf("Vampire Survivors")), now, "FR", ItadPass(key)).getValue("vampire survivors")
        assertEquals("le titre EXACT, pas le premier venu", "[\"$gameId\"]", f.posts.single().second)
        assertNotNull(i.best)
    }

    @Test
    fun withoutAKeyNothingChanges() = runBlocking {
        val f = net("storesearch" to ok(steamSearch), "steamAppID=1794680" to ok(sharkSearch), "games?id=238605" to ok(sharkGame))
        val i = Wish.refresh(f, AppState(wishlist = listOf("Vampire Survivors")), now, "FR").getValue("vampire survivors")
        assertEquals(Wish.SRC_SHARK, i.source)
        assertNull("absent : CheapShark, comme avant la 1.48.0", i.want)
        assertNull(i.currency)
        assertTrue(f.calls.none { it.contains("isthereanydeal") })
        assertTrue(f.posts.isEmpty())
    }

    @Test
    fun aKeyAddedOrRemovedRereadsTheCard() {
        val fresh = WishInfo(at = now, want = Wish.SRC_ITAD)
        assertFalse(Wish.needs(fresh, now + h, itad = true))
        assertTrue("cle retiree : relu par CheapShark", Wish.needs(fresh, now + h, itad = false))
        val legacy = WishInfo(at = now)
        assertFalse("une fiche d'avant la 1.48.0 compte pour CheapShark", Wish.needs(legacy, now + h))
        assertTrue("cle ajoutee : relu par IsThereAnyDeal", Wish.needs(legacy, now + h, itad = true))
        assertTrue("toujours perime apres six heures", Wish.needs(fresh, now + 7 * h, itad = true))
    }

    /* ------------------------------------------------------------ l'essai de la cle */

    @Test
    fun theKeyTestSaysWhatHappened() = runBlocking {
        assertEquals(ItadTest.OK, Wish.testItad(net("games/lookup/v1" to ok(lookupOk)), key))
        assertEquals(ItadTest.REFUSED, Wish.testItad(net("games/lookup/v1" to HttpResult(401, "")), key))
        assertEquals(ItadTest.REFUSED, Wish.testItad(net("games/lookup/v1" to HttpResult(403, "")), key))
        assertEquals(ItadTest.BUSY, Wish.testItad(net("games/lookup/v1" to HttpResult(429, "")), key))
        assertEquals(ItadTest.NET, Wish.testItad(net("games/lookup/v1" to HttpResult(500, "")), key))
        assertEquals(ItadTest.UNEXPECTED, Wish.testItad(net("games/lookup/v1" to ok(lookupMissing)), key))
    }
}
