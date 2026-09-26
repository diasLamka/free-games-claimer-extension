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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.ui.theme.LocalPalette

/**
 * Les jeux attendus : quand l'un d'eux passe gratuit, sa notification passe
 * devant les autres. On les ajoute ici, ou en PARTAGEANT une fiche de jeu
 * depuis n'importe quelle appli.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistScreen(state: AppState, now: Long, onAdd: (String) -> Unit, onRemove: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    val p = LocalPalette.current
    val free = state.offers.values.filter { it.isOpen(now) }.groupBy { it.normalisedTitle }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.tab_wishlist)) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item("add") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = text, onValueChange = { text = it }, singleLine = true,
                        placeholder = { Text(stringResource(R.string.wish_hint)) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (text.isNotBlank()) { onAdd(text.trim()); text = "" } }),
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(16.dp),
                    )
                    FilledIconButton(
                        onClick = { if (text.isNotBlank()) { onAdd(text.trim()); text = "" } },
                        modifier = Modifier.padding(start = 8.dp),
                    ) { Icon(Icons.Rounded.Add, stringResource(R.string.wish_add)) }
                }
            }
            item("tip") {
                Text(
                    stringResource(R.string.wish_share_tip),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 4.dp),
                )
            }
            item("h") { SectionHeader(stringResource(R.string.wish_mine), state.wishlist.size) }
            items(state.wishlist, key = { "w:$it" }) { w ->
                val hit = free[Titles.normalise(w)]?.firstOrNull()
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .padding(start = 14.dp, top = 6.dp, bottom = 6.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Rounded.Star, null, tint = if (hit != null) p.amber else MaterialTheme.colorScheme.onSurfaceVariant)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(w, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        if (hit != null) Text(stringResource(R.string.wish_free_now, Stores.label(hit.store)), style = MaterialTheme.typography.bodySmall, color = p.amber)
                    }
                    IconButton(onClick = { onRemove(w) }) { Icon(Icons.Rounded.Delete, stringResource(R.string.wish_remove)) }
                }
            }
            if (state.importedWishes.isNotEmpty()) item("imp") {
                Text(
                    pluralStringResource(R.plurals.wish_imported, state.importedWishes.size, state.importedWishes.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(4.dp),
                )
            }
        }
    }
}
