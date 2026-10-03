package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.OwnedGame
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.obj
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
 * GOG (1.24.0) : la liste de la bibliotheque accepte une recherche, avec TA session (celle de la page de
 * connexion de l'appli) -- une lecture, rien de modifie.
 *
 * EPIC (1.26.0) : l'historique des commandes du compte, au plus [EPIC_PAGES] pages, lu UNE fois par passage de
 * recuperation. Un jeu offert deja reclame y figure comme une commande a zero ; on le reconnait a
 * l'identifiant de l'offre ou a un titre identique. Epic peut repondre autre chose que du JSON (verification,
 * mur anti-robot -- OkHttp n'est pas un navigateur) : c'est alors « on ne sait pas ».
 *
 * STEAM n'est pas ici : sa liste de jeux possedes est lue a chaque veille et ecarte l'offre avant meme qu'elle
 * soit candidate (Rules). AMAZON n'a pas d'adresse que l'on sache lire : la page tranche comme avant.
 *
 * Aucune de ces adresses n'a ete mesuree avec une session d'ici : une reponse illisible, ou une recherche que
 * le magasin ignorerait, ne prouve RIEN et ne bloque RIEN. Chaque lecture est notee (voir [Reading]) pour que la
 * page « Sante » dise si le magasin se laisse lire.
 *
 * LA PRUDENCE EST LE CHOIX : un faux « deja a toi » fait RATER un jeu offert, un onglet de trop ne
 * coute qu'un onglet. Le titre doit etre IDENTIQUE (editions et casse pres) :
 * « Civilization » n'est pas « Civilization VI ».
 */
object OwnedCheck {
    const val GOG_LIBRARY_URL = "https://www.gog.com/account/getFilteredProducts"
    const val TIMEOUT_MS = 15_000L

    const val EPIC_ORDERS_URL = "https://accounts.epicgames.com/account/v2/payment/ajaxGetOrderHistory"

    /** Pages de l'historique Epic lues au plus par passage : les derniers mois, pas une bibliotheque. */
    const val EPIC_PAGES = 3

    /** Les magasins dont on sait interroger le compte. */
    val ORACLE_STORES = setOf(Stores.GOG, Stores.EPIC)

    /** Ce qu'une lecture du compte a donne : le magasin a repondu d'une forme lisible, ou non. */
    enum class Reading { READ, UNREADABLE }

    /** Une commande qui ANNULE une acquisition (comme collection-import.js). */
    private val UNDONE = Regex("refund|chargeback|revok|cancel", RegexOption.IGNORE_CASE)

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

    /** Une page de l'historique des commandes Epic. */
    data class EpicPage(val offerIds: List<String>, val titles: List<String>, val next: String?)

    fun epicPageUrl(token: String?): String =
        "$EPIC_ORDERS_URL?sortDir=DESC&sortBy=DATE&locale=en-US" +
            (if (token.isNullOrEmpty()) "" else "&nextPageToken=" + java.net.URLEncoder.encode(token, "UTF-8"))

    /** Une page de commandes Epic, ou null si elle est illisible (= « on ne sait pas »). Rembourse ou annule : ecarte. */
    fun readEpicOrders(body: String?): EpicPage? {
        val json = parseJson(body)
        val orders = json["orders"].arr ?: return null
        val ids = ArrayList<String>()
        val titles = ArrayList<String>()
        for (o in orders) {
            if (o.obj == null) continue
            val kind = listOf("orderType", "orderStatus", "status").joinToString(" ") { o[it].str.orEmpty() }
            if (UNDONE.containsMatchIn(kind)) continue
            for (item in o["items"].arr.orEmpty()) {
                if (item.obj == null) continue
                item["offerId"].str?.takeIf { s -> s.isNotEmpty() }?.let(ids::add)
                item["description"].str?.takeIf { s -> s.isNotEmpty() }?.let(titles::add)
            }
        }
        val next = json["nextPageToken"].str?.takeIf { it.isNotEmpty() }
        return EpicPage(ids.take(2000), titles.take(2000), next)
    }

    /** Les commandes Epic lues : `readable` faux = aucune page ne s'est lue. */
    data class EpicBook(val readable: Boolean, val offerIds: Set<String>, val titles: List<String>, val pages: Int)

    /** Une table par passage de recuperation : l'historique Epic se lit UNE fois, pas une fois par offre. */
    class Memo { var epic: EpicBook? = null }

    /**
     * Les commandes Epic du compte. Une page apres la premiere qui ne se lit pas arrete la lecture sans
     * invalider ce qu'on a lu : c'est vrai, et ce qu'on n'a pas lu n'est simplement pas dit.
     */
    suspend fun epicBook(fetcher: Fetcher, memo: Memo? = null, onReading: (suspend (Reading) -> Unit)? = null): EpicBook {
        memo?.epic?.let { return it }
        val ids = LinkedHashSet<String>()
        val titles = ArrayList<String>()
        val seen = HashSet<String>()
        var token: String? = null
        var pages = 0
        for (i in 0 until EPIC_PAGES) {
            val r = withTimeoutOrNull(TIMEOUT_MS) { fetcher.get(epicPageUrl(token), withCookies = true) }
            val page = if (r != null && r.ok) readEpicOrders(r.body) else null
            if (page == null) break
            pages++
            ids += page.offerIds
            titles += page.titles
            val next = page.next
            if (next == null || !seen.add(next)) break
            token = next
        }
        val book = EpicBook(pages > 0, ids, titles, pages)
        memo?.epic = book
        runCatching { onReading?.invoke(if (book.readable) Reading.READ else Reading.UNREADABLE) }
        return book
    }

    /**
     * La reponse du compte pour une offre, ou null quand on ne sait pas (autre magasin, session absente,
     * reponse illisible, recherche sans resultat). Jamais « pas a toi » : l'absence d'un titre dans une
     * recherche dont on ne maitrise pas le filtre ne prouve pas qu'il manque. Ne leve jamais.
     *
     * `memo` evite de relire l'historique Epic pour chaque offre ; `onReading` apprend si le magasin s'est laisse lire.
     */
    suspend fun accountOwns(
        fetcher: Fetcher,
        o: Offer,
        owned: Map<String, OwnedGame> = emptyMap(),
        memo: Memo? = null,
        onReading: (suspend (Reading) -> Unit)? = null,
    ): Proof? = try {
        if (o.store !in ORACLE_STORES || o.title.isBlank()) null
        else if (collectionHas(owned, o.store, o.title)) Proof("collection", "deja dans ta collection importee")
        else if (o.store == Stores.EPIC) {
            val book = epicBook(fetcher, memo, onReading)
            val sameOffer = o.source == "epic-api" && o.sourceId != null && o.sourceId in book.offerIds
            if (book.readable && (sameOffer || listHas(o.title, book.titles))) Proof("account", "deja dans l'historique des commandes de ton compte Epic") else null
        } else {
            val r = withTimeoutOrNull(TIMEOUT_MS) { fetcher.get(gogSearchUrl(o.title), withCookies = true) }
            val titles = if (r != null && r.ok) readSearch(r.body) else null
            runCatching { onReading?.invoke(if (titles != null) Reading.READ else Reading.UNREADABLE) }
            if (titles != null && listHas(o.title, titles)) Proof("account", "deja dans la bibliotheque de ton compte GOG") else null
        }
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}
