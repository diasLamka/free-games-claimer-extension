package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.ImportedWish
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.JSON
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le titre normalise (decomposition Unicode et quatre expressions regulieres) etait recalcule a chaque acces : pour chaque
 * offre, pour chaque entree de la bibliotheque, pour chaque souhait, a chaque recomposition. Il est maintenant calcule une
 * fois par objet -- l'etat est immuable, un changement cree un nouvel objet --, sans changer ce que Rules en conclut.
 */
class TitleCacheTest {
    private val now = 1_790_000_000_000L
    private fun offer(title: String, store: String = Stores.EPIC, id: String = "x") =
        Offer(key = Offer.keyFor(store, id, title), source = "x", store = store, storeId = id, title = title, url = "https://example.test/$id", end = now + 1)

    @Test
    fun aTitleIsNormalisedOncePerObject() {
        val o = offer("Hadès (Édition Deluxe)")
        assertEquals("hades", o.normalisedTitle)
        assertSame(o.normalisedTitle, o.normalisedTitle)
        assertSame(o.shownTitle, o.shownTitle)
        val e = LibraryEntry(Stores.EPIC, "h", "Hadès")
        assertEquals("hades", e.normalisedTitle)
        assertSame(e.normalisedTitle, e.normalisedTitle)
        val s = AppState(wishlist = listOf("Hadès"))
        assertSame(s.wishedTitles, s.wishedTitles)
    }

    @Test
    fun aChangedObjectIsNormalisedAgainNotFromTheOldCache() {
        val o = offer("Hades")
        assertEquals("hades", o.normalisedTitle)
        assertEquals("celeste", o.copy(title = "Céleste").normalisedTitle)
    }

    @Test
    fun theCacheIsNotPartOfTheSavedState() {
        val o = offer("Hadès")
        o.normalisedTitle
        o.shownTitle
        val json = JSON.encodeToString(Offer.serializer(), o)
        assertFalse(json, json.contains("normalisedTitle"))
        assertEquals(o, JSON.decodeFromString(Offer.serializer(), json))
        val s = AppState(wishlist = listOf("Hadès")).also { it.wishedTitles }
        assertFalse(JSON.encodeToString(AppState.serializer(), s).contains("wishedTitles"))
    }

    @Test
    fun theWishAndLibraryAnswersAreUnchanged() {
        val hades = offer("Hadès", id = "h")
        val state = AppState(
            wishlist = listOf("HADES", "Celeste"),
            importedWishes = listOf(ImportedWish("Autre jeu", Stores.GOG, "g-42"), ImportedWish("Tunic", Stores.EPIC, null)),
            library = mapOf("epic:old" to LibraryEntry(Stores.EPIC, "old", "Céleste"), "gog:old" to LibraryEntry(Stores.GOG, "old2", "Tunic")),
        )
        // Par le titre, sans casse ni accents.
        assertTrue(Rules.wished(hades, state))
        // Un souhait importe, par le titre ou par l'identifiant du magasin.
        assertTrue(Rules.wished(offer("Tunic", id = "t"), state))
        assertTrue(Rules.wished(offer("Quelque chose", store = Stores.GOG, id = "g-42"), state))
        assertFalse(Rules.wished(offer("Gris", id = "gr"), state))
        assertFalse(Rules.wished(offer("", id = "vide"), state))
        // Deja recupere : par le titre dans le MEME magasin seulement.
        assertNotNull(Rules.claimedEntry(offer("Celeste", id = "c"), state.library))
        assertNull(Rules.claimedEntry(offer("Celeste", store = Stores.GOG, id = "c"), state.library))
        assertNotNull(Rules.claimedEntry(offer("Tunic", store = Stores.GOG, id = "t"), state.library))
    }
}
