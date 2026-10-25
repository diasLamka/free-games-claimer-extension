package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.FailureReport
import io.github.diaslamka.freegames.data.Verdicts
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Revue de securite du 2026-10-11 : le chemin de l'adresse et les codes a tirets (un code GOG ou Luna ressemble a
 * ABCDE-FGHIJ-KLMNO) passaient tels quels. Un code d'echange est un bien : il ne part pas dans un rapport.
 */
class FailureReportCodesTest {
    private fun page(url: String, title: String = "t", text: String = "") =
        buildJsonObject { put("url", url); put("title", title); put("text", text) }

    @Test
    fun aDashedCodeIsMaskedInTheTextTheTitleAndThePath() {
        val f = FailureReport.of(
            Verdicts.FAILURE, null,
            page("https://www.gog.com/redeem/ABCDE-FGHIJ-KLMNO?x=1", "Code ABCDE-FGHIJ-KLMNO", "Le code AB12C-DE34F-GH56I-JK78L est deja utilise"), now = 1,
        )!!
        assertFalse(f.url!!, Regex("ABCDE|FGHIJ|KLMNO").containsMatchIn(f.url!!))
        assertFalse(f.title!!, Regex("ABCDE|FGHIJ|KLMNO").containsMatchIn(f.title!!))
        assertFalse(f.text!!, Regex("AB12C|DE34F|GH56I|JK78L").containsMatchIn(f.text!!))
        assertTrue(f.text!!.contains("deja utilise"))
        assertTrue(f.url!!.startsWith("https://www.gog.com/redeem/"))
    }

    @Test
    fun aTokenLikePathSegmentIsMaskedButAGameNameIsNot() {
        val f = FailureReport.of(
            Verdicts.FAILURE, null,
            page("https://store.epicgames.com/p/out-of-sight-b96ca8/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/1234567890123"), now = 1,
        )!!
        assertTrue(f.url!!, f.url!!.contains("/p/out-of-sight-b96ca8/"))
        assertFalse(f.url!!, f.url!!.contains("a1b2c3d4e5f6"))
        assertFalse(f.url!!, f.url!!.contains("1234567890123"))
    }

    @Test
    fun ordinaryUppercaseOrHyphenatedNamesAreNotDamaged() {
        val f = FailureReport.of(Verdicts.FAILURE, null, page("https://x.test/a", "COUNTER-STRIKE 2", "FREE-TO-PLAY now. Spider-Man 2 and X-COM"), now = 1)!!
        assertEquals("COUNTER-STRIKE 2", f.title)
        assertEquals("FREE-TO-PLAY now. Spider-Man 2 and X-COM", f.text)
    }
}
