package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Rates
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.RateTable
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Des euros partout (1.43.0) : ce qui est publie en dollars se lit au taux du jour, dit approximatif, ou reste en dollars. */
class RatesTest {
    private val now = 1_790_000_000_000L
    private val day = 24 * 3_600_000L
    private val body = """{"amount":1.0,"base":"EUR","date":"2026-10-16","rates":{"GBP":0.84385,"USD":1.1253}}"""
    private val table = RateTable("EUR", "2026-10-16", mapOf("USD" to 1.1253, "GBP" to 0.84385), now)

    @Test
    fun theEcbAnswerIsReadAndValidated() {
        val t = Rates.parse(body, now)!!
        assertEquals("EUR", t.base)
        assertEquals("2026-10-16", t.date)
        assertEquals(1.1253, t.rates.getValue("USD"), 0.00001)
        assertNull(Rates.parse("pas du json", now))
        assertNull(Rates.parse("""{"base":"EUR","rates":{}}""", now))
        assertNull(Rates.parse("""{"base":"EUR","rates":{"USD":0,"GBP":"x"}}""", now))
    }

    @Test
    fun aDollarAmountBecomesEuroAtTheDaysRate() {
        assertEquals(19.99 / 1.1253, Rates.toBase(19.99, "USD", table, now)!!, 0.0001)
        assertEquals(5.0, Rates.toBase(5.0, "EUR", table, now)!!, 0.0)
        assertNull("devise inconnue", Rates.toBase(5.0, "JPY", table, now))
        assertNull("sans devise", Rates.toBase(5.0, null, table, now))
        assertNull("sans taux", Rates.toBase(5.0, "USD", null, now))
    }

    @Test
    fun anOldRateIsNotTrusted() {
        assertNull(Rates.toBase(5.0, "USD", table, now + 31 * day))
        assertTrue(Rates.toBase(5.0, "USD", table, now + 29 * day) != null)
        assertTrue(Rates.due(table, "EUR", now + day))
        assertFalse(Rates.due(table, "EUR", now + day / 2))
        assertTrue("un autre pays, une autre devise de base", Rates.due(table, "GBP", now))
        assertTrue(Rates.due(null, "EUR", now))
    }

    @Test
    fun aConvertedAmountSaysItIsApproximateAndAnUnknownOneStaysInItsCurrency() {
        val fr = Locale.FRANCE
        val converted = Rates.show(19.99, "USD", table, "EUR", now, fr)
        assertTrue(converted, converted.startsWith("≈ ") && converted.contains("17,76"))
        assertFalse("un montant deja en euros n'est pas « environ »", Rates.show(12.49, "EUR", table, "EUR", now, fr).contains("≈"))
        val kept = Rates.show(19.99, "USD", null, "EUR", now, fr)
        assertTrue(kept, !kept.contains("≈") && kept.contains("19,99"))
        // Un taux dans une autre devise de base ne sert pas : jamais un chiffre invente.
        assertFalse(Rates.show(19.99, "USD", table.copy(base = "GBP"), "EUR", now, fr).contains("≈"))
    }

    @Test
    fun aValueWrittenByASourceIsConvertedWhenItReads() {
        val fr = Locale.FRANCE
        assertTrue(Rates.showWorth("$19.99", table, "EUR", now, fr)!!.startsWith("≈ "))
        assertEquals("23,99 €", Rates.showWorth("23,99 €", table, "EUR", now, fr)!!.replace('\u00a0', ' '))
        assertEquals("Gratuit", Rates.showWorth("Gratuit", table, "EUR", now, fr))
        assertNull(Rates.showWorth(null, table, "EUR", now, fr))
    }

    private fun fetcher(vararg answers: HttpResult) = object : Fetcher {
        var i = 0
        override suspend fun get(url: String, withCookies: Boolean, accept: String) = answers[minOf(i++, answers.size - 1)]
    }

    @Test
    fun aFailedReadNeverLosesTheRateWeHad() = runBlocking {
        val s = AppState(rates = table)
        // Frais : rien n'est redemande.
        assertEquals(table, Rates.refresh(fetcher(HttpResult(500, "")), s, now + day / 2, "EUR"))
        // Vieux, mais le reseau tombe : l'ancien reste.
        assertEquals(table, Rates.refresh(fetcher(HttpResult(500, "")), s, now + 2 * day, "EUR"))
        // Vieux, et le reseau repond : le nouveau.
        val fresh = Rates.refresh(fetcher(HttpResult(200, body)), s, now + 2 * day, "EUR")!!
        assertEquals(now + 2 * day, fresh.at)
        // Un changement de pays ne garde pas un taux d'une autre base.
        assertNull(Rates.refresh(fetcher(HttpResult(500, "")), s, now, "GBP"))
    }
}
