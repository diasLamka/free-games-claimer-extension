package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.FailureReport
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.Failure
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le rapport d'echec (1.37.0) : ce que la page montrait quand une recuperation a echoue -- le meme extrait que l'extension garde
 * (watch/failure-report.js), nettoye avant d'etre garde : ni adresse electronique, ni longue suite de chiffres ou de signes, ni
 * parametres d'adresse. Le moteur est le meme des deux cotes et joint la page au message du verdict.
 */
class FailureReportTest {
    private fun page(url: String = "https://www.gog.com/redeem?token=SECRET#f", title: String = "GOG", text: String = "rien de net") =
        buildJsonObject { put("url", url); put("title", title); put("text", text) }

    @Test
    fun onlyTheVerdictsThatAskForALookLeaveAReport() {
        for (v in listOf(Verdicts.FAILURE, Verdicts.CHALLENGE, Verdicts.LOGIN, Verdicts.TEACH)) assertTrue(v, FailureReport.isFailure(v))
        for (v in listOf(Verdicts.CLAIMED, Verdicts.REDEEMED, Verdicts.ALREADY_REDEEMED, Verdicts.OWNED, Verdicts.GONE, Verdicts.SKIPPED)) assertFalse(v, FailureReport.isFailure(v))
        assertFalse(FailureReport.isFailure(null))
    }

    @Test
    fun theAddressLosesItsParametersAndTheTextItsPrivateParts() {
        val f = FailureReport.of(
            Verdicts.FAILURE, "delai depasse",
            page(text = "Connecte en tant que moi@exemple.fr commande 1234567890123 jeton a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4 fin"), now = 5,
        )!!
        assertEquals("https://www.gog.com/redeem", f.url)
        assertFalse(f.text!!.contains("@"))
        assertFalse(f.text!!.contains("1234567890123"))
        assertFalse(f.text!!.contains("a1b2c3d4e5f6a1b2c3d4e5f6"))
        assertTrue(f.text!!.contains("fin"))
        assertEquals(5L, f.at)
    }

    @Test
    fun anOrdinarySentenceIsNotDamaged() {
        val phrase = "Code redeemed successfully! You've successfully added 1 item to your GOG account. Warbreeds - Amazon Luna"
        assertEquals(phrase, FailureReport.of(Verdicts.FAILURE, null, page(text = phrase), now = 1)!!.text)
    }

    @Test
    fun theTextIsBoundedAndWhitespaceCollapsed() {
        val f = FailureReport.of(Verdicts.FAILURE, null, page(text = "mot   \n\n suivant ".repeat(300)), now = 1)!!
        assertTrue(f.text!!.length <= FailureReport.MAX_TEXT)
        assertFalse(Regex("\\s{2,}").containsMatchIn(f.text!!))
    }

    @Test
    fun aMissingOrOddPageStillKeepsTheReason() {
        val sans = FailureReport.of(Verdicts.CHALLENGE, "defi", null, now = 7)!!
        assertNull(sans.url)
        assertNull(sans.text)
        assertEquals("defi", sans.details)
        val etrange = FailureReport.of(Verdicts.FAILURE, null, buildJsonObject { put("url", "javascript:alert(1)"); put("text", "x") }, now = 7)!!
        assertNull("une adresse qui n'est pas web est ecartee", etrange.url)
    }

    @Test
    fun aVerdictWithoutAFailureLeavesNothing() {
        assertNull(FailureReport.of(Verdicts.CLAIMED, null, page(), now = 1))
    }

    @Test
    fun theReportSaysWhatItTakesToUnderstand() {
        val offer = Offer(key = "gog:x", source = "s", store = Stores.GOG, storeId = "x", title = "WarBreeds")
        val failure = FailureReport.of(Verdicts.FAILURE, "delai depasse", page(text = "rien de net"), now = 1_790_000_000_000L)
        val attempt = Attempt(count = 3, verdict = Verdicts.FAILURE, failure = failure)
        val r = FailureReport.report(offer, attempt, version = "1.37.0", now = 1_790_000_100_000L)
        for (expected in listOf("1.37.0", "WarBreeds", "gog", "failed", "3", "delai depasse", "https://www.gog.com/redeem", "rien de net")) {
            assertTrue("manque : $expected\n$r", r.contains(expected))
        }
    }

    @Test
    fun aVerdictThatCountsNoAttemptDoesNotSayAttemptZero() {
        val offer = Offer(key = "epic:y", source = "s", store = Stores.EPIC, storeId = "y", title = "Jeu")
        val attempt = Attempt(count = 0, verdict = Verdicts.CHALLENGE, failure = FailureReport.of(Verdicts.CHALLENGE, null, null, now = 1))
        assertFalse(FailureReport.report(offer, attempt, version = "1.37.0", now = 2).contains("essai"))
    }

