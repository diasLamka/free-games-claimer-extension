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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Ratings
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.Upcoming
import io.github.diaslamka.freegames.sources.Countries
import io.github.diaslamka.freegames.sources.EpicMobileSource
import io.github.diaslamka.freegames.sources.GamerPowerSource
import io.github.diaslamka.freegames.ui.theme.LocalPalette

private val FILTERS = listOf(null, Stores.EPIC, Stores.GOG, Stores.STEAM, Stores.AMAZON)

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
) {
    val context = LocalContext.current
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var searching by rememberSaveable { mutableStateOf(false) }
    var query by rememberSaveable { mutableStateOf("") }
    var openUpcoming by rememberSaveable { mutableStateOf(true) }
    var openMobile by rememberSaveable { mutableStateOf(true) }
    var openOthers by rememberSaveable { mutableStateOf(false) }

    val q = Titles.normalise(query)
    fun keep(o: Offer) = (filter == null || o.store == filter) && (q.isEmpty() || o.normalisedTitle.contains(q))
    val open = state.offers.values.filter { it.isOpen(now) && it.keepable != false }
    val pc = open.filter { it.store in setOf(Stores.EPIC, Stores.GOG, Stores.STEAM, Stores.AMAZON) && !(it.source == GamerPowerSource.NAME && it.isExtra) }
        .filter(::keep)
        .sortedWith(compareByDescending<Offer> { Rules.wished(it, state) }.thenBy { it.end ?: Long.MAX_VALUE })
    val mobile = if (state.settings.showMobile) open.filter { it.source == EpicMobileSource.NAME }.filter(::keep) else emptyList()
    val others = if (state.settings.showOthers) open.filter { it.source == GamerPowerSource.NAME && it.store !in setOf(Stores.EPIC, Stores.GOG, Stores.STEAM, Stores.AMAZON) }
        .filter { filter == null && (q.isEmpty() || it.normalisedTitle.contains(q)) } else emptyList()
    val soon = state.upcoming.filter { it.start > now && (filter == null || filter == Stores.EPIC) && (q.isEmpty() || Titles.normalise(it.title).contains(q)) }
    val pending = Rules.pending(state, now)
    val needLogin = pending.map { it.store }.distinct().filter { state.accounts[it]?.status == Accounts.LOGGED_OUT }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                if (searching) {
                    OutlinedTextField(
                        value = query, onValueChange = { query = it }, singleLine = true,
                        placeholder = { Text(stringResource(R.string.search_hint)) },
                        modifier = Modifier.fillMaxWidth().padding(end = 8.dp),
                        shape = RoundedCornerShape(50),
                    )
                } else Text(stringResource(R.string.tab_games))
            },
            actions = {
                IconButton(onClick = { searching = !searching; if (!searching) query = "" }) {
                    Icon(if (searching) Icons.Rounded.Close else Icons.Rounded.Search, stringResource(R.string.search))
                }
                if (!searching) {
                    IconButton(onClick = { onShare(pc) }, enabled = pc.isNotEmpty()) { Icon(Icons.Rounded.Share, stringResource(R.string.share_list)) }
                    IconButton(onClick = onRefresh, enabled = !refreshing) { Icon(Icons.Rounded.Refresh, stringResource(R.string.refresh)) }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
        )
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item("hero") {
                    val total = Money.total(state.library.values.map { it.worth }, Countries.of(state.settings.country).currency)
                    Hero(
                        value = Money.format(total?.first ?: 0.0, total?.second ?: Countries.of(state.settings.country).currency),
                        count = state.library.size,
                        caption = stringResource(R.string.hero_caption),
                    )
                }
                if (pending.isNotEmpty() && !claiming) item("claim") {
                    Notice(
                        text = pluralStringResource(R.plurals.pending_claims, pending.size, pending.size),
                        color = LocalPalette.current.amber,
                    ) {
                        Button(onClick = { onClaim(emptySet()) }) {
                            Icon(Icons.Rounded.Download, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.claim_all))
                        }
                    }
                }
                if (needLogin.isNotEmpty()) item("login") {
                    Notice(
                        text = stringResource(R.string.need_login, needLogin.joinToString(", ") { Stores.label(it) }),
                        color = LocalPalette.current.rose,
                    ) { OutlinedButton(onClick = onAccounts) { Text(stringResource(R.string.accounts)) } }
                }
                item("filters") {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FILTERS.forEach { f ->
                            FilterChip(
                                selected = filter == f,
                                onClick = { filter = f },
                                label = { Text(if (f == null) stringResource(R.string.filter_all) else shortStore(f)) },
                            )
                        }
                    }
                }
                item("free-h") { SectionHeader(stringResource(R.string.section_free), pc.size) }
                if (pc.isEmpty()) item("free-empty") {
                    Text(
                        stringResource(if (state.lastCheck == null) R.string.first_check else R.string.nothing_free),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
                items(pc, key = { "o:" + it.key }) { o ->
                    OfferCard(o, state, now, claiming, onClaim = { onClaim(setOf(o.key)) }, onOpen = onOpen)
                }
                if (soon.isNotEmpty()) {
                    item("soon-h") { SectionHeader(stringResource(R.string.section_soon), soon.size, openUpcoming, { openUpcoming = !openUpcoming }) }
                    if (openUpcoming) items(soon, key = { "u:" + it.title + it.start }) { w -> UpcomingRow(w, onOpen) }
                }
                if (mobile.isNotEmpty()) {
                    item("mob-h") { SectionHeader(stringResource(R.string.section_mobile), mobile.size, openMobile, { openMobile = !openMobile }) }
                    if (openMobile) items(mobile, key = { "m:" + it.key }) { o -> CompactRow(o, now, stringResource(R.string.mobile_hint), onOpen) }
                }
                if (others.isNotEmpty()) {
                    item("oth-h") { SectionHeader(stringResource(R.string.section_others), others.size, openOthers, { openOthers = !openOthers }) }
                    if (openOthers) items(others, key = { "g:" + it.key }) { o -> CompactRow(o, now, Stores.LABELS[o.store] ?: o.platforms.orEmpty(), onOpen) }
                }
                item("status") { SourcesLine(state, now) }
            }
        }
    }
}

