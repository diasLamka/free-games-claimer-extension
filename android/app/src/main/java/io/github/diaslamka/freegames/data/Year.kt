package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.LibraryEntry
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles
import java.util.Calendar
import java.util.TimeZone

/**
 * Ton annee en jeux gratuits (1.6.0) -- le meme bilan que watch/year.js dans
 * l'extension : ce qui a ete PRIS cette annee-la (par l'appli, par le PC, par
 * l'extension), sa valeur, les magasins, le mois record, les trois plus chers,
 * le mieux note. Pur : il compte, il ne dessine pas (ui/YearCard.kt dessine).
 */
object Year {
    private val ACQUIRED = setOf("claimed", "redeemed")
    private val UTC = TimeZone.getTimeZone("UTC")

    data class Top(val title: String, val worth: String)
    data class Rated(val title: String, val percent: Int)
    data class Recap(
        val year: Int,
        val count: Int,
        val value: Double?,
        val currency: String?,
        val stores: List<Pair<String, Int>>,
        /** « 2026-07 » et son nombre de jeux. */
        val bestMonth: Pair<String, Int>?,
        val top: List<Top>,
        val bestRated: Rated?,
        val byPc: Int,
    )

    private fun yearOf(ts: Long): Int = Calendar.getInstance(UTC).apply { timeInMillis = ts }.get(Calendar.YEAR)
    private fun monthOf(ts: Long): String = Calendar.getInstance(UTC).apply { timeInMillis = ts }
        .let { "%04d-%02d".format(it.get(Calendar.YEAR), it.get(Calendar.MONTH) + 1) }

    private fun counted(e: LibraryEntry) = e.ts != null && (e.status == null || e.status in ACQUIRED) && !e.title.isNullOrBlank()

    /** Les annees ou il y a quelque chose, de la plus recente a la plus ancienne. */
    fun years(s: AppState): List<Int> = s.library.values.filter(::counted).map { yearOf(it.ts!!) }.distinct().sortedDescending()

    fun recap(s: AppState, year: Int, preferredCurrency: String?): Recap {
        val games = s.library.values.filter { counted(it) && yearOf(it.ts!!) == year }
        val total = Money.total(games.map { it.worth }, preferredCurrency)
        val stores = games.groupingBy { it.store }.eachCount().toList().sortedByDescending { it.second }
        val month = games.groupingBy { monthOf(it.ts!!) }.eachCount().toList()
            .sortedWith(compareByDescending<Pair<String, Int>> { it.second }.thenBy { it.first }).firstOrNull()
        val top = games.mapNotNull { e -> Money.parse(e.worth)?.let { e to it.value } }
            .sortedByDescending { it.second }.take(3).map { (e, _) -> Top(e.title!!, e.worth!!) }
        val rated = games.mapNotNull { e ->
            val key = if (e.store == Stores.STEAM) "app:${e.id}" else "t:${Titles.normalise(e.title)}"
            val r = s.ratings[key] ?: s.ratings["t:${Titles.normalise(e.title)}"]
            if (r?.percent != null && (r.total ?: 0) >= 50) Triple(e.title!!, r.percent, r.total ?: 0) else null
        }.sortedWith(compareByDescending<Triple<String, Int, Int>> { it.second }.thenByDescending { it.third }).firstOrNull()
        return Recap(
            year = year,
            count = games.size,
            value = total?.first,
            currency = total?.second ?: preferredCurrency,
            stores = stores,
            bestMonth = month,
            top = top,
            bestRated = rated?.let { Rated(it.first, it.second) },
            byPc = games.count { it.via == "pc" },
        )
    }
}
