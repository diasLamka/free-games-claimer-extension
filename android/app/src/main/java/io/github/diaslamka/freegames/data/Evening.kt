package io.github.diaslamka.freegames.data

import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.EveningState
import io.github.diaslamka.freegames.model.PlayMedian
import io.github.diaslamka.freegames.sources.Fetcher
import io.github.diaslamka.freegames.sources.arr
import io.github.diaslamka.freegames.sources.get
import io.github.diaslamka.freegames.sources.num
import io.github.diaslamka.freegames.sources.parseJson
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * « Ta soiree choisit le jeu » (1.23.0).
 *
 * Deux choses, et seulement deux :
 *  1. le plus long creneau LIBRE de ta soiree d'apres ton agenda (uniquement les
 *     heures de debut et de fin des evenements, jamais leurs titres, et rien ne
 *     quitte le telephone) ;
 *  2. le temps que les joueurs passent typiquement sur un jeu -- la mediane du temps
 *     de jeu des auteurs des avis Steam recents. C'est une ESTIMATION : les auteurs
 *     d'avis jouent plus que la moyenne, d'ou le « ~ » partout.
 * Le jeu choisi est celui qui TIENT dans ton creneau. Sans agenda autorise, rien ne change.
 */
object Evening {
    data class Busy(val start: Long, val end: Long)

    const val START_H = 18
    private const val END_MIN = 23 * 60 + 30
    private const val EARLY_END_MIN = 22 * 60 + 30
    /** Un evenement qui commence avant cette heure, demain, veut dire qu'on se couche tot. */
    private const val EARLY_WAKE_MIN = 9 * 60
    /** Passe cette heure, c'est la soiree de demain qu'on prepare. */
    private const val TOMORROW_AFTER_H = 22
    /** En dessous, un trou entre deux evenements n'est pas une partie. */
    const val MIN_GAP = 30
    const val SHORT_EVENING = 90
    const val FRESH_MS = 3 * 3_600_000L

    /** Moins d'avis avec un temps de jeu que cela : pas de mediane. */
    const val MIN_SAMPLE = 30
    private const val DAY_MS = 24 * 3_600_000L
    const val MEDIAN_FRESH_MS = 60 * DAY_MS
    const val MEDIAN_NONE_MS = 7 * DAY_MS
    const val PER_RUN = 4

    /** La soiree visee : de 18 h a 23 h 30 aujourd'hui (demain s'il est 22 h passe), et le matin d'apres. */
    data class Window(val from: Long, val to: Long, val earlyTo: Long, val tomorrow: Boolean, val morningFrom: Long, val morningTo: Long)

    fun window(now: Long, zone: ZoneId): Window {
        val local = Instant.ofEpochMilli(now).atZone(zone)
        val tomorrow = local.hour >= TOMORROW_AFTER_H
        val day: LocalDate = local.toLocalDate().let { if (tomorrow) it.plusDays(1) else it }
        fun at(d: LocalDate, minutes: Int) = d.atTime(LocalTime.of(minutes / 60, minutes % 60)).atZone(zone).toInstant().toEpochMilli()
        val next = day.plusDays(1)
        return Window(
            from = at(day, START_H * 60), to = at(day, END_MIN), earlyTo = at(day, EARLY_END_MIN), tomorrow = tomorrow,
            morningFrom = at(next, 0), morningTo = at(next, 12 * 60),
        )
    }

    /** Un evenement demain avant 9 h : on se couche plus tot, la soiree s'arrete a 22 h 30. */
    private fun earlyWake(w: Window, morning: List<Busy>): Boolean {
        val limit = w.morningFrom + EARLY_WAKE_MIN * 60_000L
        return morning.any { it.start in w.morningFrom until limit }
    }

    private fun merged(busy: List<Busy>, from: Long, to: Long): List<Busy> {
        val clipped = busy.map { Busy(maxOf(it.start, from), minOf(it.end, to)) }.filter { it.end > it.start }.sortedBy { it.start }
        val out = ArrayList<Busy>()
        for (b in clipped) {
            val last = out.lastOrNull()
            if (last != null && b.start <= last.end) out[out.size - 1] = Busy(last.start, maxOf(last.end, b.end)) else out += b
        }
        return out
    }

    /** Le plus long creneau libre de la soiree (et 0 minute s'il n'y en a pas d'au moins `MIN_GAP`). */
    fun free(now: Long, zone: ZoneId, evening: List<Busy>, morning: List<Busy>): EveningState {
        val w = window(now, zone)
        val early = earlyWake(w, morning)
        val end = if (early) w.earlyTo else w.to
        val start = maxOf(now, w.from)
        var bestFrom = start
        var bestTo = start
        if (start < end) {
            var cursor = start
            val gaps = ArrayList<Busy>()
            for (b in merged(evening, start, end)) {
                if (b.start > cursor) gaps += Busy(cursor, b.start)
                cursor = maxOf(cursor, b.end)
            }
            if (cursor < end) gaps += Busy(cursor, end)
            val best = gaps.maxByOrNull { it.end - it.start }
            if (best != null && (best.end - best.start) / 60_000L >= MIN_GAP) { bestFrom = best.start; bestTo = best.end }
        }
        val minutes = ((bestTo - bestFrom) / 60_000L).toInt()
        return EveningState(at = now, minutes = minutes, from = bestFrom, to = bestTo, earlyWake = early, tomorrow = w.tomorrow)
    }

