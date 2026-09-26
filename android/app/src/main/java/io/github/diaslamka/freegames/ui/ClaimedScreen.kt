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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.ui.theme.LocalPalette

/** Ce qui a ete recupere, par l'appli ou par l'extension, mois par mois. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClaimedScreen(state: AppState, onOpen: (String) -> Unit) {
    val entries = state.library.values.sortedByDescending { it.ts ?: 0 }
    val groups = entries.groupBy { e -> e.ts?.let { Fmt.month(it) } ?: "—" }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.tab_claimed)) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item("hero") {
                val total = Money.total(state.library.values.map { it.worth }, Countries.of(state.settings.country).currency)
                Hero(Money.format(total?.first ?: 0.0, total?.second ?: Countries.of(state.settings.country).currency), state.library.size, stringResource(R.string.hero_caption))
            }
            if (entries.isEmpty()) item("empty") {
                Text(
                    stringResource(R.string.claimed_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(4.dp),
                )
            }
            groups.forEach { (month, list) ->
                item("m:$month") { SectionHeader(month, list.size) }
                items(list, key = { "e:" + it.store + ":" + it.id }) { e -> ClaimedRow(state, e, onOpen) }
            }
        }
    }
}

@Composable
private fun ClaimedRow(state: AppState, e: LibraryEntry, onOpen: (String) -> Unit) {
    val title = e.title ?: e.id
    val image = e.image ?: state.offers.values.firstOrNull { it.store == e.store && (it.storeId == e.id) }?.image
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)
            .then(if (e.url != null) Modifier.clickableNoRipple { onOpen(e.url) } else Modifier).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(image, title, e.store, Modifier.width(88.dp).height(50.dp), radius = 10.dp, letterSize = 18)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val line = listOfNotNull(
                e.ts?.let { Fmt.date(it) },
                if (e.via == "extension") stringResource(R.string.via_extension) else null,
            ).joinToString(" · ")
            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            StoreChip(e.store)
            e.worth?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.amber, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
}
