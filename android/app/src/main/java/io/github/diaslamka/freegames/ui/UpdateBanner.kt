package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.AppUpdate
import io.github.diaslamka.freegames.data.Install
import io.github.diaslamka.freegames.data.UpdateRunner
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import kotlinx.coroutines.launch

/**
 * La mise a jour, sur l'accueil (1.25.0) : une version plus recente existe -> un bandeau et UN bouton ; elle se
 * telecharge -> sa progression ; Android refuse -> pourquoi, et reessayer. Rien du tout quand tout va bien, ou
 * quand la recherche n'a pas pu se faire (un depot prive sans jeton, pas de reseau) : cela se lit dans les
 * Reglages, pas sur l'ecran qu'on ouvre dix fois par jour.
 *
 * L'etat vient de [AppUpdate.status], le meme que les Reglages : la recherche se fait une fois a l'ouverture de
 * l'appli (AppRoot).
 */
@Composable
fun UpdateBanner(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val b = LocalBrut.current
    val status by AppUpdate.status.collectAsStateWithLifecycle()
    var allowDialog by remember { mutableStateOf(false) }

    // Pas dans `scope` : ce bandeau sort de la liste quand on defile, et le telechargement irait avec lui.
    fun go(release: AppUpdate.Release) {
        UpdateRunner.installInBackground(context, release) { allowDialog = true }
    }

    when (val st = status) {
        is AppUpdate.Status.Available -> Notice(stringResource(R.string.update_banner, st.release.version), b.accent, modifier) {
            BrutButton(stringResource(R.string.update_now), { go(st.release) }, icon = Icons.Rounded.SystemUpdate)
        }
        is AppUpdate.Status.Downloading -> Notice(stringResource(R.string.update_downloading, st.percent), b.accent, modifier) {
            BrutProgress(st.percent)
        }
        is AppUpdate.Status.Installing -> Notice(stringResource(R.string.update_installing), b.accent, modifier)
        is AppUpdate.Status.Failed -> if (st.reason in SHOWN_ON_HOME) {
            Notice(
                when (st.reason) {
                    AppUpdate.Reason.BAD_FILE -> stringResource(R.string.update_fail_file, st.detail.orEmpty())
                    AppUpdate.Reason.WRONG_APP -> stringResource(R.string.update_fail_wrong)
                    else -> stringResource(R.string.update_fail_install, st.detail.orEmpty())
                },
                b.ink, modifier, inverted = true,
            ) { BrutButton(stringResource(R.string.update_check), { scope.launch { UpdateRunner.search(context) } }) }
        }
        else -> {}
    }

    if (allowDialog) {
        AlertDialog(
            onDismissRequest = { allowDialog = false },
            title = { Text(stringResource(R.string.update_allow_title)) },
            text = { Text(stringResource(R.string.update_allow_text)) },
            confirmButton = {
                TextButton(onClick = {
                    allowDialog = false
                    runCatching { context.startActivity(Install.allowIntent(context)) }
                }) { Text(stringResource(R.string.update_allow_ok)) }
            },
            dismissButton = { TextButton(onClick = { allowDialog = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

/** Les echecs qui meritent l'accueil : ceux d'une installation en route. Les autres (reseau, depot prive) restent aux Reglages. */
private val SHOWN_ON_HOME = setOf(AppUpdate.Reason.INSTALL, AppUpdate.Reason.BAD_FILE, AppUpdate.Reason.WRONG_APP)
