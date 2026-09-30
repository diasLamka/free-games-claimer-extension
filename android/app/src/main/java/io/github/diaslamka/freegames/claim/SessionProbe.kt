package io.github.diaslamka.freegames.claim

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.AccountState
import io.github.diaslamka.freegames.model.Stores
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * « Suis-je connecte ? », confirme par la PAGE (1.17.0).
 *
 * La veille lit les cookies (Epic) ou appelle l'API du compte (Steam), sans
 * charger de page. Or ces deux magasins renouvellent leurs jetons de session
 * quand leur PAGE se charge, pas avant : passees quelques heures, la lecture
 * voit un jeton expire et conclut « pas connecte » -- alors que le compte l'est.
 * Le telephone se mettait alors a ignorer le magasin (rien recupere en fond,
 * bandeau « connecte-toi ») jusqu'a ce qu'on l'ouvre a la main, ce qui charge la
 * page et regle tout. Ici on fait ce geste a la place de la personne, et on le
 * fait AVANT de croire un « non ».
 *
 * REGLES.
 *   - un « oui » de la lecture se croit tel quel ;
 *   - un « non » ou un « je ne sais pas » ne devient jamais « deconnecte » sans
 *     que la page l'ait montre (redirection vers la connexion) ;
 *   - une page qui ne dit rien (defi anti-robot, page inattendue) laisse
 *     « inconnu », jamais « deconnecte » a quelqu'un qui etait connecte ;
 *   - une session deja declaree perdue PAR UNE PAGE n'est pas re-verifiee avant
 *     six heures : pas de page de magasin chargee pour un compte qui n'existe pas.
 */
object SessionProbe {
    /** Une session declaree perdue par une page n'est pas revue avant. */
    const val RECHECK_MS = 6 * 3_600_000L
    const val TIMEOUT_MS = 25_000L

    /**
     * Le verdict d'un magasin apres la page. Pure : la page (`land`) et la
     * relecture de Steam (`recheck`) sont passees en parametre.
     */
    suspend fun confirm(
        store: String,
        first: Pair<AccountState, Set<String>?>,
        prev: AccountState?,
        now: Long,
        busy: Boolean,
        land: suspend (String, Long) -> Pair<String?, String?>,
        recheck: suspend () -> Pair<AccountState, Set<String>?>,
    ): Pair<AccountState, Set<String>?> {
        val url = Accounts.pageUrl(store) ?: return first
        val (state, _) = first
        // Un oui est un oui ; et Epic « present » (cookies) n'est pas un non.
        if (state.status == Accounts.OK || state.status == Accounts.PRESENT) return first
        val wasGood = prev?.status == Accounts.OK || prev?.status == Accounts.PRESENT
        // Deja perdue, page a l'appui, il y a peu : on ne recharge pas le magasin pour rien.
        if (prev != null && prev.status == Accounts.LOGGED_OUT && prev.via == Accounts.PAGE && now - prev.checkedAt < RECHECK_MS) return prev to null
        // Un telechargement en cours (une recuperation) apportera sa propre preuve ; en attendant, on ne condamne pas.
        if (busy) return (if (wasGood) prev!!.copy(status = Accounts.UNKNOWN, via = null) else state) to null

        val (landed, title) = land(url, Accounts.pageVerdictSettle(store))
        return when (Accounts.pageVerdict(store, landed, title)) {
            Accounts.OK -> {
                // La page a renouvele les jetons : Steam peut maintenant dire ce qu'il possede.
                val again = if (store == Stores.STEAM) recheck() else null
                if (again != null && again.first.status == Accounts.OK) again.first.copy(via = Accounts.PAGE) to again.second
                else AccountState(Accounts.OK, now, via = Accounts.PAGE) to null
            }
            Accounts.LOGGED_OUT -> AccountState(Accounts.LOGGED_OUT, now, via = Accounts.PAGE) to null
            // Une page muette : on garde ce que la lecture disait pour Epic (pas de cookie), mais jamais « perdue » pour un compte qui etait bon.
            else -> (if (wasGood || store == Stores.STEAM) AccountState(Accounts.UNKNOWN, now) else state) to null
        }
    }

    /** Avec le vrai WebView. */
    suspend fun confirm(
        context: Context,
        store: String,
        country: String?,
        first: Pair<AccountState, Set<String>?>,
        prev: AccountState?,
        now: Long,
    ): Pair<AccountState, Set<String>?> = confirm(
        store, first, prev, now,
        busy = Graph.claimLock.isLocked,
        land = { url, settle -> landing(context, url, settle) },
        recheck = { Accounts.check(store, country, System.currentTimeMillis()) },
    )

    /** Charge `url` dans un WebView sans fenetre et rend (adresse finale, titre), ou (null, null) si la page ne s'est pas chargee. */
    @SuppressLint("SetJavaScriptEnabled")
    suspend fun landing(context: Context, url: String, settleMs: Long): Pair<String?, String?> = withContext(Dispatchers.Main) {
        val view = WebView(context.applicationContext)
        try {
            view.settings.javaScriptEnabled = true
            view.settings.domStorageEnabled = true
            view.settings.userAgentString = Graph.userAgent()
            // Une page de magasin n'a rien a lire sur le telephone.
            view.settings.allowFileAccess = false
            view.settings.allowContentAccess = false
            val jar = CookieManager.getInstance()
            jar.setAcceptCookie(true)
            jar.setAcceptThirdPartyCookies(view, true)
            val finished = CompletableDeferred<Unit>()
            view.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    val scheme = request.url.scheme?.lowercase()
                    return scheme != "http" && scheme != "https"
                }

                override fun onPageFinished(v: WebView, u: String) {
                    finished.complete(Unit)
                }
            }
            val m = context.resources.displayMetrics
            view.measure(
                android.view.View.MeasureSpec.makeMeasureSpec(m.widthPixels, android.view.View.MeasureSpec.EXACTLY),
                android.view.View.MeasureSpec.makeMeasureSpec(m.heightPixels, android.view.View.MeasureSpec.EXACTLY),
            )
            view.layout(0, 0, m.widthPixels, m.heightPixels)
            view.loadUrl(url)
            val done = withTimeoutOrNull(TIMEOUT_MS) { finished.await(); delay(settleMs) }
            if (done == null) null to null else view.url to view.title
        } finally {
            runCatching { view.stopLoading(); view.destroy() }
        }
    }
}
