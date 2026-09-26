package io.github.diaslamka.freegames.ui

import android.view.ViewGroup
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalPalette

/**
 * La recuperation en cours, au-dessus de tous les onglets : la page du
 * magasin reste affichee (reduite) pour que le moteur y travaille, et
 * s'agrandit quand le magasin demande une verification a un humain.
 */
@Composable
fun ClaimPanel(session: ClaimSession) {
    val ui by session.ui.collectAsState()
    if (!ui.visible) return
    val p = LocalPalette.current
    var expanded by remember { mutableStateOf(false) }
    val big = expanded || ui.needsUser

    Column(
        Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(1.dp, if (ui.needsUser) p.rose else p.amber.copy(alpha = 0.5f), RoundedCornerShape(22.dp))
            .animateContentSize(),
    ) {
        Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            if (ui.running) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.5.dp)
            else Icon(Icons.Rounded.CheckCircle, null, tint = p.jade)
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(
                    if (ui.running) stringResource(R.string.claim_progress, ui.index, ui.total, ui.title.orEmpty())
                    else stringResource(R.string.claim_done),
                    style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                val step = when (ui.step) {
                    ClaimSession.STEP_OPEN -> stringResource(R.string.step_open, Stores.label(ui.store))
                    ClaimSession.STEP_WAIT -> stringResource(R.string.step_wait)
                    ClaimSession.STEP_CLAIM -> stringResource(R.string.step_claim)
                    else -> null
                }
                if (step != null) Text(step, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (ui.running) {
                IconButton(onClick = { expanded = !expanded }) { Icon(if (big) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, stringResource(R.string.show_page)) }
                IconButton(onClick = { session.stop() }) { Icon(Icons.Rounded.Stop, stringResource(R.string.stop)) }
            } else {
                IconButton(onClick = { session.dismiss() }) { Icon(Icons.Rounded.Close, stringResource(R.string.close)) }
            }
        }
        if (ui.needsUser) {
            Text(
                stringResource(R.string.challenge_help, Stores.label(ui.store)),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 4.dp),
            )
            Row(Modifier.padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { session.userFinished(true) }) { Text(stringResource(R.string.challenge_continue)) }
                TextButton(onClick = { session.userFinished(false) }) { Text(stringResource(R.string.challenge_skip)) }
            }
        }
        if (ui.running) {
            AndroidView(
                factory = { session.webView.also { (it.parent as? ViewGroup)?.removeView(it) } },
                modifier = Modifier.fillMaxWidth().height(if (big) 480.dp else 170.dp).padding(8.dp).clip(RoundedCornerShape(14.dp)),
            )
        }
        ui.outcomes.takeLast(6).forEach { o ->
            val ok = o.verdict in Verdicts.ACQUIRED
            Row(Modifier.padding(horizontal = 14.dp, vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (ok) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline, null, Modifier.size(16.dp), tint = if (ok) p.jade else p.rose)
                Text(
                    o.title + " — " + (if (ok) stringResource(R.string.status_claimed) else verdictText(o.verdict, o.details)),
                    style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
        if (ui.outcomes.isNotEmpty()) androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
    }
}
