package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.claim.BackgroundClaim
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.LunaList
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.SourceStatus
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.parseJson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La liste des offres Luna (1.39.0) : Luna n'a pas d'API, donc rien ne disait a la veille ce qu'il y avait a prendre
 * et la recuperation de fond n'ouvrait jamais sa page. L'appli lit la liste dans la page (sans ecran), par le moteur.
 */
class LunaListTest {
    private val now = 1_790_000_000_000L
    private val host = "https://luna.amazon.fr"

    private fun card(id: String, title: String, extra: String = "") =
        """{"id":"$id","title":"$title","url":"$host/claims/$id/dp/$id","store":"amazon","hasButton":false,"hasCta":true,"collected":false$extra}"""

    private fun message(verdict: String, vararg cards: String) =
        parseJson("""{"type":"fgc-liste","verdict":"$verdict","offers":[${cards.joinToString(",")}]}""")

    @Test
    fun aCardBecomesAnAmazonOfferWithItsPage() {
        val r = LunaList.parse(message("ok", card("amzn1.pg.item.a", "Warbreeds 2")), now)
        assertEquals(LunaList.Status.OK, r.status)
        val o = r.offers.single()
        assertEquals(Stores.AMAZON, o.store)
        assertEquals(LunaList.NAME, o.source)
        assertEquals("amzn1.pg.item.a", o.storeId)
        assertEquals("Warbreeds 2", o.title)
        assertEquals("$host/claims/amzn1.pg.item.a/dp/amzn1.pg.item.a", o.url)
        assertEquals("amazon:amzn1.pg.item.a", o.key)
        assertEquals(true, o.keepable)
        assertEquals("game", o.category)
    }

    @Test
    fun aCardAlreadyTakenIsNotAnOffer() {
        val taken = LunaList.parse(parseJson("""{"verdict":"ok","offers":[{"id":"b","title":"Deja pris","url":"$host/claims/b/dp/b","collected":true,"hasCta":false}]}"""), now)
        // Une carte deja prise ne se reouvre pas : elle n'entre pas dans la liste de ce qu'il reste a prendre.
        assertTrue(taken.offers.isEmpty())
        assertEquals(LunaList.Status.OK, taken.status)
    }

    @Test
    fun directButtonCardsShareOneOfferOnTheListPage() {
        fun direct(id: String, title: String) = """{"id":"$id","title":"$title","hasButton":true,"hasCta":true,"collected":false}"""
        val r = LunaList.parse(message("ok", direct("c1", "Direct un"), direct("c2", "Direct deux"), card("d", "Avec fiche")), now)
        assertEquals(2, r.offers.size)
        val d = r.offers.single { it.url == LunaList.CLAIMS_URL }
        assertTrue(d.title, d.title.startsWith("Direct un"))
        assertTrue(d.storeId!!.startsWith("direct-"))
        val again = LunaList.parse(message("ok", direct("c1", "Direct un"), direct("c2", "Direct deux")), now)
        assertEquals(d.key, again.offers.single().key)
        val other = LunaList.parse(message("ok", direct("c9", "Autre")), now)
        assertNotEquals(d.key, other.offers.single().key)
    }

    @Test
    fun whatThePageSaysIsBoundedAndNeverBelieved() {
        val r = LunaList.parse(
            message(
                "ok",
                card("e", "Ailleurs").replace(host, "https://evil.example"),
                card("f", "   "),
                card("g", "x".repeat(500)),
            ),
            now,
        )
        assertEquals(1, r.offers.size)
        assertTrue(r.offers.single().title.length <= 120)
        val many = LunaList.parse(message("ok", *Array(200) { card("id$it", "Jeu $it") }), now)
        assertTrue(many.offers.size <= 60)
    }

