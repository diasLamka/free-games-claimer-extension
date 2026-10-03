package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Chercher, telecharger, verifier et installer la mise a jour (1.25.0) : un seul chemin pour les Reglages, le
 * bandeau de l'accueil et la veille de fond. Ce qui protege l'installation reste dans [AppUpdate] et [Install]
 * (version lue des publications du depot, taille, SHA-256, signature identique a l'appli installee).
 */
object UpdateRunner {
    private fun net() = AppUpdate.OkNet(Graph.http.client)

    /** Cherche une version plus recente ; le resultat est dans [AppUpdate.status]. Ne leve jamais. */
    suspend fun search(context: Context) {
        try {
            AppUpdate.check(net(), UpdateToken.load(context), BuildConfig.VERSION_NAME)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            AppUpdate.status.value = AppUpdate.Status.Failed(AppUpdate.Reason.NETWORK)
        }
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
            AppUpdate.status.value = AppUpdate.Status.Installing
            withContext(Dispatchers.IO) { Install.start(context, file) }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            AppUpdate.status.value = AppUpdate.Status.Failed(AppUpdate.Reason.INSTALL, e.message?.take(100))
        }
        return true
    }
}
