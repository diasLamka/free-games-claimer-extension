package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.HttpResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Le reseau de l'appli. `cookies` rend la session des pages de connexion pour
 * une adresse : elle n'est jointe qu'aux requetes qui la demandent (ce que le
 * compte possede), jamais aux sources de decouverte.
 */
class Http(private val userAgent: () -> String, private val cookies: (String) -> String?) : Fetcher {
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    private fun request(url: String, withCookies: Boolean, accept: String): Request {
        val b = Request.Builder().url(url)
            .header("User-Agent", userAgent())
            .header("Accept", accept)
            .header("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8")
        if (withCookies) cookies(url)?.takeIf { it.isNotBlank() }?.let { b.header("Cookie", it) }
        return b.build()
    }

    override suspend fun get(url: String, withCookies: Boolean, accept: String): HttpResult = withContext(Dispatchers.IO) {
        client.newCall(request(url, withCookies, accept)).execute().use { r ->
            HttpResult(r.code, r.body.string(), r.request.url.toString())
        }
    }

    /** Une image, sans cookies, bornee a 4 Mo. */
    suspend fun bytes(url: String, max: Int = 4 * 1024 * 1024): ByteArray? = withContext(Dispatchers.IO) {
        try {
            client.newCall(request(url, false, "image/*")).execute().use { r ->
                if (!r.isSuccessful) return@use null
                val len = r.body.contentLength()
                if (len > max) return@use null
                r.body.bytes().takeIf { it.size <= max }
            }
        } catch (_: Exception) {
            null
        }
    }
}
