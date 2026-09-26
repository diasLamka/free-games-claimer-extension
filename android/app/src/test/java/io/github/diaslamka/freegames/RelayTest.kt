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
import kotlinx.serialization.json.jsonObject
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
}
