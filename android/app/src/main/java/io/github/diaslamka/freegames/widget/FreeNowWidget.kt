package io.github.diaslamka.freegames.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import io.github.diaslamka.freegames.MainActivity
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Fmt
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Rules
import io.github.diaslamka.freegames.model.AppState
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.sources.GamerPowerSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * « Gratuit maintenant » sur l'ecran d'accueil (1.16.0) : les jeux gratuits en
 * cours que tu n'as pas encore, celui qui finit le premier en grand, avec un
 * compte a rebours qui defile TOUT SEUL (un `Chronometer` : il n'a pas besoin
 * qu'on le redessine), les suivants dessous, et un bouton pour tout prendre.
 *
 * Il se redessine quand la veille passe, quand l'appli change ce que tu as, et
 * toutes les trente minutes au plus (le minimum qu'Android accorde) pour
 * qu'une offre finie disparaisse.
 */
class FreeNowWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        scope.launch {
            try { refresh(context) } finally { pending.finish() }
        }
    }

    companion object {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Combien d'autres jeux le widget nomme sous le premier. */
        const val MORE = 2

        /**
         * Les jeux a montrer : en cours, pas a toi (registre, ma collection Steam),
         * que l'on peut garder -- celui qui finit le premier en tete, une fin
         * inconnue derriere. Pure.
         */
        fun items(s: AppState, now: Long): List<Offer> = s.offers.values
            .filter { o ->
                o.isOpen(now) && o.keepable != false && o.store != Stores.UNKNOWN &&
                    !(o.source == GamerPowerSource.NAME && o.isExtra) &&
                    Rules.claimedEntry(o, s.library) == null && !Rules.ownedOnSteam(o, s)
            }
            .sortedWith(compareBy<Offer> { it.end ?: Long.MAX_VALUE }.thenBy { it.shownTitle })

        suspend fun refresh(context: Context) {
            Graph.init(context)
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, FreeNowWidget::class.java))
            if (ids.isEmpty()) return
            manager.updateAppWidget(ids, views(context, Graph.store.value, System.currentTimeMillis()))
        }

        /** Le widget tel que l'etat le dit. */
        fun views(context: Context, s: AppState, now: Long, elapsed: Long = SystemClock.elapsedRealtime()): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_free_now)
            val liste = items(s, now)
            val kicker = context.getString(R.string.section_free) + if (liste.isNotEmpty()) " · ${liste.size}" else ""
            v.setTextViewText(R.id.free_kicker, kicker)

            val premier = liste.firstOrNull()
            if (premier == null) {
                v.setTextViewText(R.id.free_title, context.getString(R.string.widget_free_none_title))
                v.setTextViewText(R.id.free_more, context.getString(R.string.widget_free_none))
                v.setViewVisibility(R.id.free_clock, View.GONE)
                v.setViewVisibility(R.id.free_claim, View.GONE)
            } else {
                v.setTextViewText(R.id.free_title, premier.shownTitle)
                val fin = premier.end
                if (fin != null && fin > now) {
                    // Il defile seul : la base est l'instant, sur l'horloge du telephone, ou le decompte arrive a zero.
                    v.setViewVisibility(R.id.free_clock, View.VISIBLE)
                    v.setChronometerCountDown(R.id.free_clock, true)
                    v.setChronometer(R.id.free_clock, elapsed + (fin - now), null, true)
                } else {
                    v.setViewVisibility(R.id.free_clock, View.GONE)
                }
                v.setTextViewText(R.id.free_more, more(context, liste, now))
                val prenable = liste.any { Rules.claimable(it, s.settings) }
                v.setViewVisibility(R.id.free_claim, if (prenable) View.VISIBLE else View.GONE)
            }
            v.setOnClickPendingIntent(
                R.id.free_claim,
                PendingIntent.getActivity(
                    context, 81,
                    Intent(context, MainActivity::class.java)
                        .putExtra(MainActivity.EXTRA_TAB, 0).putExtra(MainActivity.EXTRA_CLAIM, "*")
                        .setAction("claim:*").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            v.setOnClickPendingIntent(
                R.id.free_root,
                PendingIntent.getActivity(
                    context, 82,
                    Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_TAB, 0).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            return v
        }

        /** « Epic Games Store » -> « Epic », « GOG.com » -> « GOG » : la place est comptee. */
        fun court(store: String): String = Stores.label(store).substringBefore(' ').removeSuffix(".com")

        /** Les jeux qui suivent le premier : « GOG · Hades · 2 j 3 h », un par ligne, et « +N » s'il y en a d'autres. */
        fun more(context: Context, liste: List<Offer>, now: Long): String {
            val suite = liste.drop(1)
            val lignes = suite.take(MORE).map { o ->
                val reste = o.end?.takeIf { it > now }?.let { " · " + Fmt.left(context, it, now) }.orEmpty()
                "${court(o.store)} · ${o.shownTitle}$reste"
            }
            val autres = suite.size - MORE
            return (lignes + if (autres > 0) listOf("+$autres") else emptyList()).joinToString("\n")
        }
    }
}
