package io.github.diaslamka.freegames.data

import android.content.Context
import io.github.diaslamka.freegames.R
import io.github.diaslamka.freegames.model.Offer
import io.github.diaslamka.freegames.model.Stores
import io.github.diaslamka.freegames.model.Upcoming

/**
 * La liste a partager -- comme « Copier la liste » de l'extension
 * (watch/share-list.js) : les jeux gratuits, leur magasin, leur valeur,
 * jusqu'a quand, et le lien. Rien de personnel : ni ce qu'on possede, ni les
 * souhaits.
 */
object ShareText {
    const val MAX_GAMES = 15
    const val MAX_SOON = 5

    fun compose(context: Context, offers: List<Offer>, soon: List<Upcoming>, now: Long): String {
        val lines = mutableListOf(context.getString(R.string.share_header, Fmt.day(now)), "")
        for (o in offers.take(MAX_GAMES)) {
            val parts = mutableListOf(o.shownTitle, Stores.label(o.store) + if (o.isExtra) " · DLC" else "")
            o.worth?.let { parts += it }
            parts += if (o.end != null) context.getString(R.string.share_until, Fmt.dateTime(o.end)) else context.getString(R.string.share_no_end)
            lines += "• " + parts.joinToString(" — ")
            (o.url ?: o.resolveUrl)?.takeIf { it.startsWith("https://") }?.let { lines += "  $it" }
        }
        if (offers.size > MAX_GAMES) lines += "+${offers.size - MAX_GAMES}"
        val next = soon.filter { it.start > now }.take(MAX_SOON)
        if (next.isNotEmpty()) {
            lines += listOf("", context.getString(R.string.share_upcoming))
            for (w in next) {
                lines += "• " + listOf(w.title, context.getString(R.string.share_from, Fmt.dateTime(w.start))).joinToString(" — ")
                w.url?.let { lines += "  $it" }
            }
        }
        return lines.joinToString("\n")
    }
}
