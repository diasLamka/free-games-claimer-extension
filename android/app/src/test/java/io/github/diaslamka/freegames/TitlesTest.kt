package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import org.junit.Assert.assertEquals
import org.junit.Test

class TitlesTest {
    @Test
    fun normaliseLikeTheExtension() {
        assertEquals("hollow knight silksong", Titles.normalise("Hollow Knight: Silksong"))
        assertEquals("astrea six sided oracles", Titles.normalise("Astrea: Six-Sided Oracles"))
        assertEquals("jeu minimal", Titles.normalise("Jeu Minimal (Epic Games) Giveaway"))
        assertEquals("pokemon", Titles.normalise("Pokémon"))
    }

    @Test
    fun displayDropsStoreSuffixes() {
        assertEquals("Jeu Minimal", Titles.display("Jeu Minimal (Epic Games) Giveaway"))
        assertEquals("Jeu (Remastered)", Titles.display("Jeu (Remastered) (Steam) Key Giveaway"))
    }

    @Test
    fun storesFromUrlsTitlesAndPlatforms() {
        assertEquals(Stores.EPIC, Titles.storeFromUrl("https://store.epicgames.com/p/x"))
        assertEquals(Stores.AMAZON, Titles.storeFromUrl("https://luna.amazon.fr/claims/home"))
        assertEquals(Stores.GOG, Titles.storeFromTitle("X (GOG) Giveaway"))
        assertEquals(Stores.STEAM, Titles.storeFromPlatforms("PC, Steam"))
        assertEquals(Stores.UNKNOWN, Titles.detectStore("Rien", "Android", null))
    }

    @Test
    fun sharedPagesGiveATitle() {
        assertEquals("Squad", Titles.slugTitle("https://store.steampowered.com/app/393380/Squad/"))
        assertEquals("Astrea Six Sided Oracles", Titles.slugTitle("https://store.epicgames.com/fr/p/astrea-six-sided-oracles"))
        assertEquals("Astrea Six Sided Oracles", Titles.slugTitle("https://www.gog.com/fr/game/astrea_six_sided_oracles"))
        assertEquals("393380", Titles.steamAppId("https://store.steampowered.com/app/393380/Squad/"))
        assertEquals("Squad", Titles.cleanDocTitle("Save 50% on Squad on Steam"))
        assertEquals("Mechabellum", Titles.cleanDocTitle("Mechabellum | Download and Buy Today - Epic Games Store"))
        val (t, u) = Titles.titleFromShared(null, "Regarde https://store.steampowered.com/app/393380/Squad/ !")
        assertEquals("Squad", t)
        assertEquals("https://store.steampowered.com/app/393380/Squad/", u)
    }
}
