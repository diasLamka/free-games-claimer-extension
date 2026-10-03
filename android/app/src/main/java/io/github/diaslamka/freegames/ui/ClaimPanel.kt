package io.github.diaslamka.freegames.ui

import android.view.ViewGroup
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.claim.ClaimSession
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * La recuperation en cours, au-dessus de tous les onglets : la page du
 * magasin reste affichee (reduite) pour que le moteur y travaille, et
 * s'agrandit quand le magasin demande une verification a un humain.
 */
@Composable
fun ClaimPanel(session: ClaimSession, onStopped: () -> Unit = {}, onDismissed: () -> Unit = {}) {
    val ui by session.ui.collectAsStateWithLifecycle()
    if (!ui.visible) return
    ClaimPanelContent(
        ui, onToggle = null,
        onStop = { session.stop(); onStopped() },
        onDismiss = { session.dismiss(); onDismissed() },
        onUser = { session.userFinished(it) },
        onAnswer = { session.answer(it) },
        who = session.memberName,
    ) {
        AndroidView(
            factory = { session.webView.also { (it.parent as? ViewGroup)?.removeView(it) } },
            modifier = it,
        )
    }
}

/** Le panneau lui-meme, sans la page : ce que les maquettes rendent aussi. */
@Composable
fun ClaimPanelContent(
    ui: ClaimSession.Ui,
    onToggle: (() -> Unit)?,
    onStop: () -> Unit,
    onDismiss: () -> Unit,
    onUser: (Boolean) -> Unit,
    /** « Deja a moi » / « plus offert » (1.24.0), sur la demande « montre-moi le bouton ». */
    onAnswer: (String) -> Unit = {},
    /** Toute la famille (1.9.0) : pour qui l'on recupere. */
    who: String? = null,
    page: @Composable (Modifier) -> Unit,
) {
    val b = LocalBrut.current
    var expanded by remember { mutableStateOf(false) }
    val big = expanded || ui.needsUser
    Column(
        Modifier.padding(start = 10.dp, end = 16.dp, top = 6.dp, bottom = 8.dp).fillMaxWidth()
            .brut(Color.White, shadow = b.shadow, offset = 6.dp).animateContentSize(),
    ) {
        Row(Modifier.fillMaxWidth().background(if (ui.needsUser) Color.Black else b.accent), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).padding(horizontal = 12.dp, vertical = 8.dp)) {
                Text(
                    if (ui.running) stringResource(R.string.claim_count, ui.index, ui.total).uppercase()
                    else stringResource(R.string.claim_done).uppercase(),
                    style = MaterialTheme.typography.labelLarge, color = if (ui.needsUser) b.accent else b.onAccent,
                )
                if (who != null) Text(
                    stringResource(R.string.family_for, who).uppercase(), style = MaterialTheme.typography.labelMedium,
                    color = if (ui.needsUser) Color.White else Color.Black,
                )
                if (ui.running && ui.title != null) Text(
                    ui.title.uppercase(), style = MaterialTheme.typography.titleMedium,
                    color = if (ui.needsUser) Color.White else Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                val step = when (ui.step) {
                    ClaimSession.STEP_OPEN -> stringResource(R.string.step_open, Stores.label(ui.store))
                    ClaimSession.STEP_WAIT -> stringResource(R.string.step_wait)
                    ClaimSession.STEP_CLAIM -> stringResource(R.string.step_claim)
                    else -> null
                }
                if (step != null) Text("> $step", style = MaterialTheme.typography.bodySmall, color = if (ui.needsUser) Color.White else b.onAccent)
            }
            if (ui.running) {
                Text(
                    if (big) "[–]" else "[+]", style = MaterialTheme.typography.labelLarge, color = Color.Black,
                    modifier = Modifier.background(Color.White).border(2.dp, Color.Black).clickableNoRipple { expanded = !expanded; onToggle?.invoke() }.padding(8.dp),
                )
                Text(
                    "■ " + stringResource(R.string.stop).uppercase(), style = MaterialTheme.typography.labelLarge, color = Color.White,
                    modifier = Modifier.padding(horizontal = 8.dp).background(Color.Black).clickableNoRipple(onClick = onStop).padding(8.dp),
                )
            } else {
                Text(
                    "✕", style = MaterialTheme.typography.titleMedium, color = Color.White,
                    modifier = Modifier.background(Color.Black).clickableNoRipple(onClick = onDismiss).padding(horizontal = 14.dp, vertical = 8.dp),
                )
            }
        }
        Box(Modifier.fillMaxWidth().height(3.dp).background(Color.Black))
        if (ui.needsUser) {
            Text(
                (if (ui.teach) stringResource(R.string.teach_help, Stores.label(ui.store)) else stringResource(R.string.challenge_help, Stores.label(ui.store))).uppercase(),
                style = MaterialTheme.typography.labelMedium, color = Color.Black,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            )
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BrutButton(stringResource(R.string.challenge_continue), { onUser(true) })
                BrutButton(stringResource(R.string.challenge_skip), { onUser(false) }, primary = false)
            }
            // Deux reponses de plus (1.24.0) : le jeu est deja a toi, ou n'est plus offert. L'offre est close, on ne la redemande plus.
            if (ui.teach) {
                Row(Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    BrutButton(stringResource(R.string.teach_owned), { onAnswer(Verdicts.OWNED) }, primary = false)
                    BrutButton(stringResource(R.string.teach_gone), { onAnswer(Verdicts.GONE) }, primary = false)
                }
            }
        }
        if (ui.running) {
            page(Modifier.fillMaxWidth().height(if (big) 480.dp else 170.dp).padding(8.dp).border(3.dp, Color.Black).padding(3.dp))
        }
        ui.outcomes.takeLast(6).forEach { o ->
            val ok = o.verdict in Verdicts.ACQUIRED
            // Le tampon de l'issue (1.11.0), comme la liste « Deja recupere » de l'extension.
            Row(Modifier.padding(horizontal = 12.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                // Une colonne de largeur fixe : les titres s'alignent, quel que soit le tampon.
                Box(Modifier.width(100.dp), contentAlignment = Alignment.CenterStart) {
                    KindStamp(stampKindOf(o.verdict) ?: StampKind.WAITING, small = true)
                }
                Text(
                    // Le tampon dit l'etat ; le texte ne dit que ce qu'il ajoute (connexion requise, raison de l'echec...).
                    o.title.uppercase() + (if (ok || (o.verdict == Verdicts.SKIPPED && o.details.isNullOrBlank())) "" else " — " + verdictText(o.verdict, o.details)),
                    style = MaterialTheme.typography.bodySmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
        if (ui.outcomes.isNotEmpty()) Box(Modifier.height(8.dp))
    }
}
