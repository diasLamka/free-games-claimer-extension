package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Family
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Member
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.Display
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/** Ce que la section demande a l'appli ; rien par defaut (apercus, tests). */
data class FamilyActions(
    val onAdd: (String) -> Unit = {},
    val onRemove: (String) -> Unit = {},
    val onLogin: (member: String, store: String) -> Unit = { _, _ -> },
    /** null : toute la famille. */
    val onClaim: (String?) -> Unit = {},
)

/**
 * Toute la famille (1.9.0), dans les Reglages : chaque membre, ses magasins
 * (un appui pour s'y connecter a son nom), ses jeux ; ajouter, retirer,
 * recuperer pour lui ou pour tous.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FamilyGroup(state: AppState, supported: Boolean, actions: FamilyActions) {
    val b = LocalBrut.current
    var name by remember { mutableStateOf("") }
    var removing by remember { mutableStateOf<Member?>(null) }
    Column(
        Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).brut(Color.White, shadow = b.shadow, offset = 6.dp).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(stringResource(R.string.family_hint), style = MaterialTheme.typography.bodySmall, color = Color.Black)
        if (!supported) {
            Notice(stringResource(R.string.family_unsupported), b.accent)
            return@Column
        }
        for (m in state.family) {
            Column(
                Modifier.fillMaxWidth().brut(Color.White, border = 2.dp).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.name.uppercase(), fontFamily = Display, fontSize = 20.sp, color = Color.Black, modifier = Modifier.weight(1f))
                    Tag(stringResource(R.string.family_games, m.library.size).uppercase(), b.accent, Color.Black, bordered = true)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (store in Family.STORES) {
                        val st = m.accounts[store]?.status
                        val ok = st == Accounts.OK || st == Accounts.PRESENT
                        val label = (if (store == Stores.AMAZON) "AMAZON" else shortStore(store)) + if (ok) " ✓" else " —"
                        Text(
                            label,
                            style = MaterialTheme.typography.labelLarge,
                            color = if (ok) Color.Black else Color.White,
                            modifier = Modifier.padding(end = 3.dp, bottom = 3.dp).heightIn(min = 40.dp)
                                .brut(if (ok) b.accent else Color.Black, shadow = Color.Black, offset = 3.dp, border = 2.dp)
                                .semantics { contentDescription = "${Stores.label(store)} : ${m.name}" }
                                .clickableNoRipple { actions.onLogin(m.id, store) }
                                .padding(horizontal = 10.dp, vertical = 10.dp),
                        )
                    }
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    BrutButton(stringResource(R.string.family_claim, m.name), { actions.onClaim(m.id) }, enabled = Family.STORES.any { s ->
                        m.accounts[s]?.status.let { it == Accounts.OK || it == Accounts.PRESENT }
                    })
                    BrutButton(stringResource(R.string.family_remove), { removing = m }, primary = false)
                }
            }
        }
        if (state.family.size < Family.MAX_MEMBERS) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                fun add() { if (name.isNotBlank()) { actions.onAdd(name.trim()); name = "" } }
                BrutField(name, { name = it }, stringResource(R.string.family_name_hint), Modifier.weight(1f), onDone = ::add)
                BrutButton(stringResource(R.string.family_add), ::add, enabled = name.isNotBlank())
            }
        }
        if (state.family.size >= 2) BrutButton(stringResource(R.string.family_claim_all), { actions.onClaim(null) })
    }
    removing?.let { m ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text(stringResource(R.string.family_remove_title, m.name)) },
            text = { Text(stringResource(R.string.family_remove_text)) },
            confirmButton = { TextButton(onClick = { removing = null; actions.onRemove(m.id) }) { Text(stringResource(R.string.family_remove)) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}
