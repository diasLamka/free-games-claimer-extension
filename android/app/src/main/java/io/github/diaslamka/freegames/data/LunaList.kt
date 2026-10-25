package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.str
import kotlinx.serialization.json.JsonElement

/**
 * La liste des offres Luna (1.39.0), comme la source `luna` de l'extension (watch/sources/luna.js).
 *
 * Luna n'a ni API publique ni liste lisible hors du compte : aucune source ne disait a la veille ce qu'il y avait a
 * prendre, donc la recuperation de fond n'ouvrait jamais sa page -- la ou Epic et GOG, qui ont une API, etaient pris.
 * L'appli ouvre la liste sans ecran et demande au moteur de la LIRE (jamais de clic : `readLunaList`,
 * src/core/31-bootstrap.js) ; chaque fiche devient une offre, prise ensuite comme n'importe quelle autre.
 *
 * Tout ce que dit la page est borne ici, a l'arrivee : le moteur tourne dans une page qu'Amazon controle.
 */
object LunaList {
    const val NAME = "luna"

    /** La liste des jeux ; l'hote est ramene a celui du pays choisi par `Localize.url`. */
    const val CLAIMS_URL = "https://luna.amazon.com/claims/home?filter=Game&g=s"

    /** Une page de compte, lue dans une vraie page : pas plus d'une fois par heure, reussie ou non. */
    const val EVERY_MS = 3_600_000L

    const val MAX_CARDS = 60
    private const val MAX_TITLE = 120
    private const val MAX_ID = 200
    private val LUNA_PAGE = Regex("^https://luna\\.amazon\\.[a-z.]+/", RegexOption.IGNORE_CASE)

    enum class Status {
        /** La liste a ete lue. */
        OK,

        /** La page est lue mais ne montre aucune carte : un compte sans offre, ou une page qui a change. */
        EMPTY,

        /** Amazon demande la connexion. */
        LOGIN,

        /** Un controle de securite, que l'appli ne resout jamais. */
        CHALLENGE,
        WRONG_PAGE,

        /** Le moteur n'a pas repondu, ou sa reponse n'est pas celle qu'on attend. */
        SILENT,
    }

    data class Result(val status: Status, val offers: List<Offer> = emptyList()) {
        /** Lue pour de bon : la liste est la liste ENTIERE (rien de plus a conclure d'une page vide ou illisible). */
        val ok: Boolean get() = status == Status.OK || status == Status.EMPTY

        /** Pourquoi la liste n'a pas ete lue, pour la page Sante ; null quand elle l'a ete. */
        val error: String?
            get() = when (status) {
                Status.LOGIN -> "session perdue (connexion a refaire)"
                Status.CHALLENGE -> "verification de securite demandee, que l'appli ne resout jamais"
                Status.WRONG_PAGE -> "la page ouverte n'est pas la liste des offres"
                Status.SILENT -> "le moteur n'a pas rendu la liste"
                else -> null
            }
    }

    private fun short(s: String?, n: Int) = s.orEmpty().replace(Regex("\\s+"), " ").trim().take(n)

    /** Un condense stable des cartes a bouton direct : une autre liste, une autre cle (comme `fingerprint` de luna.js). */
    private fun fingerprint(ids: List<String>): String {
        var h = 5381L
        for (cp in ids.sorted().joinToString("|").codePoints().toArray()) h = ((h * 33) xor cp.toLong()) and 0xFFFFFFFFL
        return java.lang.Long.toString(h, 36)
    }

    /**
     * La reponse du moteur (`fgc-liste`) en offres.
     *
     *  - une fiche a prendre : une offre, avec la page de la fiche ;
     *  - une carte deja prise : aucune offre (rien a rouvrir) ;
     *  - les cartes a BOUTON direct, sans fiche : UNE offre, sur la liste -- le moteur les prend toutes d'un passage.
     */
    fun parse(message: JsonElement?, now: Long): Result {
        val verdict = message["verdict"].str
        val status = when (verdict) {
            "ok" -> Status.OK
            "empty" -> Status.EMPTY
            "needs_login" -> Status.LOGIN
            "challenge" -> Status.CHALLENGE
            "wrong_page" -> Status.WRONG_PAGE
            else -> Status.SILENT
        }
        if (status != Status.OK) return Result(status)

        val offers = ArrayList<Offer>()
        val direct = ArrayList<Pair<String, String>>()
        for (raw in message["offers"].arr.orEmpty().take(MAX_CARDS)) {
            val title = short(raw["title"].str, MAX_TITLE)
            val id = short(raw["id"].str, MAX_ID)
            if (title.isEmpty() || id.isEmpty()) continue
            if (raw["collected"].bool == true) continue
            if (raw["hasButton"].bool == true) {
                direct += id to title
                continue
            }
            val url = raw["url"].str?.takeIf { LUNA_PAGE.containsMatchIn(it) }?.substringBefore('?')?.substringBefore('#') ?: continue
            offers += make(id, title, url, now)
        }
        if (direct.isNotEmpty()) {
            val more = if (direct.size > 1) " (+${direct.size - 1})" else ""
            offers += make("direct-${fingerprint(direct.map { it.first })}", short(direct[0].second + more, MAX_TITLE), CLAIMS_URL, now)
        }
        return Result(Status.OK, offers)
    }

    private fun make(id: String, title: String, url: String, now: Long) = Offer(
        key = Offer.keyFor(Stores.AMAZON, id, title),
        source = NAME,
        store = Stores.AMAZON,
        storeId = id,
        sourceId = id,
        title = title,
        url = url,
        category = "game",
        keepable = true,
        firstSeen = now,
        lastSeen = now,
    )

    /**
     * Faut-il lire la liste maintenant ? Amazon laisse actif dans l'appli, une session qu'on ne sait pas perdue, et
     * la derniere lecture -- reussie ou non -- date d'une heure au moins. `force` : un geste de l'utilisateur
     * (« Tout recuperer ») passe outre l'heure, jamais outre le reste.
     */
    fun due(s: AppState, now: Long, force: Boolean = false): Boolean {
        if (!s.settings.claimAmazon) return false
        if (s.accounts[Stores.AMAZON]?.status == Accounts.LOGGED_OUT) return false
        if (force) return true
        val last = s.sources[NAME]?.at ?: return true
        return now - last >= EVERY_MS
    }

    /**
     * Les offres de l'etat apres une lecture. Les autres sources ne bougent pas. Une lecture COMPLETE remplace les
     * offres Luna : celles qui ont quitte la liste sont terminees. Une lecture incomplete n'efface rien.
     */
    fun merge(previous: Map<String, Offer>, found: List<Offer>, complete: Boolean, now: Long): Map<String, Offer> {
        val out = LinkedHashMap<String, Offer>()
        for (o in previous.values) if (!(complete && o.source == NAME)) out[o.key] = o
        for (o in found) out[o.key] = o.copy(firstSeen = previous[o.key]?.firstSeen ?: now, lastSeen = now)
        return out
    }
}
