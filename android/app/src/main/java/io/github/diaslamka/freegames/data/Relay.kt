package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.HelpRequest
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import io.github.diaslamka.freegames.sources.str
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Le relais PC <-> telephone, cote appli -- le meme protocole que
 * watch/relay.js dans l'extension, a l'octet pres (docs/specs/
 * 2026-09-26-relais-design.md ; test/fixtures/relais.json est rejoue par les
 * deux cotes).
 *
 * Celui qui est allume recupere : avant un jeu, un verrou ; apres, « obtenu ».
 * L'autre inscrit le jeu et ne le retente pas. Bloque par une verification
 * humaine, il demande de l'aide (1.4.0) : l'autre appelle l'humain, qui finit
 * le jeu la ou il est. Tout est chiffre de bout en bout
 * (AES-256-GCM) : ntfy voit un sujet tire au hasard, jamais un titre. Aucun
 * cookie, aucun code, aucun identifiant de compte ne passe.
 *
 * Ce fichier est PUR : ni reseau, ni stockage (voir RelayLink et RelaySecret).
 */
object Relay {
    const val DEFAULT_SERVER = "https://ntfy.sh"
    const val CODE_PREFIX = "FGC1-"
    const val ENVELOPE_PREFIX = "fgc1."
    const val VERSION = 1
    const val ROLE = "phone"

    const val CLAIMED = "claimed"
    const val LOCK = "lock"
    const val ALIVE = "alive"
    const val HELP = "help"

    /** Une demande d'aide vaut un jour au plus. */
    const val MAX_HELP_MS = 24 * 3_600_000L

    /** Le lien qui ouvre l'appli sur un jeu a finir (watch/relay.js, appLink). */
    const val APP_LINK = "fgclaimer://finir"

    const val MAX_LOCK_MS = 10 * 60_000L
    const val MAX_AGE_MS = 7 * 24 * 3_600_000L
    const val ALIVE_EVERY_MS = 3_600_000L
    const val ALIVE_GAMES = 15
    const val MAX_ENVELOPE = 4000

    private val ACQUIRED = setOf("claimed", "redeemed")
    private val b64 = Base64.getUrlEncoder().withoutPadding()
    private val unb64 = Base64.getUrlDecoder()
    private val random = SecureRandom()

    /** Une association : le secret, le serveur, et l'identifiant de cet appareil. */
    data class Pairing(val secret: String, val server: String, val dev: String)

    /* ------------------------------------------------------ l'association */

    fun relayServer(url: String?): String? {
        val u = runCatching { java.net.URI(url?.trim() ?: return null) }.getOrNull() ?: return null
        if (u.scheme != "https" || u.userInfo != null || u.rawQuery != null || u.rawFragment != null) return null
        if (!(u.rawPath.isNullOrEmpty() || u.rawPath == "/")) return null
        val host = u.host ?: return null
        return "https://$host" + if (u.port != -1) ":${u.port}" else ""
    }

    /** Le code relu : (secret, serveur), ou null. */
    fun parsePairingCode(text: String?): Pair<String, String>? {
        val m = Regex("^FGC1-([A-Za-z0-9_-]{43})(?:@(https://\\S+))?$").find(text?.trim().orEmpty()) ?: return null
        val server = if (m.groupValues[2].isEmpty()) DEFAULT_SERVER else relayServer(m.groupValues[2]) ?: return null
        val raw = runCatching { unb64.decode(m.groupValues[1]) }.getOrNull() ?: return null
        if (raw.size != 32) return null
        return m.groupValues[1] to server
    }

    fun newDeviceId(): String = ByteArray(4).also { random.nextBytes(it) }.joinToString("") { "%02x".format(it) }

    /* ------------------------------------------------- la cryptographie */

