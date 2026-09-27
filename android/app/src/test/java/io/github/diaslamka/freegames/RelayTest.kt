package io.github.diaslamka.freegames

import io.github.diaslamka.freegames.data.Relay
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Le meme vecteur que test/relay.test.mjs : l'extension et l'appli doivent
 * deriver le meme sujet, ouvrir le meme message, et le chiffrer a l'identique.
 */
class RelayTest {
    private val fx = parseJson(File(System.getProperty("fixtures"), "relais.json").readText())!!.jsonObject
    private val secret = fx["secret"].str!!
    private val topic = fx["topic"].str!!
    private val envelope = fx["envelope"].str!!
    private val message = fx["message"].obj!!
    private val now = 1_790_000_060_000L

    private fun hex(s: String) = s.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test
    fun theSharedVectorOpensAndSealsIdentically() {
        assertEquals(topic, Relay.topic(secret))
        val clair = Relay.open(envelope, Relay.key(secret), topic)
        assertEquals(message, parseJson(clair))
        // Meme clair, meme nonce : meme message, a l'octet pres.
        assertEquals(envelope, Relay.seal(clair!!, Relay.key(secret), topic, hex(fx["nonce"].str!!)))
    }

    @Test
    fun anotherTopicOrKeyDoesNotOpen() {
        assertNull(Relay.open(envelope, Relay.key(secret), "fgcr-autre"))
        assertNull(Relay.open(envelope, ByteArray(32), topic))
        assertNull(Relay.open("pas un message", Relay.key(secret), topic))
    }

    @Test
    fun pairingCodes() {
        assertEquals(secret to Relay.DEFAULT_SERVER, Relay.parsePairingCode(fx["code"].str))
        assertEquals(secret to "https://ntfy.example.org", Relay.parsePairingCode(fx["code"].str + "@https://ntfy.example.org/"))
        assertNull(Relay.parsePairingCode(fx["code"].str!!.dropLast(1)))
        assertNull(Relay.parsePairingCode(fx["code"].str + "@http://ntfy.example.org"))
        assertNull(Relay.parsePairingCode("FGC2-$secret"))
        assertTrue(Relay.newDeviceId().matches(Regex("^[0-9a-f]{8}$")))
    }

    private fun base() = AppState(relay = RelayState(dev = "c0ffee01", pairedAt = now - 1000))

    @Test
    fun aGameClaimedElsewhereEntersTheLibraryOnce() {
        // Le message du vecteur vient d'un telephone (role « phone ») : ici on le lit comme venu d'un autre appareil.
        val (s, n) = Relay.apply(base(), listOf(message), now)
        assertEquals(1, n)
        val e = s.library[Rules.libraryKey("epic", "hades")]
        assertNotNull(e)
        assertEquals("Hades", e!!.title)
        assertEquals("pc", e.via)
        assertEquals(1_790_000_000_000L, s.relay!!.peerAt)
        // L'offre correspondante n'est plus a prendre.
        val o = Offer(key = "epic:hades", source = "epic", store = Stores.EPIC, storeId = "hades", title = "Hades",
            url = "https://store.epicgames.com/p/hades", end = now + 86_400_000, keepable = true)
        assertTrue(Rules.pending(s.copy(offers = mapOf(o.key to o)), now).isEmpty())
        // Rejoue : rien de plus.
        assertEquals(0, Relay.apply(s, listOf(message), now).second)
    }

    @Test
    fun ownOldAndFailedMessagesAreIgnored() {
        val mine = JsonObject(message + ("dev" to parseJson("\"c0ffee01\"")!!))
        val old = JsonObject(message + ("ts" to parseJson("${now - 8 * 24 * 3_600_000L}")!!))
        val failed = parseJson("""{"v":1,"dev":"ffffffff","role":"pc","type":"claimed","ts":$now,"games":[{"s":"gog","i":"x","t":"X","st":"failed"}]}""")!!.jsonObject
        assertEquals(0, Relay.apply(base(), listOf(mine, old, failed), now).second)
    }

    @Test
    fun aLockFromThePcHoldsTheGameTenMinutesAtMost() {
        val lock = Relay.message(Relay.LOCK, "ffffffff", now, listOf(Relay.wireGame("epic", "hades", "Hades", until = now + 3_600_000)))
        val (s, _) = Relay.apply(base(), listOf(lock), now)
        val o = Offer(key = "epic:hades", source = "epic", store = Stores.EPIC, storeId = "hades", title = "Hades", url = "https://x.test")
        assertTrue(Relay.held(s, o, now + 60_000))
        assertFalse(Relay.held(s, o, now + Relay.MAX_LOCK_MS + 1))
    }

    @Test
    fun aliveFitsInANtfyMessage() {
        val lib = (0 until 40).associate { i ->
            "epic:jeu-$i" to LibraryEntry(Stores.EPIC, "jeu-$i", "Un jeu au titre assez long numero $i",
                url = "https://store.epicgames.com/p/un-jeu-au-titre-assez-long-$i?avec=des&parametres=longs", worth = "19,99 €", ts = now - i * 1000L)
        }
        val key = Relay.key(secret)
        val m = Relay.fitAlive("c0ffee01", now, Relay.recentGames(lib)) { Relay.seal(it.toString(), key, topic).length }
        assertTrue(Relay.seal(m.toString(), key, topic).length <= Relay.MAX_ENVELOPE)
        assertEquals("Un jeu au titre assez long numero 0", m["games"]!!.let { (it as kotlinx.serialization.json.JsonArray)[0].obj!!["t"].str })
    }

