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
import androidx.compose.runtime.remember
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
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Odds
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
    // « Attends, il sera offert » (1.7.0) : les chances de chaque souhait.
    val ranked = remember(state.wishlist, state.importedWishes, state.odds, state.passes, state.givers) { Odds.rank(state, now) }
    val byTitle = ranked.associate { Titles.normalise(it.first.title) to it.second }
    val best = ranked.filter { it.second.level == Odds.HIGH || it.second.level == Odds.MEDIUM }.take(30)
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
            if (best.isNotEmpty()) {
                item("best-h") { SectionHeader(stringResource(R.string.odds_best), best.size) }
                item("best-hint") {
                    Text("> " + stringResource(R.string.odds_hint), style = MaterialTheme.typography.bodySmall, color = b.ink, modifier = Modifier.padding(start = 30.dp))
                }
                itemsIndexed(best, key = { _, p -> "b:" + p.first.key }) { _, (t, e) ->
                    Row(
                        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(Titles.display(t.title).uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            OddsReasons(e)
                        }
                        OddsBadge(e.level)
                    }
                }
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
                        else byTitle[Titles.normalise(w)]?.let { e -> OddsReasons(e); OddsBadge(e.level, Modifier.padding(top = 4.dp)) }
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

/** Le niveau, en etiquette de la charte : fortes en aplat d'accent, moyennes en noir. */
@Composable
fun OddsBadge(level: String, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    val (label, fill, ink) = when (level) {
        Odds.HIGH -> Triple(R.string.odds_high, b.accent, Color.Black)
        Odds.MEDIUM -> Triple(R.string.odds_medium, Color.Black, Color.White)
        Odds.LOW -> Triple(R.string.odds_low, Color.White, Color(0xFF4A4A4A))
        Odds.F2P -> Triple(R.string.odds_f2p, Color.White, Color(0xFF4A4A4A))
        else -> Triple(R.string.odds_unknown, Color.White, Color(0xFF4A4A4A))
    }
    Tag(stringResource(label).uppercase(), fill, ink, modifier, bordered = fill == Color.White)
}

/** Les raisons de l'estimation, sur une ligne. */
@Composable
fun OddsReasons(e: Odds.Estimate) {
    val lines = e.reasons.map { r ->
        when (r.key) {
            "odds_given_before" -> stringResource(R.string.odds_given_before, r.args[0] as Int, Fmt.monthInText(r.args[1] as Long), Stores.label(r.args[2] as String))
            "odds_publisher_gave" -> stringResource(R.string.odds_publisher_gave, r.args[0] as String, r.args[1] as Int)
            "odds_old" -> stringResource(R.string.odds_old, r.args[0] as Int)
            "odds_expensive" -> stringResource(R.string.odds_expensive, Money.format(r.args[0] as Double, r.args[1] as String?))
            "odds_cheap" -> stringResource(R.string.odds_cheap, Money.format(r.args[0] as Double, r.args[1] as String?))
            "odds_unreleased" -> stringResource(R.string.odds_unreleased)
            "odds_recent" -> stringResource(R.string.odds_recent)
            "odds_free_to_play" -> stringResource(R.string.odds_free_to_play)
            "odds_not_on_steam" -> stringResource(R.string.odds_not_on_steam)
            else -> stringResource(R.string.odds_pending)
        }
    }
    if (lines.isNotEmpty()) Text(lines.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
}
