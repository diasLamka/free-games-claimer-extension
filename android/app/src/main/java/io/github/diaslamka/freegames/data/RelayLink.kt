package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.sources.obj
import io.github.diaslamka.freegames.sources.parseJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder

/**
 * Le relais sur le reseau : lire ntfy, y ecrire, et tenir l'etat a jour.
 * Sans cookies, sans jeton : une requete au serveur ntfy, rien d'autre. Une
 * panne ne bloque jamais une recuperation -- elle est notee, c'est tout.
 */
object RelayLink {
    private data class Ctx(val pairing: Relay.Pairing, val topic: String, val key: ByteArray)

    private fun ctx(context: Context): Ctx? {
        val p = RelaySecret.load(context) ?: return null
        return Ctx(p, Relay.topic(p.secret), Relay.key(p.secret))
    }

    /** Associe ce telephone a partir du code scanne ou colle. Rend faux si le code n'en est pas un. */
    suspend fun pair(context: Context, code: String, now: Long): Boolean {
        val (secret, server) = Relay.parsePairingCode(code) ?: return false
        val dev = Relay.newDeviceId()
        withContext(Dispatchers.IO) { RelaySecret.save(context, Relay.Pairing(secret, server, dev)) }
        Graph.store.update { it.copy(relay = RelayState(dev = dev, pairedAt = now)) }
        // Le PC l'apprend tout de suite : son popup attend ce premier signe.
        sync(context, now)
        alive(context, now, force = true)
        return true
    }

    suspend fun unpair(context: Context) {
        withContext(Dispatchers.IO) { RelaySecret.clear(context) }
        Graph.store.update { it.copy(relay = null) }
    }

    private suspend fun publish(c: Ctx, msg: JsonObject): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = Relay.seal(msg.toString(), c.key, c.topic)
            val req = Request.Builder().url("${c.pairing.server}/${c.topic}")
                .header("X-Firebase", "no")
                .post(body.toRequestBody("text/plain".toMediaType()))
                .build()
            Graph.http.client.newCall(req).execute().use { it.isSuccessful }
        } catch (_: Exception) {
            false
        }
    }

    /** Lit ce qui est arrive et l'integre. Rend le nombre de jeux obtenus par le PC. */
    suspend fun sync(context: Context, now: Long): Int {
        val c = ctx(context) ?: return 0
        val since = Graph.store.value.relay?.since
        val result = withContext(Dispatchers.IO) {
            try {
                val url = "${c.pairing.server}/${c.topic}/json?poll=1&since=" + URLEncoder.encode(since ?: "12h", "UTF-8")
                Graph.http.client.newCall(Request.Builder().url(url).get().build()).execute().use { r ->
                    if (!r.isSuccessful) null else Relay.parsePoll(r.body.string(), since)
                }
            } catch (_: Exception) {
                null
            }
        }
        if (result == null) {
            Graph.store.update { s -> s.copy(relay = s.relay?.copy(lastError = "lecture impossible")) }
            return 0
        }
        val (bodies, last) = result
        val messages = bodies.mapNotNull { e -> Relay.open(e, c.key, c.topic)?.let { parseJson(it).obj } }
        var added = 0
        Graph.store.update { s ->
            val (next, n) = Relay.apply(s, messages, now)
            added = n
            next.copy(relay = next.relay?.copy(since = last, lastSync = now, lastError = null))
        }
        return added
    }

    /** Le signe de vie, au plus une fois par heure. */
    suspend fun alive(context: Context, now: Long, force: Boolean = false): Boolean {
        val c = ctx(context) ?: return false
        val s = Graph.store.value
        val r = s.relay ?: return false
        if (!force && r.lastAlive != null && now - r.lastAlive < Relay.ALIVE_EVERY_MS) return false
        val m = Relay.fitAlive(r.dev, now, Relay.recentGames(s.library)) { Relay.seal(it.toString(), c.key, c.topic).length }
        val ok = publish(c, m)
        Graph.store.update { st -> st.copy(relay = st.relay?.copy(lastAlive = if (ok) now else st.relay.lastAlive, lastError = if (ok) st.relay.lastError else "envoi impossible")) }
        return ok
    }

    suspend fun lock(context: Context, o: Offer, now: Long) {
        val c = ctx(context) ?: return
        val dev = Graph.store.value.relay?.dev ?: return
        publish(c, Relay.message(Relay.LOCK, dev, now, listOf(Relay.gameOf(o, until = now + Relay.MAX_LOCK_MS))))
    }

    suspend fun claimed(context: Context, o: Offer, verdict: String, now: Long) {
        val c = ctx(context) ?: return
        val dev = Graph.store.value.relay?.dev ?: return
        publish(c, Relay.message(Relay.CLAIMED, dev, now, listOf(Relay.gameOf(o, at = now, status = verdict))))
    }
}
