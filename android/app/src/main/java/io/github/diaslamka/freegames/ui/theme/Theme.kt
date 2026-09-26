package io.github.diaslamka.freegames.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.model.Stores

/** Les couleurs du popup de l'extension (pages/popup.html), sombre et clair. */
@Immutable
data class Palette(
    val amber: Color,
    val jade: Color,
    val rose: Color,
    val mute: Color,
    val line: Color,
    val epic: Color,
    val gog: Color,
    val steam: Color,
    val amazon: Color,
) {
    fun store(store: String?): Color = when (store) {
        Stores.EPIC, Stores.EPIC_MOBILE -> epic
        Stores.GOG -> gog
        Stores.STEAM -> steam
        Stores.AMAZON -> amazon
        else -> mute
    }
}

private val DarkPalette = Palette(
    amber = Color(0xFFFFB454), jade = Color(0xFF56D6A0), rose = Color(0xFFFF6B81), mute = Color(0xFF9A90B8),
    line = Color(0xFF2E2745), epic = Color(0xFFE4DDF5), gog = Color(0xFFA567FF), steam = Color(0xFF66C0F4), amazon = Color(0xFF00C2FF),
)
private val LightPalette = Palette(
    amber = Color(0xFFB96A00), jade = Color(0xFF12805B), rose = Color(0xFFD62B47), mute = Color(0xFF6E6488),
    line = Color(0xFFDCD5EC), epic = Color(0xFF3D3459), gog = Color(0xFF7A32E0), steam = Color(0xFF1B7FB8), amazon = Color(0xFF0079A8),
)

val LocalPalette = staticCompositionLocalOf { DarkPalette }

private val Dark = darkColorScheme(
    primary = Color(0xFFFFB454), onPrimary = Color(0xFF241400),
    primaryContainer = Color(0xFF4A3212), onPrimaryContainer = Color(0xFFFFDDB3),
    secondary = Color(0xFF56D6A0), onSecondary = Color(0xFF00301F),
    secondaryContainer = Color(0xFF123B2C), onSecondaryContainer = Color(0xFFB6F2D6),
    tertiary = Color(0xFF66C0F4),
    background = Color(0xFF14101F), onBackground = Color(0xFFEDE9F5),
    surface = Color(0xFF14101F), onSurface = Color(0xFFEDE9F5),
    surfaceVariant = Color(0xFF262038), onSurfaceVariant = Color(0xFFB9B0D4),
    surfaceContainerLowest = Color(0xFF0E0A18), surfaceContainerLow = Color(0xFF1A1528),
    surfaceContainer = Color(0xFF1E1830), surfaceContainerHigh = Color(0xFF262038), surfaceContainerHighest = Color(0xFF2E2745),
    outline = Color(0xFF4A4166), outlineVariant = Color(0xFF2E2745),
    error = Color(0xFFFF6B81), onError = Color(0xFF3A0010),
)
private val Light = lightColorScheme(
    primary = Color(0xFFB96A00), onPrimary = Color.White,
    primaryContainer = Color(0xFFFFE2BF), onPrimaryContainer = Color(0xFF3A2100),
    secondary = Color(0xFF12805B), onSecondary = Color.White,
    secondaryContainer = Color(0xFFCDEFE0), onSecondaryContainer = Color(0xFF00301F),
    tertiary = Color(0xFF1B7FB8),
    background = Color(0xFFFBFAFE), onBackground = Color(0xFF1B1528),
    surface = Color(0xFFFBFAFE), onSurface = Color(0xFF1B1528),
    surfaceVariant = Color(0xFFE9E4F3), onSurfaceVariant = Color(0xFF4D4466),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF6F3FB),
    surfaceContainer = Color(0xFFF1EDF8), surfaceContainerHigh = Color(0xFFEBE6F4), surfaceContainerHighest = Color(0xFFE2DCEF),
    outline = Color(0xFF8C82A8), outlineVariant = Color(0xFFDCD5EC),
    error = Color(0xFFD62B47), onError = Color.White,
)

private val base = Typography()
private val AppTypography = base.copy(
    headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
    headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.SemiBold),
    titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
    titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.6.sp),
)

@Composable
fun FreeGamesTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    androidx.compose.runtime.CompositionLocalProvider(LocalPalette provides if (dark) DarkPalette else LightPalette) {
        MaterialTheme(colorScheme = if (dark) Dark else Light, typography = AppTypography, content = content)
    }
}
