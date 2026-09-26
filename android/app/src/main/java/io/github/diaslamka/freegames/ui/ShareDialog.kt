package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import androidx.compose.ui.graphics.Color

/**
 * Une fiche de jeu partagee depuis une autre appli : ce que l'appli en sait
 * (gratuit maintenant, deja recupere, deja attendu), et l'ajout aux souhaits.
 * L'equivalent, sur le telephone, du clic droit et de « fg » dans l'extension.
 */
@Composable
fun ShareDialog(initial: String, state: AppState, now: Long, onAdd: (String) -> Unit, onDismiss: () -> Unit) {
    var title by remember { mutableStateOf(initial) }
    val key = Titles.normalise(title)
    val free = state.offers.values.firstOrNull { it.isOpen(now) && it.normalisedTitle == key }
    // Tous les magasins ou on l'a deja -- y compris ce que le PC a pris (relais) : l'anti-doublon de l'appli.
    val owned = state.library.values.filter { Titles.normalise(it.title) == key && it.status in setOf("claimed", "redeemed") }
        .distinctBy { it.store }.sortedBy { it.ts ?: Long.MAX_VALUE }
    val wished = state.wishlist.any { Titles.normalise(it) == key }
    val b = LocalBrut.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.share_dialog_title)) },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it }, singleLine = true, label = { Text(stringResource(R.string.share_dialog_game)) })
                val facts = buildList {
                    if (free != null) add(stringResource(R.string.fact_free, Stores.label(free.store)) to Color.Black)
                    owned.forEach { e ->
                        val date = e.ts?.let { Fmt.date(it) } ?: "—"
                        add(stringResource(if (e.via == "pc") R.string.fact_owned_by_pc else R.string.fact_owned_on, Stores.label(e.store), date) to Color.Black)
                    }
                    if (wished) add(stringResource(R.string.fact_wished) to Color(0xFF4A4A4A))
                    if (isEmpty() && key.isNotEmpty()) add(stringResource(R.string.fact_unknown) to Color(0xFF4A4A4A))
                }
                facts.forEach { (t, c) -> Text(t, color = c, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = {
            TextButton(onClick = { onAdd(title.trim()) }, enabled = key.isNotEmpty() && !wished) { Text(stringResource(R.string.wish_add)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}
