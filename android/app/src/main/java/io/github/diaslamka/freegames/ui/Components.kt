package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.text.modifiers.TextAutoSizeLayoutScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import coil3.compose.AsyncImage
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/* ------------------------------------------------------------ la matiere */

/**
 * Une surface standard : un aplat arrondi, sans bordure ni ombre. Le nom vient de l'ancienne charte ; les ecrans qui l'utilisent
 * encore (blanc = « un bloc », noir = « l'inverse ») prennent les couleurs du theme.
 */
fun Modifier.brut(
    fill: Color,
    @Suppress("UNUSED_PARAMETER") shadow: Color? = null,
    @Suppress("UNUSED_PARAMETER") offset: Dp = 0.dp,
    @Suppress("UNUSED_PARAMETER") border: Dp = 0.dp,
    @Suppress("UNUSED_PARAMETER") line: Color = Color.Black,
): Modifier = composed {
    val b = LocalBrut.current
    val shown = when (fill) {
        Color.White -> b.block
        Color.Black -> b.scheme.inverseSurface
        else -> fill
    }
    clip(RoundedCornerShape(16.dp)).background(shown)
}

/** Une barre de progression standard, lisible par TalkBack comme un controle de progression. */
@Composable
fun BrutProgress(percent: Int, modifier: Modifier = Modifier) {
    val p = percent.coerceIn(0, 100) / 100f
    LinearProgressIndicator(
        progress = { p },
        modifier = modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp))
            .semantics { progressBarRangeInfo = androidx.compose.ui.semantics.ProgressBarRangeInfo(p, 0f..1f) },
    )
}

/** Le nom court d'un magasin. */
fun shortStore(store: String?): String = when (store) {
    Stores.EPIC -> "Epic"
    Stores.EPIC_MOBILE -> "Epic mobile"
    Stores.FAB -> "Fab"
    Stores.GOG -> "GOG"
    Stores.STEAM -> "Steam"
    Stores.AMAZON -> "Amazon"
    null, Stores.UNKNOWN -> "?"
    else -> Stores.label(store)
}

/** Le magasin : une petite etiquette sombre, lisible sur une jaquette comme sur une carte. */
@Composable
fun StoreChip(store: String?, modifier: Modifier = Modifier, @Suppress("UNUSED_PARAMETER") onImage: Boolean = false) {
    val b = LocalBrut.current
    Tag(shortStore(store), b.scheme.inverseSurface, b.scheme.inverseOnSurface, modifier)
}

