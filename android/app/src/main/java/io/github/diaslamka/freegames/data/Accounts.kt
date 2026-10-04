package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.Localize
import io.github.diaslamka.freegames.sources.SteamSource
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.bool
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str

/**
 * Les comptes des magasins : ou se connecter, et comment savoir si on l'est.
 * Rien n'est lu sans que l'utilisateur se soit connecte dans l'appli : ce
 * sont les cookies de ces pages-la, et eux seuls.
 */
object Accounts {
    const val OK = "ok"
    const val LOGGED_OUT = "logged_out"
    const val PRESENT = "present"
    const val UNKNOWN = "unknown"

    /** `AccountState.via` : le verdict vient d'une vraie page du magasin, pas d'une lecture de cookies. */
    const val PAGE = "page"

    val STORES = listOf(Stores.EPIC, Stores.GOG, Stores.AMAZON, Stores.STEAM)

    fun loginUrl(store: String, country: String?): String = when (store) {
        Stores.EPIC -> "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fstore.epicgames.com%2F"
        Stores.GOG -> Localize.url("https://www.gog.com/#openlogin", country) ?: "https://www.gog.com/#openlogin"
        Stores.AMAZON -> "https://${Countries.lunaHost(country)}/claims/home"
        Stores.STEAM -> "https://store.steampowered.com/login/"
        else -> "https://store.epicgames.com/"
    }

    /** Epic envoie par e-mail de quoi poser un mot de passe, meme a un compte cree avec Google. */
    const val EPIC_SET_PASSWORD = "https://www.epicgames.com/id/login/forgot-password"

    /**
     * Le fournisseur d'identite qui REFUSE les pages integrees a une appli, si
     * `url` est chez lui. Google l'interdit depuis 2021 (OAuth dans une
     * WebView), Facebook aussi : la page de connexion s'arrete avant de les
     * charger, et l'appli explique quoi faire. Rien n'est envoye a ces
     * fournisseurs -- et surtout pas sous un deguisement de navigateur.
     */
    fun refusedProvider(url: String?): String? {
        val u = runCatching { java.net.URI(url ?: return null) }.getOrNull() ?: return null
        val host = u.host?.lowercase() ?: return null
        val path = u.path.orEmpty().lowercase()
        return when {
            host == "accounts.google.com" || host.endsWith(".accounts.google.com") -> "Google"
            (host == "google.com" || host.endsWith(".google.com")) && (path.startsWith("/o/oauth2") || path.startsWith("/signin")) -> "Google"
            (host == "facebook.com" || host.endsWith(".facebook.com")) &&
                (path.contains("/dialog/oauth") || path.startsWith("/login")) -> "Facebook"
            else -> null
        }
    }

    /** Les domaines dont les cookies font la session : pour la bonne page d'accueil. */
    fun homeUrl(store: String, country: String?): String = when (store) {
        Stores.EPIC -> Localize.url("https://store.epicgames.com/", country) ?: "https://store.epicgames.com/"
        Stores.GOG -> Localize.url("https://www.gog.com/", country) ?: "https://www.gog.com/"
        Stores.AMAZON -> "https://${Countries.lunaHost(country)}/claims/home"
        Stores.STEAM -> "https://store.steampowered.com/"
        else -> "https://store.epicgames.com/"
    }

    /**
     * La page qui tranche, quand la lecture des cookies dit « pas connecte » (1.17.0).
     *
     * Steam et Epic gardent la session dans des jetons qui expirent en quelques
     * heures ; c'est la PAGE du magasin qui les renouvelle en se chargeant.
     * Lire les cookies ou appeler l'API sans avoir charge de page voit donc un
     * jeton expire et conclut « deconnecte » a quelqu'un qui est connecte --
     * jusqu'au jour ou il ouvre le magasin lui-meme. Charger la page, c'est ce
     * qu'il faisait a la main. Steam renvoie vers /login/ sans session (mesure) ;
     * Epic vers /id/login.
     */
    fun pageUrl(store: String): String? = when (store) {
        Stores.STEAM -> "https://store.steampowered.com/account/"
        Stores.EPIC -> "https://www.epicgames.com/account/personal"
        else -> null
    }

    /** Combien attendre, apres le chargement, qu'un routeur JS renvoie vers la connexion. */
    fun pageVerdictSettle(store: String): Long = if (store == Stores.EPIC) 4_000L else 2_000L

