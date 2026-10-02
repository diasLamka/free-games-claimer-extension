package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.coroutines.withTimeoutOrNull

/**
 * « Est-ce deja a toi ? » -- demande au MAGASIN, avant d'ouvrir une page (1.24.0). Copie de
 * watch/owned-check.js.
 *
 * Un jeu offert se recupere une fois. Le moteur sait le reconnaitre quand la page le dit
 * (« Dans la bibliotheque »), mais une page qui ne dit plus que « Jouer » le laissait sans reponse,
 * et la question « montre-moi le bouton » revenait sans fin pour un jeu qu'on avait deja.
 *
 * SEUL GOG a, pour l'instant, une adresse qui repond : la liste de la bibliotheque accepte une
 * recherche, avec TA session (celle de la page de connexion de l'appli) -- une lecture, rien de
 * modifie. Jamais mesuree avec une session d'ici : une reponse illisible, ou une recherche que le
 * magasin ignorerait, ne prouve RIEN et ne bloque RIEN.
 *
 * LA PRUDENCE EST LE CHOIX : un faux « deja a toi » fait RATER un jeu offert, un onglet de trop ne
 * coute qu'un onglet. Le titre doit etre IDENTIQUE (editions et casse pres) :
 * « Civilization » n'est pas « Civilization VI ».
 */
object OwnedCheck {
    const val GOG_LIBRARY_URL = "https://www.gog.com/account/getFilteredProducts"
    const val TIMEOUT_MS = 15_000L

    /** Les magasins dont on sait interroger le compte. */
    val ORACLE_STORES = setOf(Stores.GOG)

    private val EDITION = Regex(
        "\\b(standard|deluxe|ultimate|definitive|complete|goty|game of the year|gold|premium|enhanced|remastered|anniversary|special|collector s|digital)\\s+edition\\b",
    )
    private val SPACES = Regex("\\s+")
    private val PARENS = Regex("\\s*\\([^)]*\\)\\s*")
    private val GIVEAWAY = Regex("\\b(key\\s+)?giveaway\\b", RegexOption.IGNORE_CASE)

    private fun core(title: String?): String = Titles.normalise(title).replace(EDITION, " ").replace(SPACES, " ").trim()

    /** Ces deux titres designent-ils EXACTEMENT le meme jeu ? */
    fun sameTitle(a: String?, b: String?): Boolean {
        val x = core(a)
        return x.isNotEmpty() && x == core(b)
    }

    /** L'adresse de recherche dans la bibliotheque GOG : une page, le titre nettoye et borne. */
    fun gogSearchUrl(title: String?): String {
        val q = title.orEmpty().replace(PARENS, " ").replace(GIVEAWAY, " ").replace(SPACES, " ").trim().take(80)
        return "$GOG_LIBRARY_URL?mediaType=1&sortBy=title&page=1&search=" + java.net.URLEncoder.encode(q, "UTF-8").replace("+", "%20")
    }

    /** Les titres d'une reponse de la bibliotheque, ou null si elle est illisible (= « on ne sait pas »). */
    fun readSearch(body: String?): List<String>? {
        val products = parseJson(body)["products"].arr ?: return null
        return products.mapNotNull { it["title"].str }.filter { it.isNotEmpty() }.take(200)
    }

    fun listHas(title: String?, titles: List<String>): Boolean = titles.any { sameTitle(it, title) }

    /** La collection importee (« Ma collection ») dit-elle deja que ce titre est a toi ? */
    fun collectionHas(owned: Map<String, OwnedGame>, store: String, title: String?): Boolean =
        owned.values.any { it.store == store && sameTitle(it.title, title) }

    /** Ce que le magasin a dit : d'ou, et en quelques mots. */
    data class Proof(val via: String, val note: String)

    /**
     * La reponse du compte pour une offre, ou null quand on ne sait pas (autre magasin, session absente,
     * reponse illisible, recherche sans resultat). Jamais « pas a toi » : l'absence d'un titre dans une
     * recherche dont on ne maitrise pas le filtre ne prouve pas qu'il manque. Ne leve jamais.
     */
    suspend fun accountOwns(fetcher: Fetcher, o: Offer, owned: Map<String, OwnedGame> = emptyMap()): Proof? = try {
        if (o.store !in ORACLE_STORES || o.title.isBlank()) null
        else if (collectionHas(owned, o.store, o.title)) Proof("collection", "deja dans ta collection importee")
        else {
            val r = withTimeoutOrNull(TIMEOUT_MS) { fetcher.get(gogSearchUrl(o.title), withCookies = true) }
            val titles = if (r != null && r.ok) readSearch(r.body) else null
            if (titles != null && listHas(o.title, titles)) Proof("account", "deja dans la bibliotheque de ton compte GOG") else null
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}
