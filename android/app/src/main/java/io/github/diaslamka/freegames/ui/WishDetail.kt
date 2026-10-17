package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Odds
import io.github.diaslamka.freegames.data.Wish
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.PricePoint
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.model.WishInfo
import io.github.diaslamka.freegames.ui.theme.LocalBrut

/**
 * La fiche d'un souhait (1.42.0) : la jaquette en grand, le prix du jour, le plus bas jamais vu, ou l'acheter, la courbe des
 * prix que l'appli a releves, et ce qu'on sait de ses chances d'etre offert. Rien n'est invente : ce qui manque se dit.
 */
@Composable
fun WishDetail(
    title: String,
    info: WishInfo?,
    state: AppState,
    now: Long,
    freeStore: String?,
    odds: Odds.Estimate?,
    onOpen: (String) -> Unit,
    onDismiss: () -> Unit,
    onRemove: (() -> Unit)?,
) {
    val b = LocalBrut.current
    val money = LocalMoney.current
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(
            Modifier.padding(horizontal = 14.dp, vertical = 24.dp).fillMaxWidth().brut(Color.White, shadow = b.shadow, offset = 6.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Cover(info?.image, title, null, Modifier.fillMaxWidth().aspectRatio(16f / 9f), letterSize = 64, alt = info?.thumb)
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text((info?.name ?: Titles.display(title)).uppercase(), style = MaterialTheme.typography.titleLarge, color = Color.Black)
                if (freeStore != null) Tag(stringResource(R.string.wish_free_now, Stores.label(freeStore)).uppercase(), b.accent, b.onAccent)

                PriceLines(info, compact = false)
                info?.localPrice?.let { p ->
                    if (info.best != null) Text(stringResource(R.string.wl_steam_price, money.show(p, info.localCurrency)), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
                }
                info?.lowest?.let { low ->
                    Text(
                        stringResource(R.string.wl_lowest, money.show(low, "USD"), info.lowestAt?.let { Fmt.date(it) } ?: "?"),
                        style = MaterialTheme.typography.bodySmall, color = Color.Black,
                    )
                }

                // Ou l'acheter : les marchands, du moins cher au plus cher ; un toucher ouvre l'offre.
                if (info != null && info.deals.isNotEmpty()) {
                    Section(stringResource(R.string.wl_stores))
                    for (d in info.deals.take(6)) {
                        Row(
                            Modifier.fillMaxWidth().brut(if (d == info.deals.first()) b.accent else Color.White, border = 2.dp)
                                .then(if (d.dealId != null) Modifier.clickableNoRipple { onOpen(Wish.dealUrl(d.dealId)) } else Modifier)
                                .minTouchTarget().padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(Wish.storeName(d.store), style = MaterialTheme.typography.bodyMedium, color = Color.Black, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (d.savings > 0) Text(stringResource(R.string.wl_off, d.savings), style = MaterialTheme.typography.labelSmall, color = Color.Black)
                            Text(money.show(d.price, "USD"), style = MaterialTheme.typography.titleSmall, color = Color.Black)
                        }
                    }
                    Text(stringResource(R.string.wl_stores_note), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
                }

                // L'historique : les prix que l'appli a releves, et le plus bas jamais vu en repere.
                Section(stringResource(R.string.wl_history))
                val points = info?.history.orEmpty()
                if (points.size >= 2) {
                    PriceChart(points, info?.lowest)
                    Text(stringResource(R.string.wl_history_note, points.size, Fmt.date(points.first().at)), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))
                } else Text(stringResource(R.string.wl_history_empty), style = MaterialTheme.typography.bodySmall, color = Color(0xFF4A4A4A))

                // Deja offert gratuitement, et les chances qu'il le soit encore.
                val seen = state.passes[Titles.normalise(title)].orEmpty()
                if (seen.isNotEmpty() || (odds != null && odds.level != Odds.UNKNOWN)) {
                    Section(stringResource(R.string.wl_given))
                    odds?.let { OddsReasons(it); OddsBadge(it.level) }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                    info?.appid?.let { id -> BrutButton(stringResource(R.string.wl_open_steam), { onOpen("https://store.steampowered.com/app/$id/") }) }
                    onRemove?.let { BrutButton(stringResource(R.string.wish_remove), it) }
                    BrutButton(stringResource(R.string.close), onDismiss)
                }
            }
        }
    }
}

@Composable
private fun Section(label: String) {
    val b = LocalBrut.current
    Text(
        "// " + label.uppercase(), style = MaterialTheme.typography.labelLarge, color = b.base,
        modifier = Modifier.fillMaxWidth().background(b.ink).padding(horizontal = 10.dp, vertical = 5.dp),
    )
}

/**
 * La courbe des prix releves : une ligne, un point par releve, et en pointille le plus bas jamais vu quand il tient dans
 * l'echelle. Aucun axe invente : le plus haut et le plus bas sont ecrits.
 */
@Composable
fun PriceChart(points: List<PricePoint>, lowest: Double?, modifier: Modifier = Modifier) {
    val b = LocalBrut.current
    val money = LocalMoney.current
    val lo = minOf(points.minOf { it.price }, lowest ?: Double.MAX_VALUE)
    val hi = points.maxOf { it.price }
    val span = (hi - lo).takeIf { it > 0.0001 } ?: 1.0
    val t0 = points.first().at
    val dt = (points.last().at - t0).coerceAtLeast(1L).toDouble()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(money.show(hi, "USD"), style = MaterialTheme.typography.labelSmall, color = Color.Black)
        Canvas(Modifier.fillMaxWidth().height(90.dp).brut(Color.White, border = 2.dp).padding(8.dp)) {
            fun x(p: PricePoint) = ((p.at - t0) / dt * size.width).toFloat()
            fun y(v: Double) = (size.height - ((v - lo) / span * size.height)).toFloat()
            if (lowest != null) drawLine(
                Color.Black, Offset(0f, y(lowest)), Offset(size.width, y(lowest)), strokeWidth = 2f,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(10f, 10f)),
            )
            val color = Color.Black
            points.zipWithNext().forEach { (a, c) ->
                // Un palier : le prix tient jusqu'au releve suivant, puis change.
                drawLine(color, Offset(x(a), y(a.price)), Offset(x(c), y(a.price)), strokeWidth = 5f)
                drawLine(color, Offset(x(c), y(a.price)), Offset(x(c), y(c.price)), strokeWidth = 5f)
            }
            val last = points.last()
            drawCircle(b.accent, radius = 9f, center = Offset(x(last), y(last.price)))
            drawCircle(Color.Black, radius = 9f, center = Offset(x(last), y(last.price)), style = Stroke(width = 3f))
        }
        Text(money.show(lo, "USD"), style = MaterialTheme.typography.labelSmall, color = Color.Black)
    }
}
