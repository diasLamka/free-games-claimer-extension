package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Recovery
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * Le centre de recuperation (1.31.0) : un seul ecran pour tout ce qui touche a « prendre les jeux ». En haut, l'etat et LE geste ;
 * dessous, ce que l'appli prendrait maintenant, ce qui attend ou demande de l'aide, ce qu'elle ne prend pas -- avec la raison --,
 * et ce qu'elle a pris. Le plan est calcule par [Recovery.plan], le meme calcul que le bouton « Tout recuperer ».
 */
@Composable
fun RecoveryScreen(
    state: AppState,
    now: Long,
    claiming: Boolean,
    onClaim: (Set<String>) -> Unit,
    onOpen: (String) -> Unit,
    onAccounts: () -> Unit,
) {
    val plan = remember(state, now) { Recovery.plan(state, now) }
    var openSkipped by rememberSaveable { mutableStateOf(false) }
    var openRecent by rememberSaveable { mutableStateOf(true) }
    val context = LocalContext.current

    ReadableColumn {
        TopBlock(stringResource(R.string.rec_title))
        LazyColumn(Modifier.fillMaxWidth().weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
            item("status") { StatusCard(plan, claiming, now, onClaimAll = { onClaim(emptySet()) }) }

            if (plan.ready.isNotEmpty()) {
                item("ready-h") { SectionHeader(stringResource(R.string.rec_section_ready), plan.ready.size) }
                items(plan.ready, key = { "r:" + it.offer.key }) { item ->
                    RecoveryRow(
                        item.offer,
                        support = listOfNotNull(Stores.label(item.offer.store), item.offer.end?.let { Fmt.left(context, it, now) }).joinToString(" · "),
                        action = stringResource(R.string.rec_claim), enabled = !claiming,
                    ) { onClaim(setOf(item.offer.key)) }
                }
            }

            if (plan.needsYou.isNotEmpty()) {
                item("needs-h") { SectionHeader(stringResource(R.string.rec_section_needs), plan.needsYou.size) }
                items(plan.needsYou, key = { "n:" + it.offer.key }) { item ->
                    val verdict = item.attempt?.verdict.orEmpty()
                    RecoveryRow(
                        item.offer,
                        support = verdictText(verdict, null),
                        action = stringResource(if (verdict == Verdicts.LOGIN) R.string.rec_sign_in else R.string.help_finish), enabled = !claiming,
                    ) { if (verdict == Verdicts.LOGIN) onAccounts() else onClaim(setOf(item.offer.key)) }
                }
            }

            if (plan.waiting.isNotEmpty()) {
                item("wait-h") { SectionHeader(stringResource(R.string.rec_section_waiting), plan.waiting.size) }
                items(plan.waiting, key = { "w:" + it.offer.key }) { item ->
                    val a = item.attempt
                    RecoveryRow(
                        item.offer,
                        support = listOfNotNull(
                            a?.verdict?.let { verdictText(it, null) },
                            item.retryAt?.let { stringResource(R.string.rec_retry_in, Fmt.left(context, it, now), (a?.count ?: 0) + 1, Verdicts.MAX_ATTEMPTS) },
                        ).joinToString(" · "),
                        action = stringResource(R.string.rec_retry_now), enabled = !claiming,
                    ) { onClaim(setOf(item.offer.key)) }
                }
            }

            if (plan.skipped.isNotEmpty()) {
                item("skip-h") { SectionHeader(stringResource(R.string.rec_section_skipped), plan.skipped.size, openSkipped, { openSkipped = !openSkipped }) }
                if (openSkipped) {
                    item("skip-hint") { Text(stringResource(R.string.rec_skipped_hint), style = MaterialTheme.typography.bodySmall, color = LocalBrut.current.mute, modifier = Modifier.padding(bottom = 4.dp)) }
                    items(plan.skipped, key = { "s:" + it.offer.key }) { item ->
                        val open = item.offer.url ?: item.offer.resolveUrl
                        RecoveryRow(
                            item.offer, support = whyText(item),
                            action = if (open != null) stringResource(R.string.action_open) else null, enabled = true,
                        ) { open?.let(onOpen) }
                    }
                }
            }

            item("recent-h") { SectionHeader(stringResource(R.string.rec_section_recent), plan.recent.size, openRecent, { openRecent = !openRecent }) }
            if (openRecent) {
                if (plan.recent.isEmpty()) item("recent-empty") { Text(stringResource(R.string.rec_recent_empty), style = MaterialTheme.typography.bodyMedium, color = LocalBrut.current.mute, modifier = Modifier.padding(vertical = 8.dp)) }
                items(plan.recent, key = { "p:" + it.store + it.id }) { entry -> ProofRow(entry, onOpen) }
            }
        }
    }
}

