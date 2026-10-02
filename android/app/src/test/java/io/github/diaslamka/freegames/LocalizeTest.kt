package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.sources.Localize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les adresses des magasins suivent le pays : la copie Kotlin de watch/localize.js. */
class LocalizeTest {
    @Test
    fun goldenTableMatchesTheJavaScriptModule() {
        val text = javaClass.classLoader!!.getResourceAsStream("localize-golden.tsv")!!.bufferedReader().readText()
        val lines = text.lines().filter { it.isNotBlank() }
        assertTrue("la table d'or est vide", lines.size > 100)
        for (line in lines) {
            val (country, claim, input, expected) = line.split("\t")
            assertEquals("$country claim=$claim : $input", expected, Localize.url(input, country, forClaim = claim == "true"))
        }
    }

    @Test
    fun franceMeansFrenchPages() {
        assertEquals("https://www.gog.com/fr/game/hades", Localize.url("https://www.gog.com/en/game/hades", "FR"))
        assertEquals("https://store.epicgames.com/fr/p/hades", Localize.url("https://store.epicgames.com/en-US/p/hades", "FR"))
        assertEquals("https://store.epicgames.com/p/hades?lang=fr", Localize.url("https://store.epicgames.com/p/hades", "FR"))
        assertEquals("https://luna.amazon.fr/claims/home", Localize.url("https://luna.amazon.com/claims/home", "FR"))
    }

    @Test
    fun claimPagesStayInALanguageTheEngineReads() {
        assertEquals("https://store.epicgames.com/p/x?lang=en", Localize.url("https://store.epicgames.com/p/x", "DE", forClaim = true))
        assertEquals("https://store.epicgames.com/p/x?lang=de", Localize.url("https://store.epicgames.com/p/x", "DE"))
    }

    @Test
    fun aSessionSeenElsewhereWinsAndOnlyForKnownLunaHosts() {
        assertEquals("https://luna.amazon.com/claims/home", Localize.url("https://luna.amazon.fr/claims/home", "FR", lunaHost = "luna.amazon.com"))
        assertEquals("https://luna.amazon.fr/claims/home", Localize.url("https://luna.amazon.com/claims/home", "FR", lunaHost = "evil.example"))
        assertNull(Localize.lunaHostOrNull("luna.amazon.com.evil.example"))
        assertEquals("luna.amazon.fr", Localize.lunaHostOrNull(" Luna.Amazon.FR "))
    }

    @Test
    fun othersAreLeftUntouched() {
        for (u in listOf(
            "https://store.steampowered.com/app/10/?l=english",
            "http://www.gog.com/en/game/x",
            "https://example.com/en/game/x",
            "https://store.epicgames.com.evil.example/p/x",
            "pas une adresse",
        )) assertEquals(u, Localize.url(u, "FR"))
        assertNull(Localize.url(null, "FR"))
        assertEquals("", Localize.url("", "FR"))
    }
}
