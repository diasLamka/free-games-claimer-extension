package io.github.diaslamka.freegames.sources

/** Une reponse HTTP, lue en entier. */
data class HttpResult(val code: Int, val body: String, val finalUrl: String? = null) {
    val ok: Boolean get() = code in 200..299
}

/**
 * Ce dont les sources ont besoin du reseau, et rien de plus : les tests le
 * remplacent par les captures de l'extension.
 *
 * `withCookies` joint la session de l'utilisateur -- celle des pages de
 * connexion de l'appli. Les sources de decouverte ne l'utilisent jamais :
 * une lecture anonyme rend la meme liste a tout le monde.
 */
interface Fetcher {
    suspend fun get(url: String, withCookies: Boolean = false, accept: String = "application/json"): HttpResult
}

/** Ce qu'une source a trouve. `ok` faux : la liste n'est pas a croire. */
data class SourceResult(
    val name: String,
    val offers: List<io.github.diaslamka.freegames.model.Offer> = emptyList(),
    val upcoming: List<io.github.diaslamka.freegames.model.Upcoming> = emptyList(),
    val errors: List<String> = emptyList(),
    val ok: Boolean = errors.isEmpty(),
)
