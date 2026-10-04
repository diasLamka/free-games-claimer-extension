package io.github.diaslamka.freegames.notify

import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/** Le plafond de temps d'une jaquette : au-dela, la notification sonne sans image. */
internal const val COVER_MAX_MS = 5_000L

/** La part des dix secondes d'un recepteur (goAsync) laissee aux jaquettes. */
internal const val RECEIVER_COVER_MS = 6_000L

/** Ce que les jaquettes d'un recepteur d'alarme (goAsync : dix secondes en avant-plan) peuvent encore prendre, jusqu'a `untilMs`. */
class CoverBudget(val untilMs: Long) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<CoverBudget>
}

/** Le delai a donner au telechargement d'une jaquette : le plafond, ou ce qui reste de la fenetre du recepteur ; 0 : plus la peine. */
internal fun coverTimeoutMs(untilMs: Long?, now: Long): Long =
    if (untilMs == null) COVER_MAX_MS else (untilMs - now).coerceIn(0L, COVER_MAX_MS)
