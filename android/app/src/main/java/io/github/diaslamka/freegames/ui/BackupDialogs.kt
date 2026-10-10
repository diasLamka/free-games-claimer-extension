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
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import io.github.diaslamka.freegames.data.AutoBackup
import io.github.diaslamka.freegames.data.BackupSecret
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.work.Scheduler

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

/** La sauvegarde automatique, dans les Reglages (1.28.0) : ou, quand, et de quoi la lancer ou la couper. */
@Composable
fun AutoBackupBlock(settings: Settings, now: Long, onEnable: () -> Unit, onNow: () -> Unit, onOff: () -> Unit) {
    val context = LocalContext.current
    val ink = Color(0xFF4A4A4A)
    val folder = settings.backupFolder
    Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (folder == null) {
            Text(stringResource(R.string.auto_backup_hint), style = MaterialTheme.typography.bodySmall, color = ink)
            BrutButton(stringResource(R.string.auto_backup_enable), onEnable, primary = false)
        } else {
            Text(
                "> " + stringResource(R.string.auto_backup_on, AutoBackup.folderLabel(folder)).uppercase(),
                style = MaterialTheme.typography.labelLarge, color = Color.Black,
            )
            Text(
                settings.backupAt?.let { stringResource(R.string.auto_backup_last, Fmt.ago(context, it, now)) } ?: stringResource(R.string.auto_backup_never),
                style = MaterialTheme.typography.bodySmall, color = ink,
            )
            settings.backupError?.let { code ->
                val reason = stringResource(
                    when (code) {
                        AutoBackup.ERR_FOLDER -> R.string.auto_backup_err_folder
                        AutoBackup.ERR_PASSPHRASE -> R.string.auto_backup_err_passphrase
                        else -> R.string.auto_backup_err_write
                    },
                )
                Text(stringResource(R.string.auto_backup_error, reason), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BrutButton(stringResource(R.string.auto_backup_now), onNow)
                BrutButton(stringResource(R.string.auto_backup_off), onOff, primary = false)
            }
        }
    }
}

/** Ce que l'ecran attend de l'utilisateur dans la sauvegarde chiffree. */
private sealed interface VaultAsk {
    data object Export : VaultAsk
    data object EnableAuto : VaultAsk
    class Restore(val bytes: ByteArray) : VaultAsk
}

class VaultActions(val export: () -> Unit, val restore: () -> Unit, val enableAuto: () -> Unit, val autoNow: () -> Unit, val disableAuto: () -> Unit)

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
    // « En cours » : une bulle qui s'efface des que le resultat arrive -- sinon elle le fait attendre toute sa duree (les bulles font la queue).
    fun working(): Toast = Toast.makeText(context, context.getString(R.string.backup_vault_working), Toast.LENGTH_LONG).also { it.show() }

    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val phrase = chosen
        chosen = null
        if (uri == null || phrase == null) return@rememberLauncherForActivityResult
        scope.launch {
            val busy = working()
            val ok = withContext(Dispatchers.Default) {
                runCatching {
                    val bytes = BackupVault.seal(Graph.store.value, phrase, System.currentTimeMillis())
                    context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
                }.getOrDefault(false)
            }
            busy.cancel()
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

    // Le dossier de la sauvegarde automatique : l'utilisateur le choisit, l'appli n'a de droit que sur lui, garde d'un lancement a l'autre.
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        val phrase = chosen
        chosen = null
        if (uri == null || phrase == null) return@rememberLauncherForActivityResult
        scope.launch {
            val ok = runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                BackupSecret.save(context, phrase)
            }.getOrDefault(false)
            if (!ok) {
                toast(R.string.backup_vault_failed)
            } else {
                val old = Graph.store.value.settings.backupFolder
                Graph.store.update { it.copy(settings = it.settings.copy(backupFolder = uri.toString(), backupError = null)) }
                // Un autre dossier que le precedent : l'ancien droit n'a plus lieu d'etre.
                if (old != null && old != uri.toString()) runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(old), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
                Scheduler.backup(context, true)
                Scheduler.backupNow(context)
            }
        }
    }

    when (val a = asking) {
        VaultAsk.EnableAuto -> PassphraseDialog(
            confirm = true,
            onOk = { phrase ->
                asking = null
                chosen = phrase
                folderPicker.launch(null)
            },
            onDismiss = { asking = null },
        )
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
                    val busy = working()
                    val snapshot = withContext(Dispatchers.Default) { BackupVault.open(a.bytes, phrase) }
                    busy.cancel()
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
    return remember {
        VaultActions(
            export = { asking = VaultAsk.Export },
            restore = { importer.launch(arrayOf("*/*")) },
            enableAuto = { asking = VaultAsk.EnableAuto },
            autoNow = { Scheduler.backupNow(context) },
            disableAuto = {
                scope.launch {
                    val old = Graph.store.value.settings.backupFolder
                    Graph.store.update { it.copy(settings = it.settings.copy(backupFolder = null, backupError = null)) }
                    Scheduler.backup(context, false)
                    BackupSecret.clear(context)
                    if (old != null) runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(old), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION) }
                }
            },
        )
    }
}
