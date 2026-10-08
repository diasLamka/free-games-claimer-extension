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
import android.content.Intent
import android.provider.Settings
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.github.diaslamka.freegames.notify.Notifier
import android.content.Context
import androidx.compose.foundation.layout.Row
import io.github.diaslamka.freegames.data.PassLog
import io.github.diaslamka.freegames.model.PassRecord
import io.github.diaslamka.freegames.notify.Watchdog

/**
 * La page « Sante » (1.26.0), dans les Reglages : pour chaque magasin, la session, la derniere recuperation, le
 * dernier echec depuis, ce qui attend, et si le controle du compte se laisse lire. Tout vient de [Health] : ce
 * que l'appli a deja note, jamais une mesure de plus.
 */
@Composable
fun HealthGroup(state: AppState, now: Long, notificationsAllowed: Boolean = true, onNotificationSettings: () -> Unit = {}, onAppSettings: () -> Unit = {}, onShareDiagnostic: () -> Unit = {}, onRunTest: () -> Unit = {}) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val overview = Health.overview(state, now)
    Group {
        // Notifications refusees : les alertes « derniere chance », l'aide du PC, les defis et les connexions disparaissent
        // sans un mot (Notifier.allowed). C'est ici qu'on le voit, avec le chemin pour y remedier.
        if (notificationsAllowed) {
            Text("> " + stringResource(R.string.health_notifications_on), style = MaterialTheme.typography.labelLarge, color = Color.Black)
        } else {
            Notice(stringResource(R.string.health_notifications_off), b.accent) {
                BrutButton(stringResource(R.string.health_notifications_open), onNotificationSettings)
            }
        }
        Text(
            "> " + (overview.lastCheck?.let { stringResource(R.string.health_last_check, Fmt.ago(context, it, now)) } ?: stringResource(R.string.health_never_checked)).uppercase(),
            style = MaterialTheme.typography.labelLarge, color = Color.Black,
        )
        Text(
            if (overview.sourcesDown.isEmpty()) stringResource(R.string.health_sources_ok)
            else stringResource(R.string.health_sources_down, overview.sourcesDown.joinToString(", ")),
            style = MaterialTheme.typography.bodySmall, color = Color.Black,
        )
        // La sentinelle (1.27.0) : la veille ne tourne plus -- Android la bride sans doute en arriere-plan.
        Watchdog.silentFor(state, now)?.let { silent ->
            Notice(stringResource(R.string.health_watch_stalled, Watchdog.hoursText(silent), state.settings.checkHours), b.accent) {
                BrutButton(stringResource(R.string.health_app_settings_open), onAppSettings)
            }
        }
        // Les derniers passages de la veille : la preuve qu'une passe de fond a tourne, et comment elle a fini.
        Box(Modifier.fillMaxWidth().height(2.dp).background(Color.Black))
        Text(stringResource(R.string.health_passes_title).uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black)
        if (state.watchLog.isEmpty()) {
            Text(stringResource(R.string.health_passes_none), style = MaterialTheme.typography.bodySmall, color = Color.Black)
        } else {
            state.watchLog.take(8).forEach { PassLine(it, now) }
            // Ce que la veille a coute sur le dernier jour (1.28.0).
            val cost = PassLog.cost(state.watchLog, now)
            if (cost.passes > 0) {
                Text(
                    stringResource(if (cost.atLeast) R.string.health_cost_least else R.string.health_cost, cost.passes, PassLog.duration(cost.ms)),
                    style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A),
                )
            }
        }
        // Le diagnostic partageable (1.27.0) : de quoi comprendre une veille qui ne tourne pas, sans rien de personnel.
        Box(Modifier.fillMaxWidth().height(2.dp).background(Color.Black))
        Text(stringResource(R.string.health_diag_hint), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
        BrutButton(stringResource(R.string.health_diag_share), onShareDiagnostic, primary = false)
        // Le test de la veille (1.27.0) : un passage comme le vrai, dans le travail de fond, dont le resultat arrive en notification.
        Text(stringResource(R.string.health_test_hint), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
        BrutButton(stringResource(R.string.health_test_run), onRunTest, primary = false)
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

/** Les notifications sont-elles permises ? Relu au retour des reglages d'Android : l'utilisateur les y change. */
@Composable
fun rememberNotificationsAllowed(): Boolean {
    val context = LocalContext.current
    var allowed by remember { mutableStateOf(Notifier.allowed(context)) }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) allowed = Notifier.allowed(context) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    return allowed
}

/** Envoie un texte par le menu « Partager » d'Android. */
fun shareText(context: Context, text: String, subject: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text).putExtra(Intent.EXTRA_SUBJECT, subject)
    runCatching { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** Les reglages d'Android de CETTE appli : c'est la que se leve la limite d'activite en arriere-plan (batterie). */
fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + context.packageName))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

/** Les reglages de notification de CETTE appli, dans Android. */
fun openNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
}

/** Un passage de la veille : quand, pourquoi, ce qu'il a trouve, combien de temps, et comment il a fini. */
@Composable
private fun PassLine(r: PassRecord, now: Long) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val reason = stringResource(
        when (r.reason) {
            "fond" -> R.string.pass_reason_fond
            "ecran" -> R.string.pass_reason_ecran
            else -> R.string.pass_reason_test
        },
    )
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            stringResource(R.string.health_pass_line, Fmt.ago(context, r.at, now), reason, r.offers, r.fresh, PassLog.duration(r.ms)),
            style = MaterialTheme.typography.bodySmall, color = Color.Black,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (r.screenOff) Tag(stringResource(R.string.pass_screen_off).uppercase(), b.accent, Color.Black, bordered = true)
            r.claimed?.let { Tag(stringResource(R.string.pass_claimed, it).uppercase(), b.accent, Color.Black, bordered = true) }
            val outcome = when (r.outcome) {
                PassLog.ERRORS -> R.string.pass_outcome_errors
                PassLog.FAILED -> R.string.pass_outcome_failed
                PassLog.CANCELLED -> R.string.pass_outcome_cancelled
                else -> null
            }
            if (outcome != null) Tag(stringResource(outcome).uppercase(), Color.Black, Color.White, maxLines = 2)
        }
        r.errors.forEach { Text("> $it", style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A)) }
    }
}
