package io.github.diaslamka.freegames

import android.app.Application
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.diaslamka.freegames.claim.BackgroundClaim
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Family
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Toute la famille (1.9.0) : chacun ses comptes, ses jeux, ses essais. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35], application = Application::class)
class FamilyTest {
    private val now = 1_790_540_000_000L
    private fun offer(store: String, id: String, title: String, pkg: String? = null) = Offer(
        key = "$store:$id", source = store, store = store, storeId = id, title = title,
        url = "https://example.com/$id", start = now - 3_600_000, end = now + 86_400_000, keepable = true, packageId = pkg,
    )

    private val a = offer(Stores.EPIC, "a", "Hades")
    private val b = offer(Stores.EPIC, "b", "Tunic")
    private val c = offer(Stores.GOG, "c", "Gris")
    private val d = offer(Stores.STEAM, "400", "Portal", pkg = "7")

    private fun base(): AppState {
        var s = AppState(
            offers = listOf(a, b, c, d).associateBy { it.key },
            library = mapOf("epic:a" to LibraryEntry(Stores.EPIC, "a", "Hades", ts = now)),
            engine = mapOf("FGC_history_Epic Games" to JsonPrimitive("{}"), "FGC_taught_labels" to JsonPrimitive("[]")),
        )
        s = Family.add(s, "Léa", now)
        s = Family.add(s, "Tom", now)
        return Family.setAccount(s, s.family[0].id, Stores.EPIC, AccountState(Accounts.PRESENT, now))
    }

    @Test
    fun membersAreNamedOnceAndCapped() {
        var s = base()
        assertEquals(listOf("Léa", "Tom"), s.family.map { it.name })
        assertEquals(2, s.family.map { it.id }.toSet().size)
        assertEquals(s, Family.add(s, "  léa ", now))
        assertEquals(s, Family.add(s, "   ", now))
        repeat(10) { s = Family.add(s, "Enfant $it", now) }
        assertEquals(Family.MAX_MEMBERS, s.family.size)
        val id = s.family[1].id
        assertNull(Family.member(Family.remove(s, id), id))
        assertEquals("famille-$id", Family.profileName(id))
    }

    @Test
    fun aMemberClaimsWhatTheyDoNotHaveOnTheStoresTheyAreSignedInto() {
        val s = base()
        val lea = s.family[0]
        // Hades est au compte principal, pas a Lea ; GOG n'est pas connecte ; Steam reste au compte principal.
        assertEquals(listOf("epic:a", "epic:b"), Family.todo(s, lea, now).map { it.key }.sorted())
        assertEquals(emptyList<Offer>(), Family.todo(s, s.family[1], now))
        val v = Family.view(s, lea)
        assertNull(v.relay)
        assertFalse(v.settings.claimSteam)
        assertTrue(v.steamOwned.isEmpty())
    }

    @Test
    fun aVerdictGoesToTheMemberAndNowhereElse() {
        val s0 = base()
        val id = s0.family[0].id
        var s = Family.record(s0, id, b, Verdicts.CLAIMED, null, now, unattended = true)
        val lea = Family.member(s, id)!!
        assertTrue("epic:b" in lea.library)
        assertEquals(s0.library, s.library)
        assertEquals(s0.attempts, s.attempts)
        assertEquals(listOf("epic:a"), Family.todo(s, lea, now).map { it.key })
        s = Family.record(s, id, a, Verdicts.LOGIN, "session", now, unattended = true)
        assertEquals(Accounts.LOGGED_OUT, Family.member(s, id)!!.accounts[Stores.EPIC]?.status)
        assertEquals(emptyList<Offer>(), Family.todo(s, Family.member(s, id)!!, now))
        assertTrue(s.family[1].library.isEmpty())
    }

    @Test
    fun theEngineMemoryIsTheirsButTheLearnedLabelsAreShared() {
        val s0 = base()
        val id = s0.family[0].id
        val s = Family.engineWrite(s0, id, mapOf("FGC_history_Epic Games" to JsonPrimitive("{\"x\":1}")))
        val e = Family.engineFor(s, Family.member(s, id)!!)
        assertEquals(JsonPrimitive("{\"x\":1}"), e["FGC_history_Epic Games"])
        assertTrue("FGC_taught_labels" in e)
        assertEquals(JsonPrimitive("{}"), s.engine["FGC_history_Epic Games"])
        assertFalse("FGC_history_Epic Games" in Family.engineFor(s0, Family.member(s0, id)!!))
        assertTrue(Family.engineRemove(s, id, setOf("FGC_history_Epic Games")).family[0].engine.isEmpty())
    }

    @Test
    fun withoutSeparateProfilesNothingRunsForTheFamily() {
        // La WebView du banc de test ne sait pas separer les sessions : rien ne part au nom d'un membre.
        assertFalse(Family.supported())
        val s = base().copy(settings = base().settings.copy(claimInBackground = true))
        assertTrue(BackgroundClaim.familyTodo(s, now).isEmpty())
    }

    @Test
    fun accountsAreReadWithTheMembersOwnCookies() = runBlocking {
        val lea = { url: String -> if ("epicgames.com" in url) "EPIC_EG1=abc; autre=1" else null }
        assertEquals(Accounts.PRESENT, Accounts.check(Stores.EPIC, "FR", now, cookies = lea).first.status)
        assertEquals(Accounts.LOGGED_OUT, Accounts.check(Stores.EPIC, "FR", now, cookies = { null }).first.status)
        val gog = object : Fetcher {
            override suspend fun get(url: String, withCookies: Boolean, accept: String) = HttpResult(200, """{"isLoggedIn":true,"username":"lea"}""")
        }
        val r = Accounts.check(Stores.GOG, "FR", now, http = gog, cookies = lea).first
        assertEquals(Accounts.OK, r.status)
        assertEquals("lea", r.name)
    }
}
