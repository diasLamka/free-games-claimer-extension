package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.RelayState
import io.github.diaslamka.freegames.notify.Notifier
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

    /** Ce que donne une association : faite, un code qui n'en est pas un, ou un secret que le telephone n'a pas pu garder. */
    enum class PairResult { PAIRED, BAD_CODE, NOT_STORED }

    /** Associe ce telephone a partir du code scanne ou colle. */
    suspend fun pair(context: Context, code: String, now: Long): PairResult {
        val (secret, server) = Relay.parsePairingCode(code) ?: return PairResult.BAD_CODE
        val dev = Relay.newDeviceId()
        // Le Keystore d'Android echoue chez certains constructeurs (ProviderException, KeyStoreException) : sans secret
        // garde, pas d'association -- et pas de plantage de l'interface qui a lance l'appel.
        try {
            withContext(Dispatchers.IO) { RelaySecret.save(context, Relay.Pairing(secret, server, dev)) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            return PairResult.NOT_STORED
        }
        Graph.store.update { it.copy(relay = RelayState(dev = dev, pairedAt = now)) }
        // Le PC l'apprend tout de suite : son popup attend ce premier signe.
        sync(context, now)
        alive(context, now, force = true)
        return PairResult.PAIRED
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
        val after = Graph.store.update { s ->
            val (next, n) = Relay.apply(s, messages, now)
            added = n
            next.copy(relay = next.relay?.copy(since = last, lastSync = now, lastError = null))
        }
        // Le PC demande de l'aide (1.4.0) : l'humain est appele, une fois par demande.
        val fresh = Relay.openHelp(after, now).filter { !it.second.notified }
        if (fresh.isNotEmpty()) {
            fresh.forEach { (_, h) -> Notifier.help(context, h) }
            val keys = fresh.map { it.first }.toSet()
            Graph.store.update { s ->
                val r = s.relay ?: return@update s
                s.copy(relay = r.copy(help = r.help.mapValues { (k, v) -> if (k in keys) v.copy(notified = true) else v }))
            }
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

    /**
     * Bloque par une verification humaine, ecran eteint (1.4.0) : le PC le
     * saura a son prochain cycle, et tentera ce jeu tout de suite.
     */
    suspend fun help(context: Context, o: Offer, now: Long) {
        val c = ctx(context) ?: return
        val dev = Graph.store.value.relay?.dev ?: return
        val until = minOf(o.end ?: Long.MAX_VALUE, now + Relay.MAX_HELP_MS)
        publish(c, Relay.message(Relay.HELP, dev, now, listOf(Relay.gameOf(o, until = until))))
    }

    suspend fun claimed(context: Context, o: Offer, verdict: String, now: Long) {
        val c = ctx(context) ?: return
        val dev = Graph.store.value.relay?.dev ?: return
        publish(c, Relay.message(Relay.CLAIMED, dev, now, listOf(Relay.gameOf(o, at = now, status = verdict))))
    }
}
