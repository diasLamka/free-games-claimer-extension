package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.asImageBitmap
import io.github.diaslamka.freegames.data.Proofs
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
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
 * et ce qu'elle a pris. Le plan est calcule par [Recovery.plan], le meme calcul que le bouton « Tout recuperer ». Dans la charte
 * de l'appli : cartes cernees, ombre dure, accent jaune.
 */
@Composable
fun RecoveryScreen(
    state: AppState,
    now: Long,
    claiming: Boolean,
    onClaim: (Set<String>) -> Unit,
    onOpen: (String) -> Unit,
    onAccounts: () -> Unit,
    /** Effacer toutes les captures du carnet de preuves (1.34.0). */
    onClearProofs: () -> Unit = {},
) {
    val plan = remember(state, now) { Recovery.plan(state, now) }
    var simulating by remember { mutableStateOf(false) }
    var proofOf by remember { mutableStateOf<LibraryEntry?>(null) }
    var openSkipped by rememberSaveable { mutableStateOf(false) }
    var openRecent by rememberSaveable { mutableStateOf(true) }
    val context = LocalContext.current
    val b = LocalBrut.current

    ReadableColumn {
        TopBlock(stringResource(R.string.rec_title))
        LazyColumn(
            Modifier.fillMaxWidth().weight(1f),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            item("status") { StatusBlock(plan, claiming, now, onClaimAll = { onClaim(emptySet()) }, onSimulate = { simulating = true }) }

            if (plan.ready.isNotEmpty()) {
                item("ready-h") { SectionHeader(stringResource(R.string.rec_section_ready), plan.ready.size) }
                items(plan.ready, key = { "r:" + it.offer.key }) { item ->
                    RecoveryRow(
                        item.offer,
                        support = listOfNotNull(Stores.label(item.offer.store), item.offer.end?.let { Fmt.left(context, it, now) }).joinToString(" / "),
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
                        ).joinToString(" / "),
                        action = stringResource(R.string.rec_retry_now), enabled = !claiming,
                    ) { onClaim(setOf(item.offer.key)) }
                }
            }

            if (plan.skipped.isNotEmpty()) {
                item("skip-h") { SectionHeader(stringResource(R.string.rec_section_skipped), plan.skipped.size, openSkipped, { openSkipped = !openSkipped }) }
                if (openSkipped) {
                    item("skip-hint") { Text(stringResource(R.string.rec_skipped_hint), style = MaterialTheme.typography.bodySmall, color = b.mute, modifier = Modifier.padding(bottom = 6.dp)) }
                    items(plan.skipped, key = { "s:" + it.offer.key }) { item ->
                        val open = item.offer.url ?: item.offer.resolveUrl
                        RecoveryRow(
                            item.offer, support = whyText(item),
                            action = if (open != null) stringResource(R.string.action_open) else null, enabled = true, primary = false,
                        ) { open?.let(onOpen) }
                    }
                }
            }

            item("recent-h") { SectionHeader(stringResource(R.string.rec_section_recent), plan.recent.size, openRecent, { openRecent = !openRecent }) }
            if (openRecent) {
                if (plan.recent.isEmpty()) item("recent-empty") { Text(stringResource(R.string.rec_recent_empty), style = MaterialTheme.typography.bodyMedium, color = b.mute, modifier = Modifier.padding(vertical = 8.dp)) }
                items(plan.recent, key = { "p:" + it.store + it.id }) { entry -> ProofRow(entry, onOpen, onProof = { proofOf = it }) }
                if (plan.recent.any { it.proof != null }) item("proofs-clear") {
                    BrutButton(stringResource(R.string.rec_proofs_clear), onClearProofs, Modifier.padding(top = 4.dp), primary = false)
                }
            }
        }
    }

    if (simulating) SimulationDialog(Recovery.simulate(state, now), now, onDismiss = { simulating = false })
    proofOf?.let { ProofDialog(it, onOpen, onDismiss = { proofOf = null }) }
}

/** L'etat, et le geste : « Tout recuperer » quand il y a quelque chose a prendre. Un bloc d'accent, ombre dure. */
@Composable
private fun StatusBlock(plan: Recovery.Plan, claiming: Boolean, now: Long, onClaimAll: () -> Unit, onSimulate: () -> Unit) {
    val b = LocalBrut.current
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
    Column(
        Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 10.dp)
            .brut(if (plan.quiet) Color.White else b.accent, shadow = b.shadow, offset = 6.dp).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = Color.Black)
        if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = Color.Black)
        if (!claiming && (plan.ready.isNotEmpty() || plan.needsYou.isNotEmpty())) {
            Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (plan.ready.isNotEmpty()) BrutButton(stringResource(R.string.rec_claim_all), onClaimAll, primary = false)
                BrutButton(stringResource(R.string.rec_simulate), onSimulate, primary = false)
            }
        }
    }
}

