package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Accounts
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Health
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * La page « Sante » (1.26.0), dans les Reglages : pour chaque magasin, la session, la derniere recuperation, le
 * dernier echec depuis, ce qui attend, et si le controle du compte se laisse lire. Tout vient de [Health] : ce
 * que l'appli a deja note, jamais une mesure de plus.
 */
@Composable
fun HealthGroup(state: AppState, now: Long) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val overview = Health.overview(state, now)
    Group {
        Text(
            "> " + (overview.lastCheck?.let { stringResource(R.string.health_last_check, Fmt.ago(context, it, now)) } ?: stringResource(R.string.health_never_checked)).uppercase(),
            style = MaterialTheme.typography.labelLarge, color = Color.Black,
        )
        Text(
            if (overview.sourcesDown.isEmpty()) stringResource(R.string.health_sources_ok)
            else stringResource(R.string.health_sources_down, overview.sourcesDown.joinToString(", ")),
            style = MaterialTheme.typography.bodySmall, color = Color.Black,
        )
        overview.lines.forEach { line ->
            Box(Modifier.fillMaxWidth().height(2.dp).background(Color.Black))
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    (if (line.store == Stores.AMAZON) stringResource(R.string.set_amazon) else Stores.label(line.store)).uppercase(),
                    style = MaterialTheme.typography.titleSmall, color = Color.Black,
                )
                val (account, ok) = when (line.account) {
                    Accounts.OK -> stringResource(R.string.account_ok) to true
                    Accounts.PRESENT -> stringResource(R.string.account_present) to true
                    Accounts.LOGGED_OUT -> stringResource(R.string.account_logged_out) to false
                    else -> stringResource(R.string.account_unknown) to null
                }
                Tag(
                    account.uppercase(),
                    when (ok) { true -> b.accent; false -> Color.Black; null -> Color.White },
                    if (ok == false) Color.White else Color.Black,
                    bordered = ok == null,
                    maxLines = 3,
                )
                val claim = line.lastClaim
                Text(
                    if (claim?.ts == null) stringResource(R.string.health_no_claim)
                    else stringResource(R.string.health_last_claim, Fmt.ago(context, claim.ts, now), claim.title ?: claim.id),
                    style = MaterialTheme.typography.bodySmall, color = Color.Black,
                )
                line.lastFailure?.let { f ->
                    Tag(
                        stringResource(R.string.health_failure, Fmt.ago(context, f.at, now), f.title, verdictText(f.verdict, f.details)).uppercase(),
                        Color.Black, Color.White, maxLines = 4,
                    )
                }
                if (line.waiting > 0) Text(stringResource(R.string.health_waiting, line.waiting), style = MaterialTheme.typography.bodySmall, color = Color.Black)
                Text(
                    when (line.control) {
                        Health.Control.READ -> stringResource(R.string.health_control_read, line.controlAt?.let { Fmt.ago(context, it, now) }.orEmpty())
                        Health.Control.UNREADABLE -> stringResource(R.string.health_control_unreadable, line.controlAt?.let { Fmt.ago(context, it, now) }.orEmpty())
                        Health.Control.NOT_ASKED_YET -> stringResource(R.string.health_control_wait)
                        Health.Control.OWNED_LIST -> stringResource(R.string.health_control_owned_list, state.steamOwned.size)
                        Health.Control.PAGE_DECIDES -> stringResource(R.string.health_control_page)
                    },
                    style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A),
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}
