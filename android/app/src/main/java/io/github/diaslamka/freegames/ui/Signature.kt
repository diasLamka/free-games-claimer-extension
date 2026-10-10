package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import kotlinx.coroutines.delay

/*
 * Les pastilles d'etat et le compte a rebours (1.31.0) : ce qui s'appelait « tampon » et « timecode » dans l'ancienne charte, en
 * composants standard -- une pastille arrondie avec son icone, une carte tonale.
 */

/** Une pastille de texte, sur la couleur du conteneur principal. Sert de titre court (l'aide du PC). */
@Composable
fun Stamp(text: String, modifier: Modifier = Modifier, small: Boolean = false) {
    val b = LocalBrut.current
    Text(
        text,
        style = if (small) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelLarge,
        color = b.onAccent,
        maxLines = 1,
        modifier = modifier.clip(RoundedCornerShape(8.dp)).background(b.accent).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** Les etats d'une recuperation : recupere, deja a toi, ignore, echec, en attente -- les memes que ceux de l'extension. */
enum class StampKind { CLAIMED, OWNED, SKIPPED, FAILED, WAITING }

/** L'etat d'un verdict du moteur ; null s'il n'y en a pas. La table de l'extension. */
fun stampKindOf(verdict: String?): StampKind? = when (verdict) {
    null -> null
    Verdicts.CLAIMED, Verdicts.REDEEMED -> StampKind.CLAIMED
    Verdicts.ALREADY_REDEEMED, Verdicts.OWNED -> StampKind.OWNED
    Verdicts.SKIPPED, Verdicts.OUT_OF_SCOPE -> StampKind.SKIPPED
    Verdicts.FAILURE, Verdicts.BAD_URL -> StampKind.FAILED
    else -> StampKind.WAITING
}

@Composable
fun stampLabel(kind: StampKind): String = stringResource(
    when (kind) {
        StampKind.CLAIMED -> R.string.status_claimed
        StampKind.OWNED -> R.string.stamp_owned
        StampKind.SKIPPED -> R.string.stamp_skipped
        StampKind.FAILED -> R.string.stamp_failed
        StampKind.WAITING -> R.string.stamp_waiting
    },
)

/**
 * La pastille d'un etat : une icone et un mot, sur une couleur tonale. Elle a toujours son propre fond, pour rester lisible sur une
 * jaquette comme sur une carte, en clair comme en sombre.
 */
@Composable
fun KindStamp(kind: StampKind, modifier: Modifier = Modifier, small: Boolean = false, text: String = stampLabel(kind)) {
    val s = LocalBrut.current.scheme
    val (fill, ink, icon) = when (kind) {
        StampKind.CLAIMED -> Triple(s.primaryContainer, s.onPrimaryContainer, Icons.Rounded.CheckCircle)
        StampKind.OWNED -> Triple(s.tertiaryContainer, s.onTertiaryContainer, Icons.Rounded.Inventory2)
        StampKind.SKIPPED -> Triple(s.surfaceContainerHighest, s.onSurfaceVariant, Icons.Rounded.Block)
        StampKind.FAILED -> Triple(s.errorContainer, s.onErrorContainer, Icons.Rounded.ErrorOutline)
        StampKind.WAITING -> Triple(s.secondaryContainer, s.onSecondaryContainer, Icons.Rounded.Schedule)
    }
    Row(
        modifier.clip(RoundedCornerShape(50)).background(fill).padding(horizontal = if (small) 6.dp else 10.dp, vertical = if (small) 2.dp else 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(icon, null, tint = ink, modifier = Modifier.size(if (small) 12.dp else 16.dp))
        Text(text, style = if (small) MaterialTheme.typography.labelSmall else MaterialTheme.typography.labelMedium, color = ink, maxLines = 1, softWrap = false)
    }
}

/** « 18:32:07 », ou « 2J 23:59:59 » au-dela d'un jour. */
fun timecodeText(ms: Long, daysLabel: (Long) -> String): String {
    val s = (ms / 1000).coerceAtLeast(0)
    val d = s / 86_400
    val hms = listOf((s % 86_400) / 3600, (s % 3600) / 60, s % 60).joinToString(":") { it.toString().padStart(2, '0') }
    return if (d > 0) "${daysLabel(d)} $hms" else hms
}

/** La prochaine fin d'offre, en chiffres qui defilent. L'horloge ne vit que tant que la carte est a l'ecran. */
@Composable
fun Timecode(end: Long, title: String, label: String, daysLabel: (Long) -> String, modifier: Modifier = Modifier) {
    val s = LocalBrut.current.scheme
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(end) {
        while (true) {
            now = System.currentTimeMillis()
            delay(1000 - now % 1000)
        }
    }
    val reste = end - now
    if (reste <= 0) return
    val text = timecodeText(reste, daysLabel)
    Card(
        modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = s.secondaryContainer, contentColor = s.onSecondaryContainer),
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) { contentDescription = "$label $text — $title" },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 2)
            BasicText(
                text,
                style = MaterialTheme.typography.titleLarge.copy(fontSize = 22.sp, color = s.onSecondaryContainer),
                maxLines = 1,
                autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 22.sp),
            )
            Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        }
    }
}