/** Une etiquette arrondie. */
@Composable
fun Tag(text: String, fill: Color, ink: Color, modifier: Modifier = Modifier, @Suppress("UNUSED_PARAMETER") bordered: Boolean = false, maxLines: Int = 1) {
    val b = LocalBrut.current
    // Les anciens appels disent « blanc » ou « noir » : le fond suit le theme, et l'encre le contraste (clair sur sombre, sombre sur clair).
    val shown = when (fill) {
        Color.White -> b.scheme.surfaceContainerHighest
        Color.Black -> b.scheme.inverseSurface
        else -> fill
    }
    val shownInk = if (ink == Color.Black || ink == Color.White) (if (shown.luminance() > 0.5f) Color(0xFF1C1B20) else Color(0xFFF4F0F8)) else ink
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = shownInk,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier.clip(RoundedCornerShape(8.dp)).background(shown).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** Une petite etiquette de texte (DLC, note...), sur la couleur donnee. */
@Composable
fun Pill(text: String, color: Color, modifier: Modifier = Modifier, @Suppress("UNUSED_PARAMETER") onImage: Boolean = false) {
    Tag(text, color, Color.Black, modifier)
}

/** La jaquette, aux angles arrondis. Tant qu'elle n'est pas la : l'initiale du titre. */
@Composable
fun Cover(url: String?, title: String, @Suppress("UNUSED_PARAMETER") store: String?, modifier: Modifier = Modifier, radius: Dp = 12.dp, letterSize: Int = 28) {
    val b = LocalBrut.current
    Box(modifier.clip(RoundedCornerShape(radius)).background(b.scheme.surfaceContainerHighest), contentAlignment = Alignment.Center) {
        Text(title.trim().take(1).uppercase(), fontSize = letterSize.sp, color = b.scheme.onSurfaceVariant)
        if (url != null) AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

/**
 * Le titre d'une section : le nom, son compte, et -- quand la section se replie -- un chevron. Toute la ligne se touche
 * (48 dp au moins).
 */
@Composable
fun SectionHeader(title: String, count: Int?, open: Boolean? = null, onToggle: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    Row(
        modifier.fillMaxWidth().padding(top = 12.dp)
            .then(if (onToggle != null) Modifier.heightIn(min = 48.dp).clickableNoRipple(onClick = onToggle) else Modifier.heightIn(min = 40.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = b.ink,
            modifier = Modifier.weight(1f).semantics { heading() },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (count != null) {
            Text(
                count.toString(),
                style = MaterialTheme.typography.labelLarge,
                color = b.onAccent,
                modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(50)).background(b.accent).padding(horizontal = 10.dp, vertical = 2.dp),
            )
        }
        if (open != null) {
            Icon(if (open) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, null, tint = b.mute, modifier = Modifier.padding(start = 4.dp))
        }
    }
}

/** Un bandeau : une carte de la couleur principale -- ou, `inverted`, celle de l'erreur --, son texte et son geste. */
@Composable
fun Notice(text: String, @Suppress("UNUSED_PARAMETER") color: Color, modifier: Modifier = Modifier, inverted: Boolean = false, action: (@Composable () -> Unit)? = null) {
    val s = LocalBrut.current.scheme
    Card(
        modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (inverted) s.errorContainer else s.primaryContainer,
            contentColor = if (inverted) s.onErrorContainer else s.onPrimaryContainer,
        ),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(text, style = MaterialTheme.typography.bodyLarge)
            if (action != null) Box(Modifier.padding(top = 12.dp)) { action() }
        }
    }
}

/** Le grand chiffre de l'accueil : la valeur recuperee, et combien de jeux. */
@Composable
fun Hero(value: String?, count: Int, caption: String, modifier: Modifier = Modifier) {
    val s = LocalBrut.current.scheme
    Card(
        modifier.fillMaxWidth(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = s.primaryContainer, contentColor = s.onPrimaryContainer),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(caption, style = MaterialTheme.typography.labelLarge)
            // Taille ajustee : en grande police (accessibilite), le chiffre retrecit au lieu d'etre coupe.
            BasicText(
                value ?: "0",
                style = MaterialTheme.typography.displaySmall.copy(color = s.onPrimaryContainer),
                maxLines = 1,
                autoSize = TextAutoSize.StepBased(minFontSize = 18.sp, maxFontSize = MaterialTheme.typography.displaySmall.fontSize),
                modifier = Modifier.padding(top = 4.dp),
            )
            Text(pluralStringResource(R.plurals.games_count, count, count), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/** Un bouton standard : plein pour le geste principal, tonal pour les autres. */
@Composable
fun BrutButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    primary: Boolean = true,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit = {
        if (icon != null) Icon(icon, null, modifier = Modifier.size(18.dp))
        if (icon != null) androidx.compose.foundation.layout.Spacer(Modifier.size(8.dp))
        Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    if (primary) Button(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, content = content)
    else FilledTonalButton(onClick, modifier.heightIn(min = 48.dp), enabled = enabled, content = content)
}

/** Un bouton a icone, pour la barre du haut. */
@Composable
fun SquareButton(icon: ImageVector, description: String, onClick: () -> Unit, enabled: Boolean = true) {
    FilledTonalIconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp).semantics { contentDescription = description }) {
        Icon(icon, null, modifier = Modifier.size(24.dp))
    }
}

/**
 * Un titre qui retrecit plutot que de couper un mot en deux : la plus grande
 * taille, de `max` a `min`, ou chaque ligne finit a la fin d'un mot et ou le
 * tout tient dans les lignes permises. Si meme `min` ne suffit pas (un mot
 * immense, une police enorme), on garde `min` et le mot se coupe.
 */
data class WholeWords(val min: TextUnit, val max: TextUnit, val step: TextUnit = 1.sp) : TextAutoSize {
    override fun TextAutoSizeLayoutScope.getFontSize(constraints: Constraints, text: AnnotatedString): TextUnit {
        var v = max.value
        while (v > min.value) {
            val r = performLayout(constraints, text, v.sp)
            if (!r.hasVisualOverflow && entiers(r, text.text)) return v.sp
            v -= step.value
        }
        return min
    }

    private fun entiers(r: TextLayoutResult, s: String): Boolean = (0 until r.lineCount).all { i ->
        val end = r.getLineEnd(i)
        end >= s.length || s[end - 1].isWhitespace() || s[end - 1] == '-' || s[end].isWhitespace()
    }
}

/** Le haut d'un ecran : son titre, et ses gestes a droite. */
@Composable
fun TopBlock(title: String, modifier: Modifier = Modifier, actions: @Composable () -> Unit = {}) {
    val b = LocalBrut.current
    Row(modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        val style = MaterialTheme.typography.headlineMedium
        BasicText(
            title,
            style = style.copy(color = b.ink),
            maxLines = 2,
            autoSize = WholeWords(min = 20.sp, max = style.fontSize),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { actions() }
    }
}

/** L'encre des textes secondaires : l'option inactive d'un choix, le texte d'un champ vide. */
internal val MutedInk: Color get() = Color(0xFF595959)

/** L'interrupteur standard de Material 3, avec sa cible de 48 dp et son role pour les lecteurs d'ecran. */
@Composable
fun BrutToggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    Switch(
        checked = checked,
        onCheckedChange = onChange,
        modifier = Modifier.minTouchTarget(),
    )
}

/** Un champ de saisie standard : contour arrondi, texte du systeme. */
@Composable
fun BrutField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, onDone: (() -> Unit)? = null, secret: Boolean = false) {
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true,
        placeholder = { Text(placeholder) },
        shape = RoundedCornerShape(12.dp),
        // Un secret : masque, sans correction ni suggestion (le clavier ne retient pas une phrase de passe).
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
            imeAction = ImeAction.Done,
            keyboardType = if (secret) KeyboardType.Password else KeyboardType.Text,
            autoCorrectEnabled = !secret,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Une colonne a la largeur de lecture : pleine sur un telephone, centree et
 * bornee a 760 dp sur une tablette -- des lignes de 200 caracteres ne se
 * lisent pas, et des interrupteurs a l'autre bout de l'ecran non plus.
 */
@Composable
fun ReadableColumn(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    val b = LocalBrut.current
    Box(Modifier.fillMaxSize().background(b.base), contentAlignment = Alignment.TopCenter) {
        // La borne d'abord : remplir ensuite s'arrete a 760 dp.
        Column(Modifier.widthIn(max = 760.dp).fillMaxSize(), content = content)
    }
}
