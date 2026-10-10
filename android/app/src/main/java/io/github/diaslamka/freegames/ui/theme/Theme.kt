package io.github.diaslamka.freegames.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * Le theme standard de Material 3 (1.31.0) : les couleurs dynamiques d'Android 12 et plus (celles du fond d'ecran), une palette
 * de repli violette en dessous, la typographie du systeme, des angles arrondis. Fini la charte « brute » (aplats criards,
 * bordures noires, majuscules) : une appli qu'on lit et qu'on touche comme toutes les autres.
 */
@Immutable
data class Brut(
    val name: String,
    /** Le fond de l'ecran. */
    val base: Color,
    /** Le texte pose sur le fond. */
    val ink: Color,
    /** Les blocs (cartes). */
    val block: Color,
    val onBlock: Color,
    /** L'accent : le conteneur de la couleur principale. */
    val accent: Color,
    val onAccent: Color,
    val shadow: Color,
    val mute: Color,
    val dark: Boolean,
    /** Les couleurs de la charte, a portee de main des ecrans. */
    val scheme: ColorScheme,
) {
    val line: Color get() = scheme.outlineVariant
}

/** Conserve pour les tests de captures : il n'y a qu'un jeu de couleurs, celui du systeme ou le repli. */
enum class Accent(val label: String) {
    JAUNE("STANDARD"),
}

private val LightFallback = lightColorScheme(
    primary = Color(0xFF5849C2), onPrimary = Color.White,
    primaryContainer = Color(0xFFE4DFFF), onPrimaryContainer = Color(0xFF150068),
    secondary = Color(0xFF5F5C71), onSecondary = Color.White,
    secondaryContainer = Color(0xFFE4DFF9), onSecondaryContainer = Color(0xFF1B192C),
    tertiary = Color(0xFF7B4E7F), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFD6FB), onTertiaryContainer = Color(0xFF2F0A36),
    background = Color(0xFFFCF8FF), onBackground = Color(0xFF1C1B20),
    surface = Color(0xFFFCF8FF), onSurface = Color(0xFF1C1B20),
    surfaceVariant = Color(0xFFE5E1EC), onSurfaceVariant = Color(0xFF47464F),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF6F2FA),
    surfaceContainer = Color(0xFFF0ECF4), surfaceContainerHigh = Color(0xFFEAE6EE), surfaceContainerHighest = Color(0xFFE5E1E9),
    outline = Color(0xFF787680), outlineVariant = Color(0xFFC8C5D0),
    error = Color(0xFFBA1A1A), onError = Color.White, errorContainer = Color(0xFFFFDAD6), onErrorContainer = Color(0xFF410002),
    inverseSurface = Color(0xFF312F36), inverseOnSurface = Color(0xFFF3EFF7), inversePrimary = Color(0xFFC7BFFF),
)

private val DarkFallback = darkColorScheme(
    primary = Color(0xFFC7BFFF), onPrimary = Color(0xFF2A1A93),
    primaryContainer = Color(0xFF4030A9), onPrimaryContainer = Color(0xFFE4DFFF),
    secondary = Color(0xFFC8C3DC), onSecondary = Color(0xFF302E41),
    secondaryContainer = Color(0xFF474459), onSecondaryContainer = Color(0xFFE4DFF9),
    tertiary = Color(0xFFEBB2EE), onTertiary = Color(0xFF47204E),
    tertiaryContainer = Color(0xFF603666), onTertiaryContainer = Color(0xFFFFD6FB),
    background = Color(0xFF141318), onBackground = Color(0xFFE5E1E9),
    surface = Color(0xFF141318), onSurface = Color(0xFFE5E1E9),
    surfaceVariant = Color(0xFF47464F), onSurfaceVariant = Color(0xFFC8C5D0),
    surfaceContainerLowest = Color(0xFF0F0D13), surfaceContainerLow = Color(0xFF1C1B20),
    surfaceContainer = Color(0xFF201F25), surfaceContainerHigh = Color(0xFF2B292F), surfaceContainerHighest = Color(0xFF36343A),
    outline = Color(0xFF928F9A), outlineVariant = Color(0xFF47464F),
    error = Color(0xFFFFB4AB), onError = Color(0xFF690005), errorContainer = Color(0xFF93000A), onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFE5E1E9), inverseOnSurface = Color(0xFF312F36), inversePrimary = Color(0xFF5849C2),
)

fun brut(scheme: ColorScheme, dark: Boolean, name: String = "STANDARD") = Brut(
    name = name, base = scheme.background, ink = scheme.onBackground, block = scheme.surfaceContainerLow, onBlock = scheme.onSurface,
    accent = scheme.primaryContainer, onAccent = scheme.onPrimaryContainer, shadow = Color.Transparent,
    mute = scheme.onSurfaceVariant, dark = dark, scheme = scheme,
)

val LocalBrut = staticCompositionLocalOf { brut(DarkFallback, true) }

/** Les polices du systeme : les noms restent pour les anciens ecrans, la police est celle d'Android. */
val Mono: FontFamily = FontFamily.Default
val Display: FontFamily = FontFamily.Default

private val StandardShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun FreeGamesTheme(
    @Suppress("UNUSED_PARAMETER") accent: Accent = Accent.JAUNE,
    dark: Boolean = isSystemInDarkTheme(),
    dynamic: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val scheme = when {
        dynamic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> DarkFallback
        else -> LightFallback
    }
    CompositionLocalProvider(LocalBrut provides brut(scheme, dark)) {
        MaterialTheme(colorScheme = scheme, typography = Typography(), shapes = StandardShapes, content = content)
    }
}
