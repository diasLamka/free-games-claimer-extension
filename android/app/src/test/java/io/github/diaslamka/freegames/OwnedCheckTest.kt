package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.OwnedCheck
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** « Est-ce deja a toi ? » (1.24.0) : la copie Kotlin de watch/owned-check.js. */
class OwnedCheckTest {
    private fun gog(title: String) = Offer(key = "gog:$title", source = "gog", store = Stores.GOG, storeId = "1", title = title, url = "https://www.gog.com/en/game/x")

    private class Fake(private val reply: (String) -> HttpResult) : Fetcher {
        val asked = ArrayList<Pair<String, Boolean>>()
        override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
            asked += url to withCookies
            return reply(url)
        }
    }

    private fun json(body: String, code: Int = 200) = Fake { HttpResult(code, body) }

    @Test
    fun twoTitlesAreTheSameGameOnlyIfIdentical() {
        assertTrue(OwnedCheck.sameTitle("Hades", "HADES"))
        assertTrue(OwnedCheck.sameTitle("Hades™", "Hades"))
        assertTrue(OwnedCheck.sameTitle("Hades (GOG) Giveaway", "Hades"))
        assertTrue(OwnedCheck.sameTitle("Cyberpunk 2077 - Standard Edition", "Cyberpunk 2077"))
        assertTrue(OwnedCheck.sameTitle("Pillars of Eternity: Definitive Edition", "Pillars of Eternity"))
        // Un faux « deja a toi » fait rater un jeu offert : jamais « l'un dans l'autre ».
        assertFalse(OwnedCheck.sameTitle("Civilization", "Civilization VI"))
        assertFalse(OwnedCheck.sameTitle("Hades", "Hades II"))
        assertFalse(OwnedCheck.sameTitle("Cyberpunk 2077", "Cyberpunk 2077: Phantom Liberty"))
        assertFalse(OwnedCheck.sameTitle("", ""))
        assertFalse(OwnedCheck.sameTitle("Hades", null))
    }

    @Test
    fun theSearchAddressIsTheLibraryOnePageWithACleanTitle() {
        val u = OwnedCheck.gogSearchUrl("Sid Meier's Civilization (GOG) Giveaway")
        assertTrue(u.startsWith("https://www.gog.com/account/getFilteredProducts?mediaType=1&sortBy=title&page=1&search="))
        assertEquals("Sid%20Meier%27s%20Civilization", u.substringAfter("search="))
        assertEquals(80, OwnedCheck.gogSearchUrl("x".repeat(300)).substringAfter("search=").length)
        assertEquals("", OwnedCheck.gogSearchUrl(null).substringAfter("search="))
    }

    @Test
    fun aLibraryAnswerReadsOrDoesNot() {
        assertEquals(listOf("Hades"), OwnedCheck.readSearch("""{"products":[{"title":"Hades"},{"id":3},{"title":""}]}"""))
        assertEquals(emptyList<String>(), OwnedCheck.readSearch("""{"products":[]}"""))
        assertNull(OwnedCheck.readSearch("""{"message":"Full authentication is required"}"""))
        assertNull(OwnedCheck.readSearch("<html><title>Connexion</title></html>"))
        assertNull(OwnedCheck.readSearch(null))
        assertTrue(OwnedCheck.listHas("Hades", listOf("Celeste", "HADES")))
        assertFalse(OwnedCheck.listHas("Hades", listOf("Hades II")))
    }

    @Test
    fun theGogAccountSaysYoursWithYourSessionOnOnePage() = runBlocking {
        val f = json("""{"products":[{"title":"Bounty Train"},{"title":"Hades"}],"totalPages":1}""")
        val p = OwnedCheck.accountOwns(f, gog("Hades"))
        assertNotNull(p)
        assertEquals("account", p!!.via)
        assertEquals(1, f.asked.size)
        assertTrue("avec ta session", f.asked[0].second)
    }

    @Test
    fun everythingElseIsUnknownAndBlocksNothing() = runBlocking {
        val offer = gog("Hades")
        val cases = mapOf(
            "titre absent" to json("""{"products":[{"title":"Celeste"}]}"""),
            "recherche ignoree" to json("""{"products":[{"title":"Hades II"},{"title":"Hadean"}]}"""),
            "session absente" to json("""{"message":"Full authentication is required"}""", code = 403),
            "page de connexion" to json("<html><title>Connexion</title></html>"),
            "forme inattendue" to json("""{"games":[]}"""),
            "corps vide" to json(""),
            "reseau coupe" to Fake { throw java.io.IOException("hors ligne") },
        )
        for ((name, f) in cases) assertNull(name, OwnedCheck.accountOwns(f, offer))
    }

    @Test
    fun gogAndEpicAreAskedAndTheImportedCollectionAnswersFirst() = runBlocking {
        assertEquals(setOf(Stores.GOG, Stores.EPIC), OwnedCheck.ORACLE_STORES)
        val f = json("""{"products":[{"title":"Hades"}],"orders":[{"items":[{"description":"Hades","offerId":"o1"}]}]}""")
        for (store in listOf(Stores.AMAZON, Stores.STEAM, Stores.EPIC_MOBILE)) {
            assertNull(store, OwnedCheck.accountOwns(f, gog("Hades").copy(store = store)))
        }
        assertEquals("aucune requete pour un autre magasin", 0, f.asked.size)

        val collection = mapOf("gog:1" to OwnedGame(Stores.GOG, "1", "Hades"))
        val g = json("""{"products":[]}""")
        val p = OwnedCheck.accountOwns(g, gog("Hades (GOG) Giveaway"), collection)
        assertEquals("collection", p!!.via)
        assertEquals("la collection repond sans requete", 0, g.asked.size)
        assertFalse(OwnedCheck.collectionHas(collection, Stores.EPIC, "Hades"))
        assertNull(OwnedCheck.accountOwns(g, gog("Celeste"), collection))
    }

    /* ------------------------------------------------ Epic : l'historique des commandes (1.26.0) */

    private fun epic(id: String, title: String) =
        Offer(key = "epic:$id", source = "epic-api", store = Stores.EPIC, storeId = id, sourceId = id, title = title, url = "https://store.epicgames.com/p/$id")

    private fun orders(vararg items: Pair<String, String>, next: String? = null, type: String = "PURCHASE") =
        """{"orders":[{"orderType":"$type","items":[${items.joinToString(",") { """{"offerId":"${it.first}","description":"${it.second}"}""" }}]}]""" +
            (if (next != null) ""","nextPageToken":"$next"""" else "") + "}"

    @Test
    fun anEpicPageReadsOrDoesNotAndSkipsWhatWasUndone() {
        val page = OwnedCheck.readEpicOrders(
            """{"orders":[
                {"orderType":"PURCHASE","items":[{"offerId":"a1","description":"Hades"},{"offerId":"","description":"Sans id"},{"offerId":"a3"},"x"]},
                {"orderType":"REFUND","items":[{"offerId":"r1","description":"Rembourse"}]},
                {"orderType":"PURCHASE","orderStatus":"CANCELLED","items":[{"offerId":"r2","description":"Annule"}]},
                {"orderType":"PURCHASE","items":"pas une liste"}
            ],"nextPageToken":"p2"}""",
        )!!
        assertEquals(listOf("a1", "a3"), page.offerIds)
        assertEquals(listOf("Hades", "Sans id"), page.titles)
        assertEquals("p2", page.next)
        assertEquals(emptyList<String>(), OwnedCheck.readEpicOrders("""{"orders":[]}""")!!.offerIds)
        for (bad in listOf(null, "", "<html>verification</html>", """{"message":"blocked"}""", """{"orders":"x"}""", "[]")) {
            assertNull(bad.toString(), OwnedCheck.readEpicOrders(bad))
        }
        assertTrue(OwnedCheck.epicPageUrl(null).startsWith(OwnedCheck.EPIC_ORDERS_URL))
        assertTrue(OwnedCheck.epicPageUrl("a b").endsWith("&nextPageToken=a+b"))
    }

    @Test
    fun theEpicAccountSaysYoursByOfferIdOrByIdenticalTitle() = runBlocking {
        val f = json(orders("abc" to "Autre nom", "zzz" to "Celeste"))
        val byId = OwnedCheck.accountOwns(f, epic("abc", "Hades"))
        assertEquals("account", byId!!.via)
        assertTrue(byId.note.contains("Epic"))
        assertTrue("avec ta session", f.asked.first().second)
        assertEquals(OwnedCheck.epicPageUrl(null), f.asked.first().first)
        assertNotNull(OwnedCheck.accountOwns(f, epic("nouveau", "Celeste")))
        assertNull("un autre jeu au nom voisin", OwnedCheck.accountOwns(f, epic("nouveau", "Celeste II")))
    }

    @Test
    fun whateverEpicAnswersElseIsUnknownAndBlocksNothing() = runBlocking {
        val offer = epic("abc", "Hades")
        val cases = mapOf(
            "verification" to json("<html><title>Verification</title></html>"),
            "mur anti-robot" to json("""{"message":"blocked"}""", code = 403),
            "forme inattendue" to json("""{"transactions":[]}"""),
            "corps vide" to json(""),
            "reseau coupe" to Fake { throw java.io.IOException("hors ligne") },
            "remboursee" to json(orders("abc" to "Hades", type = "REFUND")),
            "compte sans commande" to json("""{"orders":[]}"""),
        )
        for ((name, f) in cases) assertNull(name, OwnedCheck.accountOwns(f, offer))
    }

    @Test
    fun theEpicHistoryIsReadAtMostThreePagesAndOnceForAWholeRun() = runBlocking {
        var n = 0
        val f = Fake { _ -> n++; HttpResult(200, orders("o$n" to "Jeu $n", next = "t$n")) }
        val memo = OwnedCheck.Memo()
        val readings = ArrayList<OwnedCheck.Reading>()
        val note: suspend (OwnedCheck.Reading) -> Unit = { readings += it }
        assertNotNull(OwnedCheck.accountOwns(f, epic("o1", "Jeu 1"), memo = memo, onReading = note))
        assertNotNull(OwnedCheck.accountOwns(f, epic("o3", "Jeu 3"), memo = memo, onReading = note))
        assertNull("au-dela des pages lues : on ne sait pas", OwnedCheck.accountOwns(f, epic("o9", "Jeu 9"), memo = memo, onReading = note))
        assertEquals(OwnedCheck.EPIC_PAGES, f.asked.size)
        assertEquals(OwnedCheck.epicPageUrl("t1"), f.asked[1].first)
        assertEquals("une lecture notee par lecture", listOf(OwnedCheck.Reading.READ), readings)
        // Sans table commune, chaque question relit.
        f.asked.clear()
        OwnedCheck.accountOwns(f, epic("o1", "Jeu 1"))
        OwnedCheck.accountOwns(f, epic("o1", "Jeu 1"))
        assertEquals(OwnedCheck.EPIC_PAGES * 2, f.asked.size)
    }

    @Test
    fun aNextPageThatDoesNotReadKeepsWhatWasReadAndALoopStops() = runBlocking {
        var n = 0
        val f = Fake { _ -> n++; if (n == 1) HttpResult(200, orders("a1" to "Hades", next = "t1")) else HttpResult(200, "<html>mur</html>") }
        assertNotNull(OwnedCheck.accountOwns(f, epic("a1", "Hades")))
        assertEquals(2, n)
        var m = 0
        val loop = Fake { _ -> m++; HttpResult(200, """{"orders":[],"nextPageToken":"meme"}""") }
        OwnedCheck.accountOwns(loop, epic("a1", "Hades"))
        assertEquals("un jeton deja vu arrete la lecture", 2, m)
    }

    @Test
    fun everyReadingIsNotedSoTheHealthPageCanSayWhetherTheStoreLetsItself() = runBlocking {
        val seen = ArrayList<OwnedCheck.Reading>()
        val note: suspend (OwnedCheck.Reading) -> Unit = { seen += it }
        OwnedCheck.accountOwns(json("<html>verification</html>"), epic("a", "Hades"), onReading = note)
        OwnedCheck.accountOwns(json("""{"products":[{"title":"Celeste"}]}"""), gog("Hades"), onReading = note)
        OwnedCheck.accountOwns(json("""{"message":"Full authentication is required"}""", code = 403), gog("Hades"), onReading = note)
        assertEquals(listOf(OwnedCheck.Reading.UNREADABLE, OwnedCheck.Reading.READ, OwnedCheck.Reading.UNREADABLE), seen)
        // Une collection importee repond sans lecture : rien a noter.
        seen.clear()
        OwnedCheck.accountOwns(json("{}"), gog("Hades"), mapOf("gog:1" to OwnedGame(Stores.GOG, "1", "Hades")), onReading = note)
        assertTrue(seen.isEmpty())
        // Un callback qui plante ne casse rien.
        assertNotNull(OwnedCheck.accountOwns(json("""{"products":[{"title":"Hades"}]}"""), gog("Hades"), onReading = { error("boum") }))
    }
}