    /** Le temps dont on dispose, dans les mots de « Ce soir je joue a... ». */
    fun timeFor(minutes: Int): String = if (minutes < SHORT_EVENING) Tonight.HOUR else Tonight.EVENING

    /** Un creneau encore valable : lu il y a moins de trois heures. */
    fun fresh(e: EveningState?, now: Long): EveningState? = e?.takeIf { now - it.at in 0 until FRESH_MS }

    /** « 3 h 30 », « 45 min », « 2 h » : le meme texte dans toutes les langues. */
    fun durationText(minutes: Int): String {
        val m = minutes.coerceAtLeast(0)
        val h = m / 60
        val r = m % 60
        return when {
            h == 0 -> "$r min"
            r == 0 -> "$h h"
            else -> "$h h ${"%02d".format(r)}"
        }
    }

    // ------------------------------------------------------------- l'ajustement

    data class Fit(val bonus: Double, val key: String, val args: List<Any>)

    /**
     * Le jeu tient-il dans le creneau ? `median` : minutes que les joueurs y passent.
     *  - un jeu de 35 a 90 % du creneau y tient : le meilleur choix ;
     *  - bien plus court : une petite partie ;
     *  - a peu pres le creneau : correct ;
     *  - bien plus long : une premiere partie, pas la fin ;
     *  - plus de 4 h pour moins d'une heure et demie : on ecarte, c'est trop long.
     */
    fun fit(free: Int, median: Int): Fit {
        val shown = durationText(median)
        return when {
            free < SHORT_EVENING && median > 240 -> Fit(-1.5, "tonight_fit_long", listOf(shown))
            median <= free * 0.9 && median >= free * 0.35 -> Fit(2.5, "tonight_fit_tight", listOf(shown))
            median < free * 0.35 -> Fit(0.5, "tonight_fit_short", listOf(shown))
            median > free * 1.6 -> Fit(0.0, "tonight_fit_over", listOf(shown))
            else -> Fit(1.0, "tonight_fit_close", listOf(shown))
        }
    }

    /** L'ajustement d'un jeu pour ce creneau, ou null quand on ne sait pas. */
    fun fitFor(s: AppState, appid: String?, now: Long): Fit? {
        val e = fresh(s.evening, now) ?: return null
        val m = appid?.let { s.medians[it] }?.minutes ?: return null
        return fit(e.minutes, m)
    }

    // --------------------------------------------------------- les avis Steam

    fun url(appid: String) =
        "https://store.steampowered.com/appreviews/$appid?json=1&filter=recent&language=all&num_per_page=100&purchase_type=all&review_type=all"

    /** La mediane (en minutes) du temps de jeu des auteurs, ou `minutes = null` quand ils sont trop peu. null : illisible. */
    fun parseMedian(body: String, now: Long): PlayMedian? {
        val root = parseJson(body) ?: return null
        if (root["success"].num?.toInt() != 1) return null
        val reviews = root["reviews"].arr ?: return null
        val values = reviews.mapNotNull { r -> r["author"]["playtime_forever"].num?.toInt() }.filter { it > 0 }.sorted()
        if (values.size < MIN_SAMPLE) return PlayMedian(at = now, minutes = null, n = values.size)
        val mid = values.size / 2
        val median = if (values.size % 2 == 1) values[mid] else (values[mid - 1] + values[mid]) / 2
        return PlayMedian(at = now, minutes = median, n = values.size)
    }

    fun needs(m: PlayMedian?, now: Long): Boolean = m == null || now - m.at >= (if (m.minutes == null) MEDIAN_NONE_MS else MEDIAN_FRESH_MS)

    /** Les appids de la pile dont le temps de jeu manque, ceux « a essayer » d'abord. */
    fun pending(s: AppState, now: Long): List<String> =
        Tonight.buildPile(s).sortedByDescending { it.toTry }
            .mapNotNull { it.appid }.distinct()
            .filter { needs(s.medians[it], now) }
            .take(PER_RUN)

    /** Lit les avis de quelques jeux, un par seconde ou presque. Ne jette jamais. */
    suspend fun refresh(fetcher: Fetcher, appids: List<String>, now: Long): Map<String, PlayMedian> {
        val found = LinkedHashMap<String, PlayMedian>()
        var first = true
        for (id in appids.take(PER_RUN)) {
            if (!first) kotlinx.coroutines.delay(1_200)
            first = false
            val r = try { fetcher.get(url(id)) } catch (_: Exception) { continue }
            if (!r.ok) continue
            found[id] = parseMedian(r.body, now) ?: continue
        }
        return found
    }
}
