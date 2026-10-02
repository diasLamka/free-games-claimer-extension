package io.github.diaslamka.freegames.data

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import java.time.ZoneId

/**
 * Les heures occupees de l'agenda du telephone (1.23.0), pour « Ta soiree choisit
 * le jeu ». On ne lit QUE : debut, fin, journee entiere, disponibilite, ta reponse.
 * Jamais un titre, un lieu, une description ni un participant, et rien n'est garde ni
 * envoye : seul le resultat (« libre de 20 h a 23 h 30 ») est enregistre.
 *
 * Ignores : les evenements « toute la journee » (anniversaires, jours feries), ceux
 * marques « disponible », et ceux que tu as refuses.
 */
object CalendarReader {
    fun granted(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED

    /** Les evenements occupes entre `from` et `to`. Vide, sans jeter, si la permission manque. */
    fun busy(context: Context, from: Long, to: Long): List<Evening.Busy> {
        if (!granted(context)) return emptyList()
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also {
            ContentUris.appendId(it, from)
            ContentUris.appendId(it, to)
        }.build()
        val projection = arrayOf(
            CalendarContract.Instances.BEGIN, CalendarContract.Instances.END, CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.AVAILABILITY, CalendarContract.Instances.SELF_ATTENDEE_STATUS,
        )
        val out = ArrayList<Evening.Busy>()
        try {
            context.contentResolver.query(uri, projection, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val allDay = c.getInt(2) == 1
                    val free = c.getInt(3) == CalendarContract.Instances.AVAILABILITY_FREE
                    val declined = c.getInt(4) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED
                    if (allDay || free || declined) continue
                    out += Evening.Busy(c.getLong(0), c.getLong(1))
                }
            }
        } catch (_: Exception) {
            // Un agenda qui ne repond pas ne casse rien : on ne sait simplement pas.
        }
        return out
    }

    /** Le creneau libre de ta soiree, d'apres l'agenda ; null si on ne peut pas le lire. */
    fun evening(context: Context, now: Long, zone: ZoneId = ZoneId.systemDefault()): io.github.diaslamka.freegames.model.EveningState? {
        if (!granted(context)) return null
        val w = Evening.window(now, zone)
        return Evening.free(now, zone, busy(context, w.from, w.to), busy(context, w.morningFrom, w.morningTo))
    }
}
