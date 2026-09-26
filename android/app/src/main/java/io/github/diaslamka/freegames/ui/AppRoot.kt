package io.github.diaslamka.freegames.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SportsEsports
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import io.github.diaslamka.freegames.MainActivity
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.RelayLink
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.ShareText
import io.github.diaslamka.freegames.data.Watcher
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.work.Scheduler
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun AppRoot(session: ClaimSession, intents: StateFlow<Intent?>, onIntentHandled: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by Graph.store.state.collectAsState()
    val claim by session.ui.collectAsState()
    val intent by intents.collectAsState()
    var tab by rememberSaveable { mutableStateOf(0) }
    var login by rememberSaveable { mutableStateOf<String?>(null) }
    var shared by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = System.currentTimeMillis()
        }
    }

    fun refresh(then: (() -> Unit)? = null) {
        if (refreshing) return
        refreshing = true
        scope.launch {
            try {
                val r = Watcher.check(context, "ecran")
                if (r.errors.isNotEmpty() && r.offers == 0) Toast.makeText(context, r.errors.first(), Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                Toast.makeText(context, e.message ?: e.toString(), Toast.LENGTH_LONG).show()
            } finally {
                refreshing = false
                now = System.currentTimeMillis()
                then?.invoke()
            }
        }
    }

    fun claim(keys: Set<String>) {
        if (!session.start(keys)) {
            Toast.makeText(context, context.getString(R.string.busy_background), Toast.LENGTH_LONG).show()
        } else if (!session.ui.value.running) {
            Toast.makeText(context, context.getString(R.string.nothing_to_claim), Toast.LENGTH_SHORT).show()
        }
    }

    /* Le relais avec le PC (1.2.0) : un code scanne ou colle. */
    fun pairRelay(code: String) {
        scope.launch {
            val ok = RelayLink.pair(context, code, System.currentTimeMillis())
            Toast.makeText(context, context.getString(if (ok) R.string.relay_paired else R.string.relay_bad_code), Toast.LENGTH_LONG).show()
        }
    }

    /* Le lecteur de Google Play : sa camera, dans son processus -- l'appli ne
       demande pas la permission CAMERA. Sans Google Play, on colle le code. */
    fun scanRelay() {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        runCatching {
            GmsBarcodeScanning.getClient(context, options).startScan()
                .addOnSuccessListener { b -> b.rawValue?.let { pairRelay(it) } }
                .addOnFailureListener { Toast.makeText(context, context.getString(R.string.relay_scan_failed), Toast.LENGTH_LONG).show() }
        }.onFailure { Toast.makeText(context, context.getString(R.string.relay_scan_failed), Toast.LENGTH_LONG).show() }
    }

    fun updateSettings(block: (Settings) -> Settings) {
        scope.launch {
            val before = Graph.store.value.settings
            val after = Graph.store.update { it.copy(settings = block(it.settings)) }.settings
            if (after.checkHours != before.checkHours) Scheduler.periodic(context, after.checkHours, replace = true)
            if (after.country != before.country || after.showMobile != before.showMobile) refresh()
        }
    }

    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().decodeToString() } }.getOrNull()
            }
            var report: BackupIO.Report? = null
            if (text != null && text.length < 8 * 1024 * 1024) {
                Graph.store.update { s ->
                    val r = BackupIO.import(s, text, System.currentTimeMillis())
                    report = r?.second
                    r?.first ?: s
                }
            }
            val r = report
            Toast.makeText(
                context,
                if (r == null) context.getString(R.string.import_failed)
                else context.getString(R.string.import_done, r.library, r.wishes + r.imported),
                Toast.LENGTH_LONG,
            ).show()
        }
    }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val text = BackupIO.export(Graph.store.value, System.currentTimeMillis())
            val ok = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } != null }.getOrDefault(false)
            }
            Toast.makeText(context, context.getString(if (ok) R.string.export_done else R.string.export_failed), Toast.LENGTH_LONG).show()
        }
    }

    // Premiere ouverture : les notifications, puis un premier passage.
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && !state.settings.onboarded) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        if (!state.settings.onboarded) Graph.store.update { it.copy(settings = it.settings.copy(onboarded = true)) }
        val stale = state.lastCheck == null || System.currentTimeMillis() - state.lastCheck!! > 20 * 60_000
        val autoClaim = {
            val s = Graph.store.value
            if (s.settings.claimOnOpen && Rules.pending(s, System.currentTimeMillis()).any { s.accounts[it.store]?.status != Accounts.LOGGED_OUT }) {
                session.start()
            }
        }
        if (stale) refresh(autoClaim) else autoClaim()
    }

    // Ce qu'on nous demande de l'exterieur : notification, partage.
    LaunchedEffect(intent) {
        val i = intent ?: return@LaunchedEffect
        when {
            i.action == Intent.ACTION_SEND -> {
                val (t, _) = Titles.titleFromShared(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT))
                shared = t
                tab = 2
            }
            i.hasExtra(MainActivity.EXTRA_CLAIM) -> {
                val key = i.getStringExtra(MainActivity.EXTRA_CLAIM)
                tab = 0
                claim(if (key == null || key == "*") emptySet() else setOf(key))
            }
            i.hasExtra(MainActivity.EXTRA_TAB) -> tab = i.getIntExtra(MainActivity.EXTRA_TAB, 0)
        }
        onIntentHandled()
    }

    val current = login
    if (current != null) {
        LoginScreen(current, state.settings.country, onClose = {
            login = null
            CookieManager.getInstance().flush()
            scope.launch {
                val now2 = System.currentTimeMillis()
                val (acc, owned) = Accounts.check(current, state.settings.country, now2)
                Graph.store.update { s -> s.copy(accounts = s.accounts + (current to acc), steamOwned = owned?.toList() ?: s.steamOwned) }
            }
        })
        return
    }

    Scaffold(
        bottomBar = { BrutTabs(tab) { tab = it } },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ClaimPanel(session)
            when (tab) {
                0 -> GamesScreen(
                    state = state, now = now, refreshing = refreshing, claiming = claim.running,
                    onRefresh = { refresh() },
                    onClaim = { claim(it) },
                    onOpen = { ClaimSession.openExternally(context, it) },
                    onShare = { list ->
                        val text = ShareText.compose(context, list, state.upcoming, now)
                        context.startActivity(
                            Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), null),
                        )
                    },
                    onAccounts = { tab = 3 },
                )
                1 -> ClaimedScreen(state, onOpen = { ClaimSession.openExternally(context, it) })
                2 -> WishlistScreen(
                    state, now,
                    onAdd = { t -> scope.launch { Graph.store.update { s -> if (s.wishlist.any { Titles.normalise(it) == Titles.normalise(t) }) s else s.copy(wishlist = listOf(t) + s.wishlist) } } },
                    onRemove = { t -> scope.launch { Graph.store.update { s -> s.copy(wishlist = s.wishlist.filter { it != t }) } } },
                )
                else -> SettingsScreen(
                    state, now,
                    onLogin = { login = it },
                    onSettings = { updateSettings(it) },
                    onImport = { importer.launch(arrayOf("application/json", "text/plain", "*/*")) },
                    onExport = { exporter.launch("free-games-claimer-android.json") },
                    onClearSessions = {
                        CookieManager.getInstance().removeAllCookies(null)
                        CookieManager.getInstance().flush()
                        // Le stockage des pages aussi (localStorage, IndexedDB) : une session s'y cache parfois.
                        android.webkit.WebStorage.getInstance().deleteAllData()
                        scope.launch { Graph.store.update { it.copy(accounts = emptyMap(), steamOwned = emptyList()) } }
                    },
                    onCheckNow = { refresh() },
                    onRelayScan = { scanRelay() },
                    onRelayCode = { code -> pairRelay(code) },
                    onRelaySync = {
                        scope.launch {
                            val n = RelayLink.sync(context, System.currentTimeMillis())
                            RelayLink.alive(context, System.currentTimeMillis(), force = true)
                            Toast.makeText(context, context.getString(R.string.relay_synced, n), Toast.LENGTH_SHORT).show()
                        }
                    },
                    onRelayUnpair = { scope.launch { RelayLink.unpair(context) } },
                )
            }
        }
    }

    shared?.let { t ->
        ShareDialog(
            initial = t, state = state, now = now,
            onAdd = { title ->
                scope.launch { Graph.store.update { s -> if (s.wishlist.any { Titles.normalise(it) == Titles.normalise(title) }) s else s.copy(wishlist = listOf(title) + s.wishlist) } }
                shared = null
                Toast.makeText(context, context.getString(R.string.wish_added, title), Toast.LENGTH_SHORT).show()
            },
            onDismiss = { shared = null },
        )
    }
}

