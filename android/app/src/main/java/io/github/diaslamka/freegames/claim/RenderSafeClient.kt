package io.github.diaslamka.freegames.claim

import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Un client de WebView qui ne laisse jamais Android arreter l'appli quand le moteur de rendu de la page s'arrete
 * (memoire, plantage). Sans `onRenderProcessGone` qui rend `true`, le systeme tue tout le processus ; ici la page est
 * perdue, pas l'appli, et [onGone] decide quoi en faire : la WebView est inutilisable, il faut la jeter.
 */
open class RenderSafeClient(private val onGone: (didCrash: Boolean) -> Unit) : WebViewClient() {
    final override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onGone(detail.didCrash())
        return true
    }
}

/** Ce que voit ce qui attendait la page quand son moteur de rendu s'est arrete. */
class RendererGone(val didCrash: Boolean) : Exception(
    if (didCrash) "la page a plante (moteur de rendu de la WebView)" else "la page a ete arretee par le systeme (memoire)",
)
