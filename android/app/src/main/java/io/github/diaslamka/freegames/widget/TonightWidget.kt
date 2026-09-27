package io.github.diaslamka.freegames.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import io.github.diaslamka.freegames.MainActivity
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.data.Graph
import io.github.diaslamka.freegames.data.Tonight
import io.github.diaslamka.freegames.model.AppState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * « Ce soir je joue a... » sur l'ecran d'accueil (1.8.0) : le jeu du soir,
 * pourquoi, et « Un autre ». Toucher le widget ouvre l'onglet Recuperes, ou
 * se trouvent « J'y joue » et « Pas pour moi ».
 *
 * Pas de minuterie : la veille de fond le redessine a chaque passage, l'appli
 * a chaque changement du choix.
 */
class TonightWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pending = goAsync()
        scope.launch {
            try { refresh(context) } finally { pending.finish() }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_ANOTHER) return
        val pending = goAsync()
        scope.launch {
            try {
                Graph.init(context)
                Graph.store.update { Tonight.reroll(it, System.currentTimeMillis()) }
                refresh(context)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_ANOTHER = "io.github.diaslamka.freegames.CE_SOIR_UN_AUTRE"
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Retient le choix du soir s'il vient d'etre tire, puis redessine chaque widget pose. */
        suspend fun refresh(context: Context) {
            Graph.init(context)
            val now = System.currentTimeMillis()
            val s = Graph.store.update { st ->
                val (_, pick) = Tonight.current(st, now)
                if (pick != st.tonight) st.copy(tonight = pick) else st
            }
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TonightWidget::class.java))
            if (ids.isEmpty()) return
            manager.updateAppWidget(ids, views(context, s, now))
        }

        /** Le widget tel que l'etat le dit. Pur, a l'intention pres : les tests le dessinent. */
        fun views(context: Context, s: AppState, now: Long): RemoteViews {
            val v = RemoteViews(context.packageName, R.layout.widget_tonight)
            val temps = context.getString(timeLabel(s.tonight.time))
            v.setTextViewText(R.id.widget_kicker, "${context.getString(R.string.tonight_kicker)} · $temps")
            val (jeu, _) = Tonight.current(s, now)
            when {
                Tonight.playing(s.tonight, now) -> {
                    v.setTextViewText(R.id.widget_title, s.tonight.playingTitle.orEmpty())
                    v.setTextViewText(R.id.widget_why, context.getString(R.string.widget_have_fun))
                }
                jeu != null -> {
                    v.setTextViewText(R.id.widget_title, jeu.c.title)
                    v.setTextViewText(R.id.widget_why, jeu.reasons.take(3).joinToString(" · ") { reasonText(context, it) })
                }
                Tonight.buildPile(s).isEmpty() -> {
                    v.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty_title))
                    v.setTextViewText(R.id.widget_why, context.getString(R.string.widget_empty))
                }
                else -> {
                    v.setTextViewText(R.id.widget_title, context.getString(R.string.widget_nothing_title))
                    v.setTextViewText(R.id.widget_why, context.getString(R.string.widget_nothing))
                }
            }
            val empty = jeu == null && !Tonight.playing(s.tonight, now)
            v.setViewVisibility(R.id.widget_another, if (empty) View.GONE else View.VISIBLE)
            v.setOnClickPendingIntent(
                R.id.widget_another,
                PendingIntent.getBroadcast(
                    context, 71, Intent(context, TonightWidget::class.java).setAction(ACTION_ANOTHER),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            v.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(
                    context, 72,
                    Intent(context, MainActivity::class.java).putExtra(MainActivity.EXTRA_TAB, 1).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            return v
        }

        fun timeLabel(time: String): Int = when (time) {
            Tonight.HOUR -> R.string.tonight_hour
            Tonight.WEEKEND -> R.string.tonight_weekend
            Tonight.ANY -> R.string.tonight_any
            else -> R.string.tonight_evening
        }

        /** Une raison, dans la langue du telephone. */
        fun reasonText(context: Context, r: Tonight.Reason): String = when (r.key) {
            "tonight_rating" -> context.getString(R.string.tonight_rating, (r.args.firstOrNull() as? Int) ?: 0)
            "tonight_to_try" -> context.getString(R.string.tonight_to_try)
            "tonight_short" -> context.getString(R.string.tonight_short)
            "tonight_sessions" -> context.getString(R.string.tonight_sessions)
            "tonight_long" -> context.getString(R.string.tonight_long)
            "tonight_deck_verified" -> context.getString(R.string.tonight_deck_verified)
            "tonight_deck_playable" -> context.getString(R.string.tonight_deck_playable)
            else -> ""
        }
    }
}
