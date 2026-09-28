package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.TonightPick
import io.github.diaslamka.freegames.ui.theme.Display
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import io.github.diaslamka.freegames.widget.TonightWidget

/** Ce que la carte demande a l'appli ; rien par defaut (les apercus, les tests). */
data class TonightActions(
    val onKeep: (TonightPick) -> Unit = {},
    val onSettings: (time: String, deckOnly: Boolean, coop: Boolean) -> Unit = { _, _, _ -> },
    val onAnother: () -> Unit = {},
    val onPlaying: (Tonight.Scored) -> Unit = {},
    val onNotForMe: (Tonight.Scored) -> Unit = {},
)

/**
 * « Ce soir je joue a... » (1.8.0), en tete de l'onglet Recuperes : le temps
 * qu'on a, le Steam Deck, puis UN jeu, ses raisons et quatre gestes.
 */
@Composable
fun TonightCard(state: AppState, now: Long, actions: TonightActions, onOpen: (String) -> Unit) {
    val b = LocalBrut.current
    val context = LocalContext.current
    val p = state.tonight
    val pile = remember(state.owned, state.library, state.marks, state.tonightTitles) { Tonight.buildPile(state) }
    // Le tirage se fait une fois, puis il est retenu : une recomposition ne change pas le jeu.
    val (jeu, suivant) = remember(p, pile, state.tonightApps) { Tonight.current(state, now) }
    LaunchedEffect(suivant) { if (suivant != p) actions.onKeep(suivant) }
    val playing = Tonight.playing(p, now)

    Column(Modifier.fillMaxWidth().padding(top = 6.dp)) {
        SectionHeader(stringResource(R.string.tonight_title), pile.size.takeIf { it > 0 })
        if (pile.isEmpty() && !playing) {
            Text(stringResource(R.string.tonight_empty), style = MaterialTheme.typography.bodyMedium, color = b.ink, modifier = Modifier.padding(top = 6.dp))
            return@Column
        }
        Text(stringResource(R.string.tonight_hint), style = MaterialTheme.typography.bodySmall, color = b.mute, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in Tonight.TIMES) {
                val on = t == p.time
                Text(
                    stringResource(TonightWidget.timeLabel(t)).uppercase(),
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.Black,
                    maxLines = 1,
                    modifier = Modifier.padding(end = 3.dp, bottom = 3.dp)
                        .heightIn(min = 40.dp)
                        .brut(if (on) b.accent else Color.White, shadow = if (b.dark) Color.White else Color.Black, offset = 3.dp, border = 2.dp)
                        .semantics { selected = on }
                        .clickableNoRipple(role = Role.RadioButton) { actions.onSettings(t, p.deckOnly, p.coop) }
                        .padding(horizontal = 10.dp, vertical = 10.dp),
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp, bottom = 12.dp)) {
            Text(stringResource(R.string.tonight_deck), style = MaterialTheme.typography.bodyMedium, color = b.ink, modifier = Modifier.weight(1f))
            BrutToggle(p.deckOnly) { actions.onSettings(p.time, it, p.coop) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
            Text(stringResource(R.string.tonight_coop_only), style = MaterialTheme.typography.bodyMedium, color = b.ink, modifier = Modifier.weight(1f))
            BrutToggle(p.coop) { actions.onSettings(p.time, p.deckOnly, it) }
        }

        when {
            playing -> {
                Column(Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).brut(b.accent, shadow = if (b.dark) Color.White else Color.Black, offset = 6.dp).padding(14.dp)) {
                    Kicker()
                    Title(p.playingTitle.orEmpty())
                    Text(stringResource(R.string.tonight_started), style = MaterialTheme.typography.bodyMedium, color = Color.Black)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
                    p.playingPage?.let { page -> BrutButton(stringResource(R.string.tonight_open), { onOpen(page) }) }
                    BrutButton(stringResource(R.string.tonight_other), actions.onAnother, primary = false)
                }
            }
            jeu == null -> Text(stringResource(R.string.tonight_empty_filter), style = MaterialTheme.typography.bodyMedium, color = b.ink)
            else -> {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val large = maxWidth >= 520.dp
                    val carte = Modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp)
                        .brut(b.accent, shadow = if (b.dark) Color.White else Color.Black, offset = 6.dp).padding(14.dp)
                    if (large) {
                        Row(carte, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Cover(Tonight.image(jeu.c, jeu.info), jeu.c.title, jeu.c.stores.keys.firstOrNull(), Modifier.width(240.dp).aspectRatio(460f / 215f))
                            Column(Modifier.weight(1f)) { Body(jeu) }
                        }
                    } else {
                        Column(carte, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Cover(Tonight.image(jeu.c, jeu.info), jeu.c.title, jeu.c.stores.keys.firstOrNull(), Modifier.fillMaxWidth().aspectRatio(460f / 215f))
                            Column { Body(jeu) }
                        }
                    }
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(top = 10.dp),
                ) {
                    Tonight.page(jeu.c)?.let { page -> BrutButton(stringResource(R.string.tonight_open), { onOpen(page) }) }
                    BrutButton(stringResource(R.string.tonight_playing), { actions.onPlaying(jeu) }, primary = false)
                    BrutButton(stringResource(R.string.tonight_another), actions.onAnother, primary = false)
                    BrutButton(stringResource(R.string.tonight_not_for_me), { actions.onNotForMe(jeu) }, primary = false)
                }
                if (jeu.info == null && jeu.c.appid != null) {
                    Text(stringResource(R.string.tonight_reading), style = MaterialTheme.typography.bodySmall, color = b.mute, modifier = Modifier.padding(top = 6.dp))
                }
            }
        }
    }
}

@Composable
private fun Kicker() {
    Text(stringResource(R.string.tonight_kicker).uppercase(), style = MaterialTheme.typography.labelMedium, color = Color.Black)
}

@Composable
private fun Title(text: String) {
    Text(text.uppercase(), fontFamily = Display, fontSize = 24.sp, lineHeight = 26.sp, color = Color.Black, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(vertical = 2.dp))
}

@Composable
private fun Body(jeu: Tonight.Scored) {
    val context = LocalContext.current
    Kicker()
    Title(jeu.c.title)
    val magasins = listOf("steam", "gog", "epic", "amazon").filter { it in jeu.c.stores }.joinToString(" · ") { shortStore(it) }
    if (magasins.isNotEmpty()) Text(magasins, style = MaterialTheme.typography.labelSmall, color = Color.Black.copy(alpha = .75f))
    // Ce que le jeu est, en deux ou trois lignes : la description courte de sa fiche Steam.
    jeu.info?.description?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = Color.Black, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
    }
    val raisons = jeu.reasons.map { TonightWidget.reasonText(context, it) }.filter { it.isNotEmpty() }
    if (raisons.isNotEmpty()) {
        Column(Modifier.padding(top = 6.dp)) {
            for (r in raisons) Text("• $r", style = MaterialTheme.typography.bodySmall, color = Color.Black)
        }
    }
}
