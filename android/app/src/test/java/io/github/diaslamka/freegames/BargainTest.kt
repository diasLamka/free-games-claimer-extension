package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Bargain
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.PriceCheck
import io.github.diaslamka.freegames.model.Rating
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** « Piege ou bonne affaire ? » (1.22.0) : la copie Kotlin de watch/bargain.js. */
class BargainTest {
    private val now = 1_790_500_000_000L

    private fun dash(s: String) = s.takeIf { it != "-" }

    @Test
    fun goldenTableMatchesTheJavaScriptModule() {
        val text = javaClass.classLoader!!.getResourceAsStream("bargain-golden.tsv")!!.bufferedReader().readText()
        val lines = text.lines().filter { it.isNotBlank() }
        assertTrue("la table d'or est vide", lines.size >= 20)
        for (line in lines) {
            val c = line.split("\t")
            val (id, title, store, source) = c
            val offer = Offer(
                key = "$store:$id", source = source, store = store, storeId = id, title = title,
                category = dash(c[4]), keepable = when (c[5]) { "t" -> true; "f" -> false; else -> null },
                worth = dash(c[6]), parentAppid = dash(c[7]),
            )
            val check = dash(c[8])?.split("|")?.let { f ->
                PriceCheck(
                    at = now, type = f[0], isFree = f[1] == "1", price = dash(f[2])?.toDouble(), currency = dash(f[3]),
                    fullgame = dash(f[4]), fullgameName = dash(f[5]),
                )
            }
            val rating = dash(c[9])?.split("/")?.let { (p, t) -> Rating(at = now, percent = Math.round(100.0 * p.toInt() / t.toInt()).toInt(), total = t.toInt(), score = 8) }
            val base = when (c[10]) { "t" -> true; "f" -> false; else -> null }
            val v = Bargain.grade(offer, check, rating, base)
            assertEquals("$id : note", c[11], v.grade ?: "-")
            val reasons = v.reasons.joinToString(";") { "${it.key}:${it.args.joinToString("~")}:${it.tone}" }
            assertEquals("$id : raisons", c[12], reasons)
        }
    }

    @Test
    fun priceChecksAreReadFromSteamPages() {
        val dlc = """{"9":{"success":true,"data":{"steam_appid":9,"type":"dlc","is_free":false,"price_overview":{"initial":499,"currency":"USD","final":0},"fullgame":{"appid":"620","name":"Portal 2"}}}}"""
        val c = Bargain.readCheck(dlc, "9", now)!!
        assertEquals("dlc", c.type)
        assertEquals(4.99, c.price!!, 0.001)
        assertEquals("620", c.fullgame)
        assertEquals("Portal 2", c.fullgameName)
        assertTrue(Bargain.readCheck("""{"730":{"success":true,"data":{"type":"game","is_free":true}}}""", "730", now)!!.isFree)
        assertTrue("retire de la vente : une reponse", Bargain.readCheck("""{"7":{"success":false}}""", "7", now)!!.none)
        assertNull("illisible : on retentera", Bargain.readCheck("pas du json", "7", now))
        assertNull(Bargain.readCheck("""{"8":{"success":true,"data":{"type":"dlc","fullgame":{"appid":"x'; DROP"}}}}""", "8", now)!!.fullgame)
    }

    @Test
    fun theComparisonOnlyTrustsDollars() {
        fun c(price: Double?, cur: String = "USD") = PriceCheck(at = now, price = price, currency = cur)
        assertEquals("ok", Bargain.compareWorth(13.99, c(9.99)).state)
        assertEquals("ok", Bargain.compareWorth(30.0, c(25.0)).state)
        assertEquals("inflated", Bargain.compareWorth(40.0, c(20.0)).state)
        assertEquals("very", Bargain.compareWorth(60.0, c(20.0)).state)
        assertEquals("unverifiable", Bargain.compareWorth(60.0, c(null)).state)
        assertEquals("unverifiable", Bargain.compareWorth(60.0, c(20.0, "EUR")).state)
        assertEquals("unverifiable", Bargain.compareWorth(null, c(20.0)).state)
    }

