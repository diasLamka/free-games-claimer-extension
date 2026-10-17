package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.SourceResult
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le meme jeu Epic, deux fois sur l'accueil (1.41.0) : Epic le donne dans la langue du pays (« Agent A - Casse-tete
 * d'espions »), l'agregateur en anglais (« Agent A: A Puzzle in Disguise »). Le titre ne les reconnait pas ; la fin de l'offre, si.
 */
class MergeDuplicatesTest {
    private val now = 1_790_000_000_000L
    private val h = 3_600_000L
    private val epicEnd = now + 5 * 24 * h

    private fun epic(id: String, title: String, end: Long? = epicEnd) =
        Offer(key = Offer.keyFor(Stores.EPIC, id, title), source = "epic-api", store = Stores.EPIC, storeId = id, title = title, url = "https://store.epicgames.com/p/$id", end = end, keepable = true)

    private fun gp(n: Int, store: String, title: String, end: Long?) =
        Offer(key = "gamerpower:$n", source = "gamerpower", store = store, title = title, resolveUrl = "https://www.gamerpower.com/open/$n", end = end)

    private fun merged(vararg gps: Offer, natives: List<Offer> = listOf(epic("agent-a", "Agent A - Casse-tête d'espions"))) =
        Watcher.merge(emptyMap(), listOf(SourceResult("epic-api", offers = natives), SourceResult("gamerpower", offers = gps.toList())), now)

    @Test
    fun anEpicGiveawayInAnotherLanguageIsTheSameGameWhenItEndsWithinADay() {
        // L'agregateur arrondit la fin a 23:59, heure de New York : une douzaine d'heures d'ecart avec Epic.
        val dup = gp(1, Stores.EPIC, "Agent A: A Puzzle in Disguise (Epic Games) Giveaway", epicEnd + 12 * h)
        val m = merged(dup)
        assertFalse("gamerpower:1" in m)
        assertTrue(epic("agent-a", "x").key.let { k -> m.keys.any { it.startsWith("epic:") } })
    }

    @Test
    fun anotherEpicGameThatEndsElsewhereIsKept() {
        assertTrue("gamerpower:2" in merged(gp(2, Stores.EPIC, "Un autre jeu (Epic Games) Giveaway", epicEnd + 6 * 24 * h)))
        // Sans date de fin, rien ne prouve que c'est le meme : on le garde.
        assertTrue("gamerpower:3" in merged(gp(3, Stores.EPIC, "Sans date (Epic Games) Giveaway", null)))
    }

    @Test
    fun onlyEpicIsRecognisedByItsEnd() {
        // Steam, GOG, itch.io : un autre jeu qui finit le meme jour n'est pas un doublon.
        val steam = Offer(key = "steam:1", source = "steam", store = Stores.STEAM, storeId = "1", title = "Un jeu Steam", url = "https://store.steampowered.com/app/1", end = epicEnd, keepable = true)
        val other = gp(4, Stores.STEAM, "Un autre jeu Steam (Steam) Giveaway", epicEnd + h)
        val m = Watcher.merge(emptyMap(), listOf(SourceResult("steam", offers = listOf(steam)), SourceResult("gamerpower", offers = listOf(other))), now)
        assertTrue("gamerpower:4" in m)
    }

    @Test
    fun withoutAWorkingEpicSourceTheAggregatorIsTheOnlyWitness() {
        val dup = gp(5, Stores.EPIC, "Agent A: A Puzzle in Disguise (Epic Games) Giveaway", epicEnd + 12 * h)
        val m = Watcher.merge(emptyMap(), listOf(SourceResult("epic-api", errors = listOf("HTTP 500"), ok = false), SourceResult("gamerpower", offers = listOf(dup))), now)
        assertTrue("gamerpower:5" in m)
    }
}
