package io.github.diaslamka.freegames.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Money
import io.github.diaslamka.freegames.data.Year
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import io.github.diaslamka.freegames.sources.Countries
import java.io.File
import java.text.DateFormatSymbols
import java.util.Locale

/** Les textes de l'image, dans la langue du telephone. */
fun yearTexts(context: Context, r: Year.Recap): YearCard.Texts {
    val res = context.resources
    val lines = buildList {
        r.bestMonth?.let { (m, n) ->
            val name = DateFormatSymbols(Locale.getDefault()).months.getOrNull(m.substringAfter('-').toInt() - 1).orEmpty()
            add(context.getString(R.string.year_best_month, name, n))
        }
        r.bestRated?.let { add(context.getString(R.string.year_best_rated, Titles.display(it.title), it.percent)) }
        if (r.byPc > 0) add(context.getString(R.string.year_by_pc, r.byPc))
    }
    return YearCard.Texts(
        kicker = "Free Games",
        title = context.getString(R.string.year_title, r.year),
        subtitle = context.getString(R.string.year_subtitle),
        valueLabel = context.getString(R.string.year_value),
        value = r.value?.let { Money.format(it, r.currency) } ?: "—",
        gamesStamp = res.getQuantityString(R.plurals.games_count, r.count, r.count),
        stores = r.stores.map { (s, n) -> "${shortStore(s)} $n" },
        topLabel = context.getString(R.string.year_top),
        top = r.top.map { Titles.display(it.title) to it.worth },
        lines = lines,
        footer = context.getString(R.string.year_footer),
        stamp = context.getString(R.string.status_claimed),
    )
}

/** Ecrit l'image dans le cache et ouvre le partage d'Android. */
fun shareYear(context: Context, bmp: Bitmap, year: Int) {
    val dir = File(context.cacheDir, "partage").apply { mkdirs() }
    val file = File(dir, "free-games-$year.png")
    file.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.partage", file)
    val send = Intent(Intent.ACTION_SEND).setType("image/png")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** « Mon annee en image » : l'apercu, le choix de l'annee, le partage. */
@Composable
fun YearDialog(state: AppState, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val years = remember(state.library) { Year.years(state) }
    var year by remember { mutableIntStateOf(years.firstOrNull() ?: 0) }
    val cur = Countries.of(state.settings.country).currency
    val recap = remember(state.library, state.ratings, year) { Year.recap(state, year, cur) }
    val bmp = remember(recap) { if (recap.count > 0) YearCard.draw(context, yearTexts(context, recap)) else null }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.year_button)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (years.size > 1) {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        years.forEach { y -> BrutButton(y.toString(), { year = y }, primary = y == year) }
                    }
                }
                if (bmp != null) {
                    Image(
                        bmp.asImageBitmap(), contentDescription = stringResource(R.string.year_title, year),
                        modifier = Modifier.fillMaxWidth().aspectRatio(YearCard.W / YearCard.H.toFloat()).border(3.dp, MaterialTheme.colorScheme.outlineVariant),
                    )
                } else {
                    Text(stringResource(R.string.year_empty), style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            if (bmp != null) TextButton(onClick = { shareYear(context, bmp, year) }) { Text(stringResource(R.string.year_share)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}