fun shortStore(store: String?): String = when (store) {
    Stores.EPIC -> "Epic"
    Stores.EPIC_MOBILE -> "Epic mobile"
    Stores.GOG -> "GOG"
    Stores.STEAM -> "Steam"
    Stores.AMAZON -> "Amazon"
    null, Stores.UNKNOWN -> "?"
    else -> Stores.label(store)
}

@Composable
private fun SourcesLine(state: AppState, now: Long) {
    val context = LocalContext.current
    val last = state.lastCheck ?: return
    val names = mapOf("epic-api" to "Epic", "gog" to "GOG", "steam" to "Steam", "gamerpower" to "GamerPower", "epic-mobile" to "Epic mobile")
    val parts = names.mapNotNull { (k, label) -> state.sources[k]?.let { "$label ${if (it.ok) "✓" else "✗"}" } }
    Text(
        stringResource(R.string.checked_ago, Fmt.ago(context, last, now)) + " · " + parts.joinToString("  "),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
    )
}

@Composable
fun OfferCard(o: Offer, state: AppState, now: Long, claiming: Boolean, onClaim: () -> Unit, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val p = LocalPalette.current
    val claimed = Rules.claimedEntry(o, state.library)
    val owned = Rules.ownedOnSteam(o, state)
    val wished = Rules.wished(o, state)
    val attempt = state.attempts[o.key]
    val rating = state.ratings[Ratings.key(o)]
    val claimable = Rules.claimable(o, state.settings) && claimed == null && !owned
    val urgent = o.end != null && o.end - now < 24 * 3_600_000L

    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .border(1.dp, if (wished) p.amber.copy(alpha = 0.6f) else p.line, RoundedCornerShape(22.dp)),
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            Cover(o.image, o.shownTitle, o.store, Modifier.fillMaxSize(), letterSize = 48)
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(0.55f to Color.Transparent, 1f to Color(0x9914101F)),
                ),
            )
            Row(Modifier.padding(10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StoreChip(o.store, onImage = true)
                if (o.isExtra) Pill("DLC", Color.White, onImage = true)
                if (wished) Pill("★ " + stringResource(R.string.wished), p.amber, onImage = true)
            }
            if (rating?.percent != null) {
                val tone = when (Ratings.tone(rating)) { "good" -> p.jade; "mixed" -> p.amber; else -> p.rose }
                Pill(
                    stringResource(R.string.rating_short, rating.percent),
                    tone, onImage = true,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp),
                )
            }
            if (claimed != null || owned) {
                Row(
                    Modifier.align(Alignment.BottomStart).padding(10.dp).clip(RoundedCornerShape(50))
                        .background(p.jade).padding(horizontal = 10.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Rounded.CheckCircle, null, tint = Color(0xFF00301F), modifier = Modifier.size(14.dp))
                    Text(
                        stringResource(if (owned && claimed == null) R.string.status_owned else R.string.status_claimed),
                        style = MaterialTheme.typography.labelSmall, color = Color(0xFF00301F),
                        modifier = Modifier.padding(start = 4.dp),
                    )
                }
            }
        }
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(o.shownTitle, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                o.worth?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, textDecoration = TextDecoration.LineThrough, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(stringResource(R.string.free), style = MaterialTheme.typography.bodyMedium, color = p.amber)
                Spacer(Modifier.weight(1f))
                Icon(Icons.Rounded.Schedule, null, Modifier.size(15.dp), tint = if (urgent) p.rose else MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    if (o.end != null) Fmt.left(context, o.end, now) else "∞",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (urgent) p.rose else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (o.end != null) {
                Text(stringResource(R.string.until, Fmt.dateTime(o.end)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (claimed?.ts != null) {
                Text(stringResource(R.string.claimed_on, Fmt.date(claimed.ts)), style = MaterialTheme.typography.bodySmall, color = p.jade)
            } else if (attempt?.verdict != null && attempt.verdict !in Verdicts.ACQUIRED) {
                Text(verdictText(attempt.verdict, attempt.details), style = MaterialTheme.typography.bodySmall, color = p.rose, maxLines = 2, overflow = TextOverflow.Ellipsis)
            } else if (!Rules.claimable(o, state.settings) && o.store == Stores.STEAM && claimed == null && !owned) {
                Text(stringResource(R.string.steam_manual), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                if (claimable) {
                    Button(onClick = onClaim, enabled = !claiming, contentPadding = ButtonDefaults.ButtonWithIconContentPadding) {
                        Icon(Icons.Rounded.Download, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.action_claim))
                    }
                }
                (o.url ?: o.resolveUrl)?.let { u ->
                    OutlinedButton(onClick = { onOpen(u) }, contentPadding = ButtonDefaults.ButtonWithIconContentPadding) {
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.action_open))
                    }
                }
            }
        }
    }
}

