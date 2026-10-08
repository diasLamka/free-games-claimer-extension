package io.github.diaslamka.freegames.ui

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.BackupVault
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.model.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * La phrase de passe de la sauvegarde chiffree (1.28.0). `confirm` : a l'export, elle se saisit deux fois et doit etre assez longue
 * (personne ne peut la retrouver) ; a la restauration, une fois.
 */
@Composable
fun PassphraseDialog(confirm: Boolean, onOk: (String) -> Unit, onDismiss: () -> Unit) {
    var phrase by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    val valid = if (confirm) BackupVault.acceptable(phrase) && phrase == again else phrase.isNotEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.backup_vault_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (confirm) Text(stringResource(R.string.passphrase_warning), style = MaterialTheme.typography.bodySmall)
                BrutField(phrase, { phrase = it }, stringResource(R.string.passphrase_label), secret = true)
                if (confirm) {
                    if (phrase.isNotEmpty() && !BackupVault.acceptable(phrase)) {
                        Text(stringResource(R.string.passphrase_short, BackupVault.MIN_PASSPHRASE), style = MaterialTheme.typography.bodySmall)
                    }
                    BrutField(again, { again = it }, stringResource(R.string.passphrase_confirm), secret = true)
                    if (again.isNotEmpty() && again != phrase) Text(stringResource(R.string.passphrase_mismatch), style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { TextButton(onClick = { onOk(phrase) }, enabled = valid) { Text(stringResource(R.string.passphrase_ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}

/** Ce que l'ecran attend de l'utilisateur dans la sauvegarde chiffree. */
private sealed interface VaultAsk {
    data object Export : VaultAsk
    class Restore(val bytes: ByteArray) : VaultAsk
}

class VaultActions(val export: () -> Unit, val restore: () -> Unit)

/**
 * Le deroule de la sauvegarde chiffree : export = phrase (deux fois), puis le fichier ; restauration = le fichier, puis la phrase.
 * Le chiffrement est lent a dessein (PBKDF2) : il se fait hors du fil de l'ecran. `onSettingsChanged` : une restauration change les
 * reglages comme le ferait l'utilisateur, et la veille, la sentinelle et le resume suivent.
 */
@Composable
fun rememberVaultFlow(onSettingsChanged: suspend (Settings, Settings) -> Unit): VaultActions {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf<VaultAsk?>(null) }
    var chosen by remember { mutableStateOf<String?>(null) }
    fun toast(id: Int) = Toast.makeText(context, context.getString(id), Toast.LENGTH_LONG).show()

    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val phrase = chosen
        chosen = null
        if (uri == null || phrase == null) return@rememberLauncherForActivityResult
        scope.launch {
            toast(R.string.backup_vault_working)
            val ok = withContext(Dispatchers.Default) {
                runCatching {
                    val bytes = BackupVault.seal(Graph.store.value, phrase, System.currentTimeMillis())
                    context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
                }.getOrDefault(false)
            }
            toast(if (ok) R.string.backup_vault_done else R.string.backup_vault_failed)
        }
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readNBytes(BackupVault.MAX_BYTES + 64 * 1024) } }.getOrNull()
            }
            if (bytes == null || bytes.isEmpty()) toast(R.string.restore_vault_failed) else asking = VaultAsk.Restore(bytes)
        }
    }

    when (val a = asking) {
        VaultAsk.Export -> PassphraseDialog(
            confirm = true,
            onOk = { phrase ->
                asking = null
                chosen = phrase
                exporter.launch(BackupVault.fileName(System.currentTimeMillis()))
            },
            onDismiss = { asking = null },
        )
        is VaultAsk.Restore -> PassphraseDialog(
            confirm = false,
            onOk = { phrase ->
                asking = null
                scope.launch {
                    toast(R.string.backup_vault_working)
                    val snapshot = withContext(Dispatchers.Default) { BackupVault.open(a.bytes, phrase) }
                    if (snapshot == null) {
                        toast(R.string.restore_vault_failed)
                    } else {
                        val before = Graph.store.value.settings
                        val after = Graph.store.update { BackupVault.restore(it, snapshot) }.settings
                        onSettingsChanged(before, after)
                        toast(R.string.restore_vault_done)
                    }
                }
            },
            onDismiss = { asking = null },
        )
        null -> {}
    }
    return remember { VaultActions(export = { asking = VaultAsk.Export }, restore = { importer.launch(arrayOf("*/*")) }) }
}
