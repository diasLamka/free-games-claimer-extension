package io.github.diaslamka.freegames.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Bargain
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.ui.theme.LocalBrut
import java.text.NumberFormat

/* « Piege ou bonne affaire ? » (1.22.0) : la lettre A-D et son libelle sur la
   carte ; un appui ouvre les raisons, une par ligne. Les libelles sont des
   ressources, que `Bargain.Reason.key` designe par le meme nom que l'extension. */

private val REASON_RES = mapOf(
    "bargainFreeForever" to R.string.bargain_free_forever,
    "bargainDemo" to R.string.bargain_demo,
    "bargainNotAGame" to R.string.bargain_not_a_game,
    "bargainRatedHigh" to R.string.bargain_rated_high,
    "bargainRatedGood" to R.string.bargain_rated_good,
    "bargainRatedMixed" to R.string.bargain_rated_mixed,
    "bargainRatedLow" to R.string.bargain_rated_low,
    "bargainFewReviews" to R.string.bargain_few_reviews,
    "bargainValueConfirmed" to R.string.bargain_value_confirmed,
    "bargainValueSmall" to R.string.bargain_value_small,
    "bargainValueUnconfirmed" to R.string.bargain_value_unconfirmed,
    "bargainInflated" to R.string.bargain_inflated,
    "bargainNeedsBase" to R.string.bargain_needs_base,
    "bargainNeedsBaseBare" to R.string.bargain_needs_base_bare,
    "bargainNeedsBaseUnknown" to R.string.bargain_needs_base_unknown,
    "bargainBaseOwned" to R.string.bargain_base_owned,
    "bargainExtra" to R.string.bargain_extra,
    "bargainNoData" to R.string.bargain_no_data,
)

/** Les arguments qui sont des montants (« 24.99 EUR ») ou des comptes (« 100000 »), par raison : mis en forme dans la langue. */
private val MONEY_ARGS = mapOf(
    "bargainValueConfirmed" to setOf(0), "bargainValueSmall" to setOf(0), "bargainValueUnconfirmed" to setOf(0), "bargainInflated" to setOf(0, 1),
)
private val COUNT_ARGS = mapOf(
    "bargainRatedHigh" to setOf(1), "bargainRatedGood" to setOf(1), "bargainRatedMixed" to setOf(1), "bargainRatedLow" to setOf(1), "bargainFewReviews" to setOf(0),
)
private val AMOUNT = Regex("^(\\d+(?:\\.\\d+)?)\\s*([A-Za-z?]*)$")

@Composable
fun reasonText(r: Bargain.Reason): String {
    val res = REASON_RES[r.key] ?: return r.key
    val args = r.args.mapIndexed { i, a ->
        when {
            MONEY_ARGS[r.key]?.contains(i) == true -> AMOUNT.matchEntire(a)?.let { m ->
                Money.format(m.groupValues[1].toDouble(), m.groupValues[2].takeIf { it.length == 3 })
            } ?: a
            COUNT_ARGS[r.key]?.contains(i) == true -> a.toLongOrNull()?.let { NumberFormat.getIntegerInstance().format(it) } ?: a
            else -> a
        }
    }
    return stringResource(res, *args.toTypedArray())
}

@Composable
fun gradeLabel(grade: String?): String = stringResource(
    when (grade) {
        "A" -> R.string.bargain_grade_a
        "B" -> R.string.bargain_grade_b
        "C" -> R.string.bargain_grade_c
        "D" -> R.string.bargain_grade_d
        else -> R.string.bargain_grade_none
    },
)

/** Vert / ambre / rouge pour A-B, C, D ; discret sans note. */
@Composable
private fun gradeFill(grade: String?): Color {
    val b = LocalBrut.current
    return when (grade) {
        "A", "B" -> b.accent
        "C" -> Color(0xFFFFB000)
        "D" -> Color(0xFFFF4D4D)
        else -> Color.White
    }
}

/** Une ligne sous le titre : la lettre dans un carre, son libelle ; un appui pour les raisons. */
@Composable
fun BargainRow(o: Offer, state: AppState, modifier: Modifier = Modifier) {
    if (!state.settings.steamRatings) return
    val v = remember(o, state.ratings, state.checks, state.owned) { Bargain.verdictFor(o, state) }
    var open by remember { mutableStateOf(false) }
    Row(
        modifier.clickable { open = true },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Tag(v.grade ?: "?", gradeFill(v.grade), Color.Black, bordered = true)
        Text(gradeLabel(v.grade), style = MaterialTheme.typography.bodySmall, color = Color.Black)
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text(stringResource(R.string.bargain_title) + " " + (v.grade ?: "?") + " — " + gradeLabel(v.grade)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (r in v.reasons) Text("• " + reasonText(r), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 2.dp))
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.close)) } },
        )
    }
}
