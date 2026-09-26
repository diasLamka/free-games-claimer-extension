package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import io.github.diaslamka.freegames.BuildConfig
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Settings
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.height

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
    onRelayScan: () -> Unit = {},
    onRelayCode: (String) -> Unit = {},
    onRelaySync: () -> Unit = {},
    onRelayUnpair: () -> Unit = {},
) {
    val s = state.settings
    var steamWarning by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    var backgroundInfo by remember { mutableStateOf(false) }
    val b = LocalBrut.current
    Column(Modifier.fillMaxSize().background(b.base)) {
        TopBlock(stringResource(R.string.tab_settings))
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { SectionHeader(stringResource(R.string.accounts), Accounts.STORES.count { state.accounts[it]?.status == Accounts.OK || state.accounts[it]?.status == Accounts.PRESENT }) }
            item {
                Group {
                    Accounts.STORES.forEach { store -> AccountRow(store, state, now, onLogin) }
                    Text(
                        "> " + stringResource(R.string.login_tip),
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF4A4A4A),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
            item { SectionHeader(stringResource(R.string.section_claiming), null) }
            item {
                Group {
                    Toggle(stringResource(R.string.set_claim_on_open), stringResource(R.string.set_claim_on_open_hint), s.claimOnOpen) { v -> onSettings { it.copy(claimOnOpen = v) } }
                    Toggle(stringResource(R.string.set_background), stringResource(R.string.set_background_hint), s.claimInBackground) { v ->
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
            item { SectionHeader(stringResource(R.string.section_watch), null) }
            item {
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
                    Toggle(stringResource(R.string.set_notify_ending), null, s.notifyEnding) { v -> onSettings { it.copy(notifyEnding = v) } }
                    Toggle(stringResource(R.string.set_mobile), null, s.showMobile) { v -> onSettings { it.copy(showMobile = v) } }
                    Toggle(stringResource(R.string.set_others), null, s.showOthers) { v -> onSettings { it.copy(showOthers = v) } }
                    Toggle(stringResource(R.string.set_ratings), null, s.steamRatings) { v -> onSettings { it.copy(steamRatings = v) } }
                    Box(Modifier.padding(top = 6.dp)) { BrutButton(stringResource(R.string.check_now), onCheckNow, primary = false) }
                }
            }
            item { SectionHeader(stringResource(R.string.section_relay), null) }
            item { RelayGroup(state, now, onRelayScan, onRelayCode, onRelaySync, onRelayUnpair) }
            item { SectionHeader(stringResource(R.string.section_data), null) }
            item {
                Group {
                    Text(stringResource(R.string.data_tip), style = MaterialTheme.typography.bodySmall, color = Color.Black)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
                        BrutButton(stringResource(R.string.import_backup), onImport)
                        BrutButton(stringResource(R.string.export_backup), onExport, primary = false)
                    }
                    state.importedAt?.let {
                        Text("> " + stringResource(R.string.imported_on, Fmt.date(it)), style = MaterialTheme.typography.bodySmall, color = Color.Black, modifier = Modifier.padding(top = 6.dp))
                    }
                    Text(
                        "✕ " + stringResource(R.string.clear_sessions).uppercase(),
                        style = MaterialTheme.typography.labelLarge, color = Color.White,
                        modifier = Modifier.padding(top = 10.dp).background(Color.Black).clickableNoRipple { clearConfirm = true }.padding(horizontal = 10.dp, vertical = 8.dp),
                    )
                }
            }
            item { SectionHeader(stringResource(R.string.section_privacy), null) }
            item {
                Group {
                    listOf(R.string.privacy_1, R.string.privacy_2, R.string.privacy_3, R.string.privacy_4, R.string.privacy_5).forEach { id ->
                        Text("> " + stringResource(id), style = MaterialTheme.typography.bodySmall, color = Color.Black)
                    }
                }
            }
            item {
                Text(
                    "> " + stringResource(R.string.about_line, BuildConfig.VERSION_NAME, BuildConfig.ENGINE_VERSION),
                    style = MaterialTheme.typography.bodySmall,
                    color = b.mute,
                    modifier = Modifier.padding(start = 24.dp, top = 4.dp),
                )
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
        Text(stringResource(R.string.relay_intro), style = MaterialTheme.typography.bodySmall, color = Color.Black)
        if (r == null) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 8.dp)) {
                BrutButton(stringResource(R.string.relay_scan), onScan)
                BrutButton(stringResource(R.string.relay_paste), { pasting = !pasting }, primary = false)
            }
            if (pasting) {
                BrutField(code, { code = it }, "FGC1-…", onDone = { onCode(code.trim()); code = ""; pasting = false })
                BrutButton(stringResource(R.string.relay_pair), { onCode(code.trim()); code = ""; pasting = false })
            }
            Text("> " + stringResource(R.string.relay_how), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
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

@Composable
private fun Group(content: @Composable () -> Unit) {
    val b = LocalBrut.current
    Column(
        Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).brut(Color.White, shadow = b.shadow, offset = 6.dp).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) { content() }
}

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
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Column(Modifier.weight(1f).padding(end = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
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
