package io.github.diaslamka.freegames.data

import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebSettings
import java.io.File

/**
 * Les quelques objets partages par l'ecran et la veille de fond. Un seul
 * processus : un seul magasin d'etat, un seul client reseau.
 */
object Graph {
    @Volatile private var ready = false
    lateinit var store: StateStore
        private set
    lateinit var http: Http
        private set
    lateinit var app: Context
        private set

    @Volatile private var ua: String? = null

    /**
     * Une seule recuperation a la fois, ecran ou fond : deux pages pilotees
     * en meme temps sur un meme compte, c'est le trafic qu'un magasin remarque.
     */
    val claimLock = kotlinx.coroutines.sync.Mutex()

    fun init(context: Context) {
        if (ready) return
        synchronized(this) {
            if (ready) return
            app = context.applicationContext
            store = StateStore(File(app.filesDir, "etat.json"))
            http = Http({ userAgent() }, { url -> cookiesFor(url) })
            ready = true
        }
    }

    /**
     * Un navigateur de bureau, de la version de Chrome du telephone : les
     * pages des magasins se rendent alors comme celles que le moteur a
     * mesurees, et une verification Cloudflare passee dans une page vaut pour
     * les autres (elle est liee au navigateur annonce).
     */
    fun userAgent(): String {
        ua?.let { return it }
        val version = try {
            Regex("Chrome/([\\d.]+)").find(WebSettings.getDefaultUserAgent(app))?.groupValues?.get(1)
        } catch (_: Exception) {
            null
        } ?: "140.0.0.0"
        val major = version.substringBefore('.')
        return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36"
            .also { ua = it }
    }

    fun cookiesFor(url: String): String? = try {
        CookieManager.getInstance().getCookie(url)
    } catch (_: Exception) {
        null
    }
}