    @Test
    fun theEnginesVerdictsAreRead() {
        assertEquals(LunaList.Status.LOGIN, LunaList.parse(message("needs_login"), now).status)
        assertEquals(LunaList.Status.CHALLENGE, LunaList.parse(message("challenge"), now).status)
        assertEquals(LunaList.Status.WRONG_PAGE, LunaList.parse(message("wrong_page"), now).status)
        assertEquals(LunaList.Status.EMPTY, LunaList.parse(message("empty"), now).status)
        assertEquals(LunaList.Status.SILENT, LunaList.parse(null, now).status)
        assertEquals(LunaList.Status.SILENT, LunaList.parse(parseJson("""{"verdict":"nimporte quoi"}"""), now).status)
    }

    @Test
    fun theListIsReadAtMostOnceAnHourAndOnlyForAnAmazonThePhoneMayTouch() {
        val s = AppState(settings = Settings(claimInBackground = true), accounts = mapOf(Stores.AMAZON to AccountState(Accounts.OK, now)))
        assertTrue(LunaList.due(s, now))
        // Lue il y a dix minutes (reussie ou non) : pas avant l'heure.
        val recent = s.copy(sources = mapOf(LunaList.NAME to SourceStatus(now - 600_000, true, 3)))
        assertFalse(LunaList.due(recent, now))
        val failed = s.copy(sources = mapOf(LunaList.NAME to SourceStatus(now - 600_000, false, 0, "session perdue")))
        assertFalse(LunaList.due(failed, now))
        assertTrue(LunaList.due(recent, now + LunaList.EVERY_MS))
        // Amazon decoche, ou session perdue : on n'y touche pas.
        assertFalse(LunaList.due(s.copy(settings = Settings(claimInBackground = true, claimAmazon = false)), now))
        assertFalse(LunaList.due(s.copy(accounts = mapOf(Stores.AMAZON to AccountState(Accounts.LOGGED_OUT, now))), now))
    }

    @Test
    fun mergeKeepsTheOthersReplacesLunaAndDropsWhatLeftTheList() {
        val epic = Offer(key = "epic:hades", source = "epic-api", store = Stores.EPIC, storeId = "hades", title = "Hades", url = "https://store.epicgames.com/p/hades")
        val old = LunaList.parse(message("ok", card("a", "Premier"), card("z", "Parti")), now).offers
            .map { it.copy(firstSeen = 111, lastSeen = 111) }
        val before = (listOf(epic) + old).associateBy { it.key }
        val found = LunaList.parse(message("ok", card("a", "Premier"), card("n", "Nouveau")), now + 1).offers

        val after = LunaList.merge(before, found, complete = true, now = now + 1)
        assertEquals(setOf("epic:hades", "amazon:a", "amazon:n"), after.keys)
        assertEquals("la date de premiere vue est gardee", 111L, after.getValue("amazon:a").firstSeen)
        assertEquals(now + 1, after.getValue("amazon:a").lastSeen)
        assertEquals(now + 1, after.getValue("amazon:n").firstSeen)

        // Une lecture incomplete n'efface rien.
        val partial = LunaList.merge(before, found, complete = false, now = now + 1)
        assertTrue("amazon:z" in partial.keys)
    }

    @Test
    fun theBackgroundTriesWhatTheListFound() {
        val offers = LunaList.parse(message("ok", card("a", "Warbreeds 2")), now).offers
        val s = AppState(
            offers = offers.associateBy { it.key },
            accounts = mapOf(Stores.AMAZON to AccountState(Accounts.OK, now)),
            settings = Settings(claimInBackground = true),
        )
        assertEquals(listOf("Warbreeds 2"), BackgroundClaim.todo(s, now).map { it.title })
        assertTrue(BackgroundClaim.todo(s.copy(settings = Settings(claimInBackground = true, claimAmazon = false)), now).isEmpty())
        // Rien a lire quand l'ecran eteint est coupe : le reglage commande.
        assertFalse(BackgroundClaim.wantsLunaList(s.copy(settings = Settings()), now))
        assertTrue(BackgroundClaim.wantsLunaList(s, now))
    }
}
