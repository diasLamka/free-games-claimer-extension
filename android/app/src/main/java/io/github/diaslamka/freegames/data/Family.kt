package io.github.diaslamka.freegames.data

import android.webkit.CookieManager
import android.webkit.WebView
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Member
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import java.util.concurrent.ConcurrentHashMap

/**
 * Toute la famille (1.9.0) : un seul telephone recupere pour plusieurs
 * comptes, chacun avec ses propres sessions.
 *
 * LA SEPARATION EST CELLE DE WEBVIEW. Depuis androidx.webkit 1.9, une page
 * peut vivre dans un PROFIL nomme, qui a ses cookies, son stockage, ses
 * service workers : se connecter a Epic dans le profil de Lea ne touche pas
 * la session du compte principal, et inversement. Il faut une « Android
 * System WebView » qui le sache (WebViewFeature.MULTI_PROFILE) ; sinon la
 * fonction ne s'ouvre pas, et l'appli dit pourquoi.
 *
 * Ce qui est a chacun : ses comptes, ses jeux, ses essais, la memoire du
 * moteur (l'historique qu'il ecrit). Ce qui est commun : les offres, les
 * reglages, les libelles appris. Ce qui reste au compte principal : Steam
 * (sa preuve passe par une lecture de bibliotheque avec la session, faite
 * pour un seul compte), le relais avec le PC, les souhaits.
 */
object Family {
    /** Les magasins qu'un membre recupere : ceux que joue le moteur. */
    val STORES = listOf(Stores.EPIC, Stores.GOG, Stores.AMAZON)
    const val MAX_MEMBERS = 6
    private const val PREFIX = "famille-"

    fun profileName(id: String) = PREFIX + id

    /** La WebView du telephone sait-elle separer les sessions ? */
    fun supported(): Boolean = runCatching { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }.getOrDefault(false)

    fun member(s: AppState, id: String?): Member? = id?.let { i -> s.family.firstOrNull { it.id == i } }

    /* --------------------------------------------------------- l'etat */

    /** Un nouveau membre. Rend l'etat inchange si le nom est vide ou deja pris. */
    fun add(s: AppState, name: String, now: Long): AppState {
        val n = name.trim().take(40)
        if (n.isEmpty() || s.family.size >= MAX_MEMBERS || s.family.any { it.name.equals(n, ignoreCase = true) }) return s
        var id = java.lang.Long.toString(now, 36)
        while (s.family.any { it.id == id }) id += "x"
        return s.copy(family = s.family + Member(id = id, name = n, createdAt = now))
    }

    fun remove(s: AppState, id: String): AppState = s.copy(family = s.family.filterNot { it.id == id })

    private fun change(s: AppState, id: String, f: (Member) -> Member): AppState =
        s.copy(family = s.family.map { if (it.id == id) f(it) else it })

    fun setAccount(s: AppState, id: String, store: String, a: AccountState): AppState =
        change(s, id) { it.copy(accounts = it.accounts + (store to a)) }

    /**
     * L'etat tel que le voit la recuperation pour ce membre : ses jeux, ses
     * essais, ses comptes -- et ni Steam, ni relais. Les regles (Rules.pending)
     * s'y appliquent telles quelles.
     */
    fun view(s: AppState, m: Member): AppState = s.copy(
        library = m.library,
        attempts = m.attempts,
        accounts = m.accounts,
        steamOwned = emptyList(),
        relay = null,
        settings = s.settings.copy(claimSteam = false),
    )

    /** Ce qui reste a prendre pour ce membre, sur les magasins ou il est connecte. */
    fun todo(s: AppState, m: Member, now: Long, force: Set<String> = emptySet()): List<Offer> =
        Rules.pending(view(s, m), now, force).filter { o ->
            o.store in STORES && m.accounts[o.store]?.status.let { it == Accounts.OK || it == Accounts.PRESENT }
        }

