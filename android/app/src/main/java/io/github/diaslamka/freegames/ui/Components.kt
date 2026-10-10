package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.TextAutoSize
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
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.text.modifiers.TextAutoSizeLayoutScope
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.ui.theme.Display
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import io.github.diaslamka.freegames.ui.theme.Mono
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource

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

/** Une barre de progression a la charte : un cadre noir, un remplissage noir -- et un vrai controle pour TalkBack (1.29.0). */
@Composable
fun BrutProgress(percent: Int, modifier: Modifier = Modifier) {
    val p = percent.coerceIn(0, 100) / 100f
    Box(
        modifier.fillMaxWidth().height(16.dp).border(2.dp, Color.Black)
            .semantics { progressBarRangeInfo = androidx.compose.ui.semantics.ProgressBarRangeInfo(p, 0f..1f) },
    ) {
        Box(Modifier.fillMaxHeight().fillMaxWidth(p).background(Color.Black))
    }
}

/** Le nom court d'un magasin, en capitales. */
fun shortStore(store: String?): String = when (store) {
    Stores.EPIC -> "EPIC"
    Stores.EPIC_MOBILE -> "EPIC MOBILE"
    Stores.FAB -> "FAB"
    Stores.GOG -> "GOG"
    Stores.STEAM -> "STEAM"
    Stores.AMAZON -> "AMAZON"
    null, Stores.UNKNOWN -> "?"
    else -> Stores.label(store).uppercase()
}

/** Le logo d'un magasin (1.33.0), ou null : les icones de Simple Icons, en domaine public ; Amazon est Luna (Wikimedia Commons) ; Fab et les autres gardent leur nom. */
fun storeLogo(store: String?): Int? = when (store) {
    Stores.EPIC, Stores.EPIC_MOBILE -> R.drawable.logo_epic
    Stores.GOG -> R.drawable.logo_gog
    Stores.AMAZON -> R.drawable.logo_luna
    Stores.STEAM -> R.drawable.logo_steam
    Stores.HUMBLE -> R.drawable.logo_humble
    Stores.ITCHIO -> R.drawable.logo_itchio
    Stores.UBISOFT -> R.drawable.logo_ubisoft
    Stores.EA -> R.drawable.logo_ea
    Stores.BLIZZARD -> R.drawable.logo_blizzard
    Stores.LEGACY -> R.drawable.logo_legacy
    else -> null
}

/** Le magasin : son logo blanc sur noir -- avec son nom pour le lecteur d'ecran --, ou son nom en texte quand on n'a pas son logo. */
@Composable
fun StoreChip(store: String?, modifier: Modifier = Modifier, onImage: Boolean = false) {
    val logo = storeLogo(store)
    if (logo == null) {
        Tag("[${shortStore(store)}]", Color.Black, Color.White, modifier)
        return
    }
    val name = Stores.label(store)
    androidx.compose.foundation.layout.Box(modifier.background(Color.Black).padding(horizontal = 6.dp, vertical = 4.dp)) {
        Icon(
            androidx.compose.ui.res.painterResource(logo), name, tint = Color.White,
            modifier = Modifier.size(16.dp),
        )
    }
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
            .then(if (onToggle != null) Modifier.heightIn(min = 48.dp).clickableNoRipple(onClick = onToggle) else Modifier),
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
    // Le texte et son geste sur UNE ligne quand ils tiennent (1.32.0), le geste dessous sinon : un bandeau ne prend plus la place d'une carte.
    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    androidx.compose.foundation.layout.FlowRow(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(fill, shadow = if (inverted || b.dark) b.accent else b.shadow, line = if (inverted) b.ink else Color.Black).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text.uppercase(), style = MaterialTheme.typography.titleSmall, color = ink)
        if (action != null) Box { action() }
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
            // Taille ajustee : en grande police (accessibilite), le chiffre retrecit au lieu d'etre coupe.
            BasicText(
                value ?: "0",
                style = MaterialTheme.typography.displayMedium.copy(color = if (b.dark) Color.Black else b.accent),
                maxLines = 1,
                autoSize = TextAutoSize.StepBased(minFontSize = 18.sp, maxFontSize = MaterialTheme.typography.displayMedium.fontSize),
                modifier = Modifier.padding(top = 6.dp),
            )
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
            .heightIn(min = 48.dp)
            .brut(fill, shadow = if (enabled) (if (b.dark) Color.White else Color.Black) else null, offset = 4.dp)
            .then(if (enabled) Modifier.clickableNoRipple(onClick = onClick) else Modifier)
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
        Modifier.padding(end = 4.dp, bottom = 4.dp).size(48.dp)
            .brut(Color.White, shadow = if (b.dark) b.accent else Color.Black, offset = 4.dp)
            .then(if (enabled) Modifier.clickableNoRipple(onClick = onClick) else Modifier)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = if (enabled) Color.Black else Color(0xFF9A9A9A), modifier = Modifier.size(24.dp)) }
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

