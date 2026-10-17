package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Images
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.TitleMatch
import io.github.diaslamka.freegames.model.TonightInfo
import io.github.diaslamka.freegames.model.Upcoming
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test

/** Le plus d'images possible (1.40.0) : une jaquette manquante se retrouve ailleurs avant de tomber sur l'initiale. */
class ImagesTest {
    private fun offer(store: String, id: String?, title: String, image: String?) =
        Offer(key = Offer.keyFor(store, id, title), source = "x", store = store, storeId = id, title = title, url = "https://example.test/$title", image = image)

    private fun header(appid: String) = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/$appid/header.jpg"

    @Test
    fun aMissingCoverIsFoundOnAnotherEntryOfTheSameGame() {
        val withImage = offer(Stores.EPIC, "hades", "Hades", "https://img.test/hades.jpg")
        val luna = offer(Stores.AMAZON, "amzn1.a", "HADES", null)
        val idx = Images.index(AppState(offers = listOf(withImage, luna).associateBy { it.key }))
        assertEquals("https://img.test/hades.jpg", idx.find(luna.title))
    }

    @Test
    fun theRegistryAndTheUpcomingListLendTheirImagesToo() {
        val s = AppState(
            library = mapOf("epic:a" to LibraryEntry(store = Stores.EPIC, id = "a", title = "Gris", image = "https://img.test/gris.jpg")),
            upcoming = listOf(Upcoming(title = "Celeste", image = "https://img.test/celeste.jpg", start = 1)),
        )
        val idx = Images.index(s)
        assertEquals("https://img.test/gris.jpg", idx.find("gris"))
        assertEquals("https://img.test/celeste.jpg", idx.find("Celeste"))
    }

    @Test
    fun aSteamGameHasItsHeaderEvenWithoutAnyImage() {
        val steam = offer(Stores.STEAM, "620", "Portal 2", null)
        val lib = LibraryEntry(store = Stores.STEAM, id = "730", title = "Counter-Strike 2")
        val owned = OwnedGame(Stores.STEAM, "440", "Team Fortress 2")
        val idx = Images.index(AppState(offers = mapOf(steam.key to steam), library = mapOf("steam:730" to lib), owned = mapOf("steam:440" to owned)))
        assertEquals(header("620"), idx.find("Portal 2"))
        assertEquals(header("730"), idx.find("Counter-Strike 2"))
        assertEquals(header("440"), idx.find("Team Fortress 2"))
    }

    @Test
    fun anOffMarketGameTakesTheSteamHeaderItsRatingFound() {
        val epic = offer(Stores.EPIC, "x", "Some Epic Game", null)
        val s = AppState(offers = mapOf(epic.key to epic), ratings = mapOf("t:${epic.normalisedTitle}" to Rating(at = 1, appid = "1234")))
        assertEquals(header("1234"), Images.index(s).find("Some Epic Game"))
        // « Tonight » a aussi retrouve des appids par titre.
        val t = AppState(tonightTitles = mapOf("autre jeu" to TitleMatch(at = 1, appid = "99")))
        assertEquals(header("99"), Images.index(t).find("Autre Jeu"))
        // ... et sa fiche Steam a une vignette.
        val u = AppState(tonightTitles = mapOf("autre jeu" to TitleMatch(at = 1, appid = "99")), tonightApps = mapOf("99" to TonightInfo(at = 1, image = "https://img.test/99.jpg")))
        assertEquals("https://img.test/99.jpg", Images.index(u).find("Autre Jeu"))
    }

    @Test
    fun aRealImageBeatsADerivedHeaderAndOnlyHttpsIsKept() {
        val real = offer(Stores.EPIC, "p2", "Portal 2", "https://img.test/p2.jpg")
        val steam = offer(Stores.STEAM, "620", "Portal 2", null)
        assertEquals("https://img.test/p2.jpg", Images.index(AppState(offers = listOf(real, steam).associateBy { it.key })).find("Portal 2"))
        val bad = offer(Stores.EPIC, "b", "Bad", "http://insecure.test/b.jpg")
        assertNull(Images.index(AppState(offers = mapOf(bad.key to bad))).find("Bad"))
        assertNull(Images.index(AppState()).find("Rien"))
        assertNull(Images.index(AppState()).find(null))
    }

    @Test
    fun aRealImageThenItsThumbnailThenTheDerivedHeader() {
        // Un jeu recent de Steam : pas d'en-tete a l'ancienne adresse, seulement la vignette de la recherche.
        val w = io.github.diaslamka.freegames.model.WishInfo(at = 1, appid = "3265700", name = "Vampire Crawlers", image = "https://img.test/h.jpg", thumb = "https://img.test/t.jpg")
        val idx = Images.index(AppState(wishInfo = mapOf("vampire crawlers" to w)))
        assertEquals(listOf("https://img.test/h.jpg", "https://img.test/t.jpg", header("3265700")), idx.all("Vampire Crawlers"))
        assertTrue(idx.hasReal("Vampire Crawlers"))
        // Seul un en-tete deduit : ce n'est pas une vraie image, une recherche peut encore en trouver une.
        val only = Images.index(AppState(offers = mapOf("k" to offer(Stores.STEAM, "620", "Portal 2", null))))
        assertEquals(listOf(header("620")), only.all("Portal 2"))
        assertFalse(only.hasReal("Portal 2"))
    }

    @Test
    fun theCandidatesStartWithTheOwnImageThenTheFallback() {
        val idx = Images.index(AppState(offers = mapOf("a" to offer(Stores.EPIC, "h", "Hades", "https://img.test/h.jpg"))))
        assertEquals(listOf("https://own.test/x.jpg", "https://img.test/h.jpg"), Images.candidates("https://own.test/x.jpg", "Hades", idx))
        assertEquals(listOf("https://img.test/h.jpg"), Images.candidates(null, "Hades", idx))
        assertEquals(listOf("https://img.test/h.jpg"), Images.candidates("https://img.test/h.jpg", "Hades", idx))
        assertEquals(emptyList<String>(), Images.candidates(null, "Inconnu", idx))
    }
}
