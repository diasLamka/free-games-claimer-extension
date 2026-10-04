package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.diaslamka.freegames.BuildConfig
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.UpdateRunner
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Install
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.UpdateToken
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Tiles
import io.github.diaslamka.freegames.notify.Digest
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.height
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    state: AppState,
    now: Long,
    onLogin: (String) -> Unit,
    onSettings: ((Settings) -> Settings) -> Unit,
    onImport: () -> Unit,
    onExport: () -> Unit,
    onClearSessions: () -> Unit,
    onCheckNow: () -> Unit,
    /** Recuperer ce qui attend, maintenant (1.26.0) : l'accueil n'a plus de bouton pour cela. */
    onClaimNow: () -> Unit = {},
    onRelayScan: () -> Unit = {},
    onRelayCode: (String) -> Unit = {},
    onRelaySync: () -> Unit = {},
    onRelayUnpair: () -> Unit = {},
    family: FamilyActions = FamilyActions(),
    familySupported: Boolean = io.github.diaslamka.freegames.data.Family.supported(),
    /** Les sections ouvertes au depart (captures d'ecran, tests) ; sinon toutes pliees. */
    open: List<String> = emptyList(),
) {
    val s = state.settings
    var steamWarning by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    var backgroundInfo by remember { mutableStateOf(false) }
    var lastChanceInfo by remember { mutableStateOf(false) }
    val b = LocalBrut.current
    /* Toutes les sections sont pliees : un ecran de reglages est un sommaire, pas
       une page a lire. Une seule s'ouvre d'office -- les comptes, quand l'un d'eux
       a perdu sa session --, parce que c'est la qu'il y a quelque chose a faire. */
    val lost = Accounts.STORES.any { state.accounts[it]?.status == Accounts.LOGGED_OUT }
    var opened by rememberSaveable { mutableStateOf(open.ifEmpty { if (lost) listOf(SECTION_ACCOUNTS) else emptyList() }) }
    val title_health = stringResource(R.string.section_health)
    val title_accounts = stringResource(R.string.accounts)
    val title_claiming = stringResource(R.string.section_claiming)
    val title_watch = stringResource(R.string.section_watch)
    val title_relay = stringResource(R.string.section_relay)
    val title_family = stringResource(R.string.section_family)
    val title_data = stringResource(R.string.section_data)
    val title_about = stringResource(R.string.section_about)
    fun isOpen(key: String) = key in opened
    fun toggle(key: String) { opened = if (key in opened) opened - key else opened + key }
    ReadableColumn {
        TopBlock(stringResource(R.string.tab_settings))
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            // La page « Sante » (1.26.0), en premier : un probleme se lit avant les reglages. Le chiffre : les magasins a regarder.
            val health = io.github.diaslamka.freegames.data.Health.overview(state, now)
            fold(SECTION_HEALTH, title_health, health.problems.takeIf { it > 0 }, isOpen(SECTION_HEALTH), ::toggle) {
                HealthGroup(state, now)
            }
            fold(SECTION_ACCOUNTS, title_accounts, Accounts.STORES.count { state.accounts[it]?.status == Accounts.OK || state.accounts[it]?.status == Accounts.PRESENT }, isOpen(SECTION_ACCOUNTS), ::toggle) {
                Group {
                    Accounts.STORES.forEach { store -> AccountRow(store, state, now, onLogin) }
                }
            }
            fold(SECTION_CLAIMING, title_claiming, null, isOpen(SECTION_CLAIMING), ::toggle) {
                Group {
                    val waiting = Rules.pending(state, now).size
                    if (waiting > 0) BrutButton(stringResource(R.string.claim_now) + " ($waiting)", onClaimNow, icon = Icons.Rounded.Download)
                    Toggle(stringResource(R.string.set_claim_on_open), null, s.claimOnOpen) { v -> onSettings { it.copy(claimOnOpen = v) } }
                    Toggle(stringResource(R.string.set_background), null, s.claimInBackground) { v ->
                        if (v) backgroundInfo = true else onSettings { it.copy(claimInBackground = false) }
                    }
                    Toggle(Stores.label(Stores.EPIC), null, s.claimEpic) { v -> onSettings { it.copy(claimEpic = v) } }
                    Toggle(Stores.label(Stores.GOG), null, s.claimGog) { v -> onSettings { it.copy(claimGog = v) } }
                    Toggle(stringResource(R.string.set_amazon), null, s.claimAmazon) { v -> onSettings { it.copy(claimAmazon = v) } }
                    Toggle(stringResource(R.string.set_steam), stringResource(R.string.set_steam_hint), s.claimSteam) { v ->
                        if (v) steamWarning = true else onSettings { it.copy(claimSteam = false) }
                    }
                }
            }
            fold(SECTION_WATCH, title_watch, null, isOpen(SECTION_WATCH), ::toggle) {
                Group {
                    Choice(
                        stringResource(R.string.set_frequency),
                        listOf(1, 3, 6, 12).map { it to stringResource(R.string.every_hours, it) },
                        s.checkHours,
                    ) { v -> onSettings { it.copy(checkHours = v) } }
                    Choice(
                        stringResource(R.string.set_country),
                        Countries.ALL.map { it.code to it.label },
                        s.country,
                    ) { v -> onSettings { it.copy(country = v) } }
                    Toggle(stringResource(R.string.set_notify_new), null, s.notifyNew) { v -> onSettings { it.copy(notifyNew = v) } }
                    if (s.notifyNew) {
                        Choice(
                            stringResource(R.string.set_digest),
                            listOf(Digest.OFF to stringResource(R.string.digest_off)) + Digest.HOURS.map { it to stringResource(R.string.every_hours_at, it) },
                            s.digestHour,
                        ) { v -> onSettings { it.copy(digestHour = v) } }
                    }
                    Toggle(stringResource(R.string.set_notify_ending), null, s.notifyEnding) { v -> onSettings { it.copy(notifyEnding = v) } }
                    Toggle(stringResource(R.string.set_last_chance), null, s.lastChance) { v ->
                        if (v) lastChanceInfo = true else onSettings { it.copy(lastChance = false) }
                    }
                    Choice(
                        stringResource(R.string.set_tiles),
                        listOf(
                            Tiles.CARDS to stringResource(R.string.tiles_cards),
                            Tiles.LIST to stringResource(R.string.tiles_list),
                            Tiles.GRID to stringResource(R.string.tiles_grid),
                        ),
                        Tiles.of(s.tiles),
                    ) { v -> onSettings { it.copy(tiles = v) } }
                    Toggle(stringResource(R.string.set_mobile), null, s.showMobile) { v -> onSettings { it.copy(showMobile = v) } }
                    Toggle(stringResource(R.string.set_others), null, s.showOthers) { v -> onSettings { it.copy(showOthers = v) } }
                    Toggle(stringResource(R.string.set_ratings), null, s.steamRatings) { v -> onSettings { it.copy(steamRatings = v) } }
                    Toggle(stringResource(R.string.set_tonight), null, s.tonight) { v -> onSettings { it.copy(tonight = v) } }
                    Toggle(stringResource(R.string.set_taste), null, s.taste) { v -> onSettings { it.copy(taste = v) } }
                    if (s.taste) Toggle(stringResource(R.string.set_taste_quiet), null, s.tasteQuiet) { v -> onSettings { it.copy(tasteQuiet = v) } }
                    Box(Modifier.padding(top = 6.dp)) { BrutButton(stringResource(R.string.check_now), onCheckNow, primary = false) }
                }
            }
            fold(SECTION_RELAY, title_relay, null, isOpen(SECTION_RELAY), ::toggle) {
                RelayGroup(state, now, onRelayScan, onRelayCode, onRelaySync, onRelayUnpair)
            }
            fold(SECTION_FAMILY, title_family, state.family.size.takeIf { it > 0 }, isOpen(SECTION_FAMILY), ::toggle) {
                FamilyGroup(state, familySupported, family)
            }
            fold(SECTION_DATA, title_data, null, isOpen(SECTION_DATA), ::toggle) {
                Group {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        BrutButton(stringResource(R.string.import_backup), onImport)
                        BrutButton(stringResource(R.string.export_backup), onExport, primary = false)
                    }
                    state.importedAt?.let {
                        Text("> " + stringResource(R.string.imported_on, Fmt.date(it)), style = MaterialTheme.typography.bodySmall, color = Color.Black, modifier = Modifier.padding(top = 6.dp))
                    }
                    val clearName = stringResource(R.string.clear_sessions)
                    Text(
                        "✕ " + stringResource(R.string.clear_sessions).uppercase(),
                        style = MaterialTheme.typography.labelLarge, color = Color.White,
                        modifier = Modifier.padding(top = 10.dp).background(Color.Black).semantics { contentDescription = clearName }.clickableNoRipple { clearConfirm = true }.padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
            }
            // Les versions et la confidentialite vivent ici, et nulle part ailleurs.
            fold(SECTION_ABOUT, title_about, null, isOpen(SECTION_ABOUT), ::toggle) {
                Group {
                    Text(
                        stringResource(R.string.about_line, BuildConfig.VERSION_NAME, BuildConfig.ENGINE_VERSION),
                        style = MaterialTheme.typography.titleSmall, color = Color.Black,
                    )
                    Text(stringResource(R.string.section_privacy).uppercase(), style = MaterialTheme.typography.labelLarge, color = Color.Black, modifier = Modifier.padding(top = 6.dp))
                    listOf(R.string.privacy_1, R.string.privacy_2, R.string.privacy_3, R.string.privacy_4, R.string.privacy_5, R.string.privacy_6).forEach { id ->
                        Text("> " + stringResource(id), style = MaterialTheme.typography.bodySmall, color = Color.Black)
                    }
                    UpdateGroup(s, onSettings)
                }
            }
        }
    }

    if (steamWarning) {
        AlertDialog(
            onDismissRequest = { steamWarning = false },
            title = { Text(stringResource(R.string.steam_warning_title)) },
            text = { Text(stringResource(R.string.steam_warning_text)) },
            confirmButton = {
                TextButton(onClick = { steamWarning = false; onSettings { it.copy(claimSteam = true) } }) { Text(stringResource(R.string.steam_warning_ok)) }
            },
            dismissButton = { TextButton(onClick = { steamWarning = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (backgroundInfo) {
        AlertDialog(
            onDismissRequest = { backgroundInfo = false },
            title = { Text(stringResource(R.string.background_title)) },
            text = { Text(stringResource(R.string.background_text)) },
            confirmButton = {
                TextButton(onClick = { backgroundInfo = false; onSettings { it.copy(claimInBackground = true) } }) { Text(stringResource(R.string.background_ok)) }
            },
            dismissButton = { TextButton(onClick = { backgroundInfo = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (lastChanceInfo) {
        AlertDialog(
            onDismissRequest = { lastChanceInfo = false },
            title = { Text(stringResource(R.string.last_chance_title)) },
            text = { Text(stringResource(R.string.last_chance_text)) },
            confirmButton = {
                TextButton(onClick = { lastChanceInfo = false; onSettings { it.copy(lastChance = true) } }) { Text(stringResource(R.string.last_chance_ok)) }
            },
            dismissButton = { TextButton(onClick = { lastChanceInfo = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (clearConfirm) {
        AlertDialog(
            onDismissRequest = { clearConfirm = false },
            title = { Text(stringResource(R.string.clear_sessions)) },
            text = { Text(stringResource(R.string.clear_sessions_text)) },
            confirmButton = { TextButton(onClick = { clearConfirm = false; onClearSessions() }) { Text(stringResource(R.string.clear)) } },
            dismissButton = { TextButton(onClick = { clearConfirm = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/**
 * La mise a jour de l'appli (1.20.0) : chercher, telecharger, installer, sans
 * repasser par le navigateur. Voir data/AppUpdate.kt pour ce qui la protege.
 */
@Composable
private fun UpdateGroup(settings: Settings, onSettings: ((Settings) -> Settings) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val status by AppUpdate.status.collectAsStateWithLifecycle()
    var tokenInput by remember { mutableStateOf("") }
    var hasToken by remember { mutableStateOf(UpdateToken.present(context)) }
    var tokenNote by remember { mutableStateOf<Int?>(null) }
    var tokenOpen by remember { mutableStateOf(false) }
    var allowDialog by remember { mutableStateOf(false) }

    fun search() { scope.launch { UpdateRunner.search(context) } }
    fun install(release: AppUpdate.Release) {
        UpdateRunner.installInBackground(context, release) { allowDialog = true }
    }
    // On regarde une fois en ouvrant la section : la reponse est la, sans geste de plus.
    LaunchedEffect(Unit) { if (AppUpdate.status.value is AppUpdate.Status.Idle) search() }

    Text(stringResource(R.string.update_section).uppercase(), style = MaterialTheme.typography.labelLarge, color = Color.Black, modifier = Modifier.padding(top = 10.dp))
    Text(
        when (val st = status) {
            is AppUpdate.Status.Idle -> ""
            is AppUpdate.Status.Checking -> stringResource(R.string.update_checking)
            is AppUpdate.Status.UpToDate -> stringResource(R.string.update_latest)
            is AppUpdate.Status.Available -> stringResource(R.string.update_available, st.release.version)
            is AppUpdate.Status.Downloading -> stringResource(R.string.update_downloading, st.percent)
            is AppUpdate.Status.Installing -> stringResource(R.string.update_installing)
            is AppUpdate.Status.Failed -> when (st.reason) {
                AppUpdate.Reason.PRIVATE -> stringResource(R.string.update_fail_private)
                AppUpdate.Reason.RATE_LIMIT -> stringResource(R.string.update_fail_rate)
                AppUpdate.Reason.NETWORK -> stringResource(R.string.update_fail_network)
                AppUpdate.Reason.NO_RELEASE -> stringResource(R.string.update_fail_none)
                AppUpdate.Reason.BAD_FILE -> stringResource(R.string.update_fail_file, st.detail.orEmpty())
                AppUpdate.Reason.WRONG_APP -> stringResource(R.string.update_fail_wrong)
                AppUpdate.Reason.INSTALL -> stringResource(R.string.update_fail_install, st.detail.orEmpty())
            }
        },
        style = MaterialTheme.typography.bodySmall, color = Color.Black,
    )
    Box(Modifier.padding(top = 6.dp)) {
        when (val st = status) {
            is AppUpdate.Status.Available -> BrutButton(stringResource(R.string.update_install, st.release.version), { install(st.release) })
            is AppUpdate.Status.Checking, is AppUpdate.Status.Downloading, is AppUpdate.Status.Installing -> {}
            else -> BrutButton(stringResource(R.string.update_check), { search() }, primary = false)
        }
    }
    Toggle(stringResource(R.string.set_auto_update), stringResource(R.string.set_auto_update_hint), settings.autoUpdate) { v -> onSettings { it.copy(autoUpdate = v) } }
    // Ce qu'Android fera de la prochaine mise a jour (1.26.0) : on le lit, on ne le promet pas.
    Text(
        stringResource(
            when (Install.silence(context)) {
                Install.Silence.ASKS_ALWAYS -> R.string.update_silence_always
                Install.Silence.NEEDS_PERMISSION -> R.string.update_silence_permission
                Install.Silence.FIRST_TIME -> R.string.update_silence_first
                Install.Silence.SILENT -> R.string.update_silence_ok
            },
        ),
        style = MaterialTheme.typography.bodySmall, color = Color.Black,
    )
    Toggle(stringResource(R.string.set_notify_update), null, settings.notifyUpdate) { v -> onSettings { it.copy(notifyUpdate = v) } }

    Text(
        (if (tokenOpen) "▾ " else "▸ ") + stringResource(R.string.update_token_title).uppercase(),
        style = MaterialTheme.typography.labelLarge, color = Color.Black,
        modifier = Modifier.padding(top = 8.dp).clickableNoRipple { tokenOpen = !tokenOpen },
    )
    if (tokenOpen) {
        Text(stringResource(R.string.update_token_hint), style = MaterialTheme.typography.bodySmall, color = Color.Black)
        if (hasToken) {
            Text("> " + stringResource(R.string.update_token_saved), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            BrutButton(stringResource(R.string.update_token_clear), {
                UpdateToken.clear(context); hasToken = false; tokenNote = null
            }, primary = false)
        } else {
            BrutField(tokenInput, { tokenInput = it.filter { c -> !c.isWhitespace() } }, "github_pat_…", onDone = null)
            BrutButton(stringResource(R.string.update_token_save), {
                if (UpdateToken.save(context, tokenInput)) {
                    hasToken = true; tokenInput = ""; tokenNote = null
                    search()
                } else {
                    tokenNote = R.string.update_token_bad
                }
            })
            tokenNote?.let { Text("> " + stringResource(it), style = MaterialTheme.typography.bodySmall, color = Color.Black) }
        }
    }

    if (allowDialog) {
        AlertDialog(
            onDismissRequest = { allowDialog = false },
            title = { Text(stringResource(R.string.update_allow_title)) },
            text = { Text(stringResource(R.string.update_allow_text)) },
            confirmButton = {
                TextButton(onClick = { allowDialog = false; runCatching { context.startActivity(Install.allowIntent(context)) } }) {
                    Text(stringResource(R.string.update_allow_ok))
                }
            },
            dismissButton = { TextButton(onClick = { allowDialog = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/**
 * Le relais avec le PC : associer (scanner le QR code du popup de
 * l'extension, ou coller son code), voir quand le PC a parle, dissocier.
 */
@Composable
private fun RelayGroup(
    state: AppState,
    now: Long,
    onScan: () -> Unit,
    onCode: (String) -> Unit,
    onSync: () -> Unit,
    onUnpair: () -> Unit,
) {
    var pasting by remember { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    val r = state.relay
    Group {
        if (r == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
                BrutButton(stringResource(R.string.relay_scan), onScan)
                BrutButton(stringResource(R.string.relay_paste), { pasting = !pasting }, primary = false)
            }
            if (pasting) {
                BrutField(code, { code = it }, "FGC1-…", onDone = { onCode(code.trim()); code = ""; pasting = false })
                BrutButton(stringResource(R.string.relay_pair), { onCode(code.trim()); code = ""; pasting = false })
            }
        } else {
            Tag(
                (if (r.peerAt != null) stringResource(R.string.relay_heard, Fmt.ago(LocalContext.current, r.peerAt, now)) else stringResource(R.string.relay_not_heard)).uppercase(),
                if (r.peerAt != null) LocalBrut.current.accent else Color.White, Color.Black,
                bordered = r.peerAt == null, maxLines = 3,
            )
            Text("> " + stringResource(R.string.relay_paired_on, Fmt.date(r.pairedAt)), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            r.lastError?.let { Text("> " + stringResource(R.string.relay_error, it), style = MaterialTheme.typography.bodySmall, color = Color.Black) }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 6.dp)) {
                BrutButton(stringResource(R.string.relay_sync), onSync, primary = false)
                BrutButton(stringResource(if (confirm) R.string.relay_unpair_confirm else R.string.relay_unpair), {
                    if (confirm) { confirm = false; onUnpair() } else confirm = true
                }, primary = false)
            }
        }
    }
}

const val SECTION_HEALTH = "health"
const val SECTION_ACCOUNTS = "accounts"
const val SECTION_CLAIMING = "claiming"
const val SECTION_WATCH = "watch"
const val SECTION_RELAY = "relay"
const val SECTION_FAMILY = "family"
const val SECTION_DATA = "data"
const val SECTION_ABOUT = "about"

/** Une section pliable : l'en-tete se touche, le corps n'existe que si elle est ouverte. */
private fun LazyListScope.fold(key: String, title: String, count: Int?, open: Boolean, onToggle: (String) -> Unit, body: @Composable () -> Unit) {
    item(key = "h:$key") { SectionHeader(title, count, open, { onToggle(key) }) }
    if (open) item(key = "b:$key") { body() }
}

@Composable
internal fun Group(content: @Composable () -> Unit) {
    val b = LocalBrut.current
    Column(
        Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).brut(Color.White, shadow = b.shadow, offset = 6.dp).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccountRow(store: String, state: AppState, now: Long, onLogin: (String) -> Unit) {
    val b = LocalBrut.current
    val a = state.accounts[store]
    val (text, ok) = when (a?.status) {
        Accounts.OK -> (a.name?.let { stringResource(R.string.account_ok_named, it) } ?: stringResource(R.string.account_ok)) to true
        Accounts.PRESENT -> stringResource(R.string.account_present) to true
        Accounts.LOGGED_OUT -> stringResource(R.string.account_logged_out) to false
        else -> stringResource(R.string.account_unknown) to null
    }
    // Le bouton passe sous le nom quand la place manque (petit ecran, grande police).
    FlowRow(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.widthIn(min = 150.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                (if (store == Stores.AMAZON) stringResource(R.string.set_amazon) else Stores.label(store)).uppercase(),
                style = MaterialTheme.typography.titleSmall, color = Color.Black,
            )
            Tag(
                text.uppercase(),
                when (ok) { true -> b.accent; false -> Color.Black; null -> Color.White },
                if (ok == false) Color.White else Color.Black,
                bordered = ok == null,
                maxLines = 3,
            )
        }
        BrutButton(stringResource(if (ok == true) R.string.open_store else R.string.login), { onLogin(store) }, primary = ok != true)
    }
    Box(Modifier.fillMaxWidth().height(2.dp).background(Color.Black))
}

@Composable
private fun Toggle(title: String, hint: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
        }
        BrutToggle(checked, onChange)
    }
}

@Composable
private fun <T> Choice(title: String, options: List<Pair<T, String>>, selected: T, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(title.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, modifier = Modifier.weight(1f))
        Box {
            BrutButton((options.firstOrNull { it.first == selected }?.second ?: "—") + " ▾", { open = true }, primary = false)
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (v, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(v) })
                }
            }
        }
    }
}
