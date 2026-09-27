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
    const val CH_HELP = "aide"
    const val CH_LAST_CHANCE = "derniere-chance"
    private const val TAG_LAST_CHANCE = "derniere-chance"

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CH_NEW, context.getString(R.string.channel_new), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_ENDING, context.getString(R.string.channel_ending), NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CH_CLAIMS, context.getString(R.string.channel_claims), NotificationManager.IMPORTANCE_LOW),
                NotificationChannel(CH_ACCOUNT, context.getString(R.string.channel_account), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_HELP, context.getString(R.string.channel_help), NotificationManager.IMPORTANCE_HIGH),
                // Le son des alarmes, sur le flux des alarmes : il sonne meme en mode silencieux.
                NotificationChannel(CH_LAST_CHANCE, context.getString(R.string.channel_last_chance), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.channel_last_chance_hint)
                    val son = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                        ?: android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_NOTIFICATION)
                    setSound(
                        son,
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_ALARM)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
                },
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

    /** `who` : le membre de la famille pour qui l'on a recupere (1.9.0), ou null. */
    fun claimed(context: Context, titles: List<String>, who: String? = null) {
        if (titles.isEmpty()) return
        val id = if (who == null) 2000 else 2100 + (who.hashCode() and 0x3f) * 2
        val b = NotificationCompat.Builder(context, CH_CLAIMS)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.resources.getQuantityString(R.plurals.notif_claimed_title, titles.size, titles.size))
            .setContentText(titles.joinToString(", "))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id + 1, tab = if (who == null) 1 else 3))
        if (who != null) b.setSubText(context.getString(R.string.family_for, who))
        post(context, id, b.build())
    }

    /** Un membre de la famille (1.9.0) : une verification attend, a faire depuis l'appli. */
    fun familyChallenge(context: Context, who: String, o: Offer) {
        val id = ("famille-defi:" + who + o.key).hashCode()
        val b = NotificationCompat.Builder(context, CH_ACCOUNT)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_family_challenge_title, who))
            .setContentText(context.getString(R.string.notif_family_challenge_text, o.shownTitle))
            .setSubText(context.getString(R.string.family_for, who))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id + 1, tab = 3))
        post(context, id, b.build())
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

    /**
     * Le PC demande de l'aide (1.4.0) : une verification humaine l'arrete sur
     * ce jeu. Un appui ouvre l'appli sur lui, par le meme lien que l'alerte
     * ntfy -- et c'est la page du telephone, avec sa session, qui le prend.
     */
    fun help(context: Context, h: io.github.diaslamka.freegames.model.HelpRequest) {
        val id = ("aide:" + h.store + "|" + Titles.normalise(h.title)).hashCode()
        val link = Intent(Intent.ACTION_VIEW, Uri.parse(io.github.diaslamka.freegames.data.Relay.appLink(h.store, h.id, h.title)))
            .setClass(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val b = NotificationCompat.Builder(context, CH_HELP)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_help_title))
            .setContentText(context.getString(R.string.notif_help_text, h.title, Stores.label(h.store)))
            .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.notif_help_text, h.title, Stores.label(h.store))))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(PendingIntent.getActivity(context, id, link, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        post(context, id, b.build())
    }

    /**
     * La derniere chance (1.5.0) : elle sonne en boucle, comme un reveil,
     * jusqu'a ce qu'on la touche ou l'ecarte -- ou qu'on ouvre l'appli.
     */
    suspend fun lastChance(context: Context, o: Offer, s: AppState) {
        val now = System.currentTimeMillis()
        val id = ("derniere:" + o.key).hashCode()
        val text = context.getString(R.string.notif_last_chance_text, Stores.label(o.store), Fmt.left(context, o.end ?: now, now))
        val b = NotificationCompat.Builder(context, CH_LAST_CHANCE)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_last_chance_title, o.shownTitle))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id, claimKey = if (Rules.claimable(o, s.settings)) o.key else null))
        cover(o.image)?.let { b.setLargeIcon(it) }
        if (Rules.claimable(o, s.settings)) b.addAction(0, context.getString(R.string.action_claim), openApp(context, id + 1, claimKey = o.key))
        Titles.webUrl(o.url ?: o.resolveUrl)?.let { b.addAction(0, context.getString(R.string.action_open), openUrl(context, id + 2, it)) }
        val n = b.build().apply { flags = flags or android.app.Notification.FLAG_INSISTENT }
        if (!allowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(TAG_LAST_CHANCE, id, n)
        } catch (_: SecurityException) {
        }
    }

    /** L'appli est ouverte : les alarmes de derniere chance ont ete vues, elles se taisent. */
    fun silenceLastChance(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        runCatching { nm.activeNotifications.filter { it.tag == TAG_LAST_CHANCE }.forEach { nm.cancel(it.tag, it.id) } }
    }

    fun login(context: Context, store: String, who: String? = null) {
        val base = 3000 + store.hashCode() % 100 + (who?.let { 200 + (it.hashCode() and 0x3f) * 4 } ?: 0)
        val b = NotificationCompat.Builder(context, CH_ACCOUNT)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_login_title, Stores.label(store)))
            .setContentText(context.getString(R.string.notif_login_text))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, base + 1, tab = 3))
        if (who != null) b.setSubText(context.getString(R.string.family_for, who))
        post(context, base, b.build())
    }
}
