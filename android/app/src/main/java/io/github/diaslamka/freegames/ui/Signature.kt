package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.ui.theme.Display
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import io.github.diaslamka.freegames.ui.theme.Mono
import kotlinx.coroutines.delay

/*
 * La signature (1.3.0) : trois gestes qui n'appartiennent qu'a ce projet, les
 * memes que dans l'extension (pages/brut.css) --
 *   - le TICKET : la carte d'un jeu offert est un billet, poinconne sur les
 *     deux bords et perfore entre la jaquette et le reste, comme l'icone ;
 *   - le TAMPON « RECUPERE », de travers, sur ce qui a ete pris ;
 *   - le TIMECODE : la prochaine fin d'offre, en chiffres qui defilent.
 */

/**
 * Un billet : un rectangle poinconne a gauche et a droite, a la hauteur que
 * `notchY` calcule depuis la taille (la ligne de perforation).
 */
class TicketShape(private val radius: Dp, private val notchY: (Size, Density) -> Float) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val r = with(density) { radius.toPx() }
        val y = notchY(size, density).coerceIn(r, size.height - r)
        val p = Path().apply {
            moveTo(0f, 0f)
            lineTo(size.width, 0f)
            lineTo(size.width, y - r)
            arcTo(Rect(size.width - r, y - r, size.width + r, y + r), 270f, -180f, false)
            lineTo(size.width, size.height)
            lineTo(0f, size.height)
            lineTo(0f, y + r)
            arcTo(Rect(-r, y - r, r, y + r), 90f, -180f, false)
            close()
        }
        return Outline.Generic(p)
    }
}

/** Un billet 16:9 : la perforation sous la jaquette, qui occupe toute la largeur. */
fun coverTicket(radius: Dp = 9.dp) = TicketShape(radius) { size, density -> size.width * 9f / 16f + with(density) { 1.5.dp.toPx() } }

/**
 * Le bloc de la charte, en billet : l'ombre pleine a la forme du billet,
 * l'aplat et le contenu sont decoupes par ses poincons, la bordure les suit.
 */
fun Modifier.ticket(
    shape: Shape,
    fill: Color,
    shadow: Color?,
    offset: Dp = 6.dp,
    border: Dp = 3.dp,
): Modifier = this
    .drawBehind {
        if (shadow != null) {
            val o = offset.toPx()
            translate(o, o) { drawOutline(shape.createOutline(size, layoutDirection, this), shadow) }
        }
    }
    .clip(shape)
    .background(fill)
    .border(border, Color.Black, shape)

/** La perforation : des tirets noirs, entre les deux poincons. */
@Composable
fun Perforation(modifier: Modifier = Modifier, inset: Dp = 14.dp) {
    Canvas(modifier.fillMaxWidth().height(3.dp)) {
        val i = inset.toPx()
        drawLine(
            Color.Black, Offset(i, size.height / 2), Offset(size.width - i, size.height / 2),
            strokeWidth = size.height, pathEffect = PathEffect.dashPathEffect(floatArrayOf(9.dp.toPx(), 6.dp.toPx())),
        )
    }
}

/** Le tampon, de travers, double trait -- comme sur un billet composte. */
@Composable
fun Stamp(text: String, modifier: Modifier = Modifier, fill: Color = LocalBrut.current.accent, ink: Color = Color.Black, small: Boolean = false) {
    val base = MaterialTheme.typography.labelLarge
    Text(
        text.uppercase(),
        style = base.copy(fontFamily = Display, letterSpacing = if (small) 0.8.sp else 1.5.sp, fontSize = if (small) 9.sp else base.fontSize),
        color = ink,
        maxLines = 1,
        modifier = modifier.rotate(-8f)
            .background(fill)
            .border(if (small) 1.5.dp else 2.dp, ink)
            .padding(if (small) 2.dp else 3.dp)
            .border(if (small) 1.5.dp else 2.dp, ink)
            .padding(horizontal = if (small) 4.dp else 8.dp, vertical = if (small) 0.dp else 2.dp),
    )
}

/** « 18:32:07 », ou « 2J 23:59:59 » au-dela d'un jour. */
fun timecodeText(ms: Long, daysLabel: (Long) -> String): String {
    val s = (ms / 1000).coerceAtLeast(0)
    val d = s / 86_400
    val hms = listOf((s % 86_400) / 3600, (s % 3600) / 60, s % 60).joinToString(":") { it.toString().padStart(2, '0') }
    return if (d > 0) "${daysLabel(d)} $hms" else hms
}

/**
 * La prochaine fin d'offre, en chiffres qui defilent. Une bande noire, les
 * chiffres en jaune ; l'horloge ne vit que tant que la bande est a l'ecran.
 */
@Composable
fun Timecode(end: Long, title: String, label: String, daysLabel: (Long) -> String, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
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
    Row(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp)
            .drawBehind { translate(5.dp.toPx(), 5.dp.toPx()) { drawRect(b.accent) } }
            .background(Color.Black)
            .border(3.dp, if (b.dark) Color.White else Color.Black)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .semantics(mergeDescendants = true) { contentDescription = "$label $text — $title" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall.copy(fontFamily = Mono), color = Color.White, maxLines = 2)
        BasicText(
            text,
            style = MaterialTheme.typography.titleLarge.copy(fontFamily = Display, fontSize = 24.sp, color = b.accent),
            maxLines = 1,
            autoSize = TextAutoSize.StepBased(minFontSize = 12.sp, maxFontSize = 24.sp),
        )
        Text(title, style = MaterialTheme.typography.bodySmall, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
    }
}
