package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Ratings
import io.github.diaslamka.freegames.data.Relay
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Taste
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.Upcoming
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val FILTERS = listOf(null, Stores.EPIC, Stores.GOG, Stores.STEAM, Stores.AMAZON)
private val PC = setOf(Stores.EPIC, Stores.GOG, Stores.STEAM, Stores.AMAZON)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GamesScreen(
    state: AppState,
    now: Long,
    refreshing: Boolean,
    claiming: Boolean,
    onRefresh: () -> Unit,
    onClaim: (Set<String>) -> Unit,
    onOpen: (String) -> Unit,
    onShare: (List<Offer>) -> Unit,
    onAccounts: () -> Unit,
    /** Ecarter une demande d'aide du PC (1.4.0). */
    onHelpDismiss: (String) -> Unit = {},
) {
    val b = LocalBrut.current
    val context = LocalContext.current
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    // Repliees par defaut, comme dans le popup (1.3.0) : leur compte reste dans le titre.
    var openUpcoming by rememberSaveable { mutableStateOf(false) }
    var openMobile by rememberSaveable { mutableStateOf(false) }
    var openOthers by rememberSaveable { mutableStateOf(false) }

    val q = Titles.normalise(query)
    fun keep(o: Offer) = (filter == null || o.store == filter) && (q.isEmpty() || o.normalisedTitle.contains(q))
    val open = state.offers.values.filter { it.isOpen(now) && it.keepable != false }
    val pc = open.filter { it.store in PC && !(it.source == GamerPowerSource.NAME && it.isExtra) }
        .filter(::keep)
        .sortedWith(compareByDescending<Offer> { Rules.wished(it, state) }.thenBy { it.end ?: Long.MAX_VALUE })
    val mobile = if (state.settings.showMobile) open.filter { it.source == EpicMobileSource.NAME }.filter(::keep) else emptyList()
    val others = if (state.settings.showOthers) open.filter { it.source == GamerPowerSource.NAME && it.store !in PC }
        .filter { filter == null && (q.isEmpty() || it.normalisedTitle.contains(q)) } else emptyList()
    val soon = state.upcoming.filter { it.start > now && (filter == null || filter == Stores.EPIC) && (q.isEmpty() || Titles.normalise(it.title).contains(q)) }
    val pending = Rules.pending(state, now)
    val needLogin = pending.map { it.store }.distinct().filter { state.accounts[it]?.status == Accounts.LOGGED_OUT }

    Column(Modifier.fillMaxSize().background(b.base)) {
        TopBlock(stringResource(R.string.tab_games)) {
            SquareButton(if (searching) Icons.Rounded.Close else Icons.Rounded.Search, stringResource(R.string.search), { searching = !searching; if (!searching) query = "" })
            SquareButton(Icons.Rounded.Share, stringResource(R.string.share_list), { onShare(pc) }, enabled = pc.isNotEmpty())
            SquareButton(Icons.Rounded.Refresh, stringResource(R.string.refresh), onRefresh, enabled = !refreshing)
        }
        if (searching) BrutField(query, { query = it }, stringResource(R.string.search_hint), Modifier.padding(horizontal = 14.dp).padding(bottom = 8.dp))
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
          BoxWithConstraints(Modifier.fillMaxSize()) {
            // Une colonne au telephone, deux sur un pliable ou en paysage, trois sur une tablette.
            val cols = columnsFor(maxWidth)
            val full: LazyGridItemSpanScope.() -> GridItemSpan = { GridItemSpan(maxLineSpan) }
            LazyVerticalGrid(
                columns = GridCells.Fixed(cols),
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                // Le PC a besoin de toi (1.4.0) : en tete, c'est le plus urgent.
                val help = Relay.openHelp(state, now)
                if (help.isNotEmpty()) item("help", span = full) {
                    HelpBanner(help, state, claiming, onFinish = { onClaim(setOf(it.key)) }, onDismiss = onHelpDismiss)
                }
                item("hero", span = full) {
                    val cur = Countries.of(state.settings.country).currency
                    val total = Money.total(state.library.values.map { it.worth }, cur)
                    Hero(Money.format(total?.first ?: 0.0, total?.second ?: cur), state.library.size, stringResource(R.string.hero_caption))
                }
                val next = pc.filter { it.end != null && it.end > now && it.end - now < 8 * 86_400_000L }.minByOrNull { it.end!! }
                if (next != null) item("timecode", span = full) {
                    Timecode(next.end!!, next.shownTitle, stringResource(R.string.timecode_label), { d -> context.getString(R.string.timecode_days, d.toInt()) })
                }
                if (pending.isNotEmpty() && !claiming) item("claim", span = full) {
                    Notice(pluralStringResource(R.plurals.pending_claims, pending.size, pending.size), b.accent, Modifier.padding(start = 22.dp)) {
                        BrutButton(stringResource(R.string.claim_all) + " →", { onClaim(emptySet()) }, primary = false, icon = Icons.Rounded.Download)
                    }
                }
                if (needLogin.isNotEmpty()) item("login", span = full) {
                    Notice(
                        stringResource(R.string.need_login, needLogin.joinToString(", ") { Stores.label(it) }),
                        b.ink, Modifier.padding(end = 22.dp), inverted = true,
                    ) { BrutButton(stringResource(R.string.accounts), onAccounts) }
                }
                item("filters", span = full) {
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FILTERS.forEach { f ->
                            val on = filter == f
                            Text(
                                if (f == null) stringResource(R.string.filter_all).uppercase() else shortStore(f),
                                style = MaterialTheme.typography.labelLarge,
                                color = if (on && !b.dark) b.accent else Color.Black,
                                modifier = Modifier.padding(end = 3.dp, bottom = 3.dp)
                                    .brut(if (on) (if (b.dark) b.accent else Color.Black) else Color.White, shadow = if (on) null else (if (b.dark) b.accent else Color.Black), offset = 3.dp)
                                    .clickableNoRipple { filter = f }
                                    .padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
                item("free-h", span = full) { SectionHeader(stringResource(R.string.section_free), pc.size) }
                if (pc.isEmpty()) item("free-empty", span = full) {
                    Text(
                        stringResource(if (state.lastCheck == null) R.string.first_check else R.string.nothing_free),
                        style = MaterialTheme.typography.bodyMedium, color = b.ink,
                    )
                }
                itemsIndexed(pc, key = { _, o -> "o:" + o.key }) { i, o ->
                    // L'asymetrie voulue : une carte sur deux decalee de l'autre cote.
                    OfferCard(
                        o, state, now, claiming, onClaim = { onClaim(setOf(o.key)) }, onOpen = onOpen,
                        // En colonne unique, une carte sur deux decalee ; en grille, les colonnes font l'asymetrie.
                        modifier = if (cols > 1) Modifier else if (i % 2 == 0) Modifier.padding(end = 20.dp) else Modifier.padding(start = 20.dp),
                    )
                }
                if (soon.isNotEmpty()) {
                    item("soon-h", span = full) { SectionHeader(stringResource(R.string.section_soon), soon.size, openUpcoming, { openUpcoming = !openUpcoming }) }
                    if (openUpcoming) itemsIndexed(soon, key = { _, w -> "u:" + w.title + w.start }) { i, w -> UpcomingRow(w, onOpen, Modifier.padding(start = if (cols > 1 || i % 2 == 0) 0.dp else 26.dp)) }
                }
                if (mobile.isNotEmpty()) {
                    item("mob-h", span = full) { SectionHeader(stringResource(R.string.section_mobile), mobile.size, openMobile, { openMobile = !openMobile }) }
                    if (openMobile) itemsIndexed(mobile, key = { _, o -> "m:" + o.key }) { _, o -> CompactRow(o, now, stringResource(R.string.mobile_hint), onOpen) }
                }
                if (others.isNotEmpty()) {
                    item("oth-h", span = full) { SectionHeader(stringResource(R.string.section_others), others.size, openOthers, { openOthers = !openOthers }) }
                    if (openOthers) itemsIndexed(others, key = { _, o -> "g:" + o.key }) { _, o -> CompactRow(o, now, Stores.LABELS[o.store] ?: o.platforms.orEmpty(), onOpen) }
                }
                item("status", span = full) { SourcesLine(state, now) }
            }
          }
        }
    }
}

/** Le nombre de colonnes pour une largeur : les seuils des classes de taille d'Android (600, 840 dp). */
fun columnsFor(width: Dp): Int = when {
    width >= 1000.dp -> 3
    width >= 600.dp -> 2
    else -> 1
}

@Composable
private fun SourcesLine(state: AppState, now: Long) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val last = state.lastCheck ?: return
    val names = mapOf("epic-api" to "EPIC", "gog" to "GOG", "steam" to "STEAM", "gamerpower" to "GAMERPOWER", "epic-mobile" to "MOBILE")
    val parts = names.mapNotNull { (k, label) -> state.sources[k]?.let { "$label[${if (it.ok) "OK" else "KO"}]" } }
    Text(
        "> " + stringResource(R.string.checked_ago, Fmt.ago(context, last, now)).uppercase() + "\n> " + parts.joinToString(" "),
        style = MaterialTheme.typography.bodySmall, color = b.mute,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OfferCard(o: Offer, state: AppState, now: Long, claiming: Boolean, onClaim: () -> Unit, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val claimed = Rules.claimedEntry(o, state.library)
    val owned = Rules.ownedOnSteam(o, state)
    val wished = Rules.wished(o, state)
    val attempt = state.attempts[o.key]
    val rating = state.ratings[Ratings.key(o)]
    val claimable = Rules.claimable(o, state.settings) && claimed == null && !owned
    val urgent = o.end != null && o.end - now < 24 * 3_600_000L

    Column(modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).ticket(coverTicket(), Color.White, b.shadow, 6.dp)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            Cover(o.image, o.shownTitle, o.store, Modifier.fillMaxSize(), letterSize = 64)
            Row(Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                StoreChip(o.store)
                if (o.isExtra) Tag("DLC", Color.White, Color.Black)
                if (wished) Tag("★ " + stringResource(R.string.wished).uppercase(), b.accent, b.onAccent)
                // Deuxieme chance (1.12.0) : deja vu passer, jamais eu.
                if (Rules.secondChance(o, state, now) != null) Tag(stringResource(R.string.tag_second_chance).uppercase(), Color.White, Color.Black, bordered = true)
                // Tes gouts (1.14.0) : une offre qui ressemble a ce que tu aimes.
                if (Taste.matchFor(state, Taste.appidOf(o, state)) != null) Tag(stringResource(R.string.tag_for_you).uppercase(), Color.Black, b.accent)
            }
            if (rating?.percent != null) {
                Text(
                    stringResource(R.string.rating_short, rating.percent).uppercase(),
                    style = MaterialTheme.typography.labelLarge, color = Color.Black,
                    modifier = Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 10.dp).rotate(4f)
                        .brut(if (Ratings.tone(rating) == "good") b.accent else Color.White, shadow = Color.Black, offset = 3.dp)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            /* Le tampon (1.3.0 ; un par etat depuis la 1.11.0, comme l'extension) :
               pris, deja a toi, ou l'issue du dernier essai -- echec, en
               attente, ignore -- de travers, sur la jaquette. */
            val tampon = when {
                claimed != null -> stampKindOf(claimed.status) ?: StampKind.CLAIMED
                owned -> StampKind.OWNED
                attempt?.verdict != null -> stampKindOf(attempt.verdict)
                else -> null
            }
            tampon?.let { KindStamp(it, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) }
        }
        Perforation()
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Text(o.shownTitle.uppercase(), style = MaterialTheme.typography.titleLarge, color = Color.Black, maxLines = 3, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                o.worth?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.Black, textDecoration = TextDecoration.LineThrough) }
                Tag(stringResource(R.string.free).uppercase(), b.accent, b.onAccent, bordered = true)
                Spacer(Modifier.weight(1f))
                Text(
                    if (o.end != null) Fmt.left(context, o.end, now).uppercase() else "∞",
                    style = MaterialTheme.typography.labelLarge,
                    color = if (urgent) b.accent else Color.White,
                    modifier = Modifier.background(Color.Black).padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            if (o.end != null) {
                Text("> " + stringResource(R.string.until, Fmt.dateTime(o.end)), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            }
            // Piege ou bonne affaire ? (1.22.0) : rien a juger sur un jeu qu'on a deja.
            if (claimed == null && !owned) BargainRow(o, state)
            if (claimed?.ts != null) {
                Text("> " + stringResource(R.string.claimed_on, Fmt.date(claimed.ts)), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            } else if (attempt?.verdict != null && attempt.verdict !in Verdicts.ACQUIRED) {
                Text("! " + verdictText(attempt.verdict, attempt.details), style = MaterialTheme.typography.bodySmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            // FlowRow : en grande police, le second bouton passe a la ligne au lieu de deborder.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                if (claimable) BrutButton(stringResource(R.string.action_claim), onClaim, enabled = !claiming, icon = Icons.Rounded.Download)
                (o.url ?: o.resolveUrl)?.let { u -> BrutButton(stringResource(R.string.action_open), { onOpen(u) }, primary = false, icon = Icons.AutoMirrored.Rounded.OpenInNew) }
            }
        }
    }
}

@Composable
fun verdictText(verdict: String, details: String?): String {
    val base = when (verdict) {
        Verdicts.LOGIN -> stringResource(R.string.verdict_login)
        Verdicts.CHALLENGE -> stringResource(R.string.verdict_challenge)
        Verdicts.TEACH -> stringResource(R.string.verdict_teach)
        Verdicts.OWNED -> stringResource(R.string.verdict_owned)
        Verdicts.GONE -> stringResource(R.string.verdict_gone)
        Verdicts.NEEDS_BASE -> stringResource(R.string.verdict_base)
        Verdicts.LINK_ACCOUNT -> stringResource(R.string.verdict_link)
        Verdicts.OUT_OF_SCOPE -> stringResource(R.string.verdict_out_of_scope)
        Verdicts.FAILURE -> stringResource(R.string.verdict_failed)
        Verdicts.CODE_PENDING, Verdicts.CODE_COPIED -> stringResource(R.string.verdict_code)
        Verdicts.SKIPPED -> stringResource(R.string.verdict_skipped)
        else -> verdict
    }
    return if (!details.isNullOrBlank() && verdict != Verdicts.NEEDS_BASE && verdict != Verdicts.OUT_OF_SCOPE) "$base — $details" else base
}

/** Une ouverture annoncee : la date en gros bloc d'accent, a gauche. */
@Composable
private fun UpcomingRow(w: Upcoming, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    val at = Instant.ofEpochMilli(w.start).atZone(ZoneId.systemDefault())
    Row(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp)
            .then(if (w.url != null) Modifier.clickableNoRipple { onOpen(w.url) } else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(
            Modifier.width(78.dp).background(b.accent).padding(vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(DateTimeFormatter.ofPattern("dd.MM").format(at), style = MaterialTheme.typography.titleLarge, color = b.onAccent)
            Text(DateTimeFormatter.ofPattern("HH:mm").format(at), style = MaterialTheme.typography.labelMedium, color = b.onAccent)
        }
        Box(Modifier.width(3.dp).height(64.dp).background(Color.Black))
        Cover(w.image, w.title, Stores.EPIC, Modifier.padding(start = 10.dp).width(78.dp).height(44.dp), letterSize = 18)
        Text(
            w.title.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black,
            maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(horizontal = 10.dp),
        )
    }
}

@Composable
private fun CompactRow(o: Offer, now: Long, hint: String, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val b = LocalBrut.current
    Row(
        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).padding(8.dp)
            .then((o.url ?: o.resolveUrl)?.let { u -> Modifier.clickableNoRipple { onOpen(u) } } ?: Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(o.image, o.shownTitle, o.store, Modifier.width(92.dp).height(52.dp), letterSize = 20)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(o.shownTitle.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val extra = listOfNotNull(o.worth, o.end?.let { Fmt.left(context, it, now) }, hint.takeIf { it.isNotBlank() }).joinToString(" / ")
            Text(extra, style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text("↗", style = MaterialTheme.typography.titleLarge, color = Color.Black)
    }
}