/** Le haut d'un ecran : un titre massif, a gauche, sur deux lignes au besoin. */
@Composable
fun TopBlock(title: String, modifier: Modifier = Modifier, actions: @Composable () -> Unit = {}) {
    val b = LocalBrut.current
    Row(modifier.fillMaxWidth().padding(start = 14.dp, end = 10.dp, top = 12.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
        val style = MaterialTheme.typography.displaySmall
        BasicText(
            title.uppercase(),
            style = style.copy(color = b.ink),
            maxLines = 2,
            autoSize = WholeWords(min = 20.sp, max = style.fontSize),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) { actions() }
    }
}

/** L'encre des textes secondaires sur blanc : l'option inactive d'un interrupteur, le texte d'un champ vide. */
internal val MutedInk = Color(0xFF595959)

/** L'interrupteur de la charte : deux cases, OUI / NON, l'active en aplat. */
@Composable
fun BrutToggle(checked: Boolean, onChange: (Boolean) -> Unit) {
    val b = LocalBrut.current
    Row(Modifier.padding(end = 3.dp, bottom = 3.dp).brut(Color.White, shadow = Color.Black, offset = 3.dp, border = 2.dp).selectableGroup()) {
        listOf(true to R.string.toggle_on, false to R.string.toggle_off).forEach { (v, name) ->
            val on = v == checked
            Text(
                stringResource(name),
                style = MaterialTheme.typography.labelMedium,
                color = if (on) (if (v) b.onAccent else Color.White) else MutedInk,
                modifier = Modifier.background(if (on) (if (v) b.accent else Color.Black) else Color.White)
                    // `selectable` : un lecteur d'ecran dit « selectionne » ; clickableNoRipple n'en disait rien.
                    .selectable(selected = on, interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.RadioButton) { onChange(v) }
                    .heightIn(min = 48.dp).wrapContentHeight().padding(horizontal = 12.dp, vertical = 6.dp),
            )
        }
    }
}

/** Un champ de saisie : un rectangle cerne, texte monospace. */
@Composable
fun BrutField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, onDone: (() -> Unit)? = null, secret: Boolean = false) {
    Box(modifier.padding(end = 4.dp, bottom = 4.dp).brut(Color.White, shadow = Color.Black, offset = 4.dp).padding(horizontal = 12.dp, vertical = 12.dp)) {
        if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyMedium, color = MutedInk)
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = true,
            textStyle = TextStyle(fontFamily = Mono, fontSize = 14.sp, color = Color.Black),
            cursorBrush = SolidColor(Color.Black),
            // Un secret : masque, sans correction ni suggestion (le clavier ne retient pas une phrase de passe).
            visualTransformation = if (secret) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                keyboardType = if (secret) androidx.compose.ui.text.input.KeyboardType.Password else androidx.compose.ui.text.input.KeyboardType.Text,
                autoCorrectEnabled = !secret,
            ),
            keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onDone?.invoke() }),
            modifier = Modifier.fillMaxWidth(),
        )
    }
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
