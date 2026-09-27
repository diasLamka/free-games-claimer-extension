package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.R
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Les dates et durees, dans la langue du telephone. */
object Fmt {
    private val zone: ZoneId get() = ZoneId.systemDefault()

    fun dateTime(ms: Long): String =
        DateTimeFormatter.ofPattern("EEE d MMM, HH:mm", Locale.getDefault()).format(Instant.ofEpochMilli(ms).atZone(zone))

    fun day(ms: Long): String =
        DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault()).format(Instant.ofEpochMilli(ms).atZone(zone))

    fun date(ms: Long): String =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.getDefault()).format(Instant.ofEpochMilli(ms).atZone(zone))

    /** « 26.09.26 » : court, et sans langue. */
    fun short(ms: Long): String = DateTimeFormatter.ofPattern("dd.MM.yy").format(Instant.ofEpochMilli(ms).atZone(zone))

    fun month(ms: Long): String = monthInText(ms).replaceFirstChar { it.titlecase(Locale.getDefault()) }

    /** Le mois au fil d'une phrase : « en mars 2026 » (la langue decide de la majuscule). */
    fun monthInText(ms: Long): String =
        DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault()).format(Instant.ofEpochMilli(ms).atZone(zone))

    /** « 3 j », « 5 h », « 12 min » : ce qu'il reste. */
    fun left(context: Context, until: Long, now: Long): String {
        val d = (until - now).coerceAtLeast(0)
        val min = d / 60_000
        return when {
            min < 60 -> context.getString(R.string.left_minutes, min.coerceAtLeast(1))
            min < 48 * 60 -> context.getString(R.string.left_hours, min / 60)
            else -> context.getString(R.string.left_days, min / (24 * 60))
        }
    }

    /** « il y a 12 min » */
    fun ago(context: Context, then: Long, now: Long): String {
        val min = ((now - then) / 60_000).coerceAtLeast(0)
        return when {
            min < 1 -> context.getString(R.string.ago_now)
            min < 60 -> context.getString(R.string.ago_minutes, min)
            min < 48 * 60 -> context.getString(R.string.ago_hours, min / 60)
            else -> context.getString(R.string.ago_days, min / (24 * 60))
        }
    }
}
