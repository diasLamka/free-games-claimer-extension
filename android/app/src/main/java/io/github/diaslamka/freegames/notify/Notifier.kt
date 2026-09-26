package io.github.diaslamka.freegames.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.diaslamka.freegames.MainActivity
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Titles

/**
 * Les notifications : un jeu par notification, avec sa jaquette, comme
 * l'extension depuis la 2.63.0 -- et le bouton « Recuperer » quand l'appli
 * sait le prendre.
 */
object Notifier {
    const val CH_NEW = "nouveaux"
    const val CH_ENDING = "fins"
    const val CH_CLAIMS = "recuperations"
    const val CH_ACCOUNT = "comptes"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_NEW, context.getString(R.string.channel_new), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_ENDING, context.getString(R.string.channel_ending), NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CH_CLAIMS, context.getString(R.string.channel_claims), NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CH_ACCOUNT, context.getString(R.string.channel_account), NotificationManager.IMPORTANCE_DEFAULT),
            ),
        )
    }

    fun allowed(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    private fun openApp(context: Context, code: Int, claimKey: String? = null, tab: Int = 0): PendingIntent {
        val i = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_TAB, tab)
        if (claimKey != null) i.putExtra(MainActivity.EXTRA_CLAIM, claimKey).setAction("claim:$claimKey")
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    private fun openUrl(context: Context, code: Int, url: String): PendingIntent =
        PendingIntent.getActivity(
            context, code, Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private suspend fun cover(url: String?): Bitmap? {
        if (url == null) return null
        val bytes = Graph.http.bytes(url) ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= 720) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun post(context: Context, id: Int, n: android.app.Notification) {
        if (!allowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (_: SecurityException) {
        }
    }

    private fun details(context: Context, o: Offer, now: Long): String {
        val parts = mutableListOf<String>()
        parts += if (o.end != null) context.getString(R.string.notif_until, Fmt.dateTime(o.end), Fmt.left(context, o.end, now))
        else context.getString(R.string.notif_no_end)
        o.worth?.let { parts += context.getString(R.string.notif_worth, it) }
        return parts.joinToString(" · ")
    }

    suspend fun newGame(context: Context, o: Offer, s: AppState) {
        val now = System.currentTimeMillis()
        val wished = Rules.wished(o, s)
        val title = if (wished) context.getString(R.string.notif_wished_title, o.shownTitle)
        else context.getString(R.string.notif_new_title, o.shownTitle, Stores.label(o.store))
        val id = o.key.hashCode()
        val b = NotificationCompat.Builder(context, CH_NEW)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(title)
            .setContentText(details(context, o, now))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id))
            .setPriority(if (wished) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        cover(o.image)?.let { b.setLargeIcon(it).setStyle(NotificationCompat.BigPictureStyle().bigPicture(it).bigLargeIcon(null as Bitmap?)) }
        if (Rules.claimable(o, s.settings)) b.addAction(0, context.getString(R.string.action_claim), openApp(context, id + 1, claimKey = o.key))
        Titles.webUrl(o.url ?: o.resolveUrl)?.let { b.addAction(0, context.getString(R.string.action_open), openUrl(context, id + 2, it)) }
        post(context, id, b.build())
    }

    fun summary(context: Context, offers: List<Offer>, s: AppState) {
        val style = NotificationCompat.InboxStyle()
        offers.take(7).forEach { style.addLine("${it.shownTitle} — ${Stores.label(it.store)}") }
        if (offers.size > 7) style.setSummaryText("+${offers.size - 7}")
        val title = context.resources.getQuantityString(R.plurals.notif_summary_title, offers.size, offers.size)
        val b = NotificationCompat.Builder(context, CH_NEW)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(title)
            .setContentText(offers.take(3).joinToString(", ") { it.shownTitle })
            .setStyle(style)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 1001))
        if (offers.any { Rules.claimable(it, s.settings) }) b.addAction(0, context.getString(R.string.action_claim_all), openApp(context, 1002, claimKey = "*"))
        post(context, 1000, b.build())
    }

    suspend fun ending(context: Context, o: Offer, s: AppState) {
        val now = System.currentTimeMillis()
        val id = ("fin:" + o.key).hashCode()
        val b = NotificationCompat.Builder(context, CH_ENDING)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_ending_title, o.shownTitle))
            .setContentText(context.getString(R.string.notif_ending_text, Stores.label(o.store), Fmt.left(context, o.end ?: now, now)))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id))
        cover(o.image)?.let { b.setLargeIcon(it) }
        if (Rules.claimable(o, s.settings)) b.addAction(0, context.getString(R.string.action_claim), openApp(context, id + 1, claimKey = o.key))
        Titles.webUrl(o.url ?: o.resolveUrl)?.let { b.addAction(0, context.getString(R.string.action_open), openUrl(context, id + 2, it)) }
        post(context, id, b.build())
    }

    fun claimed(context: Context, titles: List<String>) {
        if (titles.isEmpty()) return
        val b = NotificationCompat.Builder(context, CH_CLAIMS)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.resources.getQuantityString(R.plurals.notif_claimed_title, titles.size, titles.size))
            .setContentText(titles.joinToString(", "))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 2001, tab = 1))
        post(context, 2000, b.build())
    }

    private const val WORKING_ID = 4000

    /** Pendant la recuperation de fond : une notification discrete, qu'on voit sans qu'elle sonne. */
    fun working(context: Context, title: String, index: Int, total: Int) {
        val b = NotificationCompat.Builder(context, CH_CLAIMS)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_working_title, index, total))
            .setContentText(title)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(total, index - 1, false)
            .setContentIntent(openApp(context, WORKING_ID + 1))
        post(context, WORKING_ID, b.build())
    }

    fun doneWorking(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(WORKING_ID) }
    }

    /**
     * Le magasin demande une verification humaine pendant que personne ne
     * regarde. L'appli ne la resout jamais : elle appelle, et un appui
     * reprend ce jeu-la, a l'ecran.
     */
    fun challenge(context: Context, o: Offer) {
        val id = ("defi:" + o.key).hashCode()
        val b = NotificationCompat.Builder(context, CH_ACCOUNT)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_challenge_title, Stores.label(o.store)))
            .setContentText(context.getString(R.string.notif_challenge_text, o.shownTitle))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(openApp(context, id, claimKey = o.key))
        post(context, id, b.build())
    }

    fun login(context: Context, store: String) {
        val b = NotificationCompat.Builder(context, CH_ACCOUNT)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_login_title, Stores.label(store)))
            .setContentText(context.getString(R.string.notif_login_text))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 3001 + store.hashCode() % 100, tab = 3))
        post(context, 3000 + store.hashCode() % 100, b.build())
    }
}
