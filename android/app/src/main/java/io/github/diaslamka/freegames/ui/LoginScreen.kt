package io.github.diaslamka.freegames.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Family
import androidx.webkit.WebViewCompat
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * Se connecter a un magasin, dans une page de l'appli. La session (les
 * cookies) reste dans l'appli : c'est elle que la recuperation utilisera.
 * Le moteur n'est PAS injecte ici -- cette page ne sert qu'a se connecter.
 *
 * Google et Facebook interdisent leur connexion dans une page integree a une
 * appli. La page s'arrete donc AVANT de les charger (Accounts.refusedProvider)
 * et l'appli dit quoi faire : pour Epic, poser un mot de passe sur le compte,
 * ce qu'Epic fait par e-mail et qui laisse la connexion Google intacte.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(store: String, country: String, onClose: () -> Unit, member: String? = null, memberName: String? = null) {
    val context = LocalContext.current
    val b = LocalBrut.current
    var loading by remember { mutableStateOf(true) }
    var refused by remember { mutableStateOf<String?>(null) }
    val web = remember {
        WebView(context).apply {
            // Toute la famille (1.9.0) : la session du membre vit dans son profil, avant tout autre usage.
            if (member != null) Family.attach(this, member)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString = Graph.userAgent()
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            val jar = if (member != null && Family.supported()) WebViewCompat.getProfile(this).cookieManager else CookieManager.getInstance()
            jar.setAcceptCookie(true)
            jar.setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val scheme = request.url.scheme?.lowercase()
                    if (scheme != "http" && scheme != "https") return true
                    Accounts.refusedProvider(request.url.toString())?.let { refused = it; return true }
                    return false
                }
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    // Filet : une ouverture qui n'est pas passee par le test ci-dessus.
                    Accounts.refusedProvider(url)?.let {
                        view.stopLoading()
                        refused = it
                        return
                    }
                    loading = true
                }
                override fun onPageFinished(view: WebView, url: String) { loading = false }
            }
            loadUrl(Accounts.loginUrl(store, country))
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            runCatching { (if (member != null && Family.supported()) WebViewCompat.getProfile(web).cookieManager else CookieManager.getInstance()).flush() }
            web.destroy()
        }
    }
    fun backToLogin() {
        refused = null
        web.loadUrl(Accounts.loginUrl(store, country))
    }
    BackHandler {
        when {
            refused != null -> backToLogin()
            web.canGoBack() -> web.goBack()
            else -> onClose()
        }
    }
    val storeName = if (store == Stores.AMAZON) stringResource(R.string.set_amazon) else Stores.label(store)
    Column(Modifier.fillMaxSize().background(b.base)) {
        TopBlock(stringResource(R.string.login_title, storeName) + (memberName?.let { " · " + it } ?: "")) {
            BrutButton(stringResource(R.string.done), onClose)
            SquareButton(Icons.Rounded.Close, stringResource(R.string.close), onClose)
        }
        Text(
            stringResource(if (store == Stores.EPIC) R.string.login_hint_epic else R.string.login_hint),
            style = MaterialTheme.typography.bodySmall,
            color = b.ink,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
        if (store == Stores.EPIC && refused == null) {
            Row(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                BrutButton(stringResource(R.string.login_set_password), { web.loadUrl(Accounts.EPIC_SET_PASSWORD) }, primary = false)
            }
        }
        if (loading && refused == null) {
            Box(Modifier.fillMaxWidth().height(4.dp).background(b.accent))
        }
        val provider = refused
        if (provider != null) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Notice(stringResource(R.string.login_refused_title, provider), b.accent)
                Text(stringResource(R.string.login_refused_why, provider), style = MaterialTheme.typography.bodyMedium, color = b.ink)
                if (store == Stores.EPIC) {
                    Text(stringResource(R.string.login_refused_epic, provider), style = MaterialTheme.typography.bodyMedium, color = b.ink)
                    BrutButton(stringResource(R.string.login_set_password), {
                        refused = null
                        web.loadUrl(Accounts.EPIC_SET_PASSWORD)
                    })
                } else {
                    Text(stringResource(R.string.login_refused_other, storeName), style = MaterialTheme.typography.bodyMedium, color = b.ink)
                }
                BrutButton(stringResource(R.string.login_back), { backToLogin() }, primary = false)
            }
        } else {
            Box(Modifier.fillMaxSize().background(Color.White)) {
                AndroidView(factory = { web }, modifier = Modifier.fillMaxSize())
            }
        }
    }
}
