package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * Les jeux attendus : quand l'un d'eux passe gratuit, sa notification passe
 * devant les autres. On les ajoute ici, ou en PARTAGEANT une fiche de jeu
 * depuis n'importe quelle appli.
 */
@Composable
fun WishlistScreen(state: AppState, now: Long, onAdd: (String) -> Unit, onRemove: (String) -> Unit) {
    val b = LocalBrut.current
    var text by rememberSaveable { mutableStateOf("") }
    val free = state.offers.values.filter { it.isOpen(now) }.groupBy { it.normalisedTitle }
    fun add() { if (text.isNotBlank()) { onAdd(text.trim()); text = "" } }
    ReadableColumn {
        TopBlock(stringResource(R.string.tab_wishlist))
        LazyColumn(
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item("add") {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(end = 30.dp)) {
                    BrutField(text, { text = it }, stringResource(R.string.wish_hint), Modifier.weight(1f), onDone = ::add)
                    SquareButton(Icons.Rounded.Add, stringResource(R.string.wish_add), ::add)
                }
            }
            item("tip") {
                Text(
                    "> " + stringResource(R.string.wish_share_tip),
                    style = MaterialTheme.typography.bodySmall, color = b.ink,
                    modifier = Modifier.padding(start = 30.dp),
                )
            }
            item("h") { SectionHeader(stringResource(R.string.wish_mine), state.wishlist.size) }
            itemsIndexed(state.wishlist, key = { _, w -> "w:$w" }) { i, w ->
                val hit = free[Titles.normalise(w)]?.firstOrNull()
                Row(
                    Modifier.fillMaxWidth().padding(start = if (i % 2 == 1) 22.dp else 0.dp, end = if (i % 2 == 1) 0.dp else 22.dp)
                        .padding(end = 5.dp, bottom = 5.dp)
                        .brut(if (hit != null) b.accent else Color.White, shadow = b.shadow, offset = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(if (hit != null) "★" else "☆", style = MaterialTheme.typography.titleLarge, color = Color.Black, modifier = Modifier.padding(horizontal = 12.dp))
                    Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
                        Text(w.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (hit != null) Text(stringResource(R.string.wish_free_now, Stores.label(hit.store)).uppercase(), style = MaterialTheme.typography.labelSmall, color = Color.Black)
                    }
                    Text(
                        "✕", style = MaterialTheme.typography.titleMedium, color = if (b.dark) Color.Black else Color.White,
                        modifier = Modifier.padding(end = 8.dp).background(if (b.dark) b.accent else Color.Black)
                            .clickableNoRipple { onRemove(w) }.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
            if (state.importedWishes.isNotEmpty()) item("imp") {
                Text(
                    "> " + pluralStringResource(R.plurals.wish_imported, state.importedWishes.size, state.importedWishes.size),
                    style = MaterialTheme.typography.bodySmall, color = b.mute,
                )
            }
        }
    }
}
