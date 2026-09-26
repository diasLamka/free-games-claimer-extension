package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalPalette

/** L'etiquette du magasin : sa couleur, son nom court. */
@Composable
fun StoreChip(store: String?, modifier: Modifier = Modifier, onImage: Boolean = false) {
    val c = LocalPalette.current.store(store)
    val label = shortStore(store)
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = if (onImage) Color(0xCC14101F) else c.copy(alpha = 0.16f),
        contentColor = if (onImage) Color.White else c,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)) {
            Box(Modifier.size(7.dp).clip(RoundedCornerShape(50)).background(c))
            Text(label, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(start = 5.dp), maxLines = 1)
        }
    }
}

/** Une petite pastille de texte. */
@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier, onImage: Boolean = false) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = if (onImage) Color(0xCC14101F) else color.copy(alpha = 0.15f),
        contentColor = color,
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, maxLines = 1, modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp))
    }
}

/**
 * La jaquette, ou l'initiale du jeu sur la couleur du magasin tant qu'elle
 * n'est pas la -- comme les cartes du popup.
 */
@Composable
fun Cover(url: String?, title: String, store: String?, modifier: Modifier = Modifier, radius: Dp = 0.dp, letterSize: Int = 28) {
    val c = LocalPalette.current.store(store)
    Box(
        modifier.clip(RoundedCornerShape(radius)).background(c.copy(alpha = 0.18f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            title.trim().take(1).uppercase(),
            color = c.copy(alpha = 0.7f),
            fontSize = letterSize.sp,
            fontWeight = FontWeight.Bold,
        )
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        }
    }
}

/** Le titre d'une section, avec son compte, repliable. */
@Composable
fun SectionHeader(title: String, count: Int?, open: Boolean? = null, onToggle: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val m = if (onToggle != null) modifier.clip(RoundedCornerShape(12.dp)).then(Modifier.clickableNoRipple(onToggle)) else modifier
    Row(
        m.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (count != null) {
            Box(
                Modifier.clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceContainerHighest)
                    .padding(horizontal = 7.dp, vertical = 1.dp),
            ) { Text("$count", style = MaterialTheme.typography.labelSmall) }
        }
        Box(Modifier.weight(1f))
        if (open != null) Icon(if (open) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Un bandeau d'information discret. */
@Composable
fun Notice(text: String, color: Color, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.25f), RoundedCornerShape(16.dp)).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), overflow = TextOverflow.Ellipsis)
        if (action != null) action()
    }
}

@Composable
fun Hero(value: String?, count: Int, caption: String, modifier: Modifier = Modifier) {
    val p = LocalPalette.current
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .border(1.dp, p.line, RoundedCornerShape(24.dp))
            .padding(horizontal = 20.dp, vertical = 18.dp),
    ) {
        Text(caption.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value ?: "—",
            style = MaterialTheme.typography.headlineLarge.copy(fontSize = 38.sp),
            color = p.amber,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            androidx.compose.ui.res.pluralStringResource(io.github.diaslamka.freegames.R.plurals.games_count, count, count),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
