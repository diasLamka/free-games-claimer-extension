package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/** Ce qui a ete recupere, par l'appli ou par l'extension, mois par mois. */
@Composable
fun ClaimedScreen(state: AppState, onOpen: (String) -> Unit) {
    val b = LocalBrut.current
    val entries = state.library.values.sortedByDescending { it.ts ?: 0 }
    val groups = entries.groupBy { e -> e.ts?.let { Fmt.month(it) } ?: "—" }
    Column(Modifier.fillMaxSize().background(b.base)) {
        TopBlock(stringResource(R.string.tab_claimed))
        LazyColumn(
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item("hero") {
                val cur = Countries.of(state.settings.country).currency
                val total = Money.total(state.library.values.map { it.worth }, cur)
                Hero(Money.format(total?.first ?: 0.0, total?.second ?: cur), state.library.size, stringResource(R.string.hero_caption))
            }
            if (entries.isEmpty()) item("empty") {
                Text(stringResource(R.string.claimed_empty), style = MaterialTheme.typography.bodyMedium, color = b.ink)
            }
            groups.forEach { (month, list) ->
                item("m:$month") { SectionHeader(month, list.size) }
                itemsIndexed(list, key = { _, e -> "e:" + e.store + ":" + e.id }) { i, e ->
                    ClaimedRow(state, e, onOpen, Modifier.padding(start = if (i % 3 == 1) 18.dp else 0.dp, end = if (i % 3 == 1) 0.dp else 8.dp))
                }
            }
        }
    }
}

@Composable
private fun ClaimedRow(state: AppState, e: LibraryEntry, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    val title = e.title ?: e.id
    val image = e.image ?: state.offers.values.firstOrNull { it.store == e.store && (it.storeId == e.id) }?.image
    Row(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp)
            .then(if (e.url != null) Modifier.clickableNoRipple { onOpen(e.url) } else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(image, title, e.store, Modifier.width(96.dp).height(64.dp), letterSize = 26)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                StoreChip(e.store)
                Text(
                    listOfNotNull(e.ts?.let { Fmt.short(it) }, if (e.via == "extension") "EXT" else null).joinToString(" / "),
                    style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A), maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        e.worth?.let {
            Text(
                it, style = MaterialTheme.typography.labelLarge, color = b.onAccent,
                modifier = Modifier.padding(end = 8.dp).background(b.accent).padding(horizontal = 6.dp, vertical = 3.dp),
            )
        }
    }
}
