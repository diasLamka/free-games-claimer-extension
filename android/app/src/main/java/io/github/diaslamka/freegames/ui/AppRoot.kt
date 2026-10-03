package io.github.diaslamka.freegames.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.webkit.CookieManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
import io.github.diaslamka.freegames.Raccourcis
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.BackupIO
import io.github.diaslamka.freegames.data.Family
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.widget.TonightWidget
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
    // Toute la famille (1.9.0) : la connexion au nom d'un membre, et sa recuperation a l'ecran.
    var loginMember by rememberSaveable { mutableStateOf<String?>(null) }
    var familySession by remember { mutableStateOf<ClaimSession?>(null) }
    var familyJob by remember { mutableStateOf<kotlinx.coroutines.Job?>(null) }
    var shared by remember { mutableStateOf<String?>(null) }
    // Un lien fgclaimer://finir (1.4.0) : le jeu que le PC n'a pas pu finir.
    var helpLink by remember { mutableStateOf<io.github.diaslamka.freegames.data.Relay.AppLink?>(null) }
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
            if (after.lastChance && !before.lastChance) {
                val t = System.currentTimeMillis()
                io.github.diaslamka.freegames.notify.LastChance.ring(context, t)
                io.github.diaslamka.freegames.notify.LastChance.schedule(context, Graph.store.value, t)
            }
            if (after.digestHour != before.digestHour || after.tasteQuiet != before.tasteQuiet || after.taste != before.taste) {
                // Le resume du jour (1.13.0) : la nouvelle heure remplace l'ancienne ; coupe, il n'y a plus rien a reveiller.
                // Le silence intelligent (1.15.0) en demande un aussi, a 20 h par defaut.
                val heure = io.github.diaslamka.freegames.notify.Digest.effectiveHour(Graph.store.value)
                if (io.github.diaslamka.freegames.notify.Digest.enabled(heure)) {
                    val t = System.currentTimeMillis()
                    Scheduler.digestAt(context, io.github.diaslamka.freegames.notify.Digest.nextSlot(heure, t, java.time.ZoneId.systemDefault()) + 60_000, replace = true)
                } else Scheduler.cancelDigest(context)
            }
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
                else context.getString(R.string.import_done, r.library, r.wishes + r.imported, r.owned),
                Toast.LENGTH_LONG,
            ).show()
            if (r != null) runCatching { TonightWidget.refresh(context) }
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

    // Une mise a jour de l'appli existe-t-elle ? (1.25.0) Une recherche a l'ouverture : le bandeau de l'accueil en vit.
    LaunchedEffect(Unit) {
        if (io.github.diaslamka.freegames.data.AppUpdate.status.value is io.github.diaslamka.freegames.data.AppUpdate.Status.Idle) {
            io.github.diaslamka.freegames.data.UpdateRunner.search(context)
        }
    }

    // Ce qu'on nous demande de l'exterieur : notification, partage.
    LaunchedEffect(intent) {
        val i = intent ?: return@LaunchedEffect
        when {
            i.action == Intent.ACTION_VIEW && i.data?.scheme == "fgclaimer" -> {
                tab = 0
                val link = io.github.diaslamka.freegames.data.Relay.parseAppLink(i.dataString)
                if (link != null) {
                    helpLink = link
                    // Pas encore dans les offres de l'appli : une verification, puis la reponse.
                    if (io.github.diaslamka.freegames.data.Relay.findOffer(Graph.store.value, link.store, link.id, link.title) == null) refresh()
                }
            }
            i.action == Intent.ACTION_SEND -> {
                val (t, _) = Titles.titleFromShared(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getStringExtra(Intent.EXTRA_TEXT))
                shared = t
                tab = 2
            }
            Raccourcis.destination(i.action) != null -> {
                // Appui long sur l'icone (1.12.0) : l'onglet, et la recuperation pour le premier.
                val d = Raccourcis.destination(i.action)!!
                tab = d.tab
                if (d.claim) claim(emptySet())
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
    val pour = loginMember
    if (current != null && pour != null) {
        LoginScreen(current, state.settings.country, onClose = {
            login = null
            loginMember = null
            scope.launch {
                val acc = Family.check(pour, current, state.settings.country, System.currentTimeMillis())
                Graph.store.update { s -> Family.setAccount(s, pour, current, acc) }
            }
        }, member = pour, memberName = Family.member(state, pour)?.name)
        return
    }
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

    /*
     * Toute la famille (1.9.0) : un membre (ou tous, `id` null) apres l'autre,
     * chacun dans sa page et son profil, a l'ecran : une verification
     * demandee se fait ici, au nom du membre.
     */
    fun claimFamily(id: String?) {
        if (familyJob?.isActive == true || session.ui.value.running) return
        familyJob = scope.launch {
            if (!Graph.claimLock.tryLock()) {
                Toast.makeText(context, context.getString(R.string.busy_background), Toast.LENGTH_LONG).show()
                return@launch
            }
            try {
                val members = Graph.store.value.family.filter { id == null || it.id == id }
                var ran = false
                for (m in members) {
                    val todo = Family.todo(Graph.store.value, m, System.currentTimeMillis(), force = emptySet())
                    if (todo.isEmpty()) {
                        if (id != null) Toast.makeText(context, context.getString(R.string.family_nothing, m.name), Toast.LENGTH_LONG).show()
                        continue
                    }
                    familySession?.release()
                    val fs = ClaimSession(context, scope, member = m.id)
                    familySession = fs
                    ran = true
                    fs.runShown(todo)
                }
                if (!ran && id == null) Toast.makeText(context, context.getString(R.string.nothing_to_claim), Toast.LENGTH_SHORT).show()
            } finally {
                Graph.claimLock.unlock()
            }
        }
    }

    /* Ce soir je joue a... (1.8.0) : chaque geste change l'etat, puis le widget. */
    fun tonightUpdate(change: (io.github.diaslamka.freegames.model.AppState) -> io.github.diaslamka.freegames.model.AppState) {
        scope.launch {
            Graph.store.update(change)
            runCatching { TonightWidget.refresh(context) }
        }
    }

    val screen: @Composable () -> Unit = {
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
                    onTiles = { v -> updateSettings { it.copy(tiles = v) } },
                    onHelpDismiss = { key ->
                        scope.launch { Graph.store.update { s -> s.copy(relay = s.relay?.let { r -> r.copy(help = r.help - key) }) } }
                    },
                )
                1 -> ClaimedScreen(
                    state, onOpen = { ClaimSession.openExternally(context, it) }, now = now,
                    tonight = TonightActions(
                        onKeep = { pick -> tonightUpdate { it.copy(tonight = pick) } },
                        onSettings = { time, deck, coop -> tonightUpdate { it.copy(tonight = it.tonight.copy(time = time, deckOnly = deck, coop = coop, key = null, shown = emptyList())) } },
                        onAnother = { tonightUpdate { Tonight.reroll(it, System.currentTimeMillis()) } },
                        // Le creneau libre lu dans l'agenda : on retire le choix, il se refait avec le bon temps.
                        onEvening = { e -> tonightUpdate { it.copy(evening = e, tonight = it.tonight.copy(key = null, shown = emptyList())) } },
                        onPlaying = { jeu ->
                            tonightUpdate {
                                Tonight.mark(it, jeu.c.key, Tonight.PLAYING).copy(
                                    tonight = it.tonight.copy(
                                        key = null, playing = jeu.c.key, playingTitle = jeu.c.title,
                                        playingPage = Tonight.page(jeu.c), playingAt = System.currentTimeMillis(),
                                    ),
                                )
                            }
                        },
                        onNotForMe = { jeu ->
                            tonightUpdate { Tonight.reroll(Tonight.mark(it, jeu.c.key, Tonight.NOT_FOR_ME), System.currentTimeMillis()) }
                            Toast.makeText(context, context.getString(R.string.tonight_dropped, jeu.c.title), Toast.LENGTH_SHORT).show()
                        },
                    ),
                )
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
                        // Et celles de la famille (1.9.0).
                        Family.clearAll(state)
                        scope.launch {
                            Graph.store.update { st ->
                                st.copy(accounts = emptyMap(), steamOwned = emptyList(), family = st.family.map { it.copy(accounts = emptyMap()) })
                            }
                        }
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
                    family = FamilyActions(
                        onAdd = { name -> scope.launch { Graph.store.update { Family.add(it, name, System.currentTimeMillis()) } } },
                        onRemove = { id ->
                            if (familySession?.member == id) { familySession?.release(); familySession = null }
                            Family.forget(id)
                            scope.launch { Graph.store.update { Family.remove(it, id) } }
                        },
                        onLogin = { id, store -> loginMember = id; login = store },
                        onClaim = { id -> claimFamily(id) },
                    ),
                )
            }
    }

    AdaptiveFrame(tab, { tab = it }, top = {
        val fs = familySession
        if (fs != null) ClaimPanel(
            fs,
            onStopped = { familyJob?.cancel() },
            onDismissed = { fs.release(); familySession = null },
        ) else ClaimPanel(session)
    }) { screen() }

    helpLink?.let { link ->
        HelpDialog(
            // Pendant une verification, « recherche » ; apres, la reponse.
            ask = resolveHelp(link, state, refreshed = !refreshing),
            onFinish = { o -> helpLink = null; claim(setOf(o.key)) },
            onDismiss = { helpLink = null },
        )
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
 * Le cadre, pour toutes les tailles (1.3.0). Sous 600 dp -- un telephone en
 * portrait --, les onglets en bas ; au-dela -- pliable ouvert, tablette,
 * telephone en paysage --, un rail sur le cote, comme le veulent les classes
 * de taille de fenetre d'Android. La largeur est celle de la FENETRE : en
 * ecran partage, l'appli suit sa moitie. Les barres du systeme et les
 * encoches de camera sont laissees libres.
 */
@Composable
fun AdaptiveFrame(tab: Int, onTab: (Int) -> Unit, top: @Composable () -> Unit = {}, content: @Composable () -> Unit) {
    val wide = LocalConfiguration.current.screenWidthDp >= 600
    if (wide) {
        Row(
            Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            BrutRail(tab, onTab)
            Column(Modifier.weight(1f).fillMaxHeight()) {
                top()
                content()
            }
        }
    } else {
        Scaffold(
            bottomBar = { BrutTabs(tab, onTab) },
            containerColor = MaterialTheme.colorScheme.background,
        ) { padding ->
            Column(
                Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding)
                    .windowInsetsPadding(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)),
            ) {
                top()
                content()
            }
        }
    }
}

