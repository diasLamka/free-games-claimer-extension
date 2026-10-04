package io.github.diaslamka.freegames.data

import kotlin.coroutines.cancellation.CancellationException

/**
 * `runCatching` qui ne mange pas l'annulation. `runCatching` attrape aussi CancellationException : une coroutine
 * annulee en plein appel suspendu continuait donc comme si l'appel avait simplement echoue -- elle ecrivait un
 * « introuvable » dans l'etat, ou gardait le « non » d'une lecture qu'elle n'avait pas fini de confirmer.
 */
inline fun <T> runCatchingSuspend(block: () -> T): Result<T> = try {
    Result.success(block())
} catch (e: CancellationException) {
    throw e
} catch (e: Throwable) {
    Result.failure(e)
}
