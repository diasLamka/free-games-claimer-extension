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
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import io.github.diaslamka.freegames.ui.theme.LocalPalette

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
) {
    val s = state.settings
    var steamWarning by remember { mutableStateOf(false) }
    var clearConfirm by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.tab_settings)) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { SectionHeader(stringResource(R.string.accounts), null) }
            item {
                Group {
                    Accounts.STORES.forEach { store -> AccountRow(store, state, now, onLogin) }
                    Text(
                        stringResource(R.string.login_tip),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }
            item { SectionHeader(stringResource(R.string.section_claiming), null) }
            item {
                Group {
                    Toggle(stringResource(R.string.set_claim_on_open), stringResource(R.string.set_claim_on_open_hint), s.claimOnOpen) { v -> onSettings { it.copy(claimOnOpen = v) } }
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
                    OutlinedButton(onClick = onCheckNow, modifier = Modifier.padding(top = 6.dp)) { Text(stringResource(R.string.check_now)) }
                }
            }
            item { SectionHeader(stringResource(R.string.section_data), null) }
            item {
                Group {
                    Text(stringResource(R.string.data_tip), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        FilledTonalButton(onClick = onImport) { Text(stringResource(R.string.import_backup)) }
                        OutlinedButton(onClick = onExport) { Text(stringResource(R.string.export_backup)) }
                    }
                    state.importedAt?.let {
                        Text(stringResource(R.string.imported_on, Fmt.date(it)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                    }
                    TextButton(onClick = { clearConfirm = true }, modifier = Modifier.padding(top = 4.dp)) {
                        Text(stringResource(R.string.clear_sessions), color = LocalPalette.current.rose)
                    }
                }
            }
            item {
                Text(
                    stringResource(R.string.about_line, BuildConfig.VERSION_NAME, BuildConfig.ENGINE_VERSION),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(4.dp),
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

@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) { content() }
}

@Composable
private fun AccountRow(store: String, state: AppState, now: Long, onLogin: (String) -> Unit) {
    val p = LocalPalette.current
    val a = state.accounts[store]
    val (text, color) = when (a?.status) {
        Accounts.OK -> (a.name?.let { stringResource(R.string.account_ok_named, it) } ?: stringResource(R.string.account_ok)) to p.jade
        Accounts.PRESENT -> stringResource(R.string.account_present) to p.jade
        Accounts.LOGGED_OUT -> stringResource(R.string.account_logged_out) to p.rose
        else -> stringResource(R.string.account_unknown) to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(p.store(store)))
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(if (store == Stores.AMAZON) stringResource(R.string.set_amazon) else Stores.label(store), style = MaterialTheme.typography.titleSmall)
            Text(text, style = MaterialTheme.typography.bodySmall, color = color)
        }
        val connected = a?.status == Accounts.OK || a?.status == Accounts.PRESENT
        if (connected) OutlinedButton(onClick = { onLogin(store) }) { Text(stringResource(R.string.open_store)) }
        else FilledTonalButton(onClick = { onLogin(store) }) { Text(stringResource(R.string.login)) }
    }
}

@Composable
private fun Toggle(title: String, hint: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickableNoRipple { onChange(!checked) }.padding(vertical = 4.dp)) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun <T> Choice(title: String, options: List<Pair<T, String>>, selected: T, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Box {
            OutlinedButton(onClick = { open = true }) { Text(options.firstOrNull { it.first == selected }?.second ?: "—") }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                options.forEach { (v, label) ->
                    DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(v) })
                }
            }
        }
    }
}
