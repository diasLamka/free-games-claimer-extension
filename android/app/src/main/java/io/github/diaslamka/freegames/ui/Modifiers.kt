package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.semantics.Role

/** Cliquable sans onde (la charte n'en a pas), mais avec son role pour les lecteurs d'ecran. */
fun Modifier.clickableNoRipple(role: Role = Role.Button, onClick: () -> Unit): Modifier = composed {
    clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = role, onClick = onClick)
}
