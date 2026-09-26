package io.github.diaslamka.freegames.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.Stores

/**
 * Se connecter a un magasin, dans une page de l'appli. La session (les
 * cookies) reste dans l'appli : c'est elle que la recuperation utilisera.
 * Le moteur n'est PAS injecte ici -- cette page ne sert qu'a se connecter.
 */
@OptIn(ExperimentalMaterial3Api::class)
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun LoginScreen(store: String, country: String, onClose: () -> Unit) {
    val context = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    val web = remember {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.userAgentString = Graph.userAgent()
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.setSupportZoom(true)
            settings.builtInZoomControls = true
            settings.displayZoomControls = false
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val scheme = request.url.scheme?.lowercase()
                    return scheme != "http" && scheme != "https"
                }
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) { loading = true }
                override fun onPageFinished(view: WebView, url: String) { loading = false }
            }
            loadUrl(Accounts.loginUrl(store, country))
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            CookieManager.getInstance().flush()
            web.destroy()
        }
    }
    BackHandler { if (web.canGoBack()) web.goBack() else onClose() }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.login_title, if (store == Stores.AMAZON) stringResource(R.string.set_amazon) else Stores.label(store))) },
            navigationIcon = { IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, stringResource(R.string.close)) } },
            actions = { TextButton(onClick = onClose) { Text(stringResource(R.string.done)) } },
        )
        Text(
            stringResource(if (store == Stores.EPIC) R.string.login_hint_epic else R.string.login_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
        )
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        AndroidView(factory = { web }, modifier = Modifier.fillMaxSize())
    }
}
