package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.ViewAgenda
import androidx.compose.material.icons.rounded.ViewList
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Ratings
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Taste
import io.github.diaslamka.freegames.data.Verdicts
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Tiles
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import androidx.compose.foundation.layout.heightIn

/*
 * Les trois facons de poser un jeu sur l'accueil (1.25.0) : de grandes tuiles, une liste, une grille.
 *
 * Aucune n'a de bouton « Recuperer » : l'appli recupere toute seule, et « Tout recuperer » du haut de
 * l'ecran reste le seul geste. Toucher une tuile ouvre la page du magasin.
 */

/** Ce que l'accueil sait d'une offre, calcule une fois pour les trois facons de la montrer. */
private class Look(val o: Offer, state: AppState, now: Long) {
    val claimed = Rules.claimedEntry(o, state.library)
    val owned = Rules.ownedOnSteam(o, state)
    val wished = Rules.wished(o, state)
    val attempt = state.attempts[o.key]
    val rating = state.ratings[Ratings.key(o)]
    val urgent = o.end != null && o.end - now < 24 * 3_600_000L
    val secondChance = Rules.secondChance(o, state, now) != null
    val forYou = Taste.matchFor(state, Taste.appidOf(o, state)) != null

    /** Le tampon : pris, deja a toi, ou l'issue du dernier essai. */
    val stamp: StampKind? = when {
        claimed != null -> stampKindOf(claimed.status) ?: StampKind.CLAIMED
        owned -> StampKind.OWNED
        attempt?.verdict != null -> stampKindOf(attempt.verdict)
        else -> null
    }
    val url: String? = o.url ?: o.resolveUrl
}

/** Toucher la tuile ouvre le magasin, quand on sait ou. */
private fun Modifier.opens(url: String?, onOpen: (String) -> Unit): Modifier =
    if (url != null) clickableNoRipple(Role.Button) { onOpen(url) } else this

@Composable
private fun TimeLeft(o: Offer, now: Long, urgent: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val b = LocalBrut.current
    Text(
        if (o.end != null) Fmt.left(context, o.end, now).uppercase() else "∞",
        style = MaterialTheme.typography.labelLarge,
        color = if (urgent) b.accent else Color.White,
        maxLines = 1,
        modifier = modifier.background(Color.Black).padding(horizontal = 8.dp, vertical = 4.dp),
    )
}

/** Les etiquettes posees sur la jaquette : le magasin, DLC, souhait, deuxieme chance, tes gouts. */
@Composable
private fun CoverTags(l: Look, compact: Boolean = false) {
    val b = LocalBrut.current
    Row(Modifier.padding(3.dp), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        StoreChip(l.o.store)
        if (l.o.isExtra) Tag("DLC", Color.White, Color.Black)
        if (l.wished) Tag(if (compact) "★" else "★ " + stringResource(R.string.wished).uppercase(), b.accent, b.onAccent)
        if (!compact) {
            // Deuxieme chance (1.12.0) : deja vu passer, jamais eu.
            if (l.secondChance) Tag(stringResource(R.string.tag_second_chance).uppercase(), Color.White, Color.Black, bordered = true)
            // Tes gouts (1.14.0) : une offre qui ressemble a ce que tu aimes.
            if (l.forYou) Tag(stringResource(R.string.tag_for_you).uppercase(), Color.Black, b.accent)
        }
    }
}

/* ------------------------------------------------------------- grandes tuiles */