/** Une ligne : la jaquette, le titre, une phrase, et un geste. Meme carte que les autres listes de l'appli. */
@Composable
private fun RecoveryRow(offer: Offer, support: String, action: String?, enabled: Boolean, primary: Boolean = true, onAction: () -> Unit) {
    val b = LocalBrut.current
    Row(
        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 7.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Cover(offer.image, offer.shownTitle, offer.store, Modifier.width(78.dp).height(44.dp), letterSize = 18)
        Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
            Text(offer.shownTitle, style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (support.isNotEmpty()) Text(support, style = MaterialTheme.typography.bodySmall, color = MutedInk, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (action != null) BrutButton(action, onAction, primary = primary, enabled = enabled)
    }
}

/** Une preuve : ce qui a ete pris, quand, par quoi, et pour combien. */
@Composable
private fun ProofRow(e: LibraryEntry, onOpen: (String) -> Unit, onProof: (LibraryEntry) -> Unit) {
    val b = LocalBrut.current
    val line = listOfNotNull(
        Stores.label(e.store),
        e.ts?.let { Fmt.dateTime(it) },
        stringResource(if (e.via == "extension") R.string.rec_via_extension else R.string.rec_via_app),
        e.worth,
    ).joinToString(" / ")
    Row(
        Modifier.fillMaxWidth().padding(end = 5.dp, bottom = 7.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(e.title ?: e.id, style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(line, style = MaterialTheme.typography.bodySmall, color = MutedInk, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (e.proof != null) BrutButton(stringResource(R.string.rec_proof), { onProof(e) }, primary = false)
        else e.url?.let { u -> BrutButton(stringResource(R.string.action_open), { onOpen(u) }, primary = false) }
    }
}

/** La simulation : ce que « Tout recuperer » ferait maintenant, dans l'ordre, sans rien ouvrir ni cliquer. */
@Composable
private fun SimulationDialog(sim: Recovery.Simulation, now: Long, onDismiss: () -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rec_sim_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (sim.steps.isEmpty()) stringResource(R.string.rec_status_quiet) else stringResource(R.string.rec_sim_summary, sim.likely, sim.blocked),
                    style = MaterialTheme.typography.bodyMedium,
                )
                sim.steps.forEachIndexed { i, step ->
                    val line = when (step.outcome) {
                        Recovery.Outcome.CLAIM -> stringResource(R.string.rec_sim_claim)
                        Recovery.Outcome.LOGIN -> stringResource(R.string.rec_sim_login)
                        Recovery.Outcome.HELP -> stringResource(R.string.rec_sim_help)
                    }
                    Column {
                        Text("${i + 1}. ${step.offer.shownTitle}", style = MaterialTheme.typography.titleSmall)
                        Text("${Stores.label(step.offer.store)} — $line", style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(stringResource(R.string.rec_sim_nothing), style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}

/** Une preuve : la capture de la page de confirmation, prise au moment ou le jeu a ete recupere. */
@Composable
private fun ProofDialog(e: LibraryEntry, onOpen: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val image = remember(e.proof) {
        Proofs.file(Proofs.dir(context), e.proof)?.let { f -> android.graphics.BitmapFactory.decodeFile(f.path)?.asImageBitmap() }
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(e.title ?: e.id) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(listOfNotNull(Stores.label(e.store), e.ts?.let { Fmt.dateTime(it) }).joinToString(" / "), style = MaterialTheme.typography.bodySmall)
                if (image != null) androidx.compose.foundation.Image(image, e.title, Modifier.fillMaxWidth(), contentScale = androidx.compose.ui.layout.ContentScale.FillWidth)
                else Text(stringResource(R.string.rec_proof_missing), style = MaterialTheme.typography.bodyMedium)
                e.proofUrl?.let { Text(stringResource(R.string.rec_proof_page, it), style = MaterialTheme.typography.bodySmall) }
            }
        },
        dismissButton = e.proofUrl?.let { u -> { androidx.compose.material3.TextButton(onClick = { onOpen(u) }) { Text(stringResource(R.string.action_open)) } } },
        confirmButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
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