    private val CHALLENGE = Regex("just a moment|un instant|attention required|verify you are human|access denied|captcha")

    /**
     * Ce que dit l'adresse ou la page a fini par atterrir. Pure.
     *
     * Une redirection vers la connexion est sans ambiguite ; rester sur la page
     * du compte dit « connecte » ; tout le reste (defi anti-robot, controle
     * d'age, page inattendue) ne dit rien : `UNKNOWN`, jamais `LOGGED_OUT`.
     */
    fun pageVerdict(store: String, landed: String?, title: String?): String {
        val u = runCatching { java.net.URI(landed ?: return UNKNOWN) }.getOrNull() ?: return UNKNOWN
        val host = u.host?.lowercase() ?: return UNKNOWN
        val path = u.path.orEmpty().lowercase()
        if (CHALLENGE.containsMatchIn(title.orEmpty().lowercase())) return UNKNOWN
        return when (store) {
            Stores.STEAM -> when {
                host == "login.steampowered.com" -> LOGGED_OUT
                host == "store.steampowered.com" && path.startsWith("/login") -> LOGGED_OUT
                host == "store.steampowered.com" && path.startsWith("/account") -> OK
                else -> UNKNOWN
            }
            Stores.EPIC -> when {
                !host.endsWith("epicgames.com") -> UNKNOWN
                path.contains("/login") -> LOGGED_OUT
                path.startsWith("/account") -> OK
                else -> UNKNOWN
            }
            else -> UNKNOWN
        }
    }

    private fun hasCookie(cookies: (String) -> String?, url: String, vararg names: String): Boolean {
        val jar = cookies(url).orEmpty()
        return names.any { n -> jar.split(';').any { it.trim().startsWith("$n=") && it.trim().length > n.length + 1 } }
    }

    /**
     * Ce que la session dit d'elle-meme, et ce que Steam dit posseder. Les
     * cookies sont ceux du compte principal, ou ceux du profil d'un membre de
     * la famille (1.9.0).
     */
    suspend fun check(
        store: String,
        country: String?,
        now: Long,
        http: io.github.diaslamka.freegames.sources.Fetcher? = null,
        cookies: (String) -> String? = { Graph.cookiesFor(it) },
    ): Pair<AccountState, Set<String>?> = when (store) {
        Stores.STEAM -> try {
            val r = (http ?: Graph.http).get("${SteamSource.OWNED_URL}?t=$now", withCookies = true)
            val owned = if (r.ok) SteamSource.parseOwned(r.body) else null
            when {
                owned == null -> AccountState(UNKNOWN, now) to null
                owned.first.isEmpty() && owned.second.isEmpty() -> AccountState(LOGGED_OUT, now) to null
                else -> AccountState(OK, now) to owned.first
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            AccountState(UNKNOWN, now) to null
        }
        Stores.GOG -> try {
            val r = (http ?: Graph.http).get("https://www.gog.com/userData.json", withCookies = true)
            val j = parseJson(r.body)
            when (j["isLoggedIn"].bool) {
                true -> AccountState(OK, now, j["username"].str) to null
                false -> AccountState(LOGGED_OUT, now) to null
                null -> AccountState(UNKNOWN, now) to null
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            AccountState(UNKNOWN, now) to null
        }
        Stores.EPIC -> AccountState(
            if (hasCookie(cookies, "https://www.epicgames.com/", "EPIC_EG1", "EPIC_SSO", "EPIC_BEARER_TOKEN") ||
                hasCookie(cookies, "https://store.epicgames.com/", "EPIC_EG1", "EPIC_SSO", "EPIC_BEARER_TOKEN")) PRESENT else LOGGED_OUT,
            now,
        ) to null
        Stores.AMAZON -> {
            val host = Countries.lunaHost(country).removePrefix("luna.")
            AccountState(
                if (hasCookie(cookies, "https://www.$host/", "at-main", "sess-at-main", "at-acbfr", "at-acbde", "at-acbuk") ||
                    hasCookie(cookies, "https://luna.$host/", "at-main", "sess-at-main")) PRESENT else LOGGED_OUT,
                now,
            ) to null
        }
        else -> AccountState(UNKNOWN, now) to null
    }
}
