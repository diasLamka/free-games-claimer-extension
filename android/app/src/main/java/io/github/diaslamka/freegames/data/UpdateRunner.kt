package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Chercher, telecharger, verifier et installer la mise a jour (1.25.0) : un seul chemin pour les Reglages, le
 * bandeau de l'accueil et la veille de fond. Ce qui protege l'installation reste dans [AppUpdate] et [Install]
 * (version lue des publications du depot, taille, SHA-256, signature identique a l'appli installee).
 */
object UpdateRunner {
    /** Le reseau de la mise a jour ; les tests le remplacent. */
    internal var net: () -> AppUpdate.Net = { AppUpdate.OkNet(Graph.http.client) }

    /** La portee du telechargement lance depuis l'interface : celle du processus, pas celle d'un ecran. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var running: Job? = null

    /** Cherche une version plus recente ; le resultat est dans [AppUpdate.status]. Ne leve jamais. */
    suspend fun search(context: Context) {
        try {
            AppUpdate.check(net(), UpdateToken.load(context), BuildConfig.VERSION_NAME)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            AppUpdate.publish(AppUpdate.Status.Failed(AppUpdate.Reason.NETWORK))
        }
    }

    /**
     * [install] pour l'interface (bandeau, Reglages). Le bandeau est un element d'une liste : defiler ou changer
     * d'onglet le sort de la composition et annule sa coroutine, donc le telechargement en route. Celui-ci tourne
     * dans la portee du processus et va jusqu'au bout.
     *
     * Rend le travail lance, ou null s'il y en a deja un (un second appui ne relance rien). `onNotAllowed` est
     * appele, une fois, quand Android n'a pas encore autorise l'appli a installer : l'interface propose alors le geste.
     */
    @Synchronized
    fun installInBackground(context: Context, release: AppUpdate.Release, onNotAllowed: () -> Unit = {}): Job? {
        if (running?.isActive == true) return null
        val app = context.applicationContext
        return scope.launch { if (!install(app, release)) onNotAllowed() }.also { running = it }
    }

    /**
     * Telecharge `release`, la verifie, la passe au systeme. Rend faux, sans rien faire, quand Android n'a pas
     * encore autorise l'appli a installer des applis (le geste unique : [Install.allowIntent]). Ne leve jamais :
     * l'echec est dans [AppUpdate.status].
     */
    suspend fun install(context: Context, release: AppUpdate.Release): Boolean {
        if (!Install.allowed(context)) return false
        try {
            val file = AppUpdate.fetch(File(context.cacheDir, "maj"), net(), UpdateToken.load(context), release) {
                Install.sameApp(context, it, release.version)
            } ?: return true
            AppUpdate.publish(AppUpdate.Status.Installing)
            withContext(Dispatchers.IO) { Install.start(context, file) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            AppUpdate.publish(AppUpdate.Status.Failed(AppUpdate.Reason.INSTALL, e.message?.take(100)))
        }
        return true
    }
}
