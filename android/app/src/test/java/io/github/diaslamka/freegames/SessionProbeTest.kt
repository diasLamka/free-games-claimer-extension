package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.claim.SessionProbe
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.Stores
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * « Suis-je connecte ? » confirme par la page (1.17.0) : un « non » des cookies
 * ou de l'API n'est cru qu'apres avoir charge la page du magasin.
 */
class SessionProbeTest {
    private val now = 1_790_540_000_000L
    private val h = 3_600_000L

    private fun verdict(store: String, landed: String?, title: String? = null) = Accounts.pageVerdict(store, landed, title)

    @Test
    fun steamSaysLoggedOutByRedirectingToItsLoginPage() {
        // Mesure : sans session, /account/ atterrit sur /login/?redir=account%2F&redir_ssl=1.
        assertEquals(Accounts.LOGGED_OUT, verdict(Stores.STEAM, "https://store.steampowered.com/login/?redir=account%2F&redir_ssl=1"))
        assertEquals(Accounts.LOGGED_OUT, verdict(Stores.STEAM, "https://login.steampowered.com/jwt/refresh?redir=x"))
        assertEquals(Accounts.OK, verdict(Stores.STEAM, "https://store.steampowered.com/account/"))
        assertEquals(Accounts.OK, verdict(Stores.STEAM, "https://store.steampowered.com/account/?l=french"))
    }

    @Test
    fun epicSaysLoggedOutByRedirectingToIdLogin() {
        assertEquals(Accounts.LOGGED_OUT, verdict(Stores.EPIC, "https://www.epicgames.com/id/login?redirectUrl=https%3A%2F%2Fwww.epicgames.com%2Faccount%2Fpersonal"))
        assertEquals(Accounts.LOGGED_OUT, verdict(Stores.EPIC, "https://www.epicgames.com/id/login/epic?lang=fr"))
        assertEquals(Accounts.OK, verdict(Stores.EPIC, "https://www.epicgames.com/account/personal"))
    }

    @Test
    fun aPageThatSaysNothingNeverSaysLoggedOut() {
        assertEquals(Accounts.UNKNOWN, verdict(Stores.STEAM, null))
        assertEquals(Accounts.UNKNOWN, verdict(Stores.STEAM, "https://store.steampowered.com/agecheck/app/1"))
        assertEquals(Accounts.UNKNOWN, verdict(Stores.STEAM, "https://store.steampowered.com/account/", "Just a moment..."))
        assertEquals(Accounts.UNKNOWN, verdict(Stores.EPIC, "https://www.epicgames.com/account/personal", "Un instant…"))
        assertEquals(Accounts.UNKNOWN, verdict(Stores.EPIC, "https://exemple.test/account/personal"))
        assertEquals(Accounts.UNKNOWN, verdict(Stores.GOG, "https://www.gog.com/account"))
    }

    private fun pair(status: String, owned: Set<String>? = null, name: String? = null) = AccountState(status, now, name) to owned

    private fun run(
        store: String, first: Pair<AccountState, Set<String>?>, prev: AccountState?, landed: String?, title: String? = null,
        busy: Boolean = false, again: Pair<AccountState, Set<String>?> = pair(Accounts.UNKNOWN),
    ): Triple<AccountState, Set<String>?, Int> {
        var lands = 0
        val r = runBlocking {
            SessionProbe.confirm(store, first, prev, now, busy, land = { _, _ -> lands++; landed to title }, recheck = { again })
        }
        return Triple(r.first, r.second, lands)
    }

    @Test
    fun aYesIsTakenAsIsWithoutLoadingAnyPage() {
        assertEquals(0, run(Stores.STEAM, pair(Accounts.OK, setOf("1")), null, null).third)
        assertEquals(0, run(Stores.EPIC, pair(Accounts.PRESENT), null, null).third)
        assertEquals(0, run(Stores.GOG, pair(Accounts.LOGGED_OUT), null, null).third)
    }

