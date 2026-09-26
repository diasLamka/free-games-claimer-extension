package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.Display
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import io.github.diaslamka.freegames.ui.theme.Mono

/* ------------------------------------------------------------ la matiere */

/**
 * Le bloc de la charte : un aplat, une bordure noire epaisse, une ombre
 * PLEINE decalee en bas a droite. Aucun flou, aucun arrondi.
 */
fun Modifier.brut(
    fill: Color,
    shadow: Color? = null,
    offset: Dp = 5.dp,
    border: Dp = 3.dp,
    line: Color = Color.Black,
): Modifier = this
    .drawBehind {
        if (shadow != null) {
            val o = offset.toPx()
            drawRect(shadow, topLeft = Offset(o, o), size = size)
        }
    }
    .background(fill)
    .border(border, line)

/** Le nom court d'un magasin, en capitales. */
fun shortStore(store: String?): String = when (store) {
    Stores.EPIC -> "EPIC"
    Stores.EPIC_MOBILE -> "EPIC MOBILE"
    Stores.GOG -> "GOG"
    Stores.STEAM -> "STEAM"
    Stores.AMAZON -> "AMAZON"
    null, Stores.UNKNOWN -> "?"
    else -> Stores.label(store).uppercase()
}

/** Le magasin : une etiquette noire, texte blanc. Plus de pastilles de couleur. */
@Composable
fun StoreChip(store: String?, modifier: Modifier = Modifier, onImage: Boolean = false) {
    Tag("[${shortStore(store)}]", Color.Black, Color.White, modifier)
}

/** Une etiquette rectangulaire. */
@Composable
fun Tag(text: String, fill: Color, ink: Color, modifier: Modifier = Modifier, bordered: Boolean = false, maxLines: Int = 1) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = ink,
        maxLines = maxLines,
        modifier = modifier
            .then(if (bordered) Modifier.brut(fill, border = 2.dp) else Modifier.background(fill))
            .padding(horizontal = 7.dp, vertical = 3.dp),
    )
}

/** Compatibilite : une petite etiquette de texte (DLC, note...). */
@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier, onImage: Boolean = false) {
    Tag(text.uppercase(), color, Color.Black, modifier, bordered = true)
}

/**
 * La jaquette, cernee de noir. Tant qu'elle n'est pas la : l'initiale, en
 * police d'affichage, sur blanc.
 */
@Composable
fun Cover(url: String?, title: String, store: String?, modifier: Modifier = Modifier, radius: Dp = 0.dp, letterSize: Int = 28) {
    Box(modifier.background(Color.White).border(3.dp, Color.Black).clipToBounds(), contentAlignment = Alignment.Center) {
        Text(title.trim().take(1).uppercase(), fontFamily = Display, fontSize = letterSize.sp, color = Color.Black)
        if (url != null) AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().padding(3.dp))
    }
}

/**
 * Le titre d'une section : une barre pleine de la couleur du texte, le
 * compte dans une case d'accent qui deborde a droite.
 */