    private fun sha256(text: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))

    fun topic(secret: String): String = "fgcr-" + sha256("fgc-relais/sujet/$secret").joinToString("") { "%02x".format(it) }.take(32)

    fun key(secret: String): ByteArray = sha256("fgc-relais/cle/$secret")

    /** Chiffre un texte JSON. `nonce` (12 octets) est injectable pour les tests. */
    fun seal(json: String, key: ByteArray, topic: String, nonce: ByteArray? = null): String {
        val iv = nonce ?: ByteArray(12).also { random.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(topic.toByteArray(Charsets.UTF_8))
        val out = c.doFinal(json.toByteArray(Charsets.UTF_8))
        return ENVELOPE_PREFIX + b64.encodeToString(iv + out)
    }

    /** Ouvre un message : le texte JSON, ou null (autre cle, autre sujet, abime). */
    fun open(envelope: String?, key: ByteArray, topic: String): String? {
        if (envelope == null || !envelope.startsWith(ENVELOPE_PREFIX)) return null
        return try {
            val all = unb64.decode(envelope.removePrefix(ENVELOPE_PREFIX))
            if (all.size < 12 + 16) return null
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, all.copyOfRange(0, 12)))
            c.updateAAD(topic.toByteArray(Charsets.UTF_8))
            String(c.doFinal(all.copyOfRange(12, all.size)), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    /* ---------------------------------------------------------- les messages */

    fun wireGame(store: String, id: String, title: String, at: Long? = null, status: String? = null,
                 worth: String? = null, url: String? = null, until: Long? = null): JsonObject = buildJsonObject {
        put("s", store)
        put("i", id)
        put("t", title.take(140))
        if (at != null) put("at", at)
        if (status != null) put("st", status)
        if (worth != null) put("w", worth.take(40))
        if (url != null && url.startsWith("https://")) put("u", url.take(300))
        if (until != null) put("until", until)
    }

    fun message(type: String, dev: String, now: Long, games: List<JsonObject>): JsonObject = buildJsonObject {
        put("v", VERSION)
        put("dev", dev)
        put("role", ROLE)
        put("type", type)
        put("ts", now)
        put("games", JsonArray(games))
    }

    fun gameOf(o: Offer, at: Long? = null, status: String? = null, until: Long? = null): JsonObject =
        wireGame(o.store, o.storeId ?: o.sourceId ?: o.normalisedTitle, o.shownTitle, at, status, o.worth, o.url, until)

    /** Les derniers jeux obtenus, du plus recent au plus ancien. */
    fun recentGames(library: Map<String, LibraryEntry>, n: Int = ALIVE_GAMES): List<LibraryEntry> =
        library.values.filter { it.title != null && it.ts != null && it.status in ACQUIRED }
            .sortedByDescending { it.ts }.take(n)

    /** Un signe de vie qui tient dans un message ntfy : sans liens d'abord, puis moins de jeux. */
    fun fitAlive(dev: String, now: Long, games: List<LibraryEntry>, size: (JsonObject) -> Int): JsonObject {
        var links = true
        var n = games.size
        while (true) {
            val m = message(ALIVE, dev, now, games.take(n).map { e ->
                wireGame(e.store, e.id, e.title.orEmpty(), e.ts, e.status, e.worth, if (links) e.url else null)
            })
            if (size(m) <= MAX_ENVELOPE || n == 0) return m
            if (links) links = false else n = maxOf(0, n - 3)
        }
    }

    /* ------------------------------------------------------ le lien de l'appli */

    /** Ce qu'un lien `fgclaimer://finir?s=&i=&t=` designe. */
    data class AppLink(val store: String, val id: String, val title: String)

    private fun form(v: String) = java.net.URLEncoder.encode(v, "UTF-8")

    /** Le lien, encode comme URLSearchParams l'encode dans l'extension. */
    fun appLink(store: String, id: String, title: String): String =
        "$APP_LINK?s=${form(store)}&i=${form(id.take(200))}&t=${form(title.take(140))}"

    /**
     * Le lien relu, ou null. Il peut venir de n'importe ou (une page web, une
     * autre appli) : il ne sert qu'a DESIGNER un jeu, que l'appli cherche dans
     * ses propres offres. Aucune adresse n'en est jamais suivie.
     */
    fun parseAppLink(text: String?): AppLink? {
        val t = text?.trim().orEmpty()
        if (!t.startsWith("$APP_LINK?") || t.length > 1200) return null
        val params = t.substringAfter('?').split('&').mapNotNull { part ->
            val k = part.substringBefore('=', "")
            if (k.isEmpty()) null else k to runCatching { java.net.URLDecoder.decode(part.substringAfter('='), "UTF-8") }.getOrNull()
        }.toMap()
        val store = params["s"]?.takeIf { it in Stores.LABELS } ?: return null
        val id = params["i"].orEmpty().takeIf { it.length <= 200 && Regex("[A-Za-z0-9._:~-]*").matches(it) } ?: return null
        val title = params["t"]?.trim()?.takeIf { it.isNotEmpty() && it.length <= 140 } ?: return null
        return AppLink(store, id, title)
    }

    /** L'offre de l'appli que designe (magasin, identifiant, titre) -- l'identifiant d'abord. */
    fun findOffer(state: AppState, store: String, id: String, title: String): Offer? {
        val same = state.offers.values.filter { it.store == store }
        if (id.isNotEmpty()) same.firstOrNull { it.storeId == id || it.sourceId == id }?.let { return it }
        val norm = Titles.normalise(title)
        return same.firstOrNull { it.normalisedTitle == norm }
    }

    /**
     * Les demandes d'aide encore ouvertes, de la plus recente a la plus
     * ancienne -- sans celles dont le jeu est deja obtenu, ici ou la-bas.
     */
    fun openHelp(state: AppState, now: Long): List<Pair<String, HelpRequest>> {
        val owned = state.library.values.filter { it.status in ACQUIRED && it.title != null }
            .map { lockKey(it.store, Titles.normalise(it.title)) }.toSet()
        return state.relay?.help.orEmpty().filter { (k, v) -> v.until > now && k !in owned }
            .toList().sortedByDescending { it.second.at }
    }

    /* -------------------------------------------------------- l'integration */

    fun lockKey(store: String, normalisedTitle: String) = "$store|$normalisedTitle"

    private fun JsonElement?.long(): Long? = (this as? JsonPrimitive)?.longOrNull

    /**
     * Integre des messages ouverts dans l'etat : les jeux obtenus par le PC
     * entrent au registre (via « pc »), ses verrous et son signe de vie sont
     * notes. Rend l'etat suivant et le nombre de jeux ajoutes. Pure.
     */
    fun apply(state: AppState, messages: List<JsonObject>, now: Long): Pair<AppState, Int> {
        val relay = state.relay ?: return state to 0
        var lib = state.library
        val locks = relay.locks.toMutableMap()
        val help = relay.help.toMutableMap()
        var peerRole = relay.peerRole
        var peerAt = relay.peerAt
        var added = 0
        for (m in messages) {
            val ts = m["ts"].long() ?: continue
            if (m["v"].long() != VERSION.toLong()) continue
            if (m["dev"].str == relay.dev) continue
            if (now - ts > MAX_AGE_MS || ts - now > 5 * 60_000L) continue
            val type = m["type"].str
            val games = m["games"].arr?.mapNotNull { it.obj }.orEmpty()
            if (type == CLAIMED || type == ALIVE) {
                for (g in games) {
                    val store = g["s"].str?.takeIf { it.isNotEmpty() } ?: continue
                    val title = g["t"].str?.takeIf { it.isNotEmpty() } ?: continue
                    val st = g["st"].str
                    if (st != null && st !in ACQUIRED) continue
                    val id = g["i"].str?.takeIf { it.isNotEmpty() } ?: Titles.normalise(title)
                    val k = Rules.libraryKey(store, id)
                    val have = lib[k]
                    if (have != null) {
                        // Deja la mais sans jaquette (le message n'en porte pas) : celle de l'offre, des que l'appli la connait.
                        if (have.image == null) findOffer(state, store, id, title)?.image?.let { lib = lib + (k to have.copy(image = it)) }
                        continue
                    }
                    // Deja la par le titre, dans le meme magasin ? Rien a ajouter.
                    val norm = Titles.normalise(title)
                    if (lib.values.any { it.store == store && Titles.normalise(it.title) == norm }) continue
                    lib = lib + (k to LibraryEntry(
                        store = store, id = id, title = title,
                        url = Titles.webUrl(g["u"].str)?.takeIf { it.startsWith("https://") },
                        worth = g["w"].str, image = findOffer(state, store, id, title)?.image, ts = g["at"].long() ?: ts,
                        status = st ?: "claimed", via = "pc",
                    ))
                    added++
                }
            }
            if (type == LOCK) {
                for (g in games) {
                    val store = g["s"].str ?: continue
                    val title = g["t"].str ?: continue
                    val until = minOf(g["until"].long() ?: (ts + MAX_LOCK_MS), ts + MAX_LOCK_MS)
                    if (until <= now) continue
                    locks[lockKey(store, Titles.normalise(title))] = until
                }
            }
            if (type == HELP) {
                for (g in games) {
                    val store = g["s"].str?.takeIf { it.isNotEmpty() } ?: continue
                    val title = g["t"].str?.takeIf { it.isNotEmpty() } ?: continue
                    val until = minOf(g["until"].long() ?: (ts + MAX_HELP_MS), ts + MAX_HELP_MS)
                    if (until <= now) continue
                    val k = lockKey(store, Titles.normalise(title))
                    val before = help[k]
                    if (before != null && before.at >= ts) continue
                    help[k] = HelpRequest(
                        store = store.take(40), id = g["i"].str.orEmpty().take(200), title = title.take(140),
                        url = g["u"].str?.takeIf { it.startsWith("https://") }?.take(300),
                        until = until, at = ts, notified = before?.notified ?: false,
                    )
                }
            }
            if (type == CLAIMED || type == ALIVE || type == LOCK || type == HELP) {
                if (peerAt == null || ts >= peerAt) {
                    peerAt = ts
                    peerRole = m["role"].str?.takeIf { it == "pc" || it == "phone" } ?: peerRole
                }
            }
        }
        val fresh = locks.filterValues { it > now }
        // Une demande d'aide s'eteint a son terme, ou quand le jeu est obtenu -- ici ou la-bas.
        val owned = lib.values.filter { it.status in ACQUIRED && it.title != null }.map { lockKey(it.store, Titles.normalise(it.title)) }.toSet()
        val stillHelp = help.filter { (k, v) -> v.until > now && k !in owned }
        return state.copy(library = lib, relay = relay.copy(locks = fresh, peerRole = peerRole, peerAt = peerAt, help = stillHelp)) to added
    }

    /** L'autre appareil est-il en train de prendre ce jeu ? */
    fun held(state: AppState, o: Offer, now: Long): Boolean {
        val until = state.relay?.locks?.get(lockKey(o.store, o.normalisedTitle)) ?: return false
        return until > now
    }

    /** Les messages ntfy (une ligne JSON chacun) : les corps, et le dernier id. */
    fun parsePoll(body: String, since: String?): Pair<List<String>, String?> {
        val out = mutableListOf<String>()
        var last = since
        for (line in body.lineSequence()) {
            if (line.isBlank()) continue
            val o = parseJson(line) as? JsonObject ?: continue
            if (o["event"].str != "message") continue
            val msg = o["message"].str ?: continue
            out += msg
            o["id"].str?.let { last = it }
        }
        return out to last
    }

}