    @Test
    fun aReportWithoutAPageSaysSo() {
        val offer = Offer(key = "epic:y", source = "s", store = Stores.EPIC, storeId = "y", title = "Jeu")
        val attempt = Attempt(count = 1, verdict = Verdicts.CHALLENGE, failure = FailureReport.of(Verdicts.CHALLENGE, null, null, now = 1))
        assertTrue(FailureReport.report(offer, attempt, version = "1.37.0", now = 2).contains("aucune page"))
    }

    @Test
    fun theAttemptKeepsTheReportUntilASuccessClearsIt() {
        val failure = FailureReport.of(Verdicts.FAILURE, "x", page(), now = 1)
        assertNotNull(failure)
        val after = Rules.afterVerdict(Attempt(count = 1, verdict = Verdicts.FAILURE, failure = failure), Verdicts.CLAIMED, null, now = 2)
        assertNull("un succes efface le rapport precedent", after.failure)
    }

    /* Le signalement en un geste (1.45.0) : le meme ticket que l'extension (watch/failure-report.js, 2.118.0). */
    private val offerEpic = Offer(key = "epic:o", source = "s", store = Stores.EPIC, storeId = "o", title = "Out of Sight")

    private fun queryOf(url: String): Map<String, String> = url.substringAfter('?').split('&').associate {
        it.substringBefore('=') to java.net.URLDecoder.decode(it.substringAfter('='), "UTF-8")
    }

    @Test
    fun theIssueLinkOpensTheRepositoryFormFilledWithTheReport() {
        val failure = FailureReport.of(Verdicts.FAILURE, "bouton introuvable", page(text = "Obtenir"), now = 1)
        val attempt = Attempt(count = 2, verdict = Verdicts.FAILURE, failure = failure)
        val url = FailureReport.issueUrl(offerEpic, attempt, version = "1.45.0", now = 2)
        assertTrue(url, url.startsWith(FailureReport.ISSUES_URL + "?"))
        val q = queryOf(url)
        assertEquals("Echec de recuperation : Out of Sight (epic)", q["title"])
        assertTrue(q["body"]!!.contains(FailureReport.report(offerEpic, attempt, "1.45.0", 2)))
        assertTrue("la consigne de relecture", q["body"]!!.contains("ce ticket sera public"))
    }

    @Test
    fun specialCharactersSurviveTheRoundTrip() {
        val offer = offerEpic.copy(title = "Tom & Jerry #1 100% + caf\u00e9")
        val attempt = Attempt(count = 1, verdict = Verdicts.FAILURE, failure = FailureReport.of(Verdicts.FAILURE, "a&b=c#d+e%20f", null, now = 1))
        val q = queryOf(FailureReport.issueUrl(offer, attempt, "1.45.0", 2))
        assertTrue(q["title"]!!, q["title"]!!.contains("Tom & Jerry #1 100% + caf\u00e9"))
        assertTrue(q["body"]!!, q["body"]!!.contains("motif : a&b=c#d+e%20f"))
    }

    @Test
    fun aTooLongLinkLosesThePageTextFirstNeverTheGame() {
        val failure = Failure(at = 1, verdict = Verdicts.FAILURE, url = "https://store.epicgames.com/p/out-of-sight", text = "\u00e9".repeat(5000))
        val attempt = Attempt(count = 2, verdict = Verdicts.FAILURE, failure = failure)
        val url = FailureReport.issueUrl(offerEpic, attempt, "1.45.0", 2)
        assertTrue(url.length.toString(), url.length <= FailureReport.MAX_ISSUE_URL)
        val body = queryOf(url)["body"]!!
        assertTrue(body.contains("jeu : Out of Sight (epic)"))
        assertTrue(body.contains("verdict : failed"))
        assertTrue("l'adresse reste", body.contains("page : https://store.epicgames.com/p/out-of-sight"))
    }

    @Test
    fun threeBackticksDoNotBreakTheCodeBlock() {
        val attempt = Attempt(count = 1, verdict = Verdicts.FAILURE, failure = FailureReport.of(Verdicts.FAILURE, "avant ``` apres", null, now = 1))
        val body = queryOf(FailureReport.issueUrl(offerEpic, attempt, "1.45.0", 2))["body"]!!
        assertEquals("une ouverture et une fermeture, pas plus", 2, body.split("```").size - 1)
    }

    @Test
    fun withoutAFailureTheTicketStillOpensAndSaysNoPageWasRead() {
        val q = queryOf(FailureReport.issueUrl(offerEpic, null, "1.45.0", 2))
        assertEquals("Echec de recuperation : Out of Sight (epic)", q["title"])
        assertTrue(q["body"]!!.contains("aucune page"))
    }
}
