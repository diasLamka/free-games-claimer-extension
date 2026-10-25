package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Odds
import io.github.diaslamka.freegames.data.Wish
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import kotlinx.coroutines.delay

/**
 * Les jeux attendus (1.42.0 : le tableau de bord). Chercher un jeu montre ses resultats AVEC image et prix pendant
 * qu'on tape ; chaque souhait a sa jaquette, son prix du jour, son plus bas historique, et une fiche (marchands, prix
 * releves, deja offert). Quand l'un d'eux passe gratuit, sa notification passe devant les autres. On peut aussi les
 * ajouter en PARTAGEANT une fiche de jeu depuis n'importe quelle appli.
 */
@Composable
fun WishlistScreen(
    state: AppState,
    now: Long,
    onAdd: (String) -> Unit,
    onRemove: (String) -> Unit,
    /** La recherche en direct (Steam, CheapShark) : suspend, appelee apres une pause de frappe. */
    suggest: suspend (String) -> List<Wish.Suggestion> = { emptyList() },
    /** Un resultat touche : le souhait est ajoute avec ce que la recherche sait deja (image, prix). */
    onAddSuggestion: (Wish.Suggestion) -> Unit = {},
    onOpen: (String) -> Unit = {},
) {
    val b = LocalBrut.current
    var text by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var detail by rememberSaveable { mutableStateOf<String?>(null) }
    var results by remember { mutableStateOf<List<Wish.Suggestion>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val removeName = stringResource(R.string.wish_remove)

    // Recherche en direct : une pause de frappe, puis les resultats ; une frappe de plus annule la precedente.
    LaunchedEffect(text) {
        val t = text.trim()
        if (t.length < 2) { results = emptyList(); searching = false; return@LaunchedEffect }
        searching = true
        delay(350)
        results = suggest(t)
        searching = false
    }

    val free = remember(state.offers, now) { state.offers.values.filter { it.isOpen(now) }.associateBy { it.normalisedTitle } }
    val mine = state.wishlist
    val mineKeys = remember(mine) { mine.map { Wish.key(it) }.toSet() }
    val imported = remember(state.importedWishes, mineKeys) {
        state.importedWishes.map { it.title }.filter { it.isNotBlank() && Wish.key(it) !in mineKeys }.distinctBy { Wish.key(it) }.take(80)
    }
    // « Attends, il sera offert » (1.7.0) : les chances de chaque souhait.
    val ranked = remember(state.wishlist, state.importedWishes, state.odds, state.passes, state.givers) { Odds.rank(state, now) }
    val byTitle = ranked.associate { Titles.normalise(it.first.title) to it.second }
    val best = ranked.filter { it.second.level == Odds.HIGH || it.second.level == Odds.MEDIUM }.take(30)
    val dash = remember(state.wishlist, state.importedWishes, state.wishInfo, state.offers, now) { Wish.dashboard(state, now) }

    fun passes(title: String): Boolean {
        val i = state.wishInfo[Wish.key(title)]
        return when (filter) {
            "sale" -> Wish.onSale(i)
            "low" -> Wish.atLow(i)
            "free" -> Wish.key(title) in free
            else -> true
        }
    }

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
                    BrutField(text, { text = it }, stringResource(R.string.wl_search_hint), Modifier.weight(1f), onDone = ::add)
                    SquareButton(Icons.Rounded.Add, stringResource(R.string.wish_add), ::add)
                }
            }

            if (text.trim().length >= 2) {
                // La recherche en direct : l'image, le titre, le prix -- un toucher et le jeu est souhaite.
                if (searching && results.isEmpty()) item("searching") {
                    Text("> " + stringResource(R.string.wl_searching), style = MaterialTheme.typography.bodySmall, color = b.ink)
                }
                if (!searching && results.isEmpty()) item("no-result") {
                    Text("> " + stringResource(R.string.wl_no_result), style = MaterialTheme.typography.bodySmall, color = b.ink)
                }
                items(results, key = { "s:" + (it.appid ?: it.gameId ?: it.title) }) { r ->
                    SuggestionRow(r, mineKeys, onClick = { onAddSuggestion(r); text = "" })
                }
            } else {
                if (dash.count > 0) {
                    item("dash") { Dashboard(dash) }
                    item("filters") {
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(stringResource(R.string.wl_filter_all), filter == null) { filter = null }
                            FilterChip(stringResource(R.string.wl_dash_sale), filter == "sale") { filter = if (filter == "sale") null else "sale" }
                            FilterChip(stringResource(R.string.wl_dash_low), filter == "low") { filter = if (filter == "low") null else "low" }
                            FilterChip(stringResource(R.string.wl_dash_free), filter == "free") { filter = if (filter == "free") null else "free" }
                        }
                    }
                }
                if (best.isNotEmpty() && filter == null) {
                    item("best-h") { SectionHeader(stringResource(R.string.odds_best), best.size) }
                    item("best-hint") {
                        Text("> " + stringResource(R.string.odds_hint), style = MaterialTheme.typography.bodySmall, color = b.ink, modifier = Modifier.padding(start = 30.dp))
                    }
                    items(best, key = { "b:" + it.first.key }) { (t, e) ->
                        Row(
                            Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp)
                                .clickableNoRipple { detail = Wish.key(t.title) }.padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Cover(state.wishInfo[Wish.key(t.title)]?.image, t.title, null, Modifier.width(108.dp).height(50.dp), letterSize = 20, alt = state.wishInfo[Wish.key(t.title)]?.thumb)
                            Column(Modifier.weight(1f)) {
                                Text(Titles.display(t.title).uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                OddsReasons(e)
                            }
                            OddsBadge(e.level)
                        }
                    }
                }
                val shown = mine.filter(::passes)
                item("h") { SectionHeader(stringResource(R.string.wish_mine), shown.size) }
                if (mine.isEmpty() && imported.isEmpty()) item("empty") {
                    Text("> " + stringResource(R.string.wl_empty), style = MaterialTheme.typography.bodySmall, color = b.ink, modifier = Modifier.padding(start = 30.dp))
                }
                items(shown, key = { "w:$it" }) { w ->
                    WishCard(
                        title = w, info = state.wishInfo[Wish.key(w)], freeStore = free[Wish.key(w)]?.store,
                        odds = byTitle[Titles.normalise(w)], removeName = removeName,
                        onClick = { detail = Wish.key(w) }, onRemove = { onRemove(w) },
                    )
                }
                val shownImported = imported.filter(::passes)
                if (shownImported.isNotEmpty()) {
                    item("imp-h") { SectionHeader(stringResource(R.string.wl_imported_h), shownImported.size) }
                    items(shownImported, key = { "i:$it" }) { w ->
                        WishCard(
                            title = w, info = state.wishInfo[Wish.key(w)], freeStore = free[Wish.key(w)]?.store,
                            odds = byTitle[Titles.normalise(w)], removeName = null,
                            onClick = { detail = Wish.key(w) }, onRemove = {},
                        )
                    }
                } else if (state.importedWishes.isNotEmpty() && filter == null) item("imp") {
                    Text(
                        "> " + pluralStringResource(R.plurals.wish_imported, state.importedWishes.size, state.importedWishes.size),
                        style = MaterialTheme.typography.bodySmall, color = b.mute,
                    )
                }
            }
        }
    }

    detail?.let { key ->
        val title = (mine + imported).firstOrNull { Wish.key(it) == key }
        if (title == null) detail = null
        else WishDetail(
            title = title, info = state.wishInfo[key], state = state, now = now, freeStore = free[key]?.store,
            odds = byTitle[key], onOpen = onOpen, onDismiss = { detail = null },
            onRemove = if (title in mine) ({ onRemove(title); detail = null }) else null,
        )
    }
}