    @Test
    fun ntfyLinesAreRead() {
        val body = listOf(
            """{"id":"a1","event":"open"}""",
            """{"id":"a2","event":"message","message":"fgc1.x"}""",
            "pas du json",
            """{"id":"a3","event":"message","message":"fgc1.y"}""",
        ).joinToString("\n")
        assertEquals(listOf("fgc1.x", "fgc1.y") to "a3", Relay.parsePoll(body, null))
    }

    /* ------------------------------------------ la demande d'aide (1.4.0) */

    private fun help(dev: String = "b0b0b0b0", until: Long = now + 3_600_000L, title: String = "Hades") = buildJsonObject {
        put("v", 1); put("dev", dev); put("role", "pc"); put("type", Relay.HELP); put("ts", now)
        put("games", kotlinx.serialization.json.JsonArray(listOf(Relay.wireGame(Stores.EPIC, "hades", title, url = "https://store.epicgames.com/p/hades", until = until))))
    }

    @Test
    fun theSharedAppLinkReadsBackIdentically() {
        val v = fx["appLink"].obj!!
        val g = v["game"].obj!!
        val link = v["link"].str!!
        assertEquals(Relay.AppLink(g["s"].str!!, g["i"].str!!, g["t"].str!!), Relay.parseAppLink(link))
        assertEquals(link, Relay.appLink(g["s"].str!!, g["i"].str!!, g["t"].str!!))
    }

    @Test
    fun anAppLinkOnlyNamesAGame() {
        assertNull(Relay.parseAppLink("https://evil.test/finir?s=epic&i=x&t=X"))
        assertNull(Relay.parseAppLink("fgclaimer://autre?s=epic&i=x&t=X"))
        assertNull("magasin inconnu", Relay.parseAppLink("fgclaimer://finir?s=evil&i=x&t=X"))
        assertNull("identifiant hors forme", Relay.parseAppLink("fgclaimer://finir?s=epic&i=%2F..%2Fx&t=X"))
        assertNull("titre vide", Relay.parseAppLink("fgclaimer://finir?s=epic&i=x&t=+"))
        assertEquals(Relay.AppLink("gog", "", "Gris"), Relay.parseAppLink("fgclaimer://finir?s=gog&t=Gris"))
    }

    @Test
    fun aHelpRequestIsKeptUntilTheGameIsClaimed() {
        val (s1, _) = Relay.apply(base(), listOf(help()), now)
        val open = Relay.openHelp(s1, now)
        assertEquals(1, open.size)
        assertEquals("Hades", open[0].second.title)
        assertEquals("https://store.epicgames.com/p/hades", open[0].second.url)
        assertFalse(open[0].second.notified)
        // Rejouee : la meme, pas une seconde.
        assertEquals(1, Relay.apply(s1, listOf(help()), now).first.relay!!.help.size)
        // Obtenu ici (le telephone l'a pris) : plus rien a afficher.
        val lib = s1.copy(library = mapOf("epic:hades" to LibraryEntry(Stores.EPIC, "hades", "Hades", null, null, null, now, status = "claimed")))
        assertTrue(Relay.openHelp(lib, now).isEmpty())
        // Son terme passe, ou de soi-meme : rien.
        assertTrue(Relay.openHelp(s1, now + 3_600_001L).isEmpty())
        assertTrue(Relay.apply(base(), listOf(help(dev = "c0ffee01")), now).first.relay!!.help.isEmpty())
        // Un jour au plus.
        val (s2, _) = Relay.apply(base(), listOf(help(until = now + 9 * 86_400_000L)), now)
        assertEquals(now + Relay.MAX_HELP_MS, s2.relay!!.help.values.first().until)
    }

    @Test
    fun theOfferIsFoundByIdThenByTitle() {
        val o = Offer(key = "epic:hades", source = "epic", store = Stores.EPIC, storeId = "hades", title = "Hades")
        val s = base().copy(offers = mapOf(o.key to o))
        assertEquals(o, Relay.findOffer(s, Stores.EPIC, "hades", "autre titre"))
        assertEquals(o, Relay.findOffer(s, Stores.EPIC, "", "HADES"))
        assertNull("le magasin compte", Relay.findOffer(s, Stores.GOG, "hades", "Hades"))
    }

    @Test
    fun aLinkIsAnsweredFromTheAppsOwnOffers() {
        val o = Offer(key = "epic:hades", source = "epic", store = Stores.EPIC, storeId = "hades", title = "Hades")
        val link = Relay.AppLink(Stores.EPIC, "hades", "Hades")
        val s = base().copy(offers = mapOf(o.key to o))
        assertEquals(io.github.diaslamka.freegames.ui.HelpAsk.Found(link, o), io.github.diaslamka.freegames.ui.resolveHelp(link, s, refreshed = false))
        val owned = s.copy(library = mapOf("epic:hades" to LibraryEntry(Stores.EPIC, "hades", "Hades", null, null, null, now, status = "claimed")))
        assertTrue(io.github.diaslamka.freegames.ui.resolveHelp(link, owned, refreshed = false) is io.github.diaslamka.freegames.ui.HelpAsk.Owned)
        assertTrue(io.github.diaslamka.freegames.ui.resolveHelp(link, base(), refreshed = false) is io.github.diaslamka.freegames.ui.HelpAsk.Looking)
        assertTrue(io.github.diaslamka.freegames.ui.resolveHelp(link, base(), refreshed = true) is io.github.diaslamka.freegames.ui.HelpAsk.Missing)
    }
}
