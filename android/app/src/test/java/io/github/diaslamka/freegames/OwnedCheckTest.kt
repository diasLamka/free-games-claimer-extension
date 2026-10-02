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
    fun onlyGogIsAskedAndTheImportedCollectionAnswersFirst() = runBlocking {
        val f = json("""{"products":[{"title":"Hades"}]}""")
        for (store in listOf(Stores.EPIC, Stores.AMAZON, Stores.STEAM)) {
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
}