/** L'etat, et le geste : « Tout recuperer » quand il y a quelque chose a prendre. */
@Composable
private fun StatusCard(plan: Recovery.Plan, claiming: Boolean, now: Long, onClaimAll: () -> Unit) {
    val s = LocalBrut.current.scheme
    val context = LocalContext.current
    val title = when {
        claiming -> stringResource(R.string.rec_status_busy)
        plan.ready.isNotEmpty() -> pluralStringResource(R.plurals.pending_claims, plan.ready.size, plan.ready.size)
        plan.needsYou.isNotEmpty() -> pluralStringResource(R.plurals.rec_needs_you_count, plan.needsYou.size, plan.needsYou.size)
        else -> stringResource(R.string.rec_status_quiet)
    }
    val detail = listOfNotNull(
        if (plan.ready.isNotEmpty()) stringResource(R.string.rec_simulation_hint) else null,
        if (plan.ready.isNotEmpty() && plan.needsYou.isNotEmpty()) pluralStringResource(R.plurals.rec_needs_you_count, plan.needsYou.size, plan.needsYou.size) else null,
        plan.nextRetry?.let { stringResource(R.string.rec_next_retry, Fmt.left(context, it, now)) },
    ).joinToString("\n")
    Card(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = if (plan.quiet) s.surfaceContainerHigh else s.primaryContainer, contentColor = if (plan.quiet) s.onSurface else s.onPrimaryContainer),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodyMedium)
            if (claiming) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 4.dp))
            else if (plan.ready.isNotEmpty()) BrutButton(stringResource(R.string.rec_claim_all), onClaimAll, Modifier.padding(top = 4.dp))
        }
    }
}

/** Une ligne standard : la jaquette, le titre, une phrase, et un geste a droite. */
@Composable
private fun RecoveryRow(offer: Offer, support: String, action: String?, enabled: Boolean, onAction: () -> Unit) {
    ListItem(
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        leadingContent = { Cover(offer.image, offer.shownTitle, offer.store, Modifier.width(72.dp).height(44.dp), radius = 8.dp, letterSize = 18) },
        headlineContent = { Text(offer.shownTitle, maxLines = 2) },
        supportingContent = if (support.isNotEmpty()) ({ Text(support, maxLines = 3) }) else null,
        trailingContent = if (action != null) ({ TextButton(onClick = onAction, enabled = enabled) { Text(action, maxLines = 1) } }) else null,
    )
    HorizontalDivider(color = LocalBrut.current.line.copy(alpha = 0.4f))
}

/** Une preuve : ce qui a ete pris, quand, par quoi, et pour combien. */
@Composable
private fun ProofRow(e: LibraryEntry, onOpen: (String) -> Unit) {
    val line = listOfNotNull(
        Stores.label(e.store),
        e.ts?.let { Fmt.dateTime(it) },
        stringResource(if (e.via == "extension") R.string.rec_via_extension else R.string.rec_via_app),
        e.worth,
    ).joinToString(" · ")
    ListItem(
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        headlineContent = { Text(e.title ?: e.id, maxLines = 2) },
        supportingContent = { Text(line, maxLines = 2) },
        trailingContent = e.url?.let { u -> ({ TextButton(onClick = { onOpen(u) }) { Text(stringResource(R.string.action_open)) } }) },
    )
    HorizontalDivider(color = LocalBrut.current.line.copy(alpha = 0.4f))
}

/** Pourquoi cette offre n'est pas prise, en toutes lettres. */
@Composable
private fun whyText(item: Recovery.Item): String = when (item.why) {
    Recovery.Why.STORE_OFF -> stringResource(R.string.rec_why_store_off)
    Recovery.Why.NO_ENGINE -> stringResource(R.string.rec_why_no_engine)
    Recovery.Why.NOTHING_TO_KEEP -> stringResource(R.string.rec_why_nothing)
    Recovery.Why.ALREADY_CLAIMED -> stringResource(R.string.rec_why_claimed)
    Recovery.Why.OWNED_STEAM -> stringResource(R.string.rec_why_steam)
    Recovery.Why.MARKED_OWNED -> stringResource(R.string.rec_why_marked)
    Recovery.Why.GAVE_UP -> stringResource(R.string.rec_why_gave_up, item.attempt?.count ?: Verdicts.MAX_ATTEMPTS)
    Recovery.Why.FINISHED -> item.attempt?.verdict?.let { verdictText(it, null) } ?: stringResource(R.string.rec_why_closed)
    null -> ""
}