    /** Un verdict pour ce membre : ses essais, ses jeux, ses comptes. Rien du compte principal ne bouge. */
    fun record(s: AppState, id: String, o: Offer, verdict: String, details: String?, now: Long, unattended: Boolean, count: Boolean = true): AppState =
        change(s, id) { m ->
            val att = if (count) Rules.afterVerdict(m.attempts[o.key], verdict, details, now, unattended) else m.attempts[o.key]
            var lib = m.library
            var acc = m.accounts
            if (verdict in Verdicts.ACQUIRED) {
                lib = lib + (Rules.libraryKeyOf(o) to LibraryEntry(
                    store = o.store, id = o.storeId ?: o.sourceId ?: o.normalisedTitle, title = o.shownTitle,
                    url = o.url, worth = o.worth, image = o.image, ts = now, status = verdict,
                ))
                acc = acc + (o.store to AccountState(Accounts.OK, now, via = Accounts.PAGE))
            }
            if (verdict == Verdicts.LOGIN) acc = acc + (o.store to AccountState(Accounts.LOGGED_OUT, now, via = Accounts.PAGE))
            m.copy(attempts = if (att != null) m.attempts + (o.key to att) else m.attempts, library = lib, accounts = acc)
        }

    /**
     * La memoire du moteur pour ce membre : les libelles appris et les
     * interrupteurs sont communs, l'historique est le sien. Lire celui du
     * compte principal lui ferait sauter des jeux qu'il n'a pas.
     */
    fun engineFor(s: AppState, m: Member): Map<String, JsonElement> =
        s.engine.filterKeys { !it.startsWith("FGC_history_") } + m.engine

    fun engineWrite(s: AppState, id: String, items: Map<String, JsonElement>): AppState =
        change(s, id) { it.copy(engine = it.engine + items) }

    fun engineRemove(s: AppState, id: String, keys: Set<String>): AppState =
        change(s, id) { it.copy(engine = it.engine - keys) }

    /* --------------------------------------------------- les profils */

    /** Les cookies de chaque profil, pris sur le fil principal comme WebView le demande. */
    private val jars = ConcurrentHashMap<String, CookieManager>()

    suspend fun cookieManager(id: String): CookieManager? = jars[id] ?: withContext(Dispatchers.Main) {
        if (!supported()) return@withContext null
        runCatching { ProfileStore.getInstance().getOrCreateProfile(profileName(id)).cookieManager }.getOrNull()
    }?.also { jars[id] = it }

    /** Les pages de ce membre vivent dans son profil. A appeler avant tout autre usage de la page. */
    fun attach(web: WebView, id: String): Boolean {
        if (!supported()) return false
        // Le profil existe avant qu'une page s'y attache (fil principal, comme WebView le veut).
        ProfileStore.getInstance().getOrCreateProfile(profileName(id))
        WebViewCompat.setProfile(web, profileName(id))
        return true
    }

    /** L'etat de ses comptes, lu avec SES cookies. */
    suspend fun check(id: String, store: String, country: String?, now: Long): AccountState {
        val jar = cookieManager(id) ?: return AccountState(Accounts.UNKNOWN, now)
        val http = Http({ Graph.userAgent() }, { url -> runCatching { jar.getCookie(url) }.getOrNull() })
        return Accounts.check(store, country, now, http) { url -> runCatching { jar.getCookie(url) }.getOrNull() }.first
    }

    /** Oublie tout de ce membre : ses cookies, son stockage, puis son profil. Sur le fil principal. */
    fun forget(id: String) {
        if (!supported()) return
        val store = runCatching { ProfileStore.getInstance() }.getOrNull() ?: return
        runCatching {
            store.getProfile(profileName(id))?.let { p ->
                p.cookieManager.removeAllCookies(null)
                p.cookieManager.flush()
                p.webStorage.deleteAllData()
            }
        }
        // Refuse tant qu'une page utilise encore le profil : les cookies sont deja effaces.
        runCatching { store.deleteProfile(profileName(id)) }
        jars.remove(id)
    }

    /** « Effacer les sessions » : celles des membres aussi. */
    fun clearAll(s: AppState) {
        if (!supported()) return
        val store = runCatching { ProfileStore.getInstance() }.getOrNull() ?: return
        for (m in s.family) runCatching {
            store.getProfile(profileName(m.id))?.let { p ->
                p.cookieManager.removeAllCookies(null)
                p.cookieManager.flush()
                p.webStorage.deleteAllData()
            }
        }
    }
}