    @Test
    fun refreshReadsEightAtMostWithoutCookiesAndNeverThrows() = runBlocking {
        val asked = ArrayList<String>()
        val fetcher = object : Fetcher {
            override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult {
                asked += url
                assertTrue("aucun cookie", !withCookies)
                val id = Regex("appids=(\\d+)").find(url)!!.groupValues[1]
                return when (id) {
                    "7" -> HttpResult(200, """{"7":{"success":false}}""")
                    "8" -> HttpResult(500, "")
                    "9" -> throw java.io.IOException("hors ligne")
                    else -> HttpResult(200, """{"$id":{"success":true,"data":{"type":"game","price_overview":{"initial":1999,"currency":"USD"}}}}""")
                }
            }
        }
        val got = Bargain.refresh(fetcher, listOf("1", "2", "1", "7", "8", "9"), emptyMap(), now)
        assertEquals(setOf("app:1", "app:2", "app:7"), got.keys)
        assertTrue(asked.all { "cc=US" in it })
        assertEquals(5, asked.size)
        // Frais : rien a refaire ; une fiche introuvable se redemande plus tot.
        assertTrue(!Bargain.needs(got, "1", now + Bargain.FRESH_MS - 1))
        assertTrue(Bargain.needs(got, "1", now + Bargain.FRESH_MS))
        assertTrue(Bargain.needs(got, "7", now + Bargain.NONE_MS))
        // Huit au plus par passage.
        asked.clear()
        val many = (100 until 130).map { it.toString() }
        Bargain.refresh(fetcher, many, emptyMap(), now)
        assertEquals(Bargain.PER_RUN, asked.size)
    }

    @Test
    fun theVerifiedTotalSeparatesWhatIsProvedFromWhatIsClaimed() {
        fun lib(store: String, id: String, title: String, worth: String, wsrc: String?) =
            "$store:$id" to LibraryEntry(store = store, id = id, title = title, worth = worth, ts = now, wsrc = wsrc)
        val entries = mapOf(
            lib(Stores.EPIC, "hades", "Hades", "24,99 EUR", "store"),
            lib(Stores.STEAM, "1", "Bon Jeu", "$24.99", "aggregator"),
            lib(Stores.STEAM, "2", "Gonfle", "$60.00", "aggregator"),
            lib(Stores.AMAZON, "x", "Sans Fiche", "$30", "aggregator"),
            lib(Stores.STEAM, "4", "Libre", "$15", "aggregator"),
            lib(Stores.AMAZON, "y", "Provenance Inconnue", "12 EUR", null),
        )
        val state = AppState(
            library = entries,
            checks = mapOf(
                "app:1" to PriceCheck(at = now, type = "game", price = 19.99, currency = "USD"),
                "app:2" to PriceCheck(at = now, type = "game", price = 19.99, currency = "USD"),
                "app:4" to PriceCheck(at = now, type = "game", isFree = true),
            ),
        )
        val c = Bargain.certify(entries.values, state)
        assertEquals(24.99, c.verified["EUR"]!!, 0.001)
        assertEquals(24.99 + 19.99, c.verified["USD"]!!, 0.001)
        assertEquals(40.01, c.trimmed["USD"]!!, 0.001)
        assertEquals(30.0, c.unverified["USD"]!!, 0.001)
        assertEquals(12.0, c.unverified["EUR"]!!, 0.001)
        assertEquals(1, c.excluded)
    }

    @Test
    fun provenanceIsStoreOnlyForTheStoresOwnSources() {
        fun o(source: String, worth: String? = "10 EUR") = Offer(key = "k", source = source, store = Stores.EPIC, title = "t", worth = worth)
        assertEquals("store", Bargain.worthSource(o("epic-api")))
        assertEquals("store", Bargain.worthSource(o("gog")))
        assertEquals("aggregator", Bargain.worthSource(o("gamerpower")))
        assertNull(Bargain.worthSource(o("epic-api", worth = null)))
    }

    @Test
    fun amountsReadTheSameAsTheModuleJs() {
        assertEquals("20", Bargain.amountText(20.0))
        assertEquals("19.99", Bargain.amountText(19.99))
        assertEquals("4.50", Bargain.amountText(4.5))
    }
}