@Composable
fun verdictText(verdict: String, details: String?): String {
    val base = when (verdict) {
        Verdicts.LOGIN -> stringResource(R.string.verdict_login)
        Verdicts.CHALLENGE -> stringResource(R.string.verdict_challenge)
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

@Composable
private fun UpcomingRow(w: Upcoming, onOpen: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)
            .then(if (w.url != null) Modifier.clickableNoRipple { onOpen(w.url) } else Modifier).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(w.image, w.title, Stores.EPIC, Modifier.width(96.dp).height(54.dp), radius = 10.dp, letterSize = 20)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(w.title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(stringResource(R.string.from_date, Fmt.dateTime(w.start)), style = MaterialTheme.typography.bodySmall, color = LocalPalette.current.amber)
        }
        StoreChip(Stores.EPIC)
    }
}

@Composable
private fun CompactRow(o: Offer, now: Long, hint: String, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(o.image, o.shownTitle, o.store, Modifier.width(96.dp).height(54.dp), radius = 10.dp, letterSize = 20)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(o.shownTitle, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            val extra = listOfNotNull(o.worth, o.end?.let { Fmt.left(context, it, now) }, hint.takeIf { it.isNotBlank() }).joinToString(" · ")
            Text(extra, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        (o.url ?: o.resolveUrl)?.let { u ->
            IconButton(onClick = { onOpen(u) }) { Icon(Icons.AutoMirrored.Rounded.OpenInNew, stringResource(R.string.action_open)) }
        }
    }
}