private val TABS = listOf(
    Triple(Icons.Rounded.SportsEsports, R.string.tab_games_short, 0),
    Triple(Icons.Rounded.Inventory2, R.string.tab_claimed, 1),
    Triple(Icons.Rounded.Star, R.string.tab_wishlist, 2),
    Triple(Icons.Rounded.Settings, R.string.tab_settings, 3),
)

/**
 * Le rail, sur un ecran large : les memes quatre cases, empilees sur le cote,
 * l'active en aplat d'accent et decalee vers la droite.
 */
@Composable
fun BrutRail(selected: Int, onSelect: (Int) -> Unit) {
    val b = io.github.diaslamka.freegames.ui.theme.LocalBrut.current
    Column(
        Modifier.fillMaxHeight().width(104.dp).background(b.base)
            .drawBehind { drawRect(androidx.compose.ui.graphics.Color.Black, topLeft = androidx.compose.ui.geometry.Offset(size.width - 3.dp.toPx(), 0f), size = androidx.compose.ui.geometry.Size(3.dp.toPx(), size.height)) }
            .verticalScroll(rememberScrollState())
            .padding(start = 10.dp, end = 16.dp, top = 16.dp, bottom = 16.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
    ) {
        TABS.forEach { (icon, label, i) ->
            val on = selected == i
            Column(
                Modifier.fillMaxWidth().offset(x = if (on) 4.dp else 0.dp)
                    .padding(end = 4.dp, bottom = 4.dp)
                    .brut(if (on) b.accent else androidx.compose.ui.graphics.Color.White, shadow = if (on) (if (b.dark) androidx.compose.ui.graphics.Color.White else androidx.compose.ui.graphics.Color.Black) else null, offset = 4.dp)
                    .selectable(selected = on, role = Role.Tab) { onSelect(i) }
                    .padding(vertical = 10.dp),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
            ) {
                Icon(icon, null, tint = androidx.compose.ui.graphics.Color.Black, modifier = Modifier.size(22.dp))
                TabLabel(stringResource(label))
            }
        }
    }
}

/**
 * Les onglets du bas : quatre cases cernees de noir, l'active en aplat
 * d'accent et decalee vers le haut. Pas de pastille Material.
 */
@Composable
fun BrutTabs(selected: Int, onSelect: (Int) -> Unit) {
    val b = io.github.diaslamka.freegames.ui.theme.LocalBrut.current
    val tabs = TABS
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
                    .selectable(selected = on, role = Role.Tab) { onSelect(i) }
                    .padding(vertical = 7.dp),
                horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
            ) {
                Icon(icon, null, tint = androidx.compose.ui.graphics.Color.Black, modifier = Modifier.size(20.dp))
                TabLabel(stringResource(label))
            }
        }
    }
}

/**
 * Le libelle d'un onglet, sur une ligne : en grande police, il retrecit pour
 * tenir dans sa case, jamais en dessous de sa taille normale (11 sp a
 * l'echelle 1). Le nom entier reste celui que lit TalkBack.
 */
@Composable
private fun TabLabel(text: String) {
    val style = MaterialTheme.typography.labelSmall
    val min = with(androidx.compose.ui.platform.LocalDensity.current) { 10.dp.toSp() }
    androidx.compose.foundation.text.BasicText(
        text.uppercase(),
        style = style.copy(color = androidx.compose.ui.graphics.Color.Black),
        maxLines = 1,
        overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        autoSize = if (min < style.fontSize) androidx.compose.foundation.text.TextAutoSize.StepBased(min, style.fontSize, 0.5.sp) else null,
        modifier = Modifier.padding(horizontal = 3.dp),
    )
}