/** La grande tuile : la jaquette en 16/9, le titre, la valeur et le temps qui reste. Un toucher ouvre le magasin. */
@Composable
fun OfferCard(o: Offer, state: AppState, now: Long, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val l = Look(o, state, now)

    Column(modifier.fillMaxWidth().padding(end = 6.dp, bottom = 6.dp).ticket(coverTicket(), Color.White, b.shadow, 6.dp).opens(l.url, onOpen)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            Cover(o.image, o.shownTitle, o.store, Modifier.fillMaxSize(), letterSize = 64)
            CoverTags(l)
            if (l.rating?.percent != null) {
                Text(
                    stringResource(R.string.rating_short, l.rating.percent).uppercase(),
                    style = MaterialTheme.typography.labelLarge, color = Color.Black,
                    modifier = Modifier.align(Alignment.TopEnd).padding(top = 12.dp, end = 10.dp).rotate(4f)
                        .brut(if (Ratings.tone(l.rating) == "good") b.accent else Color.White, shadow = Color.Black, offset = 3.dp)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            l.stamp?.let { KindStamp(it, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 16.dp)) }
        }
        Perforation()
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(o.shownTitle.uppercase(), style = MaterialTheme.typography.titleLarge, color = Color.Black, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                if (l.url != null) Text(" ↗", style = MaterialTheme.typography.titleLarge, color = Color.Black)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LocalMoney.current.worth(o.worth)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.Black, textDecoration = TextDecoration.LineThrough) }
                Tag(stringResource(R.string.free).uppercase(), b.accent, b.onAccent, bordered = true)
                Spacer(Modifier.weight(1f))
                TimeLeft(o, now, l.urgent)
            }
            if (o.end != null) {
                Text("> " + stringResource(R.string.until, Fmt.dateTime(o.end)), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            }
            // Piege ou bonne affaire ? (1.22.0) : rien a juger sur un jeu qu'on a deja.
            if (l.claimed == null && !l.owned) BargainRow(o, state)
            if (l.claimed?.ts != null) {
                Text("> " + stringResource(R.string.claimed_on, Fmt.date(l.claimed.ts)), style = MaterialTheme.typography.bodySmall, color = Color.Black)
            } else if (l.attempt?.verdict != null && l.attempt.verdict !in Verdicts.ACQUIRED) {
                Text("! " + verdictText(l.attempt.verdict, l.attempt.details), style = MaterialTheme.typography.bodySmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/* --------------------------------------------------------------------- grille */

/** La tuile de la grille : la jaquette, le titre sur deux lignes, le temps qui reste. Beaucoup de jeux d'un coup d'oeil. */
@Composable
fun OfferTile(o: Offer, state: AppState, now: Long, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    val l = Look(o, state, now)
    Column(modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).opens(l.url, onOpen)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
            Cover(o.image, o.shownTitle, o.store, Modifier.fillMaxSize(), letterSize = 40)
            CoverTags(l, compact = true)
            l.stamp?.let { KindStamp(it, Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = 8.dp), small = true) }
        }
        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(o.shownTitle.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.heightIn(min = 40.dp))
            TimeLeft(o, now, l.urgent)
        }
    }
}

/* ---------------------------------------------------------------------- liste */

/** La ligne de la liste : une petite jaquette, le titre, la valeur et le temps qui reste. Le plus compact. */
@Composable
fun OfferRow(o: Offer, state: AppState, now: Long, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val b = LocalBrut.current
    val l = Look(o, state, now)
    Row(
        modifier.fillMaxWidth().padding(end = 5.dp, bottom = 5.dp).brut(Color.White, shadow = b.shadow, offset = 5.dp).padding(8.dp).opens(l.url, onOpen),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Cover(o.image, o.shownTitle, o.store, Modifier.width(96.dp).height(54.dp), letterSize = 20)
            l.stamp?.let { KindStamp(it, Modifier.align(Alignment.BottomEnd).padding(end = 3.dp, bottom = 3.dp), small = true) }
        }
        Column(Modifier.weight(1f).padding(horizontal = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(o.shownTitle.uppercase(), style = MaterialTheme.typography.titleSmall, color = Color.Black, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                StoreChip(o.store)
                if (l.wished) Tag("★", b.accent, b.onAccent)
                LocalMoney.current.worth(o.worth)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Color.Black, textDecoration = TextDecoration.LineThrough, maxLines = 1) }
            }
            if (l.attempt?.verdict != null && l.claimed == null && l.attempt.verdict !in Verdicts.ACQUIRED) {
                Text("! " + verdictText(l.attempt.verdict, l.attempt.details), style = MaterialTheme.typography.bodySmall, color = Color.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        TimeLeft(o, now, l.urgent)
    }
}

/* ---------------------------------------------------------------- le choix */

/** Trois pastilles : comment poser les jeux. L'active est pleine ; un toucher change, et c'est retenu. */
@Composable
fun TilePicker(selected: String, onPick: (String) -> Unit, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Tiles.ALL.forEach { t ->
            val on = t == selected
            val (icon, label) = tileLook(t)
            Box(
                Modifier.padding(end = 3.dp, bottom = 3.dp).size(40.dp)
                    .brut(if (on) b.ink else Color.White, shadow = if (on) null else (if (b.dark) b.accent else Color.Black), offset = 3.dp, border = 2.dp)
                    .clickableNoRipple(Role.RadioButton) { onPick(t) }
                    .semantics { contentDescription = label; this.selected = on },
                contentAlignment = Alignment.Center,
            ) { Icon(icon, null, tint = if (on) b.base else Color.Black, modifier = Modifier.size(22.dp)) }
        }
    }
}

@Composable
private fun tileLook(t: String): Pair<ImageVector, String> = when (t) {
    Tiles.LIST -> Icons.Rounded.ViewList to stringResource(R.string.tiles_list)
    Tiles.GRID -> Icons.Rounded.GridView to stringResource(R.string.tiles_grid)
    else -> Icons.Rounded.ViewAgenda to stringResource(R.string.tiles_cards)
}