    @Test
    fun steamWithExpiredTokensIsConfirmedByThePageAndReadsAgain() {
        val libre = pair(Accounts.OK, setOf("400", "620"))
        val (state, owned, lands) = run(
            Stores.STEAM, pair(Accounts.LOGGED_OUT), AccountState(Accounts.OK, now - 9 * h),
            "https://store.steampowered.com/account/", again = libre,
        )
        assertEquals(1, lands)
        assertEquals(Accounts.OK, state.status)
        assertEquals(Accounts.PAGE, state.via)
        assertEquals(setOf("400", "620"), owned)
    }

    @Test
    fun steamConfirmedByPageEvenIfItsLibraryCannotBeReadYet() {
        val (state, owned, _) = run(Stores.STEAM, pair(Accounts.UNKNOWN), null, "https://store.steampowered.com/account/")
        assertEquals(Accounts.OK, state.status)
        assertEquals(Accounts.PAGE, state.via)
        assertNull(owned)
    }

    @Test
    fun aRedirectToTheLoginPageIsTheOnlyWayToBeLoggedOut() {
        val (state, _, lands) = run(Stores.STEAM, pair(Accounts.LOGGED_OUT), AccountState(Accounts.OK, now - 9 * h), "https://store.steampowered.com/login/?redir=account%2F")
        assertEquals(1, lands)
        assertEquals(Accounts.LOGGED_OUT, state.status)
        assertEquals(Accounts.PAGE, state.via)
    }

    @Test
    fun aMuteOrBlockedPageDoesNotCondemnAnAccountThatWasFine() {
        val (state, _, _) = run(Stores.STEAM, pair(Accounts.LOGGED_OUT), AccountState(Accounts.OK, now - 9 * h), "https://store.steampowered.com/account/", title = "Just a moment...")
        assertEquals(Accounts.UNKNOWN, state.status)
        val epic = run(Stores.EPIC, pair(Accounts.LOGGED_OUT), AccountState(Accounts.PRESENT, now - 9 * h), null)
        assertEquals(Accounts.UNKNOWN, epic.first.status)
    }

    @Test
    fun epicWithoutTheUsualCookiesButLoggedInIsSetRightByThePage() {
        val (state, _, lands) = run(Stores.EPIC, pair(Accounts.LOGGED_OUT), AccountState(Accounts.PRESENT, now - 30 * h), "https://www.epicgames.com/account/personal")
        assertEquals(1, lands)
        assertEquals(Accounts.OK, state.status)
        assertEquals(Accounts.PAGE, state.via)
    }

    @Test
    fun aNeverLoggedInEpicStaysLoggedOutWhenThePageSaysNothing() {
        val (state, _, _) = run(Stores.EPIC, pair(Accounts.LOGGED_OUT), null, null)
        assertEquals(Accounts.LOGGED_OUT, state.status)
    }

    @Test
    fun aLossAlreadyShownByAPageIsNotCheckedAgainBeforeSixHours() {
        val perdu = AccountState(Accounts.LOGGED_OUT, now - 1 * h, via = Accounts.PAGE)
        val r = run(Stores.STEAM, pair(Accounts.LOGGED_OUT), perdu, "https://store.steampowered.com/account/")
        assertEquals(0, r.third)
        assertEquals(perdu, r.first)
        // Passees six heures, on regarde a nouveau -- et si l'utilisateur s'est reconnecte, la page le voit.
        val vieux = perdu.copy(checkedAt = now - 7 * h)
        val apres = run(Stores.STEAM, pair(Accounts.LOGGED_OUT), vieux, "https://store.steampowered.com/account/")
        assertEquals(1, apres.third)
        assertEquals(Accounts.OK, apres.first.status)
    }

    @Test
    fun whileAClaimRunsNothingIsLoadedAndAGoodAccountIsNotCondemned() {
        val r = run(Stores.STEAM, pair(Accounts.LOGGED_OUT), AccountState(Accounts.OK, now - 9 * h), "https://store.steampowered.com/login/", busy = true)
        assertEquals(0, r.third)
        assertEquals(Accounts.UNKNOWN, r.first.status)
    }

    @Test
    fun anOldSavedStateWithoutTheNewFieldStillLoads() {
        val a = Json.decodeFromString(AccountState.serializer(), """{"status":"ok","checkedAt":42,"name":"moi"}""")
        assertEquals("moi", a.name)
        assertNull(a.via)
    }
}
