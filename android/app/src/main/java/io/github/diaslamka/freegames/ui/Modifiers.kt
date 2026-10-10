package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.constrainHeight

/**
 * Cliquable sans onde (la charte n'en a pas), mais avec son role pour les lecteurs d'ecran, et une cible d'au moins
 * 48 dp : un « ✕ » ou une pastille de 31 dp se touchait mal, et se ratait a la loupe.
 */
fun Modifier.clickableNoRipple(role: Role = Role.Button, onClick: () -> Unit): Modifier = composed {
    // Le clic AVANT la taille : toute la cible de 48 dp reagit au toucher, pas seulement le contenu centre.
    clickable(role = role, onClick = onClick)
        .minTouchTarget()
}

/**
 * Au moins 48 dp dans chaque sens, le contenu au centre : ce que `minimumInteractiveComponentSize` de Material 3 est
 * cense faire, mais sa taille depend d'une reglage de la vue que rien ne garantit ; ici la mise en page le dit.
 * Ce qui est avant ce modificateur (fond, bordure) entoure la cible entiere.
 */
fun Modifier.minTouchTarget(min: Dp = 48.dp): Modifier = layout { measurable, constraints ->
    val placeable = measurable.measure(constraints)
    val side = min.roundToPx()
    val width = constraints.constrainWidth(maxOf(placeable.width, side))
    val height = constraints.constrainHeight(maxOf(placeable.height, side))
    layout(width, height) { placeable.placeRelative((width - placeable.width) / 2, (height - placeable.height) / 2) }
}