/**
 * Les onglets du bas : quatre cases cernees de noir, l'active en aplat
 * d'accent et decalee vers le haut. Pas de pastille Material.
 */
@Composable
fun BrutTabs(selected: Int, onSelect: (Int) -> Unit) {
    val b = io.github.diaslamka.freegames.ui.theme.LocalBrut.current
    val tabs = listOf(
        Triple(Icons.Rounded.SportsEsports, R.string.tab_games_short, 0),
        Triple(Icons.Rounded.Inventory2, R.string.tab_claimed, 1),
        Triple(Icons.Rounded.Star, R.string.tab_wishlist, 2),
        Triple(Icons.Rounded.Settings, R.string.tab_settings, 3),
    )
    androidx.compose.foundation.layout.Row(
        Modifier.background(b.base).navigationBarsPadding()
            .drawBehind { drawRect(androidx.compose.ui.graphics.Color.Black, size = androidx.compose.ui.geometry.Size(size.width, 3.dp.toPx())) }
            .padding(start = 8.dp, end = 12.dp, top = 12.dp, bottom = 10.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
    ) {
        tabs.forEach { (icon, label, i) ->
            val on = selected == i
            androidx.compose.foundation.layout.Column(
                Modifier.weight(1f).offset(y = if (on) (-4).dp else 0.dp)
                    .padding(end = 4.dp, bottom = 4.dp)
                    .brut(if (on) b.accent else androidx.compose.ui.graphics.Color.White, shadow = if (on) (if (b.dark) androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color.Black) else null, offset = 4.dp)
                    .clickableNoRipple { onSelect(i) }
                    .padding(vertical = 7.dp),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
            ) {
                Icon(icon, null, tint = androidx.compose.ui.graphics.Color.Black, modifier = Modifier.size(20.dp))
                Text(
                    stringResource(label).uppercase(), style = MaterialTheme.typography.labelSmall,
                    color = androidx.compose.ui.graphics.Color.Black, maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                )
            }
        }
    }
}
