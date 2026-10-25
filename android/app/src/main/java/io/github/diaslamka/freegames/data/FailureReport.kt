package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.Attempt
import io.github.diaslamka.freegames.model.Failure
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.str
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * Le rapport d'echec (1.37.0) : ce que la page montrait quand une recuperation a echoue -- le meme extrait que garde l'extension
 * (watch/failure-report.js). Le moteur, le meme des deux cotes, le joint au message du verdict ; il est NETTOYE avant d'etre garde :
 * l'adresse perd ses parametres (ils portent des jetons), le texte perd les adresses electroniques et les longues suites de chiffres
 * ou de signes. Trois cents caracteres : de quoi lire une phrase, pas une page. Il reste sur ce telephone (jamais dans la sauvegarde).
 */
object FailureReport {
    const val MAX_TEXT = 300
    private const val MAX_TITLE = 100
    private const val MAX_URL = 200
    private const val MAX_DETAILS = 200

    /** Les verdicts qui demandent un regard : ce sont eux qui laissent un rapport. */
    private val VERDICTS = setOf(Verdicts.FAILURE, Verdicts.CHALLENGE, Verdicts.LOGIN, Verdicts.TEACH)

    private val SPACES = Regex("\\s+")
    private val EMAIL = Regex("[^\\s@<>()]+@[^\\s@<>()]+\\.[^\\s@<>()]+")
    private val LONG_DIGITS = Regex("\\d{8,}")
    private val LONG_TOKEN = Regex("\\b[A-Za-z0-9_-]{24,}\\b")

    /** Un code d'echange (GOG, Luna) : trois groupes de quatre signes ou plus, majuscules et chiffres, separes par des tirets. */
    private val CODE = Regex("\\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}\\b")

    fun isFailure(verdict: String?): Boolean = verdict != null && verdict in VERDICTS

    private fun tidy(value: String?, max: Int): String = value.orEmpty()
        .replace(SPACES, " ").trim()
        .replace(EMAIL, "[email]").replace(CODE, "[code]").replace(LONG_DIGITS, "[nombre]").replace(LONG_TOKEN, "[jeton]")
        .take(max).trim()

    private fun tidySegment(segment: String): String {
        val s = try { java.net.URLDecoder.decode(segment, "UTF-8") } catch (_: Exception) { segment }
        return s.replace(EMAIL, "[email]").replace(CODE, "[code]").replace(LONG_DIGITS, "[nombre]").replace(LONG_TOKEN, "[jeton]")
    }

    /** L'adresse sans parametres ni ancre, ou null si ce n'est pas une adresse web. */
    private fun bareUrl(value: String?): String? {
        val uri = try { java.net.URI(value ?: return null) } catch (_: Exception) { return null }
        val scheme = uri.scheme?.lowercase()
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host ?: return null
        val port = if (uri.port > 0) ":${uri.port}" else ""
        // Le chemin peut porter un code ou un jeton (/redeem/CODE, /orders/123456789) : chaque segment passe par le meme nettoyage.
        val path = uri.rawPath.orEmpty().split("/").joinToString("/") { if (it.isEmpty()) it else tidySegment(it) }
        return "$scheme://$host$port$path".take(MAX_URL)
    }

    /** Le rapport a garder avec l'essai, ou null : un verdict sans echec efface le precedent. `page` : ce que le moteur a joint. */
    fun of(verdict: String?, details: String?, page: JsonObject?, now: Long, shot: String? = null): Failure? {
        if (!isFailure(verdict)) return null
        val url = bareUrl(page["url"].str)
        return Failure(
            at = now, verdict = verdict!!,
            details = details?.takeIf { it.isNotEmpty() }?.take(MAX_DETAILS),
            url = url,
            title = if (url != null) tidy(page["title"].str, MAX_TITLE).ifEmpty { null } else null,
            text = if (url != null) tidy(page["text"].str, MAX_TEXT).ifEmpty { null } else null,
            shot = shot,
        )
    }

    private fun iso(ms: Long): String = Instant.ofEpochMilli(ms).truncatedTo(ChronoUnit.SECONDS).toString()

    /** Le texte a coller dans un message : tout ce qu'il faut pour comprendre, rien d'autre. */
    fun report(offer: Offer, attempt: Attempt?, version: String, now: Long): String {
        val f = attempt?.failure
        val lines = mutableListOf(
            "Free Games Claimer -- rapport d'echec",
            "version : $version (appli)",
            "date : ${iso(now)}",
            "jeu : ${offer.shownTitle} (${offer.store})",
            "verdict : ${attempt?.verdict ?: f?.verdict ?: "?"}" + (attempt?.takeIf { it.count > 0 }?.let { " (essai ${it.count})" } ?: ""),
        )
        (f?.details ?: attempt?.details)?.let { lines += "motif : $it" }
        if (f != null) lines += "constate : ${iso(f.at)}"
        if (f?.url != null) {
            lines += "page : ${f.url}"
            f.title?.let { lines += "titre de la page : $it" }
            lines += "texte de la page : ${f.text ?: "(vide)"}"
        } else {
            lines += "page : aucune page lue (l'echec s'est produit avant, ou hors d'une page)"
        }
        return lines.joinToString("\n")
    }
}