@Composable
fun SectionHeader(title: String, count: Int?, open: Boolean? = null, onToggle: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    Row(
        modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp)
            .then(if (onToggle != null) Modifier.clickableNoRipple(onToggle) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "// " + title.uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = b.base,
            modifier = Modifier.weight(1f).background(b.ink).padding(horizontal = 10.dp, vertical = 7.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (count != null) {
            Text(
                count.toString().padStart(2, '0'),
                style = MaterialTheme.typography.labelLarge,
                color = b.onAccent,
                modifier = Modifier.brut(b.accent, border = 3.dp, line = b.ink).padding(horizontal = 9.dp, vertical = 4.dp),
            )
        }
        if (open != null) {
            Text(if (open) " [–]" else " [+]", style = MaterialTheme.typography.labelLarge, color = b.ink)
        }
    }
}

/** Un bandeau : aplat d'accent, bordure, ombre dure. */
@Composable
fun Notice(text: String, color: Color, modifier: Modifier = Modifier, inverted: Boolean = false, action: (@Composable () -> Unit)? = null) {
    val b = LocalBrut.current
    val fill = when {
        inverted -> b.ink
        b.dark -> Color.White
        else -> b.accent
    }
    val ink = if (inverted) b.base else Color.Black
    Column(modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(fill, shadow = if (inverted || b.dark) b.accent else b.shadow, line = if (inverted) b.ink else Color.Black).padding(14.dp)) {
        Text(text.uppercase(), style = MaterialTheme.typography.titleSmall, color = ink)
        if (action != null) Box(Modifier.padding(top = 10.dp)) { action() }
    }
}

/**
 * Le grand chiffre, decale : un bloc inverse qui laisse une marge a droite,
 * la valeur en police d'affichage, et le compte en etiquette de travers qui
 * deborde du bloc.
 */
@Composable
fun Hero(value: String?, count: Int, caption: String, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    Box(modifier.fillMaxWidth().padding(end = 36.dp, bottom = 14.dp)) {
        val fill = if (b.dark) b.accent else Color.Black
        val ink = if (b.dark) Color.Black else Color.White
        Column(
            Modifier.fillMaxWidth().brut(fill, shadow = if (b.dark) Color.White else b.accent, offset = 7.dp).padding(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 22.dp),
        ) {
            Text(caption.uppercase(), style = MaterialTheme.typography.labelSmall, color = ink)
            Text(value ?: "0", style = MaterialTheme.typography.displayMedium, color = if (b.dark) Color.Black else b.accent, maxLines = 1, modifier = Modifier.padding(top = 6.dp))
        }
        Text(
            pluralStringResource(R.plurals.games_count, count, count).uppercase(),
            style = MaterialTheme.typography.labelLarge,
            color = Color.Black,
            modifier = Modifier.align(Alignment.BottomEnd).offset(x = 26.dp, y = 10.dp).rotate(-5f)
                .brut(Color.White, shadow = Color.Black, offset = 3.dp).padding(horizontal = 10.dp, vertical = 5.dp),
        )
    }
}

/** Un bouton de la charte : rectangle, bordure, ombre dure. */
@Composable
fun BrutButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val b = LocalBrut.current
    val fill = when {
        !enabled -> Color(0xFFD6D6D6)
        primary -> b.accent
        else -> Color.White
    }
    Row(
        modifier.padding(end = 4.dp, bottom = 4.dp)
            .brut(fill, shadow = if (enabled) (if (b.dark) Color.White else Color.Black) else null, offset = 4.dp)
            .then(if (enabled) Modifier.clickableNoRipple(onClick) else Modifier)
            .padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = Color.Black, modifier = Modifier.size(18.dp))
        Text(text.uppercase(), style = MaterialTheme.typography.labelLarge, color = Color.Black, maxLines = 1)
    }
}

/** Un bouton carre a icone, pour la barre du haut. */
@Composable
fun SquareButton(icon: ImageVector, description: String, onClick: () -> Unit, enabled: Boolean = true) {
    val b = LocalBrut.current
    Box(
        Modifier.padding(end = 4.dp, bottom = 4.dp).size(42.dp)
            .brut(Color.White, shadow = if (b.dark) b.accent else Color.Black, offset = 4.dp)
            .then(if (enabled) Modifier.clickableNoRipple(onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, description, tint = if (enabled) Color.Black else Color(0xFF9A9A9A), modifier = Modifier.size(22.dp)) }
}

/** Le haut d'un ecran : un titre massif, a gauche, sur deux lignes au besoin. */
@Composable
fun TopBlock(title: String, modifier: Modifier = Modifier, actions: @Composable () -> Unit = {}) {
    val b = LocalBrut.current
    Row(modifier.fillMaxWidth().padding(start = 14.dp, end = 10.dp, top = 12.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
        Text(title.uppercase(), style = MaterialTheme.typography.displaySmall, color = b.ink, modifier = Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) { actions() }
    }
}

/** L'interrupteur de la charte : deux cases, OUI / NON, l'active en aplat. */
@Composable
fun BrutToggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    val b = LocalBrut.current
    Row(Modifier.padding(end = 3.dp, bottom = 3.dp).brut(Color.White, shadow = Color.Black, offset = 3.dp, border = 2.dp)) {
        listOf(true to "OUI", false to "NON").forEach { (v, label) ->
            val on = v == checked
            Text(
                label,
                style = MaterialTheme.typography.labelMedium,
                color = if (on) (if (v) b.onAccent else Color.White) else Color(0xFF8A8A8A),
                modifier = Modifier.background(if (on) (if (v) b.accent else Color.Black) else Color.White)
                    .clickableNoRipple { onChange(v) }.padding(horizontal = 9.dp, vertical = 6.dp),
            )
        }
    }
}

/** Un champ de saisie : un rectangle cerne, texte monospace. */
@Composable
fun BrutField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, onDone: (() -> Unit)? = null) {
    Box(modifier.padding(end = 4.dp, bottom = 4.dp).brut(Color.White, shadow = Color.Black, offset = 4.dp).padding(horizontal = 12.dp, vertical = 12.dp)) {
        if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = Color(0xFF8A8A8A))
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true,
            textStyle = TextStyle(fontFamily = Mono, fontSize = 14.sp, color = Color.Black),
            cursorBrush = SolidColor(Color.Black),
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone?.invoke() }),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
