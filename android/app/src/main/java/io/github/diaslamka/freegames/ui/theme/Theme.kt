package io.github.diaslamka.freegames.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.R

/**
 * La charte brute : un fond uni (blanc pur ou noir profond), UNE couleur
 * criarde, des bordures noires epaisses, des ombres pleines et decalees, des
 * angles droits. Pas de degrade, pas de flou, pas de pastel.
 */
@Immutable
data class Brut(
    val name: String,
    /** Le fond de l'ecran. */
    val base: Color,
    /** Le texte pose sur le fond. */
    val ink: Color,
    /** Les blocs (cartes) : toujours clairs, toujours cernes de noir. */
    val block: Color,
    val onBlock: Color,
    /** La seule couleur d'accent. */
    val accent: Color,
    val onAccent: Color,
    /** L'ombre dure : noire sur fond blanc, accent sur fond noir. */
    val shadow: Color,
    val mute: Color,
    val dark: Boolean,
) {
    val line: Color get() = Color.Black
    val border = 3.dp
    val offset = 5.dp
}

val JAUNE_CYBER = Color(0xFFE8FF00)
val VERT_FLUO = Color(0xFF39FF14)
val FUCHSIA = Color(0xFFFF1FCE)

fun brut(accent: Color, dark: Boolean, name: String) = if (dark) Brut(
    name = name, base = Color.Black, ink = Color.White, block = Color.White, onBlock = Color.Black,
    accent = accent, onAccent = Color.Black, shadow = accent, mute = Color(0xFF9A9A9A), dark = true,
) else Brut(
    name = name, base = Color.White, ink = Color.Black, block = Color.White, onBlock = Color.Black,
    accent = accent, onAccent = Color.Black, shadow = Color.Black, mute = Color(0xFF5C5C5C), dark = false,
)

/** Les trois accents proposes. Le fond suit le telephone (clair ou sombre). */
enum class Accent(val color: Color, val label: String) {
    JAUNE(JAUNE_CYBER, "JAUNE CYBER"),
    VERT(VERT_FLUO, "VERT FLUO"),
    FUCHSIA_(FUCHSIA, "FUCHSIA"),
}

val LocalBrut = staticCompositionLocalOf { brut(JAUNE_CYBER, true, "JAUNE CYBER") }

val Mono = FontFamily(
    Font(R.font.space_mono_regular, FontWeight.Normal),
    Font(R.font.space_mono_bold, FontWeight.Bold),
)
val Display = FontFamily(Font(R.font.archivo_black, FontWeight.Black))

private fun mono(size: Int, weight: FontWeight = FontWeight.Normal, spacing: Double = 0.0) =
    TextStyle(fontFamily = Mono, fontSize = size.sp, fontWeight = weight, letterSpacing = spacing.sp, lineHeight = (size * 1.35).sp)

private fun display(size: Int) =
    TextStyle(fontFamily = Display, fontSize = size.sp, fontWeight = FontWeight.Black, lineHeight = (size * 0.98).sp, letterSpacing = (-0.5).sp)

private val BrutTypography = Typography(
    displayLarge = display(64),
    displayMedium = display(48),
    displaySmall = display(38),
    headlineLarge = display(34),
    headlineMedium = display(28),
    headlineSmall = display(24),
    titleLarge = display(22),
    titleMedium = display(19),
    titleSmall = mono(15, FontWeight.Bold),
    bodyLarge = mono(16),
    bodyMedium = mono(14),
    bodySmall = mono(12),
    labelLarge = mono(14, FontWeight.Bold, 0.5),
    labelMedium = mono(12, FontWeight.Bold, 0.8),
    labelSmall = mono(11, FontWeight.Bold, 1.0),
)

@Composable
fun FreeGamesTheme(accent: Accent = Accent.JAUNE, dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val b = brut(accent.color, dark, accent.label)
    val scheme = if (dark) darkColorScheme(
        primary = b.accent, onPrimary = b.onAccent, background = b.base, onBackground = b.ink,
        surface = b.base, onSurface = b.ink, surfaceVariant = Color(0xFF1A1A1A), onSurfaceVariant = b.mute,
        outline = Color.White, secondary = b.accent, onSecondary = b.onAccent,
    ) else lightColorScheme(
        primary = Color.Black, onPrimary = Color.White, background = b.base, onBackground = b.ink,
        surface = b.base, onSurface = b.ink, surfaceVariant = Color(0xFFF0F0F0), onSurfaceVariant = b.mute,
        outline = Color.Black, secondary = b.accent, onSecondary = b.onAccent,
    )
    CompositionLocalProvider(LocalBrut provides b) {
        MaterialTheme(colorScheme = scheme, typography = BrutTypography, content = content)
    }
}