/** Quatre chiffres d'un coup d'oeil : souhaits, en promo, au plus bas, gratuits. */
@Composable
private fun Dashboard(d: Wish.Dashboard) {
    val b = LocalBrut.current
    Row(Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Stat(d.count, stringResource(R.string.wl_dash_wishes), Color.White, Color.Black, Modifier.weight(1f))
        Stat(d.onSale, stringResource(R.string.wl_dash_sale), if (d.onSale > 0) b.accent else Color.White, Color.Black, Modifier.weight(1f))
        Stat(d.atLow, stringResource(R.string.wl_dash_low), if (d.atLow > 0) b.accent else Color.White, Color.Black, Modifier.weight(1f))
        Stat(d.freeNow, stringResource(R.string.wl_dash_free), if (d.freeNow > 0) b.accent else Color.White, Color.Black, Modifier.weight(1f))
    }
}

@Composable
private fun Stat(n: Int, label: String, fill: Color, ink: Color, modifier: Modifier) {
    val b = LocalBrut.current
    Column(modifier.brut(fill, shadow = b.shadow, offset = 4.dp).padding(horizontal = 6.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(n.toString(), style = MaterialTheme.typography.headlineSmall, color = ink, maxLines = 1)
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun FilterChip(label: String, on: Boolean, onClick: () -> Unit) {
    val b = LocalBrut.current
    Text(
        label.uppercase(),
        style = MaterialTheme.typography.labelLarge,
        color = if (on && !b.dark) b.accent else Color.Black,
        modifier = Modifier.padding(end = 3.dp, bottom = 3.dp)
            .brut(if (on) (if (b.dark) b.accent else Color.Black) else Color.White, shadow = if (on) null else (if (b.dark) b.accent else Color.Black), offset = 3.dp)
            .semantics { selected = on }
            .clickableNoRipple(role = androidx.compose.ui.semantics.Role.Tab, onClick = onClick)
            .minTouchTarget()
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
}

/** Un resultat de la recherche : la jaquette, le titre, le prix -- et ce qu'on en sait deja. */
@Composable
private fun SuggestionRow(r: Wish.Suggestion, mine: Set<String>, onClick: () -> Unit) {
    val b = LocalBrut.current
    val already = Wish.key(r.title) in mine
    Row(
        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp)
            .then(if (already) Modifier else Modifier.clickableNoRipple(onClick = onClick)).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Cover(r.image, r.title, null, Modifier.width(108.dp).height(50.dp), letterSize = 20, alt = r.thumb)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(r.title.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                val money = LocalMoney.current
                val price = r.price?.let { money.show(it, r.currency) } ?: r.best?.let { money.show(it, "USD") }
                if (price != null) Text(price, style = MaterialTheme.typography.bodyMedium, color = Color.Black)
                if (r.discount > 0) Tag(stringResource(R.string.wl_off, r.discount), b.accent, b.onAccent)
            }
        }
        Tag(stringResource(if (already) R.string.wl_in_list else R.string.wl_tap_to_add).uppercase(), if (already) Color.White else Color.Black, if (already) Color(0xFF4A4A4A) else Color.White, bordered = already)
    }
}

/** Un souhait : la jaquette, le prix du jour, le plus bas, ce que ca vaut -- un toucher ouvre la fiche. */
@Composable
private fun WishCard(
    title: String,
    info: WishInfo?,
    freeStore: String?,
    odds: Odds.Estimate?,
    removeName: String?,
    onClick: () -> Unit,
    onRemove: () -> Unit,
) {
    val b = LocalBrut.current
    Row(
        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(if (freeStore != null) b.accent else Color.White, shadow = b.shadow, offset = 5.dp)
            .clickableNoRipple(onClick = onClick).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Cover(info?.image, title, null, Modifier.width(120.dp).height(56.dp), letterSize = 22, alt = info?.thumb)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text((info?.name ?: Titles.display(title)).uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (freeStore != null) Text(stringResource(R.string.wish_free_now, Stores.label(freeStore)).uppercase(), style = MaterialTheme.typography.labelSmall, color = Color.Black)
            PriceLines(info)
            if (freeStore == null && info?.best == null && info?.localPrice == null) odds?.let { OddsBadge(it.level) }
        }
        if (removeName != null) Text(
            "✕", style = MaterialTheme.typography.titleMedium, color = if (b.dark) Color.Black else Color.White,
            modifier = Modifier.background(if (b.dark) b.accent else Color.Black)
                .semantics { contentDescription = removeName }.clickableNoRipple { onRemove() }.minTouchTarget().padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

/** Le prix du jour, la reduction, le plus bas historique : trois lignes au plus. */
@Composable
fun PriceLines(info: WishInfo?, compact: Boolean = true) {
    if (info == null) {
        Text(stringResource(R.string.wl_price_pending), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
        return
    }
    if (info.notFound && info.best == null && info.localPrice == null) {
        Text(stringResource(R.string.wl_not_found), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
        return
    }
    val b = LocalBrut.current
    val local = info.localPrice?.let { Money.format(it, info.localCurrency) }
    val money = LocalMoney.current
    val bestUsd = info.best?.let { money.show(it, "USD") }
    // Plusieurs etiquettes : elles passent a la ligne plutot que d'etre coupees (grande police, petit ecran).
    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(3.dp), itemVerticalAlignment = Alignment.CenterVertically) {
        Text(local ?: bestUsd ?: "", style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 1)
        val off = Wish.discount(info)
        if (off > 0) Tag(stringResource(R.string.wl_off, off), b.accent, b.onAccent)
        if (Wish.atLow(info)) Tag(stringResource(R.string.wl_at_low).uppercase(), Color.Black, Color.White)
        else if (Wish.nearLow(info)) Tag(stringResource(R.string.wl_near_low).uppercase(), Color.White, Color.Black, bordered = true)
    }
    if (!compact || info.lowest != null) info.lowest?.let { low ->
        Text(stringResource(R.string.wl_lowest_short, money.show(low, "USD")), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A), maxLines = 1)
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
