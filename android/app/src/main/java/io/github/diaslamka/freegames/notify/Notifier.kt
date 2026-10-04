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
import io.github.diaslamka.freegames.sources.Localize
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.data.Taste
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
    const val CH_UPDATE = "mise-a-jour"
    const val CH_HEALTH = "sante"
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
                NotificationChannel(CH_UPDATE, context.getString(R.string.channel_update), NotificationManager.IMPORTANCE_DEFAULT),
                NotificationChannel(CH_HEALTH, context.getString(R.string.channel_health), NotificationManager.IMPORTANCE_DEFAULT),
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
            context, code,
            Intent(Intent.ACTION_VIEW, Uri.parse(Localize.url(url, Graph.store.value.settings.country) ?: url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private suspend fun cover(url: String?): Bitmap? {
        if (url == null) return null
        // Un recepteur d'alarme n'a que dix secondes : fenetre epuisee ou reseau lent, la notification sonne sans image.
        val timeout = coverTimeoutMs(kotlin.coroutines.coroutineContext[CoverBudget]?.untilMs, System.currentTimeMillis())
        if (timeout <= 0) return null
        val bytes = Graph.http.bytes(url, timeoutMs = timeout) ?: return null
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
        // « Deuxieme chance » (1.12.0) : un jeu deja vu passer sans l'avoir, a la fois d'avant en toutes lettres.
        val second = Rules.secondChance(o, s, now)
        val title = when {
            wished -> context.getString(R.string.notif_wished_title, o.shownTitle)
            second != null -> context.getString(R.string.notif_second_chance_title, o.shownTitle)
            else -> context.getString(R.string.notif_new_title, o.shownTitle, Stores.label(o.store))
        }
        val id = o.key.hashCode()
        val b = NotificationCompat.Builder(context, CH_NEW)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(title)
            .setContentText(details(context, o, now))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, id))
            .setPriority(if (wished || second != null) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
        // Ce que le jeu a de particulier, en mots : la fois d'avant (1.12.0), puis de quoi il se rapproche de tes gouts (1.14.0).
        val lignes = mutableListOf<String>()
        if (second != null) lignes += context.getString(R.string.notif_second_chance_line, Fmt.monthInText(second.ts), Stores.label(second.store))
        Taste.matchFor(s, Taste.appidOf(o, s))?.let { m ->
            val noms = Taste.names(s, m.top)
            lignes += if (noms.isEmpty()) context.getString(R.string.notif_taste_line_bare) else context.getString(R.string.notif_taste_line, noms.joinToString(", "))
        }
        val texte = (listOf(details(context, o, now)) + lignes).joinToString("\n")
        if (lignes.isNotEmpty()) b.setContentText(texte).setStyle(NotificationCompat.BigTextStyle().bigText(texte))
        // Avec une jaquette, le style change : les lignes de plus passent dans le sous-titre du grand format.
        cover(o.image)?.let {
            b.setLargeIcon(it).setStyle(
                NotificationCompat.BigPictureStyle().bigPicture(it).bigLargeIcon(null as Bitmap?)
                    .also { st -> if (lignes.isNotEmpty()) st.setSummaryText(lignes.joinToString("\n")) },
            )
        }
        if (Rules.claimable(o, s.settings)) b.addAction(0, context.getString(R.string.action_claim), openApp(context, id + 1, claimKey = o.key))
        Titles.webUrl(o.url ?: o.resolveUrl)?.let { b.addAction(0, context.getString(R.string.action_open), openUrl(context, id + 2, it)) }
        // « Plus tard » (1.12.0) : pas dans les deux dernieres heures -- reporter serait refuser.
        if (Snooze.allowed(o, now)) b.addAction(0, context.getString(R.string.action_snooze), Snooze.button(context, o.key))
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

    /** Le resume du jour (1.13.0) : ce que le jour a apporte, en une seule notification. */
    fun digest(context: Context, offers: List<Offer>, s: AppState) {
        val style = NotificationCompat.InboxStyle()
        offers.take(7).forEach { style.addLine("${it.shownTitle} — ${Stores.label(it.store)}") }
        if (offers.size > 7) style.setSummaryText("+${offers.size - 7}")
        val b = NotificationCompat.Builder(context, CH_NEW)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.resources.getQuantityString(R.plurals.notif_digest_title, offers.size, offers.size))
            .setContentText(offers.take(3).joinToString(", ") { it.shownTitle })
            .setStyle(style)
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 1011))
        if (offers.any { Rules.claimable(it, s.settings) }) b.addAction(0, context.getString(R.string.action_claim_all), openApp(context, 1012, claimKey = "*"))
        post(context, 1010, b.build())
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

    /** Une version plus recente existe (1.20.0) : un clic mene aux reglages, ou elle s'installe. */
    /** La sentinelle (1.27.0) : la veille ne tourne plus. Un toucher ouvre les Reglages (la page Sante), un bouton les reglages d'Android de l'appli. */
    fun watchdog(context: Context, silentMs: Long) {
        val text = context.getString(R.string.notif_watchdog_text, Watchdog.hoursText(silentMs))
        val settings = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val b = NotificationCompat.Builder(context, CH_HEALTH)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_watchdog_title))
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 7301, tab = 3))
            .addAction(0, context.getString(R.string.action_app_settings), PendingIntent.getActivity(context, 7302, settings, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        post(context, 7301, b.build())
    }

    /** Le resultat d'un test de la veille (1.27.0), en notification : l'ecran est eteint, c'est la seule facon de le lire. */
    fun testDone(context: Context, r: io.github.diaslamka.freegames.model.PassRecord, claimOn: Boolean) {
        val done = r.outcome == io.github.diaslamka.freegames.data.PassLog.OK || r.outcome == io.github.diaslamka.freegames.data.PassLog.ERRORS
        val screen = context.getString(if (r.screenOff) R.string.screen_state_off else R.string.screen_state_on)
        val lines = mutableListOf<String>()
        if (done) {
            lines += context.getString(R.string.notif_test_text, r.offers, r.fresh, io.github.diaslamka.freegames.data.PassLog.duration(r.ms), screen)
            lines += if (claimOn) context.getString(R.string.notif_test_claimed, r.claimed ?: 0) else context.getString(R.string.notif_test_claim_off)
        } else {
            lines += r.errors.joinToString(" | ").ifEmpty { r.outcome }
        }
        val text = lines.filter { it.isNotEmpty() }.joinToString("\n")
        val b = NotificationCompat.Builder(context, CH_HEALTH)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(if (done) R.string.notif_test_ok else R.string.notif_test_failed))
            .setContentText(text.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 7310, tab = 3))
        post(context, 7310, b.build())
    }

    fun updateAvailable(context: Context, version: String) {
        val b = NotificationCompat.Builder(context, CH_UPDATE)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_update_title, version))
            .setContentText(context.getString(R.string.notif_update_text))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 3900, tab = 3))
        if (!allowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(3900, b.build())
        } catch (_: SecurityException) {
        }
    }

    /**
     * La mise a jour automatique est telechargee et verifiee (1.25.0), mais Android veut un geste : cette
     * notification porte sa fenetre « Mettre a jour cette appli ? ». Un toucher l'ouvre.
     */
    fun updateConfirm(context: Context, confirm: android.content.Intent) {
        val pending = android.app.PendingIntent.getActivity(
            context, 3901, confirm.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val b = NotificationCompat.Builder(context, CH_UPDATE)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_update_confirm_title))
            .setContentText(context.getString(R.string.notif_update_confirm_text))
            .setAutoCancel(true)
            .setContentIntent(pending)
        if (!allowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(3901, b.build())
        } catch (_: SecurityException) {
        }
    }

    /** Le moteur n'a pas reconnu le bouton (1.21.0) : toucher la notification ouvre l'appli, ou « Recuperer » le lui montre. */
    fun teach(context: Context, o: Offer) {
        val b = NotificationCompat.Builder(context, CH_ACCOUNT)
            .setSmallIcon(R.drawable.ic_stat_ticket)
            .setContentTitle(context.getString(R.string.notif_teach_title, o.shownTitle))
            .setContentText(context.getString(R.string.notif_teach_text, Stores.label(o.store)))
            .setStyle(NotificationCompat.BigTextStyle().bigText(context.getString(R.string.notif_teach_text, Stores.label(o.store))))
            .setAutoCancel(true)
            .setContentIntent(openApp(context, 3950 + (o.key.hashCode() and 0x3f), claimKey = o.key))
        if (!allowed(context)) return
        try {
            NotificationManagerCompat.from(context).notify(3950 + (o.key.hashCode() and 0x3f), b.build())
        } catch (_: SecurityException) {
        }
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
